import { Link2, Plus, Save } from "lucide-react";
import { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, TextInput } from "@/components/ui/Field";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { SOURCING_CHANNELS } from "@/lib/constants";
import { enrichSourcingGroups } from "@/lib/data";
import { translate } from "@/lib/i18n/dictionary";
import type { DashboardData, EnrichedSourcingGroup, Language, Profile } from "@/types/recruitment";

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
  onMatch
}: {
  language: Language;
  data: DashboardData;
  profile: Profile | null;
  canWrite: boolean;
  canManageSetup: boolean;
  weekStart: string;
  onWeekChange: (value: string) => void;
  onSaveSourcing: (payload: Record<string, unknown>, summary: string) => void;
  onGroup: () => void;
  onMatch: () => void;
}) {
  const groups = visibleSourcingGroups(enrichSourcingGroups(data, weekStart), profile);

  function saveGroup(event: FormEvent<HTMLFormElement>, group: EnrichedSourcingGroup) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      group_id: group.group_id,
      week_start: weekStart,
      ...Object.fromEntries(SOURCING_CHANNELS.flatMap((channel) => {
        const isMarked = Boolean(group[channel.enabled]);
        return [
          [channel.enabled, isMarked && formData.has(channel.enabled)],
          [channel.count, isMarked ? numericValue(formData.get(channel.count)) : 0]
        ];
      }))
    };
    onSaveSourcing(payload, `sourcing update - ${group.group_id}`);
  }

  return (
    <div className="grid gap-4">
      {canManageSetup ? (
        <Panel>
          <SectionTitle
            title="Sourcing Setup"
            eyebrow="Groups and requisition matching"
            action={
              <>
                <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onGroup}>New Group</Button>
                <Button type="button" size="sm" variant="secondary" icon={<Link2 size={16} />} onClick={onMatch}>Add Match</Button>
              </>
            }
          />
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle
          title="Weekly Sourcing Updates"
          eyebrow="Open requisition groups"
          action={
            <Field label="Week Start">
              <TextInput type="date" value={weekStart} onChange={(event) => onWeekChange(event.target.value)} />
            </Field>
          }
        />
        {groups.length === 0 ? (
          <EmptyState message="No unfilled sourcing groups match your responsibility." />
        ) : (
          <div className="grid gap-3">
            {groups.map((group) => {
              const markedChannels = SOURCING_CHANNELS.filter((channel) => group[channel.enabled]);
              return (
              <form key={group.group_id} className="rounded-lg border border-[#D7DEE8] bg-white p-4" onSubmit={(event) => saveGroup(event, group)}>
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-lg text-navy">{group.group_id}</strong>
                      <Tag tone="teal">{group.group_position}</Tag>
                      <Tag tone="warning">{group.open_headcount} open</Tag>
                    </div>
                    <p className="mt-1 text-sm font-bold text-slate">
                      Docs: {group.doc_ids.join(", ")} | Sites: {group.sites.join(", ")} | Owners: {group.owners.join(", ")}
                    </p>
                    <p className="mt-1 text-xs font-bold text-cool">
                      Candidates: {group.candidate_count} | Last saved: {group.latest_update?.updated_at?.slice(0, 10) ?? "Not updated this week"}
                    </p>
                  </div>
                  {canWrite ? (
                    <Button type="submit" size="sm" icon={<Save size={16} />}>Save Week</Button>
                  ) : (
                    <Tag tone="muted">{translate(language, "readonly")}</Tag>
                  )}
                </div>

                {markedChannels.length === 0 ? (
                  <p className="rounded-md bg-lightgray p-3 text-sm font-bold text-slate">{translate(language, "noMarkedSourcingChannels")}</p>
                ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {markedChannels.map((channel) => (
                    <div key={channel.count} className="rounded-md bg-lightgray p-3">
                      <label className="mb-3 flex items-center gap-2 text-sm font-extrabold text-navy">
                        <input
                          name={channel.enabled}
                          type="checkbox"
                          defaultChecked={Boolean(group.latest_update?.[channel.enabled] ?? group[channel.enabled])}
                          disabled={!canWrite}
                        />
                        {channel.label}
                      </label>
                      <Field label="Applicants">
                        <TextInput
                          name={channel.count}
                          type="number"
                          min={0}
                          defaultValue={String(group.latest_update?.[channel.count] ?? 0)}
                          readOnly={!canWrite}
                        />
                      </Field>
                    </div>
                  ))}
                </div>
                )}
              </form>
              );
            })}
          </div>
        )}
      </Panel>

    </div>
  );
}

function visibleSourcingGroups(groups: EnrichedSourcingGroup[], profile: Profile | null) {
  if (profile?.role !== "site_recruiter") return groups;
  const nickname = profile.nickname ?? profile.full_name ?? "";
  return groups.filter((group) => group.owners.includes(nickname));
}

function numericValue(value: FormDataEntryValue | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
