import { requisitionQueryAffected, type RequisitionActionReceipt } from "./requisition-action-receipt";
import { scheduleRecruitmentRead } from "./recruitment-read-scheduler";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardLevel } from "@/lib/dashboard-filters";
import type { PerformanceBand, PerformanceCell, PerformanceMetrics, PerformanceRange } from "@/lib/recruitment-performance";
import type { PipelineFunnelRow } from "@/components/ui/PipelineFunnel";
import type { SourceEffectivenessRow } from "@/components/dashboard/SourceEffectiveness";

export type PerformanceSummaryRange = { range: PerformanceRange; metrics: PerformanceMetrics; cells: PerformanceCell[]; sites: string[] };
export type PerformanceSummary = {
  current: PerformanceSummaryRange;
  prior: PerformanceSummaryRange;
  priorRange: PerformanceRange;
};
export type DashboardSummaryScope = {
  headerSite: string;
  headerPic: string;
  priorityOnly: boolean;
  sites: string[];
  departments: string[];
  levels: DashboardLevel[];
};

const cache = new Map<string, { expiresAt: number; request: Promise<unknown> }>();
const clientIds = new WeakMap<object, number>();
let nextClientId = 1;
async function cacheNamespace(client: SupabaseClient, profileKey: string) {
  let id = clientIds.get(client);
  if (!id) { id = nextClientId++; clientIds.set(client, id); }
  const { data } = await client.auth.getSession();
  const project = (client as unknown as { supabaseUrl?: string }).supabaseUrl ?? "supabase";
  return `${project}:${id}:${data.session?.user.id ?? "anonymous"}:${profileKey}`;
}
export function clearDashboardSummaryCache() { cache.clear(); sourcingSummaryReads.clear(); }
/** Expire only this auth scope's affected summaries; Welcome is responsibility-scoped. */
export function invalidateRequisitionSummaryCache(scope: string, receipts: RequisitionActionReceipt[]) {
 for(const key of cache.keys()){
  if(!key.includes(scope)||key.startsWith("welcome:"))continue;
  let filters: Record<string,unknown>={};
  try {const parts=JSON.parse(key);filters=parts.find((value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)&&("headerSite" in value||"headerPic" in value||"priorityOnly" in value))??{};}catch{
   const match=key.match(/\{.*\}/);if(match)try{filters=JSON.parse(match[0]);}catch{/* legacy cache shape */}
  }
  if(receipts.some(receipt=>receipt.effects.some(effect=>["summary","calendar","reports"].includes(effect))&&requisitionQueryAffected({entity:"requisitions",filters},receipt)))cache.delete(key);
 }
}
function memo<T>(client: SupabaseClient, key: string, fetch: () => Promise<T>, outsideQueue = false): Promise<T> {
  const now = Date.now();
  for (const [entryKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(entryKey);
  while (cache.size >= 100) cache.delete(cache.keys().next().value!);
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) return existing.request as Promise<T>;
  const request = outsideQueue ? Promise.resolve().then(fetch) : scheduleRecruitmentRead(client, fetch, 1);
  cache.set(key, { expiresAt: Number.POSITIVE_INFINITY, request });
  void request.then(() => { const entry = cache.get(key); if (entry?.request === request) entry.expiresAt = Date.now() + 30_000; }, () => {});
  request.catch(() => { if (cache.get(key)?.request === request) cache.delete(key); });
  return request;
}

/** The screen consumes aggregates only. Contribution ledgers are loaded separately when an export is requested. */
export async function loadPerformanceSummary(client: SupabaseClient, input: {
  start: string; end: string; priorStart: string; priorEnd: string; period: string;
  scope: DashboardSummaryScope; profileKey: string; refreshKey?: number;
}): Promise<PerformanceSummary> {
  const namespace = await cacheNamespace(client, input.profileKey);
  const key = JSON.stringify([namespace, input.start, input.end, input.priorStart, input.priorEnd, input.period, input.scope, input.refreshKey ?? 0]);
  return memo(client, key, async () => {
    const { data, error } = await client.rpc("app_dashboard_performance_summary_v1", {
      p_start: input.start, p_end: input.end, p_prior_start: input.priorStart, p_prior_end: input.priorEnd,
      p_period: input.period, p_scope: input.scope
    });
    if (error) throw new Error(error.message);
    const result = data as PerformanceSummary | null;
    if (!result || !result.current || !result.prior || !Array.isArray(result.current.cells) || !Array.isArray(result.prior.cells)) {
      throw new Error("Dashboard summary response is incomplete");
    }
    return result;
  });
}

export type HomeSummary = {
  requisitions: { open: number; priorityOpen: number };
  candidatePipeline: { stage: string; count: number }[];
  sourcing: { staleGroups: number; latestWeek: string | null };
  needsAction: { pendingCandidates: number; overduePending: number };
  counts: { openRequisitions: number; activePipeline: number; staleSourcing: number; pendingOffers: number; qualityIssues: number };
  workQueue: { items: Array<{ id: string; title: string; meta: string; actionLabel: string; priority: number; recordId: string; tone: "primary" | "success" | "warning" | "danger" | "muted" | "teal" | "purple"; type: "requisition" | "candidate" | "sourcing" | "offer" }>; totalCount: number };
  recentActivity: { log_id: number; entity: string; entity_id: string; action: string; changed_at: string; changed_by_email: string | null }[];
};
export type HomeScope = Pick<DashboardSummaryScope, "headerSite" | "headerPic" | "priorityOnly">;
export type HomeCoreSummary = Pick<HomeSummary, "requisitions" | "candidatePipeline" | "sourcing" | "needsAction"> & { counts: Omit<HomeSummary["counts"], "qualityIssues"> };
export type HomeWorkQueue = HomeSummary["workQueue"];
export async function loadHomeCoreSummary(client: SupabaseClient, scope: HomeScope, profileKey: string, refreshKey = 0): Promise<HomeCoreSummary> {
  const namespace = await cacheNamespace(client, profileKey);
  return memo(client, JSON.stringify(["home-core", namespace, scope, refreshKey]), async () => {
    const { data, error } = await client.rpc("app_home_core_summary_v1", { p_scope: scope });
    if (error) throw new Error(error.message);
    const result = data as HomeCoreSummary | null;
    if (!result || !result.requisitions || !result.sourcing || !result.needsAction || !Array.isArray(result.candidatePipeline) || !result.counts || (["openRequisitions", "activePipeline", "staleSourcing", "pendingOffers"] as const).some(key => !Number.isInteger(result.counts[key]) || result.counts[key] < 0)) throw new Error("Home core response is incomplete");
    return result;
  });
}
export async function loadHomeWorkQueue(client: SupabaseClient, scope: HomeScope, profileKey: string, refreshKey = 0): Promise<HomeWorkQueue> {
  const namespace = await cacheNamespace(client, profileKey);
  return memo(client, JSON.stringify(["home-work-queue", namespace, scope, refreshKey]), async () => {
    const { data, error } = await client.rpc("app_home_work_queue_v1", { p_scope: scope });
    if (error) throw new Error(error.message);
    const result = data as HomeWorkQueue | null;
    if (!result || !Array.isArray(result.items) || result.items.length > 10 || !Number.isInteger(result.totalCount) || result.totalCount < result.items.length) throw new Error("Home work queue response is incomplete");
    return result;
  });
}

export type WelcomeSummary = {
  openRequisitions: number;
  openVacancy: number;
  activeCandidates: number;
  offerFinalizationNeeded: number;
  filledThisMonth: number;
  responsibleVacancyTotal: number;
  filledResponsibleVacancyRatio: number;
  filledResponsibleVacancyBucket: 0 | 25 | 50 | 75 | 100;
};
export type HomeBannerSummary = { monthlyFillCapacity: number; monthlyFilledCount: number };
export async function loadWelcomeSummary(client: SupabaseClient, profileKey: string, refreshKey = 0, shouldRead: () => boolean = () => true): Promise<WelcomeSummary> {
  const namespace = await cacheNamespace(client, profileKey);
  return memo(client, `welcome:${namespace}:${refreshKey}`, async () => {
    if (!shouldRead()) throw new Error("Welcome summary dismissed.");
    const { data, error } = await client.rpc("app_home_welcome_summary_v1");
    if (error) throw new Error(error.message);
    const result = data as WelcomeSummary | null;
    const fields: (keyof WelcomeSummary)[] = ["openRequisitions", "openVacancy", "activeCandidates", "offerFinalizationNeeded", "filledThisMonth", "responsibleVacancyTotal", "filledResponsibleVacancyRatio"];
    if (!result || fields.some(field => typeof result[field] !== "number" || !Number.isFinite(result[field] as number)) || ![0, 25, 50, 75, 100].includes(result.filledResponsibleVacancyBucket)) throw new Error("Welcome summary response is incomplete");
    return result;
  }, true);
}
export async function loadHomeBannerSummary(client: SupabaseClient, scope: Pick<DashboardSummaryScope, "headerSite" | "headerPic" | "priorityOnly">, profileKey: string, refreshKey = 0): Promise<HomeBannerSummary> {
  const namespace = await cacheNamespace(client, profileKey);
  return memo(client, `home-banner:${namespace}:${JSON.stringify(scope)}:${refreshKey}`, async () => {
    const { data, error } = await client.rpc("app_home_banner_summary_v1", { p_scope: scope });
    if (error) throw new Error(error.message);
    const result = data as HomeBannerSummary | null;
    if (!result || !Number.isFinite(result.monthlyFillCapacity) || !Number.isFinite(result.monthlyFilledCount)) throw new Error("Home banner summary response is incomplete");
    return result;
  });
}
export type HomeQualityIssue = { id: string; cursorId: string; severity: "blocking" | "warning" | "info"; entity: "requisition" | "candidate" | "offer" | "sourcing" | "pipeline"; entityId: string; title: string; detail: string; actionLabel?: string; href?: string; workspaceCode?: string; workspaceParams?: Record<string, string | number> };
export type HomeQualityPage = { items: HomeQualityIssue[]; totalCount: number; hasMore: boolean; nextCursor: { severity: number; title: string; id: string } | null };
export type SourcingStageChannelKey = "channel_fb"|"channel_jobthai"|"channel_jobtopgun"|"channel_jobdb"|"channel_jobbkk"|"channel_linkedin"|"channel_walkin"|"channel_referral"|"channel_others"|"unknown";
export type SourcingSummary = {
  selectedWeek: string; groupId: string | null; totalApplicants: number | null; selectedApplicants: number | null;
  expectedRows: number; updatedWeeks: number; completeness: number;
  channels: Record<Exclude<SourcingStageChannelKey,"unknown">,number>;
  weeks: Array<{week_start:string;expectedRows:number;updatedRows:number;applicants:number|null}>;
  stageChannels: {cutoff:string;legend:SourcingStageChannelKey[];stages:Array<{stage:string;total:number;segments:Array<{key:SourcingStageChannelKey;count:number}>}>}|null;
};
export type RecruitmentCalendarPage = { events: {
  id: string; candidateId: string; applicationId: string; candidateName: string; date: string;
  eventType: "stage" | "start_work"; overdue: boolean; owner: string | null; round: number;
  site: string | null; stage: string; position: string | null;
  startWorkStatus?: "scheduled" | "confirmation_pending" | "started"; logId?: number | null; stageInstanceId?: string | null; logDate?: string | null; interviewer?: string | null; remark?: string | null; updatedAt?: string | null;
}[]; hasMore: boolean; nextCursor: { date: string; id: string } | null };
export type RecruitmentCalendarSummary = Omit<RecruitmentCalendarPage, "nextCursor"> & { nextCursor: null };
export async function loadHomeSummary(client: SupabaseClient, scope: Pick<DashboardSummaryScope, "headerSite" | "headerPic" | "priorityOnly">, profileKey: string, refreshKey = 0) {
  const namespace = await cacheNamespace(client, profileKey);
  return memo(client, `home:${namespace}:${JSON.stringify(scope)}:${refreshKey}`, async () => {
    const { data, error } = await client.rpc("app_home_summary_v1", { p_scope: scope });
    if (error) throw new Error(error.message);
    const result = data as HomeSummary | null;
    if (!result || !Array.isArray(result.candidatePipeline) || !Array.isArray(result.recentActivity) || !result.counts || !result.workQueue || !Array.isArray(result.workQueue.items) || result.workQueue.items.length > 10 || typeof result.workQueue.totalCount !== "number") throw new Error("Home summary response is incomplete");
    return result;
  });
}
export async function loadHomeQualityPage(client: SupabaseClient,input:{scope:Pick<DashboardSummaryScope,"headerSite"|"headerPic"|"priorityOnly">;groupId?:string|null;docId?:string|null;today:string;cursor?:HomeQualityPage["nextCursor"];limit?:25|50;profileKey:string;refreshKey?:number}):Promise<HomeQualityPage>{
  const groupId=input.groupId??null,docId=input.docId??null;
  if(groupId===""||docId==="")throw new Error("Home quality scope IDs must be exact nonempty values");
  const namespace=await cacheNamespace(client,input.profileKey),limit=input.limit??25,scope={...input.scope,...(groupId?{groupId}:{}),...(docId?{docId}:{})},key=JSON.stringify(["home-quality",namespace,scope,input.today,input.cursor??null,limit,input.refreshKey??0]);
  return memo(client, key,async()=>{
    const {data,error}=await client.rpc("app_home_quality_page_v1",{p_scope:scope,p_today:input.today,p_after_severity:input.cursor?.severity??null,p_after_title:input.cursor?.title??null,p_after_id:input.cursor?.id??null,p_limit:limit});
    if(error)throw new Error(error.message);
    const result=data as HomeQualityPage|null;
    if(!result||!Array.isArray(result.items)||result.items.length>limit||typeof result.totalCount!=="number"||typeof result.hasMore!=="boolean"||result.hasMore&&!result.nextCursor)throw new Error("Home quality page response is incomplete");
    return result;
  });
}
type SourcingSummaryRead = { promise: Promise<SourcingSummary>; controller: AbortController; readers: number; settled: boolean; expiresAt: number };
const sourcingSummaryReads = new Map<string, SourcingSummaryRead>();
async function sourcingSummaryLease(client: SupabaseClient, key: string, signal: AbortSignal | undefined, fetch: (signal: AbortSignal) => Promise<SourcingSummary>) {
  if (signal?.aborted) throw new DOMException("Read canceled", "AbortError");
  for (const [oldKey, entry] of sourcingSummaryReads) if (entry.expiresAt <= Date.now()) sourcingSummaryReads.delete(oldKey);
  let entry = sourcingSummaryReads.get(key);
  if (!entry) {
    const controller = new AbortController();
    const promise = scheduleRecruitmentRead(client, () => fetch(controller.signal), 1, { signal: controller.signal });
    entry = { promise, controller, readers: 0, settled: false, expiresAt: Infinity };
    const created = entry;
    sourcingSummaryReads.set(key, created);
    void promise.then(() => { created.settled = true; created.expiresAt = Date.now() + 30_000; }, () => { created.settled = true; if (sourcingSummaryReads.get(key) === created) sourcingSummaryReads.delete(key); });
    while (sourcingSummaryReads.size > 100) sourcingSummaryReads.delete(sourcingSummaryReads.keys().next().value!);
  }
  const leased = entry;
  leased.readers++;
  let cancel: (() => void) | undefined;
  try {
    const cancellation = new Promise<never>((_, reject) => {
      cancel = () => reject(new DOMException("Read canceled", "AbortError"));
      signal?.addEventListener("abort", cancel, { once: true });
    });
    return await (signal ? Promise.race([leased.promise, cancellation]) : leased.promise);
  } finally {
    if (cancel) signal?.removeEventListener("abort", cancel);
    leased.readers--;
    if (!leased.readers && !leased.settled) { leased.controller.abort(); if (sourcingSummaryReads.get(key) === leased) sourcingSummaryReads.delete(key); }
  }
}
export async function loadSourcingSummary(client:SupabaseClient,input:{selectedWeek:string;groupId?:string|null;scope:Pick<DashboardSummaryScope,"headerSite"|"headerPic"|"priorityOnly">;profileKey:string;refreshKey?:number;signal?:AbortSignal}):Promise<SourcingSummary>{
  const namespace=await cacheNamespace(client,input.profileKey),groupId=input.groupId??null,key=JSON.stringify(["sourcing-summary",namespace,input.selectedWeek,groupId,input.scope,input.refreshKey??0]);
  return sourcingSummaryLease(client, key, input.signal, async(signal)=>{
    const call=client.rpc("app_recruitment_sourcing_summary_v1",{p_selected_week:input.selectedWeek,p_group_id:groupId,p_scope:input.scope});
    const {data,error}=await (typeof call.abortSignal === "function" ? call.abortSignal(signal) : call);
    if(error)throw new Error(error.message);
    const result=data as SourcingSummary|null;
    if(!result||!Array.isArray(result.weeks)||result.weeks.length>8||!result.channels||!Number.isInteger(result.expectedRows)||!Number.isInteger(result.updatedWeeks)||!Number.isInteger(result.completeness)||result.groupId!==groupId||result.selectedWeek!==input.selectedWeek||groupId!==null&&!result.stageChannels)throw new Error("Sourcing summary response is incomplete");
    return result;
  });
}
export async function loadRecruitmentCalendarSummary(client: SupabaseClient, input: {
  start: string; end: string; scope: Pick<DashboardSummaryScope, "headerSite" | "headerPic" | "priorityOnly">; profileKey: string; refreshKey?: number;
}) {
  if (input.start > input.end || (Date.parse(`${input.end}T00:00:00Z`) - Date.parse(`${input.start}T00:00:00Z`)) / 86_400_000 > 61) throw new Error("Calendar range must cover at most 62 days");
  const namespace = await cacheNamespace(client, input.profileKey);
  return memo(client, `calendar:${namespace}:${input.start}:${input.end}:${JSON.stringify(input.scope)}:${input.refreshKey ?? 0}`, async () => {
    const events: RecruitmentCalendarPage["events"] = [];
    let cursor: { date: string; id: string } | null = null;
    const seen = new Set<string>();
    for (;;) {
      const { data, error } = await client.rpc("app_recruitment_calendar_v1", { p_start: input.start, p_end: input.end, p_scope: input.scope,
        p_after_date: cursor?.date ?? null, p_after_id: cursor?.id ?? null, p_limit: 200 });
      if (error) throw new Error(error.message);
      const page = data as RecruitmentCalendarPage | null;
      if (!page || !Array.isArray(page.events) || page.events.length > 200 || typeof page.hasMore !== "boolean") throw new Error("Calendar summary response is incomplete");
      for (const event of page.events) {
        if (seen.has(event.id)) throw new Error("Calendar response repeated an event; retry");
        seen.add(event.id); events.push(event);
      }
      if (!page.hasMore) return { events, hasMore: false, nextCursor: null };
      if (!page.nextCursor || page.events.length === 0) throw new Error("Calendar event pagination did not advance");
      if (cursor && (page.nextCursor.date < cursor.date || page.nextCursor.date === cursor.date && page.nextCursor.id <= cursor.id)) throw new Error("Calendar event pagination repeated a cursor");
      cursor = page.nextCursor;
    }
  });
}

export async function loadDashboardFilterOptions(client: SupabaseClient, scope: Pick<DashboardSummaryScope, "headerSite" | "headerPic" | "priorityOnly"> & { sites: string[] }, profileKey: string) {
  const namespace = await cacheNamespace(client, profileKey);
  return memo(client, `options:${namespace}:${JSON.stringify(scope)}`, async () => {
    const { data, error } = await client.rpc("app_dashboard_filter_options_v1", { p_scope: scope });
    if (error) throw new Error(error.message);
    const result = data as { sites?: unknown; departments?: unknown; owners?: unknown } | null;
    if (!result || !Array.isArray(result.sites) || !Array.isArray(result.departments) || !Array.isArray(result.owners)
      || !result.sites.every(value => typeof value === "string") || !result.departments.every(value => typeof value === "string") || !result.owners.every(value => typeof value === "string")) throw new Error("Dashboard filter options are incomplete");
    return { sites: result.sites as string[], departments: result.departments as string[], owners: result.owners as string[] };
  });
}


export type PipelineSummary = {
  range: PerformanceRange;
  reassignments: { in: number; out: number };
  funnelRows: PipelineFunnelRow[];
  sourceRows: SourceEffectivenessRow[];
  waterfallRows: { waterfall_category: string; site: string; request_type: string; vacancy_count: number; filledInSla: number; filledSlaUnknown: number }[];
  channelOptions: string[];
};

export type RiskTotalsSummary = { track: number; near: number; overdue: number; unknown: number; open: number; priorityOpen: number; priority: number; known: number; exposure: number | null };
export type RiskSummary = {
  asOf: string; future: boolean; totals: RiskTotalsSummary; priorTotals: RiskTotalsSummary | null; priorRange: PerformanceRange;
  trends: Array<{ date: string } & RiskTotalsSummary>;
  groups: Record<"site" | "department" | "department-site", Array<{ name: string } & RiskTotalsSummary>>;
};
export type RiskPage = { rows: Array<{ docId: string; site: string; department: string; position: string; personInCharge: string | null; priority: boolean; level: string | null; headCount: number; open: number; kind: "track" | "near" | "overdue" | "unknown"; startDate: string | null; restartDate: string | null; age: number | null; remaining: number | null }>; total: number; hasMore: boolean; nextCursor: { kind: number; remaining: number; open: number; docId: string } | null };
export const RISK_PAGE_SIZE = 20;

export async function loadRiskSummary(client: SupabaseClient, input: {
  start: string; end: string; priorStart: string; priorEnd: string; scope: DashboardSummaryScope; trendDates: string[]; profileKey: string; refreshKey?: number;
}): Promise<RiskSummary> {
  const namespace = await cacheNamespace(client, input.profileKey);
  const key = JSON.stringify(["risk", namespace, input.start, input.end, input.priorStart, input.priorEnd, input.scope, input.trendDates, input.refreshKey ?? 0]);
  return memo(client, key, async () => {
    const { data, error } = await client.rpc("app_dashboard_risk_summary_v1", {
      p_start: input.start, p_end: input.end, p_prior_start: input.priorStart, p_prior_end: input.priorEnd, p_scope: input.scope, p_trend_dates: input.trendDates
    });
    if (error) throw new Error(error.message);
    const result = data as RiskSummary | null;
    if (!result || !result.totals || !result.groups || !Array.isArray(result.trends) || Object.hasOwn(result, "rows") || Object.hasOwn(result, "coverage")) throw new Error("Risk summary response is incomplete");
    return result;
  });
}

export async function loadRiskPage(client: SupabaseClient, input: {
  asOf: string; scope: DashboardSummaryScope; filter: string; grouping: "site" | "department" | "department-site"; group: string;
  cursor?: RiskPage["nextCursor"]; profileKey: string; refreshKey?: number;
}): Promise<RiskPage> {
  const namespace = await cacheNamespace(client, input.profileKey);
  const key = JSON.stringify(["risk-page",namespace,input.asOf,input.scope,input.filter,input.grouping,input.group,input.cursor,input.refreshKey??0]);
  return memo(client, key,async()=>{
    const {data,error}=await client.rpc("app_dashboard_risk_page_v1",{p_as_of:input.asOf,p_scope:input.scope,p_filter:input.filter,p_grouping:input.grouping,p_group:input.group,
      p_after_kind:input.cursor?.kind??null,p_after_remaining:input.cursor?.remaining??null,p_after_open:input.cursor?.open??null,p_after_doc:input.cursor?.docId??null,p_limit:RISK_PAGE_SIZE});
    if(error) throw new Error(error.message);
    const result=data as RiskPage|null;
    if(!result||!Array.isArray(result.rows)||result.rows.length>RISK_PAGE_SIZE||typeof result.total!=="number"||typeof result.hasMore!=="boolean"||result.hasMore&&!result.nextCursor) throw new Error("Risk page response is incomplete");
    return result;
  });
}

export type ActiveRequisitionReportRow = {
  doc_id:string; site:string; department:string; section:string|null; position:string; level:string; vacancy:number;
  applicant_count:number; applicant_channels:Record<string,number>; request_type:"New"|"Replacement"; requisition_date:string;
  actual_age_days:number|null; person_in_charge:string; stage_counts:Record<string,number>;
  sla_state:{ageDays:number|null;endDate:string|null;inSla:boolean|null;isOverdue:boolean;label:string;slaDays:number|null;startDate:string|null};
  filled_date:string|null; period_status:"ongoing"|"filled"|"cancel"; period_detail:string|null;
};
export type ActiveRequisitionReportPage = {rows:ActiveRequisitionReportRow[];total:number;hasMore:boolean;nextCursor:{value:string;id:string}|null};
export type ActiveRequisitionReportCriteria={filters:Record<string,string>;search:string;sortKey:string|null;sortDirection:"asc"|"desc"|null};
export async function loadActiveRequisitionReportPage(client:SupabaseClient,input:{start:string;end:string;period:string;stageMode:"status"|"activity"|"accum";scope:DashboardSummaryScope;criteria:ActiveRequisitionReportCriteria;cursor?:ActiveRequisitionReportPage["nextCursor"]|null;profileKey:string;refreshKey?:number}):Promise<ActiveRequisitionReportPage>{
  const namespace=await cacheNamespace(client,input.profileKey),key=JSON.stringify(["active-requisition-report",namespace,input.start,input.end,input.period,input.stageMode,input.scope,input.criteria,input.cursor??null,input.refreshKey??0]);
  return memo(client, key,async()=>{
    const {data,error}=await client.rpc("app_dashboard_active_requisitions_page_v1",{p_start:input.start,p_end:input.end,p_period:input.period,p_stage_mode:input.stageMode,p_scope:input.scope,p_after_value:input.cursor?.value??null,p_after_id:input.cursor?.id??null,p_limit:25,p_search:input.criteria.search,p_filters:input.criteria.filters,p_sort:input.criteria.sortKey,p_direction:input.criteria.sortDirection});
    if(error)throw new Error(error.message);
    const result=data as ActiveRequisitionReportPage|null;
    if(!result||!Array.isArray(result.rows)||result.rows.length>25||!Number.isInteger(result.total)||typeof result.hasMore!=="boolean"||result.hasMore&&!result.nextCursor)throw new Error("Active requisition report response is incomplete");
    return result;
  });
}
export type ActiveRequisitionCandidate = {applicationId?:string;candidateId:string;name:string;stage:string;pendingDate:string;resultDate:string|null;remark:string|null;result:0|1|null};
export type ActiveRequisitionCandidatePage = {matches:ActiveRequisitionCandidate[];total:number;hasMore:boolean;nextCursor:{name:string;applicationId:string}|null};
export async function loadActiveRequisitionCandidatePage(client:SupabaseClient,input:{docId:string;stage:string;start:string;end:string;requisitionDate:string|null;stageMode:"status"|"activity"|"accum";cursor?:ActiveRequisitionCandidatePage["nextCursor"]|null;profileKey:string;refreshKey?:number}):Promise<ActiveRequisitionCandidatePage>{
  const namespace=await cacheNamespace(client,input.profileKey),key=JSON.stringify(["active-requisition-candidates",namespace,input.docId,input.stage,input.start,input.end,input.requisitionDate,input.stageMode,input.cursor??null,input.refreshKey??0]);
  return memo(client, key,async()=>{
    const {data,error}=await client.rpc("app_dashboard_active_requisition_candidates_v1",{p_doc_id:input.docId,p_stage:input.stage,p_start:input.start,p_end:input.end,p_requisition_date:input.requisitionDate,p_stage_mode:input.stageMode,p_after_name:input.cursor?.name??null,p_after_application_id:input.cursor?.applicationId??null,p_limit:25});
    if(error)throw new Error(error.message);
    const result=data as ActiveRequisitionCandidatePage|null;
    if(!result||!Array.isArray(result.matches)||result.matches.length>25||!Number.isInteger(result.total)||typeof result.hasMore!=="boolean"||result.hasMore&&!result.nextCursor)throw new Error("Requisition stage drilldown response is incomplete");
    return result;
  });
}

export type BottleneckMetrics = { waiting: number; median: number | null; overdue: number; longest: number | null; unavailable: number };
export type BottleneckStageSummary = { stage: string; sample: number; median: number | null; p90: number | null; waiting: number; oldest: number | null };
export type BottleneckSummary = {
  asOf: string; start: string; future: boolean; channel: string; stages: BottleneckStageSummary[]; primary: BottleneckStageSummary | null;
  metrics: BottleneckMetrics; priorMetrics: BottleneckMetrics | null; priorRange: PerformanceRange;
  trends: Array<{ date: string } & BottleneckMetrics>; excluded: number; conflicts: number;
  statusCounts: Record<string, number>; picOptions: string[]; channelOptions: string[];
};
export type BottleneckQueueStatus = "overdue" | "today" | "upcoming" | "unscheduled" | "unavailable";
export type BottleneckQueueRow = {
  candidate: { candidate_id: string; name: string; application_id: string };
  instance: { id: string; logId: number; candidateId: string; applicationId: string; groupId: string | null; stage: string; round: number; entry: string | null; outcome: string | null; result: number | null; due: string | null; edited: string | null; unreliable: boolean; invalidDue: boolean; duration: number | null; exclusion: string | null };
  requisitions: Array<{ doc_id: string; position: string; site: string; department: string; person_in_charge: string | null }>;
  wait: number; status: BottleneckQueueStatus; conflict: boolean;
};
export type BottleneckPage = { rows: BottleneckQueueRow[]; hasMore: boolean; hasMoreBefore: boolean; nextCursor: { value: string; id: string } | null; previousCursor: { value: string; id: string } | null };
export async function loadBottleneckPage(client: SupabaseClient, input: {
  asOf: string; scope: DashboardSummaryScope; channel: string; stage: string; status: string; pic: string; search: string;
  cursor?: { value: string; id: string } | null; before?: boolean; profileKey: string; refreshKey?: number;
}): Promise<BottleneckPage> {
  const namespace = await cacheNamespace(client, input.profileKey);
  const key = JSON.stringify(["bottleneck-page", namespace, input.asOf, input.scope, input.channel, input.stage, input.status, input.pic, input.search, input.cursor ?? null, input.before ?? false, input.refreshKey ?? 0]);
  return memo(client, key, async () => {
    const { data, error } = await client.rpc("app_dashboard_bottleneck_queue_v1", {
      p_as_of: input.asOf, p_scope: input.scope, p_channel: input.channel, p_stage: input.stage || null,
      p_status: input.status === "all" ? null : input.status, p_pic: input.pic || null, p_search: input.search || "",
      p_after_value: input.before ? null : input.cursor?.value ?? null, p_after_id: input.before ? null : input.cursor?.id ?? null,
      p_before_value: input.before ? input.cursor?.value ?? null : null, p_before_id: input.before ? input.cursor?.id ?? null : null, p_limit: 20
    });
    if (error) throw new Error(error.message);
    const result = data as BottleneckPage | null;
    if (!result || !Array.isArray(result.rows) || result.rows.length > 20 || typeof result.hasMore !== "boolean" || typeof result.hasMoreBefore !== "boolean" || result.hasMore && !result.nextCursor || result.hasMoreBefore && !result.previousCursor) throw new Error("Bottleneck queue response is incomplete");
    return result;
  });
}
export async function loadBottleneckSummary(client: SupabaseClient,input:{start:string;end:string;priorStart:string;priorEnd:string;scope:DashboardSummaryScope;channel:string;trendDates:string[];profileKey:string;refreshKey?:number}):Promise<BottleneckSummary>{
  const namespace=await cacheNamespace(client,input.profileKey);
  const key=JSON.stringify(["bottlenecks",namespace,input.start,input.end,input.priorStart,input.priorEnd,input.scope,input.channel,input.trendDates,input.refreshKey??0]);
  return memo(client, key,async()=>{
    const {data,error}=await client.rpc("app_dashboard_bottleneck_summary_v1",{p_start:input.start,p_end:input.end,p_prior_start:input.priorStart,p_prior_end:input.priorEnd,p_scope:input.scope,p_channel:input.channel,p_trend_dates:input.trendDates});
    if(error)throw new Error(error.message);
    const result=data as BottleneckSummary|null;
    if(!result||!Array.isArray(result.stages)||!Array.isArray(result.trends)||!result.metrics||!Array.isArray(result.picOptions)||!Array.isArray(result.channelOptions)||Object.hasOwn(result,"waiting")||Object.hasOwn(result,"instances")||Object.hasOwn(result,"completions"))throw new Error("Bottleneck summary response is incomplete");
    return result;
  });
}

export async function loadPipelineSummary(client: SupabaseClient, input: {
  start: string; end: string; period: string; scope: DashboardSummaryScope; channel: string; profileKey: string; refreshKey?: number;
}): Promise<PipelineSummary> {
  const namespace = await cacheNamespace(client, input.profileKey);
  const key = JSON.stringify(["pipeline", namespace, input.start, input.end, input.period, input.scope, input.channel, input.refreshKey ?? 0]);
  return memo(client, key, async () => {
    const { data, error } = await client.rpc("app_dashboard_pipeline_summary_v1", {
      p_start: input.start, p_end: input.end, p_period: input.period, p_scope: input.scope, p_channel: input.channel
    });
    if (error) throw new Error(error.message);
    const result = data as PipelineSummary | null;
    if (!result || !Array.isArray(result.funnelRows) || !Array.isArray(result.sourceRows) || !Array.isArray(result.waterfallRows) || !Array.isArray(result.channelOptions) || !result.reassignments) {
      throw new Error("Pipeline summary response is incomplete");
    }
    if (Object.hasOwn(result, "stageRecords") || Object.hasOwn(result, "hireRecords") || Object.hasOwn(result, "sourcingRecords")) throw new Error("Pipeline screen response contains contribution ledgers");
    return result;
  });
}
export function validPerformanceSummaryCell(value: unknown): value is PerformanceCell {
  if (!value || typeof value !== "object") return false;
  const cell = value as Record<string, unknown>;
  return typeof cell.site === "string" && ["NML", "FML", "MML", "SML", "Executive", "Unknown"].includes(cell.band as PerformanceBand)
    && ["vacancies", "filled", "open", "onTime", "late", "unknownSla", "newVacancies", "replacementVacancies"].every(key => Number.isFinite(cell[key]));
}

export type RejectionActorSummary = { company: number; candidate: number; unclassified: number };
export type RejectionReasonSummary = { key: string; label: { en: string; th: string }; count: number; share: number; actor: "company" | "candidate" | "unclassified" };
export type RejectionSummary = {
  range: PerformanceRange; total: number; people: number; applications: number; actors: RejectionActorSummary; periodTotal: number;
  diagnostics: { undated: number; unresolvedContext: number };
  stages: Array<{ stage: string; count: number } & RejectionActorSummary>; stageOptions: string[];
  trends: Array<{ start: string; end: string; count: number } & RejectionActorSummary>;
  granularity: "daily" | "weekly" | "monthly";
  mainReasons: RejectionReasonSummary[]; detailedReasons: RejectionReasonSummary[]; mainOptions: RejectionReasonSummary[]; detailOptions: RejectionReasonSummary[];
  comparison: { total: number; level: "main" | "detail"; reasons: RejectionReasonSummary[]; main: string; label?: { en: string; th: string }; selected: string };
};
export type RejectionFilterInput = { actor: string; stage: string; main: string; detail: string; search: string };
export type RejectionPageEvent = {
  id: string; logId: number; applicationId: string | null; candidateId: string; name: string; groupId: string | null;
  position: string | null; date: string; stage: string; round: number; actor: "company" | "candidate" | "unclassified";
  mainKey: string; detailKey: string; main: { en: string; th: string }; detail: { en: string; th: string };
  requisitions: Array<{ doc_id: string; site: string; department: string; position: string; person_in_charge: string | null }>;
};
export type RejectionPage = { events: RejectionPageEvent[]; total: number; hasMore: boolean; nextCursor: { value: string; logId: number } | null };

export async function loadRejectionSummary(client: SupabaseClient,input:{start:string;end:string;scope:DashboardSummaryScope;filters:RejectionFilterInput;profileKey:string;refreshKey?:number}):Promise<RejectionSummary>{
  const namespace=await cacheNamespace(client,input.profileKey),key=JSON.stringify(["rejections",namespace,input.start,input.end,input.scope,input.filters,input.refreshKey??0]);
  return memo(client, key,async()=>{
    const {data,error}=await client.rpc("app_dashboard_rejection_summary_v1",{p_start:input.start,p_end:input.end,p_scope:input.scope,p_filters:input.filters});
    if(error)throw new Error(error.message);
    const result=data as RejectionSummary|null;
    if(!result||!result.actors||!result.diagnostics||!Array.isArray(result.stages)||!Array.isArray(result.stageOptions)||!Array.isArray(result.trends)||!Array.isArray(result.mainReasons)||!Array.isArray(result.detailedReasons)||!Array.isArray(result.mainOptions)||!Array.isArray(result.detailOptions)||!result.comparison||Object.hasOwn(result,"events")||Object.hasOwn(result,"periodEvents"))throw new Error("Rejection summary response is incomplete");
    return result;
  });
}
export async function loadRejectionPage(client:SupabaseClient,input:{start:string;end:string;scope:DashboardSummaryScope;filters:RejectionFilterInput;sort:"date-desc"|"date-asc"|"candidate-asc"|"stage-asc";cursor?:RejectionPage["nextCursor"];profileKey:string;refreshKey?:number}):Promise<RejectionPage>{
  const namespace=await cacheNamespace(client,input.profileKey),key=JSON.stringify(["rejection-page",namespace,input.start,input.end,input.scope,input.filters,input.sort,input.cursor,input.refreshKey??0]);
  return memo(client, key,async()=>{
    const {data,error}=await client.rpc("app_dashboard_rejection_page_v1",{p_start:input.start,p_end:input.end,p_scope:input.scope,p_filters:input.filters,p_sort:input.sort,p_after_value:input.cursor?.value??null,p_after_log_id:input.cursor?.logId??null,p_limit:25});
    if(error)throw new Error(error.message);
    const result=data as RejectionPage|null;
    if(!result||!Array.isArray(result.events)||result.events.length>25||typeof result.total!=="number"||typeof result.hasMore!=="boolean"||result.hasMore&&!result.nextCursor)throw new Error("Rejection page response is incomplete");
    return result;
  });
}
