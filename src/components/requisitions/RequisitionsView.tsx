import { Plus, RotateCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { SortableFilterHeader, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { formatDate, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { getRequisitionSlaState } from "@/lib/sla";
import type { EnrichedRequisition, Language } from "@/types/recruitment";

export function RequisitionsView({
  language,
  rows,
  canWrite,
  onNew,
  onStatus,
  onOpen
}: {
  language: Language;
  rows: EnrichedRequisition[];
  canWrite: boolean;
  onNew: () => void;
  onStatus: () => void;
  onOpen: (docId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const columns: TableColumn<EnrichedRequisition>[] = [
    { key: "doc_id", label: "Doc ID", value: (row) => row.doc_id },
    { key: "position", label: "Position", value: (row) => row.position },
    { key: "department", label: "Department", value: (row) => row.department },
    { key: "request_type", label: "Type", value: (row) => row.request_type },
    { key: "section", label: "Section", value: (row) => row.section ?? "-" },
    { key: "owner", label: translate(language, "owner"), value: (row) => row.person_in_charge ?? "-" },
    { key: "status", label: translate(language, "status"), value: (row) => row.status },
    { key: "head_count", label: "HC", value: (row) => row.head_count },
    { key: "accepted_count", label: translate(language, "accepted"), value: (row) => row.accepted_count },
    { key: "candidate_count", label: "Candidates", value: (row) => row.candidate_count },
    { key: "req_date", label: "Req Date", value: (row) => row.pr_approved_date ?? "-", sortValue: (row) => row.pr_approved_date ?? "" },
    { key: "age", label: "Age", value: (row) => ageLabel(row), sortValue: (row) => getRequisitionSlaState(row, { openOnly: true }).ageDays ?? Number.POSITIVE_INFINITY },
    { key: "sla", label: "SLA", value: (row) => getRequisitionSlaState(row, { openOnly: true }).label },
    { key: "updated_at", label: "Updated", value: (row) => formatDate(row.updated_at), sortValue: (row) => row.updated_at }
  ];
  const table = useTableControls(rows, columns);
  const paginated = paginateRows(table.controlledRows, page, pageSize);
  const visibleRows = paginated.rows;

  useEffect(() => {
    setPage(1);
  }, [pageSize, rows.length, table.controlledRows.length, table.filters, table.sortDirection, table.sortKey]);

  return (
    <Panel>
      <SectionTitle
        title={translate(language, "requisitions")}
        action={
          canWrite ? (
            <>
              <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onNew}>New</Button>
              <Button type="button" size="sm" variant="secondary" icon={<RotateCw size={16} />} onClick={onStatus}>Status</Button>
            </>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <EmptyState message={translate(language, "noData")} />
      ) : (
        <>
        <div className="grid gap-3 md:hidden">
          {visibleRows.map((row) => (
            <button key={row.doc_id} type="button" className="rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-panel" onClick={() => onOpen(row.doc_id)}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <strong className={getRequisitionSlaState(row, { openOnly: true }).isOverdue ? "text-scarlet" : "text-primary"}>{row.doc_id}</strong>
                <Tag tone={statusTone(row.status) as never}>{row.status}</Tag>
              </div>
              <p className="font-bold text-navy">{row.position}</p>
              <p className="text-sm font-bold text-slate">{row.department} - {row.site}</p>
              <p className="text-sm font-bold text-slate">Type: {row.request_type}</p>
              <p className="text-sm font-bold text-slate">{row.person_in_charge ?? "-"} - {row.open_headcount} open - {row.candidate_count} candidates</p>
              <p className="text-sm font-medium text-slate">Age: {ageLabel(row)} - SLA: {getRequisitionSlaState(row, { openOnly: true }).label}</p>
            </button>
          ))}
        </div>
        <div className="table-scroll hidden md:block">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-lightgray text-xs uppercase text-slate">
              <tr>
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
                    />
                  </th>
                ))}
                <th scope="col" className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.doc_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className={`px-3 py-3 font-extrabold ${getRequisitionSlaState(row, { openOnly: true }).isOverdue ? "text-scarlet" : "text-primary"}`}>{row.doc_id}</td>
                  <td className="px-3 py-3 font-bold text-navy">{row.position}</td>
                  <td className="px-3 py-3 text-slate">{row.department}</td>
                  <td className="px-3 py-3 text-slate">{row.request_type}</td>
                  <td className="px-3 py-3 text-slate">{row.section ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.person_in_charge ?? "-"}</td>
                  <td className="px-3 py-3"><Tag tone={statusTone(row.status) as never}>{row.status}</Tag></td>
                  <td className="px-3 py-3 text-slate">{row.head_count}</td>
                  <td className="px-3 py-3 text-slate">{row.accepted_count}</td>
                  <td className="px-3 py-3 text-slate">{row.candidate_count}</td>
                  <td className="px-3 py-3 text-slate">{formatDate(row.pr_approved_date, language)}</td>
                  <td className="px-3 py-3 text-slate">{ageLabel(row)}</td>
                  <td className="px-3 py-3 text-slate">{getRequisitionSlaState(row, { openOnly: true }).label}</td>
                  <td className="px-3 py-3 text-slate">{formatDate(row.updated_at)}</td>
                  <td className="px-3 py-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={<Search size={16} />}
                      aria-label={`View requisition ${row.doc_id}`}
                      title={`View requisition ${row.doc_id}`}
                      onClick={() => onOpen(row.doc_id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination language={language} page={paginated.page} pageSize={pageSize} totalRows={table.controlledRows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </>
      )}
    </Panel>
  );
}

function ageLabel(row: EnrichedRequisition) {
  const ageDays = getRequisitionSlaState(row, { openOnly: true }).ageDays;
  return ageDays === null ? "-" : `${ageDays}d`;
}
