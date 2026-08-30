"use client";

import { ArrowLeftRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Download, ImageDown, Info, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { CommandMonthSelector, CommandSelector } from "@/components/ui/CommandSelector";
import { DayDateSelector, Field } from "@/components/ui/Field";
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
import { formatLocalDateInput } from "@/lib/dates";
import { formatDate, formatNumber } from "@/lib/format";
import { organizationLabel, type DepartmentSectionRow } from "@/lib/department-section-data";
import { processStageLabel, requestTypeLabel, translate } from "@/lib/i18n/dictionary";
import { getRequisitionSlaState, getSlaDays, type RequisitionSlaState, todayDate } from "@/lib/sla";
import { countsTowardHeadcount, countsTowardHeadcountAt } from "@/lib/offer-headcount";
import { readWorkspaceUrlState, updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import type {
  DashboardData,
  EnrichedOffer,
  EnrichedRequisition,
  Language,
  ProcessStage,
  RequisitionStatus,
  RequisitionRequestType,
  VacancyWaterfallCategory
} from "@/types/recruitment";

const detailStages = ACTIVE_PIPELINE_STAGES;
const funnelLevelOptions: Array<{ value: FunnelLevelBand; label: string }> = [
  { value: "0-3", label: "L0-L3" },
  { value: "4-6", label: "L4-L6" },
  { value: "7-9", label: "L7-L9" },
  { value: "10-14", label: "L10-L14" }
];

type FunnelLevelBand = "0-3" | "4-6" | "7-9" | "10-14";
type FunnelChannelFilter = "all" | string;
type FunnelStageCounts = Record<PipelineDisplayStage, number>;
type ReportView = "mtd" | "ytd" | "pim" | "custom";

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
  section: string | null;
  position: string;
  level: string;
  vacancy: number;
  applicant_count: number;
  request_type: RequisitionRequestType;
  requisition_date: string;
  actual_age_days: number | null;
  person_in_charge: string;
  stage_counts: Record<ProcessStage, number>;
  sla_state: RequisitionSlaState;
  filled_date: string | null;
  period_status: "ongoing" | "filled" | "cancel";
  period_detail: string | null;
};
type StageCountMode = "status" | "activity";
type ExportColumnKey = "site" | "department" | "department_th" | "section" | "section_th" | "position" | "level" | "vacancy" | "request_type" | "requisition_date" | "person_in_charge" | "status" | "detail" | "applicants" | ProcessStage | "actual_age" | "sla" | "filled_date";
type StageCandidateMatch = { candidateId: string; name: string; stage: ProcessStage; pendingDate: string; resultDate: string | null; remark: string | null; result: 0 | 1 | null };
type StageCandidateReportDetail = StageCandidateMatch & { personInCharge: string };

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
  const [reportView, setReportView] = useState<ReportView>("mtd");
  const [reportMonth, setReportMonth] = useState(today().slice(0, 7));
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [funnelStartDate, setFunnelStartDate] = useState(`${today().slice(0, 4)}-01-01`);
  const [funnelEndDate, setFunnelEndDate] = useState(today());
  const [funnelLevelBands, setFunnelLevelBands] = useState<FunnelLevelBand[]>([]);
  const [funnelChannel, setFunnelChannel] = useState<FunnelChannelFilter>("all");
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [exportPreparing, setExportPreparing] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [stageCountMode, setStageCountMode] = useState<StageCountMode>("status");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState<ExportColumnKey[]>([]);
  const [organizationRows, setOrganizationRows] = useState<DepartmentSectionRow[]>([]);
  const [stageDrilldown, setStageDrilldown] = useState<{ row: RequisitionDetailRow; stage: ProcessStage; matches: StageCandidateMatch[] } | null>(null);
  const [reportCandidate, setReportCandidate] = useState<StageCandidateReportDetail | null>(null);
  const [urlStateReady, setUrlStateReady] = useState(false);
  const chartExportRef = useRef<HTMLDivElement | null>(null);
  const requisitionExportRef = useRef<HTMLDivElement | null>(null);
  const funnelExportRef = useRef<HTMLDivElement | null>(null);
  const { startDate, endDate } = useMemo(
    () => reportRange(reportView, reportMonth, customStartDate, customEndDate),
    [customEndDate, customStartDate, reportMonth, reportView]
  );
  const validReportRange = Boolean(startDate && endDate && startDate <= endDate);

  const waterfallRows = useMemo(
    () => buildLiveWaterfallRows(data, requisitions, offers, startDate, endDate, reportView),
    [data, endDate, offers, reportView, requisitions, startDate]
  );
  const requisitionRows = useMemo(
    () => buildActiveRequisitionRows(data, requisitions, startDate, endDate, reportView, stageCountMode),
    [data, endDate, reportView, requisitions, stageCountMode, startDate]
  );
  const funnelRows = useMemo(
    () => buildDashboardPipelineFunnelRows(data, requisitions, funnelStartDate, funnelEndDate, funnelLevelBands, funnelChannel, language),
    [data, funnelChannel, funnelEndDate, funnelLevelBands, funnelStartDate, language, requisitions]
  );
  const funnelApplicantTotal = funnelRows[0]?.count ?? 0;
  const funnelChannelOptions = useMemo(() => buildFunnelChannelOptions(data, language), [data, language]);
  const funnelChannelLabel = channelFilterLabel(funnelChannel, language);
  const localizedFunnelLevelOptions = useMemo(() => buildFunnelLevelOptions(language), [language]);
  const reportSummary = useMemo(() => buildReportSummary(requisitionRows, offers, startDate, endDate, language), [endDate, language, offers, requisitionRows, startDate]);

  useEffect(() => {
    const params = readWorkspaceUrlState();
    if (isReportView(params.get("reportView"))) setReportView(params.get("reportView") as ReportView);
    if (/^\d{4}-\d{2}$/.test(params.get("reportMonth") ?? "")) setReportMonth(params.get("reportMonth")!);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("end") ?? "")) setReportMonth(params.get("end")!.slice(0, 7));
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("start") ?? "")) setCustomStartDate(params.get("start")!);
    if (/^\d{4}-\d{2}-\d{2}$/.test(params.get("end") ?? "")) setCustomEndDate(params.get("end")!);
    if (params.get("details") === "open") setDetailsOpen(true);
    if (params.get("details") === "closed") setDetailsOpen(false);
    if (params.get("funnelStart")) setFunnelStartDate(params.get("funnelStart")!);
    if (params.get("funnelEnd")) setFunnelEndDate(params.get("funnelEnd")!);
    const savedLevelBands = (params.get("funnelLevel") ?? "").split(",").filter(isFunnelLevelBand);
    if (savedLevelBands.length > 0) setFunnelLevelBands(savedLevelBands);
    if (params.get("funnelChannel")) setFunnelChannel(params.get("funnelChannel")!);
    if (params.get("funnel") === "open") setFunnelOpen(true);
    if (params.get("funnel") === "closed") setFunnelOpen(false);
    setUrlStateReady(true);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/department-sections").then((response) => response.ok ? response.json() : []).then((rows: DepartmentSectionRow[]) => { if (active) setOrganizationRows(Array.isArray(rows) ? rows : []); }).catch(() => { if (active) setOrganizationRows([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!urlStateReady) return;
    updateWorkspaceUrlState({
      start: reportView === "custom" ? customStartDate : null,
      end: reportView === "custom" ? customEndDate : null,
      reportView,
      reportMonth: reportView === "custom" ? null : reportMonth,
      details: detailsOpen ? "open" : "closed",
      funnelStart: funnelStartDate,
      funnelEnd: funnelEndDate,
      funnelLevel: funnelLevelBands.length > 0 ? funnelLevelBands.join(",") : null,
      funnelChannel,
      funnel: funnelOpen ? "open" : "closed"
    });
  }, [customEndDate, customStartDate, detailsOpen, funnelChannel, funnelEndDate, funnelLevelBands, funnelOpen, funnelStartDate, reportMonth, reportView, urlStateReady]);

  async function exportPng(surface: HTMLDivElement | null, filename: string) {
    if (!surface) return;
    setExportPreparing(true);
    setExportError(false);
    try {
      const { toPng } = await import("html-to-image");
      await waitForExportSurface();
      const width = surface.scrollWidth;
      const height = surface.scrollHeight;
      if (width < 2 || height < 2) throw new Error("Export surface has no dimensions");
      const dataUrl = await toPng(surface, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        canvasHeight: height * 2,
        canvasWidth: width * 2,
        height,
        pixelRatio: 2,
        style: { left: "0", opacity: "1", position: "static", top: "0", transform: "none", visibility: "visible" },
        width
      });
      if (!await hasVisiblePngContent(dataUrl)) throw new Error("Export surface rendered blank");
      const blob = await (await fetch(dataUrl)).blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      setExportError(true);
    } finally {
      setExportPreparing(false);
    }
  }

  async function exportRequisitionDetailXlsx(selectedColumns: ExportColumnKey[] = defaultExportColumns()) {
    setExportPreparing(true);
    try {
      const headers = selectedColumns.map((column) => exportColumnLabel(column, language));
      const { Workbook } = await import("exceljs");
      const workbook = new Workbook();
      const worksheet = workbook.addWorksheet(translate(language, "activeRequisitionsSheet"));
      const rows = requisitionRows.map((row) => selectedColumns.map((column) => exportValue(row, column, language, organizationRows)));
      worksheet.views = [{ showGridLines: false }];
      worksheet.getColumn(1).width = 2;
      for (let index = 2; index < headers.length + 2; index += 1) worksheet.getColumn(index).width = 20;
      worksheet.addTable({ name: "ActiveRequisitionsTable", ref: "B2", headerRow: true, totalsRow: false, style: { theme: "TableStyleMedium2", showRowStripes: true }, columns: headers.map((name) => ({ name, filterButton: true })), rows });
      const whiteBorder = {
        top: { style: "thin" as const, color: { argb: "FFFFFFFF" } },
        left: { style: "thin" as const, color: { argb: "FFFFFFFF" } },
        bottom: { style: "thin" as const, color: { argb: "FFFFFFFF" } },
        right: { style: "thin" as const, color: { argb: "FFFFFFFF" } }
      };
      for (let row = 2; row < rows.length + 3; row += 1) {
        for (let column = 2; column < headers.length + 2; column += 1) {
          const cell = worksheet.getCell(row, column);
          cell.font = { name: "Sarabun" };
          cell.border = whiteBorder;
          cell.alignment = {
            vertical: "middle",
            horizontal: row === 2 ? "center" : "left",
            wrapText: row > 2
          };
        }
      }
      const metadata = workbook.addWorksheet(translate(language, "exportMetadataSheet"));
      metadata.addRows([[translate(language, "generatedAt"), new Date().toISOString()], [translate(language, "generatedBy"), data.profile?.email ?? data.profile?.nickname ?? translate(language, "unknown")], [translate(language, "dateRange"), `${formatDate(startDate, language)} - ${formatDate(endDate, language)}`], [translate(language, "rows"), requisitionRows.length]]);
      metadata.eachRow((row) => row.eachCell((cell) => { cell.font = { name: "Sarabun" }; cell.alignment = { vertical: "middle" }; }));
      const bytes = await workbook.xlsx.writeBuffer();
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `active-requisitions-${startDate}-to-${endDate}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      window.setTimeout(() => setExportPreparing(false), 300);
    }
  }

  function changeReportView(nextView: ReportView) {
    if (nextView === "custom" && reportView !== "custom") {
      setCustomStartDate(startDate);
      setCustomEndDate(endDate);
    }
    setReportView(nextView);
  }

  return (
    <div className="grid min-w-0 max-w-full gap-4 overflow-x-hidden">
      <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-[#C9D5E6] bg-white py-5 font-normal shadow-[0_14px_34px_rgba(11,19,43,0.06)]">
        <div className="mb-5 border-b border-[#E4E9F2] px-4 pb-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-normal text-navy sm:text-[28px]">{translate(language, "vacancyWaterfall")}</h2>
              <p className="mt-1 text-sm font-medium text-slate">{translate(language, "reportingWindow")}</p>
            </div>
            <div className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#C9D5E6] bg-[#F8FAFD] px-3 py-2 text-sm font-semibold text-navy shadow-sm" aria-live="polite">
              <CalendarDays size={16} className="text-primary" aria-hidden="true" />
              <span className="text-slate">{translate(language, "selectedPeriod")}</span>
              <span className="tabular-nums">{formatDate(startDate, language)} - {formatDate(endDate, language)}</span>
            </div>
          </div>
          <div className="mt-4 rounded-2xl border border-[#D7E2F1] bg-[linear-gradient(135deg,#F8FAFD_0%,#F1F6FC_100%)] p-3 shadow-[0_8px_20px_rgba(11,19,43,0.04)]">
            <div className={`grid gap-3 lg:items-end ${reportView === "custom" ? "lg:grid-cols-[14rem_10rem_10rem_auto]" : "lg:grid-cols-[14rem_10rem_auto]"}`}>
            <div className="grid gap-1.5 text-sm font-medium text-navy">
              <span className="text-xs font-semibold text-slate">{translate(language, "metricView")}</span>
              <CommandSelector ariaLabel={translate(language, "metricView")} emptyLabel={translate(language, "metricView")} options={(["mtd", "ytd", "pim", "custom"] as ReportView[]).map((value) => ({ value, label: reportViewLabel(value, language) }))} value={reportView} onValueChange={(value) => changeReportView(value as ReportView)} />
            </div>
            {reportView === "custom" ? <>
              <DashboardDateFilter label={translate(language, "startDate")} value={customStartDate} onChange={setCustomStartDate} language={language} />
              <DashboardDateFilter label={translate(language, "endDate")} value={customEndDate} onChange={setCustomEndDate} language={language} />
            </> : <Field label={translate(language, "reportMonth")} className="text-xs font-semibold text-slate"><CommandMonthSelector ariaLabel={translate(language, "reportMonth")} monthLabel={(month) => monthPickerMonthLabel(month, language)} previousYearLabel={translate(language, "previousYear")} nextYearLabel={translate(language, "nextYear")} value={reportMonth} onValueChange={setReportMonth} /></Field>}
            <div className="flex flex-wrap items-end gap-2 print:hidden lg:justify-end">
              <Button type="button" size="sm" variant="secondary" icon={<ImageDown size={16} />} disabled={exportPreparing || !validReportRange} onClick={() => exportPng(chartExportRef.current, `vacancy-waterfall-${startDate}-to-${endDate}.png`)}>{translate(language, "exportPng")}</Button>
            </div>
            </div>
            {reportView === "custom" && !validReportRange ? <p className="mt-3 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2 text-sm font-medium text-danger" role="alert">{translate(language, "invalidCustomDateRange")}</p> : null}
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
          <div className="bg-white">
            <VacancyWaterfallChart language={language} rows={waterfallRows} />
          </div>
        )}
        {exportError ? <p className="mx-4 mb-1 text-sm font-medium text-danger sm:mx-6 lg:mx-8" role="alert">{translate(language, "exportPngFailed")}</p> : null}
      </section>

      <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] shadow-none">
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            <span>
              <strong className="block text-lg font-semibold text-navy">{translate(language, "activeRequisitionsSelectedRange")}</strong>
              <span className="text-sm font-medium text-slate">{translate(language, "activeRequisitionsInRange", { count: formatNumber(requisitionRows.length, language), start: formatDate(startDate, language), end: formatDate(endDate, language) })}</span>
            </span>
            <ChevronDown className={`shrink-0 transition-transform motion-reduce:transition-none ${detailsOpen ? "rotate-180" : ""}`} size={20} />
          </button>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button type="button" size="sm" variant="secondary" icon={<Download size={16} />} disabled={exportPreparing || !validReportRange} onClick={() => { setExportColumns(defaultExportColumns()); setExportOpen(true); }}>{translate(language, "export")}</Button>
          </div>
        </div>
        {detailsOpen ? (
          <div className="min-w-0 max-w-full overflow-hidden border-t border-[#E4E9F2] bg-white p-4 sm:p-6 lg:p-8">
            <div className="mb-3 inline-flex rounded-xl border border-[#C9D5E6] bg-[#F8FAFD] p-1" role="group" aria-label={translate(language, "stageCountMode")}>
              {(["status", "activity"] as StageCountMode[]).map((mode) => <button key={mode} type="button" className={`rounded-lg px-3 py-2 text-sm font-semibold ${stageCountMode === mode ? "bg-primary text-white shadow-sm" : "text-slate hover:bg-white"}`} aria-pressed={stageCountMode === mode} onClick={() => setStageCountMode(mode)}>{translate(language, mode === "status" ? "pipelineStatus" : "pipelineActivity")}</button>)}
            </div>
            <RequisitionDetailTable rows={requisitionRows} language={language} onStageClick={(row, stage) => setStageDrilldown({ row, stage, matches: stageCandidatesForRequisition(data, row.doc_id, stage, stageCountMode, startDate, endDate) })} />
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
                {translate(language, "applicantsInRange", { count: formatNumber(funnelApplicantTotal, language), start: formatDate(funnelStartDate, language), end: formatDate(funnelEndDate, language), level: funnelLevelLabel(funnelLevelBands, language), channel: funnelChannelLabel })}
              </span>
            </span>
            <ChevronDown className={`shrink-0 transition-transform motion-reduce:transition-none ${funnelOpen ? "rotate-180" : ""}`} size={20} />
          </button>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button type="button" size="sm" variant="secondary" icon={<ImageDown size={16} />} disabled={exportPreparing} onClick={() => exportPng(funnelExportRef.current, `pipeline-funnel-${funnelStartDate}-to-${funnelEndDate}.png`)}>{translate(language, "exportPng")}</Button>
          </div>
        </div>
        {funnelOpen ? (
          <div className="grid min-w-0 gap-4 border-t border-[#E4E9F2] bg-white p-4 sm:p-6 lg:p-8">
            <div className="grid gap-3 rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] p-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,10rem))_auto] sm:items-end">
              <Field label={translate(language, "startDate")} className="text-xs font-medium"><DayDateSelector ariaLabel={translate(language, "startDate")} language={language} name="funnel_start" value={funnelStartDate} onChange={(event) => setFunnelStartDate(event.target.value)} required /></Field>
              <Field label={translate(language, "endDate")} className="text-xs font-medium"><DayDateSelector ariaLabel={translate(language, "endDate")} language={language} name="funnel_end" value={funnelEndDate} onChange={(event) => setFunnelEndDate(event.target.value)} required /></Field>
              <DashboardMultiFilterPicker id="funnel-level-options" label={translate(language, "level")} language={language} options={localizedFunnelLevelOptions} values={funnelLevelBands} onValuesChange={(values) => setFunnelLevelBands(values as FunnelLevelBand[])} />
              <DashboardFilterPicker id="funnel-channel-options" label={translate(language, "channel")} options={funnelChannelOptions} value={funnelChannel} onValueChange={setFunnelChannel} />
            </div>
            <PipelineFunnel
              language={language}
              rows={funnelRows}
              title={translate(language, "recruitmentPipelineHealth")}
              subtitle={translate(language, "funnelSubtitle")}
              meta={`${funnelLevelLabel(funnelLevelBands, language)} - ${funnelChannelLabel}`}
              totalValue={funnelApplicantTotal}
            />
            <p className="text-sm font-medium text-slate">{funnelApplicantTotal === 0 ? translate(language, "noApplicantsMatchFunnelFilters") : translate(language, "topBottleneck", { value: topFunnelBottleneck(funnelRows, language) })}</p>
          </div>
        ) : null}
      </section>

      <div ref={requisitionExportRef} className="export-report-surface" aria-hidden="true">
        <ReportHeader exportMode language={language} title={translate(language, "activeRequisitionsSelectedRange")} startDate={startDate} endDate={endDate} />
        <RequisitionDetailTable rows={requisitionRows} language={language} printMode />
      </div>
      <ActiveRequisitionExportModal open={exportOpen} language={language} rows={requisitionRows} organizationRows={organizationRows} columns={exportColumns} onClose={() => setExportOpen(false)} onColumnsChange={setExportColumns} onExportXlsx={() => exportRequisitionDetailXlsx(exportColumns)} onExportPng={() => exportPng(requisitionExportRef.current, `active-requisitions-${startDate}-to-${endDate}.png`)} />
      <StageCandidateModal language={language} drilldown={stageDrilldown} onClose={() => setStageDrilldown(null)} onOpenCandidate={(candidate) => setReportCandidate({ ...candidate, personInCharge: stageDrilldown?.row.person_in_charge ?? "" })} />
      <ReportCandidateDetail language={language} candidate={reportCandidate} onClose={() => setReportCandidate(null)} />

      <div ref={chartExportRef} className="export-report-surface" aria-hidden="true">
        <ReportHeader exportMode language={language} title={translate(language, "vacancyWaterfall")} startDate={startDate} endDate={endDate} />
        <VacancyWaterfallChart language={language} rows={waterfallRows} />
      </div>

      <div ref={funnelExportRef} className="export-report-surface" aria-hidden="true">
        <ReportHeader exportMode language={language} title={translate(language, "recruitmentPipelineHealthSelectedRange")} startDate={funnelStartDate} endDate={funnelEndDate} />
        <p className="px-4 pb-3 text-sm font-medium text-slate sm:px-6 lg:px-8">{translate(language, "levelMeta")}: {funnelLevelLabel(funnelLevelBands, language)} - {translate(language, "channelMeta")}: {funnelChannelLabel}</p>
        <PipelineFunnel
          language={language}
          rows={funnelRows}
          title={translate(language, "recruitmentPipelineHealth")}
          subtitle={translate(language, "funnelSubtitle")}
          meta={`${funnelLevelLabel(funnelLevelBands, language)} - ${funnelChannelLabel}`}
          totalValue={funnelApplicantTotal}
        />
      </div>

      {exportPreparing ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-navy/45 p-6 print:hidden" role="status" aria-live="polite" aria-busy="true">
          <div className="rounded-lg border border-[#D7DEE8] bg-white px-6 py-5 text-center shadow-[0_12px_30px_rgba(11,19,43,0.12)]">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-[#D7DEE8] border-t-primary" />
            <p className="font-semibold text-navy">{translate(language, "preparingPng")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DashboardFilterPicker({
  id,
  label,
  options,
  value,
  onValueChange
}: {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div ref={ref} className="relative grid gap-1.5 text-sm font-medium text-navy">
      <span className="text-xs font-semibold text-slate">{label}</span>
      <button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-[#B8CCE4] bg-white px-3 text-left text-sm font-semibold text-navy shadow-sm transition hover:border-primary/60 hover:bg-[#FBFDFF] focus:outline-none focus:ring-2 focus:ring-primary/20" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)}>
        <SlidersHorizontal size={15} className="shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" title={selectedLabel}>{selectedLabel}</span>
        <ChevronDown size={16} className={`shrink-0 text-slate transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? <div id={id} role="listbox" aria-label={label} className="absolute z-30 mt-[4.45rem] grid w-full min-w-[12rem] grid-cols-1 gap-1.5 rounded-2xl border border-[#C9D5E6] bg-white p-2 shadow-[0_18px_40px_rgba(11,19,43,0.18)]">
        {options.map((option) => {
          const selected = option.value === value;
          return <button key={option.value} type="button" role="option" aria-selected={selected} className={`relative min-h-10 overflow-hidden rounded-xl border px-3 py-2 text-left text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${selected ? "border-primary bg-primary text-white shadow-sm" : "border-[#E4E9F2] bg-[#F8FAFD] text-navy hover:border-[#8AAED8] hover:bg-white"}`} onClick={() => { onValueChange(option.value); setOpen(false); }}>
            <span className="block min-w-0 truncate pr-5" title={option.label}>{option.label}</span>
            {selected ? <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true" /> : null}
          </button>;
        })}
      </div> : null}
    </div>
  );
}

