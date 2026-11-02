"use client";
import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { LoadingSkeleton, RefreshIndicator } from "@/components/ui/LoadingSkeleton";
import { compareApplicationLogs } from "@/lib/application-stage-order";
import { belongsToApplication } from "@/lib/applications";


import type { KeyboardEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { useEffect } from "react";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import homeBanner from "../../../home_banner.png";
import { RecruitmentCalendar, TodayEventsPanel, type CalendarEvent } from "@/components/dashboard/RecruitmentCalendar";
import { EmptyState } from "@/components/ui/EmptyState";
import { OperationalSummaryStrip } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { SelectInput } from "@/components/ui/Field";
import { StageRail } from "@/components/ui/StageRail";
import { Tag } from "@/components/ui/Tag";
import { ACTIVE_PIPELINE_STAGES, PIPELINE_JOURNEY_STAGES, SOURCING_CHANNELS, processLabel } from "@/lib/constants";
import { dailyWelcomeMessage } from "@/lib/daily-messages";
import { formatLocalDateInput } from "@/lib/dates";
import { formatCandidateName, formatDate, formatDateTime, formatNumber, formatRecruitmentId, formatRequisitionTitle } from "@/lib/format";
import { sourcingLinkReadinessLabel, sourcingLinkReadinessReason, severityLabel, translate } from "@/lib/i18n/dictionary";
import { ageDays, isCandidateAging, requisitionSourcingLinkReadiness, type DataQualityIssue } from "@/lib/operations";
import { getRequisitionSlaState } from "@/lib/sla";
import { useRecruitmentList } from "@/lib/recruitment-list";
import { CursorPagination } from "@/components/ui/CursorPagination";
import { loadHomeQualityPage, loadHomeSummary, type HomeBannerSummary, type HomeQualityPage, type HomeSummary } from "@/lib/dashboard-summary-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChangeLog, EnrichedCandidate, EnrichedOffer, EnrichedRequisition, EnrichedSourcingGroup, Language, Profile, RecruitmentLog } from "@/types/recruitment";

type HomeTabKey = "open_headcount" | "candidate_pipeline" | "sourcing_updates" | "data_quality" | "start_confirmation";

type HomeTab = {
  key: HomeTabKey;
  label: string;
  count: number | null;
};

const headcountColumns = "md:grid-cols-[minmax(0,1.8fr)_minmax(0,.8fr)_minmax(0,1fr)_minmax(0,.8fr)_minmax(0,.9fr)]";
const pipelineColumns = "md:grid-cols-[minmax(10rem,1.45fr)_minmax(8rem,.9fr)_minmax(10rem,1fr)_minmax(8rem,.8fr)_minmax(11rem,1.15fr)_minmax(11rem,1.4fr)]";
const sourcingColumns = "md:grid-cols-[minmax(10rem,1.5fr)_minmax(9rem,1.1fr)_minmax(6rem,.7fr)_minmax(10rem,1fr)_minmax(8rem,.85fr)_minmax(9rem,1fr)]";
const qualityColumns = "md:grid-cols-[minmax(10rem,1.2fr)_minmax(10rem,1.1fr)_minmax(7rem,.7fr)_minmax(12rem,1.4fr)_minmax(8rem,.8fr)_minmax(8rem,.8fr)]";
const confirmationColumns = "md:grid-cols-[minmax(10rem,1.25fr)_minmax(11rem,1.35fr)_minmax(9rem,1fr)_minmax(8rem,.85fr)_minmax(8rem,.8fr)_minmax(9rem,1fr)]";

// Adjust this value from 0 to 1 to tune the Home-banner glass surface.
const BANNER_GLASS_OPACITY = 0.2;

export function HomeView({
  language,
  profile,
  requisitions,
  candidates,
  offers,
  recruitmentLogs,
  sourcingGroups,
  sourcingHref,
  staleSourcingGroups,
  changeLogs,
  dataQualityIssues,
  canViewRecentActivity,
  onConfirmStart,
  onEditPending,
  onOpenRequisition,
  onOpenCandidate
  , listClient = null,
  accessScope = "",
  summaryScope
  , refreshKey = 0,
  bannerSummary = null,
  bannerSummaryLoading = false,
  bannerSummaryError = null,
  onRetryBannerSummary
}: {
  language: Language;
  profile: Profile | null;
  requisitions: EnrichedRequisition[];
  candidates: EnrichedCandidate[];
  offers: EnrichedOffer[];
  recruitmentLogs: RecruitmentLog[];
  sourcingGroups: EnrichedSourcingGroup[];
  sourcingHref: string;
  staleSourcingGroups: EnrichedSourcingGroup[];
  changeLogs: ChangeLog[];
  dataQualityIssues: DataQualityIssue[];
  canViewRecentActivity: boolean;
  onConfirmStart: (offer: EnrichedOffer) => void;
  onEditPending?: (candidate: EnrichedCandidate) => void;
  onOpenRequisition: (docId: string) => void;
  onOpenCandidate: (candidateId: string, applicationId?: string) => void;
  listClient?: SupabaseClient | null;
  accessScope?: string;
  summaryScope?: { headerSite: string; headerPic: string; priorityOnly: boolean };
  refreshKey?: number;
  bannerSummary?: HomeBannerSummary | null;
  bannerSummaryLoading?: boolean;
  bannerSummaryError?: string | null;
  onRetryBannerSummary?: () => void;
}) {
  const [todayEventData, setTodayEventData] = useState<{ date: string; events: CalendarEvent[] }>({ date: "", events: [] });
  const handleTodayEventsChange = useCallback((payload: { date: string; events: CalendarEvent[] }) => setTodayEventData(payload), []);
  const [homeSummary, setHomeSummary] = useState<HomeSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const summaryScopeKey = JSON.stringify(summaryScope ?? null);
  useEffect(() => {
    setHomeSummary(null); setSummaryError(false);
    if (!listClient || !summaryScope || !accessScope) return;
    let cancelled = false;
    loadHomeSummary(listClient, JSON.parse(summaryScopeKey), accessScope, refreshKey)
      .then(value => { if (!cancelled) { setHomeSummary(value); setSummaryError(false); } })
      .catch(() => { if (!cancelled) setSummaryError(true); });
    return () => { cancelled = true; };
  }, [accessScope, listClient, summaryScopeKey, refreshKey]);
  const notFilledRequisitions = requisitions.filter((row) => row.status !== "filled" && row.status !== "cancel");
  const openRequisitions = notFilledRequisitions.filter((row) => row.open_headcount > 0);
  const offeredCandidateIds = new Set(offers.map((offer) => offer.candidate_id));
  const ongoingCandidates = candidates.filter(
    (row) => row.latest_process !== "No activity"
      && ACTIVE_PIPELINE_STAGES.includes(row.latest_process)
      && row.latest_result !== 0
      && !offeredCandidateIds.has(row.candidate_id)
  );
  const needsAction = [...openRequisitions];
  const workQueue = homeSummary?.workQueue.items ?? [];
  const urgentCandidates = candidates.filter(isCandidateAging).length;
  const welcomeName = profile?.nickname ?? profile?.full_name ?? profile?.email ?? translate(language, "system");
  const todayParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = `${todayParts.find((part) => part.type === "year")?.value ?? ""}-${todayParts.find((part) => part.type === "month")?.value ?? ""}-${todayParts.find((part) => part.type === "day")?.value ?? ""}`;
  const startConfirmations = offers.filter((offer) => Boolean(offer.accepted_date) && Boolean(offer.first_working_date) && offer.first_working_date! <= today && offer.start_confirmation === null);
  const welcomeDailyMessage = bannerSummary ? dailyWelcomeMessage({
    language,
    ratio: bannerSummary.monthlyFillCapacity > 0 ? bannerSummary.monthlyFilledCount / bannerSummary.monthlyFillCapacity : 0,
    name: welcomeName,
    fallback: translate(language, "welcomeFilledRatioMessage0", { name: welcomeName })
  }) : null;
  const homeOpenCount = homeSummary?.counts.openRequisitions ?? null;
  const homePipelineCount = homeSummary?.counts.activePipeline ?? null;
  const homeStaleGroups = homeSummary?.counts.staleSourcing ?? null;
  const homeWorkQueueCount = homeSummary?.workQueue.totalCount ?? null;
  const homeRecentActivity: ChangeLog[] | null = homeSummary?.recentActivity.map(row => ({ log_id: row.log_id, entity: row.entity, entity_id: row.entity_id, action: row.action, changed_at: row.changed_at, changed_by: row.changed_by_email, changed_by_email: row.changed_by_email, old_data: null, new_data: null })) ?? null;
  const tabs: HomeTab[] = [
    { key: "open_headcount", label: translate(language, "openHeadcount"), count: homeOpenCount },
    { key: "candidate_pipeline", label: translate(language, "candidatePipeline"), count: homePipelineCount },
    { key: "sourcing_updates", label: translate(language, "SourcingUpdates"), count: homeStaleGroups },
    { key: "data_quality", label: translate(language, "dataQuality"), count: homeSummary?.counts.qualityIssues ?? null },
    ...(canViewRecentActivity ? [{ key: "start_confirmation" as const, label: translate(language, "newHireConfirmation"), count: homeSummary?.counts.pendingOffers ?? null }] : [])
  ];

  return (
    <div className="grid gap-5">
      <div data-home-banner="true" className="relative -mx-4 aspect-[6/1] w-[calc(100%+2rem)] bg-[#F8FAFF] sm:-mx-6 sm:w-[calc(100%+3rem)] lg:-mx-7 lg:w-[calc(100%+3.5rem)]">
        <img
          src={homeBanner.src}
          alt=""
          className="pointer-events-none absolute inset-0 h-full w-full object-contain object-center"
        />
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-[52%] min-w-0 items-center px-4 sm:px-6 lg:px-7">
          <div
            className="pointer-events-auto min-w-0 rounded-xl px-3 py-2.5 backdrop-blur-md sm:px-4 sm:py-3"
            style={{ backgroundColor: `rgb(239 246 255 / ${BANNER_GLASS_OPACITY})` }}
          >
            <h3 className="truncate text-base font-semibold tracking-normal text-navy sm:text-2xl lg:text-3xl">Welcome back, Khun {welcomeName}!</h3>
            {bannerSummaryLoading && bannerSummary ? <RefreshIndicator language={language} /> : null}{welcomeDailyMessage ? <p className="mt-1 hidden max-w-2xl text-[11px] font-medium leading-4 text-slate sm:line-clamp-2 lg:block lg:text-xs lg:leading-5">{welcomeDailyMessage}</p> : bannerSummaryLoading ? <LoadingSkeleton variant="text" label={<>{translate(language, "loading")}</>} className="mt-1 text-xs text-slate" /> : <div role="alert" className="mt-1 flex items-center gap-2 text-xs text-danger">{bannerSummaryError || translate(language, "loadFailed")}<RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Home`} type="button"  disabled={!onRetryBannerSummary} onClick={onRetryBannerSummary}>{translate(language, "retry")}</RetryIconButton></div>}
          </div>
        </div>
      </div>
      <div className="grid gap-5 lg:items-start lg:grid-cols-4">
        <div className="order-2 min-h-0 lg:order-1 lg:col-span-1">
        <Panel variant="primary">
          <SectionTitle
            title={profile?.role === "viewer" ? translate(language, "workspaceWatchlist") : translate(language, "todaysWork")}
            eyebrow={profile?.role === "viewer" ? translate(language, "monitoringView") : undefined}
        />
        <div className="md:hidden">
          <OperationalSummaryStrip
            density="compact"
            layout="stacked_lines"
            valueTone="navy"
            items={[
              { label: translate(language, "openRequisition"), value: homeOpenCount ?? "—", tone: homeOpenCount === null ? "muted" : homeOpenCount > 0 ? "warning" : "success" },
              { label: translate(language, "urgentItems"), value: homeWorkQueueCount ?? "—", tone: homeWorkQueueCount === null ? "muted" : homeWorkQueueCount > 0 ? "warning" : "success" }
            ]}
          />
        </div>
        <div className="hidden md:block">
          <OperationalSummaryStrip
            density="compact"
            layout="stacked_lines"
            valueTone="navy"
            items={[
              { label: translate(language, "openRequisition"), value: homeOpenCount ?? "—", tone: homeOpenCount === null ? "muted" : homeOpenCount > 0 ? "warning" : "success", helper: translate(language, "openHeadcount") },
              { label: translate(language, "urgentItems"), value: homeWorkQueueCount ?? "—", tone: homeWorkQueueCount === null ? "muted" : homeWorkQueueCount > 0 ? "warning" : "success", helper: profile?.role === "viewer" ? translate(language, "readOnlyWatchlist") : translate(language, "sortedByRisk") },
              { label: translate(language, "agingCandidates"), value: homeSummary?.needsAction.overduePending ?? "—", tone: homeSummary ? homeSummary.needsAction.overduePending > 0 ? "danger" : "success" : "muted", helper: translate(language, "lastTouchOlderThan7Days") },
              { label: translate(language, "sourcingGaps"), value: homeStaleGroups ?? "—", tone: homeStaleGroups === null ? "muted" : homeStaleGroups > 0 ? "warning" : "success", helper: translate(language, "openGroupsNeedingUpdates") }
            ]}
          />
        </div>
        </Panel>
        </div>

        <div className="order-1 grid min-w-0 gap-5 lg:order-2 lg:col-span-3">
          <div className="min-w-0">
            <RecruitmentCalendar
              candidates={candidates}
              language={language}
              offers={offers}
              profile={profile}
              recruitmentLogs={recruitmentLogs}
              onEditPending={onEditPending}
              onOpenCandidate={onOpenCandidate}
              onTodayEventsChange={handleTodayEventsChange}
              listClient={listClient}
              summaryScope={summaryScope}
              profileKey={accessScope}
              refreshKey={refreshKey}
            />
          </div>
          {todayEventData.date ? <TodayEventsPanel date={todayEventData.date} events={todayEventData.events} language={language} onOpenCandidate={onOpenCandidate} /> : null}
        </div>
      </div>

      <HomeRecordTabs
        listClient={listClient}
        accessScope={accessScope}
        summaryScope={summaryScope}
        candidates={candidates}
        changeLogs={homeRecentActivity ?? changeLogs}
        dataQualityIssues={dataQualityIssues}
        language={language}
        needsAction={needsAction}
        offers={offers}
        ongoingCandidates={ongoingCandidates}
        recruitmentLogs={recruitmentLogs}
        onOpenCandidate={onOpenCandidate}
        onOpenRequisition={onOpenRequisition}
        requisitions={requisitions}
        sourcingGroups={sourcingGroups}
        sourcingHref={sourcingHref}
        startConfirmations={startConfirmations}
        onConfirmStart={onConfirmStart}
        tabs={tabs}
      />
    </div>
  );
}

function HomeRecordTabs({
  candidates,
  changeLogs,
  dataQualityIssues,
  language,
  needsAction,
  offers,
  ongoingCandidates,
  recruitmentLogs,
  onOpenCandidate,
  onOpenRequisition,
  requisitions,
  sourcingGroups,
  sourcingHref,
  startConfirmations,
  onConfirmStart,
  tabs,
  listClient = null,
  accessScope = "",
  summaryScope
}: {
  candidates: EnrichedCandidate[];
  changeLogs: ChangeLog[];
  dataQualityIssues: DataQualityIssue[];
  language: Language;
  needsAction: EnrichedRequisition[];
  offers: EnrichedOffer[];
  ongoingCandidates: EnrichedCandidate[];
  recruitmentLogs: RecruitmentLog[];
  onOpenCandidate: (candidateId: string, applicationId?: string) => void;
  onOpenRequisition: (docId: string) => void;
  requisitions: EnrichedRequisition[];
  sourcingGroups: EnrichedSourcingGroup[];
  sourcingHref: string;
  startConfirmations: EnrichedOffer[];
  onConfirmStart: (offer: EnrichedOffer) => void;
  tabs: HomeTab[];
  listClient?: SupabaseClient | null;
  accessScope?: string;
  summaryScope?: { headerSite: string; headerPic: string; priorityOnly: boolean };
}) {
  const [activeTab, setActiveTab] = useState<HomeTabKey>("open_headcount");
  const searchParams = useSearchParams();
  const [qualitySnapshot, setQualityPage] = useState<HomeQualityPage | null>(null);
  const [qualityCursorStack, setQualityCursorStack] = useState<Array<HomeQualityPage["nextCursor"]>>([null]);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState(false);
  const [qualityRetry, setQualityRetry] = useState(0);
  const summaryScopeKey = JSON.stringify(summaryScope ?? null);
  const [headcountSort, setHeadcountSort] = useState<"oldest" | "demand" | "position">("oldest");
  const [candidateSort, setCandidateSort] = useState<"oldest_touch" | "newest_touch" | "name" | "progression">("oldest_touch");
  const tabRefs = useRef<Partial<Record<HomeTabKey, HTMLButtonElement | null>>>({});
  const recordListRef = useRef<HTMLDivElement>(null);
  const selectedTab = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];
  const today = formatLocalDateInput();
  const requestedWeek = searchParams.get("sourcingWeek");
  const groupWeekStart = (() => { const date = new Date(`${requestedWeek??today}T12:00:00+07:00`); date.setDate(date.getDate() - ((date.getDay() + 1) % 7)); return formatLocalDateInput(date); })();
  const reqPage = useRecruitmentList<EnrichedRequisition>({client:listClient,accessScope,entity:"requisitions",filters:{homeTab:"open_headcount",...(summaryScope??{})},sort:headcountSort==="oldest"?"home_oldest":headcountSort==="demand"?"home_demand":"home_position",direction:headcountSort==="position"?"asc":"desc",enabled:selectedTab.key==="open_headcount"});
  const pipelinePage = useRecruitmentList<EnrichedCandidate & {home_last_touch_date?:string|null;home_pending_remark?:string|null}>({client:listClient,accessScope,entity:"candidate_applications",filters:{homeTab:"active_pipeline",asOf:today,...(summaryScope??{})},sort:({oldest_touch:"home_oldest_touch",newest_touch:"home_newest_touch",name:"name",progression:"home_progression"} as const)[candidateSort],direction:candidateSort==="oldest_touch"?"asc":candidateSort==="name"?"asc":"desc",enabled:selectedTab.key==="candidate_pipeline"});
  const groupPage = useRecruitmentList<EnrichedSourcingGroup>({client:listClient,accessScope,entity:"position_groups",filters:{scope:"ongoing",weekStart:groupWeekStart,...(summaryScope??{})},sort:"name",direction:"asc",enabled:selectedTab.key==="sourcing_updates"});
  const startPage = useRecruitmentList<EnrichedOffer>({client:listClient,accessScope,entity:"offers",filters:{homeTab:"start_confirmation",today,...(summaryScope??{})},sort:"home_first_working",direction:"asc",enabled:selectedTab.key==="start_confirmation"});
  const qualityCursor = qualityCursorStack[qualityCursorStack.length - 1] ?? undefined;
  const qualityIdentity = JSON.stringify([accessScope, summaryScopeKey, today, qualityCursor]);
  const [loadedQualityIdentity, setLoadedQualityIdentity] = useState("");
  const qualityPage = loadedQualityIdentity === qualityIdentity ? qualitySnapshot : null;
  useEffect(() => {
    if (selectedTab.key !== "data_quality" || !listClient || !summaryScope || !accessScope) return;
    let cancelled = false;
    setQualityLoading(true); setQualityError(false);
    loadHomeQualityPage(listClient, { scope: JSON.parse(summaryScopeKey), today, cursor: qualityCursor, limit: 25, profileKey: accessScope, refreshKey: qualityRetry })
      .then(page => { if (!cancelled) { setQualityPage(page); setLoadedQualityIdentity(qualityIdentity); setQualityError(false); } })
      .catch(() => { if (!cancelled) { setQualityPage(null); setQualityError(true); } })
      .finally(() => { if (!cancelled) setQualityLoading(false); });
    return () => { cancelled = true; };
  }, [qualityIdentity, accessScope, listClient, qualityCursor, qualityRetry, selectedTab.key, summaryScope, summaryScopeKey, today]);
  const remoteCandidateRows = pipelinePage.items.map((candidate) => ({candidate,lastTouch:candidate.home_last_touch_date??null,pendingRemark:candidate.home_pending_remark??null}));
  const candidateRows = listClient ? remoteCandidateRows : ongoingCandidates.map((candidate) => {
    const logs = recruitmentLogs.filter((log) => belongsToApplication(log, candidate) && !log.superseded_at && !log.superseded_by_stage_instance_id);
    return {
      candidate,
      lastTouch: lastRecordedTouchDate(candidate, logs, today),
      pendingRemark: [...logs].sort((a, b) => compareApplicationLogs(b, a)).find((log) => log.result === null)?.remark?.trim() || null
    };
  });
  const visibleNeedsAction = listClient ? reqPage.items : needsAction;
  const visibleGroups = listClient ? groupPage.items : sourcingGroups;
  const visibleStartConfirmations = listClient ? startPage.items : startConfirmations;

  function selectTab(key: HomeTabKey) {
    if (key !== activeTab && recordListRef.current) { recordListRef.current.scrollTop = 0; recordListRef.current.scrollLeft = 0; }
    setActiveTab(key);
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, currentKey: HomeTabKey) {
    const currentIndex = tabs.findIndex((tab) => tab.key === currentKey);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    selectTab(nextTab.key);
    tabRefs.current[nextTab.key]?.focus();
  }

  if (!selectedTab) return null;

  return (
    <Panel variant="workspace">
      <SectionTitle title={translate(language, "homeRecords")} />
      <div
        aria-label={translate(language, "homeRecordTabs")}
        className="flex min-w-0 gap-4 overflow-x-auto border-b border-[#C9D5E6] px-1"
        role="tablist"
      >
        {tabs.map((tab) => {
          const selected = tab.key === selectedTab.key;
          return (
            <button
              key={tab.key}
              ref={(element) => { tabRefs.current[tab.key] = element; }}
              aria-controls={`home-record-panel-${tab.key}`}
              aria-selected={selected}
              className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                selected
                  ? "border-primary text-navy"
                  : "border-transparent text-slate hover:text-navy"
              }`}
              id={`home-record-tab-${tab.key}`}
              onClick={() => selectTab(tab.key)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.key)}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span>{tab.label}</span>
              <span aria-hidden="true" className={`inline-flex min-w-6 justify-center rounded-md px-1.5 py-0.5 text-xs tabular-nums ${selected ? "bg-primary/10 text-primary" : "bg-[#F1F4F8] text-cool"}`}>{tab.count === null ? "—" : formatNumber(tab.count, language)}</span>
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={`home-record-tab-${selectedTab.key}`}
        className="min-w-0 pt-2"
        id={`home-record-panel-${selectedTab.key}`}
        role="tabpanel"
        tabIndex={0}
      >
        {selectedTab.key === "open_headcount" ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1 pb-2 text-xs font-medium">
              <span className="text-slate" data-open-requisition-count="true">{reqPage.error ? translate(language,"loadFailed") : translate(language, "openRequisitionCount", { count: listClient?(reqPage.totalCount===null?reqPage.countLabel:formatNumber(reqPage.totalCount,language)):formatNumber(needsAction.length,language), plural: reqPage.totalCount === 1 ? "" : "s" })}{listClient&&reqPage.countError?<RetryIconButton type="button"  onClick={reqPage.retryCount} loading={reqPage.countLoading}>{translate(language,"retry")}</RetryIconButton>:null}</span>
              <label className="flex min-w-0 items-center gap-2 text-slate">{translate(language, "sortBy")}
                <SelectInput aria-label={translate(language, "sortOpenHeadcount")} className="max-w-[11rem]" value={headcountSort} onChange={(event) => setHeadcountSort(event.target.value as typeof headcountSort)}>
                  <option value="oldest">{translate(language, "oldestFirst")}</option>
                  <option value="demand">{translate(language, "mostOpenDemand")}</option>
                  <option value="position">{translate(language, "positionAZ")}</option>
                </SelectInput>
              </label>
            </div>
            <HomeRecordHeader columns={[translate(language, "openRequisition"), translate(language, "remainingVacancyShort"), translate(language, "sourcingLinkReadiness"), translate(language, "ageSla"), translate(language, "owner")]} gridClass={headcountColumns} />
            <div ref={recordListRef} className="grid grid-cols-1 divide-y divide-[#E4E9F2] md:max-h-[min(62dvh,44rem)] md:overflow-y-auto md:overscroll-y-contain" data-home-record-list="true">{reqPage.initialLoading&&!reqPage.items.length?<LoadingSkeleton variant="table" label={<>{translate(language,"loading")}</>} className="p-4 text-sm text-slate" />:reqPage.error?<div role="alert" className="p-4 text-sm text-danger">{translate(language,"loadFailed")} <RetryIconButton  onClick={reqPage.retry} loading={reqPage.loading}>{translate(language,"retry")}</RetryIconButton></div>:visibleNeedsAction.length===0?<TabEmptyState message={translate(language,"noOpenHeadcount")} />:(listClient?visibleNeedsAction:[...visibleNeedsAction].sort((a,b)=>compareHeadcount(a,b,headcountSort))).map((row) => <NeedActionCard key={row.doc_id} candidates={candidates} language={language} onOpenRequisition={onOpenRequisition} row={row} />)}</div>
            {reqPage.refreshing ? <RefreshIndicator language={language} /> : null}{listClient&&!reqPage.error?<CursorPagination language={language} page={reqPage.page} pageSize={reqPage.pageSize} loading={reqPage.loading} canPrevious={reqPage.canPrevious} canNext={reqPage.canNext} onPrevious={reqPage.goPrevious} onNext={reqPage.goNext} onPageSizeChange={reqPage.setPageSize}/>:null}
          </>
        ) : null}
        {selectedTab.key === "candidate_pipeline" ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1 pb-2 text-xs font-medium">
              <span className="text-slate" data-home-candidate-count="true">{pipelinePage.error?translate(language,"loadFailed"):translate(language, "candidatePipelineCount", { count: listClient?(pipelinePage.totalCount===null?pipelinePage.countLabel:formatNumber(pipelinePage.totalCount,language)):formatNumber(ongoingCandidates.length,language) })}{listClient&&pipelinePage.countError?<RetryIconButton type="button"  onClick={pipelinePage.retryCount} loading={pipelinePage.countLoading}>{translate(language,"retry")}</RetryIconButton>:null}</span>
              <label className="flex min-w-0 items-center gap-2 text-slate">{translate(language, "sortBy")}
                <SelectInput aria-label={translate(language, "sortCandidatePipeline")} className="max-w-[12rem]" value={candidateSort} onChange={(event) => setCandidateSort(event.target.value as typeof candidateSort)}>
                  <option value="oldest_touch">{translate(language, "oldestTouchFirst")}</option>
                  <option value="newest_touch">{translate(language, "newestTouchFirst")}</option>
                  <option value="name">{translate(language, "candidateAZ")}</option>
                  <option value="progression">{translate(language, "progressionFurthest")}</option>
                </SelectInput>
              </label>
            </div>
            <div ref={recordListRef} className="min-w-0 md:max-h-[min(62dvh,44rem)] md:overflow-auto md:overscroll-contain" data-home-candidate-scroll="true">
              <div className="md:min-w-[62rem] xl:min-w-0">
                <HomeRecordHeader columns={[translate(language, "candidate"), translate(language, "stage"), translate(language, "siteOwner"), translate(language, "lastTouch"), translate(language, "pendingRemark"), translate(language, "progress")]} gridClass={pipelineColumns} sticky />
                <div className="grid grid-cols-1 divide-y divide-[#E4E9F2]" data-home-record-list="true">{pipelinePage.initialLoading&&!candidateRows.length?<LoadingSkeleton variant="table" label={<>{translate(language,"loading")}</>} className="p-4 text-sm text-slate" />:pipelinePage.error?<div role="alert" className="p-4 text-sm text-danger">{translate(language,"loadFailed")} <RetryIconButton  onClick={pipelinePage.retry} loading={pipelinePage.loading}>{translate(language,"retry")}</RetryIconButton></div>:candidateRows.length===0?<TabEmptyState message={translate(language,"noActiveCandidates")} />:(listClient?candidateRows:candidateRows.sort((a,b)=>compareCandidateRows(a,b,candidateSort))).map(({ candidate, lastTouch, pendingRemark }) => <CandidateActionCard key={candidate.application_id ?? candidate.candidate_id} candidate={candidate} language={language} lastTouch={lastTouch} pendingRemark={pendingRemark} onOpenCandidate={onOpenCandidate} />)}</div>
              </div>
            </div>
            {pipelinePage.refreshing ? <RefreshIndicator language={language} /> : null}{listClient&&!pipelinePage.error?<CursorPagination language={language} page={pipelinePage.page} pageSize={pipelinePage.pageSize} loading={pipelinePage.loading} canPrevious={pipelinePage.canPrevious} canNext={pipelinePage.canNext} onPrevious={pipelinePage.goPrevious} onNext={pipelinePage.goNext} onPageSizeChange={pipelinePage.setPageSize}/>:null}
          </>
        ) : null}
        {selectedTab.key === "sourcing_updates" ? <div ref={recordListRef} className="min-w-0 md:max-h-[min(62dvh,44rem)] md:overflow-auto" data-home-record-list="true"><div className="md:min-w-[68rem]"><HomeRecordHeader columns={[translate(language, "group"), translate(language, "linkedRequisitions"), translate(language, "openVacanciesHeader"), translate(language, "siteOwner"), translate(language, "weekStatus"), translate(language, "lastSaved")]} gridClass={sourcingColumns} sticky /><div className="divide-y divide-[#E4E9F2]">{groupPage.initialLoading&&!visibleGroups.length?<LoadingSkeleton variant="table" label={<>{translate(language,"loading")}</>} className="p-4 text-sm text-slate" />:groupPage.error?<div role="alert" className="p-4 text-sm text-danger">{translate(language,"loadFailed")} <RetryIconButton  onClick={groupPage.retry} loading={groupPage.loading}>{translate(language,"retry")}</RetryIconButton></div>:visibleGroups.length===0?<TabEmptyState message={translate(language,"noOpenSourcingAttention")} />:visibleGroups.map((group) => <SourcingUpdateCard key={group.group_id} group={group} language={language} href={groupWorkspaceHref(sourcingHref, group.group_id)} />)}</div>{groupPage.refreshing ? <RefreshIndicator language={language} /> : null}{listClient&&!groupPage.error?<><span aria-live="polite">{groupPage.countLabel}</span>{groupPage.countError?<RetryIconButton type="button"  onClick={groupPage.retryCount} loading={groupPage.countLoading}>{translate(language,"retry")}</RetryIconButton>:null}<CursorPagination language={language} page={groupPage.page} pageSize={groupPage.pageSize} loading={groupPage.loading} canPrevious={groupPage.canPrevious} canNext={groupPage.canNext} onPrevious={groupPage.goPrevious} onNext={groupPage.goNext} onPageSizeChange={groupPage.setPageSize}/></>:null}</div></div> : null}
        {selectedTab.key === "data_quality" ? <div ref={recordListRef} className="min-w-0 md:max-h-[min(62dvh,44rem)] md:overflow-auto" data-home-record-list="true"><div className="md:min-w-[70rem]"><HomeRecordHeader columns={[translate(language, "record"), translate(language, "issue"), translate(language, "severity"), translate(language, "explanation"), translate(language, "context"), translate(language, "action")]} gridClass={qualityColumns} sticky />{qualityLoading && !qualityPage ? <LoadingSkeleton variant="table" label={<>{translate(language, "loading")}</>} className="py-4 text-sm text-slate" /> : null}{qualityError ? <div role="alert" className="py-4 text-sm text-danger">{translate(language, "loadFailed")} <RetryIconButton type="button"  onClick={() => setQualityRetry(value => value + 1)}>{translate(language, "retry")}</RetryIconButton></div> : null}<div className="divide-y divide-[#E4E9F2]">{qualityPage?.items.map(issue => <HomeQualityRow key={issue.cursorId} candidates={candidates} issue={issue} language={language} offers={offers} onOpenCandidate={onOpenCandidate} onOpenRequisition={onOpenRequisition} requisitions={requisitions} sourcingHref={sourcingHref} />)}{qualityPage && qualityPage.totalCount===0 && !qualityLoading ? <TabEmptyState message={translate(language, "noDataQualityIssues")} /> : null}</div>{qualityPage && qualityPage.totalCount>0 ? <div className="flex items-center justify-between gap-3 py-3 text-sm"><span>Page {qualityCursorStack.length} · {qualityPage.totalCount} issues</span><div className="flex gap-2"><Button type="button" variant="secondary" disabled={qualityCursorStack.length<=1||qualityLoading} onClick={()=>{setQualityPage(null);setQualityCursorStack(stack=>stack.slice(0,-1));}}>{translate(language,"previous")}</Button><Button type="button" variant="secondary" disabled={!qualityPage.hasMore||qualityLoading||!qualityPage.nextCursor} onClick={()=>{if(qualityPage.nextCursor){setQualityPage(null);setQualityCursorStack(stack=>[...stack,qualityPage.nextCursor]);}}}>{translate(language,"next")}</Button></div></div>:null}</div></div> : null}
        {selectedTab.key === "start_confirmation" ? <div ref={recordListRef} className="min-w-0 md:max-h-[min(62dvh,44rem)] md:overflow-auto" data-home-record-list="true"><div className="md:min-w-[68rem]"><HomeRecordHeader columns={[translate(language, "candidate"), translate(language, "requisition"), translate(language, "siteOwner"), translate(language, "firstWorkingDate"), translate(language, "confirmationState"), translate(language, "confirmationAction")]} gridClass={confirmationColumns} sticky /><div className="divide-y divide-[#E4E9F2]">{startPage.initialLoading&&!visibleStartConfirmations.length?<LoadingSkeleton variant="table" label={<>{translate(language,"loading")}</>} className="p-4 text-sm text-slate" />:startPage.error?<div role="alert" className="p-4 text-sm text-danger">{translate(language,"loadFailed")} <RetryIconButton  onClick={startPage.retry} loading={startPage.loading}>{translate(language,"retry")}</RetryIconButton></div>:visibleStartConfirmations.length===0?<TabEmptyState message={translate(language,"noNewHireConfirmations")} />:visibleStartConfirmations.map((offer) => <StartConfirmationCard key={offer.offer_id} language={language} offer={offer} onConfirm={() => onConfirmStart(offer)} onOpenCandidate={onOpenCandidate} requisition={requisitions.find((row) => row.doc_id === offer.doc_id)} />)}</div>{startPage.refreshing ? <RefreshIndicator language={language} /> : null}{listClient&&!startPage.error?<><span aria-live="polite">{startPage.countLabel}</span>{startPage.countError?<RetryIconButton type="button"  onClick={startPage.retryCount} loading={startPage.countLoading}>{translate(language,"retry")}</RetryIconButton>:null}<CursorPagination language={language} page={startPage.page} pageSize={startPage.pageSize} loading={startPage.loading} canPrevious={startPage.canPrevious} canNext={startPage.canNext} onPrevious={startPage.goPrevious} onNext={startPage.goNext} onPageSizeChange={startPage.setPageSize}/></>:null}</div></div> : null}
      </div>
    </Panel>
  );
}

