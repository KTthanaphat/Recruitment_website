"use client";
import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { NumberSkeleton, TableSkeletonRows, LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Clock3, UsersRound, Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CommandSelector } from "@/components/ui/CommandSelector";
import { processStageLabel } from "@/lib/i18n/dictionary";
import { enrichRequisitions } from "@/lib/data";
import { BOTTLENECK_STAGES, buildStageBottleneckReport, type DeadlineStatus } from "@/lib/stage-bottleneck-report";
import type { ActiveProcessStage } from "@/types/recruitment";
import { previousPerformanceRange } from "@/lib/recruitment-performance";
import { todayDate } from "@/lib/sla";
import { loadCompletePipelineReportData } from "@/lib/dashboard-report-loader";
import { scopeDashboardRequisitions } from "@/lib/dashboard-filters";
import { loadBottleneckPage, type BottleneckPage } from "@/lib/dashboard-summary-client";
import { formatRecruitmentId } from "@/lib/format";
import { matchesRecruitmentIdSearch } from "@/lib/recruitment-id-search";
import { assertFullContinuationPage } from "@/lib/report-export-pagination";
import { supabase } from "@/lib/supabase/client";
import { buildBottleneckExport } from "@/lib/risk-bottleneck-export";
import type { DashboardReportContext } from "./DashboardPortal";
import { riskCopy } from "./risk-copy";
import { Comparison, MiniTrend, RiskReportFrame } from "./RiskReportFrame";
import styles from "./risk-reports.module.css";

