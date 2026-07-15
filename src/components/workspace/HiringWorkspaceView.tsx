"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OperationalSummaryStrip, RecordActionGroup } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { DataQualityPanel, SourcingConversionPanel } from "@/components/ui/Workflow";
import { ACTIVE_PIPELINE_STAGES, processLabel, SOURCING_CHANNELS } from "@/lib/constants";
import { enrichCandidates, enrichOffers, enrichRequisitions, enrichSourcingGroups } from "@/lib/data";
import { formatDate, resultText, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
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
type PickerMode = "requisitions" | "groups";

type WorkspaceUrlSelection = {
  target: WorkspaceTarget;
  section: WorkspaceSection;
  docId: string | null;
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
  profile = data.profile,
  onDispatchAction,
  pipelineSlot,
  sourcingSlot,
  offerSlot,
  selectedGroupDocId
}: {
  data: DashboardData;
  language: Language;
  target: WorkspaceTarget;
  weekStart: string;
  onOpenCandidate: (candidateId: string) => void;
  onOpenRequisition: (docId: string) => void;
  canWrite?: boolean;
  profile?: Profile | null;
  onDispatchAction?: (request: WorkspaceActionRequest) => void;
  pipelineSlot?: ReactNode;
  sourcingSlot?: ReactNode;
  offerSlot?: ReactNode;
  selectedGroupDocId?: string | null;
}) {
  const [urlState, setUrlState] = useState(() => readWorkspaceSelection(target, selectedGroupDocId));
  const [pickerOpen, setPickerOpen] = useState(() => !readWorkspaceSelection(target, selectedGroupDocId).target.type);
  const [pickerMode, setPickerMode] = useState<PickerMode>(() => readWorkspaceSelection(target, selectedGroupDocId).target.type === "group" ? "groups" : "requisitions");

  const requisitions = useMemo(() => enrichRequisitions(data), [data]);
  const candidates = useMemo(() => enrichCandidates(data), [data]);
  const offers = useMemo(() => enrichOffers(data), [data]);
  const groups = useMemo(() => enrichSourcingGroups(data, weekStart), [data, weekStart]);
  const activeOpenRequisitions = useMemo(() => requisitions.filter(isActiveOpenRequisition), [requisitions]);
  const activeOpenGroups = useMemo(() => {
    const activeDocIds = new Set(activeOpenRequisitions.map((row) => row.doc_id));
    return groups.filter((group) => group.open_headcount > 0 && group.doc_ids.some((docId) => activeDocIds.has(docId)));
  }, [activeOpenRequisitions, groups]);
  const allIssues = useMemo(() => deriveDataQualityIssues(data), [data]);
  const selectedTarget = urlState.target;
  const currentParams = readWorkspaceUrlState();
  const contextualHref = (path: string) => buildContextualHref(path, {
    language,
    site: currentParams.get("site"),
    owner: currentParams.get("pic"),
    sourcingWeek: currentParams.get("sourcingWeek") ?? weekStart
  });

  useEffect(() => {
    if (readWorkspaceUrlState().get("section") === "outcome") updateLegacyOutcomeSection();
    function syncFromHistory() {
      const next = readWorkspaceSelection(target, selectedGroupDocId);
      setUrlState(next);
      setPickerMode(next.target.type === "group" ? "groups" : "requisitions");
      setPickerOpen(!next.target.type);
    }

    syncFromHistory();
    window.addEventListener("popstate", syncFromHistory);
    window.addEventListener("workspace:urlchange", syncFromHistory);
    return () => {
      window.removeEventListener("popstate", syncFromHistory);
      window.removeEventListener("workspace:urlchange", syncFromHistory);
    };
  }, [selectedGroupDocId, target]);

  const context = selectedTarget.type === "requisition" && selectedTarget.id
    ? contextForRequisition(selectedTarget.id, data, activeOpenRequisitions, candidates, offers, activeOpenGroups, contextualHref)
    : selectedTarget.type === "group" && selectedTarget.id
      ? contextForGroup(selectedTarget.id, urlState.docId, data, activeOpenRequisitions, candidates, offers, activeOpenGroups, contextualHref)
      : null;
  const hasMultipleGroupDocuments = context?.type === "group" && context.requisitions.length > 1;
  const readiness = context?.primaryRequisition ? requisitionFillReadiness(context.primaryRequisition, candidates) : null;
  const sla = context?.primaryRequisition ? getRequisitionSlaState(context.primaryRequisition, { openOnly: true }) : null;
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
  const journey = hiringContext ? deriveHiringJourney(hiringContext) : [];

  function selectTarget(nextTarget: SelectedWorkspaceTarget) {
    const next = { target: nextTarget, section: "overview" as WorkspaceSection, docId: null };
    setUrlState(next);
    setPickerMode(nextTarget.type === "group" ? "groups" : "requisitions");
    setPickerOpen(false);
    pushWorkspaceUrlState({ type: nextTarget.type, id: nextTarget.id, section: next.section, doc: null });
  }

  function selectSection(section: WorkspaceSection) {
    setUrlState((current) => ({ ...current, section }));
    pushWorkspaceUrlState({ section });
  }

  function selectGroupDocument(docId: string) {
    setUrlState((current) => ({ ...current, docId }));
    pushWorkspaceUrlState({ doc: docId, section: urlState.section });
  }

  function showWorkspaceCatalog() {
    setUrlState({ target: { type: null, id: null }, section: "overview", docId: null });
    setPickerMode("requisitions");
    setPickerOpen(true);
  }

  function showGroup(groupId: string) {
    setUrlState({ target: { type: "group", id: groupId }, section: "overview", docId: null });
    setPickerMode("groups");
    setPickerOpen(false);
  }

  const primaryAction = context?.primaryRequisition
      ? { id: "open-requisition", label: translate(language, "openRequisition"), tone: "primary" as const, onSelect: () => onOpenRequisition(context.primaryRequisition!.doc_id) }
      : { id: "select-workspace", label: translate(language, "workspaceSelect"), tone: "primary" as const, onSelect: () => setPickerOpen(true) };
  const secondaryActions = context
    ? [
      { id: "change-workspace", label: translate(language, "workspaceChange"), onSelect: () => setPickerOpen(true) }
    ]
    : [
      { id: "browse-requisitions", label: translate(language, "requisitions"), onSelect: () => { setPickerMode("requisitions"); setPickerOpen(true); } },
      { id: "browse-groups", label: translate(language, "workspaceGroups"), onSelect: () => { setPickerMode("groups"); setPickerOpen(true); } }
    ];

  return (
    <div className="grid min-w-0 gap-4">
      {pickerOpen || !context ? null : <section className="sticky top-3 z-30 min-w-0 rounded-lg border border-[#C9D5E6] bg-white/95 p-3 shadow-[0_8px_20px_rgba(11,19,43,0.045)] backdrop-blur">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0">
            {context ? <WorkspaceBreadcrumbs
              workspace={{ label: translate(language, "workspace"), href: contextualHref("/workspace"), onSelect: showWorkspaceCatalog }}
              group={context.groups[0] ? { label: context.groups[0].group_id, href: contextualHref(`/workspace?type=group&id=${encodeURIComponent(context.groups[0].group_id)}&section=overview`), current: !context.primaryRequisition, onSelect: () => showGroup(context.groups[0].group_id) } : undefined}
              requisition={context.primaryRequisition ? { label: context.primaryRequisition.doc_id, href: context.groups[0] ? contextualHref(`/workspace?type=group&id=${encodeURIComponent(context.groups[0].group_id)}&doc=${encodeURIComponent(context.primaryRequisition.doc_id)}&section=overview`) : contextualHref(`/workspace?type=requisition&id=${encodeURIComponent(context.primaryRequisition.doc_id)}&section=overview`), current: true } : undefined}
            /> : null}
            <p className="text-xs font-medium uppercase tracking-normal text-slate">{translate(language, "workspace")}</p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-xl font-semibold text-navy">{context?.title ?? translate(language, "workspaceSelectTitle")}</h1>
              {readiness ? <Tag tone={readiness.tone}>{readiness.label}</Tag> : null}
              {sla ? <Tag tone={sla.isOverdue ? "danger" : "muted"}>{sla.label}</Tag> : null}
            </div>
            <p className="mt-1 break-words text-sm font-medium text-slate">{context?.meta ?? "Choose a requisition or sourcing group to focus the workspace."}</p>
          </div>
          <RecordActionGroup label={translate(language, "workspace")} primary={primaryAction} items={secondaryActions} />
        </div>

        {context ? (
          <div className="mt-3 min-w-0">
            <OperationalSummaryStrip
              items={[
                { label: "Open HC", value: context.openHeadcount, tone: context.openHeadcount > 0 ? "warning" : "success", helper: "Remaining demand" },
                { label: "Active", value: `${activeCandidates.length}/${context.candidates.length}`, tone: "teal", helper: "Active / total" },
                { label: "Aging", value: agingCandidates.length, tone: agingCandidates.length > 0 ? "danger" : "success", helper: ">7 days since touch" },
                { label: "Offers", value: `${pendingOffers.length}/${acceptedOffers.length}`, tone: pendingOffers.length > 0 ? "warning" : "success", helper: "Pending / accepted" }
              ]}
            />
          </div>
        ) : null}

        {context && !pickerOpen ? (
          <div role="tablist" aria-label="Hiring workspace sections" className="mt-3 flex min-w-0 gap-1 overflow-x-auto border-t border-[#D7DEE8] pt-3">
            {workspaceSections.map((section) => {
              const active = urlState.section === section;
              return (
                <button key={section} id={`workspace-tab-${section}`} type="button" role="tab" aria-selected={active} aria-controls={`workspace-panel-${section}`} className={`min-h-9 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors ${active ? "border-primary text-primary" : "border-transparent text-slate hover:border-[#C9D5E6] hover:text-navy"}`} onClick={() => selectSection(section)}>
                  {workspaceSectionLabel(language, section)}
                </button>
              );
            })}
          </div>
        ) : null}
      </section>}

      {pickerOpen || !context ? (
        <WorkspacePicker candidates={candidates} canCreate={canWrite && Boolean(onDispatchAction)} groups={activeOpenGroups} invalidTarget={Boolean(selectedTarget.type && selectedTarget.id && !context)} language={language} mode={pickerMode} onCreate={() => onDispatchAction?.({ kind: "requisition.create" })} onModeChange={setPickerMode} onSelect={selectTarget} requisitions={activeOpenRequisitions} />
      ) : (
        <div id={`workspace-panel-${urlState.section}`} role="tabpanel" aria-labelledby={`workspace-tab-${urlState.section}`} className="min-w-0">
          {hasMultipleGroupDocuments ? <GroupDocumentSelector language={language} requisitions={context.requisitions} selectedDocId={context.primaryRequisition?.doc_id ?? null} onSelect={selectGroupDocument} /> : null}
          {urlState.section === "overview" ? <OverviewSection canWrite={canWrite} context={context} contextIssues={contextIssues} journey={journey} language={language} onDispatchAction={onDispatchAction} /> : null}
          {urlState.section === "pipeline" ? pipelineSlot : null}
          {urlState.section === "sourcing" ? sourcingSlot ?? <SourcingFallbackSection data={data} groups={context.groups} weekStart={weekStart} /> : null}
          {urlState.section === "offer" ? offerSlot ?? <OfferSection context={context} data={data} requisitions={requisitions} /> : null}
          {urlState.section === "activity" ? <ActivitySection activity={context.activity} language={language} /> : null}
        </div>
      )}
    </div>
  );
}