function TabEmptyState({ message }: { message: string }) {
  return <EmptyState variant="quiet" message={message} />;
}

function HomeRecordHeader({ columns, gridClass, sticky = false }: { columns: string[]; gridClass: string; sticky?: boolean }) {
  return <div data-home-record-header="true" className={`hidden min-w-0 gap-3 border-b border-[#D7DEE8] px-2 py-2 text-left text-[11px] font-medium text-slate md:grid ${sticky ? "md:sticky md:top-0 md:z-10 md:bg-white" : ""} ${gridClass}`}>{columns.map((column) => <span key={column} className="min-w-0 truncate" title={column}>{column}</span>)}</div>;
}

function MobileFieldLabel({ children }: { children: string }) {
  return <span className="text-[11px] font-medium text-slate md:hidden">{children}</span>;
}

function groupWorkspaceHref(sourcingHref: string, groupId: string) {
  const [path, query = ""] = sourcingHref.split("?");
  const params = new URLSearchParams(query);
  params.set("type", "group");
  params.set("id", groupId);
  return `${path.replace(/\/sourcing$/, "/workspace")}?${params.toString()}`;
}

function NeedActionCard({
  candidates,
  language,
  row,
  onOpenRequisition
}: {
  language: Language;
  candidates: EnrichedCandidate[];
  row: EnrichedRequisition;
  onOpenRequisition: (docId: string) => void;
}) {
  const slaState = getRequisitionSlaState(row, { openOnly: true });
  const readiness = requisitionSourcingLinkReadiness(row);
  const title = formatRequisitionTitle(row);
  return (
    <article data-home-requisition-row="true" className={`grid min-w-0 gap-2 px-2 py-2.5 text-[13px] md:items-center md:gap-3 md:text-xs xl:text-[13px] ${headcountColumns}`}>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "openRequisition")}</MobileFieldLabel><button type="button" className="block min-h-11 max-w-full rounded-sm text-left font-semibold text-navy underline-offset-2 hover:text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30 md:min-h-0" aria-label={`${translate(language, "openRequisition")}: ${title}`} title={title} onClick={() => onOpenRequisition(row.doc_id)}><span className="block truncate">{title}</span></button><p className="truncate text-[11px] font-medium text-slate" title={`${row.doc_id} · ${row.site}`}>{row.doc_id} · {row.site}</p></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "remainingVacancyShort")}</MobileFieldLabel><span className="block font-semibold tabular-nums text-navy">{formatNumber(row.open_headcount, language)}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "sourcingLinkReadiness")}</MobileFieldLabel><span title={sourcingLinkReadinessReason(language, readiness.groupIds)} className="block min-w-0"><Tag appearance="soft" tone={readiness.tone}>{sourcingLinkReadinessLabel(language, readiness.linked)}</Tag></span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "ageSla")}</MobileFieldLabel><span className="block font-semibold tabular-nums text-navy">{slaState.ageDays === null || slaState.slaDays === null ? "—" : `${slaState.ageDays}d/${slaState.slaDays}d`}</span>{slaState.isOverdue && slaState.ageDays !== null && slaState.slaDays !== null ? <span className="block text-[11px] font-normal text-scarlet">{translate(language, "overdueDays", { count: formatNumber(slaState.ageDays - slaState.slaDays, language) })}</span> : null}</div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "owner")}</MobileFieldLabel><span className="block truncate font-medium text-slate" title={row.person_in_charge ?? translate(language, "unassigned")}>{row.person_in_charge ?? translate(language, "unassigned")}</span></div>
    </article>
  );
}