export function StageBottleneckView({ context }: { context: DashboardReportContext }) {
  const { language, data, requisitions, preferences: p, onPreferencesChange: change, range } = context;
  const t = riskCopy(language), actionRef = useRef<HTMLElement>(null), requestSequence = useRef(0);
  const summary = context.bottleneckSummary;
  const today = todayDate(), asOf = range.end < today ? range.end : today;
  const priorRange = previousPerformanceRange(p.period, { start: range.start, end: asOf });
  const [page, setPage] = useState<BottleneckPage | null>(null), [pageLoading, setPageLoading] = useState(false), [pageError, setPageError] = useState(false);
  const [loadedPageKey, setLoadedPageKey] = useState("");
  const [cursor, setCursor] = useState<{ value: string; id: string } | null>(null), [before, setBefore] = useState(false);
  const [search, setSearch] = useState(p.queueSearch), [debouncedSearch, setDebouncedSearch] = useState(p.queueSearch);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search), 300); return () => window.clearTimeout(timer); }, [search]);
  const [pageRetry, setPageRetry] = useState(0);
  const profileKey = `${data.profile?.id ?? ""}:${data.profile?.role ?? ""}:${data.profile?.site ?? ""}:${data.profile?.updated_at ?? ""}`;
  const scope = useMemo(() => ({ headerSite: context.headerScope.site, headerPic: context.headerScope.owner, priorityOnly: context.headerScope.priorityOnly,
    sites: p.sites ?? [], departments: p.departments ?? [], levels: p.levels ?? [] }), [context.headerScope.site, context.headerScope.owner, context.headerScope.priorityOnly, p.sites, p.departments, p.levels]);
  const queueKey = JSON.stringify([profileKey, asOf, scope, p.funnelChannel, p.queueStage, p.queueStatus, p.queuePic, debouncedSearch]);
  const [cursorScope, setCursorScope] = useState(queueKey);
  const scopedCursor = cursorScope === queueKey ? cursor : null;
  const scopedBefore = cursorScope === queueKey && before;
  useEffect(() => { setCursorScope(queueKey); setCursor(null); setBefore(false); setPage(null); }, [queueKey]);
  const pageIdentity = JSON.stringify([queueKey, scopedCursor, scopedBefore]);
  useEffect(() => {
    if (!supabase || !range.valid || range.start > asOf) return;
    const controller = new AbortController();
    let alive = true; const sequence = ++requestSequence.current; setPageLoading(true); setPageError(false);
    loadBottleneckPage(supabase, { asOf, scope, channel: p.funnelChannel, stage: p.queueStage, status: p.queueStatus, pic: p.queuePic, search: debouncedSearch,
      cursor: scopedCursor, before: scopedBefore, profileKey, refreshKey: (context.refreshRevision ?? 0) + pageRetry, signal: controller.signal })
      .then(value => { if (alive && sequence === requestSequence.current) { setPage(value); setLoadedPageKey(pageIdentity); } })
      .catch(() => { if (alive && sequence === requestSequence.current) setPageError(true); })
      .finally(() => { if (alive && sequence === requestSequence.current) setPageLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [asOf, context.refreshRevision, debouncedSearch, p.funnelChannel, p.queuePic, p.queueStage, p.queueStatus, pageIdentity, pageRetry, profileKey, range.start, range.valid, scope, scopedBefore, scopedCursor]);
  const stages = summary?.stages ?? [], rows = loadedPageKey === pageIdentity ? page?.rows ?? [] : [];
  const status = p.queueStatus === "auto" ? (loadedPageKey === pageIdentity ? page?.resolvedStatus : undefined) ?? (summary?.metrics.overdue ? "overdue" : "all") : p.queueStatus;
  const queueInitialLoading = range.start <= asOf && !pageError && loadedPageKey !== pageIdentity;
  const stageLabel = (stage: string) => processStageLabel(language, stage as ActiveProcessStage);
  const fmt = (value: number | null) => value === null ? "—" : `${Number(value.toFixed(1))}${language === "th" ? " วัน" : "d"}`;
  function patch(values: Parameters<typeof change>[0]) { change(values); setCursor(null); setBefore(false); }
  function drill(stage: string) { patch({ queueStage: stage, queueStatus: "all" }); requestAnimationFrame(() => { actionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); actionRef.current?.focus(); }); }
  const maxDuration = Math.max(5, ...stages.map(row => row.p90 ?? 0)), axisMax = Math.ceil(maxDuration / 5) * 5;
  const maxQueue = Math.max(1, ...stages.map(row => row.waiting));
  const localScope = `${t("status")}: ${status === "all" ? t("all") : t(status as DeadlineStatus)} · ${t("stage")}: ${p.queueStage || t("all")} · ${t("pic")}: ${p.queuePic || t("all")} · ${t("search")}: ${debouncedSearch || "—"}`;
  const summaryReady = Boolean(summary);
  async function workbook() {
    if (!supabase) throw new Error("Dashboard connection is unavailable");
    const fullData = await loadCompletePipelineReportData(supabase, data);
    const headerRows = enrichRequisitions(fullData).filter(row => (!context.headerScope.site || row.site === context.headerScope.site)
      && (!context.headerScope.owner || row.person_in_charge?.toLocaleLowerCase() === context.headerScope.owner.toLocaleLowerCase())
      && (!context.headerScope.priorityOnly || row.is_priority));
    const completeReqs = scopeDashboardRequisitions(headerRows, p, context.supportedFilters);
    const report = buildStageBottleneckReport(fullData, completeReqs, range, today, priorRange, p.funnelChannel);
    const exportStatus = p.queueStatus === "auto" ? (report.metrics.overdue ? "overdue" : "all") : p.queueStatus;
    const exportRows = report.waiting.filter(row => (exportStatus === "all" || row.status === exportStatus) && (!p.queueStage || row.instance.stage === p.queueStage)
      && (!p.queuePic || row.requisitions.some(req => req.person_in_charge === p.queuePic))
      && (!debouncedSearch || [row.candidate.candidate_id, row.candidate.group_id, ...row.requisitions.map(req => req.doc_id)].some(id => matchesRecruitmentIdSearch(id, debouncedSearch))
        || [row.candidate.name, row.instance.stage, ...row.requisitions.map(req => `${req.position} ${req.site} ${req.department}`)].join(" ").toLocaleLowerCase().includes(debouncedSearch.toLocaleLowerCase())));
    const exportContext = { ...context, data: fullData, requisitions: completeReqs };
    return buildBottleneckExport(exportContext, report, exportRows, localScope);
  }
  async function preparePng() {
    if (!supabase) throw new Error("Dashboard connection is unavailable");
    const exportSummary = await context.loadBottleneckExportSummary?.() ?? summary;
    if (!exportSummary) throw new Error("Bottleneck summary is unavailable");
    const collected: BottleneckPage["rows"] = [], seenRows = new Set<string>(), seenCursors = new Set<string>();
    let next: BottleneckPage["nextCursor"] = null;
    for (let pageNumber = 0; pageNumber < 10_000; pageNumber++) {
      const result = await loadBottleneckPage(supabase, { asOf, scope, channel: p.funnelChannel, stage: p.queueStage, status, pic: p.queuePic,
        search: debouncedSearch, cursor: next, before: false, profileKey });
      for (const row of result.rows) {
        if (!row.instance?.id || seenRows.has(row.instance.id)) throw new Error("Bottleneck queue export contains duplicate or invalid rows; retry");
        seenRows.add(row.instance.id); collected.push(row);
      }
      if (!result.hasMore) {
        if (p.queueStage === "" && status === "all" && !p.queuePic && !debouncedSearch && exportSummary.channel === p.funnelChannel
          && exportSummary.metrics.waiting !== collected.length) throw new Error("Bottleneck queue export does not match the frozen summary; retry");
        return render(true, collected, exportSummary);
      }
      const following = result.nextCursor;
      assertFullContinuationPage(result.hasMore, result.rows.length, 20, "Bottleneck queue");
      if (!following) throw new Error("Bottleneck queue export is incomplete; retry");
      const token = `${following.value}\u001f${following.id}`;
      if (seenCursors.has(token) || next && token === `${next.value}\u001f${next.id}`) throw new Error("Bottleneck queue export cursor did not advance; retry");
      seenCursors.add(token); next = following;
    }
    throw new Error("Bottleneck queue export exceeded its page limit; retry");
  }
  function render(exportMode: boolean, exportedRows?: BottleneckPage["rows"], reportSummary = summary) { const summary = reportSummary; const displayRows = exportMode ? exportedRows ?? [] : rows; return <div className={styles.content}>
    {!summaryReady ? <div role={context.bottleneckSummaryStatus === "error" ? "alert" : "status"} className={styles.notice}>{context.bottleneckSummaryStatus === "error" ? <>{t("unavailable")} <RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Stage Bottleneck`} type="button"   onClick={context.onRetryBottleneckSummary}>{t("retry")}</RetryIconButton></> : <LoadingSkeleton variant="chart" language={language} label={t("loading")} />}</div> : null}
    {summary ? <>
    <div className={styles.stageToolbar}>{!exportMode ? <label className={styles.inlineField}><span>{t("channel")}</span><CommandSelector typography="normal" ariaLabel={t("channel")} emptyLabel={t("all")} value={p.funnelChannel} options={[{ value: "all", label: t("all") }, ...summary.channelOptions.map(value => ({ value, label: value }))]} onValueChange={value => change({ funnelChannel: value, queueStage: "", queueStatus: "auto", queuePic: "", queueSearch: "" })} /></label> : <p>{t("channel")}: {p.funnelChannel}</p>}<small>{t("asOf")} {summary.asOf}</small></div>
    {summary.future ? <p className={styles.notice}>{t("future")}</p> : null}
    {exportMode ? <div className={styles.stageKpis}>{(["waiting", "median", "overdue", "longest"] as const).map((key, i) => <section className={styles.stageKpi} key={key}>
      <span className={styles.kpiTop}><span className={`${styles.kpiIcon} ${i === 0 ? styles.blueSurface : i === 2 ? styles.amberSurface : styles.redSurface}`}>{i === 0 ? <UsersRound size={16} /> : i === 2 ? <AlertTriangle size={16} /> : <Clock3 size={16} />}</span><strong>{t(key === "overdue" ? summary.metrics.unavailable ? "knownPast" : "past" : key)}</strong></span>
      <b className={styles.summaryValue} data-bottleneck-metric={key}>{key === "median" || key === "longest" ? fmt(summary.metrics[key]) : summary.metrics[key]}</b>
      <small className={styles.summaryContext}>{key === "median" || key === "longest" ? t("days") : t("candidate")}</small>
      <MiniTrend values={summary.trends.map(row => row[key])} label={`${t(key === "overdue" ? "past" : key)}: ${summary.trends.map(row => `${row.date} ${row[key] ?? "—"}`).join(", ")}`} />
      <Comparison value={summary.metrics[key]} prior={key === "overdue" && (summary.metrics.unavailable || summary.priorMetrics?.unavailable) ? null : summary.priorMetrics?.[key]} days={key === "median" || key === "longest"} range={summary.priorRange} language={language} />
    </section>)}</div> : null}
    {summary.metrics.unavailable ? <p className={styles.notice}>{t("unavailable")}: {summary.metrics.unavailable}. {t("knownDue")}</p> : null}
    <section className={styles.bottleneckBanner}><AlertTriangle size={18} /><div className={styles.bannerTitle}><h3>{summary.primary ? `${t("primary")}: ${stageLabel(summary.primary.stage)}` : t("noPrimary")}</h3>{summary.primary ? <p>{summary.metrics.waiting ? (summary.primary.waiting / summary.metrics.waiting * 100).toFixed(1) : "0.0"}% · {t("waiting")} · {t("durationHint")}</p> : null}</div>{summary.primary ? <><div><strong>{summary.primary.waiting}</strong><small>{t("waiting")}</small></div><div><strong>{fmt(summary.primary.median)}</strong><small>{t("median")}</small></div><div><strong>{fmt(summary.primary.p90)}</strong><small>P90</small></div><div><strong>{fmt(summary.primary.oldest)}</strong><small>{t("oldest")}</small></div><Button type="button" size="toolbar" variant="secondary" onClick={() => drill(summary.primary!.stage)}>{t("viewCandidates")} <ChevronRight size={14} /></Button></> : null}</section>
    <div className={styles.twoColumns}>
      <section className={styles.panel}><header className={styles.sectionHead}><div><h3>{t("duration")}</h3><small>{t("durationHint")}</small></div></header><div className={styles.durationLegend}><span><i className={styles.medianDot} />{t("median")}</span><span><i className={styles.p90Dot} />P90</span></div><div className={styles.tableScroll}><table className={styles.durationTable}><thead><tr><th>{t("stage")}</th><th><div className={styles.axis}>{Array.from({ length: 5 }, (_, i) => <span key={i}>{Number((axisMax * i / 4).toFixed(1))}</span>)}</div></th><th>{t("median")}</th><th>P90</th><th>{t("sample")}</th></tr></thead><tbody>{stages.map(row => <tr key={row.stage} className={row.stage === summary.primary?.stage ? styles.highlight : ""}><th><button type="button" onClick={() => drill(row.stage)}>{stageLabel(row.stage)}</button></th><td><div className={styles.durationPlot} title={`${t("sample")}: ${row.sample}${row.sample > 0 && row.sample < 5 ? ` · ${t("small")}` : ""}`} role="img" aria-label={`${stageLabel(row.stage)}, ${t("median")} ${fmt(row.median)}, P90 ${fmt(row.p90)}, N ${row.sample}`}>
        {row.median !== null && row.p90 !== null ? <><span className={styles.rangeLine} style={{ left: `${row.median / axisMax * 100}%`, width: `${(row.p90 - row.median) / axisMax * 100}%` }} /><span className={styles.medianDot} style={{ left: `${row.median / axisMax * 100}%` }} /><span className={styles.p90Dot} style={{ left: `${row.p90 / axisMax * 100}%` }} /></> : <span className={styles.note}>—</span>}
      </div></td><td>{fmt(row.median)}</td><td>{fmt(row.p90)}</td><td title={row.sample > 0 && row.sample < 5 ? t("small") : undefined}>{row.sample}{row.sample > 0 && row.sample < 5 ? " *" : ""}</td></tr>)}</tbody></table></div><p className={styles.note}>{t("excluded")}: {summary.excluded} · {t("conflicts")}: {summary.conflicts}</p></section>
      <section className={styles.panel}><header className={styles.sectionHead}><h3>{t("queue")}</h3></header><div className={styles.tableScroll}><table><thead><tr><th>{t("stage")}</th><th>{t("waiting")}</th><th>{t("oldest")}</th></tr></thead><tbody>{stages.map(row => <tr key={row.stage} className={row.stage === summary.primary?.stage ? styles.highlight : ""}><th><button type="button" onClick={() => drill(row.stage)}>{stageLabel(row.stage)}</button></th><td><div className={styles.queueCount}><span className={styles.queueBar}><i style={{ width: `${row.waiting / maxQueue * 100}%` }} /></span><strong>{row.waiting}</strong></div></td><td>{fmt(row.oldest)}</td></tr>)}</tbody></table></div></section>
    </div>
    </> : null}
    <section className={styles.panel} ref={exportMode ? undefined : actionRef} tabIndex={-1} aria-label={t("actions")}><header className={styles.sectionHead}><h3>{t("actions")}</h3></header>
      {!exportMode ? <><div className={styles.queueFilters}><div className={styles.statusTabs} role="group" aria-label={t("status")}>{(["overdue", "today", "upcoming", "all", "unscheduled", "unavailable"] as const).filter(key => key === "all" || !summary || (summary.statusCounts[key] ?? 0) > 0).map(key => <button type="button" key={key} aria-pressed={status === key} className={status === key ? styles.selected : ""} onClick={() => patch({ queueStatus: key })}>{t(key)} <b>{summary ? key === "all" ? summary.metrics.waiting : summary.statusCounts[key] ?? 0 : "—"}</b></button>)}</div><label className={styles.search}><Search size={16} /><input aria-label={t("search")} placeholder={t("search")} value={search} onChange={event => setSearch(event.target.value)} /></label><CommandSelector typography="normal" ariaLabel={t("stage")} emptyLabel={t("all")} value={p.queueStage} options={[{ value: "", label: `${t("stage")} · ${t("all")}` }, ...BOTTLENECK_STAGES.map(value => ({ value, label: stageLabel(value) }))]} onValueChange={value => patch({ queueStage: value })} /><CommandSelector typography="normal" ariaLabel={t("pic")} emptyLabel={t("all")} value={p.queuePic} options={[{ value: "", label: `${t("pic")} · ${t("all")}` }, ...(summary?.picOptions ?? []).map(value => ({ value, label: value }))]} onValueChange={value => patch({ queuePic: value })} /></div><div className={styles.chips}>{p.queueStage ? <button type="button" onClick={() => patch({ queueStage: "" })}>{p.queueStage}</button> : null}{p.queuePic ? <button type="button" onClick={() => patch({ queuePic: "" })}>{p.queuePic}</button> : null}<button type="button" onClick={() => { setSearch(""); patch({ queueStatus: "all", queueStage: "", queuePic: "", queueSearch: "" }); }}>{t("clear")}</button></div></> : <p className={styles.note}>{localScope}</p>}
      {pageError ? <p role="alert" className={styles.notice}>{t("unavailable")} <RetryIconButton type="button" onClick={() => setPageRetry(value => value + 1)}>{t("retry")}</RetryIconButton></p> : null}
      <div className={styles.tableScroll}><table><thead><tr>{["candidate", "position", "stage", "waiting", "due", "pic", "status", "follow"].map(key => <th key={key}>{t(key as "candidate")}</th>)}</tr></thead><tbody aria-busy={pageLoading || queueInitialLoading}>{!exportMode && (pageLoading || queueInitialLoading) && !displayRows.length ? <TableSkeletonRows language={language} columns={[{},{},{},{kind:"number"},{kind:"date"},{},{},{kind:"action"}]}/> : null}{displayRows.map(row => <tr key={row.instance.id}><td><strong>{row.candidate.name}</strong><small aria-label={formatRecruitmentId(row.candidate.candidate_id)}>{formatRecruitmentId(row.candidate.candidate_id)}</small></td><td>{row.requisitions.map(req => <span key={req.doc_id} className={styles.positionContext}>{req.position}<small>{req.doc_id} · {req.site} · {req.department}</small></span>)}</td><td><span className={`${styles.badge} ${styles.trackBadge}`}>{stageLabel(row.instance.stage)}</span></td><td><strong className={row.status === "overdue" ? styles.bad : ""}>{fmt(row.wait)}</strong></td><td>{row.status === "unavailable" ? "—" : row.instance.due ?? "—"}</td><td>{[...new Set(row.requisitions.map(req => req.person_in_charge).filter(Boolean))].join(", ") || "—"}</td><td><span className={`${styles.badge} ${styles[row.status === "overdue" ? "overdueBadge" : row.status === "today" ? "nearBadge" : "unknownBadge"]}`}>{t(row.status)}</span></td><td>{exportMode ? t("follow") : <Button type="button" size="toolbar" variant="secondary" onClick={() => context.onOpenCandidate?.(row.candidate.candidate_id, row.candidate.application_id)}>{t("follow")} <ChevronRight size={14} /></Button>}</td></tr>)}</tbody></table>{!displayRows.length && !pageLoading && !queueInitialLoading && !pageError ? <p className={styles.empty}>{t("empty")}</p> : null}</div>
      {!exportMode ? <div className={styles.pagination}><Button type="button" size="toolbar" variant="secondary" disabled={!page?.hasMoreBefore || pageLoading} onClick={() => { setCursor(page?.previousCursor ?? null); setBefore(true); }}> {t("previous")}</Button><span>{loadedPageKey === pageIdentity ? rows.length : pageError ? "—" : <NumberSkeleton/>}</span><Button type="button" size="toolbar" variant="secondary" disabled={!page?.hasMore || pageLoading} onClick={() => { setCursor(page?.nextCursor ?? null); setBefore(false); }}>{t("next")}</Button></div> : null}
    </section><p className={styles.note}>{t("history")}</p>
  </div>; }
  return <RiskReportFrame title={t("stageTitle")} language={language} summary={`${range.start} – ${summary?.asOf ?? asOf} · ${context.summary}`} filename={`stage-bottlenecks-${range.start}-to-${summary?.asOf ?? asOf}`} render={render} workbook={workbook} preparePng={preparePng} />;
}
