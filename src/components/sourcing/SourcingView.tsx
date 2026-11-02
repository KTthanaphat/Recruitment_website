import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { LoadingSkeleton, RefreshIndicator } from "@/components/ui/LoadingSkeleton";
import { ArrowDown, ArrowDownUp, ArrowUp, CalendarPlus, Clock3, Pencil, Plus, Settings2, SlidersHorizontal, Unlink } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DayDateSelector, Field, SelectInput, TextInput } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { CursorPagination } from "@/components/ui/CursorPagination";
import { SortableFilterHeader, TableToolbar, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { SourcingSummaryCharts } from "@/components/sourcing/SourcingSummaryCharts";
import { EmbeddedSourcingPanel } from "@/components/sourcing/EmbeddedSourcingPanel";
import { AuthorizedRequisitionLookup } from "@/components/requisitions/AuthorizedRequisitionLookup";
import { loadSourcingSummary, type SourcingSummary } from "@/lib/dashboard-summary-client";
import { SOURCING_CHANNELS } from "@/lib/constants";
import { enrichRequisitions, enrichSourcingGroups, enrichUnmatchedSourcingGroups, sourcingGroupsInScope } from "@/lib/data";
import { sourcingCycleSaturday, sourcingDatabaseWeekStart } from "@/lib/dates";
import { formatDate, formatRecruitmentId, formatSourcingWeekRange } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { previousWeekStart, sourcingApplicants } from "@/lib/operations";
import { useRecruitmentList } from "@/lib/recruitment-list";
import { loadScopedGroupWorkspace, type ScopedGroupWorkspaceResult } from "@/lib/group-workspace-loader";
import type { DashboardData, EnrichedSourcingGroup, Language, Profile, SourcingLifecycleRow, SourcingWeeklyUpdate } from "@/types/recruitment";

export type SourcingViewProps = {
  language: Language;
  data: DashboardData;
  profile: Profile | null;
  canWrite: boolean;
  canManageSetup: boolean;
  onCreateGroup?: () => void;
  onLinkGroup?: (groupId?: string) => void;
  onAddGroupRequisition?: (groupId: string, docId: string) => void;
  weekStart: string;
  onWeekChange: (value: string) => void;
  onSaveSourcing: (payload: Record<string, unknown>, summary: string) => void;
  onUpdateGroupInfo?: (payload: Record<string, unknown>, summary: string) => void;
  onSetGroupChannel?: (payload: Record<string, unknown>, summary: string) => void;
  onUnmatchGroupRequisition?: (payload: Record<string, unknown>, summary: string) => void;
  onDeleteGroup?: (payload: Record<string, unknown>, summary: string) => void;
  groupIds?: readonly string[];
  docIds?: readonly string[];
  siteFilter?: string;
  ownerFilter?: string;
  embedded?: boolean;
  client?: SupabaseClient | null;
  accessScope?: string;
  priorityOnly?: boolean;
  refreshKey?: number;
};

type Surface = "board" | "history";

export function SourcingView({
  language, data, profile, canWrite, canManageSetup, onCreateGroup, onLinkGroup, weekStart, onWeekChange, onSaveSourcing, onUpdateGroupInfo, onSetGroupChannel,
  onUnmatchGroupRequisition, onDeleteGroup, onAddGroupRequisition, groupIds, docIds, siteFilter = "", ownerFilter = "", embedded = false, client = null, accessScope = "", priorityOnly = false, refreshKey = 0
}: SourcingViewProps) {
  const [surface, setSurface] = useState<Surface>("board");
  const [recordRow, setRecordRow] = useState<SourcingLifecycleRow | null>(null);
  const [detailGroup, setDetailGroup] = useState<EnrichedSourcingGroup | null>(null);
  const [embeddedDirty, setEmbeddedDirty] = useState(false);
  const [sourcingSummary, setSourcingSummary] = useState<SourcingSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);
  const [summaryRetry, setSummaryRetry] = useState(0);
  const allGroups = useMemo(() => buildGroups(data, weekStart), [data, weekStart]);
  const scoped = useMemo(() => allGroups.filter((group) => inScope(group, groupIds, docIds, siteFilter, ownerFilter, profile)), [allGroups, groupIds, docIds, ownerFilter, profile, siteFilter]);
  const openGroups = scoped.filter((group) => group.open_headcount > 0);
  const boardRows = useMemo(() => openGroups.map((group) => lifecycleRow(group, weekStart, data)).filter((row): row is SourcingLifecycleRow => Boolean(row)).sort(compareBoardRows), [data, openGroups, weekStart]);
  const remoteBoard = useRecruitmentList<SourcingLifecycleRow>({ client: client ?? null, accessScope, entity: "sourcing", filters: { surface: "board", weekStart, headerSite: siteFilter, headerPic: ownerFilter, priorityOnly }, sort: "status", direction: "asc", initialPageSize: 50, enabled: Boolean(!embedded && client && accessScope) });
  const summaryGroupId = groupIds?.length === 1 ? groupIds[0] : null;
  const summaryIdentity = JSON.stringify([accessScope, weekStart, summaryGroupId, siteFilter, ownerFilter, priorityOnly]);
  const [loadedSummaryIdentity, setLoadedSummaryIdentity] = useState("");
  useEffect(() => {
    let active = true;
    setSummaryError(false);
    if (!client || !accessScope) { setSummaryLoading(false); return () => { active = false; }; }
    setSummaryLoading(true);
    void loadSourcingSummary(client, { selectedWeek: weekStart, groupId: summaryGroupId, scope: { headerSite: siteFilter, headerPic: ownerFilter, priorityOnly }, profileKey: accessScope, refreshKey })
      .then((summary) => { if (active) { setSourcingSummary(summary); setLoadedSummaryIdentity(summaryIdentity); } })
      .catch(() => { if (active) setSummaryError(true); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [summaryIdentity, client, accessScope, weekStart, summaryGroupId, siteFilter, ownerFilter, priorityOnly, summaryRetry, refreshKey]);
  const boardRowsToShow = !embedded && client && accessScope ? remoteBoard.items : boardRows;
  const historyRows = useMemo(() => scoped.flatMap((group) => lifecycleRows(group, data)).sort((a, b) => b.week_start.localeCompare(a.week_start) || a.group.group_id.localeCompare(b.group.group_id)), [data, scoped]);
  const selectedEmbeddedRow = historyRows.find((row) => row.week_start === weekStart) ?? null;
  const previousRow = historyRows.find((row) => row.group.group_id === selectedEmbeddedRow?.group.group_id && row.week_start === previousWeekStart(weekStart));
  const previousUpdate = previousRow?.update ?? null;
  const previousApplicants = previousRow?.status === "saved" ? sourcingApplicants(previousUpdate) : null;
  useEffect(() => { setEmbeddedDirty(false); }, [selectedEmbeddedRow?.update?.updated_at]);
  function changeEmbeddedWeek(value: string) {
    const next = sourcingCycleSaturday(value);
    if (next === weekStart) return;
    if (embeddedDirty && !window.confirm(translate(language, "workspaceDiscardSourcingDraft"))) return;
    setEmbeddedDirty(false);
    onWeekChange(next);
  }
  const unmatchedGroups = useMemo(() => profile?.role === "system_admin" || profile?.role === "admin_recruiter" ? enrichUnmatchedSourcingGroups(data) : [], [data, profile?.role]);

  if (embedded) return <>
    <SourcingSummaryCharts summary={loadedSummaryIdentity === summaryIdentity ? sourcingSummary : null} language={language} loading={summaryLoading} error={summaryError} onRetry={() => setSummaryRetry((value) => value + 1)} />
    <EmbeddedSourcingPanel language={language} rows={historyRows} selectedWeek={weekStart} selectedRow={selectedEmbeddedRow} previousUpdate={previousUpdate ?? null} previousApplicants={previousApplicants} profile={profile} canWrite={canWrite} onWeekChange={changeEmbeddedWeek} onDirty={() => setEmbeddedDirty(true)} onSave={onSaveSourcing} onOpenGroup={setDetailGroup} />
    <GroupDetailModal language={language} group={detailGroup} data={data} selectedWeek={weekStart} profile={profile} client={client} accessScope={accessScope} scope={{ headerSite: siteFilter, headerPic: ownerFilter, priorityOnly }} refreshKey={refreshKey} onClose={() => setDetailGroup(null)} onUpdateGroupInfo={onUpdateGroupInfo} onSetGroupChannel={onSetGroupChannel} onUnmatchGroupRequisition={onUnmatchGroupRequisition} onDeleteGroup={onDeleteGroup} onAddGroupRequisition={onAddGroupRequisition} />
  </>;

  return <div className="grid gap-4">
    <Panel>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-xs font-medium uppercase tracking-normal text-slate">{translate(language, surface === "board" ? "weeklyWorkBoard" : "lifecycleHistory")}</p>
        <div className="flex min-w-0 flex-wrap items-end gap-2">{canManageSetup ? <Button type="button" size="sm" icon={<Plus size={17} />} onClick={onCreateGroup}>{translate(language, "newGroup")}</Button> : null}<div className="inline-flex rounded-md border border-[#C9D5E6] p-0.5" aria-label={translate(language, "sourcingView")}><button type="button" aria-pressed={surface === "board"} className={`min-h-9 rounded px-3 text-sm font-semibold ${surface === "board" ? "bg-primary text-white" : "text-slate"}`} onClick={() => setSurface("board")}>{translate(language, "workBoard")}</button><button type="button" aria-pressed={surface === "history"} className={`min-h-9 rounded px-3 text-sm font-semibold ${surface === "history" ? "bg-primary text-white" : "text-slate"}`} onClick={() => setSurface("history")}>{translate(language, "lifecycleHistory")}</button></div><DayDateSelector ariaLabel={translate(language, "weekStarting")} language={language} name="sourcing_week" popoverAlign="right" value={weekStart} onChange={(event) => onWeekChange(sourcingCycleSaturday(event.target.value))} required /></div>
      </div>
      <p className="text-sm text-slate">{surface === "board" ? translate(language, "openGroupsNeedRecord", { date: formatDate(weekStart, language) }) : translate(language, "savedExpectedWeeklySlots")}</p>
      <p className="mt-1 text-xs text-slate">{translate(language, "sourcingCycleDescription", { date: formatDate(weekStart, language), period: formatSourcingWeekRange(weekStart, language) })}</p>
    </Panel>
    {surface === "board" && unmatchedGroups.length > 0 ? <Panel className="border-danger/35 bg-danger/5"><h3 className="text-base font-semibold text-danger">{translate(language, "unmatchedSourcingGroups")}</h3><p className="mt-1 text-sm text-danger">{translate(language, "unmatchedSourcingGroupsWarning")}</p><div className="mt-3 grid gap-2">{unmatchedGroups.map((group) => <div key={group.group_id} className="flex flex-col items-stretch gap-3 rounded-lg border border-danger/30 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 flex-1"><strong className="block break-words font-semibold text-navy">{group.group_position}</strong><p className="mt-1 break-all text-xs font-semibold text-slate">{formatRecruitmentId(group.group_id)}</p></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => setDetailGroup(unmatchedDetailGroup(group))}>{translate(language, "details")}</Button><Button type="button" size="sm" onClick={() => onLinkGroup?.(group.group_id)}>{translate(language, "matchRequisition")}</Button></div></div>)}</div></Panel> : null}
     {surface === "board" ? <SourcingWorkBoard language={language} rows={boardRowsToShow} profile={profile} canWrite={canWrite} onOpenRecord={setRecordRow} onOpenGroup={setDetailGroup} remote={Boolean(!embedded && client && accessScope)} page={remoteBoard.page} pageSize={remoteBoard.pageSize} totalCount={remoteBoard.totalCount} countLoading={remoteBoard.countLoading} countError={remoteBoard.countError} loading={remoteBoard.loading} initialLoading={remoteBoard.initialLoading} refreshing={remoteBoard.refreshing} error={remoteBoard.error} canPrevious={remoteBoard.canPrevious} canNext={remoteBoard.canNext} goPrevious={remoteBoard.goPrevious} goNext={remoteBoard.goNext} setPageSize={remoteBoard.setPageSize} retry={remoteBoard.retry} retryCount={remoteBoard.retryCount} /> : <HistoryTableControls rows={historyRows} profile={profile} canWrite={canWrite} language={language} onOpenRecord={setRecordRow} onOpenGroup={setDetailGroup} client={!embedded ? client : null} accessScope={accessScope} siteFilter={siteFilter} ownerFilter={ownerFilter} />}
    <WeeklyRecordModal language={language} row={recordRow} profile={profile} onClose={() => setRecordRow(null)} onSave={onSaveSourcing} />
    <GroupDetailModal language={language} group={detailGroup} data={data} selectedWeek={weekStart} profile={profile} client={client} accessScope={accessScope} scope={{ headerSite: siteFilter, headerPic: ownerFilter, priorityOnly }} refreshKey={refreshKey} onClose={() => setDetailGroup(null)} onUpdateGroupInfo={onUpdateGroupInfo} onSetGroupChannel={onSetGroupChannel} onUnmatchGroupRequisition={onUnmatchGroupRequisition} onDeleteGroup={onDeleteGroup} onAddGroupRequisition={onAddGroupRequisition} />
  </div>;
}

export function EmbeddedSourcingEditor({ groupIds, ...props }: SourcingViewProps & { groupIds: readonly string[] }) {
  return <SourcingView {...props} groupIds={groupIds} embedded />;
}

function SourcingWorkBoard({ language, rows, profile, canWrite, onOpenRecord, onOpenGroup, remote = false, page = 1, pageSize = 50, totalCount = rows.length, countLoading = false, countError = false, loading = false, initialLoading = loading && rows.length === 0, refreshing = false, error = false, canPrevious = false, canNext = false, goPrevious = () => {}, goNext = () => {}, setPageSize = () => {}, retry = () => {}, retryCount = () => {} }: { language: Language; rows: SourcingLifecycleRow[]; profile: Profile | null; canWrite: boolean; onOpenRecord: (row: SourcingLifecycleRow) => void; onOpenGroup: (group: EnrichedSourcingGroup) => void; remote?: boolean; page?: number; pageSize?: number; totalCount?: number | null; countLoading?: boolean; countError?: boolean; loading?: boolean; initialLoading?: boolean; refreshing?: boolean; error?: boolean; canPrevious?: boolean; canNext?: boolean; goPrevious?: () => void; goNext?: () => void; setPageSize?: (size: 25|50|100) => void; retry?: () => void; retryCount?: () => void }) {
  const countLabel = totalCount === null ? countError ? "—" : countLoading ? "…" : "—" : String(totalCount);
  return <Panel>{refreshing ? <RefreshIndicator language={language} /> : null}<SectionTitle title={translate(language, "weeklyWork")} eyebrow={translate(language, "openRequisitionGroups")} />{remote ? <div className="mb-3 flex items-center justify-between gap-2 text-sm"><span role="status">{language === "th" ? `หน้า ${page} · ${countLabel} กลุ่ม` : `Page ${page} · ${countLabel} groups`}</span>{countError ? <RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Sourcing`} type="button"  onClick={retryCount}>{translate(language,"retry")}</RetryIconButton> : null}</div> : null}{error ? <div role="alert" className="mb-3 text-sm text-danger">{language === "th" ? "โหลดกลุ่มจัดหาล้มเหลว" : "Could not load sourcing groups."} <RetryIconButton type="button"  onClick={retry}>{translate(language,"retry")}</RetryIconButton></div> : null}{initialLoading ? <LoadingSkeleton variant="table" label={<>{translate(language,"loading")}</>} className="py-4 text-sm text-slate" /> : null}<div className="grid gap-3">
    {rows.map((row) => {
      const editable = canWrite && canManage(row.group, profile);
      const count = sourcingApplicants(row.update);
      return <article key={row.group.group_id} className="grid gap-3 rounded-xl border border-[#D7DEE8] bg-white p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenGroup(row.group)}>{row.group.group_position}</button>
            <Tag tone={row.status === "needs_recording" ? "warning" : "success"}>{translate(language, row.status === "needs_recording" ? "needsRecording" : "recorded")}</Tag>
            <span className="text-xs text-cool tabular-nums">{translate(language, "openVacancies", { count: row.group.open_headcount })}</span>
          </div>
          <p className="mt-1 text-xs font-semibold text-primary">{formatRecruitmentId(row.group.group_id)}</p>
          <p className="mt-1 text-xs text-slate">{row.group.sites.join(", ") || "-"} / {row.group.owners.join(", ") || translate(language, "unassigned")} / {enabledLabels(row).join(", ") || translate(language, "noChannels")}</p>
          {count == null && row.update ? <p className="mt-2 text-xs font-medium text-orange">{translate(language, "incompleteChannelRecord")}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" icon={<Settings2 size={16} />} onClick={() => onOpenGroup(row.group)} aria-label={translate(language, "openGroupDetails", { groupId: formatRecruitmentId(row.group.group_id) })}>{translate(language, "details")}</Button>
          {editable ? <Button type="button" size="sm" icon={row.update ? <Pencil size={16} /> : <CalendarPlus size={16} />} onClick={() => onOpenRecord(row)}>{translate(language, row.status === "needs_recording" ? "recordApplicants" : "editRecord")}</Button> : null}
        </div>
      </article>;
    })}
    {rows.length === 0 && !initialLoading && !error ? <EmptyState variant="quiet" message={translate(language, "noOpenSourcingAttention")} /> : null}
  {remote ? <CursorPagination language={language} page={page} pageSize={pageSize} loading={loading} canPrevious={canPrevious} canNext={canNext} onPrevious={goPrevious} onNext={goNext} onPageSizeChange={(size)=>setPageSize(size as 25|50|100)} /> : null}</div></Panel>;
}

function WorkBoard({ rows, profile, canWrite, onOpenRecord, onOpenGroup }: { rows: SourcingLifecycleRow[]; profile: Profile | null; canWrite: boolean; onOpenRecord: (row: SourcingLifecycleRow) => void; onOpenGroup: (group: EnrichedSourcingGroup) => void }) {
  return <Panel><SectionTitle title="Weekly work" eyebrow="Open requisition groups" /><div className="grid gap-3">
    {rows.map((row) => { const editable = canWrite && canManage(row.group, profile); const count = sourcingApplicants(row.update); return <article key={row.group.group_id} className="grid gap-3 rounded-xl border border-[#D7DEE8] bg-white p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenGroup(row.group)}>{formatRecruitmentId(row.group.group_id)}</button><Tag tone={row.status === "needs_recording" ? "warning" : "success"}>{row.status === "needs_recording" ? "Needs recording" : "Recorded"}</Tag><span className="text-xs text-cool tabular-nums">{row.group.open_headcount} open</span></div><p className="mt-1 font-medium text-navy">{row.group.group_position}</p><p className="mt-1 text-xs text-slate">{row.group.sites.join(", ") || "-"} · {row.group.owners.join(", ") || "Unassigned"} · {enabledLabels(row).join(", ") || "No channels"}</p>{count == null && row.update ? <p className="mt-2 text-xs font-medium text-orange">One or more channels are not recorded.</p> : null}</div><div className="flex gap-2"><Button type="button" size="sm" variant="secondary" icon={<Settings2 size={16} />} onClick={() => onOpenGroup(row.group)} aria-label={`Open ${formatRecruitmentId(row.group.group_id)} details`}>Details</Button>{editable ? <Button type="button" size="sm" icon={row.update ? <Pencil size={16} /> : <CalendarPlus size={16} />} onClick={() => onOpenRecord(row)}>{row.status === "needs_recording" ? "Record applicants" : "Edit record"}</Button> : null}</div></article>; })}
    {rows.length === 0 ? <EmptyState variant="quiet" message="No open sourcing groups need attention for this week." /> : null}
  </div></Panel>;
}

type HistorySort = "group" | "position" | "week" | "status" | "applicants" | "saved";
function HistoryTableControls({ rows, profile, canWrite, language, onOpenRecord, onOpenGroup, client, accessScope, siteFilter, ownerFilter }: { rows: SourcingLifecycleRow[]; profile: Profile | null; canWrite: boolean; language: Language; onOpenRecord: (row: SourcingLifecycleRow) => void; onOpenGroup: (group: EnrichedSourcingGroup) => void; client?: SupabaseClient | null; accessScope: string; siteFilter: string; ownerFilter: string }) {
  const [advanced, setAdvanced] = useState(false);
  const columns: TableColumn<SourcingLifecycleRow>[] = [
    { key: "group", label: translate(language, "groupId"), value: (row) => row.group.group_id },
    { key: "position", label: translate(language, "groupName"), value: (row) => row.group.group_position },
    { key: "week", label: translate(language, "week"), value: (row) => row.week_start },
    { key: "status", label: translate(language, "status"), value: (row) => translate(language, row.status === "saved" ? "recorded" : "needsRecording"), filterMode: "category" },
    { key: "applicants", label: translate(language, "applicants"), value: (row) => translate(language, sourcingApplicants(row.update) == null ? "unknown" : sourcingApplicants(row.update) === 0 ? "zero" : "hasApplicants"), filterMode: "category", sortValue: (row) => sourcingApplicants(row.update) ?? -1 },
    { key: "saved", label: translate(language, "lastSaved"), value: (row) => row.update?.updated_at ?? "", sortValue: (row) => row.update?.updated_at ?? "" }
  ];
  const table = useTableControls(rows, columns, { sortKey: "week", sortDirection: "desc" });
  const remote = useRecruitmentList<SourcingLifecycleRow>({ client: client ?? null, accessScope, entity: "sourcing", filters: { group: table.filters.group ?? "", position: table.filters.position ?? "", week: table.filters.week ?? "", status: table.filters.status ?? "", applicants: table.filters.applicants ?? "", headerSite: siteFilter, headerPic: ownerFilter }, sort: table.sortKey ?? "week", direction: table.sortDirection ?? "desc", initialPageSize: 50, enabled: Boolean(client && accessScope), searchInput: { value: table.search, setValue: table.setSearch } });
  const viewRows = client && accessScope ? remote.items : table.controlledRows;
  return <Panel><SectionTitle title={translate(language, "lifecycleHistory")} eyebrow={translate(language, "savedExpectedWeeklySlots")} /><TableToolbar advancedFiltersOpen={advanced} language={language} onAdvancedFiltersToggle={() => setAdvanced((value) => !value)} onSearch={table.setSearch} resultCount={client && accessScope ? remote.totalCount : table.controlledRows.length} searchValue={table.search} totalCount={client && accessScope ? remote.totalCount : rows.length} />{client && accessScope ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm"><span role="status">Page {remote.page} · {remote.totalCount} records</span><div className="flex gap-2"><Button type="button" variant="secondary" disabled={!remote.canPrevious || remote.loading} onClick={remote.goPrevious}>Previous</Button><Button type="button" variant="secondary" disabled={!remote.canNext || remote.loading} onClick={remote.goNext}>Next</Button><select aria-label="Rows per page" value={remote.pageSize} onChange={event=>remote.setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></div></div> : null}{remote.refreshing ? <RefreshIndicator language={language} /> : null}{remote.error ? <div role="alert" className="mb-3 text-sm text-danger">{language === "th" ? "โหลดประวัติการจัดหาล้มเหลว" : "Could not load sourcing history."} <RetryIconButton type="button"  onClick={remote.retry} loading={remote.loading}>Retry</RetryIconButton></div> : null}<div className="table-scroll overflow-x-auto"><table className="w-full min-w-[940px] text-left text-sm"><thead className="bg-[#F1F6FC] text-xs font-semibold uppercase tracking-wide text-slate"><tr>{columns.map((column) => <th key={column.key} className="px-3 py-3"><SortableFilterHeader columnKey={column.key} filterValue={table.filters[column.key] ?? ""} language={language} label={column.label} onFilter={table.setFilter} onSort={table.toggleSort} filterOptions={table.categoryFilterOptions(column.key)} sortDirection={table.sortDirection} sortKey={table.sortKey} showFilter={advanced} /></th>)}<th className="px-3 py-3"><span className="sr-only">{translate(language, "actions")}</span></th></tr></thead><tbody aria-busy={remote.loading}>{client && accessScope && remote.initialLoading ? <tr><td colSpan={columns.length + 1}><LoadingSkeleton variant="table" language={language} /></td></tr> : null}{viewRows.map((row) => { const editable = canWrite && canManage(row.group, profile) && (Boolean(row.update) || row.group.open_headcount > 0); const applicants = sourcingApplicants(row.update); return <tr key={`${row.group.group_id}-${row.week_start}`} className="border-b border-[#E4E9F2]"><td className="px-3 py-3"><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenGroup(row.group)}>{formatRecruitmentId(row.group.group_id)}</button></td><td className="px-3 py-3">{row.group.group_position}</td><td className="px-3 py-3">{row.week_start}</td><td className="px-3 py-3"><Tag tone={row.status === "saved" ? "success" : "warning"}>{translate(language, row.status === "saved" ? "recorded" : "needsRecording")}</Tag></td><td className="px-3 py-3">{applicants == null ? translate(language, "notRecorded") : applicants}</td><td className="px-3 py-3">{row.update?.updated_at ?? "—"}</td><td className="px-3 py-3 text-right">{editable ? <Button type="button" size="icon-sm" variant="secondary" icon={row.update ? <Pencil size={15} /> : <CalendarPlus size={15} />} aria-label={translate(language, row.update ? "editRecordForGroup" : "addRecordForGroup", { groupId: row.group.group_id, week: row.week_start })} onClick={() => onOpenRecord(row)} /> : null}</td></tr>; })}</tbody></table></div>{viewRows.length === 0 && !(client && accessScope && (remote.initialLoading || remote.error)) ? <EmptyState variant="quiet" message={translate(language, "noLifecycleRecordsMatch")} /> : null}</Panel>;
}
function HistoryRefined({ rows, profile, canWrite, onOpenRecord, onOpenGroup }: { rows: SourcingLifecycleRow[]; profile: Profile | null; canWrite: boolean; onOpenRecord: (row: SourcingLifecycleRow) => void; onOpenGroup: (group: EnrichedSourcingGroup) => void }) {
  const [filtersOpen, setFiltersOpen] = useState(false); const [filters, setFilters] = useState({ search: "", from: "", to: "", status: "all", applicants: "all" }); const [sort, setSort] = useState<{ key: HistorySort; direction: "asc" | "desc" }>({ key: "week", direction: "desc" });
  const filtered = useMemo(() => rows.filter((row) => { const applicants = sourcingApplicants(row.update); const text = `${row.group.group_id} ${row.group.group_position}`.toLowerCase(); return (!filters.search || text.includes(filters.search.toLowerCase())) && (!filters.from || row.week_start >= filters.from) && (!filters.to || row.week_start <= filters.to) && (filters.status === "all" || row.status === filters.status) && (filters.applicants === "all" || (filters.applicants === "unknown" ? applicants == null : filters.applicants === "zero" ? applicants === 0 : (applicants ?? 0) > 0)); }), [filters, rows]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => { const value = (row: SourcingLifecycleRow): string | number => { const applicants = sourcingApplicants(row.update); if (sort.key === "group") return row.group.group_id; if (sort.key === "position") return row.group.group_position; if (sort.key === "week") return row.week_start; if (sort.key === "status") return row.status; if (sort.key === "applicants") return applicants ?? -1; return row.update?.updated_at ?? ""; }; const left = value(a); const right = value(b); const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true }); return sort.direction === "asc" ? result : -result; }), [filtered, sort]);
  const header = (key: HistorySort, label: string) => <th className="px-3 py-3"><button type="button" className="flex w-full items-center justify-between gap-2 text-left" aria-label={`Sort ${label}`} onClick={() => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" })}><span>{label}</span>{sort.key === key ? sort.direction === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} /> : <ArrowDownUp size={14} />}</button></th>;
  return <Panel><SectionTitle title="Lifecycle history" eyebrow="Saved and expected weekly slots" action={<Button type="button" size="sm" variant="secondary" icon={<SlidersHorizontal size={16} />} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>Advanced filters</Button>} />{filtersOpen ? <div className="mb-4 grid gap-3 rounded-xl border border-[#D7E2F1] bg-[#F8FAFD] p-3 md:grid-cols-2 xl:grid-cols-5"><Field label="Group or position"><TextInput value={filters.search} onChange={(event) => setFilters((value) => ({ ...value, search: event.target.value }))} /></Field><Field label="From Saturday"><TextInput type="date" value={filters.from} onChange={(event) => setFilters((value) => ({ ...value, from: sourcingCycleSaturday(event.target.value) }))} /></Field><Field label="To Saturday"><TextInput type="date" value={filters.to} onChange={(event) => setFilters((value) => ({ ...value, to: sourcingCycleSaturday(event.target.value) }))} /></Field><Field label="Status"><SelectInput value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))}><option value="all">All</option><option value="saved">Recorded</option><option value="needs_recording">Needs recording</option></SelectInput></Field><Field label="Applicants"><SelectInput value={filters.applicants} onChange={(event) => setFilters((value) => ({ ...value, applicants: event.target.value }))}><option value="all">All</option><option value="has">Has applicants</option><option value="zero">Zero applicants</option><option value="unknown">Unknown</option></SelectInput></Field><div className="xl:col-span-5"><Button type="button" size="sm" variant="secondary" onClick={() => setFilters({ search: "", from: "", to: "", status: "all", applicants: "all" })}>Clear filters</Button></div></div> : null}<p className="mb-3 text-sm text-slate" role="status">{sorted.length} lifecycle record{sorted.length === 1 ? "" : "s"}</p><div className="table-scroll overflow-x-auto"><table className="w-full min-w-[940px] text-left text-sm"><thead className="bg-[#F1F6FC] text-xs font-semibold uppercase tracking-wide text-slate"><tr>{header("group", "Group")}{header("position", "Position")}{header("week", "Week")}{header("status", "Status")}{header("applicants", "Applicants")}{header("saved", "Last saved")}<th className="px-3 py-3"><span className="sr-only">Actions</span></th></tr></thead><tbody>{sorted.map((row) => { const editable = canWrite && canManage(row.group, profile) && (Boolean(row.update) || row.group.open_headcount > 0); const applicants = sourcingApplicants(row.update); return <tr key={`${row.group.group_id}-${row.week_start}`} className="border-b border-[#E4E9F2]"><td className="px-3 py-3"><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenGroup(row.group)}>{formatRecruitmentId(row.group.group_id)}</button></td><td className="max-w-[18rem] truncate px-3 py-3">{row.group.group_position}</td><td className="px-3 py-3 tabular-nums">{row.week_start}</td><td className="px-3 py-3"><Tag tone={row.status === "needs_recording" ? "warning" : "success"}>{row.status === "needs_recording" ? "Needs recording" : "Recorded"}</Tag></td><td className="px-3 py-3 tabular-nums">{applicants == null ? "Not recorded" : applicants}</td><td className="px-3 py-3">{row.update?.updated_at ?? "—"}</td><td className="px-3 py-3 text-right">{editable ? <Button type="button" size="icon-sm" variant="secondary" icon={row.update ? <Pencil size={15} /> : <CalendarPlus size={15} />} aria-label={`${row.update ? "Edit" : "Add"} ${formatRecruitmentId(row.group.group_id)} ${row.week_start}`} onClick={() => onOpenRecord(row)} /> : null}</td></tr>; })}</tbody></table></div>{sorted.length === 0 ? <EmptyState variant="quiet" message="No lifecycle records match these filters." /> : null}</Panel>;
}

function History({ rows, profile, canWrite, onOpenRecord, onOpenGroup }: { rows: SourcingLifecycleRow[]; profile: Profile | null; canWrite: boolean; onOpenRecord: (row: SourcingLifecycleRow) => void; onOpenGroup: (group: EnrichedSourcingGroup) => void }) {
  return <Panel><SectionTitle title="Lifecycle history" eyebrow="Saved and expected weekly slots" /><div className="table-scroll overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="bg-[#F1F6FC] text-xs font-semibold uppercase tracking-wide text-slate"><tr><th className="px-3 py-3">Group</th><th className="px-3 py-3">Week</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Applicants</th><th className="px-3 py-3">Last saved</th><th className="px-3 py-3"><span className="sr-only">Actions</span></th></tr></thead><tbody>{rows.map((row) => { const editable = canWrite && canManage(row.group, profile) && (Boolean(row.update) || row.group.open_headcount > 0); const applicants = sourcingApplicants(row.update); return <tr key={`${row.group.group_id}-${row.week_start}`} className="border-b border-[#E4E9F2]"><td className="px-3 py-3"><button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenGroup(row.group)}>{formatRecruitmentId(row.group.group_id)}</button><p className="max-w-xs truncate text-xs text-slate">{row.group.group_position}</p></td><td className="px-3 py-3 tabular-nums">{row.week_start}</td><td className="px-3 py-3"><Tag tone={row.status === "needs_recording" ? "warning" : "success"}>{row.status === "needs_recording" ? "Needs recording" : "Recorded"}</Tag></td><td className="px-3 py-3 tabular-nums">{applicants == null ? "Not recorded" : applicants}</td><td className="px-3 py-3">{row.update?.updated_at ? formatDate(row.update.updated_at, "en") : "—"}</td><td className="px-3 py-3 text-right">{editable ? <Button type="button" size="icon-sm" variant="secondary" icon={row.update ? <Pencil size={15} /> : <CalendarPlus size={15} />} aria-label={`${row.update ? "Edit" : "Add"} ${formatRecruitmentId(row.group.group_id)} ${row.week_start}`} onClick={() => onOpenRecord(row)} /> : null}</td></tr>; })}</tbody></table></div>{rows.length === 0 ? <EmptyState variant="quiet" message="No lifecycle records match this sourcing scope." /> : null}</Panel>;
}

function WeeklyRecordModal({ language, row: input, profile, onClose, onSave }: { language: Language; row: SourcingLifecycleRow | null; profile: Profile | null; onClose: () => void; onSave: (payload: Record<string, unknown>, summary: string) => void }) {
  const row = input as SourcingLifecycleRow;
  if (!row) return null;
  const channels = enabledChannels(row);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const invalid = channels.some((channel) => { const raw = String(form.get(channel.count) ?? "").trim(); return raw && (!Number.isInteger(Number(raw)) || Number(raw) < 0); }); if (invalid) { window.alert(translate(language, "applicantCountsWholeNumbers")); return; } const payload: Record<string, unknown> = { group_id: row.group.group_id, week_start: row.week_start, ...Object.fromEntries(SOURCING_CHANNELS.map((channel) => [channel.enabled, Boolean(channelForRow(row, channel.enabled))])), ...Object.fromEntries(SOURCING_CHANNELS.map((channel) => [channel.count, channelForRow(row, channel.enabled) ? String(form.get(channel.count) ?? "").trim() : null])) }; if (row.update) payload.expected_updated_at = row.update.updated_at; onSave(payload, `${row.update ? "correct" : "create"} sourcing update - ${row.group.group_id} ${row.week_start}`); }
  return <Modal open title={translate(language, "recordApplicantsForGroup", { action: translate(language, row.update ? "editRecord" : "recordApplicants"), groupId: row.group.group_id })} onClose={onClose} width="max-w-2xl"><form className="grid gap-4" onSubmit={submit}><p className="text-sm text-slate">{translate(language, "weekOfRecordHelp", { period: formatSourcingWeekRange(row.week_start, language) })}</p><div className="grid gap-3 sm:grid-cols-2">{channels.map((channel) => <div key={channel.enabled}><Field label={channel.label}><TextInput name={channel.count} type="number" min="0" step="1" inputMode="numeric" defaultValue={row.update?.[channel.count] ?? ""} placeholder={translate(language, "notRecorded")} /></Field><p className="mt-1 text-xs text-cool">{translate(language, "blankNotRecorded")}</p></div>)}</div><div className="flex justify-end gap-2 border-t border-[#E4E9F2] pt-4"><Button type="button" variant="secondary" onClick={onClose}>{translate(language, "cancel")}</Button><Button type="submit">{translate(language, "saveRecord")}</Button></div></form></Modal>;
}

function GroupDetailModal({ language, group: input, data, selectedWeek, profile, client, accessScope, scope, refreshKey, onClose, onUpdateGroupInfo, onSetGroupChannel, onUnmatchGroupRequisition, onDeleteGroup, onAddGroupRequisition }: { language: Language; group: EnrichedSourcingGroup | null; data: DashboardData; selectedWeek: string; profile: Profile | null; client: SupabaseClient | null; accessScope: string; scope: { headerSite: string; headerPic: string; priorityOnly: boolean }; refreshKey: number; onClose: () => void; onUpdateGroupInfo?: (payload: Record<string, unknown>, summary: string) => void; onSetGroupChannel?: (payload: Record<string, unknown>, summary: string) => void; onUnmatchGroupRequisition?: (payload: Record<string, unknown>, summary: string) => void; onDeleteGroup?: (payload: Record<string, unknown>, summary: string) => void; onAddGroupRequisition?: (groupId: string, docId: string) => void }) {
  const [effectiveWeek, setEffectiveWeek] = useState(selectedWeek);
  const [selectedRequisition, setSelectedRequisition] = useState<import("@/types/recruitment").EnrichedRequisition | null>(null);
  const [detail, setDetail] = useState<ScopedGroupWorkspaceResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  useEffect(() => { setEffectiveWeek(selectedWeek); setSelectedRequisition(null); setDetail(null); }, [input?.group_id, selectedWeek, client, accessScope, scope.headerSite, scope.headerPic, scope.priorityOnly, refreshKey]);
  useEffect(() => {
    if (!input || !client || !profile?.id || !accessScope) { setDetailLoading(false); setDetail(null); return; }
    let active = true;
    setDetail(null); setDetailLoading(true);
    void loadScopedGroupWorkspace(client, { groupId: input.group_id, selectedWeek, scope, accessScope: { profileId: profile.id, key: accessScope } })
      .then(result => { if (active) setDetail(result); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [input?.group_id, selectedWeek, client, profile?.id, accessScope, scope.headerSite, scope.headerPic, scope.priorityOnly, refreshKey, detailRetry]);
  const hydrated = detail?.status === "ready" ? detail : null;
  const detailData = useMemo(() => hydrated ? { ...data, position_groups: [hydrated.group], document_groups: hydrated.documentGroups, requisitions: hydrated.requisitions, offers: hydrated.offers, sourcing_weekly_updates: hydrated.sourcingUpdates } : data, [data, hydrated]);
  const derived = hydrated ? enrichSourcingGroups(detailData, selectedWeek).find(row => row.group_id === hydrated.group.group_id) : undefined;
  const group = hydrated ? { ...(derived ?? makeHydratedGroup(hydrated, detailData, selectedWeek)), candidate_count: hydrated.metrics.candidateCount, open_headcount: hydrated.metrics.openHeadcount } : input;
  const positionGroup = hydrated?.group;
  const effectiveUpdate = hydrated?.sourcingUpdates.find(row => row.group_id === hydrated.group.group_id && row.week_start === effectiveWeek)
    ?? hydrated?.sourcingUpdates.find(row => row.group_id === hydrated.group.group_id && row.week_start === sourcingDatabaseWeekStart(effectiveWeek));
  const editable = Boolean(group && positionGroup && group.open_headcount > 0 && canManage(group, profile));
  const matches = hydrated?.documentGroups ?? [];
  const canUnmatch = Boolean(group && onUnmatchGroupRequisition && canManage(group, profile));
  const canAddRequisition = Boolean(group && onAddGroupRequisition && canManage(group, profile));
  const isSystemAdmin = profile?.role === "system_admin";
  if (!input) return null;
  function rename(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!positionGroup || !group || !onUpdateGroupInfo) return; const name = String(new FormData(event.currentTarget).get("group_position") ?? "").trim(); if (name) onUpdateGroupInfo({ group_id: group.group_id, group_position: name, expected_updated_at: positionGroup.updated_at }, `rename sourcing group - ${formatRecruitmentId(group.group_id)}`); }
  if (detailLoading || !hydrated || !group) return <Modal open title={translate(language, "groupDetails", { groupId: formatRecruitmentId(input.group_id) })} onClose={onClose} width="max-w-3xl"><div className="grid gap-3 py-4">{detailLoading ? <LoadingSkeleton variant="table" label={<>{translate(language, "loading")}</>} className="text-sm text-slate" /> : <div role="alert" className="text-sm text-danger">{translate(language, "recordUnavailableOrLoadFailed")} <RetryIconButton type="button"  onClick={() => setDetailRetry(value => value + 1)}>{translate(language, "retry")}</RetryIconButton></div>}</div></Modal>;
  return <Modal open title={translate(language, "groupDetails", { groupId: formatRecruitmentId(group.group_id) })} onClose={onClose} width="max-w-3xl">
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><dt className="text-cool">{translate(language, "lifecycleStarts")}</dt><dd className="mt-1 font-semibold text-navy">{lifecycleBounds(group, detailData).start}</dd></div><div><dt className="text-cool">{translate(language, "lifecycleEnds")}</dt><dd className="mt-1 font-semibold text-navy">{lifecycleBounds(group, detailData).end}</dd></div><div><dt className="text-cool">{translate(language, "openHeadcount")}</dt><dd className="mt-1 font-semibold text-navy">{group.open_headcount}</dd></div><div><dt className="text-cool">{translate(language, "owners")}</dt><dd className="mt-1 font-semibold text-navy">{group.owners.join(", ") || "—"}</dd></div></dl>
      <section className="border-t border-[#E4E9F2] pt-4"><h4 className="font-semibold text-navy">{translate(language, "groupInformation")}</h4>{editable && positionGroup ? <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={rename}><TextInput name="group_position" defaultValue={positionGroup.group_position} aria-label={translate(language, "groupDisplayName")} /><Button type="submit">{translate(language, "save")}</Button></form> : <p className="mt-2 text-sm text-slate">{group.group_position}</p>}</section>
      <section className="border-t border-[#E4E9F2] pt-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h4 className="font-semibold text-navy">{translate(language, "channels")}</h4><p className="mt-1 text-sm text-slate">{translate(language, "channelEffectiveHelp")}</p></div>{editable ? <Field label={translate(language, "effectiveWeek")}><TextInput type="date" value={effectiveWeek} onChange={event => setEffectiveWeek(sourcingCycleSaturday(event.target.value))} /></Field> : null}</div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{SOURCING_CHANNELS.map(channel => { const enabled = Boolean(effectiveUpdate?.[channel.enabled] ?? positionGroup?.[channel.enabled]); const toggleLabel = translate(language, "toggleSourcingChannel", { channel: channel.label }); return <div key={channel.enabled} className="flex items-center justify-between rounded-lg border border-[#D7DEE8] px-3 py-2"><span className="text-sm font-medium text-navy">{channel.label}</span>{editable && positionGroup && onSetGroupChannel ? <button type="button" role="switch" aria-checked={enabled} aria-label={toggleLabel} title={`${toggleLabel}: ${translate(language, enabled ? "enabled" : "disabled")}`} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 ${enabled ? "bg-primary" : "bg-[#C9D5E6]"}`} onClick={() => onSetGroupChannel({ group_id: group.group_id, channel: channelKey(channel.enabled), enabled: !enabled, effective_week: effectiveWeek, expected_updated_at: positionGroup.updated_at }, `${enabled ? "disable" : "enable"} ${channel.label} - ${group.group_id} from ${effectiveWeek}`)}><span aria-hidden="true" className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} /></button> : <span className="text-sm font-medium text-slate">{translate(language, enabled ? "enabled" : "disabled")}</span>}</div>; })}</div>
      </section>
      {matches.length ? <section className="border-t border-[#E4E9F2] pt-4"><h4 className="font-semibold text-navy">{translate(language, "matchedRequisitions")}</h4><p className="mt-1 text-sm text-slate">{translate(language, "unmatchBlockedHelp")}</p><div className="mt-3 grid gap-2">{matches.map(match => { const requisition = detailData.requisitions.find(row => row.doc_id === match.doc_id); const hasCandidates = hydrated.metrics.candidateCount > 0; const unmatchLabel = translate(language, "unmatchRequisition", { id: match.doc_id }); return <div key={match.doc_group_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#D7DEE8] p-3"><div><p className="font-semibold text-navy">{requisition?.position ?? match.group_position}</p><p className="mt-1 text-xs text-slate">{match.doc_id}{requisition?.site ? ` · ${requisition.site}` : ""}{hasCandidates ? ` · ${translate(language, "candidatesLinked")}` : ""}</p></div>{canUnmatch ? <Button type="button" size="icon-sm" variant="danger" icon={<Unlink size={16} />} aria-label={unmatchLabel} title={unmatchLabel} onClick={() => onUnmatchGroupRequisition?.({ doc_group_id: match.doc_group_id, doc_id: match.doc_id, group_id: group.group_id }, `Unmatch sourcing group ${formatRecruitmentId(group.group_id)} from requisition ${match.doc_id}`)} /> : null}</div>; })}</div></section> : null}
      {canAddRequisition ? <section className="border-t border-[#E4E9F2] pt-4"><div className="rounded-lg border border-[#D7DEE8] bg-[#F8FAFD] p-3"><h5 className="mb-3 font-semibold text-navy">{translate(language, "addRequisitionToGroup")}</h5>
        <AuthorizedRequisitionLookup client={client} accessScope={accessScope} language={language}
          filters={{ status: "ongoing", homeTab: "open_headcount", managedOnly: true, unmatchedOnly: true, linkToGroupId: group.group_id, headerSite: scope.headerSite, headerPic: scope.headerPic, priorityOnly: scope.priorityOnly }}
          value={selectedRequisition?.doc_id ?? ""} selectedRow={selectedRequisition} onSelect={setSelectedRequisition}
          label={translate(language, "selectRequisitionToAdd")} name="doc_id" disabled={!hydrated} />
        <div className="mt-3 flex justify-end"><Button type="button" disabled={!selectedRequisition || !hydrated} onClick={() => { if (!selectedRequisition) return; onAddGroupRequisition?.(group.group_id, selectedRequisition.doc_id); setSelectedRequisition(null); }}>{translate(language, "addMatch")}</Button></div>
      </div></section> : null}
      {isSystemAdmin && onDeleteGroup ? <section className="border-t border-[#E4E9F2] pt-4"><h4 className="font-semibold text-scarlet">{translate(language, "systemAdminActions")}</h4><p className="mt-1 text-sm text-slate">{translate(language, "deleteGroupHelp")}</p><div className="mt-3"><Button type="button" variant="danger" disabled={matches.length > 0} title={matches.length > 0 ? translate(language, "unmatchEveryRequisition") : undefined} onClick={() => onDeleteGroup({ entity: "position_group", id: group.group_id }, `Delete sourcing group ${formatRecruitmentId(group.group_id)}`)}>{translate(language, "deleteGroup")}</Button></div></section> : null}
    </div>
  </Modal>;
}

function buildGroups(data: DashboardData, weekStart: string) {
  const open = new Map(enrichSourcingGroups(data, weekStart).map((group) => [group.group_id, group]));
  const enriched = enrichRequisitions(data);
  const ids = [...new Set(data.document_groups.map((row) => row.group_id).filter((id): id is string => Boolean(id)))];
  return ids.map((groupId) => {
    const existing = open.get(groupId); if (existing) return existing;
    const matches = data.document_groups.filter((row) => row.group_id === groupId); const reqs = matches.map((row) => enriched.find((req) => req.doc_id === row.doc_id)).filter(Boolean); const position = data.position_groups.find((row) => row.group_id === groupId); const candidateCount = data.candidates.filter((candidate) => candidate.group_id === groupId || (!candidate.group_id && matches.some((match) => match.doc_group_id === candidate.doc_group_id))).length;
    return { group_id: groupId, group_position: position?.group_position ?? matches[0]?.group_position ?? groupId, sites: unique(reqs.map((req) => req!.site)), owners: unique(reqs.map((req) => req!.person_in_charge)), doc_ids: unique(reqs.map((req) => req!.doc_id)), open_headcount: 0, candidate_count: candidateCount, ...SOURCING_CHANNELS.reduce((result, channel) => ({ ...result, [channel.enabled]: Boolean(position?.[channel.enabled] ?? matches[0]?.[channel.enabled]) }), {}), latest_update: data.sourcing_weekly_updates.find((update) => update.group_id === groupId && (update.week_start === weekStart || update.week_start === sourcingDatabaseWeekStart(weekStart))) ?? null } as EnrichedSourcingGroup;
  });
}

function unmatchedDetailGroup(group: ReturnType<typeof enrichUnmatchedSourcingGroups>[number]): EnrichedSourcingGroup {
  return { ...group, sites: [], owners: [], doc_ids: [], open_headcount: 0, candidate_count: 0, latest_update: null };
}

function makeHydratedGroup(detail: Extract<ScopedGroupWorkspaceResult, { status: "ready" }>, data: DashboardData, weekStart: string): EnrichedSourcingGroup {
  const reqs = enrichRequisitions(data);
  const links = detail.documentGroups;
  const latestUpdate = detail.sourcingUpdates.find(row => row.week_start === weekStart || row.week_start === sourcingDatabaseWeekStart(weekStart)) ?? null;
  return {
    group_id: detail.group.group_id,
    group_position: detail.group.group_position,
    sites: unique(reqs.filter(row => links.some(link => link.doc_id === row.doc_id)).map(row => row.site)),
    owners: unique(reqs.filter(row => links.some(link => link.doc_id === row.doc_id)).map(row => row.person_in_charge)),
    doc_ids: unique(links.map(link => link.doc_id)),
    open_headcount: detail.metrics.openHeadcount,
    candidate_count: detail.metrics.candidateCount,
    channel_fb: detail.group.channel_fb, channel_jobthai: detail.group.channel_jobthai, channel_jobtopgun: detail.group.channel_jobtopgun,
    channel_jobdb: detail.group.channel_jobdb, channel_jobbkk: detail.group.channel_jobbkk, channel_linkedin: detail.group.channel_linkedin,
    channel_walkin: detail.group.channel_walkin, channel_referral: detail.group.channel_referral, channel_others: detail.group.channel_others,
    latest_update: latestUpdate,
  };
}

function lifecycleRows(group: EnrichedSourcingGroup, data: DashboardData) { const { start, end } = lifecycleBounds(group, data); const rows: SourcingLifecycleRow[] = []; for (let current = start; current <= end; current = addDays(current, 7)) rows.push(lifecycleRow(group, current, data)!); return rows; }
function lifecycleRow(group: EnrichedSourcingGroup, week: string, data: DashboardData): SourcingLifecycleRow | null { const { start, end } = lifecycleBounds(group, data); if (week < start || week > end) return null; const update = data.sourcing_weekly_updates.find((row) => row.group_id === group.group_id && row.week_start === week) ?? data.sourcing_weekly_updates.find((row) => row.group_id === group.group_id && row.week_start === sourcingDatabaseWeekStart(week)) ?? null; const active = enabledChannels({ group, update }).length; const complete = Boolean(update) && active > 0 && enabledChannels({ group, update }).every((channel) => update?.[channel.count] != null); return { group, week_start: week, update, status: complete ? "saved" : "needs_recording" }; }
function lifecycleBounds(group: EnrichedSourcingGroup, data: DashboardData) { const reqs = data.requisitions.filter((req) => group.doc_ids.includes(req.doc_id)); const start = sourcingCycleSaturday(reqs.map((req) => req.pr_approved_date).filter((value): value is string => Boolean(value)).sort()[0] ?? todayBangkok()); const allTerminal = reqs.length > 0 && reqs.every((req) => req.status === "filled" || req.status === "cancel"); const terminal = reqs.filter((req) => req.status === "filled" || req.status === "cancel").map((req) => data.requisition_logs.filter((log) => log.doc_id === req.doc_id && (log.status === "filled" || log.status === "cancel")).map((log) => log.log_date).sort().at(-1) ?? req.updated_at.slice(0, 10)).sort().at(-1); return { start, end: sourcingCycleSaturday(allTerminal ? terminal ?? todayBangkok() : todayBangkok()) }; }
function enabledChannels(row: Pick<SourcingLifecycleRow, "group" | "update">) { return SOURCING_CHANNELS.filter((channel) => channelForRow(row, channel.enabled)); }
function enabledLabels(row: Pick<SourcingLifecycleRow, "group" | "update">) { return enabledChannels(row).map((channel) => channel.label); }
function channelForRow(row: Pick<SourcingLifecycleRow, "group" | "update">, enabled: (typeof SOURCING_CHANNELS)[number]["enabled"]) { return Boolean(row.update?.[enabled] ?? row.group[enabled]); }
function channelKey(enabled: (typeof SOURCING_CHANNELS)[number]["enabled"]) { return enabled.replace("channel_", ""); }
function canManage(group: EnrichedSourcingGroup, profile: Profile | null) { return profile?.role === "system_admin" || profile?.role === "admin_recruiter" || (profile?.role === "site_recruiter" && (group.owners.includes(profile.nickname ?? "") || group.sites.includes(profile.site ?? ""))); }
function inScope(group: EnrichedSourcingGroup, groupIds: readonly string[] | undefined, docIds: readonly string[] | undefined, site: string, owner: string, profile: Profile | null) { if (!sourcingGroupsInScope([group], profile, site, owner).length) return false; if (groupIds?.length && !groupIds.includes(group.group_id)) return false; return !docIds?.length || group.doc_ids.some((id) => docIds.includes(id)); }
function compareBoardRows(a: SourcingLifecycleRow, b: SourcingLifecycleRow) { const aMissing = a.status === "needs_recording" ? 0 : 1; const bMissing = b.status === "needs_recording" ? 0 : 1; return aMissing - bMissing || b.group.open_headcount - a.group.open_headcount || a.group.group_id.localeCompare(b.group.group_id); }
function addDays(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function todayBangkok() { const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "01"; return `${part("year")}-${part("month")}-${part("day")}`; }
function unique(values: Array<string | null | undefined>) { return [...new Set(values.filter((value): value is string => Boolean(value)))]; }
