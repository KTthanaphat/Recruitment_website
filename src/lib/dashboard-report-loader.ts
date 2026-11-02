import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateApplication, ApplicationAssignment, Candidate, DashboardData, DocumentGroup, Offer, RecruitmentLog, Requisition, RequisitionLog, PositionGroup, SourcingWeeklyUpdate } from "@/types/recruitment";

/** Exact count and primary-key ordering detect capped, changed or incomplete reads. */
export async function readReportPages<T>(client: SupabaseClient, table: string, key: string, columns: string, match?: [string, string]) {
  const rows: T[] = [], seen = new Set<unknown>();
  let expected: number | null = null;
  for (let offset = 0; ; offset += 500) {
    let query = client.from(table).select(columns, { count: "exact" }).order(key, { ascending: true }).range(offset, offset + 499);
    if (match) query = query.eq(match[0], match[1]);
    const result = await query;
    if (result.error) throw new Error(result.error.message);
    if (result.count === null) throw new Error(`Unable to verify complete ${table} retrieval`);
    if (expected !== null && result.count !== expected) throw new Error(`Records changed while loading ${table}; retry`);
    expected = result.count;
    const page = (result.data ?? []) as unknown as T[];
    for (const row of page) {
      const id = (row as Record<string, unknown>)[key];
      if (seen.has(id)) throw new Error(`Duplicate page in ${table}; retry`);
      seen.add(id); rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (page.length < 500 || rows.length > expected) throw new Error(`Incomplete ${table} retrieval; retry`);
  }
}
const candidateColumns = "candidate_id,created_by,home_site,responsible_recruiter_id,position_interests,name,nickname,doc_group_id,group_id,channel,first_contact_date,created_at,updated_at";
const stageColumns = "log_id,application_id,entry_assignment_id,outcome_assignment_id,candidate_id,log_date,recruitment_process,round,result,estimated_action_date,created_at,updated_at,stage_instance_id,outcome_date,pending_edited_at,record_origin,migration_note,superseded_at,superseded_by_stage_instance_id,failure_actor,failure_main_reason_id,failure_detail_reason_id,failure_reason_snapshot";
const offerColumns = "offer_id,application_id,candidate_id,doc_id,accepted_date,first_working_date,start_confirmation,start_confirmed_at,created_at,updated_at";
type CompleteInputs = { candidates: Candidate[]; logs: RecruitmentLog[]; groups: DocumentGroup[]; offers: Offer[]; applications: CandidateApplication[]; assignments: ApplicationAssignment[] };
const reportCache = new Map<string, { expiresAt: number; request: Promise<CompleteInputs> }>();
const reportClientIds = new WeakMap<object, number>();
let nextReportClientId = 1;
export function clearDashboardReportCache() { reportCache.clear(); }
export async function loadExtendedDashboardReport(client: SupabaseClient, base: DashboardData): Promise<DashboardData> {
  let clientId = reportClientIds.get(client);
  if (!clientId) { clientId = nextReportClientId++; reportClientIds.set(client, clientId); }
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw new Error("Unable to verify report export session");
  const key = `${clientId}:${sessionData.session?.user.id ?? "anonymous"}:${base.profile?.id}:${base.profile?.role}:${base.profile?.site}:${base.profile?.updated_at}`;
  const now = Date.now();
  for (const [entryKey, entry] of reportCache) if (entry.expiresAt <= now) reportCache.delete(entryKey);
  let cached = reportCache.get(key);
  if (!cached) { const pending = Promise.all([
    readReportPages<Candidate>(client, "candidates", "candidate_id", candidateColumns),
    readReportPages<RecruitmentLog>(client, "recruitment_logs", "log_id", stageColumns),
    readReportPages<DocumentGroup>(client, "document_groups", "doc_group_id", "doc_group_id,doc_id,group_id,group_position,created_at,updated_at"),
    readReportPages<Offer>(client, "offers", "offer_id", offerColumns),
    readReportPages<CandidateApplication>(client, "candidate_applications", "application_id", "*"),
    readReportPages<ApplicationAssignment>(client, "candidate_application_assignments", "assignment_id", "*")
  ]).then(([candidates, logs, groups, offers, applications, assignments]) => ({ candidates, logs, groups, offers, applications, assignments }));
    cached = { expiresAt: now + 30_000, request: pending };
    while (reportCache.size >= 3) reportCache.delete(reportCache.keys().next().value!);
    reportCache.set(key, cached);
  }
  const pending = cached.request;
  let complete: CompleteInputs;
  try { complete = await pending; } catch (error) { if (reportCache.get(key)?.request === pending) reportCache.delete(key); throw error; }
  const { candidates, logs, groups, offers, applications, assignments } = complete;
  // Aggregate company offers are kept separate from authorized candidate-linked offers.
  const companyOffers = base.offers.filter(row => !row.candidate_id);
  return { ...base, candidates, candidate_applications: applications, candidate_application_assignments: assignments, recruitment_logs: logs.filter(row => !row.superseded_at && !row.superseded_by_stage_instance_id), recruitment_log_history: logs, document_groups: groups,
    offers: [...companyOffers.filter(row => !offers.some(offer => offer.offer_id === row.offer_id)), ...offers] };
}
/** Full export-only inputs. Summary views never request these source ledgers. */
export async function loadCompletePipelineReportData(client: SupabaseClient, base: DashboardData): Promise<DashboardData> {
  const [extended, requisitions, requisitionLogs, positionGroups, sourcingUpdates] = await Promise.all([
    loadExtendedDashboardReport(client, base),
    readReportPages<Requisition>(client, "requisitions", "doc_id", "*"),
    readReportPages<RequisitionLog>(client, "requisition_logs", "log_id", "*"),
    readCompositeReportPages<PositionGroup>(client, "position_groups", ["group_id", "group_position"], "*"),
    readCompositeReportPages<SourcingWeeklyUpdate>(client, "sourcing_weekly_updates", ["group_id", "week_start"], "*")
  ]);
  return { ...extended, requisitions, requisition_logs: requisitionLogs, position_groups: positionGroups, sourcing_weekly_updates: sourcingUpdates };
}
async function readCompositeReportPages<T>(client: SupabaseClient, table: string, keys: string[], columns: string): Promise<T[]> {
  const rows: T[] = [], seen = new Set<string>();
  let expected: number | null = null;
  for (let offset = 0; ; offset += 500) {
    let query = client.from(table).select(columns, { count: "exact" });
    for (const key of keys) query = query.order(key, { ascending: true });
    const result = await query.range(offset, offset + 499);
    if (result.error) throw new Error(result.error.message);
    if (result.count === null) throw new Error(`Unable to verify complete ${table} retrieval`);
    if (expected !== null && result.count !== expected) throw new Error(`Records changed while loading ${table}; retry`);
    expected = result.count;
    const page = (result.data ?? []) as unknown as T[];
    for (const row of page) {
      const identity = keys.map(key => String((row as Record<string, unknown>)[key] ?? "")).join("\u001f");
      if (seen.has(identity)) throw new Error(`Duplicate page in ${table}; retry`);
      seen.add(identity); rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (page.length < 500 || rows.length > expected) throw new Error(`Incomplete ${table} retrieval; retry`);
  }
}
/** Hydration occurs only after an authorized report row is selected. */
export async function hydrateReportCandidate(client: SupabaseClient, candidateId: string, base: DashboardData) {
  const [candidates, logs, offers, groups, applications, assignments] = await Promise.all([
    readReportPages<Candidate>(client, "candidates", "candidate_id", "*", ["candidate_id", candidateId]),
    readReportPages<RecruitmentLog>(client, "recruitment_logs", "log_id", "*", ["candidate_id", candidateId]),
    readReportPages<Offer>(client, "offers", "offer_id", "*", ["candidate_id", candidateId]),
    readReportPages<DocumentGroup>(client, "document_groups", "doc_group_id", "*"),
    readReportPages<CandidateApplication>(client, "candidate_applications", "application_id", "*", ["candidate_id", candidateId]),
    readReportPages<ApplicationAssignment>(client, "candidate_application_assignments", "assignment_id", "*")
  ]);
  if (!candidates.length) throw new Error("Candidate is no longer available in your authorized scope");
  return { ...base, candidate_applications: [...(base.candidate_applications ?? []).filter(row => row.candidate_id !== candidateId), ...applications], candidate_application_assignments: assignments, candidates: [...base.candidates.filter(row => row.candidate_id !== candidateId), ...candidates], document_groups: groups,
    recruitment_logs: [...base.recruitment_logs.filter(row => row.candidate_id !== candidateId), ...logs.filter(row => !row.superseded_at && !row.superseded_by_stage_instance_id)],
    recruitment_log_history: [...base.recruitment_log_history.filter(row => row.candidate_id !== candidateId), ...logs], offers: [...base.offers.filter(row => row.candidate_id !== candidateId), ...offers] };
}
