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
begin
  perform public.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if v_target_stage is null then raise exception 'Target stage is required.'; end if;
  if v_stage_count = 0 then raise exception 'At least one passed stage is required.'; end if;
  if not public.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;

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
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
    values (
      v_candidate_id,
      nullif(v_item ->> 'log_date', '')::date,
      nullif(v_item ->> 'stage', ''),
      coalesce(nullif(v_item ->> 'round', '')::integer, 1),
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

grant execute on function public.app_insert_pipeline_passes(jsonb) to authenticated;
