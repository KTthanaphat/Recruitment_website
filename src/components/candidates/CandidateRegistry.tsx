"use client";
import {fetchMatchingRecordIds} from "@/lib/records-selection";
import {useEffect,useMemo,useRef,useState} from "react";
import {useSearchParams} from "next/navigation";
import {LockKeyhole} from "lucide-react";
import type {SupabaseClient} from "@supabase/supabase-js";
import {RECORD_PAGE_SIZE,RecordPagination,RecordFilterPanel,RecordCreateButton,RecordCell,RecordPriorityIndicator,useRecordsCardLayout,useRecordSelection,RecordSelectionCheckbox,RecordSelectionProgress} from "@/components/ui/RecordsControls";
import {RecordSortTriangles,TableToolbar} from "@/components/ui/TableControls";
import {BulkActionToolbar} from "@/components/ui/Workflow";
import {RetryIconButton} from "@/components/ui/RetryIconButton";
import {TableSkeletonRows,LoadingSkeleton,RefreshIndicator} from "@/components/ui/LoadingSkeleton";
import {Panel} from "@/components/ui/Panel";
import {formatCandidateName,formatDate,formatRecruitmentId} from "@/lib/format";
import {useRecruitmentList} from "@/lib/recruitment-list";
import {updateWorkspaceUrlState} from "@/lib/workspace-url-state";
import {candidateColumnFilterError,emptyCandidateColumnFilters,fetchSelectedCandidateRecords,type CandidateColumnFilters,type CandidateRegistryItem} from "@/lib/candidate-registry-records";
import {exportCandidateWorkbook} from "@/lib/candidate-full-export";
import type {DashboardData,Language} from "@/types/recruitment";

