import type { DashboardData, EnrichedRequisition, Language } from "@/types/recruitment";
import { bangkokDay, calendarDays } from "./dashboard-history";
import { addCalendarDays } from "./dashboard-report-eligibility";
import { BOTTLENECK_STAGES, normalizeStageInstances } from "./stage-bottleneck-report";
import { matchesRecruitmentIdSearch } from "./recruitment-id-search";

export type RejectionActor = "company" | "candidate" | "unclassified";
export type RejectionSort = "date-desc" | "date-asc" | "candidate-asc" | "stage-asc";
export type RejectionFilters = { actor: string; stage: string; main: string; detail: string; search: string };
export const EMPTY_REJECTION_FILTERS: RejectionFilters = { actor: "", stage: "", main: "", detail: "", search: "" };
export type RejectionEvent = {
  id: string; logId: number; applicationId?: string; candidateId: string; name: string;
  groupId: string; position: string; date: string; stage: string; round: number; actor: RejectionActor;
  mainKey: string; detailKey: string; main: Record<Language, string>; detail: Record<Language, string>;
  requisitions: EnrichedRequisition[];
};
export type ReasonCount = { key: string; label: Record<Language, string>; count: number; share: number; actor: RejectionActor };
export type ActorCounts = Record<RejectionActor, number>;
export const REJECTION_ACTORS: RejectionActor[] = ["company", "candidate", "unclassified"];
const zeroActors = (): ActorCounts => ({ company: 0, candidate: 0, unclassified: 0 });
const unknown = { en: "Unclassified reason", th: "ไม่ได้ระบุเหตุผล" };
function reasons(events: RejectionEvent[], detail: boolean): ReasonCount[] {
  const groups = new Map<string, ReasonCount>();
  for (const row of events) {
    const key = detail ? row.detailKey : row.mainKey;
    const current = groups.get(key) ?? { key, label: detail ? row.detail : row.main, count: 0, share: 0, actor: row.actor };
    current.count++; groups.set(key, current);
  }
  return [...groups.values()].map(row => ({ ...row, share: events.length ? row.count / events.length : 0 }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
export function rejectionMatches(row: RejectionEvent, filters: RejectionFilters) {
  const search = filters.search.trim();
  const plainMatch = !search || [row.name, row.applicationId, ...row.requisitions.map(req => req.doc_id)]
    .join(" ").toLocaleLowerCase().includes(search.toLocaleLowerCase());
  const idMatch = !search || [row.candidateId, row.groupId, ...row.requisitions.map(req => req.doc_id)]
    .some(value => matchesRecruitmentIdSearch(value, search));
  return (!filters.actor || row.actor === filters.actor) && (!filters.stage || row.stage === filters.stage)
    && (!filters.main || row.mainKey === filters.main) && (!filters.detail || row.detailKey === filters.detail)
    && (plainMatch || idMatch);
}
export function sortRejectionEvents(events: RejectionEvent[], sort: RejectionSort) {
  return [...events].sort((a, b) => (sort === "date-asc" ? a.date.localeCompare(b.date)
    : sort === "candidate-asc" ? a.name.localeCompare(b.name)
    : sort === "stage-asc" ? a.stage.localeCompare(b.stage) : b.date.localeCompare(a.date)) || b.logId - a.logId);
}
/** One failure per normalized attempt, joined only to caller-authorized identities and journeys. */
export function buildRejectionReport(data: DashboardData, requisitions: EnrichedRequisition[], range: { start: string; end: string }, filters = EMPTY_REJECTION_FILTERS) {
  const candidates = new Map(data.candidates.map(row => [row.candidate_id, row]));
  const applications = new Map((data.candidate_applications ?? []).map(row => [row.application_id, row]));
  const assignments = new Map((data.candidate_application_assignments ?? []).map(row => [row.assignment_id, row]));
  const logs = data.recruitment_logs.filter(row => !row.superseded_at && !row.superseded_by_stage_instance_id);
  const byLog = new Map(logs.map(row => [row.log_id, row]));
  const instances = normalizeStageInstances(logs);
  // Historical terminal labels are supported separately from the six active stages.
  const historical = logs.filter(row => !BOTTLENECK_STAGES.includes(row.recruitment_process as typeof BOTTLENECK_STAGES[number]) && row.result === 0);
  const failures = [
    ...instances.filter(row => row.result === 0).map(row => ({ log: byLog.get(row.logId)!, id: row.id, date: row.outcome })),
    ...historical.map(log => ({ log, id: log.stage_instance_id ?? `legacy-${log.log_id}`, date: bangkokDay(log.outcome_date ?? (!log.stage_instance_id ? log.log_date : null)) }))
  ].sort((a, b) => b.log.log_id - a.log.log_id);
  const seen = new Set<string>(), periodEvents: RejectionEvent[] = [];
  const diagnostics = { undated: 0, unresolvedContext: 0 };
  for (const { log, id, date } of failures) {
    const identity = `${log.application_id ?? log.candidate_id}:${id}`;
    if (seen.has(identity)) continue; seen.add(identity);
    const candidate = candidates.get(log.candidate_id);
    // A visible person must never substitute for a journey hidden by RLS.
    if (!candidate || log.application_id && !applications.has(log.application_id)) continue;
    const history = (data.candidate_application_assignments ?? []).filter(row => row.application_id === log.application_id);
    const assignment = log.outcome_assignment_id ? assignments.get(log.outcome_assignment_id) : undefined;
    const validAssignment = assignment && assignment.application_id === log.application_id ? assignment : undefined;
    const group = validAssignment?.group_id ?? (!history.length && !log.outcome_assignment_id
      ? (log.application_id ? applications.get(log.application_id)?.group_id : candidate.group_id ?? data.document_groups.find(row => row.doc_group_id === candidate.doc_group_id)?.group_id) : null);
    if (!group) { if (!date || date >= range.start && date <= range.end) diagnostics.unresolvedContext++; continue; }
    const allLinks = data.document_groups.filter(row => row.group_id === group);
    if (!allLinks.length) { if (!date || date >= range.start && date <= range.end) diagnostics.unresolvedContext++; continue; }
    const ids = new Set(allLinks.map(row => row.doc_id));
    const related = requisitions.filter(row => ids.has(row.doc_id));
    if (!related.length) continue;
    if (!date) { diagnostics.undated++; continue; }
    if (date < range.start || date > range.end) continue;
    const actor: RejectionActor = log.failure_actor === "company" || log.failure_actor === "candidate" ? log.failure_actor : "unclassified";
    const snapshot = log.failure_reason_snapshot;
    const main = snapshot?.main_en?.trim() || snapshot?.main_th?.trim() ? { en: snapshot.main_en || snapshot.main_th, th: snapshot.main_th || snapshot.main_en } : unknown;
    const detail = snapshot?.detail_en?.trim() || snapshot?.detail_th?.trim() ? { en: snapshot.detail_en || snapshot.detail_th, th: snapshot.detail_th || snapshot.detail_en } : unknown;
    const mainKey = JSON.stringify([actor, main === unknown ? "unclassified" : log.failure_main_reason_id ?? [main.en, main.th]]);
    const detailKey = JSON.stringify([mainKey, detail === unknown ? "unclassified" : log.failure_detail_reason_id ?? [detail.en, detail.th]]);
    periodEvents.push({ id: identity, logId: log.log_id, applicationId: log.application_id, candidateId: candidate.candidate_id, name: candidate.name,
      groupId: group, position: data.position_groups.find(row => row.group_id === group)?.group_position ?? allLinks[0].group_position ?? related[0].position,
      date, stage: log.recruitment_process, round: log.round, actor, mainKey, detailKey, main, detail, requisitions: related });
  }
  const events = periodEvents.filter(row => rejectionMatches(row, filters));
  const comparisonBase = periodEvents.filter(row => rejectionMatches(row, { ...filters, main: "", detail: "" }));
  const comparisonEvents = filters.main ? comparisonBase.filter(row => row.mainKey === filters.main) : comparisonBase;
  const comparison = { events: comparisonEvents, total: comparisonEvents.length, level: filters.main ? "detail" as const : "main" as const,
    reasons: reasons(comparisonEvents, Boolean(filters.main)), main: filters.main,
    label: periodEvents.find(row => row.mainKey === filters.main)?.main,
    selected: filters.main ? filters.detail : "" };
  const actors = zeroActors(); events.forEach(row => actors[row.actor]++);
  const stageNames: string[] = [...BOTTLENECK_STAGES, ...[...new Set(periodEvents.map(row => row.stage))].filter(stage => !BOTTLENECK_STAGES.includes(stage as typeof BOTTLENECK_STAGES[number])).sort()];
  const stages = stageNames.map(stage => { const counts = zeroActors(); events.filter(row => row.stage === stage).forEach(row => counts[row.actor]++); return { stage, ...counts, count: counts.company + counts.candidate + counts.unclassified }; });
  const duration = calendarDays(range.start, range.end) + 1;
  const granularity: "daily" | "weekly" | "monthly" = duration <= 31 ? "daily" : duration <= 120 ? "weekly" : "monthly";
  const trends: ({ start: string; end: string; count: number } & ActorCounts)[] = [];
  if (Number.isFinite(duration) && duration > 0) {
    for (let start = range.start; start <= range.end;) {
      const day = new Date(`${start}T00:00:00Z`);
      const next = granularity === "daily" ? addCalendarDays(start, 1) : granularity === "weekly" ? addCalendarDays(start, (6 - day.getUTCDay() + 7) % 7 || 7)
        : new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
      trends.push({ start, end: addCalendarDays(next, -1) < range.end ? addCalendarDays(next, -1) : range.end, count: 0, ...zeroActors() });
      start = next;
    }
  }
  for (const row of events) { const bucket = trends.find(bucket => row.date >= bucket.start && row.date <= bucket.end); if (bucket) { bucket.count++; bucket[row.actor]++; } }
  return { range, periodEvents, events, comparison, actors, total: events.length, people: new Set(events.map(row => row.candidateId)).size,
    applications: new Set(events.map(row => row.applicationId ?? `legacy:${row.candidateId}`)).size,
    mainReasons: reasons(events, false), detailedReasons: reasons(events, true), stages, trends, granularity, diagnostics,
    mainOptions: reasons(periodEvents.filter(row => !filters.actor || row.actor === filters.actor), false),
    detailOptions: reasons(periodEvents.filter(row => row.mainKey === filters.main && (!filters.actor || row.actor === filters.actor)), true) };
}
export type RejectionReport = ReturnType<typeof buildRejectionReport>;
