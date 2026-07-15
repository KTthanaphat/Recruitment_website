import { UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OperationalSummaryStrip } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { ROLE_LABELS } from "@/lib/constants";
import { statusTone } from "@/lib/format";
import type { DashboardData, Language } from "@/types/recruitment";

export function AdminView({
  data,
  canManageUsers,
  onInvite
}: {
  language: Language;
  data: DashboardData;
  canManageUsers: boolean;
  onInvite: () => void;
}) {
  const [search, setSearch] = useState("");
  const filteredProfiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return data.profiles;
    return data.profiles.filter((profile) =>
      [profile.nickname, profile.full_name, profile.email, profile.role, profile.site]
        .some((value) => (value ?? "").toLowerCase().includes(query))
    );
  }, [data.profiles, search]);
  const usersWithoutSite = data.profiles.filter((profile) => !profile.site && profile.role === "site_recruiter").length;
  const siteRecruiters = data.profiles.filter((profile) => profile.role === "site_recruiter").length;

  if (!canManageUsers) {
    return (
      <Panel>
        <EmptyState message="Only system admins can manage app accounts." />
      </Panel>
    );
  }

  return (
    <Panel>
      <SectionTitle
        title="User Administration"
        eyebrow="Accounts and role mapping"
        action={<Button type="button" size="sm" variant="secondary" icon={<UserPlus size={16} />} onClick={onInvite}>Manage User</Button>}
      />
      <div className="mb-4 grid gap-3">
        <OperationalSummaryStrip
          items={[
            { label: "System admins", value: data.profiles.filter((profile) => profile.role === "system_admin").length, tone: "success", helper: "Full access" },
            { label: "Recruiters", value: data.profiles.filter((profile) => profile.role === "admin_recruiter").length, tone: "primary", helper: "Operational access" },
            { label: "Site recruiters", value: siteRecruiters, tone: "teal", helper: "Site-scoped users" },
            { label: "Missing site", value: usersWithoutSite, tone: usersWithoutSite > 0 ? "warning" : "success", helper: "Site recruiters only" },
            { label: "Viewers", value: data.profiles.filter((profile) => profile.role === "viewer").length, tone: "muted", helper: "Read-only access" }
          ]}
        />
        <div className="rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3 text-sm font-medium text-slate">
          Permission changes affect which records users can view and update. Confirm role and site responsibility before saving.
        </div>
        <label className="grid gap-1 text-sm font-semibold text-slate">
          Search users
          <input
            className="min-h-9 rounded-md border border-[#C9D5E6] bg-white px-3 text-sm font-medium text-navy focus:border-primary focus:outline-none"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email, role, or site"
            type="search"
          />
        </label>
      </div>
      {data.profiles.length === 0 ? (
        <EmptyState message="No readable user profiles. Confirm the first admin profile exists in Supabase." />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filteredProfiles.map((account) => (
            <div key={account.id} className="rounded-md border border-[#D7DEE8] bg-white p-3 shadow-[0_6px_16px_rgba(11,19,43,0.025)]">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-navy">{account.nickname ?? account.full_name ?? account.email ?? "User"}</strong>
                <Tag tone={statusTone(account.role)}>{ROLE_LABELS[account.role]}</Tag>
              </div>
              <p className="mt-1 text-sm font-medium text-slate">{account.email ?? "-"}</p>
              <p className="text-sm font-medium text-slate">Site: {account.site ?? "-"}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
