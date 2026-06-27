import { Plus, Workflow } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
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
        <div className="table-scroll">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-lightgray text-xs uppercase text-slate">
              <tr>
                <th className="px-3 py-3">ID</th>
                <th className="px-3 py-3">Name</th>
                <th className="px-3 py-3">Group</th>
                <th className="px-3 py-3">Site</th>
                <th className="px-3 py-3">{translate(language, "owner")}</th>
                <th className="px-3 py-3">{translate(language, "latestProcess")}</th>
                <th className="px-3 py-3">{translate(language, "result")}</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.candidate_id} className="border-b border-[#D7DEE8] last:border-0">
                  <td className="px-3 py-3 font-extrabold text-primary">{row.candidate_id}</td>
                  <td className="px-3 py-3 font-bold text-navy">{row.name}</td>
                  <td className="px-3 py-3 text-slate">{row.group_position ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.site ?? "-"}</td>
                  <td className="px-3 py-3 text-slate">{row.person_in_charge ?? "-"}</td>
                  <td className="px-3 py-3"><Tag tone={row.latest_process === "No activity" ? "muted" : "teal"}>{row.latest_process}</Tag></td>
                  <td className="px-3 py-3"><Tag tone={statusTone(resultText(row.latest_result).toLowerCase()) as never}>{resultText(row.latest_result)}</Tag></td>
                  <td className="px-3 py-3"><Button type="button" size="sm" variant="secondary" onClick={() => onOpen(row.candidate_id)}>{translate(language, "view")}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
