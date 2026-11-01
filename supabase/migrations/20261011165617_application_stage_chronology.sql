-- Correction replacement IDs must not change journey ordering.
create or replace function public.app_insert_recruitment_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage text := nullif(payload ->> 'recruitment_process', '');
  v_result smallint := nullif(payload ->> 'result', '')::smallint;
  v_source text := coalesce(nullif(payload ->> 'source', ''), 'manual');
  v_current_stage text;
  v_current_result smallint;
  v_current_index integer;
  v_next_index integer;
  v_log_id bigint;
  v_stages text[] := array[
    'First Contact', 'Phone Screen', 'HR Interview', 'Line Interview', 'Test',
    'Reference Check', 'Offer', 'Rejected', 'Withdrawn'
  ];
  v_active_stages text[] := array[
    'Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer'
  ];
  v_auto_next_stage text;
begin
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result
    into v_current_stage, v_current_result
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc
  limit 1;

  if v_source = 'pipeline' then
    v_current_index := coalesce(array_position(v_stages, v_current_stage), 0);
    v_next_index := coalesce(array_position(v_stages, v_stage), 0);

    if v_next_index <= v_current_index then
      raise exception 'Pipeline cards can move forward only.';
    end if;
  end if;

  perform set_config('app.action', 'recruitment_log:new', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    nullif(payload ->> 'log_date', '')::date,
    v_stage,
    coalesce(nullif(payload ->> 'round', '')::integer, 1),
    nullif(payload ->> 'interviewer', ''),
    v_result,
    nullif(payload ->> 'remark', '')
  )
  returning log_id into v_log_id;

  if v_result = 1
    and v_current_stage = v_stage
    and v_current_result is null
    and array_position(v_active_stages, v_stage) is not null
    and array_position(v_active_stages, v_stage) < array_length(v_active_stages, 1)
  then
    v_auto_next_stage := v_active_stages[array_position(v_active_stages, v_stage) + 1];
    perform set_config('app.action', 'recruitment_log:auto-next-pending', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
    values (
      v_candidate_id,
      nullif(payload ->> 'log_date', '')::date,
      v_auto_next_stage,
      1,
      null,
      null,
      'Auto-progressed after pass'
    );
  end if;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'id', v_log_id::text);
end;
$$;

