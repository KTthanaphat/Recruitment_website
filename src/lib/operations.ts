import { ACTIVE_PIPELINE_STAGES, PROCESS_UPDATE_STAGES, SOURCING_CHANNELS, processLabel } from "@/lib/constants";
import { enrichCandidates, enrichOffers, enrichRequisitions, enrichSourcingGroups, latestLogsForCandidate } from "@/lib/data";
import { formatLocalDateInput } from "@/lib/dates";
import { getRequisitionSlaState } from "@/lib/sla";
import type {
  ChangeLog,
  DashboardData,
  EnrichedCandidate,
  EnrichedOffer,
  EnrichedRequisition,
  EnrichedSourcingGroup,
  HiringJourneyStepId,
  HiringJourneyStepState,
  Offer,
  ProcessStage,
  Profile,
  Requisition,
  RecruitmentLog,
  SourcingWeeklyUpdate,
  WorkspaceSection
} from "@/types/recruitment";

export type NextActionTone = "primary" | "success" | "warning" | "danger" | "muted" | "teal" | "purple";

export type WorkQueueItem = {
  id: string;
  title: string;
  meta: string;
  actionLabel: string;
  priority: number;
  tone: NextActionTone;
  type: "requisition" | "candidate" | "sourcing" | "offer";
  recordId: string;
};

export type OperationalSummaryItem = {
  label: string;
  value: string | number;
  tone?: NextActionTone;
  helper?: string;
};

export type FillReadiness = {
  label: string;
  tone: NextActionTone;
  reason: string;
};

export type OfferStatus = {
  label: string;
  tone: NextActionTone;
  ageDays: number | null;
};

export type AuditDiffRow = {
  field: string;
  oldValue: string;
  newValue: string;
  changed: boolean;
};

export type DisabledReasonCode =
  | "readonly_role"
  | "missing_required_data"
  | "failed_candidate"
  | "completed_candidate"
  | "invalid_stage_direction"
  | "not_offer_stage"
  | "not_test_stage"
  | "closed_requisition"
  | "permission_scope"
  | "unsupported_bulk_selection";

export type DisabledReason = {
  blocked: boolean;
  code?: DisabledReasonCode;
  label?: string;
  detail?: string;
  recovery?: string;
};

export type DataQualitySeverity = "blocking" | "warning" | "info";

export type DataQualityIssue = {
  id: string;
  severity: DataQualitySeverity;
  entity: "requisition" | "candidate" | "offer" | "sourcing" | "pipeline";
  entityId: string;
  title: string;
  detail: string;
  actionLabel?: string;
  href?: string;
};

export type StageHealth = {
  stage: ProcessStage | "No activity";
  count: number;
  overSlaCount: number;
  oldestAge: number | null;
  averageAge: number | null;
  passCount: number;
  failCount: number;
  latestMovementDate: string | null;
};

export type PipelineBottleneckSummary = {
  mainStage: string;
  overSlaCount: number;
  oldestCandidate: string;
  highestRiskOwner: string;
  highestRiskSite: string;
  offerPendingCount: number;
  testRepeatCount: number;
  stageHealth: StageHealth[];
};

export type SourcingConversionHealth =
  | "strong_source"
  | "high_volume_low_conversion"
  | "no_recent_applicants"
  | "good_late_stage_quality"
  | "needs_review";

export type SourcingConversionMetric = {
  groupId: string;
  channel: string;
  applicants: number;
  previousApplicants: number;
  candidates: number;
  reachedInterview: number;
  reachedTest: number;
  reachedOffer: number;
  acceptedOffers: number;
  applicantToCandidateRate: number | null;
  candidateToOfferRate: number | null;
  health: SourcingConversionHealth;
};

export type BulkSelection<EntityId extends string = string> = {
  entity: "requisition" | "candidate" | "sourcing" | "offer";
  ids: EntityId[];
};

export type BulkActionResult = {
  ok: boolean;
  succeeded: string[];
  failed: Array<{ id: string; reason: string }>;
  skipped: Array<{ id: string; reason: string }>;
};

export type HiringJourneyStep = {
  id: HiringJourneyStepId;
  label: string;
  state: HiringJourneyStepState;
  detail: string;
  section: WorkspaceSection;
};

export type HiringJourneyContext = {
  requisition: EnrichedRequisition | null;
  groups: EnrichedSourcingGroup[];
  candidates: EnrichedCandidate[];
  offers: EnrichedOffer[];
  profile: Profile | null;
  weekStart: string;
  docGroupId?: string | null;
  issues?: DataQualityIssue[];
};

