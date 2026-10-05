import { BUILTIN_DASHBOARD_REPORTS, type CommonDashboardFilter, type DashboardReportIdentity } from "./dashboard-report-registry";
import { previousSourcingReportingRange } from "./dates";
import { performanceRange, type PerformancePeriod } from "./recruitment-performance";

export type DashboardTab = string;
export type DashboardLevel = "0-3" | "4-6" | "7-9" | "10-14";
export type DashboardFilterState = {
  period: PerformancePeriod; month: string; customStart: string; customEnd: string;
  sites: string[]; departments: string[]; levels: DashboardLevel[];
};
export type DashboardPreferences = DashboardFilterState & {
  tab: DashboardTab;
  funnelChannel: string; funnelLegend: boolean; stageCountMode: "status" | "activity" | "accum";
  executiveBreakdownOpen: boolean; exportColumns: string[];
  performanceSubview: "overview" | "vacancy" | "risk"; pipelineSubview: "overview" | "bottlenecks";
  riskGrouping: "department-site" | "department" | "site"; riskFilter: string; riskGroup: string;
  queueStatus: string; queueStage: string; queuePic: string; queueSearch: string;
};
export const DASHBOARD_LEVELS: DashboardLevel[] = ["0-3", "4-6", "7-9", "10-14"];
export const DASHBOARD_SESSION_PREFIX = "recruitment.dashboard.v1:";
export function dashboardDefaults(today: string): DashboardPreferences {
  const range = previousSourcingReportingRange();
  return { period: "mtd", month: today.slice(0, 7), customStart: range.startDate, customEnd: range.endDate,
    sites: [], departments: [], levels: [], tab: "performance", funnelChannel: "all", funnelLegend: true, stageCountMode: "status",
    executiveBreakdownOpen: false, exportColumns: [], performanceSubview: "overview", pipelineSubview: "overview",
    riskGrouping: "department-site", riskFilter: "attention", riskGroup: "", queueStatus: "auto", queueStage: "", queuePic: "", queueSearch: "" };
}
export function validDashboardDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function dashboardRange(state: DashboardFilterState, today: string) {
  const range = state.period === "custom" ? { start: state.customStart, end: state.customEnd }
    : performanceRange(state.period, Number(state.month.slice(0, 4)), Number(state.month.slice(5, 7)), today);
  return { ...range, valid: validDashboardDate(range.start) && validDashboardDate(range.end) && range.start <= range.end };
}
export function dashboardLevelMatches(level: string | null | undefined, levels: DashboardLevel[]) {
  if (!levels.length) return true;
  if (!/^L?(?:[0-9]|1[0-4])$/i.test(level?.trim() ?? "")) return false;
  const value = Number(level!.trim().replace(/^L/i, ""));
  return levels.some(band => { const [min, max] = band.split("-").map(Number); return value >= min && value <= max; });
}
function selections(value: string | null) {
  if (!value) return [];
  try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) return [...new Set(parsed.filter((item): item is string => typeof item === "string" && Boolean(item)))]; } catch { /* Legacy single selection. */ }
  return [value];
}
function isPeriod(value: string | null): value is PerformancePeriod { return ["mtd", "ytd", "pim", "custom"].includes(value ?? ""); }
export function restoreDashboardPreferences(params: URLSearchParams, base: DashboardPreferences, reports: readonly DashboardReportIdentity[] = BUILTIN_DASHBOARD_REPORTS): DashboardPreferences {
  const state = { ...base };
  const keys = [...params.keys()];
  const explicitTab = params.get("dashboardTab");
  const legacyTab = keys.some(key => key.startsWith("overview")) ? "performance" : keys.some(key => key.startsWith("report") || key === "start" || key === "end") ? "vacancy" : keys.some(key => key.startsWith("funnel")) ? "pipeline" : null;
  const ids = new Set(reports.map(report => report.id));
  // Resolve the old group before translating navigation, so its period stays authoritative.
  const legacyVacancy = !ids.has("vacancy") && (explicitTab === "vacancy" || !explicitTab && legacyTab === "vacancy");
  state.tab = legacyVacancy && ids.has("performance") ? "performance" : explicitTab && ids.has(explicitTab) ? explicitTab : legacyTab && ids.has(legacyTab) ? legacyTab : ids.has(base.tab) ? base.tab : reports[0]?.id ?? "performance";
  const legacyPeriod = legacyVacancy || state.tab === "vacancy" ? params.get("reportView") : state.tab === "performance" ? params.get("overviewPeriod") : state.tab === "pipeline" ? params.get("funnelView") ?? (params.has("funnelStart") && params.has("funnelEnd") ? "custom" : null) : null;
  const period = params.get("dashboardPeriod") ?? legacyPeriod;
  if (isPeriod(period)) state.period = period;
  const overviewMonth = params.has("overviewYear") && params.has("overviewMonth") ? `${params.get("overviewYear")}-${String(params.get("overviewMonth")).padStart(2, "0")}` : null;
  const month = params.get("dashboardMonth") ?? (legacyVacancy || state.tab === "vacancy" ? params.get("reportMonth") : state.tab === "performance" ? overviewMonth : state.tab === "pipeline" ? params.get("funnelMonth") : null);
  if (month && /^(?:20\d{2}|2100)-(?:0[1-9]|1[0-2])$/.test(month)) state.month = month;
  const start = params.get("dashboardStart") ?? params.get(state.tab === "pipeline" ? "funnelStart" : "start");
  const end = params.get("dashboardEnd") ?? params.get(state.tab === "pipeline" ? "funnelEnd" : "end");
  if (start !== null) state.customStart = start;
  if (end !== null) state.customEnd = end;
  for (const [field, key, legacy] of [["sites", "dashboardSites", "overviewSite"], ["departments", "dashboardDepartments", "overviewDepartment"]] as const) {
    if (params.has(key) || params.has(legacy)) state[field] = selections(params.get(key) ?? params.get(legacy));
  }
  if (params.has("dashboardLevels") || params.has("funnelLevel")) {
    const raw = params.has("dashboardLevels") ? selections(params.get("dashboardLevels")) : (params.get("funnelLevel") ?? "").split(",");
    state.levels = raw.filter((value): value is DashboardLevel => DASHBOARD_LEVELS.includes(value as DashboardLevel));
  }
  if (params.has("funnelChannel")) state.funnelChannel = params.get("funnelChannel") || "all";
  if (params.has("funnelLegend")) state.funnelLegend = params.get("funnelLegend") !== "off";
  if (params.has("dashboardBreakdown")) state.executiveBreakdownOpen = params.get("dashboardBreakdown") === "open";
  const mode = params.get("requisitionStageMode");
  if (mode === "status" || mode === "activity" || mode === "accum") state.stageCountMode = mode;
  if (params.has("performanceSubview")) {
    const view = params.get("performanceSubview");
    state.performanceSubview = view === "vacancy" || view === "risk" ? view : "overview";
  } else if (legacyVacancy) state.performanceSubview = params.get("vacancySubview") === "risk" ? "risk" : "vacancy";
  else if (explicitTab === "performance") state.performanceSubview = "overview";
  if (params.has("pipelineSubview")) state.pipelineSubview = params.get("pipelineSubview") === "bottlenecks" ? "bottlenecks" : "overview";
  else if (explicitTab === "pipeline") state.pipelineSubview = "overview";
  const grouping = params.get("riskGrouping");
  if (grouping === "department" || grouping === "site" || grouping === "department-site") state.riskGrouping = grouping;
  for (const key of ["riskFilter", "riskGroup", "queueStatus", "queueStage", "queuePic", "queueSearch"] as const) if (params.has(key)) state[key] = params.get(key) ?? "";
  if (!["all", "track", "near", "overdue", "unknown", "attention", "priority"].includes(state.riskFilter)) state.riskFilter = "attention";
  if (!["auto", "all", "overdue", "today", "upcoming", "unscheduled", "unavailable"].includes(state.queueStatus)) state.queueStatus = "auto";
  return state;
}
export function dashboardUrlValues(state: DashboardPreferences) {
  // Session v1 may still contain the previous Vacancy group; migrate without losing local filters.
  const legacy = state as DashboardPreferences & { vacancySubview?: string };
  const oldVacancy = state.tab === "vacancy";
  return { dashboardTab: oldVacancy ? "performance" : state.tab, dashboardPeriod: state.period, dashboardMonth: state.month,
    performanceSubview: state.performanceSubview ?? (oldVacancy ? legacy.vacancySubview === "risk" ? "risk" : "vacancy" : "overview"), vacancySubview: null, pipelineSubview: state.pipelineSubview ?? "overview", riskGrouping: state.riskGrouping ?? "department-site", riskFilter: state.riskFilter ?? "attention", riskGroup: state.riskGroup ?? "",
    queueStatus: state.queueStatus ?? "auto", queueStage: state.queueStage ?? "", queuePic: state.queuePic ?? "", queueSearch: state.queueSearch ?? "",
    dashboardStart: state.customStart, dashboardEnd: state.customEnd,
    dashboardSites: JSON.stringify(state.sites), dashboardDepartments: JSON.stringify(state.departments), dashboardLevels: JSON.stringify(state.levels),
    performanceOpen: null, details: null, funnel: null,
    funnelChannel: state.funnelChannel, funnelLegend: state.funnelLegend ? "on" : "off", requisitionStageMode: state.stageCountMode,
    dashboardBreakdown: state.executiveBreakdownOpen ? "open" : "closed",
    overviewPeriod: null, overviewYear: null, overviewMonth: null, overviewSite: null, overviewDepartment: null,
    reportView: null, reportMonth: null, start: null, end: null, funnelView: null, funnelMonth: null, funnelStart: null, funnelEnd: null, funnelLevel: null };
}


/** Saved selections remain intact; each report receives only its declared spatial scope. */
export function dashboardEffectivePreferences(state: DashboardPreferences, supported: readonly CommonDashboardFilter[]): DashboardPreferences {
  return { ...state, sites: supported.includes("site") ? state.sites : [], departments: supported.includes("department") ? state.departments : [], levels: supported.includes("level") ? state.levels : [] };
}
export function scopeDashboardRequisitions<T extends { site: string; department: string; level: string | null }>(rows: readonly T[], state: DashboardPreferences, supported: readonly CommonDashboardFilter[]) {
  const effective = dashboardEffectivePreferences(state, supported);
  return rows.filter(row => (!effective.sites.length || effective.sites.includes(row.site)) && (!effective.departments.length || effective.departments.includes(row.department)) && dashboardLevelMatches(row.level, effective.levels));
}
export function dashboardReportRange(state: DashboardPreferences, today: string, supported: readonly CommonDashboardFilter[]) {
  return supported.includes("period") ? dashboardRange(state, today) : { start: "", end: "", valid: true };
}
