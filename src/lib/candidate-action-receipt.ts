import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardData, Candidate, EnrichedCandidate, CandidateApplication, RecruitmentLog, ApplicationAssignment, CandidateNote, CandidateReference, CandidateProfileCapabilities, MaskedCandidateSummary } from "@/types/recruitment";
export const CANDIDATE_ACTIONS = ["app_start_pipeline_stage_v2", "app_update_pipeline_pending_v2", "app_complete_pipeline_stage_v2", "app_pass_pipeline_jump_v2", "app_correct_pipeline_stage_record_v3", "app_upsert_candidate_profile_v2", "app_upsert_candidate_note_v2", "app_create_candidate_application_v1", "app_transfer_candidate_application_v1"] as const;
export function isCandidateAction(operation: string) { return (CANDIDATE_ACTIONS as readonly string[]).includes(operation); }
export type CandidateActionReceipt = { commit_epoch?: number; context?: { groups: DashboardData["position_groups"]; links: DashboardData["document_groups"]; requisitions: DashboardData["requisitions"] }; version: 1; request_id: string; operation: string; candidate_id: string; application_ids: string[];
 profile: { candidate: Candidate | null; capabilities: CandidateProfileCapabilities | null; masked: MaskedCandidateSummary | null };
 cards: EnrichedCandidate[]; applications: CandidateApplication[]; history: RecruitmentLog[]; assignments: ApplicationAssignment[]; notes: CandidateNote[]; references: CandidateReference[];
 removed_applications: string[]; source_stages?: string[]; source_docs?: string[]; source_groups: string[]; groups: string[]; effects: string[] };
type Store = { revision: number; receipts: Array<{ receipt: CandidateActionReceipt; committedAt: number }>; listeners: Set<() => void> };
let readEpoch = 0;
export function nextCandidateReadEpoch() { return ++readEpoch; }
const stores = new WeakMap<object, Map<string, Store>>();
function store(client: object, scope: string) { let scopes = stores.get(client); if (!scopes) { scopes = new Map(); stores.set(client, scopes); } let value = scopes.get(scope); if (!value) { value = { revision: 0, receipts: [], listeners: new Set() }; scopes.set(scope, value); } return value; }
export function candidateReceiptRevision(client: object | null, scope: string) { return client ? store(client, scope).revision : 0; }
export function subscribeCandidateReceipts(client: object | null, scope: string, listener: () => void) { if (!client) return () => {}; const value = store(client, scope); value.listeners.add(listener); return () => { value.listeners.delete(listener); }; }
export function publishCandidateReceipt(client: object, scope: string, receipt: CandidateActionReceipt) {
 receipt.commit_epoch = nextCandidateReadEpoch();
 const value = store(client, scope); value.receipts = value.receipts.filter(entry => entry.receipt.candidate_id !== receipt.candidate_id || !entry.receipt.application_ids.every(id => receipt.application_ids.includes(id)));
 value.receipts.push({ receipt, committedAt: Date.now() }); value.revision++; value.listeners.forEach(listener => listener());
}
export function patchCandidateRows<T>(client: object, scope: string, rows: T[], request: { entity: string; filters?: Record<string, unknown>; search?: string }, readStarted = 0): T[] {
 if (!["candidate_registry", "candidate_applications", "pipeline_stage"].includes(request.entity)) return rows;
 let output = rows;
 for (const { receipt, committedAt } of store(client, scope).receipts) {
  if ((receipt.commit_epoch ?? 0) < readStarted) continue;
  output = output.flatMap(row => {
   const current = row as unknown as EnrichedCandidate;
   if (current.candidate_id !== receipt.candidate_id) return [row];
   if (request.entity === "candidate_registry") return receipt.profile.candidate ? [{ ...row, ...receipt.profile.candidate } as T] : [];
   if (receipt.removed_applications.includes(current.application_id ?? "")) return [];
   const card = receipt.cards.find(value => value.application_id === current.application_id); if (!card) return [row];
   const filters = request.filters ?? {};
   const metadata = card as EnrichedCandidate & { has_readable_offer?: boolean; has_priority_requisition?: boolean };
   if ((filters.homeTab === "active_pipeline" && (card.latest_process === "No activity" || card.latest_result === 0 || metadata.has_readable_offer)) || (filters.boardFilter === "failed" && card.latest_result !== 0) || (filters.boardFilter === "passed_offer" && !(card.latest_process === "Offer" && card.latest_result === 1)) || (filters.priorityOnly && metadata.has_priority_requisition === false)) return [];
   const alias = (value: string | null | undefined) => (value ?? "").replace(/^(CAN|GRP)-(\d+)$/i, (_, prefix, digits) => prefix.toUpperCase()+"-"+digits.padStart(5,"0"));
   const query = alias(request.search?.trim()).toLowerCase();
   if (query && ![card.candidate_id, alias(card.candidate_id), card.group_id, alias(card.group_id), card.group_position, card.name, card.nickname, card.phone_no, card.email, ...(card.doc_ids ?? []), ...(card.sites ?? []), ...(card.person_in_charges ?? [])].join(" ").toLowerCase().includes(query)) return [];
   if ((filters.stage && filters.stage !== card.latest_process) || (filters.groupId && filters.groupId !== card.group_id)
     || (filters.headerSite && !card.sites?.includes(String(filters.headerSite))) || (filters.headerPic && !card.person_in_charges?.some(value => value.trim().toLowerCase() === String(filters.headerPic).trim().toLowerCase()))
     || (request.entity === "pipeline_stage" && (card.latest_result === 0 || (card.latest_process === "Offer" && card.latest_result === 1)))) return [];
   return [{ ...row, ...card } as T];
  });
 }
 return output;
}
export function applyCandidateReceipt(data: DashboardData, receipt: CandidateActionReceipt): DashboardData {
 const id = receipt.candidate_id, ids = new Set(receipt.application_ids);
 const merge = <T,>(rows: T[], changes: T[], key: (row: T) => unknown) => [...rows.filter(row => !changes.some(change => key(change) === key(row))), ...changes];
 const profile = receipt.profile;
 return { ...data,
  position_groups: merge(data.position_groups, receipt.context?.groups ?? [], row => row.group_id),
  document_groups: merge(data.document_groups, receipt.context?.links ?? [], row => row.doc_group_id),
  requisitions: merge(data.requisitions, receipt.context?.requisitions ?? [], row => row.doc_id),
  candidates: profile.candidate ? merge(data.candidates, [profile.candidate], row => row.candidate_id) : data.candidates.filter(row => row.candidate_id !== id),
  masked_candidate_pool: [...(data.masked_candidate_pool ?? []).filter(row => row.candidate_id !== id), ...(profile.masked ? [profile.masked] : [])],
  candidate_profile_capabilities: [...(data.candidate_profile_capabilities ?? []).filter(row => row.candidate_id !== id), ...(profile.capabilities ? [profile.capabilities] : [])],
  candidate_applications: [...(data.candidate_applications ?? []).filter(row => !ids.has(row.application_id)), ...receipt.applications],
  candidate_application_assignments: [...(data.candidate_application_assignments ?? []).filter(row => !ids.has(row.application_id)), ...receipt.assignments],
  recruitment_logs: [...data.recruitment_logs.filter(row => !ids.has(row.application_id ?? "")), ...receipt.history.filter(row => !row.superseded_at && !row.superseded_by_stage_instance_id)],
  recruitment_log_history: [...data.recruitment_log_history.filter(row => !ids.has(row.application_id ?? "")), ...receipt.history],
  candidate_notes: [...(data.candidate_notes ?? []).filter(row => row.candidate_id !== id), ...receipt.notes],
  candidate_references: [...data.candidate_references.filter(row => row.candidate_id !== id), ...receipt.references]
 };
}
const locks = new WeakMap<object, Set<string>>(), uncertain = new WeakMap<object, Set<string>>();
function lockSet(map: WeakMap<object, Set<string>>, client: object) { let value = map.get(client); if (!value) { value = new Set(); map.set(client, value); } return value; }
/** Writes bypass the read scheduler. Unknown network outcomes must be reconciled before another write. */
export async function performCandidateAction(client: SupabaseClient, operation: string, payload: Record<string, unknown>) {
 if (!isCandidateAction(operation)) throw new Error("Unsupported candidate action.");
 const key = String(payload.candidate_id ?? payload.application_id ?? "new"), pending = lockSet(locks, client), unknown = lockSet(uncertain, client);
 if (pending.has(key)) throw new Error("This candidate is already saving.");
 pending.add(key);
 try {
  if (unknown.has(key)) throw new Error("The previous save outcome is uncertain. Reload this candidate and review the current state before saving again.");
  const requestId = crypto.randomUUID(); const writeStarted = performance.now();
  const { data, error } = await client.rpc("app_candidate_action_v1", { p_operation: operation, p_payload: payload, p_request_id: requestId }).then(result => result, error => { unknown.add(key); throw error; });
  emitTiming("write", performance.now()-writeStarted);
  if (error) { if (!error.code || error.message.includes("Failed to fetch")) unknown.add(key); throw new Error(error.message); }
  if (!data || data.error || data.action_result?.request_id !== requestId || data.action_result?.version !== 1) { unknown.add(key); throw new Error(data?.error ?? "Save response could not be verified. Reload the candidate before continuing."); }
  if (receivedAt.size >= 100) receivedAt.delete(receivedAt.keys().next().value!);
  receivedAt.set(requestId, performance.now());
  return data as Record<string, unknown> & { ok: true; action_result: CandidateActionReceipt };
 } finally { pending.delete(key); }
}

