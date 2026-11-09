import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardData, Requisition, RequisitionLog, EnrichedRequisition } from "@/types/recruitment";
import { nextCandidateReadEpoch } from "./candidate-action-receipt";

export const REQUISITION_ACTIONS = ["app_upsert_requisition", "app_insert_requisition_log", "app_set_requisition_priority_v1"] as const;
export function isRequisitionAction(operation: string) { return (REQUISITION_ACTIONS as readonly string[]).includes(operation); }
export type RequisitionActionReceipt = {
  version: 1; request_id: string; operation: string; previous_doc_id: string | null; doc_id: string;
  display?: Pick<EnrichedRequisition,"sourcing_group_ids"|"accepted_count"|"open_headcount"|"candidate_count"|"sla_restart_date">;
  requisition: Requisition | null; removed: boolean; updated_at: string | null; commit_epoch?: number;
  aliases?: string[];
  source_scope: { site: string | null; person_in_charge: string | null; is_priority: boolean | null } | null;
  source_groups: string[]; groups: string[]; status_log: RequisitionLog | null; changed_fields: string[]; effects: string[];
};
type State = { revision: number; receipts: RequisitionActionReceipt[]; listeners: Set<() => void> };
const stores = new WeakMap<object, Map<string, State>>();
function state(client: object, scope: string) {
  let scopes = stores.get(client); if (!scopes) { scopes = new Map(); stores.set(client, scopes); }
  let value = scopes.get(scope); if (!value) { value = { revision: 0, receipts: [], listeners: new Set() }; scopes.set(scope, value); }
  return value;
}
export function clearRequisitionActionState(client: object){stores.delete(client);locks.delete(client);uncertain.delete(client);}
export function committedRequisitionId(client: object | null,scope: string,id: string){return client ? state(client,scope).receipts.find(row=>[row.doc_id,row.previous_doc_id,...(row.aliases??[])].includes(id))?.doc_id ?? id : id;}
export function requisitionReceiptRevision(client: object | null, scope: string) { return client ? state(client, scope).revision : 0; }
export function subscribeRequisitionReceipts(client: object | null, scope: string, listener: () => void) {
  if (!client) return () => {}; const value = state(client, scope); value.listeners.add(listener); return () => { value.listeners.delete(listener); };
}
export function publishRequisitionReceipt(client: object, scope: string, receipt: RequisitionActionReceipt) {
  const value = state(client, scope);
  const newer = value.receipts.find(row => [receipt.doc_id, receipt.previous_doc_id, ...(receipt.aliases ?? [])].includes(row.doc_id) && row.updated_at && receipt.updated_at && Date.parse(row.updated_at) > Date.parse(receipt.updated_at));
  if (newer) return false;
  receipt.aliases=[...new Set([receipt.previous_doc_id,...value.receipts.filter(row=>[receipt.doc_id,receipt.previous_doc_id].includes(row.doc_id)).flatMap(row=>[row.previous_doc_id,...(row.aliases??[])])].filter((id):id is string=>Boolean(id)))];
  receipt.commit_epoch = nextCandidateReadEpoch();
  value.receipts = value.receipts.filter(row => ![receipt.doc_id, receipt.previous_doc_id, ...(receipt.aliases ?? [])].includes(row.doc_id));
  value.receipts.push(receipt); value.revision++; value.listeners.forEach(listener => listener()); return true;
}
function matchesScope(receipt: RequisitionActionReceipt, filters: Record<string, unknown>) {
  const scopes = [receipt.source_scope, receipt.requisition].filter(Boolean);
  return scopes.some(row => (!filters.headerSite || row?.site === filters.headerSite)
    && (!filters.headerPic || row?.person_in_charge?.trim().toLowerCase() === String(filters.headerPic).trim().toLowerCase()));
}
export function requisitionQueryAffected(request: { entity: string; filters?: Record<string, unknown> }, receipt: RequisitionActionReceipt) {
  const f = request.filters ?? {}, docs = [receipt.doc_id, receipt.previous_doc_id, ...(receipt.aliases ?? [])], groups = [...receipt.groups, ...receipt.source_groups];
  // Candidate priority is a server-derived relationship projection, including unfiltered pages.
  if (request.entity === "candidate_registry") return true;
  if (!matchesScope(receipt, f)) return false;
  if (f.docId && !docs.includes(String(f.docId))) return false;
  if (f.groupId && !groups.includes(String(f.groupId))) return false;
  if (f.group_id && !groups.includes(String(f.group_id))) return false;
  if (receipt.operation === "app_set_requisition_priority_v1") return request.entity === "requisitions" || request.entity === "audit_log" || Boolean(f.priorityOnly);
  if (receipt.operation === "app_upsert_requisition" && !receipt.changed_fields.some(key => ["doc_id","site","person_in_charge","status","head_count","pr_approved_date","position","department","section","level","is_priority"].includes(key))) return ["requisitions","position_groups","sourcing","sourcing_records","audit_log"].includes(request.entity);
  return true;
}
function rowMatches(row: Requisition, filters: Record<string, unknown>) {
  return (!filters.headerSite || row.site === filters.headerSite)
    && (!filters.headerPic || row.person_in_charge?.trim().toLowerCase() === String(filters.headerPic).trim().toLowerCase())
    && (!filters.priorityOnly || row.is_priority)
    && (!filters.docId || row.doc_id === filters.docId)
    && (!filters.status || !["ongoing","filled","cancel"].includes(String(filters.status)) || row.status === filters.status)
    && (filters.homeTab !== "open_headcount" || row.status === "ongoing");
}
/** Overlay committed base fields only. Unknown search membership is reconciled by the server. */
export function patchRequisitionRows<T>(client: object, scope: string, rows: T[], request: { entity: string; filters?: Record<string, unknown> }, readStarted = 0): T[] {
  if (request.entity !== "requisitions") return rows;
  let result = rows;
  for (const receipt of state(client, scope).receipts) {
    result = result.flatMap(item => {
      const row = item as T & Requisition;
      if (![receipt.doc_id, receipt.previous_doc_id, ...(receipt.aliases ?? [])].includes(row.doc_id)) return [item];
      if (row.updated_at && receipt.updated_at && Date.parse(row.updated_at) > Date.parse(receipt.updated_at)) return [item];
      if ((receipt.commit_epoch ?? 0) < readStarted && (!receipt.updated_at || row.updated_at === receipt.updated_at)) return [item];
      if (receipt.removed || !receipt.requisition || !rowMatches(receipt.requisition, request.filters ?? {})) return [];
      return [{ ...row, ...receipt.requisition, ...receipt.display } as T];
    });
    if ((receipt.commit_epoch ?? 0) >= readStarted && receipt.source_scope === null && receipt.operation === "app_upsert_requisition" && receipt.requisition && !receipt.removed && rowMatches(receipt.requisition,request.filters ?? {}) && !result.some(item=>(item as T & Requisition).doc_id===receipt.doc_id)) result=[{...receipt.requisition,...receipt.display} as T,...result];
  }
  return result;
}
export function applyRequisitionReceipt(data: DashboardData, receipt: RequisitionActionReceipt): DashboardData {
  const ids = [receipt.previous_doc_id, receipt.doc_id, ...(receipt.aliases ?? [])];
  const keep = <T extends { doc_id: string }>(rows: T[]) => rows.filter(row => !ids.includes(row.doc_id));
  const rename = <T extends { doc_id: string }>(rows: T[]) => receipt.removed ? keep(rows) : rows.map(row => ids.includes(row.doc_id) ? { ...row, doc_id: receipt.doc_id } : row);
  return { ...data, requisitions: [...keep(data.requisitions), ...(receipt.requisition ? [receipt.requisition] : [])],
    requisition_logs: [...rename(data.requisition_logs).filter(row => row.log_id !== receipt.status_log?.log_id), ...(receipt.status_log ? [receipt.status_log] : [])],
    document_groups: rename(data.document_groups), offers: rename(data.offers) };
}
export function patchRequisitionDataSince(client: object, scope: string, data: DashboardData, epoch: number) {
  let result = data; for (const receipt of state(client, scope).receipts) if ((receipt.commit_epoch ?? 0) >= epoch) result = applyRequisitionReceipt(result, receipt); return result;
}
export function patchRequisitionDetail<T>(client: object, scope: string, detail: T, epoch = 0): T {
  if (Array.isArray(detail)) return patchRequisitionRows(client,scope,detail,{entity:"requisitions"},epoch) as T;
  if (!detail || typeof detail !== "object" || !("status" in detail) || detail.status !== "ready") return detail;
  let result = detail as Record<string, unknown>;
  const readEpoch=Math.max(epoch,Number(result.__requisitionReadEpoch??0));
  for (const receipt of state(client, scope).receipts) {
    if ((receipt.commit_epoch ?? 0) < readEpoch) continue;
    if (result.requisition && [receipt.previous_doc_id, receipt.doc_id, ...(receipt.aliases ?? [])].includes((result.requisition as Requisition).doc_id)) {
      const current = result.requisition as Requisition;
      if (receipt.updated_at && current.updated_at && (Date.parse(current.updated_at) > Date.parse(receipt.updated_at) || Date.parse(current.updated_at) === Date.parse(receipt.updated_at) && Object.entries(receipt.requisition ?? {}).every(([key,value])=>current[key as keyof Requisition]===value) && (!receipt.status_log || ((result.history ?? []) as RequisitionLog[]).some(row=>row.log_id===receipt.status_log?.log_id))) && current.doc_id === receipt.doc_id) continue;
      if (receipt.removed) return { status: "unavailable", reason: "not_found_or_not_authorized" } as T;
      const history = (result.history ?? []) as RequisitionLog[];
      result = { ...result, requisition: receipt.requisition,
        metrics: receipt.display ? { ...(result.metrics as object), candidateCount:receipt.display.candidate_count,acceptedOfferCount:receipt.display.accepted_count,openHeadcount:receipt.display.open_headcount,slaRestartDate:receipt.display.sla_restart_date } : result.metrics,
        history: [...history.filter(row => row.log_id !== receipt.status_log?.log_id).map(row => ({ ...row, doc_id: receipt.doc_id })), ...(receipt.status_log ? [receipt.status_log] : [])],
        documentGroups: ((result.documentGroups ?? []) as {doc_id:string}[]).map(row => ({ ...row, doc_id: receipt.doc_id })), updating: true };
    } else if (Array.isArray(result.requisitions)) {
      const ids=[receipt.doc_id,receipt.previous_doc_id,...(receipt.aliases??[])];
      const linked=(rows:unknown)=>Array.isArray(rows)?rows.flatMap((row:{doc_id:string})=>ids.includes(row.doc_id)?receipt.removed?[]:[{...row,doc_id:receipt.doc_id}]:[row]):rows;
      result = { ...result, requisitions: patchRequisitionRows(client, scope, result.requisitions, { entity: "requisitions" }, readEpoch), documentGroups:linked(result.documentGroups),offers:linked(result.offers) };
    }
  }
  return { ...result,__requisitionReadEpoch:readEpoch } as T;
}

