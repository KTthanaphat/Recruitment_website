import { RECORD_PAGE_SIZE, RecordHeaderFilterRow, RecordPagination, RecordCreateButton, RecordCell, RecordFilterPanel, useRecordFilterDraft, useRecordsCardLayout, useRecordCategoryOptions } from "@/components/ui/RecordsControls";
import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { NumberSkeleton, TableSkeletonRows, LoadingSkeleton, RefreshIndicator } from "@/components/ui/LoadingSkeleton";
import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { SortableFilterHeader, TableFilterField, TableToolbar, TruncatedTableText, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { RecordQuickActions, type RecordQuickAction } from "@/components/ui/Operations";
import { BulkActionToolbar, BulkReviewModal } from "@/components/ui/Workflow";
import { formatDate, formatRecruitmentId, formatRequisitionTitle } from "@/lib/format";
import { offerStatusLabel, translate } from "@/lib/i18n/dictionary";
import { bulkActionDisabledReason, offerImpact, offerStatus, type BulkActionResult } from "@/lib/operations";
import { readTableUrlState, writeTableUrlValues } from "@/lib/table-url-state";
import { updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import { useRecruitmentList } from "@/lib/recruitment-list";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnrichedOffer, EnrichedRequisition, Language, Offer, Profile } from "@/types/recruitment";

export function OffersView({
  language,
  rows,
  canWrite,
  profile,
  allOffers,
  onNew,
  onOpenCandidate,
  requisitions,
  client,
  accessScope,
  listScope = {}
}: {
  language: Language;
  rows: EnrichedOffer[];
  canWrite: boolean;
  profile: Profile | null;
  allOffers: Offer[];
  onNew: () => void;
  onOpenCandidate: (candidateId: string, applicationId?: string) => void;
  requisitions: EnrichedRequisition[];
  client: SupabaseClient | null;
  accessScope: string;
  listScope?: Record<string, unknown>;
}) {
  const initialTableState = useMemo(() => readTableUrlState("offer"), []);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(RECORD_PAGE_SIZE);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(Object.keys(initialTableState.filters ?? {}).length > 0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedRowCache, setSelectedRowCache] = useState<Record<string, EnrichedOffer>>({});
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
  const tableInitialized = useRef(false);
  const columns: TableColumn<EnrichedOffer>[] = [
    { key: "candidate", label: translate(language,"candidate"), value: (row) => row.candidate_name ?? row.candidate_id },
    { key: "doc_id", label: translate(language,"docId"), value: (row) => row.doc_id },
    { key: "position", label: translate(language,"position"), value: (row) => formatRequisitionTitle(row) },
    { key: "status", label: translate(language,"recordsOfferStatus"), value: (row) => offerStatusLabel(language, offerStatus(row).label), filterMode: "category" },
    { key: "impact", label: translate(language,"recordsOfferImpact"), value: (row) => offerImpact(row, allOffers, requisitions), filterMode: "category" },
    { key: "accepted", label: translate(language,"accepted"), value: (row) => row.accepted_date ? formatDate(row.accepted_date, language) : translate(language, "pending"), sortValue: (row) => row.accepted_date ?? "" },
    { key: "first_working", label: translate(language,"firstWorking"), value: (row) => formatDate(row.first_working_date), sortValue: (row) => row.first_working_date ?? "" },
    { key: "age", label: translate(language,"ageLabel"), value: (row) => ageLabel(row), sortValue: (row) => offerStatus(row).ageDays ?? Number.POSITIVE_INFINITY }
  ];
  const table = useTableControls(rows, columns, initialTableState);
  const staged = useRecordFilterDraft(table.filters, advancedFiltersOpen);
  const list = useRecruitmentList<EnrichedOffer>({ client, accessScope, entity: "offers", filters: { ...listScope, ...table.filters }, sort: table.sortKey ?? "accepted", direction: table.sortDirection ?? "desc", initialPageSize: RECORD_PAGE_SIZE, enabled: Boolean(client && accessScope), searchInput: { value: table.search, setValue: table.setSearch } });
  const recordFilterOptions=useRecordCategoryOptions(columns,[...rows,...list.items],JSON.stringify([accessScope,listScope,language]));
  const paginated = { page: list.page };
  const visibleRows = client && accessScope ? list.items : paginateRows(table.controlledRows, page, pageSize).rows;
  const selectedRows = selectedIds.map(id => selectedRowCache[id] ?? [...rows, ...list.items].find(row => String(row.offer_id) === id)).filter((row): row is EnrichedOffer => Boolean(row));
  const bulkDisabledReason = bulkActionDisabledReason({ entity: "offer", ids: selectedIds }, "open offer links", profile);

  useEffect(() => {
    if (!tableInitialized.current) {
      tableInitialized.current = true;
      return;
    }
    setPage(1);
  }, [pageSize, rows.length, table.controlledRows.length, table.filters, table.search, table.sortDirection, table.sortKey]);

  useEffect(() => {
    updateWorkspaceUrlState(writeTableUrlValues("offer", {
      filters: table.filters,
      page: list.page,
      pageSize: list.pageSize,
      search: list.search,
      sortDirection: table.sortDirection,
      sortKey: table.sortKey
    }));
  }, [list.page, list.pageSize, list.search, table.filters, table.sortDirection, table.sortKey]);

  return (
    <Panel className="records-surface records-offers">{list.refreshing ? <RefreshIndicator language={language} /> : null}
      {list.error ? <div role="alert" className="mb-3 flex items-center gap-3 text-sm text-scarlet"><span>Could not load offers.</span><RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Offers`} type="button"  onClick={list.retry} loading={list.loading}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</RetryIconButton></div> : null}
      {!client && rows.length === 0 ? (
        <>{canWrite ? <div className="mb-4 flex justify-end"><RecordCreateButton label={translate(language,"newOffer")} onClick={onNew}/></div> : null}<EmptyState message={translate(language, "noData")} /></>
      ) : (
        <>
        {list.initialLoading ? <LoadingSkeleton variant="cards" language={language} className="md:hidden" /> : null}<TableToolbar records advancedFiltersPanelId="records-offer-filters" filtersActive={Object.values(table.filters).some(Boolean)}           advancedFiltersOpen={advancedFiltersOpen}
          language={language}
          onAdvancedFiltersToggle={() => setAdvancedFiltersOpen((open) => !open)}
          onSearch={list.setSearch}
          resultCount={client ? list.totalCount : table.controlledRows.length}
          searchValue={list.search}
          trailingActions={canWrite ? <RecordCreateButton label={translate(language,"newOffer")} onClick={onNew}/> : null}
          totalCount={client ? list.totalCount : rows.length}
        />
<RecordFilterPanel id="records-offer-filters" open={advancedFiltersOpen} language={language} onClose={()=>setAdvancedFiltersOpen(false)} onApply={()=>table.setFilters({...staged.draft})} onClear={()=>{staged.setDraft({});table.setFilters({});}} columns={columns} filters={staged.draft} onFilter={staged.setField} filterOptions={recordFilterOptions}/>
        {client && list.totalCount === 0 ? <EmptyState variant="quiet" message={translate(language, "noData")} /> : null}
        <div className="grid gap-3 md:hidden">
          {visibleRows.map((row) => (
            <article key={row.offer_id} className="ats-card p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <strong className="font-bold text-navy">
                  {row.candidate_name ?? formatRecruitmentId(row.candidate_id)}
                </strong>
                {row.accepted_date ? <Tag tone="success">{formatDate(row.accepted_date, language)}</Tag> : <Tag tone="muted">{translate(language, "pending")}</Tag>}
              </div>
              <p className="text-sm font-semibold text-navy">{formatRequisitionTitle(row)}</p>
              <p className="text-sm font-medium text-slate">{translate(language, "startLower")} {formatDate(row.first_working_date, language)}</p>
              <p className="hidden text-xs font-medium text-cool md:block">{translate(language, "requisitionId")}: {row.doc_id}</p>
              <p className="hidden text-sm font-medium text-slate md:block">{offerImpact(row, allOffers, requisitions)} - {translate(language, "age")} {ageLabel(row)}</p>
              <div className="mt-3">
                <RecordQuickActions label={translate(language, "recordActionsFor", { label: row.candidate_name ?? row.candidate_id })} actions={offerActions(row, language, onOpenCandidate)} />
              </div>
            </article>
          ))}
        </div>
        <div className="table-scroll hidden md:block" tabIndex={0}>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-lightgray text-xs uppercase text-slate">
              <tr>
                <th scope="col" className="records-selection-cell">
                  <input className="record-selection-checkbox"
                    aria-label={translate(language, "selectVisibleOffers")}
                    type="checkbox"
                    checked={visibleRows.length > 0 && visibleRows.every((row) => selectedIds.includes(String(row.offer_id)))}
                    onChange={(event) => { setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...visibleRows.map((row) => String(row.offer_id))])) : selectedIds.filter((id) => !visibleRows.some((row) => String(row.offer_id) === id))); setSelectedRowCache(current => { const next={...current}; for(const row of visibleRows){const id=String(row.offer_id); if(event.target.checked) next[id]=row; else delete next[id];} return next; }); }}
                  />
                </th>
                {columns.map((column) => (
                  <th key={column.key} scope="col" className="px-3 py-3 align-top">
                    <SortableFilterHeader
                      columnKey={column.key}
                      filterValue={table.filters[column.key] ?? ""}
                      language={language}
                      label={column.label}
                      onFilter={table.setFilter}
                      onSort={table.toggleSort}
                      filterOptions={recordFilterOptions(column.key)}
                      sortDirection={table.sortDirection}
                      sortKey={table.sortKey}
                      showFilter={false} viewportBoundedFilters
                    />
                  </th>
                ))}
                <th scope="col" className="px-3 py-3"><span className="sr-only">{translate(language, "actions")}</span></th>
              </tr>
            </thead>
            <tbody aria-busy={list.loading}>{list.initialLoading ? <TableSkeletonRows columns={[{kind:"action"}, ...columns.map(column => ({kind: /date/i.test(column.key) ? "date" as const : "text" as const})), {kind:"action"}]} language={language}/> : null}
              {visibleRows.map((row) => (
                <tr key={row.offer_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="records-selection-cell"><input className="record-selection-checkbox"
                      aria-label={translate(language, "selectOffer", { id: row.offer_id })}
                      type="checkbox"
                      checked={selectedIds.includes(String(row.offer_id))}
                      onChange={(event) => { const id=String(row.offer_id); setSelectedIds((current) => event.target.checked ? [...new Set([...current,id])] : current.filter((value) => value !== id)); setSelectedRowCache(current=>{const next={...current};if(event.target.checked)next[id]=row;else delete next[id];return next;}); }}
                    /></td>
                  <td className="px-3 py-3"><RecordCell>
                    <TruncatedTableText value={row.candidate_name ?? formatRecruitmentId(row.candidate_id)} className="font-bold text-navy" />
                  </RecordCell></td>
                  <td className="px-3 py-3 font-semibold text-navy"><RecordCell>{row.doc_id}</RecordCell></td>
                  <td className="px-3 py-3 text-slate"><RecordCell><TruncatedTableText value={formatRequisitionTitle(row)} /></RecordCell></td>
                  <td className="px-3 py-3"><RecordCell><Tag tone={offerStatus(row).tone}>{offerStatusLabel(language, offerStatus(row).label)}</Tag></RecordCell></td>
                  <td className="px-3 py-3 text-slate"><RecordCell>{offerImpact(row, allOffers, requisitions)}</RecordCell></td>
                  <td className="px-3 py-3"><RecordCell>{row.accepted_date ? <Tag tone="success">{formatDate(row.accepted_date, language)}</Tag> : <Tag tone="muted">{translate(language, "pending")}</Tag>}</RecordCell></td>
                  <td className="px-3 py-3 text-slate"><RecordCell>{formatDate(row.first_working_date, language)}</RecordCell></td>
                  <td className="px-3 py-3 text-slate"><RecordCell>{ageLabel(row)}</RecordCell></td>
                  <td className="px-3 py-3"><RecordCell>
                    <div className="flex items-center justify-end gap-2">
                      <RecordQuickActions label={translate(language, "recordActionsFor", { label: row.candidate_name ?? row.candidate_id })} actions={offerActions(row, language, onOpenCandidate)} />
                    </div>
                  </RecordCell></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <RecordPagination pageSize={client ? list.pageSize : pageSize} onPageSizeChange={size => { setPageSize(size); list.setPageSize(size); setPage(1); }} language={language} page={client ? list.page : page} totalCount={client ? list.totalCount : table.controlledRows.length} countLoading={client ? list.countLoading : false} countError={client ? list.countError : false} loading={client ? list.loading : false} canPrevious={client ? list.canPrevious : page > 1} canNext={client ? list.canNext : page * pageSize < table.controlledRows.length} onPrevious={client ? list.goPrevious : () => setPage(value => Math.max(1,value-1))} onNext={client ? list.goNext : () => setPage(value=>value+1)} onRetryCount={list.retryCount}/>
        <BulkActionToolbar
          disabledReason={bulkDisabledReason}
          entityLabel={translate(language, "offers")}
          language={language}
          selectedCount={selectedIds.length}
          onClear={() => {
            setSelectedIds([]);
            setSelectedRowCache({});
            setBulkResult(null);
          }}
          onExport={() => exportOffers(selectedRows, allOffers, requisitions)}
          onOpenReview={() => {
            setBulkResult(null);
            setBulkReviewOpen(true);
          }}
        />
        <BulkReviewModal
          actionLabel={translate(language, "bulkOfferReviewAction")}
          ids={selectedIds}
          language={language}
          open={bulkReviewOpen}
          result={bulkResult}
          onClose={() => setBulkReviewOpen(false)}
          onConfirm={() => setBulkResult({ ok: true, succeeded: selectedIds, failed: [], skipped: [] })}
        />
        </>
      )}
    </Panel>
  );
}

function exportOffers(rows: EnrichedOffer[], allOffers: Offer[], requisitions: EnrichedRequisition[]) {
  downloadCsv("selected-offers.csv", rows.map((row) => ({
    offer_id: row.offer_id,
    candidate: row.candidate_name ?? row.candidate_id,
    doc_id: row.doc_id,
    status: offerStatus(row).label,
    impact: offerImpact(row, allOffers, requisitions),
    accepted_date: row.accepted_date ?? "",
    first_working_date: row.first_working_date ?? ""
  })));
}

function offerActions(row: EnrichedOffer, language: Language, onOpenCandidate: (candidateId: string, applicationId?: string) => void): RecordQuickAction[] {
  return [
    { id: "view", label: translate(language, "viewOfferCandidateDetailFor", { name: row.candidate_name ?? row.candidate_id }), icon: <Search size={16} aria-hidden="true" />, iconOnly: true, onSelect: () => onOpenCandidate(row.candidate_id, row.application_id) }
  ];
}

function DetailButton({ ariaLabel, onClick }: { ariaLabel: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-slate hover:text-primary"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      icon={<Search size={16} aria-hidden="true" />}
    />
  );
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ageLabel(row: EnrichedOffer) {
  const age = offerStatus(row).ageDays;
  return age === null ? "-" : `${age}d`;
}
