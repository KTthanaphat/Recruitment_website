begin;

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
  v_row public.recruitment_logs%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_opened_date is null then raise exception 'PIPELINE_INVALID_PAYLOAD: Pending opened date is required.'; end if;
  if v_opened_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Pending opened date cannot be after the Bangkok business date.';
  end if;
  if exists (select 1 from public.recruitment_logs where candidate_id = v_candidate_id and superseded_at is null) then
    raise exception 'PIPELINE_INVALID_TRANSITION: A canonical Pipeline stage already exists.';
  end if;
  perform set_config('app.action', 'pipeline:start', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin)
  values (v_candidate_id, v_opened_date, 'Phone Screen', 1, nullif(v_pending ->> 'interviewer', ''), null, nullif(v_pending ->> 'remark', ''), 'user')
  returning * into v_row;
  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'id', v_row.log_id::text, 'stage_instance_id', v_row.stage_instance_id, 'updated_at', v_row.updated_at);
end;
$$;

revoke all on function public.app_start_pipeline_stage_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_start_pipeline_stage_v2(jsonb) to authenticated;
drop function if exists public.app_insert_recruitment_log(jsonb);
drop function if exists public.app_insert_pipeline_passes(jsonb);
drop function if exists public.app_insert_test_maintenance(jsonb);
drop function if exists public.app_insert_pipeline_test_exit(jsonb);

commit;