create or replace function public.app_insert_pipeline_passes(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_target_stage text := nullif(payload ->> 'target_stage', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_current_stage text;
  v_current_result smallint;
  v_current_index integer;
  v_target_index integer;
  v_stage_count integer := jsonb_array_length(v_stages);
  v_active_stages text[] := array[
    'Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer'
  ];
  v_item jsonb;
  v_expected_stage text;
  v_log_id bigint;
  v_pass_stage text;
  v_pass_round integer;
  v_pass_date date;
begin
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if v_target_stage is null then raise exception 'Target stage is required.'; end if;
  if v_stage_count = 0 then raise exception 'At least one passed stage is required.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result
    into v_current_stage, v_current_result
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc
  limit 1;

  v_current_index := coalesce(array_position(v_active_stages, v_current_stage), 0);
  v_target_index := coalesce(array_position(v_active_stages, v_target_stage), 0);

  if v_current_index = 0 then raise exception 'Candidate is not in an active pipeline stage.'; end if;
  if v_current_result is not null then raise exception 'Latest candidate stage is already completed.'; end if;
  if v_target_index <= v_current_index then raise exception 'Pipeline cards can move forward only.'; end if;
  if v_target_index <> v_current_index + v_stage_count then
    raise exception 'All passed stages between current and target must be confirmed.';
  end if;

  for v_item in select value from jsonb_array_elements(v_stages)
  loop
    v_expected_stage := v_active_stages[v_current_index + coalesce((v_item ->> 'index')::integer, 0)];
    if nullif(v_item ->> 'stage', '') <> v_expected_stage then
      raise exception 'Passed stages must be consecutive from the current stage.';
    end if;
  end loop;

  perform set_config('app.action', 'recruitment_log:pipeline-pass', true);
  for v_item in select value from jsonb_array_elements(v_stages)
  loop
    v_pass_stage := nullif(v_item ->> 'stage', '');
    v_pass_round := coalesce(nullif(v_item ->> 'round', '')::integer, 1);
    v_pass_date := nullif(v_item ->> 'log_date', '')::date;
    if v_pass_stage is null or v_pass_date is null then
      raise exception 'Every crossed stage needs a stage and result date.';
    end if;
    if v_pass_round < 1 then
      raise exception 'Every crossed stage needs a valid round.';
    end if;

    perform set_config('app.action', 'recruitment_log:pipeline-pending', true);
    if not exists (
      select 1
      from public.recruitment_logs
      where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
        and recruitment_process = v_pass_stage
        and round = v_pass_round
        and result is null
    ) then
      insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
      values (
        v_candidate_id,
        v_pass_date,
        v_pass_stage,
        v_pass_round,
        nullif(v_item ->> 'interviewer', ''),
        null,
        coalesce(nullif(v_item ->> 'pending_remark', ''), 'Pending stage confirmed before pipeline pass')
      )
      returning log_id into v_log_id;
    end if;

    perform set_config('app.action', 'recruitment_log:pipeline-pass', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
    values (
      v_candidate_id,
      v_pass_date,
      v_pass_stage,
      v_pass_round,
      nullif(v_item ->> 'interviewer', ''),
      1,
      nullif(v_item ->> 'remark', '')
    )
    returning log_id into v_log_id;
  end loop;

  perform set_config('app.action', 'recruitment_log:auto-next-pending', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    coalesce(nullif((v_stages -> (v_stage_count - 1)) ->> 'log_date', '')::date, current_date),
    v_target_stage,
    1,
    null,
    null,
    'Auto-created pending stage after pipeline drag and drop'
  );

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'id', v_log_id::text);
end;
$$;

create or replace function public.app_insert_test_maintenance(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_current_test jsonb := coalesce(payload -> 'current_test', '{}'::jsonb);
  v_next_test jsonb := coalesce(payload -> 'next_test', '{}'::jsonb);
  v_current_stage text;
  v_current_result smallint;
  v_latest_round integer;
  v_current_round integer := coalesce(nullif(v_current_test ->> 'round', '')::integer, 1);
  v_next_round integer := coalesce(nullif(v_next_test ->> 'round', '')::integer, v_current_round + 1);
  v_log_id bigint;
begin
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result, round
    into v_current_stage, v_current_result, v_latest_round
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc
  limit 1;

  if v_current_stage <> 'Test' or v_current_result is not null then
    raise exception 'Candidate must be in a pending Test round.';
  end if;
  if v_current_round <> v_latest_round then
    raise exception 'Current Test round does not match the latest pending Test round.';
  end if;
  if v_next_round <= v_current_round then
    raise exception 'Next Test round must be greater than the current round.';
  end if;

  perform set_config('app.action', 'recruitment_log:test-current-pass', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    nullif(v_current_test ->> 'log_date', '')::date,
    'Test',
    v_current_round,
    nullif(v_current_test ->> 'interviewer', ''),
    1,
    nullif(v_current_test ->> 'remark', '')
  )
  returning log_id into v_log_id;

  perform set_config('app.action', 'recruitment_log:test-next-pending', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    nullif(v_next_test ->> 'log_date', '')::date,
    'Test',
    v_next_round,
    nullif(v_next_test ->> 'interviewer', ''),
    null,
    nullif(v_next_test ->> 'remark', '')
  )
  returning log_id into v_log_id;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'id', v_log_id::text);
end;
$$;

create or replace function public.app_insert_pipeline_test_exit(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_target_stage text := nullif(payload ->> 'target_stage', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_extra_rounds jsonb := coalesce(payload -> 'extra_test_rounds', '[]'::jsonb);
  v_stage_count integer := jsonb_array_length(v_stages);
  v_current_stage text;
  v_current_result smallint;
  v_latest_round integer;
  v_pass_stage jsonb;
  v_pass_round integer;
  v_item jsonb;
  v_log_id bigint;
begin
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if v_target_stage <> 'Reference Check' then raise exception 'Test exit target must be Reference Check.'; end if;
  if v_stage_count <> 1 then raise exception 'Test exit must pass exactly one Test stage.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result, round
    into v_current_stage, v_current_result, v_latest_round
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc
  limit 1;

  if v_current_stage <> 'Test' or v_current_result is not null then
    raise exception 'Candidate must be in a pending Test round.';
  end if;

  v_pass_stage := v_stages -> 0;
  if nullif(v_pass_stage ->> 'stage', '') <> 'Test' then
    raise exception 'Test exit must pass the Test stage.';
  end if;
  v_pass_round := coalesce(nullif(v_pass_stage ->> 'round', '')::integer, 1);
  if v_pass_round <> v_latest_round then
    raise exception 'Test exit pass round must match the latest pending Test round.';
  end if;

  perform set_config('app.action', 'recruitment_log:test-extra-pending', true);
  for v_item in select value from jsonb_array_elements(v_extra_rounds)
  loop
    if coalesce(nullif(v_item ->> 'round', '')::integer, 0) <= v_pass_round then
      raise exception 'Additional Test rounds must be greater than the pass round.';
    end if;
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
    values (
      v_candidate_id,
      nullif(v_item ->> 'log_date', '')::date,
      'Test',
      coalesce(nullif(v_item ->> 'round', '')::integer, v_pass_round + 1),
      nullif(v_item ->> 'interviewer', ''),
      null,
      nullif(v_item ->> 'remark', '')
    )
    returning log_id into v_log_id;
  end loop;

  perform set_config('app.action', 'recruitment_log:test-pass', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    nullif(v_pass_stage ->> 'log_date', '')::date,
    'Test',
    v_pass_round,
    nullif(v_pass_stage ->> 'interviewer', ''),
    1,
    nullif(v_pass_stage ->> 'remark', '')
  )
  returning log_id into v_log_id;

  perform set_config('app.action', 'recruitment_log:auto-next-pending', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    coalesce(nullif(v_pass_stage ->> 'log_date', '')::date, current_date),
    'Reference Check',
    1,
    null,
    null,
    'Auto-created pending stage after Test exit'
  );

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'id', v_log_id::text);
end;
$$;

create or replace function public.app_update_pipeline_pending_v2(payload jsonb)
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
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_previous_outcome_date date;
  v_row public.recruitment_logs%rowtype;
begin
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage_instance_id, expected_updated_at, and pending.opened_date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
    and stage_instance_id = v_stage_instance_id
    and superseded_at is null
  for update;

  if not found or v_row.result is not null then
    raise exception 'PIPELINE_NOT_CURRENT: The selected stage is not the current Pending stage.';
  end if;
  if v_row.updated_at <> v_expected_updated_at then
    raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.';
  end if;
  if exists (
    select 1 from public.recruitment_logs later
    where later.candidate_id = v_candidate_id and later.application_id = app_private.current_application_id()
      and later.superseded_at is null
      and (app_private.pipeline_stage_index(later.recruitment_process), later.round) > (app_private.pipeline_stage_index(v_row.recruitment_process), v_row.round)
  ) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and (app_private.pipeline_stage_index(recruitment_process), round) < (app_private.pipeline_stage_index(v_row.recruitment_process), v_row.round)
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
    or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Pending opened date must follow the previous Outcome, and the estimate cannot precede the Pending opened date.';
  end if;

  perform set_config('app.action', 'pipeline:pending-edit', true);
  update public.recruitment_logs
  set log_date = v_opened_date,
      interviewer = nullif(v_pending ->> 'interviewer', ''),
      remark = nullif(v_pending ->> 'remark', ''),
      estimated_action_date = v_estimated_action_date,
      pending_edited_at = now(),
      pending_edited_by = auth.uid()
  where log_id = v_row.log_id
  returning * into v_row;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'stage_instance_id', v_row.stage_instance_id, 'updated_at', v_row.updated_at);
end;
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
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.application_id = app_private.current_application_id() and later.superseded_at is null and (app_private.pipeline_stage_index(later.recruitment_process), later.round) > (app_private.pipeline_stage_index(v_row.recruitment_process), v_row.round)) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and (app_private.pipeline_stage_index(recruitment_process), round) < (app_private.pipeline_stage_index(v_row.recruitment_process), v_row.round)
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc limit 1;
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

create or replace function public.app_pass_pipeline_jump_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'current_stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_stages jsonb := coalesce(payload -> 'passed_stages', '[]'::jsonb);
  v_target jsonb := coalesce(payload -> 'target_pending', '{}'::jsonb);
  v_target_stage text := nullif(v_target ->> 'stage', '');
  v_target_date date := nullif(v_target ->> 'opened_date', '')::date;
  v_target_estimated_action_date date := nullif(v_target ->> 'estimated_action_date', '')::date;
  v_current public.recruitment_logs%rowtype;
  v_item jsonb;
  v_pending jsonb;
  v_outcome jsonb;
  v_stage text;
  v_opened_date date;
  v_outcome_date date;
  v_previous_date date;
  v_previous_outcome_date date;
  v_current_index integer;
  v_count integer := jsonb_array_length(v_stages);
  v_i integer;
  v_new_id uuid;
begin
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_count < 1 or v_target_stage is null or v_target_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: current instance, expected timestamp, passed stages, and target Pending are required.';
  end if;

  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found or v_current.result is not null then raise exception 'PIPELINE_NOT_CURRENT: Jump requires the current Pending stage.'; end if;
  if v_current.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.application_id = app_private.current_application_id() and later.superseded_at is null and (app_private.pipeline_stage_index(later.recruitment_process), later.round) > (app_private.pipeline_stage_index(v_current.recruitment_process), v_current.round)) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and (app_private.pipeline_stage_index(recruitment_process), round) < (app_private.pipeline_stage_index(v_current.recruitment_process), v_current.round)
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc limit 1;

  v_current_index := app_private.pipeline_stage_index(v_current.recruitment_process);
  if v_current_index is null or v_current_index + v_count > 6 then raise exception 'PIPELINE_INVALID_TRANSITION: Jump exceeds the active pipeline.'; end if;
  if v_target_stage <> (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[v_current_index + v_count] then
    raise exception 'PIPELINE_INVALID_TRANSITION: Jump target must immediately follow all confirmed Pass stages.';
  end if;

  for v_i in 0..v_count - 1 loop
    v_item := v_stages -> v_i;
    v_stage := nullif(v_item ->> 'stage', '');
    v_pending := coalesce(v_item -> 'pending', '{}'::jsonb);
    v_outcome := coalesce(v_item -> 'outcome', '{}'::jsonb);
    v_opened_date := nullif(v_pending ->> 'opened_date', '')::date;
    v_outcome_date := nullif(v_outcome ->> 'date', '')::date;
    if lower(coalesce(v_outcome ->> 'result', '')) not in ('pass', '1') then
      raise exception 'PIPELINE_INVALID_TRANSITION: Every jump Outcome must explicitly be Pass.';
    end if;
    if v_stage <> (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[v_current_index + v_i] then
      raise exception 'PIPELINE_INVALID_TRANSITION: Passed stages must be consecutive.';
    end if;
    if v_opened_date is null or v_outcome_date is null
      or v_opened_date > app_private.pipeline_business_date()
      or v_outcome_date > app_private.pipeline_business_date()
      or v_outcome_date < v_opened_date
      or (v_previous_outcome_date is not null and v_i = 0 and v_opened_date < v_previous_outcome_date)
      or (v_previous_date is not null and v_opened_date < v_previous_date)
    then
      raise exception 'PIPELINE_DATE_ORDER: Jump stage dates must be complete and nondecreasing.';
    end if;

    if v_i = 0 then
      if v_stage <> v_current.recruitment_process or coalesce(nullif(v_item ->> 'round', '')::integer, v_current.round) <> v_current.round then
        raise exception 'PIPELINE_INVALID_TRANSITION: The first passed stage must match the current Pending stage and round.';
      end if;
      perform set_config('app.action', 'pipeline:jump-pass', true);
      update public.recruitment_logs
      set log_date = v_opened_date,
          interviewer = nullif(v_pending ->> 'interviewer', ''),
          remark = nullif(v_pending ->> 'remark', ''),
          estimated_action_date = nullif(v_pending ->> 'estimated_action_date', '')::date,
          pending_edited_at = now(),
          pending_edited_by = auth.uid(),
          result = 1,
          outcome_date = v_outcome_date,
          outcome_interviewer = nullif(v_outcome ->> 'interviewer', ''),
          outcome_remark = nullif(v_outcome ->> 'remark', ''),
          outcome_recorded_at = now()
      where log_id = v_current.log_id;
    else
      perform set_config('app.action', 'pipeline:jump-pass', true);
      insert into public.recruitment_logs (
        candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
        outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at, record_origin
      ) values (
        v_candidate_id, v_opened_date, v_stage, coalesce(nullif(v_item ->> 'round', '')::integer, 1),
        nullif(v_pending ->> 'interviewer', ''), 1, nullif(v_pending ->> 'remark', ''),
        v_outcome_date, nullif(v_outcome ->> 'interviewer', ''),
        nullif(v_outcome ->> 'remark', ''), now(), 'auto'
      );
    end if;
    v_previous_date := v_outcome_date;
  end loop;

  if v_target_date < v_previous_date or v_target_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Target Pending date must be between the last Pass and Bangkok business date.';
  end if;
  if v_target_estimated_action_date is not null and v_target_estimated_action_date < v_target_date then
    raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Target estimated action date cannot be before the target Pending opened date.';
  end if;
  v_new_id := gen_random_uuid();
  perform set_config('app.action', 'pipeline:jump-target-pending', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, estimated_action_date, record_origin
  ) values (
    v_new_id, v_candidate_id, v_target_date, v_target_stage, coalesce(nullif(v_target ->> 'round', '')::integer, 1),
    nullif(v_target ->> 'interviewer', ''), null, nullif(v_target ->> 'remark', ''), v_target_estimated_action_date, 'auto'
  );

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'completed_stage_instance_ids', (
      select coalesce(jsonb_agg(stage_instance_id order by log_id), '[]'::jsonb)
      from public.recruitment_logs
      where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result = 1
        and log_id >= v_current.log_id and log_id < (select log_id from public.recruitment_logs where stage_instance_id = v_new_id)
    ),
    'next_stage', jsonb_build_object('stage_instance_id', v_new_id, 'stage', v_target_stage, 'round', coalesce(nullif(v_target ->> 'round', '')::integer, 1), 'opened_date', v_target_date)
  );
end;
$$;

create or replace function public.app_correct_pipeline_outcome_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_outcome jsonb := coalesce(payload -> 'outcome', '{}'::jsonb);
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_row public.recruitment_logs%rowtype;
  v_replacement public.recruitment_logs%rowtype;
  v_replacement_id uuid := gen_random_uuid();
  v_previous_outcome_date date;
  v_next_opened_date date;
  v_failure_snapshot jsonb;
begin
  perform app_private.resolve_application(payload);
  perform app_private.assert_system_admin();
  if v_candidate_id is null or v_stage_instance_id is null or v_expected_updated_at is null or v_result is null or v_outcome_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: candidate, stage instance, expected timestamp, and corrected Outcome are required.';
  end if;
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;

  select * into v_row from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found or v_row.result is null then raise exception 'PIPELINE_NOT_FOUND: A canonical completed stage is required.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Outcome changed after it was opened.'; end if;
  if v_result is distinct from v_row.result then
    raise exception 'PIPELINE_CORRECTION_RESULT_IMMUTABLE: Outcome correction cannot change Pass/Fail.';
  end if;
  if v_row.result = 0 then
    if v_outcome ? 'failure_actor' or v_outcome ? 'failure_main_reason_id' or v_outcome ? 'failure_detail_reason_id' then
      v_failure_snapshot := app_private.failure_reason_snapshot(nullif(v_outcome ->> 'failure_actor', ''), nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid);
    else
      v_failure_snapshot := v_row.failure_reason_snapshot;
    end if;
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and (app_private.pipeline_stage_index(recruitment_process), round) < (app_private.pipeline_stage_index(v_row.recruitment_process), v_row.round)
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc limit 1;
  select log_date into v_next_opened_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and (app_private.pipeline_stage_index(recruitment_process), round) > (app_private.pipeline_stage_index(v_row.recruitment_process), v_row.round)
  order by app_private.pipeline_stage_index(recruitment_process), round, log_id limit 1;
  if v_outcome_date > app_private.pipeline_business_date()
    or v_outcome_date < v_row.log_date
    or (v_previous_outcome_date is not null and v_row.log_date < v_previous_outcome_date)
    or (v_next_opened_date is not null and v_outcome_date > v_next_opened_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must satisfy previous Outcome <= Pending <= corrected Outcome <= next Pending <= Bangkok business date.';
  end if;

  perform set_config('app.action', 'pipeline:outcome-correction-supersede', true);
  update public.recruitment_logs
  set superseded_at = now(),
      superseded_by_stage_instance_id = v_replacement_id,
      superseded_reason = 'outcome corrected by system admin'
  where log_id = v_row.log_id;

  perform set_config('app.action', 'pipeline:outcome-correction-replacement', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
    outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at,
    failure_actor, failure_main_reason_id, failure_detail_reason_id, failure_reason_snapshot,
    pending_edited_at, pending_edited_by, record_origin, migration_note,
    created_at
  ) values (
    v_replacement_id, v_row.candidate_id, v_row.log_date, v_row.recruitment_process, v_row.round, v_row.interviewer,
    v_row.result, v_row.remark, v_outcome_date, nullif(v_outcome ->> 'interviewer', ''),
    nullif(v_outcome ->> 'remark', ''), now(),
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_actor', ''), v_row.failure_actor) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, v_row.failure_main_reason_id) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid, v_row.failure_detail_reason_id) else null end,
    v_failure_snapshot, v_row.pending_edited_at, v_row.pending_edited_by,
    'correction', concat_ws('; ', nullif(v_row.migration_note, ''), 'corrected from ' || v_row.stage_instance_id::text),
    v_row.created_at
  ) returning * into v_replacement;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'superseded_stage_instance_id', v_row.stage_instance_id,
    'replacement_stage', jsonb_build_object(
      'stage_instance_id', v_replacement.stage_instance_id,
      'stage', v_replacement.recruitment_process,
      'round', v_replacement.round,
      'result', v_replacement.result,
      'outcome_date', v_replacement.outcome_date,
      'updated_at', v_replacement.updated_at
    )
  );
end;
$$;

create or replace function public.app_correct_pipeline_stage_record_v3(payload jsonb)
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
  v_outcome jsonb := payload -> 'outcome';
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_row public.recruitment_logs%rowtype;
  v_replacement public.recruitment_logs%rowtype;
  v_replacement_id uuid := gen_random_uuid();
  v_previous_outcome_date date;
  v_next_opened_date date;
  v_failure_snapshot jsonb;
begin
  perform app_private.resolve_application(payload);
  if app_private.current_app_role() not in ('system_admin', 'admin_recruiter') then
    raise exception 'PIPELINE_ADMIN_REQUIRED: System admin or admin recruiter role is required.';
  end if;
  if v_candidate_id is null or v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: candidate, stage instance, expected timestamp, and Pending date are required.';
  end if;
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;

  select * into v_row from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found then raise exception 'PIPELINE_NOT_FOUND: A canonical pipeline record is required.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The pipeline record changed after it was opened.'; end if;
  if (v_row.result is null and v_outcome is not null) or (v_row.result is not null and (v_outcome is null or v_result is null or v_outcome_date is null)) then
    raise exception 'PIPELINE_INVALID_PAYLOAD: Pending records have no Outcome; completed records require result and Outcome date.';
  end if;
  if v_row.result is not null and v_result is distinct from v_row.result then
    raise exception 'PIPELINE_CORRECTION_RESULT_IMMUTABLE: Outcome correction cannot change Pass/Fail.';
  end if;
  if v_row.result = 0 then
    if v_outcome ? 'failure_actor' or v_outcome ? 'failure_main_reason_id' or v_outcome ? 'failure_detail_reason_id' then
      v_failure_snapshot := app_private.failure_reason_snapshot(nullif(v_outcome ->> 'failure_actor', ''), nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid);
    else
      v_failure_snapshot := v_row.failure_reason_snapshot;
    end if;
  end if;

  select outcome_date into v_previous_outcome_date from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and (app_private.pipeline_stage_index(recruitment_process), round) < (app_private.pipeline_stage_index(v_row.recruitment_process), v_row.round)
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
    or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date)
    or (v_row.result is not null and (v_outcome_date > app_private.pipeline_business_date() or v_outcome_date < v_opened_date))
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must remain within the previous Outcome and this Pending/Outcome.';
  end if;

  perform set_config('app.action', 'pipeline:admin-record-correction-supersede', true);
  update public.recruitment_logs set superseded_at = now(), superseded_by_stage_instance_id = v_replacement_id,
    superseded_reason = 'pipeline record corrected by administrator' where log_id = v_row.log_id;
  perform set_config('app.action', 'pipeline:admin-record-correction-replacement', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
    estimated_action_date, outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at,
    failure_actor, failure_main_reason_id, failure_detail_reason_id, failure_reason_snapshot,
    pending_edited_at, pending_edited_by, record_origin, migration_note, created_at
  ) values (
    v_replacement_id, v_row.candidate_id, v_opened_date, v_row.recruitment_process, v_row.round,
    nullif(v_pending ->> 'interviewer', ''), case when v_row.result is null then null else v_result end, nullif(v_pending ->> 'remark', ''),
    v_estimated_action_date,
    case when v_row.result is null then null else v_outcome_date end,
    case when v_row.result is null then null else nullif(v_outcome ->> 'interviewer', '') end,
    case when v_row.result is null then null else nullif(v_outcome ->> 'remark', '') end,
    case when v_row.result is null then null else now() end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_actor', ''), v_row.failure_actor) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, v_row.failure_main_reason_id) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid, v_row.failure_detail_reason_id) else null end,
    v_failure_snapshot,
    now(), auth.uid(), 'correction', concat_ws('; ', nullif(v_row.migration_note, ''), 'corrected from ' || v_row.stage_instance_id::text), v_row.created_at
  ) returning * into v_replacement;
  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'superseded_stage_instance_id', v_row.stage_instance_id,
    'replacement_stage_instance_id', v_replacement.stage_instance_id, 'updated_at', v_replacement.updated_at);