function OverviewSection({ canWrite, context, contextIssues, journey, language, onDispatchAction }: { canWrite: boolean; context: WorkspaceContext; contextIssues: ReturnType<typeof deriveDataQualityIssues>; journey: HiringJourneyStep[]; language: Language; onDispatchAction?: (request: WorkspaceActionRequest) => void }) {
  const requisition = context.primaryRequisition;
  const actionDisabled = !requisition || !canWrite || !onDispatchAction;
  const actionTitle = !requisition
    ? "Select a requisition before editing it."
    : !canWrite
      ? "Your role can monitor this hiring case but cannot update it."
      : !onDispatchAction
        ? "This workspace action is not connected in the current screen."
        : undefined;

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
      <div className="grid min-w-0 gap-4">
        <Panel>
          <SectionTitle
            title={translate(language, "workspaceJourney")}
            eyebrow={translate(language, "workspaceCurrentPath")}
            action={requisition ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" disabled={actionDisabled} title={actionTitle} onClick={() => onDispatchAction?.({ kind: "requisition.edit", docId: requisition.doc_id })}>Edit</Button>
                <Button type="button" size="sm" variant="secondary" disabled={actionDisabled} title={actionTitle} onClick={() => onDispatchAction?.({ kind: "requisition.status", docId: requisition.doc_id })}>Change Status</Button>
              </div>
            ) : null}
          />
          <JourneyGuide language={language} steps={journey} />
        </Panel>
      </div>
      <DataQualityPanel compact issues={contextIssues} title={translate(language, "workspaceDataQuality")} />
    </div>
  );
}

