"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Info, Loader2, Mail, Phone, Search, UserRoundSearch, X } from "lucide-react";
import Image from "next/image";
import lookupArtwork from "../../../public/images/candidate-lookup-detective-v5-900.webp";
import { createPortal } from "react-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language } from "@/types/recruitment";
import { Button } from "@/components/ui/Button";
import { useOverlayScrollLock } from "@/components/ui/overlay-scroll-lock";

type Application = { application_id:string; group_id:string; group_position:string; stage:string; state:string; result:number|null };
type Page<T> = { items:T[]; next_cursor:string|null };
type Match = { candidate_id:string; name:string; nickname:string|null; phone_no:string|null; email:string|null; applications:Page<Application> };
type State = { open:boolean; activeOnly:boolean; input:string; submitted:string; page:Page<Match>; status:"idle"|"loading"|"ready"|"error"; error:string };
const LOOKUP_DEBOUNCE_MS=300;
const empty:State = {open:true,activeOnly:false,input:"",submitted:"",page:{items:[],next_cursor:null},status:"idle",error:""};
let currentScope="", state=empty, revision=0;
const listeners=new Set<()=>void>();
const emit=(patch:Partial<State>)=>{state={...state,...patch};listeners.forEach(fn=>fn());};
export function clearCandidateLookup(resetOpen=false){revision++;state={...empty,open:resetOpen?true:state.open};listeners.forEach(fn=>fn());}
export function normalizeLookupContact(input:string){
 const text=input.trim();
 if(text.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)&&text.length<=320?text.toLowerCase():null;
 if(!/^\+?[0-9 () .-]+$/.test(text))return null;
 const digits=text.replace(/\D/g,"");
 if(text.startsWith("+"))return /^66\d{4,9}$/.test(digits)?`0${digits.slice(2)}`:null;
 if(/^66\d{9}$/.test(digits))return `0${digits.slice(2)}`;
 return /^\d{4,10}$/.test(digits)?digits:null;
}
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};

