"use client";

import type { KeyboardEvent } from "react";
import { useRef, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { OperationalSummaryStrip, RecordActionList } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { StageRail } from "@/components/ui/StageRail";
import { Tag } from "@/components/ui/Tag";
import { DataQualityIssueCard } from "@/components/ui/Workflow";
import { ACTIVE_PIPELINE_STAGES, processLabel } from "@/lib/constants";
import { formatDateTime, formatNumber, statusTone, toTitle } from "@/lib/format";
import { actionToneLabel, translate } from "@/lib/i18n/dictionary";
import { deriveWorkQueue, isCandidateAging, type DataQualityIssue } from "@/lib/operations";
import { getRequisitionSlaState } from "@/lib/sla";
import type { ChangeLog, EnrichedCandidate, EnrichedOffer, EnrichedRequisition, EnrichedSourcingGroup, Language, Profile } from "@/types/recruitment";

type HomeTabKey = "open_headcount" | "candidate_pipeline" | "sourcing_updates" | "data_quality" | "recent_activity";

type HomeTab = {
  key: HomeTabKey;
  label: string;
  count: number;
};

export function HomeView({
  language,
  profile,
  requisitions,
  candidates,
  offers,
  staleSourcingGroups,
  changeLogs,
  dataQualityIssues,
  canViewRecentActivity,
  onOpenRequisition,
  onOpenCandidate
}: {
  language: Language;
  profile: Profile | null;
  requisitions: EnrichedRequisition[];
  candidates: EnrichedCandidate[];
  offers: EnrichedOffer[];
  staleSourcingGroups: EnrichedSourcingGroup[];
  changeLogs: ChangeLog[];
  dataQualityIssues: DataQualityIssue[];
  canViewRecentActivity: boolean;
  onOpenRequisition: (docId: string) => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const notFilledRequisitions = requisitions.filter((row) => row.status !== "filled" && row.status !== "cancel");
  const openRequisitions = notFilledRequisitions.filter((row) => row.open_headcount > 0);
  const offeredCandidateIds = new Set(offers.map((offer) => offer.candidate_id));
  const ongoingCandidates = candidates.filter(
    (row) => row.latest_process !== "No activity"
      && ACTIVE_PIPELINE_STAGES.includes(row.latest_process)
      && row.latest_result !== 0
      && !offeredCandidateIds.has(row.candidate_id)
  );
  const needsAction = [...openRequisitions].sort(compareByRequisitionAgeDesc);
  const workQueue = deriveWorkQueue({ candidates, offers, profile, requisitions, staleSourcingGroups });
  const urgentCandidates = candidates.filter(isCandidateAging).length;
  const tabs: HomeTab[] = [
    { key: "open_headcount", label: translate(language, "openHeadcount"), count: needsAction.length },
    { key: "candidate_pipeline", label: translate(language, "candidatePipeline"), count: ongoingCandidates.length },
    { key: "sourcing_updates", label: translate(language, "SourcingUpdates"), count: staleSourcingGroups.length },
    { key: "data_quality", label: translate(language, "dataQuality"), count: dataQualityIssues.length },
    ...(canViewRecentActivity ? [{ key: "recent_activity" as const, label: translate(language, "recentActivity"), count: changeLogs.length }] : [])
  ];

  return (
    <div className="grid gap-5">
      <Panel variant="primary">
        <SectionTitle
          title={profile?.role === "viewer" ? translate(language, "workspaceWatchlist") : translate(language, "todaysWork")}
          eyebrow={profile?.role === "viewer" ? translate(language, "monitoringView") : translate(language, "prioritizedRecruiterActions")}
        />
        <div className="mb-3">
          <OperationalSummaryStrip
            density="compact"
            items={[
              { label: translate(language, "openRequisition"), value: openRequisitions.length, tone: openRequisitions.length > 0 ? "warning" : "success", helper: translate(language, "openHeadcount") },
              { label: translate(language, "urgentItems"), value: workQueue.length, tone: workQueue.length > 0 ? "warning" : "success", helper: profile?.role === "viewer" ? translate(language, "readOnlyWatchlist") : translate(language, "sortedByRisk") },
              { label: translate(language, "agingCandidates"), value: urgentCandidates, tone: urgentCandidates > 0 ? "danger" : "success", helper: translate(language, "lastTouchOlderThan7Days") },
              { label: translate(language, "sourcingGaps"), value: staleSourcingGroups.length, tone: staleSourcingGroups.length > 0 ? "warning" : "success", helper: translate(language, "openGroupsNeedingUpdates") }
            ]}
          />
        </div>
        <RecordActionList
          emptyMessage={profile?.role === "viewer" ? translate(language, "noMonitoredRecordsNeedAttention") : translate(language, "noUrgentAssignedWork")}
          items={workQueue}
          layout={workQueue.length > 4 ? "horizontal" : "stack"}
          onOpenCandidate={onOpenCandidate}
          onOpenRequisition={onOpenRequisition}
        />
      </Panel>

      <HomeRecordTabs
        changeLogs={changeLogs}
        dataQualityIssues={dataQualityIssues}
        language={language}
        needsAction={needsAction}
        ongoingCandidates={ongoingCandidates}
        onOpenCandidate={onOpenCandidate}
        onOpenRequisition={onOpenRequisition}
        staleSourcingGroups={staleSourcingGroups}
        tabs={tabs}
      />
    </div>
  );
}

function HomeRecordTabs({
  changeLogs,
  dataQualityIssues,
  language,
  needsAction,
  ongoingCandidates,
  onOpenCandidate,
  onOpenRequisition,
  staleSourcingGroups,
  tabs
}: {
  changeLogs: ChangeLog[];
  dataQualityIssues: DataQualityIssue[];
  language: Language;
  needsAction: EnrichedRequisition[];
  ongoingCandidates: EnrichedCandidate[];
  onOpenCandidate: (candidateId: string) => void;
  onOpenRequisition: (docId: string) => void;
  staleSourcingGroups: EnrichedSourcingGroup[];
  tabs: HomeTab[];
}) {
  const [activeTab, setActiveTab] = useState<HomeTabKey>("open_headcount");
  const tabRefs = useRef<Partial<Record<HomeTabKey, HTMLButtonElement | null>>>({});
  const selectedTab = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];

  function selectTab(key: HomeTabKey) {
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
        className="flex min-w-0 gap-0 overflow-x-auto rounded-t-2xl border-b border-[#C9D5E6] bg-[#EEF3F8] px-1 pt-1"
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
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-t-xl border px-4 text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                selected
                  ? "relative z-10 border-[#C9D5E6] border-b-white bg-white text-navy shadow-[0_-3px_12px_rgba(11,19,43,0.05)]"
                  : "border-transparent bg-transparent text-slate hover:bg-white/80 hover:text-navy"
              }`}
              id={`home-record-tab-${tab.key}`}
              onClick={() => selectTab(tab.key)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.key)}
              role="tab"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span>{tab.label}</span>
              <span aria-hidden="true" className={`inline-flex min-w-6 justify-center rounded-md px-1.5 py-0.5 text-xs ${selected ? "bg-primary/10 text-primary" : "bg-white/80 text-slate"}`}>{formatNumber(tab.count, language)}</span>
            </button>
          );
        })}
      </div>

      <div
        aria-labelledby={`home-record-tab-${selectedTab.key}`}
        className="grid max-h-[min(62dvh,44rem)] gap-3 overflow-y-auto overscroll-y-contain rounded-b-2xl rounded-tr-2xl border border-[#C9D5E6] border-t-0 bg-white p-3 pr-2 shadow-[0_8px_24px_rgba(11,19,43,0.045)] md:grid-cols-2"
        id={`home-record-panel-${selectedTab.key}`}
        role="tabpanel"
        tabIndex={0}
      >
        {selectedTab.key === "open_headcount" ? (
          needsAction.length === 0 ? <TabEmptyState message={translate(language, "noOpenHeadcount")} /> : needsAction.map((row) => <NeedActionCard key={row.doc_id} language={language} onOpenRequisition={onOpenRequisition} row={row} />)
        ) : null}
        {selectedTab.key === "candidate_pipeline" ? (
          ongoingCandidates.length === 0 ? <TabEmptyState message={translate(language, "noActiveCandidates")} /> : ongoingCandidates.map((candidate) => <CandidateActionCard key={candidate.candidate_id} candidate={candidate} language={language} onOpenCandidate={onOpenCandidate} />)
        ) : null}
        {selectedTab.key === "sourcing_updates" ? (
          staleSourcingGroups.length === 0 ? <TabEmptyState message={translate(language, "noStaleSourcingUpdates")} /> : staleSourcingGroups.map((group) => <SourcingUpdateCard key={group.group_id} group={group} language={language} />)
        ) : null}
        {selectedTab.key === "data_quality" ? (
          dataQualityIssues.length === 0 ? <TabEmptyState message={translate(language, "noDataQualityIssues")} /> : dataQualityIssues.map((issue) => <DataQualityIssueCard key={issue.id} issue={issue} language={language} />)
        ) : null}
        {selectedTab.key === "recent_activity" ? (
          changeLogs.length === 0 ? <TabEmptyState message={translate(language, "noRecentActivity")} /> : changeLogs.map((log) => <RecentActivityCard key={log.log_id} language={language} log={log} />)
        ) : null}
      </div>
    </Panel>
  );
}

function TabEmptyState({ message }: { message: string }) {
  return <div className="md:col-span-2"><EmptyState variant="quiet" message={message} /></div>;
}

function NeedActionCard({
  language,
  row,
  onOpenRequisition
}: {
  language: Language;
  row: EnrichedRequisition;
  onOpenRequisition: (docId: string) => void;
}) {
  const slaState = getRequisitionSlaState(row, { openOnly: true });
  return (
    <button
      type="button"
      className="ats-card grid touch-manipulation gap-1 p-3 text-left"
      onClick={() => onOpenRequisition(row.doc_id)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className={slaState.isOverdue ? "text-scarlet" : "text-navy"}>{row.doc_id} - {row.position}</strong>
        <Tag tone="warning">{translate(language, "openCount", { count: row.open_headcount })}</Tag>
      </div>
      <p className="text-sm font-medium text-slate">{row.department} - {row.site} - {row.person_in_charge ?? translate(language, "unassigned")}</p>
      <p className="text-xs font-medium text-slate">{translate(language, "ageLabel")}: {slaState.ageDays === null ? "-" : `${slaState.ageDays}d`} - {translate(language, "slaLabel")}: {slaState.label}</p>
    </button>
  );
}

function CandidateActionCard({
  candidate,
  language,
  onOpenCandidate
}: {
  candidate: EnrichedCandidate;
  language: Language;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const needsOfferFinalization = candidate.latest_process === "Offer" && candidate.latest_result === 1;
  return (
    <button
      type="button"
      className="ats-card grid touch-manipulation gap-2 p-3 text-left"
      onClick={() => onOpenCandidate(candidate.candidate_id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block truncate text-navy">{candidate.name}</strong>
          <p className="text-xs font-medium text-slate">{candidate.candidate_id} - {candidate.group_position ?? "-"}</p>
        </div>
        <Tag tone={needsOfferFinalization ? "warning" : "primary"}>
          {needsOfferFinalization ? translate(language, "offerPending") : processLabel(candidate.latest_process, language)}
        </Tag>
      </div>
      <StageRail compact language={language} currentStage={candidate.latest_process} currentResult={candidate.latest_result} />
      <p className="text-xs font-medium text-slate">{candidate.site ?? "-"} - {candidate.person_in_charge ?? translate(language, "unassigned")}</p>
      <span className="text-xs font-semibold text-navy">{translate(language, "open")}</span>
    </button>
  );
}

function SourcingUpdateCard({ group, language }: { group: EnrichedSourcingGroup; language: Language }) {
  return (
    <Link
      className="ats-card grid touch-manipulation gap-1 p-3 text-left"
      href="/sourcing"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-navy">{group.group_id} - {group.group_position}</strong>
        <Tag tone="warning">{translate(language, "openCount", { count: group.open_headcount })}</Tag>
      </div>
      <p className="text-sm font-medium text-slate">
        {translate(language, "docs")}: {group.doc_ids.join(", ")} - {translate(language, "sites")}: {group.sites.join(", ")} - {translate(language, "owners")}: {group.owners.join(", ") || translate(language, "unassigned")}
      </p>
      <p className="text-xs font-medium text-cool">
        {translate(language, "lastSaved")}: {group.latest_update?.updated_at ? formatDateTime(group.latest_update.updated_at) : translate(language, "notUpdatedYet")}
      </p>
    </Link>
  );
}

function RecentActivityCard({ language, log }: { language: Language; log: ChangeLog }) {
  return (
    <article className="ats-card-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm text-navy">{toTitle(log.entity)} - {log.entity_id}</strong>
        <Tag tone={statusTone(log.action) as never}>{actionToneLabel(language, log.action)}</Tag>
      </div>
      <p className="mt-1 text-sm font-medium text-slate">{log.changed_by_email ?? translate(language, "system")} - {formatDateTime(log.changed_at)}</p>
    </article>
  );
}

function compareByRequisitionAgeDesc(a: EnrichedRequisition, b: EnrichedRequisition) {
  const ageA = getRequisitionSlaState(a, { openOnly: true }).ageDays;
  const ageB = getRequisitionSlaState(b, { openOnly: true }).ageDays;
  if (ageA === null && ageB === null) return b.open_headcount - a.open_headcount;
  if (ageA === null) return 1;
  if (ageB === null) return -1;
  return ageB - ageA || b.open_headcount - a.open_headcount;
}
