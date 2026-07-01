import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { formatDate } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { EnrichedOffer, Language } from "@/types/recruitment";

export function OffersView({
  language,
  rows,
  canWrite,
  onNew
}: {
  language: Language;
  rows: EnrichedOffer[];
  canWrite: boolean;
  onNew: () => void;
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
        title={translate(language, "offers")}
        action={canWrite ? <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onNew}>New Offer</Button> : null}
      />
      {rows.length === 0 ? (
        <EmptyState message={translate(language, "noData")} />
      ) : (
        <>
        <div className="grid gap-3 md:hidden">
          {visibleRows.map((row) => (
            <article key={row.offer_id} className="rounded-md border border-[#D7DEE8] bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <strong className="text-navy">{row.candidate_name ?? row.candidate_id}</strong>
                {row.accepted_date ? <Tag tone="success">{formatDate(row.accepted_date)}</Tag> : <Tag tone="muted">Pending</Tag>}
              </div>
              <p className="text-sm font-bold text-primary">{row.doc_id}</p>
              <p className="text-sm font-bold text-slate">{row.position ?? "-"} - start {formatDate(row.first_working_date)}</p>
            </article>
          ))}
        </div>
        <div className="table-scroll hidden md:block">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-lightgray text-xs uppercase text-slate">
              <tr>
                <th scope="col" className="px-3 py-3">Candidate</th>
                <th scope="col" className="px-3 py-3">Doc ID</th>
                <th scope="col" className="px-3 py-3">Position</th>
                <th scope="col" className="px-3 py-3">Accepted</th>
                <th scope="col" className="px-3 py-3">First Working</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.offer_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="px-3 py-3 font-bold text-navy">{row.candidate_name ?? row.candidate_id}</td>
                  <td className="px-3 py-3 font-extrabold text-primary">{row.doc_id}</td>
                  <td className="px-3 py-3 text-slate">{row.position ?? "-"}</td>
                  <td className="px-3 py-3">{row.accepted_date ? <Tag tone="success">{formatDate(row.accepted_date)}</Tag> : <Tag tone="muted">Pending</Tag>}</td>
                  <td className="px-3 py-3 text-slate">{formatDate(row.first_working_date)}</td>
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
