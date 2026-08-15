-- Candidate Pipeline Record Register: audited, administrator-only corrections.
create or replace function public.app_correct_pipeline_stage_record_v3(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_pending jsonb := coalesce(payload -> 'pending', '{}'::jsonb);
  v_outcome jsonb := payload -> 'outcome';
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_row public.recruitment_logs%rowtype;
  v_replacement public.recruitment_logs%rowtype;
  v_replacement_id uuid := gen_random_uuid();
  v_previous_outcome_date date;
  v_next_opened_date date;
begin
  if app_private.current_app_role() not in ('system_admin', 'admin_recruiter') then raise exception 'PIPELINE_ADMIN_REQUIRED: System admin or admin recruiter role is required.'; end if;
  if v_candidate_id is null or v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then raise exception 'PIPELINE_INVALID_PAYLOAD: candidate, stage instance, expected timestamp, and Pending date are required.'; end if;
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;
  select * into v_row from public.recruitment_logs where candidate_id = v_candidate_id and stage_instance_id = v_stage_instance_id and superseded_at is null for update;
  if not found then raise exception 'PIPELINE_NOT_FOUND: A canonical pipeline record is required.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The pipeline record changed after it was opened.'; end if;
  if (v_row.result is null and v_outcome is not null) or (v_row.result is not null and (v_outcome is null or v_result is null or v_outcome_date is null)) then raise exception 'PIPELINE_INVALID_PAYLOAD: Pending records have no Outcome; completed records require result and Outcome date.'; end if;
  select outcome_date into v_previous_outcome_date from public.recruitment_logs where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id order by log_id desc limit 1;
  select log_date into v_next_opened_date from public.recruitment_logs where candidate_id = v_candidate_id and superseded_at is null and log_id > v_row.log_id order by log_id limit 1;
  if v_opened_date > app_private.pipeline_business_date() or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date) or (v_row.result is not null and (v_outcome_date > app_private.pipeline_business_date() or v_outcome_date < v_opened_date or (v_next_opened_date is not null and v_outcome_date > v_next_opened_date))) then raise exception 'PIPELINE_DATE_ORDER: Dates must remain within the previous Outcome, this Pending/Outcome, and the next Pending.'; end if;
  if v_row.result is not null and v_result = 0 and v_next_opened_date is not null then raise exception 'PIPELINE_INVALID_TRANSITION: A failed corrected stage cannot have downstream canonical history.'; end if;
  perform set_config('app.action', 'pipeline:admin-record-correction-supersede', true);
  update public.recruitment_logs set superseded_at = now(), superseded_by_stage_instance_id = v_replacement_id, superseded_reason = 'pipeline record corrected by administrator' where log_id = v_row.log_id;
  perform set_config('app.action', 'pipeline:admin-record-correction-replacement', true);
  insert into public.recruitment_logs (stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at, pending_edited_at, pending_edited_by, record_origin, migration_note, created_at)
  values (v_replacement_id, v_row.candidate_id, v_opened_date, v_row.recruitment_process, v_row.round, nullif(v_pending ->> 'interviewer', ''), case when v_row.result is null then null else v_result end, nullif(v_pending ->> 'remark', ''), case when v_row.result is null then null else v_outcome_date end, case when v_row.result is null then null else nullif(v_outcome ->> 'interviewer', '') end, case when v_row.result is null then null else nullif(v_outcome ->> 'remark', '') end, case when v_row.result is null then null else now() end, now(), auth.uid(), 'correction', concat_ws('; ', nullif(v_row.migration_note, ''), 'corrected from ' || v_row.stage_instance_id::text), v_row.created_at)
  returning * into v_replacement;
  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'superseded_stage_instance_id', v_row.stage_instance_id, 'replacement_stage_instance_id', v_replacement.stage_instance_id, 'updated_at', v_replacement.updated_at);
end;
$$;
revoke all on function public.app_correct_pipeline_stage_record_v3(jsonb) from public, anon, authenticated;
grant execute on function public.app_correct_pipeline_stage_record_v3(jsonb) to authenticated;
