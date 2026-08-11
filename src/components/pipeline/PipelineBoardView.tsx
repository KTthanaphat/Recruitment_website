"use client";

import { ArrowRight, Filter, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OperationalSummaryStrip } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { DisabledReasonHint } from "@/components/ui/Workflow";
import { ACTIVE_PIPELINE_STAGES, processIndex, processLabel } from "@/lib/constants";
import { formatLocalDateInput } from "@/lib/dates";
import { formatCandidateName, formatDate } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { candidatePipelineCapability, candidateProcessDisabledReason, deriveStageHealth, isCandidateAging, pipelineMoveDisabledReason, type DataQualityIssue } from "@/lib/operations";
import type { CandidateReference, CandidateReferenceCheck, EnrichedCandidate, Language, ProcessStage, Profile, RecruitmentLog } from "@/types/recruitment";

type PipelineStageKey = ProcessStage | "No activity";
type PipelineGroupBy = "none" | "site" | "owner";
type BoardFilter = "all" | "aging" | "no_activity" | "offer_pending" | "over_sla";

export function PipelineBoardView({
  language,
  rows,
  recruitmentLogs,
  candidateReferences = [],
  candidateReferenceChecks = [],
  profile,
  dataQualityIssues = [],
  embedded = false,
  canWrite,
  offeredCandidateIds,
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
  onUpdateOffer
}: {
  language: Language;
  rows: EnrichedCandidate[];
  recruitmentLogs: RecruitmentLog[];
  candidateReferences?: CandidateReference[];
  candidateReferenceChecks?: CandidateReferenceCheck[];
  profile: Profile | null;
  dataQualityIssues?: DataQualityIssue[];
  /** Renders inside an existing workspace surface without standalone page chrome. */
  embedded?: boolean;
  canWrite: boolean;
  offeredCandidateIds?: ReadonlySet<string>;
  onNewCandidate?: () => void;
  onOpen: (candidateId: string) => void;
  onMove: (candidate: EnrichedCandidate, nextStage: ProcessStage) => void;
  onFailCurrentStage: (candidate: EnrichedCandidate) => void;
  onMaintainTest: (candidate: EnrichedCandidate) => void;
  onStartProcess: (candidate: EnrichedCandidate) => void;
  onEditPending?: (candidate: EnrichedCandidate) => void;
  onPassStage?: (candidate: EnrichedCandidate) => void;
  onManageReferenceChecks?: (candidate: EnrichedCandidate) => void;
  onCreateOffer?: (candidate: EnrichedCandidate) => void;
  onUpdateOffer: (candidate: EnrichedCandidate) => void;
}) {
  const [dragged, setDragged] = useState<EnrichedCandidate | null>(null);
  const [blockedStage, setBlockedStage] = useState<PipelineStageKey | null>(null);
  const [openStageMenu, setOpenStageMenu] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<PipelineGroupBy>("none");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [focusedCandidateId, setFocusedCandidateId] = useState<string | null>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterSearchRef = useRef<HTMLInputElement>(null);
  const activeFilterCount = Number(Boolean(pipelineSearch.trim())) + Number(boardFilter !== "all");
  const activeRowsBase = rows.filter((row) => row.latest_result !== 0 && !(row.latest_process === "Offer" && row.latest_result === 1));
  const activeRows = filterBoardRows(filterPipelineRows(activeRowsBase, pipelineSearch), boardFilter);
  const failedGroups = failedCandidatesByStage(filterPipelineRows(rows, pipelineSearch), recruitmentLogs);
  const passedOfferRows = passedOfferCandidates(filterPipelineRows(rows, pipelineSearch));
  const agingRows = activeRows.filter(isCandidateAging);
  const noActivityRows = activeRows.filter((row) => row.latest_process === "No activity");
  const displayStages: PipelineStageKey[] = ["No activity", ...ACTIVE_PIPELINE_STAGES];

  useEffect(() => {
    if (!openStageMenu) return;

    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Element && event.target.closest("[data-stage-menu-root='true']")) return;
      setOpenStageMenu(null);
    }

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpenStageMenu(null);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openStageMenu]);

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
  }, [embedded]);

  useEffect(() => {
    if (!focusedCandidateId) return;
    const card = document.getElementById(`pipeline-candidate-${focusedCandidateId}`);
    if (!card) return;
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    if (!document.querySelector('[role="dialog"]')) card.focus({ preventScroll: true });
  }, [activeRows, failedGroups, focusedCandidateId, passedOfferRows]);

  return (
    <div className="grid gap-5">
      <Panel variant={embedded ? "workspace" : "primary"} className={embedded ? "shadow-none" : ""}>
        <SectionTitle
          title={translate(language, "candidatePipeline")}
          action={canWrite && onNewCandidate ? <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onNewCandidate}>{translate(language, "newCandidate")}</Button> : null}
        />
        <div className="mb-3 grid gap-3">
          <OperationalSummaryStrip
            density="compact"
            items={[
              { label: translate(language, "activeCandidates"), value: activeRows.length, tone: "primary", helper: translate(language, "visibleOnBoard") },
              { label: translate(language, "aging"), value: agingRows.length, tone: agingRows.length > 0 ? "danger" : "success", helper: translate(language, "daysSinceTouch") },
              { label: translate(language, "failed7d"), value: failedGroups.reduce((sum, group) => sum + group.rows.length, 0), tone: "danger", helper: translate(language, "recentFailedOutcomes") },
              { label: translate(language, "offerPass7d"), value: passedOfferRows.length, tone: "success", helper: translate(language, "recentlyCompleted") },
              { label: translate(language, "noActivity"), value: noActivityRows.length, tone: noActivityRows.length > 0 ? "warning" : "success", helper: translate(language, "needsFirstUpdate") }
            ]}
          />
          <div className="relative flex flex-wrap items-center justify-between gap-2" data-filter-popover-root="true">
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
                className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${activeFilterCount > 0 ? "bg-primary text-white ring-primary" : "bg-white text-slate ring-[#C9D5E6] hover:bg-[#F8FAFD]"}`}
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
                <div id="pipeline-filter-popover" role="dialog" aria-label={translate(language, "pipelineFilters")} className="absolute right-0 top-10 z-30 grid w-[min(22rem,calc(100vw-2rem))] gap-3 rounded-2xl border border-[#E4E9F2] bg-white p-3 shadow-[0_8px_24px_rgba(11,19,43,0.08)]">
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
        </div>
        <div className="flex gap-3 overflow-x-auto rounded-2xl border border-[#E4E9F2] bg-white p-3" aria-label={translate(language, "candidatePipeline")}>
          {displayStages.map((stage) => {
            const stageRows = sortByLastUpdateAsc(activeRows.filter((row) => row.latest_process === stage));
            const isBlocked = blockedStage === stage;
            const metrics = deriveStageHealth(stage, stageRows, recruitmentLogs);
            const groupedRows = groupPipelineRows(stageRows, groupBy, language);

            return (
              <section
                key={stage}
                className={`min-h-80 w-[min(17rem,82vw)] shrink-0 rounded-2xl border border-[rgb(var(--app-primary-rgb)/0.22)] bg-[rgb(var(--app-primary-rgb)/0.08)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] transition-colors ${
                  isBlocked ? "border-scarlet bg-[#FFF1F0]" : ""
                }`}
                onDragOver={(event) => {
                  if (!canWrite || !dragged) return;
                  const targetIndex = processIndex(stage);
                  const currentIndex = processIndex(dragged.latest_process);
                  const isMaintainTestDrop = stage === "Test" && dragged.latest_process === "Test";
                  if (targetIndex > currentIndex || isMaintainTestDrop) {
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
                  if (stage === "Test" && dragged.latest_process === "Test") {
                    onMaintainTest(dragged);
                  } else if (processIndex(stage) > processIndex(dragged.latest_process)) {
                    onMove(dragged, stage);
                  }
                  setDragged(null);
                }}
              >
                <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
                  <h3 className={`break-words text-sm font-semibold ${metrics.overSlaCount > 0 ? "text-scarlet" : "text-navy"}`}>
                    {processLabel(stage, language)}
                  </h3>
                  <Tag tone={metrics.overSlaCount > 0 ? "danger" : "muted"}>{stageRows.length}</Tag>
                </div>
                {stageRows.length === 0 ? (
                  <EmptyState variant="board" message={translate(language, "noData")} />
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
                        key={candidate.candidate_id}
                        candidate={candidate}
                        language={language}
                        canWrite={canWrite}
                        draggable={canWrite && candidatePipelineCapability(candidate, recruitmentLogs.filter((log) => log.candidate_id === candidate.candidate_id), profile).canDrag}
                        updateStages={updateStages}
                        profile={profile}
                        recruitmentLogs={recruitmentLogs.filter((log) => log.candidate_id === candidate.candidate_id)}
                        candidateReferences={candidateReferences.filter((reference) => reference.candidate_id === candidate.candidate_id)}
                        candidateReferenceChecks={candidateReferenceChecks}
                        issueCount={issueCount}
                        focused={focusedCandidateId === candidate.candidate_id}
                        menuOpen={openStageMenu === candidate.candidate_id}
                        onOpen={onOpen}
                        onMove={onMove}
                        onFailCurrentStage={onFailCurrentStage}
                        onMaintainTest={onMaintainTest}
                        onStartProcess={onStartProcess}
                        onEditPending={onEditPending}
                        onPassStage={onPassStage}
                        onManageReferenceChecks={onManageReferenceChecks}
                        onUpdateOffer={onUpdateOffer}
                        onMenuToggle={() => setOpenStageMenu((current) => current === candidate.candidate_id ? null : candidate.candidate_id)}
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
              </section>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel variant="secondary">
          <SectionTitle title={translate(language, "failedCandidatesLast7Days")} />
          {failedGroups.every((group) => group.rows.length === 0) ? (
            <EmptyState variant="quiet" message={translate(language, "noFailedCandidatesLast7Days")} />
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
                        key={candidate.candidate_id}
                        candidate={candidate}
                        language={language}
                        canWrite={false}
                        tone="failed"
                        focused={focusedCandidateId === candidate.candidate_id}
                        onOpen={onOpen}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </Panel>

        <Panel variant="secondary">
          <SectionTitle title={translate(language, "passedOfferLast7Days")} />
          {passedOfferRows.length === 0 ? (
            <EmptyState variant="quiet" message={translate(language, "noOfferPassLast7Days")} />
          ) : (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {passedOfferRows.map((candidate) => (
                <PipelineCandidateCard
                  key={candidate.candidate_id}
                  candidate={candidate}
                  language={language}
                  canWrite={false}
                  tone="passed"
                  showCreateOffer={canWrite && !offeredCandidateIds?.has(candidate.candidate_id)}
                  focused={focusedCandidateId === candidate.candidate_id}
                  onOpen={onOpen}
                  onCreateOffer={onCreateOffer}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function failedCandidatesByStage(rows: EnrichedCandidate[], recruitmentLogs: RecruitmentLog[]) {
  const cutoff = recentCutoffDate();
  const groups = new Map<ProcessStage, EnrichedCandidate[]>(ACTIVE_PIPELINE_STAGES.map((stage) => [stage, []]));

  for (const row of rows) {
    if (row.latest_result !== 0 || row.latest_process === "No activity") continue;
    const failureDate = recruitmentLogs
      .filter((log) => log.candidate_id === row.candidate_id && log.superseded_at === null && log.result === 0)
      .sort((a, b) => b.log_id - a.log_id)[0]?.outcome_date;
    if (!failureDate || failureDate < cutoff) continue;
    groups.set(row.latest_process, [...(groups.get(row.latest_process) ?? []), row]);
  }

  return ACTIVE_PIPELINE_STAGES.map((stage) => ({
    stage,
    rows: sortByLastUpdateAsc(groups.get(stage) ?? [])
  }));
}

function passedOfferCandidates(rows: EnrichedCandidate[]) {
  const cutoff = recentCutoffDate();

  return sortByLastUpdateDesc(rows
    .filter((row) => {
      if (row.latest_process !== "Offer" || row.latest_result !== 1 || !row.latest_log_date) return false;
      return row.latest_log_date >= cutoff;
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

function PipelineCandidateCard({
  candidate,
  language,
  canWrite,
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
}: {
  candidate: EnrichedCandidate;
  language: Language;
  canWrite: boolean;
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
  onOpen: (candidateId: string) => void;
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
}) {
  const lastUpdate = candidateLastUpdate(candidate);
  const canFailCurrentStage = ACTIVE_PIPELINE_STAGES.includes(candidate.latest_process as ProcessStage) && candidate.latest_result === null;
  const unresolvedReferences = candidateReferences.filter((reference) => (
    reference.status === "available" && !candidateReferenceChecks.some((check) => check.reference_id === reference.reference_id)
  )).length;
  const referencePassBlocked = candidate.latest_process === "Reference Check" && unresolvedReferences > 0;
  const hasCardAction = showCreateOffer || updateStages.length > 0 || canFailCurrentStage || candidate.latest_process === "Offer" || candidate.latest_process === "No activity";
  const baseDisabledReason = candidateProcessDisabledReason(candidate, recruitmentLogs ?? [], profile ?? null);
  const capability = candidatePipelineCapability(candidate, recruitmentLogs ?? [], profile ?? null);
  const stageMenuId = `stage-menu-${candidate.candidate_id}`;
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
      const width = Math.min(320, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
      const above = window.innerHeight - rect.bottom < 280 && rect.top > 280;
      setMenuPosition({ left, top: above ? rect.top - 8 : rect.bottom + 8, above });
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
      id={`pipeline-candidate-${candidate.candidate_id}`}
      tabIndex={focused ? -1 : undefined}
      className={`ats-card relative min-w-0 p-3 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/30 ${focused ? "border-primary ring-2 ring-primary/25" : ""} ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-sm text-left focus:outline-none focus:ring-2 focus:ring-primary/25"
          onClick={() => {
            onMenuClose?.();
            onOpen(candidate.candidate_id);
          }}
        >
          <strong className="block truncate text-sm leading-tight text-navy">{formatCandidateName(candidate)}</strong>
          <p className="mt-1 truncate text-xs font-medium text-slate">{candidate.site ?? "-"}-{candidate.group_position ?? "-"} ({candidate.person_in_charge ?? "-"})</p>
        </button>
        {canWrite ? (
          <button
            ref={actionsButtonRef}
            type="button"
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:bg-lightgray disabled:text-cool ${isCandidateAging(candidate) ? "text-scarlet ring-[#F4B4AE] hover:bg-[#FFF1F0] hover:text-scarlet" : "text-slate ring-[#C9D5E6] hover:bg-[#F8FAFD] hover:text-primary"}`}
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
      <p className="mt-3 text-[10px] font-medium text-cool">{translate(language, "updatedDate", { date: formatDate(lastUpdate, language) })}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
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
          className="fixed z-[45] grid w-[min(20rem,calc(100vw-1rem))] max-h-[min(70vh,28rem)] gap-1 overflow-y-auto rounded-2xl border border-[#E4E9F2] bg-white p-2 shadow-[0_8px_24px_rgba(11,19,43,0.16)]"
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
          {candidate.latest_process === "Test" ? (
            <button
              type="button"
              role="menuitem"
              className="rounded px-2 py-1 text-left text-xs font-medium text-slate transition-colors hover:bg-lightgray hover:text-primary focus:bg-lightgray focus:text-primary"
              disabled={capability.blocked}
              aria-label={`${translate(language, "addAnotherTestRound")} ${formatCandidateName(candidate)}`}
              onClick={(event) => {
                event.stopPropagation();
                onMenuClose?.();
                onMaintainTest?.(candidate);
              }}
            >
              {translate(language, "addAnotherTestRound")}
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
