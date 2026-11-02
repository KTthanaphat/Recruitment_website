"use client";

import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Building2, CalendarDays, ContactRound, Hash, LockKeyhole, Mail, Pencil, Phone, Plus, UserRound, UsersRound } from "lucide-react";
import { DetailGrid, SectionHeading } from "@/components/ui/RecordDetailFields";
import { InlineDataQualityIssues } from "@/components/ui/Workflow";
import { deriveDataQualityIssues } from "@/lib/operations";
import { Button } from "@/components/ui/Button";
import { formatDate, formatDateTime, formatRecruitmentId } from "@/lib/format";
import { processLabel } from "@/lib/constants";
import { compareApplicationLogs } from "@/lib/application-stage-order";
import { candidateCanUseGroup, canManageApplicationGroup, profileCapabilities } from "@/lib/applications";
import { fetchApplicationDestinations, type ApplicationDestination } from "@/lib/application-destinations";
import type { DashboardData, Language } from "@/types/recruitment";

const ApplicationDetailsContext = createContext<ReactNode>(null);
export function CandidateApplicationDetailsExtras() { return useContext(ApplicationDetailsContext); }

export function CandidateProfilePanel({candidateId, applicationId, data, language, client, accessScope, onSelect, onEdit, onAction, children}: {
  candidateId:string; applicationId:string|null; data:DashboardData; language:Language;
  client:SupabaseClient|null; accessScope:string;
  onSelect:(id:string)=>void; onEdit:()=>void; onAction:(rpc:string,payload:Record<string,unknown>,summary:string)=>void; children?:ReactNode;
}) {
  const currentNote=data.candidate_notes?.find(row=>row.candidate_id===candidateId);
  const [intent,setIntent]=useState<"add"|"transfer"|null>(null);
  const [group,setGroup]=useState("");
  const [reason,setReason]=useState("");
  const [destinationSearch,setDestinationSearch]=useState("");
  const [destinationRows,setDestinationRows]=useState<ApplicationDestination[]>([]);
  const [destinationCursor,setDestinationCursor]=useState<string|null>(null);
  const [destinationHasMore,setDestinationHasMore]=useState(false);
  const [destinationLoading,setDestinationLoading]=useState(false);
  const [destinationError,setDestinationError]=useState(false);
  const [destinationRetry,setDestinationRetry]=useState(0);
  const tabs=useRef<Array<HTMLButtonElement|null>>([]);
  useEffect(()=>{setIntent(null);setGroup("");setReason("");setDestinationSearch("");},[applicationId,candidateId]);
  useEffect(()=>{
    if(!intent||!client||!accessScope){setDestinationRows([]);setDestinationCursor(null);setDestinationHasMore(false);setDestinationLoading(false);return;}
    let cancelled=false;setDestinationRows([]);setDestinationCursor(null);setDestinationHasMore(false);setDestinationLoading(true);setDestinationError(false);
    const timer=setTimeout(()=>{fetchApplicationDestinations(client,{search:destinationSearch,limit:50}).then(page=>{if(!cancelled){setDestinationRows(page.items);setDestinationCursor(page.next_cursor?.group_id??null);setDestinationHasMore(page.has_more);}}).catch(()=>{if(!cancelled){setDestinationRows([]);setDestinationError(true);}}).finally(()=>{if(!cancelled)setDestinationLoading(false);});},300);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[accessScope,client,destinationRetry,destinationSearch,intent]);
  const t=(en:string,th:string)=>language==="th"?th:en;
  const candidate=data.candidates.find(row=>row.candidate_id===candidateId);
  const masked=data.masked_candidate_pool?.find(row=>row.candidate_id===candidateId);
  if(!candidate) return masked ? <section className="grid gap-4" aria-label={t("Masked candidate profile","ข้อมูลผู้สมัครที่ปกปิด")}>
    <h3 className="text-lg font-semibold text-navy">{formatRecruitmentId(masked.candidate_id)}</h3>
    <p className="text-sm text-slate">{t("Position interests","ตำแหน่งที่สนใจ")}: {masked.position_interests??"—"}</p>
    <p className="text-sm text-slate">{t("Created by","สร้างโดย")}: {masked.creator_label} · {formatDate(masked.created_at,language)}</p>
    <div className="select-none rounded-lg border border-[#D7DEE8] p-4"><span aria-hidden="true" className="block blur-sm">••••••••••••••••••••</span><p className="mt-3 flex items-center gap-2 text-sm text-slate"><LockKeyhole size={16}/>{t("Private profile. Only its creator or an administrator can start its first application.","ข้อมูลส่วนตัว เฉพาะผู้สร้างหรือผู้ดูแลระบบเท่านั้นที่เพิ่มใบสมัครแรกได้")}</p></div>
  </section> : <p>{t("Candidate unavailable or access changed.","ไม่พบผู้สมัครหรือสิทธิ์การเข้าถึงเปลี่ยนแปลง")}</p>;

  const capabilities=profileCapabilities(data,candidateId);
  const applications=(data.candidate_applications??[]).filter(row=>row.candidate_id===candidateId).sort((a,b)=>Number(a.state==="closed")-Number(b.state==="closed")||b.created_at.localeCompare(a.created_at)||a.application_id.localeCompare(b.application_id));
  const selected=applications.find(row=>row.application_id===applicationId);
  const selectedLogs=selected?data.recruitment_logs.filter(row=>row.application_id===selected.application_id&&!row.superseded_at).sort((a,b)=>compareApplicationLogs(b,a)):[];
  const currentLog=selectedLogs[0];
  const canTransfer=Boolean(selected?.state==="active"&&canManageApplicationGroup(data,selected.group_id));
  const destinations=destinationRows.filter(row=>(intent!=="transfer"||row.group_id!==selected?.group_id)&&candidateCanUseGroup(data,candidateId,row.group_id,intent==="transfer"?selected?.application_id:undefined));
  const profileWarnings = deriveDataQualityIssues(data).filter((issue,index,all)=>issue.entityId===candidateId&&issue.workspaceCode==="duplicateCandidate"&&all.findIndex(other=>other.id===issue.id)===index);
  const groupName=(id:string)=>data.position_groups.find(row=>row.group_id===id)?.group_position??data.application_destinations?.find(row=>row.group_id===id)?.group_position??formatRecruitmentId(id);
  const fields = [
    {label:t("Candidate name","ชื่อผู้สมัคร"),value:candidate.name,icon:<UserRound size={18}/>},
    {label:t("Nickname","ชื่อเล่น"),value:candidate.nickname,icon:<UserRound size={18}/>},
    {label:t("Candidate ID","รหัสผู้สมัคร"),value:formatRecruitmentId(candidate.candidate_id),icon:<Hash size={18}/>},
    {label:t("Created by","สร้างโดย"),value:capabilities.creator_label,icon:<UsersRound size={18}/>},
    {label:t("Phone","โทรศัพท์"),value:candidate.phone_no,icon:<Phone size={18}/>},
    {label:t("Email","อีเมล"),value:candidate.email,icon:<Mail size={18}/>},
    ...(candidate.home_site?[{label:t("Site","สถานที่"),value:candidate.home_site,icon:<Building2 size={18}/>}]:[]),
    {label:t("Source","แหล่งที่มา"),value:candidate.channel,icon:<ContactRound size={18}/>},
    {label:t("Referral","ผู้แนะนำ"),value:candidate.ref_name,icon:<UsersRound size={18}/>},
    {label:t("First contact","วันที่ติดต่อครั้งแรก"),value:candidate.first_contact_date?formatDate(candidate.first_contact_date,language):null,icon:<CalendarDays size={18}/>}
  ].map(row=>({...row,copyValue:row.value,value:row.value||"—"}));
  function moveTab(event:KeyboardEvent<HTMLButtonElement>,index:number) {
    let next=index;
    if(event.key==="ArrowRight") next=(index+1)%applications.length;
    else if(event.key==="ArrowLeft") next=(index+applications.length-1)%applications.length;
    else if(event.key==="Home") next=0;
    else if(event.key==="End") next=applications.length-1;
    else return;
    event.preventDefault();tabs.current[next]?.focus();onSelect(applications[next].application_id);
  }
  const applicationForm = intent ? (<form className="mt-4 grid gap-3 rounded-lg border border-[#C9D5E6] p-4" onSubmit={event=>{event.preventDefault();const destination=groupName(group);onAction(intent==="add"?"app_create_candidate_application_v1":"app_transfer_candidate_application_v1",{candidate_id:candidateId,group_id:group,...(intent==="transfer"&&selected?{application_id:selected.application_id,expected_version:selected.version,reason}:{})},intent==="transfer"?`${t("Reassign application","เปลี่ยนกลุ่มใบสมัคร")}: ${groupName(selected!.group_id)} → ${destination}; ${processLabel(currentLog?.recruitment_process??"Phone Screen",language)}; ${reason}`:`${t("Add application","เพิ่มใบสมัคร")}: ${destination}`);}}>
        <h4 className="font-semibold text-navy">{intent==="transfer"?t("Review reassignment","ตรวจสอบการเปลี่ยนกลุ่ม"):t("Add application","เพิ่มใบสมัคร")}</h4>
        {intent==="transfer"?<p className="text-sm text-slate">{groupName(selected!.group_id)} · {processLabel(currentLog?.recruitment_process??"Phone Screen",language)} · {currentLog?.result===null?t("Pending work is preserved","คงงานที่รอดำเนินการ"):t("Completed results and history are preserved","คงผลและประวัติเดิม")}</p>:null}
      <label className="grid gap-1 text-sm text-slate">{t("Search destination groups","ค้นหากลุ่มปลายทาง")}<input aria-label={t("Search destination groups","ค้นหากลุ่มปลายทาง")} value={destinationSearch} onChange={event=>setDestinationSearch(event.target.value)} placeholder={t("Search ID or position","ค้นหารหัสหรือชื่อตำแหน่ง")} className="min-h-11 max-w-full rounded-md border border-[#C9D5E6] bg-white p-2 text-sm text-navy"/></label>
      <label className="grid gap-1 text-sm text-slate">{t("Destination group","กลุ่มปลายทาง")}<select aria-label={t("Destination group","กลุ่มปลายทาง")} required value={group} onChange={event=>setGroup(event.target.value)} className="min-h-11 max-w-full rounded-md border border-[#C9D5E6] bg-white p-2 text-sm text-navy"><option value="">{t("Select group","เลือกกลุ่ม")}</option>{group&&!destinations.some(row=>row.group_id===group)?<option value={group}>{groupName(group)} · {formatRecruitmentId(group)}</option>:null}{destinations.map(row=><option key={row.group_id} value={row.group_id}>{`${row.group_position} · ${formatRecruitmentId(row.group_id)}${row.sites.length?` · ${row.sites.join(", ")}`:""}`}</option>)}</select></label>
      {destinationLoading?<LoadingSkeleton variant="lookup" label={<>{t("Loading groups","กำลังโหลดกลุ่ม")}</>}  />:null}{destinationError?<span role="alert" className="text-danger">{t("Could not load groups","โหลดกลุ่มไม่สำเร็จ")} <RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Candidate Profile Panel`} type="button" onClick={()=>setDestinationRetry(value=>value+1)}>{t("Retry","ลองอีกครั้ง")}</RetryIconButton></span>:null}{destinationHasMore?<button type="button" disabled={destinationLoading} onClick={async()=>{if(!client||!destinationCursor||destinationLoading)return;setDestinationLoading(true);setDestinationError(false);try{const page=await fetchApplicationDestinations(client,{search:destinationSearch,afterGroupId:destinationCursor,limit:50});setDestinationRows(rows=>[...rows,...page.items.filter(item=>!rows.some(row=>row.group_id===item.group_id))]);setDestinationCursor(page.next_cursor?.group_id??null);setDestinationHasMore(page.has_more);}catch{setDestinationError(true);}finally{setDestinationLoading(false);}}}>{t("Load more","โหลดเพิ่ม")}</button>:null}
        {!destinations.length?<p className="text-sm text-slate">{t("No eligible destination groups.","ไม่มีกลุ่มปลายทางที่เข้าเงื่อนไข")}</p>:null}
        {intent==="transfer"?<label className="grid gap-1 text-sm text-slate">{t("Reason","เหตุผล")}<textarea required value={reason} onChange={event=>setReason(event.target.value)} className="rounded-md border border-[#C9D5E6] p-2 text-sm text-navy"/></label>:null}
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!group||intent==="transfer"&&!reason.trim()}>{t("Review application","ตรวจสอบใบสมัคร")}</Button><Button type="button" variant="secondary" onClick={()=>setIntent(null)}>{t("Cancel","ยกเลิก")}</Button></div>
      </form>) : null;
  return <div className="grid min-w-0 gap-5">
    {profileWarnings.length?<div aria-label={t("Profile warnings","คำเตือนข้อมูลผู้สมัคร")}><InlineDataQualityIssues issues={profileWarnings} language={language}/></div>:null}
    <section className="rounded-xl border border-[#D7DEE8] bg-white p-4 sm:p-5" aria-label={t("Candidate profile","ข้อมูลผู้สมัคร")}>
      <div className="mb-3 flex items-center justify-between gap-3"><SectionHeading icon={<ContactRound size={19}/>} title={t("Candidate profile","ข้อมูลผู้สมัคร")}/>{capabilities.can_edit?<Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 text-primary" icon={<Pencil size={18} aria-hidden="true"/>} aria-label={t("Edit profile","แก้ไขข้อมูลผู้สมัคร")} title={t("Edit profile","แก้ไขข้อมูลผู้สมัคร")} onClick={onEdit}/>:null}</div>
      <DetailGrid workspace language={language} rows={fields}/>
      {candidate.candidate_folder_url?<a href={candidate.candidate_folder_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center break-all text-sm font-medium text-primary underline">{t("Open CV / candidate folder","เปิดประวัติ / แฟ้มผู้สมัคร")}</a>:null}
      <div className="mt-4"><h4 className="text-sm font-semibold text-navy">{t("Position interests","ตำแหน่งที่สนใจ")}</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate">{candidate.position_interests??"—"}</p></div>
    <section className="mt-4 border-t border-[#E7EDF5] pt-4" aria-label={t("Profile note","บันทึกผู้สมัคร")}>
      <h3 className="mb-3 text-base font-semibold text-navy">{t("Profile note","บันทึกผู้สมัคร")}</h3>
      {!capabilities.can_read_note?<p className="flex items-center gap-2 text-sm text-slate"><LockKeyhole size={16}/>{t("Private note — available to the creator, application PICs, and administrators.","บันทึกส่วนตัว สำหรับผู้สร้าง ผู้รับผิดชอบกลุ่มใบสมัคร และผู้ดูแลระบบ")}</p>:<>
        <p className="whitespace-pre-wrap break-words text-sm text-navy">{currentNote?.body||t("No profile note.","ยังไม่มีบันทึกผู้สมัคร")}</p>
        {currentNote?<p className="mt-2 text-xs text-slate">{t("Last edited by","แก้ไขล่าสุดโดย")} {capabilities.note_editor_label??data.profiles.find(row=>row.id===(currentNote.updated_by??currentNote.created_by))?.nickname??(currentNote.updated_by===data.profile?.id?data.profile?.nickname:t("Recruiter","ผู้สรรหา"))} · {formatDateTime(currentNote.updated_at??currentNote.created_at,language)}</p>:null}

      </>}
    </section>

    </section>

    <section className="min-w-0" aria-label={t("Applications","ใบสมัคร")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold text-navy">{t("Applications","ใบสมัคร")}</h3>{capabilities.can_add_application?<Button type="button" variant="secondary" size="icon-sm" className="min-h-11 min-w-11" aria-label={t("Add application","เพิ่มใบสมัคร")} title={t("Add application","เพิ่มใบสมัคร")} icon={<Plus size={20} aria-hidden="true"/>} onClick={()=>{setIntent("add");setGroup("");setReason("");}}/>:null}</div>
      {applications.length?<div role="tablist" aria-label={t("Candidate applications","ใบสมัครของผู้สมัคร")} className="flex max-w-full gap-1 overflow-x-auto relative z-10 -mb-px items-end pb-0">{applications.map((application,index)=><button key={application.application_id} ref={element=>{tabs.current[index]=element;}} type="button" role="tab" id={`application-tab-${application.application_id}`} aria-controls={`application-panel-${application.application_id}`} aria-selected={selected?.application_id===application.application_id} tabIndex={selected?selected.application_id===application.application_id?0:-1:index===0?0:-1} onKeyDown={event=>moveTab(event,index)} onClick={()=>onSelect(application.application_id)} className={`min-h-11 min-w-40 shrink-0 rounded-t-lg border px-3 py-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selected?.application_id===application.application_id?"border-primary border-b-white bg-white text-navy":"border-[#E4E9F2] bg-[#F8FAFD] text-slate"}`}><span className="block max-w-60 whitespace-normal break-words font-semibold">{groupName(application.group_id)}</span><span className="mt-1 block text-xs">{formatRecruitmentId(application.group_id)} · {application.state==="active"?t("Active","ดำเนินการ"):t("Closed","ปิดแล้ว")}</span></button>)}</div>:<p className="py-3 text-sm text-slate">{t("No applications are available. This profile may be unmatched, or its journeys may be outside your access.","ไม่มีใบสมัครที่เปิดดูได้ อาจยังไม่จับคู่หรือใบสมัครอยู่นอกสิทธิ์ของคุณ")}</p>}
      {selected?<div role="tabpanel" id={`application-panel-${selected.application_id}`} aria-labelledby={`application-tab-${selected.application_id}`} className="grid min-w-0 gap-4 rounded-b-xl rounded-tr-xl border border-primary bg-white p-3 sm:p-4">
        <ApplicationDetailsContext.Provider value={<>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate">{t("Opened","วันที่เริ่มใบสมัคร")}: {formatDateTime(selected!.created_at,language)}{selected?.closed_at?` · ${t("Closed","ปิดแล้ว")}: ${formatDateTime(selected.closed_at,language)} · ${selected.closure_reason??""}`:""}</p>
          {canTransfer?<Button type="button" variant="secondary" onClick={()=>{setIntent("transfer");setGroup("");setReason("");}}>{t("Reassign application","เปลี่ยนกลุ่มใบสมัคร")}</Button>:null}</div>
                  <details className="border-t border-[#E4E9F2] pt-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-navy">{t("Assignment history","ประวัติการเปลี่ยนกลุ่ม")}</summary>{(data.candidate_application_assignments??[]).filter(row=>row.application_id===selected.application_id).sort((a,b)=>a.started_at.localeCompare(b.started_at)).map(row=><p key={row.assignment_id} className="mt-2 break-words text-sm text-slate">{row.from_group_id?`${formatRecruitmentId(row.from_group_id)} → `:""}{formatRecruitmentId(row.group_id)} · {formatDateTime(row.started_at,language)}{row.reason?` · ${row.reason}`:""}{row.attribution_inferred?` · ${t("Historical attribution inferred","อ้างอิงกลุ่มย้อนหลัง")}`:""}</p>)}</details>
        </>}>
          {children}
        </ApplicationDetailsContext.Provider>
        {selectedLogs.map(log=>{const entry=data.candidate_application_assignments?.find(row=>row.assignment_id===log.entry_assignment_id),outcome=data.candidate_application_assignments?.find(row=>row.assignment_id===log.outcome_assignment_id);return entry&&(entry.group_id!==selected.group_id||outcome&&outcome.group_id!==entry.group_id)?<p key={log.log_id} className="text-xs text-slate">{processLabel(log.recruitment_process,language)} · {t("Began in","เริ่มที่")}: {formatRecruitmentId(entry.group_id)}{outcome?` · ${t("Outcome recorded in","บันทึกผลที่")}: ${formatRecruitmentId(outcome.group_id)}`:` · ${t("Pending began before reassignment","เริ่มก่อนเปลี่ยนกลุ่ม")}`}</p>:null;})}
        {intent==="transfer"?applicationForm:null}

      </div>:applications.length?<p className="py-4 text-sm text-slate">{t("Select an application tab to view its journey and actions.","เลือกแท็บใบสมัครเพื่อดูเส้นทางและการดำเนินการ")}</p>:null}

      {intent==="add"?applicationForm:null}
    </section>
  </div>;
}
