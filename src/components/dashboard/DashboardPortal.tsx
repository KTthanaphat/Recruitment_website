"use client";

import { RefreshIndicator } from "@/components/ui/LoadingSkeleton";
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
import { RejectionDashboardView } from "./RejectionDashboardView";
import { riskCopy } from "./risk-copy";
import { loadDashboardFilterOptions, loadPipelineSummary, loadRejectionSummary, type RejectionSummary, type PipelineSummary } from "@/lib/dashboard-summary-client";
import { loadRiskSummary, type RiskSummary, loadBottleneckSummary, type BottleneckSummary } from "@/lib/dashboard-summary-client";
import { previousPerformanceRange } from "@/lib/recruitment-performance";
import { observationDates } from "@/lib/dashboard-history";
import { supabase } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";

export type DashboardRequisitionReference = Pick<EnrichedRequisition, "doc_id" | "site" | "department" | "position" | "level" | "head_count" | "person_in_charge">;
export type DashboardReportContext = {
  refreshRevision?: number;
  language: Language; data: DashboardData; requisitions: EnrichedRequisition[]; offers: EnrichedOffer[]; candidateOffers: Offer[];
  preferences: DashboardPreferences; onPreferencesChange: (patch: Partial<DashboardPreferences>) => void;
  headerScope: { site: string; owner: string; priorityOnly: boolean }; range: { start: string; end: string; valid: boolean }; summary: string; supportedFilters: DashboardReportIdentity["filters"];
  pipelineSummary?: PipelineSummary | null; pipelineSummaryStatus?: "idle" | "loading" | "error" | "ready"; onRetryPipelineSummary?: () => void;
  riskSummary?: RiskSummary | null; riskSummaryStatus?: "idle" | "loading" | "error" | "ready"; onRetryRiskSummary?: () => void;
  bottleneckSummary?: BottleneckSummary | null; bottleneckSummaryStatus?: "idle" | "loading" | "error" | "ready"; onRetryBottleneckSummary?: () => void;
  loadBottleneckExportSummary?: () => Promise<BottleneckSummary>;
  rejectionSummary?: RejectionSummary | null; rejectionSummaryStatus?: "idle" | "loading" | "error" | "ready"; onRetryRejectionSummary?: () => void;
  rejectionSummaryFilters?: { actor: string; stage: string; main: string; detail: string; search: string };
  onOpenCandidate?: (id: string, applicationId?: string) => void; onOpenRequisition?: (row: DashboardRequisitionReference) => void;
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
  onOpenCandidate?: (id: string, applicationId?: string) => void; onOpenRequisition?: (row: DashboardRequisitionReference) => Promise<boolean>;
  refreshKey?: number;
}) {
  const registry = useMemo(() => validateDashboardReports(reports), [reports]);
  const today = todayDate(), t = copy[language];
  const [preferences, setPreferences] = useState(() => dashboardDefaults(today));
  const [ready, setReady] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [limited, setLimited] = useState<DashboardRequisitionReference | null>(null);
  const [filterOptionsState, setFilterOptions] = useState<{ key: string; sites: string[]; departments: string[] } | null>(null);
  const [filterOptionsError, setFilterOptionsError] = useState(false);
  const [pipelineSummaryState, setPipelineSummaryState] = useState<{ key: string; status: "loading" | "ready" | "error"; value?: PipelineSummary } | null>(null);
  const [pipelineRetry, setPipelineRetry] = useState(0);
  const [riskSummaryState, setRiskSummaryState] = useState<{ key: string; status: "loading" | "ready" | "error"; value?: RiskSummary } | null>(null);
  const [riskRetry, setRiskRetry] = useState(0);
  const [bottleneckSummaryState,setBottleneckSummaryState]=useState<{key:string;status:"loading"|"ready"|"error";value?:BottleneckSummary}|null>(null);
  const [bottleneckRetry,setBottleneckRetry]=useState(0);
  const [rejectionSummaryState,setRejectionSummaryState]=useState<{key:string;status:"loading"|"ready"|"error";value?:RejectionSummary}|null>(null);
  const [rejectionRetry,setRejectionRetry]=useState(0);
  const [rejectionSearch,setRejectionSearch]=useState(preferences.rejectionSearch);
  useEffect(()=>{const timer=window.setTimeout(()=>setRejectionSearch(preferences.rejectionSearch),300);return()=>window.clearTimeout(timer);},[preferences.rejectionSearch]);
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
    if (!ready || !filterOptions) return;
    updateWorkspaceUrlState(dashboardUrlValues(preferences));
    try { sessionStorage.setItem(sessionKey, JSON.stringify(preferences)); } catch { /* Keep URL state available. */ }
  }, [preferences, ready, sessionKey]);
  const profileKey = `${data.profile?.id ?? ""}:${data.profile?.role ?? ""}:${data.profile?.site ?? ""}:${data.profile?.updated_at ?? ""}`;
  const headerOptionScope = { headerSite: globalSite, headerPic: globalOwner, priorityOnly: globalPriorityOnly };
  const optionKey = JSON.stringify([profileKey, headerOptionScope, preferences.sites]);
  useEffect(() => {
    if (!ready || !supabase) return;
    let cancelled = false; setFilterOptionsError(false);
    loadDashboardFilterOptions(supabase, { ...headerOptionScope, sites: preferences.sites }, profileKey)
      .then(result => { if (!cancelled) setFilterOptions({ key: optionKey, ...result }); })
      .catch(() => { if (!cancelled) setFilterOptionsError(true); });
    return () => { cancelled = true; };
  }, [ready, supabase, globalSite, globalOwner, globalPriorityOnly, preferences.sites, profileKey, optionKey]);
  const filterOptions = filterOptionsState?.key === optionKey ? filterOptionsState : null;
  const sites = useMemo(() => orderedReportSites(filterOptions?.sites ?? []), [filterOptions?.sites]);
  const departments = filterOptions?.departments ?? [];
  useEffect(() => {
    if (!ready || !filterOptions || filterOptions.key !== optionKey) return;
    const selectedSites = preferences.sites.filter(value => sites.includes(value));
    const allowedDepartments = new Set(departments);
    const selectedDepartments = preferences.departments.filter(value => allowedDepartments.has(value));
    if (selectedSites.length !== preferences.sites.length || selectedDepartments.length !== preferences.departments.length) {
      setPreferences(current => ({ ...current, sites: selectedSites, departments: selectedDepartments })); setRemoved(true);
    }
  }, [ready, filterOptions, departments, sites, preferences.sites, preferences.departments]);
  useEffect(() => { if (removed) { const timer = window.setTimeout(() => setRemoved(false), 7000); return () => window.clearTimeout(timer); } }, [removed]);
  const range = dashboardRange(preferences, today);
  const pipelineReportDefinition = registry.find(report => report.id === "pipeline");
  const pipelineRange = dashboardReportRange(preferences, today, pipelineReportDefinition?.filters ?? []);
  const riskReportDefinition = registry.find(report => report.id === "performance");
  const riskRange = dashboardReportRange(preferences, today, riskReportDefinition?.filters ?? []);
  const pipelineScope = useMemo(() => ({ headerSite: globalSite, headerPic: globalOwner, priorityOnly: globalPriorityOnly, sites: preferences.sites, departments: preferences.departments, levels: preferences.levels }), [globalSite, globalOwner, globalPriorityOnly, preferences.sites, preferences.departments, preferences.levels]);
  const needsPipelineSummary = preferences.tab === "pipeline" && preferences.pipelineSubview === "overview" || preferences.tab === "performance" && preferences.performanceSubview === "vacancy";
  const pipelineSummaryKey = JSON.stringify([profileKey, pipelineRange.start, pipelineRange.end, preferences.period, pipelineScope, preferences.funnelChannel]);
  useEffect(() => {
    if (!ready || !needsPipelineSummary || !pipelineRange.valid) return;
    if (!supabase) { setPipelineSummaryState({ key: pipelineSummaryKey, status: "error" }); return; }
    let cancelled = false; setPipelineSummaryState(previous => ({ key: pipelineSummaryKey, status: "loading", value: previous?.key === pipelineSummaryKey ? previous.value : undefined }));
    loadPipelineSummary(supabase, { start: pipelineRange.start, end: pipelineRange.end, period: preferences.period, scope: pipelineScope, channel: preferences.funnelChannel, profileKey, refreshKey: refreshKey + pipelineRetry })
      .then(value => { if (!cancelled) setPipelineSummaryState({ key: pipelineSummaryKey, status: "ready", value }); })
      .catch(() => { if (!cancelled) setPipelineSummaryState({ key: pipelineSummaryKey, status: "error" }); });
    return () => { cancelled = true; };
  }, [ready, needsPipelineSummary, preferences.tab, preferences.pipelineSubview, preferences.performanceSubview, preferences.period, preferences.funnelChannel, pipelineRange.start, pipelineRange.end, pipelineRange.valid, pipelineScope, pipelineSummaryKey, profileKey, refreshKey, pipelineRetry]);
  const riskPriorRange = previousPerformanceRange(preferences.period, { start: riskRange.start, end: riskRange.end < today ? riskRange.end : today });
  const riskTrendDates = useMemo(() => riskRange.valid ? observationDates(riskRange.start, riskRange.end < today ? riskRange.end : today) : [], [riskRange.start, riskRange.end, riskRange.valid, today]);
  const riskSummaryKey = JSON.stringify([profileKey, riskRange.start, riskRange.end, riskPriorRange, pipelineScope, riskTrendDates]);
  const needsRiskSummary = preferences.tab === "performance" && preferences.performanceSubview === "risk";
  useEffect(() => {
    if (!ready || !needsRiskSummary || !riskRange.valid) return;
    if (!supabase) { setRiskSummaryState({ key: riskSummaryKey, status: "error" }); return; }
    let cancelled = false; setRiskSummaryState(previous => ({ key: riskSummaryKey, status: "loading", value: previous?.key === riskSummaryKey ? previous.value : undefined }));
    loadRiskSummary(supabase, { start: riskRange.start, end: riskRange.end, priorStart: riskPriorRange.start, priorEnd: riskPriorRange.end, scope: pipelineScope, trendDates: riskTrendDates, profileKey, refreshKey: refreshKey + riskRetry })
      .then(value => { if (!cancelled) setRiskSummaryState({ key: riskSummaryKey, status: "ready", value }); })
      .catch(() => { if (!cancelled) setRiskSummaryState({ key: riskSummaryKey, status: "error" }); });
    return () => { cancelled = true; };
  }, [ready, needsRiskSummary, riskRange.valid, riskRange.start, riskRange.end, riskPriorRange.start, riskPriorRange.end, pipelineScope, riskTrendDates, profileKey, refreshKey, riskRetry, riskSummaryKey]);
  const bottleneckPriorRange=previousPerformanceRange(preferences.period,{start:pipelineRange.start,end:pipelineRange.end<today?pipelineRange.end:today});
  const bottleneckTrendDates=useMemo(()=>pipelineRange.valid?observationDates(pipelineRange.start,pipelineRange.end<today?pipelineRange.end:today):[],[pipelineRange.start,pipelineRange.end,pipelineRange.valid,today]);
  const needsBottleneckSummary=preferences.tab==="pipeline"&&preferences.pipelineSubview==="bottlenecks";
  const bottleneckSummaryKey = JSON.stringify([profileKey, pipelineRange.start, pipelineRange.end, pipelineScope, preferences.funnelChannel, refreshKey, bottleneckRetry]);
  useEffect(() => {
    if (!ready || !needsBottleneckSummary || !pipelineRange.valid) return;
    if (!supabase) { setBottleneckSummaryState({ key: bottleneckSummaryKey, status: "error" }); return; }
    const controller = new AbortController();
    setBottleneckSummaryState({ key: bottleneckSummaryKey, status: "loading" });
    loadBottleneckSummary(supabase, { start: pipelineRange.start, end: pipelineRange.end, priorStart: null, priorEnd: null, scope: pipelineScope, channel: preferences.funnelChannel, trendDates: [], profileKey, refreshKey: refreshKey + bottleneckRetry, signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setBottleneckSummaryState({ key: bottleneckSummaryKey, status: "ready", value }); })
      .catch(() => { if (!controller.signal.aborted) setBottleneckSummaryState({ key: bottleneckSummaryKey, status: "error" }); });
    return () => controller.abort();
  }, [ready, needsBottleneckSummary, pipelineRange.valid, pipelineRange.start, pipelineRange.end, pipelineScope, preferences.funnelChannel, profileKey, refreshKey, bottleneckRetry, bottleneckSummaryKey]);
  const currentBottlenecks = bottleneckSummaryState?.key === bottleneckSummaryKey ? bottleneckSummaryState.value : undefined;
  function loadBottleneckExportSummary() {
    if (!supabase || !pipelineRange.valid) throw new Error("Bottleneck summary is unavailable");
    return loadBottleneckSummary(supabase, { start: pipelineRange.start, end: pipelineRange.end, priorStart: bottleneckPriorRange.start, priorEnd: bottleneckPriorRange.end, scope: pipelineScope, channel: preferences.funnelChannel, trendDates: bottleneckTrendDates, profileKey, refreshKey });
  }
  const rejectionFilters={actor:preferences.rejectionActor,stage:preferences.rejectionStage,main:preferences.rejectionMain,detail:preferences.rejectionDetail,search:rejectionSearch};
  const needsRejectionSummary=preferences.tab==="pipeline"&&preferences.pipelineSubview==="rejections";
  const rejectionSummaryKey=JSON.stringify([profileKey,pipelineRange.start,pipelineRange.end,pipelineScope,rejectionFilters]);
  useEffect(()=>{
    if(!ready||!needsRejectionSummary||!pipelineRange.valid)return;
    if(!supabase){setRejectionSummaryState({key:rejectionSummaryKey,status:"error"});return;}
    const controller = new AbortController();setRejectionSummaryState(previous => ({ key: rejectionSummaryKey, status: "loading", value: previous?.key === rejectionSummaryKey ? previous.value : undefined }));
    loadRejectionSummary(supabase,{start:pipelineRange.start,end:pipelineRange.end,scope:pipelineScope,filters:rejectionFilters,profileKey,refreshKey:refreshKey+rejectionRetry,signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted)setRejectionSummaryState({key:rejectionSummaryKey,status:"ready",value});}).catch(()=>{if(!controller.signal.aborted)setRejectionSummaryState({key:rejectionSummaryKey,status:"error"});});
    return () => controller.abort();
  },[ready,needsRejectionSummary,pipelineRange.valid,pipelineRange.start,pipelineRange.end,pipelineScope,rejectionFilters.actor,rejectionFilters.stage,rejectionFilters.main,rejectionFilters.detail,rejectionFilters.search,profileKey,refreshKey,rejectionRetry,rejectionSummaryKey]);
  function reportContext(report: DashboardReportDefinition): DashboardReportContext {
    const effective = dashboardEffectivePreferences(preferences, report.filters);
    const effectiveRange = dashboardReportRange(preferences, today, report.filters);
    const headerScoped = requisitions.filter(row => (!globalSite || row.site === globalSite)
      && (!globalOwner || row.person_in_charge?.toLocaleLowerCase() === globalOwner.toLocaleLowerCase())
      && (!globalPriorityOnly || row.is_priority));
    const scoped = scopeDashboardRequisitions(headerScoped, preferences, report.filters);
    const ids = new Set(scoped.map(row => row.doc_id));
    const sourceData = data;
    const reportData: DashboardData = { ...sourceData, requisitions: scoped,
      requisition_logs: sourceData.requisition_logs.filter(row => ids.has(row.doc_id)),
      offers: sourceData.offers.filter(row => ids.has(row.doc_id)) };
    const parts = report.filters.includes("period") ? [effectiveRange.valid ? `${formatDate(effectiveRange.start, language)} – ${formatDate(effectiveRange.end, language)}` : t.invalid, preferences.period === "custom" ? t.custom : preferences.period.toUpperCase()] : [];
    parts.push(`${t.site}: ${effective.sites.join(", ") || globalSite || t.all}`);
    if (report.filters.includes("department")) parts.push(`${t.department}: ${effective.departments.join(", ") || t.all}`);
    if (report.filters.includes("level")) parts.push(`${t.level}: ${effective.levels.map(level => `L${level.replace("-", "–L")}`).join(", ") || t.all}`);
    parts.push(`${t.pic}: ${globalOwner || t.all}`);
    if (globalPriorityOnly) parts.push(t.priority);
    const wantsSummary = report.id === "pipeline" || report.id === "performance" && preferences.performanceSubview === "vacancy";
    const wantsRiskSummary = report.id === "performance" && preferences.performanceSubview === "risk";
    const wantsBottleneckSummary=report.id==="pipeline"&&preferences.pipelineSubview==="bottlenecks";
    const wantsRejectionSummary=report.id==="pipeline"&&preferences.pipelineSubview==="rejections";
    return { refreshRevision: refreshKey, headerScope: { site: globalSite, owner: globalOwner, priorityOnly: globalPriorityOnly }, language, data: reportData, requisitions: scoped, offers: offers.filter(row => ids.has(row.doc_id)), candidateOffers: candidateOffers.filter(row => ids.has(row.doc_id)), pipelineSummary: wantsSummary && pipelineSummaryState?.key === pipelineSummaryKey ? pipelineSummaryState.value ?? null : null, pipelineSummaryStatus: wantsSummary ? pipelineSummaryState?.key === pipelineSummaryKey ? (pipelineSummaryState.value ? "ready" : pipelineSummaryState.status) : "loading" : "idle", onRetryPipelineSummary: () => setPipelineRetry(value => value + 1), riskSummary: wantsRiskSummary && riskSummaryState?.key === riskSummaryKey ? riskSummaryState.value ?? null : null, riskSummaryStatus: wantsRiskSummary ? riskSummaryState?.key === riskSummaryKey ? (riskSummaryState.value ? "ready" : riskSummaryState.status) : "loading" : "idle", onRetryRiskSummary: () => setRiskRetry(value => value + 1), bottleneckSummary: wantsBottleneckSummary ? currentBottlenecks ?? null : null, loadBottleneckExportSummary: wantsBottleneckSummary ? loadBottleneckExportSummary : undefined,bottleneckSummaryStatus:wantsBottleneckSummary?bottleneckSummaryState?.key===bottleneckSummaryKey? (bottleneckSummaryState.value ? "ready" : bottleneckSummaryState.status):"loading":"idle",onRetryBottleneckSummary:()=>setBottleneckRetry(value=>value+1),rejectionSummary:wantsRejectionSummary&&rejectionSummaryState?.key===rejectionSummaryKey?rejectionSummaryState.value??null:null,rejectionSummaryStatus:wantsRejectionSummary?rejectionSummaryState?.key===rejectionSummaryKey? (rejectionSummaryState.value ? "ready" : rejectionSummaryState.status):"loading":"idle",onRetryRejectionSummary:()=>setRejectionRetry(value=>value+1),rejectionSummaryFilters:wantsRejectionSummary?rejectionFilters:undefined, preferences: effective, onPreferencesChange: change, range: effectiveRange, summary: parts.join(" · "), supportedFilters: report.filters,
      onOpenCandidate, onOpenRequisition: row => { if (onOpenRequisition) void onOpenRequisition(row).then(opened => { if (!opened) setLimited(row); }); else setLimited(row); } };
  }
  function change(patch: Partial<DashboardPreferences>) {
    const changesCommonFilter = ["period", "month", "customStart", "customEnd", "sites", "departments", "levels"].some(key => key in patch);
    if (changesCommonFilter || Object.keys(patch).some(key => key.startsWith("rejection")) || ["performanceSubview", "pipelineSubview", "riskGrouping", "riskFilter", "riskGroup", "queueStatus", "queueStage", "queuePic", "queueSearch"].some(key => key in patch)) {
      const next = { ...preferences, ...patch, ...(changesCommonFilter ? { rejectionPage: 0 } : {}) };
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
    {filterOptionsError ? <p role="alert" className="mt-2 text-xs text-danger">{language === "th" ? "โหลดตัวเลือกตัวกรองไม่สำเร็จ" : "Could not load dashboard filter options"}</p> : null}
    {removed ? <p role="status" className="mt-2 text-xs text-slate">{t.removed}</p> : null}
      {!range.valid ? <p role="alert" className="mt-2 text-sm text-danger">{t.invalid}</p> : null}
    </section>
    <DashboardReportNavigation reports={registry} selectedId={selected.id} language={language} onSelect={selectTab} />
    {unsupported.length ? <p role="status" className="text-sm text-slate">{t.unsupported} {unsupported.map(filter => t[filter]).join(", ")}</p> : null}
    {registry.map(report => {
      const views = report.id === "performance" ? ["overview", "vacancy", "risk"] : report.id === "pipeline" ? ["overview", "bottlenecks", "rejections"] : ["overview"];
      const activeView = report.id === "performance" ? preferences.performanceSubview : report.id === "pipeline" ? preferences.pipelineSubview : "overview";
      const viewLabel = (view: string) => view === "rejections" ? language === "th" ? "การปฏิเสธและถอนตัว" : "Rejections" : view === "overview" && report.id === "performance" ? language === "th" ? "ภาพรวมผลการสรรหา" : "Performance" : view === "vacancy" ? language === "th" ? "อัตราว่างและใบขออัตรา" : "Vacancy & Requisitions" : rt(view as "overview");
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
          const summaryView = view === "risk" || view === "bottlenecks" || view === "rejections";
          const active = selected.id === report.id && activeView === view;
          return <div key={view} id={`${report.id}-${view}-panel`} role={views.length > 1 ? "tabpanel" : undefined} aria-labelledby={views.length > 1 ? `${report.id}-${view}-tab` : undefined} hidden={activeView !== view}>
            {((needsPipelineSummary && pipelineSummaryState?.key === pipelineSummaryKey && pipelineSummaryState.status === "loading" && pipelineSummaryState.value) || (needsRiskSummary && riskSummaryState?.key === riskSummaryKey && riskSummaryState.status === "loading" && riskSummaryState.value) || (needsBottleneckSummary && bottleneckSummaryState?.key === bottleneckSummaryKey && bottleneckSummaryState.status === "loading" && bottleneckSummaryState.value) || (needsRejectionSummary && rejectionSummaryState?.key === rejectionSummaryKey && rejectionSummaryState.status === "loading" && rejectionSummaryState.value)) ? <RefreshIndicator language={language} /> : null}
            {!dashboardReportRange(preferences, today, report.filters).valid ? <p className="rounded-xl border border-[#E4E9F2] p-5 text-sm text-slate">{t.invalid}</p> : summaryView ? active ? view === "risk" ? <VacancyRiskView context={reportContext(report)} /> : view === "rejections" ? <RejectionDashboardView context={reportContext(report)} /> : <StageBottleneckView context={reportContext(report)} /> : null : view === "vacancy" ? <VacancyWaterfallView context={reportContext(report)} reportGroup="vacancy" /> : report.render(reportContext(report))}
          </div>;
        })}
      </div>;
    })}
    <Drawer open={Boolean(limited)} title={limited?.position ?? ""} eyebrow={rt("readOnly")} closeLabel={language === "th" ? "ปิด" : "Close"} onClose={() => setLimited(null)}>{limited ? <><p className="mb-4 text-sm text-slate">{rt("noIdentity")}</p><dl className="grid grid-cols-2 gap-3 text-sm">{[["ID", limited.doc_id], [rt("site"), limited.site], [rt("department"), limited.department], [rt("level"), limited.level ?? "—"], [rt("approved"), limited.head_count], [rt("pic"), limited.person_in_charge ?? "—"]].map(([key, value]) => <div key={key}><dt className="text-xs text-slate">{key}</dt><dd>{value}</dd></div>)}</dl></> : null}</Drawer>
  </div>;
}
