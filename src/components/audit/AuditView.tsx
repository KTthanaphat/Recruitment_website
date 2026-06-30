import { Search } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { formatDateTime, statusTone, toTitle } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { ChangeLog, Language } from "@/types/recruitment";

export function AuditView({ language, rows }: { language: Language; rows: ChangeLog[] }) {
  return (
    <Panel>
      <SectionTitle title={translate(language, "audit")} />
      {rows.length === 0 ? (
        <EmptyState message="No audit records yet." />
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <article key={row.log_id} className="rounded-md border border-[#D7DEE8] bg-white p-4 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong className="text-navy">{toTitle(row.entity)} · {row.entity_id}</strong>
                  <p className="text-sm font-bold text-slate">{row.changed_by_email ?? "System"} · {formatDateTime(row.changed_at)}</p>
                </div>
                <Tag tone={statusTone(row.action) as never}>{row.action}</Tag>
              </div>
              <details className="rounded-md border border-[#D7DEE8] bg-lightgray/70 p-3 text-sm">
                <summary className="inline-flex cursor-pointer items-center gap-2 font-extrabold text-primary hover:text-primary" aria-label={`View JSON change for ${row.entity} ${row.entity_id}`}>
                  <Search size={16} aria-hidden="true" />
                  JSON change
                </summary>
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs text-navy">
                  {JSON.stringify({ old: row.old_data, next: row.new_data }, null, 2)}
                </pre>
              </details>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}
