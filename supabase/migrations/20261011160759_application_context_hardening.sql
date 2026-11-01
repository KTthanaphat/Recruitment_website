-- Reviewed follow-up: fixed function namespace, authenticated legacy writes, exact offer handoff.
create or replace function app_private.current_application_id() returns uuid language sql stable set search_path=pg_catalog as $$
  select nullif(current_setting('app.application_id',true),'')::uuid
$$;
create or replace function public.app_complete_pipeline_stage_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_pending jsonb := coalesce(payload -> 'pending', '{}'::jsonb);
  v_outcome jsonb := coalesce(payload -> 'outcome', '{}'::jsonb);
  v_next jsonb := coalesce(payload -> 'next_pending', '{}'::jsonb);
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_next_stage text := nullif(v_next ->> 'stage', '');
  v_next_round integer := coalesce(nullif(v_next ->> 'round', '')::integer, 1);
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_next_estimated_action_date date := nullif(v_next ->> 'estimated_action_date', '')::date;
  v_expected_next_stage text;
  v_previous_outcome_date date;
  v_next_opened_date date;
  v_row public.recruitment_logs%rowtype;
  v_next_row public.recruitment_logs%rowtype;
  v_next_id uuid;
  v_handoff jsonb;
  v_failure_snapshot jsonb;
begin
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null or v_outcome_date is null or v_result is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage instance, expected timestamp, Pending date, and Pass/Fail outcome date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
    and stage_instance_id = v_stage_instance_id
    and superseded_at is null
  for update;

  if not found or v_row.result is not null then raise exception 'PIPELINE_NOT_CURRENT: The selected stage is not Pending.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.application_id = app_private.current_application_id() and later.superseded_at is null and later.log_id > v_row.log_id) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or v_outcome_date > app_private.pipeline_business_date()
    or v_outcome_date < v_opened_date
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
    or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must satisfy previous Outcome <= Pending <= Outcome <= Bangkok business date.';
  end if;

  if v_result = 0 then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Fail cannot create a next Pending stage.'; end if;
    v_failure_snapshot := app_private.failure_reason_snapshot(nullif(v_outcome ->> 'failure_actor', ''), nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid);
  elsif v_row.recruitment_process = 'Offer' then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Offer Pass uses handoff and cannot create a next Pending stage.'; end if;
  elsif v_row.recruitment_process in ('Line Interview', 'Test') and v_next_stage = v_row.recruitment_process then
    if v_next_round <> v_row.round + 1 then raise exception 'PIPELINE_INVALID_TRANSITION: The next repeatable-stage round must be current round plus one.'; end if;
  else
    v_expected_next_stage := (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[app_private.pipeline_stage_index(v_row.recruitment_process) + 1];
    if v_next_stage is distinct from v_expected_next_stage or v_next_round <> 1 then
      raise exception 'PIPELINE_NEXT_PENDING_REQUIRED: Pass must create the immediate next stage as round 1 Pending.';
    end if;
  end if;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    -- The next Pending is created as part of this completion, so its date is
    -- always the selected Outcome date. Ignore legacy client-supplied values.
    v_next_opened_date := v_outcome_date;
    if v_next_estimated_action_date is not null and v_next_estimated_action_date < v_next_opened_date then
      raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Next estimated action date cannot be before the next Pending opened date.';
    end if;
  end if;

  perform set_config('app.action', case when v_result = 1 then 'pipeline:pass' else 'pipeline:fail' end, true);
  update public.recruitment_logs
  set log_date = v_opened_date,
      interviewer = nullif(v_pending ->> 'interviewer', ''),
      remark = nullif(v_pending ->> 'remark', ''),
      estimated_action_date = v_estimated_action_date,
      pending_edited_at = now(),
      pending_edited_by = auth.uid(),
      result = v_result,
      outcome_date = v_outcome_date,
      outcome_interviewer = nullif(v_outcome ->> 'interviewer', ''),
      outcome_remark = nullif(v_outcome ->> 'remark', ''),
      failure_actor = case when v_result = 0 then v_outcome ->> 'failure_actor' else null end,
      failure_main_reason_id = case when v_result = 0 then nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid else null end,
      failure_detail_reason_id = case when v_result = 0 then nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid else null end,
      failure_reason_snapshot = v_failure_snapshot,
      outcome_recorded_at = now()
  where log_id = v_row.log_id
  returning * into v_row;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    v_next_id := gen_random_uuid();
    perform set_config('app.action', 'pipeline:next-pending', true);
    insert into public.recruitment_logs (
      stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, estimated_action_date, record_origin
    ) values (
      v_next_id, v_candidate_id, v_next_opened_date, v_next_stage, v_next_round,
      nullif(v_next ->> 'interviewer', ''), null, nullif(v_next ->> 'remark', ''), v_next_estimated_action_date, 'auto'
    ) returning * into v_next_row;
    v_next_id := v_next_row.stage_instance_id;
  end if;

  if v_result = 1 and v_row.recruitment_process = 'Offer' then
    select jsonb_build_object(
      'candidate_id', v_candidate_id,
      'application_id', app_private.current_application_id(),
      'passed_date', v_outcome_date,
      'group_id', c.group_id,
      'requisitions', coalesce(jsonb_agg(jsonb_build_object(
        'doc_group_id', peer.doc_group_id,
        'doc_id', r.doc_id,
        'site', r.site,
        'position', r.position,
        'open_headcount', greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0)
      ) order by r.doc_id) filter (where r.doc_id is not null), '[]'::jsonb)
    ) into v_handoff
    from public.candidate_applications c
    join public.document_groups peer on peer.group_id = c.group_id
    join public.requisitions r on r.doc_id = peer.doc_id and r.status = 'ongoing'
    left join lateral (
      select count(*)::integer accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start'
    ) accepted on true
    where c.candidate_id = v_candidate_id and c.application_id = app_private.current_application_id()
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
    group by c.group_id;

    if v_handoff is null
      or jsonb_array_length(coalesce(v_handoff -> 'requisitions', '[]'::jsonb)) = 0
    then
      raise exception 'PIPELINE_OFFER_HANDOFF_INELIGIBLE: Offer Pass requires an eligible ongoing requisition with open headcount.';
    end if;
  end if;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'completed_stage', jsonb_build_object(
      'stage_instance_id', v_row.stage_instance_id, 'stage', v_row.recruitment_process,
      'round', v_row.round, 'result', v_row.result, 'outcome_date', v_row.outcome_date,
      'updated_at', v_row.updated_at
    ),
    'next_stage', case when v_next_id is null then null else jsonb_build_object(
      'stage_instance_id', v_next_row.stage_instance_id, 'stage', v_next_row.recruitment_process,
      'round', v_next_row.round, 'opened_date', v_next_row.log_date, 'updated_at', v_next_row.updated_at
    ) end,
    'terminal', v_result = 0 or v_row.recruitment_process = 'Offer',
    'offer_handoff', v_handoff
  );
