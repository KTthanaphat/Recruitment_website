import { Plus, RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { formatDate, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
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
          {rows.map((row) => (
            <button key={row.doc_id} type="button" className="rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-panel" onClick={() => onOpen(row.doc_id)}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <strong className="text-primary">{row.doc_id}</strong>
                <Tag tone={statusTone(row.status) as never}>{row.status}</Tag>
              </div>
              <p className="font-bold text-navy">{row.position}</p>
              <p className="text-sm font-bold text-slate">{row.department} - {row.site}</p>
              <p className="text-sm font-bold text-slate">Type: {row.request_type}</p>
              <p className="text-sm font-bold text-slate">{row.person_in_charge ?? "-"} - {row.open_headcount} open - {row.candidate_count} candidates</p>
            </button>
          ))}
        </div>
        <div className="table-scroll hidden md:block">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-lightgray text-xs uppercase text-slate">
              <tr>
                <th className="px-3 py-3">Doc ID</th>
                <th className="px-3 py-3">Position</th>
                <th className="px-3 py-3">Department</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Section</th>
                <th className="px-3 py-3">{translate(language, "owner")}</th>
                <th className="px-3 py-3">{translate(language, "status")}</th>
                <th className="px-3 py-3">HC</th>
                <th className="px-3 py-3">{translate(language, "accepted")}</th>
                <th className="px-3 py-3">Candidates</th>
                <th className="px-3 py-3">Updated</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.doc_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="px-3 py-3 font-extrabold text-primary">{row.doc_id}</td>
                  <td className="px-3 py-3 font-bold text-navy">{row.position}</td>
                  <td className="px-3 py-3 text-slate">{row.department}</td>
                  <td className="px-3 py-3 text-slate">{row.request_type}</td>
                  <td className="px-3 py-3 text-slate">{row.section ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.person_in_charge ?? "-"}</td>
                  <td className="px-3 py-3"><Tag tone={statusTone(row.status) as never}>{row.status}</Tag></td>
                  <td className="px-3 py-3 text-slate">{row.head_count}</td>
                  <td className="px-3 py-3 text-slate">{row.accepted_count}</td>
                  <td className="px-3 py-3 text-slate">{row.candidate_count}</td>
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
        </>
      )}
    </Panel>
  );
}
