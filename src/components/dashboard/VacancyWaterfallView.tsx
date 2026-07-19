"use client";

import { ChevronDown, Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, SelectInput, TextInput } from "@/components/ui/Field";
import { OperationalSummaryStrip } from "@/components/ui/Operations";
import { PipelineFunnel, type PipelineFunnelRow } from "@/components/ui/PipelineFunnel";
import { SortableFilterHeader, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import {
  ACTIVE_PIPELINE_STAGES,
  PIPELINE_FUNNEL_STAGES,
  pipelineDisplayLabel,
  SOURCING_CHANNELS,
  type PipelineDisplayStage
} from "@/lib/constants";
import { currentLocalYearStart, formatLocalDateInput } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";
import { processStageLabel, requestTypeLabel, translate } from "@/lib/i18n/dictionary";
import { getRequisitionSlaState, type RequisitionSlaState, todayDate } from "@/lib/sla";
import { readWorkspaceUrlState, updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import type {
  DashboardData,
  EnrichedOffer,
  EnrichedRequisition,
  Language,
  ProcessStage,
  RequisitionRequestType,
  VacancyWaterfallCategory
} from "@/types/recruitment";

const siteOrder = ["HQ", "KT1", "KT2"];
const detailStages = ACTIVE_PIPELINE_STAGES;
const funnelLevelOptions: Array<{ value: FunnelLevelBand; label: string }> = [
  { value: "all", label: "All levels" },
  { value: "0-3", label: "L0-L3" },
  { value: "4-9", label: "L4-L9" },
  { value: "10-14", label: "L10-L14" }
];

type PrintTarget = "chart" | "requisition-detail" | "pipeline-funnel";
type FunnelLevelBand = "all" | "0-3" | "4-9" | "10-14";
type FunnelChannelFilter = "all" | string;
type FunnelStageCounts = Record<PipelineDisplayStage, number>;

type WaterfallRow = {
  waterfall_category: VacancyWaterfallCategory;
  site: string;
  request_type: RequisitionRequestType;
  vacancy_count: number;
};

type RequisitionDetailRow = {
  doc_id: string;
  site: string;
  department: string;
  position: string;
  level: string;
  vacancy: number;
  applicant_count: number;
  request_type: RequisitionRequestType;
  requisition_date: string;
  person_in_charge: string;
  stage_counts: Record<ProcessStage, number>;
  sla_state: RequisitionSlaState;
  filled_status: "Open" | "Filled";
  filled_date: string | null;
};

export function VacancyWaterfallView({
  language,
  data,
  requisitions,
  offers
}: {
  language: Language;
  data: DashboardData;
  requisitions: EnrichedRequisition[];
  offers: EnrichedOffer[];
}) {
  const [startDate, setStartDate] = useState(currentYearStart());
  const [endDate, setEndDate] = useState(today());
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [funnelStartDate, setFunnelStartDate] = useState(currentYearStart());
  const [funnelEndDate, setFunnelEndDate] = useState(today());
  const [funnelLevelBand, setFunnelLevelBand] = useState<FunnelLevelBand>("all");
  const [funnelChannel, setFunnelChannel] = useState<FunnelChannelFilter>("all");
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [printTarget, setPrintTarget] = useState<PrintTarget | null>(null);
  const [exportPreparing, setExportPreparing] = useState(false);
  const [urlStateReady, setUrlStateReady] = useState(false);
  const printFallbackTimer = useRef<number | null>(null);

  const waterfallRows = useMemo(
    () => buildLiveWaterfallRows(requisitions, offers, startDate, endDate),
    [endDate, offers, requisitions, startDate]
  );
  const requisitionRows = useMemo(
    () => buildOpenedRequisitionRows(data, requisitions, startDate, endDate),
    [data, endDate, requisitions, startDate]
  );
  const funnelRows = useMemo(
    () => buildDashboardPipelineFunnelRows(data, requisitions, funnelStartDate, funnelEndDate, funnelLevelBand, funnelChannel, language),
    [data, funnelChannel, funnelEndDate, funnelLevelBand, funnelStartDate, language, requisitions]
  );
  const funnelApplicantTotal = funnelRows[0]?.count ?? 0;
  const funnelChannelOptions = useMemo(() => buildFunnelChannelOptions(data, language), [data, language]);
  const funnelChannelLabel = channelFilterLabel(funnelChannel, language);
  const localizedFunnelLevelOptions = useMemo(() => buildFunnelLevelOptions(language), [language]);
  const reportSummary = useMemo(() => buildReportSummary(requisitionRows, funnelRows, language), [funnelRows, language, requisitionRows]);

  useEffect(() => {
    const params = readWorkspaceUrlState();
    const queryStart = params.get("start");
    const queryEnd = params.get("end");
    if (queryStart) setStartDate(queryStart);
    if (queryEnd) setEndDate(queryEnd);
    if (params.get("details") === "open") setDetailsOpen(true);
    if (params.get("details") === "closed") setDetailsOpen(false);
    if (params.get("funnelStart")) setFunnelStartDate(params.get("funnelStart")!);
    if (params.get("funnelEnd")) setFunnelEndDate(params.get("funnelEnd")!);
    if (isFunnelLevelBand(params.get("funnelLevel"))) setFunnelLevelBand(params.get("funnelLevel") as FunnelLevelBand);
    if (params.get("funnelChannel")) setFunnelChannel(params.get("funnelChannel")!);
    if (params.get("funnel") === "open") setFunnelOpen(true);
    if (params.get("funnel") === "closed") setFunnelOpen(false);
    setUrlStateReady(true);
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;
    updateWorkspaceUrlState({
      start: startDate,
      end: endDate,
      details: detailsOpen ? "open" : "closed",
      funnelStart: funnelStartDate,
      funnelEnd: funnelEndDate,
      funnelLevel: funnelLevelBand,
      funnelChannel,
      funnel: funnelOpen ? "open" : "closed"
    });
  }, [detailsOpen, endDate, funnelChannel, funnelEndDate, funnelLevelBand, funnelOpen, funnelStartDate, startDate, urlStateReady]);

  useEffect(() => {
    const clearPrintTarget = () => {
      setPrintTarget(null);
      setExportPreparing(false);
      document.body.removeAttribute("data-print-target");
      if (printFallbackTimer.current !== null) {
        window.clearTimeout(printFallbackTimer.current);
        printFallbackTimer.current = null;
      }
    };
    window.addEventListener("afterprint", clearPrintTarget);
    return () => {
      window.removeEventListener("afterprint", clearPrintTarget);
      if (printFallbackTimer.current !== null) window.clearTimeout(printFallbackTimer.current);
    };
  }, []);

  useEffect(() => {
    if (printTarget) document.body.setAttribute("data-print-target", printTarget);
    else document.body.removeAttribute("data-print-target");
  }, [printTarget]);

  function exportPdf(target: PrintTarget) {
    setPrintTarget(target);
    setExportPreparing(true);
    document.body.setAttribute("data-print-target", target);
    if (printFallbackTimer.current !== null) window.clearTimeout(printFallbackTimer.current);
    window.setTimeout(() => window.print(), 120);
    printFallbackTimer.current = window.setTimeout(() => {
      setPrintTarget(null);
      setExportPreparing(false);
      document.body.removeAttribute("data-print-target");
      printFallbackTimer.current = null;
    }, 12000);
  }

  async function exportRequisitionDetailXlsx() {
    setExportPreparing(true);
    try {
      const XLSX = await import("xlsx");
      const headers = requisitionDetailHeaders(language);
      const worksheet = XLSX.utils.json_to_sheet(requisitionRows.map((row) => requisitionDetailExportRow(row, language)), { header: headers });
      const metadata = XLSX.utils.json_to_sheet([{
        [translate(language, "generatedAt")]: new Date().toISOString(),
        [translate(language, "generatedBy")]: data.profile?.email ?? data.profile?.nickname ?? translate(language, "unknown"),
        [translate(language, "dateRange")]: `${formatDate(startDate, language)} - ${formatDate(endDate, language)}`,
        [translate(language, "rows")]: requisitionRows.length
      }]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, translate(language, "openedRequisitionsSheet"));
      XLSX.utils.book_append_sheet(workbook, metadata, translate(language, "exportMetadataSheet"));
      XLSX.writeFile(workbook, `opened-requisitions-${startDate}-to-${endDate}.xlsx`);
    } finally {
      window.setTimeout(() => setExportPreparing(false), 300);
    }
  }

  function applyReportPreset(preset: "weekly" | "monthly" | "site") {
    const end = today();
    const days = preset === "weekly" ? 6 : 29;
    const start = addDays(end, -days);
    setStartDate(start);
    setEndDate(end);
    setFunnelStartDate(start);
    setFunnelEndDate(end);
    if (preset === "site") {
      setDetailsOpen(true);
      setFunnelOpen(true);
    }
  }

  return (
    <div className="grid min-w-0 max-w-full gap-4 overflow-x-hidden">
      <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-[#C9D5E6] bg-white py-5 font-normal shadow-[0_14px_34px_rgba(11,19,43,0.06)]">
        <div className="mb-5 grid gap-5 border-b border-[#E4E9F2] px-4 pb-5 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-start lg:px-8">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-normal text-slate">{translate(language, "weeklyRecruitmentPerformance")}</p>
            <h2 className="text-2xl font-semibold tracking-normal text-navy sm:text-[28px]">{translate(language, "vacancyWaterfall")}</h2>
            <p className="mt-1 text-sm font-medium text-slate">{formatDate(startDate, language)} - {formatDate(endDate, language)}</p>
          </div>
          <div className="grid gap-3 rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] p-3 sm:flex sm:items-start sm:justify-end">
            <Field label={translate(language, "startDate")} className="text-xs font-medium">
              <TextInput
                className="min-h-10 w-full rounded-xl border border-[#C9D5E6] bg-white px-2.5 py-1.5 text-sm font-normal text-navy shadow-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-36"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label={translate(language, "endDate")} className="text-xs font-medium">
              <TextInput
                className="min-h-10 w-full rounded-xl border border-[#C9D5E6] bg-white px-2.5 py-1.5 text-sm font-normal text-navy shadow-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-36"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-2 pt-5 print:hidden">
              <Button type="button" size="sm" variant="secondary" onClick={() => applyReportPreset("weekly")}>{translate(language, "weeklyPreset")}</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => applyReportPreset("monthly")}>{translate(language, "monthlyPreset")}</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => applyReportPreset("site")}>{translate(language, "siteReviewPreset")}</Button>
              <Button type="button" size="sm" variant="secondary" icon={<Download size={16} />} disabled={exportPreparing} onClick={() => exportPdf("chart")}>{translate(language, "exportPdf")}</Button>
            </div>
          </div>
        </div>

        <div className="mb-5 px-4 sm:px-6 lg:px-8">
          <OperationalSummaryStrip density="compact" items={reportSummary} />
        </div>

        {waterfallRows.length === 0 ? (
          <div className="px-4 sm:px-6 lg:px-8">
            <EmptyState variant="quiet" message={translate(language, "noWaterfallData")} />
          </div>
        ) : (
          <div data-print-section="chart" className="print-chart-report">
            <ReportHeader language={language} title={translate(language, "weeklyRecruitmentPerformance")} startDate={startDate} endDate={endDate} />
            <VacancyWaterfallChart language={language} rows={waterfallRows} />
          </div>
        )}
      </section>

      <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] shadow-none">
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <span>
              <strong className="block text-lg font-semibold text-navy">{translate(language, "openedRequisitionsSelectedRange")}</strong>
              <span className="text-sm font-medium text-slate">{translate(language, "requisitionsInRange", { count: formatNumber(requisitionRows.length, language), start: formatDate(startDate, language), end: formatDate(endDate, language) })}</span>
            </span>
            <ChevronDown className={`shrink-0 transition-transform motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} size={20} />
          </button>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button type="button" size="sm" variant="secondary" icon={<Download size={16} />} disabled={exportPreparing} onClick={exportRequisitionDetailXlsx}>{translate(language, "exportDetailXlsx")}</Button>
            <Button type="button" size="sm" variant="secondary" icon={<Download size={16} />} disabled={exportPreparing} onClick={() => exportPdf("requisition-detail")}>{translate(language, "exportDetailPdf")}</Button>
          </div>
        </div>
        {detailsOpen ? (
          <div className="min-w-0 max-w-full overflow-hidden border-t border-[#E4E9F2] bg-white p-4 sm:p-6 lg:p-8">
            <RequisitionDetailTable rows={requisitionRows} language={language} />
          </div>
        ) : null}
      </section>

      <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] shadow-none">
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
            onClick={() => setFunnelOpen((open) => !open)}
          >
            <span>
              <strong className="block text-lg font-semibold text-navy">{translate(language, "recruitmentPipelineHealthSelectedRange")}</strong>
              <span className="text-sm font-medium text-slate">
                {translate(language, "applicantsInRange", { count: formatNumber(funnelApplicantTotal, language), start: formatDate(funnelStartDate, language), end: formatDate(funnelEndDate, language), level: funnelLevelLabel(funnelLevelBand, language), channel: funnelChannelLabel })}
              </span>
            </span>
            <ChevronDown className={`shrink-0 transition-transform motion-reduce:transition-none ${funnelOpen ? "rotate-180" : ""}`} size={20} />
          </button>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button type="button" size="sm" variant="secondary" icon={<Download size={16} />} disabled={exportPreparing} onClick={() => exportPdf("pipeline-funnel")}>{translate(language, "exportFunnelPdf")}</Button>
          </div>
        </div>
        {funnelOpen ? (
          <div className="grid min-w-0 gap-4 border-t border-[#E4E9F2] bg-white p-4 sm:p-6 lg:p-8">
            <div className="grid gap-3 rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] p-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,10rem))_auto] sm:items-end">
              <Field label={translate(language, "startDate")} className="text-xs font-medium">
                <TextInput
                  className="min-h-10 w-full rounded-xl border border-[#C9D5E6] bg-white px-2.5 py-1.5 text-sm font-normal text-navy shadow-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  type="date"
                  value={funnelStartDate}
                  onChange={(event) => setFunnelStartDate(event.target.value)}
                />
              </Field>
              <Field label={translate(language, "endDate")} className="text-xs font-medium">
                <TextInput
                  className="min-h-10 w-full rounded-xl border border-[#C9D5E6] bg-white px-2.5 py-1.5 text-sm font-normal text-navy shadow-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                  type="date"
                  value={funnelEndDate}
                  onChange={(event) => setFunnelEndDate(event.target.value)}
                />
              </Field>
              <Field label={translate(language, "level")} className="text-xs font-medium">
                <SelectInput value={funnelLevelBand} onChange={(event) => setFunnelLevelBand(event.target.value as FunnelLevelBand)}>
                  {localizedFunnelLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </SelectInput>
              </Field>
              <Field label={translate(language, "channel")} className="text-xs font-medium">
                <SelectInput value={funnelChannel} onChange={(event) => setFunnelChannel(event.target.value)}>
                  {funnelChannelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </SelectInput>
              </Field>
            </div>
            <PipelineFunnel
              language={language}
              rows={funnelRows}
              title={translate(language, "recruitmentPipelineHealth")}
              subtitle={translate(language, "funnelSubtitle")}
              meta={`${funnelLevelLabel(funnelLevelBand, language)} - ${funnelChannelLabel}`}
              totalValue={funnelApplicantTotal}
            />
            <p className="text-sm font-medium text-slate">{funnelApplicantTotal === 0 ? translate(language, "noApplicantsMatchFunnelFilters") : translate(language, "topBottleneck", { value: topFunnelBottleneck(funnelRows, language) })}</p>
          </div>
        ) : null}
      </section>

      <div data-print-section="requisition-detail" className="print-report-only">
        <ReportHeader language={language} title={translate(language, "openedRequisitionsSelectedRange")} startDate={startDate} endDate={endDate} />
        <RequisitionDetailTable rows={requisitionRows} language={language} printMode />
      </div>

      <div data-print-section="pipeline-funnel" className="print-report-only print-funnel-report">
        <ReportHeader language={language} title={translate(language, "recruitmentPipelineHealthSelectedRange")} startDate={funnelStartDate} endDate={funnelEndDate} />
        <p className="px-4 pb-3 text-sm font-medium text-slate sm:px-6 lg:px-8">{translate(language, "levelMeta")}: {funnelLevelLabel(funnelLevelBand, language)} - {translate(language, "channelMeta")}: {funnelChannelLabel}</p>
        <PipelineFunnel
          language={language}
          rows={funnelRows}
          title={translate(language, "recruitmentPipelineHealth")}
          subtitle={translate(language, "funnelSubtitle")}
          meta={`${funnelLevelLabel(funnelLevelBand, language)} - ${funnelChannelLabel}`}
          totalValue={funnelApplicantTotal}
        />
      </div>

      {exportPreparing ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-navy/45 p-6 print:hidden" role="status" aria-live="polite" aria-busy="true">
          <div className="rounded-lg border border-[#D7DEE8] bg-white px-6 py-5 text-center shadow-[0_12px_30px_rgba(11,19,43,0.12)]">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-[#D7DEE8] border-t-primary" />
            <p className="font-semibold text-navy">{translate(language, "preparingPdf")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReportHeader({ language, title, startDate, endDate }: { language: Language; title: string; startDate: string; endDate: string }) {
  return (
    <div className="hidden print-report-header px-4 pb-3 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-navy">{title}</h1>
      <p className="text-sm text-slate">{translate(language, "dateRange")}: {formatDate(startDate, language)} - {formatDate(endDate, language)}</p>
    </div>
  );
}

function VacancyWaterfallChart({ language, rows }: { language: Language; rows: WaterfallRow[] }) {
  const chart = buildWaterfall(rows, language);
  const plotWidth = 720;
  const plotHeight = 480;
  const width = 1120;
  const topPad = 58;
  const bottomPad = 58;
  const height = topPad + plotHeight + bottomPad;
  const leftPad = 70;
  const plotRight = leftPad + plotWidth;
  const yMax = chart.yMax;
  const yScale = (value: number) => topPad + ((yMax - Math.max(value, 0)) / Math.max(yMax, 1)) * plotHeight;
  const step = plotWidth / Math.max(chart.categories.length, 1);
  const barWidth = Math.min(96, Math.max(52, step * 0.5));
  const zeroY = yScale(0);
  const totalBar = chart.bars.find((bar) => bar.categoryType === "total");
  const totalBarRight = totalBar ? categoryX(totalBar.categoryIndex, step, leftPad) + barWidth / 2 : plotRight;

  return (
    <div className="chart-report-body w-full pb-2">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h3 className="screen-chart-title text-2xl font-semibold leading-tight tracking-normal text-navy sm:text-[26px]">
          {translate(language, "weeklyRecruitmentPerformance")}
        </h3>
        <div className="chart-legend mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          {chart.legend.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-sm font-medium text-slate">
              <span
                className="chart-legend-swatch shrink-0"
                style={{
                  backgroundColor: item.color,
                  display: "inline-block",
                  height: 12,
                  width: 12
                }}
              />
              <span>{formatLegendLabel(language, item.label)}</span>
            </div>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="vacancy-waterfall-svg block aspect-[3/2] h-auto w-full max-w-full">
        {totalBar ? (
          <RightSegmentBrackets
            x={totalBarRight + 24}
            segments={totalBar.segments.map((segment) => ({
              key: segment.key,
              label: segment.label,
              yTop: yScale(segment.top),
              yBottom: yScale(segment.bottom)
            }))}
          />
        ) : null}
        <line x1={leftPad} x2={plotRight} y1={zeroY} y2={zeroY} stroke="#526173" strokeWidth={1} />
        <line x1={leftPad} x2={leftPad} y1={topPad} y2={zeroY} stroke="#526173" strokeWidth={2} />
        {chart.yTicks.filter((tick) => tick > 0).map((tick) => {
          const y = yScale(tick);
          return (
            <g key={tick}>
              <line x1={leftPad - 8} x2={leftPad} y1={y} y2={y} stroke="#526173" strokeWidth={1.5} />
              <text x={leftPad - 18} y={y + 8} textAnchor="end" className="fill-slate text-[22px] font-light">{tick}</text>
            </g>
          );
        })}
        {chart.connectors.map((connector) => {
          const x1 = categoryX(connector.from, step, leftPad) + barWidth / 2;
          const x2 = categoryX(connector.to, step, leftPad) - barWidth / 2;
          const y = yScale(connector.value);
          return <line key={`${connector.from}-${connector.to}`} x1={x1} x2={x2} y1={y} y2={y} stroke="#96A3B4" strokeWidth={1.5} />;
        })}
        {chart.bars.map((bar) => {
          const x = categoryX(bar.categoryIndex, step, leftPad) - barWidth / 2;
          return (
            <g key={bar.key}>
              {bar.segments.map((segment) => {
                const yA = yScale(segment.bottom);
                const yB = yScale(segment.top);
                const y = Math.min(yA, yB);
                const rectHeight = Math.max(Math.abs(yB - yA), 1);
                return <rect key={segment.key} x={x} y={y} width={barWidth} height={rectHeight} fill={segment.color} rx={0} />;
              })}
              <text x={x + barWidth / 2} y={yScale(bar.labelAnchor) - 14} textAnchor="middle" className="fill-navy text-[24px] font-light">
                {bar.label}
              </text>
            </g>
          );
        })}
        {chart.categories.map((category, index) => (
          <text key={category} x={categoryX(index, step, leftPad)} y={height - 22} textAnchor="middle" className="fill-slate text-[13px] font-semibold">
            {formatCategoryLabel(language, category)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function RightSegmentBrackets({
  x,
  segments
}: {
  x: number;
  segments: {
    key: string;
    label: string;
    yTop: number;
    yBottom: number;
  }[];
}) {
  return (
    <g>
      {segments
        .filter((segment) => segment.label?.trim())
        .map((segment) => {
          const rawTop = Math.min(segment.yTop, segment.yBottom);
          const rawBottom = Math.max(segment.yTop, segment.yBottom);
          const mid = (rawTop + rawBottom) / 2;

          const gap = 4;
          const minHeight = 18;
          const height = Math.max(rawBottom - rawTop - gap * 2, minHeight);

          const top = mid - height / 2;
          const bottom = mid + height / 2;

          const width = 12;
          const radius = Math.min(5, height / 3);

          const tipWidth = 6;
          const tipHeight = Math.min(7, height * 0.18);

          const d = [
            `M ${x} ${top}`,
            `H ${x + width - radius}`,
            `Q ${x + width} ${top} ${x + width} ${top + radius}`,
            `V ${mid - tipHeight}`,
            `L ${x + width + tipWidth} ${mid}`,
            `L ${x + width} ${mid + tipHeight}`,
            `V ${bottom - radius}`,
            `Q ${x + width} ${bottom} ${x + width - radius} ${bottom}`,
            `H ${x}`
          ].join(" ");

          return (
            <g key={segment.key}>
              <path
                d={d}
                fill="none"
                stroke="#526173"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />

              <text
                x={x + width + tipWidth + 14}
                y={mid}
                textAnchor="start"
                dominantBaseline="middle"
                className="fill-slate-600 text-[22px] font-light"
              >
                {segment.label}
              </text>
            </g>
          );
        })}
    </g>
  );
}

function RequisitionDetailTable({ rows, language, printMode = false }: { rows: RequisitionDetailRow[]; language: Language; printMode?: boolean }) {
  const columns: TableColumn<RequisitionDetailRow>[] = [
    { key: "site", label: translate(language, "site"), value: (row) => row.site },
    { key: "department", label: translate(language, "department"), value: (row) => row.department },
    { key: "position", label: translate(language, "position"), value: (row) => row.position },
    { key: "level", label: translate(language, "jobLevel"), value: (row) => row.level },
    { key: "vacancy", label: translate(language, "vacancy"), value: (row) => row.vacancy },
    { key: "request_type", label: translate(language, "requestType"), value: (row) => requestTypeLabel(language, row.request_type) },
    { key: "requisition_date", label: translate(language, "requisitionDate"), value: (row) => formatDate(row.requisition_date, language), sortValue: (row) => row.requisition_date },
    { key: "person_in_charge", label: translate(language, "personInCharge"), value: (row) => row.person_in_charge },
    { key: "applicants", label: translate(language, "applicants"), value: (row) => row.applicant_count },
    ...detailStages.map((stage): TableColumn<RequisitionDetailRow> => ({
      key: stage,
      label: processStageLabel(language, stage),
      value: (row) => row.stage_counts[stage] ?? 0
    })),
    { key: "sla", label: translate(language, "sla"), value: (row) => slaExportValue(row.sla_state, language), sortValue: (row) => row.sla_state.ageDays ?? Number.POSITIVE_INFINITY },
    { key: "filled_status", label: translate(language, "filledStatus"), value: (row) => translate(language, row.filled_status === "Filled" ? "filled" : "open") },
    { key: "filled_date", label: translate(language, "filledDate"), value: (row) => row.filled_date ? formatDate(row.filled_date, language) : "-", sortValue: (row) => row.filled_date ?? "" }
  ];
  const table = useTableControls(rows, columns);
  const visibleRows = printMode ? rows : table.controlledRows;
  if (rows.length === 0) return <EmptyState message={translate(language, "noOpenedRequisitionsInRange")} />;

  return (
    <div className={`max-h-[560px] min-w-0 max-w-full overflow-x-auto ${printMode ? "print-detail-scroll" : "dashboard-detail-scroll"}`}>
      <table className={`${printMode ? "print-detail-table" : "min-w-max"} table-auto border-collapse text-left text-xs`}>
        <thead>
          <tr className="bg-lightgray text-navy">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={`${detailHeaderClass(column.label, printMode)} border border-[#D7DEE8] px-2 py-2 font-semibold`}>
                {printMode ? column.label : (
                  <SortableFilterHeader
                    columnKey={column.key}
                    filterValue={table.filters[column.key] ?? ""}
                    language={language}
                    label={column.label}
                    onFilter={table.setFilter}
                    onSort={table.toggleSort}
                    sortDirection={table.sortDirection}
                    sortKey={table.sortKey}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.doc_id} className="align-top">
              <td className={`${detailCellClass("Site")} border border-[#D7DEE8] px-2 py-2`}>{row.site}</td>
              <td className={`${detailCellClass("Department")} border border-[#D7DEE8] px-2 py-2`}>{row.department}</td>
              <td className={`${detailCellClass("Position")} border border-[#D7DEE8] px-2 py-2`}>{row.position}</td>
              <td className={`${detailCellClass("Job Level")} border border-[#D7DEE8] px-2 py-2`}>{row.level}</td>
              <td className={`${detailCellClass("Vacancy")} border border-[#D7DEE8] px-2 py-2 text-right`}>{row.vacancy}</td>
              <td className={`${detailCellClass("Requisition Type")} border border-[#D7DEE8] px-2 py-2`}>{requestTypeLabel(language, row.request_type)}</td>
              <td className={`${detailCellClass("Requisition Date")} border border-[#D7DEE8] px-2 py-2`}>{formatDate(row.requisition_date, language)}</td>
              <td className={`${detailCellClass("Person in Charge")} border border-[#D7DEE8] px-2 py-2`}>{row.person_in_charge}</td>
              <td className={`${detailCellClass("Applicants")} border border-[#D7DEE8] px-2 py-2 text-right`}>{row.applicant_count}</td>
              {detailStages.map((stage) => (
                <td key={stage} className={`${detailCellClass(stage)} border border-[#D7DEE8] px-2 py-2 text-right`}>{row.stage_counts[stage] ?? 0}</td>
              ))}
              <td className={`${detailCellClass("SLA")} border border-[#D7DEE8] px-2 py-2`}>{slaStatusCell(row.sla_state)}</td>
              <td className={`${detailCellClass("Filled Status")} border border-[#D7DEE8] px-2 py-2`}>{translate(language, row.filled_status === "Filled" ? "filled" : "open")}</td>
              <td className={`${detailCellClass("Filled Date")} border border-[#D7DEE8] px-2 py-2`}>{row.filled_date ? formatDate(row.filled_date, language) : "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function slaStatusCell(state: RequisitionSlaState) {
  if (state.ageDays === null || state.inSla === null) return "-";
  const dotClass = state.inSla ? "sla-dot-ok bg-primary" : "sla-dot-overdue bg-scarlet";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`sla-dot size-2.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <span>({state.ageDays}d)</span>
    </span>
  );
}

function slaExportValue(state: RequisitionSlaState, language: Language) {
  if (state.ageDays === null || state.inSla === null) return "-";
  return `${state.inSla ? translate(language, "inSla") : translate(language, "overSlaLabel")} (${state.ageDays}d)`;
}

function requisitionDetailHeaders(language: Language) {
  return [
    translate(language, "site"),
    translate(language, "department"),
    translate(language, "position"),
    translate(language, "jobLevel"),
    translate(language, "vacancy"),
    translate(language, "requestType"),
    translate(language, "requisitionDate"),
    translate(language, "personInCharge"),
    translate(language, "applicants"),
    ...detailStages.map((stage) => processStageLabel(language, stage)),
    translate(language, "sla"),
    translate(language, "filledStatus"),
    translate(language, "filledDate")
  ];
}

function requisitionDetailExportRow(row: RequisitionDetailRow, language: Language) {
  const stageHeaders = new Map(detailStages.map((stage) => [processStageLabel(language, stage), stage]));
  return Object.fromEntries(
    requisitionDetailHeaders(language).map((header) => {
      if (header === translate(language, "site")) return [header, row.site];
      if (header === translate(language, "department")) return [header, row.department];
      if (header === translate(language, "position")) return [header, row.position];
      if (header === translate(language, "jobLevel")) return [header, row.level];
      if (header === translate(language, "vacancy")) return [header, row.vacancy];
      if (header === translate(language, "requestType")) return [header, requestTypeLabel(language, row.request_type)];
      if (header === translate(language, "requisitionDate")) return [header, formatDate(row.requisition_date, language)];
      if (header === translate(language, "personInCharge")) return [header, row.person_in_charge];
      if (header === translate(language, "applicants")) return [header, row.applicant_count];
      if (header === translate(language, "sla")) return [header, slaExportValue(row.sla_state, language)];
      if (header === translate(language, "filledStatus")) return [header, translate(language, row.filled_status === "Filled" ? "filled" : "open")];
      if (header === translate(language, "filledDate")) return [header, row.filled_date ? formatDate(row.filled_date, language) : "-"];
      const stage = stageHeaders.get(header);
      return [header, stage ? row.stage_counts[stage] ?? 0 : 0];
    })
  );
}

function detailHeaderClass(header: string, printMode: boolean) {
  return `${printMode ? "" : "sticky top-0 z-10"} ${detailCellClass(header)}`;
}

function detailCellClass(header: string) {
  const sizing = detailColumnClass(header);
  if (["Site", "Department", "Position", "Job Level", "Vacancy", "Requisition Type", "Requisition Date"].includes(header)) return `bg-white ${sizing}`;
  if (["Person in Charge", "Applicants"].includes(header)) return `bg-[#F8FBFF] ${sizing}`;
  if (isDetailStageHeader(header)) return `bg-[#F7F8FF] ${sizing}`;
  return `bg-[#F8FFF9] ${sizing}`;
}

function detailColumnClass(header: string) {
  if (["Department", "Position", "Person in Charge"].includes(header)) return "detail-text min-w-36 max-w-56 whitespace-normal";
  if (["Requisition Type"].includes(header)) return "min-w-32 whitespace-nowrap";
  if (["Requisition Date", "Filled Date"].includes(header)) return "min-w-28 whitespace-nowrap";
  if (["SLA", "Filled Status"].includes(header)) return "min-w-24 whitespace-nowrap";
  if (isDetailStageHeader(header)) return "min-w-16 whitespace-nowrap text-right";
  if (["Vacancy", "Applicants"].includes(header)) return "min-w-16 whitespace-nowrap text-right";
  return "min-w-20 whitespace-nowrap";
}

function isDetailStageHeader(header: string) {
  return detailStages.some((stage) => header === stage || header === processStageLabel("en", stage) || header === processStageLabel("th", stage));
}

function buildWaterfall(rows: WaterfallRow[], language: Language) {
  const sites = siteOrder.filter((site) => rows.some((row) => row.site === site));
  const categories: string[] = [];
  if (rows.some((row) => row.waterfall_category === "Week Start")) categories.push("Week Start");
  for (const site of sites) if (rows.some((row) => row.waterfall_category === "Open" && row.site === site)) categories.push(`${site} Open`);
  for (const site of sites) if (rows.some((row) => row.waterfall_category === "Filled" && row.site === site)) categories.push(`${site} Filled`);
  if (rows.some((row) => row.waterfall_category === "Total")) categories.push("Total");

  const categoryRows = categories.map((category) => rowsForCategory(rows, category));
  const totals = categoryRows.map((items) => items.reduce((sum, row) => sum + row.vacancy_count, 0));
  const bars = [];
  const connectors = [];
  let running = 0;
  const yMax = waterfallAxisMax(rows);

  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index];
    const isTotal = category === "Total";
    const isFilled = category.endsWith(" Filled");
    const base = category === "Week Start" || isTotal ? 0 : running;
    const segments = [];
    let positiveCursor = base;
    let downwardCursor = base;
    let top = base;

    for (const row of sortSnapshotRows(categoryRows[index])) {
      if (row.vacancy_count === 0) continue;
      const magnitude = Math.abs(row.vacancy_count);
      const isDownward = isFilled || row.vacancy_count < 0;
      const segmentBottom = isDownward ? Math.max(downwardCursor - magnitude, 0) : positiveCursor;
      const segmentTop = isDownward ? downwardCursor : positiveCursor + magnitude;
      if (isDownward) downwardCursor = segmentBottom;
      else positiveCursor = segmentTop;
      top = Math.max(top, segmentTop);
      segments.push({
        key: `${category}-${row.site}-${row.request_type}`,
        label: formatBreakdownLabel(row, language),
        bottom: segmentBottom,
        top: segmentTop,
        color: snapshotColor(row.site, row.request_type)
      });
    }

    const startValue = base;
    const endValue = isTotal ? totals[index] : base + totals[index];
    if (!isTotal) running += totals[index];

    bars.push({
      key: category,
      categoryIndex: index,
      segments,
      total: totals[index],
      label: formatChartValue(totals[index], language, isFilled),
      labelAnchor: Math.max(top, 0),
      startValue,
      endValue,
      topValue: Math.max(startValue, endValue),
      bottomValue: Math.min(startValue, endValue),
      categoryType: categoryType(category)
    });
  }

  for (let index = 0; index < bars.length - 1; index += 1) {
    connectors.push({ from: index, to: index + 1, value: connectorValue(bars[index], bars[index + 1]) });
  }

  return {
    categories,
    bars,
    connectors,
    yTicks: yAxisTicks(yMax),
    yMax,
    legend: stackItems(rows)
  };
}

function buildLiveWaterfallRows(
  requisitions: EnrichedRequisition[],
  offers: EnrichedOffer[],
  startDate: string,
  endDate: string
): WaterfallRow[] {
  if (!startDate || !endDate || startDate > endDate) return [];

  const rows: WaterfallRow[] = [];
  const requisitionsById = new Map(requisitions.map((row) => [row.doc_id, row]));
  const acceptedOffers = offers.filter((offer) => Boolean(offer.accepted_date));

  for (const requisition of requisitions) {
    if (requisition.status === "cancel" || !siteOrder.includes(requisition.site)) continue;
    const openedDate = dateOnly(requisition.pr_approved_date) ?? dateOnly(requisition.created_at);
    if (!openedDate) continue;

    if (openedDate < startDate) {
      const filledBeforeStart = acceptedOffers.filter(
        (offer) => offer.doc_id === requisition.doc_id && dateOnly(offer.accepted_date) !== null && dateOnly(offer.accepted_date)! < startDate
      ).length;
      const openAtStart = Math.max(requisition.head_count - filledBeforeStart, 0);
      if (openAtStart > 0) rows.push(waterfallRow("Week Start", requisition.site, requisition.request_type ?? "New", openAtStart));
    }

    if (openedDate >= startDate && openedDate <= endDate) {
      rows.push(waterfallRow("Open", requisition.site, requisition.request_type ?? "New", requisition.head_count));
    }
  }

  for (const offer of acceptedOffers) {
    const acceptedDate = dateOnly(offer.accepted_date);
    if (!acceptedDate || acceptedDate < startDate || acceptedDate > endDate) continue;
    const requisition = requisitionsById.get(offer.doc_id);
    if (!requisition || requisition.status === "cancel") continue;
    rows.push(waterfallRow("Filled", requisition.site, requisition.request_type ?? "New", -1));
  }

  const groupedRows = aggregateWaterfallRows(rows);
  const totals = new Map<string, WaterfallRow>();
  for (const row of groupedRows) {
    const key = `${row.site}|${row.request_type}`;
    const existing = totals.get(key);
    totals.set(key, waterfallRow("Total", row.site, row.request_type, (existing?.vacancy_count ?? 0) + row.vacancy_count));
  }

  return aggregateWaterfallRows([...groupedRows, ...Array.from(totals.values())]);
}

function buildOpenedRequisitionRows(data: DashboardData, requisitions: EnrichedRequisition[], startDate: string, endDate: string): RequisitionDetailRow[] {
  return requisitions
    .filter((requisition) => {
      const openedDate = dateOnly(requisition.pr_approved_date) ?? dateOnly(requisition.created_at);
      return requisition.status !== "cancel" && Boolean(openedDate) && openedDate! >= startDate && openedDate! <= endDate;
    })
    .map((requisition) => {
      const openedDate = dateOnly(requisition.pr_approved_date) ?? dateOnly(requisition.created_at) ?? "";
      const groupIds = groupIdsForRequisition(data, requisition.doc_id);
      const relatedDocGroupIds = docGroupIdsForGroupIds(data, groupIds);
      const stageCounts = stageHistoryCountsForDocGroups(data, relatedDocGroupIds);
      const acceptedDates = data.offers
        .filter((offer) => offer.doc_id === requisition.doc_id && offer.accepted_date)
        .map((offer) => dateOnly(offer.accepted_date))
        .filter(Boolean) as string[];
      const filledStatus: RequisitionDetailRow["filled_status"] = requisition.status === "filled" || requisition.accepted_count >= requisition.head_count ? "Filled" : "Open";

      return {
        doc_id: requisition.doc_id,
        site: requisition.site,
        department: requisition.department,
        position: requisition.position,
        level: requisition.level ?? "-",
        vacancy: requisition.head_count,
        applicant_count: applicantCountForGroups(data, groupIds, startDate, endDate),
        request_type: requisition.request_type,
        requisition_date: openedDate,
        person_in_charge: requisition.person_in_charge ?? "-",
        stage_counts: stageCounts,
        sla_state: getRequisitionSlaState(
          requisition,
          { endDate: filledStatus === "Filled" ? acceptedDates.sort().at(-1) ?? todayDate() : todayDate() }
        ),
        filled_status: filledStatus,
        filled_date: filledStatus === "Filled" && acceptedDates.length > 0 ? acceptedDates.sort().at(-1) ?? null : null
      };
    })
    .sort(compareRequisitionDetailRows);
}

function buildDashboardPipelineFunnelRows(
  data: DashboardData,
  requisitions: EnrichedRequisition[],
  startDate: string,
  endDate: string,
  levelBand: FunnelLevelBand,
  channelFilter: FunnelChannelFilter,
  language: Language
): PipelineFunnelRow[] {
  if (!startDate || !endDate || startDate > endDate) return buildPipelineFunnelRows(0, emptyFunnelStageCounts(), language);

  const eligibleRequisitions = requisitions.filter((requisition) =>
    requisition.status !== "cancel" && levelMatchesBand(requisition.level, levelBand)
  );
  const eligibleDocIds = new Set(eligibleRequisitions.map((requisition) => requisition.doc_id));
  const groupIds = new Set<string>();
  const directDocGroupIds = new Set<string>();

  for (const group of data.document_groups) {
    if (!eligibleDocIds.has(group.doc_id)) continue;
    directDocGroupIds.add(group.doc_group_id);
    if (group.group_id) groupIds.add(group.group_id);
  }

  const linkedDocGroupIds = docGroupIdsForGroupIds(data, groupIds);
  for (const docGroupId of directDocGroupIds) linkedDocGroupIds.add(docGroupId);

  return buildPipelineFunnelRows(
    applicantCountForGroups(data, groupIds, startDate, endDate, channelFilter),
    passedStageActivityCountsForDocGroups(data, linkedDocGroupIds, startDate, endDate, channelFilter),
    language
  );
}

function buildPipelineFunnelRows(applicantTotal: number, stageCounts: FunnelStageCounts, language: Language): PipelineFunnelRow[] {
  const baseRows = [
    { key: "applicants", label: translate(language, "applicants"), count: applicantTotal },
    ...PIPELINE_FUNNEL_STAGES.map((stage) => ({ key: stage, label: pipelineDisplayLabel(stage, language), count: stageCounts[stage] ?? 0 }))
  ];

  return baseRows.map((row, index) => {
    const previousCount = index > 0 ? baseRows[index - 1].count : null;
    return {
      ...row,
      conversionRate: previousCount && previousCount > 0 ? row.count / previousCount : null,
      yieldRate: applicantTotal > 0 ? row.count / applicantTotal : null,
      barRatio: applicantTotal > 0 ? Math.min(row.count / applicantTotal, 1) : null
    };
  });
}

function groupIdsForRequisition(data: DashboardData, docId: string) {
  return new Set(
    data.document_groups
      .filter((group) => group.doc_id === docId && group.group_id)
      .map((group) => group.group_id as string)
  );
}

function docGroupIdsForGroupIds(data: DashboardData, groupIds: Set<string>) {
  if (groupIds.size === 0) return new Set<string>();
  return new Set(
    data.document_groups
      .filter((group) => group.group_id && groupIds.has(group.group_id))
      .map((group) => group.doc_group_id)
  );
}

function applicantCountForGroups(data: DashboardData, groupIds: Set<string>, startDate: string, endDate: string, channelFilter: FunnelChannelFilter = "all") {
  if (groupIds.size === 0) return 0;
  const channels: ReadonlyArray<(typeof SOURCING_CHANNELS)[number]> = channelFilter === "all"
    ? SOURCING_CHANNELS
    : SOURCING_CHANNELS.filter((channel) => channel.label === channelFilter);
  if (channels.length === 0) return 0;
  return data.sourcing_weekly_updates
    .filter((update) => groupIds.has(update.group_id) && update.week_start >= startDate && update.week_start <= endDate)
    .reduce(
      (sum, update) => sum + channels.reduce<number>((channelSum, channel) => channelSum + Number(update[channel.count] ?? 0), 0),
      0
    );
}

function stageHistoryCountsForDocGroups(data: DashboardData, docGroupIds: Set<string>) {
  const stageCandidates = Object.fromEntries(detailStages.map((stage) => [stage, new Set<string>()])) as Record<ProcessStage, Set<string>>;
  if (docGroupIds.size === 0) return emptyStageCounts();

  const candidateIds = new Set(
    data.candidates
      .filter((candidate) => docGroupIds.has(candidate.doc_group_id))
      .map((candidate) => candidate.candidate_id)
  );

  for (const log of data.recruitment_logs) {
    if (!candidateIds.has(log.candidate_id) || !detailStages.includes(log.recruitment_process)) continue;
    stageCandidates[log.recruitment_process].add(log.candidate_id);
  }

  return Object.fromEntries(detailStages.map((stage) => [stage, stageCandidates[stage].size])) as Record<ProcessStage, number>;
}

function passedStageActivityCountsForDocGroups(data: DashboardData, docGroupIds: Set<string>, startDate: string, endDate: string, channelFilter: FunnelChannelFilter = "all") {
  const stageCandidates = emptyFunnelCandidateSets();
  if (docGroupIds.size === 0) return emptyFunnelStageCounts();

  const candidateIds = new Set(
    data.candidates
      .filter((candidate) => docGroupIds.has(candidate.doc_group_id) && channelMatchesFilter(candidate.channel, channelFilter))
      .map((candidate) => candidate.candidate_id)
  );

  for (const log of data.recruitment_logs) {
    const logDate = dateOnly(log.log_date);
    if (!logDate || logDate < startDate || logDate > endDate) continue;
    if (!candidateIds.has(log.candidate_id) || !detailStages.includes(log.recruitment_process)) continue;
    if (log.recruitment_process === "Phone Screen") stageCandidates["Resume Screening"].add(log.candidate_id);
    if (log.result === 1) stageCandidates[log.recruitment_process].add(log.candidate_id);
  }

  return Object.fromEntries(PIPELINE_FUNNEL_STAGES.map((stage) => [stage, stageCandidates[stage].size])) as FunnelStageCounts;
}

function emptyStageCounts() {
  return Object.fromEntries(detailStages.map((stage) => [stage, 0])) as Record<ProcessStage, number>;
}

function emptyFunnelStageCounts() {
  return Object.fromEntries(PIPELINE_FUNNEL_STAGES.map((stage) => [stage, 0])) as FunnelStageCounts;
}

function emptyFunnelCandidateSets() {
  return Object.fromEntries(PIPELINE_FUNNEL_STAGES.map((stage) => [stage, new Set<string>()])) as Record<PipelineDisplayStage, Set<string>>;
}

function buildFunnelChannelOptions(data: DashboardData, language: Language) {
  const options = new Map<string, string>([["all", translate(language, "allChannels")]]);
  for (const channel of SOURCING_CHANNELS) options.set(channel.label, channel.label);
  for (const candidate of data.candidates) {
    const channel = candidate.channel?.trim();
    if (channel) options.set(channel, channel);
  }
  return Array.from(options, ([value, label]) => ({ value, label }));
}

function channelFilterLabel(value: FunnelChannelFilter, language: Language) {
  return value === "all" ? translate(language, "allChannels") : value;
}

function channelMatchesFilter(channel: string | null | undefined, filter: FunnelChannelFilter) {
  return filter === "all" || channel?.trim() === filter;
}

function isFunnelLevelBand(value: string | null): value is FunnelLevelBand {
  return value === "all" || value === "0-3" || value === "4-9" || value === "10-14";
}

function buildFunnelLevelOptions(language: Language): Array<{ value: FunnelLevelBand; label: string }> {
  return funnelLevelOptions.map((option) => ({
    ...option,
    label: option.value === "all" ? translate(language, "allLevels") : option.label
  }));
}

function funnelLevelLabel(value: FunnelLevelBand, language: Language) {
  return buildFunnelLevelOptions(language).find((option) => option.value === value)?.label ?? translate(language, "allLevels");
}

function levelMatchesBand(level: string | null | undefined, band: FunnelLevelBand) {
  if (band === "all") return true;
  const numericLevel = Number.parseInt(String(level ?? "").replace(/^L/i, ""), 10);
  if (!Number.isFinite(numericLevel)) return false;
  if (band === "0-3") return numericLevel >= 0 && numericLevel <= 3;
  if (band === "4-9") return numericLevel >= 4 && numericLevel <= 9;
  return numericLevel >= 10 && numericLevel <= 14;
}

function compareRequisitionDetailRows(a: RequisitionDetailRow, b: RequisitionDetailRow) {
  const siteDelta = siteRank(a.site) - siteRank(b.site);
  if (siteDelta !== 0) return siteDelta;
  const statusDelta = (a.filled_status === "Open" ? 0 : 1) - (b.filled_status === "Open" ? 0 : 1);
  if (statusDelta !== 0) return statusDelta;
  const dateA = a.filled_date ?? "9999-12-31";
  const dateB = b.filled_date ?? "9999-12-31";
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  return a.requisition_date.localeCompare(b.requisition_date);
}

function rowsForCategory(rows: WaterfallRow[], category: string) {
  if (category.endsWith(" Open")) return rows.filter((row) => row.waterfall_category === "Open" && row.site === category.replace(" Open", ""));
  if (category.endsWith(" Filled")) return rows.filter((row) => row.waterfall_category === "Filled" && row.site === category.replace(" Filled", ""));
  return rows.filter((row) => row.waterfall_category === category);
}

function sortSnapshotRows(rows: WaterfallRow[]) {
  return [...rows].sort((a, b) => siteRank(a.site) - siteRank(b.site) || requestTypeRank(a.request_type) - requestTypeRank(b.request_type));
}

function siteRank(site: string) {
  const index = siteOrder.indexOf(site);
  return index === -1 ? siteOrder.length : index;
}

function requestTypeRank(requestType: RequisitionRequestType) {
  return requestType === "Replacement" ? 0 : 1;
}

function snapshotColor(site: string, requestType: string) {
  const rep: Record<string, string> = { HQ: "#0AA0C3", KT1: "#146EFA", KT2: "#411EDC" };
  const fresh: Record<string, string> = { HQ: "#90F5EC", KT1: "#80BDFF", KT2: "#C7BCF5" };
  return requestType === "New" ? fresh[site] ?? "#D7DEE8" : rep[site] ?? "#475569";
}

function categoryX(index: number, step: number, leftPad: number) {
  return leftPad + step * index + step / 2;
}

function formatChartValue(value: number, language: Language, isFilled = false) {
  const amount = formatNumber(Math.abs(value), language);
  return isFilled || value < 0 ? `(${amount})` : amount;
}

function waterfallAxisMax(rows: WaterfallRow[]) {
  const startTotal = rows.filter((row) => row.waterfall_category === "Week Start").reduce((sum, row) => sum + row.vacancy_count, 0);
  const openTotal = rows.filter((row) => row.waterfall_category === "Open" && siteOrder.includes(row.site)).reduce((sum, row) => sum + Math.max(row.vacancy_count, 0), 0);
  return Math.max(Math.ceil((startTotal + openTotal) * 1.1), 1);
}

function yAxisTicks(max: number) {
  if (max <= 6) return Array.from({ length: max + 1 }, (_, index) => index);
  const step = Math.max(Math.ceil(max / 4), 1);
  return [0, step, step * 2, step * 3, max].filter((value) => value <= max).filter((value, index, values) => values.indexOf(value) === index).sort((a, b) => a - b);
}

function categoryType(category: string) {
  if (category === "Week Start") return "weekStart";
  if (category === "Total") return "total";
  if (category.endsWith(" Filled")) return "filled";
  return "open";
}

function connectorValue(
  previous: { categoryType: string; endValue: number; bottomValue: number; topValue: number },
  next: { categoryType: string; startValue: number; endValue: number; topValue: number }
) {
  if (previous.categoryType === "filled" && next.categoryType === "total") return next.topValue;
  if (previous.categoryType === "filled") return previous.bottomValue;
  if (next.categoryType === "filled") return next.startValue;
  if (next.categoryType === "total") return previous.endValue;
  return previous.topValue;
}

function formatCategoryLabel(language: Language, category: string) {
  if (category === "Week Start") return translate(language, "weekStart");
  if (category === "Total") return translate(language, "total");
  if (category.endsWith(" Open")) return `${category.replace(" Open", "")} ${translate(language, "open")}`;
  if (category.endsWith(" Filled")) return `${category.replace(" Filled", "")} ${translate(language, "filled")}`;
  return category;
}

function formatLegendLabel(language: Language, label: string) {
  const [site, requestType] = label.split(" ");
  const suffix = requestType === "Replacement" ? translate(language, "replacementVacancy") : translate(language, "newVacancy");
  return `${site} ${suffix}`;
}

function formatBreakdownLabel(row: WaterfallRow, language: Language) {
  return `${row.site}-${row.request_type === "Replacement" ? "REP" : "NEW"}: ${formatNumber(row.vacancy_count, language)}`;
}

function stackItems(rows: WaterfallRow[]) {
  const seen = new Set<string>();
  const items = [];
  for (const row of sortSnapshotRows(rows.filter((item) => item.vacancy_count !== 0 && siteOrder.includes(item.site)))) {
    const key = `${row.site}|${row.request_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ label: `${row.site} ${row.request_type}`, color: snapshotColor(row.site, row.request_type) });
  }
  return items;
}

function waterfallRow(waterfallCategory: VacancyWaterfallCategory, site: string, requestType: RequisitionRequestType, vacancyCount: number): WaterfallRow {
  return { waterfall_category: waterfallCategory, site, request_type: requestType, vacancy_count: vacancyCount };
}

function aggregateWaterfallRows(rows: WaterfallRow[]) {
  const totals = new Map<string, WaterfallRow>();
  for (const row of rows) {
    const key = `${row.waterfall_category}|${row.site}|${row.request_type}`;
    const existing = totals.get(key);
    totals.set(key, existing ? { ...existing, vacancy_count: existing.vacancy_count + row.vacancy_count } : row);
  }
  return Array.from(totals.values());
}

function currentYearStart() {
  return currentLocalYearStart();
}

function today() {
  return formatLocalDateInput();
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return formatLocalDateInput(date);
}

function buildReportSummary(requisitionRows: RequisitionDetailRow[], funnelRows: PipelineFunnelRow[], language: Language) {
  const opened = requisitionRows.length;
  const openHeadcount = requisitionRows.reduce((sum, row) => sum + (row.filled_status === "Open" ? row.vacancy : 0), 0);
  const filled = requisitionRows.filter((row) => row.filled_status === "Filled").length;
  const overSla = requisitionRows.filter((row) => row.sla_state.isOverdue).length;
  const bottleneck = topFunnelBottleneck(funnelRows, language);
  return [
    { label: translate(language, "opened"), value: opened, tone: "primary" as const, helper: translate(language, "requisitionsInRangeHelper") },
    { label: translate(language, "filled"), value: filled, tone: filled > 0 ? "success" as const : "muted" as const, helper: translate(language, "filledRequisitions") },
    { label: translate(language, "openHeadcountShort"), value: openHeadcount, tone: openHeadcount > 0 ? "warning" as const : "success" as const, helper: translate(language, "remainingVacancy") },
    { label: translate(language, "overSlaLabel"), value: overSla, tone: overSla > 0 ? "danger" as const : "success" as const, helper: translate(language, "needsReview") },
    { label: translate(language, "pipelineBottleneck"), value: bottleneck, tone: "teal" as const, helper: translate(language, "largestFunnelDrop") }
  ];
}

function topFunnelBottleneck(rows: PipelineFunnelRow[], language: Language) {
  const candidates = rows
    .slice(1)
    .map((row, index) => {
      const previous = rows[index];
      const drop = previous ? Math.max(previous.count - row.count, 0) : 0;
      return { label: row.label, drop };
    })
    .sort((a, b) => b.drop - a.drop);
  const top = candidates[0];
  return top && top.drop > 0 ? `${top.label} (-${top.drop})` : translate(language, "noMajorDrop");
}

function dateOnly(value: string | null | undefined) {
  if (!value) return null;
  return value.slice(0, 10);
}
