create or replace function app_private.assert_candidate_pipeline_open(p_candidate_id text)
returns void
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
begin
  if exists (
    select 1
    from public.recruitment_logs
    where candidate_id = p_candidate_id
      and result = 0
  ) then
    raise exception 'Pipeline update unavailable because this candidate has a failed stage.';
  end if;

  if (
    select count(distinct recruitment_process)
    from public.recruitment_logs
    where candidate_id = p_candidate_id
      and result = 1
      and recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
  ) = 6 then
    raise exception 'Pipeline update unavailable because this candidate completed all stages.';
  end if;
end;
$$;

do $$
declare
  v_function regprocedure;
  v_sql text;
  v_old text := $match$if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;$match$;
  v_new text := $match$if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);$match$;
begin
  foreach v_function in array array[
    'public.app_insert_recruitment_log(jsonb)'::regprocedure,
    'public.app_insert_pipeline_passes(jsonb)'::regprocedure,
    'public.app_insert_test_maintenance(jsonb)'::regprocedure,
    'public.app_insert_pipeline_test_exit(jsonb)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_function) into v_sql;
    if position('assert_candidate_pipeline_open' in v_sql) > 0 then
      continue;
    end if;

    v_sql := replace(v_sql, v_old, v_new);
    if position('assert_candidate_pipeline_open' in v_sql) = 0 then
      raise exception 'Could not patch pipeline guard into %', v_function;
    end if;
    execute v_sql;
  end loop;
end;
$$;
