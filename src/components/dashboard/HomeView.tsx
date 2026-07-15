"use client";

import { CalendarClock, CheckCircle2, FileText, UsersRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { OperationalSummaryStrip, RecordActionList } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { StageRail } from "@/components/ui/StageRail";
import { StatCard } from "@/components/ui/StatCard";
import { Tag } from "@/components/ui/Tag";
import { BottleneckSummaryPanel, DataQualityPanel } from "@/components/ui/Workflow";
import { ACTIVE_PIPELINE_STAGES, processLabel } from "@/lib/constants";
import { formatDateTime, formatNumber, statusTone, toTitle } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { derivePipelineBottlenecks, deriveWorkQueue, isCandidateAging, type DataQualityIssue } from "@/lib/operations";
import { getRequisitionSlaState } from "@/lib/sla";
import type { ChangeLog, EnrichedCandidate, EnrichedOffer, EnrichedRequisition, EnrichedSourcingGroup, Language, Profile, RecruitmentLog } from "@/types/recruitment";

export function HomeView({
  language,
  profile,
  requisitions,
  candidates,
  offers,
  staleSourcingGroups,
  changeLogs,
  recruitmentLogs,
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
  recruitmentLogs: RecruitmentLog[];
  dataQualityIssues: DataQualityIssue[];
  canViewRecentActivity: boolean;
  onOpenRequisition: (docId: string) => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const activeRequisitions = requisitions.filter((row) => row.status === "ongoing");
  const notFilledRequisitions = requisitions.filter((row) => row.status !== "filled" && row.status !== "cancel");
  const vacancyBaseRequisitions = requisitions.filter((row) => row.status !== "cancel");
  const filledVacancy = vacancyBaseRequisitions.reduce((sum, row) => sum + row.accepted_count, 0);
  const totalVacancy = vacancyBaseRequisitions.reduce((sum, row) => sum + row.head_count, 0);
  const openRequisitions = notFilledRequisitions.filter((row) => row.open_headcount > 0);
  const ownerName = profile?.nickname ?? profile?.full_name ?? "";
  const responsibleUnfilled = activeRequisitions.filter((row) => row.open_headcount > 0 && row.person_in_charge === ownerName);
  const offeredCandidateIds = new Set(offers.map((offer) => offer.candidate_id));
  const ongoingCandidates = candidates.filter(
    (row) => row.latest_process !== "No activity"
      && ACTIVE_PIPELINE_STAGES.includes(row.latest_process)
      && row.latest_result !== 0
      && !offeredCandidateIds.has(row.candidate_id)
  );
  const needsAction = notFilledRequisitions
    .filter((row) => row.open_headcount > 0)
    .sort(compareByRequisitionAgeDesc);
  const pipelinePreview = ongoingCandidates.slice(0, 8);
  const workQueue = deriveWorkQueue({ candidates, offers, profile, requisitions, staleSourcingGroups });
  const bottleneckSummary = profile?.role === "admin_recruiter" || profile?.role === "site_recruiter"
    ? derivePipelineBottlenecks(candidates, recruitmentLogs)
    : null;
  const urgentCandidates = candidates.filter(isCandidateAging).length;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label={translate(language, "openRequisition")} value={summaryValue(formatNumber(openRequisitions.length, language), translate(language, "requisitionsUnit"))} icon={<FileText size={22} />} />
        <StatCard label={translate(language, "filledVacancy")} value={summaryValue(`${formatNumber(filledVacancy, language)}/${formatNumber(totalVacancy, language)}`, translate(language, "vacancyUnit"))} icon={<CheckCircle2 size={22} />} />
        <StatCard label={translate(language, "ongoingCandidates")} value={summaryValue(formatNumber(ongoingCandidates.length, language), translate(language, "candidatesUnit"))} icon={<UsersRound size={22} />} />
        <StatCard label={translate(language, "SourcingUpdates")} value={summaryValue(formatNumber(staleSourcingGroups.length, language), translate(language, "groupIdUnit"))} icon={<CalendarClock size={22} />} />
      </div>

      {bottleneckSummary ? <BottleneckSummaryPanel summary={bottleneckSummary} /> : null}

      <Panel variant="section">
        <SectionTitle
          title={profile?.role === "viewer" ? "Workspace Watchlist" : "Today's Work"}
          eyebrow={profile?.role === "viewer" ? "Monitoring view" : "Prioritized recruiter actions"}
        />
        <div className="mb-3">
          <OperationalSummaryStrip
            items={[
              { label: "Urgent items", value: workQueue.length, tone: workQueue.length > 0 ? "warning" : "success", helper: profile?.role === "viewer" ? "Read-only watchlist" : "Sorted by risk" },
              { label: "Aging candidates", value: urgentCandidates, tone: urgentCandidates > 0 ? "danger" : "success", helper: "Last touch older than 7 days" },
              { label: "Sourcing gaps", value: staleSourcingGroups.length, tone: staleSourcingGroups.length > 0 ? "warning" : "success", helper: "Open groups needing updates" }
            ]}
          />
        </div>
        <RecordActionList
          emptyMessage={profile?.role === "viewer" ? "No monitored records need attention right now." : "No urgent assigned work right now."}
          items={workQueue}
          layout={workQueue.length > 3 ? "horizontal" : "stack"}
          onOpenCandidate={onOpenCandidate}
          onOpenRequisition={onOpenRequisition}
        />
      </Panel>

      <DataQualityPanel compact issues={dataQualityIssues} scrollThreshold={3} title="Data Quality" />

      <Panel variant="section">
        <SectionTitle
          title={translate(language, "candidatePipeline")}
          action={<Link className="text-sm font-semibold text-primary hover:text-[#082BB0]" href="/pipeline">{translate(language, "fullPipeline")}</Link>}
        />
        <HomeListFrame count={pipelinePreview.length} threshold={4} ariaLabel="Candidate Pipeline" gridClassName="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {pipelinePreview.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-4">
              <EmptyState message={translate(language, "noActiveCandidates")} />
            </div>
          ) : (
            pipelinePreview.map((candidate) => (
              <CandidateActionCard key={candidate.candidate_id} candidate={candidate} language={language} scrolling={pipelinePreview.length > 4} onOpenCandidate={onOpenCandidate} />
            ))
          )}
        </HomeListFrame>
      </Panel>

      <Panel>
        <SectionTitle
          title={translate(language, "SourcingUpdates")}
          action={<Link className="text-sm font-semibold text-primary hover:text-[#082BB0]" href="/sourcing">{translate(language, "sourcing")}</Link>}
        />
        <HomeListFrame count={staleSourcingGroups.length} threshold={3} ariaLabel="Sourcing Updates">
          {staleSourcingGroups.length === 0 ? (
            <EmptyState message={translate(language, "noStaleSourcingUpdates")} />
          ) : (
            staleSourcingGroups.map((group) => (
              <Link
                key={group.group_id}
                className={`grid touch-manipulation gap-1 rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-[0_6px_16px_rgba(11,19,43,0.025)] transition-colors motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 hover:border-primary/40 hover:bg-[#F8FAFD] ${staleSourcingGroups.length > 3 ? homeScrollItemClass : ""}`}
                href="/sourcing"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-navy">{group.group_id} - {group.group_position}</strong>
                  <Tag tone="warning">{group.open_headcount} {translate(language, "open")}</Tag>
                </div>
                <p className="text-sm font-medium text-slate">
                  Docs: {group.doc_ids.join(", ")} - Sites: {group.sites.join(", ")} - Owners: {group.owners.join(", ") || translate(language, "unassigned")}
                </p>
                <p className="text-xs font-medium text-cool">
                  {translate(language, "lastSaved")}: {group.latest_update?.updated_at ? formatDateTime(group.latest_update.updated_at) : translate(language, "notUpdatedYet")}
                </p>
              </Link>
            ))
          )}
        </HomeListFrame>
      </Panel>

      <Panel>
        <SectionTitle
          title="Open Headcount"
          action={<Link className="text-sm font-semibold text-primary hover:text-[#082BB0]" href="/requisitions">{translate(language, "openList")}</Link>}
        />
        <HomeListFrame count={needsAction.length} threshold={3} ariaLabel="Open Headcount">
          {needsAction.length === 0 ? (
            <EmptyState message={translate(language, "noOpenHeadcount")} />
          ) : (
            needsAction.map((row) => (
              <NeedActionCard
                key={row.doc_id}
                language={language}
                row={row}
                scrolling={needsAction.length > 3}
                onOpenRequisition={onOpenRequisition}
              />
            ))
          )}
        </HomeListFrame>
      </Panel>

      {canViewRecentActivity ? (
        <Panel variant="subtle">
          <SectionTitle
            title={translate(language, "recentActivity")}
            action={<Link className="text-sm font-semibold text-primary hover:text-[#082BB0]" href="/audit">{translate(language, "audit")}</Link>}
          />
          <HomeListFrame count={changeLogs.length} threshold={3} ariaLabel="Recent Activity">
            {changeLogs.length === 0 ? (
              <EmptyState message={translate(language, "noRecentActivity")} />
            ) : (
              changeLogs.map((log) => (
                <div key={log.log_id} className={`rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3 shadow-none ${changeLogs.length > 3 ? homeScrollItemClass : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-navy">{toTitle(log.entity)} - {log.entity_id}</strong>
                    <Tag tone={statusTone(log.action) as never}>{log.action}</Tag>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate">{log.changed_by_email ?? translate(language, "system")} - {formatDateTime(log.changed_at)}</p>
                </div>
              ))
            )}
          </HomeListFrame>
        </Panel>
      ) : null}
    </div>
  );
}

const homeScrollItemClass = "w-[min(22rem,82vw)] shrink-0 snap-start";

function HomeListFrame({
  ariaLabel,
  children,
  count,
  gridClassName = "grid gap-2",
  threshold
}: {
  ariaLabel: string;
  children: ReactNode;
  count: number;
  gridClassName?: string;
  threshold: number;
}) {
  if (count <= threshold) {
    return <div className={gridClassName}>{children}</div>;
  }
  return (
    <div
      aria-label={`${ariaLabel} scrollable list`}
      className="flex snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2"
      data-home-scroll-section={ariaLabel}
    >
      {children}
    </div>
  );
}

function NeedActionCard({
  language,
  scrolling = false,
  row,
  onOpenRequisition
}: {
  language: Language;
  scrolling?: boolean;
  row: EnrichedRequisition;
  onOpenRequisition: (docId: string) => void;
}) {
  const slaState = getRequisitionSlaState(row, { openOnly: true });
  return (
    <button
      type="button"
      className={`grid touch-manipulation gap-1 rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-[0_6px_16px_rgba(11,19,43,0.025)] transition-colors motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 hover:border-primary/40 hover:bg-[#F8FAFD] ${scrolling ? homeScrollItemClass : ""}`}
      onClick={() => onOpenRequisition(row.doc_id)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className={slaState.isOverdue ? "text-scarlet" : "text-navy"}>{row.doc_id} - {row.position}</strong>
        <Tag tone="warning">{row.open_headcount} {translate(language, "open")}</Tag>
      </div>
      <p className="text-sm font-medium text-slate">{row.department} - {row.site} - {row.person_in_charge ?? translate(language, "unassigned")}</p>
      <p className="text-xs font-medium text-slate">Age: {slaState.ageDays === null ? "-" : `${slaState.ageDays}d`} - SLA: {slaState.label}</p>
    </button>
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

function summaryValue(value: string, unit: string) {
  return (
    <span className="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
      <span className="text-2xl font-semibold leading-none text-navy">{value}</span>
      <span className="text-lg font-normal leading-none text-slate">{unit}</span>
    </span>
  );
}

function CandidateActionCard({
  candidate,
  language,
  scrolling = false,
  onOpenCandidate
}: {
  candidate: EnrichedCandidate;
  language: Language;
  scrolling?: boolean;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const needsOfferFinalization = candidate.latest_process === "Offer" && candidate.latest_result === 1;
  return (
    <button
      type="button"
      className={`grid touch-manipulation gap-2 rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-[0_6px_16px_rgba(11,19,43,0.025)] transition-colors motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 hover:border-primary/40 hover:bg-[#F8FAFD] ${scrolling ? homeScrollItemClass : ""}`}
      onClick={() => onOpenCandidate(candidate.candidate_id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block truncate text-navy">{candidate.name}</strong>
          <p className="text-xs font-medium text-slate">{candidate.candidate_id} - {candidate.group_position ?? "-"}</p>
        </div>
        <Tag tone={needsOfferFinalization ? "warning" : "teal"}>
          {needsOfferFinalization ? "Offer pending" : processLabel(candidate.latest_process)}
        </Tag>
      </div>
      <StageRail compact currentStage={candidate.latest_process} currentResult={candidate.latest_result} />
      <p className="text-xs font-medium text-slate">{candidate.site ?? "-"} - {candidate.person_in_charge ?? translate(language, "unassigned")}</p>
      <span className="text-xs font-semibold text-primary">Open</span>
    </button>
  );
}