export function CandidateLookup({client,scope,language,onOpen}:{client:SupabaseClient;scope:string;language:Language;onOpen:(id:string,applicationId?:string)=>void}){
 const view=useSyncExternalStore(subscribe,()=>currentScope===scope?state:empty,()=>empty);
 const t=(en:string,th:string)=>language==="th"?th:en;
 const titleId=useId(),introId=useId(),inputId=useId(),hintId=useId(),launcher=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),inputRef=useRef<HTMLInputElement>(null);
 const [phone,setPhone]=useState(false),[appBusy,setAppBusy]=useState<string|null>(null),[composing,setComposing]=useState(false);
 const showResults=view.status!=="idle"||view.page.items.length>0;
 const phoneModal=view.open&&phone&&showResults;
 useOverlayScrollLock(phoneModal);
 useEffect(()=>{if(currentScope!==scope){currentScope=scope;clearCandidateLookup(true);setComposing(false);}const query=matchMedia("(max-width: 639px)");const update=()=>setPhone(query.matches);update();query.addEventListener("change",update);return()=>query.removeEventListener("change",update);},[scope]);
 useEffect(()=>{const {data}=client.auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT")clearCandidateLookup(true);});const invalidate=()=>clearCandidateLookup();window.addEventListener("recruitment:lookup-invalidate",invalidate);return()=>{data.subscription.unsubscribe();window.removeEventListener("recruitment:lookup-invalidate",invalidate);};},[client]);

 const close=()=>{setComposing(false);emit({open:false});window.setTimeout(()=>launcher.current?.focus(),0);};
 const search=useCallback(async(more=false)=>{
  if(state.status==="loading")return;
  const contact=more?view.submitted:normalizeLookupContact(view.input);
  if(!contact){emit({status:"error",error:"input"});return;}
  const cursor=more?view.page.next_cursor:null, prior=more?view.page.items:[];
  const token=++revision;emit({status:"loading",error:"",submitted:contact,...(!more?{page:{items:[],next_cursor:null}}:{})});
  try{const {data,error}=await client.rpc("app_candidate_contact_lookup_v2",{p_contact:contact,p_after_id:cursor,p_limit:10,p_active_only:view.activeOnly});if(token!==revision||currentScope!==scope)return;if(error)throw error;if(!data||!Array.isArray(data.items))throw new Error("Invalid lookup response");emit({page:{items:[...prior,...data.items],next_cursor:data.next_cursor},status:"ready"});}
  catch{if(token===revision&&currentScope===scope)emit({status:"error",error:"request"});}
 },[client,scope,view]);
 useEffect(()=>{
  if(!view.open||composing||view.status!=="idle"||!normalizeLookupContact(view.input))return;
  const scheduledRevision=revision;
  const timer=window.setTimeout(()=>{
   if(revision===scheduledRevision&&currentScope===scope&&state.open&&state.status==="idle")void search();
  },LOOKUP_DEBOUNCE_MS);
  return()=>window.clearTimeout(timer);
 },[view.open,view.input,view.activeOnly,view.status,scope,composing,search]);
 async function moreApplications(match:Match){
  if(appBusy||!match.applications.next_cursor)return;const token=revision;setAppBusy(match.candidate_id);
  try{const {data,error}=await client.rpc("app_candidate_lookup_applications_v2",{p_candidate_id:match.candidate_id,p_after_id:match.applications.next_cursor,p_limit:5,p_active_only:view.activeOnly});if(token!==revision||currentScope!==scope)return;if(error||!data||!Array.isArray(data.items))throw error;emit({page:{...state.page,items:state.page.items.map(row=>row.candidate_id===match.candidate_id?{...row,applications:{items:[...row.applications.items,...data.items],next_cursor:data.next_cursor}}:row)},error:""});}
  catch{if(token===revision)emit({error:"request"});}finally{setAppBusy(null);}
 }
 const openProfile=(id:string,app?:string)=>{emit({open:false});onOpen(id,app);};
 const stateLabel=(value:string)=>(({active:t("Active","กำลังดำเนินการ"),closed:t("Closed","สิ้นสุดแล้ว")} as Record<string,string>)[value]??value);
 const stageLabel=(value:string)=>(({"Not started":t("Not started","ยังไม่เริ่ม"),"Phone Screen":t("Phone Screen","คัดกรองโทรศัพท์"),"HR Interview":t("HR Interview","สัมภาษณ์ HR"),"Line Interview":t("Line Interview","สัมภาษณ์ต้นสังกัด"),"Reference Check":t("Reference Check","ตรวจสอบบุคคลอ้างอิง"),Test:t("Test","ทดสอบ"),Offer:t("Offer","เสนอจ้าง")} as Record<string,string>)[value]??value);
 return <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-3 z-[52] sm:bottom-5 sm:right-5" data-candidate-lookup>
  {!view.open?<Button ref={launcher} type="button" className="min-h-11 rounded-xl" icon={<UserRoundSearch size={18} aria-hidden="true"/>} onClick={()=>{emit({open:true});window.setTimeout(()=>inputRef.current?.focus(),0);}} aria-expanded={false}>{t("Candidate lookup","ค้นหาผู้สมัคร")}</Button>:null}
  {view.open?<>{phoneModal?<div className="fixed inset-0 bg-navy/35 sm:hidden" onClick={close} aria-hidden="true"/>:null}
   <div ref={panel} role="dialog" aria-modal={phoneModal?true:undefined} aria-labelledby={titleId} aria-describedby={introId} className={`fixed inset-x-2 ${phoneModal?"bottom-[calc(0.5rem+env(safe-area-inset-bottom))] max-h-[calc(100dvh-1rem)]":"bottom-[calc(5rem+env(safe-area-inset-bottom))] max-h-[calc(100dvh-6rem)]"} flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#B7D2FF] bg-white text-navy shadow-[0_2px_10px_rgba(20,110,250,0.14)] sm:relative sm:inset-auto sm:max-h-[min(80dvh,42rem)] sm:w-[22.5rem] sm:max-w-[calc(100vw-2.5rem)]`} onKeyDown={event=>{
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();}
    if(phoneModal&&event.key==="Tab"){const controls=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]')??[]);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
   }}>
    {!showResults?<LookupBackdrop wave className="pointer-events-none absolute inset-x-0 bottom-0 h-8 w-full"/>:null}
    <header className="relative z-10 grid shrink-0 grid-cols-2 gap-2 px-3 pt-2">
     <div className="relative min-h-[4.5rem] min-w-0 self-stretch" data-lookup-illustration>
      <LookupBackdrop className="pointer-events-none absolute inset-x-0 bottom-0 h-[calc(100%-0.5rem)] w-full"/>
      <Image src={lookupArtwork} fill priority unoptimized alt="" aria-hidden="true" className="object-contain object-left-bottom"/>
      <svg aria-hidden="true" focusable="false" viewBox="0 0 30 30" className="absolute right-0 top-1 h-5 w-5 text-[#146EFA]"><path d="M8 3 5 12M22 8l-8 7M27 23h-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>
     </div>
     <div className="grid min-w-0 content-start gap-0.5 pl-2" data-lookup-heading>
      <div className="flex justify-end"><button type="button" className="grid h-11 w-11 place-items-center rounded-lg text-slate hover:bg-blue-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-7 sm:w-7" onClick={close} aria-label={t("Close lookup","ปิดหน้าต่างค้นหา")}><X size={19}/></button></div>
      <h2 id={titleId} className="text-base font-semibold leading-snug text-navy">{t("Candidate lookup","ค้นหาผู้สมัคร")}</h2>
      <p id={introId} className="text-[11px] leading-4 text-slate">{t("Search by phone or email.","ค้นหาด้วยเบอร์โทรหรืออีเมล")}</p>
     </div>
    </header>
    <form className="relative z-10 mt-2 flex shrink-0 gap-1.5 px-3" onSubmit={event=>{event.preventDefault();if(!composing&&state.status!=="loading")void search();}}>
     <label htmlFor={inputId} className="sr-only">{t("Find by phone digits or full email","ค้นหาด้วยเบอร์โทรบางส่วนหรืออีเมลแบบเต็ม")}</label>
     <div className="relative min-w-0 flex-1">
      <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate">{view.status==="loading"?<Loader2 size={18} className="motion-safe:animate-spin"/>:<Search size={18}/>}</span>
      <input ref={inputRef} id={inputId} type="text" autoComplete="off" aria-busy={view.status==="loading"} aria-invalid={view.error==="input"?true:undefined} aria-describedby={hintId} enterKeyHint="search" maxLength={320} placeholder={t("4+ digits / email","4+ หลัก / อีเมล")} value={view.input} onCompositionStart={()=>{revision++;setComposing(true);emit({status:"idle",error:"",page:{items:[],next_cursor:null}});}} onCompositionEnd={()=>setComposing(false)} onKeyDown={event=>{if(event.key==="Enter"&&event.nativeEvent.isComposing)event.preventDefault();}} onChange={event=>{revision++;emit({input:event.target.value,status:"idle",error:"",page:{items:[],next_cursor:null}});}} className="h-11 w-full rounded-xl border border-[#93B9FF] bg-white py-2 pl-9 pr-9 text-sm text-navy placeholder:text-slate outline-none focus:ring-2 focus:ring-primary/25 sm:h-10"/>
      {view.input?<button type="button" className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-xl text-slate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t("Clear search","ล้างการค้นหา")} onClick={()=>{revision++;emit({input:"",submitted:"",page:{items:[],next_cursor:null},status:"idle",error:""});inputRef.current?.focus();}}><X size={15}/></button>:null}
     </div>

     <span id={hintId} className="sr-only">{t("Search updates after you pause typing. Press Enter to search now.","ค้นหาอัตโนมัติเมื่อหยุดพิมพ์ หรือกด Enter เพื่อค้นหาทันที")}</span>
    </form>
    <div className="relative z-10 mx-3 mt-2 flex shrink-0 items-center justify-between gap-2 border-t border-[#E1E9FA] pb-2 pt-1">
     <div className="flex min-w-0 items-center gap-1"><span className="text-xs font-semibold text-slate">{t("Active candidates only","เฉพาะที่ดำเนินการ")}</span><LookupHelp language={language}/></div>
     <label className="relative inline-flex shrink-0 cursor-pointer">
      <input type="checkbox" role="switch" checked={view.activeOnly} aria-checked={view.activeOnly} aria-label={t("Active candidates only","เฉพาะผู้สมัครที่กำลังดำเนินการ")} className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0" onChange={event=>{revision++;emit({activeOnly:event.target.checked,page:{items:[],next_cursor:null},status:"idle",error:""});}}/>
      <span aria-hidden="true" className="pointer-events-none flex min-h-11 min-w-[5.5rem] sm:min-h-9 items-center justify-center gap-1.5 rounded-full border border-[#C9DAFF] bg-[#EAF0FF] px-2 peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-primary/50 peer-focus-visible:ring-offset-2">
       <span className={`relative inline-flex h-6 w-10 shrink-0 rounded-full ${view.activeOnly?"bg-[#146EFA]":"bg-[#AABFE3]"}`}><span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${view.activeOnly?"translate-x-4":"translate-x-0"}`}/></span>
       <span className="text-xs font-semibold text-[#0B51DC]">{view.activeOnly?t("ON","เปิด"):t("OFF","ปิด")}</span>
      </span>
     </label>
    </div>
    {showResults?<>
    <div className="min-h-0 overflow-y-auto overscroll-contain px-3 pb-3" aria-busy={view.status==="loading"}>
     <div role="status" className="text-sm text-slate">{view.status==="loading"?t("Searching…","กำลังค้นหา…"):view.status==="ready"&&!view.page.items.length?t("No matching candidate found.","ไม่พบผู้สมัครที่ตรงกัน"):""}</div>
     {view.error?<div role="alert" className="mb-3 rounded-lg bg-white px-3 py-2 text-sm text-danger">{view.error==="input"?t("Enter at least 4 consecutive phone digits, or a valid full email.","ระบุเบอร์โทรอย่างน้อย 4 หลักติดต่อกัน หรืออีเมลแบบเต็มที่ถูกต้อง"):t("Could not load results. Press Enter or Retry to try again.","โหลดข้อมูลไม่สำเร็จ กด Enter หรือลองอีกครั้ง")}{view.error==="request"?<Button type="button" variant="ghost" size="sm" className="ml-1 min-h-11 sm:min-h-9" onClick={()=>void search()}>{t("Retry","ลองอีกครั้ง")}</Button>:null}</div>:null}
     <div className="grid gap-2">{view.page.items.map(match=><article key={match.candidate_id} className="min-w-0 rounded-xl border border-[#E4E9F2] bg-white p-2.5"><div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-semibold text-primary" aria-hidden="true">{match.name.trim().slice(0,2)}</span><div className="min-w-0"><h3 className="break-words text-sm font-semibold text-navy">{match.name}</h3><p className="text-xs text-slate">{match.candidate_id}</p></div></div><dl className="my-2 grid gap-1 text-xs text-slate">{match.email?<div className="flex min-w-0 gap-2"><dt><Mail size={14} aria-hidden="true"/><span className="sr-only">{t("Email","อีเมล")}</span></dt><dd className="min-w-0 break-words [overflow-wrap:anywhere]">{match.email}</dd></div>:null}{match.phone_no?<div className="flex gap-2"><dt><Phone size={14} aria-hidden="true"/><span className="sr-only">{t("Phone","เบอร์โทร")}</span></dt><dd>{match.phone_no}</dd></div>:null}</dl><ul className="divide-y divide-[#E4E9F2]">{match.applications.items.map(app=><li key={app.application_id} className="py-2"><p className="break-words text-xs font-semibold text-navy">{app.group_position} <span className="font-normal text-slate">· {app.group_id}</span></p><p className="mt-1 text-xs text-slate">{stageLabel(app.stage)} · {stateLabel(app.state)}</p><Button type="button" variant="ghost" size="sm" className="mt-1 min-h-11 text-xs sm:min-h-9" onClick={()=>openProfile(match.candidate_id,app.application_id)}>{t("View application","ดูใบสมัคร")}</Button></li>)}</ul>{match.applications.next_cursor?<Button type="button" variant="ghost" size="sm" disabled={appBusy!==null} onClick={()=>void moreApplications(match)}>{t("Show more applications","แสดงใบสมัครเพิ่มเติม")}</Button>:null}<Button type="button" variant="secondary" className="mt-2 min-h-11 w-full text-xs sm:min-h-9" onClick={()=>openProfile(match.candidate_id)}>{t("View full profile","ดูประวัติผู้สมัคร")}</Button></article>)}</div>
     {view.page.next_cursor?<Button type="button" variant="secondary" className="mt-4 min-h-11 w-full" disabled={view.status==="loading"} onClick={()=>void search(true)}>{t("Show more candidates","แสดงผู้สมัครเพิ่มเติม")}</Button>:null}
    </div>
    </>:null}
   </div></>:null}
 </div>;
}

function LookupBackdrop({wave=false,className}:{wave?:boolean;className:string}){
 const id=useId(),gradientId=`${id}-fade`,grainId=`${id}-grain`;
 return <svg aria-hidden="true" focusable="false" viewBox={wave?"0 0 480 64":"0 0 180 64"} preserveAspectRatio="none" className={className}>
  <defs>
   <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#FFFFFF"/><stop offset="30%" stopColor="#F7FAFF"/><stop offset="100%" stopColor="#D8E6FF"/></linearGradient>
   <filter id={grainId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves={3} seed={7} stitchTiles="stitch" result="noise"/>
    <feColorMatrix in="noise" type="saturate" values="0" result="monochrome"/>
    <feComponentTransfer in="monochrome" result="softNoise"><feFuncA type="linear" slope="0.2"/></feComponentTransfer>
    <feComposite in="softNoise" in2="SourceGraphic" operator="in" result="clippedGrain"/>
    <feBlend in="clippedGrain" in2="SourceGraphic" mode="soft-light"/>
   </filter>
  </defs>
  <path d={wave?"M210 64C266 22 306 12 354 34S428 62 480 14V64Z":"M0 64C0 28 38 0 90 0S180 28 180 64Z"} fill={`url(#${gradientId})`} filter={`url(#${grainId})`}/>
 </svg>;
}

function LookupHelp({language}:{language:Language}){
 const [open,setOpen]=useState(false),[position,setPosition]=useState({left:12,top:12});const trigger=useRef<HTMLButtonElement>(null),tooltip=useRef<HTMLSpanElement>(null),id=useId();
 const guidance=language==="th"?"ใช้เบอร์โทรอย่างน้อย 4 หลักติดต่อกันจากส่วนใดก็ได้ หรืออีเมลแบบเต็ม เพื่อค้นหาผู้สมัครที่คุณมีสิทธิ์เข้าถึง เปิดตัวกรองเพื่อค้นหาเฉพาะผู้ที่มีใบสมัครกำลังดำเนินการซึ่งคุณมีสิทธิ์ดู":"Use 4 or more consecutive phone digits from anywhere in the number, or a full email. Active only requires an active application you can view.";
 useLayoutEffect(()=>{if(!open)return;const place=()=>{const rect=trigger.current?.getBoundingClientRect();if(!rect)return;const height=tooltip.current?.offsetHeight??60;setPosition({left:Math.max(12,Math.min(rect.right-240,innerWidth-252)),top:rect.top-height-6>=12?rect.top-height-6:Math.min(rect.bottom+6,innerHeight-height-12)});};const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setOpen(false);}};place();document.addEventListener("keydown",escape,true);window.addEventListener("resize",place);window.addEventListener("scroll",place,true);return()=>{document.removeEventListener("keydown",escape,true);window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};},[open,guidance]);
 return <span className="inline-flex" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}><button ref={trigger} type="button" className="grid h-11 w-11 place-items-center rounded-lg text-slate hover:bg-blue-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:h-7 sm:w-7" aria-label={language==="th"?"เกี่ยวกับการค้นหาผู้สมัคร":"About candidate lookup"} aria-describedby={open?id:undefined} onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)} onClick={()=>setOpen(true)}><Info size={15} aria-hidden="true"/></button>{open?createPortal(<span ref={tooltip} id={id} role="tooltip" style={position} className="pointer-events-none fixed z-[90] w-60 max-w-[calc(100vw-24px)] rounded-lg bg-navy px-3 py-2 text-xs leading-relaxed text-white shadow-lg">{guidance}</span>,document.body):null}</span>;
}
