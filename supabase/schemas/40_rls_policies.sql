-- Canonical declarative schema source. Edit this file set, not historical migrations.

alter table public.profiles enable row level security;
alter table public.requisitions enable row level security;
alter table public.requisition_logs enable row level security;
alter table public.position_groups enable row level security;
alter table public.document_groups enable row level security;
alter table public.candidates enable row level security;
alter table public.recruitment_logs enable row level security;
alter table public.offers enable row level security;
alter table public.sourcing_weekly_updates enable row level security;
alter table public.vacancy_weekly_snapshots enable row level security;
alter table public.change_logs enable row level security;

drop policy if exists profiles_select_self_or_admin on public.profiles;
drop policy if exists profiles_select_self_or_recruiter_admin on public.profiles;
create policy profiles_select_self_or_recruiter_admin on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or app_private.current_app_role() in ('system_admin', 'admin_recruiter')
);

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update to authenticated
using (app_private.is_system_admin())
with check (app_private.is_system_admin());

drop policy if exists requisitions_read on public.requisitions;
create policy requisitions_read on public.requisitions
for select to authenticated
using (
  app_private.is_global_recruitment_reader()
  or (
    app_private.current_app_role() = 'site_recruiter'
    and site = app_private.current_profile_site()
  )
);

drop policy if exists requisition_logs_read on public.requisition_logs;
create policy requisition_logs_read on public.requisition_logs
for select to authenticated
using (app_private.can_read_requisition(doc_id));

drop policy if exists position_groups_read on public.position_groups;
create policy position_groups_read on public.position_groups
for select to authenticated
using (app_private.is_recruitment_reader());

drop policy if exists document_groups_read on public.document_groups;
create policy document_groups_read on public.document_groups
for select to authenticated
using (app_private.can_read_requisition(doc_id));

drop policy if exists candidates_read on public.candidates;
create policy candidates_read on public.candidates
for select to authenticated
using (
  exists (
    select 1
    from public.document_groups dg
    where dg.doc_group_id = candidates.doc_group_id
      and app_private.can_read_requisition(dg.doc_id)
  )
);

drop policy if exists recruitment_logs_read on public.recruitment_logs;
create policy recruitment_logs_read on public.recruitment_logs
for select to authenticated
using (
  exists (
    select 1
    from public.candidates c
    join public.document_groups dg on dg.doc_group_id = c.doc_group_id
    where c.candidate_id = recruitment_logs.candidate_id
      and app_private.can_read_requisition(dg.doc_id)
  )
);

drop policy if exists offers_read on public.offers;
create policy offers_read on public.offers
for select to authenticated
using (app_private.can_read_requisition(doc_id));

drop policy if exists sourcing_weekly_updates_read on public.sourcing_weekly_updates;
create policy sourcing_weekly_updates_read on public.sourcing_weekly_updates
for select to authenticated
using (app_private.can_read_sourcing_group(group_id));

drop policy if exists vacancy_weekly_snapshots_read on public.vacancy_weekly_snapshots;
create policy vacancy_weekly_snapshots_read on public.vacancy_weekly_snapshots
for select to authenticated
using (
  app_private.is_global_recruitment_reader()
  or (
    app_private.current_app_role() = 'site_recruiter'
    and site = app_private.current_profile_site()
  )
);

drop policy if exists change_logs_read on public.change_logs;
create policy change_logs_read on public.change_logs
for select to authenticated
using (app_private.is_global_recruitment_reader());
