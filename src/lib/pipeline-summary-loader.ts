import { scheduleRecruitmentRead } from "./recruitment-read-scheduler";
import { useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PipelineSummary = {
  as_of: string;
  recent_since: string;
  active: number;
  aging: number;
  failed: number;
  passed_offer: number;
  no_activity: number;
  by_stage: Array<{ stage: string; count: number }>;
};

export type PipelineSummaryScope = { headerSite: string; headerPic: string; priorityOnly: boolean };
export type PipelineSummaryRequest = { scope: PipelineSummaryScope; groupId: string | null; asOf: string; recentDays?: number };

type SummaryEntry = { expiresAt: number; pending: Promise<PipelineSummary>; controller: AbortController; readers: number; settled: boolean };
const cache = new Map<string, SummaryEntry>();
const clientIds = new WeakMap<object, number>(); let nextClientId = 1;
const ttlMs = 30_000;
let revision = 0;
const listeners = new Set<() => void>();

export function subscribePipelineSummary(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function pipelineSummaryRevision() { return revision; }
export function clearPipelineSummaryCache(accessScope?: string, groups?: ReadonlySet<string>) {
 for (const [key, entry] of cache) { const parts = JSON.parse(key); if (accessScope && (parts[1] !== accessScope || (parts[3] && groups && !groups.has(parts[3])))) continue; entry.controller.abort(); cache.delete(key); }
 revision += 1; listeners.forEach(listener => listener());
}
async function leaseSummary(entry: SummaryEntry, signal?: AbortSignal) {
 entry.readers++; let cancel: (() => void) | undefined;
 try {
  if (signal?.aborted) throw Object.assign(new Error("Summary canceled"),{name:"AbortError"});
  const cancellation=new Promise<never>((_,reject)=>{cancel=()=>reject(Object.assign(new Error("Summary canceled"),{name:"AbortError"}));signal?.addEventListener("abort",cancel,{once:true});});
  return await (signal?Promise.race([entry.pending,cancellation]):entry.pending);
 } finally { if(cancel)signal?.removeEventListener("abort",cancel);entry.readers--;if(!entry.readers&&!entry.settled)entry.controller.abort(); }
}

/** Complete authorized pipeline summary; counts are independent of the current list page. */
export async function loadPipelineSummary(client: Pick<SupabaseClient, "rpc">, accessScope: string, request: PipelineSummaryRequest, signal?: AbortSignal): Promise<PipelineSummary> {
  const scope: PipelineSummaryScope = { headerSite: request.scope.headerSite ?? "", headerPic: request.scope.headerPic ?? "", priorityOnly: request.scope.priorityOnly ?? false };
  const { groupId, asOf, recentDays = 7 } = request;
  let id = clientIds.get(client); if (!id) { id = nextClientId++; clientIds.set(client,id); }
  for(const [key,entry] of cache)if(entry.expiresAt<=Date.now())cache.delete(key);
  while(cache.size>=100){const first=cache.keys().next().value!;cache.get(first)?.controller.abort();cache.delete(first);}
  const key = JSON.stringify([id, accessScope, scope, groupId, asOf, recentDays]);
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now() && !existing.controller.signal.aborted) return leaseSummary(existing,signal);
  const controller = new AbortController();
  const pending = scheduleRecruitmentRead(client, () => { const request = client.rpc("app_pipeline_summary_v1", { p_scope: scope, p_group_id: groupId, p_as_of: asOf, p_recent_days: recentDays }); return typeof request.abortSignal === "function" ? request.abortSignal(controller.signal) : request; }, 1, {signal:controller.signal}).then(({ data, error }) => {
    if (error) throw new Error(error.message);
    const value = data as Partial<PipelineSummary> | null;
    const count = (input: unknown): input is number => typeof input === "number" && Number.isInteger(input) && input >= 0;
    if (!value || typeof value.as_of !== "string" || typeof value.recent_since !== "string" || !count(value.active) || !count(value.aging) || !count(value.failed) || !count(value.passed_offer) || !count(value.no_activity) || !Array.isArray(value.by_stage) || value.by_stage.some(row => !row || typeof row.stage !== "string" || !count(row.count))) throw new Error("Pipeline summary returned an invalid response");
    return value as PipelineSummary;
  });
  const entry:SummaryEntry={expiresAt:Number.POSITIVE_INFINITY,pending,controller,readers:0,settled:false};cache.set(key,entry);
  void pending.then(()=>{entry.settled=true;},()=>{entry.settled=true;});
  void pending.then(() => { const entry = cache.get(key); if (entry?.pending === pending) entry.expiresAt = Date.now() + ttlMs; }, () => {});
  try { return await leaseSummary(entry,signal); }
  catch (error) { if ((!signal?.aborted || controller.signal.aborted) && cache.get(key)?.pending === pending) cache.delete(key); throw error; }
}
