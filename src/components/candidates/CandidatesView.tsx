import { Plus, Search, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { SortableFilterHeader, TableToolbar, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { RecordActionGroup } from "@/components/ui/Operations";
import { BulkActionToolbar, BulkReviewModal } from "@/components/ui/Workflow";
import { processLabel } from "@/lib/constants";
import { resultText, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { bulkActionDisabledReason, candidateTouchAgeDays, isCandidateAging, type BulkActionResult } from "@/lib/operations";
import { readTableUrlState, writeTableUrlValues } from "@/lib/table-url-state";
import { updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import type { EnrichedCandidate, Language, Profile } from "@/types/recruitment";

type CandidateTriageFilter = "all" | "no_activity" | "aging" | "active" | "failed" | "offer_pending" | "offer_accepted";

export function CandidatesView({
  language,
  rows,
  canWrite,
  profile,
  onNew,
  onProcess,
  onOpen
}: {
  language: Language;
  rows: EnrichedCandidate[];
  canWrite: boolean;
  profile: Profile | null;
  onNew: () => void;
  onProcess: () => void;
  onOpen: (candidateId: string) => void;
}) {
  const initialTableState = useMemo(() => readTableUrlState("cand"), []);
  const [page, setPage] = useState(initialTableState.page);
  const [pageSize, setPageSize] = useState<number>((PAGE_SIZE_OPTIONS as readonly number[]).includes(initialTableState.pageSize) ? initialTableState.pageSize : PAGE_SIZE_OPTIONS[0]);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(Object.keys(initialTableState.filters ?? {}).length > 0);
  const [triageFilter, setTriageFilter] = useState<CandidateTriageFilter>("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
  const tableInitialized = useRef(false);
  const columns: TableColumn<EnrichedCandidate>[] = [
    { key: "candidate_id", label: "ID", value: (row) => row.candidate_id },
    { key: "name", label: "Name", value: (row) => row.name },
    { key: "group", label: "Group", value: (row) => row.group_position ?? "-", filterValue: (row) => [row.group_position, ...row.doc_ids].filter(Boolean).join(" ") },
    { key: "site", label: "Site", value: (row) => row.site ?? "-" },
    { key: "owner", label: translate(language, "owner"), value: (row) => row.person_in_charge ?? "-" },
    { key: "latest_process", label: translate(language, "latestProcess"), value: (row) => processLabel(row.latest_process) },
    { key: "result", label: translate(language, "result"), value: (row) => resultText(row.latest_result) },
    { key: "last_touch", label: "Last Touch", value: (row) => ageLabel(row), sortValue: (row) => candidateTouchAgeDays(row) ?? Number.POSITIVE_INFINITY }
  ];
  const triagedRows = useMemo(() => filterCandidatesByTriage(rows, triageFilter), [rows, triageFilter]);
  const table = useTableControls(triagedRows, columns, initialTableState);
  const paginated = paginateRows(table.controlledRows, page, pageSize);
  const visibleRows = paginated.rows;
  const selectedRows = rows.filter((row) => selectedIds.includes(row.candidate_id));
  const bulkDisabledReason = bulkActionDisabledReason({ entity: "candidate", ids: selectedIds }, "mark candidates for review", profile);

  useEffect(() => {
    if (!tableInitialized.current) {
      tableInitialized.current = true;
      return;
    }
    setPage(1);
  }, [pageSize, rows.length, table.controlledRows.length, table.filters, table.search, table.sortDirection, table.sortKey, triageFilter]);

  useEffect(() => {
    updateWorkspaceUrlState(writeTableUrlValues("cand", {
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
        title={translate(language, "candidates")}
        action={
          canWrite ? (
            <>
              <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onNew}>New</Button>
              <Button type="button" size="sm" variant="secondary" icon={<Workflow size={16} />} onClick={onProcess}>{translate(language, "processUpdate")}</Button>
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
          onAdvancedFiltersToggle={() => setAdvancedFiltersOpen((open) => !open)}
          onSearch={table.setSearch}
          resultCount={table.controlledRows.length}
          searchValue={table.search}
          totalCount={triagedRows.length}
        />
        <div className="mb-3 flex flex-wrap gap-2">
          {candidateTriageOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`min-h-8 rounded-md px-3 text-xs font-semibold ring-1 ring-inset transition-colors ${triageFilter === option.value ? "bg-primary text-white ring-primary" : "bg-white text-navy ring-[#C9D5E6] hover:bg-[#F8FAFD]"}`}
              aria-pressed={triageFilter === option.value}
              onClick={() => setTriageFilter(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:hidden">
          {visibleRows.map((row) => (
            <article key={row.candidate_id} className="rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-[0_6px_16px_rgba(11,19,43,0.025)]">
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="rounded-sm text-left font-bold text-navy focus:outline-none focus:ring-2 focus:ring-primary/25"
                  onClick={() => onOpen(row.candidate_id)}
                >
                  {row.name}
                </button>
                <div className="flex items-center gap-2">
                  <DetailButton
                    ariaLabel={`View candidate detail for ${row.name}`}
                    onClick={() => onOpen(row.candidate_id)}
                  />
                  <Tag tone={statusTone(resultText(row.latest_result).toLowerCase()) as never}>{resultText(row.latest_result)}</Tag>
                </div>
              </div>
              <p className="text-sm font-semibold text-navy">{row.candidate_id}</p>
              <p className="text-sm font-medium text-slate">{row.group_position ?? "-"} - {row.site ?? "-"}</p>
              <p className="text-sm font-medium text-slate">{processLabel(row.latest_process)} - {row.person_in_charge ?? "-"}</p>
              <p className="text-sm font-medium text-slate">Last touch: {ageLabel(row)}</p>
              <div className="mt-3">
                <RecordActionGroup
                  label={row.name}
                  items={candidateActions(row)}
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
                    aria-label="Select visible candidates"
                    type="checkbox"
                    checked={visibleRows.length > 0 && visibleRows.every((row) => selectedIds.includes(row.candidate_id))}
                    onChange={(event) => setSelectedIds(event.target.checked ? Array.from(new Set([...selectedIds, ...visibleRows.map((row) => row.candidate_id)])) : selectedIds.filter((id) => !visibleRows.some((row) => row.candidate_id === id)))}
                  />
                </th>
                {columns.map((column) => (
                  <th key={column.key} scope="col" className="px-3 py-3 align-top">
                    <SortableFilterHeader
                      columnKey={column.key}
                      filterValue={table.filters[column.key] ?? ""}
                      label={column.label}
                      onFilter={table.setFilter}
                      onSort={table.toggleSort}
                      sortDirection={table.sortDirection}
                      sortKey={table.sortKey}
                      showFilter={advancedFiltersOpen}
                    />
                  </th>
                ))}
                <th scope="col" className="px-3 py-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.candidate_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="px-3 py-3">
                    <input
                      aria-label={`Select candidate ${row.candidate_id}`}
                      type="checkbox"
                      checked={selectedIds.includes(row.candidate_id)}
                      onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, row.candidate_id] : current.filter((id) => id !== row.candidate_id))}
                    />
                  </td>
                  <td className="px-3 py-3 font-semibold text-navy">{row.candidate_id}</td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      className="rounded-sm text-left font-bold text-navy focus:outline-none focus:ring-2 focus:ring-primary/25"
                      onClick={() => onOpen(row.candidate_id)}
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-slate">{row.group_position ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.site ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.person_in_charge ?? "-"}</td>
                  <td className="px-3 py-3"><Tag tone={row.latest_process === "No activity" ? "muted" : "teal"}>{processLabel(row.latest_process)}</Tag></td>
                  <td className="px-3 py-3"><Tag tone={statusTone(resultText(row.latest_result).toLowerCase()) as never}>{resultText(row.latest_result)}</Tag></td>
                  <td className="px-3 py-3 text-slate">{ageLabel(row)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <DetailButton
                        ariaLabel={`View candidate detail for ${row.name}`}
                        onClick={() => onOpen(row.candidate_id)}
                      />
                      <RecordActionGroup
                        label={row.name}
                        items={candidateActions(row)}
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
          entityLabel="candidates"
          selectedCount={selectedIds.length}
          onClear={() => {
            setSelectedIds([]);
            setBulkResult(null);
          }}
          onExport={() => exportCandidates(selectedRows)}
          onOpenReview={() => {
            setBulkResult(null);
            setBulkReviewOpen(true);
          }}
        />
        <BulkReviewModal
          actionLabel="Mark selected candidates for process review. Candidate stage movement stays one-by-one in this pass."
          ids={selectedIds}
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

function exportCandidates(rows: EnrichedCandidate[]) {
  downloadCsv("selected-candidates.csv", rows.map((row) => ({
    candidate_id: row.candidate_id,
    name: row.name,
    site: row.site ?? "",
    owner: row.person_in_charge ?? "",
    latest_process: processLabel(row.latest_process)
  })));
}

function candidateActions(row: EnrichedCandidate) {
  return [
    { id: "workspace", label: "Workspace", href: `/workspace?type=${row.group_id ? "group" : "requisition"}&id=${encodeURIComponent(row.group_id ?? row.doc_ids[0] ?? "")}` },
    ...row.doc_ids.map((docId) => ({ id: `requisition-${docId}`, label: `Requisition ${docId}`, href: `/requisitions?detailType=requisition&detailId=${encodeURIComponent(docId)}` })),
    { id: "offers", label: "Related offers", href: `/offers?offerSearch=${encodeURIComponent(row.candidate_id)}` }
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

const candidateTriageOptions: Array<{ value: CandidateTriageFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "no_activity", label: "No activity" },
  { value: "aging", label: "Aging" },
  { value: "active", label: "Active" },
  { value: "failed", label: "Failed" },
  { value: "offer_pending", label: "Offer pending" },
  { value: "offer_accepted", label: "Offer accepted" }
];

function filterCandidatesByTriage(rows: EnrichedCandidate[], filter: CandidateTriageFilter) {
  if (filter === "all") return rows;
  if (filter === "no_activity") return rows.filter((row) => row.latest_process === "No activity");
  if (filter === "aging") return rows.filter(isCandidateAging);
  if (filter === "active") return rows.filter((row) => row.latest_process !== "No activity" && row.latest_result !== 0 && !row.accepted_date);
  if (filter === "failed") return rows.filter((row) => row.latest_result === 0);
  if (filter === "offer_pending") return rows.filter((row) => row.latest_process === "Offer" && !row.accepted_date);
  if (filter === "offer_accepted") return rows.filter((row) => Boolean(row.accepted_date));
  return rows;
}

function ageLabel(row: EnrichedCandidate) {
  const age = candidateTouchAgeDays(row);
  return age === null ? "-" : `${age}d`;
}
