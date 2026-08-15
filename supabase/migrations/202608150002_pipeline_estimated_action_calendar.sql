-- Estimated Pipeline actions and Home recruitment calendar support.
-- Existing records intentionally keep a null estimate; no inferred backfill is applied.

alter table public.recruitment_logs
  add column if not exists estimated_action_date date;

alter table public.recruitment_logs
  drop constraint if exists recruitment_logs_estimated_action_date_order;

alter table public.recruitment_logs
  add constraint recruitment_logs_estimated_action_date_order
  check (estimated_action_date is null or estimated_action_date >= log_date);

create or replace function public.app_start_pipeline_stage_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_pending jsonb := coalesce(payload -> 'pending', '{}'::jsonb);
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_row public.recruitment_logs%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_opened_date is null then raise exception 'PIPELINE_INVALID_PAYLOAD: Pending opened date is required.'; end if;
  if v_opened_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Pending opened date cannot be after the Bangkok business date.';
  end if;
  if v_estimated_action_date is not null and v_estimated_action_date < v_opened_date then
    raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Estimated action date cannot be before the Pending opened date.';
  end if;
  if exists (
    select 1 from public.recruitment_logs
    where candidate_id = v_candidate_id and superseded_at is null
  ) then
    raise exception 'PIPELINE_INVALID_TRANSITION: A canonical Pipeline stage already exists.';
  end if;

  perform set_config('app.action', 'pipeline:start', true);
  insert into public.recruitment_logs (
    candidate_id, log_date, recruitment_process, round, interviewer, result, remark, estimated_action_date, record_origin
  ) values (
    v_candidate_id, v_opened_date, 'Phone Screen', 1,
    nullif(v_pending ->> 'interviewer', ''), null, nullif(v_pending ->> 'remark', ''), v_estimated_action_date, 'user'
  ) returning * into v_row;
  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'id', v_row.log_id::text,
    'stage_instance_id', v_row.stage_instance_id,
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.app_start_pipeline_stage_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_start_pipeline_stage_v2(jsonb) to authenticated;

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
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage_instance_id, expected_updated_at, and pending.opened_date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id
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
    where later.candidate_id = v_candidate_id
      and later.superseded_at is null
      and later.log_id > v_row.log_id
  ) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
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

revoke all on function public.app_update_pipeline_pending_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_update_pipeline_pending_v2(jsonb) to authenticated;

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
  v_next_opened_date date;
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_next_estimated_action_date date := nullif(v_next ->> 'estimated_action_date', '')::date;
  v_expected_next_stage text;
  v_previous_outcome_date date;
  v_row public.recruitment_logs%rowtype;
  v_next_row public.recruitment_logs%rowtype;
  v_next_id uuid;
  v_handoff jsonb;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null or v_outcome_date is null or v_result is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage instance, expected timestamp, Pending date, and Pass/Fail outcome date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id
    and stage_instance_id = v_stage_instance_id
    and superseded_at is null
  for update;

  if not found or v_row.result is not null then raise exception 'PIPELINE_NOT_CURRENT: The selected stage is not Pending.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.superseded_at is null and later.log_id > v_row.log_id) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
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
  elsif v_row.recruitment_process = 'Offer' then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Offer Pass uses handoff and cannot create a next Pending stage.'; end if;
  elsif v_row.recruitment_process = 'Test' and v_next_stage = 'Test' then
    if v_next_round <> v_row.round + 1 then raise exception 'PIPELINE_INVALID_TRANSITION: The next Test round must be current round plus one.'; end if;
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
      'passed_date', v_outcome_date,
      'group_id', anchor.group_id,
      'requisitions', coalesce(jsonb_agg(jsonb_build_object(
        'doc_group_id', peer.doc_group_id,
        'doc_id', r.doc_id,
        'site', r.site,
        'position', r.position,
        'open_headcount', greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0)
      ) order by r.doc_id) filter (where r.doc_id is not null), '[]'::jsonb)
    ) into v_handoff
    from public.candidates c
    join public.document_groups anchor on anchor.doc_group_id = c.doc_group_id
    join public.document_groups peer on (anchor.group_id is not null and peer.group_id = anchor.group_id) or peer.doc_group_id = anchor.doc_group_id
    join public.requisitions r on r.doc_id = peer.doc_id and r.status = 'ongoing'
    left join lateral (
      select count(*)::integer accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null
    ) accepted on true
    where c.candidate_id = v_candidate_id
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
    group by anchor.group_id;

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

