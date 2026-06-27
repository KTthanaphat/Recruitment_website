import { Link2, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { DashboardData, Language } from "@/types/recruitment";

export function SetupView({
  language,
  data,
  canWrite,
  canAdmin,
  onGroup,
  onMatch,
  onInvite
}: {
  language: Language;
  data: DashboardData;
  canWrite: boolean;
  canAdmin: boolean;
  onGroup: () => void;
  onMatch: () => void;
  onInvite: () => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel>
        <SectionTitle
          title="Position Groups"
          action={canWrite ? <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onGroup}>New Group</Button> : null}
        />
        <div className="grid gap-2">
          {data.position_groups.length === 0 ? (
            <EmptyState message="No position groups yet." />
          ) : (
            data.position_groups.map((group) => (
              <div key={group.group_id} className="rounded-md border border-[#D7DEE8] p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-navy">{group.group_id}</strong>
                  <Tag tone="teal">{group.group_position}</Tag>
                </div>
                <p className="mt-2 text-sm font-bold text-slate">
                  {[group.channel_fb && "Facebook", group.channel_jobthai && "JobThai", group.channel_jobtopgun && "JobTopGun", group.channel_jobdb && "JobDB"]
                    .filter(Boolean)
                    .join(" · ") || "No sourcing channels"}
                </p>
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          title="Requisition Matches"
          action={canWrite ? <Button type="button" size="sm" icon={<Link2 size={16} />} onClick={onMatch}>Add Match</Button> : null}
        />
        <div className="grid gap-2">
          {data.document_groups.length === 0 ? (
            <EmptyState message="No requisition-group matches yet." />
          ) : (
            data.document_groups.map((match) => (
              <div key={match.doc_group_id} className="rounded-md border border-[#D7DEE8] p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-navy">{match.doc_group_id}</strong>
                  <Tag tone="primary">{match.doc_id}</Tag>
                </div>
                <p className="mt-2 text-sm font-bold text-slate">{match.group_position} · {match.group_id ?? "Legacy group"}</p>
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel className="xl:col-span-2">
        <SectionTitle
          title="Users and Roles"
          eyebrow={canAdmin ? "Admin" : translate(language, "adminOnly")}
          action={canAdmin ? <Button type="button" size="sm" icon={<UserPlus size={16} />} onClick={onInvite}>Create User</Button> : null}
        />
        {data.profiles.length === 0 ? (
          <EmptyState message="No readable user profiles. Confirm the first admin profile exists in Supabase." />
        ) : (
          <div className="table-scroll">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-lightgray text-xs uppercase text-slate">
                <tr>
                  <th className="px-3 py-3">Email</th>
                  <th className="px-3 py-3">Name</th>
                  <th className="px-3 py-3">Role</th>
                  <th className="px-3 py-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.profiles.map((profile) => (
                  <tr key={profile.id} className="border-b border-[#D7DEE8] last:border-0">
                    <td className="px-3 py-3 font-bold text-navy">{profile.email ?? "-"}</td>
                    <td className="px-3 py-3 text-slate">{profile.full_name ?? "-"}</td>
                    <td className="px-3 py-3"><Tag tone={statusTone(profile.role) as never}>{profile.role}</Tag></td>
                    <td className="px-3 py-3 text-slate">{profile.updated_at.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