end;
$$;
create or replace function app_private.assert_application_destination(p_candidate text,p_group text) returns void language plpgsql security definer set search_path=public,app_private as $$
declare v_site text; v_home text;
begin
  if not app_private.can_manage_sourcing_group(p_group) or not app_private.has_open_group_requisition(p_group) then raise exception 'APPLICATION_GROUP_NOT_AVAILABLE: Select a group you manage with remaining open demand.'; end if;
  select home_site into v_home from public.candidates where candidate_id=p_candidate;
  select min(r.site) into v_site from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=p_group;
  if exists(select 1 from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=p_group and r.site is distinct from v_home) and app_private.current_app_role() not in ('system_admin','admin_recruiter') then raise exception 'APPLICATION_CROSS_SITE_ADMIN_REQUIRED'; end if;
end $$;
create or replace function public.app_upsert_candidate(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_home text; v_candidate public.candidates%rowtype;
begin
  if nullif(payload->>'group_id','') is null and nullif(payload->>'doc_group_id','') is not null then
    payload:=payload||jsonb_build_object('group_id',(select group_id from public.document_groups where doc_group_id=payload->>'doc_group_id'));
  end if;
  if payload->>'mode'='change' then
    select * into v_candidate from public.candidates where candidate_id=payload->>'candidate_id';
    v_home:=v_candidate.home_site;
    if nullif(payload->>'group_id','') is not null and payload->>'group_id' is distinct from v_candidate.group_id then raise exception 'APPLICATION_TRANSFER_REQUIRED: Reassign the application instead of editing profile group.'; end if;
  else
    select min(r.site) into v_home from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=payload->>'group_id';
  end if;
  return public.app_upsert_candidate_profile_v1(jsonb_build_object('home_site',v_home,'responsible_recruiter_id',coalesce(v_candidate.responsible_recruiter_id,auth.uid()))||payload);
end $$;
revoke all on function public.app_insert_pipeline_passes(jsonb), public.app_insert_pipeline_test_exit(jsonb), public.app_insert_recruitment_log(jsonb), public.app_insert_test_maintenance(jsonb) from public, anon;
grant execute on function public.app_insert_pipeline_passes(jsonb), public.app_insert_pipeline_test_exit(jsonb), public.app_insert_recruitment_log(jsonb), public.app_insert_test_maintenance(jsonb) to authenticated;