export function deriveHiringJourney(context: HiringJourneyContext): HiringJourneyStep[] {
  const { requisition, groups, candidates, offers } = context;
  const accepted = offers.filter((offer) => Boolean(offer.accepted_date));
  const active = candidates.filter((candidate) => candidate.latest_result !== 0 && !candidate.accepted_date);
  const currentSourcing = groups.some((group) => group.latest_update?.week_start === context.weekStart);
  const missingStart = accepted.some((offer) => !offer.first_working_date);
  const filled = Boolean(requisition && (requisition.status === "filled" || requisition.open_headcount <= 0));
  const cancelled = requisition?.status === "cancel";

  return [
    journeyStep("requisition", "Requisition", requisition ? (cancelled ? "blocked" : "completed") : "current", requisition ? (cancelled ? "Requisition is cancelled." : "Hiring request is ready.") : "Create the hiring request.", "overview"),
    journeyStep("setup", "Group setup", !requisition || cancelled ? "blocked" : groups.length > 0 ? "completed" : "current", groups.length > 0 ? `${groups.length} sourcing group${groups.length === 1 ? "" : "s"} linked.` : "Create or match a sourcing group.", "overview"),
    journeyStep("sourcing", "Sourcing", groups.length === 0 || cancelled ? "blocked" : currentSourcing ? "completed" : "attention", currentSourcing ? "Current week is saved." : "Weekly sourcing update is missing.", "sourcing"),
    journeyStep("candidates", "Candidates", groups.length === 0 || cancelled ? "blocked" : candidates.length > 0 ? "completed" : "current", candidates.length > 0 ? `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} linked.` : "Add the first candidate.", "pipeline"),
    journeyStep("pipeline", "Pipeline", candidates.length === 0 || cancelled ? "blocked" : filled ? "completed" : active.some(isCandidateAging) || active.some((candidate) => candidate.latest_process === "No activity") ? "attention" : "current", filled ? "Required offers are accepted." : active.length > 0 ? `${active.length} active candidate${active.length === 1 ? "" : "s"}.` : "No active candidates remain.", "pipeline"),
    journeyStep("offer", "Offer", candidates.length === 0 || cancelled ? "blocked" : accepted.length >= (requisition?.head_count ?? Number.POSITIVE_INFINITY) ? "completed" : offers.length > 0 ? "attention" : "not_started", offers.length > 0 ? `${accepted.length}/${requisition?.head_count ?? "-"} accepted.` : "No offer recorded.", "offer"),
    journeyStep("closure", "Start & closure", cancelled ? "completed" : !filled ? "not_started" : missingStart ? "attention" : "completed", cancelled ? "Requisition is cancelled." : !filled ? "Complete accepted offers first." : missingStart ? "Add missing first working dates." : "Vacancy is filled and start dates are recorded.", "offer")
  ];
}

function journeyStep(id: HiringJourneyStepId, label: string, state: HiringJourneyStepState, detail: string, section: WorkspaceSection): HiringJourneyStep {
  return { id, label, state, detail, section };
}

