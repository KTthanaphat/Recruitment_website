-- Lifecycle-safe sourcing updates. Blank applicant inputs are intentionally NULL
-- (unrecorded), not zero; historical corrections remain possible for managed groups.
alter table public.sourcing_weekly_updates
  alter column applicants_fb drop default,
  alter column applicants_jobthai drop default,
  alter column applicants_jobtopgun drop default,
  alter column applicants_jobdb drop default,
  alter column applicants_linkedin drop default,
  alter column applicants_walkin drop default,
  alter column applicants_referral drop default,
  alter column applicants_others drop default;

create or replace function public.app_upsert_sourcing_weekly_update(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_week_start date := nullif(payload ->> 'week_start', '')::date;
  v_expected timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_group public.position_groups%rowtype;
  v_existing public.sourcing_weekly_updates%rowtype;
  v_saved public.sourcing_weekly_updates%rowtype;
  v_start date;
  v_end date;
  v_is_existing boolean := false;
begin
  perform app_private.assert_recruitment_writer();
  if v_group_id is null or v_week_start is null then
    raise exception 'SOURCING_UPDATE_REQUIRED: Group ID and Monday week are required.';
  end if;
  if extract(isodow from v_week_start) <> 1 then
    raise exception 'SOURCING_WEEK_INVALID: Week start must be a Monday.';
  end if;

  select * into v_group from public.position_groups where group_id = v_group_id for update;
  if not found then raise exception 'SOURCING_GROUP_NOT_FOUND: Group not found.'; end if;
  select start_week, end_week into v_start, v_end from app_private.sourcing_group_lifecycle(v_group_id);
  if v_start is null or v_week_start < v_start or v_week_start > v_end then
    raise exception 'SOURCING_WEEK_OUTSIDE_LIFECYCLE: Week is outside this group''s sourcing lifecycle.';
  end if;

  select * into v_existing from public.sourcing_weekly_updates
  where group_id = v_group_id and week_start = v_week_start for update;
  v_is_existing := found;
  if v_is_existing then
    if not app_private.can_manage_sourcing_group_history(v_group_id) then
      raise exception 'SOURCING_UPDATE_DENIED: You can correct only sourcing groups you manage.';
    end if;
    if v_expected is null or v_existing.updated_at <> v_expected then
      raise exception 'SOURCING_STALE_WRITE: This weekly record changed after it was opened.';
    end if;
  else
    if v_expected is not null then
      raise exception 'SOURCING_STALE_WRITE: No saved record matches the supplied timestamp.';
    end if;
    if not app_private.has_open_group_requisition(v_group_id) or not app_private.can_manage_sourcing_group(v_group_id) then
      raise exception 'SOURCING_CREATE_DENIED: Only a managed open group may receive a new weekly record.';
    end if;
  end if;

  perform set_config('app.action', case when v_is_existing then 'sourcing_update:corrected' else 'sourcing_update:created' end, true);
  insert into public.sourcing_weekly_updates (
    group_id, week_start,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_linkedin, channel_walkin, channel_referral, channel_others,
    applicants_fb, applicants_jobthai, applicants_jobtopgun, applicants_jobdb, applicants_linkedin, applicants_walkin, applicants_referral, applicants_others,
    updated_by
  ) values (
    v_group_id, v_week_start,
    case when payload ? 'channel_fb' then (payload ->> 'channel_fb')::boolean else coalesce(v_group.channel_fb, false) end,
    case when payload ? 'channel_jobthai' then (payload ->> 'channel_jobthai')::boolean else coalesce(v_group.channel_jobthai, false) end,
    case when payload ? 'channel_jobtopgun' then (payload ->> 'channel_jobtopgun')::boolean else coalesce(v_group.channel_jobtopgun, false) end,
    case when payload ? 'channel_jobdb' then (payload ->> 'channel_jobdb')::boolean else coalesce(v_group.channel_jobdb, false) end,
    case when payload ? 'channel_linkedin' then (payload ->> 'channel_linkedin')::boolean else coalesce(v_group.channel_linkedin, false) end,
    case when payload ? 'channel_walkin' then (payload ->> 'channel_walkin')::boolean else coalesce(v_group.channel_walkin, false) end,
    case when payload ? 'channel_referral' then (payload ->> 'channel_referral')::boolean else coalesce(v_group.channel_referral, false) end,
    case when payload ? 'channel_others' then (payload ->> 'channel_others')::boolean else coalesce(v_group.channel_others, false) end,
    nullif(payload ->> 'applicants_fb', '')::integer,
    nullif(payload ->> 'applicants_jobthai', '')::integer,
    nullif(payload ->> 'applicants_jobtopgun', '')::integer,
    nullif(payload ->> 'applicants_jobdb', '')::integer,
    nullif(payload ->> 'applicants_linkedin', '')::integer,
    nullif(payload ->> 'applicants_walkin', '')::integer,
    nullif(payload ->> 'applicants_referral', '')::integer,
    nullif(payload ->> 'applicants_others', '')::integer,
    auth.uid()
  ) on conflict (group_id, week_start) do update set
    channel_fb = case when payload ? 'channel_fb' then excluded.channel_fb else sourcing_weekly_updates.channel_fb end,
    channel_jobthai = case when payload ? 'channel_jobthai' then excluded.channel_jobthai else sourcing_weekly_updates.channel_jobthai end,
    channel_jobtopgun = case when payload ? 'channel_jobtopgun' then excluded.channel_jobtopgun else sourcing_weekly_updates.channel_jobtopgun end,
    channel_jobdb = case when payload ? 'channel_jobdb' then excluded.channel_jobdb else sourcing_weekly_updates.channel_jobdb end,
    channel_linkedin = case when payload ? 'channel_linkedin' then excluded.channel_linkedin else sourcing_weekly_updates.channel_linkedin end,
    channel_walkin = case when payload ? 'channel_walkin' then excluded.channel_walkin else sourcing_weekly_updates.channel_walkin end,
    channel_referral = case when payload ? 'channel_referral' then excluded.channel_referral else sourcing_weekly_updates.channel_referral end,
    channel_others = case when payload ? 'channel_others' then excluded.channel_others else sourcing_weekly_updates.channel_others end,
    applicants_fb = excluded.applicants_fb, applicants_jobthai = excluded.applicants_jobthai,
    applicants_jobtopgun = excluded.applicants_jobtopgun, applicants_jobdb = excluded.applicants_jobdb,
    applicants_linkedin = excluded.applicants_linkedin, applicants_walkin = excluded.applicants_walkin,
    applicants_referral = excluded.applicants_referral, applicants_others = excluded.applicants_others,
    updated_by = excluded.updated_by
  returning * into v_saved;
  return jsonb_build_object('ok', true, 'id', v_group_id, 'week_start', v_week_start, 'updated_at', v_saved.updated_at);
end;
$$;

revoke all on function public.app_upsert_sourcing_weekly_update(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_sourcing_weekly_update(jsonb) to authenticated;
