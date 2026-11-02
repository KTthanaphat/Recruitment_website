"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CommandSelector } from "@/components/ui/CommandSelector";
import { formatDate, formatRecruitmentId } from "@/lib/format";
import { buildRejectionReport, sortRejectionEvents, REJECTION_ACTORS, type ReasonCount, type RejectionSort } from "@/lib/rejection-report";
import { BOTTLENECK_STAGES } from "@/lib/stage-bottleneck-report";
import { buildRejectionExport } from "@/lib/rejection-export";
import type { DashboardReportContext } from "./DashboardPortal";
import { RiskReportFrame } from "./RiskReportFrame";
import { ReasonTreemap } from "./ReasonTreemap";
import { rejectionText, rejectionStageLabel, type RejectionCopyKey } from "./rejection-copy";
import { loadRejectionPage, type RejectionPage, type RejectionFilterInput } from "@/lib/dashboard-summary-client";
import { loadCompletePipelineReportData } from "@/lib/dashboard-report-loader";
import { enrichOffers, enrichRequisitions } from "@/lib/data";
import { scopeDashboardRequisitions } from "@/lib/dashboard-filters";
import styles from "./rejections.module.css";

export function RejectionDashboardView({ context }: { context: DashboardReportContext }) {
  const { language, data, requisitions, preferences: p, range, onPreferencesChange: change } = context;
  const t = rejectionText(language), stageLabel = (stage: string) => rejectionStageLabel(language, stage);
  const [showAll, setShowAll] = useState(false);
  const report=context.rejectionSummary;
  const appliedSearch=context.rejectionSummaryFilters?.search??p.rejectionSearch;
  const searchSettled=appliedSearch===p.rejectionSearch;
  const filters=useMemo<RejectionFilterInput>(()=>({actor:p.rejectionActor,stage:p.rejectionStage,main:p.rejectionMain,detail:p.rejectionDetail,search:appliedSearch}),[p.rejectionActor,p.rejectionStage,p.rejectionMain,p.rejectionDetail,appliedSearch]);
  const pageScope=useMemo(()=>({headerSite:context.headerScope.site,headerPic:context.headerScope.owner,priorityOnly:context.headerScope.priorityOnly,sites:p.sites,departments:p.departments,levels:p.levels}),[context.headerScope.site,context.headerScope.owner,context.headerScope.priorityOnly,p.sites,p.departments,p.levels]);
  const page=Math.max(0,Math.min(p.rejectionPage,1000));
  const [cursorStack,setCursorStack]=useState<Array<RejectionPage["nextCursor"]>>([]);
  const [pageState,setPageState]=useState<{key:string;status:"loading"|"ready"|"error";value?:RejectionPage}|null>(null);
  const pageFilterKey=JSON.stringify([range.start,range.end,pageScope,filters,p.rejectionSort,data.profile?.id,data.profile?.updated_at]);
  const [pageRetry,setPageRetry]=useState(0);
  const pageKey=JSON.stringify([pageFilterKey,page,pageRetry]);
  const pageCursor=page?cursorStack[page-1]??undefined:undefined;
  useEffect(()=>{setCursorStack([]);},[pageFilterKey]);
  useEffect(()=>{
    if(!supabase||context.rejectionSummaryStatus!=="ready"||!report||!searchSettled)return;
    const client=supabase;
    let cancelled=false;setPageState({key:pageKey,status:"loading"});
    const load=async()=>{
      let cursor:RejectionPage["nextCursor"]=null;const cursors:Array<RejectionPage["nextCursor"]>=[];
      for(let index=0;index<=page;index++){
        if(index>0){const known=cursors[index-1]??cursorStack[index-1];if(known){cursor=known;}else{const previous=await loadRejectionPage(client,{start:range.start,end:range.end,scope:pageScope,filters,sort:p.rejectionSort,cursor,profileKey:`${data.profile?.id??""}:${data.profile?.updated_at??""}`});if(!previous.hasMore||!previous.nextCursor)throw new Error("Rejection pagination did not advance");cursor=previous.nextCursor;cursors[index-1]=cursor;}}
        const result=await loadRejectionPage(client,{start:range.start,end:range.end,scope:pageScope,filters,sort:p.rejectionSort,cursor,profileKey:`${data.profile?.id??""}:${data.profile?.updated_at??""}`});
        if(index===page){if(!cancelled){setCursorStack(current=>{const merged=[...current];for(let i=0;i<cursors.length;i++)if(cursors[i])merged[i]=cursors[i];if(result.hasMore&&result.nextCursor)merged[page]=result.nextCursor;return merged;});setPageState({key:pageKey,status:"ready",value:result});}return;}
        if(!result.hasMore||!result.nextCursor)throw new Error("Saved rejection page no longer exists");cursor=result.nextCursor;cursors[index]=cursor;
      }
    };
    load().catch(()=>{if(!cancelled)setPageState({key:pageKey,status:"error"});});
    return()=>{cancelled=true;};
  },[supabase,context.rejectionSummaryStatus,report,searchSettled,pageKey,page,pageFilterKey,pageScope,filters,p.rejectionSort,range.start,range.end,data.profile?.id,data.profile?.updated_at]);
  const pageData=pageState?.key===pageKey?pageState.value:null;
  const rows=pageData?.events??[];
  const lastPage=Math.max(0,Math.ceil((pageData?.total??0)/25)-1);
  const commonScope = `${context.summary}:${context.headerScope.site}:${context.headerScope.owner}:${context.headerScope.priorityOnly}`;
  const previousScope = useRef(commonScope);
  useEffect(() => { if (previousScope.current !== commonScope) { previousScope.current = commonScope; if (p.rejectionPage !== 0) change({ rejectionPage: 0 }); } }, [commonScope, p.rejectionPage, change]);
  const selectedMain = report?.mainOptions.find(row => row.key === p.rejectionMain);
  const selectedDetail = report?.detailOptions.find(row => row.key === p.rejectionDetail);
  const localFilters = [
    { key: "rejectionActor" as const, label: t("actor"), value: p.rejectionActor ? t(p.rejectionActor as "company") : "" },
    { key: "rejectionStage" as const, label: t("stage"), value: p.rejectionStage ? stageLabel(p.rejectionStage) : "" },
    { key: "rejectionMain" as const, label: t("main"), value: p.rejectionMain ? selectedMain?.label[language] ?? p.rejectionMain : "" },
    { key: "rejectionDetail" as const, label: t("detail"), value: p.rejectionDetail ? selectedDetail?.label[language] ?? p.rejectionDetail : "" },
    { key: "rejectionSearch" as const, label: t("search"), value: p.rejectionSearch }
  ];
  const localScope = localFilters.map(row => `${row.label}: ${row.value || t("all")}`).join(" · ");
  function patch(values: Partial<typeof p>) { change({ ...values, rejectionPage: 0 }); }
  function main(value: string) { patch({ rejectionMain: value === p.rejectionMain ? "" : value, rejectionDetail: "" }); }
  const percent = (count: number) => `${report?.total ? (count / report.total * 100).toFixed(1) : "0.0"}%`;
  function legend() { return <div className={styles.legend}>{REJECTION_ACTORS.map(actor => <span key={actor}><i className={styles[actor]} />{t(actor)}</span>)}</div>; }
  function reasons(items: ReasonCount[], detailed: boolean, exportMode: boolean) {
    const max = Math.max(1, ...items.map(row => row.count));
    return <div className={styles.bars}>{items.map(row => <button type="button" className={styles.reason} key={row.key} aria-pressed={(detailed ? p.rejectionDetail : p.rejectionMain) === row.key}
      disabled={exportMode} aria-label={`${row.label[language]}: ${row.count}, ${percent(row.count)}`} onClick={() => detailed ? patch({ rejectionDetail: row.key === p.rejectionDetail ? "" : row.key }) : main(row.key)}>
      <span>{row.label[language]}</span><strong>{row.count}</strong><span className={styles.track}><i className={styles.fill} style={{ width: `${row.count / max * 100}%` }} /></span><small>{percent(row.count)}</small>
    </button>)}</div>;
  }
  function render(exportMode: boolean, exportEvents: RejectionPage["events"] = rows) {
    if(!report)return <div/>;
    const mainItems = exportMode || showAll ? report.mainReasons : report.mainReasons.slice(0, 10);
    const maxStage = Math.max(1, ...report.stages.map(row => row.count)), maxTrend = Math.max(1, ...report.trends.map(row => row.count));
    return <div className={`${styles.content} dashboard-compact-controls ${exportMode ? styles.export : ""}`} data-rejection-report>
      <p className={styles.definition}>{t("definition")}</p>
      <div className={styles.summary}>{(["total", ...REJECTION_ACTORS] as const).map(key => <section className={styles.metric} key={key}>
        <span>{t(key)}</span><b data-rejection-metric={key}>{key === "total" ? report.total : report.actors[key]}</b>
        <small>{key === "total" ? `${report.people} ${t("people")} · ${report.applications} ${t("applications")}` : `${percent(report.actors[key])} · ${t("share")}`}</small>
      </section>)}</div>
      {!exportMode ? <section className={styles.panel} aria-label={t("active")}><div className={styles.filters}>
        <label className={styles.field}><span>{t("actor")}</span><CommandSelector typography="normal" density="compact" ariaLabel={t("actor")} emptyLabel={t("all")} value={p.rejectionActor} options={[{ value: "", label: t("all") }, ...REJECTION_ACTORS.map(value => ({ value, label: t(value) }))]} onValueChange={value => patch({ rejectionActor: value, rejectionMain: "", rejectionDetail: "" })} /></label>
        <label className={styles.field}><span>{t("stage")}</span><CommandSelector typography="normal" density="compact" ariaLabel={t("stage")} emptyLabel={t("all")} value={p.rejectionStage} options={[{ value: "", label: t("all") }, ...report.stageOptions.map(stage => ({ value: stage, label: stageLabel(stage) }))]} onValueChange={value => patch({ rejectionStage: value })} /></label>
        <label className={styles.field}><span>{t("main")}</span><CommandSelector typography="normal" density="compact" ariaLabel={t("main")} emptyLabel={t("all")} value={p.rejectionMain} options={[{ value: "", label: t("all") }, ...report.mainOptions.map(row => ({ value: row.key, label: row.label[language] }))]} onValueChange={value => patch({ rejectionMain: value, rejectionDetail: "" })} /></label>
        <label className={styles.field}><span>{t("detail")}</span><CommandSelector typography="normal" density="compact" ariaLabel={t("detail")} emptyLabel={t("all")} value={p.rejectionDetail} disabled={!p.rejectionMain} options={[{ value: "", label: t("all") }, ...report.detailOptions.map(row => ({ value: row.key, label: row.label[language] }))]} onValueChange={value => patch({ rejectionDetail: value })} /></label>
        <label className={`${styles.field} ${styles.search}`}><span>{t("search")}</span><input type="search" placeholder={t("search")} value={p.rejectionSearch} onChange={event => patch({ rejectionSearch: event.target.value })} /></label>
        <Button type="button" size="toolbar" variant="secondary" className={styles.clear} onClick={() => patch({ rejectionActor: "", rejectionStage: "", rejectionMain: "", rejectionDetail: "", rejectionSearch: "" })}>{t("clear")}</Button>
      </div>{localFilters.some(row => row.value) ? <div className={styles.chips}>{localFilters.filter(row => row.value).map(row => <button type="button" key={row.key} aria-label={`${t("remove")}: ${row.label}`} onClick={() => patch({ [row.key]: "", ...(row.key === "rejectionMain" || row.key === "rejectionActor" ? { rejectionDetail: "", ...(row.key === "rejectionActor" ? { rejectionMain: "" } : {}) } : {}) })}>{row.label}: {row.value}<X size={12} /></button>)}</div> : null}</section> : <p className={styles.note}>{localScope}</p>}
      {report.diagnostics.undated || report.diagnostics.unresolvedContext ? <aside className={styles.quality} aria-label={t("quality")}><strong>{t("quality")}</strong><p>{t("undated")}: {report.diagnostics.undated}</p><p>{t("unresolved")}: {report.diagnostics.unresolvedContext}</p></aside> : null}
      {!report.total ? <p role="status" className={`${styles.panel} ${styles.empty}`}>{t(report.periodTotal ? "noMatches" : "empty")}</p> : null}
      <section className={styles.explorer} aria-label={t("reasonView")}>
        <header className={styles.explorerHeader}><h3>{t("mainTitle")}</h3>{!exportMode ? <div className={styles.viewSwitch} role="group" aria-label={t("reasonView")}>{(["treemap", "bars"] as const).map(view => <button key={view} type="button" aria-pressed={p.rejectionReasonView === view} onClick={() => change({ rejectionReasonView: view })}>{t(view)}</button>)}</div> : <span className={styles.note}>{t(p.rejectionReasonView)}</span>}</header>
        {p.rejectionReasonView === "treemap" ? <div className={styles.panel}>
          <nav className={styles.breadcrumb} aria-label={t("main")}><button type="button" disabled={!p.rejectionMain || exportMode} onClick={() => patch({ rejectionMain: "", rejectionDetail: "" })}>{t("allMain")}</button>{p.rejectionMain ? <><span aria-hidden="true">/</span><strong>{report.comparison.label?.[language] ?? t("main")}</strong></> : null}</nav>
          <p className={styles.comparisonScope} data-reason-comparison-total>{report.comparison.level === "detail" ? `${t("comparisonDetail")} ${report.comparison.label?.[language] ?? t("main")}` : t("comparisonMain")} — <strong>{report.comparison.total}</strong> {t("comparison")} · {t("comparisonShare")}</p>
          {report.comparison.total ? <ReasonTreemap reasons={report.comparison.reasons} language={language} selected={report.comparison.selected} exportMode={exportMode} onSelect={key => report.comparison.level === "main" ? patch({ rejectionMain: key, rejectionDetail: "" }) : patch({ rejectionDetail: p.rejectionDetail === key ? "" : key })} /> : <p className={styles.empty}>{t("noMatches")}</p>}
        </div> : <>
      <div className={styles.reasonGrid}>
        <section className={styles.panel} aria-label={t("mainTitle")}><header className={styles.head}><div><h3>{t("main")}</h3><p className={styles.note}>{t("share")}</p></div>{!exportMode && report.mainReasons.length > 10 ? <Button type="button" variant="ghost" size="toolbar" onClick={() => setShowAll(value => !value)}>{t(showAll ? "showLess" : "showAll")}</Button> : null}</header>{reasons(mainItems, false, exportMode)}</section>
        <section className={styles.panel} aria-label={t("detailTitle")}><header className={styles.head}><div><h3>{t("detailTitle")}</h3>{selectedMain ? <p className={styles.note}>{selectedMain.label[language]}</p> : null}</div></header>{p.rejectionMain || exportMode ? reasons(report.detailedReasons, true, exportMode) : <p className={styles.empty}>{t("selectMain")}</p>}</section>
      </div>
        </>}
      </section>
      <div className={styles.patternGrid}>
        <section className={styles.panel} aria-label={t("stageTitle")}><header className={styles.head}><h3>{t("stageTitle")}</h3></header>{legend()}{report.stages.map(row => <button key={row.stage} type="button" disabled={exportMode} className={`${styles.stage} ${p.rejectionStage === row.stage ? styles.selected : ""}`} aria-pressed={p.rejectionStage === row.stage} aria-label={`${stageLabel(row.stage)}: ${row.count}; ${REJECTION_ACTORS.map(actor => `${t(actor)} ${row[actor]}`).join(", ")}`} onClick={() => patch({ rejectionStage: p.rejectionStage === row.stage ? "" : row.stage })}>
          <span>{stageLabel(row.stage)}{!BOTTLENECK_STAGES.includes(row.stage as typeof BOTTLENECK_STAGES[number]) ? <small>{t("historical")}</small> : null}</span><span className={styles.track}>{REJECTION_ACTORS.map(actor => <i key={actor} className={styles[actor]} style={{ width: `${row[actor] / maxStage * 100}%` }} />)}</span><strong>{row.count}</strong>
        </button>)}</section>
        <section className={styles.panel} aria-label={t("trend")}><header className={styles.head}><h3>{t("trend")}</h3><small className={styles.note}>{t(report.granularity)}</small></header>{legend()}<div className={styles.trendScroll}><div className={styles.trend} role="img" aria-label={`${t("trend")}: ${report.trends.map(row => `${row.start}–${row.end}: ${row.count}`).join("; ")}`}>{report.trends.map(row => <div key={row.start} className={styles.bucket} title={`${formatDate(row.start, language)} – ${formatDate(row.end, language)}: ${row.count}; ${REJECTION_ACTORS.map(actor => `${t(actor)} ${row[actor]}`).join(", ")}`}>
          <b>{row.count}</b><div className={styles.column} style={{ height: `${row.count / maxTrend * 138}px` }}>{REJECTION_ACTORS.map(actor => <i key={actor} className={styles[actor]} style={{ height: `${row.count ? row[actor] / row.count * 100 : 0}%` }} />)}</div><span>{row.start.slice(5).split("-").reverse().join("/")}</span>
        </div>)}</div></div></section>
      </div>
      <section className={styles.panel} aria-label={t("records")}><header className={styles.head}><h3>{t("records")} ({report.total})</h3>{!exportMode ? <CommandSelector typography="normal" density="compact" ariaLabel={t("sort")} emptyLabel={t("date-desc")} value={p.rejectionSort} options={(["date-desc", "date-asc", "candidate-asc", "stage-asc"] as RejectionSort[]).map(value => ({ value, label: t(value) }))} onValueChange={value => patch({ rejectionSort: value as RejectionSort })} /> : null}</header>
        {!exportMode&&pageState?.key===pageKey&&pageState.status==="error" ? <div role="alert" className={styles.empty}>{language==="th"?"โหลดรายการไม่สำเร็จ":"Could not load rejection rows."} <Button type="button" size="toolbar" variant="secondary" onClick={()=>setPageRetry(value=>value+1)}>{language==="th"?"ลองอีกครั้ง":"Retry"}</Button></div> : !exportMode&&(pageState?.key!==pageKey||pageState.status!=="ready"||!pageData) ? <p role="status" className={styles.empty}>{language==="th"?"กำลังโหลดรายการ…":"Loading records…"}</p> : <div className={styles.scroll}><table className={styles.table}><thead><tr>{(["outcome", "person", "application", "position", "stage", "actor", "main", "detail", "context"] as RejectionCopyKey[]).map(key => <th key={key} scope="col">{t(key)}</th>)}</tr></thead><tbody>{(exportMode?exportEvents:rows).map(row => <tr key={row.id} data-rejection-event={row.id}>
          <td>{formatDate(row.date, language)}</td><td>{context.onOpenCandidate ? <button type="button" className={styles.person} onClick={() => context.onOpenCandidate?.(row.candidateId, row.applicationId??undefined)}>{row.name}</button> : <strong>{row.name}</strong>}<small aria-label={formatRecruitmentId(row.candidateId)}>{formatRecruitmentId(row.candidateId)}</small></td><td>{row.applicationId ?? "—"}</td><td>{row.position??"—"}</td><td>{stageLabel(row.stage)}<small>{t("round")} {row.round}</small></td><td>{t(row.actor)}</td><td>{row.main[language]}</td><td>{row.detail[language]}</td><td>{row.requisitions.map(req => <div key={req.doc_id}>{req.doc_id}<small>{req.site} · {req.department} · {req.person_in_charge || "—"}</small></div>)}</td>
        </tr>)}</tbody></table></div>}
        {!exportMode && (pageData?.total??0)>25 ? <nav className={styles.pagination} aria-label={t("records")}><Button type="button" size="toolbar" variant="secondary" disabled={!page} onClick={() => change({ rejectionPage: page - 1 })}>{t("previous")}</Button><span>{t("page")} {page + 1} / {lastPage + 1}</span><Button type="button" size="toolbar" variant="secondary" disabled={!pageData?.hasMore} onClick={() => change({ rejectionPage: page + 1 })}>{t("next")}</Button></nav> : null}
      </section><p className={styles.note}>{t("guideText")}</p>
    </div>;
  }
  async function exportRejectionWorkbook() {
    const client=supabase;if(!client)throw new Error("Recruitment client is unavailable");
    const exportRange={start:range.start,end:range.end},exportFilters={...filters},exportPreferences={...p},headerScope={...context.headerScope};
    const completeData=await loadCompletePipelineReportData(client,data);
    const headerRows=enrichRequisitions(completeData).filter(row=>(!headerScope.site||row.site===headerScope.site)&&(!headerScope.owner||row.person_in_charge?.toLocaleLowerCase()===headerScope.owner.toLocaleLowerCase())&&(!headerScope.priorityOnly||row.is_priority));
    const scopedRows=scopeDashboardRequisitions(headerRows,exportPreferences,context.supportedFilters);
    const fullReport=buildRejectionReport(completeData,scopedRows,exportRange,exportFilters);
    const ids=new Set(scopedRows.map(row=>row.doc_id));
    const exportContext={...context,data:completeData,requisitions:scopedRows,offers:enrichOffers(completeData).filter(row=>ids.has(row.doc_id)),candidateOffers:completeData.offers.filter(row=>ids.has(row.doc_id)),range:{...context.range,...exportRange}};
    return buildRejectionExport(exportContext,fullReport,localScope);
  }
  async function prepareRejectionPng() {
    const client=supabase;if(!client||!report)throw new Error("Rejection report is unavailable");
    const frozen={start:range.start,end:range.end,scope:{...pageScope},filters:{...filters},sort:p.rejectionSort,profileKey:`${data.profile?.id??""}:${data.profile?.updated_at??""}`,refreshKey:Date.now()};
    const all:RejectionPage["events"]=[],seen=new Set<string>();let cursor:RejectionPage["nextCursor"]|undefined;
    for(;;){const pageResult=await loadRejectionPage(client,{...frozen,cursor});all.push(...pageResult.events);if(!pageResult.hasMore)break;if(!pageResult.nextCursor)throw new Error("Rejection export paging did not complete");const key=JSON.stringify(pageResult.nextCursor);if(seen.has(key))throw new Error("Rejection export cursor did not advance");seen.add(key);cursor=pageResult.nextCursor;}
    if(all.length!==report.total||new Set(all.map(row=>row.id)).size!==all.length)throw new Error("Rejection export returned an incomplete event set");
    return render(true,all);
  }
  if(context.rejectionSummaryStatus==="error")return <section className={styles.panel}><p role="alert">{language==="th"?"โหลดสรุปการปฏิเสธไม่สำเร็จ":"Could not load the rejection summary."}</p><Button type="button" size="toolbar" className="mt-3" onClick={context.onRetryRejectionSummary}>{language==="th"?"ลองอีกครั้ง":"Retry"}</Button></section>;
  if(context.rejectionSummaryStatus!=="ready"||!report||!searchSettled)return <section className={styles.panel}><p role="status">{language==="th"?"กำลังโหลดสรุปการปฏิเสธ…":"Loading rejection summary…"}</p></section>;
  return <RiskReportFrame title={t("title")} language={language} summary={context.summary} filename={`rejection-analysis-${range.start}-to-${range.end}`} render={render} workbook={exportRejectionWorkbook} preparePng={prepareRejectionPng} />;
}