end;
$$;

create or replace function public.app_insert_recruitment_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage text := nullif(payload ->> 'recruitment_process', '');
  v_result smallint := nullif(payload ->> 'result', '')::smallint;
  v_event_date date := nullif(payload ->> 'log_date', '')::date;
  v_current public.recruitment_logs%rowtype;
  v_next_stage text;
  v_next jsonb := null;
begin
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_event_date is null then raise exception 'PIPELINE_INVALID_PAYLOAD: Date is required.'; end if;
  if v_event_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Date cannot be after the Bangkok business date.';
  end if;

  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is null
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc limit 1 for update;

  if not found then
    if v_stage <> 'Phone Screen' or v_result is not null
      or exists (select 1 from public.recruitment_logs where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null)
    then
      raise exception 'PIPELINE_INVALID_TRANSITION: A candidate without canonical activity must start at Phone Screen Pending.';
    end if;
    perform set_config('app.action', 'pipeline:legacy-start-pending', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin)
    values (
      v_candidate_id, v_event_date, 'Phone Screen', 1, nullif(payload ->> 'interviewer', ''), null,
      nullif(payload ->> 'remark', ''), 'user'
    ) returning * into v_current;
    update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
    return jsonb_build_object('ok', true, 'id', v_current.log_id::text, 'stage_instance_id', v_current.stage_instance_id);
  end if;

  if v_stage <> v_current.recruitment_process then
    raise exception 'PIPELINE_INVALID_TRANSITION: Legacy Process Update can edit or complete only the current Pending stage.';
  end if;
  if v_result is null then
    return public.app_update_pipeline_pending_v2(jsonb_build_object(
      'candidate_id', v_candidate_id,
      'stage_instance_id', v_current.stage_instance_id,
      'expected_updated_at', v_current.updated_at,
      'pending', jsonb_build_object(
        'opened_date', v_event_date,
        'interviewer', nullif(payload ->> 'interviewer', ''),
        'remark', nullif(payload ->> 'remark', '')
      )
    ));
  end if;

  if v_result = 1 and v_current.recruitment_process <> 'Offer' then
    v_next_stage := (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[app_private.pipeline_stage_index(v_current.recruitment_process) + 1];
    v_next := jsonb_build_object('stage', v_next_stage, 'round', 1, 'opened_date', v_event_date);
  end if;
  return public.app_complete_pipeline_stage_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'pending', jsonb_build_object(
      'opened_date', v_current.log_date,
      'interviewer', coalesce(nullif(payload ->> 'interviewer', ''), v_current.interviewer),
      'remark', coalesce(nullif(payload ->> 'remark', ''), v_current.remark)
    ),
    'outcome', jsonb_build_object(
      'result', v_result,
      'date', v_event_date,
      'interviewer', nullif(payload ->> 'interviewer', ''),
      'remark', nullif(payload ->> 'remark', '')
    ),
    'next_pending', v_next
  ));
