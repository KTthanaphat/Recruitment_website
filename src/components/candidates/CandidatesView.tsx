import { Plus, Search, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { processLabel } from "@/lib/constants";
import { resultText, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { EnrichedCandidate, Language } from "@/types/recruitment";

export function CandidatesView({
  language,
  rows,
  canWrite,
  onNew,
  onProcess,
  onOpen
}: {
  language: Language;
  rows: EnrichedCandidate[];
  canWrite: boolean;
  onNew: () => void;
  onProcess: () => void;
  onOpen: (candidateId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const paginated = paginateRows(rows, page, pageSize);
  const visibleRows = paginated.rows;

  useEffect(() => {
    setPage(1);
  }, [rows.length, pageSize]);

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
        <div className="grid gap-3 md:hidden">
          {visibleRows.map((row) => (
            <button key={row.candidate_id} type="button" className="rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-panel" onClick={() => onOpen(row.candidate_id)}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <strong className="text-navy">{row.name}</strong>
                <Tag tone={statusTone(resultText(row.latest_result).toLowerCase()) as never}>{resultText(row.latest_result)}</Tag>
              </div>
              <p className="text-sm font-bold text-primary">{row.candidate_id}</p>
              <p className="text-sm font-bold text-slate">{row.group_position ?? "-"} - {row.site ?? "-"}</p>
              <p className="text-sm font-bold text-slate">{processLabel(row.latest_process)} - {row.person_in_charge ?? "-"}</p>
            </button>
          ))}
        </div>
        <div className="table-scroll hidden md:block">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-lightgray text-xs uppercase text-slate">
              <tr>
                <th scope="col" className="px-3 py-3">ID</th>
                <th scope="col" className="px-3 py-3">Name</th>
                <th scope="col" className="px-3 py-3">Group</th>
                <th scope="col" className="px-3 py-3">Site</th>
                <th scope="col" className="px-3 py-3">{translate(language, "owner")}</th>
                <th scope="col" className="px-3 py-3">{translate(language, "latestProcess")}</th>
                <th scope="col" className="px-3 py-3">{translate(language, "result")}</th>
                <th scope="col" className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.candidate_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="px-3 py-3 font-extrabold text-primary">{row.candidate_id}</td>
                  <td className="px-3 py-3 font-bold text-navy">{row.name}</td>
                  <td className="px-3 py-3 text-slate">{row.group_position ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.site ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.person_in_charge ?? "-"}</td>
                  <td className="px-3 py-3"><Tag tone={row.latest_process === "No activity" ? "muted" : "teal"}>{processLabel(row.latest_process)}</Tag></td>
                  <td className="px-3 py-3"><Tag tone={statusTone(resultText(row.latest_result).toLowerCase()) as never}>{resultText(row.latest_result)}</Tag></td>
                  <td className="px-3 py-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      icon={<Search size={16} />}
                      aria-label={`View candidate ${row.candidate_id}`}
                      title={`View candidate ${row.candidate_id}`}
                      onClick={() => onOpen(row.candidate_id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination language={language} page={paginated.page} pageSize={pageSize} totalRows={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        </>
      )}
    </Panel>
  );
}
