import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
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
      {data.profiles.length === 0 ? (
        <EmptyState message="No readable user profiles. Confirm the first admin profile exists in Supabase." />
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
      )}
    </Panel>
  );
}
