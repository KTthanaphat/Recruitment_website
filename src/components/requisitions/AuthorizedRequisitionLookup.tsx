import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/Button";
import { CursorPagination } from "@/components/ui/CursorPagination";
import { Field, SelectInput, TextInput } from "@/components/ui/Field";
import { useRecruitmentList } from "@/lib/recruitment-list";
import { translate } from "@/lib/i18n/dictionary";
import type { EnrichedRequisition, Language } from "@/types/recruitment";

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
};

/** A role-scoped requisition picker whose search and eligibility filters run before paging. */
export function AuthorizedRequisitionLookup({ client, accessScope, language, filters, value, selectedRow = null, onSelect, label, name, disabled = false }: AuthorizedRequisitionLookupProps) {
  const [search, setSearch] = useState("");
  const criteriaKey = JSON.stringify(filters);
  const selectionScopeKey = `${accessScope}\u001f${criteriaKey}`;
  const [retained, setRetained] = useState<{ scopeKey: string; client: SupabaseClient | null; id: string; row: EnrichedRequisition } | null>(null);
  const previousScope = useRef<{ scopeKey: string; client: SupabaseClient | null } | null>(null);
  const previous = previousScope.current;
  const initialScope = previous === null;
  const scopeUnchanged = previous?.scopeKey === selectionScopeKey && previous.client === client;
  const page = useRecruitmentList<EnrichedRequisition>({
    client, accessScope, entity: "requisitions", filters, searchInput: { value: search, setValue: setSearch },
    sort: "doc_id", direction: "asc", initialPageSize: 50, enabled: Boolean(client && accessScope && !disabled),
  });
  const visibleRow = page.items.find(row => row.doc_id === value) ?? null;
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
  useEffect(() => {
    if (!value) setRetained(null);
  }, [value]);
  const currentRetained = retained?.scopeKey === selectionScopeKey && retained.client === client ? retained : null;
  const effectiveSelected = value ? visibleRow ?? (currentRetained?.id === value ? currentRetained.row : null) : null;
  const options = useMemo(() => {
    const rows = [...page.items];
    if (effectiveSelected && !rows.some(row => row.doc_id === effectiveSelected.doc_id)) rows.unshift(effectiveSelected);
    return rows;
  }, [page.items, effectiveSelected]);
  const accessUnavailable = !disabled && (!client || !accessScope);
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
    <Field label={translate(language, "searchRequisitions")}>
      <TextInput value={search} onChange={event => setSearch(event.target.value)} placeholder={translate(language, "searchPlaceholder")} aria-label={translate(language, "searchRequisitions")} disabled={disabled} />
    </Field>
    <Field label={label}>
      <SelectInput name={name} aria-label={label} value={value} disabled={disabled || accessUnavailable} onChange={event => select(event.target.value)}>
        {optionChildren}
      </SelectInput>
    </Field>
    <div className="flex min-h-5 items-center justify-between gap-2 text-xs text-slate">
      <span>{page.countLabel} · {translate(language, "requisitions")}</span>
      {page.countError ? <Button type="button" size="sm" variant="secondary" onClick={page.retryCount}>{translate(language, "retry")}</Button> : null}
    </div>
    {page.loading ? <p role="status" className="text-sm text-slate">{translate(language, "loading")}</p> : null}
    {accessUnavailable ? <p role="alert" className="text-sm text-danger">{translate(language, "recordUnavailableOrLoadFailed")}</p> : null}
    {page.error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-danger"><span>{translate(language, "recordUnavailableOrLoadFailed")}</span><Button type="button" size="sm" variant="secondary" onClick={page.retry}>{translate(language, "retry")}</Button></div> : null}
    {!accessUnavailable && !page.loading && !page.error && page.items.length === 0 ? <p role="status" className="text-sm text-slate">{translate(language, "noEligibleRequisitions")}</p> : null}
    {!page.error ? <CursorPagination language={language} page={page.page} pageSize={page.pageSize} loading={page.loading} canPrevious={page.canPrevious} canNext={page.canNext} onPrevious={page.goPrevious} onNext={page.goNext} onPageSizeChange={page.setPageSize} /> : null}
  </div>;
}