end;
$$;

create or replace function public.app_insert_pipeline_passes(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_target_stage text := nullif(payload ->> 'target_stage', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_current public.recruitment_logs%rowtype;
  v_item jsonb;
  v_passed jsonb := '[]'::jsonb;
  v_last_date date;
  v_i integer;
begin
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is null
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc limit 1 for update;
  if not found then raise exception 'PIPELINE_NOT_CURRENT: A current Pending stage is required.'; end if;
  if jsonb_array_length(v_stages) < 1 then raise exception 'PIPELINE_INVALID_PAYLOAD: At least one passed stage is required.'; end if;

  for v_i in 0..jsonb_array_length(v_stages) - 1 loop
    v_item := v_stages -> v_i;
    v_last_date := nullif(v_item ->> 'log_date', '')::date;
    v_passed := v_passed || jsonb_build_array(jsonb_build_object(
      'stage', nullif(v_item ->> 'stage', ''),
      'round', coalesce(nullif(v_item ->> 'round', '')::integer, 1),
      'pending', jsonb_build_object(
        'opened_date', case when v_i = 0 then v_current.log_date else v_last_date end,
        'interviewer', coalesce(nullif(v_item ->> 'interviewer', ''), case when v_i = 0 then v_current.interviewer else null end),
        'remark', case when v_i = 0 then v_current.remark else nullif(v_item ->> 'pending_remark', '') end
      ),
      'outcome', jsonb_build_object(
        'result', 'pass', 'date', v_last_date,
        'interviewer', nullif(v_item ->> 'interviewer', ''), 'remark', nullif(v_item ->> 'remark', '')
      )
    ));
  end loop;

  return public.app_pass_pipeline_jump_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'current_stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'passed_stages', v_passed,
    'target_pending', jsonb_build_object('stage', v_target_stage, 'round', 1, 'opened_date', v_last_date)
  ));
