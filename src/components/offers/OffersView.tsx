import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
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
  return (
    <Panel>
      <SectionTitle
        title={translate(language, "offers")}
        action={canWrite ? <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onNew}>New Offer</Button> : null}
      />
      {rows.length === 0 ? (
        <EmptyState message={translate(language, "noData")} />
      ) : (
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-lightgray text-xs uppercase text-slate">
              <tr>
                <th className="px-3 py-3">Candidate</th>
                <th className="px-3 py-3">Doc ID</th>
                <th className="px-3 py-3">Position</th>
                <th className="px-3 py-3">Accepted</th>
                <th className="px-3 py-3">First Working</th>
                <th className="px-3 py-3">Type</th>
                <th className="px-3 py-3">Replaced</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.offer_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="px-3 py-3 font-bold text-navy">{row.candidate_name ?? row.candidate_id}</td>
                  <td className="px-3 py-3 font-extrabold text-primary">{row.doc_id}</td>
                  <td className="px-3 py-3 text-slate">{row.position ?? "-"}</td>
                  <td className="px-3 py-3">{row.accepted_date ? <Tag tone="success">{formatDate(row.accepted_date)}</Tag> : <Tag tone="muted">Pending</Tag>}</td>
                  <td className="px-3 py-3 text-slate">{formatDate(row.first_working_date)}</td>
                  <td className="px-3 py-3 text-slate">{row.offered_type ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.replaced ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
