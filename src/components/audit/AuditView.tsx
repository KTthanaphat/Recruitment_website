import { RECORD_PAGE_SIZE, RecordPagination, RecordFilterPanel, useRecordFilterDraft } from "@/components/ui/RecordsControls";
import { TableToolbar } from "@/components/ui/TableControls";
import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { NumberSkeleton, LoadingSkeleton, RefreshIndicator } from "@/components/ui/LoadingSkeleton";
import { Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { DayDateSelector } from "@/components/ui/Field";
import { Tag } from "@/components/ui/Tag";
import { formatDateTime, formatRecruitmentId, statusTone, toTitle } from "@/lib/format";
import { actionToneLabel, translate } from "@/lib/i18n/dictionary";
import { auditDiffRows } from "@/lib/operations";
import { useRecruitmentList } from "@/lib/recruitment-list";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChangeLog, Language } from "@/types/recruitment";

export function AuditView({ language, rows, client, accessScope }: { language: Language; rows: ChangeLog[]; client: SupabaseClient | null; accessScope: string }) {
  const [filters, setFilters] = useState({ action: "", changedBy: "", end: "", entity: "", entityId: "", start: "" });
  const [localPage,setLocalPage]=useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const staged = useRecordFilterDraft(filters, filtersOpen);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setFilters((current) => ({
      ...current,
      entity: params.get("entity") ?? current.entity,
      entityId: params.get("entityId") ?? current.entityId
    }));
  }, []);
  const [localPageSize, setLocalPageSize] = useState<number>(RECORD_PAGE_SIZE);
  const list = useRecruitmentList<ChangeLog>({ client, accessScope, entity: "audit_log", initialPageSize: RECORD_PAGE_SIZE, filters, sort: "changed_at", direction: "desc", enabled: Boolean(client && accessScope) });
  useEffect(()=>setLocalPage(1),[filters,list.search]);
  const filteredRows = client && accessScope ? list.items : rows.filter((row) => {
    const changedAt = row.changed_at.slice(0, 10);
    return (!filters.entity || row.entity.toLowerCase().includes(filters.entity.toLowerCase()))
      && (!filters.action || row.action.toLowerCase().includes(filters.action.toLowerCase()))
      && (!filters.changedBy || (row.changed_by_email ?? row.changed_by ?? "").toLowerCase().includes(filters.changedBy.toLowerCase()))
      && (!filters.entityId || row.entity_id.toLowerCase().includes(filters.entityId.toLowerCase()))
      && (!filters.start || changedAt >= filters.start)
      && (!filters.end || changedAt <= filters.end);
  }).sort((a, b) => b.changed_at.localeCompare(a.changed_at) || b.log_id - a.log_id);

  return (
    <Panel className="records-surface">{list.refreshing ? <RefreshIndicator language={language} /> : null}
      <TableToolbar records advancedFiltersPanelId="records-audit-filters" filtersActive={Object.values(filters).some(Boolean)} language={language} advancedFiltersOpen={filtersOpen} onAdvancedFiltersToggle={()=>setFiltersOpen(v=>!v)} searchValue={list.search} onSearch={list.setSearch} resultCount={list.totalCount} totalCount={list.totalCount}/>
      <RecordFilterPanel id="records-audit-filters" open={filtersOpen} language={language} onClose={()=>setFiltersOpen(false)} onApply={()=>setFilters({...staged.draft})} onClear={()=>{const empty={action:"",changedBy:"",end:"",entity:"",entityId:"",start:""};staged.setDraft(empty);setFilters(empty);}}><AuditFilter language={language} label={translate(language, "entity")} value={staged.draft.entity} onChange={(value) => staged.setDraft((current) => ({ ...current, entity: value }))} /><AuditFilter language={language} label={translate(language, "action")} value={staged.draft.action} onChange={(value) => staged.setDraft((current) => ({ ...current, action: value }))} /><AuditFilter language={language} label={translate(language, "startDate")} type="date" value={staged.draft.start} onChange={(value) => staged.setDraft((current) => ({ ...current, start: value }))} /><AuditFilter language={language} label={translate(language, "endDate")} type="date" value={staged.draft.end} onChange={(value) => staged.setDraft((current) => ({ ...current, end: value }))} /><AuditFilter language={language} label={translate(language, "entityId")} value={staged.draft.entityId} onChange={(value) => staged.setDraft((current) => ({ ...current, entityId: value }))} /><AuditFilter language={language} label={translate(language, "changedBy")} value={staged.draft.changedBy} onChange={(value) => staged.setDraft((current) => ({ ...current, changedBy: value }))} /></RecordFilterPanel>
      {list.error ? <div role="alert" className="mb-3 flex items-center gap-3 text-sm text-scarlet"><span>Could not load audit records.</span><RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Audit`} type="button"  onClick={list.retry} loading={list.loading}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</RetryIconButton></div> : null}
      {filteredRows.length === 0 && !list.initialLoading ? <EmptyState message={list.error ? "Audit records are unavailable." : rows.length === 0 ? translate(language, "noAuditRecords") : translate(language, "noAuditRecordsMatch")} /> : (
        <div className="min-w-0 md:overflow-x-auto" data-testid="audit-table-viewport">
          <div className="records-audit-header sticky top-0 z-10 hidden min-w-[66rem] bg-white md:block"><div className="records-audit-heading-row grid min-w-[66rem] grid-cols-[minmax(13rem,1.5fr)_minmax(9rem,.8fr)_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(9rem,.8fr)] gap-3 px-3"><span>{translate(language,"workspaceEvent")}</span><span>{translate(language,"date")}</span><span>{translate(language,"record")}</span><span>{translate(language,"actor")}</span><span>{translate(language,"fieldChanges")}</span></div></div>
          <div className="records-audit-body md:min-w-[66rem]">
            {list.initialLoading ? <LoadingSkeleton variant="table" columns={5} gridClassName="md:grid-cols-[minmax(13rem,1.5fr)_minmax(9rem,.8fr)_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(9rem,.8fr)]" language={language} /> : null}{filteredRows.slice(client?0:(localPage-1)*localPageSize,client?list.pageSize:localPage*localPageSize).map((row) => { const diffs = auditDiffRows(row); const changed = diffs.filter((diff) => diff.changed).length; return <article key={row.log_id} className="records-audit-row min-w-0 px-3 text-sm hover:bg-[#F8FAFD]">
              <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(13rem,1.5fr)_minmax(9rem,.8fr)_minmax(12rem,1fr)_minmax(10rem,1fr)_minmax(9rem,.8fr)] md:items-start md:gap-3">
                <div className="min-w-0"><span className="block text-xs text-slate md:hidden">{translate(language, "workspaceEvent")}</span><span className="block break-words font-semibold text-navy">{auditEntityLabel(language, row.entity)}</span><Tag appearance="soft" tone={statusTone(row.action) as never}>{actionToneLabel(language, row.action)}</Tag></div>
                <div className="text-slate"><span className="block text-xs md:hidden">{translate(language, "date")}</span><time dateTime={row.changed_at}>{formatDateTime(row.changed_at, language)}</time></div>
                <div className="min-w-0 break-all"><span className="block text-xs text-slate md:hidden">{translate(language, "record")}</span><span className="font-semibold text-navy">{formatRecruitmentId(row.entity_id)}</span><AuditRecordLinks row={row} /></div>
                <div title={row.changed_by_email ?? row.changed_by ?? translate(language,"system")} className="min-w-0 break-all text-slate"><span className="block text-xs md:hidden">{translate(language, "actor")}</span>{row.changed_by_email ?? row.changed_by ?? translate(language, "system")}</div>
                <div className="min-w-0 md:col-start-5"><button type="button" aria-expanded={expandedIds.has(row.log_id)} aria-controls={expandedIds.has(row.log_id) ? `audit-diff-${row.log_id}` : undefined} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 text-left font-semibold text-primary hover:bg-[#E8F0FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:min-h-9" aria-label={translate(language, "viewFieldChangesFor", { entity: row.entity, id: formatRecruitmentId(row.entity_id) })} onClick={() => setExpandedIds((current) => { const next = new Set(current); if (next.has(row.log_id)) next.delete(row.log_id); else next.add(row.log_id); return next; })}><Search size={15} aria-hidden="true" />{translate(language, "auditChangedFieldCount", { count: changed })}</button></div>
              </div>
              {expandedIds.has(row.log_id) ? <div id={`audit-diff-${row.log_id}`} className="mt-3 grid min-w-0 gap-2 rounded-lg border border-[#D7DEE8] bg-white p-3">{diffs.map((diff) => <div key={diff.field} className={`grid min-w-0 gap-1 border-b border-[#E4E9F2] pb-2 text-xs last:border-0 last:pb-0 md:grid-cols-[9rem_1fr_1fr] ${diff.changed ? "" : "opacity-70"}`}><strong className="break-all text-navy">{diff.field}</strong><span className="break-all text-slate">{translate(language, "oldValue")}: {diff.oldValue}</span><span className="break-all text-slate">{translate(language, "newValue")}: {diff.newValue}</span></div>)}</div> : null}
            </article>; })}
          </div>
        </div>
      )}
      <RecordPagination pageSize={client?list.pageSize:localPageSize} onPageSizeChange={size=>{setLocalPageSize(size);list.setPageSize(size);setLocalPage(1);}} language={language} page={client?list.page:localPage} totalCount={client?list.totalCount:filteredRows.length} countLoading={list.countLoading} countError={list.countError} loading={list.loading} canPrevious={client?list.canPrevious:localPage>1} canNext={client?list.canNext:localPage*localPageSize<filteredRows.length} onPrevious={client?list.goPrevious:()=>setLocalPage(p=>p-1)} onNext={client?list.goNext:()=>setLocalPage(p=>p+1)} onRetryCount={list.retryCount}/>
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