end;
$$;

create or replace function public.app_insert_test_maintenance(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_current_test jsonb := coalesce(payload -> 'current_test', '{}'::jsonb);
  v_next_test jsonb := coalesce(payload -> 'next_test', '{}'::jsonb);
  v_current public.recruitment_logs%rowtype;
begin
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is null
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc limit 1 for update;
  if not found or v_current.recruitment_process <> 'Test' then raise exception 'PIPELINE_NOT_CURRENT: Candidate must be in a Pending Test round.'; end if;
  if coalesce(nullif(v_current_test ->> 'round', '')::integer, v_current.round) <> v_current.round then
    raise exception 'PIPELINE_INVALID_TRANSITION: Current Test round does not match.';
  end if;
  return public.app_complete_pipeline_stage_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'pending', jsonb_build_object(
      'opened_date', v_current.log_date,
      'interviewer', coalesce(nullif(v_current_test ->> 'interviewer', ''), v_current.interviewer),
      'remark', coalesce(nullif(v_current_test ->> 'remark', ''), v_current.remark)
    ),
    'outcome', jsonb_build_object(
      'result', 'pass', 'date', nullif(v_current_test ->> 'log_date', '')::date,
      'interviewer', nullif(v_current_test ->> 'interviewer', ''), 'remark', nullif(v_current_test ->> 'remark', '')
    ),
    'next_pending', jsonb_build_object(
      'stage', 'Test', 'round', nullif(v_next_test ->> 'round', '')::integer,
      'opened_date', nullif(v_next_test ->> 'log_date', '')::date,
      'interviewer', nullif(v_next_test ->> 'interviewer', ''), 'remark', nullif(v_next_test ->> 'remark', '')
    )
  ));
