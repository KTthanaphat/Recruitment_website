import { candidateReceiptRevision, nextCandidateReadEpoch, subscribeCandidateReceipts, patchCandidateRows, type CandidateActionReceipt } from "./candidate-action-receipt";
import { scheduleRecruitmentRead, promoteRecruitmentRead, clearRecruitmentReadQueue } from "./recruitment-read-scheduler";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

export type RecruitmentListEntity = "candidate_registry" | "candidate_applications" | "pipeline_history" | "pipeline_stage" | "requisitions" | "position_groups" | "sourcing" | "sourcing_records" | "offers" | "audit_log";
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
  signal?: AbortSignal;
  background?: boolean;
  priority?: number;
  freshAfter?: number;
};
export type RecruitmentReadPhases = { queueMs: number; requestMs: number; receivedAt: number; cacheHit: boolean };
export type RecruitmentListPage<T> = { readStarted?: number; readTiming?: RecruitmentReadPhases; items: T[]; total_count: number | null; has_more: boolean; has_more_before?: boolean; next_cursor: RecruitmentListCursor | null; previous_cursor?: RecruitmentListCursor | null };

type RpcClient = Pick<SupabaseClient, "rpc">;
type ReadEntry<T> = { epoch: number; promise: Promise<T>; expiresAt: number; controller: AbortController; readers: number; settled: boolean };
const pageCache = new Map<string, ReadEntry<RecruitmentListPage<unknown>>>();
const countCache = new Map<string, ReadEntry<number>>();
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

async function lease<T>(entry: ReadEntry<T>, signal?: AbortSignal): Promise<T> {
  entry.readers++;
  let cancel: (() => void) | undefined;
  try {
    if (signal?.aborted) throw Object.assign(new Error("Read canceled"), { name: "AbortError" });
    const cancellation = new Promise<never>((_, reject) => { cancel = () => reject(Object.assign(new Error("Read canceled"), { name: "AbortError" })); signal?.addEventListener("abort", cancel, { once: true }); });
    return await (signal ? Promise.race([entry.promise, cancellation]) : entry.promise);
  } finally { if (cancel) signal?.removeEventListener("abort", cancel); entry.readers--; if (!entry.readers && !entry.settled) entry.controller.abort(); }
}

type QueryRevision = { kind: "records" | "count"; client: object; request: RecruitmentListRequest; revision: number; listeners: Set<() => void> };
const queryRevisions = new Map<string, QueryRevision>();
function queryRevisionEntry(client: object, request: RecruitmentListRequest, kind: "records" | "count" = "records") {
 const key = JSON.stringify([clientId(client as RpcClient), request.accessScope, request.entity, request.search ?? "", request.filters ?? {}, kind]);
 if (queryRevisions.size >= 500) for (const [oldKey, old] of queryRevisions) { if (!old.listeners.size) queryRevisions.delete(oldKey); if (queryRevisions.size < 400) break; }
 let entry = queryRevisions.get(key); if (!entry) { entry = { kind, client, request, revision: 0, listeners: new Set() }; queryRevisions.set(key, entry); }
 return entry;
}
export function recruitmentQueryRevision(client: object | null, request: RecruitmentListRequest, kind: "records" | "count" = "records") { return client ? queryRevisionEntry(client, request, kind).revision : 0; }
export function subscribeRecruitmentQuery(client: object | null, request: RecruitmentListRequest, listener: () => void, kind: "records" | "count" = "records") {
 if (!client) return () => {}; const entry = queryRevisionEntry(client, request, kind); entry.listeners.add(listener); return () => { entry.listeners.delete(listener); };
}
function affectedQuery(request: RecruitmentListRequest, receipt: CandidateActionReceipt, count = false) {
 if (!recruitmentListDependenciesForMutation(receipt.operation).includes(request.entity)) return false;
 const filters = request.filters ?? {};
 if (count && request.entity !== "audit_log" && !receipt.effects.includes("counts")) {
  const changesMembership = Boolean(request.search) || (receipt.operation === "app_upsert_candidate_profile_v2" && request.entity === "candidate_registry") || ["aging","over_sla"].includes(String(filters.boardFilter ?? ""));
  if (!changesMembership) return false;
 }
 if (filters.candidateId && filters.candidateId !== receipt.candidate_id) return false;
 if (filters.applicationId && !receipt.application_ids.includes(String(filters.applicationId))) return false;
 if (filters.groupId && ![...receipt.source_groups, ...receipt.groups].includes(String(filters.groupId))) return false;
 if ((request.entity === "pipeline_stage" || request.entity === "candidate_applications" && filters.boardFilter === "failed") && filters.stage && ![...(receipt.source_stages ?? []), ...receipt.cards.map(row => row.latest_process)].includes(String(filters.stage))) return false;
 return true;
}
/** Revalidate loaded affected criteria once; untouched stages keep their pages and requests. */
export function invalidateCandidateRecruitmentLists(client: object, scope: string, receipts: CandidateActionReceipt[]) {
 for (const entry of queryRevisions.values()) if (entry.client === client && entry.request.accessScope === scope && receipts.some(receipt => affectedQuery(entry.request, receipt, entry.kind === "count"))) { entry.revision++; entry.listeners.forEach(listener => listener()); }
 for (const cache of [pageCache, countCache]) for (const key of cache.keys()) {
  const parts = JSON.parse(key); if (parts[0] !== clientId(client as RpcClient) || parts[1] !== scope) continue;
  const request = { accessScope: scope, entity: parts[2], search: parts[3], filters: parts[4] };
  if (receipts.some(receipt => affectedQuery(request, receipt, cache === countCache) && (cache.get(key)?.epoch ?? 0) < (receipt.commit_epoch ?? Number.POSITIVE_INFINITY))) cache.delete(key);
 }
}

