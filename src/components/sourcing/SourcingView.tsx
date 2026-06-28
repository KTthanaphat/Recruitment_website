import { BarChart3, Link2, Plus, Save, UserPlus } from "lucide-react";
import { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, TextInput } from "@/components/ui/Field";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { ROLE_LABELS } from "@/lib/constants";
import { enrichSourcingGroups } from "@/lib/data";
import { statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { DashboardData, EnrichedSourcingGroup, Language, Profile } from "@/types/recruitment";

const channelFields = [
  { enabled: "channel_fb", count: "applicants_fb", label: "Facebook" },
  { enabled: "channel_jobthai", count: "applicants_jobthai", label: "JobThai" },
  { enabled: "channel_jobtopgun", count: "applicants_jobtopgun", label: "JobTopGun" },
  { enabled: "channel_jobdb", count: "applicants_jobdb", label: "JobDB" }
] as const;

export function SourcingView({
  language,
  data,
  profile,
  canWrite,
  canManageSetup,
  canManageUsers,
  canManageSnapshots,
  weekStart,
  onWeekChange,
  onSaveSourcing,
  onGroup,
  onMatch,
  onInvite,
  onSnapshot
}: {
  language: Language;
  data: DashboardData;
  profile: Profile | null;
  canWrite: boolean;
  canManageSetup: boolean;
  canManageUsers: boolean;
  canManageSnapshots: boolean;
  weekStart: string;
  onWeekChange: (value: string) => void;
  onSaveSourcing: (payload: Record<string, unknown>, summary: string) => void;
  onGroup: () => void;
  onMatch: () => void;
  onInvite: () => void;
  onSnapshot: () => void;
}) {
  const groups = visibleSourcingGroups(enrichSourcingGroups(data, weekStart), profile);
  const canUseAdminTools = canManageSetup || canManageUsers || canManageSnapshots;

  function saveGroup(event: FormEvent<HTMLFormElement>, group: EnrichedSourcingGroup) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      group_id: group.group_id,
      week_start: weekStart,
      channel_fb: formData.has("channel_fb"),
      channel_jobthai: formData.has("channel_jobthai"),
      channel_jobtopgun: formData.has("channel_jobtopgun"),
      channel_jobdb: formData.has("channel_jobdb"),
      applicants_fb: numericValue(formData.get("applicants_fb")),
      applicants_jobthai: numericValue(formData.get("applicants_jobthai")),
      applicants_jobtopgun: numericValue(formData.get("applicants_jobtopgun")),
      applicants_jobdb: numericValue(formData.get("applicants_jobdb"))
    };
    onSaveSourcing(payload, `sourcing update - ${group.group_id}`);
  }

  return (
    <div className="grid gap-4">
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
            {groups.map((group) => (
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

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {channelFields.map((channel) => (
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
              </form>
            ))}
          </div>
        )}
      </Panel>

      {canUseAdminTools ? (
        <Panel>
          <SectionTitle title="Administration" eyebrow="Setup and snapshots" />
          <div className="flex flex-wrap gap-2">
            {canManageSetup ? <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onGroup}>New Group</Button> : null}
            {canManageSetup ? <Button type="button" size="sm" variant="secondary" icon={<Link2 size={16} />} onClick={onMatch}>Add Match</Button> : null}
            {canManageUsers ? <Button type="button" size="sm" variant="secondary" icon={<UserPlus size={16} />} onClick={onInvite}>Manage User</Button> : null}
            {canManageSnapshots ? <Button type="button" size="sm" variant="secondary" icon={<BarChart3 size={16} />} onClick={onSnapshot}>Vacancy Snapshot</Button> : null}
          </div>

          {canManageUsers && data.profiles.length > 0 ? (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {data.profiles.map((account) => (
                <div key={account.id} className="rounded-md border border-[#D7DEE8] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-navy">{account.nickname ?? account.full_name ?? account.email ?? "User"}</strong>
                    <Tag tone={statusTone(account.role)}>{ROLE_LABELS[account.role]}</Tag>
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate">{account.email ?? "-"}</p>
                  <p className="text-sm font-bold text-slate">Site: {account.site ?? "-"}</p>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
      ) : null}
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
