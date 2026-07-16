import { Plus, RotateCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { SortableFilterHeader, TableToolbar, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { RecordActionGroup } from "@/components/ui/Operations";
import { BulkActionToolbar, BulkReviewModal } from "@/components/ui/Workflow";
import { formatDate, statusTone } from "@/lib/format";
import { fillReadinessLabel, requisitionStatusLabel, requestTypeLabel, translate } from "@/lib/i18n/dictionary";
import { bulkActionDisabledReason, requisitionFillReadiness, type BulkActionResult } from "@/lib/operations";
import { getRequisitionSlaState } from "@/lib/sla";
import { readTableUrlState, writeTableUrlValues } from "@/lib/table-url-state";
import { updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import type { EnrichedCandidate, EnrichedRequisition, Language, Profile } from "@/types/recruitment";

export function RequisitionsView({
  language,
  rows,
  canWrite,
  candidates,
  profile,
  onNew,
  onStatus,
  onOpen
}: {
  language: Language;
  rows: EnrichedRequisition[];
  canWrite: boolean;
  candidates: EnrichedCandidate[];
  profile: Profile | null;
  onNew: () => void;
  onStatus: () => void;
  onOpen: (docId: string) => void;
}) {
  const initialTableState = useMemo(() => readTableUrlState("req"), []);
  const [page, setPage] = useState(initialTableState.page);
  const [pageSize, setPageSize] = useState<number>((PAGE_SIZE_OPTIONS as readonly number[]).includes(initialTableState.pageSize) ? initialTableState.pageSize : PAGE_SIZE_OPTIONS[0]);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(Object.keys(initialTableState.filters ?? {}).length > 0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
  const tableInitialized = useRef(false);
  const columns: TableColumn<EnrichedRequisition>[] = [
    { key: "doc_id", label: "Doc ID", value: (row) => row.doc_id },
    { key: "position", label: "Position", value: (row) => row.position },
    { key: "department", label: "Department", value: (row) => row.department },
    { key: "request_type", label: translate(language, "requestType"), value: (row) => requestTypeLabel(language, row.request_type) },
    { key: "section", label: "Section", value: (row) => row.section ?? "-" },
    { key: "owner", label: translate(language, "owner"), value: (row) => row.person_in_charge ?? "-" },
    { key: "status", label: translate(language, "status"), value: (row) => requisitionStatusLabel(language, row.status) },
    { key: "head_count", label: "HC", value: (row) => row.head_count },
    { key: "accepted_count", label: translate(language, "accepted"), value: (row) => row.accepted_count },
    { key: "open_headcount", label: "Open HC", value: (row) => row.open_headcount },
    { key: "candidate_count", label: "Candidates", value: (row) => row.candidate_count },
    { key: "readiness", label: translate(language, "fillReadiness"), value: (row) => fillReadinessLabel(language, requisitionFillReadiness(row, candidates).label) },
    { key: "req_date", label: "Req Date", value: (row) => row.pr_approved_date ?? "-", sortValue: (row) => row.pr_approved_date ?? "" },
    { key: "age", label: "Age", value: (row) => ageLabel(row), sortValue: (row) => getRequisitionSlaState(row, { openOnly: true }).ageDays ?? Number.POSITIVE_INFINITY },
    { key: "sla", label: "SLA", value: (row) => getRequisitionSlaState(row, { openOnly: true }).label },
    { key: "updated_at", label: "Updated", value: (row) => formatDate(row.updated_at), sortValue: (row) => row.updated_at }
  ];
  const table = useTableControls(rows, columns, initialTableState);
  const paginated = paginateRows(table.controlledRows, page, pageSize);
  const visibleRows = paginated.rows;
  const selectedRows = rows.filter((row) => selectedIds.includes(row.doc_id));
  const bulkDisabledReason = bulkActionDisabledReason({ entity: "requisition", ids: selectedIds }, "update requisition status", profile);

  useEffect(() => {
    if (!tableInitialized.current) {
      tableInitialized.current = true;
      return;
    }
    setPage(1);
  }, [pageSize, rows.length, table.controlledRows.length, table.filters, table.search, table.sortDirection, table.sortKey]);

  useEffect(() => {
    updateWorkspaceUrlState(writeTableUrlValues("req", {
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
        title={translate(language, "requisitions")}
        action={
          canWrite ? (
            <>
              <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onNew}>{translate(language, "newRequisition")}</Button>
              <Button type="button" size="sm" variant="secondary" icon={<RotateCw size={16} />} onClick={onStatus}>Status</Button>
            </>
          ) : null
        }
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
            <article key={row.doc_id} className="rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-[0_3px_10px_rgba(11,19,43,0.02)]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    className={`rounded-sm text-left font-semibold focus:outline-none focus:ring-2 focus:ring-primary/25 ${getRequisitionSlaState(row, { openOnly: true }).isOverdue ? "text-scarlet" : "text-navy"}`}
                    onClick={() => onOpen(row.doc_id)}
                  >
                    {row.doc_id}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <DetailButton
                    ariaLabel={`View requisition detail for ${row.doc_id}`}
                    onClick={() => onOpen(row.doc_id)}
                  />
                  <Tag tone={statusTone(row.status) as never}>{requisitionStatusLabel(language, row.status)}</Tag>
                </div>
              </div>
              <p className="font-semibold text-navy">{row.position}</p>
              <p className="text-sm font-medium text-slate">{row.department} - {row.site}</p>
              <p className="text-sm font-medium text-slate">{translate(language, "requestType")}: {requestTypeLabel(language, row.request_type)}</p>
              <p className="text-sm font-medium text-slate">{row.person_in_charge ?? "-"} - {translate(language, "openCount", { count: row.open_headcount })} - {translate(language, "candidatesCount", { count: row.candidate_count })}</p>
              <p className="text-sm font-medium text-slate">{translate(language, "readiness")}: {fillReadinessLabel(language, requisitionFillReadiness(row, candidates).label)}</p>
              <p className="text-sm font-medium text-slate">{translate(language, "age")}: {ageLabel(row)} - SLA: {getRequisitionSlaState(row, { openOnly: true }).label}</p>
              <div className="mt-3">
                <RecordActionGroup
                  label={row.doc_id}
                  items={requisitionActions(row.doc_id)}
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
                    aria-label={translate(language, "selectVisibleRequisitions")}
                    type="checkbox"
                    checked={visibleRows.length > 0 && visibleRows.every((row) => selectedIds.includes(row.doc_id))}
                    onChange={(event) => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...visibleRows.map((row) => row.doc_id)])) : selectedIds.filter((id) => !visibleRows.some((row) => row.doc_id === id)))}
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
                <tr key={row.doc_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="px-3 py-3">
                    <input
                      aria-label={translate(language, "selectRequisition", { id: row.doc_id })}
                      type="checkbox"
                      checked={selectedIds.includes(row.doc_id)}
                      onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, row.doc_id] : current.filter((id) => id !== row.doc_id))}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className={`rounded-sm text-left font-semibold focus:outline-none focus:ring-2 focus:ring-primary/25 ${getRequisitionSlaState(row, { openOnly: true }).isOverdue ? "text-scarlet" : "text-navy"}`}
                      onClick={() => onOpen(row.doc_id)}
                    >
                      {row.doc_id}
                    </button>
                  </td>
                  <td className="px-3 py-3 font-semibold text-navy">{row.position}</td>
                  <td className="px-3 py-3 text-slate">{row.department}</td>
                  <td className="px-3 py-3 text-slate">{requestTypeLabel(language, row.request_type)}</td>
                  <td className="px-3 py-3 text-slate">{row.section ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.person_in_charge ?? "-"}</td>
                  <td className="px-3 py-3"><Tag tone={statusTone(row.status) as never}>{requisitionStatusLabel(language, row.status)}</Tag></td>
                  <td className="px-3 py-3 text-slate">{row.head_count}</td>
                  <td className="px-3 py-3 text-slate">{row.accepted_count}</td>
                  <td className="px-3 py-3 text-slate">{row.open_headcount}</td>
                  <td className="px-3 py-3 text-slate">{row.candidate_count}</td>
                  <td className="px-3 py-3"><Tag tone={requisitionFillReadiness(row, candidates).tone}>{fillReadinessLabel(language, requisitionFillReadiness(row, candidates).label)}</Tag></td>
                  <td className="px-3 py-3 text-slate">{formatDate(row.pr_approved_date, language)}</td>
                  <td className="px-3 py-3 text-slate">{ageLabel(row)}</td>
                  <td className="px-3 py-3 text-slate">{getRequisitionSlaState(row, { openOnly: true }).label}</td>
                  <td className="px-3 py-3 text-slate">{formatDate(row.updated_at)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <DetailButton
                        ariaLabel={`View requisition detail for ${row.doc_id}`}
                        onClick={() => onOpen(row.doc_id)}
                      />
                      <RecordActionGroup
                        label={row.doc_id}
                        items={requisitionActions(row.doc_id)}
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
          entityLabel={translate(language, "requisitionsUnit")}
          language={language}
          selectedCount={selectedIds.length}
          onClear={() => {
            setSelectedIds([]);
            setBulkResult(null);
          }}
          onExport={() => exportRequisitions(selectedRows)}
          onOpenReview={() => {
            setBulkResult(null);
            setBulkReviewOpen(true);
          }}
        />
        <BulkReviewModal
          actionLabel={translate(language, "bulkRequisitionReviewAction")}
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

function exportRequisitions(rows: EnrichedRequisition[]) {
  downloadCsv("selected-requisitions.csv", rows.map((row) => ({
    doc_id: row.doc_id,
    position: row.position,
    site: row.site,
    owner: row.person_in_charge ?? "",
    status: row.status,
    open_headcount: row.open_headcount
  })));
}

function requisitionActions(docId: string) {
  return [
    { id: "workspace", label: "Workspace", href: `/workspace?type=requisition&id=${encodeURIComponent(docId)}` },
    { id: "candidates", label: "Related candidates", href: `/candidates?candSearch=${encodeURIComponent(docId)}` },
    { id: "offers", label: "Related offers", href: `/offers?offerSearch=${encodeURIComponent(docId)}` }
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

function ageLabel(row: EnrichedRequisition) {
  const ageDays = getRequisitionSlaState(row, { openOnly: true }).ageDays;
  return ageDays === null ? "-" : `${ageDays}d`;
}