export function deriveWorkQueue({
  candidates,
  offers,
  profile,
  requisitions,
  staleSourcingGroups
}: {
  candidates: EnrichedCandidate[];
  offers: EnrichedOffer[];
  profile: Profile | null;
  requisitions: EnrichedRequisition[];
  staleSourcingGroups: EnrichedSourcingGroup[];
}) {
  const items: WorkQueueItem[] = [];

  for (const row of responsibleRows(requisitions, profile)) {
    const sla = getRequisitionSlaState(row, { openOnly: true });
    if (row.status !== "ongoing" || row.open_headcount <= 0 || !sla.isOverdue) continue;
    items.push({
      id: `req:${row.doc_id}`,
      title: `${row.doc_id} - ${row.position}`,
      meta: `${row.site} - ${row.person_in_charge ?? "Unassigned"} - ${row.open_headcount} open - ${sla.label}`,
      actionLabel: "Overdue SLA",
      priority: 10 + (sla.ageDays ?? 0),
      recordId: row.doc_id,
      tone: "danger",
      type: "requisition"
    });
  }

  for (const row of responsibleRows(candidates, profile)) {
    const ageDays = candidateTouchAgeDays(row);
    if (!isCandidateAging(row)) continue;
    items.push({
      id: `cand:${row.candidate_id}`,
      title: row.name,
      meta: `${row.site ?? "-"} - ${processLabel(row.latest_process)} - last touched ${ageDays ?? "-"}d ago`,
      actionLabel: "Aging candidate",
      priority: 8 + (ageDays ?? 0),
      recordId: row.candidate_id,
      tone: "warning",
      type: "candidate"
    });
  }

  for (const group of responsibleSourcingGroups(staleSourcingGroups, profile)) {
    items.push({
      id: `source:${group.group_id}`,
      title: `${group.group_id} - ${group.group_position}`,
      meta: `${group.open_headcount} open - ${group.doc_ids.join(", ")} - last saved ${group.latest_update?.updated_at ? ageDays(group.latest_update.updated_at) + "d ago" : "never"}`,
      actionLabel: "Stale sourcing",
      priority: 7 + (group.latest_update?.updated_at ? ageDays(group.latest_update.updated_at) ?? 0 : 20),
      recordId: group.group_id,
      tone: "warning",
      type: "sourcing"
    });
  }

  for (const offer of responsibleRows(offers, profile)) {
    const status = offerStatus(offer);
    if (status.label !== "Pending" && status.label !== "Missing start date") continue;
    items.push({
      id: `offer:${offer.offer_id}`,
      title: offer.candidate_name ?? offer.candidate_id,
      meta: `${offer.doc_id} - ${offer.position ?? "-"} - ${status.label}`,
      actionLabel: status.label,
      priority: status.label === "Missing start date" ? 9 : 6 + (status.ageDays ?? 0),
      recordId: offer.candidate_id,
      tone: status.tone,
      type: "offer"
    });
  }

  return items.sort((a, b) => b.priority - a.priority).slice(0, 10);
}

export function isCandidateAging(candidate: EnrichedCandidate) {
  const age = candidateTouchAgeDays(candidate);
  return Boolean(
    age !== null
      && age > 7
      && candidate.latest_result !== 0
      && !candidate.accepted_date
      && ACTIVE_PIPELINE_STAGES.includes(candidate.latest_process as ProcessStage)
  );
}

export function candidateTouchAgeDays(candidate: EnrichedCandidate) {
  return ageDays(candidate.latest_log_date ?? candidate.updated_at);
}

export function latestSuccessfulOfferPassDate(candidateId: string, logs: RecruitmentLog[]) {
  return logs
    .filter((log) => log.candidate_id === candidateId && log.recruitment_process === "Offer" && log.result === 1)
    .map((log) => log.log_date)
    .sort()
    .at(-1) ?? null;
}

export function requisitionFillReadiness(row: EnrichedRequisition, candidates: EnrichedCandidate[]): FillReadiness {
  if (row.status === "filled" || row.open_headcount <= 0) {
    return { label: "Filled", tone: "success", reason: "Accepted offers meet requested headcount." };
  }
  if (row.status === "cancel") {
    return { label: "Cancelled", tone: "muted", reason: "Requisition is no longer active." };
  }
  const related = candidates.filter((candidate) => candidate.doc_ids.includes(row.doc_id));
  const active = related.filter((candidate) =>
    candidate.latest_result !== 0
      && !candidate.accepted_date
      && ACTIVE_PIPELINE_STAGES.includes(candidate.latest_process as ProcessStage)
  );
  if (related.length === 0) return { label: "No coverage", tone: "danger", reason: "No candidates are linked to this requisition." };
  if (active.some((candidate) => candidate.latest_process === "Reference Check" || candidate.latest_process === "Offer")) {
    return { label: "Late-stage coverage", tone: "success", reason: "At least one active candidate is in Reference Check or Offer." };
  }
  if (active.some(isCandidateAging)) return { label: "Aging coverage", tone: "warning", reason: "Active candidates exist but at least one is older than 7 days." };
  if (active.length > 0) return { label: "Active coverage", tone: "teal", reason: "Candidates are moving through the process." };
  return { label: "Needs candidate", tone: "warning", reason: "Linked candidates are inactive, failed, or completed." };
}

export function offerStatus(offer: Pick<EnrichedOffer, "accepted_date" | "created_at" | "first_working_date">): OfferStatus {
  if (!offer.accepted_date) return { label: "Pending", tone: "warning", ageDays: ageDays(offer.created_at) };
  if (!offer.first_working_date) return { label: "Missing start date", tone: "danger", ageDays: ageDays(offer.accepted_date) };
  const startAge = ageDays(offer.first_working_date);
  if (startAge !== null && startAge < 0 && startAge >= -14) return { label: "First day upcoming", tone: "teal", ageDays: Math.abs(startAge) };
  if (startAge !== null && startAge >= 0) return { label: "Started", tone: "success", ageDays: startAge };
  return { label: "Accepted", tone: "success", ageDays: ageDays(offer.accepted_date) };
}

