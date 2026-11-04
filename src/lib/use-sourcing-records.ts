import { useEffect, useState, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchRecruitmentList, recruitmentListRevision, subscribeRecruitmentLists, type RecruitmentListCursor, type RecruitmentReadPhases } from "./recruitment-list";
import { useSourcingDisplayTiming } from "./sourcing-load-timing";
import { previousWeekStart } from "./operations";
import type { SourcingRecordRow } from "@/types/recruitment";

type Scope = { headerSite: string; headerPic: string; priorityOnly: boolean };
type Selection = { timing?: RecruitmentReadPhases; key: string; rows: SourcingRecordRow[]; loading: boolean; error: boolean; settled: boolean };
type Navigator = { key: string; request: string; rows: SourcingRecordRow[]; cursor: RecruitmentListCursor | null; hasMore: boolean; loading: boolean; error: boolean };
const emptySelection: Selection = { key: "", rows: [], loading: false, error: false, settled: false };
const emptyNavigator: Navigator = { key: "", request: "", rows: [], cursor: null, hasMore: false, loading: false, error: false };

/** The form never waits for history, exact counts, or chart aggregates. */
export function useSourcingRecords({ client, accessScope, groupId, selectedWeek, scope, refreshKey, enabled }: {
  client: SupabaseClient | null; accessScope: string; groupId: string | null; selectedWeek: string; scope: Scope; refreshKey: number; enabled: boolean;
}) {
  const revision = useSyncExternalStore(listener => subscribeRecruitmentLists("sourcing_records", listener), () => recruitmentListRevision("sourcing_records"), () => 0);
  const scopeKey = JSON.stringify([accessScope, groupId, scope.headerSite, scope.headerPic, scope.priorityOnly, refreshKey, revision]);
  const selectionKey = JSON.stringify([scopeKey, selectedWeek]);
  const [selection, setSelection] = useState(emptySelection);
  const [selectionRetry, setSelectionRetry] = useState(0);
  const [navigator, setNavigator] = useState(emptyNavigator);
  const [navigation, setNavigation] = useState<{ key: string; cursor: RecruitmentListCursor | null }>({ key: "", cursor: null });
  const [historyRetry, setHistoryRetry] = useState(0);
  const active = Boolean(enabled && client && accessScope && groupId);
  useEffect(() => {
    if (!active || !client) return;
    const controller = new AbortController();
    const [identity, id, site, pic, priority] = JSON.parse(JSON.parse(selectionKey)[0]) as [string, string, string, string, boolean];
    const week = JSON.parse(selectionKey)[1] as string;
    setSelection(previous => ({ key: selectionKey, rows: previous.key === selectionKey ? previous.rows : [], loading: true, error: false, settled: false }));
    void fetchRecruitmentList<SourcingRecordRow>(client, {
      accessScope: identity, entity: "sourcing_records", filters: { surface: "history", groupId: id, headerSite: site, headerPic: pic, priorityOnly: priority, from: previousWeekStart(week), to: week },
      sort: "week", direction: "desc", limit: 25, signal: controller.signal, priority: 0
    }).then(page => {
      if (!controller.signal.aborted) setSelection({ key: selectionKey, rows: page.items, timing: page.readTiming, loading: false, error: false, settled: true });
    }).catch(() => {
      if (!controller.signal.aborted) setSelection(previous => ({ key: selectionKey, rows: previous.key === selectionKey ? previous.rows : [], loading: false, error: true, settled: true }));
    });
    return () => controller.abort();
  }, [active, client, selectionKey, selectionRetry]);
  const selected = active && selection.key === selectionKey ? selection : emptySelection;
  useSourcingDisplayTiming("selected-week", selected.timing);
  const cursor = navigation.key === scopeKey ? navigation.cursor : null;
  const requestKey = JSON.stringify([scopeKey, cursor, historyRetry]);
  useEffect(() => {
    if (!active || !client || !selected.settled) return;
    if (navigator.key === scopeKey && navigator.request === requestKey && !navigator.error) return;
    const controller = new AbortController();
    const [identity, id, site, pic, priority] = JSON.parse(scopeKey) as [string, string, string, string, boolean];
    const nextCursor = JSON.parse(requestKey)[1] as RecruitmentListCursor | null;
    setNavigator(previous => ({ ...(previous.key === scopeKey ? previous : emptyNavigator), key: scopeKey, loading: true, error: false }));
    void fetchRecruitmentList<SourcingRecordRow>(client, {
      accessScope: identity, entity: "sourcing_records", filters: { surface: "history", groupId: id, headerSite: site, headerPic: pic, priorityOnly: priority },
      sort: "week", direction: "desc", limit: 25, cursor: nextCursor, signal: controller.signal,
      background: !nextCursor, priority: nextCursor ? 0 : 1
    }).then(page => {
      if (controller.signal.aborted) return;
      setNavigator(previous => {
        const rows = nextCursor && previous.key === scopeKey ? previous.rows : [];
        const unique = new Map([...rows, ...page.items].map(row => [row.group.group_id + ":" + row.week_start, row]));
        return { key: scopeKey, request: requestKey, rows: [...unique.values()], cursor: page.next_cursor, hasMore: page.has_more, loading: false, error: false };
      });
    }).catch(() => {
      if (!controller.signal.aborted) setNavigator(previous => ({ ...(previous.key === scopeKey ? previous : emptyNavigator), key: scopeKey, request: requestKey, loading: false, error: true }));
    });
    return () => controller.abort();
    // Navigator state is an output, not a trigger; requestKey owns the requested cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, client, scopeKey, selected.settled, requestKey]);
  const history = active && navigator.key === scopeKey ? navigator : emptyNavigator;
  return {
    selectedRow: selected.rows.find(row => row.week_start === selectedWeek) ?? null,
    previousRow: selected.rows.find(row => row.week_start === previousWeekStart(selectedWeek)) ?? null,
    selectionLoading: active && (!selected.settled || selected.loading), selectionError: selected.error,
    selectionSettled: active && selected.settled, retrySelection: () => setSelectionRetry(value => value + 1),
    historyRows: history.rows, historyLoading: active && selected.settled && (!history.request || history.loading), historyError: history.error,
    hasMore: history.hasMore, retryHistory: () => setHistoryRetry(value => value + 1),
    loadMore: () => { if (history.hasMore && history.cursor && !history.loading) setNavigation({ key: scopeKey, cursor: history.cursor }); }
  };
}