revoke all on function public.app_complete_pipeline_stage_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_complete_pipeline_stage_v2(jsonb) to authenticated;

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
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_count < 1 or v_target_stage is null or v_target_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: current instance, expected timestamp, passed stages, and target Pending are required.';
  end if;

  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found or v_current.result is not null then raise exception 'PIPELINE_NOT_CURRENT: Jump requires the current Pending stage.'; end if;
  if v_current.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.superseded_at is null and later.log_id > v_current.log_id) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_current.log_id
  order by log_id desc limit 1;

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
      where candidate_id = v_candidate_id and superseded_at is null and result = 1
        and log_id >= v_current.log_id and log_id < (select log_id from public.recruitment_logs where stage_instance_id = v_new_id)
    ),
    'next_stage', jsonb_build_object('stage_instance_id', v_new_id, 'stage', v_target_stage, 'round', coalesce(nullif(v_target ->> 'round', '')::integer, 1), 'opened_date', v_target_date)
  );
end;
$$;

revoke all on function public.app_pass_pipeline_jump_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_pass_pipeline_jump_v2(jsonb) to authenticated;

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
begin
  if app_private.current_app_role() not in ('system_admin', 'admin_recruiter') then
    raise exception 'PIPELINE_ADMIN_REQUIRED: System admin or admin recruiter role is required.';
  end if;
  if v_candidate_id is null or v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: candidate, stage instance, expected timestamp, and Pending date are required.';
  end if;
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;

  select * into v_row from public.recruitment_logs
  where candidate_id = v_candidate_id and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found then raise exception 'PIPELINE_NOT_FOUND: A canonical pipeline record is required.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The pipeline record changed after it was opened.'; end if;
  if (v_row.result is null and v_outcome is not null) or (v_row.result is not null and (v_outcome is null or v_result is null or v_outcome_date is null)) then
    raise exception 'PIPELINE_INVALID_PAYLOAD: Pending records have no Outcome; completed records require result and Outcome date.';
  end if;

  select outcome_date into v_previous_outcome_date from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  select log_date into v_next_opened_date from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and log_id > v_row.log_id
  order by log_id limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
    or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date)
    or (v_row.result is not null and (v_outcome_date > app_private.pipeline_business_date() or v_outcome_date < v_opened_date or (v_next_opened_date is not null and v_outcome_date > v_next_opened_date)))
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must remain within the previous Outcome, this Pending/Outcome, and the next Pending.';
  end if;
  if v_row.result is not null and v_result = 0 and v_next_opened_date is not null then
    raise exception 'PIPELINE_INVALID_TRANSITION: A failed corrected stage cannot have downstream canonical history.';
  end if;

  perform set_config('app.action', 'pipeline:admin-record-correction-supersede', true);
  update public.recruitment_logs set superseded_at = now(), superseded_by_stage_instance_id = v_replacement_id,
    superseded_reason = 'pipeline record corrected by administrator' where log_id = v_row.log_id;
  perform set_config('app.action', 'pipeline:admin-record-correction-replacement', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
    estimated_action_date, outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at,
    pending_edited_at, pending_edited_by, record_origin, migration_note, created_at
  ) values (
    v_replacement_id, v_row.candidate_id, v_opened_date, v_row.recruitment_process, v_row.round,
    nullif(v_pending ->> 'interviewer', ''), case when v_row.result is null then null else v_result end, nullif(v_pending ->> 'remark', ''),
    v_estimated_action_date,
    case when v_row.result is null then null else v_outcome_date end,
    case when v_row.result is null then null else nullif(v_outcome ->> 'interviewer', '') end,
    case when v_row.result is null then null else nullif(v_outcome ->> 'remark', '') end,
    case when v_row.result is null then null else now() end,
    now(), auth.uid(), 'correction', concat_ws('; ', nullif(v_row.migration_note, ''), 'corrected from ' || v_row.stage_instance_id::text), v_row.created_at
  ) returning * into v_replacement;
  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'superseded_stage_instance_id', v_row.stage_instance_id,
    'replacement_stage_instance_id', v_replacement.stage_instance_id, 'updated_at', v_replacement.updated_at);
end;
$$;

revoke all on function public.app_correct_pipeline_stage_record_v3(jsonb) from public, anon, authenticated;
grant execute on function public.app_correct_pipeline_stage_record_v3(jsonb) to authenticated;
