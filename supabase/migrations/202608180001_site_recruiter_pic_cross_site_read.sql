-- Site Recruiters may read requisitions they own, regardless of the assigned
-- site. Write permissions remain restricted by can_manage_requisition.
create or replace function app_private.can_read_requisition(p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    app_private.is_global_recruitment_reader()
    or (
      app_private.current_app_role() = 'site_recruiter'
      and exists (
        select 1
        from public.requisitions r
        where r.doc_id = p_doc_id
          and (
            r.site = app_private.current_profile_site()
            or r.person_in_charge = app_private.current_profile_nickname()
          )
      )
    )
$$;

drop policy if exists requisitions_read on public.requisitions;
create policy requisitions_read on public.requisitions
for select to authenticated
using (
  app_private.is_global_recruitment_reader()
  or (
    app_private.current_app_role() = 'site_recruiter'
    and (
      site = app_private.current_profile_site()
      or person_in_charge = app_private.current_profile_nickname()
    )
  )
);
