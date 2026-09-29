-- Permit System Admins and Admin Recruiters to add cross-site requisitions to a sourcing group.
-- Site Recruiters may add requisitions from any site already represented by that group.
create or replace function app_private.assert_group_site_match(p_group_id text, p_doc_id text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site text;
begin
  if p_group_id is null then return; end if;
  select site into v_site from public.requisitions where doc_id = p_doc_id;
  if v_site is null then raise exception 'Requisition does not exist.'; end if;
  if app_private.current_app_role() in ('system_admin', 'admin_recruiter') then return; end if;
  if not exists (select 1 from public.document_groups where group_id = p_group_id) then return; end if;
  if exists (
    select 1
    from public.document_groups dg
    join public.requisitions r on r.doc_id = dg.doc_id
    where dg.group_id = p_group_id
      and r.site = v_site
  ) then
    return;
  else
    raise exception 'Group ID can only be matched to requisitions at one site.';
  end if;
end;
$$;

create or replace function app_private.enforce_document_group_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_private.assert_group_site_match(new.group_id, new.doc_id);
  return new;
end;
$$;

drop trigger if exists enforce_document_group_site on public.document_groups;
create trigger enforce_document_group_site
before insert or update of doc_id, group_id on public.document_groups
for each row execute function app_private.enforce_document_group_site();