export function offerImpact(offer: EnrichedOffer, allOffers: Offer[], requisitions: EnrichedRequisition[]) {
  const requisition = requisitions.find((row) => row.doc_id === offer.doc_id);
  if (!requisition) return "Requisition not found";
  const accepted = allOffers.filter((row) => row.doc_id === offer.doc_id && row.accepted_date).length;
  const open = Math.max(requisition.head_count - accepted, 0);
  return `${accepted}/${requisition.head_count} accepted - ${open === 0 ? "fills requisition" : `${open} open`}`;
}

export function sourcingApplicants(update: SourcingWeeklyUpdate | null | undefined) {
  if (!update) return 0;
  return SOURCING_CHANNELS.reduce((sum, channel) => sum + Number(update[channel.count] ?? 0), 0);
}

export function previousWeekStart(weekStart: string) {
  const date = new Date(`${weekStart}T00:00:00`);
  if (Number.isNaN(date.getTime())) return weekStart;
  date.setDate(date.getDate() - 7);
  return formatLocalDateInput(date);
}

export function sourcingPreviousUpdate(data: DashboardData, groupId: string, weekStart: string) {
  const previousWeek = previousWeekStart(weekStart);
  return data.sourcing_weekly_updates.find((update) => update.group_id === groupId && update.week_start === previousWeek) ?? null;
}

export function auditDiffRows(log: ChangeLog): AuditDiffRow[] {
  const oldData = log.old_data ?? {};
  const newData = log.new_data ?? {};
  const keys = Array.from(new Set([...Object.keys(oldData), ...Object.keys(newData)])).sort((a, b) => a.localeCompare(b));
  return keys.map((key) => {
    const oldValue = displayValue(oldData[key]);
    const newValue = displayValue(newData[key]);
    return {
      field: key,
      oldValue,
      newValue,
      changed: oldValue !== newValue
    };
  });
}

export function ageDays(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date(`${formatLocalDateInput()}T00:00:00`);
  return Math.floor((today.getTime() - date.getTime()) / 86_400_000);
}

export function candidateProcessDisabledReason(candidate: EnrichedCandidate, logs: RecruitmentLog[], profile: Profile | null): DisabledReason {
  if (!canProfileWrite(profile)) return disabled("readonly_role", "Read-only role", "Your role can inspect this candidate but cannot update process records.", "Ask an admin recruiter or site recruiter with access to update it.");
  if (logs.some((log) => log.result === 0)) return disabled("failed_candidate", "Failed candidate", "Pipeline update unavailable because this candidate has a failed stage.", "Review the history or create a separate candidate record for a new application.");
  if (candidate.accepted_date || (candidate.latest_process === "Offer" && candidate.latest_result === 1)) {
    return disabled("completed_candidate", "Completed candidate", "Pipeline update unavailable because this candidate completed all stages.", "Review the offer record instead of adding another process update.");
  }
  if (!candidate.doc_group_id) return disabled("missing_required_data", "Missing group", "Candidate is not linked to a requisition group.", "Link the candidate to a group before updating the process.");
  return { blocked: false };
}

export function pipelineMoveDisabledReason(candidate: EnrichedCandidate, targetStage: ProcessStage | "No activity", logs: RecruitmentLog[], profile: Profile | null): DisabledReason {
  const base = candidateProcessDisabledReason(candidate, logs, profile);
  if (base.blocked) return base;
  if (targetStage === "No activity") return disabled("invalid_stage_direction", "Invalid movement", "Candidates cannot be moved back to No activity.", "Choose a forward pipeline stage.");
  if (targetStage === "Offer" && !candidate.doc_ids[0]) return disabled("missing_required_data", "Missing requisition", "Offer movement needs a linked requisition.", "Match the candidate to a requisition group first.");
  if (candidate.latest_process === "No activity") return targetStage === "Phone Screen" ? { blocked: false } : disabled("invalid_stage_direction", "Start required", "No-activity candidates should start with Phone Screen.", "Start phone screen first.");
  const currentIndex = ACTIVE_PIPELINE_STAGES.indexOf(candidate.latest_process as ProcessStage);
  const targetIndex = ACTIVE_PIPELINE_STAGES.indexOf(targetStage);
  if (targetIndex <= currentIndex && !(targetStage === "Test" && candidate.latest_process === "Test")) {
    return disabled("invalid_stage_direction", "Forward only", "Pipeline movement can only move forward or maintain the Test stage.", "Choose a later stage.");
  }
  return { blocked: false };
}

