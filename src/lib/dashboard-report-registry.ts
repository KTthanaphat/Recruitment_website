import type { Language } from "@/types/recruitment";

export type CommonDashboardFilter = "period" | "site" | "department" | "level";
export const COMMON_DASHBOARD_FILTERS = ["period", "site", "department", "level"] as const;
export type DashboardReportIdentity = {
  id: string;
  label: Record<Language, string>;
  filters: readonly CommonDashboardFilter[];
};

/** Extend this catalog and provide the renderer; URL parsing reads this same catalog. */
export const BUILTIN_DASHBOARD_REPORTS = [
  { id: "performance", label: { en: "Recruitment Performance", th: "ผลการสรรหา" }, filters: COMMON_DASHBOARD_FILTERS },
  { id: "pipeline", label: { en: "Pipeline & Sources", th: "กระบวนการและช่องทางสรรหา" }, filters: COMMON_DASHBOARD_FILTERS }
] as const satisfies readonly DashboardReportIdentity[];

export function validateDashboardReports<T extends DashboardReportIdentity>(reports: readonly T[]): readonly T[] {
  if (!reports.length) throw new Error("Dashboard requires at least one report.");
  const ids = new Set<string>();
  for (const report of reports) {
    if (!/^[a-z][a-z0-9-]*$/.test(report.id) || ids.has(report.id)) throw new Error(`Invalid or duplicate dashboard report ID: ${report.id}`);
    if (!report.label.en.trim() || !report.label.th.trim()) throw new Error(`Missing dashboard report label: ${report.id}`);
    if (report.filters.some(filter => !COMMON_DASHBOARD_FILTERS.includes(filter)) || new Set(report.filters).size !== report.filters.length) throw new Error(`Invalid dashboard filter capabilities: ${report.id}`);
    ids.add(report.id);
  }
  return reports;
}

export function dashboardNavigationKind(reports: readonly DashboardReportIdentity[]) {
  return reports.length > 5 ? "selector" : "tabs";
}
