"use client";
import { candidateReceiptRevision, candidateActionReveals, latestCandidateReceipt, subscribeCandidateReceipts, patchCandidateRows } from "./candidate-action-receipt";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fetchRecruitmentList, fetchRecruitmentListCount, recruitmentQueryRevision, subscribeRecruitmentQuery, recruitmentListRevision, subscribeRecruitmentLists, type RecruitmentListPage, type RecruitmentListCursor, type useRecruitmentList } from "./recruitment-list";
import { scheduleRecruitmentRead } from "./recruitment-read-scheduler";
import type { EnrichedCandidate } from "@/types/recruitment";

/** A board owns cursor blocks of 25; presentation always slices five before grouping. */
export function usePipelineBoardList(input: Parameters<typeof useRecruitmentList<EnrichedCandidate>>[0]) {
  const { client, accessScope, entity, filters = {}, sort = "", direction = "asc", enabled = true, searchInput } = input;
  const [search, setSearch] = useState(""); const activeSearch = searchInput?.value ?? search;
  const [debounced, setDebounced] = useState(activeSearch.trim());
  useEffect(() => { const timer = setTimeout(() => setDebounced(activeSearch.trim()), 300); return () => clearTimeout(timer); }, [activeSearch]);
  const receiptRevision = useSyncExternalStore(fn => subscribeCandidateReceipts(client, accessScope, fn), () => candidateReceiptRevision(client, accessScope), () => 0);
  const entityRevision = useSyncExternalStore(fn => subscribeRecruitmentLists(entity, fn), () => recruitmentListRevision(entity), () => 0);
  const revision = entityRevision + useSyncExternalStore(fn => subscribeRecruitmentQuery(client, { accessScope, entity, filters, search: debounced }, fn), () => recruitmentQueryRevision(client, { accessScope, entity, filters, search: debounced }), () => 0);
  const countRevision = useSyncExternalStore(fn => subscribeRecruitmentQuery(client, { accessScope, entity, filters, search: debounced }, fn, "count"), () => recruitmentQueryRevision(client, { accessScope, entity, filters, search: debounced }, "count"), () => 0);
  const [retry, setRetry] = useState(0), [countRetry, setCountRetry] = useState(0);
  const identity = JSON.stringify([accessScope, entity, filters, sort, direction, debounced]);
  type Snapshot = { identity: string; revision: number; blocks: Map<number, RecruitmentListPage<EnrichedCandidate>>; page: number; loading: boolean; error: boolean };
  const [state, setState] = useState<Snapshot>({ identity: "", revision: -1, blocks: new Map(), page: 1, loading: false, error: false });
  const [count, setCount] = useState({ identity: "", value: null as number | null, loading: false, error: false });
  const [revealNotice, setRevealNotice] = useState<"excluded" | null>(null);
  const anchor = useRef<{ identity: string; cursors: Map<number, RecruitmentListCursor | null>; before: Set<number>; page: number }>({ identity, cursors: new Map([[0, null]]), before: new Set(), page: 1 });
  const handledReveal = useRef("");
  const revealGeneration = useRef({ request: "", identity: "" });
  function revealCard() {
    const receipt = latestCandidateReceipt(client, accessScope);
    if (!receipt || !candidateActionReveals(receipt.operation) || handledReveal.current === receipt.request_id) return null;
    const card = receipt.cards.find(value => filters.boardFilter === "failed" ? value.latest_result === 0 && (!filters.stage || value.latest_process === filters.stage) : filters.boardFilter === "passed_offer" ? value.latest_process === "Offer" && value.latest_result === 1 : value.latest_process === filters.stage && value.latest_result !== 0 && !(value.latest_process === "Offer" && value.latest_result === 1));
    return card ? { receipt, card } : null;
  }
  const desired = useRef(1); const controllers = useRef(new Set<AbortController>());
  useEffect(() => { const requests = controllers.current; return () => { for (const controller of requests) controller.abort(); requests.clear(); }; }, [client, identity]);
  useEffect(() => { setRevealNotice(null); }, [identity]);
  const current = state.identity === identity && activeSearch.trim() === debounced ? state : null;
  const page = current?.page ?? 1, blockIndex = Math.floor((page - 1) / 5), block = current?.blocks.get(blockIndex);
  // A generation owns all reads, including optional prefetch. Cleanup cancels obsolete queue entries.
  useEffect(() => {
    if (!enabled || !client || !accessScope) return;
    if (revealCard()) return;
    let canceled = false;
    if (anchor.current.identity !== identity) anchor.current = { identity, cursors: new Map([[0, null]]), before: new Set(), page: 1 };
    const targetPage = anchor.current.page, targetBlock = Math.floor((targetPage-1)/5); desired.current = targetPage;
    const requests = controllers.current; const controller = new AbortController(); requests.add(controller);
    setState(previous => ({ identity, revision, blocks: previous.identity === identity ? previous.blocks : new Map(), page: targetPage, loading: true, error: false }));
    fetchRecruitmentList<EnrichedCandidate>(client, { accessScope, entity, filters, sort, direction, search: debounced, limit: 25, cursor: anchor.current.cursors.get(targetBlock), before: anchor.current.before.has(targetBlock), signal: controller.signal })
      .then(result => {
        if (canceled) return;
        if (!result.items.length && targetPage > 1) {
          anchor.current = { identity, cursors: new Map([[0, null]]), before: new Set(), page: 1 };
          desired.current = 1; setRetry(value => value + 1); return;
        }
        const availablePage = Math.min(targetPage, targetBlock * 5 + Math.max(1, Math.ceil(result.items.length / 5)));
        anchor.current.page = availablePage; desired.current = availablePage;
        setState({ identity, revision, blocks: new Map([[targetBlock, result]]), page: availablePage, loading: false, error: false });
      })
      .catch(() => { if (!canceled) setState(previous => ({ ...previous, loading: false, error: true })); });
    return () => { canceled = true; for (const request of requests) request.abort(); requests.clear(); };
    // Serialized identity and generation keys cover the request values above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, enabled, identity, revision, retry]);
  const firstBlock = Boolean(current?.blocks.size);
  useEffect(() => {
    if (!enabled || !client || !accessScope || !firstBlock) return;
    let canceled = false; const controller = new AbortController();
    setCount(previous => ({ identity, value: previous.identity === identity ? previous.value : null, loading: true, error: false }));
    fetchRecruitmentListCount(client, { accessScope, entity, filters, search: debounced, signal: controller.signal })
      .then(value => { if (!canceled) setCount({ identity, value, loading: false, error: false }); })
      .catch(() => { if (!canceled) setCount(previous => ({ ...previous, loading: false, error: true })); });
    return () => { canceled = true; controller.abort(); };
    // Serialized identity and generation keys cover the request values above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, enabled, identity, firstBlock, entityRevision, countRevision, countRetry]);
  async function loadBlock(index: number, cursor: RecruitmentListCursor | null, background = false, before = false) {
    if (!client || !current) return;
    const controller = new AbortController(); controllers.current.add(controller);
    anchor.current.cursors.set(index, cursor);
    if (before) anchor.current.before.add(index); else anchor.current.before.delete(index);
    if (!background) setState(previous => ({ ...previous, loading: true, error: false }));
    try {
      const result = await fetchRecruitmentList<EnrichedCandidate>(client, { accessScope, entity, filters, sort, direction, search: debounced, limit: 25, cursor, before, signal: controller.signal, background });
      if (controller.signal.aborted) return;
      setState(previous => previous.identity !== identity || previous.revision !== revision ? previous : ({ ...previous, blocks: new Map(previous.blocks).set(index, result), ...(background ? {} : { page: desired.current, loading: false, error: false }) }));
    } catch { if (!controller.signal.aborted && !background) setState(previous => ({ ...previous, loading: false, error: true })); }
    finally { controllers.current.delete(controller); }
  }
  useEffect(() => {
    if (!enabled || !block?.has_more || !block.next_cursor || current?.blocks.has(blockIndex + 1)) return;
    // Background priority yields to every queued visible request. Fetch just one following block.
    void loadBlock(blockIndex + 1, block.next_cursor, true);
    // Serialized identity and generation keys cover the request values above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, identity, revision, block]);
  const countValue = count.identity === identity ? count.value : null;
  const patchedItems = client && block ? patchCandidateRows(client, accessScope, block.items, { entity, filters, search: debounced }, block.readStarted) : [];
  const items = patchedItems.slice(((page - 1) % 5) * 5, ((page - 1) % 5 + 1) * 5);
  const canNext = Boolean(block && (((page - 1) % 5 + 1) * 5 < block.items.length || block.has_more));
  useEffect(() => {
    if (countValue === null || !current || current.loading || page <= Math.max(1, Math.ceil(countValue/5))) return;
    anchor.current = { identity, page: 1, cursors: new Map([[0, null]]), before: new Set() }; setRetry(value => value+1);
    // Serialized identity and generation keys cover the request values above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countValue, identity, page, current?.loading]);
  function navigate(next: number) {
    if (!current || current.loading || next < 1) return;
    const index = Math.floor((next - 1) / 5); desired.current = next; anchor.current.page = next;
    if (current.blocks.has(index)) setState(previous => ({ ...previous, page: next, error: false }));
    else if (anchor.current.cursors.has(index)) void loadBlock(index, anchor.current.cursors.get(index)!, false, anchor.current.before.has(index));
    else if (next < page && block?.previous_cursor) void loadBlock(index, block.previous_cursor, false, true);
    else if (next > page && block?.next_cursor) void loadBlock(index, block.next_cursor);
  }
  useEffect(() => {
    const target = revealCard();
    if (!enabled || !client || !target) return;
    const { receipt, card } = target;
    if (revealGeneration.current.request === receipt.request_id && revealGeneration.current.identity !== identity) { handledReveal.current = receipt.request_id; setRetry(value => value+1); return; }
    revealGeneration.current = { request: receipt.request_id, identity };
    const controller = new AbortController(); controllers.current.add(controller); setRevealNotice(null);
    void (async () => {
      const { data, error } = await scheduleRecruitmentRead(client, () => client.rpc("app_pipeline_card_location_v1", { p_application_id: card.application_id, p_search: debounced, p_filters: { ...filters, ...(entity === "pipeline_stage" ? { activeBoard: true } : {}) }, p_sort: sort, p_direction: direction }).abortSignal(controller.signal), 0, { signal: controller.signal });
      if (controller.signal.aborted) return; if (error) throw new Error(error.message);
      if (data?.excluded) { handledReveal.current = receipt.request_id; setRevealNotice("excluded"); setRetry(value => value+1); return; }
      if (!Number.isInteger(data?.page) || !Number.isInteger(data?.block)) throw new Error("Invalid card location");
      const pageResult = await fetchRecruitmentList<EnrichedCandidate>(client, { accessScope, entity, search: debounced, filters, sort, direction, limit: 25, cursor: data.cursor, freshAfter: receipt.commit_epoch, signal: controller.signal });
      if (controller.signal.aborted) return;
      handledReveal.current = receipt.request_id;
      anchor.current = { identity, page: data.page, cursors: new Map([[data.block, data.cursor]]), before: new Set() }; desired.current = data.page;
      setState(previous => ({ identity, revision, page: data.page, blocks: new Map(previous.identity === identity ? previous.blocks : []).set(data.block, pageResult), loading: false, error: false }));
    })().catch(() => { if (!controller.signal.aborted) { handledReveal.current = receipt.request_id; setRetry(value => value+1); } }).finally(() => controllers.current.delete(controller));
    return () => controller.abort();
    // Serialized identity and generation keys cover the request values above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, enabled, receiptRevision, identity, revision]);
  return { revealNotice, items, allItems: current ? [...current.blocks.values()].flatMap(value => value.items) : [], totalCount: countValue,
    countLabel: countValue === null ? "—" : String(countValue), countLoading: count.identity !== identity || count.loading, countError: count.identity === identity && count.error,
    page, pageSize: 5, pages: countValue === null ? "…" : Math.max(1, Math.ceil(countValue / 5)),
    initialLoading: Boolean(enabled && !block && !current?.error), loading: current?.loading ?? false, refreshing: Boolean(block && current?.loading), error: current?.error ?? false,
    canPrevious: page > 1, canNext, goPrevious: () => navigate(page - 1), goNext: () => navigate(page + 1),
    retry: () => setRetry(value => value + 1), retryCount: () => setCountRetry(value => value + 1),
    search: activeSearch, setSearch: searchInput?.setValue ?? setSearch };
}
