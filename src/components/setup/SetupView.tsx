import { Link2, Plus, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PAGE_SIZE_OPTIONS, Pagination, paginateRows } from "@/components/ui/Pagination";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { SortableFilterHeader, type TableColumn, useTableControls } from "@/components/ui/TableControls";
import { Tag } from "@/components/ui/Tag";
import { ROLE_LABELS, SOURCING_CHANNELS } from "@/lib/constants";
import { formatDate, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { DashboardData, Language, Profile } from "@/types/recruitment";

export function SetupView({
  language,
  data,
  canManageSetup,
  canManageUsers,
  onGroup,
  onMatch,
  onInvite
}: {
  language: Language;
  data: DashboardData;
  canManageSetup: boolean;
  canManageUsers: boolean;
  onGroup: () => void;
  onMatch: () => void;
  onInvite: () => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const columns: TableColumn<Profile>[] = [
    { key: "email", label: "Email", value: (profile) => profile.email ?? "-" },
    { key: "nickname", label: "Nickname", value: (profile) => profile.nickname ?? profile.full_name ?? "-" },
    { key: "site", label: "Site", value: (profile) => profile.site ?? "-" },
    { key: "role", label: "Role", value: (profile) => ROLE_LABELS[profile.role], sortValue: (profile) => profile.role },
    { key: "updated", label: "Updated", value: (profile) => formatDate(profile.updated_at, language), sortValue: (profile) => profile.updated_at ?? "" }
  ];
  const table = useTableControls(data.profiles, columns);
  const paginatedProfiles = paginateRows(table.controlledRows, page, pageSize);

  useEffect(() => {
    setPage(1);
  }, [data.profiles.length, pageSize, table.controlledRows.length, table.filters, table.sortDirection, table.sortKey]);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel>
        <SectionTitle
          title="Position Groups"
          action={canManageSetup ? <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onGroup}>New Group</Button> : null}
        />
        <div className="grid gap-2">
          {data.position_groups.length === 0 ? (
            <EmptyState message="No position groups yet." />
          ) : (
            data.position_groups.map((group) => (
              <div key={group.group_id} className="rounded-md border border-[#D7DEE8] bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-navy">{group.group_id}</strong>
                  <Tag tone="teal">{group.group_position}</Tag>
                </div>
                <p className="mt-2 text-sm font-bold text-slate">
                  {SOURCING_CHANNELS.map((channel) => group[channel.enabled] && channel.label)
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
          action={canManageSetup ? <Button type="button" size="sm" icon={<Link2 size={16} />} onClick={onMatch}>Add Match</Button> : null}
        />
        <div className="grid gap-2">
          {data.document_groups.length === 0 ? (
            <EmptyState message="No requisition-group matches yet." />
          ) : (
            data.document_groups.map((match) => (
              <div key={match.doc_group_id} className="rounded-md border border-[#D7DEE8] bg-white p-3 shadow-sm">
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
          eyebrow={canManageUsers ? "System Admin" : translate(language, "adminOnly")}
          action={canManageUsers ? <Button type="button" size="sm" icon={<UserPlus size={16} />} onClick={onInvite}>Manage User</Button> : null}
        />
        {data.profiles.length === 0 ? (
          <EmptyState message="No readable user profiles. Confirm the first admin profile exists in Supabase." />
        ) : (
          <div className="table-scroll">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-lightgray text-xs uppercase text-slate">
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} scope="col" className="min-w-[148px] px-3 py-3 align-top">
                      <SortableFilterHeader
                        columnKey={column.key}
                        label={column.label}
                        filterValue={table.filters[column.key] ?? ""}
                        onFilter={table.setFilter}
                        onSort={table.toggleSort}
                        sortDirection={table.sortDirection}
                        sortKey={table.sortKey}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginatedProfiles.rows.map((profile) => (
                  <tr key={profile.id} className="border-b border-[#D7DEE8] last:border-0">
                    <td className="px-3 py-3 font-bold text-navy">{profile.email ?? "-"}</td>
                    <td className="px-3 py-3 text-slate">{profile.nickname ?? profile.full_name ?? "-"}</td>
                    <td className="px-3 py-3 text-slate">{profile.site ?? "-"}</td>
                    <td className="px-3 py-3"><Tag tone={statusTone(profile.role)}>{ROLE_LABELS[profile.role]}</Tag></td>
                    <td className="px-3 py-3 text-slate">{formatDate(profile.updated_at, language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination language={language} page={paginatedProfiles.page} pageSize={pageSize} totalRows={table.controlledRows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </Panel>
    </div>
  );
}