export function offerActionDisabledReason(candidate: EnrichedCandidate | null | undefined, requisition: EnrichedRequisition | Requisition | null | undefined, profile: Profile | null): DisabledReason {
  if (!canProfileWrite(profile)) return disabled("readonly_role", "Read-only role", "Your role can inspect offers but cannot create or update them.", "Ask a recruiter with write access.");
  if (!candidate) return disabled("missing_required_data", "Missing candidate", "An offer must be linked to a candidate.", "Select a candidate before creating the offer.");
  if (!requisition) return disabled("missing_required_data", "Missing requisition", "An offer must be linked to a requisition.", "Match the candidate to a requisition first.");
  if ("status" in requisition && requisition.status === "cancel") return disabled("closed_requisition", "Closed requisition", "Offers cannot be created for cancelled requisitions.", "Use an ongoing requisition.");
  if (candidate.latest_process !== "Offer") return disabled("not_offer_stage", "Not in Offer", "Candidate has not reached the Offer stage.", "Move the candidate to Offer before creating the offer record.");
  return { blocked: false };
}

export function sourcingUpdateDisabledReason(group: EnrichedSourcingGroup, profile: Profile | null): DisabledReason {
  if (!canProfileWrite(profile)) return disabled("readonly_role", "Read-only role", "Your role can inspect sourcing but cannot save weekly updates.", "Ask a recruiter with write access.");
  if (profile?.role === "site_recruiter") {
    const nickname = profile.nickname ?? profile.full_name ?? "";
    const site = profile.site ?? "";
    if (!group.owners.includes(nickname) && !group.sites.includes(site)) {
      return disabled("permission_scope", "Outside responsibility", "This sourcing group is outside your site or responsibility.", "Open a group assigned to your site or ask an admin recruiter.");
    }
  }
  return { blocked: false };
}

export function bulkActionDisabledReason(selection: BulkSelection, action: string, profile: Profile | null): DisabledReason {
  if (selection.ids.length === 0) return disabled("missing_required_data", "Nothing selected", "Select at least one row before running a bulk action.", "Select rows from the table.");
  if (action.includes("update") || action.includes("save") || action.includes("copy")) {
    if (!canProfileWrite(profile)) return disabled("readonly_role", "Read-only role", "Your role cannot run write bulk actions.", "Use export or ask a recruiter with write access.");
  }
  if (selection.entity === "candidate" && action.includes("stage")) {
    return disabled("unsupported_bulk_selection", "Bulk stage movement disabled", "Candidate bulk stage movement is not enabled in this guardrail pass.", "Use the pipeline action menu for stage updates.");
  }
  return { blocked: false };
}

export function deriveCandidateStageAge(candidate: EnrichedCandidate) {
  return candidateTouchAgeDays(candidate);
}

export function deriveStageHealth(stage: ProcessStage | "No activity", candidates: EnrichedCandidate[], logs: RecruitmentLog[]): StageHealth {
  const rows = candidates.filter((candidate) => candidate.latest_process === stage);
  const ages = rows.map(deriveCandidateStageAge).filter((age): age is number => age !== null);
  const stageLogs = logs.filter((log) => log.recruitment_process === stage);
  const latestMovementDate = stageLogs.map((log) => log.log_date).sort().at(-1) ?? null;
  return {
    stage,
    count: rows.length,
    overSlaCount: rows.filter(isCandidateAging).length,
    oldestAge: ages.length > 0 ? Math.max(...ages) : null,
    averageAge: ages.length > 0 ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length) : null,
    passCount: stageLogs.filter((log) => log.result === 1).length,
    failCount: stageLogs.filter((log) => log.result === 0).length,
    latestMovementDate
  };
}

