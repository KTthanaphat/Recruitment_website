import { Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { SortableFilterHeader, TableToolbar, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { RecordActionGroup } from "@/components/ui/Operations";
import { BulkActionToolbar, BulkReviewModal } from "@/components/ui/Workflow";
import { formatDate } from "@/lib/format";
import { offerStatusLabel, translate } from "@/lib/i18n/dictionary";
import { bulkActionDisabledReason, offerImpact, offerStatus, type BulkActionResult } from "@/lib/operations";
import { readTableUrlState, writeTableUrlValues } from "@/lib/table-url-state";
import { updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import type { EnrichedOffer, EnrichedRequisition, Language, Offer, Profile } from "@/types/recruitment";

export function OffersView({
  language,
  rows,
  canWrite,
  profile,
  allOffers,
  onNew,
  onOpenCandidate,
  onOpenRequisition,
  requisitions
}: {
  language: Language;
  rows: EnrichedOffer[];
  canWrite: boolean;
  profile: Profile | null;
  allOffers: Offer[];
  onNew: () => void;
  onOpenCandidate: (candidateId: string) => void;
  onOpenRequisition: (docId: string) => void;
  requisitions: EnrichedRequisition[];
}) {
  const initialTableState = useMemo(() => readTableUrlState("offer"), []);
  const [page, setPage] = useState(initialTableState.page);
  const [pageSize, setPageSize] = useState<number>((PAGE_SIZE_OPTIONS as readonly number[]).includes(initialTableState.pageSize) ? initialTableState.pageSize : PAGE_SIZE_OPTIONS[0]);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(Object.keys(initialTableState.filters ?? {}).length > 0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
  const tableInitialized = useRef(false);
  const columns: TableColumn<EnrichedOffer>[] = [
    { key: "candidate", label: "Candidate", value: (row) => row.candidate_name ?? row.candidate_id },
    { key: "doc_id", label: "Doc ID", value: (row) => row.doc_id },
    { key: "position", label: "Position", value: (row) => row.position ?? "-" },
    { key: "status", label: "Offer Status", value: (row) => offerStatusLabel(language, offerStatus(row).label) },
    { key: "impact", label: "Impact", value: (row) => offerImpact(row, allOffers, requisitions) },
    { key: "accepted", label: "Accepted", value: (row) => row.accepted_date ? formatDate(row.accepted_date, language) : translate(language, "pending"), sortValue: (row) => row.accepted_date ?? "" },
    { key: "first_working", label: "First Working", value: (row) => formatDate(row.first_working_date), sortValue: (row) => row.first_working_date ?? "" },
    { key: "age", label: "Age", value: (row) => ageLabel(row), sortValue: (row) => offerStatus(row).ageDays ?? Number.POSITIVE_INFINITY }
  ];
  const table = useTableControls(rows, columns, initialTableState);
  const paginated = paginateRows(table.controlledRows, page, pageSize);
  const visibleRows = paginated.rows;
  const selectedRows = rows.filter((row) => selectedIds.includes(String(row.offer_id)));
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
      page: paginated.page,
      pageSize,
      search: table.search,
      sortDirection: table.sortDirection,
      sortKey: table.sortKey
    }));
  }, [pageSize, paginated.page, table.filters, table.search, table.sortDirection, table.sortKey]);

  return (
    <Panel>
      <SectionTitle
        title={translate(language, "offers")}
        action={canWrite ? <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onNew}>New Offer</Button> : null}
      />
      {rows.length === 0 ? (
        <EmptyState message={translate(language, "noData")} />
      ) : (
        <>
        <TableToolbar
          advancedFiltersOpen={advancedFiltersOpen}
          language={language}
          onAdvancedFiltersToggle={() => setAdvancedFiltersOpen((open) => !open)}
          onSearch={table.setSearch}
          resultCount={table.controlledRows.length}
          searchValue={table.search}
          totalCount={rows.length}
        />
        <div className="grid gap-3 md:hidden">
          {visibleRows.map((row) => (
            <article key={row.offer_id} className="rounded-md border border-[#D7DEE8] bg-white p-3 shadow-[0_3px_10px_rgba(11,19,43,0.02)]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="rounded-sm text-left font-bold text-navy focus:outline-none focus:ring-2 focus:ring-primary/25"
                  onClick={() => onOpenCandidate(row.candidate_id)}
                >
                  {row.candidate_name ?? row.candidate_id}
                </button>
                <div className="flex items-center gap-2">
                  <DetailButton
                    ariaLabel={`View offer candidate detail for ${row.candidate_name ?? row.candidate_id}`}
                    onClick={() => onOpenCandidate(row.candidate_id)}
                  />
                  {row.accepted_date ? <Tag tone="success">{formatDate(row.accepted_date, language)}</Tag> : <Tag tone="muted">{translate(language, "pending")}</Tag>}
                </div>
              </div>
              <p className="text-sm font-semibold text-navy">{row.doc_id}</p>
              <p className="text-sm font-medium text-slate">{row.position ?? "-"} - {translate(language, "startLower")} {formatDate(row.first_working_date, language)}</p>
              <p className="text-sm font-medium text-slate">{offerImpact(row, allOffers, requisitions)} - {translate(language, "age")} {ageLabel(row)}</p>
              <div className="mt-3">
                <RecordActionGroup
                  label={row.candidate_name ?? row.candidate_id}
                  items={offerActions(row.doc_id, onOpenRequisition)}
                />
              </div>
            </article>
          ))}
        </div>
        <div className="table-scroll hidden md:block">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-lightgray text-xs uppercase text-slate">
              <tr>
                <th scope="col" className="px-3 py-3">
                  <input
                    aria-label={translate(language, "selectVisibleOffers")}
                    type="checkbox"
                    checked={visibleRows.length > 0 && visibleRows.every((row) => selectedIds.includes(String(row.offer_id)))}
                    onChange={(event) => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...visibleRows.map((row) => String(row.offer_id))])) : selectedIds.filter((id) => !visibleRows.some((row) => String(row.offer_id) === id)))}
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
                      sortDirection={table.sortDirection}
                      sortKey={table.sortKey}
                      showFilter={advancedFiltersOpen}
                    />
                  </th>
                ))}
                <th scope="col" className="px-3 py-3"><span className="sr-only">{translate(language, "actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.offer_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="px-3 py-3">
                    <input
                      aria-label={translate(language, "selectOffer", { id: row.offer_id })}
                      type="checkbox"
                      checked={selectedIds.includes(String(row.offer_id))}
                      onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, String(row.offer_id)] : current.filter((id) => id !== String(row.offer_id)))}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="rounded-sm text-left font-bold text-navy focus:outline-none focus:ring-2 focus:ring-primary/25"
                      onClick={() => onOpenCandidate(row.candidate_id)}
                    >
                      {row.candidate_name ?? row.candidate_id}
                    </button>
                  </td>
                  <td className="px-3 py-3 font-semibold text-navy">{row.doc_id}</td>
                  <td className="px-3 py-3 text-slate">{row.position ?? "-"}</td>
                  <td className="px-3 py-3"><Tag tone={offerStatus(row).tone}>{offerStatusLabel(language, offerStatus(row).label)}</Tag></td>
                  <td className="px-3 py-3 text-slate">{offerImpact(row, allOffers, requisitions)}</td>
                  <td className="px-3 py-3">{row.accepted_date ? <Tag tone="success">{formatDate(row.accepted_date, language)}</Tag> : <Tag tone="muted">{translate(language, "pending")}</Tag>}</td>
                  <td className="px-3 py-3 text-slate">{formatDate(row.first_working_date, language)}</td>
                  <td className="px-3 py-3 text-slate">{ageLabel(row)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <DetailButton
                        ariaLabel={`View offer candidate detail for ${row.candidate_name ?? row.candidate_id}`}
                        onClick={() => onOpenCandidate(row.candidate_id)}
                      />
                      <RecordActionGroup
                        label={row.candidate_name ?? row.candidate_id}
                        items={offerActions(row.doc_id, onOpenRequisition)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination language={language} page={paginated.page} pageSize={pageSize} totalRows={table.controlledRows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        <BulkActionToolbar
          disabledReason={bulkDisabledReason}
          entityLabel={translate(language, "offers")}
          language={language}
          selectedCount={selectedIds.length}
          onClear={() => {
            setSelectedIds([]);
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

function offerActions(docId: string, onOpenRequisition: (docId: string) => void) {
  return [
    { id: "requisition", label: "Requisition", onSelect: () => onOpenRequisition(docId) },
    { id: "workspace", label: "Workspace", href: `/workspace?type=requisition&id=${encodeURIComponent(docId)}` },
    { id: "candidates", label: "Related candidates", href: `/candidates?candSearch=${encodeURIComponent(docId)}` }
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
