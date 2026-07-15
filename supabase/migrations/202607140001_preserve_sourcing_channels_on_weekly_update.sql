create or replace function public.app_upsert_sourcing_weekly_update(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_week_start date := nullif(payload ->> 'week_start', '')::date;
  v_group public.position_groups%rowtype;
begin
  perform public.assert_recruitment_writer();
  if v_group_id is null then raise exception 'Group ID is required.'; end if;
  if v_week_start is null then raise exception 'Week start is required.'; end if;
  if not public.has_open_group_requisition(v_group_id) then raise exception 'Group has no unfilled active requisition.'; end if;
  if not public.can_manage_sourcing_group(v_group_id) then raise exception 'You can update only sourcing groups where you are responsible.'; end if;
  select * into v_group from public.position_groups where group_id = v_group_id;

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
    case when payload ? 'channel_fb' then (payload ->> 'channel_fb')::boolean else coalesce(v_group.channel_fb, false) end,
    case when payload ? 'channel_jobthai' then (payload ->> 'channel_jobthai')::boolean else coalesce(v_group.channel_jobthai, false) end,
    case when payload ? 'channel_jobtopgun' then (payload ->> 'channel_jobtopgun')::boolean else coalesce(v_group.channel_jobtopgun, false) end,
    case when payload ? 'channel_jobdb' then (payload ->> 'channel_jobdb')::boolean else coalesce(v_group.channel_jobdb, false) end,
    case when payload ? 'channel_linkedin' then (payload ->> 'channel_linkedin')::boolean else coalesce(v_group.channel_linkedin, false) end,
    case when payload ? 'channel_walkin' then (payload ->> 'channel_walkin')::boolean else coalesce(v_group.channel_walkin, false) end,
    case when payload ? 'channel_referral' then (payload ->> 'channel_referral')::boolean else coalesce(v_group.channel_referral, false) end,
    case when payload ? 'channel_others' then (payload ->> 'channel_others')::boolean else coalesce(v_group.channel_others, false) end,
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
    channel_fb = case when payload ? 'channel_fb' then excluded.channel_fb else sourcing_weekly_updates.channel_fb end,
    channel_jobthai = case when payload ? 'channel_jobthai' then excluded.channel_jobthai else sourcing_weekly_updates.channel_jobthai end,
    channel_jobtopgun = case when payload ? 'channel_jobtopgun' then excluded.channel_jobtopgun else sourcing_weekly_updates.channel_jobtopgun end,
    channel_jobdb = case when payload ? 'channel_jobdb' then excluded.channel_jobdb else sourcing_weekly_updates.channel_jobdb end,
    channel_linkedin = case when payload ? 'channel_linkedin' then excluded.channel_linkedin else sourcing_weekly_updates.channel_linkedin end,
    channel_walkin = case when payload ? 'channel_walkin' then excluded.channel_walkin else sourcing_weekly_updates.channel_walkin end,
    channel_referral = case when payload ? 'channel_referral' then excluded.channel_referral else sourcing_weekly_updates.channel_referral end,
    channel_others = case when payload ? 'channel_others' then excluded.channel_others else sourcing_weekly_updates.channel_others end,
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

revoke all on function public.app_upsert_sourcing_weekly_update(jsonb) from public, anon;
grant execute on function public.app_upsert_sourcing_weekly_update(jsonb) to authenticated;