export function derivePipelineBottlenecks(candidates: EnrichedCandidate[], recruitmentLogs: RecruitmentLog[], filters?: { site?: string; owner?: string; query?: string }): PipelineBottleneckSummary {
  const scoped = candidates.filter((candidate) =>
    (!filters?.site || candidate.site === filters.site)
      && (!filters?.owner || candidate.person_in_charge === filters.owner)
      && (!filters?.query || [candidate.candidate_id, candidate.name, candidate.group_position, candidate.doc_ids.join(" ")].join(" ").toLowerCase().includes(filters.query.toLowerCase()))
  );
  const scopedCandidateIds = new Set(scoped.map((candidate) => candidate.candidate_id));
  const scopedLogs = recruitmentLogs.filter((log) => scopedCandidateIds.has(log.candidate_id));
  const activeRows = scoped.filter((row) => row.latest_result !== 0 && !(row.latest_process === "Offer" && row.latest_result === 1));
  const stages: Array<ProcessStage | "No activity"> = ["No activity", ...ACTIVE_PIPELINE_STAGES];
  const stageHealth = stages.map((stage) => deriveStageHealth(stage, activeRows, scopedLogs));
  const main = [...stageHealth].sort((a, b) => b.overSlaCount - a.overSlaCount || (b.oldestAge ?? -1) - (a.oldestAge ?? -1) || b.count - a.count)[0];
  const agingRows = activeRows.filter(isCandidateAging);
  const oldest = [...activeRows].sort((a, b) => (deriveCandidateStageAge(b) ?? -1) - (deriveCandidateStageAge(a) ?? -1))[0];
  const offerPendingCount = activeRows.filter((row) => row.latest_process === "Offer" && !row.accepted_date).length;
  const testRepeatCount = scopedLogs.filter((log) => log.recruitment_process === "Test" && log.round > 1).length;
  return {
    mainStage: main ? processLabel(main.stage) : "No active stage",
    overSlaCount: agingRows.length,
    oldestCandidate: oldest ? `${deriveCandidateStageAge(oldest) ?? "-"}d in ${processLabel(oldest.latest_process)}` : "-",
    highestRiskOwner: topGroup(agingRows.map((row) => row.person_in_charge ?? "Unassigned")),
    highestRiskSite: topGroup(agingRows.map((row) => row.site ?? "No site")),
    offerPendingCount,
    testRepeatCount,
    stageHealth
  };
}

export function deriveDataQualityIssues(data: DashboardData): DataQualityIssue[] {
  const candidates = enrichCandidates(data);
  const requisitions = enrichRequisitions(data);
  const offers = enrichOffers(data);
  const groups = enrichSourcingGroups(data, formatLocalDateInput());
  return [
    ...candidates.flatMap((candidate) => candidateQualityIssues(candidate, data)),
    ...requisitions.flatMap((requisition) => requisitionQualityIssues(requisition, data)),
    ...offers.flatMap((offer) => offerQualityIssues(offer, data)),
    ...groups.flatMap((group) => sourcingQualityIssues(group, data)),
    ...candidates.flatMap((candidate) => pipelineQualityIssues(candidate, latestLogsForCandidate(data, candidate.candidate_id), data))
  ].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.title.localeCompare(b.title));
}

export function candidateQualityIssues(candidate: EnrichedCandidate, data: DashboardData): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const duplicateByPhone = candidate.phone_no
    ? data.candidates.filter((row) => row.candidate_id !== candidate.candidate_id && row.phone_no && row.phone_no === candidate.phone_no)
    : [];
  const duplicateByName = data.candidates.filter((row) => row.candidate_id !== candidate.candidate_id && row.name.trim().toLowerCase() === candidate.name.trim().toLowerCase());
  const duplicateByFolder = candidate.candidate_folder_url
    ? data.candidates.filter((row) => row.candidate_id !== candidate.candidate_id && row.candidate_folder_url === candidate.candidate_folder_url)
    : [];
  if (duplicateByPhone.length > 0 || duplicateByName.length > 0 || duplicateByFolder.length > 0) {
    issues.push(issue("warning", "candidate", candidate.candidate_id, "Possible duplicate candidate", "Another record has the same phone, name, or folder URL.", "Review candidate", `/candidates?detailType=candidate&detailId=${encodeURIComponent(candidate.candidate_id)}`));
  }
  if (candidate.latest_process === "No activity" && (ageDays(candidate.created_at) ?? 0) > 2) {
    issues.push(issue("info", "candidate", candidate.candidate_id, "Candidate has no activity", "Candidate has been created but has no process update.", "Start process", `/pipeline?detailType=candidate&detailId=${encodeURIComponent(candidate.candidate_id)}`));
  }
  const linkedClosed = data.requisitions.find((row) => candidate.doc_ids.includes(row.doc_id) && row.status !== "ongoing");
  if (linkedClosed && candidate.latest_result !== 0 && !candidate.accepted_date) {
    issues.push(issue("warning", "candidate", candidate.candidate_id, "Candidate linked to closed requisition", `${linkedClosed.doc_id} is ${linkedClosed.status}.`, "Review match", `/workspace?type=requisition&id=${encodeURIComponent(linkedClosed.doc_id)}`));
  }
  return issues;
}

