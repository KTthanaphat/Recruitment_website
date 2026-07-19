import { Plus, Search, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { SortableFilterHeader, TableToolbar, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { RecordQuickActions, type RecordQuickAction } from "@/components/ui/Operations";
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
    { key: "name", label: translate(language, "name"), value: (row) => row.name },
    { key: "group", label: translate(language, "group"), value: (row) => row.group_position ?? "-", filterValue: (row) => [row.group_position, ...row.doc_ids].filter(Boolean).join(" ") },
    { key: "site", label: translate(language, "site"), value: (row) => row.site ?? "-" },
    { key: "owner", label: translate(language, "owner"), value: (row) => row.person_in_charge ?? "-" },
    { key: "latest_process", label: translate(language, "latestProcess"), value: (row) => processLabel(row.latest_process, language) },
    { key: "result", label: translate(language, "result"), value: (row) => resultText(row.latest_result, language) },
    { key: "last_touch", label: translate(language, "lastTouch"), value: (row) => ageLabel(row), sortValue: (row) => candidateTouchAgeDays(row) ?? Number.POSITIVE_INFINITY }
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
              <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onNew}>{translate(language, "newCandidate")}</Button>
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
          language={language}
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
              className={`min-h-8 rounded-lg px-3 text-xs font-semibold ring-1 ring-inset transition-colors ${triageFilter === option.value ? "bg-primary text-white ring-primary" : "bg-white text-navy ring-[#C9D5E6] hover:bg-[#F8FAFD]"}`}
              aria-pressed={triageFilter === option.value}
              onClick={() => setTriageFilter(option.value)}
            >
              {translate(language, option.labelKey)}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:hidden">
          {visibleRows.map((row) => (
            <article key={row.candidate_id} className="ats-card p-3 text-left">
              <div className="mb-2 flex items-center justify-between gap-2">
                <strong className="font-bold text-navy">
                  {row.name}
                </strong>
                <Tag tone={statusTone(resultText(row.latest_result).toLowerCase()) as never}>{resultText(row.latest_result, language)}</Tag>
              </div>
              <p className="text-sm font-semibold text-navy">{row.candidate_id}</p>
              <p className="text-sm font-medium text-slate">{row.group_position ?? "-"} - {row.site ?? "-"}</p>
              <p className="text-sm font-medium text-slate">{processLabel(row.latest_process, language)} - {row.person_in_charge ?? "-"}</p>
              <p className="text-sm font-medium text-slate">{translate(language, "lastTouchValue", { value: ageLabel(row) })}</p>
              <div className="mt-3">
                <RecordQuickActions label={translate(language, "recordActionsFor", { label: row.name })} actions={candidateActions(row, language, onOpen)} />
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
                    aria-label={translate(language, "selectVisibleCandidates")}
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
                <tr key={row.candidate_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="px-3 py-3">
                    <input
                      aria-label={translate(language, "selectCandidate", { id: row.candidate_id })}
                      type="checkbox"
                      checked={selectedIds.includes(row.candidate_id)}
                      onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, row.candidate_id] : current.filter((id) => id !== row.candidate_id))}
                    />
                  </td>
                  <td className="px-3 py-3 font-semibold text-navy">{row.candidate_id}</td>
                  <td className="px-3 py-3">
                    <span className="font-bold text-navy">
                      {row.name}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate">{row.group_position ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.site ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.person_in_charge ?? "-"}</td>
                  <td className="px-3 py-3"><Tag tone={row.latest_process === "No activity" ? "muted" : "teal"}>{processLabel(row.latest_process, language)}</Tag></td>
                  <td className="px-3 py-3"><Tag tone={statusTone(resultText(row.latest_result).toLowerCase()) as never}>{resultText(row.latest_result, language)}</Tag></td>
                  <td className="px-3 py-3 text-slate">{ageLabel(row)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <RecordQuickActions label={translate(language, "recordActionsFor", { label: row.name })} actions={candidateActions(row, language, onOpen)} />
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
          entityLabel={translate(language, "candidatesUnit")}
          language={language}
          selectedCount={selectedIds.length}
          onClear={() => {
            setSelectedIds([]);
            setBulkResult(null);
          }}
          onExport={() => exportCandidates(selectedRows, language)}
          onOpenReview={() => {
            setBulkResult(null);
            setBulkReviewOpen(true);
          }}
        />
        <BulkReviewModal
          actionLabel={translate(language, "bulkCandidateReviewAction")}
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

function exportCandidates(rows: EnrichedCandidate[], language: Language) {
  downloadCsv("selected-candidates.csv", rows.map((row) => ({
    candidate_id: row.candidate_id,
    name: row.name,
    site: row.site ?? "",
    owner: row.person_in_charge ?? "",
    latest_process: processLabel(row.latest_process, language)
  })));
}

function candidateActions(row: EnrichedCandidate, language: Language, onOpen: (candidateId: string) => void): RecordQuickAction[] {
  return [
    { id: "view", label: translate(language, "viewCandidateDetailFor", { name: row.name }), icon: <Search size={16} aria-hidden="true" />, iconOnly: true, onSelect: () => onOpen(row.candidate_id) }
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

const candidateTriageOptions: Array<{ value: CandidateTriageFilter; labelKey: string }> = [
  { value: "all", labelKey: "candidateTriageAll" },
  { value: "no_activity", labelKey: "candidateTriageNoActivity" },
  { value: "aging", labelKey: "candidateTriageAging" },
  { value: "active", labelKey: "candidateTriageActive" },
  { value: "failed", labelKey: "candidateTriageFailed" },
  { value: "offer_pending", labelKey: "candidateTriageOfferPending" },
  { value: "offer_accepted", labelKey: "candidateTriageOfferAccepted" }
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
