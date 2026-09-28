"use client";

import { ChevronDown, ImageDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CommandSelector } from "@/components/ui/CommandSelector";
import { CommandMultiSelector } from "@/components/ui/CommandMultiSelector";
import { todayDate } from "@/lib/sla";
import { formatDate } from "@/lib/format";
import { readWorkspaceUrlState, updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import { buildPerformanceReport, performanceRange, previousPerformanceRange, type PerformancePeriod } from "@/lib/recruitment-performance";
import { orderedReportSites, PerformanceReport, performanceCopy } from "./PerformanceReport";
import styles from "./performance.module.css";
import type { DashboardData, EnrichedOffer, EnrichedRequisition, Language } from "@/types/recruitment";

export function RecruitmentPerformanceOverview({ language, data, requisitions, offers, globalSite = "", globalOwner = "" }: { language: Language; data: DashboardData; requisitions: EnrichedRequisition[]; offers: EnrichedOffer[]; globalSite?: string; globalOwner?: string }) {
  const t = performanceCopy[language], today = todayDate();
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const [period, setPeriod] = useState<PerformancePeriod>("mtd");
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [selectedSites, setSelectedSites] = useState<string[]>([]);
  const [selectedDepartments, setSelectedDepartments] = useState<string[]>([]);
  const [urlReady, setUrlReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const range = useMemo(() => performanceRange(period, year, month, today), [period, year, month, today]);
  const previous = useMemo(() => previousPerformanceRange(period, range), [period, range]);
  const selectedRequisitions = useMemo(() => requisitions.filter(row => (!selectedSites.length || selectedSites.includes(row.site)) && (!selectedDepartments.length || selectedDepartments.includes(row.department))), [requisitions, selectedSites, selectedDepartments]);
  const report = useMemo(() => buildPerformanceReport(data, selectedRequisitions, offers, range, period), [data, selectedRequisitions, offers, range, period]);
  const priorReport = useMemo(() => buildPerformanceReport(data, selectedRequisitions, offers, previous, period), [data, selectedRequisitions, offers, previous, period]);
  const sites = useMemo(() => orderedReportSites(requisitions.map(row => row.site)), [requisitions]);
  const chartSites = useMemo(() => orderedReportSites(selectedRequisitions.map(row => row.site)), [selectedRequisitions]);
  const departments = useMemo(() => [...new Set(requisitions.filter(row => !selectedSites.length || selectedSites.includes(row.site)).map(row => row.department).filter(Boolean))].sort(), [requisitions, selectedSites]);
  const yearOptions = useMemo(() => {
    const values = requisitions.map(row => Number(row.pr_approved_date?.slice(0, 4))).filter(Number.isFinite);
    const from = Math.min(year, Number(today.slice(0, 4)), ...values);
    const to = Math.max(year, Number(today.slice(0, 4)), ...values);
    return Array.from({ length: Math.min(30, to - from + 1) }, (_, index) => String(to - index));
  }, [requisitions, today, year]);
  const monthLabel = (value: number) => new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, value - 1, 1)));

  useEffect(() => {
    const params = readWorkspaceUrlState();
    const p = params.get("overviewPeriod"), y = Number(params.get("overviewYear")), m = Number(params.get("overviewMonth"));
    if (p === "mtd" || p === "ytd" || p === "pim") setPeriod(p);
    if (Number.isInteger(y) && y >= 2000 && y <= 2100) setYear(y);
    if (Number.isInteger(m) && m >= 1 && m <= 12) setMonth(m);
    setSelectedSites(readSelections(params.get("overviewSite")));
    setSelectedDepartments(readSelections(params.get("overviewDepartment")));
    setUrlReady(true);
  }, []);
  useEffect(() => { if (urlReady) updateWorkspaceUrlState({ overviewPeriod: period, overviewYear: year, overviewMonth: month, overviewSite: serializeSelections(selectedSites), overviewDepartment: serializeSelections(selectedDepartments) }); }, [urlReady, period, year, month, selectedSites, selectedDepartments]);
  useEffect(() => { if (urlReady && requisitions.length) setSelectedSites(values => values.some(value => !sites.includes(value)) ? values.filter(value => sites.includes(value)) : values); }, [urlReady, sites, requisitions.length]);
  useEffect(() => { if (urlReady && requisitions.length) setSelectedDepartments(values => values.some(value => !departments.includes(value)) ? values.filter(value => departments.includes(value)) : values); }, [urlReady, departments, requisitions.length]);

  async function exportPng() {
    const surface = exportRef.current;
    if (!surface) return;
    setExporting(true); setExportError(false);
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
    } catch { setExportError(true); }
    finally { setExporting(false); }
  }

  const metadata = `${formatDate(range.start, language)} – ${formatDate(range.end, language)} · ${period.toUpperCase()} · ${t.site}: ${selectedSites.join(", ") || globalSite || t.all} · ${t.department}: ${selectedDepartments.join(", ") || t.all}${globalOwner ? ` · ${language === "th" ? "ผู้รับผิดชอบ" : "Person in Charge"}: ${globalOwner}` : ""}`;
  return <section className={`${styles.root} ${styles.reportSection}`} aria-label={t.title} data-performance-overview>
    <header className={styles.header}>
      <h2 className={styles.barHeading} aria-label={t.title}><button type="button" className={styles.collapseButton} aria-label={t.title} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(value => !value)}><span><strong>{t.title}</strong><span className={styles.barMetadata}>{metadata}</span></span><ChevronDown size={20} className={expanded ? styles.expandedChevron : ""} aria-hidden="true" /></button></h2>
      <Button type="button" size="sm" variant="secondary" icon={<ImageDown size={14} />} disabled={exporting} onClick={exportPng}>{exporting ? t.loading : t.export}</Button>
    </header>
    <div id={contentId} hidden={!expanded} className={styles.reportContent}>
      <div className={styles.filters}>
        <Selector label={t.period} value={period} description={period === "pim" ? t.pim : period.toUpperCase()} options={[["mtd", "MTD"], ["ytd", "YTD"], ["pim", "PIM"]]} onChange={value => setPeriod(value as PerformancePeriod)} />
        <Selector label={t.year} value={String(year)} options={yearOptions.map(value => [value, value])} onChange={value => setYear(Number(value))} />
        <Selector label={t.month} value={String(month)} options={Array.from({ length: 12 }, (_, index) => [String(index + 1), monthLabel(index + 1)])} onChange={value => setMonth(Number(value))} />
        <div className={styles.filter}><span className={styles.filterLabel}>{t.site}</span><CommandMultiSelector label={t.site} allLabel={t.all} values={selectedSites} options={sites} onChange={setSelectedSites} /></div>
        <div className={styles.filter}><span className={styles.filterLabel}>{t.department}</span><CommandMultiSelector label={t.department} allLabel={t.all} values={selectedDepartments} options={departments} onChange={setSelectedDepartments} /></div>
      </div>
    {exportError ? <p role="alert" className="mb-3 text-sm text-red-600">{t.exportFailed}</p> : null}
    <PerformanceReport report={report} previous={priorReport} language={language} sites={chartSites} period={period} />
    </div>
    <div ref={exportRef} className={`export-report-surface ${styles.root}`} style={{ width: Math.max(1306, 400 + chartSites.length * 240), minWidth: 1306, background: "#FAFAFC" }} aria-hidden="true" data-performance-export>
      <div className={styles.exportTitle}><h2>{t.title}</h2><span>{period === "pim" ? t.pim : period.toUpperCase()}</span></div>
      <p className={styles.exportContext}>{metadata}</p>
      <PerformanceReport report={report} previous={priorReport} language={language} sites={chartSites} period={period} exportMode />
    </div>
  </section>;
}

function readSelections(value: string | null): string[] {
  if (!value) return [];
  try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return [...new Set(parsed.filter((item): item is string => typeof item === "string" && item.length > 0))]; } catch { /* Legacy single selection. */ }
  return [value];
}
function serializeSelections(values: string[]) { return values.length > 1 ? JSON.stringify(values) : values[0] || null; }

function Selector({ label, value, options, onChange, description }: { label: string; value: string; options: string[][]; onChange: (value: string) => void; description?: string }) {
  return <div className={styles.filter} title={description} role={description ? "group" : undefined} aria-label={description}><span className={styles.filterLabel}>{label}</span><CommandSelector ariaLabel={label} emptyLabel={label} value={value} options={options.map(([option, name]) => ({ value: option, label: name }))} onValueChange={onChange} /></div>;
}
