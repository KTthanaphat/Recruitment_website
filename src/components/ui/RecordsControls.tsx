"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { TableFilterField, type TableColumn } from "@/components/ui/TableControls";
import { Button } from "@/components/ui/Button";
import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { translate } from "@/lib/i18n/dictionary";
import type { Language } from "@/types/recruitment";
export const RECORD_PAGE_SIZE = 7 as const;
export function RecordCreateButton({ label, onClick }: {
    label: string;
    onClick: () => void;
}) {
    return <Button type="button" variant="primary" size="icon-sm" className="records-create-button" aria-label={label} title={label} onClick={onClick} icon={<Plus size={18} aria-hidden="true"/>}/>;
}
export function RecordPagination({ language, page, totalCount, countLoading = false, countError = false, loading = false, canPrevious, canNext, onPrevious, onNext, onRetryCount, pageSize = RECORD_PAGE_SIZE, onPageSizeChange }: {
    language: Language;
    page: number;
    pageSize?: number;
    onPageSizeChange?: (size: number) => void;
    totalCount: number | null;
    countLoading?: boolean;
    countError?: boolean;
    loading?: boolean;
    canPrevious: boolean;
    canNext: boolean;
    onPrevious: () => void;
    onNext: () => void;
    onRetryCount?: () => void;
}) {
    const navRef = useRef<HTMLElement>(null);
    const callbackRef = useRef(onPageSizeChange);
    const pageSizeRef = useRef(pageSize);
    callbackRef.current = onPageSizeChange;
    pageSizeRef.current = pageSize;
    useEffect(() => {
      if (!onPageSizeChange || loading) return;
      const nav = navRef.current;
      const panel = nav?.closest<HTMLElement>(".records-surface");
      if (!nav || !panel) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const measure = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (window.innerWidth < 768) {
            if (pageSizeRef.current !== RECORD_PAGE_SIZE) callbackRef.current?.(RECORD_PAGE_SIZE);
            return;
          }
          const heading = panel.querySelector<HTMLElement>("thead, .records-audit-header");
          if (!heading || !heading.getClientRects().length) return;
          // A sticky header moves during page scrolling; the table's document
          // position stays fixed and prevents scroll-triggered page-size changes.
          const anchor = heading.closest("table") ?? heading.parentElement ?? heading;
          const headerBottom = anchor.getBoundingClientRect().top + window.scrollY + heading.getBoundingClientRect().height;
          const bottomPadding = parseFloat(getComputedStyle(panel).paddingBottom) || 0;
          const available = window.innerHeight - headerBottom - nav.getBoundingClientRect().height - bottomPadding - 112;
          const size = Math.max(1, Math.min(100, Math.floor(available / 48)));
          if (size !== pageSizeRef.current) callbackRef.current?.(size);
        }, 120);
      };
      const observer = new ResizeObserver(measure);
      observer.observe(panel);
      if (panel.parentElement) observer.observe(panel.parentElement);
      window.addEventListener("resize", measure);
      measure();
      return () => { clearTimeout(timer); observer.disconnect(); window.removeEventListener("resize", measure); };
    }, [Boolean(onPageSizeChange), loading]);
    const empty = totalCount === 0;
    const pages = totalCount === null ? null : Math.ceil(totalCount / pageSize);
    const current = empty ? 0 : page;
    const total = countError ? "—" : pages === null ? "…" : String(pages);
    const range = totalCount === null ? "" : translate(language, "showingRows", { start: empty ? 0 : (page - 1) * pageSize + 1, end: Math.min(page * pageSize, totalCount), total: totalCount });
    return <nav ref={navRef} className="records-pagination" data-record-pagination data-record-page-size={pageSize} aria-label={language === "th" ? "การแบ่งหน้ารายการ" : "Record pagination"} aria-busy={loading || countLoading}>
   <span className="records-page-range">{range}</span>
   <div className="flex items-center gap-1">
    {countError && onRetryCount ? <RetryIconButton type="button" aria-label={language === "th" ? "ลองนับรายการอีกครั้ง" : "Retry record count"} title={language === "th" ? "ลองนับรายการอีกครั้ง" : "Retry record count"} onClick={onRetryCount} loading={countLoading}/> : null}
    <Button type="button" size="icon-sm" variant="ghost" disabled={loading || empty || !canPrevious} aria-label={translate(language, "previousPage")} title={translate(language, "previousPage")} onClick={onPrevious} icon={<ChevronLeft size={18} aria-hidden="true"/>}/>
    <span className="min-w-12 text-center text-xs font-medium tabular-nums text-navy" aria-live="polite" aria-label={translate(language, "pageOf", { current, total })}>{current}/{total}</span>
    <Button type="button" size="icon-sm" variant="ghost" disabled={loading || empty || !canNext} aria-label={translate(language, "nextPage")} title={translate(language, "nextPage")} onClick={onNext} icon={<ChevronRight size={18} aria-hidden="true"/>}/>
   </div>
 </nav>;
}
export function RecordCell({ children }: {
    children: ReactNode;
}) { const ref = useRef<HTMLDivElement>(null); useEffect(() => { if (ref.current)
    ref.current.title = ref.current.textContent ?? ""; }, [children]); return <div ref={ref} className="records-cell-content">{children}</div>; }

