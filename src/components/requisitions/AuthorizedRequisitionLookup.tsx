"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/Button";
import { CursorPagination } from "@/components/ui/CursorPagination";
import { Field, SelectInput, TextInput } from "@/components/ui/Field";
import { fetchRecruitmentList, useRecruitmentList } from "@/lib/recruitment-list";
import { translate } from "@/lib/i18n/dictionary";
import type { EnrichedRequisition, Language } from "@/types/recruitment";
import type { RecruitmentListPage } from "@/lib/recruitment-list";

export type AuthorizedRequisitionLookupProps = {
  client: SupabaseClient | null;
  accessScope: string;
  language: Language;
  filters: Record<string, unknown>;
  value: string;
  selectedRow?: EnrichedRequisition | null;
  onSelect: (row: EnrichedRequisition | null) => void;
  label: string;
  name: string;
  disabled?: boolean;
  searchInsideMenu?: boolean;
  loadAllResults?: boolean;
};

/** A role-scoped requisition picker whose search and eligibility filters run before paging. */
export function AuthorizedRequisitionLookup({ client, accessScope, language, filters, value, selectedRow = null, onSelect, label, name, disabled = false, searchInsideMenu = false, loadAllResults = false }: AuthorizedRequisitionLookupProps) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [allRows, setAllRows] = useState<EnrichedRequisition[]>([]);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState(false);
  const [allRetry, setAllRetry] = useState(0);
  const criteriaKey = JSON.stringify(filters);
  const stableFilters = useMemo(() => JSON.parse(criteriaKey) as Record<string, unknown>, [criteriaKey]);
  const selectionScopeKey = `${accessScope}\u001f${criteriaKey}`;
  const [retained, setRetained] = useState<{ scopeKey: string; client: SupabaseClient | null; id: string; row: EnrichedRequisition } | null>(null);
  const previousScope = useRef<{ scopeKey: string; client: SupabaseClient | null } | null>(null);
  const previous = previousScope.current;
  const initialScope = previous === null;
  const scopeUnchanged = previous?.scopeKey === selectionScopeKey && previous.client === client;
  const collectAll = searchInsideMenu && loadAllResults;
  const page = useRecruitmentList<EnrichedRequisition>({
    client, accessScope, entity: "requisitions", filters: stableFilters, searchInput: { value: search, setValue: setSearch },
    sort: "doc_id", direction: "asc", initialPageSize: 50, enabled: Boolean(client && accessScope && !disabled && !collectAll),
  });
  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => {
    if (!collectAll || !client || !accessScope || disabled) { setAllRows([]); setAllLoading(false); setAllError(false); return; }
    let cancelled = false;
    setAllRows([]); setAllLoading(true); setAllError(false);
    const timer = setTimeout(async () => {
      try {
        const collected = new Map<string, EnrichedRequisition>();
        const seenCursors = new Set<string>();
        let cursor: { value: unknown; id: string } | null = null;
        let hasMore = true;
        while (hasMore) {
          const result: RecruitmentListPage<EnrichedRequisition> = await fetchRecruitmentList<EnrichedRequisition>(client, { accessScope, entity: "requisitions", filters: stableFilters, search: debouncedSearch, sort: "doc_id", direction: "asc", limit: 100, cursor });
          for (const row of result.items) collected.set(row.doc_id, row);
          if (!cancelled) setAllRows([...collected.values()]);
          hasMore = result.has_more;
          cursor = result.next_cursor;
          if (hasMore) {
            if (!cursor) throw new Error("Requisition list returned no continuation cursor");
            const cursorKey = JSON.stringify(cursor);
            if (seenCursors.has(cursorKey)) throw new Error("Requisition list repeated a continuation cursor");
            seenCursors.add(cursorKey);
          }
        }
      } catch {
        if (!cancelled) setAllError(true);
      } finally {
        if (!cancelled) setAllLoading(false);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [accessScope, allRetry, client, collectAll, debouncedSearch, disabled, stableFilters]);
  const allSearchPending = collectAll && search.trim() !== debouncedSearch;
  const loading = collectAll ? allLoading || allSearchPending : page.loading;
  const error = collectAll ? allError : page.error;
  const pageRows = collectAll ? (allSearchPending ? [] : allRows) : page.items;
  const visibleRow = pageRows.find(row => row.doc_id === value) ?? null;
  useEffect(() => {
    if (visibleRow) setRetained({ scopeKey: selectionScopeKey, client, id: visibleRow.doc_id, row: visibleRow });
  }, [visibleRow, selectionScopeKey, client]);
  useEffect(() => {
    if (selectedRow && selectedRow.doc_id === value && (initialScope || scopeUnchanged)) {
      setRetained({ scopeKey: selectionScopeKey, client, id: selectedRow.doc_id, row: selectedRow });
    }
  }, [selectedRow, value, initialScope, scopeUnchanged, selectionScopeKey, client]);
  useEffect(() => {
    const previousValue = previousScope.current;
    previousScope.current = { scopeKey: selectionScopeKey, client };
    if (previousValue && (previousValue.scopeKey !== selectionScopeKey || previousValue.client !== client)) {
      setRetained(null);
      if (value || selectedRow) onSelect(null);
    }
  }, [selectionScopeKey, client, value, selectedRow, onSelect]);
  useEffect(() => { if (!value) setRetained(null); }, [value]);
  const currentRetained = retained?.scopeKey === selectionScopeKey && retained.client === client ? retained : null;
  const effectiveSelected = value ? visibleRow ?? (currentRetained?.id === value ? currentRetained.row : null) : null;
  const options = useMemo(() => {
    const rows = [...pageRows];
    if (effectiveSelected && !rows.some(row => row.doc_id === effectiveSelected.doc_id)) rows.unshift(effectiveSelected);
    return rows;
  }, [pageRows, effectiveSelected]);
  const accessUnavailable = !disabled && (!client || !accessScope);
  const searchControl = searchInsideMenu ? { ariaLabel: translate(language, "searchRequisitions"), onChange: setSearch, placeholder: translate(language, "searchPlaceholder"), value: search } : undefined;
  const menuFooter = collectAll ? <div className="grid gap-2 text-xs text-slate">{loading ? <p role="status">{translate(language, "loading")}</p> : null}{error ? <div role="alert" className="flex items-center gap-2 text-danger"><span>{translate(language, "recordUnavailableOrLoadFailed")}</span><Button type="button" variant="secondary" size="sm" onClick={() => setAllRetry(current => current + 1)}>{translate(language, "retry")}</Button></div> : null}</div> : undefined;
  const optionChildren = [
    <option key="" value="">{translate(language, "selectRequisitionToAdd")}</option>,
    ...options.map(row => <option key={row.doc_id} value={row.doc_id}>{row.doc_id} · {row.position}{row.site ? ` · ${row.site}` : ""}</option>),
  ];
  function select(docId: string) {
    if (!docId) { setRetained(null); onSelect(null); return; }
    const row = options.find(candidate => candidate.doc_id === docId) ?? (effectiveSelected?.doc_id === docId ? effectiveSelected : null);
    if (!row) return;
    setRetained({ scopeKey: selectionScopeKey, client, id: row.doc_id, row });
    onSelect(row);
  }
  return <div className="grid gap-2" data-testid="authorized-requisition-lookup">
    {!searchInsideMenu ? <Field label={translate(language, "searchRequisitions")}><TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder={translate(language, "searchPlaceholder")} aria-label={translate(language, "searchRequisitions")} disabled={disabled} /></Field> : null}
    <Field label={label}>
      <SelectInput name={name} aria-label={label} value={value} disabled={disabled || accessUnavailable} search={searchControl} menuFooter={menuFooter} onChange={event => select(event.target.value)}>
        {optionChildren}
      </SelectInput>
    </Field>
    {!collectAll ? <div className="flex min-h-5 items-center justify-between gap-2 text-xs text-slate"><span>{page.countLabel} · {translate(language, "requisitions")}</span>{page.countError ? <Button type="button" size="sm" variant="secondary" onClick={page.retryCount}>{translate(language, "retry")}</Button> : null}</div> : null}
    {loading && !collectAll ? <p role="status" className="text-sm text-slate">{translate(language, "loading")}</p> : null}
    {accessUnavailable ? <p role="alert" className="text-sm text-danger">{translate(language, "recordUnavailableOrLoadFailed")}</p> : null}
    {error && !collectAll ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-danger"><span>{translate(language, "recordUnavailableOrLoadFailed")}</span><Button type="button" size="sm" variant="secondary" onClick={page.retry}>{translate(language, "retry")}</Button></div> : null}
    {!accessUnavailable && !loading && !error && pageRows.length === 0 ? <p role="status" className="text-sm text-slate">{translate(language, "noEligibleRequisitions")}</p> : null}
    {!searchInsideMenu && !page.error ? <CursorPagination language={language} page={page.page} pageSize={page.pageSize} loading={page.loading} canPrevious={page.canPrevious} canNext={page.canNext} onPrevious={page.goPrevious} onNext={page.goNext} onPageSizeChange={page.setPageSize} /> : null}
    {collectAll && error ? <div role="alert" className="flex items-center justify-between gap-2 text-sm text-danger"><span>{translate(language, "recordUnavailableOrLoadFailed")}</span><Button type="button" size="sm" variant="secondary" onClick={() => setAllRetry(current => current + 1)}>{translate(language, "retry")}</Button></div> : null}
  </div>;
}
