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

const cache = new Map<string, { expiresAt: number; pending: Promise<PipelineSummary> }>();
const ttlMs = 30_000;
let revision = 0;
const listeners = new Set<() => void>();

export function subscribePipelineSummary(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
export function pipelineSummaryRevision() { return revision; }
export function clearPipelineSummaryCache() { cache.clear(); revision += 1; listeners.forEach(listener => listener()); }

/** Complete authorized pipeline summary; counts are independent of the current list page. */
export async function loadPipelineSummary(client: Pick<SupabaseClient, "rpc">, accessScope: string, scope: Record<string, unknown>, groupId: string | null, asOf: string, recentDays = 7): Promise<PipelineSummary> {
  const key = JSON.stringify([accessScope, scope, groupId, asOf, recentDays]);
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.pending;
  const pending = Promise.resolve(client.rpc("app_pipeline_summary_v1", { p_scope: scope, p_group_id: groupId, p_as_of: asOf, p_recent_days: recentDays })).then(({ data, error }) => {
    if (error) throw new Error(error.message);
    const value = data as Partial<PipelineSummary> | null;
    const count = (input: unknown): input is number => typeof input === "number" && Number.isInteger(input) && input >= 0;
    if (!value || typeof value.as_of !== "string" || typeof value.recent_since !== "string" || !count(value.active) || !count(value.aging) || !count(value.failed) || !count(value.passed_offer) || !count(value.no_activity) || !Array.isArray(value.by_stage) || value.by_stage.some(row => !row || typeof row.stage !== "string" || !count(row.count))) throw new Error("Pipeline summary returned an invalid response");
    return value as PipelineSummary;
  });
  cache.set(key, { expiresAt: Date.now() + ttlMs, pending });
  try { return await pending; }
  catch (error) { if (cache.get(key)?.pending === pending) cache.delete(key); throw error; }
}