end;
$$;

create or replace function public.app_insert_pipeline_test_exit(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_extra jsonb := coalesce(payload -> 'extra_test_rounds', '[]'::jsonb);
  v_item jsonb;
  v_current public.recruitment_logs%rowtype;
begin
  perform app_private.resolve_application(payload);
  if jsonb_array_length(v_extra) > 0 then
    raise exception 'PIPELINE_INVALID_TRANSITION: Complete additional Test rounds with Test maintenance before exiting Test.';
  end if;
  if payload ->> 'target_stage' <> 'Reference Check' or jsonb_array_length(v_stages) <> 1 then
    raise exception 'PIPELINE_INVALID_TRANSITION: Test exit must Pass one current Test round into Reference Check.';
  end if;
  v_item := v_stages -> 0;
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is null
  order by app_private.pipeline_stage_index(recruitment_process) desc, round desc, log_id desc limit 1 for update;
  if not found or v_current.recruitment_process <> 'Test' or coalesce(nullif(v_item ->> 'round', '')::integer, 0) <> v_current.round then
    raise exception 'PIPELINE_NOT_CURRENT: Test exit must use the current Pending Test round.';
  end if;
  return public.app_complete_pipeline_stage_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'pending', jsonb_build_object('opened_date', v_current.log_date, 'interviewer', coalesce(nullif(v_item ->> 'interviewer', ''), v_current.interviewer), 'remark', v_current.remark),
    'outcome', jsonb_build_object('result', 'pass', 'date', nullif(v_item ->> 'log_date', '')::date, 'interviewer', nullif(v_item ->> 'interviewer', ''), 'remark', nullif(v_item ->> 'remark', '')),
    'next_pending', jsonb_build_object('stage', 'Reference Check', 'round', 1, 'opened_date', nullif(v_item ->> 'log_date', '')::date)
  ));
end;
$$;