export function requisitionQualityIssues(requisition: EnrichedRequisition, data: DashboardData): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  if (requisition.status === "ongoing" && requisition.open_headcount <= 0) {
    issues.push(issue("warning", "requisition", requisition.doc_id, "Accepted offers meet headcount", "Requisition is still ongoing even though accepted offers meet requested headcount.", "Review status", `/workspace?type=requisition&id=${encodeURIComponent(requisition.doc_id)}`));
  }
  if (requisition.status === "ongoing" && requisition.open_headcount > 0 && requisition.candidate_count === 0) {
    issues.push(issue("warning", "requisition", requisition.doc_id, "Open headcount without candidates", "No candidates are linked to this open requisition.", "Add candidate", `/workspace?type=requisition&id=${encodeURIComponent(requisition.doc_id)}`));
  }
  const groupIds = data.document_groups.filter((match) => match.doc_id === requisition.doc_id).map((match) => match.group_id).filter(Boolean) as string[];
  const stale = groupIds.length > 0 && !data.sourcing_weekly_updates.some((update) => groupIds.includes(update.group_id) && (ageDays(update.updated_at) ?? 99) <= 14);
  if (requisition.status === "ongoing" && requisition.open_headcount > 0 && stale) {
    issues.push(issue("info", "requisition", requisition.doc_id, "Sourcing update is stale", "Open requisition has no sourcing update saved in the last 14 days.", "Update sourcing", `/workspace?type=requisition&id=${encodeURIComponent(requisition.doc_id)}`));
  }
  return issues;
}

export function offerQualityIssues(offer: EnrichedOffer, data: DashboardData): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  if (offer.accepted_date && !offer.first_working_date) {
    issues.push(issue("warning", "offer", String(offer.offer_id), "Accepted offer missing first working date", "Accepted offers need a first working date for follow-up and reporting.", "Review offer", `/offers?offerSearch=${encodeURIComponent(offer.candidate_id)}`));
  }
  const requisition = data.requisitions.find((row) => row.doc_id === offer.doc_id);
  if (offer.accepted_date && requisition?.status === "ongoing") {
    const accepted = data.offers.filter((row) => row.doc_id === offer.doc_id && row.accepted_date).length;
    if (accepted >= requisition.head_count) {
      issues.push(issue("info", "offer", String(offer.offer_id), "Offer may fill requisition", "Accepted offers meet requested headcount while requisition remains ongoing.", "Review requisition", `/workspace?type=requisition&id=${encodeURIComponent(offer.doc_id)}`));
    }
  }
  return issues;
}

export function sourcingQualityIssues(group: EnrichedSourcingGroup, _data: DashboardData): DataQualityIssue[] {
  if (group.open_headcount <= 0) return [];
  if (!group.latest_update || (ageDays(group.latest_update.updated_at) ?? 99) > 14) {
    return [issue("info", "sourcing", group.group_id, "Sourcing group needs update", "Open headcount exists but sourcing has not been updated in 14 days.", "Update sourcing", `/workspace?type=group&id=${encodeURIComponent(group.group_id)}`)];
  }
  return [];
}

export function pipelineQualityIssues(candidate: EnrichedCandidate, logs: RecruitmentLog[], _data: DashboardData): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const sorted = [...logs].sort((a, b) => a.log_date.localeCompare(b.log_date) || a.log_id - b.log_id);
  let previousIndex = -1;
  for (const log of sorted) {
    const index = PROCESS_UPDATE_STAGES.indexOf(log.recruitment_process);
    if (index !== -1 && previousIndex > index && log.recruitment_process !== "Test") {
      issues.push(issue("warning", "pipeline", candidate.candidate_id, "Process history is out of order", "A later log appears to move backward in the pipeline.", "Review history", `/candidates?detailType=candidate&detailId=${encodeURIComponent(candidate.candidate_id)}`));
      break;
    }
    if (index !== -1) previousIndex = Math.max(previousIndex, index);
  }
  return issues;
}