/** Reads one filtered, sorted keyset page. Invalid RPC payloads fail closed instead of falling back to local arrays. */
export async function fetchRecruitmentList<T>(client: RpcClient, request: RecruitmentListRequest): Promise<RecruitmentListPage<T>> {
  pruneCache(pageCache, MAX_PAGE_CACHE_ENTRIES);
  const started = nextCandidateReadEpoch();
  const normalized = { ...request, search: request.search ?? "", filters: request.filters ?? {}, sort: request.sort ?? "", direction: request.direction ?? "asc", limit: request.limit ?? 50 };
  const key = cacheKey(client, normalized);
  let cached = pageCache.get(key);
  if (cached && (cached.expiresAt <= Date.now() || (request.freshAfter !== undefined && cached.epoch <= request.freshAfter))) { pageCache.delete(key); cached = undefined; }
  const fromCache = Boolean(cached?.settled && !cached.controller.signal.aborted);
  if (!cached || cached.controller.signal.aborted) {
    const queuedAt = performance.now();
    let requestStarted = queuedAt;
    const controller = new AbortController();
    const created: Promise<RecruitmentListPage<unknown>> = scheduleRecruitmentRead(client, () => { requestStarted = performance.now(); const call = client.rpc("app_recruitment_list_v1", {
      p_entity: normalized.entity,
      p_search: normalized.search,
      p_filters: normalized.filters,
      p_sort: normalized.sort,
      p_direction: normalized.direction,
      p_limit: normalized.limit,
      p_cursor_value: normalized.cursor?.value ?? null,
      p_cursor_id: normalized.cursor?.id ?? null,
      p_before: normalized.before ?? false
    }); return typeof call.abortSignal === "function" ? call.abortSignal(controller.signal) : call; }, request.priority ?? (request.background ? 20 : 0), { signal: controller.signal }).then(({ data, error }) => {
      if (error) throw new Error(error.message);
      const result = data as Partial<RecruitmentListPage<unknown>> | null;
      const limit = normalized.limit ?? 50;
      const cursorIsValid = (value: unknown) => value === null || (typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string" && "value" in value);
      if (!result || !Array.isArray(result.items) || !(result.total_count === undefined || result.total_count === null || (typeof result.total_count === "number" && Number.isInteger(result.total_count) && result.total_count >= 0)) || result.items.length > limit || typeof result.has_more !== "boolean" || typeof result.has_more_before !== "boolean" || !cursorIsValid(result.next_cursor) || !cursorIsValid(result.previous_cursor) || (result.has_more && (!result.next_cursor || result.items.length === 0)) || (!result.has_more && result.next_cursor !== null) || (result.has_more_before !== Boolean(result.previous_cursor)) || (result.has_more_before && result.items.length === 0)) {
        throw new Error("Recruitment list returned an invalid response");
      }
      return { ...result, readStarted: started, total_count: result.total_count ?? null, ...(normalized.entity === "sourcing_records" ? { readTiming: { queueMs: requestStarted - queuedAt, requestMs: performance.now() - requestStarted, receivedAt: performance.now(), cacheHit: false } } : {}) } as RecruitmentListPage<unknown>;
    });
    cached = { epoch: nextCandidateReadEpoch(), promise: created, expiresAt: Number.POSITIVE_INFINITY, controller, readers: 0, settled: false };
    const entry = cached; void created.then(() => { entry.settled = true; }, () => { entry.settled = true; });
    pageCache.set(key, cached);
    pruneCache(pageCache, MAX_PAGE_CACHE_ENTRIES);
    void created.then(() => { const current = pageCache.get(key); if (current?.promise === created) current.expiresAt = Date.now() + 30_000; }, () => { if (pageCache.get(key)?.promise === created) pageCache.delete(key); });
  }
  if (!request.background && !cached.settled) promoteRecruitmentRead(client, cached.controller.signal, request.priority ?? 0);
  try { const page = await lease(cached, request.signal) as RecruitmentListPage<T>; return { ...page, ...(page.readTiming && fromCache ? { readTiming: { queueMs: 0, requestMs: 0, receivedAt: performance.now(), cacheHit: true } } : {}), items: patchCandidateRows(client, request.accessScope, page.items, request, page.readStarted) }; }
  catch (error) { if ((!request.signal?.aborted || cached.controller.signal.aborted) && pageCache.get(key) === cached) pageCache.delete(key); throw error; }
}

/** Complete card projection; never publishes a partial cursor traversal. */
export async function fetchCompleteRecruitmentList<T>(client: RpcClient, request: RecruitmentListRequest, keyOf: (row: T) => string): Promise<RecruitmentListPage<T>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const items: T[] = [], ids = new Set<string>(), cursors = new Set<string>();
    let cursor: RecruitmentListCursor | null = null;
    do {
      const page: RecruitmentListPage<T> = await fetchRecruitmentList<T>(client, { ...request, limit: 100, cursor, before: false });
      for (const row of page.items) {
        const id = keyOf(row);
        if (!id || ids.has(id)) throw new Error("Complete list contains a missing or duplicate identity");
        ids.add(id); items.push(row);
      }
      cursor = page.has_more ? page.next_cursor : null;
      if (cursor) {
        const key = JSON.stringify(cursor);
        if (cursors.has(key)) throw new Error("Complete list cursor did not advance");
        cursors.add(key);
      }
    } while (cursor);
    const count = await fetchRecruitmentListCount(client, request);
    if (count === items.length) return { items, total_count: count, has_more: false, has_more_before: false, next_cursor: null, previous_cursor: null };
    // Clear cached pages for a clean second snapshot without emitting a render revision.
    for (const key of pageCache.keys()) { const parts = JSON.parse(key); if (parts[0] === clientId(client) && parts[1] === request.accessScope && parts[2] === request.entity) pageCache.delete(key); }
    for (const key of countCache.keys()) { const parts = JSON.parse(key); if (parts[0] === clientId(client) && parts[1] === request.accessScope && parts[2] === request.entity) countCache.delete(key); }
  }
  throw new Error("Matching records changed during retrieval. Please retry.");
}

