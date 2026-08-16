-- Lifecycle-valid sourcing records: weeks are Monday slots from first PR approval
-- through the final filled/cancelled requisition (or the current Bangkok week).
create or replace function app_private.can_manage_sourcing_group_history(p_group_id text)
returns boolean language sql stable security definer set search_path = public, app_private as $$
  select app_private.current_app_role() in ('system_admin', 'admin_recruiter')
    or (app_private.current_app_role() = 'site_recruiter' and exists (
      select 1 from public.document_groups dg join public.requisitions r on r.doc_id = dg.doc_id
      where dg.group_id = p_group_id and r.person_in_charge = app_private.current_profile_nickname()
    ));
$$;

create or replace function app_private.sourcing_group_lifecycle(p_group_id text)
returns table(start_week date, end_week date) language sql stable security definer set search_path = public, app_private as $$
  with linked as (
    select r.doc_id, r.pr_approved_date, r.status,
      coalesce((select max(l.log_date) from public.requisition_logs l where l.doc_id = r.doc_id and l.status in ('filled','cancel')), r.updated_at::date) as terminal_date
    from public.document_groups dg join public.requisitions r on r.doc_id = dg.doc_id where dg.group_id = p_group_id
  ), bounds as (
    select min(pr_approved_date) as first_date,
      bool_and(status in ('filled','cancel')) as all_terminal,
      max(terminal_date) filter (where status in ('filled','cancel')) as last_terminal
    from linked
  ) select date_trunc('week', first_date)::date,
    date_trunc('week', case when all_terminal then last_terminal else (now() at time zone 'Asia/Bangkok')::date end)::date
  from bounds where first_date is not null;
$$;

create or replace function public.app_update_sourcing_group_info_v1(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_group public.position_groups%rowtype; v_id text := nullif(payload->>'group_id',''); v_expected timestamptz := nullif(payload->>'expected_updated_at','')::timestamptz; v_name text := nullif(btrim(payload->>'group_position'),'');
begin
  perform app_private.assert_recruitment_writer();
  if v_id is null or v_name is null then raise exception 'SOURCING_GROUP_INFO_REQUIRED: Group and name are required.'; end if;
  if not app_private.has_open_group_requisition(v_id) or not app_private.can_manage_sourcing_group(v_id) then raise exception 'SOURCING_GROUP_INFO_DENIED: Only a managed open group can be changed.'; end if;
  select * into v_group from public.position_groups where group_id=v_id for update;
  if not found then raise exception 'SOURCING_GROUP_NOT_FOUND: Group not found.'; end if;
  if v_expected is null or v_group.updated_at <> v_expected then raise exception 'SOURCING_GROUP_STALE_WRITE: Group changed after it was opened.'; end if;
  perform set_config('app.action','sourcing_group:info-corrected',true);
  update public.position_groups set group_position=v_name where group_id=v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end; $$;

create or replace function public.app_set_sourcing_group_channel_v1(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_group public.position_groups%rowtype; v_id text := nullif(payload->>'group_id',''); v_channel text := nullif(payload->>'channel',''); v_enabled boolean := coalesce((payload->>'enabled')::boolean,false); v_effective date := nullif(payload->>'effective_week','')::date; v_expected timestamptz := nullif(payload->>'expected_updated_at','')::timestamptz; v_col text; v_start date; v_end date; v_rows integer;
begin
  perform app_private.assert_recruitment_writer();
  if v_id is null or v_channel not in ('fb','jobthai','jobtopgun','jobdb','linkedin','walkin','referral','others') then raise exception 'SOURCING_CHANNEL_INVALID: Select a valid channel.'; end if;
  if not app_private.has_open_group_requisition(v_id) or not app_private.can_manage_sourcing_group(v_id) then raise exception 'SOURCING_CHANNEL_DENIED: Only a managed open group can change channels.'; end if;
  select * into v_group from public.position_groups where group_id=v_id for update;
  if not found then raise exception 'SOURCING_GROUP_NOT_FOUND: Group not found.'; end if;
  if v_expected is null or v_group.updated_at <> v_expected then raise exception 'SOURCING_CHANNEL_STALE_WRITE: Group changed after it was opened.'; end if;
  select start_week,end_week into v_start,v_end from app_private.sourcing_group_lifecycle(v_id);
  v_effective := coalesce(v_effective,v_start);
  if extract(isodow from v_effective) <> 1 or v_effective < v_start or v_effective > v_end then raise exception 'SOURCING_CHANNEL_WEEK_INVALID: Effective week must be a lifecycle Monday.'; end if;
  v_col := 'channel_' || v_channel;
  perform set_config('app.action',case when v_enabled then 'sourcing_group:channel-enabled:' else 'sourcing_group:channel-disabled:' end || v_channel,true);
  execute format('update public.position_groups set %I=$1 where group_id=$2',v_col) using v_enabled,v_id;
  if v_enabled then
    execute format('update public.sourcing_weekly_updates set %I=true,%I=null where group_id=$1 and week_start >= $2',v_col,'applicants_'||v_channel) using v_id,v_effective;
  else
    execute format('update public.sourcing_weekly_updates set %I=false,%I=null where group_id=$1 and week_start >= $2',v_col,'applicants_'||v_channel) using v_id,v_effective;
  end if;
  get diagnostics v_rows=row_count;
  return jsonb_build_object('ok',true,'id',v_id,'affected_records',v_rows);
end; $$;

revoke all on function public.app_update_sourcing_group_info_v1(jsonb), public.app_set_sourcing_group_channel_v1(jsonb) from public, anon;
grant execute on function public.app_update_sourcing_group_info_v1(jsonb), public.app_set_sourcing_group_channel_v1(jsonb) to authenticated;
