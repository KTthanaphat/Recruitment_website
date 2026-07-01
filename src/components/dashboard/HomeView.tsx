"use client";

import { CalendarClock, CheckCircle2, FileText, UsersRound } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { StageRail } from "@/components/ui/StageRail";
import { StatCard } from "@/components/ui/StatCard";
import { Tag } from "@/components/ui/Tag";
import { ACTIVE_PIPELINE_STAGES, processLabel } from "@/lib/constants";
import { formatDateTime, formatNumber, statusTone, toTitle } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { ChangeLog, EnrichedCandidate, EnrichedRequisition, EnrichedSourcingGroup, Language, Offer, Profile } from "@/types/recruitment";

export function HomeView({
  language,
  profile,
  requisitions,
  candidates,
  offers,
  staleSourcingGroups,
  changeLogs,
  canViewRecentActivity,
  onOpenRequisition,
  onOpenCandidate
}: {
  language: Language;
  profile: Profile | null;
  requisitions: EnrichedRequisition[];
  candidates: EnrichedCandidate[];
  offers: Offer[];
  staleSourcingGroups: EnrichedSourcingGroup[];
  changeLogs: ChangeLog[];
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
    .sort((a, b) => b.open_headcount - a.open_headcount)
    .slice(0, 6);
  const pipelinePreview = ongoingCandidates.slice(0, 8);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label={translate(language, "openRequisition")} value={summaryValue(formatNumber(openRequisitions.length, language), translate(language, "requisitionsUnit"))} icon={<FileText size={22} />} />
        <StatCard label={translate(language, "filledVacancy")} value={summaryValue(`${formatNumber(filledVacancy, language)}/${formatNumber(totalVacancy, language)}`, translate(language, "vacancyUnit"))} icon={<CheckCircle2 size={22} />} />
        <StatCard label={translate(language, "ongoingCandidates")} value={summaryValue(formatNumber(ongoingCandidates.length, language), translate(language, "candidatesUnit"))} icon={<UsersRound size={22} />} />
        <StatCard label={translate(language, "SourcingUpdates")} value={summaryValue(formatNumber(staleSourcingGroups.length, language), translate(language, "groupIdUnit"))} icon={<CalendarClock size={22} />} />
      </div>

      <Panel variant="section">
        <SectionTitle
          title={translate(language, "candidatePipeline")}
          action={<Link className="text-sm font-bold text-primary hover:text-primary" href="/pipeline">{translate(language, "fullPipeline")}</Link>}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {pipelinePreview.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-4">
              <EmptyState message={translate(language, "noActiveCandidates")} />
            </div>
          ) : (
            pipelinePreview.map((candidate) => (
              <CandidateActionCard key={candidate.candidate_id} candidate={candidate} language={language} onOpenCandidate={onOpenCandidate} />
            ))
          )}
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          title={translate(language, "SourcingUpdates")}
          action={<Link className="text-sm font-bold text-primary hover:text-primary" href="/sourcing">{translate(language, "sourcing")}</Link>}
        />
        <div className="grid gap-2">
          {staleSourcingGroups.length === 0 ? (
            <EmptyState message={translate(language, "noStaleSourcingUpdates")} />
          ) : (
            staleSourcingGroups.slice(0, 6).map((group) => (
              <Link
                key={group.group_id}
                className="grid touch-manipulation gap-1 rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-sm transition-colors motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 hover:border-primary/40 hover:bg-[#EEF4FF] hover:shadow-panel"
                href="/sourcing"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-navy">{group.group_id} - {group.group_position}</strong>
                  <Tag tone="warning">{group.open_headcount} {translate(language, "open")}</Tag>
                </div>
                <p className="text-sm font-bold text-slate">
                  Docs: {group.doc_ids.join(", ")} - Sites: {group.sites.join(", ")} - Owners: {group.owners.join(", ") || translate(language, "unassigned")}
                </p>
                <p className="text-xs font-bold text-cool">
                  {translate(language, "lastSaved")}: {group.latest_update?.updated_at ? formatDateTime(group.latest_update.updated_at) : translate(language, "notUpdatedYet")}
                </p>
              </Link>
            ))
          )}
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          title={translate(language, "needsAction")}
          action={<Link className="text-sm font-bold text-primary hover:text-primary" href="/requisitions">{translate(language, "openList")}</Link>}
        />
        <div className="grid gap-2">
          {needsAction.length === 0 ? (
            <EmptyState message={translate(language, "noOpenHeadcount")} />
          ) : (
            needsAction.map((row) => (
              <button
                key={row.doc_id}
                type="button"
                className="grid touch-manipulation gap-1 rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-sm transition-colors motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 hover:border-primary/40 hover:bg-[#EEF4FF] hover:shadow-panel"
                onClick={() => onOpenRequisition(row.doc_id)}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-navy">{row.doc_id} - {row.position}</strong>
                  <Tag tone="warning">{row.open_headcount} {translate(language, "open")}</Tag>
                </div>
                <p className="text-sm font-bold text-slate">{row.department} - {row.site} - {row.person_in_charge ?? translate(language, "unassigned")}</p>
              </button>
            ))
          )}
        </div>
      </Panel>

      {canViewRecentActivity ? (
        <Panel variant="subtle">
          <SectionTitle
            title={translate(language, "recentActivity")}
            action={<Link className="text-sm font-bold text-primary hover:text-primary" href="/audit">{translate(language, "audit")}</Link>}
          />
          <div className="grid gap-2">
            {changeLogs.length === 0 ? (
              <EmptyState message={translate(language, "noRecentActivity")} />
            ) : (
              changeLogs.slice(0, 6).map((log) => (
                <div key={log.log_id} className="rounded-md border border-[#D7DEE8] bg-lightgray/60 p-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-navy">{toTitle(log.entity)} - {log.entity_id}</strong>
                    <Tag tone={statusTone(log.action) as never}>{log.action}</Tag>
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate">{log.changed_by_email ?? translate(language, "system")} - {formatDateTime(log.changed_at)}</p>
                </div>
              ))
            )}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function summaryValue(value: string, unit: string) {
  return (
    <span className="flex min-w-0 items-baseline gap-1 whitespace-nowrap">
      <span className="text-2xl font-semibold leading-none text-primary">{value}</span>
      <span className="text-lg font-light leading-none text-primary">{unit}</span>
    </span>
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
      className="grid touch-manipulation gap-2 rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-sm transition-colors motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-panel"
      onClick={() => onOpenCandidate(candidate.candidate_id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block truncate text-navy">{candidate.name}</strong>
          <p className="text-xs font-bold text-slate">{candidate.candidate_id} - {candidate.group_position ?? "-"}</p>
        </div>
        <Tag tone={needsOfferFinalization ? "warning" : "teal"}>
          {needsOfferFinalization ? translate(language, "offerFinalizationNeeded") : processLabel(candidate.latest_process)}
        </Tag>
      </div>
      <StageRail compact currentStage={candidate.latest_process} currentResult={candidate.latest_result} />
      <p className="text-xs font-bold text-slate">{candidate.site ?? "-"} - {candidate.person_in_charge ?? translate(language, "unassigned")}</p>
    </button>
  );
}
