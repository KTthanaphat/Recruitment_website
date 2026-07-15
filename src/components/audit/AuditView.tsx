import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { formatDateTime, statusTone, toTitle } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { auditDiffRows } from "@/lib/operations";
import type { ChangeLog, Language } from "@/types/recruitment";

export function AuditView({ language, rows }: { language: Language; rows: ChangeLog[] }) {
  const [filters, setFilters] = useState({ action: "", changedBy: "", end: "", entity: "", entityId: "", start: "" });
  const filteredRows = useMemo(() => rows.filter((row) => {
    const changedAt = row.changed_at.slice(0, 10);
    return (!filters.entity || row.entity.toLowerCase().includes(filters.entity.toLowerCase()))
      && (!filters.action || row.action.toLowerCase().includes(filters.action.toLowerCase()))
      && (!filters.changedBy || (row.changed_by_email ?? row.changed_by ?? "").toLowerCase().includes(filters.changedBy.toLowerCase()))
      && (!filters.entityId || row.entity_id.toLowerCase().includes(filters.entityId.toLowerCase()))
      && (!filters.start || changedAt >= filters.start)
      && (!filters.end || changedAt <= filters.end);
  }), [filters, rows]);

  return (
    <Panel>
      <SectionTitle title={translate(language, "audit")} />
      <div className="mb-4 grid gap-2 rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3 md:grid-cols-3 xl:grid-cols-6">
        <AuditFilter label="Entity" value={filters.entity} onChange={(value) => setFilters((current) => ({ ...current, entity: value }))} />
        <AuditFilter label="Action" value={filters.action} onChange={(value) => setFilters((current) => ({ ...current, action: value }))} />
        <AuditFilter label="Changed by" value={filters.changedBy} onChange={(value) => setFilters((current) => ({ ...current, changedBy: value }))} />
        <AuditFilter label="Entity ID" value={filters.entityId} onChange={(value) => setFilters((current) => ({ ...current, entityId: value }))} />
        <AuditFilter label="Start" type="date" value={filters.start} onChange={(value) => setFilters((current) => ({ ...current, start: value }))} />
        <AuditFilter label="End" type="date" value={filters.end} onChange={(value) => setFilters((current) => ({ ...current, end: value }))} />
      </div>
      {rows.length === 0 ? (
        <EmptyState message="No audit records yet." />
      ) : (
        <div className="grid gap-3">
          {filteredRows.length === 0 ? <EmptyState message="No audit records match the current filters." /> : null}
          {filteredRows.map((row) => (
            <article key={row.log_id} className="rounded-md border border-[#D7DEE8] bg-white p-4 shadow-[0_6px_16px_rgba(11,19,43,0.025)]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong className="text-navy">{toTitle(row.entity)} - {row.entity_id}</strong>
                  <p className="text-sm font-medium text-slate">{row.changed_by_email ?? "System"} - {formatDateTime(row.changed_at)}</p>
                </div>
                <Tag tone={statusTone(row.action) as never}>{row.action}</Tag>
              </div>
              <AuditRecordLinks row={row} />
              <details className="rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3 text-sm">
                <summary className="inline-flex cursor-pointer items-center gap-2 font-semibold text-navy hover:text-primary" aria-label={`View field changes for ${row.entity} ${row.entity_id}`}>
                  <Search size={16} aria-hidden="true" />
                  Field changes
                </summary>
                <div className="mt-3 grid gap-2">
                  {auditDiffRows(row).map((diff) => (
                    <div key={diff.field} className={`grid gap-2 rounded border border-[#D7DEE8] bg-white p-2 text-xs md:grid-cols-[10rem_1fr_1fr] ${diff.changed ? "" : "opacity-70"}`}>
                      <strong className="text-navy">{diff.field}</strong>
                      <span className="text-slate">Old: {diff.oldValue}</span>
                      <span className="text-slate">New: {diff.newValue}</span>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AuditFilter({ label, onChange, type = "search", value }: { label: string; onChange: (value: string) => void; type?: "date" | "search"; value: string }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-slate">
      {label}
      <input
        className="min-h-9 rounded-md border border-[#C9D5E6] bg-white px-2 text-sm font-medium text-navy focus:border-primary focus:outline-none"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function AuditRecordLinks({ row }: { row: ChangeLog }) {
  const entity = row.entity.toLowerCase();
  const newData = row.new_data ?? {};
  const oldData = row.old_data ?? {};
  const candidateId = stringValue(newData.candidate_id) ?? stringValue(oldData.candidate_id) ?? (entity.includes("candidate") ? row.entity_id : null);
  const docId = stringValue(newData.doc_id) ?? stringValue(oldData.doc_id) ?? (entity.includes("requisition") ? row.entity_id : null);
  const groupId = stringValue(newData.group_id) ?? stringValue(oldData.group_id) ?? (entity.includes("position_group") ? row.entity_id : null);
  const links = [
    docId ? { href: `/workspace?type=requisition&id=${encodeURIComponent(docId)}`, label: "Open workspace" } : null,
    groupId ? { href: `/workspace?type=group&id=${encodeURIComponent(groupId)}`, label: "Group workspace" } : null,
    candidateId ? { href: `/candidates?detailType=candidate&detailId=${encodeURIComponent(candidateId)}`, label: "Open candidate" } : null,
    docId ? { href: `/requisitions?detailType=requisition&detailId=${encodeURIComponent(docId)}`, label: "Open requisition" } : null
  ].filter(Boolean) as Array<{ href: string; label: string }>;
  if (links.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {links.map((link) => (
        <Link key={link.href} className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-primary ring-1 ring-inset ring-[#C9D5E6] hover:bg-[#F8FAFD]" href={link.href}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
