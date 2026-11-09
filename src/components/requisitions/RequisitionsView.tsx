import {fetchMatchingRecordIds,fetchSelectedRequisitions} from "@/lib/records-selection";
import { downloadCsv } from "@/lib/download-csv";
import { RECORD_PAGE_SIZE, RecordPagination, RecordCreateButton, RecordCell, RecordFilterPanel, useRecordFilterDraft, RecordPriorityIndicator, useRecordCategoryOptions, useRecordSelection, RecordSelectionCheckbox, RecordSelectionProgress } from "@/components/ui/RecordsControls";
import { RetryIconButton } from "@/components/ui/RetryIconButton";
import { NumberSkeleton, TableSkeletonRows, LoadingSkeleton, RefreshIndicator } from "@/components/ui/LoadingSkeleton";
import { Plus, RotateCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { SortableFilterHeader, TableFilterField, TableToolbar, TruncatedTableText, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { RecordQuickActions, type RecordQuickAction } from "@/components/ui/Operations";
import { BulkActionToolbar } from "@/components/ui/Workflow";
import { formatDate, formatRequisitionCardTitle, formatRequisitionOptionLabel, formatRequisitionTitle, statusTone } from "@/lib/format";
import { sourcingLinkReadinessLabel, sourcingLinkReadinessReason, requisitionStatusLabel, requestTypeLabel, translate } from "@/lib/i18n/dictionary";
import { bulkActionDisabledReason, requisitionSourcingLinkReadiness, type BulkActionResult } from "@/lib/operations";
import { getRequisitionSlaState } from "@/lib/sla";
import { readTableUrlState, writeTableUrlValues } from "@/lib/table-url-state";
import { updateWorkspaceUrlState } from "@/lib/workspace-url-state";
import { useRecruitmentList } from "@/lib/recruitment-list";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnrichedCandidate, EnrichedRequisition, Language, Profile } from "@/types/recruitment";

export function RequisitionsView({
  language,
  rows,
  canWrite,
  candidates,
  profile,
  onNew,
  onStatus,
  onOpen,
  client,
  accessScope,
  listScope = {}
}: {
  language: Language;
  rows: EnrichedRequisition[];
  canWrite: boolean;
  candidates: EnrichedCandidate[];
  profile: Profile | null;
  onNew: () => void;
  onStatus: () => void;
  onOpen: (docId: string) => void;
  client: SupabaseClient | null;
  accessScope: string;
  listScope?: Record<string, unknown>;
}) {

  const initialTableState = useMemo(() => readTableUrlState("req"), []);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(RECORD_PAGE_SIZE);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(Object.keys(initialTableState.filters ?? {}).length > 0);
  const tableInitialized = useRef(false);
  const columns: TableColumn<EnrichedRequisition>[] = [
    { key: "doc_id", label: translate(language, "docId"), value: (row) => row.doc_id },
    { key: "position", label: translate(language, "position"), value: (row) => formatRequisitionTitle(row) },
    { key: "status", label: translate(language, "status"), value: (row) => requisitionStatusLabel(language, row.status), filterMode: "category" },
    { key: "open_headcount", label: translate(language, "openHeadcountShort"), value: (row) => row.open_headcount },
    { key: "readiness", label: (language==="th"?"เชื่อมโยง":"Linked"), value: (row) => sourcingLinkReadinessLabel(language, requisitionSourcingLinkReadiness(row).linked) },
    { key: "sla", label: translate(language, "slaLabel"), value: (row) => getRequisitionSlaState(row, { openOnly: true }).label },
    { key: "age", label: translate(language, "ageLabel"), value: (row) => ageLabel(row), sortValue: (row) => getRequisitionSlaState(row, { openOnly: true }).ageDays ?? Number.POSITIVE_INFINITY },
    { key: "owner", label: translate(language, "owner"), value: (row) => row.person_in_charge ?? "-" },
    { key: "department", label: translate(language, "department"), value: (row) => row.department },
    { key: "request_type", label: translate(language, "requestType"), value: (row) => requestTypeLabel(language, row.request_type), filterMode: "category" },
    { key: "section", label: translate(language, "section"), value: (row) => row.section ?? "-" },
    { key: "head_count", label: translate(language, "headcount"), value: (row) => row.head_count },
    { key: "accepted_count", label: translate(language, "accepted"), value: (row) => row.accepted_count },
    { key: "candidate_count", label: translate(language, "candidates"), value: (row) => row.candidate_count },
    { key: "req_date", label: translate(language, "requisitionDate"), value: (row) => row.pr_approved_date ? formatDate(row.pr_approved_date, language) : "-", sortValue: (row) => row.pr_approved_date ?? "" },
    { key: "updated_at", label: translate(language, "updated"), value: (row) => formatDate(row.updated_at, language), sortValue: (row) => row.updated_at }
  ];
  const displayColumns=["position","status","readiness","sla","age","owner","department","request_type","section","open_headcount","head_count","accepted_count","candidate_count","req_date","updated_at"].map(key=>columns.find(column=>column.key===key)!);
  const table = useTableControls(rows, columns, initialTableState);
  const staged = useRecordFilterDraft(table.filters, advancedFiltersOpen);
  const list = useRecruitmentList<EnrichedRequisition>({ client, accessScope, entity: "requisitions", filters: { ...listScope, ...table.filters }, sort: table.sortKey ?? "updated_at", direction: table.sortDirection ?? "desc", initialPageSize: RECORD_PAGE_SIZE, enabled: Boolean(client && accessScope), searchInput: { value: table.search, setValue: table.setSearch } });
  const recordFilterOptions=useRecordCategoryOptions(columns,[...rows,...list.items],JSON.stringify([accessScope,listScope,language]));
  const paginated = { page: list.page };
  const visibleRows = client && accessScope ? list.items : paginateRows(table.controlledRows, page, pageSize).rows;
  const selectionIdentity=JSON.stringify([accessScope,listScope,table.search,table.filters,table.sortKey,table.sortDirection]);
  const selection=useRecordSelection(selectionIdentity),selectedIds=selection.ids;
  const clearFeedback=selection.clearFeedback;
  useEffect(()=>clearFeedback(),[list.page,page,clearFeedback]);
  const [exportBusy,setExportBusy]=useState(false),[exportMessage,setExportMessage]=useState(""),[exportError,setExportError]=useState("");
  const exportController=useRef<AbortController|null>(null),activeSelectionIdentity=useRef(selectionIdentity);activeSelectionIdentity.current=selectionIdentity;
  useEffect(()=>{exportController.current?.abort();setExportBusy(false);setExportMessage("");setExportError("");return()=>exportController.current?.abort();},[selectionIdentity]);
  const allMatchingChecked=selectedIds.length>0&&selectedIds.length===(client?list.totalCount:table.controlledRows.length)&&visibleRows.every(row=>selectedIds.includes(row.doc_id));
  const captureAll=async()=>{const succeeded=await selection.capture((signal,onProgress)=>client?fetchMatchingRecordIds(client,{accessScope,entity:"requisitions",search:list.search.trim(),filters:{...listScope,...table.filters},signal},onProgress):Promise.resolve(table.controlledRows.map(row=>row.doc_id)),visibleRows.map(row=>row.doc_id));if(succeeded)list.retryCount();};
  async function exportSelected(){
   if(exportBusy||selection.captureBusy||!selectedIds.length)return;
   const controller=new AbortController(),started=selectionIdentity;exportController.current=controller;setExportBusy(true);setExportError("");setExportMessage("");
   try{const fresh=client?await fetchSelectedRequisitions(client,accessScope,selectedIds,listScope,controller.signal):rows.filter(row=>selectedIds.includes(row.doc_id));
    if(controller.signal.aborted||activeSelectionIdentity.current!==started)return;
    exportRequisitions(fresh);setExportMessage(language==="th"?"ส่งออก "+fresh.length+" จาก "+selectedIds.length+" รายการที่เลือก":"Exported "+fresh.length+" of "+selectedIds.length+" selected requisitions.");
   }catch{if(!controller.signal.aborted&&activeSelectionIdentity.current===started)setExportError(language==="th"?"ส่งออกไม่สำเร็จ โปรดลองอีกครั้ง":"Could not export selected requisitions. Please retry.");}
   finally{if(activeSelectionIdentity.current===started)setExportBusy(false);}
  }

  useEffect(() => {
    if (!tableInitialized.current) {
      tableInitialized.current = true;
      return;
    }
    setPage(1);
  }, [pageSize, rows.length, table.controlledRows.length, table.filters, table.search, table.sortDirection, table.sortKey]);

  useEffect(() => {
    updateWorkspaceUrlState(writeTableUrlValues("req", {
      filters: table.filters,
      page: list.page,
      pageSize: list.pageSize,
      search: list.search,
      sortDirection: table.sortDirection,
      sortKey: table.sortKey
    }));
  }, [list.page, list.pageSize, list.search, table.filters, table.sortDirection, table.sortKey]);

  return (
    <Panel className="records-surface records-requisitions">{list.refreshing || list.countLoading && list.totalCount !== null ? <RefreshIndicator language={language} /> : null}
      {list.error ? <div role="alert" className="mb-3 flex items-center gap-3 text-sm text-scarlet"><span>Could not load requisitions.</span><RetryIconButton title={`${language === "th" ? "ลองโหลดข้อมูลอีกครั้ง" : "Retry loading"}: Requisitions`} type="button"  onClick={list.retry} loading={list.loading}>{language === "th" ? "ลองอีกครั้ง" : "Retry"}</RetryIconButton></div> : null}
      <RecordSelectionProgress selection={selection} language={language}/>{exportMessage?<p role="status" className="my-2 text-xs text-slate">{exportMessage}</p>:null}{exportError?<p role="alert" className="my-2 text-xs text-scarlet">{exportError}</p>:null}
      {!client && rows.length === 0 ? (
        <>{canWrite ? <div className="mb-4 flex flex-wrap items-center justify-end gap-2"><RecordCreateButton label={translate(language,"newRequisition")} onClick={onNew}/></div> : null}<EmptyState message={translate(language, "noData")} /></>
      ) : (
        <>
        {list.initialLoading ? <LoadingSkeleton variant="cards" language={language} className="md:hidden" /> : null}<TableToolbar records advancedFiltersPanelId="records-requisition-filters" filtersActive={Object.values(table.filters).some(Boolean)}           advancedFiltersOpen={advancedFiltersOpen}
          language={language}
          onAdvancedFiltersToggle={() => setAdvancedFiltersOpen((open) => !open)}
          onSearch={list.setSearch}
          resultCount={client ? list.totalCount : table.controlledRows.length}
          searchValue={list.search}
          trailingActions={canWrite ? <><RecordCreateButton label={translate(language,"newRequisition")} onClick={onNew}/></> : null}
          totalCount={client ? list.totalCount : rows.length}
        />
<RecordFilterPanel id="records-requisition-filters" open={advancedFiltersOpen} language={language} onClose={()=>setAdvancedFiltersOpen(false)} onApply={()=>table.setFilters({...staged.draft})} onClear={()=>{staged.setDraft({});table.setFilters({});}}>
  {[
    { label: language==="th"?"คำขอและสถานะ":"Requisition and status", keys:["position","doc_id","status","readiness"] },
    { label: language==="th"?"ผู้รับผิดชอบและหน่วยงาน":"Owner and organization", keys:["owner","department","section","request_type"] },
    { label: language==="th"?"อัตราและระยะเวลา":"Headcount and timing", keys:["open_headcount","head_count","accepted_count","candidate_count","sla","age"] },
    { label: language==="th"?"วันที่":"Dates", keys:["req_date","updated_at"] }
  ].map(group=><fieldset key={group.label} className="col-span-full min-w-0 border-0 p-0"><legend className="mb-2 text-xs font-semibold text-navy">{group.label}</legend><div className="grid min-w-0 grid-cols-1 gap-3">{group.keys.map(key=>{const column=columns.find(item=>item.key===key)!;return <div key={key} className="records-filter-field"><span className="text-xs font-medium text-slate">{column.label}</span><TableFilterField columnKey={key} filterValue={staged.draft[key]??""} language={language} label={column.label} onFilter={staged.setField} filterOptions={recordFilterOptions(key)} viewportBounded sidebar/></div>;})}</div></fieldset>)}
</RecordFilterPanel>
        {client && list.totalCount === 0 ? <EmptyState variant="quiet" message={translate(language, "noData")} /> : null}
        <div className="grid gap-3 md:hidden">
          {visibleRows.map((row) => (
            <article key={row.doc_id} className={"ats-card p-3 text-left "+(selection.flashing(row.doc_id)?"records-selection-flash":"")}><label className="record-selection-target mb-1 w-11"><RecordSelectionCheckbox label={translate(language,"selectRequisition",{id:row.doc_id})} checked={selectedIds.includes(row.doc_id)} onChange={checked=>selection.toggle(row.doc_id,checked)} disabled={list.loading||selection.captureBusy}/></label>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-start gap-2"><button type="button" className="records-requisition-identity text-left" aria-label={translate(language,"viewRequisitionDetailFor",{id:row.doc_id})} onClick={()=>onOpen(row.doc_id)}><span className="records-position-primary">{formatRequisitionTitle(row)}</span><span className="records-position-id">{row.doc_id}</span></button><RecordPriorityIndicator priority={row.is_priority===true} language={language}/></div>
                </div>
                <Tag appearance="soft" tone={statusTone(row.status) as never}>{requisitionStatusLabel(language, row.status)}</Tag>
              </div>
              <p className="text-sm font-medium text-slate">{row.site} · {translate(language, "openCount", { count: row.open_headcount })} · {translate(language, "candidatesCount", { count: row.candidate_count })}</p>
              <dl className="mt-2 grid gap-1.5 text-xs">
                <div className="flex min-w-0 gap-2"><dt className="shrink-0 font-medium text-slate">{translate(language, "department")}</dt><dd className="min-w-0 break-words font-semibold text-navy">{row.department}</dd></div>
                <div className="flex min-w-0 gap-2"><dt className="shrink-0 font-medium text-slate">{translate(language, "requestType")}</dt><dd className="min-w-0 break-words font-semibold text-navy">{requestTypeLabel(language, row.request_type)}</dd></div>
                <div className="flex min-w-0 gap-2"><dt className="shrink-0 font-medium text-slate">{translate(language, "owner")}</dt><dd className="min-w-0 break-words font-semibold text-navy">{row.person_in_charge ?? "-"}</dd></div>
                <div className="flex min-w-0 gap-2"><dt className="shrink-0 font-medium text-slate">{language==="th"?"เชื่อมโยง":"Linked"}</dt><dd className="min-w-0 break-words"><ReadinessText row={row} candidates={candidates} language={language} /></dd></div>
                <div className="flex min-w-0 gap-2"><dt className="shrink-0 font-medium text-slate">{translate(language, "ageLabel")}</dt><dd className="min-w-0 break-words font-semibold text-navy">{ageLabel(row)}</dd></div>
                <div className="flex min-w-0 gap-2"><dt className="shrink-0 font-medium text-slate">{translate(language, "slaLabel")}</dt><dd className="min-w-0 break-words font-semibold text-navy">{getRequisitionSlaState(row, { openOnly: true }).label}</dd></div>
              </dl>
              <div className="mt-3">
                <RecordQuickActions label={translate(language, "recordActionsFor", { label: formatRequisitionOptionLabel(row) })} actions={requisitionActions(row, language, onOpen)} />
              </div>
            </article>
          ))}
        </div>
        <div className="table-scroll hidden md:block" tabIndex={0}>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-lightgray text-xs uppercase text-slate">
              <tr>
                <th scope="col" className="records-selection-cell">
                  <RecordSelectionCheckbox label={language==="th"?"เลือกคำขอทั้งหมดที่ตรงกัน":"Select all matching requisitions"} checked={allMatchingChecked} mixed={selectedIds.length>0&&!allMatchingChecked} onChange={checked=>checked?captureAll():selection.clear()} disabled={list.loading||list.criteriaPending||selection.captureBusy||list.countLoading||list.countError||list.totalCount===null||list.totalCount===0}/>
                </th>
                <th scope="col" className="records-priority-column px-2 py-3">{language==="th"?"ความสำคัญ":"Priority"}</th>
                {displayColumns.map((column) => (
                  <th key={column.key} scope="col" className="px-3 py-3 align-top">
                    <SortableFilterHeader
                      columnKey={column.key}
                      filterValue={table.filters[column.key] ?? ""}
                      language={language}
                      label={column.label}
                      onFilter={table.setFilter}
                      onSort={table.toggleSort}
                      filterOptions={recordFilterOptions(column.key)}
                      sortDirection={table.sortDirection}
                      sortKey={table.sortKey}
                      showFilter={false} viewportBoundedFilters
                    />
                  </th>
                ))}
                <th scope="col" className="px-3 py-3"><span className="sr-only">{translate(language, "actions")}</span></th>
              </tr>
            </thead>
            <tbody aria-busy={list.loading}>{list.initialLoading ? <TableSkeletonRows columns={[{kind:"action"},{kind:"action"}, ...displayColumns.map(column => ({kind: /head|count|age|sla/i.test(column.key) ? "number" as const : "text" as const})), {kind:"action"}]} language={language}/> : null}
              {visibleRows.map((row) => (
                <tr key={row.doc_id} className={selection.flashing(row.doc_id)?"records-selection-flash":""}>
                  <td className="records-selection-cell"><RecordSelectionCheckbox label={translate(language,"selectRequisition",{id:row.doc_id})} checked={selectedIds.includes(row.doc_id)} onChange={checked=>selection.toggle(row.doc_id,checked)} disabled={list.loading||selection.captureBusy}/></td>
<td className="records-priority-column"><RecordCell><RecordPriorityIndicator priority={row.is_priority===true} language={language}/></RecordCell></td>
<td><RecordCell><button type="button" className="records-requisition-identity text-left focus-visible:ring-2 focus-visible:ring-primary" aria-label={translate(language,"viewRequisitionDetailFor",{id:row.doc_id})} title={formatRequisitionTitle(row)+" / "+row.doc_id} onClick={()=>onOpen(row.doc_id)}><span className="records-position-primary">{formatRequisitionTitle(row)}</span><span className="records-position-id">{row.doc_id}</span></button></RecordCell></td>
<td className="px-3 py-3"><RecordCell><Tag appearance="soft" tone={statusTone(row.status) as never}>{requisitionStatusLabel(language, row.status)}</Tag></RecordCell></td>
<td className="px-3 py-3"><RecordCell><ReadinessText row={row} candidates={candidates} language={language} /></RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell>{getRequisitionSlaState(row, { openOnly: true }).label}</RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell>{ageLabel(row)}</RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell><TruncatedTableText value={row.person_in_charge} /></RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell><TruncatedTableText value={row.department} /></RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell>{requestTypeLabel(language, row.request_type)}</RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell><TruncatedTableText value={row.section} /></RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell>{row.open_headcount}</RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell>{row.head_count}</RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell>{row.accepted_count}</RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell>{row.candidate_count}</RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell>{formatDate(row.pr_approved_date, language)}</RecordCell></td>
<td className="px-3 py-3 text-slate"><RecordCell>{formatDate(row.updated_at)}</RecordCell></td>
<td className="px-3 py-3"><RecordCell>
                    <div className="flex items-center justify-end gap-2">
                      <RecordQuickActions label={translate(language, "recordActionsFor", { label: formatRequisitionOptionLabel(row) })} actions={requisitionActions(row, language, onOpen)} />
                    </div>
                  </RecordCell></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <RecordPagination pageSize={client ? list.pageSize : pageSize} onPageSizeChange={size => { setPageSize(size); list.setPageSize(size); setPage(1); }} language={language} page={client ? list.page : page} totalCount={client ? list.totalCount : table.controlledRows.length} countLoading={client ? list.countLoading : false} countError={client ? list.countError : false} loading={selection.captureBusy||(client ? list.loading : false)} canPrevious={client ? list.canPrevious : page > 1} canNext={client ? list.canNext : page * pageSize < table.controlledRows.length} onPrevious={client ? list.goPrevious : () => setPage(value => Math.max(1,value-1))} onNext={client ? list.goNext : () => setPage(value=>value+1)} onRetryCount={list.retryCount}/>
        <BulkActionToolbar
          selectionNote={language==="th"?"ส่งออกข้อมูลที่เลือกหรือล้างการเลือก":"Export the selected records or clear the selection."}
          entityLabel={translate(language, "requisitionsUnit")}
          language={language}
          selectedCount={selectedIds.length}
          onClear={() => {
            selection.clear();
          }}
          onExport={exportSelected} exportBusy={exportBusy||selection.captureBusy}

        />

        </>
      )}
    </Panel>
  );
}

function exportRequisitions(rows: EnrichedRequisition[]) {
  downloadCsv("selected-requisitions.csv", rows.map((row) => ({
    doc_id: row.doc_id,
    position: row.position,
    site: row.site,
    owner: row.person_in_charge ?? "",
    status: row.status,
    open_headcount: row.open_headcount
  })));
}

function requisitionActions(row: EnrichedRequisition, language: Language, onOpen: (docId: string) => void): RecordQuickAction[] {
  return [
    { id: "view", label: translate(language, "viewRequisitionDetailFor", { id: formatRequisitionOptionLabel(row) }), icon: <Search size={16} aria-hidden="true" />, iconOnly: true, onSelect: () => onOpen(row.doc_id) }
  ];
}

function ReadinessText({ candidates, language, row }: { candidates: EnrichedCandidate[]; language: Language; row: EnrichedRequisition }) {
  const readiness = requisitionSourcingLinkReadiness(row);
  const label=sourcingLinkReadinessLabel(language,readiness.linked);
  return <span title={label+" · "+sourcingLinkReadinessReason(language,readiness.groupIds)} className="records-linked-tag" data-linked={readiness.linked}><Tag appearance="soft" tone={readiness.linked?"primary":"danger"}>{label}</Tag></span>;
}

function DetailButton({ ariaLabel, onClick }: { ariaLabel: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-slate hover:text-primary"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      icon={<Search size={16} aria-hidden="true" />}
    />
  );
}


function ageLabel(row: EnrichedRequisition) {
  const ageDays = getRequisitionSlaState(row, { openOnly: true }).ageDays;
  return ageDays === null ? "-" : `${ageDays}d`;
}
