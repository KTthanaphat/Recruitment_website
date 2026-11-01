"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Flag, AlertTriangle, ChevronRight, Info, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CommandSelector } from "@/components/ui/CommandSelector";
import { previousPerformanceRange } from "@/lib/recruitment-performance";
import { todayDate } from "@/lib/sla";
import { buildVacancyRiskReport, riskGroups, riskGroupKey, riskRowMatches, type RiskFilter, type RiskKind, type RiskTotals } from "@/lib/vacancy-risk-report";
import { loadRiskPage, RISK_PAGE_SIZE, type RiskPage } from "@/lib/dashboard-summary-client";
import { assertFullContinuationPage } from "@/lib/report-export-pagination";
import { supabase } from "@/lib/supabase/client";
import { enrichRequisitions } from "@/lib/data";
import { scopeDashboardRequisitions } from "@/lib/dashboard-filters";
import { buildRiskExport } from "@/lib/risk-bottleneck-export";
import type { DashboardReportContext } from "./DashboardPortal";
import { riskCopy } from "./risk-copy";
import { Comparison, MiniTrend, RiskReportFrame } from "./RiskReportFrame";
import styles from "./risk-reports.module.css";
const categories: RiskKind[] = ["track", "near", "overdue", "unknown"];
export function RiskBar({ totals, label }: { totals: RiskTotals; label: string }) {
  return <div className={styles.riskBar} role="img" aria-label={label}>{categories.map(kind => totals[kind] ? <span key={kind} className={styles[kind]} style={{ width: `${totals[kind] / totals.open * 100}%` }} /> : null)}</div>;
}
export function VacancyRiskView({ context }: { context: DashboardReportContext }) {
  const { language, data, requisitions, preferences: p, onPreferencesChange: change, range } = context, t = riskCopy(language), actionRef = useRef<HTMLElement>(null);
  const [pageNumber,setPageNumber]=useState(0),[cursorStack,setCursorStack]=useState<Array<RiskPage["nextCursor"]>>([]);
  const [riskPageState,setRiskPageState]=useState<{key:string;status:"loading"|"ready"|"error";value?:RiskPage}|null>(null);
  const pageCursor=pageNumber?cursorStack[pageNumber-1]??undefined:undefined;
  const pageScope=useMemo(()=>({headerSite:context.headerScope.site,headerPic:context.headerScope.owner,priorityOnly:context.headerScope.priorityOnly,sites:p.sites,departments:p.departments,levels:p.levels}),[context.headerScope.site,context.headerScope.owner,context.headerScope.priorityOnly,p.sites,p.departments,p.levels]);
  const report = context.riskSummary;
  const groups = report?.groups[p.riskGrouping] ?? [];
  const riskPageKey=JSON.stringify([context.riskSummary?.asOf,pageScope,p.riskFilter,p.riskGrouping,p.riskGroup,pageCursor,pageNumber]);
  useEffect(()=>{setPageNumber(0);setCursorStack([]);},[context.riskSummary?.asOf,pageScope,p.riskFilter,p.riskGrouping,p.riskGroup]);
  useEffect(()=>{
    if(!supabase||!context.riskSummary) return;
    let cancelled=false;setRiskPageState({key:riskPageKey,status:"loading"});
    loadRiskPage(supabase,{asOf:context.riskSummary.asOf,scope:pageScope,filter:p.riskFilter,grouping:p.riskGrouping,group:p.riskGroup,cursor:pageCursor,profileKey:`${data.profile?.id??""}:${data.profile?.updated_at??""}`})
      .then(value=>{if(!cancelled)setRiskPageState({key:riskPageKey,status:"ready",value});}).catch(()=>{if(!cancelled)setRiskPageState({key:riskPageKey,status:"error"});});
    return()=>{cancelled=true;};
  },[context.riskSummary,pageScope,p.riskFilter,p.riskGrouping,p.riskGroup,pageCursor,pageNumber,riskPageKey,data.profile?.id,data.profile?.updated_at]);
  const pageData=riskPageState?.key===riskPageKey?riskPageState.value:null;
  const visible=pageData?.rows??[];
  const filterScope = `${t("group")}: ${t(p.riskGrouping)} · ${t(p.riskFilter as RiskFilter)}${p.riskGroup ? ` · ${p.riskGroup}` : ""}`;
  async function exportRiskWorkbook() {
    if (!supabase) throw new Error("Recruitment client is unavailable");
    const exportToday = todayDate(), exportRange = { start: range.start, end: range.end };
    const exportPriorRange = previousPerformanceRange(p.period, { start: exportRange.start, end: exportRange.end < exportToday ? exportRange.end : exportToday });
    // Match the company-wide anonymized risk feed used by the summary. Ordinary RLS
    // pages can be narrower for site recruiters, and the bootstrap is intentionally lean.
    const {data:raw,error}=await supabase.rpc("app_dashboard_company_report");
    if(error) throw new Error(error.message);
    const source=raw as Partial<Pick<typeof data,"requisitions"|"requisition_logs"|"offers">>|null;
    if(!source||!Array.isArray(source.requisitions)||!Array.isArray(source.requisition_logs)||!Array.isArray(source.offers)) throw new Error("Complete risk export source is unavailable; retry export");
    const unique=<T,>(rows:T[],key:keyof T)=>{const ids=rows.map(row=>row[key]);return ids.every(id=>(typeof id==="string"&&id.length>0)||(typeof id==="number"&&Number.isFinite(id)))&&new Set(ids).size===rows.length;};
    if(!unique(source.requisitions,"doc_id")||!unique(source.requisition_logs,"log_id")||!unique(source.offers,"offer_id")) throw new Error("Risk export source is incomplete; retry export");
    const completeData={...data,requisitions:source.requisitions,requisition_logs:source.requisition_logs,offers:source.offers};
    const headerRows=enrichRequisitions(completeData).filter(row=>(!context.headerScope.site||row.site===context.headerScope.site)&&(!context.headerScope.owner||row.person_in_charge?.toLocaleLowerCase()===context.headerScope.owner.toLocaleLowerCase())&&(!context.headerScope.priorityOnly||row.is_priority));
    const scopedRows=scopeDashboardRequisitions(headerRows,p,context.supportedFilters);
    const ids=new Set(scopedRows.map(row=>row.doc_id));
    const exportData={...completeData,requisitions:scopedRows,requisition_logs:completeData.requisition_logs.filter(row=>ids.has(row.doc_id)),offers:completeData.offers.filter(row=>ids.has(row.doc_id))};
    const exportContext={...context,data:exportData,requisitions:scopedRows,offers:context.offers.filter(row=>ids.has(row.doc_id)),candidateOffers:completeData.offers.filter(row=>ids.has(row.doc_id))};
    const fullReport=buildVacancyRiskReport(exportData,scopedRows,exportRange,exportToday,exportPriorRange);
    const fullGroups=riskGroups(fullReport.rows,p.riskGrouping);
    const fullVisible=fullReport.rows.filter(row=>riskRowMatches(row,p.riskFilter as RiskFilter)&&(!p.riskGroup||riskGroupKey(row,p.riskGrouping)===p.riskGroup));
    return buildRiskExport(exportContext,fullReport,fullGroups,fullVisible,filterScope);
  }
  async function preparePng() {
    if (!supabase || !context.riskSummary) throw new Error("Risk report is unavailable");
    const collected: RiskPage["rows"] = [], seenRows = new Set<string>(), seenCursors = new Set<string>();
    let cursor: RiskPage["nextCursor"] = null, expectedTotal: number | null = null;
    for (let pageNumber = 0; pageNumber < 10_000; pageNumber++) {
      const result = await loadRiskPage(supabase, { asOf: context.riskSummary.asOf, scope: pageScope, filter: p.riskFilter, grouping: p.riskGrouping,
        group: p.riskGroup, cursor: cursor ?? undefined, profileKey: `${data.profile?.id ?? ""}:${data.profile?.updated_at ?? ""}` });
      if (expectedTotal !== null && result.total !== expectedTotal) throw new Error("Risk report changed during export; retry");
      expectedTotal = result.total;
      for (const row of result.rows) {
        if (!row.docId || seenRows.has(row.docId)) throw new Error("Risk export contains duplicate or invalid requisitions; retry");
        seenRows.add(row.docId); collected.push(row);
      }
      if (!result.hasMore) {
        if (expectedTotal !== collected.length) throw new Error("Risk export is incomplete; retry");
        return render(true, collected);
      }
      const following = result.nextCursor;
      assertFullContinuationPage(result.hasMore, result.rows.length, RISK_PAGE_SIZE, "Risk");
      if (!following) throw new Error("Risk export is incomplete; retry");
      const token = JSON.stringify(following);
      if (seenCursors.has(token) || cursor && token === JSON.stringify(cursor)) throw new Error("Risk export cursor did not advance; retry");
      seenCursors.add(token); cursor = following;
    }
    throw new Error("Risk export exceeded its page limit; retry");
  }
  function drill(filter: RiskFilter, group = "") { change({ riskFilter: filter, riskGroup: group }); requestAnimationFrame(() => { actionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); actionRef.current?.focus(); }); }
  const format = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
  function render(exportMode: boolean, exportedRows?: RiskPage["rows"]) { if (!report) return <div />; const totals = report.totals, priorityCount = totals.priority, actionRows = exportMode ? exportedRows ?? [] : visible; return <div className={styles.content}>
      {report.future ? <p className={styles.notice}>{t("future")}</p> : null}
    <div className={styles.riskHero}>
      <section className={styles.health}><h3>{t("health")}</h3><div className={styles.healthGrid}><div className={styles.headcountIdentity}><p aria-label={t("open")}><span>{t("openFirst")}</span><span>{t("openSecond")}</span></p><strong className={styles.bigNumber} data-risk-open>{totals.open}</strong></div><div><RiskBar totals={totals} label={categories.map(kind => `${t(kind)} ${totals[kind]}`).join(", ")} /><div className={styles.healthLegend}>{categories.filter(kind => totals[kind] || kind !== "unknown").map(kind => <div key={kind}><span className={`${styles.dot} ${styles[kind]}`} />{t(kind)}<strong>{totals[kind]}</strong></div>)}</div></div></div><p className={styles.exposure}><Info size={17} /><span><strong>{totals.near + totals.overdue}</strong> / {totals.known} {t("known")} · <strong>{format(totals.exposure)} {t("exposure")}</strong></span></p></section>
      {(["overdue", "near", "priority"] as const).map(key => { const denominator = key === "priority" ? totals.priorityOpen : totals.open; return <button key={key} type="button" className={styles.riskKpi} aria-pressed={p.riskFilter === key && !p.riskGroup} onClick={() => drill(key)}><span className={styles.kpiTop}><span className={`${styles.kpiIcon} ${key === "near" ? styles.amberSurface : styles.redSurface}`}>{key === "overdue" ? <Clock3 size={16} /> : key === "near" ? <AlertTriangle size={16} /> : <Flag size={16} />}</span><strong>{t(key)}</strong><ChevronRight size={16} /></span><b className={styles.summaryValue} data-risk-metric={key}>{totals[key]}/{denominator}</b><small className={styles.summaryContext} title={denominator ? undefined : t("noDenominator")}>({denominator ? format(totals[key] / denominator) : "—"}) {t(key === "priority" ? "ofPriority" : "ofOpen")}</small><MiniTrend values={report.trends.map(row => row[key])} label={`${t(key)}: ${report.trends.map(row => `${row.date} ${row[key]}`).join(", ")}`} tone={key === "near" ? "amber" : "red"} /><Comparison value={totals[key]} prior={report.priorTotals?.[key]} range={report.priorRange} language={language} /></button>; })}
    </div>
    <div className={styles.twoColumns}>
      <section className={styles.panel}><header className={styles.sectionHead}><h3>{t("distribution")}</h3>{!exportMode ? <label className={styles.inlineField}><span>{t("group")}</span><CommandSelector typography="normal" ariaLabel={t("group")} emptyLabel={t("group")} value={p.riskGrouping} options={["department-site", "department", "site"].map(value => ({ value, label: t(value as typeof p.riskGrouping) }))} onValueChange={value => change({ riskGrouping: value as typeof p.riskGrouping, riskGroup: "" })} /></label> : null}</header><div className={styles.tableScroll}><table className={styles.distributionTable}><thead><tr><th>{t(p.riskGrouping)}</th><th>{t("distribution")}</th>{categories.filter(kind => kind !== "unknown" || totals.unknown).map(kind => <th key={kind}>{t(kind === "near" ? "approaching" : kind)}</th>)}<th>{t("total")}</th><th>{t("exposure")}</th></tr></thead><tbody>{[...groups, { name: t("total"), ...totals }].map((row, i) => <tr key={row.name} className={i === groups.length ? styles.totalRow : ""}><th>{i === groups.length ? row.name : <button type="button" onClick={() => drill("all", row.name)}>{row.name}</button>}</th><td><RiskBar totals={row} label={categories.map(kind => `${t(kind === "near" ? "approaching" : kind)} ${row[kind]}`).join(", ")} /></td>{categories.filter(kind => kind !== "unknown" || totals.unknown).map(kind => <td key={kind}>{row[kind]}</td>)}<td><strong>{row.open}</strong></td><td className={row.exposure && row.exposure > .5 ? styles.bad : ""}>{format(row.exposure)}</td></tr>)}</tbody></table></div><div className={styles.legend}>{categories.filter(kind => kind !== "unknown" || totals.unknown).map(kind => <span key={kind}><i className={`${styles.dot} ${styles[kind]}`} />{t(kind === "near" ? "approaching" : kind)}</span>)}</div></section>
      <section className={styles.panel}><header className={styles.sectionHead}><h3>{t("needs")}</h3><Button type="button" size="toolbar" variant="ghost" onClick={() => drill("priority")}>{t("viewAll")} ({priorityCount})</Button></header><p className={styles.note}>{language === "th" ? "รายการความเสี่ยงโหลดแยกตามหน้าที่เลือก เพื่อให้ยอดสรุปครบถ้วน" : "Risk rows load separately for the selected page; summary totals include every matching requisition."}</p></section>
    </div>
          <section ref={exportMode ? undefined : actionRef} tabIndex={-1} className={styles.panel} aria-label={t("requisitions")}><header className={styles.sectionHead}><h3>{t("requisitions")} <small>({exportMode ? actionRows.length : pageData?.total ?? 0})</small></h3>{!exportMode ? <CommandSelector typography="normal" ariaLabel={t("risk")} emptyLabel={t("risk")} value={p.riskFilter} options={["attention", "all", "track", "near", "overdue", "unknown", "priority"].map(value => ({ value, label: t(value as RiskFilter) }))} onValueChange={value => change({ riskFilter: value })} /> : null}</header><div className={styles.chips}><span>{t(p.riskFilter as RiskFilter)}</span>{p.riskGroup ? <button type="button" onClick={() => change({ riskGroup: "" })}>{p.riskGroup}<X size={13} /></button> : null}{!exportMode ? <button type="button" onClick={() => change({ riskFilter: "all", riskGroup: "" })}>{t("clear")}</button> : null}</div>{!exportMode && riskPageState?.status === "error" ? <p role="alert" className={styles.empty}>{language === "th" ? "โหลดรายการไม่สำเร็จ" : "Could not load risk rows."}</p> : !exportMode && (riskPageState?.status !== "ready" || riskPageState.key!==riskPageKey || !pageData) ? <p role="status" className={styles.empty}>{language === "th" ? "กำลังโหลดรายการ..." : "Loading risk rows..."}</p> : <><div className={styles.tableScroll}><table className={styles.riskActionTable}><thead><tr>{["position", "site", "open", "age", "remaining", "pic", "review"].map(key => <th key={key}>{t(key as "position")}</th>)}</tr></thead><tbody>{actionRows.map(row => <tr key={row.docId}><td><strong>{row.position}</strong><small>{row.docId} · {row.department}</small></td><td>{row.site}</td><td>{row.open}</td><td title={row.restartDate ? `${t("restart")} · ${row.restartDate}` : undefined}>{row.age === null ? "—" : `${row.age} ${t("days")}`}</td><td><span tabIndex={row.restartDate ? 0 : undefined} title={row.restartDate ? `${t("restart")} · ${row.restartDate}` : undefined} aria-describedby={row.restartDate ? exportMode ? "risk-export-restart-remark" : "risk-restart-remark" : undefined} className={`${styles.badge} ${styles[row.kind + "Badge"]}`}>{row.remaining === null ? t("unknown") : `${row.remaining} ${t("days")}`}{row.restartDate ? "*" : ""}</span></td><td>{row.personInCharge || "—"}</td><td>{exportMode ? t("review") : <Button type="button" size="toolbar" variant="secondary" onClick={() => context.onOpenRequisition?.({doc_id:row.docId,site:row.site,department:row.department,position:row.position,level:row.level,head_count:row.headCount,person_in_charge:row.personInCharge})}>{t("review")} <ChevronRight size={14} /></Button>}</td></tr>)}</tbody></table>{!actionRows.length ? <p className={styles.empty}>{t("empty")}</p> : null}</div>{!exportMode ? <div className={styles.pagination}><Button type="button" size="toolbar" variant="secondary" disabled={!pageNumber} onClick={()=>setPageNumber(value=>Math.max(0,value-1))}>{t("previous")}</Button><span>{t("page")} {pageNumber+1} · {pageData!.total}</span><Button type="button" size="toolbar" variant="secondary" disabled={!pageData?.hasMore} onClick={()=>{if(!pageData?.nextCursor)return;setCursorStack(current=>[...current.slice(0,pageNumber),pageData.nextCursor]);setPageNumber(value=>value+1);}}>{t("next")}</Button></div> : null}</>}{actionRows.some(row => row.restartDate) ? <p id={exportMode ? "risk-export-restart-remark" : "risk-restart-remark"} className={styles.note} data-sla-restart-remark>{t("restartRemark")}</p> : null}</section>
    <p className={styles.note}>{t("history")}</p>
  </div>; }
  if (context.riskSummaryStatus !== "ready" || !report) return <div className="rounded-xl border border-[#E4E9F2] bg-white p-5">{context.riskSummaryStatus === "error" ? <><p role="alert" className="text-sm text-danger">{language === "th" ? "โหลดสรุปความเสี่ยงไม่สำเร็จ" : "Could not load the risk summary."}</p><Button type="button" size="toolbar" className="mt-3" onClick={context.onRetryRiskSummary}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</Button></> : <p role="status" className="text-sm text-slate">{language === "th" ? "กำลังโหลดสรุปความเสี่ยง..." : "Loading risk summary..."}</p>}</div>;
  return <RiskReportFrame title={t("riskTitle")} language={language} summary={`${t("asOf")} ${report.asOf} · ${context.summary}`} filename={`vacancy-risk-${report.asOf}`} render={render} workbook={exportRiskWorkbook} preparePng={preparePng} />;
}