/** Counts the full authorized criteria scope separately from cursor projection and pages. */
export async function fetchRecruitmentListCount(client: RpcClient, request: RecruitmentListRequest): Promise<number> {
  pruneCache(countCache, MAX_COUNT_CACHE_ENTRIES);
  const normalized = { ...request, search: request.search ?? "", filters: request.filters ?? {} };
  const key = countKey(client, normalized);
  let cached = countCache.get(key);
  if (cached && cached.expiresAt <= Date.now()) { countCache.delete(key); cached = undefined; }
  if (!cached || cached.controller.signal.aborted) {
    const controller = new AbortController();
    const created = scheduleRecruitmentRead(client, () => { const call = client.rpc("app_recruitment_list_count_v1", {
      p_entity: normalized.entity, p_search: normalized.search, p_filters: normalized.filters
    }); return typeof call.abortSignal === "function" ? call.abortSignal(controller.signal) : call; }, request.priority ?? 10, { signal: controller.signal }).then(({ data, error }) => {
      if (error) throw new Error(error.message);
      if (typeof data !== "number" || !Number.isInteger(data) || data < 0) throw new Error("Recruitment list count returned an invalid response");
      return data;
    });
    cached = { epoch: Date.now(), promise: created, expiresAt: Number.POSITIVE_INFINITY, controller, readers: 0, settled: false };
    const entry = cached; void created.then(() => { entry.settled = true; }, () => { entry.settled = true; });
    countCache.set(key, cached);
    pruneCache(countCache, MAX_COUNT_CACHE_ENTRIES);
    void created.then(() => { const current = countCache.get(key); if (current?.promise === created) current.expiresAt = Date.now() + 30_000; }, () => { if (countCache.get(key)?.promise === created) countCache.delete(key); });
  }
  if (request.priority !== undefined && !cached.settled) promoteRecruitmentRead(client, cached.controller.signal, request.priority);
  try { return await lease(cached, request.signal); }
  catch (error) { if ((!request.signal?.aborted || cached.controller.signal.aborted) && countCache.get(key) === cached) countCache.delete(key); throw error; }
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
const APPLICATION_MUTATION_DEPENDENCIES = ["audit_log", "candidate_registry", "candidate_applications", "pipeline_history", "pipeline_stage", "offers", "requisitions", "position_groups", "sourcing", "sourcing_records"] as const satisfies readonly RecruitmentListEntity[];
const OFFER_MUTATION_DEPENDENCIES = ["audit_log", "offers", "candidate_registry", "candidate_applications", "pipeline_history", "pipeline_stage", "requisitions", "position_groups", "sourcing", "sourcing_records"] as const satisfies readonly RecruitmentListEntity[];
const REQUISITION_GROUP_MUTATION_DEPENDENCIES = ["audit_log", "requisitions", "position_groups", "sourcing", "sourcing_records", "offers", "candidate_registry", "candidate_applications", "pipeline_history", "pipeline_stage"] as const satisfies readonly RecruitmentListEntity[];

/** Candidate operations are narrow; other and unknown writes keep conservative invalidation. */
export function recruitmentListDependenciesForMutation(endpoint: string): readonly RecruitmentListEntity[] {
  if (endpoint === "app_upsert_candidate_note_v2") return ["audit_log"];
  if (endpoint === "app_upsert_candidate_profile_v2") return ["candidate_registry", "candidate_applications", "pipeline_stage", "audit_log"];
  if (["app_start_pipeline_stage_v2", "app_update_pipeline_pending_v2", "app_complete_pipeline_stage_v2", "app_pass_pipeline_jump_v2", "app_correct_pipeline_stage_record_v3", "app_create_candidate_application_v1", "app_transfer_candidate_application_v1"].includes(endpoint)) return ["candidate_registry", "candidate_applications", "pipeline_history", "pipeline_stage", "audit_log"];
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
  return APPLICATION_MUTATION_DEPENDENCIES;
}

export function invalidateRecruitmentListsForMutation(endpoint: string) {
  invalidateRecruitmentLists(...recruitmentListDependenciesForMutation(endpoint));
}

export function clearRecruitmentListCache() {
  clearRecruitmentReadQueue();
  pageCache.clear();
  countCache.clear();
  for (const entity of listeners.keys()) { revision.set(entity, (revision.get(entity) ?? 0) + 1); listeners.get(entity)?.forEach(listener => listener()); }
}

export function useRecruitmentList<T>({ client, accessScope, entity, filters = {}, sort = "", direction = "asc", initialPageSize = 50, enabled = true, searchInput, complete = false, completeKey }: { client: SupabaseClient | null; accessScope: string; entity: RecruitmentListEntity; filters?: Record<string, unknown>; sort?: string; direction?: "asc" | "desc"; initialPageSize?: 25 | 50 | 100; enabled?: boolean; searchInput?: { value: string; setValue: (value: string) => void }; complete?: boolean; completeKey?: (row: T) => string }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1), [displayPage, setDisplayPage] = useState(1), [pageSize, setPageSize] = useState<25 | 50 | 100>(initialPageSize);
  const [cursor, setCursor] = useState<RecruitmentListCursor | null>(null), [before, setBefore] = useState(false), [cursorCriteria, setCursorCriteria] = useState("");
  const [result, setResult] = useState<RecruitmentListPage<T> | null>(null), [loadedKey, setLoadedKey] = useState(""), [loading, setLoading] = useState(false), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const [errorKey, setErrorKey] = useState("");
  const navigationPending = useRef(false);
  useSyncExternalStore(listener => subscribeCandidateReceipts(client, accessScope, listener), () => candidateReceiptRevision(client, accessScope), () => 0);
  const listRevision = useSyncExternalStore(listener => subscribeRecruitmentLists(entity, listener), () => recruitmentListRevision(entity), () => 0);
  const scopedRevision = useSyncExternalStore(fn => subscribeRecruitmentQuery(client, { accessScope, entity, search: debouncedSearch, filters }, fn), () => recruitmentQueryRevision(client, { accessScope, entity, search: debouncedSearch, filters }), () => 0);
  const scopedCountRevision = useSyncExternalStore(fn => subscribeRecruitmentQuery(client, { accessScope, entity, search: debouncedSearch, filters }, fn, "count"), () => recruitmentQueryRevision(client, { accessScope, entity, search: debouncedSearch, filters }, "count"), () => 0);
  const filterKey = JSON.stringify(filters);
  const criteriaKey = JSON.stringify([client ? clientId(client) : 0, accessScope, entity, debouncedSearch, filterKey, sort, direction, pageSize, enabled, complete]);
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
    const controller = new AbortController();
    setLoading(true); setError(false);
    const request = { signal: controller.signal, accessScope, entity, search: debouncedSearch, filters, sort, direction, limit: pageSize, cursor: effectiveCursor, before: effectiveBefore };
    (complete ? fetchCompleteRecruitmentList<T>(client, request, completeKey ?? ((row) => JSON.stringify(row))) : fetchRecruitmentList<T>(client, request))
      .then(pageResult => { if (cancelled) return; setResult(pageResult); setLoadedKey(requestKey); setDisplayPage(requestPage); if (!effectiveCursor) setPage(1); })
      .catch(() => { if (!cancelled) { setError(true); setErrorKey(requestKey); } })
      .finally(() => { if (!cancelled) { setLoading(false); navigationPending.current = false; } });
    return () => { cancelled = true; controller.abort(); };
  }, [accessScope, client, debouncedSearch, direction, effectiveBefore, effectiveCursor, enabled, entity, filterKey, listRevision, scopedRevision, page, pageSize, requestKey, retry, sort, complete]);
  const countCriteriaKey = JSON.stringify([client ? clientId(client) : 0, accessScope, entity, debouncedSearch, filterKey, enabled]);
  const [countState, setCountState] = useState<{ key: string; value: number | null; loading: boolean; error: boolean }>({ key: "", value: null, loading: false, error: false });
  const [countRetry, setCountRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !client || !accessScope) { setCountState({ key: countCriteriaKey, value: null, loading: false, error: false }); return; }
    if (loadedKey !== requestKey || !result || error) return;
    let cancelled = false;
    const controller = new AbortController();
    setCountState(previous => ({ key: countCriteriaKey, value: previous.key === countCriteriaKey ? previous.value : null, loading: true, error: false }));
    fetchRecruitmentListCount(client, { accessScope, entity, search: debouncedSearch, filters, signal: controller.signal })
      .then(value => { if (!cancelled) setCountState({ key: countCriteriaKey, value, loading: false, error: false }); })
      .catch(() => { if (!cancelled) setCountState(previous => ({ key: countCriteriaKey, value: previous.key === countCriteriaKey ? previous.value : null, loading: false, error: true })); });
    return () => { cancelled = true; controller.abort(); };
  }, [accessScope, client, countCriteriaKey, countRetry, debouncedSearch, enabled, entity, filterKey, listRevision, scopedCountRevision, loadedKey, requestKey, result, error]);
  const searchPending = activeSearch.trim() !== debouncedSearch;
  const activeError = error && errorKey === requestKey && !searchPending;
  const current = !searchPending && loadedKey === requestKey ? result : null;
  const currentCount = !searchPending && countState.key === countCriteriaKey ? countState : null;
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
  return { readTiming: current?.readTiming, settled: loadedKey === requestKey || activeError, initialLoading: Boolean(enabled && client && accessScope && !current && !activeError), refreshing: Boolean(loading && current), search: activeSearch, setSearch: searchInput?.setValue ?? setSearch, items: client && current ? patchCandidateRows(client, accessScope, current.items, { entity, filters, search: debouncedSearch }, current.readStarted) : [], totalCount, countLabel: totalCount === null ? countError ? "—" : countLoading ? "…" : "—" : String(totalCount), countLoading, countError, page: displayPage, pageSize, setPageSize: changePageSize, loading, error: activeError, canPrevious: !loading && page > 1, canNext: !loading && Boolean(current?.has_more && current.next_cursor), goPrevious, goNext, goFirst, retry: () => setRetry(value => value + 1), retryCount: () => setCountRetry(value => value + 1) };
}
