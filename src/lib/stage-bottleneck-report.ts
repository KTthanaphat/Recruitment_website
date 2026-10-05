import type { ActiveProcessStage, Candidate, DashboardData, EnrichedRequisition, RecruitmentLog } from "@/types/recruitment";
import { bangkokDay, calendarDays, historicalVacancy, observationDates } from "./dashboard-history";
import { addCalendarDays } from "./dashboard-report-eligibility";
export const BOTTLENECK_STAGES: ActiveProcessStage[] = ["Phone Screen", "HR Interview", "Line Interview", "Test", "Reference Check", "Offer"];
export type DeadlineStatus = "overdue" | "today" | "upcoming" | "unscheduled" | "unavailable";
export type StageInstance = { id: string; logId: number; candidateId: string; stage: ActiveProcessStage; round: number; entry: string | null; outcome: string | null; result: number | null; due: string | null; edited: string | null; unreliable: boolean; invalidDue: boolean; duration: number | null; exclusion: string | null };
export type WaitingRecord = { candidate: Candidate; instance: StageInstance; requisitions: EnrichedRequisition[]; wait: number; status: DeadlineStatus; conflict: boolean };
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * p, low = Math.floor(index);
  return sorted[low] + (sorted[Math.ceil(index)] - sorted[low]) * (index - low);
}
function instance(log: RecruitmentLog, entry: string | null, outcome: string | null, fabricated = false): StageInstance {
  const exclusion = fabricated ? "Outcome-only legacy record" : /inferred|clamped/i.test(log.migration_note ?? "") ? "Inferred or clamped migration date" : !entry ? "Missing or invalid entry date" : log.result !== null && !outcome ? "Missing or invalid outcome date" : outcome && outcome < entry ? "Outcome precedes entry" : null;
  return { id: log.stage_instance_id ?? `legacy-${log.log_id}`, logId: log.log_id, candidateId: log.candidate_id, stage: log.recruitment_process as ActiveProcessStage, round: log.round,
    entry, outcome, result: log.result, due: bangkokDay(log.estimated_action_date), edited: bangkokDay(log.pending_edited_at),
    unreliable: log.record_origin === "migration" && !log.pending_edited_at,
    invalidDue: Boolean(log.estimated_action_date && !bangkokDay(log.estimated_action_date)),
    duration: !exclusion && entry && outcome ? calendarDays(entry, outcome) : null, exclusion };
}
/** Pair legacy attempts per candidate/stage/round while retaining mixed canonical history. */
export function normalizeStageInstances(logs: RecruitmentLog[]): StageInstance[] {
  const active = logs.filter(log => !log.superseded_at && !log.superseded_by_stage_instance_id && BOTTLENECK_STAGES.includes(log.recruitment_process as ActiveProcessStage));
  const result = active.filter(log => log.stage_instance_id).map(log => instance(log, bangkokDay(log.log_date), log.result === null ? null : bangkokDay(log.outcome_date), /outcome.only/i.test(log.migration_note ?? "")));
  const buckets = new Map<string, RecruitmentLog[]>();
  for (const log of active.filter(log => !log.stage_instance_id)) {
    const key = JSON.stringify([log.candidate_id, log.recruitment_process, log.round]);
    buckets.set(key, [...(buckets.get(key) ?? []), log]);
  }
  for (const rows of buckets.values()) {
    const sorted = rows.sort((a, b) => a.log_date.localeCompare(b.log_date) || a.log_id - b.log_id);
    let pending: RecruitmentLog | null = null;
    for (const log of sorted) {
      if (log.result === null) { if (pending) result.push(instance(pending, bangkokDay(pending.log_date), null)); pending = log; }
      else {
        const merged = pending ? { ...log, estimated_action_date: pending.estimated_action_date, pending_edited_at: pending.pending_edited_at, record_origin: pending.record_origin } : log;
        result.push(instance(merged, pending ? bangkokDay(pending.log_date) : null, bangkokDay(log.outcome_date ?? log.log_date), !pending)); pending = null;
      }
    }
    if (pending) result.push(instance(pending, bangkokDay(pending.log_date), null));
  }
  return result.sort((a, b) => a.logId - b.logId);
}
function relatedRequisitions(candidate: Candidate, data: DashboardData, requisitions: EnrichedRequisition[]) {
  const legacy = data.document_groups.find(row => row.doc_group_id === candidate.doc_group_id);
  const group = candidate.group_id ?? legacy?.group_id;
  const ids = new Set(data.document_groups.filter(row => group ? row.group_id === group : row.doc_group_id === candidate.doc_group_id).map(row => row.doc_id));
  return requisitions.filter(row => ids.has(row.doc_id));
}
export function stageSnapshot(data: DashboardData, requisitions: EnrichedRequisition[], instances: StageInstance[], start: string, asOf: string, channel: string, today: string) {
  const candidates = data.candidates.filter(row => channel === "all" || (row.channel ?? "Others") === channel);
  const contexts = new Map(candidates.map(candidate => [candidate.candidate_id, relatedRequisitions(candidate, data, requisitions)]));
  const eligible = instances.filter(row => (contexts.get(row.candidateId)?.length ?? 0) > 0);
  const completions = eligible.filter(row => row.result !== null && row.outcome && row.outcome >= start && row.outcome <= asOf);
  const valid = completions.filter(row => row.duration !== null);
  const waiting: WaitingRecord[] = [];
  const openIds = new Set(requisitions.filter(row => historicalVacancy(data, row, asOf).remaining > 0).map(row => row.doc_id));
  for (const candidate of candidates) {
    const linked = contexts.get(candidate.candidate_id) ?? [];
    if (!linked.some(row => openIds.has(row.doc_id))) continue;
    const logs = data.recruitment_logs.filter(row => row.candidate_id === candidate.candidate_id && !row.superseded_at && !row.superseded_by_stage_instance_id);
    const terminal = logs.some(row => { const explicit = ["Rejected", "Withdrawn"].includes(row.recruitment_process); const day = bangkokDay(explicit || !row.stage_instance_id ? row.log_date : row.outcome_date); return day && day <= asOf && (explicit || row.result === 0); });
    const accepted = data.offers.some(row => row.candidate_id === candidate.candidate_id && bangkokDay(row.accepted_date) && bangkokDay(row.accepted_date)! <= asOf);
    if (terminal || accepted) continue;
    const unresolved = eligible.filter(row => row.candidateId === candidate.candidate_id && row.entry && row.entry <= asOf && !row.exclusion && (!row.outcome || row.outcome > asOf))
      .sort((a, b) => a.entry!.localeCompare(b.entry!) || a.round - b.round || a.logId - b.logId);
    const current = unresolved.at(-1);
    if (!current) continue;
    const latestAttempt = eligible.filter(row => row.candidateId === candidate.candidate_id && row.entry && row.entry <= asOf && !row.exclusion)
      .sort((a, b) => a.entry!.localeCompare(b.entry!) || a.round - b.round || a.logId - b.logId).at(-1);
    if (latestAttempt?.id !== current.id) continue;
    const unavailable = Boolean(current.invalidDue || current.edited && current.edited > asOf || current.unreliable && asOf < today);
    const status: DeadlineStatus = unavailable ? "unavailable" : !current.due ? "unscheduled" : current.due < asOf ? "overdue" : current.due === asOf ? "today" : "upcoming";
    waiting.push({ candidate, instance: current, requisitions: linked, wait: calendarDays(current.entry!, asOf), status, conflict: unresolved.length > 1 });
  }
  waiting.sort((a, b) => Number(b.status === "overdue") - Number(a.status === "overdue") || (a.instance.due ?? "9999").localeCompare(b.instance.due ?? "9999") || b.wait - a.wait || a.candidate.candidate_id.localeCompare(b.candidate.candidate_id));
  const stages = BOTTLENECK_STAGES.map(stage => {
    const completed = valid.filter(row => row.stage === stage), queue = waiting.filter(row => row.instance.stage === stage);
    return { stage, sample: completed.length, median: percentile(completed.map(row => row.duration!), .5), p90: percentile(completed.map(row => row.duration!), .9), waiting: queue.length, oldest: queue.length ? Math.max(...queue.map(row => row.wait)) : null };
  });
  const primary = [...stages].filter(row => row.median !== null).sort((a, b) => b.median! - a.median! || b.waiting - a.waiting || (b.oldest ?? -1) - (a.oldest ?? -1) || BOTTLENECK_STAGES.indexOf(a.stage) - BOTTLENECK_STAGES.indexOf(b.stage))[0] ?? null;
  return { stages, primary, completions, waiting, excluded: eligible.filter(row => row.exclusion && (row.outcome ? row.outcome >= start && row.outcome <= asOf : row.entry && row.entry <= asOf)).length,
    metrics: { waiting: waiting.length, median: percentile(valid.map(row => row.duration!), .5), overdue: waiting.filter(row => row.status === "overdue").length, longest: waiting.length ? Math.max(...waiting.map(row => row.wait)) : null, unavailable: waiting.filter(row => row.status === "unavailable").length },
    conflicts: waiting.filter(row => row.conflict).length, contexts };
}
export function buildStageBottleneckReport(data: DashboardData, requisitions: EnrichedRequisition[], range: { start: string; end: string }, today: string, priorRange: { start: string; end: string }, channel = "all") {
  const asOf = range.end < today ? range.end : today, instances = normalizeStageInstances(data.recruitment_logs);
  const current = stageSnapshot(data, requisitions, instances, range.start, asOf, channel, today);
  const dates = observationDates(range.start, asOf);
  return { ...current, asOf, start: range.start, future: range.start > asOf, channel, instances: instances.filter(row => (current.contexts.get(row.candidateId)?.length ?? 0) > 0), priorRange,
    prior: range.start > asOf ? null : stageSnapshot(data, requisitions, instances, priorRange.start, priorRange.end, channel, today),
    trends: dates.map((date, i) => { const snapshot = stageSnapshot(data, requisitions, instances, i ? addCalendarDays(dates[i - 1], 1) : range.start, date, channel, today); return { date, ...snapshot.metrics, overdue: snapshot.metrics.unavailable ? null : snapshot.metrics.overdue }; }) };
}
export type StageBottleneckReport = ReturnType<typeof buildStageBottleneckReport>;
