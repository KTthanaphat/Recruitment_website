import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChangeLog } from "@/types/recruitment";

export type ScopedAccessIdentity = { profileId: string; key: string };
export type ScopedUnavailableReason = "not_found_or_not_authorized" | "incomplete" | "read_failed";
export type ActivityCursor = { changedAt: string; logId: number };
export type ScopedActivityPage = { items: ChangeLog[]; totalCount: number; hasMore: boolean; nextCursor: ActivityCursor | null };
export type ScopedPageResult<T> = { items: T[]; totalCount: number; hasMore: boolean; nextCursor: ActivityCursor | null };

type QueryResult<T> = { data: T[] | null; error: { message: string } | null; count: number | null };
type QueryClient = Pick<SupabaseClient, "auth"> & { from: (table: string) => any };
const PAGE_SIZE = 200;
const ACTIVITY_SIZE = 25;

export class ScopedReadError extends Error {
  constructor(readonly reason: ScopedUnavailableReason, message: string) { super(message); }
}

/** Bind every lookup to the current authenticated profile and caller's project/access identity. */
export async function verifyScopedIdentity(client: QueryClient, identity: ScopedAccessIdentity) {
  if (!identity.key.trim() || !identity.profileId.trim()) throw new ScopedReadError("read_failed", "A scoped access identity is required.");
  const { data, error } = await client.auth.getSession();
  if (error) throw new ScopedReadError("read_failed", "Unable to verify the active session.");
  if (!data.session?.user?.id || data.session.user.id !== identity.profileId) throw new ScopedReadError("not_found_or_not_authorized", "The requested record is unavailable.");
}

/** Read a filtered relation in stable pages. Counts, identities, and page boundaries must agree. */
export async function readCompleteScopedPages<T>(
  makePage: (from: number, to: number) => PromiseLike<QueryResult<T>>,
  rowKey: (row: T) => string,
  label: string,
): Promise<T[]> {
  const output: T[] = [], seen = new Set<string>();
  let expected: number | null = null;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await makePage(offset, offset + PAGE_SIZE - 1);
    if (result.error) throw new ScopedReadError("read_failed", result.error.message || `Could not read ${label}.`);
    if (typeof result.count !== "number" || !Number.isInteger(result.count) || result.count < 0) throw new ScopedReadError("incomplete", `Could not verify the complete ${label} set.`);
    if (expected !== null && expected !== result.count) throw new ScopedReadError("incomplete", `${label} changed during retrieval.`);
    expected = result.count;
    const page = result.data ?? [];
    if (page.length > PAGE_SIZE) throw new ScopedReadError("incomplete", `${label} page exceeded its bound.`);
    for (const row of page) {
      const key = rowKey(row);
      if (!key || seen.has(key)) throw new ScopedReadError("incomplete", `Duplicate or invalid ${label} row.`);
      seen.add(key); output.push(row);
    }
    if (output.length === expected) return output;
    if (page.length !== PAGE_SIZE || output.length > expected) throw new ScopedReadError("incomplete", `Incomplete ${label} retrieval.`);
  }
}

export async function readScopedInPages<T>(client: QueryClient, table: string, column: string, values: readonly string[], order: string, label: string, columns = "*") {
  const uniqueValues = [...new Set(values)].filter(Boolean).sort();
  const output: T[] = [], seen = new Set<string>();
  for (let start = 0; start < uniqueValues.length; start += 200) {
    const chunk = uniqueValues.slice(start, start + 200);
    const rows = await readCompleteScopedPages<T>(
      (from, to) => client.from(table).select(columns, { count: "exact" }).in(column, chunk).order(order, { ascending: true }).range(from, to),
      row => String((row as Record<string, unknown>)[order] ?? ""),
      label,
    );
    for (const row of rows) {
      const key = rowKeyForTable(table, row);
      if (seen.has(key)) throw new ScopedReadError("incomplete", `Duplicate ${label} row across lookup chunks.`);
      seen.add(key); output.push(row);
    }
  }
  return output;
}

function rowKeyForTable(table: string, row: unknown) {
  const value = row as Record<string, unknown>;
  if (table === "sourcing_weekly_updates") return `${String(value.group_id ?? "")}\u001f${String(value.week_start ?? "")}`;
  return String(value.doc_group_id ?? value.application_id ?? value.offer_id ?? value.log_id ?? value.group_id ?? value.doc_id ?? "");
}

const cursorDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
function validateActivityCursor(cursor?: ActivityCursor | null): ActivityCursor | null {
  if (cursor == null) return null;
  if (!cursorDatePattern.test(cursor.changedAt) || !Number.isSafeInteger(cursor.logId) || cursor.logId < 1) throw new ScopedReadError("read_failed", "Invalid activity cursor.");
  return cursor;
}

/** A bounded descending activity page; identity and entity keys are exact, never substring filters. */
export async function readScopedActivityPage(client: QueryClient, entity: "requisitions" | "position_groups", entityId: string, cursorInput?: ActivityCursor | null): Promise<ScopedActivityPage> {
  const cursor = validateActivityCursor(cursorInput);
  let countQuery = client.from("change_logs").select("log_id", { count: "exact", head: true }).eq("entity", entity).eq("entity_id", entityId);
  const countResult = await countQuery;
  if (countResult.error) throw new ScopedReadError("read_failed", countResult.error.message || "Could not read activity count.");
  if (typeof countResult.count !== "number" || !Number.isInteger(countResult.count) || countResult.count < 0) throw new ScopedReadError("incomplete", "Could not verify activity count.");
  let pageQuery = client.from("change_logs").select("log_id,entity,entity_id,action,changed_at,changed_by,changed_by_email,old_data,new_data", { count: "exact" }).eq("entity", entity).eq("entity_id", entityId);
  if (cursor) pageQuery = pageQuery.or(`changed_at.lt.${cursor.changedAt},and(changed_at.eq.${cursor.changedAt},log_id.lt.${cursor.logId})`);
  const result = await pageQuery.order("changed_at", { ascending: false }).order("log_id", { ascending: false }).range(0, ACTIVITY_SIZE);
  if (result.error) throw new ScopedReadError("read_failed", result.error.message || "Could not read activity rows.");
  const page = (result.data ?? []) as ChangeLog[];
  const ids = new Set<number>();
  for (const row of page) {
    if (!Number.isSafeInteger(row.log_id) || ids.has(row.log_id) || row.entity !== entity || row.entity_id !== entityId) throw new ScopedReadError("incomplete", "Activity rows failed identity validation.");
    ids.add(row.log_id);
  }
  const hasExtra = page.length > ACTIVITY_SIZE;
  const items = page.slice(0, ACTIVITY_SIZE);
  const last = items.at(-1);
  const nextCursor = hasExtra && last ? { changedAt: last.changed_at, logId: last.log_id } : null;
  if (nextCursor && cursor && nextCursor.changedAt === cursor.changedAt && nextCursor.logId === cursor.logId) throw new ScopedReadError("incomplete", "Activity cursor did not advance.");
  return { items, totalCount: countResult.count, hasMore: hasExtra, nextCursor };
}

export function scopedUnavailableReason(error: unknown): ScopedUnavailableReason {
  if (error instanceof ScopedReadError) return error.reason;
  if (error && typeof error === "object" && "reason" in error && (error.reason === "not_found_or_not_authorized" || error.reason === "incomplete" || error.reason === "read_failed")) return error.reason;
  return "read_failed";
}