function DashboardMultiFilterPicker({ id, label, language, options, values, onValuesChange }: { id: string; label: string; language: Language; options: Array<{ value: string; label: string }>; values: string[]; onValuesChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const allSelected = values.length === options.length;
  const selectedLabel = values.length === 0 ? translate(language, "allLevels") : options.filter((option) => values.includes(option.value)).map((option) => option.label).join(", ");

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", closeOnEscape); };
  }, []);

  return <div ref={ref} className="relative grid gap-1.5 text-sm font-medium text-navy">
    <span className="text-xs font-semibold text-slate">{label}</span>
    <button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-[#B8CCE4] bg-white px-3 text-left text-sm font-semibold text-navy shadow-sm transition hover:border-primary/60 hover:bg-[#FBFDFF] focus:outline-none focus:ring-2 focus:ring-primary/20" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => setOpen((current) => !current)}><SlidersHorizontal size={15} className="shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1 truncate" title={selectedLabel}>{selectedLabel}</span><ChevronDown size={16} className={`shrink-0 text-slate transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" /></button>
    {open ? <div id={id} role="listbox" aria-multiselectable="true" aria-label={label} className="absolute z-30 mt-[4.45rem] grid w-full min-w-[12rem] grid-cols-1 gap-1.5 rounded-2xl border border-[#C9D5E6] bg-white p-2 shadow-[0_18px_40px_rgba(11,19,43,0.18)]">
      <label className="flex min-h-9 items-center gap-2 border-b border-[#E4E9F2] pb-1.5 text-sm font-semibold"><input type="checkbox" checked={allSelected} onChange={(event) => onValuesChange(event.target.checked ? options.map((option) => option.value) : [])} />{translate(language, "selectAll")}</label>
      {options.map((option) => <label key={option.value} role="option" aria-selected={values.includes(option.value)} className="flex min-h-9 items-center gap-2 rounded-lg px-1 text-sm font-semibold hover:bg-[#F8FAFD]"><input type="checkbox" checked={values.includes(option.value)} onChange={(event) => onValuesChange(event.target.checked ? [...values, option.value] : values.filter((value) => value !== option.value))} />{option.label}</label>)}
    </div> : null}
  </div>;
}

