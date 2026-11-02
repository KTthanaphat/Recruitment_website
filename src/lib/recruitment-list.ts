import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type RecruitmentListEntity = "candidate_registry" | "candidate_applications" | "pipeline_history" | "pipeline_stage" | "requisitions" | "position_groups" | "sourcing" | "offers" | "audit_log";
export type RecruitmentListCursor = { value: unknown; id: string };
export type RecruitmentListRequest = {
  /** Auth/project identity tuple. Prevents cross-session or cross-environment cache reuse. */
  accessScope: string;
  entity: RecruitmentListEntity;
  search?: string;
  filters?: Record<string, unknown>;
  sort?: string;
  direction?: "asc" | "desc";
  limit?: 25 | 50 | 100;
  cursor?: RecruitmentListCursor | null;
  before?: boolean;
};
export type RecruitmentListPage<T> = { items: T[]; total_count: number | null; has_more: boolean; has_more_before?: boolean; next_cursor: RecruitmentListCursor | null; previous_cursor?: RecruitmentListCursor | null };

type RpcClient = Pick<SupabaseClient, "rpc">;
const pageCache = new Map<string, { promise: Promise<RecruitmentListPage<unknown>>; expiresAt: number }>();
const countCache = new Map<string, { promise: Promise<number>; expiresAt: number }>();
const MAX_PAGE_CACHE_ENTRIES = 250;
const MAX_COUNT_CACHE_ENTRIES = 500;
const clientIds = new WeakMap<object, number>();
let nextClientId = 1;
const revision = new Map<RecruitmentListEntity, number>();
const listeners = new Map<RecruitmentListEntity, Set<() => void>>();

export function subscribeRecruitmentLists(entity: RecruitmentListEntity, listener: () => void) {
  const subscribers = listeners.get(entity) ?? new Set<() => void>();
  subscribers.add(listener); listeners.set(entity, subscribers);
  return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(entity); };
}
export function recruitmentListRevision(entity: RecruitmentListEntity) { return revision.get(entity) ?? 0; }