const locks = new WeakMap<object, Set<string>>(), uncertain = new WeakMap<object, Set<string>>();
function keys(map: WeakMap<object, Set<string>>, client: object) { let value = map.get(client); if (!value) { value = new Set(); map.set(client,value); } return value; }
export async function reconcileRequisitionAction(client: SupabaseClient, scope: string, payload: Record<string, unknown>) {
  const started = performance.now(), ids = [...new Set([payload.previous_doc_id,payload.doc_id].filter(Boolean).map(String))];
  const result = await client.from("requisitions").select("*").in("doc_id", ids);
  if (result.error) throw new Error(result.error.message);
  // This establishes current authorized state, not whether a lost request succeeded.

  emit("reconciliation",performance.now()-started);
  return (result.data ?? []) as Requisition[];
}
export function requisitionNeedsReconciliation(client: object,scope: string,docId: string){return keys(uncertain,client).has(scope+"\u001f"+docId);}
export function acknowledgeRequisitionReconciliation(client: object,scope: string,docId: string){keys(uncertain,client).delete(scope+"\u001f"+docId);}
export async function performRequisitionAction(client: SupabaseClient, scope: string, operation: string, payload: Record<string, unknown>) {
  if (!isRequisitionAction(operation)) throw new Error("Unsupported requisition action.");
  const ids = [...new Set([payload.previous_doc_id,payload.doc_id].filter(Boolean).map(id=>scope+"\u001f"+id))];
  const pending = keys(locks,client), unknown = keys(uncertain,client);
  if (ids.some(id=>pending.has(id))) throw new Error("This requisition is already saving.");
  if (ids.some(id=>unknown.has(id))) {
    await reconcileRequisitionAction(client,scope,payload);
    throw new Error("The previous save outcome was uncertain. Current access was reconciled; reload and review this requisition before saving again.");
  }
  ids.forEach(id=>pending.add(id));
  const requestId=crypto.randomUUID(), started=performance.now();
  try {
    const {data,error} = await client.rpc("app_requisition_action_v1",{payload:{operation,payload,request_id:requestId}}).then(value=>value,error=>{ids.forEach(id=>unknown.add(id));throw error;});
    emit("write",performance.now()-started);
    if(error) { if(!error.code || error.message.includes("Failed to fetch"))ids.forEach(id=>unknown.add(id)); throw new Error(error.message); }
    const receipt=data?.action_result as RequisitionActionReceipt | undefined;
    if(!data?.ok || !receipt || receipt.version!==1 || receipt.request_id!==requestId || receipt.operation!==operation
      || receipt.doc_id!==String(payload.doc_id) || !Array.isArray(receipt.groups) || !Array.isArray(receipt.source_groups)
      || !Array.isArray(receipt.effects) || !Array.isArray(receipt.changed_fields) || (!receipt.removed && (!receipt.requisition || receipt.requisition.doc_id!==receipt.doc_id || !receipt.updated_at))) {
      ids.forEach(id=>unknown.add(id)); throw new Error("Save response could not be verified. Reload and review the requisition before continuing.");
    }
    if(received.size>=100)received.delete(received.keys().next().value!);
    received.set(requestId,performance.now()); return data as Record<string,unknown> & {ok:true;action_result:RequisitionActionReceipt};
  } catch(error) { if(error instanceof TypeError)ids.forEach(id=>unknown.add(id)); if(ids.some(id=>unknown.has(id)))throw new Error((error instanceof Error?error.message:String(error))+" The save outcome is uncertain; reload and review this requisition before saving again.");throw error; }
  finally { ids.forEach(id=>pending.delete(id)); }
}
type Timing = {phase:"write"|"response-to-display"|"reconciliation";durationMs:number};
const observers=new Set<(value:Timing)=>void>(),received=new Map<string,number>();
export function subscribeRequisitionActionTimings(observer:(value:Timing)=>void){observers.add(observer);return()=>{observers.delete(observer);};}
function emit(phase:Timing["phase"],durationMs:number){for(const observer of observers){try{observer({phase,durationMs});}catch{/* diagnostics cannot affect saves */}}if(typeof window!=="undefined"&&(window as Window & {__recruitmentMeasureReads?:boolean}).__recruitmentMeasureReads)window.dispatchEvent(new CustomEvent("recruitment:requisition-action-timing",{detail:{phase,durationMs}}));}
export function markRequisitionDisplayed(requestId:string){const time=received.get(requestId);if(time!==undefined){emit("response-to-display",performance.now()-time);received.delete(requestId);}}