function ReportHeader({ exportMode = false, language, title, startDate, endDate }: { exportMode?: boolean; language: Language; title: string; startDate: string; endDate: string }) {
  return (
    <div className={`${exportMode ? "block" : "hidden print-report-header"} px-4 pb-3 sm:px-6 lg:px-8`}>
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

function defaultExportColumns(): ExportColumnKey[] {
  return ["site", "department", "section", "position", "level", "vacancy", "request_type", "requisition_date", "person_in_charge", "status", "detail", "applicants", ...detailStages, "actual_age", "sla", "filled_date"];
}

function exportColumnLabel(key: ExportColumnKey, language: Language) {
  return key === "department" ? "Department" : key === "section" ? "Section" : key === "department_th" ? translate(language, "departmentThai") : key === "section_th" ? translate(language, "sectionThai") : key === "request_type" ? translate(language, "requestType") : key === "requisition_date" ? translate(language, "requisitionDate") : key === "person_in_charge" ? translate(language, "personInCharge") : key === "actual_age" ? translate(language, "actualAge") : key === "filled_date" ? translate(language, "filledDate") : key === "applicants" ? translate(language, "applicants") : key === "sla" ? translate(language, "slaAtPeriodEnd") : detailStages.includes(key as ProcessStage) ? processStageLabel(language, key as ProcessStage) : translate(language, key);
}

function ActiveRequisitionExportModal({ open, language, rows, organizationRows, columns, onClose, onColumnsChange, onExportXlsx, onExportPng }: { open: boolean; language: Language; rows: RequisitionDetailRow[]; organizationRows: DepartmentSectionRow[]; columns: ExportColumnKey[]; onClose: () => void; onColumnsChange: (columns: ExportColumnKey[]) => void; onExportXlsx: () => void; onExportPng: () => void }) {
  const registry: ExportColumnKey[] = ["site", "department", "department_th", "section", "section_th", "position", "level", "vacancy", "request_type", "requisition_date", "person_in_charge", "status", "detail", "applicants", ...detailStages, "actual_age", "sla", "filled_date"];
  const label = (key: ExportColumnKey) => exportColumnLabel(key, language);
  const [dragging, setDragging] = useState<ExportColumnKey | null>(null);
  const [insertBefore, setInsertBefore] = useState<ExportColumnKey | null>(null);
  return <Modal open={open} title={translate(language, "export")} onClose={onClose} width="max-w-6xl"><div className="grid gap-4"><p className="text-sm text-slate">{translate(language, "exportColumnHelp")}</p><div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-[#D7DEE8] p-3 sm:grid-cols-2 lg:grid-cols-4">{registry.map((key) => <label key={key} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[#E4E9F2] bg-white px-3 py-2.5 shadow-sm transition hover:border-[#B8CCE4] hover:bg-[#F8FAFD]"><span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-navy"><span className="truncate">{label(key)}</span><span className="group relative shrink-0"><Info size={14} className="text-slate" aria-label={translate(language, "exportFieldDescription", { field: label(key) })} /><span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 w-64 rounded-lg bg-navy px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{exportFieldDescription(key, language)}<span className="absolute right-1.5 top-full border-x-4 border-t-4 border-x-transparent border-t-navy" /></span></span></span><input type="checkbox" checked={columns.includes(key)} onChange={() => onColumnsChange(columns.includes(key) ? columns.filter((value) => value !== key) : [...columns, key])} /></label>)}</div><div className="overflow-x-auto rounded-xl border border-[#D7DEE8]"><table className="min-w-max text-xs"><thead><tr>{columns.map((key) => <th key={key} className={`border-b bg-[#F8FAFD] px-3 py-2 text-left transition-[padding,margin] ${insertBefore === key && dragging !== key ? "border-l-4 border-l-primary pl-7" : ""}`} onDragEnter={(event) => { event.preventDefault(); if (dragging && dragging !== key) setInsertBefore(key); }} onDragOver={(event) => { event.preventDefault(); if (dragging && dragging !== key) setInsertBefore(key); }} onDrop={(event) => { event.preventDefault(); const from = (event.dataTransfer.getData("text/plain") || dragging) as ExportColumnKey | null; if (from && from !== key) { const next = columns.filter((item) => item !== from); const targetIndex = next.indexOf(key); if (targetIndex >= 0) { next.splice(targetIndex, 0, from); onColumnsChange(next); } } setDragging(null); setInsertBefore(null); }}><button type="button" draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", key); event.dataTransfer.effectAllowed = "move"; setDragging(key); }} onDragEnd={() => { setDragging(null); setInsertBefore(null); }} className="inline-flex cursor-grab items-center gap-1.5 font-semibold text-navy active:cursor-grabbing"><ArrowLeftRight size={15} aria-hidden="true" /> {label(key)}</button></th>)}</tr></thead><tbody>{rows.slice(0, 5).map((row) => <tr key={row.doc_id}>{columns.map((key) => <td key={key} className="max-w-44 truncate border-t px-3 py-2" title={String(exportValue(row, key, language, organizationRows))}>{previewValue(exportValue(row, key, language, organizationRows))}</td>)}</tr>)}</tbody></table></div><div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={() => onColumnsChange(defaultExportColumns())}>{translate(language, "restoreDefault")}</Button><Button type="button" variant="secondary" disabled={!columns.length} onClick={onExportPng}>{translate(language, "exportPng")}</Button><Button type="button" disabled={!columns.length} onClick={onExportXlsx}>{translate(language, "exportDetailXlsx")}</Button></div></div></Modal>;
}

function previewValue(value: string | number) { const text = String(value); return text.length > 28 ? `${text.slice(0, 25)}...` : text; }
function exportFieldDescription(key: ExportColumnKey, language: Language) {
  const english: Partial<Record<ExportColumnKey, string>> = {
    site: "Site: The operating location responsible for the requisition.", department: "Department: The requisition's department in the selected system language.", department_th: "Department (Thai): The canonical Thai department name stored with the requisition.", section: "Section: The requisition's section in the selected system language.", section_th: "Section (Thai): The canonical Thai section name stored with the requisition.", position: "Position: The requested job title.", level: "Job Level: The approved job grade for the requisition.", vacancy: "Vacancy: Total approved headcount requested.", request_type: "Request Type: Whether the requisition is new or a replacement.", requisition_date: "Requisition Date: The approved opening date (pr_approved_date).", person_in_charge: "Person in Charge: The recruiter assigned to manage the requisition.", status: "Status at Period End: Requisition state at the selected period end. Filled is derived from accepted offer coverage; Cancelled is a recorded status action.", detail: "Detail: The remark attached to that latest historical status record.", applicants: "Applicants: Applicants recorded through sourcing during the selected period.", actual_age: "Actual Age: Age of the requisition since the requisition opened (pr_approved_date).", sla: "SLA at Period End: SLA age at the filled date when filled; otherwise at the selected period end.", filled_date: "Filled Date: The most recent date that accepted offers met the approved headcount, as of the selected period end."
  };
  const stage = detailStages.includes(key as ProcessStage) ? `${processStageLabel(language, key as ProcessStage)}: Unique candidates with a current pipeline record or a completed result in this stage, depending on the selected mode.` : null;
  return stage ?? english[key] ?? translate(language, "exportFieldDescription", { field: exportColumnLabel(key, language) });
}

function exportValue(row: RequisitionDetailRow, key: ExportColumnKey, language: Language, organizationRows: DepartmentSectionRow[] = []): string | number {
  if (detailStages.includes(key as ProcessStage)) return row.stage_counts[key as ProcessStage] ?? 0;
  const values: Record<string, string | number> = { site: row.site, department: organizationLabel(organizationRows, language, row.site, row.department, "department"), department_th: organizationLabel(organizationRows, "th", row.site, row.department, "department"), section: organizationLabel(organizationRows, language, row.site, row.section, "section") || "-", section_th: organizationLabel(organizationRows, "th", row.site, row.section, "section") || "-", position: row.position, level: row.level, vacancy: row.vacancy, request_type: requestTypeLabel(language, row.request_type), requisition_date: formatDate(row.requisition_date, language), person_in_charge: row.person_in_charge, status: translate(language, row.period_status === "ongoing" ? "ongoing" : row.period_status === "filled" ? "filled" : "cancel"), detail: row.period_detail ?? "-", applicants: row.applicant_count, actual_age: row.actual_age_days === null ? "-" : `${row.actual_age_days}d`, sla: slaExportValue(row.sla_state, language), filled_date: row.filled_date ? formatDate(row.filled_date, language) : "-" };
  return values[key];
}

function StageCandidateModal({ language, drilldown, onClose, onOpenCandidate }: { language: Language; drilldown: { row: RequisitionDetailRow; stage: ProcessStage; matches: StageCandidateMatch[] } | null; onClose: () => void; onOpenCandidate: (candidate: StageCandidateMatch) => void }) {
  const label = drilldown ? `${processStageLabel(language, drilldown.stage)} · ${drilldown.row.doc_id}` : "";
  return <Modal open={Boolean(drilldown)} title={`Candidates in ${label}`} onClose={onClose} width="max-w-4xl"><div className="grid gap-3"><p className="text-sm text-slate">{drilldown?.matches.length ?? 0} candidates in the selected report context.</p>{drilldown?.matches.length ? <div className="max-h-[55vh] overflow-auto rounded-xl border border-[#D7DEE8]"><table className="min-w-full text-sm"><thead className="sticky top-0 bg-[#F8FAFD] text-left"><tr>{["Candidate", "ID", "Pending Date", "Result Date", "Person in Charge"].map((header) => <th key={header} className="border-b px-3 py-2 font-semibold text-navy">{header}</th>)}</tr></thead><tbody>{drilldown.matches.map((match) => <tr key={match.candidateId} className="hover:bg-[#F8FAFD]"><td className="border-b px-3 py-2"><button type="button" className="font-semibold text-primary underline" onClick={() => onOpenCandidate(match)}>{match.name}</button></td><td className="border-b px-3 py-2">{match.candidateId}</td><td className="border-b px-3 py-2">{formatDate(match.pendingDate, language)}</td><td className="border-b px-3 py-2">{match.resultDate ? formatDate(match.resultDate, language) : "—"}</td><td className="border-b px-3 py-2">{drilldown.row.person_in_charge || "—"}</td></tr>)}</tbody></table></div> : <EmptyState message={translate(language, "noData")} />}</div></Modal>;
}

function ReportCandidateDetail({ language, candidate, onClose }: { language: Language; candidate: StageCandidateReportDetail | null; onClose: () => void }) {
  return <Modal open={Boolean(candidate)} title="Candidate Report Detail" onClose={onClose} width="max-w-lg"><dl className="grid grid-cols-2 gap-3 text-sm"><dt className="text-slate">Candidate</dt><dd className="font-semibold text-navy">{candidate?.name}</dd><dt className="text-slate">ID</dt><dd>{candidate?.candidateId}</dd><dt className="text-slate">Stage</dt><dd>{candidate ? processStageLabel(language, candidate.stage) : ""}</dd><dt className="text-slate">Pending Date</dt><dd>{candidate ? formatDate(candidate.pendingDate, language) : ""}</dd><dt className="text-slate">Result Date</dt><dd>{candidate?.resultDate ? formatDate(candidate.resultDate, language) : "—"}</dd><dt className="text-slate">Person in Charge</dt><dd>{candidate?.personInCharge || "—"}</dd></dl></Modal>;
}

function RequisitionDetailTable({ rows, language, printMode = false, onStageClick }: { rows: RequisitionDetailRow[]; language: Language; printMode?: boolean; onStageClick?: (row: RequisitionDetailRow, stage: ProcessStage) => void }) {
  const columns: TableColumn<RequisitionDetailRow>[] = [
    { key: "site", label: translate(language, "site"), value: (row) => row.site },
    { key: "department", label: translate(language, "department"), value: (row) => row.department },
    { key: "section", label: translate(language, "section"), value: (row) => row.section ?? "-" },
    { key: "position", label: translate(language, "position"), value: (row) => row.position },
    { key: "level", label: translate(language, "jobLevel"), value: (row) => row.level },
    { key: "vacancy", label: translate(language, "vacancy"), value: (row) => row.vacancy },
    { key: "request_type", label: translate(language, "requestType"), value: (row) => requestTypeLabel(language, row.request_type) },
    { key: "requisition_date", label: translate(language, "requisitionDate"), value: (row) => formatDate(row.requisition_date, language), sortValue: (row) => row.requisition_date },
    { key: "person_in_charge", label: translate(language, "personInCharge"), value: (row) => row.person_in_charge },
    { key: "status", label: translate(language, "statusAtPeriodEnd"), value: (row) => translate(language, row.period_status === "ongoing" ? "ongoing" : row.period_status === "filled" ? "filled" : "cancel") },
    { key: "detail", label: translate(language, "detail"), value: (row) => row.period_detail ?? "-" },
    { key: "applicants", label: translate(language, "applicants"), value: (row) => row.applicant_count },
    ...detailStages.map((stage): TableColumn<RequisitionDetailRow> => ({
      key: stage,
      label: processStageLabel(language, stage),
      value: (row) => row.stage_counts[stage] ?? 0
    })),
    { key: "actual_age", label: translate(language, "actualAge"), value: (row) => row.actual_age_days === null ? "-" : `${row.actual_age_days}d`, sortValue: (row) => row.actual_age_days ?? Number.POSITIVE_INFINITY },
    { key: "sla", label: translate(language, "slaAtPeriodEnd"), value: (row) => slaExportValue(row.sla_state, language), sortValue: (row) => row.sla_state.ageDays ?? Number.POSITIVE_INFINITY },
    { key: "filled_date", label: translate(language, "filledDate"), value: (row) => row.filled_date ? formatDate(row.filled_date, language) : "-", sortValue: (row) => row.filled_date ?? "" }
  ];
  const table = useTableControls(rows, columns);
  const visibleRows = printMode ? rows : table.controlledRows;
  if (rows.length === 0) return <EmptyState message={translate(language, "noActiveRequisitionsInRange")} />;

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
              <td className={`${detailCellClass("Section")} border border-[#D7DEE8] px-2 py-2`}>{row.section ?? "-"}</td>
              <td className={`${detailCellClass("Position")} border border-[#D7DEE8] px-2 py-2`}>{row.position}</td>
              <td className={`${detailCellClass("Job Level")} border border-[#D7DEE8] px-2 py-2`}>{row.level}</td>
              <td className={`${detailCellClass("Vacancy")} border border-[#D7DEE8] px-2 py-2 text-right`}>{row.vacancy}</td>
              <td className={`${detailCellClass("Requisition Type")} border border-[#D7DEE8] px-2 py-2`}>{requestTypeLabel(language, row.request_type)}</td>
              <td className={`${detailCellClass("Requisition Date")} border border-[#D7DEE8] px-2 py-2`}>{formatDate(row.requisition_date, language)}</td>
              <td className={`${detailCellClass("Person in Charge")} border border-[#D7DEE8] px-2 py-2`}>{row.person_in_charge}</td>
              <td className={`${detailCellClass("Status at Period End")} border border-[#D7DEE8] px-2 py-2`}>{translate(language, row.period_status === "ongoing" ? "ongoing" : row.period_status === "filled" ? "filled" : "cancel")}</td>
              <td className={`${detailCellClass("Detail")} border border-[#D7DEE8] px-2 py-2`}>{row.period_detail ?? "-"}</td>
              <td className={`${detailCellClass("Applicants")} border border-[#D7DEE8] px-2 py-2 text-right`}>{row.applicant_count}</td>
              {detailStages.map((stage) => (
                <td key={stage} className={`${detailCellClass(stage)} border border-[#D7DEE8] px-2 py-2 text-right`}>{(row.stage_counts[stage] ?? 0) > 0 && !printMode && onStageClick ? <button type="button" className="rounded px-1 font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/30" onClick={() => onStageClick(row, stage)} aria-label={`View ${row.stage_counts[stage]} candidates in ${processStageLabel(language, stage)}`}>{row.stage_counts[stage]}</button> : row.stage_counts[stage] ?? 0}</td>
              ))}
              <td className={`${detailCellClass("Actual Age")} border border-[#D7DEE8] px-2 py-2`}>{row.actual_age_days === null ? "-" : `${row.actual_age_days}d`}</td>
              <td className={`${detailCellClass("SLA at Period End")} border border-[#D7DEE8] px-2 py-2`}>{slaStatusCell(row.sla_state)}</td>
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
    translate(language, "section"),
    translate(language, "position"),
    translate(language, "jobLevel"),
    translate(language, "vacancy"),
    translate(language, "requestType"),
    translate(language, "requisitionDate"),
    translate(language, "personInCharge"),
    translate(language, "statusAtPeriodEnd"),
    translate(language, "detail"),
    translate(language, "applicants"),
    ...detailStages.map((stage) => processStageLabel(language, stage)),
    translate(language, "actualAge"),
    translate(language, "slaAtPeriodEnd"),
    translate(language, "filledDate")
  ];
}

function requisitionDetailExportRow(row: RequisitionDetailRow, language: Language) {
  const stageHeaders = new Map(detailStages.map((stage) => [processStageLabel(language, stage), stage]));
  return Object.fromEntries(
    requisitionDetailHeaders(language).map((header) => {
      if (header === translate(language, "site")) return [header, row.site];
      if (header === translate(language, "department")) return [header, row.department];
      if (header === translate(language, "section")) return [header, row.section ?? "-"];
      if (header === translate(language, "position")) return [header, row.position];
      if (header === translate(language, "jobLevel")) return [header, row.level];
      if (header === translate(language, "vacancy")) return [header, row.vacancy];
      if (header === translate(language, "requestType")) return [header, requestTypeLabel(language, row.request_type)];
      if (header === translate(language, "requisitionDate")) return [header, formatDate(row.requisition_date, language)];
      if (header === translate(language, "personInCharge")) return [header, row.person_in_charge];
      if (header === translate(language, "statusAtPeriodEnd")) return [header, translate(language, row.period_status === "ongoing" ? "ongoing" : row.period_status === "filled" ? "filled" : "cancel")];
      if (header === translate(language, "detail")) return [header, row.period_detail ?? "-"];
      if (header === translate(language, "applicants")) return [header, row.applicant_count];
      if (header === translate(language, "actualAge")) return [header, row.actual_age_days === null ? "-" : `${row.actual_age_days}d`];
      if (header === translate(language, "slaAtPeriodEnd")) return [header, slaExportValue(row.sla_state, language)];
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
  if (["SLA"].includes(header)) return "min-w-24 whitespace-nowrap";
  if (isDetailStageHeader(header)) return "min-w-16 whitespace-nowrap text-right";
  if (["Vacancy", "Applicants"].includes(header)) return "min-w-16 whitespace-nowrap text-right";
  return "min-w-20 whitespace-nowrap";
}

function isDetailStageHeader(header: string) {
  return detailStages.some((stage) => header === stage || header === processStageLabel("en", stage) || header === processStageLabel("th", stage));
}

function buildWaterfall(rows: WaterfallRow[], language: Language) {
  const sites = Array.from(new Set(rows.map((row) => row.site))).sort((a, b) => a.localeCompare(b));
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
  data: DashboardData,
  requisitions: EnrichedRequisition[],
  offers: EnrichedOffer[],
  startDate: string,
  endDate: string,
  reportView: ReportView
): WaterfallRow[] {
  if (!startDate || !endDate || startDate > endDate) return [];

  const rows: WaterfallRow[] = [];
  // The movement chart and Active in Selected Period must use one population.
  // In particular, an offer from a closed/expired requisition cannot reduce a
  // waterfall whose corresponding vacancy was excluded from its opening bars.
  const eligibleRequisitions = requisitions.filter((requisition) =>
    isReportEligible(requisition, data, startDate, endDate, reportView)
  );
  const requisitionsById = new Map(eligibleRequisitions.map((row) => [row.doc_id, row]));
  const coveredOffers = offers.filter(countsTowardHeadcount);

  for (const requisition of eligibleRequisitions) {
    const openedDate = dateOnly(requisition.pr_approved_date) ?? dateOnly(requisition.created_at);
    if (!openedDate) continue;

    if (openedDate < startDate) {
      const filledBeforeStart = offers.filter((offer) => offer.doc_id === requisition.doc_id && countsTowardHeadcountAt(offer, startDate)).length;
      const openAtStart = Math.max(requisition.head_count - filledBeforeStart, 0);
      if (openAtStart > 0) rows.push(waterfallRow("Week Start", requisition.site, requisition.request_type ?? "New", openAtStart));
    }

    if (openedDate >= startDate && openedDate <= endDate) {
      rows.push(waterfallRow("Open", requisition.site, requisition.request_type ?? "New", requisition.head_count));
    }
  }

  for (const offer of coveredOffers) {
    const acceptedDate = dateOnly(offer.accepted_date);
    if (!acceptedDate || acceptedDate < startDate || acceptedDate > endDate) continue;
    const requisition = requisitionsById.get(offer.doc_id);
    if (!requisition || requisitionSnapshotAt(data, requisition, endDate).status === "cancel") continue;
    rows.push(waterfallRow("Filled", requisition.site, requisition.request_type ?? "New", -1));
  }

  for (const offer of offers) {
    if (offer.start_confirmation !== "did_not_start") continue;
    const noShowDate = dateOnly(offer.start_confirmed_at);
    if (!noShowDate || noShowDate < startDate || noShowDate > endDate) continue;
    const requisition = requisitionsById.get(offer.doc_id);
    if (!requisition || requisitionSnapshotAt(data, requisition, endDate).status === "cancel") continue;
    rows.push(waterfallRow("Open", requisition.site, requisition.request_type ?? "New", 1));
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

function buildActiveRequisitionRows(data: DashboardData, requisitions: EnrichedRequisition[], startDate: string, endDate: string, reportView: ReportView, stageCountMode: StageCountMode): RequisitionDetailRow[] {
  return requisitions
    .filter((requisition) => isReportEligible(requisition, data, startDate, endDate, reportView))
    .map((requisition) => {
      const requisitionDate = validDateOnly(requisition.pr_approved_date) ?? "";
      const groupIds = groupIdsForRequisition(data, requisition.doc_id);
      const relatedDocGroupIds = docGroupIdsForGroupIds(data, groupIds);
      const stageCounts = stageCountMode === "status" ? pipelineStatusCountsForDocGroups(data, relatedDocGroupIds, endDate) : stageActivityCountsForDocGroups(data, relatedDocGroupIds, startDate, endDate);
      const snapshot = requisitionSnapshotAt(data, requisition, endDate);
      const filledDate = snapshot.filledDate;

      return {
        doc_id: requisition.doc_id,
        site: requisition.site,
        department: requisition.department,
        section: requisition.section,
        position: requisition.position,
        level: requisition.level ?? "-",
        vacancy: requisition.head_count,
        applicant_count: applicantCountForGroups(data, groupIds, startDate, endDate),
        request_type: requisition.request_type,
        requisition_date: requisitionDate,
        actual_age_days: calendarDayAge(requisitionDate, todayDate()),
        person_in_charge: requisition.person_in_charge ?? "-",
        stage_counts: stageCounts,
        sla_state: getRequisitionSlaState(requisition, {
          endDate: snapshot.status === "filled" ? filledDate ?? endDate : endDate
        }),
        filled_date: filledDate,
        period_status: snapshot.status,
        period_detail: snapshot.remark
      };
    })
    .sort(compareRequisitionDetailRows);
}

function isReportEligible(requisition: EnrichedRequisition, data: DashboardData, startDate: string, endDate: string, reportView: ReportView) {
  const prDate = validDateOnly(requisition.pr_approved_date);
  const snapshot = requisitionSnapshotAt(data, requisition, endDate);
  const closeDate = snapshot.filledDate;
  if (!prDate || snapshot.status === "cancel" || prDate > endDate || Boolean(closeDate && closeDate < startDate)) return false;
  if (reportView === "pim" || reportView === "custom") return true;
  const slaDays = getSlaDays(requisition.level);
  const slaDeadline = slaDays === null ? null : addCalendarDays(prDate, slaDays);
  return Boolean(slaDeadline && slaDeadline >= startDate);
}

function validDateOnly(value: string | null | undefined) {
  const date = dateOnly(value);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? date : null;
}

function buildDashboardPipelineFunnelRows(
  data: DashboardData,
  requisitions: EnrichedRequisition[],
  startDate: string,
  endDate: string,
  levelBands: FunnelLevelBand[],
  channelFilter: FunnelChannelFilter,
  language: Language
): PipelineFunnelRow[] {
  if (!startDate || !endDate || startDate > endDate) return buildPipelineFunnelRows(0, emptyFunnelStageCounts(), language);

  const eligibleRequisitions = requisitions.filter((requisition) =>
    requisition.status !== "cancel" && levelMatchesBands(requisition.level, levelBands)
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

function stageActivityCountsForDocGroups(data: DashboardData, docGroupIds: Set<string>, startDate: string, endDate: string) {
  const stageCandidates = Object.fromEntries(detailStages.map((stage) => [stage, new Set<string>()])) as Record<ProcessStage, Set<string>>;
  if (docGroupIds.size === 0) return emptyStageCounts();

  const candidateIds = new Set(
    data.candidates
      .filter((candidate) => Boolean(candidate.doc_group_id && docGroupIds.has(candidate.doc_group_id)))
      .map((candidate) => candidate.candidate_id)
  );

  for (const log of data.recruitment_logs) {
    const activityDate = dateOnly(log.result === 1 ? (log.outcome_date ?? log.log_date) : log.log_date);
    if (!activityDate || activityDate < startDate || activityDate > endDate || !candidateIds.has(log.candidate_id) || !detailStages.includes(log.recruitment_process)) continue;
    stageCandidates[log.recruitment_process].add(log.candidate_id);
  }

  return Object.fromEntries(detailStages.map((stage) => [stage, stageCandidates[stage].size])) as Record<ProcessStage, number>;
}

function passedStageActivityCountsForDocGroups(data: DashboardData, docGroupIds: Set<string>, startDate: string, endDate: string, channelFilter: FunnelChannelFilter = "all") {
  const stageCandidates = emptyFunnelCandidateSets();
  if (docGroupIds.size === 0) return emptyFunnelStageCounts();

  const candidateIds = new Set(
    data.candidates
      .filter((candidate) => Boolean(candidate.doc_group_id && docGroupIds.has(candidate.doc_group_id)) && channelMatchesFilter(candidate.channel, channelFilter))
      .map((candidate) => candidate.candidate_id)
  );

  for (const log of data.recruitment_logs) {
    const result = log.result;
    const logDate = dateOnly(result === 1 ? (log.outcome_date ?? log.log_date) : log.log_date);
    if (!logDate || logDate < startDate || logDate > endDate) continue;
    if (!candidateIds.has(log.candidate_id) || !detailStages.includes(log.recruitment_process)) continue;
    if (log.recruitment_process === "Phone Screen") stageCandidates["Resume Screening"].add(log.candidate_id);
    if (result === 1) stageCandidates[log.recruitment_process].add(log.candidate_id);
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

function isFunnelLevelBand(value: string | null | undefined): value is FunnelLevelBand {
  return value === "0-3" || value === "4-6" || value === "7-9" || value === "10-14";
}

function buildFunnelLevelOptions(language: Language): Array<{ value: FunnelLevelBand; label: string }> {
  return funnelLevelOptions;
}

function funnelLevelLabel(values: FunnelLevelBand[], language: Language) {
  return values.length === 0 ? translate(language, "allLevels") : buildFunnelLevelOptions(language).filter((option) => values.includes(option.value)).map((option) => option.label).join(", ");
}

function levelMatchesBands(level: string | null | undefined, bands: FunnelLevelBand[]) {
  if (bands.length === 0) return true;
  const numericLevel = Number.parseInt(String(level ?? "").replace(/^L/i, ""), 10);
  if (!Number.isFinite(numericLevel)) return false;
  return bands.some((band) => (band === "0-3" && numericLevel >= 0 && numericLevel <= 3)
    || (band === "4-6" && numericLevel >= 4 && numericLevel <= 6)
    || (band === "7-9" && numericLevel >= 7 && numericLevel <= 9)
    || (band === "10-14" && numericLevel >= 10 && numericLevel <= 14));
}

function compareRequisitionDetailRows(a: RequisitionDetailRow, b: RequisitionDetailRow) {
  const siteDelta = a.site.localeCompare(b.site);
  if (siteDelta !== 0) return siteDelta;
  const statusDelta = (a.period_status === "ongoing" ? 0 : 1) - (b.period_status === "ongoing" ? 0 : 1);
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
  return [...rows].sort((a, b) => a.site.localeCompare(b.site) || requestTypeRank(a.request_type) - requestTypeRank(b.request_type));
}

function requestTypeRank(requestType: RequisitionRequestType) {
  return requestType === "Replacement" ? 0 : 1;
}

function snapshotColor(site: string, requestType: string) {
  const originalColors: Record<string, { New: string; Replacement: string }> = {
    HQ: { New: "#90F5EC", Replacement: "#0AA0C3" },
    KT1: { New: "#80BDFF", Replacement: "#146EFA" },
    KT2: { New: "#C7BCF5", Replacement: "#411EDC" }
  };
  const original = originalColors[site]?.[requestType === "New" ? "New" : "Replacement"];
  if (original) return original;
  const palette = requestType === "New"
    ? ["#90F5EC", "#80BDFF", "#C7BCF5", "#CFE8B4", "#F8D3A2", "#F4C6DF"]
    : ["#0AA0C3", "#146EFA", "#411EDC", "#4B7F52", "#C56A16", "#A33B72"];
  return palette[stableColorIndex(site, palette.length)];
}

function stableColorIndex(value: string, length: number) {
  return [...value].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 0) % length;
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
  const openTotal = rows.filter((row) => row.waterfall_category === "Open").reduce((sum, row) => sum + Math.max(row.vacancy_count, 0), 0);
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
  for (const row of sortSnapshotRows(rows.filter((item) => item.vacancy_count !== 0))) {
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

function DashboardDateFilter({
  label,
  value,
  onChange,
  language
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  language: Language;
}) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => calendarMonth(value || today()));
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = validDateOnly(value);
  const monthStart = new Date(`${visibleMonth}-01T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0));
  const leadingDays = monthStart.getUTCDay();
  const dayCount = monthEnd.getUTCDate();
  const calendarDays = Array.from({ length: Math.ceil((leadingDays + dayCount) / 7) * 7 }, (_, index) => index - leadingDays + 1);
  const weekdayFormatter = new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", { weekday: "narrow" });

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function moveMonth(offset: number) {
    const next = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + offset, 1));
    setVisibleMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return <div className="grid gap-1.5 text-sm font-medium text-navy">
    <span className="text-xs font-semibold text-slate">{label}</span>
    <div ref={pickerRef} className="relative">
      <button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[#B8CCE4] bg-white px-3 text-left text-sm font-semibold text-navy shadow-sm transition hover:border-primary/60 hover:bg-[#FBFDFF] focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setVisibleMonth(calendarMonth(value || today())); setOpen((current) => !current); }}>
        <CalendarDays size={16} className="shrink-0 text-primary" aria-hidden="true" />
        <span className={`min-w-0 flex-1 truncate tabular-nums ${selectedDate ? "" : "text-slate"}`}>{selectedDate ? formatDate(selectedDate, language) : translate(language, "selectDate")}</span>
        <ChevronDown size={17} className={`shrink-0 text-slate transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open ? <div role="dialog" aria-label={label} className="absolute z-30 mt-2 w-[19rem] rounded-2xl border border-[#C9D5E6] bg-white p-3 shadow-[0_18px_40px_rgba(11,19,43,0.18)]">
        <div className="mb-3 flex items-center justify-between rounded-xl bg-[#F8FAFD] p-1">
          <button type="button" className="grid size-8 place-items-center rounded-lg text-slate transition hover:bg-white hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={translate(language, "previousMonth")} onClick={() => moveMonth(-1)}><ChevronLeft size={17} /></button>
          <span className="text-sm font-semibold tabular-nums text-navy">{monthPickerLabel(visibleMonth, language)}</span>
          <button type="button" className="grid size-8 place-items-center rounded-lg text-slate transition hover:bg-white hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={translate(language, "nextMonth")} onClick={() => moveMonth(1)}><ChevronRight size={17} /></button>
        </div>
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate" aria-hidden="true">
          {Array.from({ length: 7 }, (_, day) => <span key={day}>{weekdayFormatter.format(new Date(Date.UTC(2026, 5, day + 7)))}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day) => {
            if (day < 1 || day > dayCount) return <span key={`blank-${day}`} className="size-9" aria-hidden="true" />;
            const date = `${visibleMonth}-${String(day).padStart(2, "0")}`;
            const selected = selectedDate === date;
            return <button key={date} type="button" className={`grid size-9 place-items-center rounded-lg text-sm font-semibold tabular-nums transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${selected ? "bg-primary text-white shadow-sm" : "text-navy hover:bg-[#EAF2FC]"}`} aria-pressed={selected} onClick={() => { onChange(date); setOpen(false); }}>{day}</button>;
          })}
        </div>
      </div> : null}
    </div>
  </div>;
}

function today() {
  return formatLocalDateInput();
}

function stageCandidatesForRequisition(data: DashboardData, docId: string, stage: ProcessStage, mode: StageCountMode, startDate: string, endDate: string): StageCandidateMatch[] {
  const docGroupIds = docGroupIdsForGroupIds(data, groupIdsForRequisition(data, docId));
  const candidates = data.candidates.filter((candidate) => Boolean(candidate.doc_group_id && docGroupIds.has(candidate.doc_group_id)));
  return candidates.flatMap((candidate) => {
    const logs = data.recruitment_logs.filter((log) => log.candidate_id === candidate.candidate_id && log.recruitment_process === stage);
    const matching = mode === "activity"
      ? logs.find((log) => { const date = dateOnly(log.result === 1 ? (log.outcome_date ?? log.log_date) : log.log_date); return Boolean(date && date >= startDate && date <= endDate); })
      : logs.filter((log) => log.log_date <= endDate && (!log.outcome_date || log.outcome_date > endDate || log.result === null)).sort((a, b) => b.log_date.localeCompare(a.log_date) || b.log_id - a.log_id)[0];
    if (!matching) return [];
    return [{ candidateId: candidate.candidate_id, name: candidate.name, stage, pendingDate: matching.log_date, resultDate: dateOnly(matching.outcome_date), remark: matching.outcome_remark ?? matching.remark, result: matching.result }];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function pipelineStatusCountsForDocGroups(data: DashboardData, docGroupIds: Set<string>, endDate: string) {
  const stageCandidates = Object.fromEntries(detailStages.map((stage) => [stage, new Set<string>()])) as Record<ProcessStage, Set<string>>;
  const candidateIds = new Set(data.candidates.filter((candidate) => Boolean(candidate.doc_group_id && docGroupIds.has(candidate.doc_group_id))).map((candidate) => candidate.candidate_id));
  for (const candidateId of candidateIds) {
    const latest = data.recruitment_logs
      .filter((log) => log.candidate_id === candidateId && detailStages.includes(log.recruitment_process) && log.log_date <= endDate && (!log.outcome_date || log.outcome_date > endDate || log.result === null))
      .sort((a, b) => b.log_date.localeCompare(a.log_date) || b.log_id - a.log_id)[0];
    if (latest) stageCandidates[latest.recruitment_process].add(candidateId);
  }
  return Object.fromEntries(detailStages.map((stage) => [stage, stageCandidates[stage].size])) as Record<ProcessStage, number>;
}

function requisitionSnapshotAt(data: DashboardData, requisition: EnrichedRequisition, endDate: string) {
  const logs = data.requisition_logs.filter((log) => log.doc_id === requisition.doc_id);
  const latest = logs.filter((log) => log.log_date <= endDate).sort((a, b) => a.log_date.localeCompare(b.log_date) || a.log_id - b.log_id).at(-1);
  // Cancellation is a deliberate terminal action. Offer coverage, rather
  // than a requisition log, is the source of truth for Filled: automatic
  // offer updates do not create requisition_log rows.
  if (latest?.status === "cancel" || (logs.length === 0 && requisition.status === "cancel")) {
    return { status: "cancel" as RequisitionStatus, remark: latest?.remark ?? null, filledDate: null };
  }

  const offerFilledDate = offerFilledDateAtPeriodEnd(data, requisition, endDate);
  if (offerFilledDate) return { status: "filled" as RequisitionStatus, remark: latest?.remark ?? null, filledDate: offerFilledDate };

  if (latest?.status === "filled") {
    return { status: "filled" as RequisitionStatus, remark: latest.remark ?? null, filledDate: validDateOnly(latest.log_date) };
  }

  return { status: "ongoing" as RequisitionStatus, remark: latest?.remark ?? null, filledDate: null };
}

function offerFilledDateAtPeriodEnd(data: DashboardData, requisition: EnrichedRequisition, endDate: string) {
  const acceptanceDates = Array.from(new Set(
    data.offers
      .filter((offer) => offer.doc_id === requisition.doc_id)
      .map((offer) => validDateOnly(offer.accepted_date))
      .filter((date): date is string => Boolean(date && date <= endDate))
  )).sort();

  let filledDate: string | null = null;
  for (const date of acceptanceDates) {
    const coverageDate = addCalendarDays(date, 1);
    const coveredHeadcount = data.offers.filter((offer) => offer.doc_id === requisition.doc_id && countsTowardHeadcountAt(offer, coverageDate)).length;
    if (coveredHeadcount >= requisition.head_count) filledDate = date;
  }

  const coveredAtPeriodEnd = data.offers.filter((offer) => offer.doc_id === requisition.doc_id && countsTowardHeadcountAt(offer, addCalendarDays(endDate, 1))).length;
  return coveredAtPeriodEnd >= requisition.head_count ? filledDate : null;
}

async function waitForExportSurface() {
  await document.fonts?.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function hasVisiblePngContent(dataUrl: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = dataUrl;
  await image.decode();
  if (image.naturalWidth < 2 || image.naturalHeight < 2) return false;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const step = Math.max(4, Math.floor(Math.sqrt((canvas.width * canvas.height) / 4096)));
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const index = (y * canvas.width + x) * 4;
      if (data[index + 3] > 0 && (data[index] < 245 || data[index + 1] < 245 || data[index + 2] < 245)) return true;
    }
  }
  return false;
}

function calendarMonth(value: string) {
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : today().slice(0, 7);
}

function reportRange(view: ReportView, month: string, customStartDate: string, customEndDate: string) {
  if (view === "custom") return { startDate: customStartDate, endDate: customEndDate };
  const safeMonth = /^\d{4}-\d{2}$/.test(month) ? month : today().slice(0, 7);
  const [year, monthNumber] = safeMonth.split("-").map(Number);
  const endDate = `${safeMonth}-${String(new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()).padStart(2, "0")}`;
  return { startDate: view === "ytd" ? `${year}-01-01` : `${safeMonth}-01`, endDate };
}

function reportViewLabel(view: ReportView, language: Language) {
  return translate(language, view === "mtd" ? "monthToDate" : view === "ytd" ? "yearToDate" : view === "pim" ? "performanceInMonth" : "customRange");
}

function monthPickerLabel(value: string, language: Language) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function monthPickerMonthLabel(month: number, language: Language) {
  return new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", { month: "short" }).format(new Date(Date.UTC(2026, month - 1, 1)));
}

function isReportView(value: string | null): value is ReportView {
  return value === "mtd" || value === "ytd" || value === "pim" || value === "custom";
}

function addCalendarDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildReportSummary(requisitionRows: RequisitionDetailRow[], offers: EnrichedOffer[], startDate: string, endDate: string, language: Language) {
  const openRequisitions = requisitionRows.filter((row) => row.period_status === "ongoing").length;
  const activeVacancy = requisitionRows.reduce((sum, row) => sum + row.vacancy, 0);
  const filled = offers.filter((offer) => {
    const date = validDateOnly(offer.accepted_date);
    return Boolean(countsTowardHeadcount(offer) && date && date >= startDate && date <= endDate && requisitionRows.some((row) => row.doc_id === offer.doc_id));
  }).length;
  const performance = activeVacancy === 0 ? 0 : Math.floor((filled / activeVacancy) * 100);
  const overSla = requisitionRows.filter((row) => row.sla_state.isOverdue).length;
  return [
    { label: translate(language, "openRequisitions"), value: openRequisitions, tone: "primary" as const, helper: translate(language, "openRequisitionsHelper") },
    { label: translate(language, "filledVacancyRatio"), value: `${formatNumber(filled, language)}/${formatNumber(activeVacancy, language)} (${performance}%)`, tone: performance > 0 ? "teal" as const : "muted" as const, helper: translate(language, "acceptedOffersInRange") },
    { label: translate(language, "overSlaLabel"), value: overSla, tone: overSla > 0 ? "danger" as const : "success" as const, helper: translate(language, "needsReview") }
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

function calendarDayAge(startDate: string, endDate: string) {
  if (!startDate || !endDate) return null;
  return Math.max(Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000), 0);
}
