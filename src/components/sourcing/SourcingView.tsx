import { AlertTriangle, Link2, Plus, Save, Trash2, Unlink } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, TextInput } from "@/components/ui/Field";
import { OperationalSummaryStrip, RecordActionGroup } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { BulkActionToolbar, BulkReviewModal, DisabledReasonHint, SourcingConversionPanel } from "@/components/ui/Workflow";
import { SOURCING_CHANNELS } from "@/lib/constants";
import { enrichSourcingGroups, enrichUnmatchedSourcingGroups } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { ageDays, bulkActionDisabledReason, deriveSourcingConversionMetrics, sourcingApplicants, sourcingPreviousUpdate, sourcingUpdateDisabledReason, type BulkActionResult } from "@/lib/operations";
import type { DashboardData, EnrichedSourcingGroup, EnrichedUnmatchedSourcingGroup, Language, Profile } from "@/types/recruitment";

export type SourcingViewProps = {
  language: Language;
  data: DashboardData;
  profile: Profile | null;
  canWrite: boolean;
  canManageSetup: boolean;
  weekStart: string;
  onWeekChange: (value: string) => void;
  onSaveSourcing: (payload: Record<string, unknown>, summary: string) => void;
  onGroup?: () => void;
  onMatch?: (defaults?: { doc_id?: string; group_id?: string }) => void;
  onUnmatch?: (payload: Record<string, unknown>, summary: string) => void;
  onDeleteRecord?: (payload: Record<string, unknown>, summary: string) => void;
  canDeleteRecords?: boolean;
  /** Restricts the editor to groups related to an embedded workspace context. */
  groupIds?: readonly string[];
  /** Fallback scope for workspace contexts where the related group should resolve through selected requisitions. */
  docIds?: readonly string[];
  /** Omits standalone-only URL filtering and bulk actions when rendered in a workspace. */
  embedded?: boolean;
};

