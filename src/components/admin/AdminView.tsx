import { UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OperationalSummaryStrip } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { statusTone } from "@/lib/format";
import { roleLabel, translate } from "@/lib/i18n/dictionary";
import type { DashboardData, Language } from "@/types/recruitment";

export function AdminView({
  language,
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
        <EmptyState message={translate(language, "onlySystemAdmins")} />
      </Panel>
    );
  }

  return (
    <Panel>
      <SectionTitle
        title={translate(language, "userAdministration")}
        eyebrow={translate(language, "accountsAndRoleMapping")}
        action={<Button type="button" size="sm" variant="secondary" icon={<UserPlus size={16} />} onClick={onInvite}>{translate(language, "manageUser")}</Button>}
      />
      <div className="mb-4 grid gap-3">
        <OperationalSummaryStrip
          items={[
            { label: translate(language, "systemAdmins"), value: data.profiles.filter((profile) => profile.role === "system_admin").length, tone: "success", helper: translate(language, "fullAccess") },
            { label: translate(language, "recruiters"), value: data.profiles.filter((profile) => profile.role === "admin_recruiter").length, tone: "primary", helper: translate(language, "operationalAccess") },
            { label: translate(language, "siteRecruiters"), value: siteRecruiters, tone: "teal", helper: translate(language, "siteScopedUsers") },
            { label: translate(language, "missingSite"), value: usersWithoutSite, tone: usersWithoutSite > 0 ? "warning" : "success", helper: translate(language, "siteRecruitersOnly") },
            { label: translate(language, "viewers"), value: data.profiles.filter((profile) => profile.role === "viewer").length, tone: "muted", helper: translate(language, "readOnlyAccess") }
          ]}
        />
        <div className="rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3 text-sm font-medium text-slate">
          {translate(language, "userPermissionWarning")}
        </div>
        <label className="grid gap-1 text-sm font-semibold text-slate">
          {translate(language, "searchUsers")}
          <input
            className="min-h-9 rounded-md border border-[#C9D5E6] bg-white px-3 text-sm font-medium text-navy focus:border-primary focus:outline-none"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={translate(language, "userSearchPlaceholder")}
            type="search"
          />
        </label>
      </div>
      {data.profiles.length === 0 ? (
        <EmptyState message={translate(language, "noReadableProfiles")} />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filteredProfiles.map((account) => (
            <div key={account.id} className="rounded-md border border-[#D7DEE8] bg-white p-3 shadow-[0_3px_10px_rgba(11,19,43,0.02)]">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-navy">{account.nickname ?? account.full_name ?? account.email ?? translate(language, "user")}</strong>
                <Tag tone={statusTone(account.role)}>{roleLabel(language, account.role)}</Tag>
              </div>
              <p className="mt-1 text-sm font-medium text-slate">{account.email ?? "-"}</p>
              <p className="text-sm font-medium text-slate">{translate(language, "siteValue", { site: account.site ?? "-" })}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