export function deriveSourcingConversionMetrics(data: DashboardData, groupId: string, weekStart = formatLocalDateInput()): SourcingConversionMetric[] {
  const groupMatches = data.document_groups.filter((match) => match.group_id === groupId);
  const docGroupIds = new Set(groupMatches.map((match) => match.doc_group_id));
  const candidates = data.candidates.filter((candidate) => docGroupIds.has(candidate.doc_group_id));
  const update = data.sourcing_weekly_updates.find((row) => row.group_id === groupId && row.week_start === weekStart);
  const previous = sourcingPreviousUpdate(data, groupId, weekStart);

  return SOURCING_CHANNELS.map((channel) => {
    const channelCandidates = candidates.filter((candidate) => normalized(candidate.channel) === normalized(channel.label));
    const candidateIds = new Set(channelCandidates.map((candidate) => candidate.candidate_id));
    const logs = data.recruitment_logs.filter((log) => candidateIds.has(log.candidate_id));
    const reachedOfferIds = new Set(logs.filter((log) => log.recruitment_process === "Offer").map((log) => log.candidate_id));
    const applicants = Number(update?.[channel.count] ?? 0);
    const candidateCount = channelCandidates.length;
    const reachedOffer = reachedOfferIds.size;
    const acceptedOffers = data.offers.filter((offer) => candidateIds.has(offer.candidate_id) && offer.accepted_date).length;
    return {
      groupId,
      channel: channel.label,
      applicants,
      previousApplicants: Number(previous?.[channel.count] ?? 0),
      candidates: candidateCount,
      reachedInterview: new Set(logs.filter((log) => log.recruitment_process === "HR Interview" || log.recruitment_process === "Line Interview").map((log) => log.candidate_id)).size,
      reachedTest: new Set(logs.filter((log) => log.recruitment_process === "Test").map((log) => log.candidate_id)).size,
      reachedOffer,
      acceptedOffers,
      applicantToCandidateRate: applicants > 0 ? candidateCount / applicants : null,
      candidateToOfferRate: candidateCount > 0 ? reachedOffer / candidateCount : null,
      health: sourcingConversionHealth(applicants, candidateCount, reachedOffer, acceptedOffers)
    };
  });
}

function sourcingConversionHealth(applicants: number, candidates: number, reachedOffer: number, acceptedOffers: number): SourcingConversionHealth {
  if (applicants === 0) return "no_recent_applicants";
  if (applicants >= 20 && candidates / applicants < 0.1) return "high_volume_low_conversion";
  if (acceptedOffers > 0 || reachedOffer > 0) return "good_late_stage_quality";
  if (candidates / applicants >= 0.2) return "strong_source";
  return "needs_review";
}

function disabled(code: DisabledReasonCode, label: string, detail: string, recovery?: string): DisabledReason {
  return { blocked: true, code, detail, label, recovery };
}

function issue(severity: DataQualitySeverity, entity: DataQualityIssue["entity"], entityId: string, title: string, detail: string, actionLabel?: string, href?: string): DataQualityIssue {
  return { id: `${entity}:${entityId}:${title}`, severity, entity, entityId, title, detail, actionLabel, href };
}

function severityWeight(severity: DataQualitySeverity) {
  if (severity === "blocking") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function canProfileWrite(profile: Profile | null) {
  return profile?.role === "system_admin" || profile?.role === "admin_recruiter" || profile?.role === "site_recruiter";
}

function topGroup(values: string[]) {
  if (values.length === 0) return "-";
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "-";
}

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function responsibleRows<T extends { site?: string | null; person_in_charge?: string | null }>(rows: T[], profile: Profile | null) {
  if (!profile || profile.role === "system_admin" || profile.role === "admin_recruiter" || profile.role === "viewer") return rows;
  const ownerNames = [profile.nickname, profile.full_name].filter(Boolean).map((value) => value!.toLowerCase());
  const site = profile.site?.toLowerCase();
  return rows.filter((row) => {
    const owner = (row.person_in_charge ?? "").toLowerCase();
    const rowSite = (row.site ?? "").toLowerCase();
    return ownerNames.some((name) => owner.includes(name)) || Boolean(site && rowSite.includes(site));
  });
}

function responsibleSourcingGroups(groups: EnrichedSourcingGroup[], profile: Profile | null) {
  if (profile?.role !== "site_recruiter") return groups;
  const nickname = profile.nickname ?? profile.full_name ?? "";
  const site = profile.site ?? "";
  return groups.filter((group) => group.owners.includes(nickname) || group.sites.includes(site));
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