function CandidateActionCard({
  candidate,
  language,
  lastTouch,
  pendingRemark,
  onOpenCandidate
}: {
  candidate: EnrichedCandidate;
  language: Language;
  lastTouch: string | null;
  pendingRemark: string | null;
  onOpenCandidate: (candidateId: string, applicationId?: string) => void;
}) {
  const needsOfferFinalization = candidate.latest_process === "Offer" && candidate.latest_result === 1;
  return (
    <article data-home-candidate-row="true" data-candidate-id={candidate.candidate_id} className={`grid min-w-0 gap-2 px-2 py-2.5 text-[13px] md:items-center md:gap-3 md:text-xs xl:text-[13px] ${pipelineColumns}`}>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "candidate")}</MobileFieldLabel><button type="button" aria-label={`${translate(language, "openCandidate")}: ${formatCandidateName(candidate)}`} title={formatCandidateName(candidate)} className="block min-h-11 max-w-full rounded-sm text-left font-semibold text-navy underline-offset-2 hover:text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30 md:min-h-0" onClick={() => onOpenCandidate(candidate.candidate_id, candidate.application_id)}><span className="block truncate">{formatCandidateName(candidate)}</span></button><p className="truncate text-[11px] font-medium text-slate" title={`${formatRecruitmentId(candidate.candidate_id)} · ${candidate.group_position ?? "—"}`}>{formatRecruitmentId(candidate.candidate_id)} · {candidate.group_position ?? "—"}</p></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "stage")}</MobileFieldLabel><span className="block truncate font-medium text-navy" title={needsOfferFinalization ? translate(language, "offerPending") : processLabel(candidate.latest_process, language)}>{needsOfferFinalization ? translate(language, "offerPending") : processLabel(candidate.latest_process, language)}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "siteOwner")}</MobileFieldLabel><span className="block truncate font-medium text-slate" title={`${candidate.site ?? "—"} · ${candidate.person_in_charge ?? translate(language, "unassigned")}`}>{candidate.site ?? "—"} · {candidate.person_in_charge ?? translate(language, "unassigned")}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "lastTouch")}</MobileFieldLabel><span className="block font-medium tabular-nums text-navy">{lastTouch ? formatDate(lastTouch, language) : "—"}</span>{lastTouch ? <span className="block text-[11px] font-normal text-slate">{translate(language, "touchAgeDays", { count: formatNumber(ageDays(lastTouch) ?? 0, language) })}</span> : null}</div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "pendingRemark")}</MobileFieldLabel><span className="block truncate font-medium text-slate focus:rounded-sm focus:outline-none focus:ring-2 focus:ring-primary/30" tabIndex={pendingRemark ? 0 : undefined} aria-label={pendingRemark ?? undefined} title={pendingRemark ?? undefined}>{pendingRemark ?? "—"}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "progress")}</MobileFieldLabel><StageRail compact showStageIcons bareStageIcons showConnectors={false} showSummary={false} language={language} currentStage={candidate.latest_process} currentResult={candidate.latest_result} /></div>
    </article>
  );
}