function clientId(client: RpcClient) {
  let id = clientIds.get(client as object);
  if (!id) { id = nextClientId++; clientIds.set(client as object, id); }
  return id;
}
function cacheKey(client: RpcClient, request: RecruitmentListRequest) {
  return JSON.stringify([clientId(client), request.accessScope, request.entity, request.search ?? "", request.filters ?? {}, request.sort ?? "", request.direction ?? "asc", request.limit ?? 50, request.cursor ?? null, request.before ?? false, revision.get(request.entity) ?? 0]);
}
function countKey(client: RpcClient, request: RecruitmentListRequest) {
  return JSON.stringify([clientId(client), request.accessScope, request.entity, request.search ?? "", request.filters ?? {}, revision.get(request.entity) ?? 0]);
}
function pruneCache<T>(cache: Map<string, { promise: Promise<T>; expiresAt: number }>, maxEntries: number) {
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expiresAt !== Number.POSITIVE_INFINITY && entry.expiresAt <= now) cache.delete(key);
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Reads one filtered, sorted keyset page. Invalid RPC payloads fail closed instead of falling back to local arrays. */
export async function fetchRecruitmentList<T>(client: RpcClient, request: RecruitmentListRequest): Promise<RecruitmentListPage<T>> {
  pruneCache(pageCache, MAX_PAGE_CACHE_ENTRIES);
  const normalized = { ...request, search: request.search ?? "", filters: request.filters ?? {}, sort: request.sort ?? "", direction: request.direction ?? "asc", limit: request.limit ?? 50 };
  const key = cacheKey(client, normalized);
  let cached = pageCache.get(key);
  if (cached && cached.expiresAt <= Date.now()) { pageCache.delete(key); cached = undefined; }
  if (!cached) {
    const created: Promise<RecruitmentListPage<unknown>> = Promise.resolve(client.rpc("app_recruitment_list_v1", {
      p_entity: normalized.entity,
      p_search: normalized.search,
      p_filters: normalized.filters,
      p_sort: normalized.sort,
      p_direction: normalized.direction,
      p_limit: normalized.limit,
      p_cursor_value: normalized.cursor?.value ?? null,
      p_cursor_id: normalized.cursor?.id ?? null,
      p_before: normalized.before ?? false
    })).then(({ data, error }) => {
      if (error) throw new Error(error.message);
      const result = data as Partial<RecruitmentListPage<unknown>> | null;
      const limit = normalized.limit ?? 50;
      const cursorIsValid = (value: unknown) => value === null || (typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string" && "value" in value);
      if (!result || !Array.isArray(result.items) || !(result.total_count === undefined || result.total_count === null || (typeof result.total_count === "number" && Number.isInteger(result.total_count) && result.total_count >= 0)) || result.items.length > limit || typeof result.has_more !== "boolean" || typeof result.has_more_before !== "boolean" || !cursorIsValid(result.next_cursor) || !cursorIsValid(result.previous_cursor) || (result.has_more && (!result.next_cursor || result.items.length === 0)) || (!result.has_more && result.next_cursor !== null) || (result.has_more_before !== Boolean(result.previous_cursor)) || (result.has_more_before && result.items.length === 0)) {
        throw new Error("Recruitment list returned an invalid response");
      }
      return { ...result, total_count: result.total_count ?? null } as RecruitmentListPage<unknown>;
    });
    cached = { promise: created, expiresAt: Number.POSITIVE_INFINITY };
    pageCache.set(key, cached);
    pruneCache(pageCache, MAX_PAGE_CACHE_ENTRIES);
    void created.then(() => { const current = pageCache.get(key); if (current?.promise === created) current.expiresAt = Date.now() + 30_000; }, () => { if (pageCache.get(key)?.promise === created) pageCache.delete(key); });
  }
  try { return await cached.promise as RecruitmentListPage<T>; }
  catch (error) { if (pageCache.get(key) === cached) pageCache.delete(key); throw error; }
}

/** Counts the full authorized criteria scope separately from cursor projection and pages. */
export async function fetchRecruitmentListCount(client: RpcClient, request: RecruitmentListRequest): Promise<number> {
  pruneCache(countCache, MAX_COUNT_CACHE_ENTRIES);
  const normalized = { ...request, search: request.search ?? "", filters: request.filters ?? {} };
  const key = countKey(client, normalized);
  let cached = countCache.get(key);
  if (cached && cached.expiresAt <= Date.now()) { countCache.delete(key); cached = undefined; }
  if (!cached) {
    const created = Promise.resolve(client.rpc("app_recruitment_list_count_v1", {
      p_entity: normalized.entity, p_search: normalized.search, p_filters: normalized.filters
    })).then(({ data, error }) => {
      if (error) throw new Error(error.message);
      if (typeof data !== "number" || !Number.isInteger(data) || data < 0) throw new Error("Recruitment list count returned an invalid response");
      return data;
    });
    cached = { promise: created, expiresAt: Number.POSITIVE_INFINITY };
    countCache.set(key, cached);
    pruneCache(countCache, MAX_COUNT_CACHE_ENTRIES);
    void created.then(() => { const current = countCache.get(key); if (current?.promise === created) current.expiresAt = Date.now() + 30_000; }, () => { if (countCache.get(key)?.promise === created) countCache.delete(key); });
  }
  try { return await cached.promise; }
  catch (error) { if (countCache.get(key) === cached) countCache.delete(key); throw error; }
}

/** Invalidate only affected list families after a successful mutation. */
export function invalidateRecruitmentLists(...entities: RecruitmentListEntity[]) {
  const targets = new Set(entities);
  for (const entity of targets) { revision.set(entity, (revision.get(entity) ?? 0) + 1); listeners.get(entity)?.forEach(listener => listener()); }
  for (const key of pageCache.keys()) {
    const parsed = JSON.parse(key) as [number, string, RecruitmentListEntity];
    if (targets.has(parsed[2])) pageCache.delete(key);
  }
  for (const key of countCache.keys()) {
    const parsed = JSON.parse(key) as [number, string, RecruitmentListEntity];
    if (targets.has(parsed[2])) countCache.delete(key);
  }
}

const AUDIT_MUTATION_DEPENDENCIES = ["audit_log"] as const satisfies readonly RecruitmentListEntity[];
const APPLICATION_MUTATION_DEPENDENCIES = ["audit_log", "candidate_registry", "candidate_applications", "pipeline_history", "pipeline_stage", "offers", "requisitions", "position_groups", "sourcing"] as const satisfies readonly RecruitmentListEntity[];
const OFFER_MUTATION_DEPENDENCIES = ["audit_log", "offers", "candidate_registry", "candidate_applications", "pipeline_history", "pipeline_stage", "requisitions", "position_groups", "sourcing"] as const satisfies readonly RecruitmentListEntity[];
const REQUISITION_GROUP_MUTATION_DEPENDENCIES = ["audit_log", "requisitions", "position_groups", "sourcing", "offers", "candidate_registry", "candidate_applications", "pipeline_history", "pipeline_stage"] as const satisfies readonly RecruitmentListEntity[];

/** Exact post-write dependencies; unknown endpoint names invalidate audit only. */
export function recruitmentListDependenciesForMutation(endpoint: string): readonly RecruitmentListEntity[] {
  if (["app_upsert_offer", "app_confirm_offer_start_v1"].includes(endpoint)) return OFFER_MUTATION_DEPENDENCIES;
  if ([
    "app_create_candidate_application_v1", "app_start_pipeline_stage_v2", "app_update_pipeline_pending_v2",
    "app_complete_pipeline_stage_v2", "app_pass_pipeline_jump_v2", "app_correct_pipeline_stage_record_v3",
    "app_save_candidate_reference_check_v1", "app_set_candidate_reference_status_v1", "app_upsert_candidate_reference_v1",
    "app_upsert_candidate_profile_v2", "app_interview_meetings", "app_rejection_letter_draft", "app_transfer_candidate_application_v1"
  ].includes(endpoint)) return APPLICATION_MUTATION_DEPENDENCIES;
  if ([
    "app_upsert_requisition", "app_set_requisition_priority_v1", "app_insert_requisition_log", "app_upsert_position_group",
    "app_update_sourcing_group_info_v1", "app_set_sourcing_group_channel_v1", "app_upsert_sourcing_weekly_update",
    "app_upsert_vacancy_weekly_snapshot", "app_create_group_match", "app_create_and_match_sourcing_group_v2",
    "app_unmatch_group_requisition", "app_delete_recruitment_record"
  ].includes(endpoint)) return REQUISITION_GROUP_MUTATION_DEPENDENCIES;
  return AUDIT_MUTATION_DEPENDENCIES;
}

export function invalidateRecruitmentListsForMutation(endpoint: string) {
  invalidateRecruitmentLists(...recruitmentListDependenciesForMutation(endpoint));
}

export function clearRecruitmentListCache() {
  pageCache.clear();
  countCache.clear();
  for (const entity of listeners.keys()) { revision.set(entity, (revision.get(entity) ?? 0) + 1); listeners.get(entity)?.forEach(listener => listener()); }
}

export function useRecruitmentList<T>({ client, accessScope, entity, filters = {}, sort = "", direction = "asc", initialPageSize = 50, enabled = true, searchInput }: { client: SupabaseClient | null; accessScope: string; entity: RecruitmentListEntity; filters?: Record<string, unknown>; sort?: string; direction?: "asc" | "desc"; initialPageSize?: 25 | 50 | 100; enabled?: boolean; searchInput?: { value: string; setValue: (value: string) => void } }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1), [displayPage, setDisplayPage] = useState(1), [pageSize, setPageSize] = useState<25 | 50 | 100>(initialPageSize);
  const [cursor, setCursor] = useState<RecruitmentListCursor | null>(null), [before, setBefore] = useState(false), [cursorCriteria, setCursorCriteria] = useState("");
  const [result, setResult] = useState<RecruitmentListPage<T> | null>(null), [loadedKey, setLoadedKey] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const navigationPending = useRef(false);
  const listRevision = useSyncExternalStore(listener => subscribeRecruitmentLists(entity, listener), () => recruitmentListRevision(entity), () => 0);
  const filterKey = JSON.stringify(filters);
  const criteriaKey = JSON.stringify([client ? clientId(client) : 0, accessScope, entity, debouncedSearch, filterKey, sort, direction, pageSize, listRevision, enabled]);
  const effectiveCursor = cursorCriteria === criteriaKey ? cursor : null;
  const effectiveBefore = cursorCriteria === criteriaKey && before;
  const requestPage = effectiveCursor ? page : 1;
  const requestKey = JSON.stringify([criteriaKey, effectiveCursor, effectiveBefore, requestPage]);
  const activeSearch = searchInput?.value ?? search;
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(activeSearch.trim()), 300); return () => clearTimeout(timer); }, [activeSearch]);
  useEffect(() => { navigationPending.current = false; setPage(1); setCursor(null); setBefore(false); setCursorCriteria(""); }, [criteriaKey]);
  useEffect(() => {
    if (!enabled || !client || !accessScope) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError(false);
    fetchRecruitmentList<T>(client, { accessScope, entity, search: debouncedSearch, filters, sort, direction, limit: pageSize, cursor: effectiveCursor, before: effectiveBefore })
      .then(pageResult => { if (cancelled) return; setResult(pageResult); setLoadedKey(requestKey); setDisplayPage(requestPage); if (!effectiveCursor) setPage(1); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) { setLoading(false); navigationPending.current = false; } });
    return () => { cancelled = true; };
  }, [accessScope, client, debouncedSearch, direction, effectiveBefore, effectiveCursor, enabled, entity, filterKey, listRevision, page, pageSize, requestKey, retry, sort]);
  const countCriteriaKey = JSON.stringify([client ? clientId(client) : 0, accessScope, entity, debouncedSearch, filterKey, listRevision, enabled]);
  const [countState, setCountState] = useState<{ key: string; value: number | null; loading: boolean; error: boolean }>({ key: "", value: null, loading: false, error: false });
  const [countRetry, setCountRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !client || !accessScope) { setCountState({ key: countCriteriaKey, value: null, loading: false, error: false }); return; }
    let cancelled = false;
    setCountState({ key: countCriteriaKey, value: null, loading: true, error: false });
    fetchRecruitmentListCount(client, { accessScope, entity, search: debouncedSearch, filters })
      .then(value => { if (!cancelled) setCountState({ key: countCriteriaKey, value, loading: false, error: false }); })
      .catch(() => { if (!cancelled) setCountState({ key: countCriteriaKey, value: null, loading: false, error: true }); });
    return () => { cancelled = true; };
  }, [accessScope, client, countCriteriaKey, countRetry, debouncedSearch, enabled, entity, filterKey, listRevision]);
  const current = loadedKey === requestKey ? result : null;
  const currentCount = countState.key === countCriteriaKey ? countState : null;
  function goNext() {
    if (loading || navigationPending.current || !current?.has_more || !current.next_cursor) return;
    navigationPending.current = true; setCursor(current.next_cursor); setBefore(false); setCursorCriteria(criteriaKey); setPage(value => value + 1);
  }
  function goPrevious() {
    if (loading || navigationPending.current || page <= 1) return;
    if (!current?.previous_cursor) { goFirst(); return; }
    navigationPending.current = true; setCursor(current.previous_cursor); setBefore(true); setCursorCriteria(criteriaKey); setPage(value => value - 1);
  }
  function goFirst() { if (loading || navigationPending.current || page <= 1) return; navigationPending.current = true; setCursor(null); setBefore(false); setCursorCriteria(criteriaKey); setPage(1); }
  function changePageSize(value: number) { if (value !== 25 && value !== 50 && value !== 100) return; setPageSize(value); }
  const totalCount = currentCount?.value ?? null;
  const countLoading = currentCount?.loading ?? Boolean(enabled && client && accessScope);
  const countError = currentCount?.error ?? false;
  return { search: activeSearch, setSearch: searchInput?.setValue ?? setSearch, items: current?.items ?? [], totalCount, countLabel: totalCount === null ? countError ? "—" : countLoading ? "…" : "—" : String(totalCount), countLoading, countError, page: displayPage, pageSize, setPageSize: changePageSize, loading, error, canPrevious: !loading && page > 1, canNext: !loading && Boolean(current?.has_more && current.next_cursor), goPrevious, goNext, goFirst, retry: () => setRetry(value => value + 1), retryCount: () => setCountRetry(value => value + 1) };
}
