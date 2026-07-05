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
  perform public.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if not public.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;

  select recruitment_process, result, round
    into v_current_stage, v_current_result, v_latest_round
  from public.recruitment_logs
  where candidate_id = v_candidate_id
  order by log_id desc
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
  perform public.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if v_target_stage <> 'Reference Check' then raise exception 'Test exit target must be Reference Check.'; end if;
  if v_stage_count <> 1 then raise exception 'Test exit must pass exactly one Test stage.'; end if;
  if not public.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;

  select recruitment_process, result, round
    into v_current_stage, v_current_result, v_latest_round
  from public.recruitment_logs
  where candidate_id = v_candidate_id
  order by log_id desc
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

grant execute on function public.app_insert_test_maintenance(jsonb) to authenticated;
grant execute on function public.app_insert_pipeline_test_exit(jsonb) to authenticated;
