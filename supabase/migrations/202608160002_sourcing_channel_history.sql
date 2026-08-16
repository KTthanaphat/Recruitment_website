-- A newly enabled channel is intentionally unknown for already-saved weeks.
alter table public.sourcing_weekly_updates
  alter column applicants_fb drop not null,
  alter column applicants_jobthai drop not null,
  alter column applicants_jobtopgun drop not null,
  alter column applicants_jobdb drop not null,
  alter column applicants_linkedin drop not null,
  alter column applicants_walkin drop not null,
  alter column applicants_referral drop not null,
  alter column applicants_others drop not null;

create or replace function public.app_add_sourcing_group_channel_v1(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_channel text := nullif(payload ->> 'channel', '');
  v_expected timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_column text;
  v_group public.position_groups%rowtype;
  v_rows integer;
begin
  perform app_private.assert_recruitment_writer();
  if v_group_id is null or v_channel not in ('fb','jobthai','jobtopgun','jobdb','linkedin','walkin','referral','others') then
    raise exception 'SOURCING_CHANNEL_INVALID: Select a valid channel.';
  end if;
  if not app_private.has_open_group_requisition(v_group_id) or not app_private.can_manage_sourcing_group(v_group_id) then
    raise exception 'SOURCING_CHANNEL_NOT_AUTHORIZED: You can add channels only to managed open groups.';
  end if;
  select * into v_group from public.position_groups where group_id = v_group_id for update;
  if not found then raise exception 'SOURCING_GROUP_NOT_FOUND: Group not found.'; end if;
  if v_expected is null or v_group.updated_at <> v_expected then raise exception 'SOURCING_CHANNEL_STALE_WRITE: Group changed after it was opened.'; end if;
  v_column := 'channel_' || v_channel;
  if (to_jsonb(v_group) ->> v_column)::boolean then raise exception 'SOURCING_CHANNEL_EXISTS: This channel is already enabled.'; end if;
  perform set_config('app.action', 'sourcing_group:add-channel:' || v_channel, true);
  execute format('update public.position_groups set %I = true where group_id = $1', v_column) using v_group_id;
  execute format('update public.sourcing_weekly_updates set %I = true, %I = null where group_id = $1', v_column, 'applicants_' || v_channel) using v_group_id;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'id', v_group_id, 'affected_records', v_rows);
end;
$$;
revoke all on function public.app_add_sourcing_group_channel_v1(jsonb) from public, anon;
grant execute on function public.app_add_sourcing_group_channel_v1(jsonb) to authenticated;