function JourneyGuide({ language, steps }: { language: Language; steps: HiringJourneyStep[] }) {
  return (
    <ol className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {steps.map((step, index) => (
        <li key={step.id} className={`min-w-0 rounded-md border p-3 ${journeyClass(step.state)}`}>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate">{index + 1}. {journeyStepLabel(language, step)}</span>
            <span className="shrink-0 text-xs font-semibold">{journeyStateLabel(language, step.state)}</span>
          </div>
          <p className="mt-1 break-words text-xs font-medium text-slate">{step.detail}</p>
        </li>
      ))}
    </ol>
  );
}

function SourcingFallbackSection({ data, groups, weekStart }: { data: DashboardData; groups: EnrichedSourcingGroup[]; weekStart: string }) {
  return (
    <Panel>
      <SectionTitle title="Sourcing coverage" eyebrow="Read-only fallback" />
      <div className="grid min-w-0 gap-3">
        {groups.length === 0 ? <EmptyState message="No matched sourcing group for this workspace." /> : groups.map((group) => {
          const previous = sourcingPreviousUpdate(data, group.group_id, weekStart);
          const metrics = deriveSourcingConversionMetrics(data, group.group_id, weekStart);
          return (
            <article key={group.group_id} className="grid min-w-0 gap-3 rounded-md border border-[#D7DEE8] bg-white p-3">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><strong className="block break-words text-navy">{group.group_id} - {group.group_position}</strong><p className="text-sm font-medium text-slate">{group.sites.join(", ") || "-"} - {group.owners.join(", ") || "Unassigned"}</p></div><Tag tone={group.open_headcount > 0 ? "warning" : "success"}>{group.open_headcount} open</Tag></div>
              <p className="text-sm font-medium text-slate">This week: {sourcingApplicants(group.latest_update)} applicants. Previous week: {sourcingApplicants(previous)}. Enabled channels: {SOURCING_CHANNELS.filter((channel) => group[channel.enabled]).length}.</p>
              <SourcingConversionPanel metrics={metrics} />
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function OfferSection({ context, data, requisitions }: { context: WorkspaceContext; data: DashboardData; requisitions: EnrichedRequisition[] }) {
  return (
    <Panel>
      <SectionTitle title="Hiring offers" eyebrow="Offers and starts" />
      <div className="grid gap-2">
        {context.offers.length === 0 ? <EmptyState message="No offers are linked to this workspace." /> : context.offers.map((offer) => (
          <article key={offer.offer_id} className="min-w-0 rounded-md border border-[#D7DEE8] bg-white p-3">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><div className="min-w-0"><strong className="block break-words text-navy">{offer.candidate_name ?? offer.candidate_id}</strong>{context.requisitions.length > 1 ? <p className="text-sm font-medium text-slate">{offer.doc_id}</p> : null}</div><Tag tone={offerStatus(offer).tone}>{offerStatus(offer).label}</Tag></div>
            <p className="mt-2 break-words text-sm font-medium text-slate">{offerImpact(offer, data.offers, requisitions)}</p>
            <p className="text-xs font-medium text-cool">Accepted {formatDate(offer.accepted_date)} - Start {formatDate(offer.first_working_date)}</p>
          </article>
        ))}
      </div>
    </Panel>
  );
}

function ActivitySection({ activity, language }: { activity: WorkspaceActivity[]; language: Language }) {
  return (
    <Panel>
      <SectionTitle title={translate(language, "workspaceRecentActivity")} eyebrow={translate(language, "workspaceNewestFirst")} />
      <div className="grid min-w-0 gap-2">
        {activity.length === 0 ? <EmptyState message="No recent activity for this workspace." /> : activity.slice(0, 20).map((item) => (
          <Link key={item.id} href={item.href} className="grid min-w-0 gap-1 rounded-md border border-[#D7DEE8] bg-white p-3 transition-colors hover:border-primary/40 hover:bg-[#F8FAFD] focus:outline-none focus:ring-2 focus:ring-primary/25">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><strong className="break-words text-sm text-navy">{item.title}</strong><Tag tone={statusTone(item.tone) as never}>{item.tone}</Tag></div>
            <p className="break-words text-xs font-medium text-slate">{formatDate(item.date)} - {item.meta}</p>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function isActiveOpenRequisition(row: EnrichedRequisition) {
  return row.status === "ongoing" && row.open_headcount > 0;
}

function GroupDocumentSelector({ language, requisitions, selectedDocId, onSelect }: { language: Language; requisitions: EnrichedRequisition[]; selectedDocId: string | null; onSelect: (docId: string) => void }) {
  return (
    <Panel variant="subtle" className="mb-4">
      <SectionTitle title={translate(language, "workspaceRequisitionContext")} eyebrow={translate(language, "workspaceRequisitionContextHelp")} />
      <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
        {requisitions.map((requisition) => <button key={requisition.doc_id} type="button" aria-pressed={selectedDocId === requisition.doc_id} className={`min-h-9 shrink-0 rounded-md px-3 text-sm font-semibold ring-1 ring-inset transition-colors ${selectedDocId === requisition.doc_id ? "bg-primary text-white ring-primary" : "bg-white text-navy ring-[#C9D5E6] hover:bg-[#F8FAFD]"}`} onClick={() => onSelect(requisition.doc_id)}>{requisition.doc_id} - {requisition.position}</button>)}
      </div>
    </Panel>
  );
}

function WorkspacePicker({ candidates, canCreate, groups, invalidTarget, language, mode, onCreate, onModeChange, onSelect, requisitions }: { candidates: EnrichedCandidate[]; canCreate: boolean; groups: EnrichedSourcingGroup[]; invalidTarget: boolean; language: Language; mode: PickerMode; onCreate: () => void; onModeChange: (mode: PickerMode) => void; onSelect: (target: SelectedWorkspaceTarget) => void; requisitions: EnrichedRequisition[] }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRequisitions = requisitions.filter((row) => !normalizedQuery || [row.doc_id, row.position, row.site, row.department, row.person_in_charge].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery));
  const filteredGroups = groups.filter((group) => !normalizedQuery || [group.group_id, group.group_position, group.sites.join(" "), group.owners.join(" "), group.doc_ids.join(" ")].join(" ").toLowerCase().includes(normalizedQuery));
  const rows = mode === "requisitions" ? filteredRequisitions.slice(0, 12) : filteredGroups.slice(0, 12);
  return (
    <Panel className="min-w-0">
      <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-normal text-slate">{translate(language, "workspacePicker")}</p><h2 className="mt-1 text-lg font-semibold text-navy">{translate(language, "workspaceSelectTitle")}</h2>{invalidTarget ? <p className="mt-1 text-sm font-medium text-orange">The workspace in the URL was not found. Choose an available record.</p> : null}</div><div className="flex flex-wrap items-center gap-2">{canCreate ? <Button type="button" size="sm" onClick={onCreate}>{translate(language, "newRequisition")}</Button> : null}<div className="inline-flex w-fit rounded-md border border-[#C9D5E6] bg-[#F8FAFD] p-1" aria-label="Workspace record type">{(["requisitions", "groups"] as PickerMode[]).map((item) => <button key={item} type="button" className={`min-h-8 rounded px-3 text-sm font-semibold transition-colors ${mode === item ? "bg-white text-primary shadow-sm" : "text-slate hover:text-navy"}`} aria-pressed={mode === item} onClick={() => onModeChange(item)}>{item === "requisitions" ? translate(language, "requisitions") : translate(language, "workspaceGroups")}</button>)}</div></div></div>
      <label className="grid gap-1 text-sm font-semibold text-navy">{translate(language, "workspaceSearch")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, position, site, owner" className="min-h-10 w-full min-w-0 rounded-md border border-[#C9D5E6] bg-white px-3 text-sm font-medium text-navy outline-none placeholder:text-cool focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.length === 0 ? <EmptyState message="No matching workspaces." /> : null}
        {mode === "requisitions" ? (rows as EnrichedRequisition[]).map((row) => <button key={row.doc_id} type="button" className="grid min-w-0 gap-2 rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-[0_6px_16px_rgba(11,19,43,0.025)] transition hover:border-primary/40 hover:bg-[#F8FAFD]" onClick={() => onSelect({ type: "requisition", id: row.doc_id })}><div className="flex min-w-0 items-start justify-between gap-2"><strong className="break-words text-navy">{row.doc_id}</strong><Tag tone={row.open_headcount > 0 ? "warning" : "success"}>{row.open_headcount} open</Tag></div><p className="break-words font-medium text-slate">{row.position}</p><p className="text-xs font-medium text-cool">{row.site} - {row.person_in_charge ?? "-"} - {candidates.filter((candidate) => candidate.doc_ids.includes(row.doc_id)).length} candidates</p></button>) : (rows as EnrichedSourcingGroup[]).map((group) => <button key={group.group_id} type="button" className="grid min-w-0 gap-2 rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-[0_6px_16px_rgba(11,19,43,0.025)] transition hover:border-primary/40 hover:bg-[#F8FAFD]" onClick={() => onSelect({ type: "group", id: group.group_id })}><div className="flex min-w-0 items-start justify-between gap-2"><strong className="break-words text-navy">{group.group_id}</strong><Tag tone="muted">{group.candidate_count} candidates</Tag></div><p className="break-words font-medium text-slate">{group.group_position}</p><p className="text-xs font-medium text-cool">{group.sites.join(", ")} - {group.owners.join(", ") || "-"}</p></button>)}
      </div>
    </Panel>
  );
}

function readWorkspaceSelection(fallback: WorkspaceTarget, selectedGroupDocId?: string | null): WorkspaceUrlSelection {
  if (typeof window === "undefined") return { target: fallback, section: "overview", docId: selectedGroupDocId ?? null };
  const params = readWorkspaceUrlState();
  const type = params.get("type");
  const id = params.get("id");
  const rawSection = params.get("section");
  const section = rawSection === "outcome" ? "offer" : rawSection;
  return { target: (type === "requisition" || type === "group") && id ? { type, id } : { type: null, id: null }, section: isWorkspaceSection(section) ? section : "overview", docId: params.get("doc") ?? selectedGroupDocId ?? null };
}

function updateLegacyOutcomeSection() {
  const url = new URL(window.location.href);
  url.searchParams.set("section", "offer");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event("workspace:urlchange"));
}

function contextForRequisition(id: string, data: DashboardData, requisitions: EnrichedRequisition[], candidates: EnrichedCandidate[], offers: EnrichedOffer[], groups: EnrichedSourcingGroup[], contextualHref: (path: string) => string): WorkspaceContext | null {
  const requisition = requisitions.find((row) => row.doc_id === id);
  if (!requisition) return null;
  const matches = data.document_groups.filter((match) => match.doc_id === id);
  const groupIds = new Set(matches.map((match) => match.group_id).filter(Boolean) as string[]);
  const docGroupIds = groupIds.size > 0 ? new Set(data.document_groups.filter((match) => match.group_id && groupIds.has(match.group_id)).map((match) => match.doc_group_id)) : new Set(matches.map((match) => match.doc_group_id));
  const relatedCandidates = candidates.filter((candidate) => docGroupIds.has(candidate.doc_group_id) || candidate.doc_ids.includes(id));
  const relatedOffers = offers.filter((offer) => offer.doc_id === id);
  const relatedGroups = groups.filter((group) => groupIds.has(group.group_id));
  return { id, type: "requisition", title: `${requisition.doc_id} - ${requisition.position}`, meta: `${requisition.site} - ${requisition.department} - ${requisition.person_in_charge ?? "Unassigned"}`, primaryRequisition: requisition, requisitions: [requisition], groups: relatedGroups, candidates: relatedCandidates, offers: relatedOffers, openHeadcount: requisition.open_headcount, docGroupId: matches[0]?.doc_group_id ?? null, activity: activityForContext(data, relatedCandidates.map((row) => row.candidate_id), [id], [...groupIds], contextualHref) };
}

function contextForGroup(id: string, selectedDocId: string | null, data: DashboardData, requisitions: EnrichedRequisition[], candidates: EnrichedCandidate[], offers: EnrichedOffer[], groups: EnrichedSourcingGroup[], contextualHref: (path: string) => string): WorkspaceContext | null {
  const group = groups.find((row) => row.group_id === id);
  if (!group) return null;
  const matches = data.document_groups.filter((match) => match.group_id === id);
  const linkedDocIds = new Set(matches.map((match) => match.doc_id));
  const relatedRequisitions = requisitions.filter((row) => linkedDocIds.has(row.doc_id));
  const primaryRequisition = relatedRequisitions.length === 1 ? relatedRequisitions[0] : relatedRequisitions.find((row) => row.doc_id === selectedDocId) ?? null;
  const scopedMatches = primaryRequisition ? matches.filter((match) => match.doc_id === primaryRequisition.doc_id) : matches;
  const groupDocGroupIds = new Set(matches.map((match) => match.doc_group_id));
  const relatedCandidates = candidates.filter((candidate) => groupDocGroupIds.has(candidate.doc_group_id));
  const relatedOffers = offers.filter((offer) => primaryRequisition ? offer.doc_id === primaryRequisition.doc_id : linkedDocIds.has(offer.doc_id));
  return { id, type: "group", title: `${group.group_id} - ${group.group_position}`, meta: `${group.sites.join(", ") || "-"} - ${group.owners.join(", ") || "Unassigned"}`, primaryRequisition, requisitions: relatedRequisitions, groups: [group], candidates: relatedCandidates, offers: relatedOffers, openHeadcount: primaryRequisition?.open_headcount ?? group.open_headcount, docGroupId: primaryRequisition ? scopedMatches[0]?.doc_group_id ?? null : null, activity: activityForContext(data, relatedCandidates.map((row) => row.candidate_id), primaryRequisition ? [primaryRequisition.doc_id] : [...linkedDocIds], [id], contextualHref) };
}

function activityForContext(data: DashboardData, candidateIds: string[], docIds: string[], groupIds: string[], contextualHref: (path: string) => string): WorkspaceActivity[] {
  const candidateSet = new Set(candidateIds);
  const docSet = new Set(docIds);
  const groupSet = new Set(groupIds);
  return [
    ...data.recruitment_logs.filter((log) => candidateSet.has(log.candidate_id)).map((log) => ({ id: `log:${log.log_id}`, date: log.log_date, title: `${log.candidate_id} - ${processLabel(log.recruitment_process)}`, meta: `Round ${log.round} - ${resultText(log.result)}`, tone: resultText(log.result).toLowerCase(), href: contextualHref(`/pipeline?detailId=${encodeURIComponent(log.candidate_id)}`) })),
    ...data.requisition_logs.filter((log) => docSet.has(log.doc_id)).map((log) => ({ id: `reqlog:${log.log_id}`, date: log.log_date, title: `${log.doc_id} - status update`, meta: log.remark ?? "No remark", tone: log.status, href: contextualHref(`/requisitions?detailId=${encodeURIComponent(log.doc_id)}`) })),
    ...data.offers.filter((offer) => docSet.has(offer.doc_id) || candidateSet.has(offer.candidate_id)).map((offer) => ({ id: `offer:${offer.offer_id}`, date: offer.updated_at, title: `${offer.candidate_id} - offer`, meta: `Accepted ${formatDate(offer.accepted_date)} - Start ${formatDate(offer.first_working_date)}`, tone: offer.accepted_date ? "accepted" : "pending", href: contextualHref(`/offers?offerSearch=${encodeURIComponent(offer.doc_id)}`) })),
    ...data.sourcing_weekly_updates.filter((update) => groupSet.has(update.group_id)).map((update) => ({ id: `source:${update.group_id}:${update.week_start}`, date: update.updated_at, title: `${update.group_id} - sourcing update`, meta: `${sourcingApplicants(update)} applicants`, tone: "update", href: contextualHref(`/sourcing?sourceSearch=${encodeURIComponent(update.group_id)}`) }))
  ].sort((left, right) => right.date.localeCompare(left.date));
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

function journeyClass(state: HiringJourneyStep["state"]) {
  if (state === "attention") return "border-[#F3D3A2] bg-[#FFF7E8]";
  if (state === "blocked") return "border-[#F4B4AE] bg-[#FFF1F0]";
  if (state === "completed") return "border-[#C9D5E6] bg-[#F8FAFD]";
  if (state === "current") return "border-[#C9D5E6] bg-[#F8FAFD]";
  return "border-[#D7DEE8] bg-lightgray/65";
}

function journeyStepLabel(language: Language, step: HiringJourneyStep) {
  const keys: Record<HiringJourneyStep["id"], string> = { requisition: "journeyRequisition", setup: "journeySetup", sourcing: "journeySourcing", candidates: "journeyCandidates", pipeline: "journeyPipeline", offer: "journeyOffer", closure: "journeyClosure" };
  return translate(language, keys[step.id]);
}

function journeyStateLabel(language: Language, state: HiringJourneyStep["state"]) {
  const keys: Record<HiringJourneyStep["state"], string> = { completed: "journeyCompleted", current: "journeyCurrent", attention: "journeyAttention", blocked: "journeyBlocked", not_started: "journeyNotStarted" };
  return translate(language, keys[state]);
}