function validRecordedDate(value: string | null | undefined, today: string) {
  const date = value?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

function lastRecordedTouchDate(candidate: EnrichedCandidate, logs: RecruitmentLog[], today: string) {
  const activityDates = logs.flatMap((log) => [validRecordedDate(log.log_date, today), validRecordedDate(log.outcome_date, today)]).filter((value): value is string => Boolean(value));
  return activityDates.sort().at(-1) ?? validRecordedDate(candidate.first_contact_date, today);
}

function compareCandidateRows(a: { candidate: EnrichedCandidate; lastTouch: string | null }, b: { candidate: EnrichedCandidate; lastTouch: string | null }, sort: "oldest_touch" | "newest_touch" | "name" | "progression") {
  const identity = formatCandidateName(a.candidate).localeCompare(formatCandidateName(b.candidate), undefined, { sensitivity: "base" }) || a.candidate.candidate_id.localeCompare(b.candidate.candidate_id);
  if (sort === "name") return identity;
  if (sort === "progression") return (PIPELINE_JOURNEY_STAGES.indexOf(b.candidate.latest_process as typeof PIPELINE_JOURNEY_STAGES[number]) - PIPELINE_JOURNEY_STAGES.indexOf(a.candidate.latest_process as typeof PIPELINE_JOURNEY_STAGES[number])) || identity;
  if (!a.lastTouch || !b.lastTouch) return a.lastTouch ? -1 : b.lastTouch ? 1 : identity;
  return (sort === "oldest_touch" ? a.lastTouch.localeCompare(b.lastTouch) : b.lastTouch.localeCompare(a.lastTouch)) || identity;
}

function SourcingUpdateCard({ group, language, href }: { group: EnrichedSourcingGroup; language: Language; href: string }) {
  const channels = group.latest_update ? SOURCING_CHANNELS.filter((channel) => group.latest_update?.[channel.enabled]) : [];
  const weekComplete = Boolean(group.latest_update) && channels.length > 0 && channels.every((channel) => group.latest_update?.[channel.count] != null);
  return (
    <article className={`grid min-w-0 gap-2 px-2 py-2.5 text-[13px] md:items-center md:gap-3 md:text-xs xl:text-[13px] ${sourcingColumns}`}>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "group")}</MobileFieldLabel><Link className="block min-h-11 max-w-full rounded-sm text-left font-semibold text-navy underline-offset-2 hover:text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30 md:min-h-0" href={href} title={`${formatRecruitmentId(group.group_id)} - ${group.group_position}`}><span className="block truncate">{formatRecruitmentId(group.group_id)} - {group.group_position}</span></Link><p className="truncate text-[11px] font-medium text-slate" title={group.doc_ids.join(", ")}>{group.doc_ids.join(", ") || "—"}</p></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "linkedRequisitions")}</MobileFieldLabel><span className="block font-semibold tabular-nums text-navy">{formatNumber(group.doc_ids.length, language)}</span><span className="block break-all text-[11px] text-slate">{group.doc_ids.join(", ") || "—"}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "openVacanciesHeader")}</MobileFieldLabel><span className="block font-semibold tabular-nums text-navy">{formatNumber(group.open_headcount, language)}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "siteOwner")}</MobileFieldLabel><span className="block truncate font-medium text-slate" title={`${group.sites.join(", ")} · ${group.owners.join(", ") || translate(language, "unassigned")}`}>{group.sites.join(", ")} · {group.owners.join(", ") || translate(language, "unassigned")}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "weekStatus")}</MobileFieldLabel><Tag appearance="soft" tone={weekComplete ? "success" : "warning"}>{translate(language, weekComplete ? "workspaceRecordedUpdate" : group.latest_update ? "workspaceIncompleteWeek" : "workspaceMissingUpdate")}</Tag></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "lastSaved")}</MobileFieldLabel><span className="block truncate font-medium text-slate">{group.latest_update?.updated_at ? formatDateTime(group.latest_update.updated_at, language) : translate(language, "notUpdatedYet")}</span></div>
    </article>
  );
}