/** Keep edits local until explicitly applied; closing restores committed values. */
export function useRecordFilterDraft<T extends Record<string, unknown>>(applied:T, open:boolean) {
 const [draft,setDraft]=useState<T>(applied);
 useEffect(()=>{setDraft(applied);},[open,applied]);
 return {draft,setDraft,setField:(key:string,value:string)=>setDraft(current=>({...current,[key]:value}))};
}

type RecordFilterPanelProps = { id:string; open:boolean; language:Language; onClose:()=>void; onClear:()=>void; onApply:()=>void; applyDisabled?:boolean; columns?:ReadonlyArray<{key:string;label:string}>; filters?:Record<string,string>; onFilter?:(key:string,value:string)=>void; filterOptions?:(key:string)=>string[]|undefined; children?:ReactNode; header?:ReactNode; };
export function RecordFilterPanel({id,open,language,onClose,onClear,onApply,applyDisabled=false,columns=[],filters={},onFilter,filterOptions,children,header}:RecordFilterPanelProps) {
 const ref=useRef<HTMLElement>(null), previous=useRef(false), closeRef=useRef(onClose); closeRef.current=onClose;
 useEffect(()=>{
  if(!open){if(previous.current) document.querySelector<HTMLButtonElement>(`button[aria-controls="${id}"]`)?.focus(); previous.current=false; return;}
  previous.current=true; ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape' && !document.querySelector('[data-category-menu]')){event.preventDefault();closeRef.current();} if(event.key==='Tab' && window.innerWidth<768 && ref.current && !document.querySelector('[data-category-menu]')){const nodes=Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')).filter(node=>node.getClientRects().length);if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}}};
  document.addEventListener('keydown',key); return()=>document.removeEventListener('keydown',key);
 },[open,id]);
 return <><div className="records-filter-backdrop" hidden={!open} onClick={onClose}/><aside ref={ref} id={id} hidden={!open} className="records-filter-sidebar" aria-label={translate(language,"advancedFilters")} data-record-filter-panel>
  <div className="records-filter-sidebar-heading"><h3>{translate(language,"advancedFilters")}</h3><button type="button" className="records-filter-close" aria-label={language==="th"?"ปิด":"Close"} onClick={onClose}><X size={18} aria-hidden="true"/></button></div>
  <div className="records-filter-sidebar-content">{header}{columns.map(column=><div key={column.key} className="records-filter-field"><span className="text-xs font-medium text-slate">{column.label}</span><TableFilterField columnKey={column.key} filterValue={filters[column.key]??""} language={language} label={column.label} onFilter={onFilter!} filterOptions={filterOptions?.(column.key)} viewportBounded sidebar/></div>)}{children}</div>
  <div className="records-filter-sidebar-footer"><Button type="button" variant="secondary" onClick={onClear}>{language==="th"?"ล้างตัวกรอง":"Clear filters"}</Button><Button type="button" onClick={onApply} disabled={applyDisabled}>{language==="th"?"ใช้ตัวกรอง":"Apply filter"}</Button></div>
 </aside></>;
}

