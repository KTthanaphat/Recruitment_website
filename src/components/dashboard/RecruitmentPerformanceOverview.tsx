"use client";

import { useMemo, useRef, useState } from "react";
import { DashboardExportChooser } from "./DashboardExportChooser";
import { buildPerformanceExportSnapshot, downloadDashboardWorkbook } from "@/lib/dashboard-workbook";
import { translate } from "@/lib/i18n/dictionary";
import { buildPerformanceReport, previousPerformanceRange } from "@/lib/recruitment-performance";
import { orderedReportSites, PerformanceReport, performanceCopy } from "./PerformanceReport";
import styles from "./performance.module.css";
import type { DashboardReportContext } from "./DashboardPortal";

export function RecruitmentPerformanceOverview({ context }: { context: DashboardReportContext }) {
  const { language, data, requisitions, offers, range, summary: metadata, preferences } = context;
  const t = performanceCopy[language], period = preferences.period;
  const exportRef = useRef<HTMLDivElement | null>(null);
  const previous = useMemo(() => previousPerformanceRange(period, { start: range.start, end: range.end }), [period, range.start, range.end]);
  const report = useMemo(() => buildPerformanceReport(data, requisitions, offers, { start: range.start, end: range.end }, period), [data, requisitions, offers, range.start, range.end, period]);
  const priorReport = useMemo(() => buildPerformanceReport(data, requisitions, offers, previous, period), [data, requisitions, offers, previous, period]);
  const chartSites = useMemo(() => orderedReportSites(requisitions.map(row => row.site)), [requisitions]);

  const [pngSnapshot, setPngSnapshot] = useState<{ report: typeof report; previous: typeof priorReport; metadata: string; sites: string[]; period: typeof period; language: typeof language } | null>(null);
  const png = pngSnapshot ?? { report, previous: priorReport, metadata, sites: chartSites, period, language };
  async function exportExcel() {
    const snapshot = buildPerformanceExportSnapshot(context, report, priorReport, chartSites);
    await downloadDashboardWorkbook(snapshot);
  }
  async function exportPng() {
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
      <DashboardExportChooser language={language} title={t.title} summary={metadata} pngLabel={t.export} disabled={!range.valid} onPng={exportPng} onExcel={exportExcel} />
    </header>
    <div className={styles.reportContent}>
    <PerformanceReport report={report} previous={priorReport} language={language} sites={chartSites} period={period} />
    </div>
    <div ref={exportRef} className={`export-report-surface ${styles.root}`} style={{ width: Math.max(1306, 400 + png.sites.length * 240), minWidth: 1306, background: "#FAFAFC" }} aria-hidden="true" data-performance-export>
      <div className={styles.exportTitle}><h2>{t.title}</h2><span>{png.period === "pim" ? t.pim : png.period.toUpperCase()}</span></div>
      <p className={styles.exportContext}>{png.metadata}</p>
      <PerformanceReport report={png.report} previous={png.previous} language={png.language} sites={png.sites} period={png.period} exportMode />
    </div>
  </section>;
}
