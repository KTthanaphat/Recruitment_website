import { sourcingCycleSaturday } from "../../../src/lib/dates";
import { expect, type Page, type Route } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ACTIVE_PIPELINE_STAGES, SOURCING_CHANNELS } from "../../../src/lib/constants";
import { compareApplicationLogs } from "../../../src/lib/application-stage-order";
import { enrichCandidates, enrichOffers, enrichRequisitions, enrichWorkspaceLinkedGroups } from "../../../src/lib/data";
import { countsTowardHeadcount } from "../../../src/lib/offer-headcount";
import { deriveDataQualityIssues, deriveWorkQueue, sourcingApplicants } from "../../../src/lib/operations";
import { deriveSourcingStageChannels } from "../../../src/lib/sourcing-stage-channels";
import { buildRejectionReport, sortRejectionEvents } from "../../../src/lib/rejection-report";
import { buildVacancyRiskReport, riskGroups, riskGroupKey, riskRowMatches } from "../../../src/lib/vacancy-risk-report";
import { buildStageBottleneckReport } from "../../../src/lib/stage-bottleneck-report";
import { buildPerformanceReport, previousPerformanceRange } from "../../../src/lib/recruitment-performance";
import { buildPipelineReport } from "../../../src/lib/pipeline-report";
import { requisitionSnapshotAt } from "../../../src/lib/dashboard-report-eligibility";
import { formatRecruitmentId } from "../../../src/lib/format";
import { buildLegacyWelcomeSummary } from "./legacy-welcome-summary";
import type { DashboardData, Language, Role } from "../../../src/types/recruitment";

type MockUserRole = Role;

type MockSupabaseOptions = {
  language?: Language | null;
  role?: MockUserRole;
  now?: Date;
  countDelayMs?: number;
  countFailureOnceEntity?: string;
  emptyContinuationOnceEntity?: string;
  welcomeSummaryDelayMs?: number;
  welcomeSummaryFailureOnce?: boolean;
  homeBannerSummaryDelayMs?: number;
  homeBannerSummaryFailureOnce?: boolean;
};

export type MockRpcCall = {
  endpoint: string;
  payload: Record<string, unknown>;
  response?: unknown;
};

export type MockSupabaseContext = {
  data: DashboardData;
  rpcCalls: MockRpcCall[];
  restReads: Array<{ table: string; scopedCandidate: string; candidateIds: string[]; inFilterSizes: Record<string, number> }>;
  excludeBootstrapCandidate: (candidateId: string) => void;
};

const fixtureNow = new Date("2026-07-24T05:00:00.000Z");

