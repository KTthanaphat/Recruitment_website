import { ChevronRight, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { DayDateSelector, TextInput } from "@/components/ui/Field";
import { Tag } from "@/components/ui/Tag";
import { SOURCING_CHANNELS } from "@/lib/constants";
import { formatDate, formatSourcingWeekRange } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { SOURCING_CHANNEL_COLORS } from "@/lib/sourcing-colors";
import type { EnrichedSourcingGroup, Language, Profile, SourcingLifecycleRow, SourcingWeeklyUpdate } from "@/types/recruitment";

type Channel = (typeof SOURCING_CHANNELS)[number];

export function EmbeddedSourcingPanel({ language, rows, selectedWeek, selectedRow, previousUpdate, previousApplicants, profile, canWrite, onWeekChange, onDirty, onSave, onOpenGroup }: {
  language: Language;
  rows: SourcingLifecycleRow[];
  selectedWeek: string;
  selectedRow: SourcingLifecycleRow | null;
  previousUpdate: SourcingWeeklyUpdate | null;
  previousApplicants: number | null;
  profile: Profile | null;
  canWrite: boolean;
  onWeekChange: (value: string) => void;
  onDirty: () => void;
  onSave: (payload: Record<string, unknown>, summary: string) => void;
  onOpenGroup: (group: EnrichedSourcingGroup) => void;
}) {
  return <section className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-testid="workspace-sourcing-layout">
    <div className="min-w-0 rounded-xl border border-[#D7DEE8] bg-white p-3 sm:p-4">
      <div data-testid="workspace-sourcing-week-header" className="flex min-h-[4.5rem] items-start border-b border-[#E4E9F2] pb-3"><h2 className="text-lg font-semibold text-navy">{translate(language, "sourcingSelectWeek")}</h2></div>
      <div data-testid="workspace-sourcing-dates" className="mt-2 max-h-72 min-w-0 divide-y divide-[#E4E9F2] overflow-y-auto lg:max-h-[28rem]">
        {rows.map((row) => {
          const selected = row.week_start === selectedWeek;
          return <button key={`${row.group.group_id}:${row.week_start}`} type="button" aria-current={selected ? "date" : undefined} onClick={() => onWeekChange(row.week_start)} className={`flex min-h-14 w-full min-w-0 items-center gap-2 border-l-[3px] px-3 py-2 text-left hover:bg-[#F1F6FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${selected ? "border-primary bg-[#F1F6FC]" : "border-transparent"}`}>
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold tabular-nums text-navy">{formatDate(row.week_start, language)}</span><span className="block text-xs text-slate">{translate(language, "sourcingSatFri")}</span></span>
            <Tag appearance="soft" tone={row.status === "saved" ? "success" : "warning"}>{translate(language, row.status === "saved" ? "recorded" : row.update ? "workspaceIncompleteWeek" : "workspaceMissingUpdate")}</Tag>
            <ChevronRight className="h-4 w-4 shrink-0 text-slate" aria-hidden="true" />
          </button>;
        })}
        {rows.length === 0 ? <EmptyState variant="quiet" message={translate(language, "noOpenSourcingWorkspace")} /> : null}
      </div>
    </div>
    <div className="min-w-0 rounded-xl border border-[#D7DEE8] bg-white p-3 sm:p-4">
      <div data-testid="workspace-sourcing-update-header" className="flex min-h-[4.5rem] min-w-0 flex-wrap items-start justify-between gap-3 border-b border-[#E4E9F2] pb-3">
        <div className="min-w-0"><h2 className="break-words text-lg font-semibold text-navy">{translate(language, "sourcingUpdateForDate", { date: formatDate(selectedWeek, language) })}</h2><p className="mt-1 text-xs tabular-nums text-slate">{formatSourcingWeekRange(selectedWeek, language)}</p></div>
        <div className="flex min-w-0 flex-wrap items-center gap-2"><DayDateSelector ariaLabel={translate(language, "weekStarting")} language={language} name="workspace_sourcing_week" value={selectedWeek} onChange={(event) => onWeekChange(event.target.value)} required />{selectedRow ? <Button type="button" size="sm" variant="secondary" onClick={() => onOpenGroup(selectedRow.group)}>{translate(language, "details")}</Button> : null}</div>
      </div>
      {selectedRow ? <SourcingDraftForm key={`${selectedRow.group.group_id}:${selectedRow.week_start}:${selectedRow.update?.updated_at ?? "new"}`} language={language} row={selectedRow} previousUpdate={previousUpdate} previousApplicants={previousApplicants} profile={profile} canWrite={canWrite} onDirty={onDirty} onSave={onSave} /> : <EmptyState variant="quiet" message={translate(language, "noOpenSourcingWorkspace")} />}
    </div>
  </section>;
}

function SourcingDraftForm({ language, row, previousUpdate, previousApplicants, profile, canWrite, onDirty, onSave }: {
  language: Language;
  row: SourcingLifecycleRow;
  previousUpdate: SourcingWeeklyUpdate | null;
  previousApplicants: number | null;
  profile: Profile | null;
  canWrite: boolean;
  onDirty: () => void;
  onSave: (payload: Record<string, unknown>, summary: string) => void;
}) {
  const channels = SOURCING_CHANNELS.filter((channel) => Boolean(row.update?.[channel.enabled] ?? row.group[channel.enabled]));
  const enabled = new Set<Channel["enabled"]>(channels.map((channel) => channel.enabled));
  const editable = canWrite && (profile?.role === "system_admin" || profile?.role === "admin_recruiter" || (profile?.role === "site_recruiter" && (row.group.owners.includes(profile.nickname ?? "") || row.group.sites.includes(profile.site ?? ""))));
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(channels.map((channel) => [channel.count, String(row.update?.[channel.count] ?? "")])));
  const countFor = (channel: Channel) => { const raw = draft[channel.count]?.trim() ?? ""; return raw !== "" && Number.isInteger(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null; };
  const values = channels.map(countFor);
  const draftTotal = channels.length > 0 && values.every((value) => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
  const change = draftTotal !== null && previousApplicants !== null ? draftTotal - previousApplicants : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const invalid = channels.some((channel) => { const raw = draft[channel.count]?.trim() ?? ""; return raw && (!Number.isInteger(Number(raw)) || Number(raw) < 0); });
    if (invalid) { window.alert(translate(language, "applicantCountsWholeNumbers")); return; }
    const payload: Record<string, unknown> = {
      group_id: row.group.group_id,
      week_start: row.week_start,
      ...Object.fromEntries(SOURCING_CHANNELS.map((channel) => [channel.enabled, enabled.has(channel.enabled)])),
      ...Object.fromEntries(SOURCING_CHANNELS.map((channel) => [channel.count, enabled.has(channel.enabled) ? draft[channel.count]?.trim() ?? "" : null]))
    };
    if (row.update) payload.expected_updated_at = row.update.updated_at;
    onSave(payload, `${row.update ? "correct" : "create"} sourcing update - ${row.group.group_id} ${row.week_start}`);
  }

  return <form className="min-w-0" onSubmit={submit}>
    <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold text-navy">{translate(language, "sourcingChannels")}</h3><p className="mt-1 text-xs text-slate">{translate(language, "blankNotRecorded")}</p></div><div className="flex items-center gap-2"><Tag appearance="soft" tone={row.status === "saved" ? "success" : "warning"}>{translate(language, row.status === "saved" ? "recorded" : row.update ? "workspaceIncompleteWeek" : "workspaceMissingUpdate")}</Tag>{editable ? <Button type="submit" size="icon-sm" icon={<Save size={17} />} aria-label={translate(language, "saveRecord")} title={translate(language, "saveRecord")} className="!h-11 !w-11 sm:!h-9 sm:!w-9" /> : null}</div></div>
    <div data-testid="workspace-sourcing-channel-rows" className="mt-3 grid min-w-0 gap-x-5 sm:grid-cols-2 min-[1536px]:grid-cols-3">{channels.map((channel) => {
      const current = countFor(channel);
      const previous = previousUpdate?.[channel.enabled] && previousUpdate[channel.count] != null ? previousUpdate[channel.count] : null;
      const difference = current !== null && previous !== null ? current - previous : null;
      return <div key={channel.enabled} className="grid min-w-0 grid-cols-[minmax(0,1fr)_4.5rem_2.5rem] items-center gap-2 border-b border-[#E4E9F2] py-2"><label className="min-w-0 text-sm font-semibold text-navy" htmlFor={`workspace-${channel.count}`}><span className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: SOURCING_CHANNEL_COLORS[channel.enabled] }} /><span className="min-w-0 truncate" title={channel.label}>{channel.label}</span></span><span className="mt-0.5 block truncate text-[11px] font-normal text-slate">{translate(language, "sourcingVsPrevious")}: {previous ?? "—"}</span></label><TextInput id={`workspace-${channel.count}`} aria-label={channel.label} name={channel.count} type="number" min="0" step="1" inputMode="numeric" value={draft[channel.count] ?? ""} placeholder={translate(language, "notRecorded")} disabled={!editable} onChange={(event) => { setDraft((currentDraft) => ({ ...currentDraft, [channel.count]: event.target.value })); onDirty(); }} className="min-w-0 !px-2 text-right tabular-nums" /><span className={`text-right text-xs font-semibold tabular-nums ${difference === null ? "text-slate" : difference > 0 ? "text-emerald-700" : difference < 0 ? "text-danger" : "text-slate"}`}>({difference === null ? "—" : `${difference > 0 ? "+" : ""}${difference}`})</span></div>;
    })}</div>
    <div data-testid="workspace-sourcing-draft-total" className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-[#E4E9F2] pt-3"><div><p className="font-semibold text-navy">{translate(language, "sourcingDraftTotal")}</p><p className="text-xs text-slate">{draftTotal === null ? translate(language, "sourcingIncompleteTotal") : translate(language, "applicants")}</p></div><strong className="text-xl font-semibold tabular-nums text-navy">{draftTotal ?? "—"}{draftTotal !== null ? <span className="ml-2 text-sm font-medium text-slate">({change === null ? "—" : `${change > 0 ? "+" : ""}${change}`})</span> : null}</strong></div>
  </form>;
}
