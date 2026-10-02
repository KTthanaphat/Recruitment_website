"use client";

import Link from "next/link";
import { ArrowLeft, BarChart3, BriefcaseBusiness, CheckCircle2, Clock3, FileText, Plus, Send, UserRound, UsersRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { SelectInput } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordActionGroup } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { DataQualityIssueCard, SourcingConversionPanel } from "@/components/ui/Workflow";
import { localizeWorkspaceIssue } from "@/lib/workspace-quality-copy";
import { ACTIVE_PIPELINE_STAGES, processLabel, SOURCING_CHANNELS } from "@/lib/constants";
import { enrichCandidates, enrichOffers, enrichRequisitions, enrichSourcingGroups, enrichWorkspaceLinkedGroups } from "@/lib/data";
import { formatDate, formatDateTime, formatRequisitionCardTitle, formatRequisitionCompactParts, formatRequisitionOptionLabel, formatRequisitionTitle, resultText, statusTone } from "@/lib/format";
import { actionToneLabel, fillReadinessLabel, offerStatusLabel, requisitionStatusLabel, translate } from "@/lib/i18n/dictionary";
import {
  deriveDataQualityIssues,
  deriveHiringJourney,
  deriveSourcingConversionMetrics,
  isCandidateAging,
  offerImpact,
  offerStatus,
  requisitionFillReadiness,
  sourcingApplicants,
  sourcingPreviousUpdate,
  type HiringJourneyStep
} from "@/lib/operations";
import { getRequisitionSlaState } from "@/lib/sla";
import { buildContextualHref, pushWorkspaceUrlState, readWorkspaceUrlState } from "@/lib/workspace-url-state";
import { WorkspaceBreadcrumbs } from "@/components/workspace/WorkspaceBreadcrumbs";
import { LinkedRequisitionPreview } from "@/components/workspace/LinkedRequisitionPreview";
import type {
  DashboardData,
  EnrichedCandidate,
  EnrichedOffer,
  EnrichedRequisition,
  EnrichedSourcingGroup,
  Language,
  Profile,
  WorkspaceActionRequest,
  WorkspaceSection
} from "@/types/recruitment";

type WorkspaceTarget = {
  type: "requisition" | "group" | null;
  id: string | null;
};

type SelectedWorkspaceTarget = {
  type: "requisition" | "group";
  id: string;
};

type WorkspaceUrlSelection = {
  target: WorkspaceTarget;
  section: WorkspaceSection;
};

type WorkspaceContext = {
  id: string;
  type: "requisition" | "group";
  title: string;
  meta: string;
  primaryRequisition: EnrichedRequisition | null;
  requisitions: EnrichedRequisition[];
  groups: EnrichedSourcingGroup[];
  candidates: EnrichedCandidate[];
  offers: EnrichedOffer[];
  openHeadcount: number;
  docGroupId: string | null;
  activity: WorkspaceActivity[];
};

type WorkspaceActivity = {
  id: string;
  date: string;
  title: string;
  meta: string;
  tone: string;
  href: string;
  actor: string | null;
};

const workspaceSections: WorkspaceSection[] = ["overview", "sourcing", "pipeline", "offer", "activity"];