function HomeQualityRow({ candidates, issue, language, offers, onOpenCandidate, onOpenRequisition, requisitions, sourcingHref }: {
  candidates: EnrichedCandidate[];
  issue: Pick<DataQualityIssue, "id" | "severity" | "entity" | "entityId" | "title" | "detail" | "actionLabel" | "href">;
  language: Language;
  offers: EnrichedOffer[];
  onOpenCandidate: (candidateId: string, applicationId?: string) => void;
  onOpenRequisition: (docId: string) => void;
  requisitions: EnrichedRequisition[];
  sourcingHref: string;
}) {
  const candidate = candidates.find((row) => row.candidate_id === issue.entityId);
  const requisition = requisitions.find((row) => row.doc_id === issue.entityId);
  const offer = offers.find((row) => String(row.offer_id) === issue.entityId);
  const site = candidate?.site ?? requisition?.site ?? offers.find((row) => row.offer_id === offer?.offer_id)?.site ?? null;
  const recordName = candidate ? formatCandidateName(candidate) : requisition ? formatRequisitionTitle(requisition) : offer ? offer.candidate_name ?? formatRecruitmentId(offer.candidate_id) : formatRecruitmentId(issue.entityId);
  const recordClass = "block min-h-11 max-w-full rounded-sm text-left font-semibold text-navy underline-offset-2 hover:text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30 md:min-h-0";
  const identity = issue.entity === "candidate" || issue.entity === "pipeline"
    ? <button type="button" className={recordClass} title={recordName} onClick={() => onOpenCandidate(issue.entityId)}><span className="block truncate">{recordName}</span></button>
    : issue.entity === "requisition"
      ? <button type="button" className={recordClass} title={recordName} onClick={() => onOpenRequisition(issue.entityId)}><span className="block truncate">{recordName}</span></button>
      : <Link className={recordClass} title={recordName} href={issue.entity === "sourcing" ? groupWorkspaceHref(sourcingHref, issue.entityId) : `/offers?offerSearch=${encodeURIComponent(offer?.candidate_id ?? issue.entityId)}`}><span className="block truncate">{recordName}</span></Link>;
  const severityTone = issue.severity === "blocking" ? "danger" : issue.severity === "warning" ? "warning" : "muted";
  return <article data-home-quality-row="true" className={`grid min-w-0 gap-2 px-2 py-2.5 text-[13px] md:items-center md:gap-3 md:text-xs xl:text-[13px] ${qualityColumns}`}>
    <div className="min-w-0"><MobileFieldLabel>{translate(language, "record")}</MobileFieldLabel>{identity}<span className="block truncate text-[11px] font-medium text-slate">{formatRecruitmentId(issue.entityId)}</span></div>
    <div className="min-w-0"><MobileFieldLabel>{translate(language, "issue")}</MobileFieldLabel><span className="block break-words font-medium text-navy">{issue.title}</span></div>
    <div className="min-w-0"><MobileFieldLabel>{translate(language, "severity")}</MobileFieldLabel><Tag appearance="soft" tone={severityTone}>{severityLabel(language, issue.severity)}</Tag></div>
    <div className="min-w-0"><MobileFieldLabel>{translate(language, "explanation")}</MobileFieldLabel><span className="block break-words font-medium text-slate">{issue.detail}</span></div>
    <div className="min-w-0"><MobileFieldLabel>{translate(language, "context")}</MobileFieldLabel><span className="block break-words text-slate">{translate(language, issue.entity === "offer" ? "workspaceOffer" : issue.entity)}{site ? ` · ${site}` : ""}</span></div>
    <div className="min-w-0"><MobileFieldLabel>{translate(language, "action")}</MobileFieldLabel>{issue.href && issue.actionLabel ? <Link className="inline-flex min-h-11 items-center rounded-md px-2 text-xs font-semibold text-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/30 md:min-h-9" href={issue.href}>{issue.actionLabel}</Link> : <span className="text-slate">—</span>}</div>
  </article>;
}

