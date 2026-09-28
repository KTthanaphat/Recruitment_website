import { Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { MobileBottomSheet } from "@/components/ui/MobileBottomSheet";
import { DayDateSelector } from "@/components/ui/Field";
import { Tag } from "@/components/ui/Tag";
import { formatDateTime, statusTone, toTitle } from "@/lib/format";
import { actionToneLabel, translate } from "@/lib/i18n/dictionary";
import { auditDiffRows } from "@/lib/operations";
import type { ChangeLog, Language } from "@/types/recruitment";

export function AuditView({ language, rows }: { language: Language; rows: ChangeLog[] }) {
  const [filters, setFilters] = useState({ action: "", changedBy: "", end: "", entity: "", entityId: "", start: "" });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilters((current) => ({
      ...current,
      entity: params.get("entity") ?? current.entity,
      entityId: params.get("entityId") ?? current.entityId
    }));
  }, []);
  const filteredRows = useMemo(() => rows.filter((row) => {
    const changedAt = row.changed_at.slice(0, 10);
    return (!filters.entity || row.entity.toLowerCase().includes(filters.entity.toLowerCase()))
      && (!filters.action || row.action.toLowerCase().includes(filters.action.toLowerCase()))
      && (!filters.changedBy || (row.changed_by_email ?? row.changed_by ?? "").toLowerCase().includes(filters.changedBy.toLowerCase()))
      && (!filters.entityId || row.entity_id.toLowerCase().includes(filters.entityId.toLowerCase()))
      && (!filters.start || changedAt >= filters.start)
      && (!filters.end || changedAt <= filters.end);
  }).sort((a, b) => b.changed_at.localeCompare(a.changed_at) || b.log_id - a.log_id), [filters, rows]);

  return (
    <Panel>
      <SectionTitle title={translate(language, "audit")} action={<Button type="button" size="sm" variant="secondary" icon={<SlidersHorizontal size={16} />} className="md:hidden" onClick={() => setFiltersOpen(true)}>{translate(language, "filters")}</Button>} />
      <div className="mb-4 hidden gap-2 rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3 md:grid md:grid-cols-3 xl:grid-cols-6">
        <AuditFilter language={language} label={translate(language, "entity")} value={filters.entity} onChange={(value) => setFilters((current) => ({ ...current, entity: value }))} />
        <AuditFilter language={language} label={translate(language, "action")} value={filters.action} onChange={(value) => setFilters((current) => ({ ...current, action: value }))} />
        <AuditFilter language={language} label={translate(language, "changedBy")} value={filters.changedBy} onChange={(value) => setFilters((current) => ({ ...current, changedBy: value }))} />
        <AuditFilter language={language} label={translate(language, "entityId")} value={filters.entityId} onChange={(value) => setFilters((current) => ({ ...current, entityId: value }))} />
        <AuditFilter language={language} label={translate(language, "startDate")} type="date" value={filters.start} onChange={(value) => setFilters((current) => ({ ...current, start: value }))} />
        <AuditFilter language={language} label={translate(language, "endDate")} type="date" value={filters.end} onChange={(value) => setFilters((current) => ({ ...current, end: value }))} />
      </div>
      <MobileBottomSheet open={filtersOpen} title={translate(language, "filters")} closeLabel={translate(language, "close")} onClose={() => setFiltersOpen(false)}>
        <div className="grid gap-3">
          <AuditFilter language={language} label={translate(language, "entity")} value={filters.entity} onChange={(value) => setFilters((current) => ({ ...current, entity: value }))} />
          <AuditFilter language={language} label={translate(language, "action")} value={filters.action} onChange={(value) => setFilters((current) => ({ ...current, action: value }))} />
          <AuditFilter language={language} label={translate(language, "changedBy")} value={filters.changedBy} onChange={(value) => setFilters((current) => ({ ...current, changedBy: value }))} />
          <AuditFilter language={language} label={translate(language, "entityId")} value={filters.entityId} onChange={(value) => setFilters((current) => ({ ...current, entityId: value }))} />
          <div className="grid grid-cols-2 gap-2"><AuditFilter language={language} label={translate(language, "startDate")} type="date" value={filters.start} onChange={(value) => setFilters((current) => ({ ...current, start: value }))} /><AuditFilter language={language} label={translate(language, "endDate")} type="date" value={filters.end} onChange={(value) => setFilters((current) => ({ ...current, end: value }))} /></div>
          <Button type="button" onClick={() => setFiltersOpen(false)}>{translate(language, "confirm")}</Button>
        </div>
      </MobileBottomSheet>
      <p className="mb-3 text-sm font-medium text-slate" role="status">{translate(language, "auditResultCount", { count: filteredRows.length })}</p>
      {rows.length === 0 ? <EmptyState message={translate(language, "noAuditRecords")} /> : filteredRows.length === 0 ? <EmptyState message={translate(language, "noAuditRecordsMatch")} /> : (
        <div className="min-w-0 md:max-h-[min(68dvh,48rem)] md:overflow-auto" data-testid="audit-table-viewport">
          <div className="sticky top-0 z-10 hidden min-w-[66rem] grid-cols-[minmax(13rem,1.5fr)_minmax(9rem,.8fr)_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(9rem,.8fr)] gap-3 border-b border-[#D7DEE8] bg-white px-3 py-2 text-xs font-medium text-slate md:grid"><span>{translate(language, "workspaceEvent")}</span><span>{translate(language, "date")}</span><span>{translate(language, "record")}</span><span>{translate(language, "actor")}</span><span>{translate(language, "fieldChanges")}</span></div>
          <div className="divide-y divide-[#E4E9F2] md:min-w-[66rem]">
            {filteredRows.map((row) => { const diffs = auditDiffRows(row); const changed = diffs.filter((diff) => diff.changed).length; return <article key={row.log_id} className="min-w-0 px-3 py-3 text-sm hover:bg-[#F8FAFD]">
              <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(13rem,1.5fr)_minmax(9rem,.8fr)_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(9rem,.8fr)] md:items-start md:gap-3">
                <div className="min-w-0"><span className="block text-xs text-slate md:hidden">{translate(language, "workspaceEvent")}</span><span className="block break-words font-semibold text-navy">{auditEntityLabel(language, row.entity)}</span><Tag appearance="soft" tone={statusTone(row.action) as never}>{actionToneLabel(language, row.action)}</Tag></div>
                <div className="text-slate"><span className="block text-xs md:hidden">{translate(language, "date")}</span><time dateTime={row.changed_at}>{formatDateTime(row.changed_at, language)}</time></div>
                <div className="min-w-0 break-all"><span className="block text-xs text-slate md:hidden">{translate(language, "record")}</span><span className="font-semibold text-navy">{row.entity_id}</span><AuditRecordLinks row={row} /></div>
                <div className="min-w-0 break-all text-slate"><span className="block text-xs md:hidden">{translate(language, "actor")}</span>{row.changed_by_email ?? row.changed_by ?? translate(language, "system")}</div>
                <div className="min-w-0 md:col-start-5"><button type="button" aria-expanded={expandedIds.has(row.log_id)} aria-controls={expandedIds.has(row.log_id) ? `audit-diff-${row.log_id}` : undefined} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 text-left font-semibold text-primary hover:bg-[#E8F0FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-h-9" aria-label={translate(language, "viewFieldChangesFor", { entity: row.entity, id: row.entity_id })} onClick={() => setExpandedIds((current) => { const next = new Set(current); if (next.has(row.log_id)) next.delete(row.log_id); else next.add(row.log_id); return next; })}><Search size={15} aria-hidden="true" />{translate(language, "auditChangedFieldCount", { count: changed })}</button></div>
              </div>
              {expandedIds.has(row.log_id) ? <div id={`audit-diff-${row.log_id}`} className="mt-3 grid min-w-0 gap-2 rounded-lg border border-[#D7DEE8] bg-white p-3">{diffs.map((diff) => <div key={diff.field} className={`grid min-w-0 gap-1 border-b border-[#E4E9F2] pb-2 text-xs last:border-0 last:pb-0 md:grid-cols-[9rem_1fr_1fr] ${diff.changed ? "" : "opacity-70"}`}><strong className="break-all text-navy">{diff.field}</strong><span className="break-all text-slate">{translate(language, "oldValue")}: {diff.oldValue}</span><span className="break-all text-slate">{translate(language, "newValue")}: {diff.newValue}</span></div>)}</div> : null}
            </article>; })}
          </div>
        </div>
      )}
    </Panel>
  );
}

function AuditFilter({ label, language, onChange, type = "search", value }: { label: string; language: Language; onChange: (value: string) => void; type?: "date" | "search"; value: string }) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-slate">
      {label}
      {type === "date" ? <DayDateSelector ariaLabel={label} language={language} name={label} value={value} onChange={(event) => onChange(event.target.value)} /> : <input
        className="min-h-11 rounded-md border border-[#C9D5E6] bg-white px-2 text-sm font-medium text-navy focus:border-primary focus:outline-none"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />}
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
    <div className="mt-1 flex flex-wrap gap-1">
      {links.map((link) => (
        <Link key={link.href} className="rounded-md px-1.5 py-1 text-xs font-semibold text-primary hover:bg-[#E8F0FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href={link.href}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}

function auditEntityLabel(language: Language, entity: string) {
  const name = entity.toLowerCase();
  if (name.includes("candidate")) return translate(language, "candidate");
  if (name.includes("requisition")) return translate(language, "requisition");
  if (name.includes("offer")) return translate(language, "offer");
  if (name.includes("position_group")) return translate(language, "group");
  if (name.includes("sourcing")) return translate(language, "sourcingUpdate");
  if (name.includes("recruitment_log")) return translate(language, "pipeline");
  return toTitle(entity);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}