export function patchCandidateDataSince(client: object, scope: string, data: DashboardData, readStarted: number) {
 let result = data; for (const entry of store(client, scope).receipts) if ((entry.receipt.commit_epoch ?? 0) >= readStarted) result = applyCandidateReceipt(result, entry.receipt); return result;
}

export function latestCandidateReceipt(client: object | null, scope: string) { return client ? store(client, scope).receipts.at(-1)?.receipt ?? null : null; }
export function acknowledgeCandidateReconciliation(client: object, candidateId: string) { lockSet(uncertain, client).delete(candidateId); }

export function candidateActionReveals(operation: string) { return ["app_start_pipeline_stage_v2", "app_complete_pipeline_stage_v2", "app_pass_pipeline_jump_v2", "app_correct_pipeline_stage_record_v3", "app_create_candidate_application_v1", "app_transfer_candidate_application_v1"].includes(operation); }

export type CandidateActionTiming = { phase: "write" | "response-to-display" | "reconciliation"; durationMs: number };
const timingObservers = new Set<(timing: CandidateActionTiming) => void>();
const receivedAt = new Map<string, number>();
export function subscribeCandidateActionTimings(listener: (timing: CandidateActionTiming) => void) { timingObservers.add(listener); return () => { timingObservers.delete(listener); }; }
function emitTiming(phase: CandidateActionTiming["phase"], durationMs: number) { for (const listener of timingObservers) { try { listener({phase,durationMs}); } catch { /* Diagnostics never change saves. */ } } }
export function markCandidateReceiptDisplayed(requestId: string) { const time = receivedAt.get(requestId); if (time !== undefined) { emitTiming("response-to-display", performance.now()-time); receivedAt.delete(requestId); } }
export function markCandidateReconciliation(start: number) { emitTiming("reconciliation", performance.now()-start); }