export function SourcingView({
  language,
  data,
  profile,
  canWrite,
  canManageSetup,
  weekStart,
  onWeekChange,
  onSaveSourcing,
  onGroup,
  onMatch,
  onUnmatch,
  onDeleteRecord,
  canDeleteRecords = false,
  groupIds,
  docIds,
  embedded = false
}: SourcingViewProps) {
  const [urlFilters, setUrlFilters] = useState({ sourceSearch: "", reqSearch: "" });
  const scopedGroups = scopeSourcingGroups(enrichSourcingGroups(data, weekStart), groupIds, docIds);
  const allGroups = visibleSourcingGroups(scopedGroups, profile);
  const groups = filterSourcingGroups(allGroups, urlFilters);
  const unmatchedGroups = !embedded && canManageSetup ? filterUnmatchedGroups(enrichUnmatchedSourcingGroups(data), urlFilters) : [];
  const groupScopeKey = groups.map((group) => group.group_id).join("|");
  const focusedGroupId = urlFilters.sourceSearch || urlFilters.reqSearch ? groups[0]?.group_id ?? null : null;
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [bulkReviewOpen, setBulkReviewOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkActionResult | null>(null);
  const selectedGroups = groups.filter((group) => selectedGroupIds.includes(group.group_id));
  const bulkDisabledReason = bulkActionDisabledReason({ entity: "sourcing", ids: selectedGroupIds }, "copy previous sourcing week", profile);

  useEffect(() => {
    if (embedded) return;
    const params = new URLSearchParams(window.location.search);
    setUrlFilters({
      sourceSearch: params.get("sourceSearch") ?? "",
      reqSearch: params.get("reqSearch") ?? ""
    });
  }, [embedded]);

  useEffect(() => {
    const availableIds = new Set(groupScopeKey.split("|").filter(Boolean));
    setSelectedGroupIds((current) => {
      const next = current.filter((id) => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [groupScopeKey]);

  useEffect(() => {
    if (!focusedGroupId) return;
    const group = document.getElementById(`sourcing-group-${focusedGroupId}`);
    if (!group) return;
    group.scrollIntoView({ block: "center", behavior: "smooth" });
    group.focus({ preventScroll: true });
  }, [focusedGroupId]);

  function saveGroup(event: FormEvent<HTMLFormElement>, group: EnrichedSourcingGroup) {
    event.preventDefault();
    const disabledReason = sourcingUpdateDisabledReason(group, profile);
    if (disabledReason.blocked) return;
    const formData = new FormData(event.currentTarget);
    const negativeChannels = SOURCING_CHANNELS.filter((channel) => rawNumericValue(formData.get(channel.count)) < 0);
    if (negativeChannels.length > 0) {
      window.alert(`Applicant counts cannot be negative: ${negativeChannels.map((channel) => channel.label).join(", ")}.`);
      return;
    }
    const hasUnusualValue = SOURCING_CHANNELS.some((channel) => numericValue(formData.get(channel.count)) > 1000);
    if (hasUnusualValue && !window.confirm("One or more applicant counts are above 1,000. Save anyway?")) return;
    const payload = {
      group_id: group.group_id,
      week_start: weekStart,
      ...Object.fromEntries(SOURCING_CHANNELS.map((channel) => [
        channel.count,
        Boolean(group[channel.enabled]) ? numericValue(formData.get(channel.count)) : 0
      ]))
    };
    onSaveSourcing(payload, `sourcing update - ${group.group_id}`);
  }

  return (
    <div className="grid gap-4">
      {canManageSetup && (onGroup || onMatch) ? (
        <Panel>
          <SectionTitle
            title="Sourcing Setup"
            eyebrow="Groups and requisition matching"
            action={
              <>
                {onGroup ? <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onGroup}>New Group</Button> : null}
                {onMatch ? <Button type="button" size="sm" variant="secondary" icon={<Link2 size={16} />} onClick={() => onMatch()}>{translate(language, "addMatch")}</Button> : null}
              </>
            }
          />
        </Panel>
      ) : null}

      {unmatchedGroups.length > 0 ? (
        <Panel className="border-[#F3D3A2] bg-[#FFFDF8]">
          <SectionTitle
            title={translate(language, "unmatchedSourcingGroups")}
            eyebrow={translate(language, "setupAttention")}
          />
          <p className="mb-3 flex items-start gap-2 text-sm font-medium text-slate" role="status">
            <AlertTriangle className="mt-0.5 shrink-0 text-orange" size={17} aria-hidden="true" />
            <span>{translate(language, "unmatchedSourcingGroupsWarning")}</span>
          </p>
          <div className="grid gap-2">
            {unmatchedGroups.map((group) => {
              const markedChannels = SOURCING_CHANNELS.filter((channel) => group[channel.enabled]);
              return (
                <div key={group.group_id} className="grid gap-3 rounded-lg border border-[#F3D3A2] bg-white p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-base text-navy">{group.group_id}</strong>
                      <Tag tone="warning">{group.group_position}</Tag>
                    </div>
                    <p className="mt-1 text-xs font-medium text-cool">
                      {translate(language, "enabledChannels")}: {markedChannels.length > 0 ? markedChannels.map((channel) => channel.label).join(", ") : translate(language, "none")}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                    {onMatch ? (
                      <Button type="button" size="sm" icon={<Link2 size={16} />} onClick={() => onMatch({ group_id: group.group_id })}>
                        {translate(language, "matchRequisition")}
                      </Button>
                    ) : null}
                    {canDeleteRecords && onDeleteRecord ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="danger"
                        icon={<Trash2 size={16} />}
                        onClick={() => onDeleteRecord({ entity: "position_group", id: group.group_id }, translate(language, "deleteRecordSummary", { entity: translate(language, "sourcingGroup"), id: group.group_id }))}
                      >
                        {translate(language, "deleteRecord")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle
          title={embedded ? translate(language, "sourcingCoverage") : translate(language, "weeklySourcingUpdates")}
          eyebrow={translate(language, "openRequisitionGroups")}
          action={
            <Field label={translate(language, "weekStart")}>
              <TextInput type="date" value={weekStart} onChange={(event) => onWeekChange(event.target.value)} />
            </Field>
          }
        />
        {!embedded && (urlFilters.sourceSearch || urlFilters.reqSearch) ? (
          <p className="mb-3 text-sm font-medium text-slate" role="status">
            Showing {groups.length} contextual group{groups.length === 1 ? "" : "s"}{urlFilters.sourceSearch ? ` for ${urlFilters.sourceSearch}` : ""}{urlFilters.reqSearch ? ` matching requisition ${urlFilters.reqSearch}` : ""}.
          </p>
        ) : null}
        {groups.length === 0 ? (
          <EmptyState message={emptySourcingMessage(embedded, urlFilters)} />
        ) : (
          <div className="grid gap-3">
            {groups.map((group) => {
              const markedChannels = SOURCING_CHANNELS.filter((channel) => group[channel.enabled]);
              const latestSavedUpdate = latestSourcingUpdateForGroup(data, group.group_id);
              const groupMatches = data.document_groups
                .filter((match) => match.group_id === group.group_id && group.doc_ids.includes(match.doc_id))
                .sort((a, b) => a.doc_id.localeCompare(b.doc_id));
              return (
              <form id={`sourcing-group-${group.group_id}`} key={group.group_id} tabIndex={focusedGroupId === group.group_id ? -1 : undefined} className={`rounded-lg border bg-white p-4 shadow-[0_4px_14px_rgba(11,19,43,0.025)] focus:outline-none focus:ring-2 focus:ring-primary/30 ${focusedGroupId === group.group_id ? "border-primary ring-2 ring-primary/25" : "border-[#D7DEE8]"}`} onSubmit={(event) => saveGroup(event, group)}>
                {(() => {
                  const previousUpdate = sourcingPreviousUpdate(data, group.group_id, weekStart);
                  const defaultUpdate = group.latest_update ?? latestSavedUpdate;
                  const thisWeekApplicants = sourcingApplicants(group.latest_update);
                  const previousApplicants = sourcingApplicants(previousUpdate);
                  const activeChannels = SOURCING_CHANNELS.filter((channel) => group[channel.enabled]).length;
                  const disabledReason = sourcingUpdateDisabledReason(group, profile);
                  const conversionMetrics = deriveSourcingConversionMetrics(data, group.group_id, weekStart);
                  return (
                    <>
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        aria-label={translate(language, "selectSourcingGroup", { id: group.group_id })}
                        type="checkbox"
                        checked={selectedGroupIds.includes(group.group_id)}
                        onChange={(event) => setSelectedGroupIds((current) => event.target.checked ? [...current, group.group_id] : current.filter((id) => id !== group.group_id))}
                      />
                      <strong className="text-lg text-navy">{group.group_id}</strong>
                      <Tag tone="teal">{group.group_position}</Tag>
                      <Tag tone="warning">{translate(language, "openCount", { count: group.open_headcount })}</Tag>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate">
                      {translate(language, "docs")}: {group.doc_ids.join(", ")} | {translate(language, "sites")}: {group.sites.join(", ")} | {translate(language, "owners")}: {group.owners.join(", ")}
                    </p>
                    <p className="mt-1 text-xs font-medium text-cool">
                      {translate(language, "candidates")}: {group.candidate_count} | {translate(language, "lastSaved")}: {group.latest_update?.updated_at ? formatDate(group.latest_update.updated_at, language) : translate(language, "notUpdatedThisWeek")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {canWrite ? (
                      <Button
                        type="submit"
                        size="icon-sm"
                        icon={<Save size={16} />}
                        disabled={disabledReason.blocked}
                        aria-label={translate(language, "saveSourcingWeekFor", { id: group.group_id })}
                        title={disabledReason.blocked ? disabledReason.detail : translate(language, "saveSourcingWeekFor", { id: group.group_id })}
                      >
                        <span className="sr-only">{translate(language, "save")}</span>
                      </Button>
                    ) : (
                      <Tag tone="muted">{translate(language, "readonly")}</Tag>
                    )}
                    <RecordActionGroup
                      label={`${translate(language, "sourcingGroup")} ${group.group_id}`}
                      items={[
                        ...(canWrite ? [{ id: "copy-previous", label: "Copy Previous Week", onSelect: () => copyPreviousWeek(document.getElementById(`sourcing-group-${group.group_id}`) as HTMLFormElement | null, previousUpdate), disabledReason: { blocked: !previousUpdate || disabledReason.blocked, label: "Copy unavailable", detail: disabledReason.blocked ? disabledReason.detail : "No previous week update is available." } }] : []),
                        ...(canManageSetup && onUnmatch ? groupMatches.map((match) => ({
                          id: `unmatch-${match.doc_group_id}`,
                          label: translate(language, "unmatchRequisition", { id: match.doc_id }),
                          icon: <Unlink size={16} />,
                          tone: "danger" as const,
                          onSelect: () => onUnmatch(
                            { doc_group_id: match.doc_group_id, doc_id: match.doc_id, group_id: group.group_id },
                            translate(language, "unmatchRecordSummary", { group: group.group_id, requisition: match.doc_id })
                          )
                        })) : []),
                        { id: "requisitions", href: `/requisitions?reqSearch=${encodeURIComponent(group.doc_ids.join(" "))}`, label: "Matching requisitions" },
                        { id: "candidates", href: `/candidates?candSearch=${encodeURIComponent(group.group_position)}`, label: "Related candidates" },
                        { id: "workspace", href: `/workspace?type=group&id=${encodeURIComponent(group.group_id)}`, label: "Open workspace" }
                      ]}
                    />
                  </div>
                </div>
                <DisabledReasonHint language={language} reason={disabledReason} />
                <div className="mb-4 grid gap-3">
                  <OperationalSummaryStrip
                    items={[
                      { label: translate(language, "thisWeek"), value: thisWeekApplicants, tone: thisWeekApplicants > 0 ? "teal" : "warning", helper: translate(language, "applicantsSaved") },
                      { label: translate(language, "previousWeek"), value: previousApplicants, tone: "muted", helper: previousUpdate ? translate(language, "forComparison") : translate(language, "noPriorUpdate") },
                      { label: translate(language, "trend"), value: trendLabel(thisWeekApplicants, previousApplicants), tone: trendTone(thisWeekApplicants, previousApplicants), helper: translate(language, "applicantMovement") },
                      { label: translate(language, "channels"), value: activeChannels, tone: activeChannels > 0 ? "primary" : "warning", helper: translate(language, "enabledChannels") },
                      { label: translate(language, "lastUpdateAge"), value: group.latest_update?.updated_at ? `${ageDays(group.latest_update.updated_at) ?? "-"}d` : translate(language, "never"), tone: group.latest_update?.updated_at ? "muted" : "warning", helper: translate(language, "selectedWeek") }
                    ]}
                  />
                  <SourcingConversionPanel collapsible defaultOpen={false} language={language} metrics={conversionMetrics} />
                </div>

                {markedChannels.length === 0 ? (
                  <p className="rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3 text-sm font-medium text-slate">{translate(language, "noMarkedSourcingChannels")}</p>
                ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {markedChannels.map((channel) => (
                    <div key={channel.count} className="rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3">
                      <p className="mb-3 text-sm font-semibold text-navy">{channel.label}</p>
                      <Field label={translate(language, "applicants")}>
                        <TextInput
                          name={channel.count}
                          type="number"
                          min={0}
                          defaultValue={String(defaultUpdate?.[channel.count] ?? 0)}
                          readOnly={!canWrite}
                        />
                      </Field>
                    </div>
                  ))}
                </div>
                )}
                    </>
                  );
                })()}
              </form>
              );
            })}
          </div>
        )}
        {!embedded ? <BulkActionToolbar
          disabledReason={bulkDisabledReason}
          entityLabel={translate(language, "sourcingGroupsUnit")}
          language={language}
          selectedCount={selectedGroupIds.length}
          onClear={() => {
            setSelectedGroupIds([]);
            setBulkResult(null);
          }}
          onExport={() => exportSourcingGroups(selectedGroups)}
          onOpenReview={() => {
            setBulkResult(null);
            setBulkReviewOpen(true);
          }}
        /> : null}
        {!embedded ? <BulkReviewModal
          actionLabel={translate(language, "bulkSourcingReviewAction")}
          ids={selectedGroupIds}
          language={language}
          open={bulkReviewOpen}
          result={bulkResult}
          onClose={() => setBulkReviewOpen(false)}
          onConfirm={() => setBulkResult({ ok: true, succeeded: selectedGroupIds, failed: [], skipped: [] })}
        /> : null}
      </Panel>

    </div>
  );
}

export function EmbeddedSourcingEditor({ groupIds, ...props }: SourcingViewProps & { groupIds: readonly string[] }) {
  return <SourcingView {...props} groupIds={groupIds} embedded />;
}

function scopeSourcingGroups(groups: EnrichedSourcingGroup[], groupIds?: readonly string[], docIds?: readonly string[]) {
  const groupIdSet = new Set(groupIds ?? []);
  const docIdSet = new Set(docIds ?? []);
  if (groupIdSet.size === 0 && docIdSet.size === 0) return groups;
  return groups.filter((group) => (
    groupIdSet.has(group.group_id)
      || group.doc_ids.some((docId) => docIdSet.has(docId))
  ));
}

function emptySourcingMessage(embedded: boolean, filters: { sourceSearch: string; reqSearch: string }) {
  if (filters.sourceSearch || filters.reqSearch) return "No sourcing groups match this context.";
  if (embedded) return "No open sourcing group is linked to this workspace context.";
  return "No unfilled sourcing groups match your responsibility.";
}

function exportSourcingGroups(groups: EnrichedSourcingGroup[]) {
  downloadCsv("selected-sourcing-groups.csv", groups.map((group) => ({
    group_id: group.group_id,
    group_position: group.group_position,
    sites: group.sites.join(" "),
    owners: group.owners.join(" "),
    open_headcount: group.open_headcount,
    candidate_count: group.candidate_count
  })));
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function visibleSourcingGroups(groups: EnrichedSourcingGroup[], profile: Profile | null) {
  if (profile?.role !== "site_recruiter") return groups;
  const nickname = profile.nickname ?? profile.full_name ?? "";
  return groups.filter((group) => group.owners.includes(nickname));
}

function latestSourcingUpdateForGroup(data: DashboardData, groupId: string) {
  return data.sourcing_weekly_updates
    .filter((update) => update.group_id === groupId)
    .sort((a, b) => b.week_start.localeCompare(a.week_start) || b.updated_at.localeCompare(a.updated_at))[0] ?? null;
}

function filterSourcingGroups(groups: EnrichedSourcingGroup[], filters: { sourceSearch: string; reqSearch: string }) {
  const sourceSearch = filters.sourceSearch.trim().toLocaleLowerCase();
  const requisitionTerms = filters.reqSearch.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return groups.filter((group) => {
    const matchesSource = !sourceSearch || [
      group.group_id,
      group.group_position,
      ...group.sites,
      ...group.owners
    ].some((value) => value.toLocaleLowerCase().includes(sourceSearch));
    const matchesRequisition = requisitionTerms.length === 0 || group.doc_ids.some((docId) => requisitionTerms.some((term) => docId.toLocaleLowerCase().includes(term)));
    return matchesSource && matchesRequisition;
  });
}

function filterUnmatchedGroups(groups: EnrichedUnmatchedSourcingGroup[], filters: { sourceSearch: string; reqSearch: string }) {
  if (filters.reqSearch.trim()) return [];
  const sourceSearch = filters.sourceSearch.trim().toLocaleLowerCase();
  if (!sourceSearch) return groups;
  return groups.filter((group) => [
    group.group_id,
    group.group_position
  ].some((value) => value.toLocaleLowerCase().includes(sourceSearch)));
}

function numericValue(value: FormDataEntryValue | null) {
  const parsed = rawNumericValue(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function rawNumericValue(value: FormDataEntryValue | null) {
  return Number(value ?? 0);
}

function copyPreviousWeek(form: HTMLFormElement | null, previousUpdate: ReturnType<typeof sourcingPreviousUpdate>) {
  if (!form || !previousUpdate) return;
  for (const channel of SOURCING_CHANNELS) {
    const count = form.elements.namedItem(channel.count);
    if (count instanceof HTMLInputElement) count.value = String(previousUpdate[channel.count] ?? 0);
  }
}

function trendLabel(current: number, previous: number) {
  const delta = current - previous;
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return String(delta);
  return "0";
}

function trendTone(current: number, previous: number) {
  const delta = current - previous;
  if (delta > 0) return "success" as const;
  if (delta < 0) return "warning" as const;
  return "muted" as const;
}
