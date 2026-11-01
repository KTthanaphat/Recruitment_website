"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DashboardExportChooser } from "./DashboardExportChooser";
import { buildPerformanceExportSnapshot, downloadDashboardWorkbook } from "@/lib/dashboard-workbook";
import { translate } from "@/lib/i18n/dictionary";
import { buildPerformanceReport, previousPerformanceRange } from "@/lib/recruitment-performance";
import { orderedReportSites, PerformanceReport, performanceCopy } from "./PerformanceReport";
import styles from "./performance.module.css";
import type { DashboardReportContext } from "./DashboardPortal";
import { supabase } from "@/lib/supabase/client";
import { loadPerformanceSummary, type PerformanceSummaryRange } from "@/lib/dashboard-summary-client";
import { enrichOffers, enrichRequisitions } from "@/lib/data";
import { dashboardLevelMatches } from "@/lib/dashboard-filters";

export function RecruitmentPerformanceOverview({ context }: { context: DashboardReportContext }) {
  const { language, data, requisitions, offers, range, summary: metadata, preferences } = context;
  const t = performanceCopy[language], period = preferences.period;
  const exportRef = useRef<HTMLDivElement | null>(null);
  const previous = useMemo(() => previousPerformanceRange(period, { start: range.start, end: range.end }), [period, range.start, range.end]);
  const [reportResult, setReportResult] = useState<{ key: string; current: PerformanceSummaryRange; prior: PerformanceSummaryRange } | null>(null);
  const [reportError, setReportError] = useState(false);
  const [retrySummary, setRetrySummary] = useState(0);
  const requestKey = JSON.stringify([range.start, range.end, previous.start, previous.end, period, context.headerScope, preferences.sites, preferences.departments, preferences.levels, context.data.profile?.id, context.data.profile?.updated_at]);
  useEffect(() => {
    if (!range.valid || !supabase) return;
    let cancelled = false; setReportError(false);
    loadPerformanceSummary(supabase, { start: range.start, end: range.end, priorStart: previous.start, priorEnd: previous.end, period,
      scope: { headerSite: context.headerScope.site, headerPic: context.headerScope.owner, priorityOnly: context.headerScope.priorityOnly,
        sites: preferences.sites, departments: preferences.departments, levels: preferences.levels },
      profileKey: `${context.data.profile?.id ?? ""}:${context.data.profile?.updated_at ?? ""}` })
      .then(result => { if (!cancelled) setReportResult({ key: requestKey, current: result.current, prior: result.prior }); })
      .catch(() => { if (!cancelled) setReportError(true); });
    return () => { cancelled = true; };
  }, [requestKey, range.valid, range.start, range.end, previous.start, previous.end, period, context.headerScope.site, context.headerScope.owner, context.headerScope.priorityOnly, context.data.profile?.id, context.data.profile?.updated_at, preferences.sites, preferences.departments, preferences.levels, retrySummary]);
  const report = reportResult?.key === requestKey ? reportResult.current : null;
  const priorReport = reportResult?.key === requestKey ? reportResult.prior : null;
  const chartSites = useMemo(() => orderedReportSites(report?.sites ?? []), [report?.sites]);

  const [pngSnapshot, setPngSnapshot] = useState<{ report: PerformanceSummaryRange; previous: PerformanceSummaryRange; metadata: string; sites: string[]; period: typeof period; language: typeof language } | null>(null);
  const png = pngSnapshot ?? { report, previous: priorReport, metadata, sites: chartSites, period, language };
  async function exportExcel() {
    if (!report || !priorReport) throw new Error("Performance summary is not ready");
    if (!supabase) throw new Error("Report export is unavailable");
    // Export requires the complete atomic company feed; never build workbook rows from a summary or page.
    const { data: raw, error } = await supabase.rpc("app_dashboard_company_report");
    if (error) throw new Error(error.message);
    const source = raw as Partial<Pick<typeof data, "requisitions" | "requisition_logs" | "offers">> | null;
    if (!source || !Array.isArray(source.requisitions) || !Array.isArray(source.requisition_logs) || !Array.isArray(source.offers)) throw new Error("Complete report source is unavailable; retry export");
    const unique = <T,>(rows: T[], key: keyof T) => {
      const ids = rows.map(row => row[key]);
      return ids.every(id => (typeof id === "string" && id.length > 0) || (typeof id === "number" && Number.isFinite(id))) && new Set(ids).size === rows.length;
    };
    if (!unique(source.requisitions, "doc_id") || !unique(source.requisition_logs, "log_id") || !unique(source.offers, "offer_id")) throw new Error("Report source changed during export; retry");
    const exportData = { ...data, requisitions: source.requisitions, requisition_logs: source.requisition_logs, offers: source.offers };
    const inScope = (row: (typeof requisitions)[number]) =>
      (!context.headerScope.site || row.site === context.headerScope.site)
      && (!context.headerScope.owner || row.person_in_charge?.toLocaleLowerCase() === context.headerScope.owner.toLocaleLowerCase())
      && (!context.headerScope.priorityOnly || row.is_priority)
      && (!preferences.sites.length || preferences.sites.includes(row.site))
      && (!preferences.departments.length || preferences.departments.includes(row.department))
      && (!preferences.levels.length || dashboardLevelMatches(row.level, preferences.levels));
    const exportRequisitions = enrichRequisitions(exportData).filter(inScope);
    const reportIds = new Set(exportRequisitions.map(row => row.doc_id));
    const exportOffers = enrichOffers(exportData).filter(row => reportIds.has(row.doc_id));
    const exportContext = { ...context, data: exportData, requisitions: exportRequisitions, offers: exportOffers };
    const exportReport = buildPerformanceReport(exportData, exportRequisitions, exportOffers, { start: range.start, end: range.end }, period);
    const exportPrior = buildPerformanceReport(exportData, exportRequisitions, exportOffers, previous, period);
    const snapshot = buildPerformanceExportSnapshot(exportContext, exportReport, exportPrior, chartSites);
    await downloadDashboardWorkbook(snapshot);
  }
  async function exportPng() {
    if (!report || !priorReport) throw new Error("Performance summary is not ready");
    const surface = exportRef.current;
    if (!surface) throw new Error("Missing export surface");
    setPngSnapshot({ report, previous: priorReport, metadata, sites: chartSites, period, language });
    try {
      const { toPng } = await import("html-to-image");
      await document.fonts.ready;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const width = surface.scrollWidth, height = surface.scrollHeight;
      if (width < 2 || height < 2) throw new Error("Empty export surface");
      const url = await toPng(surface, { backgroundColor: "#FAFAFC", pixelRatio: 2, cacheBust: true, width, height, style: { opacity: "1", position: "static", visibility: "visible", left: "0", top: "0" } });
      const image = new Image();
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No export canvas");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = false;
      for (let index = 0; index < pixels.length; index += Math.max(4, Math.floor(pixels.length / 4000 / 4) * 4)) {
        if (pixels[index] < 240 || pixels[index + 1] < 240 || pixels[index + 2] < 240) { visible = true; break; }
      }
      if (!visible) throw new Error("Blank export");
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `recruitment-performance-${range.start}-to-${range.end}.png`; anchor.click();
    } finally { setPngSnapshot(null); }
  }

  return <section className={`${styles.root} ${styles.reportSection}`} aria-label={t.title} data-performance-overview>
    <header className={styles.header}>
      <h2 className={styles.barHeading} aria-label={t.title}><strong>{t.title}</strong><span className={styles.barMetadata}>{metadata}</span></h2>
      <DashboardExportChooser language={language} title={t.title} summary={metadata} pngLabel={t.export} disabled={!range.valid || !report || !priorReport} onPng={exportPng} onExcel={exportExcel} />
    </header>
    <div className={styles.reportContent}>
      {report && priorReport ? <PerformanceReport report={report} previous={priorReport} language={language} sites={chartSites} period={period} />
        : <div className="p-4 text-sm text-slate"><p role={reportError || !supabase ? "alert" : "status"}>{reportError || !supabase ? (language === "th" ? "โหลดสรุปรายงานไม่สำเร็จ" : "Could not load report summary") : (language === "th" ? "กำลังโหลดสรุปรายงาน…" : "Loading report summary…")}</p>{reportError && supabase ? <button type="button" className="mt-2 rounded-md px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => setRetrySummary(value => value + 1)}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</button> : null}</div>}
    </div>
    <div ref={exportRef} className={`export-report-surface ${styles.root}`} style={{ width: Math.max(1306, 400 + png.sites.length * 240), minWidth: 1306, background: "#FAFAFC" }} aria-hidden="true" data-performance-export>
      <div className={styles.exportTitle}><h2>{t.title}</h2><span>{png.period === "pim" ? t.pim : png.period.toUpperCase()}</span></div>
      <p className={styles.exportContext}>{png.metadata}</p>
      {png.report && png.previous ? <PerformanceReport report={png.report} previous={png.previous} language={png.language} sites={png.sites} period={png.period} exportMode /> : null}
    </div>
  </section>;
}
