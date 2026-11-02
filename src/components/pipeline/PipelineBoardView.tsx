"use client";
import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { LoadingSkeleton, RefreshIndicator } from "@/components/ui/LoadingSkeleton";
import { compareApplicationLogs } from "@/lib/application-stage-order";
import { belongsToApplication, applicationKey } from "@/lib/applications";

import { failureReasonText } from "@/lib/rejection-reasons";

import { ArrowRight, Filter, Mail, Pencil, Plus, Search } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { DayDateSelector, SelectInput } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { OperationalSummaryStrip } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { CursorPagination } from "@/components/ui/CursorPagination";
import { SortableFilterHeader, TableToolbar, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { DisabledReasonHint } from "@/components/ui/Workflow";
import { ACTIVE_PIPELINE_STAGES, processIndex, processLabel } from "@/lib/constants";
import { formatLocalDateInput } from "@/lib/dates";
import { formatCandidateName, formatDate, formatRecruitmentId, resultText, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { candidatePipelineCapability, candidateProcessDisabledReason, candidateTouchAgeDays, isCandidateAging, pipelineMoveDisabledReason, type DataQualityIssue } from "@/lib/operations";
import { readTableUrlState, writeTableUrlValues } from "@/lib/table-url-state";
import { updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import { useRecruitmentList } from "@/lib/recruitment-list";
import { clearPipelineSummaryCache, loadPipelineSummary, pipelineSummaryRevision, subscribePipelineSummary, type PipelineSummary } from "@/lib/pipeline-summary-loader";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateReference, CandidateReferenceCheck, DashboardData, EnrichedCandidate, Language, ProcessStage, Profile, RecruitmentLog } from "@/types/recruitment";

type PipelineStageKey = ProcessStage | "No activity";
type PipelineGroupBy = "none" | "site" | "owner";
type BoardFilter = "all" | "aging" | "no_activity" | "offer_pending" | "over_sla";
type PipelineView = "board" | "table";

function isRepeatableStage(stage: PipelineStageKey | null | undefined): stage is "Line Interview" | "Test" {
  return stage === "Line Interview" || stage === "Test";
}

export function PipelineBoardView({
  language,
  rows: initialRows,
  recruitmentLogs,
  recruitmentLogHistory = recruitmentLogs,
  candidateReferences = [],
  candidateReferenceChecks = [],
  profile,
  dataQualityIssues = [],
  embedded = false,
  canWrite,
  offeredCandidateIds,
  rejectionLetterSentCandidateIds,
  onNewCandidate,
  onOpen,
  onMove,
  onFailCurrentStage,
  onMaintainTest,
  onStartProcess,
  onEditPending,
  onPassStage,
  onManageReferenceChecks,
  onCreateOffer,
  onUpdateOffer,
  onEditCandidate,
  onCorrectPipelineRecord
  , onCreateRejectionLetter,
  listClient = null,
  accessScope = "",
  listScope = {},
  onEnsureActionContext,
  mutationRevision = 0
}: {
  language: Language;
  rows: EnrichedCandidate[];
  recruitmentLogs: RecruitmentLog[];
  recruitmentLogHistory?: RecruitmentLog[];
  candidateReferences?: CandidateReference[];
  candidateReferenceChecks?: CandidateReferenceCheck[];
  profile: Profile | null;
  dataQualityIssues?: DataQualityIssue[];
  /** Renders inside an existing workspace surface without standalone page chrome. */
  embedded?: boolean;
  canWrite: boolean;
  offeredCandidateIds?: ReadonlySet<string>;
  rejectionLetterSentCandidateIds?: ReadonlySet<string>;
  onNewCandidate?: () => void;
  onOpen: (candidateId: string, applicationId?: string) => void;
  onMove: (candidate: EnrichedCandidate, nextStage: ProcessStage) => void;
  onFailCurrentStage: (candidate: EnrichedCandidate) => void;
  onMaintainTest: (candidate: EnrichedCandidate) => void;
  onStartProcess: (candidate: EnrichedCandidate) => void;
  onEditPending?: (candidate: EnrichedCandidate) => void;
  onPassStage?: (candidate: EnrichedCandidate) => void;
  onManageReferenceChecks?: (candidate: EnrichedCandidate) => void;
  onCreateOffer?: (candidate: EnrichedCandidate) => void;
  onUpdateOffer: (candidate: EnrichedCandidate) => void;
  onEditCandidate?: (candidateId: string) => void;
  onCorrectPipelineRecord?: (candidate: EnrichedCandidate, log: RecruitmentLog) => void;
  onCreateRejectionLetter?: (candidate: EnrichedCandidate) => void;
  listClient?: SupabaseClient | null;
  accessScope?: string;
  listScope?: Record<string, unknown>;
  mutationRevision?: number;
  onEnsureActionContext?: (candidate: EnrichedCandidate) => Promise<{ data: DashboardData; candidate: EnrichedCandidate } | null>;
}) {
  const [dragged, setDragged] = useState<EnrichedCandidate | null>(null);
  const [blockedStage, setBlockedStage] = useState<PipelineStageKey | null>(null);
  const [openStageMenu, setOpenStageMenu] = useState<string | null>(null);
  const [openMobileStageMenu, setOpenMobileStageMenu] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<PipelineGroupBy>("none");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [focusedCandidateId, setFocusedCandidateId] = useState<string | null>(null);
  const [pipelineView, setPipelineView] = useState<PipelineView>("board");
  const [actionContexts, setActionContexts] = useState<Record<string, Pick<DashboardData, "recruitment_logs" | "candidate_references" | "candidate_reference_checks">>>({});
  useEffect(() => { setActionContexts({}); setOpenStageMenu(null); setOpenMobileStageMenu(null); }, [accessScope, mutationRevision]);
  const serverEnabled = Boolean(listClient && accessScope);
  const stageFilters = { ...listScope, boardFilter, asOf: formatLocalDateInput(), recentSince: recentCutoffDate() };
  const stageSearchInput = { value: pipelineSearch, setValue: setPipelineSearch };
  const noActivityList = useRecruitmentList<EnrichedCandidate>({ client: listClient, accessScope, entity: "pipeline_stage", filters: { ...stageFilters, stage: "No activity" }, sort: "board_last_update", direction: "asc", searchInput: stageSearchInput, enabled: serverEnabled });
  const phoneList = useRecruitmentList<EnrichedCandidate>({ client: listClient, accessScope, entity: "pipeline_stage", filters: { ...stageFilters, stage: "Phone Screen" }, sort: "board_last_update", direction: "asc", searchInput: stageSearchInput, enabled: serverEnabled });
  const hrInterviewList = useRecruitmentList<EnrichedCandidate>({ client: listClient, accessScope, entity: "pipeline_stage", filters: { ...stageFilters, stage: "HR Interview" }, sort: "board_last_update", direction: "asc", searchInput: stageSearchInput, enabled: serverEnabled });
  const lineInterviewList = useRecruitmentList<EnrichedCandidate>({ client: listClient, accessScope, entity: "pipeline_stage", filters: { ...stageFilters, stage: "Line Interview" }, sort: "board_last_update", direction: "asc", searchInput: stageSearchInput, enabled: serverEnabled });
  const testList = useRecruitmentList<EnrichedCandidate>({ client: listClient, accessScope, entity: "pipeline_stage", filters: { ...stageFilters, stage: "Test" }, sort: "board_last_update", direction: "asc", searchInput: stageSearchInput, enabled: serverEnabled });
  const referenceList = useRecruitmentList<EnrichedCandidate>({ client: listClient, accessScope, entity: "pipeline_stage", filters: { ...stageFilters, stage: "Reference Check" }, sort: "board_last_update", direction: "asc", searchInput: stageSearchInput, enabled: serverEnabled });
  const offerList = useRecruitmentList<EnrichedCandidate>({ client: listClient, accessScope, entity: "pipeline_stage", filters: { ...stageFilters, stage: "Offer" }, sort: "board_last_update", direction: "asc", searchInput: stageSearchInput, enabled: serverEnabled });
  const stageLists: Array<{ stage: PipelineStageKey; list: ReturnType<typeof useRecruitmentList<EnrichedCandidate>> }> = [
    { stage: "No activity", list: noActivityList }, { stage: "Phone Screen", list: phoneList }, { stage: "HR Interview", list: hrInterviewList },
    { stage: "Line Interview", list: lineInterviewList }, { stage: "Test", list: testList }, { stage: "Reference Check", list: referenceList }, { stage: "Offer", list: offerList }
  ];
  const stageListByStage = new Map(stageLists.map(entry => [entry.stage, entry.list]));
  const failedList = useRecruitmentList<EnrichedCandidate>({ client: listClient, accessScope, entity: "candidate_applications", filters: { ...listScope, boardFilter: "failed", asOf: formatLocalDateInput(), ...(embedded ? { embeddedAllTime: true } : { recentSince: recentCutoffDate() }) }, sort: "latest_log_date", direction: "desc", enabled: serverEnabled });
  const passedOfferList = useRecruitmentList<EnrichedCandidate>({ client: listClient, accessScope, entity: "candidate_applications", filters: { ...listScope, boardFilter: "passed_offer", asOf: formatLocalDateInput(), ...(embedded ? { embeddedAllTime: true } : { recentSince: recentCutoffDate() }) }, sort: "latest_log_date", direction: "desc", enabled: serverEnabled });
  async function openCandidateActionMenu(candidate: EnrichedCandidate, setMenu: (value: string | null | ((current: string | null) => string | null)) => void) {
    const key = applicationKey(candidate);
    if (serverEnabled && onEnsureActionContext) {
      const hydrated = await onEnsureActionContext(candidate);
      if (!hydrated) return;
      setActionContexts({ [key]: hydrated.data });
    }
    setMenu(current => current === key ? null : key);
  }
  function actionRows(candidate: EnrichedCandidate) {
    const hydrated = actionContexts[applicationKey(candidate)];
    return {
      recruitmentLogs: hydrated?.recruitment_logs ?? recruitmentLogs.filter(log => belongsToApplication(log, candidate)),
      candidateReferences: hydrated?.candidate_references ?? candidateReferences.filter(reference => reference.candidate_id === candidate.candidate_id),
      candidateReferenceChecks: hydrated?.candidate_reference_checks ?? candidateReferenceChecks
    };
  }
  const scopeKey = JSON.stringify(listScope);
  const summaryRevision = useSyncExternalStore(subscribePipelineSummary, pipelineSummaryRevision, () => 0);
  const [summarySnapshot, setSummary] = useState<PipelineSummary | null>(null);
  const summaryKey = JSON.stringify([accessScope, scopeKey]);
  const [loadedSummaryKey, setLoadedSummaryKey] = useState("");
  const summary = loadedSummaryKey === summaryKey ? summarySnapshot : null;
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const rows = serverEnabled ? stageLists.flatMap(entry => entry.list.items) : initialRows;
  const boardRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterSearchRef = useRef<HTMLInputElement>(null);
  const activeFilterCount = Number(Boolean(pipelineSearch.trim())) + Number(boardFilter !== "all");
  const activeRowsBase = rows.filter((row) => row.latest_result !== 0 && !(row.latest_process === "Offer" && row.latest_result === 1));
  const activeRows = serverEnabled ? rows : filterBoardRows(filterPipelineRows(activeRowsBase, pipelineSearch), boardFilter);
  const failedGroups = serverEnabled ? failedGroupsFromPage(failedList.items) : failedCandidatesByStage(filterPipelineRows(initialRows, pipelineSearch), recruitmentLogs, embedded ? null : recentCutoffDate());
  const passedOfferRows = serverEnabled ? passedOfferList.items : passedOfferCandidates(filterPipelineRows(initialRows, pipelineSearch), embedded ? null : recentCutoffDate());
  const agingRows = activeRows.filter(isCandidateAging);
  const noActivityRows = activeRows.filter((row) => row.latest_process === "No activity");
  const displayStages: PipelineStageKey[] = ["No activity", ...ACTIVE_PIPELINE_STAGES];

  useEffect(() => { if (serverEnabled) { failedList.setSearch(pipelineSearch); passedOfferList.setSearch(pipelineSearch); } }, [pipelineSearch, serverEnabled]);
  useEffect(() => { setSummary(null); setSummaryError(false); }, [accessScope, scopeKey, serverEnabled]);
  useEffect(() => {
    if (!serverEnabled || !listClient) return;
    let cancelled = false; setSummaryLoading(true);
    loadPipelineSummary(listClient, accessScope, JSON.parse(scopeKey) as Record<string, unknown>, typeof listScope.groupId === "string" ? listScope.groupId : null, formatLocalDateInput(), 7)
      .then(value => { if (!cancelled) { setSummary(value); setLoadedSummaryKey(summaryKey); setSummaryError(false); } })
      .catch(() => { if (!cancelled) setSummaryError(true); }).finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [summaryKey, listScope.groupId, accessScope, listClient, scopeKey, serverEnabled, summaryRevision]);

  useEffect(() => {
    if (!openStageMenu && !openMobileStageMenu) return;

    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-stage-menu-root='true']")) return;
      setOpenStageMenu(null);
      setOpenMobileStageMenu(null);
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenStageMenu(null);
      setOpenMobileStageMenu(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMobileStageMenu, openStageMenu]);

  useEffect(() => {
    if (!filterOpen) return;
    filterSearchRef.current?.focus();

    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-filter-popover-root='true']")) return;
      setFilterOpen(false);
      window.setTimeout(() => filterTriggerRef.current?.focus(), 0);
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (openStageMenu) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      setFilterOpen(false);
      window.setTimeout(() => filterTriggerRef.current?.focus(), 0);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filterOpen, openStageMenu]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialSearch = embedded ? "" : params.get("pipelineSearch") ?? "";
    setPipelineSearch(initialSearch);
    setFilterOpen(Boolean(initialSearch));
    setFocusedCandidateId(params.get("detailId"));
    if (!embedded && params.get("pipelineView") === "table") setPipelineView("table");
  }, [embedded]);

  useEffect(() => {
    if (embedded) return;
    updateWorkspaceUrlState({ pipelineView: pipelineView === "table" ? "table" : null });
  }, [embedded, pipelineView]);

  useEffect(() => {
    if (!focusedCandidateId) return;
    const card = document.getElementById(`pipeline-candidate-${focusedCandidateId}`);
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    if (!document.querySelector('[role="dialog"]')) card.focus({ preventScroll: true });
  }, [activeRows, failedGroups, focusedCandidateId, passedOfferRows]);

  if (!embedded && pipelineView === "table") {
    return <PipelineTableView
      language={language}
      rows={rows}
      recruitmentLogs={recruitmentLogs}
      recruitmentLogHistory={recruitmentLogHistory}
      profile={profile}
      canWrite={canWrite}
      onNewCandidate={onNewCandidate}
      onOpen={onOpen}
      onCorrectPipelineRecord={onCorrectPipelineRecord}
      onViewChange={setPipelineView}
      listClient={listClient}
      accessScope={accessScope}
      listScope={listScope}
    />;
  }

  return (
    <div className="grid min-w-0 max-w-full gap-5 overflow-x-clip">
      <Panel variant={embedded ? "workspace" : "primary"} className={embedded ? "!rounded-none !border-0 !p-0 !shadow-none" : ""}>
        <SectionTitle
          title={translate(language, "candidatePipeline")}
          action={<div className="flex min-w-0 flex-wrap items-center justify-end gap-2"><PipelineViewSwitch language={language} value="board" onChange={setPipelineView} />{canWrite && onNewCandidate ? <Button type="button" size="sm" icon={<Plus size={17} />} onClick={onNewCandidate}>{translate(language, "newCandidate")}</Button> : null}</div>}
        />
        <div className="mb-3 grid gap-3">
          {serverEnabled && !summary && !summaryError ? <LoadingSkeleton variant="metrics" language={language} /> : <OperationalSummaryStrip
            className={embedded ? "hidden" : undefined}
            density="compact"
            items={[
              { label: translate(language, "activeCandidates"), value: serverEnabled ? summary?.active ?? "—" : activeRows.length, tone: "primary", helper: translate(language, "visibleOnBoard") },
              { label: translate(language, "aging"), value: serverEnabled ? summary?.aging ?? "—" : agingRows.length, tone: "danger", helper: translate(language, "daysSinceTouch") },
              { label: translate(language, embedded ? "failedAllTime" : "failed7d"), value: serverEnabled ? summary?.failed ?? "—" : failedGroups.reduce((sum, group) => sum + group.rows.length, 0), tone: "danger", helper: translate(language, embedded ? "allFailedOutcomes" : "recentFailedOutcomes") },
              { label: translate(language, embedded ? "offerPassAllTime" : "offerPass7d"), value: serverEnabled ? summary?.passed_offer ?? "—" : passedOfferRows.length, tone: "success", helper: translate(language, embedded ? "allCompletedOffers" : "recentlyCompleted") },
              { label: translate(language, "noActivity"), value: serverEnabled ? summary?.no_activity ?? "—" : noActivityRows.length, tone: "warning", helper: translate(language, "needsFirstUpdate") }
            ]}
          />}{summaryLoading && summary ? <RefreshIndicator language={language} /> : null}
          {serverEnabled && summaryError ? <div role="alert" className="rounded-lg border border-[#E9B9B4] bg-[#FFF8F7] px-3 py-2 text-sm text-scarlet">{translate(language, "loadError")} <RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Pipeline Board`} type="button" className="ml-2 font-semibold underline" onClick={() => { setSummaryError(false); setSummary(null); clearPipelineSummaryCache(); }}>{translate(language, "retry")}</RetryIconButton></div> : null}
          <div className={`relative flex flex-wrap items-center justify-between gap-2 ${embedded ? "hidden md:flex" : ""}`} data-filter-popover-root="true">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate">{translate(language, "groupCards")}</span>
              {pipelineGroupOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`min-h-8 rounded-lg px-3 text-xs font-semibold ring-1 ring-inset transition-colors ${groupBy === option.value ? "bg-primary text-white ring-primary" : "bg-white text-navy ring-[#C9D5E6] hover:bg-[#F8FAFD]"}`}
                  aria-pressed={groupBy === option.value}
                  onClick={() => setGroupBy(option.value)}
                >
                  {translate(language, option.labelKey)}
                </button>
              ))}
            </div>
            <div className="relative ml-auto">
              <button
                ref={filterTriggerRef}
                type="button"
                className={`ats-dropdown-trigger relative inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${activeFilterCount > 0 ? "text-primary" : "text-slate"}`}
                aria-label={activeFilterCount > 0 ? translate(language, "pipelineFiltersActive", { count: activeFilterCount }) : translate(language, "pipelineFilters")}
                aria-expanded={filterOpen}
                aria-controls="pipeline-filter-popover"
                title={translate(language, "pipelineFilters")}
                onClick={() => setFilterOpen((open) => !open)}
              >
                <Filter size={15} aria-hidden="true" />
                {activeFilterCount > 0 ? <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-navy px-1 text-[10px] font-bold leading-none text-white" aria-hidden="true">{activeFilterCount}</span> : null}
              </button>
              {filterOpen ? (
                <div id="pipeline-filter-popover" role="dialog" aria-label={translate(language, "pipelineFilters")} className="ats-dropdown-surface absolute right-0 top-10 z-30 grid max-h-[min(70dvh,28rem)] w-[min(22rem,calc(100vw-2rem))] gap-3 rounded-2xl border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <strong className="text-sm text-navy">{translate(language, "pipelineFilters")}</strong>
                    {activeFilterCount > 0 ? <button type="button" className="text-xs font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30" onClick={() => { setBoardFilter("all"); setPipelineSearch(""); }}>{translate(language, "clear")}</button> : null}
                  </div>
                  <div className="grid gap-2">
                    <span className="text-xs font-semibold text-slate">{translate(language, "boardFilter")}</span>
                    <div className="flex flex-wrap gap-2">
                      {boardFilterOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`min-h-8 rounded-lg px-3 text-xs font-semibold ring-1 ring-inset transition-colors ${boardFilter === option.value ? "bg-primary text-white ring-primary" : "bg-white text-navy ring-[#C9D5E6] hover:bg-[#F8FAFD]"}`}
                          aria-pressed={boardFilter === option.value}
                          onClick={() => setBoardFilter(option.value)}
                        >
                          {translate(language, option.labelKey)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="grid gap-1 text-xs font-semibold text-slate">
                    {translate(language, "searchPipeline")}
                    <input
                      ref={filterSearchRef}
                      type="search"
                      value={pipelineSearch}
                      onChange={(event) => setPipelineSearch(event.target.value)}
                      className="min-h-10 w-full rounded-xl border border-[#C9D5E6] bg-white px-3 text-sm font-medium text-navy outline-none transition-colors placeholder:text-cool focus:border-primary focus:ring-2 focus:ring-primary/20"
                      placeholder={translate(language, "pipelineSearchPlaceholder")}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          </div>
          <label className={`grid gap-1 md:hidden ${embedded ? "hidden" : ""}`}>
            <span className="text-xs font-semibold text-slate">{translate(language, "candidatePipeline")}</span>
            <SelectInput
              defaultValue=""
              aria-label={translate(language, "candidatePipeline")}
              onChange={(event) => {
                const stage = event.target.value;
                if (!stage) return;
                boardRef.current?.querySelector<HTMLElement>(`[data-pipeline-stage="${stage}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
                event.currentTarget.value = "";
              }}
            >
              <option value="">{translate(language, "candidatePipeline")}</option>
              {displayStages.map((stage) => <option key={stage} value={stage}>{processLabel(stage, language)}</option>)}
            </SelectInput>
          </label>
        </div>
        {embedded ? <MobileWorkspacePipelineStages language={language} rows={activeRows} stages={displayStages} stageLists={serverEnabled ? stageListByStage : undefined} canWrite={canWrite} onMove={onMove} onOpen={onOpen} onStartProcess={onStartProcess} renderCandidate={(candidate) => (
          <PipelineCandidateCard
            candidate={candidate}
            compact
            language={language}
            canWrite={canWrite}
            updateStages={nextStages(candidate.latest_process)}
            profile={profile}
            {...actionRows(candidate)}
            issueCount={dataQualityIssues.filter((issue) => issue.entityId === candidate.candidate_id).length}
            menuOpen={openMobileStageMenu === applicationKey(candidate)}
            onOpen={onOpen}
            onMove={onMove}
            onFailCurrentStage={onFailCurrentStage}
            onMaintainTest={onMaintainTest}
            onStartProcess={onStartProcess}
            onEditPending={onEditPending}
            onPassStage={onPassStage}
            onManageReferenceChecks={onManageReferenceChecks}
            onUpdateOffer={onUpdateOffer}
            onMenuToggle={() => { void openCandidateActionMenu(candidate, setOpenMobileStageMenu); }}
            onMenuClose={() => setOpenMobileStageMenu(null)}
          />
        )} /> : null}
        <div ref={boardRef} className={`flex gap-2 overflow-x-auto rounded-2xl border border-[#E4E9F2] bg-white p-2 md:gap-3 md:p-3 ${embedded ? "hidden md:flex" : ""}`} aria-label={translate(language, "candidatePipeline")}>
          {displayStages.map((stage) => {
            const stageList = stageListByStage.get(stage)!;
            const stageRows = serverEnabled ? stageList.items : sortByLastUpdateAsc(activeRows.filter((row) => row.latest_process === stage));
            const isBlocked = blockedStage === stage;
            const groupedRows = groupPipelineRows(stageRows, groupBy, language);

            return (
              <section
                key={stage}
                data-pipeline-stage={stage}
                className={`min-h-64 w-[calc(100vw-3.5rem)] shrink-0 rounded-xl border border-[#B8CCE4] bg-[#EAF3FF] p-2 shadow-none transition-colors md:min-h-80 md:w-[min(17rem,82vw)] md:rounded-2xl md:border-[rgb(var(--app-primary-rgb)/0.28)] md:p-2.5 ${
                  isBlocked ? "border-scarlet bg-[#FFF1F0]" : ""
                }`}
                onDragOver={(event) => {
                  if (!canWrite || !dragged) return;
                  const targetIndex = processIndex(stage);
                  const currentIndex = processIndex(dragged.latest_process);
                  const isRepeatableStageDrop = isRepeatableStage(stage) && dragged.latest_process === stage;
                  if (targetIndex > currentIndex || isRepeatableStageDrop) {
                    event.preventDefault();
                    setBlockedStage(null);
                  } else {
                    setBlockedStage(stage);
                  }
                }}
                onDragLeave={() => setBlockedStage(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  setBlockedStage(null);
                  if (!canWrite || !dragged) return;
                  if (stage === "No activity") return;
                  if (isRepeatableStage(stage) && dragged.latest_process === stage) {
                    onMaintainTest(dragged);
                  } else if (processIndex(stage) > processIndex(dragged.latest_process)) {
                    onMove(dragged, stage);
                  }
                  setDragged(null);
                }}
              >
                <div className="sticky top-0 z-10 -mx-1 mb-2 min-w-0 bg-[#EAF3FF] px-1 pb-2 md:mb-3 md:pb-1">
                  <h3 className={`break-words text-sm font-semibold ${processIndex(stage) === 1 ? "text-scarlet" : "text-navy"}`}>
                  {processLabel(stage, language)} <span aria-hidden="true" className="ml-1 rounded bg-white/70 px-1.5 py-0.5 text-xs tabular-nums">{serverEnabled ? stageList.countLabel : stageRows.length}</span>
                  </h3>
                  {serverEnabled && stageList.refreshing ? <RefreshIndicator language={language} /> : null}{serverEnabled && stageList.countError ? <RetryIconButton type="button"   onClick={stageList.retryCount} loading={stageList.countLoading}>{translate(language, "retry")}</RetryIconButton> : null}
                  {serverEnabled && stageList.error ? <RetryIconButton type="button"   onClick={stageList.retry} loading={stageList.loading}>{translate(language, "retry")}</RetryIconButton> : null}
                </div>
                {stageRows.length === 0 ? (
                  serverEnabled && stageList.initialLoading ? <LoadingSkeleton variant="cards" label={<>{translate(language, "loading")}</>} className="px-1 py-2 text-xs font-medium text-slate" />
                    : serverEnabled && stageList.error ? <p role="alert" className="px-1 py-2 text-xs font-medium text-scarlet">{translate(language, "loadError")}</p>
                    : <EmptyState variant="board" message={serverEnabled && (stageList.totalCount ?? 0) > 0 ? translate(language, "noRecordsOnCurrentPage") : translate(language, "noData")} />
                ) : (
                <div className="grid gap-2">
                  {groupedRows.map((group) => (
                    <div key={group.label} className="grid gap-2">
                      {group.label ? <p className="text-[11px] font-semibold text-slate">{group.label}</p> : null}
                      {group.rows.map((candidate) => {
                      const updateStages = nextStages(candidate.latest_process);
                      const issueCount = dataQualityIssues.filter((issue) => issue.entityId === candidate.candidate_id).length;
                      return (
                      <PipelineCandidateCard
                        key={applicationKey(candidate)}
                        candidate={candidate}
                        language={language}
                        canWrite={canWrite}
                        draggable={canWrite && candidatePipelineCapability(candidate, recruitmentLogs.filter((log) => belongsToApplication(log, candidate)), profile).canDrag}
                        updateStages={updateStages}
                        profile={profile}
                        {...actionRows(candidate)}
                        issueCount={issueCount}
                        focused={focusedCandidateId === candidate.candidate_id}
                        menuOpen={openStageMenu === applicationKey(candidate)}
                        onOpen={onOpen}
                        onMove={onMove}
                        onFailCurrentStage={onFailCurrentStage}
                        onMaintainTest={onMaintainTest}
                        onStartProcess={onStartProcess}
                        onEditPending={onEditPending}
                        onPassStage={onPassStage}
                        onManageReferenceChecks={onManageReferenceChecks}
                        onUpdateOffer={onUpdateOffer}
                        onMenuToggle={() => { void openCandidateActionMenu(candidate, setOpenStageMenu); }}
                        onMenuClose={() => setOpenStageMenu(null)}
                        onDragStart={() => setDragged(candidate)}
                        onDragEnd={() => {
                          setDragged(null);
                          setBlockedStage(null);
                        }}
                      />
                    );
                    })}
                    </div>
                  ))}
                </div>
                )}
                {serverEnabled ? <CursorPagination language={language} page={stageList.page} pageSize={stageList.pageSize} loading={stageList.loading} canPrevious={stageList.canPrevious} canNext={stageList.canNext} onPrevious={stageList.goPrevious} onNext={stageList.goNext} onPageSizeChange={stageList.setPageSize} /> : null}
              </section>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel variant="secondary">
          <SectionTitle title={translate(language, embedded ? "failedCandidatesAllTime" : "failedCandidatesLast7Days")} />
          {failedGroups.every((group) => group.rows.length === 0) ? (
            serverEnabled && failedList.initialLoading ? <LoadingSkeleton variant="cards" label={<>{translate(language, "loading")}</>} className="py-3 text-sm text-slate" /> : <EmptyState variant="quiet" message={translate(language, embedded ? "noFailedCandidatesAllTime" : "noFailedCandidatesLast7Days")} />
          ) : (
            <div className="grid grid-flow-col gap-3 overflow-x-auto pb-2" style={{ gridAutoColumns: "minmax(240px, 1fr)" }}>
              {failedGroups.map((group) => (
                <section key={group.stage} className="min-h-48 rounded-2xl border border-[#F4B4AE] bg-[#FFF8F7] p-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <strong className="text-sm text-scarlet">{processLabel(group.stage, language)}</strong>
                    <Tag tone="danger">{group.rows.length}</Tag>
                  </div>
                  <div className="grid gap-2">
                    {group.rows.map((candidate) => (
                      <PipelineCandidateCard
                        key={applicationKey(candidate)}
                        candidate={candidate}
                        language={language}
                        canWrite={false}
                        tone="failed"
                        focused={focusedCandidateId === candidate.candidate_id}
                        onOpen={onOpen}
                        onCreateRejectionLetter={canWrite ? onCreateRejectionLetter : undefined}
                        rejectionLetterSent={rejectionLetterSentCandidateIds?.has(applicationKey(candidate))}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          {serverEnabled ? <div className="mt-3 flex items-center justify-end gap-2"><span className="text-xs text-slate">{failedList.countLabel} · {translate(language, "pipelineRecords")}</span>{failedList.countError ? <RetryIconButton type="button"   onClick={failedList.retryCount} loading={failedList.countLoading}>{translate(language, "retry")}</RetryIconButton> : null}{failedList.error ? <RetryIconButton type="button"   onClick={failedList.retry} loading={failedList.loading}>{translate(language, "retry")}</RetryIconButton> : null}<CursorPagination language={language} page={failedList.page} pageSize={failedList.pageSize} loading={failedList.loading} canPrevious={failedList.canPrevious} canNext={failedList.canNext} onPrevious={failedList.goPrevious} onNext={failedList.goNext} onPageSizeChange={failedList.setPageSize} /></div> : null}
        </Panel>

        <Panel variant="secondary">
          <SectionTitle title={translate(language, embedded ? "passedOfferAllTime" : "passedOfferLast7Days")} />
          {passedOfferRows.length === 0 ? (
            serverEnabled && passedOfferList.initialLoading ? <LoadingSkeleton variant="cards" label={<>{translate(language, "loading")}</>} className="py-3 text-sm text-slate" /> : <EmptyState variant="quiet" message={translate(language, embedded ? "noOfferPassAllTime" : "noOfferPassLast7Days")} />
          ) : (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {passedOfferRows.map((candidate) => (
                <PipelineCandidateCard
                  key={applicationKey(candidate)}
                  candidate={candidate}
                  language={language}
                  canWrite={false}
                  tone="passed"
                  showCreateOffer={canWrite && !offeredCandidateIds?.has(applicationKey(candidate))}
                  focused={focusedCandidateId === candidate.candidate_id}
                  onOpen={onOpen}
                  onCreateOffer={onCreateOffer}
                />
              ))}
            </div>
          )}
          {serverEnabled ? <div className="mt-3 flex items-center justify-end gap-2"><span className="text-xs text-slate">{passedOfferList.countLabel} · {translate(language, "pipelineRecords")}</span>{passedOfferList.countError ? <RetryIconButton type="button"   onClick={passedOfferList.retryCount} loading={passedOfferList.countLoading}>{translate(language, "retry")}</RetryIconButton> : null}{passedOfferList.error ? <RetryIconButton type="button"   onClick={passedOfferList.retry} loading={passedOfferList.loading}>{translate(language, "retry")}</RetryIconButton> : null}<CursorPagination language={language} page={passedOfferList.page} pageSize={passedOfferList.pageSize} loading={passedOfferList.loading} canPrevious={passedOfferList.canPrevious} canNext={passedOfferList.canNext} onPrevious={passedOfferList.goPrevious} onNext={passedOfferList.goNext} onPageSizeChange={passedOfferList.setPageSize} /></div> : null}
        </Panel>
      </div>
    </div>
  );
}

function PipelineViewSwitch({ language, value, onChange }: { language: Language; value: PipelineView; onChange: (view: PipelineView) => void }) {
  return <div className="inline-flex rounded-lg bg-lightgray p-1" aria-label={translate(language, "pipelineView")}>
    {(["board", "table"] as const).map((view) => <button key={view} type="button" aria-pressed={value === view} onClick={() => onChange(view)} className={`min-h-8 rounded-md px-3 text-xs font-semibold transition-colors ${value === view ? "bg-white text-navy shadow-sm" : "text-slate hover:text-navy"}`}>{translate(language, view === "board" ? "boardView" : "tableView")}</button>)}
  </div>;
}

type PipelineRecordRow = { candidate: EnrichedCandidate; log: RecruitmentLog; audit: boolean };

function PipelineTableView({ language, rows, recruitmentLogs, recruitmentLogHistory, profile, canWrite, onNewCandidate, onOpen, onCorrectPipelineRecord, onViewChange, listClient, accessScope, listScope }: {
  language: Language; rows: EnrichedCandidate[]; recruitmentLogs: RecruitmentLog[]; recruitmentLogHistory: RecruitmentLog[]; profile: Profile | null; canWrite: boolean; onNewCandidate?: () => void; onOpen: (candidateId: string, applicationId?: string) => void; onCorrectPipelineRecord?: (candidate: EnrichedCandidate, log: RecruitmentLog) => void; onViewChange: (view: PipelineView) => void; listClient: SupabaseClient | null; accessScope: string; listScope: Record<string, unknown>;
}) {
  const initial = useMemo(() => ({ ...readTableUrlState("pipe"), sortKey: readTableUrlState("pipe").sortKey ?? "date", sortDirection: readTableUrlState("pipe").sortDirection ?? "desc" }), []);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState<number>((PAGE_SIZE_OPTIONS as readonly number[]).includes(initial.pageSize) ? initial.pageSize : 25);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(Object.keys(initial.filters ?? {}).length > 0);
  const [showAudit, setShowAudit] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("pipeAudit") === "1");
  const candidateById = useMemo(() => new Map(rows.map((candidate) => [applicationKey(candidate), candidate])), [rows]);
  const recordRows = useMemo(() => recruitmentLogHistory.flatMap((log) => {
    const candidate = candidateById.get(log.application_id ?? log.candidate_id);
    if (!candidate || (!showAudit && Boolean(log.superseded_at))) return [];
    return [{ candidate, log, audit: Boolean(log.superseded_at) }];
  }), [candidateById, recruitmentLogHistory, showAudit]);
  const columns: TableColumn<PipelineRecordRow>[] = [
    { key: "candidate", label: translate(language, "candidate"), value: ({ candidate }) => `${candidate.candidate_id} ${formatCandidateName(candidate)}` },
    { key: "requisition", label: translate(language, "group"), value: ({ candidate }) => `${candidate.group_position ?? "-"} ${candidate.doc_ids.join(" ")}` },
    { key: "site", label: translate(language, "site"), value: ({ candidate }) => candidate.site ?? "-" },
    { key: "owner", label: translate(language, "owner"), value: ({ candidate }) => candidate.person_in_charge ?? "-" },
    { key: "stage", label: translate(language, "process"), value: ({ log }) => `${processLabel(log.recruitment_process, language)} ${log.round}` },
    { key: "pending", label: translate(language, "pendingDetails"), value: ({ log }) => `${log.log_date} ${log.estimated_action_date ?? ""} ${log.interviewer ?? ""} ${log.remark ?? ""}` },
    { key: "outcome", label: translate(language, "outcome"), value: ({ log }) => `${resultText(log.result, language)} ${log.outcome_date ?? ""} ${log.outcome_interviewer ?? ""} ${log.result === 0 ? failureReasonText(log, language) : ""} ${log.outcome_remark ?? ""}` },
    { key: "date", label: translate(language, "lastTouch"), value: ({ log }) => formatDate(log.outcome_date ?? log.log_date, language), sortValue: ({ log }) => log.outcome_date ?? log.log_date }
  ];
  const table = useTableControls(recordRows, columns, initial);
  const paginated = paginateRows(table.controlledRows, page, pageSize);
  const serverEnabled = Boolean(listClient && accessScope);
  const historyList = useRecruitmentList<PipelineRecordRow>({ client: listClient, accessScope, entity: "pipeline_history", filters: { ...listScope, ...table.filters, showAudit }, sort: table.sortKey === "date" ? "log_date" : table.sortKey ?? "log_date", direction: table.sortDirection ?? "desc", enabled: serverEnabled });
  useEffect(() => { if (serverEnabled) historyList.setSearch(table.search); }, [serverEnabled, table.search]);
  const visibleRows = serverEnabled ? historyList.items : paginated.rows;
  const adminCanCorrect = profile?.role === "system_admin" || profile?.role === "admin_recruiter";
  useEffect(() => { setPage(1); }, [showAudit, table.controlledRows.length, table.search, table.sortDirection, table.sortKey]);
  useEffect(() => { updateWorkspaceUrlState({ ...writeTableUrlValues("pipe", { filters: table.filters, page: paginated.page, pageSize, search: table.search, sortDirection: table.sortDirection, sortKey: table.sortKey }), pipeAudit: showAudit ? "1" : null }); }, [pageSize, paginated.page, showAudit, table.filters, table.search, table.sortDirection, table.sortKey]);
  const clear = () => { columns.forEach((column) => table.setFilter(column.key, "")); table.setSearch(""); setShowAudit(false); };
  return <Panel variant="primary">
    <SectionTitle title={translate(language, "candidatePipeline")} action={<div className="flex min-w-0 flex-wrap items-center justify-end gap-2"><PipelineViewSwitch language={language} value="table" onChange={onViewChange} />{canWrite && onNewCandidate ? <Button type="button" size="sm" icon={<Plus size={17} />} onClick={onNewCandidate}>{translate(language, "newCandidate")}</Button> : null}</div>} />
    <TableToolbar advancedFiltersOpen={advancedFiltersOpen} language={language} onAdvancedFiltersToggle={() => setAdvancedFiltersOpen((open) => !open)} onSearch={table.setSearch} resultCount={table.controlledRows.length} searchValue={table.search} totalCount={recordRows.length} />
    {advancedFiltersOpen ? <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-[#E4E9F2] bg-[#F8FAFD] p-3"><label className="flex items-center gap-2 text-sm font-semibold text-navy"><input type="checkbox" checked={showAudit} onChange={(event) => setShowAudit(event.target.checked)} />{translate(language, "showAuditHistory")}</label><Button type="button" variant="secondary" size="sm" onClick={clear}>{translate(language, "clear")}</Button></div> : null}
    {serverEnabled && historyList.error ? <div role="alert" className="rounded-lg border border-[#E9B9B4] bg-[#FFF8F7] px-3 py-2 text-sm text-scarlet">{translate(language, "loadError")} <RetryIconButton type="button"   onClick={historyList.retry} loading={historyList.loading}>{translate(language, "retry")}</RetryIconButton></div> : null}
    {serverEnabled && historyList.initialLoading ? <LoadingSkeleton variant="cards" label={<>{translate(language, "loading")}</>} className="px-3 py-2 text-sm text-slate" /> : null}
    <div className="grid gap-2 md:hidden">{visibleRows.map(({ candidate, log, audit }) => <article key={log.log_id} className="ats-card p-3"><button type="button" onClick={() => onOpen(candidate.candidate_id, candidate.application_id)} className="text-left"><strong className="block text-navy">{formatCandidateName(candidate)}</strong><span className="text-xs text-slate">{processLabel(log.recruitment_process, language)} · {translate(language, "round")} {log.round}</span></button><p className="mt-2 text-xs text-slate">{translate(language, "pendingDetails")}: {formatDate(log.log_date, language)} · {log.interviewer ?? "-"}</p>{log.estimated_action_date ? <p className="text-xs font-medium text-slate">{translate(language, "estimatedDateValue", { date: formatDate(log.estimated_action_date, language) })}</p> : null}{log.result !== null ? <p className="text-xs text-slate">{translate(language, "outcome")}: {resultText(log.result, language)} · {formatDate(log.outcome_date, language)}</p> : null}<RecordTableActions candidate={candidate} log={log} audit={audit} language={language} canCorrect={adminCanCorrect} onOpen={onOpen} onCorrect={onCorrectPipelineRecord} /></article>)}</div>
    <div className="table-scroll hidden md:block"><table className="w-full border-collapse text-left text-sm"><thead className="bg-lightgray text-xs uppercase text-slate"><tr>{columns.map((column) => <th key={column.key} scope="col" className="px-3 py-3 align-top"><SortableFilterHeader columnKey={column.key} filterValue={table.filters[column.key] ?? ""} language={language} label={column.label} onFilter={table.setFilter} onSort={table.toggleSort} sortDirection={table.sortDirection} sortKey={table.sortKey} showFilter={advancedFiltersOpen} /></th>)}<th className="px-3 py-3"><span className="sr-only">{translate(language, "actions")}</span></th></tr></thead><tbody>{visibleRows.map(({ candidate, log, audit }) => <tr key={log.log_id} className="border-b border-[#D7DEE8] last:border-0"><td className="px-3 py-3"><button type="button" onClick={() => onOpen(candidate.candidate_id, candidate.application_id)} className="text-left font-semibold text-navy hover:text-primary">{formatRecruitmentId(candidate.candidate_id)}<span className="block text-xs font-medium text-slate">{formatCandidateName(candidate)}</span></button></td><td className="px-3 py-3 text-slate">{candidate.group_position ?? "-"}<span className="block text-xs">{candidate.doc_ids.join(", ") || "-"}</span></td><td className="px-3 py-3 text-slate">{candidate.site ?? "-"}</td><td className="px-3 py-3 text-slate">{candidate.person_in_charge ?? "-"}</td><td className="px-3 py-3"><Tag tone={audit ? "muted" : "teal"}>{processLabel(log.recruitment_process, language)} · {log.round}</Tag></td><td className="px-3 py-3 text-slate">{formatDate(log.log_date, language)}{log.estimated_action_date ? <span className="block text-xs font-semibold text-primary">{translate(language, "estimatedDateValue", { date: formatDate(log.estimated_action_date, language) })}</span> : null}<span className="block text-xs">{log.interviewer ?? "-"}</span><span className="block text-xs">{log.remark ?? ""}</span></td><td className="px-3 py-3 text-slate">{log.result === null ? <Tag tone="warning">{resultText(null, language)}</Tag> : <><Tag tone={statusTone(log.result)}>{resultText(log.result, language)}</Tag><span className="block text-xs">{formatDate(log.outcome_date, language)} · {log.outcome_interviewer ?? "-"}</span><span className="block text-xs">{log.result === 0 ? failureReasonText(log, language) : ""}</span><span className="block text-xs">{log.outcome_remark ?? ""}</span></>}</td><td className="px-3 py-3 text-slate">{formatDate(log.updated_at ?? log.created_at, language)}</td><td className="px-3 py-3"><RecordTableActions candidate={candidate} log={log} audit={audit} language={language} canCorrect={adminCanCorrect} onOpen={onOpen} onCorrect={onCorrectPipelineRecord} /></td></tr>)}</tbody></table></div>
    {visibleRows.length === 0 && !historyList.loading ? <EmptyState message={translate(language, "noData")} /> : null}
    {serverEnabled ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E4E9F2] pt-3"><span className="text-xs font-medium text-slate">{historyList.totalCount} · {translate(language, "pipelineRecords")}</span><div className="flex items-center gap-2"><SelectInput aria-label={translate(language, "rowsPerPage")} value={historyList.pageSize} onChange={event => historyList.setPageSize(Number(event.target.value))}>{PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size}</option>)}</SelectInput><Button type="button" size="sm" variant="secondary" disabled={!historyList.canPrevious} onClick={historyList.goPrevious}>{translate(language, "previous")}</Button><span className="min-w-12 text-center text-xs tabular-nums text-slate">{historyList.page}</span><Button type="button" size="sm" variant="secondary" disabled={!historyList.canNext} onClick={historyList.goNext}>{translate(language, "next")}</Button></div></div> : <Pagination language={language} page={paginated.page} pageSize={pageSize} totalRows={table.controlledRows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />}
  </Panel>;
}

function RecordTableActions({ candidate, log, audit, language, canCorrect, onOpen, onCorrect }: { candidate: EnrichedCandidate; log: RecruitmentLog; audit: boolean; language: Language; canCorrect: boolean; onOpen: (id: string, applicationId?: string) => void; onCorrect?: (candidate: EnrichedCandidate, log: RecruitmentLog) => void }) {
  return <div className="flex items-center justify-end gap-1"><Button type="button" variant="ghost" size="icon-sm" icon={<Search size={15} />} aria-label={translate(language, "viewCandidateDetailFor", { name: formatCandidateName(candidate) })} title={translate(language, "viewDetail")} onClick={() => onOpen(candidate.candidate_id, candidate.application_id)} />{canCorrect && !audit && onCorrect ? <Button type="button" variant="ghost" size="icon-sm" icon={<Pencil size={15} />} aria-label={translate(language, "editPipelineRecord")} title={translate(language, "editPipelineRecord")} onClick={() => onCorrect(candidate, log)} /> : null}</div>;
}

function LegacyPipelineTableView({
  language, rows, recruitmentLogs, candidateReferences, candidateReferenceChecks, profile, canWrite, onNewCandidate, onOpen, onStartProcess, onEditPending, onPassStage, onFailCurrentStage, onMaintainTest, onUpdateOffer, onEditCandidate, onViewChange
}: {
  language: Language; rows: EnrichedCandidate[]; recruitmentLogs: RecruitmentLog[]; candidateReferences: CandidateReference[]; candidateReferenceChecks: CandidateReferenceCheck[]; profile: Profile | null; canWrite: boolean; onNewCandidate?: () => void; onOpen: (candidateId: string, applicationId?: string) => void; onStartProcess: (candidate: EnrichedCandidate) => void; onEditPending?: (candidate: EnrichedCandidate) => void; onPassStage?: (candidate: EnrichedCandidate) => void; onFailCurrentStage: (candidate: EnrichedCandidate) => void; onMaintainTest: (candidate: EnrichedCandidate) => void; onUpdateOffer: (candidate: EnrichedCandidate) => void; onEditCandidate?: (candidateId: string) => void; onViewChange: (view: PipelineView) => void;
}) {
  const initial = useMemo(() => ({ ...readTableUrlState("pipe"), sortKey: readTableUrlState("pipe").sortKey ?? "last_touch", sortDirection: readTableUrlState("pipe").sortDirection ?? "desc" }), []);
  const initialAdvanced = useMemo(() => {
    if (typeof window === "undefined") return { state: "", from: "", to: "" };
    const params = new URLSearchParams(window.location.search);
    return { state: params.get("pipeState") ?? "", from: params.get("pipeFrom") ?? "", to: params.get("pipeTo") ?? "" };
  }, []);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState<number>((PAGE_SIZE_OPTIONS as readonly number[]).includes(initial.pageSize) ? initial.pageSize : 25);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(Object.keys(initial.filters ?? {}).length > 0);
  const [stateFilter, setStateFilter] = useState(initialAdvanced.state);
  const [fromDate, setFromDate] = useState(initialAdvanced.from);
  const [toDate, setToDate] = useState(initialAdvanced.to);
  const columns: TableColumn<EnrichedCandidate>[] = [
    { key: "candidate", label: translate(language, "candidate"), value: (row) => `${row.candidate_id} ${formatCandidateName(row)}` },
    { key: "requisition", label: translate(language, "group"), value: (row) => `${row.group_position ?? "-"} ${row.doc_ids.join(" ")}` },
    { key: "site", label: translate(language, "site"), value: (row) => row.site ?? "-" },
    { key: "owner", label: translate(language, "owner"), value: (row) => row.person_in_charge ?? "-" },
    { key: "stage", label: translate(language, "currentStage"), value: (row) => processLabel(row.latest_process, language) },
    { key: "state", label: translate(language, "pipelineState"), value: (row) => pipelineStateLabel(row, language) },
    { key: "interviewer", label: translate(language, "interviewer"), value: (row) => pendingInterviewer(row, recruitmentLogs) ?? "-" },
    { key: "last_touch", label: translate(language, "lastTouch"), value: (row) => formatDate(candidateLastUpdate(row), language), sortValue: (row) => candidateLastUpdate(row) },
    { key: "age", label: translate(language, "age"), value: (row) => ageLabel(row), sortValue: (row) => candidateTouchAgeDays(row) ?? Number.POSITIVE_INFINITY }
  ];
  const datedRows = useMemo(() => rows.filter((row) => {
    const lastTouch = candidateLastUpdate(row).slice(0, 10);
    return (!fromDate || lastTouch >= fromDate) && (!toDate || lastTouch <= toDate) && (!stateFilter || pipelineStateKey(row) === stateFilter);
  }), [fromDate, rows, stateFilter, toDate]);
  const table = useTableControls(datedRows, columns, initial);
  const paginated = paginateRows(table.controlledRows, page, pageSize);
  const activeFilterCount = Object.values(table.filters).filter(Boolean).length + Number(Boolean(stateFilter)) + Number(Boolean(fromDate)) + Number(Boolean(toDate));

  useEffect(() => { setPage(1); }, [fromDate, pageSize, rows.length, stateFilter, table.controlledRows.length, table.filters, table.search, table.sortDirection, table.sortKey, toDate]);
  useEffect(() => {
    updateWorkspaceUrlState({ ...writeTableUrlValues("pipe", { filters: table.filters, page: paginated.page, pageSize, search: table.search, sortDirection: table.sortDirection, sortKey: table.sortKey }), pipeState: stateFilter, pipeFrom: fromDate, pipeTo: toDate });
  }, [fromDate, pageSize, paginated.page, stateFilter, table.filters, table.search, table.sortDirection, table.sortKey, toDate]);

  const clearFilters = () => { columns.forEach((column) => table.setFilter(column.key, "")); table.setSearch(""); setStateFilter(""); setFromDate(""); setToDate(""); };
  return <Panel variant="primary">
    <SectionTitle title={translate(language, "candidatePipeline")} action={<div className="flex min-w-0 flex-wrap items-center justify-end gap-2"><PipelineViewSwitch language={language} value="table" onChange={onViewChange} />{canWrite && onNewCandidate ? <Button type="button" size="sm" icon={<Plus size={17} />} onClick={onNewCandidate}>{translate(language, "newCandidate")}</Button> : null}</div>} />
    <TableToolbar advancedFiltersOpen={advancedFiltersOpen} language={language} onAdvancedFiltersToggle={() => setAdvancedFiltersOpen((open) => !open)} onSearch={table.setSearch} resultCount={table.controlledRows.length} searchValue={table.search} totalCount={rows.length} />
    {advancedFiltersOpen ? <div className="mb-3 grid gap-2 rounded-xl border border-[#E4E9F2] bg-[#F8FAFD] p-3 md:grid-cols-4">
      <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate"><span>{translate(language, "pipelineState")}</span><SelectInput value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="">{translate(language, "candidateTriageAll")}</option>{pipelineTableStates.map((state) => <option key={state} value={state}>{translate(language, `pipelineState${state}`)}</option>)}</SelectInput></label>
      <label className="grid gap-1 text-xs font-semibold text-slate"><span>{translate(language, "lastTouchFrom")}</span><DayDateSelector ariaLabel={translate(language, "lastTouchFrom")} language={language} name="last_touch_from" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
      <label className="grid gap-1 text-xs font-semibold text-slate"><span>{translate(language, "lastTouchTo")}</span><DayDateSelector ariaLabel={translate(language, "lastTouchTo")} language={language} name="last_touch_to" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
      <div className="flex items-end"><Button type="button" variant="secondary" size="sm" disabled={activeFilterCount === 0 && !table.search} onClick={clearFilters}>{translate(language, "clear")}</Button></div>
    </div> : null}
    <div className="grid gap-2 md:hidden">{paginated.rows.map((row) => <PipelineTableCard key={applicationKey(row)} candidate={row} language={language} recruitmentLogs={recruitmentLogs} candidateReferences={candidateReferences} candidateReferenceChecks={candidateReferenceChecks} profile={profile} canWrite={canWrite} onOpen={onOpen} onStartProcess={onStartProcess} onEditPending={onEditPending} onPassStage={onPassStage} onFailCurrentStage={onFailCurrentStage} onMaintainTest={onMaintainTest} onUpdateOffer={onUpdateOffer} onEditCandidate={onEditCandidate} />)}</div>
    <div className="table-scroll hidden md:block"><table className="w-full border-collapse text-left text-sm"><thead className="bg-lightgray text-xs uppercase text-slate"><tr>{columns.map((column) => <th key={column.key} scope="col" className="px-3 py-3 align-top"><SortableFilterHeader columnKey={column.key} filterValue={table.filters[column.key] ?? ""} language={language} label={column.label} onFilter={table.setFilter} onSort={table.toggleSort} sortDirection={table.sortDirection} sortKey={table.sortKey} showFilter={advancedFiltersOpen} /></th>)}<th className="px-3 py-3"><span className="sr-only">{translate(language, "actions")}</span></th></tr></thead><tbody>{paginated.rows.map((row) => <tr key={applicationKey(row)} className="border-b border-[#D7DEE8] last:border-0"><td className="px-3 py-3"><button type="button" onClick={() => onOpen(row.candidate_id, row.application_id)} className="text-left font-semibold text-navy hover:text-primary">{formatRecruitmentId(row.candidate_id)}<span className="block text-xs font-medium text-slate">{formatCandidateName(row)}</span></button></td><td className="px-3 py-3 text-slate">{row.group_position ?? "-"}<span className="block text-xs">{row.doc_ids.join(", ") || "-"}</span></td><td className="px-3 py-3 text-slate">{row.site ?? "-"}</td><td className="px-3 py-3 text-slate">{row.person_in_charge ?? "-"}</td><td className="px-3 py-3"><Tag tone="teal">{processLabel(row.latest_process, language)}</Tag></td><td className="px-3 py-3"><Tag tone={pipelineStateTone(row)}>{pipelineStateLabel(row, language)}</Tag></td><td className="px-3 py-3 text-slate">{pendingInterviewer(row, recruitmentLogs) ?? "-"}</td><td className="px-3 py-3 text-slate">{formatDate(candidateLastUpdate(row), language)}</td><td className="px-3 py-3 text-slate">{ageLabel(row)}</td><td className="px-3 py-3"><PipelineTableActions candidate={row} language={language} recruitmentLogs={recruitmentLogs} candidateReferences={candidateReferences} candidateReferenceChecks={candidateReferenceChecks} profile={profile} canWrite={canWrite} onOpen={onOpen} onStartProcess={onStartProcess} onEditPending={onEditPending} onPassStage={onPassStage} onFailCurrentStage={onFailCurrentStage} onMaintainTest={onMaintainTest} onUpdateOffer={onUpdateOffer} onEditCandidate={onEditCandidate} /></td></tr>)}</tbody></table></div>
    {paginated.rows.length === 0 ? <EmptyState message={translate(language, "noData")} /> : null}
    <Pagination language={language} page={paginated.page} pageSize={pageSize} totalRows={table.controlledRows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
  </Panel>;
}

function PipelineTableCard(props: PipelineTableActionProps) {
  const { candidate, language, recruitmentLogs, onOpen } = props;
  return <article className="ats-card p-3"><button type="button" onClick={() => onOpen(candidate.candidate_id, candidate.application_id)} className="text-left"><strong className="block text-navy">{formatCandidateName(candidate)}</strong><span className="text-xs text-slate">{formatRecruitmentId(candidate.candidate_id)} · {candidate.site ?? "-"} · {candidate.person_in_charge ?? "-"}</span></button><div className="mt-2 flex flex-wrap gap-2"><Tag tone="teal">{processLabel(candidate.latest_process, language)}</Tag><Tag tone={pipelineStateTone(candidate)}>{pipelineStateLabel(candidate, language)}</Tag><span className="text-xs text-slate">{translate(language, "lastTouch")}: {formatDate(candidateLastUpdate(candidate), language)}</span></div><div className="mt-3"><PipelineTableActions {...props} /></div></article>;
}

type PipelineTableActionProps = { candidate: EnrichedCandidate; language: Language; recruitmentLogs: RecruitmentLog[]; candidateReferences: CandidateReference[]; candidateReferenceChecks: CandidateReferenceCheck[]; profile: Profile | null; canWrite: boolean; onOpen: (candidateId: string, applicationId?: string) => void; onStartProcess: (candidate: EnrichedCandidate) => void; onEditPending?: (candidate: EnrichedCandidate) => void; onPassStage?: (candidate: EnrichedCandidate) => void; onFailCurrentStage: (candidate: EnrichedCandidate) => void; onMaintainTest: (candidate: EnrichedCandidate) => void; onUpdateOffer: (candidate: EnrichedCandidate) => void; onEditCandidate?: (candidateId: string) => void; };

function PipelineTableActions({ candidate, language, profile, onOpen, onEditCandidate }: PipelineTableActionProps) {
  const canEditRecord = profile?.role === "system_admin" || profile?.role === "admin_recruiter";
  return <div className="flex items-center justify-end gap-1"><Button type="button" variant="ghost" size="icon-sm" icon={<Search size={15} />} aria-label={translate(language, "viewCandidateDetailFor", { name: formatCandidateName(candidate) })} title={translate(language, "viewDetail")} onClick={() => onOpen(candidate.candidate_id, candidate.application_id)} />{canEditRecord && onEditCandidate ? <Button type="button" variant="ghost" size="icon-sm" icon={<Pencil size={15} />} aria-label={translate(language, "changeRecord")} title={translate(language, "changeRecord")} onClick={() => onEditCandidate(candidate.candidate_id)} /> : null}</div>;
}

const pipelineTableStates = ["awaiting", "passed", "failed", "no_activity", "offer_complete"] as const;
function pipelineStateKey(row: EnrichedCandidate) { if (row.latest_process === "No activity") return "no_activity"; if (row.latest_process === "Offer" && row.latest_result === 1) return "offer_complete"; if (row.latest_result === 0) return "failed"; if (row.latest_result === 1) return "passed"; return "awaiting"; }
function pipelineStateLabel(row: EnrichedCandidate, language: Language) { return translate(language, `pipelineState${pipelineStateKey(row)}`); }
function pipelineStateTone(row: EnrichedCandidate) { const state = pipelineStateKey(row); return state === "failed" ? "danger" : state === "awaiting" || state === "no_activity" ? "warning" : state === "offer_complete" ? "success" : "teal"; }
function pendingInterviewer(row: EnrichedCandidate, logs: RecruitmentLog[]) { return logs.filter((log) => belongsToApplication(log, row) && log.superseded_at === null && log.result === null).sort((a, b) => compareApplicationLogs(b, a))[0]?.interviewer ?? null; }
function ageLabel(row: EnrichedCandidate) { const age = candidateTouchAgeDays(row); return age === null ? "-" : `${age}d`; }

function failedCandidatesByStage(rows: EnrichedCandidate[], recruitmentLogs: RecruitmentLog[], cutoff: string | null) {
  const groups = new Map<ProcessStage, EnrichedCandidate[]>(ACTIVE_PIPELINE_STAGES.map((stage) => [stage, []]));

  for (const row of rows) {
    if (row.latest_result !== 0 || row.latest_process === "No activity") continue;
    const failureDate = recruitmentLogs
      .filter((log) => belongsToApplication(log, row) && log.superseded_at === null && log.result === 0)
      .sort((a, b) => compareApplicationLogs(b, a))[0]?.outcome_date;
    if (cutoff && (!failureDate || failureDate < cutoff)) continue;
    groups.set(row.latest_process, [...(groups.get(row.latest_process) ?? []), row]);
  }

  return ACTIVE_PIPELINE_STAGES.map((stage) => ({
    stage,
    rows: sortByLastUpdateAsc(groups.get(stage) ?? [])
  }));
}

function failedGroupsFromPage(rows: EnrichedCandidate[]) {
  return ACTIVE_PIPELINE_STAGES.map(stage => ({ stage, rows: rows.filter(row => row.latest_process === stage) }));
}

function passedOfferCandidates(rows: EnrichedCandidate[], cutoff: string | null) {

  return sortByLastUpdateDesc(rows
    .filter((row) => {
      if (row.latest_process !== "Offer" || row.latest_result !== 1) return false;
      return !cutoff || Boolean(row.latest_log_date && row.latest_log_date >= cutoff);
    }));
}

function recentCutoffDate() {
  const [year, month, day] = formatLocalDateInput().split("-").map(Number);
  const cutoff = new Date(Date.UTC(year, month - 1, day));
  cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  return [
    cutoff.getUTCFullYear(),
    String(cutoff.getUTCMonth() + 1).padStart(2, "0"),
    String(cutoff.getUTCDate()).padStart(2, "0")
  ].join("-");
}

function MobileWorkspacePipelineStages({
  language,
  rows,
  stages,
  stageLists,
  canWrite,
  onMove,
  onOpen,
  onStartProcess,
  renderCandidate
}: {
  language: Language;
  rows: EnrichedCandidate[];
  stages: PipelineStageKey[];
  stageLists?: ReadonlyMap<PipelineStageKey, ReturnType<typeof useRecruitmentList<EnrichedCandidate>>>;
  canWrite: boolean;
  onMove: (candidate: EnrichedCandidate, nextStage: ProcessStage) => void;
  onOpen: (candidateId: string, applicationId?: string) => void;
  onStartProcess: (candidate: EnrichedCandidate) => void;
  renderCandidate?: (candidate: EnrichedCandidate) => JSX.Element;
}) {
  if (renderCandidate) {
    return (
      <div data-workspace-pipeline-stages className="grid gap-2 md:hidden" aria-label={translate(language, "candidatePipeline")}>
        {stages.map((stage) => {
          const stageList = stageLists?.get(stage);
          const stageRows = stageList?.items ?? sortByLastUpdateAsc(rows.filter((row) => row.latest_process === stage));
          return <details key={stage} className="group rounded-lg border border-[#E4E9F2] bg-white">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-details-marker]:hidden"><span className="min-w-0 truncate">{processLabel(stage, language)}</span><span className="inline-flex min-w-7 items-center justify-center rounded-md bg-[#F1F6FC] px-2 py-1 text-xs tabular-nums text-navy">{stageList?.countLabel ?? stageRows.length}</span></summary>
            <div className="grid gap-1 border-t border-[#E4E9F2] p-2">{stageList?.countError ? <RetryIconButton type="button"   onClick={stageList.retryCount} loading={stageList.countLoading}>{translate(language, "retry")}</RetryIconButton> : null}{stageList?.error ? <RetryIconButton type="button"   onClick={stageList.retry} loading={stageList.loading}>{translate(language, "retry")}</RetryIconButton> : null}{stageRows.length === 0 ? stageList?.loading ? <LoadingSkeleton variant="cards" label={<>{translate(language, "loading")}</>} className="px-1 py-2 text-xs font-medium text-slate" /> : stageList?.error ? <p role="alert" className="px-1 py-2 text-xs font-medium text-scarlet">{translate(language, "loadError")}</p> : <p className="px-1 py-2 text-xs font-medium text-slate">{translate(language, "noData")}</p> : stageRows.map(renderCandidate)}{stageList ? <CursorPagination language={language} page={stageList.page} pageSize={stageList.pageSize} loading={stageList.loading} canPrevious={stageList.canPrevious} canNext={stageList.canNext} onPrevious={stageList.goPrevious} onNext={stageList.goNext} onPageSizeChange={stageList.setPageSize} /> : null}</div>
          </details>;
        })}
      </div>
    );
  }
  return (
    <div data-workspace-pipeline-stages className="grid gap-2 md:hidden" aria-label={translate(language, "candidatePipeline")}>
      {stages.map((stage) => {
        const stageList = stageLists?.get(stage);
        const stageRows = stageList?.items ?? sortByLastUpdateAsc(rows.filter((row) => row.latest_process === stage));
        return (
          <details key={stage} className="group rounded-lg border border-[#E4E9F2] bg-white">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 truncate">{processLabel(stage, language)}</span>
              <span className="inline-flex min-w-7 items-center justify-center rounded-md bg-[#F1F6FC] px-2 py-1 text-xs tabular-nums text-navy">{stageList?.countLabel ?? stageRows.length}</span>
            </summary>
            <div className="grid gap-1 border-t border-[#E4E9F2] p-2">
              {stageList?.countError ? <RetryIconButton type="button"   onClick={stageList.retryCount} loading={stageList.countLoading}>{translate(language, "retry")}</RetryIconButton> : null}{stageList?.error ? <RetryIconButton type="button"   onClick={stageList.retry} loading={stageList.loading}>{translate(language, "retry")}</RetryIconButton> : null}
              {stageRows.length === 0 ? stageList?.loading ? <LoadingSkeleton variant="cards" label={<>{translate(language, "loading")}</>} className="px-1 py-2 text-xs font-medium text-slate" /> : stageList?.error ? <p role="alert" className="px-1 py-2 text-xs font-medium text-scarlet">{translate(language, "loadError")}</p> : <p className="px-1 py-2 text-xs font-medium text-slate">{translate(language, "noData")}</p> : stageRows.map((candidate) => {
                const nextStage = nextStages(candidate.latest_process)[0];
                const canAdvance = canWrite && (candidate.latest_process === "No activity" || Boolean(nextStage));
                const advanceLabel = candidate.latest_process === "No activity"
                  ? translate(language, "startPhoneScreenFor", { name: formatCandidateName(candidate) })
                  : `${processLabel(nextStage!, language)} · ${formatCandidateName(candidate)}`;
                return <div key={applicationKey(candidate)} className="flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 hover:bg-[#F8FAFD]">
                  <button type="button" onClick={() => onOpen(candidate.candidate_id, candidate.application_id)} className="min-w-0 flex-1 text-left focus:outline-none focus:ring-2 focus:ring-primary/30"><strong className="block truncate text-sm text-navy">{formatCandidateName(candidate)}</strong><span className="block truncate text-xs font-medium text-slate">{candidate.site ?? "-"} · {candidate.group_position ?? "-"}</span></button>
                  {canAdvance ? <button type="button" aria-label={advanceLabel} title={advanceLabel} onClick={() => candidate.latest_process === "No activity" ? onStartProcess(candidate) : onMove(candidate, nextStage!)} className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-[#C9D5E6] text-primary hover:bg-[#F1F7FF] focus:outline-none focus:ring-2 focus:ring-primary/30"><ArrowRight size={17} aria-hidden="true" /></button> : null}
                </div>;
              })}
              {stageList ? <CursorPagination language={language} page={stageList.page} pageSize={stageList.pageSize} loading={stageList.loading} canPrevious={stageList.canPrevious} canNext={stageList.canNext} onPrevious={stageList.goPrevious} onNext={stageList.goNext} onPageSizeChange={stageList.setPageSize} /> : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function PipelineCandidateCard({
  candidate,
  language,
  canWrite,
  compact = false,
  draggable = false,
  updateStages = [],
  profile = null,
  recruitmentLogs = [],
  candidateReferences = [],
  candidateReferenceChecks = [],
  issueCount = 0,
  menuOpen = false,
  focused = false,
  tone = "default",
  showCreateOffer = false,
  rejectionLetterSent = false,
  onOpen,
  onMove,
  onFailCurrentStage,
  onMaintainTest,
  onStartProcess,
  onEditPending,
  onPassStage,
  onManageReferenceChecks,
  onCreateOffer,
  onUpdateOffer,
  onMenuToggle,
  onMenuClose,
  onDragStart,
  onDragEnd
  , onCreateRejectionLetter
}: {
  candidate: EnrichedCandidate;
  language: Language;
  canWrite: boolean;
  /** Uses the same action menu in a low-detail Workspace list row. */
  compact?: boolean;
  draggable?: boolean;
  updateStages?: ProcessStage[];
  profile?: Profile | null;
  recruitmentLogs?: RecruitmentLog[];
  candidateReferences?: CandidateReference[];
  candidateReferenceChecks?: CandidateReferenceCheck[];
  issueCount?: number;
  menuOpen?: boolean;
  focused?: boolean;
  tone?: "default" | "failed" | "passed";
  showCreateOffer?: boolean;
  rejectionLetterSent?: boolean;
  onOpen: (candidateId: string, applicationId?: string) => void;
  onMove?: (candidate: EnrichedCandidate, nextStage: ProcessStage) => void;
  onFailCurrentStage?: (candidate: EnrichedCandidate) => void;
  onMaintainTest?: (candidate: EnrichedCandidate) => void;
  onStartProcess?: (candidate: EnrichedCandidate) => void;
  onEditPending?: (candidate: EnrichedCandidate) => void;
  onPassStage?: (candidate: EnrichedCandidate) => void;
  onManageReferenceChecks?: (candidate: EnrichedCandidate) => void;
  onCreateOffer?: (candidate: EnrichedCandidate) => void;
  onUpdateOffer?: (candidate: EnrichedCandidate) => void;
  onMenuToggle?: () => void;
  onMenuClose?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onCreateRejectionLetter?: (candidate: EnrichedCandidate) => void;
}) {
  const lastUpdate = candidateLastUpdate(candidate);
  const currentPending = [...recruitmentLogs].sort((a, b) => compareApplicationLogs(b, a)).find((log) => log.result === null && !log.superseded_at);
  const estimatedActionDate = currentPending?.estimated_action_date ?? null;
  const estimateOverdue = Boolean(estimatedActionDate && estimatedActionDate < formatLocalDateInput());
  const canFailCurrentStage = ACTIVE_PIPELINE_STAGES.includes(candidate.latest_process as ProcessStage) && candidate.latest_result === null;
  const unresolvedReferences = candidateReferences.filter((reference) => (
    reference.status === "available" && !candidateReferenceChecks.some((check) => check.reference_id === reference.reference_id && check.application_id === candidate.application_id)
  )).length;
  const referencePassBlocked = candidate.latest_process === "Reference Check" && unresolvedReferences > 0;
  const hasCardAction = showCreateOffer || updateStages.length > 0 || canFailCurrentStage || candidate.latest_process === "Offer" || candidate.latest_process === "No activity";
  const baseDisabledReason = candidateProcessDisabledReason(candidate, recruitmentLogs ?? [], profile ?? null);
  const capability = candidatePipelineCapability(candidate, recruitmentLogs ?? [], profile ?? null);
  const stageMenuId = `stage-menu-${applicationKey(candidate)}`;
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wasMenuOpenRef = useRef(false);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8, above: false });

  useEffect(() => {
    if (menuOpen) {
      wasMenuOpenRef.current = true;
      menuRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not([disabled])')?.focus();
      return;
    }
    if (!wasMenuOpenRef.current) return;
    wasMenuOpenRef.current = false;
    window.setTimeout(() => actionsButtonRef.current?.focus(), 0);
  }, [menuOpen]);
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const positionMenu = () => {
      const rect = actionsButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const isPhone = window.innerWidth < 768;
      const width = Math.min(isPhone ? 480 : 320, window.innerWidth - 16);
      const left = isPhone ? 8 : Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const above = isPhone || (window.innerHeight - rect.bottom < 280 && rect.top > 280);
      setMenuPosition({ left, top: isPhone ? window.innerHeight - 8 : above ? rect.top - 8 : rect.bottom + 8, above });
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [menuOpen]);
  const toneClass = tone === "failed"
      ? "hover:border-scarlet/40 hover:bg-[#FFF8F7]"
    : tone === "passed"
      ? "hover:border-[#C9D5E6] hover:bg-[#F8FAFD]"
      : "hover:border-[#C9D5E6] hover:bg-[#F8FAFD]";

  return (
    <article
      data-stage-menu-root="true"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      id={`pipeline-candidate-${applicationKey(candidate)}`}
      data-candidate-id={candidate.candidate_id}
      tabIndex={focused ? -1 : undefined}
      className={`${compact ? "border-0 bg-transparent p-1 shadow-none" : "ats-card p-2.5 md:p-3"} relative min-w-0 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 ${focused ? "border-primary ring-2 ring-primary/25" : ""} ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-sm text-left focus:outline-none focus:ring-2 focus:ring-primary/25"
          onClick={() => {
            onMenuClose?.();
            onOpen(candidate.candidate_id, candidate.application_id);
          }}
        >
          <strong className="block truncate text-sm leading-tight text-navy">{formatCandidateName(candidate)}</strong>
          <p className="mt-1 truncate text-xs font-medium text-slate">{formatRecruitmentId(candidate.candidate_id)} · {candidate.site ?? "-"} · {candidate.group_position ?? "-"}{compact ? "" : ` (${candidate.person_in_charge ?? "-"})`}</p>
        </button>
        <div className="flex shrink-0 items-center gap-1">
        {tone === "failed" && onCreateRejectionLetter ? (
          <Button type="button" size="icon-sm" variant="ghost" disabled={rejectionLetterSent} className="text-scarlet hover:bg-[#FFF1F0] hover:text-scarlet disabled:text-cool" icon={<Mail size={17} aria-hidden="true" />} aria-label="Send rejection letter" title={rejectionLetterSent ? "Rejection letter already sent" : "Send rejection letter"} onClick={(event) => { event.stopPropagation(); if (!rejectionLetterSent) onCreateRejectionLetter(candidate); }} />
        ) : null}
        {canWrite ? (
          <button
            ref={actionsButtonRef}
            type="button"
            className={`ats-dropdown-trigger inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:bg-lightgray disabled:text-cool ${isCandidateAging(candidate) ? "text-scarlet" : "text-slate"}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={stageMenuId}
            aria-label={translate(language, "candidateActionsFor", { name: formatCandidateName(candidate) })}
            title={hasCardAction ? translate(language, "candidateActionsFor", { name: formatCandidateName(candidate) }) : translate(language, "noActionsFor", { name: formatCandidateName(candidate) })}
            disabled={!hasCardAction}
            onClick={(event) => {
              event.stopPropagation();
              onMenuToggle?.();
            }}
          >
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : null}
        </div>
      </div>
      <p className="hidden md:block md:mt-3 md:text-[10px] md:font-medium md:text-cool">{translate(language, "updatedDate", { date: formatDate(lastUpdate, language) })}</p>
      {estimatedActionDate ? <p className={`${compact ? "mt-1" : "mt-2"} text-xs font-semibold ${estimateOverdue ? "text-scarlet" : "text-primary"}`}>{translate(language, "estimatedDateValue", { date: formatDate(estimatedActionDate, language) })}{estimateOverdue ? ` · ${translate(language, "overdue")}` : ""}</p> : null}
      <div className={compact ? "hidden" : "mt-1 flex flex-wrap items-center gap-2 md:mt-1"}>
        {issueCount ? <Tag tone="warning">{translate(language, "dataIssuesCount", { count: issueCount, plural: issueCount === 1 ? "" : "s" })}</Tag> : null}
      </div>
      {showCreateOffer ? (
        <Button
          type="button"
          size="sm"
          className="mt-3 w-full justify-center"
          onClick={(event) => {
            event.stopPropagation();
            onCreateOffer?.(candidate);
          }}
        >
          {translate(language, "createOffer")}
        </Button>
      ) : null}
      {menuOpen && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          id={stageMenuId}
          role="menu"
          aria-label={translate(language, "candidateActionsFor", { name: formatCandidateName(candidate) })}
          className="ats-dropdown-menu fixed z-[45] grid w-[min(20rem,calc(100vw-1rem))] max-h-[min(70vh,28rem)] rounded-2xl border max-md:w-[calc(100vw-1rem)] max-md:[&_[role=menuitem]]:min-h-11 max-md:[&_[role=menuitem]]:px-3 max-md:[&_[role=menuitem]]:py-2 max-md:[&_[role=menuitem]]:text-sm"
          style={{ left: menuPosition.left, top: menuPosition.top, transform: menuPosition.above ? "translateY(-100%)" : undefined }}
          data-stage-menu-root="true"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => handlePipelineMenuKeyDown(event, menuRef.current, actionsButtonRef.current, onMenuClose)}
        >
          <DisabledReasonHint language={language} reason={capability.blocked ? capability : baseDisabledReason} />
          {referencePassBlocked ? <p className="px-2 py-1 text-xs font-medium text-orange">{translate(language, "referencePassBlocked", { count: unresolvedReferences })}</p> : null}
          {candidate.latest_process === "No activity" ? (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-xs font-medium text-slate transition-colors hover:bg-lightgray hover:text-primary focus:bg-lightgray focus:text-primary"
              disabled={capability.blocked || referencePassBlocked}
              aria-label={translate(language, "startPhoneScreenFor", { name: formatCandidateName(candidate) })}
              onClick={(event) => {
                event.stopPropagation();
                onMenuClose?.();
                onStartProcess?.(candidate);
              }}
            >
              {translate(language, "startPhoneScreen")}
            </button>
          ) : null}
          {candidate.latest_process === "Offer" ? (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-xs font-medium text-slate transition-colors hover:bg-lightgray hover:text-primary focus:bg-lightgray focus:text-primary"
              disabled={capability.blocked}
              aria-label={translate(language, "updateOfferFor", { name: formatCandidateName(candidate) })}
              onClick={(event) => {
                event.stopPropagation();
                onMenuClose?.();
                onUpdateOffer?.(candidate);
              }}
            >
              {translate(language, "updateOffer")}
            </button>
          ) : null}
          {canFailCurrentStage ? (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-xs font-medium text-slate transition-colors hover:bg-lightgray hover:text-primary focus:bg-lightgray focus:text-primary"
              disabled={capability.blocked || referencePassBlocked}
              aria-label={translate(language, "passStageFor", { name: formatCandidateName(candidate), stage: processLabel(candidate.latest_process, language) })}
              title={referencePassBlocked ? translate(language, "referencePassBlockedShort", { count: unresolvedReferences }) : undefined}
              onClick={(event) => { event.stopPropagation(); if (capability.blocked || referencePassBlocked) return; onMenuClose?.(); onPassStage?.(candidate); }}
            >
              {translate(language, "passStage")}
            </button>
          ) : null}
          {canFailCurrentStage ? (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-xs font-medium text-scarlet transition-colors hover:bg-[#FFF1F0] focus:bg-[#FFF1F0] focus:text-scarlet"
              disabled={capability.blocked}
              aria-label={translate(language, "failStageFor", { name: formatCandidateName(candidate), stage: processLabel(candidate.latest_process, language) })}
              title={baseDisabledReason.detail}
              onClick={(event) => {
                event.stopPropagation();
                if (capability.blocked) return;
                onMenuClose?.();
                onFailCurrentStage?.(candidate);
              }}
            >
              {translate(language, "failStage")}
            </button>
          ) : null}
          {candidate.latest_process === "Reference Check" && candidate.latest_result === null ? (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-xs font-medium text-slate transition-colors hover:bg-lightgray hover:text-primary focus:bg-lightgray focus:text-primary"
              disabled={capability.blocked}
              onClick={(event) => {
                event.stopPropagation();
                if (capability.blocked) return;
                onMenuClose?.();
                onManageReferenceChecks?.(candidate);
              }}
            >
              {translate(language, "manageReferenceChecks")}
            </button>
          ) : null}
          {isRepeatableStage(candidate.latest_process) ? (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-xs font-medium text-slate transition-colors hover:bg-lightgray hover:text-primary focus:bg-lightgray focus:text-primary"
              disabled={capability.blocked}
              aria-label={`${translate(language, candidate.latest_process === "Line Interview" ? "addAnotherLineInterviewRound" : "addAnotherTestRound")} ${formatCandidateName(candidate)}`}
              onClick={(event) => {
                event.stopPropagation();
                onMenuClose?.();
                onMaintainTest?.(candidate);
              }}
            >
              {translate(language, candidate.latest_process === "Line Interview" ? "addAnotherLineInterviewRound" : "addAnotherTestRound")}
            </button>
          ) : null}
          {updateStages.map((nextStage) => (
            (() => {
              const disabledReason = capability.blocked ? capability : pipelineMoveDisabledReason(candidate, nextStage, recruitmentLogs ?? [], profile ?? null);
              return (
            <button
              key={nextStage}
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-xs font-medium text-slate transition-colors hover:bg-lightgray hover:text-primary focus:bg-lightgray focus:text-primary"
              disabled={disabledReason.blocked}
              title={disabledReason.detail}
              aria-label={`${translate(language, "updateStage")} ${formatCandidateName(candidate)} ${processLabel(nextStage, language)}`}
              onClick={(event) => {
                event.stopPropagation();
                if (disabledReason.blocked) return;
                onMenuClose?.();
                onMove?.(candidate, nextStage);
              }}
            >
              {processLabel(nextStage, language)}
            </button>
              );
            })()
          ))}
          {canFailCurrentStage ? (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-xs font-medium text-slate transition-colors hover:bg-lightgray hover:text-primary focus:bg-lightgray focus:text-primary"
              disabled={capability.blocked}
              aria-label={translate(language, "editPendingDetailsFor", { name: formatCandidateName(candidate) })}
              onClick={(event) => { event.stopPropagation(); if (capability.blocked) return; onMenuClose?.(); onEditPending?.(candidate); }}
            >
              {translate(language, "editPendingDetails")}
            </button>
          ) : null}
        </div>,
        document.body
      ) : null}
    </article>
  );
}

function candidateLastUpdate(candidate: EnrichedCandidate) {
  return candidate.latest_log_date ?? candidate.updated_at;
}

function sortByLastUpdateAsc(candidates: EnrichedCandidate[]) {
  return [...candidates].sort((a, b) => candidateLastUpdate(a).localeCompare(candidateLastUpdate(b)));
}

function sortByLastUpdateDesc(candidates: EnrichedCandidate[]) {
  return [...candidates].sort((a, b) => candidateLastUpdate(b).localeCompare(candidateLastUpdate(a)));
}

function handlePipelineMenuKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  menu: HTMLDivElement | null,
  trigger: HTMLButtonElement | null,
  onClose?: () => void
) {
  if (event.key === "Escape") {
    event.preventDefault();
    onClose?.();
    window.setTimeout(() => trigger?.focus(), 0);
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const actions = Array.from(menu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not([disabled])') ?? []);
  if (actions.length === 0) return;
  event.preventDefault();
  const current = actions.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? actions.length - 1
      : event.key === "ArrowDown"
        ? (current + 1 + actions.length) % actions.length
        : (current - 1 + actions.length) % actions.length;
  actions[next]?.focus();
}

function nextStages(stage: ProcessStage | "No activity" | null | undefined) {
  const currentIndex = ACTIVE_PIPELINE_STAGES.indexOf(stage as ProcessStage);
  if (stage === "No activity") return [];
  if (currentIndex === -1) return ACTIVE_PIPELINE_STAGES;
  return ACTIVE_PIPELINE_STAGES.slice(currentIndex + 2);
}

const pipelineGroupOptions: Array<{ value: PipelineGroupBy; labelKey: string }> = [
  { value: "none", labelKey: "none" },
  { value: "site", labelKey: "site" },
  { value: "owner", labelKey: "owner" }
];

const boardFilterOptions: Array<{ value: BoardFilter; labelKey: string }> = [
  { value: "all", labelKey: "candidateTriageAll" },
  { value: "aging", labelKey: "agingOnly" },
  { value: "no_activity", labelKey: "candidateTriageNoActivity" },
  { value: "offer_pending", labelKey: "candidateTriageOfferPending" },
  { value: "over_sla", labelKey: "overSlaFilter" }
];

function filterBoardRows(rows: EnrichedCandidate[], filter: BoardFilter) {
  if (filter === "aging" || filter === "over_sla") return rows.filter(isCandidateAging);
  if (filter === "no_activity") return rows.filter((row) => row.latest_process === "No activity");
  if (filter === "offer_pending") return rows.filter((row) => row.latest_process === "Offer" && !row.accepted_date);
  return rows;
}

function filterPipelineRows(rows: EnrichedCandidate[], search: string) {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  if (!normalizedSearch) return rows;
  return rows.filter((row) => [
    row.candidate_id,
    row.name,
    row.nickname,
    row.group_position,
    row.site,
    row.person_in_charge,
    ...row.doc_ids
  ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch)));
}

function groupPipelineRows(rows: EnrichedCandidate[], groupBy: PipelineGroupBy, language: Language) {
  if (groupBy === "none") return [{ label: "", rows }];
  const groups = new Map<string, EnrichedCandidate[]>();
  for (const row of rows) {
    const label = groupBy === "site" ? row.site ?? translate(language, "noSite") : row.person_in_charge ?? translate(language, "unassigned");
    groups.set(label, [...(groups.get(label) ?? []), row]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, groupRows]) => ({ label, rows: groupRows }));
}
