import type { DashboardReportContext } from "@/components/dashboard/DashboardPortal";
import { rejectionText, rejectionStageLabel } from "@/components/dashboard/rejection-copy";
import { REJECTION_ACTORS, type RejectionReport } from "./rejection-report";
import type { DashboardTableSpec, ReportExportSnapshot, WorkbookCell } from "./dashboard-workbook";

export function buildRejectionExport(context: DashboardReportContext, report: RejectionReport, localScope: string): ReportExportSnapshot {
  const { language, range } = context, t = rejectionText(language);
  function table(id: string, title: string, headers: string[], rows: WorkbookCell[][], formats: Record<number, string> = {}): DashboardTableSpec {
    return { id, title, description: title, columns: headers.map((label, i) => ({ key: `c${i}`, label, width: 24, format: formats[i] })), rows };
  }
  const summary = [
    table("metrics", t("total"), [t("field"), t("count"), t("share")], [[t("total"), report.total, report.total ? 1 : null], ...REJECTION_ACTORS.map(actor => [t(actor), report.actors[actor], report.total ? report.actors[actor] / report.total : null] as WorkbookCell[]), [t("people"), report.people, null], [t("applications"), report.applications, null]], { 2: "0.0%" }),
    table("reasons", t("mainTitle"), [t("main"), t("count"), t("share")], report.mainReasons.map(row => [row.label[language], row.count, row.share]), { 2: "0.0%" }),
    table("details", t("detailTitle"), [t("main"), t("detail"), t("count"), t("share")], report.detailedReasons.map(row => [report.events.find(event => event.detailKey === row.key)!.main[language], row.label[language], row.count, row.share]), { 3: "0.0%" }),
    table("stages", t("stageTitle"), [t("stage"), ...REJECTION_ACTORS.map(t), t("count")], report.stages.map(row => [rejectionStageLabel(language, row.stage), ...REJECTION_ACTORS.map(actor => row[actor]), row.count])),
    table("trend", t("trend"), [t("start"), t("end"), ...REJECTION_ACTORS.map(t), t("count")], report.trends.map(row => [new Date(`${row.start}T00:00:00Z`), new Date(`${row.end}T00:00:00Z`), ...REJECTION_ACTORS.map(actor => row[actor]), row.count]), { 0: "dd/mm/yyyy", 1: "dd/mm/yyyy" }),
    table("comparison", report.comparison.level === "detail" ? t("comparisonDetail") : t("comparisonMain"), [t("reasonKey"), t("main"), t("detail"), t("actor"), t("count"), t("comparisonShare"), t("comparison"), t("selected")], report.comparison.reasons.map(row => [row.key, report.comparison.level === "main" ? row.label[language] : report.comparison.label?.[language] ?? null, report.comparison.level === "detail" ? row.label[language] : null, t(row.actor), row.count, row.share, report.comparison.total, Number(row.key === report.comparison.selected)]), { 5: "0.0%" }),
    table("readme", t("guide"), [t("field"), t("value")], [[t("title"), t("guideText")], [t("active"), localScope], [t("quality"), `${t("undated")}: ${report.diagnostics.undated}; ${t("unresolved")}: ${report.diagnostics.unresolvedContext}`], [t("trend"), t(report.granularity)], [t("weekly"), t("weekConvention")], [t("reasonView"), t(context.preferences.rejectionReasonView ?? "treemap")], [t("comparison"), t("comparisonGuide")]])
  ];
  const source = table("events", t("records"), [t("event"), t("outcome"), t("candidateId"), t("person"), t("application"), t("position"), t("stage"), t("round"), t("actor"), t("main"), t("detail"), t("docs"), t("site"), t("department"), t("pic")],
    report.events.map(row => [row.id, new Date(`${row.date}T00:00:00Z`), row.candidateId, row.name, row.applicationId ?? null, row.position, rejectionStageLabel(language, row.stage), row.round, t(row.actor), row.main[language], row.detail[language], row.requisitions.map(req => req.doc_id).join(", "), ...(["site", "department", "person_in_charge"] as const).map(key => [...new Set(row.requisitions.map(req => req[key]).filter(Boolean))].join(", "))]), { 1: "dd/mm/yyyy" });
  const selectedIds = new Set(report.events.map(row => row.id));
  const comparisonSource = table("comparison_events", t("comparisonRecords"), [t("event"), t("outcome"), t("reasonKey"), t("main"), t("detail"), t("actor"), t("selectedContribution")], report.comparison.events.map(row => [row.id, new Date(`${row.date}T00:00:00Z`), report.comparison.level === "main" ? row.mainKey : row.detailKey, row.main[language], row.detail[language], t(row.actor), Number(selectedIds.has(row.id))]), { 1: "dd/mm/yyyy" });
  return { reportId: "rejections", language, generatedAt: new Date().toISOString(), filename: `rejection-analysis-${range.start}-to-${range.end}.xlsx`, scope: `${context.summary} · ${localScope}`, sheets: [
    { id: "summary", title: language === "th" ? "ข้อมูลสรุป" : "Summary Data", tables: summary },
    { id: "source", title: language === "th" ? "ข้อมูลต้นทาง" : "Source Data", tables: [source, comparisonSource] }
  ] };
}