export function CandidateRegistry({data,client,language,canWrite,site,owner,onNew,onOpen}:{data:DashboardData;client:SupabaseClient|null;language:Language;canWrite:boolean;site:string;owner:string;onNew:()=>void;onOpen:(id:string)=>void}) {
 const params=useSearchParams(),mobile=useRecordsCardLayout();
 const [direction,setDirection]=useState<"asc"|"desc">(params.get("candDir")==="asc"?"asc":"desc");
 useEffect(()=>setDirection(params.get("candDir")==="asc"?"asc":"desc"),[params]);
 const [scope,setScope]=useState("all"),[advanced,setAdvanced]=useState(false);
 const [draft,setDraft]=useState<CandidateColumnFilters>({...emptyCandidateColumnFilters});
 const [applied,setApplied]=useState<CandidateColumnFilters>({...emptyCandidateColumnFilters});
 const invalid=candidateColumnFilterError(draft);
 useEffect(()=>{setDraft(applied);},[advanced,applied]);
 const t=(en:string,th:string)=>language==="th"?th:en;
 const accessScope=[process.env.NEXT_PUBLIC_SUPABASE_URL??"local",data.profile?.id??"signed-out",data.profile?.role??"",data.profile?.site??"",data.profile?.updated_at??""].join(":");
 const filters=useMemo(()=>({scope,site,owner,...applied}),[scope,site,owner,applied]);
 const list=useRecruitmentList<CandidateRegistryItem>({client:data.profile?client:null,accessScope,entity:"candidate_registry",initialPageSize:RECORD_PAGE_SIZE,filters,sort:"updated_at",direction});
 const identity=JSON.stringify([accessScope,filters,list.search,direction]);
 const selection=useRecordSelection(identity);
 const clearFeedback=selection.clearFeedback;
 useEffect(()=>clearFeedback(),[list.page,clearFeedback]);
 const allVisible=selection.ids.length>0&&selection.ids.length===list.totalCount&&list.items.every(row=>selection.ids.includes(row.candidate_id));
 const someVisible=selection.ids.length>0;
 const captureAll=async()=>{const succeeded=await selection.capture((signal,onProgress)=>client?fetchMatchingRecordIds(client,{accessScope,entity:"candidate_registry",search:list.search.trim(),filters,signal},onProgress):Promise.resolve([]),list.items.map(row=>row.candidate_id));if(succeeded)list.retryCount();};
 const exportController=useRef<AbortController|null>(null),activeIdentity=useRef(identity);activeIdentity.current=identity;
 const [exportBusy,setExportBusy]=useState(false),[exportMessage,setExportMessage]=useState(""),[exportError,setExportError]=useState("");
 useEffect(()=>{exportController.current?.abort();setExportBusy(false);setExportMessage("");setExportError("");return()=>exportController.current?.abort();},[identity]);
 async function exportSelected(){
  if(!client||exportBusy||selection.captureBusy||!selection.ids.length)return;
  const controller=new AbortController(),startedIdentity=identity;exportController.current=controller;setExportBusy(true);setExportError("");setExportMessage("");
  try{
   const rows=await fetchSelectedCandidateRecords(client,accessScope,selection.ids,{site,owner},controller.signal);
   if(controller.signal.aborted||activeIdentity.current!==startedIdentity)return;
   await exportCandidateWorkbook(client, accessScope, rows, language, controller.signal, (done,total)=>{if(activeIdentity.current===startedIdentity)setExportMessage(t("Preparing candidate history "+done+" / "+total,"กำลังเตรียมประวัติผู้สมัคร "+done+" / "+total));});
   setExportMessage(t("Exported "+rows.length+" of "+selection.ids.length+" selected candidates.","ส่งออกผู้สมัครที่เลือก "+rows.length+" จาก "+selection.ids.length+" รายการ"));
  }catch(error){if(!controller.signal.aborted&&activeIdentity.current===startedIdentity)setExportError(t("Could not export selected candidates. Please retry.","ส่งออกผู้สมัครไม่สำเร็จ โปรดลองอีกครั้ง"));}
  finally{if(activeIdentity.current===startedIdentity)setExportBusy(false);}
 }
 function privateValue(){return <span aria-label={t("Private","ข้อมูลส่วนตัว")} className="inline-flex items-center gap-2 text-slate"><LockKeyhole size={14}/><span aria-hidden="true" className="select-none blur-sm">••••••••</span></span>;}
 const open=(row:CandidateRegistryItem)=><button type="button" className="min-h-11 max-w-full text-left font-semibold text-navy hover:text-primary focus-visible:ring-2 focus-visible:ring-primary" onClick={()=>onOpen(row.candidate_id)}><span className="block md:truncate">{row.masked?privateValue():formatCandidateName({name:row.name,nickname:row.nickname})}</span><span className="block text-xs font-normal text-slate">{formatRecruitmentId(row.candidate_id)}</span></button>;
 const scopeControls=<div className="records-scope-control records-scope-strip" role="group" aria-label={t("Candidate registry filter","ตัวกรองทะเบียนผู้สมัคร")}>{[["all",t("All","ทั้งหมด")],["pool",t("Talent pool","ฐานผู้สมัคร")],["active",t("Active applications","ใบสมัครที่ดำเนินการ")],["history",t("History","ประวัติ")]].map(([value,label])=><button key={value} type="button" aria-pressed={scope===value} className={"min-h-11 rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:ring-primary "+(scope===value?"border-primary bg-primary/10 text-navy":"border-[#D7DEE8] text-slate")} onClick={()=>setScope(value)}>{label}</button>)}</div>;
 const sortControl=<button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded text-left font-medium text-slate focus-visible:ring-2 focus-visible:ring-primary" aria-label={t("Sort Updated","เรียงตามอัปเดต")} onClick={()=>{const next=direction==="desc"?"asc":"desc";setDirection(next);updateWorkspaceUrlState({candDir:next});}}>{t("Updated","อัปเดต")}<RecordSortTriangles direction={direction}/></button>;
 const date=(row:CandidateRegistryItem)=><span title={row.masked?t("Saved date is shown to protect private update activity.","แสดงวันที่บันทึกเพื่อปกป้องกิจกรรมการอัปเดตส่วนตัว"):undefined}>{formatDate(row.masked?row.created_at:row.updated_at,language)}</span>;
 const textFields=[["candidateText",t("Candidate","ผู้สมัคร")],["contactText",t("Contact","ติดต่อ")],["candidateSite",t("Site","สถานที่")],["creatorText",t("Created by","สร้างโดย")],["sourceText",t("Source","แหล่งที่มา")],["interestsText",t("Interests","ตำแหน่งที่สนใจ")]] as const;
 const input=(key:keyof CandidateColumnFilters,label:string,type="text")=><input type={type} aria-label={label} value={draft[key]} min={type==="number"?0:undefined} max={type==="number"?2147483647:undefined} step={type==="number"?1:undefined} aria-invalid={invalid&&(key.startsWith("active")||key.startsWith("updated"))?true:undefined} aria-describedby={invalid?"candidate-filter-error":undefined} onChange={event=>setDraft(current=>({...current,[key]:event.target.value}))} className="min-h-8 min-w-0 w-full rounded-lg border border-[#C9D5E6] bg-white px-2 py-1 text-xs font-medium normal-case text-navy placeholder:text-cool focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"/>;
 const field=(key:keyof CandidateColumnFilters,label:string)=>input(key,t("Filter ","กรอง ")+label);
 const countFields=<div className="records-filter-range"><label className="grid gap-1 text-xs font-normal">{t("Minimum","ขั้นต่ำ")}{input("activeMin",t("Minimum active applications","จำนวนใบสมัครขั้นต่ำ"),"number")}</label><label className="grid gap-1 text-xs font-normal">{t("Maximum","สูงสุด")}{input("activeMax",t("Maximum active applications","จำนวนใบสมัครสูงสุด"),"number")}</label></div>;
 const dateFields=<div className="records-filter-range"><label className="grid gap-1 text-xs font-normal">{t("From","ตั้งแต่")}{input("updatedFrom",t("Updated from","อัปเดตตั้งแต่"),"date")}</label><label className="grid gap-1 text-xs font-normal">{t("To","ถึง")}{input("updatedTo",t("Updated to","อัปเดตถึง"),"date")}</label></div>;
 const selectRow=(row:CandidateRegistryItem)=><RecordSelectionCheckbox label={t("Select candidate ","เลือกผู้สมัคร ")+formatRecruitmentId(row.candidate_id)} checked={selection.ids.includes(row.candidate_id)} onChange={checked=>selection.toggle(row.candidate_id,checked)} disabled={list.loading||selection.captureBusy}/>;
 return <Panel className="records-surface records-candidates">
  {scopeControls}<RecordSelectionProgress selection={selection} language={language}/>
  {list.refreshing?<RefreshIndicator language={language}/>:null}
  <TableToolbar records advancedFiltersPanelId="records-candidate-filters" filtersActive={Object.values(applied).some(Boolean)} language={language} advancedFiltersOpen={advanced} onAdvancedFiltersToggle={()=>setAdvanced(value=>!value)} onSearch={list.setSearch} searchValue={list.search} searchLabel={t("Search name, ID, contact or position interests","ค้นหาชื่อ รหัส ช่องทางติดต่อ หรือตำแหน่งที่สนใจ")} resultCount={list.totalCount} totalCount={list.totalCount} trailingActions={canWrite?<RecordCreateButton label={t("New Candidate","เพิ่มผู้สมัคร")} onClick={onNew}/>:null}/>

  {mobile?<div className="mb-2 flex justify-end text-xs">{sortControl}</div>:null}
  <RecordFilterPanel id="records-candidate-filters" open={advanced} language={language} onClose={()=>setAdvanced(false)} onApply={()=>{if(!invalid)setApplied(Object.fromEntries(Object.entries(draft).map(([key,value])=>[key,value.trim()])) as CandidateColumnFilters);}} applyDisabled={Boolean(invalid)} onClear={()=>{setDraft({...emptyCandidateColumnFilters});setApplied({...emptyCandidateColumnFilters});}}>
    {invalid?<p id="candidate-filter-error" role="alert" className="text-sm text-scarlet">{invalid==="count"?t("Use whole counts from 0, with minimum no greater than maximum.","ระบุจำนวนเต็มตั้งแต่ 0 โดยขั้นต่ำต้องไม่เกินสูงสุด"):t("Use valid dates, with From no later than To.","ระบุวันที่ที่ถูกต้อง โดยวันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด")}</p>:null}
    <div className="col-span-full text-xs font-semibold text-navy">{t("Candidate details","ข้อมูลผู้สมัคร")}</div>
    {textFields.map(([key,label])=><label key={key} className="records-filter-field text-xs text-slate"><span className="font-medium">{label}</span>{field(key,label)}</label>)}
    <div className="col-span-full border-t border-[#E4E9F2] pt-3 text-xs font-semibold text-navy">{t("Application activity","กิจกรรมใบสมัคร")}</div>
    <div className="records-filter-field text-xs text-slate "><span className="font-medium">{t("Active applications","ใบสมัครที่ดำเนินการ")}</span>{countFields}</div>
    <div className="records-filter-field text-xs text-slate "><span className="font-medium">{t("Updated","อัปเดต")}</span>{dateFields}</div>
  </RecordFilterPanel>
  {list.items.some(row=>row.masked)?<p className="mb-3 text-xs text-slate">{t("Private unmatched profiles are discoverable across sites. Search uses only their visible ID, interests, and creator.","ค้นพบข้อมูลที่ยังไม่จับคู่จากทุกสถานที่ ค้นหาได้เฉพาะรหัส ตำแหน่งที่สนใจ และผู้สร้างที่แสดง")}</p>:null}
  {list.error?<div className="my-3 flex items-center gap-3 text-sm text-scarlet" role="alert"><span>{t("Could not load candidates.","โหลดข้อมูลผู้สมัครไม่สำเร็จ")}</span><RetryIconButton type="button" onClick={list.retry} loading={list.loading}>{t("Retry","ลองอีกครั้ง")}</RetryIconButton></div>:null}
  {list.initialLoading?<LoadingSkeleton variant="cards" count={3} label={t("Loading candidates…","กำลังโหลดข้อมูลผู้สมัคร…")} className="py-4 text-sm text-slate md:hidden"/>:null}
  <div className="records-mobile-cards grid gap-4 md:hidden">{list.items.map(row=><article key={row.candidate_id} className={"min-w-0 rounded-lg border border-[#E4E9F2] bg-white p-3 "+(selection.flashing(row.candidate_id)?"records-selection-flash":"")}><div className="flex items-start gap-2"><label className="record-selection-target">{selectRow(row)}</label><div className="min-w-0 flex-1">{open(row)}</div><RecordPriorityIndicator priority={!row.masked&&row.has_priority_requisition} language={language} candidate/></div><dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm"><dt className="text-slate">{t("Created by","สร้างโดย")}</dt><dd className="break-words">{row.creator_label??"—"}</dd><dt className="text-slate">{t("Interests","ตำแหน่งที่สนใจ")}</dt><dd className="break-words">{row.position_interests??"—"}</dd><dt className="text-slate">{t("Contact","ติดต่อ")}</dt><dd className="break-all">{row.masked?privateValue():[row.phone_no,row.email].filter(Boolean).join(" · ")||"—"}</dd>{!row.masked?<><dt className="text-slate">{t("Site","สถานที่")}</dt><dd>{row.home_site??"—"}</dd><dt className="text-slate">{t("Source","แหล่งที่มา")}</dt><dd>{row.channel??"—"}</dd><dt className="text-slate">{t("Active applications","ใบสมัครที่ดำเนินการ")}</dt><dd>{row.active_application_count??0}</dd></>:null}<dt className="text-slate">{t("Updated","อัปเดต")}</dt><dd>{date(row)}</dd></dl></article>)}</div>
  <div className="table-scroll hidden md:block"><table className="w-full text-left text-sm"><thead className="bg-lightgray text-slate"><tr><th scope="col" className="records-selection-cell"><RecordSelectionCheckbox label={t("Select all matching candidates","เลือกผู้สมัครทั้งหมดที่ตรงกัน")} checked={allVisible} mixed={someVisible&&!allVisible} onChange={checked=>checked?captureAll():selection.clear()} disabled={list.loading||selection.captureBusy||list.criteriaPending||list.countLoading||list.countError||list.totalCount===null||list.totalCount===0||Boolean(invalid)||JSON.stringify(Object.fromEntries(Object.entries(draft).map(([key,value])=>[key,value.trim()])))!==JSON.stringify(applied)}/></th><th className="records-priority-column" scope="col">{t("Priority","ความสำคัญ")}</th>{textFields.map(([key,label])=><th key={key} scope="col">{label}</th>)}<th scope="col">{t("Active applications","ใบสมัครที่ดำเนินการ")}</th><th scope="col" aria-sort={direction==="asc"?"ascending":"descending"}>{sortControl}</th></tr></thead><tbody aria-busy={list.loading}>
  {list.initialLoading?<TableSkeletonRows columns={[{kind:"action"},{kind:"action"},{},{},{},{},{},{},{kind:"number"},{kind:"date"}]} language={language}/>:null}
  {list.items.map(row=><tr key={row.candidate_id} className={selection.flashing(row.candidate_id)?"records-selection-flash":""}>
   <td className="records-selection-cell">{selectRow(row)}</td><td className="records-priority-column"><RecordCell><RecordPriorityIndicator priority={!row.masked&&row.has_priority_requisition} language={language} candidate/></RecordCell></td><td><RecordCell>{open(row)}</RecordCell></td><td><RecordCell>{row.masked?privateValue():[row.phone_no,row.email].filter(Boolean).join(" · ")||"—"}</RecordCell></td><td><RecordCell>{row.masked?null:row.home_site??"—"}</RecordCell></td><td><RecordCell>{row.creator_label??"—"}</RecordCell></td><td><RecordCell>{row.masked?null:row.channel??"—"}</RecordCell></td><td><RecordCell>{row.position_interests??"—"}</RecordCell></td><td><RecordCell>{row.masked?"—":row.active_application_count??0}</RecordCell></td><td><RecordCell>{date(row)}</RecordCell></td>
  </tr>)}</tbody></table></div>
  {!list.initialLoading&&!list.error&&!list.items.length?<p className="py-6 text-sm text-slate">{t("No matching candidates.","ไม่พบผู้สมัครที่ตรงกับการค้นหา")}</p>:null}
  <RecordPagination pageSize={list.pageSize} onPageSizeChange={list.setPageSize} language={language} page={list.page} totalCount={list.totalCount} countLoading={list.countLoading} countError={list.countError} loading={list.loading||selection.captureBusy} canPrevious={list.canPrevious} canNext={list.canNext} onPrevious={list.goPrevious} onNext={list.goNext} onRetryCount={list.retryCount}/>
  <BulkActionToolbar entityLabel={t("candidates","ผู้สมัคร")} language={language} selectedCount={selection.ids.length} onClear={selection.clear} onExport={exportSelected} exportBusy={exportBusy||selection.captureBusy} selectionNote={t("Export authorized candidate and process history or clear the selection.","ส่งออกประวัติผู้สมัครและกระบวนการที่มีสิทธิ์เข้าถึงหรือล้างการเลือก")}/>
  {exportMessage?<p role="status" className="mt-2 text-xs text-slate">{exportMessage}</p>:null}{exportError?<p role="alert" className="mt-2 text-xs text-scarlet">{exportError}</p>:null}
 </Panel>;
}
