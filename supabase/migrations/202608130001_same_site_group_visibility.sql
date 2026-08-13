-- Same-site sourcing group visibility and ownership.
-- Preflight: groups below must be split/rematched before this migration can be applied.
do $$
declare
  v_conflicts text;
begin
  select string_agg(group_id, ', ' order by group_id) into v_conflicts
  from (
    select dg.group_id
    from public.document_groups dg
    join public.requisitions r on r.doc_id = dg.doc_id
    where dg.group_id is not null
    group by dg.group_id
    having count(distinct r.site) > 1
  ) conflicts;
  if v_conflicts is not null then
    raise exception 'GROUP_SITE_CONFLICT: remediate cross-site group IDs before migration: %', v_conflicts;
  end if;
end;
$$;

create or replace function app_private.can_read_position_group(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select app_private.current_app_role() in ('system_admin', 'admin_recruiter')
    or exists (
      select 1 from public.document_groups dg
      where dg.group_id = p_group_id
        and app_private.can_read_requisition(dg.doc_id)
    )
$$;

create or replace function app_private.can_read_sourcing_group(p_group_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select app_private.can_read_position_group(p_group_id)
$$;

create or replace function app_private.assert_group_site_match(p_group_id text, p_doc_id text)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_site text;
begin
  if p_group_id is null then return; end if;
  select site into v_site from public.requisitions where doc_id = p_doc_id;
  if v_site is null then raise exception 'Requisition does not exist.'; end if;
  if exists (
    select 1 from public.document_groups dg join public.requisitions r on r.doc_id = dg.doc_id
    where dg.group_id = p_group_id and r.site is distinct from v_site
  ) then raise exception 'Group ID can only be matched to requisitions at one site.'; end if;
end;
$$;

create or replace function app_private.enforce_document_group_site()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform app_private.assert_group_site_match(new.group_id, new.doc_id);
  return new;
end;
$$;

drop trigger if exists enforce_document_group_site on public.document_groups;
create trigger enforce_document_group_site before insert or update of doc_id, group_id on public.document_groups
for each row execute function app_private.enforce_document_group_site();

drop policy if exists position_groups_read on public.position_groups;
create policy position_groups_read on public.position_groups for select to authenticated
using (app_private.can_read_position_group(group_id));

create or replace function public.app_create_group_match(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_doc_group_id text;
  v_group public.position_groups%rowtype;
begin
  perform app_private.assert_recruitment_writer();
  if v_doc_id is null or not exists(select 1 from public.requisitions where doc_id = v_doc_id) then raise exception 'Requisition does not exist.'; end if;
  if not app_private.can_manage_requisition(v_doc_id) then raise exception 'You can match only requisitions where you are person in charge.'; end if;
  select * into v_group from public.position_groups where group_id = v_group_id;
  if not found then raise exception 'Group ID does not exist.'; end if;
  if exists(select 1 from public.document_groups where doc_id = v_doc_id) then raise exception 'This requisition is already matched.'; end if;
  perform app_private.assert_group_site_match(v_group_id, v_doc_id);
  v_doc_group_id := app_private.next_app_id('document_groups', 'DGRP');
  perform set_config('app.action', 'document_group:new', true);
  insert into public.document_groups (doc_group_id, doc_id, group_id, group_position, channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_linkedin, channel_walkin, channel_referral, channel_others)
  values (v_doc_group_id, v_doc_id, v_group_id, v_group.group_position, v_group.channel_fb, v_group.channel_jobthai, v_group.channel_jobtopgun, v_group.channel_jobdb, v_group.channel_linkedin, v_group.channel_walkin, v_group.channel_referral, v_group.channel_others);
  return jsonb_build_object('ok', true, 'id', v_doc_group_id);
end;
$$;

create or replace function public.app_create_and_match_sourcing_group(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_group_position text := nullif(payload ->> 'group_position', '');
  v_group_id text;
  v_doc_group_id text;
begin
  perform app_private.assert_recruitment_writer();
  if v_doc_id is null or not exists(select 1 from public.requisitions where doc_id = v_doc_id) then raise exception 'Requisition does not exist.'; end if;
  if not app_private.can_manage_requisition(v_doc_id) then raise exception 'You can create and match only requisitions where you are person in charge.'; end if;
  if v_group_position is null then raise exception 'Group Position is required.'; end if;
  if exists(select 1 from public.document_groups where doc_id = v_doc_id) then raise exception 'This requisition is already matched.'; end if;
  if not exists (
    select 1 from public.requisitions r left join lateral (
      select count(*)::integer as accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null
    ) accepted on true
    where r.doc_id = v_doc_id and r.status = 'ongoing' and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
  ) then raise exception 'Requisition must be ongoing with open headcount.'; end if;
  v_group_id := app_private.next_app_id('position_groups', 'GRP');
  v_doc_group_id := app_private.next_app_id('document_groups', 'DGRP');
  perform set_config('app.action', 'position_group:create_and_match', true);
  insert into public.position_groups (group_id, group_position, channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_linkedin, channel_walkin, channel_referral, channel_others)
  values (v_group_id, v_group_position, coalesce((payload ->> 'channel_fb')::boolean, false), coalesce((payload ->> 'channel_jobthai')::boolean, false), coalesce((payload ->> 'channel_jobtopgun')::boolean, false), coalesce((payload ->> 'channel_jobdb')::boolean, false), coalesce((payload ->> 'channel_linkedin')::boolean, false), coalesce((payload ->> 'channel_walkin')::boolean, false), coalesce((payload ->> 'channel_referral')::boolean, false), coalesce((payload ->> 'channel_others')::boolean, false));
  insert into public.document_groups (doc_group_id, doc_id, group_id, group_position, channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_linkedin, channel_walkin, channel_referral, channel_others)
  select v_doc_group_id, v_doc_id, v_group_id, group_position, channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_linkedin, channel_walkin, channel_referral, channel_others from public.position_groups where group_id = v_group_id;
  return jsonb_build_object('ok', true, 'id', v_group_id, 'doc_group_id', v_doc_group_id);
end;
$$;

revoke all on function public.app_create_and_match_sourcing_group(jsonb) from public, anon, authenticated;
grant execute on function public.app_create_and_match_sourcing_group(jsonb) to authenticated;
