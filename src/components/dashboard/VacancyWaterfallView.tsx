"use client";

import { isReportEligible, validDateOnly, requisitionSnapshotAt, dateOnly } from "@/lib/dashboard-report-eligibility";
import { buildPipelineReport } from "@/lib/pipeline-report";
import { DashboardExportChooser } from "./DashboardExportChooser";
import { buildPipelineExportSnapshot, downloadDashboardWorkbook } from "@/lib/dashboard-workbook";
import { OnOffSwitch } from "@/components/ui/OnOffSwitch";

import { ArrowLeftRight, Download, FileSpreadsheet, ImageDown, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ReportHelp } from "./ReportHelp";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { CommandSelector } from "@/components/ui/CommandSelector";
import { Field } from "@/components/ui/Field";
import { OperationalSummaryStrip } from "@/components/ui/Operations";
import { PipelineFunnel, type PipelineFunnelRow } from "@/components/ui/PipelineFunnel";
import { SourceEffectiveness, type SourceEffectivenessRow } from "./SourceEffectiveness";
import { SortableFilterHeader, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import {
  ACTIVE_PIPELINE_STAGES,
  pipelineDisplayLabel,
  SOURCING_CHANNELS
} from "@/lib/constants";
import { filledSlaAtAcceptance, waterfallExecutiveRows } from "@/lib/vacancy-executive";
import { formatDate, formatNumber } from "@/lib/format";
import { organizationLabel, type DepartmentSectionRow } from "@/lib/department-section-data";
import { processStageLabel, requestTypeLabel, translate } from "@/lib/i18n/dictionary";
import { getRequisitionSlaState, type RequisitionSlaState, todayDate } from "@/lib/sla";
import { countsTowardHeadcount, countsTowardHeadcountAt } from "@/lib/offer-headcount";
import type { DashboardReportContext } from "./DashboardPortal";
import type {
  DashboardData,
  EnrichedOffer,
  EnrichedRequisition,
  Language,
  Offer,
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
type ReportView = "mtd" | "ytd" | "pim" | "custom";

type WaterfallRow = {
  waterfall_category: VacancyWaterfallCategory;
  site: string;
  request_type: RequisitionRequestType;
  vacancy_count: number;
  filledInSla?: number;
  filledSlaUnknown?: number;
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
  applicant_channels: Record<(typeof SOURCING_CHANNELS)[number]["count"], number>;
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
type StageCountMode = "status" | "activity" | "accum";
type ExportColumnKey = "site" | "department" | "department_th" | "section" | "section_th" | "position" | "level" | "vacancy" | "request_type" | "requisition_date" | "person_in_charge" | "status" | "detail" | "applicants" | (typeof SOURCING_CHANNELS)[number]["count"] | ProcessStage | "actual_age" | "sla" | "filled_date";
type StageCandidateMatch = { candidateId: string; name: string; stage: ProcessStage; pendingDate: string; resultDate: string | null; remark: string | null; result: 0 | 1 | null };
type StageCandidateReportDetail = StageCandidateMatch & { personInCharge: string };

export function VacancyWaterfallView({ context, reportGroup }: { context: DashboardReportContext; reportGroup: "vacancy" | "pipeline" }) {
  const { language, data, requisitions, offers, candidateOffers, preferences, onPreferencesChange, range, summary } = context;
  const reportView = preferences.period, funnelView = preferences.period;
  const executiveBreakdownOpen = preferences.executiveBreakdownOpen;
  const funnelLevelBands = preferences.levels, funnelChannel = preferences.funnelChannel, funnelLegend = preferences.funnelLegend;
  const setExecutiveBreakdownOpen = (open: boolean) => onPreferencesChange({ executiveBreakdownOpen: open });
  const setFunnelChannel = (channel: string) => onPreferencesChange({ funnelChannel: channel });
  const [exportPreparing, setExportPreparing] = useState(false);
  const [exportError, setExportError] = useState(false);
  const stageCountMode = preferences.stageCountMode;
  const setStageCountMode = (mode: StageCountMode) => onPreferencesChange({ stageCountMode: mode });
  const [exportOpen, setExportOpen] = useState(false);
  const exportColumns = preferences.exportColumns as ExportColumnKey[];
  const setExportColumns = (columns: ExportColumnKey[]) => onPreferencesChange({ exportColumns: columns });
  const [organizationRows, setOrganizationRows] = useState<DepartmentSectionRow[]>([]);
  const [stageDrilldown, setStageDrilldown] = useState<{ row: RequisitionDetailRow; stage: ProcessStage; matches: StageCandidateMatch[] } | null>(null);
  const [reportCandidate, setReportCandidate] = useState<StageCandidateReportDetail | null>(null);
  const chartExportRef = useRef<HTMLDivElement | null>(null);
  const requisitionExportRef = useRef<HTMLDivElement | null>(null);
  const funnelExportRef = useRef<HTMLDivElement | null>(null);
  const startDate = range.start, endDate = range.end, validReportRange = range.valid;
  const funnelStartDate = range.start, funnelEndDate = range.end, validFunnelRange = range.valid;

  const waterfallRows = useMemo(
    () => buildLiveWaterfallRows(data, requisitions, offers, startDate, endDate, reportView),
    [data, endDate, offers, reportView, requisitions, startDate]
  );
  const requisitionRows = useMemo(
    () => buildActiveRequisitionRows(data, requisitions, startDate, endDate, reportView, stageCountMode),
    [data, endDate, reportView, requisitions, stageCountMode, startDate]
  );
  const pipelineReport = useMemo(() => buildPipelineReport(data, candidateOffers, requisitions, { start: range.start, end: range.end, valid: range.valid }, funnelView, funnelLevelBands, funnelChannel, language), [data, candidateOffers, requisitions, range.start, range.end, range.valid, funnelView, funnelLevelBands, funnelChannel, language]);
  const { funnelRows, sourceRows } = pipelineReport;
  const pipelineMetadata = `${summary} · ${translate(language, "channelMeta")}: ${channelFilterLabel(funnelChannel, language)} · ${language === "th" ? "คำอธิบายสีช่องทาง" : "Channel legend"}: ${funnelLegend ? "ON" : "OFF"}`;
  const [pipelinePngSnapshot, setPipelinePngSnapshot] = useState<{ report: typeof pipelineReport; metadata: string; start: string; end: string; legend: boolean } | null>(null);
  const pngPipeline = pipelinePngSnapshot ?? { report: pipelineReport, metadata: pipelineMetadata, start: funnelStartDate, end: funnelEndDate, legend: funnelLegend };
  async function exportPipelineExcel() { const snapshot = buildPipelineExportSnapshot(context, pipelineReport); await downloadDashboardWorkbook(snapshot); }
  async function exportPipelinePng() {
    setPipelinePngSnapshot({ report: pipelineReport, metadata: pipelineMetadata, start: funnelStartDate, end: funnelEndDate, legend: funnelLegend });
    try { await exportPng(funnelExportRef.current, `pipeline-funnel-${funnelStartDate}-to-${funnelEndDate}.png`, 2, true); } finally { setPipelinePngSnapshot(null); }
  }
  const funnelHelp = language === "th"
    ? "ผู้สมัครมาจากยอดรายสัปดาห์ที่บันทึกไว้ ขั้นตอนจริงนับผู้สมัครไม่ซ้ำที่มีผลผ่านในช่วงวันที่เลือก หนึ่งครั้งต่อผู้สมัครต่อขั้นตอน Resume Screening เป็นขั้นแสดงผลที่นับผู้สมัครซึ่งเข้าสู่ Phone Screen ไม่จำเป็นต้องผ่าน Con% เทียบกับขั้นก่อนหน้า Yield เทียบกับผู้สมัคร และความกว้างแท่งเทียบกับผู้สมัคร"
    : "Applicants come from saved weekly sourcing counts. Each real stage counts distinct candidates with a passed result dated in the selected range, once per candidate per stage. Derived Resume Screening counts candidates who reached Phone Screen, whether or not they passed. Con% compares with the preceding row, Yield with Applicants, and bar width with Applicants.";
  const funnelExportWidth = 1920;
  const funnelExportHeight = 1080;
  const funnelApplicantTotal = funnelRows[0]?.count ?? 0;
  const funnelChannelOptions = useMemo(() => buildFunnelChannelOptions(data, language), [data, language]);
  const funnelChannelLabel = channelFilterLabel(funnelChannel, language);
  const reportSummary = useMemo(() => buildReportSummary(requisitionRows, offers, startDate, endDate, language), [endDate, language, offers, requisitionRows, startDate]);

  useEffect(() => {
    let active = true;
    fetch("/api/department-sections").then((response) => response.ok ? response.json() : []).then((rows: DepartmentSectionRow[]) => { if (active) setOrganizationRows(Array.isArray(rows) ? rows : []); }).catch(() => { if (active) setOrganizationRows([]); });
    return () => { active = false; };
  }, []);

  async function exportPng(surface: HTMLDivElement | null, filename: string, pixelRatio = 2, propagateError = false) {
    if (!surface) { if (propagateError) throw new Error("Missing export surface"); return; }
    setExportPreparing(true);
    setExportError(false);
    try {
      const { toPng } = await import("html-to-image");
      await waitForExportSurface();
      const width = surface.scrollWidth;
      const height = surface.scrollHeight;
      if (width < 2 || height < 2) throw new Error("Export surface has no dimensions");
      if (surface === funnelExportRef.current && (width > surface.clientWidth + 1 || height > surface.clientHeight + 1)) throw new Error("Pipeline export content exceeds its slide");
      const dataUrl = await toPng(surface, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        height,
        pixelRatio,
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
    } catch (error) {
      setExportError(true);
      if (propagateError) throw error;
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
      const stageModeLabel = translate(language, stageCountMode === "status" ? "pipelineStatus" : stageCountMode === "activity" ? "pipelineActivity" : "pipelineAccum");
      metadata.addRows([[translate(language, "generatedAt"), new Date().toISOString()], [translate(language, "generatedBy"), data.profile?.email ?? data.profile?.nickname ?? translate(language, "unknown")], [translate(language, "dateRange"), `${formatDate(startDate, language)} - ${formatDate(endDate, language)}`], [translate(language, "stageCountMode"), stageModeLabel], [translate(language, "rows"), requisitionRows.length], [language === "th" ? "ขอบเขตที่ใช้" : "Applied scope", summary]]);
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

  return (
    <div className="grid min-w-0 max-w-full gap-4 overflow-x-hidden">
      {reportGroup === "vacancy" ? <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] shadow-none">
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <h2 className="min-w-0 flex-1"><span><strong className="block text-lg font-semibold text-navy">{translate(language, "vacancyWaterfall")} &amp; {translate(language, "activeRequisitionsSelectedRange")}</strong><span className="text-sm font-medium text-slate">{summary} · {translate(language, "activeRequisitionsInRange", { count: formatNumber(requisitionRows.length, language), start: formatDate(startDate, language), end: formatDate(endDate, language) })}</span></span></h2>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
          <ReportHelp label={language === "th" ? "คำอธิบายกราฟอัตราว่าง" : "Vacancy Waterfall help"} text={language === "th" ? "แสดงการเปลี่ยนแปลงอัตราว่างจากต้นช่วงถึงปลายช่วง แท่งสีแยกสถานที่และประเภทคำขอ การบรรจุลดอัตราว่าง รายงานนี้ใช้ตัวกรองร่วมของแดชบอร์ด" : "Tracks open vacancies from the start to the end of the selected range. Stacks separate sites and request types; fills reduce open vacancies. The common dashboard filters apply to this report."} />
          <Button type="button" size="toolbar" variant="secondary" icon={<ImageDown size={16} />} aria-label={`${translate(language, "export")} ${translate(language, "vacancyWaterfall")} PNG`} title={`${translate(language, "export")} ${translate(language, "vacancyWaterfall")} PNG`} disabled={exportPreparing || !validReportRange} onClick={() => exportPng(chartExportRef.current, `vacancy-waterfall-${startDate}-to-${endDate}.png`)}>{translate(language, "export")}</Button>
          <Button type="button" size="toolbar" variant="secondary" icon={<Download size={16} />} aria-label={`${translate(language, "export")} ${translate(language, "activeRequisitionsSelectedRange")}`} title={`${translate(language, "export")} ${translate(language, "activeRequisitionsSelectedRange")}`} disabled={exportPreparing || !validReportRange} onClick={() => { if (!exportColumns.length) setExportColumns(defaultExportColumns()); setExportOpen(true); }}>{translate(language, "export")}</Button>
          </div>
        </div>
        <div className="border-t border-[#E4E9F2] bg-white py-4">
        <div className="mb-5 px-4 sm:px-6 lg:px-8">
          <OperationalSummaryStrip density="compact" items={reportSummary} />
        </div>

        {waterfallRows.length === 0 ? (
          <div className="px-4 sm:px-6 lg:px-8">
            <EmptyState variant="quiet" message={translate(language, "noWaterfallData")} />
          </div>
        ) : null}
        {validReportRange ? (
          <div className="bg-white">
            <VacancyWaterfallChart sites={requisitions.map(row => row.site)} breakdownOpen={executiveBreakdownOpen} onBreakdownChange={setExecutiveBreakdownOpen} language={language} rows={waterfallRows} startDate={startDate} endDate={endDate} />
          </div>
        ) : null}
        {exportError ? <p className="mx-4 mb-1 text-sm font-medium text-danger sm:mx-6 lg:mx-8" role="alert">{translate(language, "exportPngFailed")}</p> : null}
        <div className="min-w-0 max-w-full overflow-hidden border-t border-[#E4E9F2] bg-white p-4 sm:p-6 lg:p-8">
          <h3 className="mb-3 text-lg font-semibold text-navy">{translate(language, "activeRequisitionsSelectedRange")}</h3>
            <div className="mb-3 inline-flex rounded-xl border border-[#C9D5E6] bg-[#F8FAFD] p-1" role="group" aria-label={translate(language, "stageCountMode")}>
              {(["activity", "status", "accum"] as StageCountMode[]).map((mode) => <button key={mode} type="button" className={`rounded-lg px-3 py-2 text-sm font-semibold ${stageCountMode === mode ? "bg-primary text-white shadow-sm" : "text-slate hover:bg-white"}`} aria-pressed={stageCountMode === mode} onClick={() => setStageCountMode(mode)}>{translate(language, mode === "status" ? "pipelineStatus" : mode === "activity" ? "pipelineActivity" : "pipelineAccum")}</button>)}
            </div>
            {stageCountMode === "accum" ? <p className="mb-3 text-sm font-medium text-slate">{translate(language, "pipelineAccumHelp")}</p> : null}
            <RequisitionDetailTable rows={requisitionRows} language={language} onStageClick={(row, stage) => setStageDrilldown({ row, stage, matches: stageCandidatesForRequisition(data, row.doc_id, stage, stageCountMode, startDate, endDate) })} />
          </div>
        </div>
      </section> : null}

      {reportGroup === "pipeline" ? <section className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-[#E4E9F2] bg-[#F8FAFD] shadow-none">
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <h2 className="min-w-0 flex-1">
            <strong className="block text-lg font-semibold text-navy">{translate(language, "recruitmentPipelineHealthSelectedRange")}</strong>
            <span className="text-sm font-medium text-slate">{summary} · {translate(language, "applicantsInRange", { count: formatNumber(funnelApplicantTotal, language), start: formatDate(funnelStartDate, language), end: formatDate(funnelEndDate, language), level: funnelLevelLabel(funnelLevelBands, language), channel: funnelChannelLabel })}</span>
          </h2>
          <div className="flex flex-wrap gap-2 print:hidden">
            <DashboardExportChooser language={language} title={language === "th" ? "กระบวนการและช่องทางสรรหา" : "Pipeline & Sources"} summary={pipelineMetadata} pngLabel={`${translate(language, "export")} ${translate(language, "recruitmentPipelineHealth")} PNG`} disabled={exportPreparing || !validFunnelRange} onPng={exportPipelinePng} onExcel={exportPipelineExcel} />
          </div>
        </div>
          <div className="grid min-w-0 gap-4 border-t border-[#E4E9F2] bg-white p-4 sm:p-6 lg:p-8">
            <div data-testid="pipeline-filters" className="dashboard-filter-toolbar pipeline-filter-toolbar flex min-w-0 flex-wrap items-end gap-3 rounded-xl border border-[#E4E9F2] bg-[#F8FAFD] p-3">
              <DashboardFilterPicker label={translate(language, "channel")} options={funnelChannelOptions} value={funnelChannel} onValueChange={setFunnelChannel} />
              <div className="grid min-w-0 gap-1 text-xs font-medium text-slate"><span>{language === "th" ? "คำอธิบายสีช่องทาง" : "Channel legend"}</span><OnOffSwitch checked={funnelLegend} onCheckedChange={funnelLegend => onPreferencesChange({ funnelLegend })} label={language === "th" ? "คำอธิบายสีช่องทาง" : "Channel legend"} language={language} title={language === "th" ? "สลับคำอธิบายสีช่องทาง" : "Toggle channel legend"} /></div>
            </div>
            {validFunnelRange ? null : <p role="alert" className="text-sm font-medium text-danger">{translate(language, "invalidCustomDateRange")}</p>}
            <div className="grid min-w-0 gap-3 min-[1080px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-testid="pipeline-source-layout">
            <PipelineFunnel
              language={language}
              rows={funnelRows}
              title={translate(language, "recruitmentPipelineHealth")}
              helpText={funnelHelp}
              compactAtDesktop
              totalValue={funnelApplicantTotal}
              showTotalSummary={false}
              showChannelLegend={funnelLegend}
            />
            <SourceEffectiveness rows={sourceRows} language={language} />
            </div>
            <p className="text-sm font-medium text-slate">{funnelApplicantTotal === 0 ? translate(language, "noApplicantsMatchFunnelFilters") : translate(language, "topBottleneck", { value: topFunnelBottleneck(funnelRows, language) })}</p>
          </div>
      </section> : null}

      {reportGroup === "vacancy" ? <div ref={requisitionExportRef} className="export-report-surface" aria-hidden="true">
        <ReportHeader exportMode language={language} title={translate(language, "activeRequisitionsSelectedRange")} startDate={startDate} endDate={endDate} meta={`${summary} · ${translate(language, "stageCountModeMeta", { mode: translate(language, stageCountMode === "status" ? "pipelineStatus" : stageCountMode === "activity" ? "pipelineActivity" : "pipelineAccum") })}`} />
        <RequisitionExportTable rows={requisitionRows} language={language} organizationRows={organizationRows} columns={exportColumns} />
      </div> : null}
      <ActiveRequisitionExportModal open={exportOpen} language={language} rows={requisitionRows} organizationRows={organizationRows} columns={exportColumns} onClose={() => setExportOpen(false)} onColumnsChange={setExportColumns} onExportXlsx={() => exportRequisitionDetailXlsx(exportColumns)} onExportPng={() => exportPng(requisitionExportRef.current, `active-requisitions-${startDate}-to-${endDate}.png`)} />
      <StageCandidateModal language={language} drilldown={stageDrilldown} onClose={() => setStageDrilldown(null)} onOpenCandidate={(candidate) => setReportCandidate({ ...candidate, personInCharge: stageDrilldown?.row.person_in_charge ?? "" })} />
      <ReportCandidateDetail language={language} candidate={reportCandidate} onClose={() => setReportCandidate(null)} />

      {reportGroup === "vacancy" ? <div ref={chartExportRef} className="export-report-surface" aria-hidden="true">
        <p className="px-4 py-2 text-sm text-slate">{summary}</p>
        <VacancyWaterfallChart sites={requisitions.map(row => row.site)} isExport breakdownOpen={executiveBreakdownOpen} language={language} rows={waterfallRows} startDate={startDate} endDate={endDate} />
      </div> : null}

      {reportGroup === "pipeline" ? <div ref={funnelExportRef} className="export-report-surface flex flex-col" style={{ width: funnelExportWidth, minWidth: funnelExportWidth, height: funnelExportHeight, minHeight: funnelExportHeight }} aria-hidden="true">
        <ReportHeader exportMode language={language} title={translate(language, "recruitmentPipelineHealthSelectedRange")} startDate={pngPipeline.start} endDate={pngPipeline.end} meta={pngPipeline.metadata} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-3">
        <PipelineFunnel
          language={language}
          rows={pngPipeline.report.funnelRows}
          title={translate(language, "recruitmentPipelineHealth")}
          helpText={funnelHelp}
          exportMode
          totalValue={pngPipeline.report.funnelRows[0]?.count ?? 0}
          showTotalSummary={false}
          showChannelLegend={pngPipeline.legend}
        />
        <SourceEffectiveness rows={pngPipeline.report.sourceRows} language={language} exportMode />
        </div>
      </div> : null}

      {exportPreparing && reportGroup === "vacancy" ? (
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
  label,
  options,
  value,
  onValueChange
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return <div className="grid min-w-0 gap-1 text-sm font-medium text-navy">
    <span className="truncate text-xs font-medium text-slate" title={label}>{label}</span>
    <CommandSelector typography="normal" ariaLabel={label} emptyLabel={label} options={options} value={value} onValueChange={onValueChange} />
  </div>;
}

function ReportHeader({ exportMode = false, language, title, startDate, endDate, meta }: { exportMode?: boolean; language: Language; title: string; startDate: string; endDate: string; meta?: string }) {
  return (
    <div className={`${exportMode ? "block" : "hidden print-report-header"} px-4 pb-3 sm:px-6 lg:px-8`}>
      <h1 className="text-2xl font-semibold text-navy">{title}</h1>
      <p className="text-sm text-slate">{translate(language, "dateRange")}: {formatDate(startDate, language)} - {formatDate(endDate, language)}</p>
      {meta ? <p className="text-sm text-slate">{meta}</p> : null}
    </div>
  );
}

function VacancyWaterfallChart({ language, rows, sites = [], startDate, endDate, isExport = false, breakdownOpen = false, onBreakdownChange }: { language: Language; rows: WaterfallRow[]; sites?: string[]; startDate?: string; endDate?: string; isExport?: boolean; breakdownOpen?: boolean; onBreakdownChange?: (open: boolean) => void }) {
  const chart = buildWaterfall(rows, language, sites);
  const plotWidth = 900;
  const leftAnnotationLane = 8;
  const leftPlotPadding = 144;
  const rightPlotPadding = 144;
  const plotHeight = 480;
  const topPad = 64;
  const bottomPad = 44;
  const height = topPad + plotHeight + bottomPad;
  const leftPad = leftAnnotationLane + leftPlotPadding;
  const width = leftPad + plotWidth + rightPlotPadding;
  const plotRight = leftPad + plotWidth;
  const yMax = chart.yMax;
  const yScale = (value: number) => topPad + ((yMax - Math.max(value, 0)) / Math.max(yMax, 1)) * plotHeight;
  const step = plotWidth / Math.max(chart.categories.length, 1);
  const barWidth = Math.min(96, Math.max(52, step * 0.5));
  const zeroY = yScale(0);
  const totalBar = chart.bars.find((bar) => bar.categoryType === "total");
  const categoryPosition = (index: number) => leftPad + step * (index + 0.5);
  const weekStartBar = chart.bars.find((bar) => bar.categoryType === "weekStart");
  const totalBarRight = totalBar ? categoryPosition(totalBar.categoryIndex) + barWidth / 2 : plotRight;
  const weekStartBarLeft = weekStartBar ? categoryPosition(weekStartBar.categoryIndex) - barWidth / 2 : leftPad;

  return (
    <div className="chart-report-body w-full pb-2">
      <div className="w-full px-2 sm:px-3 lg:px-4">
        {!isExport ? <h3 className="screen-chart-title px-1 text-2xl font-semibold leading-tight tracking-normal text-navy sm:text-[26px]">{(language === "th" ? "ผลการสรรหาในช่วงเวลาที่เลือก" : "Recruitment Performance in Selected Period")}</h3> : null}
        <div className={`${isExport ? "mt-0" : "mt-2"} grid min-w-0 gap-4`}>
          <div>
            {isExport ? <><h3 className="screen-chart-title px-1 text-2xl font-semibold leading-tight tracking-normal text-navy sm:text-[26px]">{(language === "th" ? "ผลการสรรหาในช่วงเวลาที่เลือก" : "Recruitment Performance in Selected Period")}</h3><p className="mt-1 px-1 text-sm font-light text-slate">{formatDate(startDate!, language)} - {formatDate(endDate!, language)}</p></> : null}
            {!isExport && startDate && endDate ? <p className="mt-1 px-1 text-sm text-slate">{formatDate(startDate, language)} – {formatDate(endDate, language)}</p> : null}
            <WaterfallExecutiveSummary language={language} rows={rows} />
          </div>
          <WaterfallExecutiveSummaryTable language={language} rows={rows} breakdownOpen={breakdownOpen} onBreakdownChange={onBreakdownChange} />
        </div>
        <div className="chart-legend mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-[#E4E9F2] px-1 pt-3">
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
      <svg viewBox={`0 0 ${width} ${height}`} className="vacancy-waterfall-svg block aspect-[53/28] h-auto w-full max-w-full">
        {weekStartBar ? <LeftSegmentBrackets x={weekStartBarLeft - 18} segments={siteSummarySegments(weekStartBar.segments, yScale, language, ":")} /> : null}
        {totalBar ? <RightSegmentBrackets x={totalBarRight + 18} segments={siteSummarySegments(totalBar.segments, yScale, language, ":")} /> : null}
        <line x1={leftPad} x2={plotRight} y1={zeroY} y2={zeroY} stroke="#526173" strokeWidth={1} />
        {chart.connectors.map((connector) => {
          const x1 = categoryPosition(connector.from) + barWidth / 2;
          const x2 = categoryPosition(connector.to) - barWidth / 2;
          const y = yScale(connector.value);
          return <line key={`${connector.from}-${connector.to}`} x1={x1} x2={x2} y1={y} y2={y} stroke="#96A3B4" strokeWidth={1.5} />;
        })}
        {chart.bars.map((bar) => {
          const x = categoryPosition(bar.categoryIndex) - barWidth / 2;
          return (
            <g key={bar.key} data-waterfall-category={bar.key}>
              {bar.segments.map((segment) => {
                const yA = yScale(segment.bottom);
                const yB = yScale(segment.top);
                const y = Math.min(yA, yB);
                const rectHeight = Math.max(Math.abs(yB - yA), 1);
                const description = `${formatCategoryLabel(language, chart.categories[bar.categoryIndex])} · ${segment.site} · ${requestTypeLabel(language, segment.requestType)}: ${formatNumber(Math.abs(segment.value), language)}`;
                return <g key={segment.key} tabIndex={isExport ? undefined : 0} aria-label={description}><title>{description}</title><rect x={x} y={y} width={barWidth} height={rectHeight} fill={segment.color} rx={0} />{rectHeight >= 22 ? <text x={x + barWidth / 2} y={y + rectHeight / 2} textAnchor="middle" dominantBaseline="middle" fill={oppositeSnapshotColor(segment.site, segment.requestType)} className="text-[15px] font-light">{formatNumber(Math.abs(segment.value), language)}</text> : null}</g>;
              })}
              <text x={x + barWidth / 2} y={yScale(bar.labelAnchor) - 14} textAnchor="middle" className="fill-navy text-[24px] font-light">
                {bar.label}
              </text>
            </g>
          );
        })}
        {chart.categories.map((category, index) => (
          <text key={category} x={categoryPosition(index)} y={height - 22} textAnchor="middle" className="fill-slate text-[13px] font-semibold">
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

function LeftSegmentBrackets({ x, segments }: { x: number; segments: { key: string; label: string; yTop: number; yBottom: number }[] }) {
  return <g>{segments.filter((segment) => segment.label?.trim()).map((segment) => {
    const rawTop = Math.min(segment.yTop, segment.yBottom);
    const rawBottom = Math.max(segment.yTop, segment.yBottom);
    const mid = (rawTop + rawBottom) / 2;
    const height = Math.max(rawBottom - rawTop - 8, 18);
    const top = mid - height / 2;
    const bottom = mid + height / 2;
    const width = 12;
    const radius = Math.min(5, height / 3);
    const tipWidth = 6;
    const tipHeight = Math.min(7, height * 0.18);
    const d = [`M ${x} ${top}`, `H ${x - width + radius}`, `Q ${x - width} ${top} ${x - width} ${top + radius}`, `V ${mid - tipHeight}`, `L ${x - width - tipWidth} ${mid}`, `L ${x - width} ${mid + tipHeight}`, `V ${bottom - radius}`, `Q ${x - width} ${bottom} ${x - width + radius} ${bottom}`, `H ${x}`].join(" ");
    return <g key={segment.key}><path d={d} fill="none" stroke="#526173" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /><text x={x - width - tipWidth - 12} y={mid} textAnchor="end" dominantBaseline="middle" className="fill-slate-600 text-[22px] font-light">{segment.label}</text></g>;
  })}</g>;
}

function WaterfallExecutiveSummary({ language, rows }: { language: Language; rows: WaterfallRow[] }) {
  const start = rows.filter((row) => row.waterfall_category === "Week Start").reduce((sum, row) => sum + row.vacancy_count, 0);
  const end = rows.filter((row) => row.waterfall_category === "Total").reduce((sum, row) => sum + row.vacancy_count, 0);
  const openings = rows.filter((row) => row.waterfall_category === "Open").reduce((sum, row) => sum + Math.abs(row.vacancy_count), 0);
  const filled = rows.filter((row) => row.waterfall_category === "Filled").reduce((sum, row) => sum + Math.abs(row.vacancy_count), 0);
  const bySite = new Map<string, { total: number; types: Map<RequisitionRequestType, number> }>();
  for (const row of rows.filter((row) => row.waterfall_category === "Total")) {
    const entry = bySite.get(row.site) ?? { total: 0, types: new Map<RequisitionRequestType, number>() };
    entry.total += row.vacancy_count;
    entry.types.set(row.request_type, (entry.types.get(row.request_type) ?? 0) + row.vacancy_count);
    bySite.set(row.site, entry);
  }
  const backlog = Array.from(bySite, ([site, value]) => ({ site, ...value })).sort((a, b) => b.total - a.total)[0];
  const composition = backlog ? Array.from(backlog.types, ([type, value]) => ({ type, value })).sort((a, b) => b.value - a.value)[0] : null;
  const direction = end === start ? "unchanged" : end > start ? "increased" : "decreased";
  const net = end - start;
  const className = "mt-1 max-w-5xl px-1 text-sm font-normal leading-relaxed text-slate [&_strong]:font-normal";
  if (language === "th") return <p className={className}>ในช่วงเวลาที่เลือก จำนวนอัตรารวม<strong> {direction === "unchanged" ? `คงเดิมที่ ${formatNumber(end, language)}` : `${direction === "increased" ? "เพิ่ม" : "ลด"}จาก ${formatNumber(start, language)} เป็น ${formatNumber(end, language)}`} ({net >= 0 ? "+" : ""}{formatNumber(net, language)})</strong> จากการเปิดใหม่ <strong>{formatNumber(openings, language)}</strong> อัตรา และบรรจุแล้ว <strong>{formatNumber(filled, language)}</strong> อัตรา{backlog ? <> โดยคงค้างสูงสุดที่ <strong>{backlog.site} {formatNumber(backlog.total, language)}</strong> อัตรา ส่วนใหญ่เป็น <strong>{composition?.type === "Replacement" ? translate(language, "replacementVacancy") : translate(language, "newVacancy")}</strong></> : null}.</p>;
  return <p className={className}>During the selected period, total vacancies <strong>{direction === "unchanged" ? `remained at ${formatNumber(end, language)}` : `${direction} from ${formatNumber(start, language)} to ${formatNumber(end, language)}`} ({net >= 0 ? "+" : ""}{formatNumber(net, language)})</strong>, driven by <strong>{formatNumber(openings, language)} openings</strong> against <strong>{formatNumber(filled, language)} positions filled</strong>{backlog ? <>. The remaining backlog is concentrated at <strong>{backlog.site} with {formatNumber(backlog.total, language)} vacancies</strong>, primarily <strong>{composition?.type === "Replacement" ? "replacement" : "new"} vacancies</strong></> : null}.</p>;
}

function WaterfallExecutiveSummaryTable({ language, rows, breakdownOpen = false, onBreakdownChange }: { language: Language; rows: WaterfallRow[]; breakdownOpen?: boolean; onBreakdownChange?: (open: boolean) => void }) {
  const summaryRows = waterfallExecutiveRows(rows);
  const th = language === "th";
  const labels = th
    ? ["สถานที่", "อัตราว่างต้นงวด", "เปิดเพิ่ม", "บรรจุแล้ว", "บรรจุใน SLA", "เปลี่ยนแปลงสุทธิ", "อัตราว่างปลายงวด"]
    : ["Site", "Opening vac.", "Opened", "Filled", "Filled in SLA", "Net change", "Closing vac."];
  const signed = (value: number) => `${value > 0 ? "+" : ""}${formatNumber(value, language)}`;
  const missing = th ? "ไม่สามารถคำนวณ SLA ได้ เนื่องจากข้อมูลวันที่หรือระดับของตำแหน่งที่บรรจุบางรายการไม่สมบูรณ์" : "SLA unavailable: some filled positions have missing or invalid dates or levels.";
  const siteLabel = (row: ReturnType<typeof waterfallExecutiveRows>[number]) => row.grandTotal ? translate(language, "total") : row.site;
  return <div className="min-w-0">
    <div className="waterfall-executive-table max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={th ? "สรุปอัตราว่างตามสถานที่" : "Executive vacancy summary by site"}>
      <table className="mx-auto w-max min-w-[42rem] border-collapse text-right text-sm tabular-nums">
        <caption className="sr-only">{th ? "สรุปอัตราว่างตามสถานที่" : "Executive vacancy summary by site"}</caption>
        <thead><tr className="border-b border-[#C9D5E6] text-slate">{labels.map((label, index) => <th key={label} scope="col" className={`px-3 py-2 text-center font-medium ${index === 0 ? "text-left" : ""} ${index === 6 ? "bg-[#F0F4FA]" : ""}`}>{label}</th>)}</tr></thead>
        <tbody>{summaryRows.map(row => <tr key={row.site} className={row.grandTotal ? "border-t-2 border-[#C9D5E6] font-semibold text-navy" : "border-t border-[#E4E9F2] text-slate"}>
          <th scope="row" className="px-3 py-2.5 text-left font-medium"><span className="inline-flex items-center gap-1.5"><span className="size-2 shrink-0" style={{ backgroundColor: row.grandTotal ? "#0B132B" : snapshotColor(row.site, "New") }} aria-hidden="true" />{siteLabel(row)}</span></th>
          <td className="px-3 py-2.5 font-semibold text-navy">{formatNumber(row.opening, language)}</td>
          <td className="px-3 py-2.5">{signed(row.opened)}</td>
          <td className="px-3 py-2.5">{signed(-row.filled)}</td>
          <td className="px-3 py-2.5" title={row.unknown ? missing : row.filled === 0 ? (th ? "ไม่มีการบรรจุในช่วงเวลานี้" : "No positions filled in this period") : `${row.inSla}/${row.filled}`}>
            {row.slaPercent === null ? "—" : `${row.slaPercent}%`}
          </td>
          <td className="px-3 py-2.5 font-semibold text-navy">{signed(row.net)}</td>
          <td className="bg-[#F0F4FA] px-3 py-2.5 font-semibold text-navy">{formatNumber(row.closing, language)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {summaryRows.some(row => row.unknown > 0) ? <p className="mt-2 text-xs text-slate">{missing}</p> : null}
    <details open={breakdownOpen} onToggle={event => onBreakdownChange?.(event.currentTarget.open)} className="mt-2 text-sm text-slate">
      <summary className="w-fit cursor-pointer rounded px-1 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{th ? "รายละเอียดเปิดเพิ่มและบรรจุ: เพิ่มใหม่ / ทดแทน" : "Opened and filled breakdown: New / Replacement"}</summary>
      <div className="max-w-full overflow-x-auto">
        <table className="mx-auto w-max min-w-[32rem] border-collapse text-right text-sm tabular-nums">
          <thead><tr className="border-b border-[#C9D5E6]">{[labels[0], th ? "เปิดเพิ่ม: เพิ่มใหม่" : "Opened: New", th ? "เปิดเพิ่ม: ทดแทน" : "Opened: Replacement", th ? "บรรจุ: เพิ่มใหม่" : "Filled: New", th ? "บรรจุ: ทดแทน" : "Filled: Replacement"].map((label, index) => <th key={label} scope="col" className={`px-3 py-2 text-center font-medium ${index === 0 ? "text-left" : ""}`}>{label}</th>)}</tr></thead>
          <tbody>{summaryRows.map(row => <tr key={row.site} className={`border-t border-[#E4E9F2] ${row.grandTotal ? "font-semibold" : ""}`}><th scope="row" className="px-3 py-2 text-left font-medium"><span className="inline-flex items-center gap-1.5"><span className="size-2 shrink-0" style={{ backgroundColor: row.grandTotal ? "#0B132B" : snapshotColor(row.site, "New") }} aria-hidden="true" />{siteLabel(row)}</span></th>{[row.openNew, row.openReplacement, -row.filledNew, -row.filledReplacement].map((value, i) => <td key={i} className="px-3 py-2">{signed(value)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  </div>;
}

function siteSummarySegments(
  segments: Array<{ key: string; site: string; value: number; top: number; bottom: number }>,
  yScale: (value: number) => number,
  language: Language,
  separator = "—"
) {
  const grouped = new Map<string, { value: number; top: number; bottom: number }>();
  for (const segment of segments) {
    const existing = grouped.get(segment.site);
    grouped.set(segment.site, existing ? { value: existing.value + segment.value, top: Math.max(existing.top, segment.top), bottom: Math.min(existing.bottom, segment.bottom) } : { value: segment.value, top: segment.top, bottom: segment.bottom });
  }
  return Array.from(grouped, ([site, summary]) => ({ key: site, label: `${site}${separator} ${formatNumber(summary.value, language)}`, yTop: yScale(summary.top), yBottom: yScale(summary.bottom) }));
}

function exportColumnLabel(key: ExportColumnKey, language: Language) {
  const channel = SOURCING_CHANNELS.find((item) => item.count === key);
  if (channel) return `${channel.label} ${translate(language, "applicants")}`;
  return key === "department" ? "Department" : key === "section" ? "Section" : key === "department_th" ? translate(language, "departmentThai") : key === "section_th" ? translate(language, "sectionThai") : key === "request_type" ? translate(language, "requestType") : key === "requisition_date" ? translate(language, "requisitionDate") : key === "person_in_charge" ? translate(language, "personInCharge") : key === "actual_age" ? translate(language, "actualAge") : key === "filled_date" ? translate(language, "filledDate") : key === "applicants" ? translate(language, "applicants") : key === "sla" ? translate(language, "slaAtPeriodEnd") : detailStages.includes(key as ProcessStage) ? processStageLabel(language, key as ProcessStage) : translate(language, key);
}

function ActiveRequisitionExportModal({ open, language, rows, organizationRows, columns, onClose, onColumnsChange, onExportXlsx, onExportPng }: { open: boolean; language: Language; rows: RequisitionDetailRow[]; organizationRows: DepartmentSectionRow[]; columns: ExportColumnKey[]; onClose: () => void; onColumnsChange: (columns: ExportColumnKey[]) => void; onExportXlsx: () => void; onExportPng: () => void }) {
  const registry: ExportColumnKey[] = ["site", "department", "department_th", "section", "section_th", "position", "level", "vacancy", "request_type", "requisition_date", "person_in_charge", "status", "detail", "applicants", ...SOURCING_CHANNELS.map((channel) => channel.count), ...detailStages, "actual_age", "sla", "filled_date"];
  const label = (key: ExportColumnKey) => exportColumnLabel(key, language);
  const [dragging, setDragging] = useState<ExportColumnKey | null>(null);
  const [insertBefore, setInsertBefore] = useState<ExportColumnKey | null>(null);
  return <Modal open={open} title={translate(language, "export")} onClose={onClose} width="max-w-6xl" compactControls><div className="dashboard-compact-controls grid gap-4"><p className="text-sm text-slate">{translate(language, "exportColumnHelp")}</p><div className="grid max-h-52 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-[#D7DEE8] p-3 sm:grid-cols-2 lg:grid-cols-4">{registry.map((key) => <label key={key} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[#E4E9F2] bg-white px-3 py-2.5 shadow-sm transition hover:border-[#B8CCE4] hover:bg-[#F8FAFD]"><span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-navy"><span className="truncate">{label(key)}</span><span className="group relative shrink-0"><Info size={14} className="text-slate" aria-label={translate(language, "exportFieldDescription", { field: label(key) })} /><span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 w-64 rounded-lg bg-navy px-3 py-2 text-xs font-normal leading-relaxed text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">{exportFieldDescription(key, language)}<span className="absolute right-1.5 top-full border-x-4 border-t-4 border-x-transparent border-t-navy" /></span></span></span><input type="checkbox" checked={columns.includes(key)} onChange={() => onColumnsChange(columns.includes(key) ? columns.filter((value) => value !== key) : [...columns, key])} /></label>)}</div><div className="overflow-x-auto rounded-xl border border-[#D7DEE8]"><table className="min-w-max text-xs"><thead><tr>{columns.map((key) => <th key={key} className={`border-b bg-[#F8FAFD] px-3 py-2 text-left transition-[padding,margin] ${insertBefore === key && dragging !== key ? "border-l-4 border-l-primary pl-7" : ""}`} onDragEnter={(event) => { event.preventDefault(); if (dragging && dragging !== key) setInsertBefore(key); }} onDragOver={(event) => { event.preventDefault(); if (dragging && dragging !== key) setInsertBefore(key); }} onDrop={(event) => { event.preventDefault(); const from = (event.dataTransfer.getData("text/plain") || dragging) as ExportColumnKey | null; if (from && from !== key) { const next = columns.filter((item) => item !== from); const targetIndex = next.indexOf(key); if (targetIndex >= 0) { next.splice(targetIndex, 0, from); onColumnsChange(next); } } setDragging(null); setInsertBefore(null); }}><button type="button" draggable onDragStart={(event) => { event.dataTransfer.setData("text/plain", key); event.dataTransfer.effectAllowed = "move"; setDragging(key); }} onDragEnd={() => { setDragging(null); setInsertBefore(null); }} className="inline-flex cursor-grab items-center gap-1.5 font-semibold text-navy active:cursor-grabbing"><ArrowLeftRight size={15} aria-hidden="true" /> {label(key)}</button></th>)}</tr></thead><tbody>{rows.slice(0, 5).map((row) => <tr key={row.doc_id}>{columns.map((key) => <td key={key} className="max-w-44 truncate border-t px-3 py-2" title={String(exportValue(row, key, language, organizationRows))}>{previewValue(exportValue(row, key, language, organizationRows))}</td>)}</tr>)}</tbody></table></div><div className="flex flex-wrap justify-end gap-2"><Button type="button" size="toolbar" variant="secondary" onClick={() => onColumnsChange(defaultExportColumns())}>{translate(language, "restoreDefault")}</Button><Button type="button" size="toolbar" variant="secondary" icon={<ImageDown size={16} />} aria-label={`${translate(language, "export")} ${translate(language, "activeRequisitionsSelectedRange")} PNG`} title={`${translate(language, "export")} ${translate(language, "activeRequisitionsSelectedRange")} PNG`} disabled={!columns.length} onClick={onExportPng}>{translate(language, "export")}</Button><Button type="button" size="toolbar" icon={<FileSpreadsheet size={16} />} aria-label={`${translate(language, "export")} ${translate(language, "activeRequisitionsSelectedRange")} XLSX`} title={`${translate(language, "export")} ${translate(language, "activeRequisitionsSelectedRange")} XLSX`} disabled={!columns.length} onClick={onExportXlsx}>{translate(language, "export")}</Button></div></div></Modal>;
}

function RequisitionExportTable({ rows, language, organizationRows, columns }: { rows: RequisitionDetailRow[]; language: Language; organizationRows: DepartmentSectionRow[]; columns: ExportColumnKey[] }) {
  return <div className="print-detail-scroll"><table className="print-detail-table min-w-full border-collapse text-xs"><thead><tr>{columns.map((key) => <th key={key} className="border border-[#D7DEE8] bg-[#F8FAFD] px-3 py-2 text-left font-semibold">{exportColumnLabel(key, language)}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.doc_id}>{columns.map((key) => <td key={key} className="border border-[#D7DEE8] px-3 py-2">{exportValue(row, key, language, organizationRows)}</td>)}</tr>)}</tbody></table></div>;
}

function previewValue(value: string | number) { const text = String(value); return text.length > 28 ? `${text.slice(0, 25)}...` : text; }
function exportFieldDescription(key: ExportColumnKey, language: Language) {
  const channel = SOURCING_CHANNELS.find((item) => item.count === key);
  if (channel) return language === "th" ? `จำนวนผู้สมัคร ${channel.label} จากข้อมูลรายสัปดาห์ของกลุ่มที่เชื่อมกับคำขอ กลุ่มที่เชื่อมหลายคำขอจะนับซ้ำในแต่ละคำขอ` : `${channel.label} applicants from linked groups' saved weekly updates. A group linked to multiple requisitions contributes its count to each.`;
  const english: Partial<Record<ExportColumnKey, string>> = {
    site: "Site: The operating location responsible for the requisition.", department: "Department: The requisition's department in the selected system language.", department_th: "Department (Thai): The canonical Thai department name stored with the requisition.", section: "Section: The requisition's section in the selected system language.", section_th: "Section (Thai): The canonical Thai section name stored with the requisition.", position: "Position: The requested job title.", level: "Job Level: The approved job grade for the requisition.", vacancy: "Vacancy: Total approved headcount requested.", request_type: "Request Type: Whether the requisition is new or a replacement.", requisition_date: "Requisition Date: The approved opening date (pr_approved_date).", person_in_charge: "Person in Charge: The recruiter assigned to manage the requisition.", status: "Status at Period End: Requisition state at the selected period end. Filled is derived from accepted offer coverage; Cancelled is a recorded status action.", detail: "Detail: The remark attached to that latest historical status record.", applicants: "Applicants: Applicants recorded through sourcing during the selected period.", actual_age: "Actual Age: Age of the requisition since the requisition opened (pr_approved_date).", sla: "SLA at Period End: SLA age at the filled date when filled; otherwise at the selected period end.", filled_date: "Filled Date: The most recent date that accepted offers met the approved headcount, as of the selected period end."
  };
  const stage = detailStages.includes(key as ProcessStage) ? `${processStageLabel(language, key as ProcessStage)}: Unique candidates with a current pipeline record or a completed result in this stage, depending on the selected mode.` : null;
  return stage ?? english[key] ?? translate(language, "exportFieldDescription", { field: exportColumnLabel(key, language) });
}

function exportValue(row: RequisitionDetailRow, key: ExportColumnKey, language: Language, organizationRows: DepartmentSectionRow[] = []): string | number {
  const channel = SOURCING_CHANNELS.find((item) => item.count === key);
  if (channel) return row.applicant_channels[channel.count];
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
      <table data-requisition-detail-table className={`${printMode ? "print-detail-table" : "min-w-max"} table-auto border-collapse text-left text-xs`}>
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

function buildWaterfall(rows: WaterfallRow[], language: Language, scopedSites: string[] = []) {
  const sites = Array.from(new Set([...scopedSites, ...rows.map((row) => row.site)])).sort((a, b) => a.localeCompare(b));
  const categories = ["Week Start", ...sites.map(site => `${site} Open`), ...sites.map(site => `${site} Filled`), "Total"]
    .filter(category => rowsForCategory(rows, category).some(row => row.vacancy_count !== 0));

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
        site: row.site,
        requestType: row.request_type,
        value: magnitude,
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
  // Movement history preserves the acceptance even when a later no-show reopens it.
  const acceptedOffers = offers.filter(offer => Boolean(offer.accepted_date));

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

  for (const offer of acceptedOffers) {
    const acceptedDate = dateOnly(offer.accepted_date);
    if (!acceptedDate || acceptedDate < startDate || acceptedDate > endDate) continue;
    const requisition = requisitionsById.get(offer.doc_id);
    if (!requisition || requisitionSnapshotAt(data, requisition, endDate).status === "cancel") continue;
    const inSla = filledSlaAtAcceptance(requisition, acceptedDate, offers
      .filter(candidate => candidate.doc_id === requisition.doc_id && candidate.start_confirmation === "did_not_start")
      .map(candidate => candidate.start_confirmed_at));
    rows.push({ ...waterfallRow("Filled", requisition.site, requisition.request_type ?? "New", -1), filledInSla: inSla === true ? 1 : 0, filledSlaUnknown: inSla === null ? 1 : 0 });
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
      const stageCounts = stageCountMode === "status"
        ? pipelineStatusCountsForDocGroups(data, relatedDocGroupIds, endDate)
        : stageCountMode === "activity"
          ? stageActivityCountsForDocGroups(data, relatedDocGroupIds, startDate, endDate)
          : stageAccumCountsForDocGroups(data, relatedDocGroupIds, requisitionDate, endDate);
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
        applicant_channels: Object.fromEntries(SOURCING_CHANNELS.map((channel) => [channel.count, applicantCountForGroups(data, groupIds, startDate, endDate, channel.label)])) as RequisitionDetailRow["applicant_channels"],
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



function emptyStageCounts() {
  return Object.fromEntries(detailStages.map((stage) => [stage, 0])) as Record<ProcessStage, number>;
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
  return Math.max(startTotal + openTotal, 1);
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
  if (category === "Week Start") return language === "th" ? "อัตราว่างต้นงวด" : "Opening vacancies";
  if (category === "Total") return language === "th" ? "อัตราว่างปลายงวด" : "Closing vacancies";
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
    totals.set(key, existing ? { ...existing, vacancy_count: existing.vacancy_count + row.vacancy_count, filledInSla: (existing.filledInSla ?? 0) + (row.filledInSla ?? 0), filledSlaUnknown: (existing.filledSlaUnknown ?? 0) + (row.filledSlaUnknown ?? 0) } : row);
  }
  return Array.from(totals.values());
}

function oppositeSnapshotColor(site: string, requestType: RequisitionRequestType) {
  return snapshotColor(site, requestType === "New" ? "Replacement" : "New");
}

function stageAccumCountsForDocGroups(data: DashboardData, docGroupIds: Set<string>, requisitionDate: string, endDate: string) {
  const stageCandidates = Object.fromEntries(detailStages.map((stage) => [stage, new Set<string>()])) as Record<ProcessStage, Set<string>>;
  if (!requisitionDate || docGroupIds.size === 0) return emptyStageCounts();
  const candidateIds = new Set(data.candidates.filter((candidate) => Boolean(candidate.doc_group_id && docGroupIds.has(candidate.doc_group_id))).map((candidate) => candidate.candidate_id));
  for (const log of data.recruitment_logs) {
    const enteredDate = dateOnly(log.log_date);
    if (log.superseded_at || !enteredDate || enteredDate < requisitionDate || enteredDate > endDate || !candidateIds.has(log.candidate_id) || !detailStages.includes(log.recruitment_process)) continue;
    stageCandidates[log.recruitment_process].add(log.candidate_id);
  }
  return Object.fromEntries(detailStages.map((stage) => [stage, stageCandidates[stage].size])) as Record<ProcessStage, number>;
}

function stageCandidatesForRequisition(data: DashboardData, docId: string, stage: ProcessStage, mode: StageCountMode, startDate: string, endDate: string): StageCandidateMatch[] {
  const docGroupIds = docGroupIdsForGroupIds(data, groupIdsForRequisition(data, docId));
  const requisitionDate = validDateOnly(data.requisitions.find((requisition) => requisition.doc_id === docId)?.pr_approved_date);
  const candidates = data.candidates.filter((candidate) => Boolean(candidate.doc_group_id && docGroupIds.has(candidate.doc_group_id)));
  return candidates.flatMap((candidate) => {
    const logs = data.recruitment_logs.filter((log) => log.candidate_id === candidate.candidate_id && log.recruitment_process === stage && !log.superseded_at);
    const matching = mode === "activity"
      ? logs.find((log) => { const date = dateOnly(log.result === 1 ? (log.outcome_date ?? log.log_date) : log.log_date); return Boolean(date && date >= startDate && date <= endDate); })
      : mode === "accum"
        ? logs.filter((log) => { const date = dateOnly(log.log_date); return Boolean(requisitionDate && date && date >= requisitionDate && date <= endDate); }).sort((a, b) => a.log_date.localeCompare(b.log_date) || a.log_id - b.log_id)[0]
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

function calendarDayAge(startDate: string, endDate: string) {
  if (!startDate || !endDate) return null;
  return Math.max(Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000), 0);
}
