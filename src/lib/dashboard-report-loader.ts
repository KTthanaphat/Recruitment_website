import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candidate, DashboardData, DocumentGroup, Offer, RecruitmentLog } from "@/types/recruitment";

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
const candidateColumns = "candidate_id,name,nickname,doc_group_id,group_id,channel,first_contact_date,created_at,updated_at";
const stageColumns = "log_id,candidate_id,log_date,recruitment_process,round,result,estimated_action_date,created_at,updated_at,stage_instance_id,outcome_date,pending_edited_at,record_origin,migration_note,superseded_at,superseded_by_stage_instance_id";
const offerColumns = "offer_id,candidate_id,doc_id,accepted_date,first_working_date,start_confirmation,start_confirmed_at,created_at,updated_at";
type CompleteInputs = { candidates: Candidate[]; logs: RecruitmentLog[]; groups: DocumentGroup[]; offers: Offer[] };
const reportCache = new Map<string, Promise<CompleteInputs>>();
export function clearDashboardReportCache() { reportCache.clear(); }
export async function loadExtendedDashboardReport(client: SupabaseClient, base: DashboardData): Promise<DashboardData> {
  const key = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "local"}:${base.profile?.id}:${base.profile?.role}:${base.profile?.site}:${base.profile?.updated_at}`;
  let pending = reportCache.get(key);
  if (!pending) { pending = Promise.all([
    readReportPages<Candidate>(client, "candidates", "candidate_id", candidateColumns),
    readReportPages<RecruitmentLog>(client, "recruitment_logs", "log_id", stageColumns),
    readReportPages<DocumentGroup>(client, "document_groups", "doc_group_id", "doc_group_id,doc_id,group_id,group_position,created_at,updated_at"),
    readReportPages<Offer>(client, "offers", "offer_id", offerColumns)
  ]).then(([candidates, logs, groups, offers]) => ({ candidates, logs, groups, offers })); reportCache.set(key, pending); }
  let complete: CompleteInputs;
  try { complete = await pending; } catch (error) { if (reportCache.get(key) === pending) reportCache.delete(key); throw error; }
  const { candidates, logs, groups, offers } = complete;
  // Aggregate company offers are kept separate from authorized candidate-linked offers.
  const companyOffers = base.offers.filter(row => !row.candidate_id);
  return { ...base, candidates, recruitment_logs: logs.filter(row => !row.superseded_at && !row.superseded_by_stage_instance_id), recruitment_log_history: logs, document_groups: groups,
    offers: [...companyOffers.filter(row => !offers.some(offer => offer.offer_id === row.offer_id)), ...offers] };
}
/** Hydration occurs only after an authorized report row is selected. */
export async function hydrateReportCandidate(client: SupabaseClient, candidateId: string, base: DashboardData) {
  const [candidates, logs, offers, groups] = await Promise.all([
    readReportPages<Candidate>(client, "candidates", "candidate_id", "*", ["candidate_id", candidateId]),
    readReportPages<RecruitmentLog>(client, "recruitment_logs", "log_id", "*", ["candidate_id", candidateId]),
    readReportPages<Offer>(client, "offers", "offer_id", "*", ["candidate_id", candidateId]),
    readReportPages<DocumentGroup>(client, "document_groups", "doc_group_id", "*")
  ]);
  if (!candidates.length) throw new Error("Candidate is no longer available in your authorized scope");
  return { ...base, candidates: [...base.candidates.filter(row => row.candidate_id !== candidateId), ...candidates], document_groups: groups,
    recruitment_logs: [...base.recruitment_logs.filter(row => row.candidate_id !== candidateId), ...logs.filter(row => !row.superseded_at && !row.superseded_by_stage_instance_id)],
    recruitment_log_history: [...base.recruitment_log_history.filter(row => row.candidate_id !== candidateId), ...logs], offers: [...base.offers.filter(row => row.candidate_id !== candidateId), ...offers] };
}
