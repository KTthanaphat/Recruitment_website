alter table public.position_groups
  add column if not exists channel_linkedin boolean not null default false,
  add column if not exists channel_walkin boolean not null default false,
  add column if not exists channel_referral boolean not null default false,
  add column if not exists channel_others boolean not null default false;

alter table public.document_groups
  add column if not exists channel_linkedin boolean not null default false,
  add column if not exists channel_walkin boolean not null default false,
  add column if not exists channel_referral boolean not null default false,
  add column if not exists channel_others boolean not null default false;

alter table public.sourcing_weekly_updates
  add column if not exists channel_linkedin boolean not null default false,
  add column if not exists channel_walkin boolean not null default false,
  add column if not exists channel_referral boolean not null default false,
  add column if not exists channel_others boolean not null default false,
  add column if not exists applicants_linkedin integer not null default 0 check (applicants_linkedin >= 0),
  add column if not exists applicants_walkin integer not null default 0 check (applicants_walkin >= 0),
  add column if not exists applicants_referral integer not null default 0 check (applicants_referral >= 0),
  add column if not exists applicants_others integer not null default 0 check (applicants_others >= 0);

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
  if v_mode = 'new' then
    v_group_id := public.next_app_id('position_groups', 'GRP');
  elsif v_group_id is null then
    raise exception 'Group ID is required in Change mode.';
  end if;

  select exists(select 1 from public.position_groups where group_id = v_group_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Group ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Group ID does not exist. Switch to New mode to create it.'; end if;

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

create or replace function public.app_upsert_sourcing_weekly_update(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_week_start date := nullif(payload ->> 'week_start', '')::date;
begin
  perform public.assert_recruitment_writer();
  if v_group_id is null then raise exception 'Group ID is required.'; end if;
  if v_week_start is null then raise exception 'Week start is required.'; end if;
  if not public.has_open_group_requisition(v_group_id) then raise exception 'Group has no unfilled active requisition.'; end if;
  if not public.can_manage_sourcing_group(v_group_id) then raise exception 'You can update only sourcing groups where you are responsible.'; end if;

  perform set_config('app.action', 'sourcing_update:upsert', true);
  insert into public.sourcing_weekly_updates (
    group_id, week_start,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb,
    channel_linkedin, channel_walkin, channel_referral, channel_others,
    applicants_fb, applicants_jobthai, applicants_jobtopgun, applicants_jobdb,
    applicants_linkedin, applicants_walkin, applicants_referral, applicants_others,
    updated_by
  )
  values (
    v_group_id,
    v_week_start,
    coalesce((payload ->> 'channel_fb')::boolean, false),
    coalesce((payload ->> 'channel_jobthai')::boolean, false),
    coalesce((payload ->> 'channel_jobtopgun')::boolean, false),
    coalesce((payload ->> 'channel_jobdb')::boolean, false),
    coalesce((payload ->> 'channel_linkedin')::boolean, false),
    coalesce((payload ->> 'channel_walkin')::boolean, false),
    coalesce((payload ->> 'channel_referral')::boolean, false),
    coalesce((payload ->> 'channel_others')::boolean, false),
    coalesce(nullif(payload ->> 'applicants_fb', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_jobthai', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_jobtopgun', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_jobdb', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_linkedin', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_walkin', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_referral', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_others', '')::integer, 0),
    auth.uid()
  )
  on conflict (group_id, week_start) do update set
    channel_fb = excluded.channel_fb,
    channel_jobthai = excluded.channel_jobthai,
    channel_jobtopgun = excluded.channel_jobtopgun,
    channel_jobdb = excluded.channel_jobdb,
    channel_linkedin = excluded.channel_linkedin,
    channel_walkin = excluded.channel_walkin,
    channel_referral = excluded.channel_referral,
    channel_others = excluded.channel_others,
    applicants_fb = excluded.applicants_fb,
    applicants_jobthai = excluded.applicants_jobthai,
    applicants_jobtopgun = excluded.applicants_jobtopgun,
    applicants_jobdb = excluded.applicants_jobdb,
    applicants_linkedin = excluded.applicants_linkedin,
    applicants_walkin = excluded.applicants_walkin,
    applicants_referral = excluded.applicants_referral,
    applicants_others = excluded.applicants_others,
    updated_by = excluded.updated_by;

  return jsonb_build_object('ok', true, 'id', v_group_id);
end;
$$;