export function HiringWorkspaceView({
  data,
  language,
  target,
  weekStart,
  onOpenCandidate,
  onOpenRequisition,
  canWrite = data.profile?.role !== "viewer",
  canManageSetup = false,
  profile = data.profile,
  onDispatchAction,
  pipelineSlot,
  sourcingSlot,
  offerSlot,
  siteFilter = "",
  ownerFilter = ""
}: {
  data: DashboardData;
  language: Language;
  target: WorkspaceTarget;
  weekStart: string;
  onOpenCandidate: (candidateId: string) => void;
  onOpenRequisition: (docId: string) => void;
  canWrite?: boolean;
  canManageSetup?: boolean;
  profile?: Profile | null;
  onDispatchAction?: (request: WorkspaceActionRequest) => void;
  pipelineSlot?: ReactNode;
  sourcingSlot?: ReactNode;
  offerSlot?: ReactNode;
  siteFilter?: string;
  ownerFilter?: string;
}) {
  const [urlState, setUrlState] = useState(() => readWorkspaceSelection(target));
  const [pickerOpen, setPickerOpen] = useState(() => !readWorkspaceSelection(target).target.type);
  const [pickerScope, setPickerScope] = useState<"ongoing" | "all">("ongoing");
  const [contextCompact, setContextCompact] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const scopedData = useMemo(() => {
    const visibleDocIds = new Set(data.requisitions.filter((row) => (
      canSiteRecruiterViewRequisition(row, profile)
      && (!siteFilter || row.site === siteFilter)
      && (!ownerFilter || row.person_in_charge === ownerFilter)
    )).map((row) => row.doc_id));
    const documentGroups = data.document_groups.filter((row) => visibleDocIds.has(row.doc_id));
    const documentGroupIds = new Set(documentGroups.map((row) => row.doc_group_id));
    const candidateIds = new Set(data.candidates.filter((row) => Boolean(row.doc_group_id && documentGroupIds.has(row.doc_group_id))).map((row) => row.candidate_id));
    return {
      ...data,
      requisitions: data.requisitions.filter((row) => visibleDocIds.has(row.doc_id)),
      document_groups: documentGroups,
      candidates: data.candidates.filter((row) => candidateIds.has(row.candidate_id)),
      offers: data.offers.filter((row) => visibleDocIds.has(row.doc_id)),
      recruitment_logs: data.recruitment_logs.filter((row) => candidateIds.has(row.candidate_id))
    };
  }, [data, ownerFilter, profile, siteFilter]);
  const requisitions = useMemo(() => enrichRequisitions(scopedData), [scopedData]);
  const candidates = useMemo(() => enrichCandidates(scopedData), [scopedData]);
  const offers = useMemo(() => enrichOffers(scopedData), [scopedData]);
  const groups = useMemo(() => enrichSourcingGroups(scopedData, weekStart), [scopedData, weekStart]);
  const allGroups = useMemo(() => enrichWorkspaceLinkedGroups(scopedData, weekStart), [scopedData, weekStart]);
  const latestSavedByGroup = useMemo(() => {
    const latest = new Map<string, string>();
    for (const update of scopedData.sourcing_weekly_updates) {
      if (update.updated_at > (latest.get(update.group_id) ?? "")) latest.set(update.group_id, update.updated_at);
    }
    return latest;
  }, [scopedData.sourcing_weekly_updates]);
  const activeOpenRequisitions = useMemo(() => requisitions.filter(isActiveOpenRequisition), [requisitions]);
  const activeOpenGroups = useMemo(() => {
    const activeDocIds = new Set(activeOpenRequisitions.map((row) => row.doc_id));
    return groups.filter((group) => group.open_headcount > 0 && group.doc_ids.some((docId) => activeDocIds.has(docId)));
  }, [activeOpenRequisitions, groups]);
  const allIssues = useMemo(() => deriveDataQualityIssues(scopedData), [scopedData]);
  const selectedTarget = urlState.target;
  useEffect(() => {
    if (selectedTarget.type === "group" && selectedTarget.id && allGroups.some((row) => row.group_id === selectedTarget.id) && !activeOpenGroups.some((row) => row.group_id === selectedTarget.id)) setPickerScope("all");
  }, [activeOpenGroups, allGroups, selectedTarget.id, selectedTarget.type]);
  const currentParams = readWorkspaceUrlState();
  const contextualHref = (path: string) => buildContextualHref(path, {
    language,
    site: currentParams.get("site"),
    owner: currentParams.get("pic"),
    sourcingWeek: currentParams.get("sourcingWeek") ?? weekStart,
    priority: currentParams.get("priority")
  });

  useEffect(() => {
    if (readWorkspaceUrlState().get("section") === "outcome") updateLegacyOutcomeSection();
    function syncFromHistory() {
      const next = readWorkspaceSelection(target);
      setUrlState(next);
      setPickerOpen(!next.target.type);
    }

    syncFromHistory();
    window.addEventListener("popstate", syncFromHistory);
    window.addEventListener("workspace:urlchange", syncFromHistory);
    return () => {
      window.removeEventListener("popstate", syncFromHistory);
      window.removeEventListener("workspace:urlchange", syncFromHistory);
    };
  }, [target]);

  const context = selectedTarget.type === "requisition" && selectedTarget.id
    ? contextForRequisition(selectedTarget.id, scopedData, activeOpenRequisitions, candidates, offers, activeOpenGroups, contextualHref, language)
    : selectedTarget.type === "group" && selectedTarget.id
      ? contextForGroup(selectedTarget.id, scopedData, requisitions, candidates, offers, allGroups, contextualHref, language)
      : null;
  const groupReadiness = context?.type === "group" ? summarizeGroupReadiness(context.requisitions, candidates) : null;
  const groupTerminalStatus = context?.type === "group" && !groupReadiness ? terminalGroupStatus(context.requisitions) : null;
  const groupSla = context?.type === "group" ? oldestGroupSla(context.requisitions) : null;
  const activeCandidates = context?.candidates.filter((candidate) => candidate.latest_result !== 0 && !candidate.accepted_date && ACTIVE_PIPELINE_STAGES.includes(candidate.latest_process as never)) ?? [];
  const agingCandidates = activeCandidates.filter(isCandidateAging);
  const pendingOffers = context?.offers.filter((offer) => !offer.accepted_date) ?? [];
  const acceptedOffers = context?.offers.filter((offer) => Boolean(offer.accepted_date)) ?? [];
  const contextIssues = context ? allIssues.filter((issue) =>
    context.requisitions.some((row) => issue.entityId === row.doc_id)
      || context.candidates.some((row) => issue.entityId === row.candidate_id)
      || context.offers.some((row) => issue.entityId === String(row.offer_id))
      || context.groups.some((row) => issue.entityId === row.group_id)
  ) : [];
  const hiringContext = context ? {
    requisition: context.primaryRequisition,
    groups: context.groups,
    candidates: context.candidates,
    offers: context.offers,
    profile,
    weekStart,
    docGroupId: context.docGroupId,
    issues: contextIssues
  } : null;
  const journey = hiringContext ? context?.type === "group" ? deriveGroupJourney(hiringContext, context.requisitions, language) : deriveHiringJourney(hiringContext) : [];
  const nextJourneyStep = journey.find((step) => step.state === "attention") ?? journey.find((step) => step.state === "current") ?? journey.find((step) => step.state === "not_started");
  const summaryItems = context ? [
    { label: translate(language, "openHeadcountShort"), value: context.openHeadcount, tone: context.openHeadcount > 0 ? "warning" as const : "success" as const, helper: translate(language, "remainingDemand") },
    { label: translate(language, "active"), value: `${activeCandidates.length}/${context.candidates.length}`, tone: "teal" as const, helper: translate(language, "activeTotal") },
    { label: translate(language, "agingCandidates"), value: agingCandidates.length, tone: agingCandidates.length > 0 ? "danger" as const : "success" as const, helper: translate(language, "lastTouchOlderThan7Days") },
    { label: translate(language, "offersSummaryLabel"), value: `${pendingOffers.length}/${acceptedOffers.length}`, tone: pendingOffers.length > 0 ? "warning" as const : "success" as const, helper: translate(language, "pendingAccepted") }
  ] : [];

  useEffect(() => {
    function onScroll() {
      setContextCompact((wasCompact) => window.matchMedia("(min-width: 1024px)").matches && window.scrollY > (wasCompact ? 40 : 80));
    }

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, []);

  useEffect(() => {
    if (!context || pickerOpen) return;
    const previous = document.documentElement.style.overflowAnchor;
    const previousBody = document.body.style.overflowAnchor;
    document.documentElement.style.overflowAnchor = "none";
    document.body.style.overflowAnchor = "none";
    return () => { document.documentElement.style.overflowAnchor = previous; document.body.style.overflowAnchor = previousBody; };
  }, [context?.type, pickerOpen]);

  function selectTarget(nextTarget: SelectedWorkspaceTarget) {
    const next = { target: nextTarget, section: "overview" as WorkspaceSection };
    setUrlState(next);
    setPickerOpen(false);
    pushWorkspaceUrlState({ type: nextTarget.type, id: nextTarget.id, section: next.section, doc: null, groupChoices: null });
  }

  function selectSection(section: WorkspaceSection) {
    setUrlState((current) => ({ ...current, section }));
    pushWorkspaceUrlState({ section });
  }

  function showWorkspaceCatalog() {
    setUrlState({ target: { type: null, id: null }, section: "overview" });
    setPickerOpen(true);
    pushWorkspaceUrlState({ type: null, id: null, section: "overview", doc: null });
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, section: WorkspaceSection) {
    const index = workspaceSections.indexOf(section);
    const next = event.key === "ArrowRight" ? (index + 1) % workspaceSections.length
      : event.key === "ArrowLeft" ? (index - 1 + workspaceSections.length) % workspaceSections.length
        : event.key === "Home" ? 0 : event.key === "End" ? workspaceSections.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    selectSection(workspaceSections[next]);
    tabRefs.current[next]?.focus();
  }

  function showGroup(groupId: string) {
    setUrlState({ target: { type: "group", id: groupId }, section: "overview" });
    setPickerOpen(false);
  }

  const primaryAction = nextJourneyStep ? { id: "open-next-section", label: translate(language, "workspaceOpenSection", { section: workspaceSectionLabel(language, nextJourneyStep.section) }), tone: "primary" as const, onSelect: () => selectSection(nextJourneyStep.section) }
        : { id: "select-workspace", label: translate(language, "workspaceSelect"), tone: "primary" as const, onSelect: () => setPickerOpen(true) };
  const secondaryActions = context
    ? [
      { id: "change-workspace", label: translate(language, "workspaceChange"), onSelect: () => setPickerOpen(true) }
    ]
    : [
      { id: "browse-groups", label: translate(language, "workspaceGroups"), onSelect: () => setPickerOpen(true) }
    ];

  return (
    <div className={`grid min-w-0 gap-5 ${context && !pickerOpen ? "lg:min-h-[calc(100vh+7rem)] lg:content-start" : ""}`}>
      {pickerOpen || !context ? null : <section className={`relative z-30 min-w-0 rounded-2xl border border-[#D7E4F5] bg-gradient-to-r from-white via-white to-[#F1F6FF] p-3 shadow-[0_8px_24px_rgba(11,19,43,0.06)] lg:sticky lg:top-3 lg:backdrop-blur ${contextCompact ? "lg:mb-2 lg:p-2.5" : context.type === "group" ? "lg:p-3" : "lg:p-5"}`}>
        <div className={`grid min-w-0 grid-cols-1 gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto] ${contextCompact ? "lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" : "min-[1080px]:grid-cols-[minmax(0,9fr)_minmax(0,16fr)]"}`}>
          {!contextCompact ? <div className="flex min-w-0 items-center gap-1 md:col-start-1 md:row-start-1"><button type="button" aria-label={translate(language, "backToWorkspaceGroups")} title={translate(language, "backToWorkspaceGroups")} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-primary hover:bg-[#E9F1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:min-h-8 lg:min-w-8" onClick={showWorkspaceCatalog}><ArrowLeft size={16} aria-hidden="true" /></button><WorkspaceBreadcrumbs
            flush={context.type === "group"}
            language={language}
            workspace={{ label: translate(language, "workspace"), href: contextualHref("/workspace"), onSelect: showWorkspaceCatalog }}
            group={context.groups[0] ? { label: context.groups[0].group_id, href: contextualHref(`/workspace?type=group&id=${encodeURIComponent(context.groups[0].group_id)}&section=overview`), current: !context.primaryRequisition, onSelect: () => showGroup(context.groups[0].group_id) } : undefined}
          /></div> : null}
          <div className={`flex min-w-0 items-start gap-2 md:col-span-2 md:row-start-2 ${contextCompact ? "lg:col-span-1 lg:col-start-1 lg:row-start-1" : "min-[1080px]:col-span-1"}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E9F1FF] text-primary"><BriefcaseBusiness size={18} aria-hidden="true" /></span>
            <div className="min-w-0">
              <h1 className={`break-words text-xl font-semibold leading-7 text-navy md:text-2xl ${contextCompact ? "lg:text-lg lg:leading-6" : ""}`}>{context.type === "group" ? context.groups[0]?.group_position : context.title}</h1>
              {context.type === "group" ? <>
                <p data-testid="workspace-site-owner" className={`mt-0.5 flex max-w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs font-medium text-slate ${contextCompact ? "lg:hidden" : ""}`}>
                  <span className="max-w-full break-all" aria-label={`${translate(language, "groupId")}: ${context.id}`}>{context.id}</span>
                  <span className="max-w-full break-words"><span className="mr-2 text-cool" aria-hidden="true">|</span><span aria-label={`${translate(language, "site")}: ${context.groups[0]?.sites.join(", ") || "—"}`}>{context.groups[0]?.sites.join(", ") || "—"}</span></span>
                  <span className="max-w-full break-words"><span className="mr-2 text-cool" aria-hidden="true">|</span><span aria-label={`${translate(language, "owner")}: ${context.groups[0]?.owners.join(", ") || translate(language, "unassigned")}`}>{context.groups[0]?.owners.join(", ") || translate(language, "unassigned")}</span></span>
                </p>
                {contextCompact ? <p className="mt-0.5 hidden break-all text-xs font-medium text-slate lg:block">{translate(language, "groupId")}: {context.id}</p> : null}
              </> : <>
                <p className="mt-0.5 break-words text-xs font-medium text-slate">{translate(language, "requisitionId")}: {context.id}</p>
                <p data-testid="workspace-site-owner" className={`mt-1 break-words text-xs font-medium text-slate ${contextCompact ? "lg:hidden" : ""}`}>
                  {translate(language, "site")}: {context.primaryRequisition?.site || "—"}
                  <span className="mx-2 text-cool" aria-hidden="true">·</span>
                  {translate(language, "owner")}: {context.primaryRequisition?.person_in_charge || translate(language, "unassigned")}
                </p>
              </>}
              {context.type === "group" && (groupReadiness || groupTerminalStatus || groupSla) ? <div data-testid="group-focused-tags" className={`mt-1 flex flex-wrap gap-1.5 ${contextCompact ? "lg:hidden" : ""}`}>
                {groupReadiness ? <Tag appearance="soft" tone={groupReadiness.tone}>{fillReadinessLabel(language, groupReadiness.label)} · {groupReadiness.count}/{groupReadiness.total}</Tag> : null}
                {groupTerminalStatus ? <Tag appearance="soft" tone={groupTerminalStatus.tone}>{translate(language, groupTerminalStatus.key)}</Tag> : null}
                {groupSla ? <Tag appearance="soft" tone={groupSla.isOverdue ? "danger" : "muted"}>{groupSla.label}</Tag> : null}
              </div> : null}
            </div>
          </div>
          {context.type === "group" ? null : <div className={`md:col-start-2 md:row-start-1 md:justify-self-end ${contextCompact ? "lg:col-start-2 lg:row-start-1" : ""}`}><RecordActionGroup label={translate(language, "workspace")} primary={primaryAction} items={secondaryActions} flat /></div>}
          <div data-testid={context.type === "group" ? "group-header-metrics" : "workspace-header-metrics"} className={`min-w-0 border-t border-[#D7E4F5] pt-1 md:col-span-2 md:row-start-3 min-[1080px]:col-span-1 min-[1080px]:col-start-2 min-[1080px]:row-start-2 min-[1080px]:border-l min-[1080px]:border-t-0 min-[1080px]:pl-3 min-[1080px]:pt-0 ${contextCompact ? "lg:hidden" : ""}`}>
            <div className="grid grid-cols-2 md:grid-cols-4" aria-label={translate(language, "workspace")}>
              {summaryItems.map((item, index) => {
                const Icon = [UsersRound, UserRound, Clock3, FileText][index];
                return <div key={item.label} className={`min-w-0 px-2 py-2 ${index % 2 === 1 ? "border-l border-[#D7E4F5]" : ""} ${index >= 2 ? "border-t border-[#D7E4F5] md:border-t-0" : ""} ${index === 2 ? "md:border-l md:border-[#D7E4F5]" : ""}`}>
                  <div className="flex min-w-0 items-start gap-2">
                    <Icon size={17} className={`mt-0.5 shrink-0 ${item.tone === "danger" ? "text-scarlet" : item.tone === "warning" ? "text-orange" : item.tone === "teal" ? "text-teal" : "text-primary"}`} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className={`${context.type === "group" ? "" : "min-h-8"} text-xs font-medium leading-4 text-slate`}>{item.label}</p>
                      <p className={`${context.type === "group" ? "" : "min-h-12"} break-words text-xs font-light leading-4 text-slate`}>{item.helper}</p>
                      <p className={`mt-1 break-words text-xl font-semibold tabular-nums ${item.tone === "danger" ? "text-scarlet" : "text-navy"}`}>{item.value}</p>
                    </div>
                  </div>
                </div>;
              })}
            </div>
          </div>
        </div>
      </section>}
      {pickerOpen || !context ? (
        <WorkspacePicker canManageSetup={canManageSetup && Boolean(onDispatchAction)} groups={(pickerScope === "all" ? allGroups : activeOpenGroups).filter((group) => { const choices = readWorkspaceUrlState().get("groupChoices"); return !choices || choices.split(",").includes(group.group_id); })} scope={pickerScope} onScopeChange={setPickerScope} data={scopedData} requisitions={requisitions} candidates={candidates} latestSavedByGroup={latestSavedByGroup} invalidTarget={Boolean(selectedTarget.type && selectedTarget.id && !context)} language={language} onCreateGroup={() => onDispatchAction?.({ kind: "group.create" })} onCreateRequisition={() => onDispatchAction?.({ kind: "requisition.create" })} onOpenRequisition={onOpenRequisition} onSelect={selectTarget} />
      ) : (
        <section data-testid="workspace-tabs-panel" className="min-w-0 overflow-hidden rounded-xl border border-[#E4E9F2] bg-white shadow-[0_2px_8px_rgba(11,19,43,0.03)]">
        <div role="tablist" aria-label={translate(language, "hiringWorkspaceSections")} className="flex min-w-0 gap-5 overflow-x-auto border-b border-[#E4E9F2] px-4">
          {workspaceSections.map((section, index) => {
            const active = urlState.section === section;
            return (
              <button
                key={section}
                id={`workspace-tab-${section}`}
                ref={(node) => { tabRefs.current[index] = node; }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                aria-controls={`workspace-panel-${section}`}
                className={`min-h-11 shrink-0 border-b-2 px-1 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                  active
                    ? "border-primary text-navy"
                    : "border-transparent text-slate hover:border-[#C9D5E6] hover:text-navy"
                }`}
                onClick={() => selectSection(section)}
                onKeyDown={(event) => onTabKeyDown(event, section)}
              >
                {workspaceSectionLabel(language, section)}
              </button>
            );
          })}
        </div>
        <div id={`workspace-panel-${urlState.section}`} role="tabpanel" aria-labelledby={`workspace-tab-${urlState.section}`} tabIndex={0} className="min-w-0 p-3 focus:outline-none md:p-4">
          {urlState.section === "overview" ? <OverviewSection context={context} contextIssues={contextIssues} journey={journey} language={language} onOpenRequisition={onOpenRequisition} onSelectSection={selectSection} /> : null}
          {urlState.section === "pipeline" ? pipelineSlot : null}
          {urlState.section === "sourcing" ? sourcingSlot ?? <SourcingFallbackSection data={scopedData} groups={context.groups} language={language} weekStart={weekStart} /> : null}
          {urlState.section === "offer" ? offerSlot ?? <OfferSection context={context} data={scopedData} language={language} requisitions={requisitions} /> : null}
          {urlState.section === "activity" ? <ActivitySection activity={context.activity} language={language} /> : null}
        </div>
        </section>
      )}
    </div>
  );
}

function OverviewSection({ context, contextIssues, journey, language, onOpenRequisition, onSelectSection }: { context: WorkspaceContext; contextIssues: ReturnType<typeof deriveDataQualityIssues>; journey: HiringJourneyStep[]; language: Language; onOpenRequisition: (docId: string) => void; onSelectSection: (section: WorkspaceSection) => void }) {
  const nextStep = journey.find((step) => step.state === "attention") ?? journey.find((step) => step.state === "current") ?? journey.find((step) => step.state === "not_started");
  const sortedIssues = [...contextIssues].sort((a, b) => ({ blocking: 0, warning: 1, info: 2 })[a.severity] - ({ blocking: 0, warning: 1, info: 2 })[b.severity]);
  const overdueGroupRequests = context.requisitions.filter((row) => getRequisitionSlaState(row, { openOnly: true }).isOverdue).length;

  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)] lg:items-stretch">
      <section data-testid="workspace-journey-panel" className="min-w-0 rounded-2xl border border-[#D7E4F5] bg-white p-4 md:p-5 lg:flex lg:h-[28rem] lg:flex-col">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate">{translate(language, "workspaceCurrentPath")}</p>
            <h2 className="mt-1 text-lg font-semibold text-navy">{translate(language, "workspaceJourney")}</h2>
          </div>
        </div>
        {nextStep ? <p className="sr-only">{translate(language, "workspaceNextAction")}: {journeyStepLabel(language, nextStep)}</p> : <p className="mb-3 text-sm text-slate">{translate(language, "workspaceUpToDate")}</p>}
        <JourneyGuide language={language} steps={journey} nextStepId={nextStep?.id} onSelectSection={onSelectSection} onOpenRequisition={onOpenRequisition} requisitions={context.requisitions} />
      </section>
      <section data-testid="workspace-quality-panel" className="min-w-0 rounded-2xl border border-[#D7E4F5] bg-white p-4 md:p-5 lg:flex lg:h-[28rem] lg:flex-col">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-navy">{translate(language, "overviewDataQuality")} <span className="text-slate">({sortedIssues.length})</span></h2>
          {overdueGroupRequests > 0 ? <Tag appearance="soft" tone="danger">{translate(language, "workspaceOverdueShort", { count: overdueGroupRequests })}</Tag> : null}
        </div>
        <div data-testid="workspace-quality-list" className="mt-3 min-w-0 divide-y divide-[#E4E9F2] lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-2 lg:[scrollbar-gutter:stable]">
          {sortedIssues.length === 0 ? <p className="text-sm text-slate">{translate(language, "noDataQualityIssues")}</p> : sortedIssues.map((issue) => <DataQualityIssueCard key={issue.id} issue={localizeWorkspaceIssue(issue, language)} language={language} row overview />)}
        </div>
      </section>
    </div>
  );
}

function journeyIcon(id: HiringJourneyStep["id"]) {
  const icons = { requisition: FileText, setup: UsersRound, sourcing: Send, candidates: UserRound, pipeline: BarChart3, offer: FileText, closure: CheckCircle2 };
  return icons[id];
}

function JourneyGuide({ language, steps, nextStepId, onSelectSection, onOpenRequisition, requisitions }: { language: Language; steps: HiringJourneyStep[]; nextStepId?: HiringJourneyStep["id"]; onSelectSection: (section: WorkspaceSection) => void; onOpenRequisition: (docId: string) => void; requisitions: EnrichedRequisition[] }) {
  return (
    <ol data-testid="workspace-journey-list" className="relative grid min-w-0 gap-1.5 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:border-l before:border-[#C9D5E6] lg:min-h-0 lg:flex-1 lg:content-start lg:overflow-y-auto lg:overscroll-contain lg:pr-2 lg:[scrollbar-gutter:stable]">
      {steps.map((step, index) => {
        const Icon = journeyIcon(step.id);
        const isNext = step.id === nextStepId;
        const tone = step.state === "completed" ? "success" : step.state === "attention" ? "warning" : step.state === "current" ? "primary" : step.state === "blocked" ? "danger" : "muted";
        return <li key={step.id} className="relative grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-start gap-2">
          <span aria-hidden="true" className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${isNext ? "border-primary bg-[#E8F0FF] text-navy" : "border-[#C9D5E6] bg-white text-slate"}`}>{index + 1}</span>
          <div className="min-w-0">
            <button type="button" className={`grid min-h-11 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg border px-2.5 py-2 text-left hover:bg-[#F8FAFD] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isNext ? step.state === "attention" ? "border-[#F3D3A2] bg-[#FFF7E8]" : "border-primary/30 bg-[#F1F6FC]" : "border-[#E4E9F2] bg-white"}`} onClick={() => onSelectSection(step.section)} aria-label={`${isNext ? `${translate(language, "workspaceNextAction")}: ` : ""}${journeyStepLabel(language, step)}: ${journeyStateLabel(language, step.state)}`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#EEF3F8] text-primary"><Icon size={16} aria-hidden="true" /></span>
              <span className="min-w-0"><span className="block break-words text-sm font-semibold text-navy">{journeyStepLabel(language, step)}</span><span className="mt-1 block break-words text-xs font-medium text-slate">{step.detail}</span></span>
              <span className="justify-self-end"><Tag appearance="soft" tone={tone}>{journeyStateLabel(language, step.state)}</Tag></span>
            </button>
            {step.id === "requisition" ? <div className="mt-2 grid min-w-0 gap-1.5 pl-2" data-testid="workspace-linked-requisitions">{requisitions.map((row) => { const title = formatRequisitionCompactParts(row); return <button key={row.doc_id} type="button" className="min-h-11 min-w-0 rounded-md border border-[#D7E4F5] px-2 py-1 text-left text-sm text-primary hover:bg-[#F1F6FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => onOpenRequisition(row.doc_id)} aria-label={formatRequisitionOptionLabel(row)} title={formatRequisitionTitle(row)}><span className="flex min-w-0 items-baseline font-semibold"><span className="min-w-0 truncate">{title.position}</span>{title.level ? <span className="shrink-0">&nbsp;({title.level})</span> : null}</span><span className="block break-all text-xs text-slate">{row.doc_id} · {requisitionStatusLabel(language, row.status)}</span></button>; })}</div> : null}
          </div>
        </li>;
      })}
    </ol>
  );
}
function SourcingFallbackSection({ data, groups, language, weekStart }: { data: DashboardData; groups: EnrichedSourcingGroup[]; language: Language; weekStart: string }) {
  return (
    <Panel>
      <SectionTitle title={translate(language, "sourcingCoverage")} eyebrow={translate(language, "readOnlyFallback")} />
      <div className="grid min-w-0 gap-3">
        {groups.length === 0 ? <EmptyState message={translate(language, "noMatchedSourcingGroup")} /> : groups.map((group) => {
          const previous = sourcingPreviousUpdate(data, group.group_id, weekStart);
          const metrics = deriveSourcingConversionMetrics(data, group.group_id, weekStart);
          return (
            <article key={group.group_id} className="grid min-w-0 gap-3 rounded-md border border-[#D7DEE8] bg-white p-3">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><strong className="block break-words text-navy">{group.group_id} - {group.group_position}</strong><p className="text-sm font-medium text-slate">{group.sites.join(", ") || "-"} - {group.owners.join(", ") || translate(language, "unassigned")}</p></div><Tag tone={group.open_headcount > 0 ? "warning" : "success"}>{translate(language, "openCount", { count: group.open_headcount })}</Tag></div>
              <p className="text-sm font-medium text-slate">{translate(language, "sourcingWeekSummary", { applicants: sourcingApplicants(group.latest_update), previous: sourcingApplicants(previous), channels: SOURCING_CHANNELS.filter((channel) => group[channel.enabled]).length })}</p>
              <SourcingConversionPanel language={language} metrics={metrics} />
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function OfferSection({ context, data, language, requisitions }: { context: WorkspaceContext; data: DashboardData; language: Language; requisitions: EnrichedRequisition[] }) {
  return (
    <Panel>
      <SectionTitle title={translate(language, "hiringOffers")} eyebrow={translate(language, "offersAndStarts")} />
      <div className="grid gap-2">
        {context.offers.length === 0 ? <EmptyState message={translate(language, "noOffersWorkspace")} /> : context.offers.map((offer) => (
          <article key={offer.offer_id} className="min-w-0 rounded-md border border-[#D7DEE8] bg-white p-3">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><strong className="block break-words text-navy">{offer.candidate_name ?? offer.candidate_id}</strong>{context.requisitions.length > 1 ? <p className="text-sm font-medium text-slate">{offer.doc_id}</p> : null}</div><Tag tone={offerStatus(offer).tone}>{offerStatusLabel(language, offerStatus(offer).label)}</Tag></div>
            <p className="mt-2 break-words text-sm font-medium text-slate">{offerImpact(offer, data.offers, requisitions)}</p>
            <p className="text-xs font-medium text-cool">{translate(language, "acceptedStartSummary", { accepted: formatDate(offer.accepted_date, language), start: formatDate(offer.first_working_date, language) })}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function ActivitySection({ activity, language }: { activity: WorkspaceActivity[]; language: Language }) {
  return (
    <section className="min-w-0">
      <SectionTitle title={translate(language, "workspaceRecentActivity")} eyebrow={translate(language, "workspaceNewestFirst")} />
      <div className="min-w-0 md:max-h-[min(62dvh,44rem)] md:overflow-auto">
      <div className="min-w-0 divide-y divide-[#E4E9F2] border-y border-[#E4E9F2] md:min-w-[60rem]">
        {activity.length > 0 ? <div className="sticky top-0 z-10 hidden gap-3 bg-white py-2 text-xs font-medium text-slate md:grid md:grid-cols-[minmax(9rem,.8fr)_minmax(12rem,1.5fr)_minmax(12rem,1.3fr)_minmax(10rem,1fr)_minmax(7rem,.7fr)]"><span>{translate(language, "date")}</span><span>{translate(language, "workspaceEvent")}</span><span>{translate(language, "workspaceContext")}</span><span>{translate(language, "actor")}</span><span>{translate(language, "status")}</span></div> : null}
        {activity.length === 0 ? <EmptyState message={translate(language, "noRecentWorkspaceActivity")} /> : activity.slice(0, 20).map((item) => (
          <div key={item.id} className="grid min-w-0 gap-2 py-3 text-sm md:grid-cols-[minmax(9rem,.8fr)_minmax(12rem,1.5fr)_minmax(12rem,1.3fr)_minmax(10rem,1fr)_minmax(7rem,.7fr)] md:items-center md:gap-3">
            <span className="text-xs text-slate"><span className="md:sr-only">{translate(language, "date")}: </span>{item.date.includes("T") ? formatDateTime(item.date, language) : formatDate(item.date, language)}</span>
            <Link href={item.href} title={item.title} className="min-w-0 truncate font-semibold text-navy hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{item.title}</Link>
            <span className="min-w-0 truncate text-xs text-slate" title={item.meta}><span className="md:sr-only">{translate(language, "workspaceContext")}: </span>{item.meta}</span>
            <span className="min-w-0 break-all text-xs text-slate"><span className="md:sr-only">{translate(language, "actor")}: </span>{item.actor || translate(language, "unknown")}</span>
            <span><span className="md:sr-only text-xs text-slate">{translate(language, "status")}: </span><Tag appearance="soft" tone={statusTone(item.tone) as never}>{actionToneLabel(language, item.tone)}</Tag></span>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}

function isActiveOpenRequisition(row: EnrichedRequisition) {
  return row.status === "ongoing" && row.open_headcount > 0;
}

function terminalGroupStatus(requisitions: EnrichedRequisition[]) {
  if (!requisitions.length) return null;
  if (requisitions.every((row) => row.status === "cancel")) return { key: "workspaceCancelledGroup", tone: "muted" as const };
  if (requisitions.every((row) => row.status === "filled" || (row.status === "ongoing" && row.open_headcount <= 0))) return { key: "workspaceFilledGroup", tone: "success" as const };
  return { key: "workspaceClosedGroup", tone: "muted" as const };
}

function WorkspacePicker({ canManageSetup, groups, scope, onScopeChange, data, requisitions, candidates, latestSavedByGroup, invalidTarget, language, onCreateGroup, onCreateRequisition, onOpenRequisition, onSelect }: { canManageSetup: boolean; groups: EnrichedSourcingGroup[]; scope: "ongoing" | "all"; onScopeChange: (scope: "ongoing" | "all") => void; data: DashboardData; requisitions: EnrichedRequisition[]; candidates: EnrichedCandidate[]; latestSavedByGroup: Map<string, string>; invalidTarget: boolean; language: Language; onCreateGroup: () => void; onCreateRequisition: () => void; onOpenRequisition: (docId: string) => void; onSelect: (target: SelectedWorkspaceTarget) => void }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"attention" | "name" | "oldest">("attention");
  const normalizedQuery = query.trim().toLowerCase();
  const nameOrder = (a: string, b: string) => a.localeCompare(b, language === "th" ? "th" : "en", { numeric: true });
  const rows = groups.map((group) => {
    const matches = data.document_groups.filter((match) => match.group_id === group.group_id);
    const docIds = new Set(matches.map((match) => match.doc_id));
    const docGroupIds = new Set(matches.map((match) => match.doc_group_id));
    const linkedRequisitions = requisitions.filter((requisition) => docIds.has(requisition.doc_id));
    const linkedCandidates = candidates.filter((candidate) => candidate.group_id === group.group_id || Boolean(candidate.doc_group_id && docGroupIds.has(candidate.doc_group_id)));
    return {
      group,
      linkedRequisitions,
      readiness: summarizeGroupReadiness(linkedRequisitions, linkedCandidates),
      terminal: terminalGroupStatus(linkedRequisitions),
      filled: linkedRequisitions.reduce((sum, row) => sum + Math.min(row.head_count, row.accepted_count), 0),
      demand: linkedRequisitions.reduce((sum, row) => sum + row.head_count, 0),
      active: linkedCandidates.filter((candidate) => candidate.latest_result !== 0 && !candidate.accepted_date && ACTIVE_PIPELINE_STAGES.includes(candidate.latest_process as never)).length,
      candidateCount: linkedCandidates.length
    };
  });
  const priority: Record<string, number> = { "No coverage": 0, "Needs candidate": 1, "Aging coverage": 2, "Active coverage": 3, "Late-stage coverage": 4 };
  const filteredGroups = rows.filter(({ group, linkedRequisitions }) => !normalizedQuery || [group.group_id, group.group_position, group.sites.join(" "), group.owners.join(" "), linkedRequisitions.map((row) => row.doc_id).join(" ")].join(" ").toLowerCase().includes(normalizedQuery)).sort((a, b) => {
    const groupA = a.group;
    const groupB = b.group;
    if (sort !== "name") {
      if (sort === "attention") {
        if (Boolean(a.readiness) !== Boolean(b.readiness)) return a.readiness ? -1 : 1;
        if (!a.readiness && !b.readiness) return nameOrder(groupA.group_position, groupB.group_position) || nameOrder(groupA.group_id, groupB.group_id);
        const readinessOrder = (priority[a.readiness?.label ?? ""] ?? 5) - (priority[b.readiness?.label ?? ""] ?? 5);
        if (readinessOrder) return readinessOrder;
        if (groupA.open_headcount !== groupB.open_headcount) return groupB.open_headcount - groupA.open_headcount;
      }
      if (sort === "oldest") {
        if (Boolean(groupA.latest_update) !== Boolean(groupB.latest_update)) return groupA.latest_update ? 1 : -1;
        if (groupA.latest_update?.updated_at !== groupB.latest_update?.updated_at) return (groupA.latest_update?.updated_at ?? "").localeCompare(groupB.latest_update?.updated_at ?? "");
      }
    }
    return nameOrder(groupA.group_position, groupB.group_position) || nameOrder(groupA.group_id, groupB.group_id);
  });
  const count = filteredGroups.length;
  const heading = "hidden md:grid md:min-w-[68rem] md:grid-cols-[minmax(11rem,1.45fr)_minmax(7rem,1fr)_minmax(6rem,.7fr)_minmax(7rem,.7fr)_minmax(9rem,1fr)_minmax(10rem,1fr)_minmax(8rem,.8fr)] md:gap-3 md:px-3 md:py-2 text-left text-xs font-semibold text-slate";
  const rowClass = "grid min-w-0 gap-2 border-t border-[#E4E9F2] px-3 py-2 text-sm md:min-w-[68rem] md:grid-cols-[minmax(11rem,1.45fr)_minmax(7rem,1fr)_minmax(6rem,.7fr)_minmax(7rem,.7fr)_minmax(9rem,1fr)_minmax(10rem,1fr)_minmax(8rem,.8fr)] md:items-center md:gap-3";
  return (
    <Panel className="min-w-0 border-[#D7DEE8] shadow-none">
      <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-normal text-slate">{translate(language, "workspacePicker")}</p><h2 className="mt-1 text-lg font-semibold text-navy">{translate(language, "workspaceSelectTitle")}</h2>{invalidTarget ? <p className="mt-1 text-sm font-medium text-orange">{translate(language, "workspaceUrlNotFound")}</p> : null}</div><div className="flex min-w-0 w-full items-center justify-end gap-2 sm:w-auto"><div role="group" aria-label={translate(language, "workspaceGroupScope")} className="inline-flex min-w-0 rounded-lg border border-[#C9D5E6] bg-[#F8FAFD] p-0.5">{(["ongoing", "all"] as const).map((option) => <button key={option} type="button" aria-pressed={scope === option} onClick={() => onScopeChange(option)} className={`min-h-11 rounded-md px-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-h-9 ${scope === option ? "bg-white text-navy shadow-sm" : "text-slate hover:text-navy"}`}>{translate(language, option === "ongoing" ? "workspaceOngoingGroups" : "workspaceAllGroups")}</button>)}</div>{canManageSetup ? <WorkspaceCreateMenu language={language} onCreateGroup={onCreateGroup} onCreateRequisition={onCreateRequisition} /> : null}</div></div>
      <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <label className="grid gap-1 text-sm font-semibold text-navy">{translate(language, "workspaceSearch")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate(language, "workspaceSearchPlaceholder")} className="min-h-11 w-full min-w-0 rounded-lg border border-[#C9D5E6] bg-white px-3 text-sm font-medium text-navy outline-none placeholder:text-cool focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
        <label className="grid gap-1 text-sm font-medium text-slate">{translate(language, "sortBy")}<SelectInput value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="attention">{translate(language, "workspaceNeedsAttention")}</option><option value="name">{translate(language, "workspaceNameSort")}</option><option value="oldest">{translate(language, "workspaceOldestSort")}</option></SelectInput></label>
      </div>
      <p className="mt-4 text-sm font-medium text-slate" role="status">{translate(language, "workspaceMatches", { count })}</p>
      <div className="mt-2 min-w-0 md:max-h-[min(60vh,36rem)] md:overflow-auto">
        {count === 0 ? <EmptyState message={translate(language, "noMatchingWorkspaces")} /> : null}
        {count > 0 ? <div className={heading}><span>{translate(language, "groupName")}</span><span>{translate(language, "readiness")}</span><span>{translate(language, "workspaceFilledDemand")}</span><span>{translate(language, "workspaceActiveCandidates")}</span><span>{translate(language, "siteOwner")}</span><span>{translate(language, "linkedRequisitions")}</span><span>{translate(language, "lastSaved")}</span></div> : null}
        {filteredGroups.map(({ group, linkedRequisitions, readiness, terminal, filled, demand, active, candidateCount }) => <div key={group.group_id} className={rowClass}>
          <div className="flex min-h-16 min-w-0 flex-col items-start justify-center self-center"><button type="button" title={group.group_position} aria-label={`${group.group_position}, ${group.group_id}`} className="flex min-h-11 min-w-0 max-w-full items-end pb-0.5 text-left font-semibold text-navy hover:text-primary hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => onSelect({ type: "group", id: group.group_id })}><span className="truncate">{group.group_position}</span></button><span className="block break-all text-xs leading-4 text-slate">{group.group_id}</span></div>
          <div><span className="md:hidden text-xs text-slate">{translate(language, "readiness")}: </span>{readiness ? <Tag appearance="soft" tone={readiness.tone}>{fillReadinessLabel(language, readiness.label)}</Tag> : terminal ? <Tag appearance="soft" tone={terminal.tone}>{translate(language, terminal.key)}</Tag> : "—"}</div>
          <p className="tabular-nums"><span className="md:hidden text-xs text-slate">{translate(language, "workspaceFilledDemand")}: </span>{filled}/{demand}</p>
          <p className="tabular-nums"><span className="md:hidden text-xs text-slate">{translate(language, "workspaceActiveCandidates")}: </span>{active}/{candidateCount}</p>
          <p className="min-w-0 break-words" title={`${group.sites.join(", ")} / ${group.owners.join(", ")}`}><span className="md:hidden text-xs text-slate">{translate(language, "siteOwner")}: </span>{group.sites.join(", ") || "—"} / {group.owners.join(", ") || translate(language, "unassigned")}</p>
          <div className="min-w-0"><span className="md:hidden text-xs text-slate">{translate(language, "linkedRequisitions")}: </span><LinkedRequisitionPreview groupName={group.group_position} language={language} requisitions={linkedRequisitions} onOpenRequisition={onOpenRequisition} /></div>
          <p className="text-xs text-slate"><span className="md:hidden">{translate(language, "lastSaved")}: </span>{latestSavedByGroup.get(group.group_id) ? formatDate(latestSavedByGroup.get(group.group_id), language) : "—"}</p>
        </div>)}
      </div>
    </Panel>
  );
}

function readWorkspaceSelection(fallback: WorkspaceTarget): WorkspaceUrlSelection {
  if (typeof window === "undefined") return { target: fallback.type === "group" ? fallback : { type: null, id: null }, section: "overview" };
  const params = readWorkspaceUrlState();
  const type = params.get("type");
  const id = params.get("id");
  const rawSection = params.get("section");
  const section = rawSection === "outcome" ? "offer" : rawSection;
  return { target: type === "group" && id ? { type, id } : { type: null, id: null }, section: isWorkspaceSection(section) ? section : "overview" };
}

function updateLegacyOutcomeSection() {
  const url = new URL(window.location.href);
  url.searchParams.set("section", "offer");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event("workspace:urlchange"));
}

function contextForRequisition(id: string, data: DashboardData, requisitions: EnrichedRequisition[], candidates: EnrichedCandidate[], offers: EnrichedOffer[], groups: EnrichedSourcingGroup[], contextualHref: (path: string) => string, language: Language): WorkspaceContext | null {
  const requisition = requisitions.find((row) => row.doc_id === id);
  if (!requisition) return null;
  const matches = data.document_groups.filter((match) => match.doc_id === id);
  const groupIds = new Set(matches.map((match) => match.group_id).filter(Boolean) as string[]);
  const docGroupIds = groupIds.size > 0 ? new Set(data.document_groups.filter((match) => match.group_id && groupIds.has(match.group_id)).map((match) => match.doc_group_id)) : new Set(matches.map((match) => match.doc_group_id));
  const relatedCandidates = candidates.filter((candidate) => Boolean(candidate.doc_group_id && docGroupIds.has(candidate.doc_group_id)) || candidate.doc_ids.includes(id));
  const relatedOffers = offers.filter((offer) => offer.doc_id === id);
  const relatedGroups = groups.filter((group) => groupIds.has(group.group_id));
  return { id, type: "requisition", title: formatRequisitionTitle(requisition), meta: `${translate(language, "requisitionId")}: ${requisition.doc_id} - ${requisition.site} - ${requisition.department} - ${requisition.person_in_charge ?? translate(language, "unassigned")}`, primaryRequisition: requisition, requisitions: [requisition], groups: relatedGroups, candidates: relatedCandidates, offers: relatedOffers, openHeadcount: requisition.open_headcount, docGroupId: matches[0]?.doc_group_id ?? null, activity: activityForContext(data, relatedCandidates.map((row) => row.candidate_id), [id], [...groupIds], contextualHref, language) };
}

function WorkspaceCreateMenu({ language, onCreateGroup, onCreateRequisition }: { language: Language; onCreateGroup: () => void; onCreateRequisition: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const actions = [
    { label: translate(language, "newRequisition"), onSelect: onCreateRequisition },
    { label: translate(language, "newGroup"), onSelect: onCreateGroup }
  ];
  return <div ref={root} className="relative z-40 shrink-0">
    <Button ref={trigger} type="button" size="sm" className="ats-dropdown-trigger !min-h-11 text-navy sm:!min-h-9" icon={<Plus size={16} aria-hidden="true" />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); } if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); requestAnimationFrame(() => choices.current[event.key === "ArrowDown" ? 0 : 1]?.focus()); } }}>{translate(language, "workspaceCreateNew")}</Button>
    {open ? <div role="menu" aria-label={translate(language, "workspaceCreateNew")} className="ats-dropdown-menu absolute right-0 top-full z-50 mt-1 grid max-h-[min(70dvh,28rem)] w-[min(15rem,calc(100vw-2rem))] rounded-lg border" onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const current = choices.current.indexOf(document.activeElement as HTMLButtonElement); choices.current[(current + (event.key === "ArrowDown" ? 1 : -1) + 2) % 2]?.focus(); }
    }}>{actions.map((action, index) => <button key={action.label} ref={(node) => { choices.current[index] = node; }} role="menuitem" type="button" className="flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm font-semibold text-navy hover:bg-[#F1F6FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => { setOpen(false); action.onSelect(); }}>{action.label}</button>)}</div> : null}
  </div>;
}

function openGroupRequisitions(requisitions: EnrichedRequisition[]) {
  return requisitions.filter(isActiveOpenRequisition);
}

function summarizeGroupReadiness(requisitions: EnrichedRequisition[], candidates: EnrichedCandidate[]) {
  const open = openGroupRequisitions(requisitions);
  if (!open.length) return null;
  const priority: Record<string, number> = { "No coverage": 0, "Needs candidate": 1, "Aging coverage": 2, "Active coverage": 3, "Late-stage coverage": 4 };
  const states = open.map((row) => requisitionFillReadiness(row, candidates));
  const worst = [...states].sort((a, b) => (priority[a.label] ?? 5) - (priority[b.label] ?? 5))[0];
  return { label: worst.label, tone: worst.tone, count: states.filter((state) => state.label === worst.label).length, total: open.length };
}

function oldestGroupSla(requisitions: EnrichedRequisition[]) {
  const ranked = openGroupRequisitions(requisitions).map((row) => ({ id: row.doc_id, sla: getRequisitionSlaState(row, { openOnly: true }) }))
    .sort((a, b) => (b.sla.ageDays ?? -1) - (a.sla.ageDays ?? -1) || a.id.localeCompare(b.id));
  return ranked[0]?.sla ?? null;
}

function deriveGroupJourney(context: Parameters<typeof deriveHiringJourney>[0], requisitions: EnrichedRequisition[], language: Language): HiringJourneyStep[] {
  const steps = deriveHiringJourney({ ...context, requisition: null });
  const linked = requisitions.length;
  const open = openGroupRequisitions(requisitions);
  const covered = open.filter((row) => context.offers.filter((offer) => offer.doc_id === row.doc_id && offer.accepted_date).length >= row.head_count).length;
  const allOffersCovered = open.length > 0 && covered === open.length;
  const allClosed = linked > 0 && requisitions.every((row) => row.status === "filled" || row.status === "cancel" || row.open_headcount <= 0);
  const missingStart = context.offers.some((offer) => offer.accepted_date && !offer.first_working_date);
  return steps.map((step) => {
    if (step.id === "requisition") return { ...step, state: linked > 0 ? "completed" : "current", detail: linked > 0 ? translate(language, "workspaceLinkedRequestCount", { count: linked }) : step.detail };
    if (step.id === "offer") return { ...step, state: !context.candidates.length ? "blocked" : allOffersCovered ? "completed" : context.offers.length ? "attention" : "not_started", detail: translate(language, "workspaceGroupOfferCoverage", { covered, total: open.length }) };
    if (step.id === "closure") return { ...step, state: !allClosed ? "not_started" : missingStart ? "attention" : "completed", detail: translate(language, allClosed ? missingStart ? "workspaceGroupMissingStart" : "workspaceGroupClosed" : "workspaceGroupClosurePending") };
    return step;
  });
}

function contextForGroup(id: string, data: DashboardData, requisitions: EnrichedRequisition[], candidates: EnrichedCandidate[], offers: EnrichedOffer[], groups: EnrichedSourcingGroup[], contextualHref: (path: string) => string, language: Language): WorkspaceContext | null {
  const group = groups.find((row) => row.group_id === id);
  if (!group) return null;
  const matches = data.document_groups.filter((match) => match.group_id === id);
  const linkedDocIds = new Set(matches.map((match) => match.doc_id));
  const relatedRequisitions = requisitions.filter((row) => linkedDocIds.has(row.doc_id));
  const groupDocGroupIds = new Set(matches.map((match) => match.doc_group_id));
  const relatedCandidates = candidates.filter((candidate) => candidate.group_id === id || Boolean(candidate.doc_group_id && groupDocGroupIds.has(candidate.doc_group_id)));
  const relatedOffers = offers.filter((offer) => linkedDocIds.has(offer.doc_id));
  return { id, type: "group", title: `${group.group_id} - ${group.group_position}`, meta: `${group.sites.join(", ") || "-"} - ${group.owners.join(", ") || translate(language, "unassigned")}`, primaryRequisition: null, requisitions: relatedRequisitions, groups: [group], candidates: relatedCandidates, offers: relatedOffers, openHeadcount: group.open_headcount, docGroupId: null, activity: activityForContext(data, relatedCandidates.map((row) => row.candidate_id), [...linkedDocIds], [id], contextualHref, language) };
}

function activityForContext(data: DashboardData, candidateIds: string[], docIds: string[], groupIds: string[], contextualHref: (path: string) => string, language: Language): WorkspaceActivity[] {
  const candidateSet = new Set(candidateIds);
  const docSet = new Set(docIds);
  const groupSet = new Set(groupIds);
  return [
    ...data.recruitment_logs.filter((log) => candidateSet.has(log.candidate_id)).map((log) => ({ id: `log:${log.log_id}`, date: log.log_date, title: `${log.candidate_id} - ${processLabel(log.recruitment_process, language)}`, meta: `${translate(language, "round")} ${log.round} - ${resultText(log.result, language)}`, tone: resultText(log.result).toLowerCase(), href: contextualHref(`/pipeline?detailId=${encodeURIComponent(log.candidate_id)}`), actor: auditActor(data, "recruitment_logs", log.candidate_id, log.created_at, "log_id", log.log_id) })),
    ...data.requisition_logs.filter((log) => docSet.has(log.doc_id)).map((log) => ({ id: `reqlog:${log.log_id}`, date: log.log_date, title: `${log.doc_id} - ${translate(language, "statusUpdate")}`, meta: log.remark ?? translate(language, "noRemark"), tone: log.status, href: contextualHref(`/requisitions?detailId=${encodeURIComponent(log.doc_id)}`), actor: auditActor(data, "requisition_logs", log.doc_id, log.created_at, "log_id", log.log_id) })),
    ...data.offers.filter((offer) => docSet.has(offer.doc_id) || candidateSet.has(offer.candidate_id)).map((offer) => ({ id: `offer:${offer.offer_id}`, date: offer.updated_at, title: `${offer.candidate_id} - ${translate(language, "offerLower")}`, meta: translate(language, "acceptedStartSummary", { accepted: formatDate(offer.accepted_date, language), start: formatDate(offer.first_working_date, language) }), tone: offer.accepted_date ? "accepted" : "pending", href: contextualHref(`/offers?offerSearch=${encodeURIComponent(offer.doc_id)}`), actor: auditActor(data, "offers", offer.doc_id, offer.updated_at, "offer_id", offer.offer_id) })),
    ...data.sourcing_weekly_updates.filter((update) => groupSet.has(update.group_id)).map((update) => ({ id: `source:${update.group_id}:${update.week_start}`, date: update.updated_at, title: `${update.group_id} - ${translate(language, "sourcingUpdate")}`, meta: translate(language, "applicantsCount", { count: sourcingApplicants(update) }), tone: "update", href: contextualHref(`/sourcing?sourceSearch=${encodeURIComponent(update.group_id)}`), actor: update.updated_by }))
  ].sort((left, right) => right.date.localeCompare(left.date));
}

function auditActor(data: DashboardData, entity: string, id: string, changedAt: string, recordKey: string, recordId: number) {
  const matches = data.change_logs.filter((row) => row.entity === entity && row.entity_id === id && row.changed_at === changedAt && String(row.new_data?.[recordKey] ?? row.old_data?.[recordKey] ?? "") === String(recordId));
  return matches.length === 1 ? matches[0].changed_by_email ?? matches[0].changed_by : null;
}

function workspaceSectionLabel(language: Language, section: WorkspaceSection) {
  if (section === "overview") return translate(language, "workspaceOverview");
  if (section === "activity") return translate(language, "workspaceActivity");
  if (section === "offer") return translate(language, "workspaceOffer");
  return translate(language, section);
}

function isWorkspaceSection(value: string | null): value is WorkspaceSection {
  return value === "overview" || value === "pipeline" || value === "sourcing" || value === "offer" || value === "activity";
}

function canSiteRecruiterViewRequisition(requisition: Pick<EnrichedRequisition, "site" | "person_in_charge">, profile: Profile | null | undefined) {
  if (profile?.role !== "site_recruiter") return true;
  const assignedSite = normalizeScopeValue(profile.site);
  const assignedRecruiter = normalizeScopeValue(profile.nickname);
  return (
    Boolean(assignedSite && normalizeScopeValue(requisition.site) === assignedSite)
    || Boolean(assignedRecruiter && normalizeScopeValue(requisition.person_in_charge) === assignedRecruiter)
  );
}

function normalizeScopeValue(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

function journeyStepLabel(language: Language, step: HiringJourneyStep) {
  const keys: Record<HiringJourneyStep["id"], string> = { requisition: "journeyRequisition", setup: "journeySetup", sourcing: "journeySourcing", candidates: "journeyCandidates", pipeline: "journeyPipeline", offer: "journeyOffer", closure: "journeyClosure" };
  return translate(language, keys[step.id]);
}

function journeyStateLabel(language: Language, state: HiringJourneyStep["state"]) {
  const keys: Record<HiringJourneyStep["state"], string> = { completed: "journeyCompleted", current: "journeyCurrent", attention: "journeyAttention", blocked: "journeyBlocked", not_started: "journeyNotStarted" };
  return translate(language, keys[state]);
}
