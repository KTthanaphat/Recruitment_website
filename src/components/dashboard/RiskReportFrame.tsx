"use client";
import { useRef, useState, type ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { DashboardExportChooser } from "./DashboardExportChooser";
import { riskCopy } from "./risk-copy";
import { downloadDashboardWorkbook, type ReportExportSnapshot } from "@/lib/dashboard-workbook";
import type { Language } from "@/types/recruitment";
import { formatCompactDateRange } from "@/lib/format";
import styles from "./risk-reports.module.css";
export function RiskReportFrame({ title, summary, language, filename, render, workbook }: { title: string; summary: string; language: Language; filename: string; render: (exportMode: boolean) => ReactNode; workbook: () => ReportExportSnapshot }) {
  const [image, setImage] = useState<ReactNode>(null);
  const ref = useRef<HTMLDivElement>(null);
  async function png() {
    setImage(render(true));
    try {
      await document.fonts.ready;
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const surface = ref.current;
      if (!surface) throw new Error("Missing export surface");
      const { toPng } = await import("html-to-image");
      const width = surface.scrollWidth, height = surface.scrollHeight;
      const url = await toPng(surface, { backgroundColor: "#FAFAFC", pixelRatio: 2, cacheBust: true, width, height, style: { opacity: "1", visibility: "visible", position: "static", left: "0", top: "0" } });
      const loaded = new Image();
      await new Promise<void>((resolve, reject) => { loaded.onload = () => resolve(); loaded.onerror = reject; loaded.src = url; });
      const canvas = document.createElement("canvas"); canvas.width = loaded.width; canvas.height = loaded.height;
      const ctx = canvas.getContext("2d"); if (!ctx || width < 2 || height < 2) throw new Error("Empty PNG");
      ctx.drawImage(loaded, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonblank = false;
      for (let i = 0; i < pixels.length; i += Math.max(4, Math.floor(pixels.length / 16000) * 4)) if (pixels[i] < 225 || pixels[i + 1] < 225 || pixels[i + 2] < 225) { nonblank = true; break; }
      if (!nonblank) throw new Error("Blank PNG");
      const link = document.createElement("a"); link.href = url; link.download = `${filename}.png`; link.click();
    } finally { setImage(null); }
  }
  return <section className={styles.root} aria-label={title} data-risk-report>
    <header className={styles.reportHeader}>
      <div className={styles.reportIdentity}>
        <span className={styles.headingIcon}><BarChart3 size={18} /></span><div><h2>{title}</h2><small>{summary}</small></div>
      </div>
      <DashboardExportChooser language={language} title={title} summary={summary} pngLabel={`${title} PNG`} onPng={png} onExcel={async () => { const captured = workbook(); await downloadDashboardWorkbook(captured); }} />
    </header>
    <div>{render(false)}</div>
    <div className={`export-report-surface ${styles.root} ${styles.export}`} ref={ref} aria-hidden="true" data-risk-export>
      <h2>{title}</h2><p className={styles.note}>{summary}</p>{image}
    </div>
  </section>;
}
export function MiniTrend({ values, label, tone = "blue" }: { values: (number | null)[]; label: string; tone?: string }) {
  const valid = values.filter((value): value is number => value !== null), maximum = Math.max(1, ...valid);
  return <svg className={`${styles.spark} ${styles[tone] ?? ""}`} viewBox="0 0 160 32" role="img" aria-label={label}>
    {values.map((value, i) => value === null ? null : <rect key={i} x={i * 20 + 2} y={30 - value / maximum * 26} width="13" height={Math.max(2, value / maximum * 26)} rx="0" />)}
  </svg>;
}
export function Comparison({ value, prior, range, days, language }: { value: number | null; prior: number | null | undefined; range: { start: string; end: string }; days?: boolean; language: Language }) {
  const t = riskCopy(language);
  if (prior === null || prior === undefined || value === null) return <small className={styles.note}>{t("noTrend")}</small>;
  const change = value - prior;
  return <small className={change > 0 ? styles.bad : styles.good}>{change > 0 ? "↑ +" : change < 0 ? "↓ " : ""}{Number(change.toFixed(1))}{days ? ` ${t("days")}` : prior ? ` (${change > 0 ? "+" : ""}${(change / prior * 100).toFixed(1)}%)` : ""} · {formatCompactDateRange(range)}</small>;
}