function StartConfirmationCard({ language, offer, onConfirm, onOpenCandidate, requisition }: { language: Language; offer: EnrichedOffer; onConfirm: () => void; onOpenCandidate: (candidateId: string, applicationId?: string) => void; requisition?: EnrichedRequisition }) {
  return (
    <article className={`grid min-w-0 gap-2 px-2 py-2.5 text-[13px] md:items-center md:gap-3 md:text-xs xl:text-[13px] ${confirmationColumns}`}>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "candidate")}</MobileFieldLabel><button type="button" className="block min-h-11 max-w-full rounded-sm text-left font-semibold text-navy underline-offset-2 hover:text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30 md:min-h-0" title={offer.candidate_name ?? formatRecruitmentId(offer.candidate_id)} aria-label={`${translate(language, "openCandidate")}: ${offer.candidate_name ?? formatRecruitmentId(offer.candidate_id)}`} onClick={() => onOpenCandidate(offer.candidate_id, offer.application_id)}><span className="block truncate">{offer.candidate_name ?? formatRecruitmentId(offer.candidate_id)}</span></button><span className="block truncate text-[11px] font-medium text-slate">{formatRecruitmentId(offer.candidate_id)}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "requisition")}</MobileFieldLabel><span className="block truncate font-medium text-navy" title={`${formatRequisitionTitle(offer)} · ${offer.doc_id}`}>{formatRequisitionTitle(offer)} · {offer.doc_id}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "siteOwner")}</MobileFieldLabel><span className="block break-words text-slate">{requisition?.site || offer.site || "—"} · {requisition?.person_in_charge || offer.person_in_charge || translate(language, "unassigned")}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "firstWorkingDate")}</MobileFieldLabel><span className="block font-medium tabular-nums text-slate">{formatDate(offer.first_working_date, language)}</span></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "confirmationState")}</MobileFieldLabel><Tag appearance="soft" tone="warning">{translate(language, "pending")}</Tag></div>
      <div className="min-w-0"><MobileFieldLabel>{translate(language, "confirmationAction")}</MobileFieldLabel><Button type="button" size="sm" variant="secondary" icon={<BadgeCheck size={15} aria-hidden="true" />} className="!min-h-11 px-2.5 text-xs md:!min-h-9" onClick={onConfirm}>{translate(language, "confirmStart")}</Button></div>
    </article>
  );
}

function compareHeadcount(a: EnrichedRequisition, b: EnrichedRequisition, sort: "oldest" | "demand" | "position") {
  const ageA = getRequisitionSlaState(a, { openOnly: true }).ageDays;
  const ageB = getRequisitionSlaState(b, { openOnly: true }).ageDays;
  if (sort === "position") return a.position.localeCompare(b.position, undefined, { sensitivity: "base" }) || a.doc_id.localeCompare(b.doc_id);
  if (sort === "demand") return b.open_headcount - a.open_headcount || compareByAgeDesc(ageA, ageB) || a.doc_id.localeCompare(b.doc_id);
  return compareByAgeDesc(ageA, ageB) || b.open_headcount - a.open_headcount;
}

function compareByAgeDesc(ageA: number | null, ageB: number | null) {
  if (ageA === null && ageB === null) return 0;
  if (ageA === null) return 1;
  if (ageB === null) return -1;
  return ageB - ageA;
}