/** Retain category choices from already-authorized page snapshots while filters narrow the rows. */
export function useRecordCategoryOptions<T>(columns:ReadonlyArray<TableColumn<T>>,rows:readonly T[],scope:string) {
 const known=useRef<{scope:string;values:Map<string,Set<string>>}>({scope:"",values:new Map()});
 const values=new Map<string,Set<string>>();
 for(const column of columns) {
  if(column.filterMode!=="category")continue;
  const options=new Set(known.current.scope===scope?known.current.values.get(column.key):undefined);
  for(const row of rows){const value=String(column.filterValue?.(row)??column.value(row)??"—").trim();if(value)options.add(value);}
  values.set(column.key,options);
 }
 useEffect(()=>{known.current={scope,values};});
 return (key:string)=>{const options=values.get(key);return options?[...options].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"})):undefined;};
}

export function useRecordsCardLayout() {
 const [mobile,setMobile]=useState(false);
 useEffect(()=>{const query=matchMedia("(max-width:767px)");const update=()=>setMobile(query.matches);update();query.addEventListener("change",update);return()=>query.removeEventListener("change",update);},[]);
 return mobile;
}
export function RecordPriorityIndicator({priority,language,candidate=false}:{priority:boolean;language:Language;candidate?:boolean}) {
 const label=language==="th"?(priority?"มีความสำคัญ":"ไม่มีความสำคัญ"):(priority?"Prioritized":"Not prioritized");
 const description=candidate?(language==="th"?"พิจารณาจากคำขอที่มีความสำคัญในใบสมัครที่ดำเนินการและคุณมีสิทธิ์ดู":"Based on priority requisitions in active applications within your access"):"";
 return <span role="img" aria-label={label} title={[label,description].filter(Boolean).join(" · ")} data-record-priority data-priority={priority} className="inline-flex items-center justify-center" style={{color:priority?"#0A3CDC":"#7C94AD"}}><Bookmark size={18} fill={priority?"currentColor":"none"} aria-hidden="true"/></span>;
}

export function useRecordSelection(identity:string) {
 const [state,setState]=useState<{identity:string;ids:string[]}>({identity,ids:[]});
 const [flashes,setFlashes]=useState<Set<string>>(new Set());
 const timers=useRef(new Map<string,ReturnType<typeof setTimeout>>());
 const controller=useRef<AbortController|null>(null),generation=useRef(0),currentIdentity=useRef(identity);currentIdentity.current=identity;
 const [captureBusy,setCaptureBusy]=useState(false),[captureError,setCaptureError]=useState("");
 const [progress,setProgress]=useState<{loaded:number;total:number|null}>({loaded:0,total:null});
 const cancelCapture=useCallback(()=>{generation.current++;controller.current?.abort();setCaptureBusy(false);},[]);
 const ids=state.identity===identity?state.ids:[];
 const clearFeedback=useCallback(()=>{setFlashes(new Set());for(const timer of timers.current.values())clearTimeout(timer);timers.current.clear();},[]);
 useEffect(()=>{cancelCapture();setState({identity,ids:[]});clearFeedback();setCaptureError("");},[identity,cancelCapture,clearFeedback]);
 useEffect(()=>{const active=timers.current;return()=>{generation.current++;controller.current?.abort();for(const timer of active.values())clearTimeout(timer);active.clear();};},[]);
 const flash=(fresh:string[])=>{if(!fresh.length)return;setFlashes(current=>new Set([...current,...fresh]));for(const id of fresh){clearTimeout(timers.current.get(id));timers.current.set(id,setTimeout(()=>{setFlashes(current=>{const next=new Set(current);next.delete(id);return next;});timers.current.delete(id);},1000));}};
 const select=(visible:string[],checked:boolean)=>{if(checked)flash(visible.filter(id=>!ids.includes(id)));setState({identity,ids:checked?[...new Set([...ids,...visible])]:ids.filter(id=>!visible.includes(id))});};
 async function capture(load:(signal:AbortSignal,onProgress:(value:{loaded:number;total:number|null})=>void)=>Promise<string[]>,visible:string[]){
  controller.current?.abort();const token=++generation.current,started=identity,abort=new AbortController();controller.current=abort;setCaptureBusy(true);setCaptureError("");setProgress({loaded:0,total:null});
  try{const next=await load(abort.signal,value=>{if(generation.current===token&&currentIdentity.current===started)setProgress(value);});if(abort.signal.aborted||generation.current!==token||currentIdentity.current!==started)return;
   flash(visible.filter(id=>next.includes(id)&&!ids.includes(id)));setState({identity:started,ids:[...new Set(next)]});return true;
  }catch(error){if(!abort.signal.aborted&&generation.current===token&&currentIdentity.current===started)setCaptureError(error instanceof Error?error.message:"Could not select matching records.");return false;}
  finally{if(generation.current===token&&currentIdentity.current===started)setCaptureBusy(false);}
 }
 return {ids,clearFeedback,capture,captureBusy,captureError,progress,cancelCapture,flashing:(id:string)=>flashes.has(id),toggle:(id:string,checked:boolean)=>select([id],checked),toggleVisible:select,clear:()=>{cancelCapture();setCaptureError("");setState({identity,ids:[]});clearFeedback();}};
}
export function RecordSelectionProgress({selection,language}:{selection:{captureBusy:boolean;captureError:string;progress:{loaded:number;total:number|null};cancelCapture:()=>void};language:Language}) {
 const {captureBusy,captureError,progress,cancelCapture}=selection;
 return <>{captureBusy?<div className="records-selection-progress my-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate"><span role="status" aria-live="polite">{language==="th"?"กำลังเลือก":"Selecting"} {progress.loaded}{progress.total===null?"": " / "+progress.total} {language==="th"?"รายการที่ตรงกัน":"matching records"}</span><Button type="button" size="sm" variant="ghost" onClick={cancelCapture}>{language==="th"?"ยกเลิก":"Cancel"}</Button></div>:null}{captureError?<p role="alert" className="my-2 text-xs text-scarlet">{language==="th"?"เลือกข้อมูลไม่สำเร็จ โปรดลองเลือกทั้งหมดอีกครั้ง":"Could not select matching records. Please retry select all."} <span className="sr-only">{captureError}</span></p>:null}</>;
}
export function RecordSelectionCheckbox({checked,mixed=false,label,onChange,disabled=false}:{checked:boolean;mixed?:boolean;label:string;onChange:(checked:boolean)=>void;disabled?:boolean}) {
 const ref=useRef<HTMLInputElement>(null);useEffect(()=>{if(ref.current)ref.current.indeterminate=mixed;});
 return <input ref={ref} className="record-selection-checkbox" type="checkbox" checked={checked} aria-label={label} onChange={event=>onChange(event.target.checked)} disabled={disabled}/>;
}

export function RecordHeaderFilterRow({open,children}:{open:boolean;children:ReactNode}) {return open?<tr className="records-filter-row">{children}</tr>:null;}
