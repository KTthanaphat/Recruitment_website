create or replace function public.app_upsert_position_group(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_exists boolean;
begin
  perform public.assert_recruitment_writer();
  if v_mode not in ('new', 'change') then
    raise exception 'mode must be new or change';
  end if;
  if v_mode = 'new' then
    v_group_id := public.next_app_id('position_groups', 'GRP');
  elsif v_group_id is null then
    raise exception 'Group ID is required in Change mode.';
  end if;

  select exists(select 1 from public.position_groups where group_id = v_group_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Group ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Group ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not public.can_manage_sourcing_group(v_group_id) then
    raise exception 'You can edit only sourcing groups linked to requisitions where you are responsible.';
  end if;

  perform set_config('app.action', 'position_group:' || v_mode, true);
  insert into public.position_groups (
    group_id, group_position,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb,
    channel_linkedin, channel_walkin, channel_referral, channel_others
  )
  values (
    v_group_id,
    nullif(payload ->> 'group_position', ''),
    coalesce((payload ->> 'channel_fb')::boolean, false),
    coalesce((payload ->> 'channel_jobthai')::boolean, false),
    coalesce((payload ->> 'channel_jobtopgun')::boolean, false),
    coalesce((payload ->> 'channel_jobdb')::boolean, false),
    coalesce((payload ->> 'channel_linkedin')::boolean, false),
    coalesce((payload ->> 'channel_walkin')::boolean, false),
    coalesce((payload ->> 'channel_referral')::boolean, false),
    coalesce((payload ->> 'channel_others')::boolean, false)
  )
  on conflict (group_id) do update set
    group_position = excluded.group_position,
    channel_fb = excluded.channel_fb,
    channel_jobthai = excluded.channel_jobthai,
    channel_jobtopgun = excluded.channel_jobtopgun,
    channel_jobdb = excluded.channel_jobdb,
    channel_linkedin = excluded.channel_linkedin,
    channel_walkin = excluded.channel_walkin,
    channel_referral = excluded.channel_referral,
    channel_others = excluded.channel_others;

  return jsonb_build_object('ok', true, 'id', v_group_id);
end;
$$;

create or replace function public.app_create_group_match(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_doc_group_id text;
  v_group public.position_groups%rowtype;
begin
  perform public.assert_recruitment_writer();
  if v_doc_id is null or not exists(select 1 from public.requisitions where doc_id = v_doc_id) then
    raise exception 'Requisition does not exist.';
  end if;
  if not public.can_manage_requisition(v_doc_id) then
    raise exception 'You can match only requisitions where you are person in charge.';
  end if;
  select * into v_group from public.position_groups where group_id = v_group_id;
  if not found then raise exception 'Group ID does not exist.'; end if;
  if exists(select 1 from public.document_groups where doc_id = v_doc_id) then
    raise exception 'This requisition is already matched.';
  end if;

  v_doc_group_id := public.next_app_id('document_groups', 'DGRP');
  perform set_config('app.action', 'document_group:new', true);
  insert into public.document_groups (
    doc_group_id, doc_id, group_id, group_position,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb,
    channel_linkedin, channel_walkin, channel_referral, channel_others
  )
  values (
    v_doc_group_id, v_doc_id, v_group_id, v_group.group_position,
    v_group.channel_fb, v_group.channel_jobthai, v_group.channel_jobtopgun, v_group.channel_jobdb,
    v_group.channel_linkedin, v_group.channel_walkin, v_group.channel_referral, v_group.channel_others
  );

  return jsonb_build_object('ok', true, 'id', v_doc_group_id);
end;
$$;

revoke all on function public.app_upsert_position_group(jsonb) from public, anon;
revoke all on function public.app_create_group_match(jsonb) from public, anon;
grant execute on function public.app_upsert_position_group(jsonb) to authenticated;
grant execute on function public.app_create_group_match(jsonb) to authenticated;