function recruitmentPipelineRowMatches(data: DashboardData, row: ReturnType<typeof enrichCandidates>[number], entity: string, filters: Record<string, unknown>, search: string) {
  const application = data.candidate_applications?.find(item => item.application_id === row.application_id);
  const board = String(filters.boardFilter ?? "all");
  if (filters.candidateId && row.candidate_id !== String(filters.candidateId)) return false;
  if (board === "failed") { if (row.latest_result !== 0) return false; }
  else if (board === "passed_offer") { if (row.latest_process !== "Offer" || row.latest_result !== 1) return false; }
  else if (entity === "pipeline_stage") { if (row.latest_result === 0 || row.latest_process === "Offer" && row.latest_result === 1) return false; }
  else if (!filters.candidateId && !filters.homeTab && (application?.state !== "active" || row.latest_result === 0 || row.latest_process === "Offer" && row.latest_result === 1)) return false;
  if (filters.homeTab === "active_pipeline" && (row.latest_process === "No activity" || row.latest_result === 0 || data.offers.some(offer => offer.candidate_id === row.candidate_id))) return false;
  if (filters.groupId && row.group_id !== filters.groupId || filters.headerSite && !row.sites.includes(String(filters.headerSite)) || filters.headerPic && !row.person_in_charges.includes(String(filters.headerPic)) || filters.priorityOnly && row.doc_ids.every(id => !data.requisitions.some(req => req.doc_id === id && req.is_priority))) return false;
  if (filters.stage && row.latest_process !== filters.stage) return false;
  if (board === "failed" && filters.recentSince) {
    const failDate = data.recruitment_logs.filter(log => log.application_id === row.application_id && !log.superseded_at && log.result === 0).sort((a, b) => String(b.outcome_date ?? b.log_date).localeCompare(String(a.outcome_date ?? a.log_date)))[0]?.outcome_date;
    if (!failDate || String(failDate).slice(0, 10) < String(filters.recentSince)) return false;
  }
  if (board === "passed_offer" && filters.recentSince && (!row.latest_log_date || row.latest_log_date < String(filters.recentSince))) return false;
  if (board === "no_activity" && row.latest_process !== "No activity") return false;
  if (board === "offer_pending" && !(row.latest_process === "Offer" && row.latest_result === null && !row.accepted_date)) return false;
  if (board === "aging" || board === "over_sla") {
    const touch = row.latest_log_date ?? row.updated_at.slice(0, 10), asOf = String(filters.asOf ?? "2026-07-24");
    if (row.latest_result === 0 || row.accepted_date || !ACTIVE_PIPELINE_STAGES.includes(row.latest_process as never) || Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${touch}T12:00:00Z`) <= 7 * 86_400_000) return false;
  }
  const blob = [row.candidate_id, formatRecruitmentId(row.candidate_id), row.name, row.nickname, row.phone_no, row.email, row.doc_ids.join(" "), row.group_position, row.site, row.person_in_charge].join(" ").toLocaleLowerCase();
  return blob.includes(search);
}

const roleUserIds: Record<MockUserRole, string> = {
  system_admin: "qa-system",
  admin_recruiter: "qa-admin",
  site_recruiter: "qa-site",
  viewer: "qa-viewer"
};

export async function installMockSupabase(page: Page, options: MockSupabaseOptions = {}): Promise<MockSupabaseContext> {
  const role = options.role ?? "admin_recruiter";
  const language = options.language === undefined ? "en" : options.language;
  const data = createRecruitmentDataset(role);
  data.candidate_applications = data.candidates.map((candidate, index) => ({ application_id: `00000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`, candidate_id: candidate.candidate_id, group_id: candidate.group_id ?? data.document_groups.find(link=>link.doc_group_id===candidate.doc_group_id)?.group_id ?? "GRP-ENG", state: data.offers.some(offer=>offer.candidate_id===candidate.candidate_id&&offer.accepted_date&&offer.start_confirmation!=="did_not_start")||data.recruitment_logs.some(log=>log.candidate_id===candidate.candidate_id&&log.result===0)?"closed":"active", closure_reason: null, closed_at: null, created_by: data.profile?.id??null, version: 1, created_at:candidate.created_at,updated_at:candidate.updated_at }));
  data.candidate_application_assignments = data.candidate_applications.map((application,index)=>({assignment_id:`10000000-0000-4000-8000-${String(index+1).padStart(12,"0")}`,application_id:application.application_id,group_id:application.group_id,from_group_id:null,started_at:application.created_at,ended_at:null,actor_id:data.profile?.id??null,reason:null,attribution_inferred:true}));
  data.candidate_notes=[];
  data.candidates.forEach(candidate=> {const app=data.candidate_applications?.find(app=>app.candidate_id===candidate.candidate_id);candidate.home_site=data.requisitions.find(req=>data.document_groups.some(link=>link.group_id===app?.group_id&&link.doc_id===req.doc_id))?.site??"HQ";candidate.created_by=data.profile?.id;candidate.responsible_recruiter_id=data.profile?.id??null;});
  [...data.recruitment_logs,...data.offers,...data.candidate_reference_checks].forEach(record=>{record.application_id=data.candidate_applications?.find(app=>app.candidate_id===record.candidate_id)?.application_id;});
  data.recruitment_log_history=data.recruitment_logs;
  data.recruitment_logs.forEach(log=>{const assignment=data.candidate_application_assignments?.find(row=>row.application_id===log.application_id);log.entry_assignment_id=assignment?.assignment_id;log.outcome_assignment_id=log.result===null?null:assignment?.assignment_id;});
  const rpcCalls: MockRpcCall[] = [];
  const failedCountEntities = new Set<string>();
  const emptyContinuationEntities = new Set<string>();
  let welcomeSummaryFailed = false;
  let homeBannerSummaryFailed = false;
  const restReads: MockSupabaseContext["restReads"] = [];
  const bootstrapExcludedCandidateIds = new Set<string>();
  const supabaseUrl = readPublicSupabaseUrl();
  const storageKey = supabaseStorageKey(supabaseUrl);
  const userId = roleUserIds[role];
  const userEmail = `${role.replace("_", ".")}@qa.example.com`;

  await page.clock.setFixedTime(options.now ?? fixtureNow);

  await page.addInitScript(
    ({ key, id, email, language: savedLanguage }) => {
      window.localStorage.setItem(key, JSON.stringify({
        access_token: "qa-access-token",
        token_type: "bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        refresh_token: "qa-refresh-token",
        user: {
          id,
          aud: "authenticated",
          role: "authenticated",
          email,
          app_metadata: {},
          user_metadata: {}
        }
      }));
      if (savedLanguage) window.localStorage.setItem("recruitment_lang", savedLanguage);
    },
    { key: storageKey, id: userId, email: userEmail, language }
  );

  await page.route("**/auth/v1/user", async (route) => {
    await json(route, {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: userEmail,
      app_metadata: {},
      user_metadata: {}
    });
  });

  await page.route("**/rest/v1/rpc/**", async (route) => {
    const requestedEndpoint = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
    let endpoint = requestedEndpoint;
    const body = route.request().postDataJSON() as { payload?: Record<string, unknown>; p_entity?: string; p_search?: string; p_filters?: Record<string, unknown>; p_sort?: string; p_direction?: string; p_limit?: number; p_cursor_value?: unknown; p_cursor_id?: string | null; p_before?: boolean; p_after_group_id?: string | null; p_after_candidate_id?: string | null; p_after_application_id?: string | null; p_group_id?: string | null } | undefined;
    const wrapped = requestedEndpoint === "app_candidate_action_v1";
    if (wrapped) endpoint = String(asRecord(body).p_operation);
    const payload = wrapped ? asRecord(asRecord(body).p_payload) : body?.payload ?? {};
    if (wrapped) rpcCalls.push({ endpoint: requestedEndpoint, payload: { ...body } });
    if (endpoint === "app_pipeline_card_location_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const criteria=asRecord(body?.p_filters), search=String(body?.p_search??"").trim().toLowerCase();
      const rows=enrichCandidates(data).filter(row=>recruitmentPipelineRowMatches(data,row,"pipeline_stage",criteria,search)).sort((a,b)=>String(a.latest_log_date??a.updated_at??"").localeCompare(String(b.latest_log_date??b.updated_at??""))||String(a.application_id).localeCompare(String(b.application_id)));
      const index=rows.findIndex(row=>row.application_id===asRecord(body).p_application_id), blockStart=Math.floor(index/25)*25, previous=rows[blockStart-1];
      await json(route,index<0?{excluded:true}:{application_id:rows[index].application_id,block:Math.floor(index/25),offset:index%25,page:Math.floor(index/5)+1,cursor:previous?{value:previous.latest_log_date??previous.updated_at??"",id:previous.application_id}:null}); return;
    }
    const admin=["system_admin","admin_recruiter"].includes(data.profile?.role??"");
    const pic=(groupId:string)=>data.document_groups.some(link=>link.group_id===groupId&&data.requisitions.some(req=>req.doc_id===link.doc_id&&[data.profile?.nickname,data.profile?.full_name].some(name=>name&&name.trim().toLowerCase()===req.person_in_charge?.trim().toLowerCase())));
    const reportScope=asRecord(body?.p_scope),reportRequisitions=()=>enrichRequisitions(data).filter(row=>(!reportScope.headerSite||row.site===reportScope.headerSite)&&(!reportScope.headerPic||row.person_in_charge?.trim().toLowerCase()===String(reportScope.headerPic).trim().toLowerCase())&&(!reportScope.priorityOnly||row.is_priority)&&(!Array.isArray(reportScope.sites)||!reportScope.sites.length||reportScope.sites.includes(row.site))&&(!Array.isArray(reportScope.departments)||!reportScope.departments.length||reportScope.departments.includes(row.department))&&(!Array.isArray(reportScope.levels)||!reportScope.levels.length||reportScope.levels.includes(row.level)));
    const reportToday=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(options.now??fixtureNow);
    const reportPeriod=String(body?.p_period??"custom") as "mtd"|"ytd"|"pim"|"custom";
    if(endpoint==="app_masked_candidate_pool_v1") { await json(route,data.masked_candidate_pool??[]);return; }
    if(endpoint==="app_application_destinations_v1") { await json(route,data.application_destinations??data.position_groups.filter(group=>data.document_groups.some(link=>link.group_id===group.group_id&&data.requisitions.some(req=>req.doc_id===link.doc_id&&req.status==="ongoing"&&req.head_count>data.offers.filter(offer=>offer.doc_id===req.doc_id&&offer.accepted_date&&offer.start_confirmation!=="did_not_start").length))).map(group=>({...group,sites:[],owners:[],doc_ids:[]})));return; }
    if(endpoint==="app_application_destinations_page_v1") {
      const call: MockRpcCall = { endpoint, payload: { ...body } }; rpcCalls.push(call);
      const search=String(body?.p_search??"").trim().toLocaleLowerCase(),after=String(body?.p_after_group_id??""),limit=Math.max(1,Math.min(100,Number(body?.p_limit??50)));
      const rows=(data.application_destinations??data.position_groups.filter(group=>data.document_groups.some(link=>link.group_id===group.group_id&&data.requisitions.some(req=>req.doc_id===link.doc_id&&req.status==="ongoing"&&req.head_count>data.offers.filter(offer=>offer.doc_id===req.doc_id&&offer.accepted_date&&offer.start_confirmation!=="did_not_start").length))).map(group=>({...group,sites:[],owners:[],doc_ids:[]})))
        .filter(group=>[group.group_id,group.group_id.replace(/^(GRP)-(\d+)$/u,(_m,prefix,digits)=>`${prefix}-${digits.padStart(5,"0")}`),group.group_position,...(group.sites??[]),...(group.owners??[]),...(group.doc_ids??[])].join(" ").toLocaleLowerCase().includes(search))
        .sort((a,b)=>a.group_id.localeCompare(b.group_id,"en",{numeric:true})).filter(group=>!after||group.group_id.localeCompare(after,"en",{numeric:true})>0);
      const items=rows.slice(0,limit),hasMore=rows.length>limit,last=items.at(-1);
      const response={items,has_more:hasMore,next_cursor:hasMore&&last?{group_id:last.group_id}:null};call.response=response;
      await json(route,response);return;
    }
    if(endpoint==="app_offer_candidates_page_v1") {
      const call:MockRpcCall={endpoint,payload:{...body}};rpcCalls.push(call);
      const search=String(body?.p_search??"").trim().toLocaleLowerCase(),afterCandidate=String(body?.p_after_candidate_id??""),afterApplication=String(body?.p_after_application_id??""),limit=Math.max(1,Math.min(100,Number(body?.p_limit??50)));
      const options=(data.candidate_applications??[]).flatMap(app=>{
        const candidate=data.candidates.find(row=>row.candidate_id===app.candidate_id);if(!candidate||app.state!=="active")return [];
        if(body?.p_group_id&&app.group_id!==body.p_group_id)return [];
        const latest=data.recruitment_logs.filter(log=>(log.application_id===app.application_id||(!log.application_id&&log.candidate_id===app.candidate_id))&&!log.superseded_at&&!(log as unknown as Record<string,unknown>).superseded_by_stage_instance_id).sort(compareApplicationLogs).at(-1);
        if(latest?.recruitment_process!=="Offer"||latest.result!==1||data.offers.some(offer=>offer.application_id===app.application_id||(!offer.application_id&&offer.candidate_id===app.candidate_id)))return [];
        const docIds=data.requisitions.filter(req=>data.document_groups.some(link=>link.group_id===app.group_id&&link.doc_id===req.doc_id)&&req.status==="ongoing"&&req.head_count>data.offers.filter(offer=>offer.doc_id===req.doc_id&&offer.accepted_date&&offer.start_confirmation!=="did_not_start").length).map(req=>req.doc_id);
        const displayId=candidate.candidate_id.replace(/^(CAN)-(\d+)$/u,(_m,prefix,digits)=>`${prefix}-${digits.padStart(5,"0")}`);
        if(!docIds.length||![candidate.candidate_id,displayId,candidate.name,data.position_groups.find(group=>group.group_id===app.group_id)?.group_position,docIds.join(" ")].join(" ").toLocaleLowerCase().includes(search))return [];
        return [{candidate_id:candidate.candidate_id,application_id:app.application_id,name:candidate.name,group_position:data.position_groups.find(group=>group.group_id===app.group_id)?.group_position??"",doc_ids:docIds}];
      }).sort((a,b)=>a.candidate_id.localeCompare(b.candidate_id,"en",{numeric:true})||a.application_id.localeCompare(b.application_id));
      const eligible=afterCandidate?options.filter(row=>row.candidate_id.localeCompare(afterCandidate,"en",{numeric:true})>0||row.candidate_id===afterCandidate&&row.application_id>afterApplication):options,items=eligible.slice(0,limit),hasMore=eligible.length>limit,last=items.at(-1);
      call.response={items,has_more:hasMore,next_cursor:hasMore&&last?{candidate_id:last.candidate_id,application_id:last.application_id}:null};
      await json(route,call.response);return;
    }
    if(endpoint==="app_dashboard_performance_summary_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const summary=(start:string,end:string)=>{const requisitions=reportRequisitions(),report=buildPerformanceReport(data,requisitions,enrichOffers(data),{start,end},reportPeriod,String(reportScope.headerSite??""),"");return {range:{start,end},metrics:report.metrics,cells:report.cells,sites:report.sites};};
      await json(route,{current:summary(String(body?.p_start),String(body?.p_end)),prior:summary(String(body?.p_prior_start),String(body?.p_prior_end)),priorRange:{start:String(body?.p_prior_start),end:String(body?.p_prior_end)}});return;
    }
    if(endpoint==="app_dashboard_pipeline_summary_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const start=String(body?.p_start),end=String(body?.p_end),channel=String(body?.p_channel??"all"),requisitions=reportRequisitions(),report=buildPipelineReport(data,enrichOffers(data),requisitions,{start,end,valid:Boolean(start&&end&&start<=end)},reportPeriod,Array.isArray(reportScope.levels)?reportScope.levels as never[]:[],channel,language??"en");
      const waterfallRows: Array<{waterfall_category:string;site:string;request_type:string;vacancy_count:number;filledInSla:number;filledSlaUnknown:number}> = [];
      const before=new Date(`${start}T00:00:00Z`);before.setUTCDate(before.getUTCDate()-1);const openingDate=before.toISOString().slice(0,10);
      for(const req of report.requisitions){const opened=String(req.pr_approved_date??req.created_at??"").slice(0,10),opening=requisitionSnapshotAt(data,req,openingDate).remaining,closing=requisitionSnapshotAt(data,req,end).remaining;
        if(opened&&opened<start&&opening>0)waterfallRows.push({waterfall_category:"Week Start",site:req.site,request_type:req.request_type??"New",vacancy_count:opening,filledInSla:0,filledSlaUnknown:0});
        if(opened&&opened>=start&&opened<=end)waterfallRows.push({waterfall_category:"Open",site:req.site,request_type:req.request_type??"New",vacancy_count:req.head_count,filledInSla:0,filledSlaUnknown:0});
        const contribution=buildPerformanceReport(data,[req],enrichOffers(data),{start,end},reportPeriod).requisitionContributions[0];
        if(contribution?.filled)waterfallRows.push({waterfall_category:"Filled",site:req.site,request_type:req.request_type??"New",vacancy_count:-contribution.filled,filledInSla:contribution.onTime,filledSlaUnknown:contribution.unknownSla});
        waterfallRows.push({waterfall_category:"Total",site:req.site,request_type:req.request_type??"New",vacancy_count:closing,filledInSla:0,filledSlaUnknown:0});
      }
      await json(route,{range:{start,end},reassignments:report.reassignments,funnelRows:report.funnelRows,sourceRows:report.sourceRows,waterfallRows,channelOptions:[...SOURCING_CHANNELS.map(row=>row.label),"Unknown"]});return;
    }
    if(endpoint==="app_dashboard_risk_summary_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const start=String(body?.p_start),end=String(body?.p_end),today=reportToday,requisitions=reportRequisitions(),priorRange={start:String(body?.p_prior_start),end:String(body?.p_prior_end)};
      const report=buildVacancyRiskReport(data,requisitions,{start,end},today,priorRange),totals=report.totals;
      const mapTotals=(value:typeof totals)=>({track:value.track,near:value.near,overdue:value.overdue,unknown:value.unknown,open:value.open,priorityOpen:value.priorityOpen,priority:value.priority,known:value.known,exposure:value.exposure});
      await json(route,{asOf:report.asOf,future:report.future,totals:mapTotals(totals),priorTotals:report.prior?mapTotals(report.prior.totals):null,priorRange:report.priorRange,
        trends:report.trends.map(row=>({date:row.date,...mapTotals(row)})),groups:{site:riskGroups(report.rows,"site").map(row=>({name:row.name,...mapTotals(row)})),department:riskGroups(report.rows,"department").map(row=>({name:row.name,...mapTotals(row)})),"department-site":riskGroups(report.rows,"department-site").map(row=>({name:row.name,...mapTotals(row)}))}});return;
    }
    if(endpoint==="app_dashboard_risk_page_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const asOf=String(body?.p_as_of),grouping=String(body?.p_grouping??"site") as "site"|"department"|"department-site",filter=String(body?.p_filter??"all"),group=String(body?.p_group??""),prior={start:asOf,end:asOf};
      const report=buildVacancyRiskReport(data,reportRequisitions(),{start:asOf,end:asOf},asOf,prior),matches=report.rows.filter(row=>riskRowMatches(row,filter as never)&&(!group||riskGroupKey(row,grouping)===group));
      let offset=0;const after=String(body?.p_after_doc??"");if(after){const index=matches.findIndex(row=>row.requisition.doc_id===after);offset=index<0?0:index+1;}const rows=matches.slice(offset,offset+20),hasMore=offset+rows.length<matches.length,last=rows.at(-1);
      await json(route,{rows:rows.map(row=>({docId:row.requisition.doc_id,site:row.requisition.site,department:row.requisition.department,position:row.requisition.position,personInCharge:row.requisition.person_in_charge,priority:row.requisition.is_priority,level:row.requisition.level,headCount:row.requisition.head_count,open:row.open,kind:row.kind,startDate:row.start,restartDate:row.restart,age:row.age,remaining:row.remaining})),total:matches.length,hasMore,nextCursor:hasMore&&last?{kind:{overdue:0,near:1,track:2,unknown:3}[last.kind],remaining:last.remaining??2147483647,open:last.open,docId:last.requisition.doc_id}:null});return;
    }
    if(endpoint==="app_dashboard_bottleneck_summary_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const start=String(body?.p_start),end=String(body?.p_end),today=reportToday,priorRange={start:String(body?.p_prior_start),end:String(body?.p_prior_end)},channel=String(body?.p_channel??"all"),report=buildStageBottleneckReport(data,reportRequisitions(),{start,end},today,priorRange,channel),statusCounts=Object.fromEntries(["overdue","today","upcoming","unscheduled","unavailable"].map(status=>[status,report.waiting.filter(row=>row.status===status).length]));
      await json(route,{asOf:report.asOf,start:report.start,future:report.future,channel,stages:report.stages,primary:report.primary,metrics:report.metrics,priorMetrics:report.prior?.metrics??null,priorRange:report.priorRange,
        trends:report.trends,excluded:report.excluded,conflicts:report.conflicts,statusCounts,picOptions:[...new Set(report.waiting.map(row=>row.candidate.person_in_charge).filter(Boolean))],channelOptions:[...new Set(data.candidates.map(row=>row.channel?.trim()||"Others"))]});return;
    }
    if(endpoint==="app_dashboard_bottleneck_queue_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const asOf=String(body?.p_as_of??reportToday),channel=String(body?.p_channel??"all"),stage=String(body?.p_stage??""),status=String(body?.p_status??""),picFilter=String(body?.p_pic??""),search=String(body?.p_search??"").trim().toLowerCase(),report=buildStageBottleneckReport(data,reportRequisitions(),{start:asOf,end:asOf},asOf,{start:asOf,end:asOf},"all");
      let rows=report.waiting.filter(row=>(channel==="all"||(row.candidate.channel?.trim()||"Others")===channel)&&(!stage||row.instance.stage===stage)&&(!status||row.status===status)&&(!picFilter||row.requisitions.some(req=>req.person_in_charge===picFilter))&&(!search||[row.candidate.candidate_id,row.candidate.name,row.instance.stage,...row.requisitions.flatMap(req=>[req.doc_id,req.position,req.site,req.person_in_charge])].join(" ").toLowerCase().includes(search)));
      const cursorId=String(body?.p_after_id??body?.p_before_id??"");if(cursorId){const index=rows.findIndex(row=>row.instance.id===cursorId||String(row.instance.logId)===cursorId);if(index>=0)rows=body?.p_before_id?rows.slice(Math.max(0,index-20),index):rows.slice(index+1);}
      const limit=Math.max(1,Math.min(20,Number(body?.p_limit??20))),page=rows.slice(0,limit),hasMore=rows.length>limit,last=page.at(-1);
      await json(route,{rows:page.map(row=>({candidate:{candidate_id:row.candidate.candidate_id,name:row.candidate.name,application_id:row.instance.applicationId??row.candidate.application_id},instance:row.instance,requisitions:row.requisitions.map(req=>({doc_id:req.doc_id,position:req.position,site:req.site,department:req.department,person_in_charge:req.person_in_charge})),wait:row.wait,status:row.status,conflict:row.conflict})),hasMore,hasMoreBefore:Boolean(body?.p_after_id),nextCursor:hasMore&&last?{value:String(last.wait),id:last.instance.id}:null,previousCursor:body?.p_after_id&&page[0]?{value:String(page[0].wait),id:page[0].instance.id}:null});return;
    }
    if(endpoint==="app_dashboard_rejection_summary_v1"||endpoint==="app_dashboard_rejection_page_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const filters=asRecord(body?.p_filters), range={start:String(body?.p_start??"2026-07-01"),end:String(body?.p_end??"2026-07-24")};
      const report=buildRejectionReport(data,enrichRequisitions(data),range,{actor:String(filters.actor??""),stage:String(filters.stage??""),main:String(filters.main??""),detail:String(filters.detail??""),search:String(filters.search??"")});
      if(endpoint==="app_dashboard_rejection_summary_v1") {
        const {events:_events,periodEvents:_periodEvents,comparison,...summary}=report;
        await json(route,{...summary,periodTotal:report.periodEvents.length,stageOptions:report.stages.map(row=>row.stage),comparison:{total:comparison.total,level:comparison.level,reasons:comparison.reasons,main:comparison.main,label:comparison.label,selected:comparison.selected}});return;
      }
      const sort=String(body?.p_sort??"date-desc") as "date-desc"|"date-asc"|"candidate-asc"|"stage-asc";
      let events=sortRejectionEvents(report.events,sort);
      const after=body?.p_after_log_id==null?null:Number(body.p_after_log_id);
      if(after!==null) { const index=events.findIndex(event=>event.logId===after); if(index>=0)events=events.slice(index+1); }
      const page=events.slice(0,25),hasMore=events.length>25,last=page.at(-1);
      await json(route,{events:page.map(({requisitions,...event})=>({ ...event, groupId:event.groupId||null, applicationId:event.applicationId??null, position:event.position||null, requisitions:requisitions.map(req=>({doc_id:req.doc_id,site:req.site,department:req.department,position:req.position,person_in_charge:req.person_in_charge})) })),total:report.events.length,hasMore,nextCursor:hasMore&&last?{value:last.date,logId:last.logId}:null});return;
    }
    if(endpoint==="app_candidate_profile_detail_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const candidateId=String(body?.p_candidate_id??""),candidate=data.candidates.find(row=>row.candidate_id===candidateId)??null,masked=data.masked_candidate_pool?.find(row=>row.candidate_id===candidateId)??null;
      const existing=data.candidate_profile_capabilities?.find(row=>row.candidate_id===candidateId);
      const creator=candidate?.created_by===data.profile?.id,groupPIC=data.candidate_applications?.some(app=>app.candidate_id===candidateId&&pic(app.group_id))??false;
      const capabilities=existing??(candidate?{candidate_id:candidateId,creator_label:data.profiles.find(profile=>profile.id===candidate.created_by)?.nickname??"Creator",can_edit:data.profile?.role!=="viewer"&&(admin||creator||groupPIC),can_read_note:admin||creator||groupPIC,can_edit_note:data.profile?.role!=="viewer"&&(admin||creator),can_add_application:data.profile?.role!=="viewer"&&(admin||creator||groupPIC),is_unmatched:!data.candidate_applications?.some(app=>app.candidate_id===candidateId)}:null);
      const {application_id:_applicationId,application_state:_applicationState,doc_group_id:_docGroupId,group_id:_groupId,...profile}=candidate??{} as typeof data.candidates[number];
      await json(route,{candidate:candidate?profile:null,masked:candidate?null:masked??null,capabilities});return;
    }
    if(endpoint==="app_recruitment_list_count_v1") {
      const call:MockRpcCall={endpoint,payload:{...body}};rpcCalls.push(call);
      const entity=String(body?.p_entity??""),filters=asRecord(body?.p_filters),search=String(body?.p_search??"").trim().toLocaleLowerCase();
      if(options.countDelayMs&&entity==="candidate_registry") await new Promise(resolve=>setTimeout(resolve,options.countDelayMs));
      if(options.countFailureOnceEntity===entity&&!failedCountEntities.has(entity)) { failedCountEntities.add(entity); await json(route,{message:"Temporary count failure"},500);return; }
      if(entity==="candidate_registry") {
        const creatorName=(id:string)=>data.profiles.find(profile=>profile.id===id)?.nickname??"Creator";
        const full=data.candidates.filter(candidate=>{const apps=data.candidate_applications?.filter(row=>row.candidate_id===candidate.candidate_id)??[],unmatched=data.candidate_profile_capabilities?.find(row=>row.candidate_id===candidate.candidate_id)?.is_unmatched??!apps.length,creator=creatorName(candidate.created_by);if(filters.scope==="pool"&&!unmatched||filters.scope==="active"&&!apps.some(row=>row.state==="active")||filters.scope==="history"&&!apps.some(row=>row.state==="closed"))return false;if(filters.site&&candidate.home_site!==filters.site||filters.owner&&creator!==filters.owner)return false;return [candidate.candidate_id,candidate.name,candidate.nickname,candidate.phone_no,candidate.email,candidate.position_interests].join(" ").toLocaleLowerCase().includes(search);});
        const masked=filters.scope==="all"||filters.scope==="pool"?(data.masked_candidate_pool??[]).filter(row=>!data.candidates.some(candidate=>candidate.candidate_id===row.candidate_id)&&(!filters.owner||row.creator_label===filters.owner)&&[row.candidate_id,row.position_interests,row.creator_label].join(" ").toLocaleLowerCase().includes(search)):[];
        await json(route,full.length+masked.length);return;
      }
      if(entity==="candidate_applications"||entity==="pipeline_stage") {
        const rows=enrichCandidates(data).filter(row=>recruitmentPipelineRowMatches(data,row,entity,filters,search));
        call.response=rows.length;await json(route,rows.length);return;
      }
      if(entity==="pipeline_history") {
        const source=enrichCandidates(data),byApp=new Map(source.map(row=>[row.application_id??row.candidate_id,row]));
        const rows=(data.recruitment_log_history??data.recruitment_logs).filter(log=>{const candidate=byApp.get(log.application_id??log.candidate_id);return Boolean(candidate&&(!filters.candidateId||candidate.candidate_id===String(filters.candidateId))&&(!filters.applicationId||candidate.application_id===String(filters.applicationId))&&(filters.showAudit||(!log.superseded_at&&!(log as unknown as Record<string,unknown>).superseded_by_stage_instance_id))&&[candidate.candidate_id,candidate.name,candidate.nickname,candidate.doc_ids.join(" "),candidate.site,candidate.person_in_charge,log.recruitment_process,log.round,log.log_date,log.estimated_action_date,log.interviewer,log.remark,log.result,log.outcome_date,log.outcome_interviewer,log.outcome_remark].join(" ").toLocaleLowerCase().includes(search));});
        await json(route,rows.length);return;
      }
      if(entity==="audit_log") {
        const rows=data.change_logs.filter(row=>(!filters.entity||row.entity.toLowerCase().includes(String(filters.entity).toLowerCase()))&&(!filters.action||row.action.toLowerCase().includes(String(filters.action).toLowerCase()))&&(!filters.changedBy||(row.changed_by_email??row.changed_by??"").toLowerCase().includes(String(filters.changedBy).toLowerCase()))&&(!filters.entityId||row.entity_id.toLowerCase().includes(String(filters.entityId).toLowerCase()))&&(!filters.start||row.changed_at.slice(0,10)>=String(filters.start))&&(!filters.end||row.changed_at.slice(0,10)<=String(filters.end))&&[row.entity,row.action,row.changed_by_email,row.changed_by,row.entity_id].join(" ").toLowerCase().includes(search));
        await json(route,rows.length);return;
      }
      if(entity==="requisitions") { call.response=requisitionListRows(data,filters,search).length; await json(route,call.response);return; }
      if(entity==="offers") { await json(route,offerListRows(data,filters,search).length);return; }
      if(entity==="position_groups") { await json(route,workspaceGroupRows(data,filters,search).length);return; }
      if(entity==="sourcing" || entity==="sourcing_records") { await json(route,sourcingListRows(data,filters,search,options.now ?? fixtureNow).length);return; }
      await json(route,{message:"Mock does not implement this recruitment list count entity."},501);return;
    }
    if(endpoint==="app_candidate_profile_capabilities_v1") { await json(route,data.candidate_profile_capabilities??data.candidates.map(candidate=>{const creator=candidate.created_by===data.profile?.id,groupPIC=data.candidate_applications?.some(app=>app.candidate_id===candidate.candidate_id&&pic(app.group_id))??false;return {candidate_id:candidate.candidate_id,creator_label:data.profiles.find(profile=>profile.id===candidate.created_by)?.nickname??"Creator",can_edit:data.profile?.role!=="viewer"&&(admin||creator||groupPIC),can_read_note:admin||creator||groupPIC,can_edit_note:data.profile?.role!=="viewer"&&(admin||creator),can_add_application:data.profile?.role!=="viewer"&&(admin||creator||groupPIC),is_unmatched:!data.candidate_applications?.some(app=>app.candidate_id===candidate.candidate_id)};}));return; }
    if(endpoint==="app_recruitment_list_v1") {
      const filters=asRecord(body?.p_filters),search=String(body?.p_search??"").trim().toLocaleLowerCase(),limit=Number(body?.p_limit??50);
      if(body?.p_cursor_id)await new Promise(resolve=>setTimeout(resolve,180));
      const listCall: MockRpcCall = { endpoint, payload: { ...body } };
      rpcCalls.push(listCall);
      if(body?.p_entity==="candidate_applications"||body?.p_entity==="pipeline_stage") {
        const enriched=enrichCandidates(data).map(candidate=>{const logs=data.recruitment_logs.filter(log=>(log.application_id===candidate.application_id||(!log.application_id&&log.candidate_id===candidate.candidate_id))&&!log.superseded_at&&!(log as unknown as Record<string,unknown>).superseded_by_stage_instance_id);const pending=[...logs].sort((a,b)=>compareApplicationLogs(b,a)).find(log=>log.result===null);const today=String(filters.asOf??new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()));const touches=logs.flatMap(log=>[log.log_date,log.outcome_date]).filter((value):value is string=>Boolean(value&&String(value).slice(0,10)<=today)).map(value=>String(value).slice(0,10)).sort();const contact=candidate.first_contact_date&&candidate.first_contact_date<=today?candidate.first_contact_date:null;return {...candidate,application_state:data.candidate_applications?.find(app=>app.application_id===candidate.application_id)?.state??"active",home_last_touch_date:touches.at(-1)??contact,home_pending_remark:pending?.remark??null};});
        const allowed=enriched.filter(row=>recruitmentPipelineRowMatches(data,row,String(body?.p_entity),filters,search));
        const sort=String(body?.p_sort??"latest_log_date"),direction=String(body?.p_direction??"desc");
        const sorted=[...allowed].sort((a,b)=>{
          const field=(row:typeof allowed[number])=>sort.startsWith("home_")?(sort==="home_progression"?String(ACTIVE_PIPELINE_STAGES.indexOf(row.latest_process as never)).padStart(2,"0"):String(row.home_last_touch_date??"")):sort==="board_last_update"?(row.latest_log_date??row.updated_at?.slice(0,10)??null):(row as unknown as Record<string,unknown>)[sort];
          const av=String(field(a)??""),bv=String(field(b)??"");
          if((sort==="home_oldest_touch"||sort==="home_newest_touch")&&Boolean(a.home_last_touch_date)!==Boolean(b.home_last_touch_date))return a.home_last_touch_date?-1:1;
          const cmp=av.localeCompare(bv,"en",{numeric:true,sensitivity:"base"});
          return (direction==="desc"?-cmp:cmp)||String(a.application_id).localeCompare(String(b.application_id));
        });
        const cursorId=String(body?.p_cursor_id??""),cursorIndex=cursorId?sorted.findIndex(row=>row.application_id===cursorId):-1,before=body?.p_before===true;
        const start=cursorIndex<0?0:before?Math.max(0,cursorIndex-limit):cursorIndex+1,end=cursorIndex<0?Math.min(limit,sorted.length):before?cursorIndex:Math.min(sorted.length,cursorIndex+1+limit);
        const items=sorted.slice(start,end),hasMore=end<sorted.length,hasMoreBefore=start>0;
        const cursorValue=(row:typeof sorted[number])=>sort.startsWith("home_")?(sort==="home_progression"?ACTIVE_PIPELINE_STAGES.indexOf(row.latest_process as never):row.home_last_touch_date??""):sort==="board_last_update"?(row.latest_log_date??row.updated_at?.slice(0,10)??""):(row as unknown as Record<string,unknown>)[sort]??row.latest_log_date??"";
        await json(route,{items,total_count:sorted.length,has_more:hasMore,has_more_before:hasMoreBefore,next_cursor:hasMore&&items.length?{value:cursorValue(items.at(-1)!),id:String(items.at(-1)!.application_id)}:null,previous_cursor:hasMoreBefore&&items.length?{value:cursorValue(items[0]),id:String(items[0].application_id)}:null});return;
      }
      if(body?.p_entity==="pipeline_history") {
        rpcCalls.push({endpoint,payload:{...body}});
        const source=enrichCandidates(data),byApp=new Map(source.map(row=>[row.application_id??row.candidate_id,row]));
        const rows=(data.recruitment_log_history??data.recruitment_logs).flatMap(log=>{
          const candidate=byApp.get(log.application_id??log.candidate_id);
          if(!candidate||(filters.candidateId&&candidate.candidate_id!==String(filters.candidateId))||(filters.applicationId&&candidate.application_id!==String(filters.applicationId))||(!filters.showAudit&&(log.superseded_at||(log as unknown as Record<string,unknown>).superseded_by_stage_instance_id)))return [];
          return [{candidate,log,audit:Boolean(log.superseded_at||(log as unknown as Record<string,unknown>).superseded_by_stage_instance_id)}];
        }).filter(({candidate,log})=>{
          const blob=[candidate.candidate_id,candidate.name,candidate.nickname,candidate.group_position,candidate.doc_ids.join(" "),candidate.site,candidate.person_in_charge,log.recruitment_process,log.round,log.log_date,log.estimated_action_date,log.interviewer,log.remark,log.result===null?"Pending":log.result===1?"Pass":"Fail",log.outcome_date,log.outcome_interviewer,log.outcome_remark].join(" ").toLocaleLowerCase();
          if(search&&!blob.includes(search))return false;
          const val=String(filters.candidate??"").toLocaleLowerCase();if(val&&![candidate.candidate_id,candidate.name,candidate.nickname].some(item=>String(item??"").toLocaleLowerCase().includes(val)))return false;
          const req=String(filters.requisition??"").toLocaleLowerCase();if(req&&![candidate.group_position,...candidate.doc_ids].some(item=>String(item??"").toLocaleLowerCase().includes(req)))return false;
          if(filters.site&&!String(candidate.site??"").toLocaleLowerCase().includes(String(filters.site).toLocaleLowerCase()))return false;
          if(filters.owner&&!String(candidate.person_in_charge??"").toLocaleLowerCase().includes(String(filters.owner).toLocaleLowerCase()))return false;
          if(filters.stage&&!String(log.recruitment_process).toLocaleLowerCase().includes(String(filters.stage).toLocaleLowerCase()))return false;
          if(filters.pending&&![log.log_date,log.estimated_action_date,log.interviewer,log.remark].join(" ").toLocaleLowerCase().includes(String(filters.pending).toLocaleLowerCase()))return false;
          const outcome=[log.result===null?"Pending":log.result===1?"Pass":"Fail",log.outcome_date,log.outcome_interviewer,log.outcome_remark,log.failure_reason_snapshot].join(" ").toLocaleLowerCase();
          if(filters.outcome&&!outcome.includes(String(filters.outcome).toLocaleLowerCase()))return false;
          if(filters.date&&![log.log_date,log.outcome_date].join(" ").includes(String(filters.date)))return false;
          return true;
        });
        const sort=String(body?.p_sort??"log_date"),direction=String(body?.p_direction??"desc");
        const sortValue=(row:typeof rows[number])=>sort==="date"?row.log.outcome_date??row.log.log_date:sort==="stage"?row.log.recruitment_process:sort==="candidate"?row.candidate.candidate_id:sort==="requisition"?row.candidate.group_position??"":sort==="site"?row.candidate.site??"":sort==="owner"?row.candidate.person_in_charge??"":sort==="pending"?row.log.estimated_action_date??row.log.log_date:sort==="outcome"?row.log.outcome_date??row.log.log_date:row.log.log_date;
        const sorted=[...rows].sort((a,b)=>(direction==="desc"?-1:1)*(String(sortValue(a)).localeCompare(String(sortValue(b)),"en",{numeric:true})||a.log.log_id-b.log.log_id));
        const cursorId=Number(body?.p_cursor_id??0),cursorIndex=cursorId?sorted.findIndex(row=>row.log.log_id===cursorId):-1,before=body?.p_before===true,limit=Number(body?.p_limit??50);
        const start=cursorIndex<0?0:before?Math.max(0,cursorIndex-limit):cursorIndex+1,end=cursorIndex<0?Math.min(limit,sorted.length):before?cursorIndex:Math.min(sorted.length,cursorIndex+1+limit);
        const items=sorted.slice(start,end),hasMore=end<sorted.length,hasMoreBefore=start>0,anchor=(row:typeof sorted[number])=>({value:sortValue(row),id:String(row.log.log_id)});
        await json(route,{items,total_count:sorted.length,has_more:hasMore,has_more_before:hasMoreBefore,next_cursor:hasMore&&items.length?anchor(items.at(-1)!):null,previous_cursor:hasMoreBefore&&items.length?anchor(items[0]):null});return;
      }
      if(body?.p_entity==="audit_log") {
        const rows=data.change_logs.filter(row=>(!filters.entity||row.entity.toLowerCase().includes(String(filters.entity).toLowerCase()))&&(!filters.action||row.action.toLowerCase().includes(String(filters.action).toLowerCase()))&&(!filters.changedBy||(row.changed_by_email??row.changed_by??"").toLowerCase().includes(String(filters.changedBy).toLowerCase()))&&(!filters.entityId||row.entity_id.toLowerCase().includes(String(filters.entityId).toLowerCase()))&&(!filters.start||row.changed_at.slice(0,10)>=String(filters.start))&&(!filters.end||row.changed_at.slice(0,10)<=String(filters.end))&&[row.entity,row.action,row.changed_by_email,row.changed_by,row.entity_id].join(" ").toLowerCase().includes(search));
        const sorted=[...rows].sort((a,b)=>b.changed_at.localeCompare(a.changed_at)||Number(b.log_id)-Number(a.log_id)),cursorId=String(body.p_cursor_id??""),cursorIndex=cursorId?sorted.findIndex(row=>String(row.log_id)===cursorId):-1,before=body.p_before===true,start=cursorIndex<0?0:before?Math.max(0,cursorIndex-limit):cursorIndex+1,end=cursorIndex<0?Math.min(limit,sorted.length):before?cursorIndex:Math.min(sorted.length,cursorIndex+1+limit),items=sorted.slice(start,end),hasMore=end<sorted.length,hasMoreBefore=start>0,anchor=(row:typeof sorted[number])=>({value:row.changed_at,id:String(row.log_id)});
        await json(route,{items,total_count:sorted.length,has_more:hasMore,has_more_before:hasMoreBefore,next_cursor:hasMore&&items.length?anchor(items.at(-1)!):null,previous_cursor:hasMoreBefore&&items.length?anchor(items[0]):null});return;
      }
      if(body?.p_entity==="requisitions") {
        const rows=requisitionListRows(data,filters,search),sort=String(body.p_sort??"updated_at"),direction=String(body.p_direction??"desc"),field=(row:typeof rows[number])=>sort==="home_oldest"?String(Math.floor((Date.now()-Date.parse(row.pr_approved_date??row.updated_at))/86_400_000)).padStart(6,"0"):sort==="home_demand"?String(row.open_headcount).padStart(6,"0"):sort==="home_position"?`${row.position} ${row.level??""}`:sort==="position"?`${row.position} ${row.level??""}`:sort==="readiness"?String(row.sourcing_group_ids.length):sort==="sla"?String(row.sla_restart_date??row.pr_approved_date??""):String((row as unknown as Record<string,unknown>)[sort]??"");
        const sorted=[...rows].sort((a,b)=>{const delta=field(a).localeCompare(field(b),"en",{numeric:true,sensitivity:"base"});return (direction==="desc"?-delta:delta)||a.doc_id.localeCompare(b.doc_id);});
        const cursorId=String(body.p_cursor_id??""),cursorIndex=cursorId?sorted.findIndex(row=>row.doc_id===cursorId):-1,before=body.p_before===true,start=cursorIndex<0?0:before?Math.max(0,cursorIndex-limit):cursorIndex+1,end=cursorIndex<0?Math.min(limit,sorted.length):before?cursorIndex:Math.min(sorted.length,cursorIndex+1+limit),items=sorted.slice(start,end),hasMore=end<sorted.length,hasMoreBefore=start>0,anchor=(row:typeof sorted[number])=>({value:field(row),id:row.doc_id});
        listCall.response={items,total_count:sorted.length,has_more:hasMore,has_more_before:hasMoreBefore,next_cursor:hasMore&&items.length?anchor(items.at(-1)!):null,previous_cursor:hasMoreBefore&&items.length?anchor(items[0]):null};
        await json(route,listCall.response);return;
      }
      if(body?.p_entity==="offers") {
        const rows=offerListRows(data,filters,search),sort=String(body.p_sort??"accepted"),direction=String(body.p_direction??"desc"),field=(row:typeof rows[number])=>String((row as unknown as Record<string,unknown>)[sort]??"");
        const sorted=[...rows].sort((a,b)=>{const delta=field(a).localeCompare(field(b),"en",{numeric:true,sensitivity:"base"});return (direction==="desc"?-delta:delta)||String(a.offer_id).localeCompare(String(b.offer_id),"en",{numeric:true});});
        const cursorId=String(body.p_cursor_id??""),cursorIndex=cursorId?sorted.findIndex(row=>String(row.offer_id)===cursorId):-1,before=body.p_before===true,start=cursorIndex<0?0:before?Math.max(0,cursorIndex-limit):cursorIndex+1,end=cursorIndex<0?Math.min(limit,sorted.length):before?cursorIndex:Math.min(sorted.length,cursorIndex+1+limit),items=sorted.slice(start,end),hasMore=end<sorted.length,hasMoreBefore=start>0,anchor=(row:typeof sorted[number])=>({value:field(row),id:String(row.offer_id)});
        await json(route,{items,total_count:sorted.length,has_more:hasMore,has_more_before:hasMoreBefore,next_cursor:hasMore&&items.length?anchor(items.at(-1)!):null,previous_cursor:hasMoreBefore&&items.length?anchor(items[0]):null});return;
      }
      if(body?.p_entity==="position_groups") {
        const rows=workspaceGroupRows(data,filters,search),sort=String(body.p_sort??"attention"),direction=String(body.p_direction??"asc"),rank=(value:string|null|undefined)=>({"No coverage":0,"Needs candidate":1,"Aging coverage":2,"Active coverage":3,"Late-stage coverage":4}[value??""]??5);
        const sorted=[...rows].sort((a,b)=>{let delta=0;if(sort==="name")delta=a.group_position.localeCompare(b.group_position,"en",{numeric:true,sensitivity:"base"});else if(sort==="oldest")delta=(a.latest_saved_at??"").localeCompare(b.latest_saved_at??"");else delta=rank(a.readiness_label)-rank(b.readiness_label)||b.open_headcount-a.open_headcount||a.group_position.localeCompare(b.group_position,"en",{numeric:true,sensitivity:"base"});if(direction==="desc")delta=-delta;return delta||a.group_id.localeCompare(b.group_id);});
        const cursorId=String(body.p_cursor_id??""),cursorIndex=cursorId?sorted.findIndex(row=>row.group_id===cursorId):-1,before=body.p_before===true,start=cursorIndex<0?0:before?Math.max(0,cursorIndex-limit):cursorIndex+1,end=cursorIndex<0?Math.min(limit,sorted.length):before?cursorIndex:Math.min(sorted.length,cursorIndex+1+limit),items=sorted.slice(start,end),hasMore=end<sorted.length,hasMoreBefore=start>0,anchor=(row:typeof sorted[number])=>({value:sort==="name"?row.group_position:sort==="oldest"?row.latest_saved_at??"":`${rank(row.readiness_label)}:${row.open_headcount}`,id:row.group_id});
        await json(route,{items,total_count:sorted.length,has_more:hasMore,has_more_before:hasMoreBefore,next_cursor:hasMore&&items.length?anchor(items.at(-1)!):null,previous_cursor:hasMoreBefore&&items.length?anchor(items[0]):null});return;
      }
      if(body?.p_entity==="sourcing" || body?.p_entity==="sourcing_records") {
        const rows=sourcingListRows(data,filters,search,options.now ?? fixtureNow),sort=String(body.p_sort??"group"),direction=String(body.p_direction??"asc");
        const value=(row:typeof rows[number])=>sort==="position"?row.group.group_position:sort==="week"?row.week_start:sort==="status"?row.status:sort==="applicants"?String(row.applicants??-1):sort==="saved"?String(row.update?.updated_at??""):row.group.group_id;
        const sorted=[...rows].sort((a,b)=>{const delta=value(a).localeCompare(value(b),"en",{numeric:true,sensitivity:"base"});return (direction==="desc"?-delta:delta)||a.group.group_id.localeCompare(b.group.group_id)||a.week_start.localeCompare(b.week_start);});
        const anchorId=(row:typeof sorted[number])=>row.group.group_id+"|"+row.week_start,cursorId=String(body.p_cursor_id??""),cursorIndex=cursorId?sorted.findIndex(row=>anchorId(row)===cursorId):-1,before=body.p_before===true,limit=Number(body.p_limit??50),start=cursorIndex<0?0:before?Math.max(0,cursorIndex-limit):cursorIndex+1,end=cursorIndex<0?Math.min(limit,sorted.length):before?cursorIndex:Math.min(sorted.length,cursorIndex+1+limit),items=sorted.slice(start,end),hasMore=end<sorted.length,hasMoreBefore=start>0,anchor=(row:typeof sorted[number])=>({value:value(row),id:anchorId(row)});
        await json(route,{items,total_count:sorted.length,has_more:hasMore,has_more_before:hasMoreBefore,next_cursor:hasMore&&items.length?anchor(items.at(-1)!):null,previous_cursor:hasMoreBefore&&items.length?anchor(items[0]):null});return;
      }
      if(body?.p_entity!=="candidate_registry"){await json(route,{message:"Mock does not implement this recruitment list entity."},501);return;}
      const creatorName=(id:string)=>data.profiles.find(profile=>profile.id===id)?.nickname??"Creator";
      const idSearch=(id:string)=>id.replace(/^(CAN|GRP)-(\d+)$/u,(_match,prefix:string,digits:string)=>`${prefix}-${digits.padStart(5,"0")}`);
      const full=data.candidates.filter(candidate=>{
        const apps=data.candidate_applications?.filter(row=>row.candidate_id===candidate.candidate_id)??[];
        const unmatched=data.candidate_profile_capabilities?.find(row=>row.candidate_id===candidate.candidate_id)?.is_unmatched??!apps.length;
        const creator=creatorName(candidate.created_by);
        if(filters.scope==="pool"&&!unmatched||filters.scope==="active"&&!apps.some(row=>row.state==="active")||filters.scope==="history"&&!apps.some(row=>row.state==="closed"))return false;
        if(filters.site&&candidate.home_site!==filters.site||filters.owner&&creator!==filters.owner)return false;
        return [candidate.name,candidate.nickname,candidate.candidate_id,idSearch(candidate.candidate_id),candidate.phone_no,candidate.email,candidate.position_interests].join(" ").toLocaleLowerCase().includes(search);
      }).map(candidate=>{const apps=data.candidate_applications?.filter(row=>row.candidate_id===candidate.candidate_id)??[];return {candidate_id:candidate.candidate_id,name:candidate.name,nickname:candidate.nickname,phone_no:candidate.phone_no,email:candidate.email,home_site:candidate.home_site,creator_label:creatorName(candidate.created_by),channel:candidate.channel,position_interests:candidate.position_interests,active_application_count:apps.filter(row=>row.state==="active").length,updated_at:candidate.updated_at,created_at:candidate.created_at,masked:false,is_unmatched:data.candidate_profile_capabilities?.find(row=>row.candidate_id===candidate.candidate_id)?.is_unmatched??!apps.length};});
      const all=filters.scope==="all"||filters.scope==="pool"?(data.masked_candidate_pool??[]).filter(row=>!data.candidates.some(candidate=>candidate.candidate_id===row.candidate_id)&&(!filters.owner||row.creator_label===filters.owner)&&[row.candidate_id,idSearch(row.candidate_id),row.position_interests,row.creator_label].join(" ").toLocaleLowerCase().includes(search)).map(row=>({candidate_id:row.candidate_id,name:null,nickname:null,phone_no:null,email:null,home_site:null,creator_label:row.creator_label,channel:null,position_interests:row.position_interests,active_application_count:null,updated_at:null,created_at:row.created_at,masked:true,is_unmatched:true})):[];
      const rows=[...full,...all].sort((a,b)=>(b.updated_at??b.created_at??"").localeCompare(a.updated_at??a.created_at??"")||a.candidate_id.localeCompare(b.candidate_id));
      const cursor=body?.p_cursor_value as string|null,cursorId=String(body?.p_cursor_id??""),before=body?.p_before===true;
      if(options.emptyContinuationOnceEntity==="candidate_registry"&&cursorId&&!emptyContinuationEntities.has("candidate_registry")) { emptyContinuationEntities.add("candidate_registry"); await json(route,{items:[],total_count:rows.length,has_more:false,has_more_before:false,next_cursor:null,previous_cursor:null});return; }
      const cursorCompare=(row:typeof rows[number])=>cursor.localeCompare(row.updated_at??row.created_at??"")||row.candidate_id.localeCompare(cursorId);
      const eligible=cursor===null||cursor===undefined?rows:rows.filter(row=>before?cursorCompare(row)<0:cursorCompare(row)>0);
      const items=before?eligible.slice(-limit):eligible.slice(0,limit),first=items[0],last=items.at(-1),firstIndex=first?rows.indexOf(first):0;
      const hasMore=firstIndex+items.length<rows.length,hasMoreBefore=firstIndex>0;
      await json(route,{items,total_count:rows.length,has_more:hasMore,has_more_before:hasMoreBefore,next_cursor:hasMore&&last?{value:last.updated_at??last.created_at??"",id:last.candidate_id}:null,previous_cursor:hasMoreBefore&&first?{value:first.updated_at??first.created_at??"",id:first.candidate_id}:null});return;
    }
    if(endpoint==="app_recruitment_sourcing_summary_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const selectedWeek=String(body?.p_selected_week??"2026-07-18"),groupId=typeof body?.p_group_id==="string"?body.p_group_id:null;
      const groups=data.position_groups.filter(group=>!groupId||group.group_id===groupId);
      const updates=data.sourcing_weekly_updates.map(update => ({...update,week_start:sourcingCycleSaturday(update.week_start)})).filter(update=>update.week_start<=selectedWeek&&(!groupId||update.group_id===groupId));
      const weeks=[...new Set(updates.map(update=>update.week_start))].sort().slice(-8).reverse().map(week_start=>{const weekRows=updates.filter(update=>update.week_start===week_start);return {week_start,expectedRows:groups.length,updatedRows:weekRows.length,applicants:weekRows.length < groups.length || weekRows.some(row=>sourcingApplicants(row) === null) ? null : weekRows.reduce((sum,row)=>sum+(sourcingApplicants(row)??0),0)};});
      const saved=updates.filter(row=>row.week_start===selectedWeek),totalApplicants=updates.reduce((sum,row)=>sum+(sourcingApplicants(row)??0),0);
      const channels=Object.fromEntries(SOURCING_CHANNELS.map(channel=>[channel.enabled,updates.reduce((sum,row)=>sum+(row[channel.enabled]?Number(row[channel.count]??0):0),0)]));
      await json(route,{selectedWeek,groupId,totalApplicants:updates.length?totalApplicants:null,selectedApplicants:saved.length?saved.reduce((sum,row)=>sum+(sourcingApplicants(row)??0),0):null,expectedRows:groups.length*8,updatedWeeks:updates.length,completeness:groups.length?Math.round(Math.min(1,updates.length/(groups.length*8))*100):0,channels,weeks,stageChannels:groupId?deriveSourcingStageChannels(data,groupId,selectedWeek):null});return;
    }
    if(["app_home_summary_v1","app_home_core_summary_v1","app_home_work_queue_v1"].includes(endpoint)) {
      rpcCalls.push({endpoint,payload:{...body}});
      const scope=asRecord(body?.p_scope),rows=enrichCandidates(data).filter(row=>(!scope.headerSite||row.sites.includes(String(scope.headerSite)))&&(!scope.headerPic||row.person_in_charges.includes(String(scope.headerPic)))&&(!scope.priorityOnly||row.doc_ids.some(id=>data.requisitions.some(req=>req.doc_id===id&&req.is_priority))));
      const open=enrichRequisitions(data).filter(row=>row.status!=="filled"&&row.status!=="cancel"&&row.open_headcount>0&&(!scope.headerSite||row.site===String(scope.headerSite))&&(!scope.headerPic||row.person_in_charge===String(scope.headerPic))&&(!scope.priorityOnly||row.is_priority)),pipeline=rows.filter(row=>row.latest_result!==0&&!(row.latest_process==="Offer"&&row.latest_result===1));
      const today="2026-07-24",pending=rows.flatMap(candidate=>data.recruitment_logs.filter(log=>log.application_id===candidate.application_id&&!log.superseded_at&&log.result===null).map(log=>({candidate,log})));
      const latestWeek=data.sourcing_weekly_updates.map(row=>row.week_start).sort().at(-1)??null;
      const recentActivity=(data.change_logs??[]).sort((a,b)=>b.changed_at.localeCompare(a.changed_at)).slice(0,10).map(row=>({log_id:row.log_id,entity:row.entity,entity_id:row.entity_id,action:row.action,changed_at:row.changed_at,changed_by_email:row.changed_by_email}));
       const workQueue=deriveWorkQueue({candidates:enrichCandidates(data),offers:enrichOffers(data),profile:data.profile??null,requisitions:enrichRequisitions(data),staleSourcingGroups:enrichWorkspaceLinkedGroups(data,today).filter(group=>!data.sourcing_weekly_updates.some(update=>update.group_id===group.group_id&&update.week_start===latestWeek))});
       const qualityCount=deriveDataQualityIssues(data).length;
       if(endpoint==="app_home_work_queue_v1") { await json(route,{items:workQueue,totalCount:workQueue.length});return; }
       await json(route,{requisitions:{open:open.length,priorityOpen:open.filter(row=>row.is_priority).length},candidatePipeline:[...new Set(pipeline.map(row=>row.latest_process))].map(stage=>({stage,count:pipeline.filter(row=>row.latest_process===stage).length})),sourcing:{staleGroups:data.position_groups.filter(group=>!data.sourcing_weekly_updates.some(update=>update.group_id===group.group_id&&update.week_start===latestWeek)).length,latestWeek},needsAction:{pendingCandidates:new Set(pending.map(row=>row.candidate.application_id)).size,overduePending:pending.filter(({log})=>Boolean(log.estimated_action_date&&log.estimated_action_date<today)).length},counts:{openRequisitions:open.length,activePipeline:pipeline.filter(row=>row.latest_process!=="No activity").length,staleSourcing:data.position_groups.filter(group=>!data.sourcing_weekly_updates.some(update=>update.group_id===group.group_id&&update.week_start===latestWeek)).length,pendingOffers:data.offers.filter(offer=>!offer.accepted_date||!offer.first_working_date||offer.start_confirmation==="did_not_start").length,qualityIssues:qualityCount},workQueue:{items:workQueue,totalCount:workQueue.length},recentActivity});return;
    }
    if(endpoint==="app_home_welcome_summary_v1") {
      const rpcCall={endpoint,payload:{...body}};rpcCalls.push(rpcCall);
      if(options.welcomeSummaryDelayMs) await new Promise(resolve=>setTimeout(resolve,options.welcomeSummaryDelayMs));
      if(options.welcomeSummaryFailureOnce&&!welcomeSummaryFailed){welcomeSummaryFailed=true;await json(route,{message:"Synthetic welcome summary failure"},500);return;}
      const now=options.now??fixtureNow;
      const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
      const today=`${parts.find(part=>part.type==="year")?.value}-${parts.find(part=>part.type==="month")?.value}-${parts.find(part=>part.type==="day")?.value}`;
      const summary=buildLegacyWelcomeSummary(enrichRequisitions(data),enrichCandidates(data),data.offers,data.requisition_logs,data.profile,today);
      rpcCall.response=summary;
      await json(route,summary);return;
    }
    if(endpoint==="app_home_banner_summary_v1") {
      const rpcCall={endpoint,payload:{...body}};rpcCalls.push(rpcCall);
      if(options.homeBannerSummaryDelayMs) await new Promise(resolve=>setTimeout(resolve,options.homeBannerSummaryDelayMs));
      if(options.homeBannerSummaryFailureOnce&&!homeBannerSummaryFailed){homeBannerSummaryFailed=true;await json(route,{message:"Synthetic home banner failure"},500);return;}
      const scope=asRecord(body?.p_scope),scopedReqs=enrichRequisitions(data).filter(row=>(!scope.headerSite||row.site===String(scope.headerSite))&&(!scope.headerPic||row.person_in_charge===String(scope.headerPic))&&(!scope.priorityOnly||row.is_priority)),reqs=scopedReqs.filter(row=>row.status!=="cancel");
      const docIds=new Set(scopedReqs.map(row=>row.doc_id));
      const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit"}).formatToParts(options.now??fixtureNow);
      const month=`${parts.find(part=>part.type==="year")?.value}-${parts.find(part=>part.type==="month")?.value}`;
      const summary={monthlyFillCapacity:reqs.reduce((sum,row)=>sum+row.head_count,0),monthlyFilledCount:data.offers.filter(offer=>docIds.has(offer.doc_id)&&offer.accepted_date?.slice(0,7)===month).length};
      rpcCall.response=summary;
      await json(route,summary);return;
    }
     if(endpoint==="app_home_quality_page_v1") {
       rpcCalls.push({endpoint,payload:{...body}});
       const scope=asRecord(body?.p_scope),groupId=String(scope.groupId??""),docId=String(scope.docId??""),groupIds=docId?data.document_groups.filter(row=>row.doc_id===docId).map(row=>row.group_id).filter(Boolean) as string[]:groupId?[groupId]:[],docIds=new Set(data.document_groups.filter(row=>groupIds.includes(row.group_id??"")).map(row=>row.doc_id)),candidateIds=new Set(data.candidate_applications?.filter(app=>groupIds.includes(app.group_id??"")).map(app=>app.candidate_id)??[]),offerIds=new Set(data.offers.filter(row=>docIds.has(row.doc_id)).map(row=>String(row.offer_id)));
       const severityRank:Record<string,number>={blocking:0,warning:1,info:2},rows=deriveDataQualityIssues(data).filter(issue=>!groupId&&!docId||issue.entityId===groupId||docIds.has(issue.entityId)||candidateIds.has(issue.entityId)||offerIds.has(issue.entityId)).sort((a,b)=>severityRank[a.severity]-severityRank[b.severity]||a.title.localeCompare(b.title)||a.id.localeCompare(b.id)).map((row,index)=>({...row,cursorId:row.id+"|"+index})),afterSeverity=body?.p_after_severity==null?null:Number(body.p_after_severity),afterTitle=String(body?.p_after_title??""),afterId=String(body?.p_after_id??""),limit=Math.max(1,Math.min(50,Number(body?.p_limit??25)));
       const remaining=rows.filter(row=>afterSeverity===null||severityRank[row.severity]>afterSeverity||severityRank[row.severity]===afterSeverity&&(row.title>afterTitle||row.title===afterTitle&&row.cursorId>afterId)),items=remaining.slice(0,limit),hasMore=remaining.length>limit,last=items.at(-1);
       await json(route,{items,totalCount:rows.length,hasMore,nextCursor:hasMore&&last?{severity:severityRank[last.severity],title:last.title,id:last.cursorId}:null});return;
     }
    if(endpoint==="app_recruitment_calendar_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const scope=asRecord(body?.p_scope),start=String(body?.p_start),end=String(body?.p_end),rows=enrichCandidates(data).filter(row=>(!scope.headerSite||row.sites.includes(String(scope.headerSite)))&&(!scope.headerPic||row.person_in_charges.includes(String(scope.headerPic)))&&(!scope.priorityOnly||row.doc_ids.some(id=>data.requisitions.some(req=>req.doc_id===id&&req.is_priority)))),byApplication=new Map(rows.map(row=>[row.application_id??row.candidate_id,row])),events:Record<string,unknown>[]=[];
      for(const log of data.recruitment_logs){const candidate=byApplication.get(log.application_id??log.candidate_id);if(!candidate||!log.estimated_action_date||log.result!==null||log.superseded_at||!ACTIVE_PIPELINE_STAGES.includes(log.recruitment_process)||log.estimated_action_date<start||log.estimated_action_date>end)continue;events.push({id:`log:${log.log_id}`,logId:log.log_id,stageInstanceId:log.stage_instance_id,logDate:log.log_date,updatedAt:log.updated_at,interviewer:log.interviewer,remark:log.remark,candidateId:candidate.candidate_id,applicationId:candidate.application_id??candidate.candidate_id,candidateName:candidate.name,date:log.estimated_action_date,eventType:"stage",overdue:log.estimated_action_date<new Date().toISOString().slice(0,10),owner:candidate.person_in_charge,round:log.round,site:candidate.site,stage:log.recruitment_process,position:candidate.group_position});}
      for(const offer of data.offers){if(!offer.accepted_date||!offer.first_working_date||offer.first_working_date<start||offer.first_working_date>end)continue;const candidate=byApplication.get(offer.application_id??offer.candidate_id);if(!candidate)continue;events.push({id:`offer:${offer.offer_id}`,candidateId:candidate.candidate_id,applicationId:candidate.application_id??candidate.candidate_id,candidateName:candidate.name,date:offer.first_working_date,eventType:"start_work",overdue:offer.first_working_date<new Date().toISOString().slice(0,10),owner:candidate.person_in_charge,round:1,site:candidate.site,stage:"Offer",position:candidate.group_position,startWorkStatus:offer.start_confirmation==="started"?"started":offer.first_working_date<=new Date().toISOString().slice(0,10)?"confirmation_pending":"scheduled"});}
      events.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.id).localeCompare(String(b.id)));
      const afterDate=String(body?.p_after_date??""),afterId=String(body?.p_after_id??""),limit=Math.max(1,Math.min(200,Number(body?.p_limit??200)));
      const remaining=events.filter(event=>!afterDate||String(event.date)>afterDate||(String(event.date)===afterDate&&String(event.id)>afterId));
      const page=remaining.slice(0,limit),hasMore=remaining.length>limit,last=page.at(-1);
      await json(route,{events:page,hasMore,nextCursor:hasMore&&last?{date:String(last.date),id:String(last.id)}:null});return;
    }
    if(endpoint==="app_recruitment_groups_page_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const filters=asRecord(body?.p_filters),groupId=String(filters.exactGroupId??""),weekStart=String(filters.weekStart??"2026-07-18");
      const group=workspaceGroupRows(data,{scope:"all",weekStart,group_id:groupId,headerSite:filters.headerSite,headerPic:filters.headerPic,priorityOnly:filters.priorityOnly},"").find(row=>row.group_id===groupId);
      await json(route,{items:group?[{group_id:group.group_id,group_position:group.group_position,doc_ids:group.doc_ids,open_headcount:group.open_headcount,candidate_count:group.candidate_count,active_candidate_count:group.active_candidate_count,demand_count:group.demand_count,filled_count:group.filled_count}]:[],total_count:group?1:0,has_more:false,has_more_before:false,next_cursor:null,previous_cursor:null});return;
    }
    if(endpoint==="app_pipeline_summary_v1") {
      rpcCalls.push({endpoint,payload:{...body}});
      const scope=asRecord(body?.p_scope),groupId=String(body?.p_group_id??""),asOf=String(body?.p_as_of??"2026-07-24"),recentDays=Number(body?.p_recent_days??7);
      const dateDays=(value:string|null|undefined)=>value?Math.floor((Date.parse(`${asOf}T12:00:00Z`)-Date.parse(`${value.slice(0,10)}T12:00:00Z`))/86_400_000):Infinity;
      const rows=enrichCandidates(data).filter(row=>{const app=data.candidate_applications?.find(item=>item.application_id===row.application_id);return app?.state==="active"&&(!groupId||row.group_id===groupId)&&(!scope.headerSite||row.sites.includes(String(scope.headerSite)))&&(!scope.headerPic||row.person_in_charges.includes(String(scope.headerPic)))&&(!scope.priorityOnly||row.doc_ids.some(id=>data.requisitions.some(req=>req.doc_id===id&&req.is_priority)));});
      const active=rows.filter(row=>row.latest_result!==0&&!(row.latest_process==="Offer"&&row.latest_result===1));
      const logs=data.recruitment_logs.filter(log=>!log.superseded_at&&!(log as unknown as Record<string,unknown>).superseded_by_stage_instance_id);
      const recentFailure=new Set(logs.filter(log=>log.result===0&&dateDays(log.outcome_date??log.log_date)<recentDays).map(log=>log.application_id??log.candidate_id));
      const recentOffer=new Set(logs.filter(log=>log.recruitment_process==="Offer"&&log.result===1&&dateDays(log.log_date)<recentDays).map(log=>log.application_id??log.candidate_id));
      const asDate=new Date(`${asOf}T12:00:00Z`);asDate.setUTCDate(asDate.getUTCDate()-(recentDays-1));
      const byStage=[...new Set(rows.map(row=>row.latest_process))].map(stage=>({stage,count:rows.filter(row=>row.latest_process===stage).length}));
      await json(route,{as_of:asOf,recent_since:asDate.toISOString().slice(0,10),active:active.length,aging:active.filter(row=>dateDays(row.latest_log_date)>7).length,failed:recentFailure.size,passed_offer:recentOffer.size,no_activity:active.filter(row=>row.latest_process==="No activity").length,by_stage:byStage});return;
    }
    if(endpoint==="app_update_pipeline_pending_v2" && !wrapped) {
      rpcCalls.push({endpoint,payload:{...payload}});
      const pending=asRecord(payload.pending),row=data.recruitment_logs.find(log=>log.application_id===payload.application_id&&log.stage_instance_id===payload.stage_instance_id);
      if(!row||row.candidate_id!==payload.candidate_id){await json(route,{error:"Pending stage not found"},409);return;}
      row.estimated_action_date=typeof pending.estimated_action_date==="string"?pending.estimated_action_date:null;
      row.interviewer=typeof pending.interviewer==="string"?pending.interviewer:null;
      row.remark=typeof pending.remark==="string"?pending.remark:null;
      row.updated_at="2026-07-24T05:00:00.000Z";
      const history=data.recruitment_log_history.find(log=>log.log_id===row.log_id);
      if(history){history.estimated_action_date=row.estimated_action_date;history.interviewer=row.interviewer;history.remark=row.remark;history.updated_at=row.updated_at;}
      await json(route,{ok:true});return;
    }
    if(endpoint==="app_candidate_duplicate_matches_v1") {const phone=String(payload.phone_no??"").replace(/[^0-9]/g,""),email=String(payload.email??"").trim().toLowerCase();await json(route,data.candidates.filter(candidate=>candidate.candidate_id!==payload.candidate_id&&Boolean(phone&&candidate.phone_no?.replace(/[^0-9]/g,"")===phone||email&&candidate.email?.trim().toLowerCase()===email)).map(candidate=>({candidate_id:candidate.candidate_id,phone:Boolean(phone&&candidate.phone_no?.replace(/[^0-9]/g,"")===phone),email:Boolean(email&&candidate.email?.trim().toLowerCase()===email)})));return; }
    rpcCalls.push({ endpoint, payload });
    if(endpoint==="app_dashboard_filter_options_v1") {
      await json(route,{sites:[...new Set(data.requisitions.map(row=>row.site).filter(Boolean))].sort(),departments:[...new Set(data.requisitions.map(row=>row.department).filter(Boolean))].sort(),owners:[...new Set(data.requisitions.map(row=>row.person_in_charge?.trim()).filter((value):value is string=>Boolean(value)))].sort((a,b)=>a.localeCompare(b,"en",{sensitivity:"base"}))});return;
    }
    if (endpoint === "app_dashboard_company_report") {
      await json(route, {
        requisitions: data.requisitions,
        requisition_logs: data.requisition_logs,
        offers: data.offers.filter((offer) => offer.accepted_date !== null).map(offer => ({ ...offer, candidate_id: null, remark: null, start_confirmed_by: null, start_confirmation_reason: null }))
      });
      return;
    }
    if (endpoint === "app_set_requisition_priority_v1") {
      const current = data.requisitions.find(row => row.doc_id === payload.doc_id);
      if (!current || current.updated_at !== payload.expected_updated_at) {
        await json(route, { message: "PRIORITY_STALE_WRITE" }, 409);
        return;
      }
      current.is_priority = payload.is_priority === true;
      current.updated_at = "2026-07-24T05:00:01.000Z";
      await json(route, { ok: true, id: current.doc_id, is_priority: current.is_priority, updated_at: current.updated_at });
      return;
    }
    applyRpcMutation(data, endpoint, payload);
    const completedOffer = endpoint === "app_complete_pipeline_stage_v2"
      && asRecord(payload.outcome).result === "pass"
      && data.recruitment_logs.find((row) => row.stage_instance_id === payload.stage_instance_id)?.recruitment_process === "Offer";
    let receipt: Record<string,unknown> | undefined;
    if (wrapped) {
      const id=String(payload.candidate_id??data.candidates.at(-1)?.candidate_id??""), candidate=data.candidates.find(row=>row.candidate_id===id)??null;
      const apps=(data.candidate_applications??[]).filter(row=>row.candidate_id===id&&(!payload.application_id||row.application_id===payload.application_id));
      const ids=apps.map(row=>row.application_id), history=(data.recruitment_log_history??data.recruitment_logs).filter(row=>ids.includes(row.application_id??""));
      receipt={version:1,request_id:asRecord(body).p_request_id,operation:endpoint,candidate_id:id,application_ids:ids,profile:{candidate,capabilities:(data.candidate_profile_capabilities??[]).find(row=>row.candidate_id===id)??null,masked:null},cards:enrichCandidates(data).filter(row=>ids.includes(row.application_id??"")),applications:apps,history,assignments:(data.candidate_application_assignments??[]).filter(row=>ids.includes(row.application_id)),notes:(data.candidate_notes??[]).filter(row=>row.candidate_id===id),references:data.candidate_references.filter(row=>row.candidate_id===id),removed_applications:[],source_stages:ACTIVE_PIPELINE_STAGES,source_groups:apps.map(row=>row.group_id),groups:apps.map(row=>row.group_id),effects:endpoint==="app_upsert_candidate_note_v2"?["detail","audit"]:["records","detail","counts","summary","calendar","reports","audit"]};
    }
    await json(route, completedOffer
      ? { ok: true, id: generatedIdForEndpoint(endpoint), ...(receipt?{action_result:receipt}:{}), offer_handoff: { candidate_id: payload.candidate_id, passed_date: asRecord(payload.outcome).date, requisitions: [{ doc_id: "REQ-HQ-1" }] } }
      : { ok: true, id: generatedIdForEndpoint(endpoint), ...(receipt?{action_result:receipt}:{}) });
  });

  await page.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/rpc/")) return route.fallback();
    const table = url.pathname.split("/").at(-1) ?? "";
    if (table === "rejection_reasons" && route.request().method() !== "GET") {
      if (role !== "system_admin" && role !== "admin_recruiter") { await json(route, { message: "Permission denied" }, 403); return; }
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (route.request().method() === "POST") data.rejection_reasons.push({ reason_id: `10000000-0000-4000-8000-${String(data.rejection_reasons.length + 10).padStart(12, "0")}`, reason_kind: String(body.reason_kind) as "main" | "detail", actor: String(body.actor) as "candidate" | "company", parent_id: body.parent_id ? String(body.parent_id) : null, label_th: String(body.label_th), label_en: String(body.label_en), sort_order: Number(body.sort_order), active: Boolean(body.active), created_at: fixtureNow.toISOString(), updated_at: fixtureNow.toISOString() });
      if (route.request().method() === "PATCH") { const id = url.searchParams.get("reason_id")?.replace(/^eq\./, ""); const row = data.rejection_reasons.find((reason) => reason.reason_id === id); if (row) Object.assign(row, body); }
      await json(route, []); return;
    }
    let rows = tableRows(data, table);
    if (bootstrapExcludedCandidateIds.size) {
      const candidateScope = url.searchParams.get("candidate_id")?.replace(/^eq\./, "") ?? "";
      const applicationScope = url.searchParams.get("application_id")?.replace(/^eq\./, "") ?? "";
      const scopedCandidate = data.candidate_applications?.find(row => row.application_id === applicationScope)?.candidate_id ?? candidateScope;
      rows = rows.filter(row => {
        const item = row as Record<string, unknown>;
        const candidateId = String(item.candidate_id ?? "");
        const applicationId = String(item.application_id ?? "");
        const excludedId = bootstrapExcludedCandidateIds.has(candidateId)
          ? candidateId
          : data.candidate_applications?.find(application => application.application_id === applicationId && bootstrapExcludedCandidateIds.has(application.candidate_id))?.candidate_id;
        if (!excludedId) return true;
        return scopedCandidate === excludedId;
      });
    }
    if (["candidates", "candidate_applications", "candidate_application_assignments", "candidate_references", "candidate_reference_checks", "candidate_notes", "rejection_letter_drafts", "rejection_letter_templates", "interview_invitation_templates", "recruitment_logs", "offers", "interview_meetings", "position_groups", "document_groups", "requisitions", "requisition_logs"].includes(table)) {
      const inFilterSizes = Object.fromEntries([...url.searchParams.entries()].flatMap(([key, value]) => {
        const match = value.match(/^in\.\((.*)\)$/);
        return match ? [[key, match[1] ? match[1].split(",").length : 0]] : [];
      }));
      restReads.push({ table, scopedCandidate: url.searchParams.get("candidate_id")?.replace(/^eq\./, "") ?? (data.candidate_applications?.find(row => row.application_id === url.searchParams.get("application_id")?.replace(/^eq\./, ""))?.candidate_id ?? ""), candidateIds: rows.map(row => String((row as Record<string, unknown>).candidate_id ?? "")).filter(Boolean), inFilterSizes });
    }
    if (route.request().headers().prefer?.includes("count=exact")) {
      let filtered = filterRestRows(rows,url);
      const sort = url.searchParams.get("order")?.split(".")[0];
      if (sort) filtered = [...filtered].sort((a, b) => String((a as Record<string, unknown>)[sort]).localeCompare(String((b as Record<string, unknown>)[sort]), "en", { numeric: true }));
      const start = Number(url.searchParams.get("offset") ?? 0), limit = Number(url.searchParams.get("limit") ?? 500), pageRows = filtered.slice(start, start + limit);
      await route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range", "content-range": `${start}-${start + pageRows.length - 1}/${filtered.length}` }, body: JSON.stringify(pageRows), status: 200 }); return;
    }
    await json(route, applyRestQuery(rows, url));
  });

  return { data, rpcCalls, restReads, excludeBootstrapCandidate: candidateId => { bootstrapExcludedCandidateIds.add(candidateId); } };
}

export async function expectWorkspaceReady(page: Page) {
  const header = page.locator("[data-app-header-actions]");
  await expect(page.getByRole("button", { name: /^(Refresh|รีเฟรช)$/ })).toBeVisible();
  await expect(header.getByLabel(/^(Site|พื้นที่)$/)).toBeVisible();
  await expect(header.getByLabel(/^(Person in Charge|ผู้รับผิดชอบ)$/)).toBeVisible();
  await expect(page.getByText("Loading recruitment records...")).toHaveCount(0);
  if (new URL(page.url()).pathname === "/dashboard") await expect(page.locator("[data-dashboard-filters]")).toBeVisible();
}

export function seedCrossSiteMatchScenario(data: DashboardData) {
  data.requisitions.push(
    requisition("REQ-KT1-MIX-PEER", "KT1", "Peer-owned Production Operator", "Production", "Nina", 2, "2026-07-09", "ongoing", null),
    requisition("REQ-KT2-MIX-BOB", "KT2", "Cross-site Bob requisition", "Planning", "Bob", 2, "2026-07-10", "ongoing", null)
  );
  data.position_groups.push(positionGroup("GRP-MIX", "Mixed-site support"));
  data.document_groups.push(
    documentGroup("DG-MIX-HQ", "REQ-HQ-1", "GRP-MIX", "Mixed-site support"),
    documentGroup("DG-MIX-KT1", "REQ-KT1-1", "GRP-MIX", "Mixed-site support")
  );
}

function requisitionListRows(data: DashboardData, filters: Record<string, unknown>, search: string) {
  return enrichRequisitions(data).filter(row => {
    if(filters.homeTab==="open_headcount"&&(row.status==="filled"||row.status==="cancel"||row.open_headcount<=0))return false;
    const role=data.profile?.role??"viewer",admin=role==="system_admin"||role==="admin_recruiter";
    const ownerMatches=(value:string|null|undefined)=>[data.profile?.nickname,data.profile?.full_name].some(name=>Boolean(name&&value&&name.trim().toLocaleLowerCase()===value.trim().toLocaleLowerCase()));
    if(filters.managedOnly===true&&!admin&&!(role==="site_recruiter"&&(row.site===data.profile?.site||ownerMatches(row.person_in_charge))))return false;
    if(filters.unmatchedOnly===true&&data.document_groups.some(link=>link.doc_id===row.doc_id))return false;
    const linkToGroupId=typeof filters.linkToGroupId==="string"?filters.linkToGroupId:"";
    if(linkToGroupId){
      if(!data.position_groups.some(group=>group.group_id===linkToGroupId))return false;
      const groupLinks=data.document_groups.filter(link=>link.group_id===linkToGroupId);
      const groupReqs=data.requisitions.filter(req=>groupLinks.some(link=>link.doc_id===req.doc_id));
      const groupManageable=admin||role==="site_recruiter"&&groupReqs.some(req=>req.site===data.profile?.site||ownerMatches(req.person_in_charge));
      if(!groupManageable||!admin&&!groupReqs.some(req=>req.site===row.site))return false;
    }
    const values: Record<string, unknown> = { ...row, readiness: row.sourcing_group_ids.length ? "Linked" : "Unlinked", sla: row.sla_restart_date ?? row.pr_approved_date ?? "", age: Math.floor((Date.now() - Date.parse(row.pr_approved_date ?? row.updated_at)) / 86_400_000), site: row.site, level: row.level };
    for (const [key, value] of Object.entries(filters)) {
      if (value === null || value === undefined || value === "") continue;
      if (key === "homeTab") continue;
      if (key === "headerSite" && String(row.site ?? "").toLowerCase() !== String(value).toLowerCase()) return false;
      if (key === "headerPic" && !String(row.person_in_charge ?? "").toLowerCase().includes(String(value).toLowerCase())) return false;
      if (key === "priorityOnly" && value && !row.is_priority) return false;
      if (["headerSite", "headerPic", "priorityOnly", "managedOnly", "unmatchedOnly", "linkToGroupId"].includes(key)) continue;
      if (!String(values[key] ?? "").toLowerCase().includes(String(value).toLowerCase())) return false;
    }
    const blob = [row.doc_id,row.position,row.level,row.status,row.site,row.person_in_charge,row.department,row.request_type,row.section,row.head_count,row.open_headcount,row.accepted_count,row.candidate_count,row.pr_approved_date,row.updated_at,...row.sourcing_group_ids].join(" ").toLowerCase();
    return blob.includes(search);
  });
}

function offerListRows(data: DashboardData, filters: Record<string, unknown>, search: string) {
  return enrichOffers(data).map(offer => {
    const req=data.requisitions.find(row=>row.doc_id===offer.doc_id);
    const related=data.offers.filter(row=>row.doc_id===offer.doc_id);
    const accepted_count=related.filter(countsTowardHeadcount).length;
    const head_count=req?.head_count??0;
    return {...offer,head_count,accepted_count,status:offer.start_confirmation??(offer.accepted_date?"accepted":"pending"),age_days:Math.max(0,Math.floor((Date.now()-Date.parse(offer.created_at))/86_400_000))};
  }).filter(row=>{
    if(filters.homeTab==="start_confirmation"&&(!row.accepted_date||!row.first_working_date||row.first_working_date>String(filters.today??"9999-12-31")||row.start_confirmation!=null))return false;
    const values:Record<string,unknown>={...row,accepted:row.accepted_date??"pending",first_working:row.first_working_date??"",impact:String(row.accepted_count)+"/"+String(row.head_count)};
    for(const[key,value]of Object.entries(filters)){
      if(value===null||value===undefined||value==="")continue;
      if(key==="homeTab"||key==="today")continue;
      if(key==="headerSite"&&row.site!==value||key==="headerPic"&&row.person_in_charge!==value||key==="priorityOnly"&&value&&!data.requisitions.find(req=>req.doc_id===row.doc_id)?.is_priority)return false;
      if(["headerSite","headerPic","priorityOnly"].includes(key))continue;
      if(!String(values[key]??"").toLowerCase().includes(String(value).toLowerCase()))return false;
    }
    return [row.candidate_id,row.candidate_name,row.doc_id,row.position,row.level,row.site,row.person_in_charge,row.status,row.accepted_date,row.first_working_date].join(" ").toLowerCase().includes(search);
  });
}

function workspaceGroupRows(data: DashboardData, filters: Record<string, unknown>, search: string) {
  const week=String(filters.weekStart??"2026-07-18");
  // Match the group RPC's permission/header-scoped linked-requisition projection.
  const profile=data.profile;
  const visibleReqs=data.requisitions.filter(req=>(profile?.role!=="site_recruiter"||req.site===profile.site||req.person_in_charge===profile.nickname)
    &&(!filters.headerSite||req.site===filters.headerSite)&&(!filters.headerPic||req.person_in_charge===filters.headerPic)&&(!filters.priorityOnly||req.is_priority));
  const visibleIds=new Set(visibleReqs.map(req=>req.doc_id));
  const projected={...data,requisitions:visibleReqs,document_groups:data.document_groups.filter(link=>visibleIds.has(link.doc_id))};
  return enrichWorkspaceLinkedGroups(projected,week).map(group=>{
    const reqs=enrichRequisitions(projected).filter(req=>group.doc_ids.includes(req.doc_id));
    const people=enrichCandidates(data).filter(candidate=>candidate.group_id===group.group_id);
    const active=people.filter(candidate=>candidate.application_state!=="closed"&&candidate.latest_result!==0&&!candidate.accepted_date&&ACTIVE_PIPELINE_STAGES.includes(candidate.latest_process as never));
    const open=reqs.filter(req=>req.status==="ongoing"&&req.open_headcount>0);
    const readiness=open.length===0?null:people.length===0?"No coverage":active.some(candidate=>candidate.latest_process==="Reference Check"||candidate.latest_process==="Offer")?"Late-stage coverage":active.some(candidate=>Date.now()-Date.parse(String(candidate.latest_log_date??"1970-01-01")+"T00:00:00Z")>7*86_400_000)?"Aging coverage":active.length?"Active coverage":"Needs candidate";
    const saved=data.sourcing_weekly_updates.filter(row=>row.group_id===group.group_id).map(row=>row.updated_at).sort().at(-1)??null;
    return {...group,demand_count:reqs.reduce((sum,req)=>sum+req.head_count,0),filled_count:reqs.reduce((sum,req)=>sum+Math.min(req.head_count,req.accepted_count),0),active_candidate_count:active.length,readiness_label:readiness,readiness_count:readiness?open.filter(req=>req.open_headcount>0).length:0,readiness_total:open.length,latest_saved_at:saved};
  }).filter(group=>{
    if(filters.scope==="ongoing"&&!group.doc_ids.some(id=>data.requisitions.some(req=>req.doc_id===id&&req.status==="ongoing"&&req.head_count>data.offers.filter(offer=>offer.doc_id===id&&countsTowardHeadcount(offer)).length)))return false;
    if(filters.group_id&&group.group_id!==filters.group_id)return false;
    if(filters.headerSite&&!group.sites.includes(String(filters.headerSite))||filters.headerPic&&!group.owners.includes(String(filters.headerPic)))return false;
    if(filters.priorityOnly&&!group.doc_ids.some(id=>data.requisitions.some(req=>req.doc_id===id&&req.is_priority)))return false;
    if(filters.site&&!group.sites.some(site=>site.toLowerCase().includes(String(filters.site).toLowerCase()))||filters.owner&&!group.owners.some(owner=>owner.toLowerCase().includes(String(filters.owner).toLowerCase())))return false;
    if(filters.position&&!group.group_position.toLowerCase().includes(String(filters.position).toLowerCase())||filters.doc_id&&!group.doc_ids.includes(String(filters.doc_id))||filters.readiness&&String(group.readiness_label??"").toLowerCase()!==String(filters.readiness).toLowerCase())return false;
    if(search&&!([group.group_id,group.group_position,group.sites.join(" "),group.owners.join(" "),group.doc_ids.join(" ")].join(" ").toLowerCase().includes(search)))return false;
    return true;
  });
}

function sourcingListRows(data: DashboardData, filters: Record<string, unknown>, search: string, now = fixtureNow) {
  const selectedWeek=String(filters.weekStart??filters.week??"2026-07-18");
  const rows = enrichWorkspaceLinkedGroups(data, selectedWeek).flatMap(group => {
    const requestedWeek=filters.week??(filters.surface==="board"?selectedWeek:"");
    const updates = data.sourcing_weekly_updates.filter(row => row.group_id === group.group_id && (!requestedWeek || sourcingCycleSaturday(row.week_start) === requestedWeek));
    const reqs = data.requisitions.filter(req => group.doc_ids.includes(req.doc_id));
    const first = sourcingCycleSaturday(reqs.map(req=>req.pr_approved_date).filter((day):day is string=>Boolean(day)).sort()[0] ?? now.toISOString().slice(0,10));
    const terminal = reqs.length > 0 && reqs.every(req=>["filled","cancel"].includes(req.status));
    const last = sourcingCycleSaturday(terminal ? reqs.map(req=>data.requisition_logs.filter(log=>log.doc_id===req.doc_id&&["filled","cancel"].includes(log.status)).map(log=>log.log_date).sort().at(-1) ?? req.updated_at.slice(0,10)).sort().at(-1)! : now.toISOString().slice(0,10));
    const expectedWeeks: string[]=[];
    for(let date=new Date(first+"T00:00:00Z");date.toISOString().slice(0,10)<=last;date.setUTCDate(date.getUTCDate()+7)) expectedWeeks.push(date.toISOString().slice(0,10));
    const weeks = requestedWeek ? expectedWeeks.filter(week=>week===String(requestedWeek)) : expectedWeeks.reverse();
    return weeks.map(week_start => {
      const update = updates.find(row => sourcingCycleSaturday(row.week_start) === week_start) ?? data.sourcing_weekly_updates.find(row => row.group_id === group.group_id && sourcingCycleSaturday(row.week_start) === week_start) ?? null;
      return { group, week_start, update, status: update && sourcingApplicants(update) !== null ? "saved" as const : "needs_recording" as const, applicants: update ? Object.values(update).filter(value => typeof value === "number").reduce<number>((sum, value) => sum + value, 0) : null };
    });
  });
  return rows.filter(row => {
    if (filters.from && row.week_start < String(filters.from)) return false;
    if (filters.to && row.week_start > String(filters.to)) return false;
    if (filters.groupId && row.group.group_id !== String(filters.groupId)) return false;
    if (filters.groupId && row.group.group_id !== String(filters.groupId)) return false;
    if (filters.group && !row.group.group_id.toLowerCase().includes(String(filters.group).toLowerCase())) return false;
    if (filters.position && !row.group.group_position.toLowerCase().includes(String(filters.position).toLowerCase())) return false;
    if ((filters.week||filters.weekStart) && row.week_start !== String(filters.week??filters.weekStart)) return false;
    if (filters.status && !String(filters.status).toLowerCase().includes(row.status)) return false;
    if (filters.applicants && !String(filters.applicants).toLowerCase().includes(row.applicants == null ? "unknown" : row.applicants === 0 ? "zero" : "has")) return false;
    if (filters.headerSite && !row.group.sites.includes(String(filters.headerSite))) return false;
    if (filters.headerPic && !row.group.owners.includes(String(filters.headerPic))) return false;
    return [row.group.group_id,row.group.group_position,row.week_start,row.status,row.applicants].join(" ").toLowerCase().includes(search);
  });
}

function createRecruitmentDataset(activeRole: MockUserRole): DashboardData {
  const profiles = [
    profile("qa-system", "system@example.com", "System Admin", "System", null, "system_admin"),
    profile("qa-admin", "admin@example.com", "Alice Admin", "Alice", null, "admin_recruiter"),
    profile("qa-site", "site@example.com", "Bob Site", "Bob", "KT1", "site_recruiter"),
    profile("qa-viewer", "viewer@example.com", "Victor Viewer", "Victor", null, "viewer")
  ];

  return {
    profile: profiles.find((item) => item.id === roleUserIds[activeRole]) ?? profiles[1],
    profiles,
    requisitions: [
      requisition("REQ-HQ-1", "HQ", "Engineer", "Operations", "Alice", 5, "2026-06-01"),
      requisition("REQ-HQ-2", "HQ", "Engineer", "Operations", "Alice", 1, "2026-06-10", "ongoing", "4"),
      requisition("REQ-KT1-1", "KT1", "Technician", "Production", "Bob", 3, "2026-06-03"),
      requisition("REQ-KT1-PEER", "KT1", "Line Technician", "Production", "Nina", 2, "2026-06-04"),
      requisition("REQ-HQ-BOB", "HQ", "Recruitment Coordinator", "People", "Bob", 1, "2026-06-06"),
      requisition("REQ-KT2-1", "KT2", "Analyst", "Planning", "Alice", 2, "2026-06-05"),
      requisition("REQ-UNMATCHED-1", "HQ", "Senior Procurement Operations and Supplier Development Specialist", "Procurement", "Alice", 1, "2026-07-08", "ongoing", null),
      requisition("REQ-CLOSED-1", "HQ", "Closed Role", "Operations", "Alice", 1, "2026-06-07", "filled")
    ],
    requisition_logs: [],
    position_groups: [
      positionGroup("GRP-ENG", "Engineer"),
      positionGroup("GRP-TECH", "Technician"),
      positionGroup("GRP-KT1-PEER", "Line Technician"),
      positionGroup("GRP-HQ-BOB", "Recruitment Coordinator"),
      positionGroup("GRP-ANL", "Analyst"),
      positionGroup("GRP-BUY", "Buyer")
    ],
    document_groups: [
      documentGroup("DG-HQ-ENG", "REQ-HQ-1", "GRP-ENG", "Engineer"),
      documentGroup("DG-HQ2-ENG", "REQ-HQ-2", "GRP-ENG", "Engineer"),
      documentGroup("DG-KT1-TECH", "REQ-KT1-1", "GRP-TECH", "Technician"),
      documentGroup("DG-KT1-PEER", "REQ-KT1-PEER", "GRP-KT1-PEER", "Line Technician"),
      documentGroup("DG-HQ-BOB", "REQ-HQ-BOB", "GRP-HQ-BOB", "Recruitment Coordinator"),
      documentGroup("DG-KT2-ANL", "REQ-KT2-1", "GRP-ANL", "Analyst"),
      documentGroup("DG-CLOSED", "REQ-CLOSED-1", "GRP-CLOSED", "Closed Role")
    ],
    candidates: [
      candidate("C-PHONE", "Pat Phone", "DG-HQ-ENG", "Facebook", "2026-06-20"),
      candidate("C-PHONE-PASS", "Penny Phone Pass", "DG-HQ-ENG", "Facebook", "2026-06-20"),
      candidate("C-AGING", "Avery Aging", "DG-HQ-ENG", "JobThai", "2026-06-01"),
      candidate("C-HR", "Hana HR", "DG-HQ-ENG", "Referral", "2026-06-21"),
      candidate("C-LINE", "Liam Line", "DG-KT1-TECH", "Walk-in", "2026-06-22"),
      candidate("C-TEST", "Tina Test", "DG-KT1-TECH", "JobsDB", "2026-06-23"),
      candidate("C-REF", "Rae Reference", "DG-KT2-ANL", "LinkedIn", "2026-06-24"),
      candidate("C-OFFER", "Owen Offer", "DG-KT2-ANL", "LinkedIn", "2026-06-25"),
      candidate("C-OFFER-READY", "Nina Offer Ready", "DG-HQ-ENG", "Referral", "2026-07-01"),
      candidate("C-FAILED", "Finn Failed", "DG-HQ-ENG", "Facebook", "2026-06-26"),
      candidate("C-OFFER-PASS", "Olivia Offer Pass", "DG-KT1-TECH", "Referral", "2026-06-27"),
      candidate("C-OFFER-NO-OFFER", "Oscar Offer Needed", "DG-HQ-ENG", "Referral", "2026-07-02"),
      candidate("C-NO-ACTIVITY", "Nora No Activity", "DG-KT2-ANL", "Others", "2026-06-28")
    ],
    candidate_references: [
      {
        reference_id: "10000000-0000-4000-8000-000000000001",
        candidate_id: "C-REF",
        reference_name: "Mina Manager",
        relationship: "Former manager",
        channel_type: "phone",
        channel_value: "0812345678",
        other_channel_label: null,
        status: "available",
        status_reason: null,
        created_by: "qa-admin",
        updated_by: "qa-admin",
        created_at: "2026-07-10T05:00:00.000Z",
        updated_at: "2026-07-10T05:00:00.000Z"
      }
    ],
    candidate_reference_checks: [],
    recruitment_logs: [
      log(1, "C-PHONE", "Phone Screen", null, 1, "2026-07-09", "2026-07-25"),
      log(28, "C-PHONE-PASS", "Phone Screen", 1, 1, "2026-07-10"),
      log(2, "C-AGING", "Phone Screen", null, 1, "2026-06-25", "2026-07-20"),
      log(3, "C-HR", "Phone Screen", 1, 1, "2026-07-01"),
      log(4, "C-HR", "HR Interview", null, 1, "2026-07-09", "2026-08-05"),
      log(5, "C-LINE", "HR Interview", 1, 1, "2026-07-02"),
      log(6, "C-LINE", "Line Interview", null, 1, "2026-07-09"),
      log(7, "C-TEST", "Line Interview", 1, 1, "2026-07-03"),
      log(8, "C-TEST", "Test", null, 1, "2026-07-09"),
      log(9, "C-REF", "Test", 1, 1, "2026-07-04"),
      log(10, "C-REF", "Reference Check", null, 1, "2026-07-09"),
      log(11, "C-OFFER", "Reference Check", 1, 1, "2026-07-05"),
      log(12, "C-OFFER", "Offer", null, 1, "2026-07-09"),
      log(13, "C-FAILED", "Phone Screen", 1, 1, "2026-07-04"),
      log(14, "C-FAILED", "HR Interview", 0, 1, "2026-07-17"),
      log(15, "C-OFFER-PASS", "Phone Screen", 1, 1, "2026-07-01"),
      log(16, "C-OFFER-PASS", "HR Interview", 1, 1, "2026-07-02"),
      log(17, "C-OFFER-PASS", "Line Interview", 1, 1, "2026-07-03"),
      log(18, "C-OFFER-PASS", "Test", 1, 1, "2026-07-04"),
      log(19, "C-OFFER-PASS", "Reference Check", 1, 1, "2026-07-05"),
      log(20, "C-OFFER-PASS", "Offer", 1, 1, "2026-07-17"),
      log(21, "C-OFFER-READY", "Offer", null, 1, "2026-07-11"),
      log(22, "C-OFFER-NO-OFFER", "Phone Screen", 1, 1, "2026-07-12"),
      log(23, "C-OFFER-NO-OFFER", "HR Interview", 1, 1, "2026-07-13"),
      log(24, "C-OFFER-NO-OFFER", "Line Interview", 1, 1, "2026-07-14"),
      log(25, "C-OFFER-NO-OFFER", "Test", 1, 1, "2026-07-15"),
      log(26, "C-OFFER-NO-OFFER", "Reference Check", 1, 1, "2026-07-16"),
      log(27, "C-OFFER-NO-OFFER", "Offer", 1, 1, "2026-07-18")
    ],
    offers: [
      offer(1, "C-OFFER", "REQ-KT2-1", null, null),
      offer(2, "C-OFFER-PASS", "REQ-KT1-1", "2026-07-17", "2026-07-20")
    ],
    sourcing_weekly_updates: [
      sourcingUpdate("GRP-ENG", "2026-06-29", 8),
      sourcingUpdate("GRP-TECH", "2026-06-29", 4),
      sourcingUpdate("GRP-ENG", "2026-07-06", 12),
      sourcingUpdate("GRP-TECH", "2026-07-06", 7),
      sourcingUpdate("GRP-KT1-PEER", "2026-07-06", 3),
      sourcingUpdate("GRP-ANL", "2026-07-06", 5)
    ],
    vacancy_weekly_snapshots: [],
    rejection_reasons: [
      { reason_id: "10000000-0000-4000-8000-000000000001", reason_kind: "main", actor: "candidate", parent_id: null, label_th: "ค่าตอบแทนและสวัสดิการ", label_en: "Compensation and benefits", sort_order: 1, active: true, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" },
      { reason_id: "10000000-0000-4000-8000-000000000002", reason_kind: "detail", actor: "candidate", parent_id: "10000000-0000-4000-8000-000000000001", label_th: "เงินเดือนต่ำกว่าความคาดหวัง", label_en: "Salary below expectations", sort_order: 1, active: true, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" },
      { reason_id: "10000000-0000-4000-8000-000000000003", reason_kind: "main", actor: "company", parent_id: null, label_th: "ทักษะและผลการประเมิน", label_en: "Skills and assessment results", sort_order: 1, active: true, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" },
      { reason_id: "10000000-0000-4000-8000-000000000004", reason_kind: "detail", actor: "company", parent_id: "10000000-0000-4000-8000-000000000003", label_th: "ผลสัมภาษณ์ไม่ผ่านเกณฑ์", label_en: "Interview result did not meet criteria", sort_order: 1, active: true, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" }
    ],
    rejection_letter_templates: [
      { template_id: "template-th", name: "Thai rejection", language: "th", subject_template: "Result for {candidate_name}", body_template: "Dear {candidate_name}", active: true, version: 1, created_by: "qa-system", updated_by: "qa-system", created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" },
      { template_id: "template-en", name: "English rejection", language: "en", subject_template: "Result for {candidate_name}", body_template: "Dear {candidate_name}", active: true, version: 1, created_by: "qa-system", updated_by: "qa-system", created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" }
    ],
    rejection_letter_drafts: [],
    interview_invitation_templates: [
      { template_id: "interview-template-en", name: "English Teams interview", language: "en", subject_template: "Interview invitation for {candidate_name}", body_template: "Hello {candidate_name}, your {interview_stage} is {bangkok_start}. Join: {teams_join_link}", active: true, version: 1, created_by: "qa-system", updated_by: "qa-system", created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" },
      { template_id: "interview-template-th", name: "Thai Teams interview", language: "th", subject_template: "นัดสัมภาษณ์ {candidate_name}", body_template: "สัมภาษณ์ {interview_stage} วันที่ {bangkok_start} ลิงก์: {teams_join_link}", active: true, version: 1, created_by: "qa-system", updated_by: "qa-system", created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" }
    ],
    interview_meetings: [],
    change_logs: [
      {
        log_id: 1,
        entity: "recruitment_logs",
        entity_id: "16",
        action: "insert",
        changed_at: "2026-07-10T09:00:00",
        changed_by: "qa-admin",
        changed_by_email: "admin@example.com",
        old_data: null,
        new_data: { candidate_id: "C-OFFER-PASS" }
      }
    ]
  };
}

function applyRpcMutation(data: DashboardData, endpoint: string, payload: Record<string, unknown>) {
  if(endpoint === "app_upsert_candidate_profile_v1" || endpoint === "app_upsert_candidate_profile_v2") {
    const id=payload.mode==="change"?String(payload.candidate_id):"CAN-NEW-"+(data.candidates.length+1);
    const existing=data.candidates.find(candidate=>candidate.candidate_id===id);
    const row={...(existing??candidate(id,String(payload.name),"","Others","2026-07-24")),...payload,created_by:existing?.created_by??data.profile?.id,responsible_recruiter_id:existing?.responsible_recruiter_id??data.profile?.id,home_site:existing?.home_site??(data.profile?.role==="site_recruiter"?data.profile.site:null),candidate_id:id,group_id:existing?.group_id??null,doc_group_id:null,created_at:existing?.created_at??fixtureNow.toISOString(),updated_at:fixtureNow.toISOString()} as DashboardData["candidates"][number];
    if(existing) Object.assign(existing,row); else data.candidates.push(row);
    if(Object.prototype.hasOwnProperty.call(payload,"note")) applyRpcMutation(data,"app_upsert_candidate_note_v2",{candidate_id:id,body:payload.note});
    if(payload.group_id) applyRpcMutation(data,"app_create_candidate_application_v1",{candidate_id:id,group_id:payload.group_id});
  }
  if(endpoint === "app_upsert_candidate_note_v2") {
    const index=data.candidate_notes?.findIndex(note=>note.candidate_id===payload.candidate_id)??-1;
    const previous=index>=0?data.candidate_notes![index]:null;
    if(!String(payload.body??"").trim()) {if(index>=0)data.candidate_notes!.splice(index,1);}
    else if(previous) Object.assign(previous,{body:String(payload.body),version:(previous.version??1)+1,updated_by:data.profile?.id,updated_at:fixtureNow.toISOString()});
    else if(data.candidate_notes) data.candidate_notes.push({note_id:"note-"+Date.now(),candidate_id:String(payload.candidate_id),body:String(payload.body),created_by:data.profile?.id??null,updated_by:data.profile?.id,version:1,created_at:fixtureNow.toISOString(),updated_at:fixtureNow.toISOString()});
  }
  if(endpoint === "app_create_candidate_application_v1") {
    const id="00000000-0000-4000-8000-"+String((data.candidate_applications?.length??0)+1).padStart(12,"0");
    data.candidate_applications?.push({application_id:id,candidate_id:String(payload.candidate_id),group_id:String(payload.group_id),state:"active",closure_reason:null,closed_at:null,created_by:data.profile?.id??null,version:1,created_at:fixtureNow.toISOString(),updated_at:fixtureNow.toISOString()});
    const assignment="assignment-"+id;
    data.candidate_application_assignments?.push({assignment_id:assignment,application_id:id,group_id:String(payload.group_id),from_group_id:null,started_at:fixtureNow.toISOString(),ended_at:null,actor_id:data.profile?.id??null,reason:null,attribution_inferred:false});
    data.recruitment_logs.push({...log(data.recruitment_logs.length+100,String(payload.candidate_id),"Phone Screen",null,1,"2026-07-24"),application_id:id,entry_assignment_id:assignment,outcome_assignment_id:null});
  }
  if(endpoint === "app_transfer_candidate_application_v1") {
    const app=data.candidate_applications?.find(row=>row.application_id===payload.application_id);if(!app)return;
    data.candidate_application_assignments?.filter(row=>row.application_id===app.application_id&&!row.ended_at).forEach(row=>row.ended_at=fixtureNow.toISOString());
    data.candidate_application_assignments?.push({assignment_id:"transfer-"+Date.now(),application_id:app.application_id,group_id:String(payload.group_id),from_group_id:app.group_id,started_at:fixtureNow.toISOString(),ended_at:null,actor_id:data.profile?.id??null,reason:String(payload.reason),attribution_inferred:false});
    app.group_id=String(payload.group_id);app.version++;
  }
  if (endpoint === "app_create_group_match") {
    const docId = String(payload.doc_id ?? "");
    const groupId = String(payload.group_id ?? "");
    const group = data.position_groups.find((row) => row.group_id === groupId);
     if (docId && groupId && group && !data.document_groups.some((row) => row.doc_id === docId)) {
      data.document_groups.push(documentGroup("DG-GENERATED-"+docId, docId, groupId, group.group_position));
    }
  }
  if (endpoint === "app_upsert_sourcing_weekly_update") {
    const groupId = String(payload.group_id ?? "");
    const weekStart = String(payload.week_start ?? "");
    const existing = data.sourcing_weekly_updates.find((row) => row.group_id === groupId && row.week_start === weekStart);
    const update = existing ?? sourcingUpdate(groupId, weekStart, 0);
    for (const channel of SOURCING_CHANNELS) {
      update[channel.enabled] = Boolean(payload[channel.enabled]);
      const raw = payload[channel.count];
      update[channel.count] = raw == null || raw === "" ? null : Number(raw);
    }
    update.updated_at = "2026-07-24T05:00:00.000Z";
    if (!existing) data.sourcing_weekly_updates.push(update);
  }
  if (endpoint === "app_create_and_match_sourcing_group_v2") {
    const groupId = generatedIdForEndpoint(endpoint);
    const groupPosition = String(payload.group_position ?? "New group");
    const docIds = Array.isArray(payload.doc_ids) ? payload.doc_ids.map((value) => String(value)) : [];
    data.position_groups.push(positionGroup(groupId, groupPosition));
    docIds.forEach((docId, index) => data.document_groups.push(documentGroup("DG-GENERATED-"+(index+1), docId, groupId, groupPosition)));
  }
  if (endpoint === "app_unmatch_group_requisition") {
    const docGroupId = String(payload.doc_group_id ?? "");
    const docId = String(payload.doc_id ?? "");
    const groupId = String(payload.group_id ?? "");
    data.document_groups = data.document_groups.filter((match) => (
      docGroupId
        ? match.doc_group_id !== docGroupId
        : !(match.doc_id === docId && match.group_id === groupId)
    ));
  }
  if (endpoint === "app_confirm_offer_start_v1") {
    const current = data.offers.find((row) => row.offer_id === Number(payload.offer_id));
    if (!current) return;
    current.start_confirmation = String(payload.start_confirmation) as "started" | "did_not_start";
    current.start_confirmation_reason = current.start_confirmation === "did_not_start" ? nullableText(payload.reason) : null;
    current.start_confirmed_at = "2026-07-24T05:00:00.000Z";
    current.start_confirmed_by = "qa-admin";
    current.updated_at = "2026-07-24T05:00:00.000Z";
  }
  if (endpoint === "app_delete_recruitment_record") {
    const entity = String(payload.entity ?? "");
    const id = String(payload.id ?? "");
    if (entity === "requisition") data.requisitions = data.requisitions.filter((row) => row.doc_id !== id);
    if (entity === "position_group") data.position_groups = data.position_groups.filter((row) => row.group_id !== id);
    if (entity === "document_group") data.document_groups = data.document_groups.filter((row) => row.doc_group_id !== id);
    if (entity === "candidate") data.candidates = data.candidates.filter((row) => row.candidate_id !== id);
    if (entity === "offer") data.offers = data.offers.filter((row) => String(row.offer_id) !== id);
    if (entity === "recruitment_log") data.recruitment_logs = data.recruitment_logs.filter((row) => String(row.log_id) !== id);
    if (entity === "requisition_log") data.requisition_logs = data.requisition_logs.filter((row) => String(row.log_id) !== id);
    if (entity === "sourcing_weekly_update") {
      const weekStart = String(payload.week_start ?? "");
      data.sourcing_weekly_updates = data.sourcing_weekly_updates.filter((row) => !(row.group_id === id && row.week_start === weekStart));
    }
    if (entity === "vacancy_weekly_snapshot") data.vacancy_weekly_snapshots = data.vacancy_weekly_snapshots.filter((row) => String(row.snapshot_id) !== id);
  }
  if (endpoint === "app_start_pipeline_stage_v2") {
    const candidateId = String(payload.candidate_id ?? "");
    addCanonicalPending(data, candidateId, asRecord(payload.pending));
    const created = data.recruitment_logs.at(-1);
    if (created) appendPipelineAudit(data, created.log_id, "pipeline:start", created);
  }
  if (endpoint === "app_update_pipeline_pending_v2") {
    const candidateId = String(payload.candidate_id ?? "");
    const stageInstanceId = String(payload.stage_instance_id ?? "");
    const pending = Object.keys(asRecord(payload.pending)).length ? asRecord(payload.pending) : payload;
    const current = data.recruitment_logs.find((row) => (
      row.candidate_id === candidateId
      && (row.stage_instance_id === stageInstanceId || row.log_id === Number(payload.pending_log_id ?? -1))
      && row.result === null
      && row.superseded_at === null
    ));
    if (!current) return;
    current.log_date = String(pending.opened_date ?? current.log_date);
    current.estimated_action_date = nullableText(pending.estimated_action_date);
    current.interviewer = nullableText(pending.interviewer);
    current.remark = nullableText(pending.remark);
    current.pending_edited_at = "2026-07-24T05:00:00.000Z";
    current.pending_edited_by = "qa-admin";
    current.updated_at = "2026-07-24T05:00:00.000Z";
    appendPipelineAudit(data, current.log_id, "pipeline:pending-edit", current);
  }
  if (endpoint === "app_upsert_candidate_reference_v1") {
    const candidateId = String(payload.candidate_id ?? "");
    const referenceId = String(payload.reference_id ?? "");
    const current = data.candidate_references.find((row) => row.reference_id === referenceId);
    if (current) {
      current.reference_name = String(payload.reference_name ?? current.reference_name);
      current.relationship = String(payload.relationship ?? current.relationship);
      current.channel_type = String(payload.channel_type ?? current.channel_type) as typeof current.channel_type;
      current.channel_value = String(payload.channel_value ?? current.channel_value);
      current.other_channel_label = nullableText(payload.other_channel_label);
      current.updated_at = "2026-07-24T05:00:00.000Z";
    } else {
      data.candidate_references.push({
        reference_id: "10000000-0000-4000-8000-"+String(data.candidate_references.length + 2).padStart(12, "0"),
        candidate_id: candidateId,
        reference_name: String(payload.reference_name ?? ""),
        relationship: String(payload.relationship ?? ""),
        channel_type: String(payload.channel_type ?? "phone") as "phone" | "email" | "line" | "other",
        channel_value: String(payload.channel_value ?? ""),
        other_channel_label: nullableText(payload.other_channel_label),
        status: "available",
        status_reason: null,
        created_by: "qa-admin",
        updated_by: "qa-admin",
        created_at: "2026-07-24T05:00:00.000Z",
        updated_at: "2026-07-24T05:00:00.000Z"
      });
    }
  }
  if (endpoint === "app_set_candidate_reference_status_v1") {
    const current = data.candidate_references.find((row) => row.reference_id === String(payload.reference_id ?? ""));
    if (!current) return;
    current.status = String(payload.status ?? current.status) as typeof current.status;
    current.status_reason = nullableText(payload.reason);
    current.updated_at = "2026-07-24T05:00:00.000Z";
  }
  if (endpoint === "app_save_candidate_reference_check_v1") {
    const referenceId = String(payload.reference_id ?? "");
    const current = data.candidate_reference_checks.find((row) => row.reference_id === referenceId);
    if (current) {
      current.checked_date = String(payload.checked_date ?? current.checked_date);
      current.duration_minutes = Number(payload.duration_minutes ?? current.duration_minutes);
      current.conversation_summary = String(payload.conversation_summary ?? current.conversation_summary);
      current.updated_at = "2026-07-24T05:00:00.000Z";
    } else {
      data.candidate_reference_checks.push({
        check_id: "20000000-0000-4000-8000-"+String(data.candidate_reference_checks.length + 1).padStart(12, "0"),
        reference_id: referenceId,
        application_id: String(payload.application_id ?? data.candidate_applications?.find(app => app.candidate_id === payload.candidate_id)?.application_id ?? ""),
        checked_date: String(payload.checked_date ?? "2026-07-24"),
        duration_minutes: Number(payload.duration_minutes ?? 0),
        conversation_summary: String(payload.conversation_summary ?? ""),
        checked_by: "qa-admin",
        created_at: "2026-07-24T05:00:00.000Z",
        updated_at: "2026-07-24T05:00:00.000Z"
      });
    }
  }
  if (endpoint === "app_complete_pipeline_stage_v2") {
    const candidateId = String(payload.candidate_id ?? "");
    const current = findCanonicalPending(data, candidateId, String(payload.stage_instance_id ?? ""), Number(payload.pending_log_id ?? -1));
    if (!current) return;
    const pending = Object.keys(asRecord(payload.pending)).length ? asRecord(payload.pending) : payload;
    const outcome = Object.keys(asRecord(payload.outcome)).length
      ? asRecord(payload.outcome)
      : { ...asRecord(payload.outcome_detail), result: payload.outcome };
    applyPending(current, pending);
    current.result = outcome.result === "fail" ? 0 : 1;
    current.outcome_date = String(outcome.date ?? current.log_date);
    current.outcome_interviewer = nullableText(outcome.interviewer);
    current.outcome_remark = nullableText(outcome.remark);
    if (current.result === 0 && outcome.failure_actor) {
      const main = data.rejection_reasons.find((reason) => reason.reason_id === outcome.failure_main_reason_id);
      const detail = data.rejection_reasons.find((reason) => reason.reason_id === outcome.failure_detail_reason_id);
      current.failure_actor = String(outcome.failure_actor) as "candidate" | "company";
      current.failure_main_reason_id = main?.reason_id ?? null;
      current.failure_detail_reason_id = detail?.reason_id ?? null;
      current.failure_reason_snapshot = main && detail ? { actor: current.failure_actor, main_th: main.label_th, main_en: main.label_en, detail_th: detail.label_th, detail_en: detail.label_en } : null;
    }
    current.outcome_recorded_at = "2026-07-24T05:00:00.000Z";
    current.updated_at = "2026-07-24T05:00:00.000Z";
    const next = asRecord(payload.next_pending);
    if (current.result === 1 && Object.keys(next).length) addCanonicalPending(data, candidateId, { ...next, application_id: current.application_id, opened_date: current.outcome_date });
    appendPipelineAudit(data, current.log_id, "pipeline:completion", current);
  }
  if (endpoint === "app_pass_pipeline_jump_v2") {
    const candidateId = String(payload.candidate_id ?? "");
    const current = findCanonicalPending(data, candidateId, String(payload.current_stage_instance_id ?? ""), Number(payload.pending_log_id ?? -1));
    const passedStages = Array.isArray(payload.passed_stages) ? payload.passed_stages.map(asRecord) : [];
    if (!current || !passedStages.length) return;
    for (const [index, stage] of passedStages.entries()) {
      const row = index === 0
        ? current
        : log(nextLogId(data), candidateId, String(stage.stage) as never, null, Number(stage.round ?? 1), String(asRecord(stage.pending).opened_date ?? "2026-07-24"));
      if (index > 0) data.recruitment_logs.push(row);
      applyPending(row, asRecord(stage.pending));
      const outcome = asRecord(stage.outcome);
      row.result = 1;
      row.outcome_date = String(outcome.date ?? row.log_date);
      row.outcome_interviewer = nullableText(outcome.interviewer);
      row.outcome_remark = nullableText(outcome.remark);
      row.outcome_recorded_at = "2026-07-24T05:00:00.000Z";
      row.updated_at = "2026-07-24T05:00:00.000Z";
      appendPipelineAudit(data, row.log_id, "pipeline:jump", row);
    }
    addCanonicalPending(data, candidateId, { ...asRecord(payload.target_pending), application_id: payload.application_id });
  }
}

function tableRows(data: DashboardData, table: string) {
  const tables: Record<string, unknown[]> = {
    profiles: data.profiles,
    requisitions: data.requisitions,
    requisition_logs: data.requisition_logs,
    position_groups: data.position_groups,
    document_groups: data.document_groups,
    candidates: data.candidates,
    candidate_applications: data.candidate_applications??[],
    candidate_application_assignments:data.candidate_application_assignments??[],
    candidate_notes:data.candidate_notes??[],
    candidate_references: data.candidate_references,
    candidate_reference_checks: data.candidate_reference_checks,
    recruitment_logs: data.recruitment_logs,
    rejection_reasons: data.rejection_reasons,
    offers: data.offers,
    sourcing_weekly_updates: data.sourcing_weekly_updates,
    vacancy_weekly_snapshots: data.vacancy_weekly_snapshots,
    change_logs: data.change_logs,
    rejection_letter_templates: data.rejection_letter_templates,
    rejection_letter_drafts: data.rejection_letter_drafts,
    interview_invitation_templates: data.interview_invitation_templates,
    interview_meetings: data.interview_meetings
  };
  return tables[table] ?? [];
}

function applyRestQuery(rows: unknown[], url: URL) {
  rows = filterRestRows(rows,url);
  const limit = Number(url.searchParams.get("limit") ?? rows.length);
  return rows.slice(0, Number.isFinite(limit) ? limit : rows.length);
}

function filterRestRows(rows: unknown[], url: URL) {
  for (const [key,value] of url.searchParams) {
    if(value.startsWith("eq.")) rows=rows.filter(row=>String((row as Record<string,unknown>)[key])===value.slice(3));
    else if(value.startsWith("in.(")&&value.endsWith(")")) {
      const allowed=new Set(value.slice(4,-1).split(",").map(item=>item.replace(/^\"|\"$/g,"")));
      rows=rows.filter(row=>allowed.has(String((row as Record<string,unknown>)[key])));
    }
  }
  return rows;
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*"
    },
    body: JSON.stringify(body),
    status
  });
}

function readPublicSupabaseUrl() {
  const envPath = path.join(process.cwd(), ".env.local");
  const file = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  return process.env.NEXT_PUBLIC_SUPABASE_URL
    ?? file.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "")
    ?? "https://qa.supabase.co";
}

function supabaseStorageKey(url: string) {
  const host = new URL(url).hostname;
  const projectRef = host.split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

function generatedIdForEndpoint(endpoint: string) {
  if (endpoint.includes("candidate")) return "C-GENERATED";
  if (endpoint.includes("requisition")) return "REQ-GENERATED";
  if (endpoint.includes("group")) return "GRP-GENERATED";
  return "QA-GENERATED";
}

function nextLogId(data: DashboardData) {
  return Math.max(0, ...data.recruitment_logs.map((item) => item.log_id)) + 1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function findCanonicalPending(data: DashboardData, candidateId: string, stageInstanceId: string, pendingLogId = -1) {
  return data.recruitment_logs.find((row) => (
    row.candidate_id === candidateId
    && (row.stage_instance_id === stageInstanceId || row.log_id === pendingLogId)
    && row.result === null
    && row.superseded_at === null
  ));
}

function applyPending(row: DashboardData["recruitment_logs"][number], pending: Record<string, unknown>) {
  row.log_date = String(pending.opened_date ?? row.log_date);
  row.estimated_action_date = nullableText(pending.estimated_action_date);
  row.interviewer = nullableText(pending.interviewer);
  row.remark = nullableText(pending.remark);
  row.pending_edited_at = "2026-07-24T05:00:00.000Z";
  row.pending_edited_by = "qa-admin";
}

function addCanonicalPending(data: DashboardData, candidateId: string, pending: Record<string, unknown>) {
  const stage = String(pending.stage ?? "Phone Screen") as DashboardData["recruitment_logs"][number]["recruitment_process"];
  const row = log(nextLogId(data), candidateId, stage, null, Number(pending.round ?? 1), String(pending.opened_date ?? "2026-07-24"));
  row.estimated_action_date = nullableText(pending.estimated_action_date);
  row.interviewer = nullableText(pending.interviewer);
  row.remark = nullableText(pending.remark);
  row.record_origin = "auto";
  row.application_id = String(pending.application_id ?? data.candidate_applications?.find(app => app.candidate_id === candidateId)?.application_id ?? "");
  data.recruitment_logs.push(row);
  appendPipelineAudit(data, row.log_id, "pipeline:pending-create", row);
}

function appendPipelineAudit(data: DashboardData, logId: number, action: string, record: unknown) {
  data.change_logs.unshift({
    log_id: Math.max(0, ...data.change_logs.map((item) => item.log_id)) + 1,
    entity: "recruitment_logs",
    entity_id: String(logId),
    action,
    changed_at: "2026-07-24T05:00:00.000Z",
    changed_by: "qa-admin",
    changed_by_email: "admin@example.com",
    old_data: null,
    new_data: asRecord(record)
  });
}

function profile(id: string, email: string, fullName: string, nickname: string, site: string | null, role: Role) {
  return { id, email, full_name: fullName, nickname, site, role, created_at: "2026-06-01T00:00:00", updated_at: "2026-07-01T00:00:00" };
}

function requisition(
  docId: string,
  site: string,
  position: string,
  department: string,
  owner: string,
  headCount: number,
  date: string,
  status: "ongoing" | "filled" | "cancel" = "ongoing",
  level: string | null = "L4"
) {
  return {
    doc_id: docId,
    pr_approved_date: date,
    site,
    position,
    department,
    section: "QA",
    level,
    head_count: headCount,
    person_in_charge: owner,
    line_manager: "QA Manager",
    request_type: "New" as const,
    replacement_names: null,
    status,
    created_at: `${date}T00:00:00`,
    updated_at: `${date}T00:00:00`
  };
}

function positionGroup(groupId: string, groupPosition: string) {
  return {
    group_id: groupId,
    group_position: groupPosition,
    channel_fb: true,
    channel_jobthai: true,
    channel_jobtopgun: false,
    channel_jobdb: true,
    channel_jobbkk: false,
    channel_linkedin: true,
    channel_walkin: true,
    channel_referral: true,
    channel_others: true,
    created_at: "2026-06-01T00:00:00",
    updated_at: "2026-07-01T00:00:00"
  };
}

function documentGroup(docGroupId: string, docId: string, groupId: string, groupPosition: string) {
  return {
    doc_group_id: docGroupId,
    doc_id: docId,
    group_id: groupId,
    group_position: groupPosition,
    channel_fb: true,
    channel_jobthai: true,
    channel_jobtopgun: false,
    channel_jobdb: true,
    channel_jobbkk: false,
    channel_linkedin: true,
    channel_walkin: true,
    channel_referral: true,
    channel_others: true,
    created_at: "2026-06-01T00:00:00",
    updated_at: "2026-07-01T00:00:00"
  };
}

function candidate(candidateId: string, name: string, docGroupId: string, channel: string, date: string) {
  return {
    candidate_id: candidateId,
    name,
    phone_no: "0800000000",
    email: null,
    doc_group_id: docGroupId,
    channel,
    ref_name: null,
    first_contact_date: date,
    candidate_folder_url: `https://example.com/${candidateId}`,
    created_at: `${date}T00:00:00`,
    updated_at: `${date}T00:00:00`
  };
}

function log(logId: number, candidateId: string, stage: DashboardData["recruitment_logs"][number]["recruitment_process"], result: 0 | 1 | null, round: number, date: string, estimatedActionDate: string | null = null): DashboardData["recruitment_logs"][number] {
  return {
    log_id: logId,
    candidate_id: candidateId,
    log_date: date,
    recruitment_process: stage,
    round,
    interviewer: "QA Interviewer",
    result,
    remark: `QA ${stage}`,
    estimated_action_date: estimatedActionDate,
    created_at: `${date}T09:00:00`,
    stage_instance_id: `00000000-0000-4000-8000-${String(logId).padStart(12, "0")}`,
    outcome_date: result === null ? null : date,
    outcome_interviewer: result === null ? null : "QA Interviewer",
    outcome_remark: result === null ? null : `QA ${stage} outcome`,
    outcome_recorded_at: result === null ? null : `${date}T10:00:00`,
    updated_at: `${date}T09:00:00`,
    pending_edited_at: null,
    pending_edited_by: null,
    record_origin: "user" as const,
    migration_note: null,
    superseded_at: null,
    superseded_by_stage_instance_id: null,
    superseded_reason: null
  };
}

function offer(offerId: number, candidateId: string, docId: string, acceptedDate: string | null, firstWorkingDate: string | null) {
  return {
    offer_id: offerId,
    candidate_id: candidateId,
    doc_id: docId,
    accepted_date: acceptedDate,
    first_working_date: firstWorkingDate,
    start_confirmation: null,
    start_confirmed_at: null,
    start_confirmed_by: null,
    start_confirmation_reason: null,
    remark: null,
    created_at: "2026-07-01T00:00:00",
    updated_at: "2026-07-01T00:00:00"
  };
}

function sourcingUpdate(groupId: string, weekStart: string, applicants: number) {
  return {
    group_id: groupId,
    week_start: weekStart,
    channel_fb: true,
    channel_jobthai: true,
    channel_jobtopgun: false,
    channel_jobdb: false,
    channel_jobbkk: false,
    channel_linkedin: false,
    channel_walkin: false,
    channel_referral: false,
    channel_others: false,
    applicants_fb: applicants,
    applicants_jobthai: 0,
    applicants_jobtopgun: 0,
    applicants_jobdb: 0,
    applicants_jobbkk: 0,
    applicants_linkedin: 0,
    applicants_walkin: 0,
    applicants_referral: 0,
    applicants_others: 0,
    updated_by: "qa-admin",
    created_at: "2026-07-06T00:00:00",
    updated_at: "2026-07-06T00:00:00"
  };
}
