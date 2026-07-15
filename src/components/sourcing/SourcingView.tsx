import { Link2, Plus, Save } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, TextInput } from "@/components/ui/Field";
import { OperationalSummaryStrip, RecordActionGroup } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { BulkActionToolbar, BulkReviewModal, DisabledReasonHint, SourcingConversionPanel } from "@/components/ui/Workflow";
import { SOURCING_CHANNELS } from "@/lib/constants";
import { enrichSourcingGroups } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { ageDays, bulkActionDisabledReason, deriveSourcingConversionMetrics, sourcingApplicants, sourcingPreviousUpdate, sourcingUpdateDisabledReason, type BulkActionResult } from "@/lib/operations";
import type { DashboardData, EnrichedSourcingGroup, Language, Profile } from "@/types/recruitment";

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
  onMatch?: () => void;
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
  groupIds,
  docIds,
  embedded = false
}: SourcingViewProps) {
  const [urlFilters, setUrlFilters] = useState({ sourceSearch: "", reqSearch: "" });
  const scopedGroups = scopeSourcingGroups(enrichSourcingGroups(data, weekStart), groupIds, docIds);
  const allGroups = visibleSourcingGroups(scopedGroups, profile);
  const groups = filterSourcingGroups(allGroups, urlFilters);
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
                {onMatch ? <Button type="button" size="sm" variant="secondary" icon={<Link2 size={16} />} onClick={onMatch}>Add Match</Button> : null}
              </>
            }
          />
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle
          title={embedded ? "Sourcing Coverage" : "Weekly Sourcing Updates"}
          eyebrow="Open requisition groups"
          action={
            <Field label="Week Start">
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
              return (
              <form id={`sourcing-group-${group.group_id}`} key={group.group_id} tabIndex={focusedGroupId === group.group_id ? -1 : undefined} className={`rounded-lg border bg-white p-4 shadow-[0_8px_20px_rgba(11,19,43,0.035)] focus:outline-none focus:ring-2 focus:ring-primary/30 ${focusedGroupId === group.group_id ? "border-primary ring-2 ring-primary/25" : "border-[#D7DEE8]"}`} onSubmit={(event) => saveGroup(event, group)}>
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
                        aria-label={`Select sourcing group ${group.group_id}`}
                        type="checkbox"
                        checked={selectedGroupIds.includes(group.group_id)}
                        onChange={(event) => setSelectedGroupIds((current) => event.target.checked ? [...current, group.group_id] : current.filter((id) => id !== group.group_id))}
                      />
                      <strong className="text-lg text-navy">{group.group_id}</strong>
                      <Tag tone="teal">{group.group_position}</Tag>
                      <Tag tone="warning">{group.open_headcount} open</Tag>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate">
                      Docs: {group.doc_ids.join(", ")} | Sites: {group.sites.join(", ")} | Owners: {group.owners.join(", ")}
                    </p>
                    <p className="mt-1 text-xs font-medium text-cool">
                      Candidates: {group.candidate_count} | Last saved: {group.latest_update?.updated_at ? formatDate(group.latest_update.updated_at, language) : "Not updated this week"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    {canWrite ? (
                      <Button
                        type="submit"
                        size="icon-sm"
                        icon={<Save size={16} />}
                        disabled={disabledReason.blocked}
                        aria-label={`Save sourcing week for ${group.group_id}`}
                        title={disabledReason.blocked ? disabledReason.detail : `Save sourcing week for ${group.group_id}`}
                      >
                        <span className="sr-only">Save</span>
                      </Button>
                    ) : (
                      <Tag tone="muted">{translate(language, "readonly")}</Tag>
                    )}
                    <RecordActionGroup
                      label={`sourcing group ${group.group_id}`}
                      items={[
                        ...(canWrite ? [{ id: "copy-previous", label: "Copy Previous Week", onSelect: () => copyPreviousWeek(document.getElementById(`sourcing-group-${group.group_id}`) as HTMLFormElement | null, previousUpdate), disabledReason: { blocked: !previousUpdate || disabledReason.blocked, label: "Copy unavailable", detail: disabledReason.blocked ? disabledReason.detail : "No previous week update is available." } }] : []),
                        { id: "requisitions", href: `/requisitions?reqSearch=${encodeURIComponent(group.doc_ids.join(" "))}`, label: "Matching requisitions" },
                        { id: "candidates", href: `/candidates?candSearch=${encodeURIComponent(group.group_position)}`, label: "Related candidates" },
                        { id: "workspace", href: `/workspace?type=group&id=${encodeURIComponent(group.group_id)}`, label: "Open workspace" }
                      ]}
                    />
                  </div>
                </div>
                <DisabledReasonHint reason={disabledReason} />
                <div className="mb-4 grid gap-3">
                  <OperationalSummaryStrip
                    items={[
                      { label: "This week", value: thisWeekApplicants, tone: thisWeekApplicants > 0 ? "teal" : "warning", helper: "Applicants saved" },
                      { label: "Previous week", value: previousApplicants, tone: "muted", helper: previousUpdate ? "For comparison" : "No prior update" },
                      { label: "Trend", value: trendLabel(thisWeekApplicants, previousApplicants), tone: trendTone(thisWeekApplicants, previousApplicants), helper: "Applicant movement" },
                      { label: "Channels", value: activeChannels, tone: activeChannels > 0 ? "primary" : "warning", helper: "Enabled channels" },
                      { label: "Last update age", value: group.latest_update?.updated_at ? `${ageDays(group.latest_update.updated_at) ?? "-"}d` : "Never", tone: group.latest_update?.updated_at ? "muted" : "warning", helper: "Selected week" }
                    ]}
                  />
                  <SourcingConversionPanel collapsible defaultOpen={false} metrics={conversionMetrics} />
                </div>

                {markedChannels.length === 0 ? (
                  <p className="rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3 text-sm font-medium text-slate">{translate(language, "noMarkedSourcingChannels")}</p>
                ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {markedChannels.map((channel) => (
                    <div key={channel.count} className="rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3">
                      <p className="mb-3 text-sm font-semibold text-navy">{channel.label}</p>
                      <Field label="Applicants">
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
          entityLabel="sourcing groups"
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
          actionLabel="Review selected sourcing groups for copy-previous-week workflow. Existing per-group save remains unchanged."
          ids={selectedGroupIds}
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
