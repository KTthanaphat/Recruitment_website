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
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if v_target_stage is null then raise exception 'Target stage is required.'; end if;
  if v_stage_count = 0 then raise exception 'At least one passed stage is required.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;

  select recruitment_process, result
    into v_current_stage, v_current_result
  from public.recruitment_logs
  where candidate_id = v_candidate_id
  order by log_id desc
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
      where candidate_id = v_candidate_id
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
