"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { CommandMonthSelector, CommandSelector } from "@/components/ui/CommandSelector";
import { CommandMultiSelector } from "@/components/ui/CommandMultiSelector";
import { DayDateSelector } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { dashboardDefaults, dashboardEffectivePreferences, scopeDashboardRequisitions, dashboardReportRange, dashboardRange, dashboardUrlValues, restoreDashboardPreferences, DASHBOARD_LEVELS, DASHBOARD_SESSION_PREFIX, type DashboardPreferences, type DashboardTab } from "@/lib/dashboard-filters";
import { pushWorkspaceUrlState, readWorkspaceUrlState, updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import { BUILTIN_DASHBOARD_REPORTS, COMMON_DASHBOARD_FILTERS, validateDashboardReports, type DashboardReportIdentity } from "@/lib/dashboard-report-registry";
import { todayDate } from "@/lib/sla";
import { formatDate } from "@/lib/format";
import type { DashboardData, EnrichedOffer, EnrichedRequisition, Language, Offer } from "@/types/recruitment";
import { RecruitmentPerformanceOverview } from "./RecruitmentPerformanceOverview";
import { VacancyWaterfallView } from "./VacancyWaterfallView";
import { orderedReportSites } from "./PerformanceReport";
import { DashboardReportNavigation } from "./DashboardReportNavigation";
import { ReportHelp } from "./ReportHelp";
import { VacancyRiskView } from "./VacancyRiskView";
import { StageBottleneckView } from "./StageBottleneckView";
import { riskCopy } from "./risk-copy";
import { loadExtendedDashboardReport } from "@/lib/dashboard-report-loader";
import { supabase } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";

export type DashboardReportContext = {
  language: Language; data: DashboardData; requisitions: EnrichedRequisition[]; offers: EnrichedOffer[]; candidateOffers: Offer[];
  preferences: DashboardPreferences; onPreferencesChange: (patch: Partial<DashboardPreferences>) => void;
  headerScope: { site: string; owner: string; priorityOnly: boolean }; range: { start: string; end: string; valid: boolean }; summary: string; supportedFilters: DashboardReportIdentity["filters"];
  onOpenCandidate?: (id: string) => void; onOpenRequisition?: (row: EnrichedRequisition) => void;
};
export type DashboardReportDefinition = DashboardReportIdentity & { render: (context: DashboardReportContext) => ReactNode };
const renderers: Record<string, DashboardReportDefinition["render"]> = {
  performance: context => <RecruitmentPerformanceOverview context={context} />,
  pipeline: context => <VacancyWaterfallView context={context} reportGroup="pipeline" />
};
export const DASHBOARD_REPORTS = validateDashboardReports(BUILTIN_DASHBOARD_REPORTS.map(report => {
  const render = renderers[report.id];
  if (!render) throw new Error(`Missing dashboard renderer: ${report.id}`);
  return { ...report, render };
}));
const copy = {
  en: { title: "Dashboard", filters: "Common dashboard filters", period: "Period", month: "Report month", start: "Start date", end: "End date", site: "Site", department: "Department", level: "Job Level", all: "All", pic: "Person in Charge", priority: "Priority only", reset: "Reset dashboard filters", removed: "Unavailable selections were removed to match the current site scope.", invalid: "Choose valid start and end dates. Start must be on or before end.", report: "Report", unsupported: "This report does not use:", previousYear: "Previous year", nextYear: "Next year", pim: "Performance in Month", custom: "Custom", scope: "Applied scope" },
  th: { title: "แดชบอร์ด", filters: "ตัวกรองร่วมของแดชบอร์ด", period: "ช่วงรายงาน", month: "เดือนรายงาน", start: "วันที่เริ่มต้น", end: "วันที่สิ้นสุด", site: "สถานที่", department: "ฝ่าย", level: "ระดับงาน", all: "ทั้งหมด", pic: "ผู้รับผิดชอบ", priority: "เฉพาะคำขอสำคัญ", reset: "รีเซ็ตตัวกรองแดชบอร์ด", removed: "นำตัวเลือกที่ไม่อยู่ในขอบเขตสถานที่ปัจจุบันออกแล้ว", invalid: "เลือกวันที่เริ่มต้นและสิ้นสุดที่ถูกต้อง วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด", report: "รายงาน", unsupported: "รายงานนี้ไม่ใช้ตัวกรอง:", previousYear: "ปีก่อนหน้า", nextYear: "ปีถัดไป", pim: "ผลการดำเนินงานในเดือน", custom: "กำหนดช่วงเอง", scope: "ขอบเขตที่ใช้" }
};

export function DashboardPortal({ language, data, requisitions, offers, candidateOffers, globalSite, globalOwner, globalPriorityOnly, onOpenCandidate, onOpenRequisition, refreshKey = 0, reports = DASHBOARD_REPORTS }: {
  language: Language; data: DashboardData; requisitions: EnrichedRequisition[]; offers: EnrichedOffer[]; candidateOffers: Offer[];
  globalSite: string; globalOwner: string; globalPriorityOnly: boolean; reports?: readonly DashboardReportDefinition[];
  onOpenCandidate?: (id: string) => void; onOpenRequisition?: (row: EnrichedRequisition) => Promise<boolean>;
  refreshKey?: number;
}) {
  const registry = useMemo(() => validateDashboardReports(reports), [reports]);
  const today = todayDate(), t = copy[language];
  const [preferences, setPreferences] = useState(() => dashboardDefaults(today));
  const [ready, setReady] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [extended, setExtended] = useState<{ refreshKey: number; access: string; data: DashboardData; refreshed: string } | null>(null);
  const [loadError, setLoadError] = useState(false), [retry, setRetry] = useState(0);
  const [limited, setLimited] = useState<EnrichedRequisition | null>(null);
  const newView = preferences.tab === "performance" && preferences.performanceSubview === "risk" || preferences.tab === "pipeline" && preferences.pipelineSubview === "bottlenecks";
  const access = `${data.profile?.id}:${data.profile?.role}:${data.profile?.site}:${data.profile?.updated_at}`;
  const complete = extended?.refreshKey === refreshKey && extended.access === access;
  useEffect(() => {
    if (!newView || complete) return;
    let cancelled = false; setLoadError(false);
    if (!supabase) { setLoadError(true); return; }
    loadExtendedDashboardReport(supabase, data).then(result => { if (!cancelled) setExtended({ refreshKey, access, data: result, refreshed: new Date().toISOString() }); }).catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [newView, data, complete, refreshKey, access, retry]);
  const sessionKey = `${DASHBOARD_SESSION_PREFIX}${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "local"}:${data.profile?.id ?? "anonymous"}`;
  useEffect(() => {
    let base = dashboardDefaults(today);
    try {
      const raw = sessionStorage.getItem(sessionKey);
      if (raw) {
        const saved = JSON.parse(raw) as DashboardPreferences;
        const columns = Array.isArray(saved.exportColumns) ? saved.exportColumns.filter(value => typeof value === "string") : [];
        base = restoreDashboardPreferences(new URLSearchParams(Object.entries(dashboardUrlValues(saved)).filter(([, value]) => value !== null) as [string, string][]), base, registry);
        base.exportColumns = columns;
      }
    } catch { /* Storage is optional. */ }
    setPreferences(restoreDashboardPreferences(readWorkspaceUrlState(), base, registry));
    setReady(true);
    const restore = () => setPreferences(current => restoreDashboardPreferences(readWorkspaceUrlState(), { ...dashboardDefaults(today), exportColumns: current.exportColumns }, registry));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [sessionKey, today, registry]);
  useEffect(() => {
    if (!ready) return;
    updateWorkspaceUrlState(dashboardUrlValues(preferences));
    try { sessionStorage.setItem(sessionKey, JSON.stringify(preferences)); } catch { /* Keep URL state available. */ }
  }, [preferences, ready, sessionKey]);
  const sites = useMemo(() => orderedReportSites(requisitions.map(row => row.site)), [requisitions]);
  const departments = useMemo(() => [...new Set(requisitions.filter(row => !preferences.sites.length || preferences.sites.includes(row.site)).map(row => row.department).filter(Boolean))].sort(), [preferences.sites, requisitions]);
  useEffect(() => {
    if (!ready) return;
    const selectedSites = preferences.sites.filter(value => sites.includes(value));
    const allowedDepartments = new Set(requisitions.filter(row => !selectedSites.length || selectedSites.includes(row.site)).map(row => row.department));
    const selectedDepartments = preferences.departments.filter(value => allowedDepartments.has(value));
    if (selectedSites.length !== preferences.sites.length || selectedDepartments.length !== preferences.departments.length) {
      setPreferences(current => ({ ...current, sites: selectedSites, departments: selectedDepartments })); setRemoved(true);
    }
  }, [ready, requisitions, sites, preferences.sites, preferences.departments]);
  useEffect(() => { if (removed) { const timer = window.setTimeout(() => setRemoved(false), 7000); return () => window.clearTimeout(timer); } }, [removed]);
  const range = dashboardRange(preferences, today);
  function reportContext(report: DashboardReportDefinition): DashboardReportContext {
    const effective = dashboardEffectivePreferences(preferences, report.filters);
    const effectiveRange = dashboardReportRange(preferences, today, report.filters);
    const scoped = scopeDashboardRequisitions(requisitions, preferences, report.filters);
    const ids = new Set(scoped.map(row => row.doc_id));
    const parts = report.filters.includes("period") ? [effectiveRange.valid ? `${formatDate(effectiveRange.start, language)} – ${formatDate(effectiveRange.end, language)}` : t.invalid, preferences.period === "custom" ? t.custom : preferences.period.toUpperCase()] : [];
    parts.push(`${t.site}: ${effective.sites.join(", ") || globalSite || t.all}`);
    if (report.filters.includes("department")) parts.push(`${t.department}: ${effective.departments.join(", ") || t.all}`);
    if (report.filters.includes("level")) parts.push(`${t.level}: ${effective.levels.map(level => `L${level.replace("-", "–L")}`).join(", ") || t.all}`);
    parts.push(`${t.pic}: ${globalOwner || t.all}`);
    if (globalPriorityOnly) parts.push(t.priority);
    return { headerScope: { site: globalSite, owner: globalOwner, priorityOnly: globalPriorityOnly }, language, data: newView && complete && extended ? { ...extended.data, requisitions: data.requisitions, requisition_logs: data.requisition_logs } : data, requisitions: scoped, offers: offers.filter(row => ids.has(row.doc_id)), candidateOffers: candidateOffers.filter(row => ids.has(row.doc_id)), preferences: effective, onPreferencesChange: change, range: effectiveRange, summary: parts.join(" · "), supportedFilters: report.filters,
      onOpenCandidate, onOpenRequisition: row => { if (onOpenRequisition) void onOpenRequisition(row).then(opened => { if (!opened) setLimited(row); }); else setLimited(row); } };
  }
  function change(patch: Partial<DashboardPreferences>) {
    const changesCommonFilter = ["period", "month", "customStart", "customEnd", "sites", "departments", "levels"].some(key => key in patch);
    if (changesCommonFilter || ["performanceSubview", "pipelineSubview", "riskGrouping", "riskFilter", "riskGroup", "queueStatus", "queueStage", "queuePic", "queueSearch"].some(key => key in patch)) {
      const next = { ...preferences, ...patch };
      pushWorkspaceUrlState(dashboardUrlValues(next));
      setPreferences(next);
    } else setPreferences(current => ({ ...current, ...patch }));
  }
  function selectTab(tab: DashboardTab) { if (tab !== preferences.tab) pushWorkspaceUrlState({ dashboardTab: tab }); change({ tab }); }
  const selected = registry.find(report => report.id === preferences.tab) ?? registry[0];
  const summary = reportContext(selected).summary;
  const unsupported = COMMON_DASHBOARD_FILTERS.filter(filter => !selected.filters.includes(filter));
  const labelClass = "mb-0.5 block text-xs font-medium leading-4 text-slate";
  const rt = riskCopy(language);
  if (!ready) return <p role="status" className="text-sm text-slate">{language === "th" ? "กำลังเตรียมรายงาน..." : "Preparing reports..."}</p>;
  return <div className="dashboard-compact-controls grid min-w-0 gap-2" data-dashboard-portal>
    <h1 className="sr-only">{t.title}</h1>
    <section aria-label={t.filters} className="dashboard-filter-toolbar rounded-xl border border-[#E4E9F2] bg-[#F8FAFD] p-2" data-dashboard-filters>
      <div className={`grid min-w-0 grid-cols-2 items-end gap-x-2 gap-y-1.5 sm:grid-cols-3 ${preferences.period === "custom" ? "xl:grid-cols-[.7fr_1fr_1fr_.8fr_1.15fr_.9fr_auto]" : "lg:grid-cols-[.7fr_1fr_.8fr_1.15fr_.9fr_auto]"}`}>
        <div className="min-w-0"><span className={labelClass}>{t.period}</span><CommandSelector typography="normal" ariaLabel={t.period} emptyLabel={t.period} value={preferences.period} options={[{ value: "mtd", label: "MTD" }, { value: "ytd", label: "YTD" }, { value: "pim", label: `PIM · ${t.pim}` }, { value: "custom", label: t.custom }]} onValueChange={value => change({ period: value as DashboardPreferences["period"] })} /></div>
        {preferences.period === "custom" ? <>{(["start", "end"] as const).map(edge => <div key={edge} className="col-span-2 min-w-0 sm:col-span-1"><span className={labelClass}>{t[edge]}</span><DayDateSelector language={language} ariaLabel={t[edge]} name={`dashboard_${edge}`} value={edge === "start" ? preferences.customStart : preferences.customEnd} onChange={event => change(edge === "start" ? { customStart: event.target.value } : { customEnd: event.target.value })} required /></div>)}</> : <div className="dashboard-month-field min-w-0"><span className={labelClass}>{t.month}</span><CommandMonthSelector typography="normal" ariaLabel={t.month} monthLabel={month => new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-US", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, month - 1, 1)))} previousYearLabel={t.previousYear} nextYearLabel={t.nextYear} value={preferences.month} onValueChange={month => change({ month })} /></div>}
        <div className="min-w-0"><span className={labelClass}>{t.site}</span><CommandMultiSelector typography="normal" label={t.site} allLabel={t.all} options={sites} values={preferences.sites} onChange={values => change({ sites: values })} /></div>
        <div className="min-w-0"><span className={labelClass}>{t.department}</span><CommandMultiSelector typography="normal" label={t.department} allLabel={t.all} options={departments} values={preferences.departments} onChange={values => change({ departments: values })} /></div>
        <div className="min-w-0"><span className={labelClass}>{t.level}</span><CommandMultiSelector typography="normal" label={t.level} allLabel={t.all} options={DASHBOARD_LEVELS.map(value => ({ value, label: `L${value.replace("-", "–L")}` }))} values={preferences.levels} onChange={levels => change({ levels: levels as DashboardPreferences["levels"] })} /></div>
        <div className="dashboard-filter-actions flex items-center justify-end gap-1">
          <ReportHelp label={t.scope} text={summary} />
          <Button type="button" size="icon-toolbar" variant="ghost" aria-label={t.reset} title={t.reset} icon={<RotateCcw size={15} />} onClick={() => { const defaults = dashboardDefaults(today); change({ period: defaults.period, month: defaults.month, customStart: defaults.customStart, customEnd: defaults.customEnd, sites: [], departments: [], levels: [] }); }} />
        </div>
      </div>
      <p className="sr-only" data-dashboard-summary>{summary}</p>
      {removed ? <p role="status" className="mt-2 text-xs text-slate">{t.removed}</p> : null}
      {!range.valid ? <p role="alert" className="mt-2 text-sm text-danger">{t.invalid}</p> : null}
    </section>
    <DashboardReportNavigation reports={registry} selectedId={selected.id} language={language} onSelect={selectTab} />
    {unsupported.length ? <p role="status" className="text-sm text-slate">{t.unsupported} {unsupported.map(filter => t[filter]).join(", ")}</p> : null}
    {registry.map(report => {
      const views = report.id === "performance" ? ["overview", "vacancy", "risk"] : report.id === "pipeline" ? ["overview", "bottlenecks"] : ["overview"];
      const activeView = report.id === "performance" ? preferences.performanceSubview : report.id === "pipeline" ? preferences.pipelineSubview : "overview";
      const viewLabel = (view: string) => view === "overview" && report.id === "performance" ? language === "th" ? "ภาพรวมผลการสรรหา" : "Performance" : view === "vacancy" ? language === "th" ? "อัตราว่างและใบขออัตรา" : "Vacancy & Requisitions" : rt(view as "overview");
      return <div key={report.id} role="tabpanel" id={`dashboard-panel-${report.id}`} aria-labelledby={`dashboard-label-${report.id}`} hidden={selected.id !== report.id} className="min-w-0" data-report-group={report.id}>
        <span id={`dashboard-label-${report.id}`} className="sr-only">{report.label[language]}</span>
        {views.length > 1 ? <div className="dashboard-subviews mb-2 flex gap-1 overflow-x-auto" role="tablist" aria-label={report.label[language]} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[target]?.focus(); buttons[target]?.click();
        }}>
          {views.map(view => <button type="button" role="tab" key={view} id={`${report.id}-${view}-tab`} aria-controls={`${report.id}-${view}-panel`} aria-selected={activeView === view} tabIndex={activeView === view ? 0 : -1} className={`dashboard-compact-tab shrink-0 rounded-lg text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0A3CDC] ${activeView === view ? "bg-primary/10 text-primary" : "text-slate hover:bg-white"}`} onClick={() => change(report.id === "performance" ? { performanceSubview: view as DashboardPreferences["performanceSubview"] } : { pipelineSubview: view as DashboardPreferences["pipelineSubview"] })}>{viewLabel(view)}</button>)}
        </div> : null}
        {views.map(view => {
          const extendedView = view === "risk" || view === "bottlenecks";
          const active = selected.id === report.id && activeView === view;
          return <div key={view} id={`${report.id}-${view}-panel`} role={views.length > 1 ? "tabpanel" : undefined} aria-labelledby={views.length > 1 ? `${report.id}-${view}-tab` : undefined} hidden={activeView !== view}>
            {!dashboardReportRange(preferences, today, report.filters).valid ? <p className="rounded-xl border border-[#E4E9F2] p-5 text-sm text-slate">{t.invalid}</p> : extendedView ? active ? !complete || !extended ? <div className="rounded-xl border border-[#E4E9F2] bg-white p-5"><p role={loadError ? "alert" : "status"}>{rt(loadError ? "error" : "loading")}</p>{loadError ? <Button size="toolbar" className="mt-3" onClick={() => setRetry(value => value + 1)}>{rt("retry")}</Button> : null}</div> : <><p className="mb-2 text-right text-xs text-slate">{rt("updated")}: {new Intl.DateTimeFormat(language === "th" ? "th-TH" : "en-GB", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(extended.refreshed))}</p>{view === "risk" ? <VacancyRiskView context={reportContext(report)} /> : <StageBottleneckView context={reportContext(report)} />}</> : null : view === "vacancy" ? <VacancyWaterfallView context={reportContext(report)} reportGroup="vacancy" /> : report.render(reportContext(report))}
          </div>;
        })}
      </div>;
    })}
    <Drawer open={Boolean(limited)} title={limited?.position ?? ""} eyebrow={rt("readOnly")} closeLabel={language === "th" ? "ปิด" : "Close"} onClose={() => setLimited(null)}>{limited ? <><p className="mb-4 text-sm text-slate">{rt("noIdentity")}</p><dl className="grid grid-cols-2 gap-3 text-sm">{[["ID", limited.doc_id], [rt("site"), limited.site], [rt("department"), limited.department], [rt("level"), limited.level ?? "—"], [rt("approved"), limited.head_count], [rt("pic"), limited.person_in_charge ?? "—"]].map(([key, value]) => <div key={key}><dt className="text-xs text-slate">{key}</dt><dd>{value}</dd></div>)}</dl></> : null}</Drawer>
  </div>;
}
