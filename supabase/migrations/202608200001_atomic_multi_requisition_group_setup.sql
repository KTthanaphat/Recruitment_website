-- A normal New Group must be immediately visible to its responsible recruiter.
-- Create the group and every requisition link in one transaction.
create or replace function public.app_create_and_match_sourcing_group_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_group_position text := nullif(btrim(payload ->> 'group_position'), '');
  v_doc_ids text[];
  v_group_id text;
  v_doc_group_ids text[] := array[]::text[];
  v_site_count integer;
  v_invalid_count integer;
  v_doc_id text;
  v_doc_group_id text;
begin
  perform app_private.assert_recruitment_writer();
  if v_group_position is null then
    raise exception 'SOURCING_GROUP_POSITION_REQUIRED: Group Position is required.';
  end if;
  if jsonb_typeof(payload -> 'doc_ids') <> 'array' then
    raise exception 'SOURCING_GROUP_REQUISITIONS_REQUIRED: Select at least one requisition.';
  end if;

  select array_agg(doc_id order by doc_id)
    into v_doc_ids
  from (
    select nullif(btrim(value), '') as doc_id
    from jsonb_array_elements_text(payload -> 'doc_ids') as item(value)
  ) ids
  where doc_id is not null;

  if coalesce(array_length(v_doc_ids, 1), 0) = 0
    or cardinality(v_doc_ids) <> cardinality(array(select distinct unnest(v_doc_ids))) then
    raise exception 'SOURCING_GROUP_REQUISITIONS_INVALID: Select one or more distinct requisitions.';
  end if;

  select count(distinct r.site), count(*) filter (where r.doc_id is null
      or r.status <> 'ongoing'
      or coalesce((select count(*) from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null), 0) >= r.head_count
      or exists (select 1 from public.document_groups dg where dg.doc_id = r.doc_id)
      or not app_private.can_manage_requisition(r.doc_id))
    into v_site_count, v_invalid_count
  from unnest(v_doc_ids) requested(doc_id)
  left join public.requisitions r on r.doc_id = requested.doc_id;

  if v_site_count <> 1 then
    raise exception 'SOURCING_GROUP_SITE_MISMATCH: Group ID can only be matched to requisitions at one site.';
  end if;
  if v_invalid_count > 0 then
    raise exception 'SOURCING_GROUP_REQUISITION_DENIED: Every requisition must exist, be open, unmatched, and be manageable by you.';
  end if;

  v_group_id := app_private.next_app_id('position_groups', 'GRP');
  perform set_config('app.action', 'position_group:create_and_match', true);
  insert into public.position_groups (
    group_id, group_position,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_jobbkk,
    channel_linkedin, channel_walkin, channel_referral, channel_others
  ) values (
    v_group_id, v_group_position,
    coalesce((payload ->> 'channel_fb')::boolean, false),
    coalesce((payload ->> 'channel_jobthai')::boolean, false),
    coalesce((payload ->> 'channel_jobtopgun')::boolean, false),
    coalesce((payload ->> 'channel_jobdb')::boolean, false),
    coalesce((payload ->> 'channel_jobbkk')::boolean, false),
    coalesce((payload ->> 'channel_linkedin')::boolean, false),
    coalesce((payload ->> 'channel_walkin')::boolean, false),
    coalesce((payload ->> 'channel_referral')::boolean, false),
    coalesce((payload ->> 'channel_others')::boolean, false)
  );

  foreach v_doc_id in array v_doc_ids loop
    v_doc_group_id := app_private.next_app_id('document_groups', 'DGRP');
    insert into public.document_groups (
      doc_group_id, doc_id, group_id, group_position,
      channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_jobbkk,
      channel_linkedin, channel_walkin, channel_referral, channel_others
    )
    select v_doc_group_id, v_doc_id, group_id, group_position,
      channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_jobbkk,
      channel_linkedin, channel_walkin, channel_referral, channel_others
    from public.position_groups where group_id = v_group_id;
    v_doc_group_ids := array_append(v_doc_group_ids, v_doc_group_id);
  end loop;

  return jsonb_build_object('ok', true, 'id', v_group_id, 'doc_group_ids', to_jsonb(v_doc_group_ids));
end;
$$;

revoke all on function public.app_create_and_match_sourcing_group_v2(jsonb) from public, anon;
grant execute on function public.app_create_and_match_sourcing_group_v2(jsonb) to authenticated;

create or replace function public.app_upsert_requisition(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_exists boolean;
  v_status text := coalesce(nullif(payload ->> 'status', ''), 'ongoing');
  v_role text := app_private.current_app_role();
  v_site text := nullif(payload ->> 'site', '');
  v_person_in_charge text := nullif(payload ->> 'person_in_charge', '');
  v_request_type text := coalesce(nullif(payload ->> 'request_type', ''), 'New');
  v_replacement_names text := nullif(payload ->> 'replacement_names', '');
  v_head_count integer := coalesce(nullif(payload ->> 'head_count', '')::integer, 1);
  v_replacement_count integer;
begin
  perform app_private.assert_recruitment_writer();
  if v_doc_id is null then raise exception 'Doc ID is required.'; end if;
  if v_mode not in ('new', 'change') then raise exception 'mode must be new or change'; end if;
  if v_status not in ('ongoing', 'cancel') then raise exception 'Requisition status can only be ongoing or cancel. Filled is automatic.'; end if;
  if v_head_count < 1 then raise exception 'Headcount must be at least 1.'; end if;
  if v_request_type not in ('New', 'Replacement') then raise exception 'Request type must be New or Replacement.'; end if;
  if v_request_type = 'Replacement' then
    if v_replacement_names is null then raise exception 'Replacement names are required for replacement requisitions.'; end if;
    select count(*) into v_replacement_count
    from regexp_split_to_table(v_replacement_names, E'\\r?\\n') as name(value)
    where btrim(value) <> '';
    if v_replacement_count <> v_head_count then
      raise exception 'Replacement name count must match Headcount.';
    end if;
  else
    v_replacement_names := null;
  end if;

  if v_role = 'site_recruiter' then
    v_site := app_private.current_profile_site();
    v_person_in_charge := app_private.current_profile_nickname();
    if v_site is null or v_person_in_charge is null then raise exception 'Site recruiter accounts require assigned site and nickname.'; end if;
  end if;

  select exists(select 1 from public.requisitions where doc_id = v_doc_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Requisition Doc ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Requisition Doc ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_requisition(v_doc_id) then raise exception 'You can edit only requisitions where you are person in charge.'; end if;

  perform set_config('app.action', 'requisition:' || v_mode, true);
  insert into public.requisitions (doc_id, pr_approved_date, site, position, department, section, level, head_count, person_in_charge, line_manager, request_type, replacement_names, status)
  values (v_doc_id, nullif(payload ->> 'pr_approved_date', '')::date, v_site, nullif(payload ->> 'position', ''), nullif(payload ->> 'department', ''), nullif(payload ->> 'section', ''), nullif(payload ->> 'level', ''), v_head_count, v_person_in_charge, nullif(payload ->> 'line_manager', ''), v_request_type, v_replacement_names, v_status)
  on conflict (doc_id) do update set
    pr_approved_date = excluded.pr_approved_date, site = excluded.site, position = excluded.position, department = excluded.department,
    section = excluded.section, level = excluded.level, head_count = excluded.head_count, person_in_charge = excluded.person_in_charge,
    line_manager = excluded.line_manager, request_type = excluded.request_type, replacement_names = excluded.replacement_names, status = excluded.status;

  perform set_config('app.action', 'auto-status', true);
  perform app_private.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_doc_id);
end;
$$;
