-- Canonical Pending dates are derived server-side. Client-provided log_date values
-- remain accepted for backward-compatible payloads but are never authoritative.
create or replace function app_private.derive_pipeline_pending_date()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_first_contact_date date;
  v_previous_outcome_date date;
  v_has_previous boolean;
begin
  if new.superseded_at is not null then return new; end if;

  select exists(
    select 1 from public.recruitment_logs log
    where log.candidate_id = new.candidate_id
      and log.superseded_at is null
      and log.log_id is distinct from new.log_id
  ) into v_has_previous;

  if not v_has_previous then
    select first_contact_date into v_first_contact_date
    from public.candidates where candidate_id = new.candidate_id;
    if v_first_contact_date is null then
      raise exception 'PIPELINE_FIRST_CONTACT_REQUIRED: Add First Contact Date before starting Phone Screen.';
    end if;
    new.log_date := v_first_contact_date;
  else
    select log.outcome_date into v_previous_outcome_date
    from public.recruitment_logs log
    where log.candidate_id = new.candidate_id
      and log.superseded_at is null
      and log.result = 1
      and (
        app_private.pipeline_stage_index(log.recruitment_process) < app_private.pipeline_stage_index(new.recruitment_process)
        or (log.recruitment_process = 'Test' and new.recruitment_process = 'Test' and log.round < new.round)
      )
    order by app_private.pipeline_stage_index(log.recruitment_process) desc, log.round desc, log.log_id desc
    limit 1;
    if v_previous_outcome_date is null then
      raise exception 'PIPELINE_DATE_ORDER: Pending date must derive from the previous passed Outcome.';
    end if;
    new.log_date := v_previous_outcome_date;
  end if;

  if new.estimated_action_date is not null and new.estimated_action_date < new.log_date then
    raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Estimated action date cannot precede the derived Pending date.';
  end if;
  return new;
end;
$$;

drop trigger if exists derive_pipeline_pending_date on public.recruitment_logs;
create trigger derive_pipeline_pending_date
before insert or update on public.recruitment_logs
for each row execute function app_private.derive_pipeline_pending_date();

create or replace function app_private.propagate_corrected_outcome_date()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_next public.recruitment_logs%rowtype;
begin
  if new.superseded_at is not null or new.record_origin <> 'correction' or new.result <> 1 then return new; end if;
  if exists (
    select 1 from public.recruitment_logs log
    where log.candidate_id = new.candidate_id and log.superseded_at is null and log.result is not null
      and (app_private.pipeline_stage_index(log.recruitment_process) > app_private.pipeline_stage_index(new.recruitment_process)
        or (log.recruitment_process = 'Test' and new.recruitment_process = 'Test' and log.round > new.round))
  ) then
    raise exception 'PIPELINE_DOWNSTREAM_HISTORY: Outcome date cannot change after a later completed stage exists.';
  end if;
  select * into v_next from public.recruitment_logs log
  where log.candidate_id = new.candidate_id and log.superseded_at is null
    and (app_private.pipeline_stage_index(log.recruitment_process) > app_private.pipeline_stage_index(new.recruitment_process)
      or (log.recruitment_process = 'Test' and new.recruitment_process = 'Test' and log.round > new.round))
  order by app_private.pipeline_stage_index(log.recruitment_process), log.round, log.log_id
  limit 1 for update;
  if new.recruitment_process <> 'Offer' and not found then
    raise exception 'PIPELINE_NEXT_PENDING_REQUIRED: A next unresolved Pending stage is required for this Outcome correction.';
  end if;
  if found then
    if v_next.result is not null then
      raise exception 'PIPELINE_DOWNSTREAM_HISTORY: Outcome date cannot change after a later completed stage exists.';
    end if;
    if v_next.estimated_action_date is not null and v_next.estimated_action_date < new.outcome_date then
      raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Corrected Outcome would exceed the next Pending estimate.';
    end if;
    perform set_config('app.action', 'pipeline:derived-next-pending-date', true);
    update public.recruitment_logs set log_date = new.outcome_date where log_id = v_next.log_id;
  end if;
  return new;
end;
$$;

drop trigger if exists propagate_corrected_outcome_date on public.recruitment_logs;
create trigger propagate_corrected_outcome_date
after insert on public.recruitment_logs
for each row execute function app_private.propagate_corrected_outcome_date();

create or replace function public.app_correct_pipeline_stage_record_v3(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
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
  if v_opened_date > app_private.pipeline_business_date() or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date) or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date) or (v_row.result is not null and (v_outcome_date > app_private.pipeline_business_date() or v_outcome_date < v_opened_date)) then raise exception 'PIPELINE_DATE_ORDER: Dates must remain within the previous Outcome and this Pending/Outcome.'; end if;
  perform set_config('app.action', 'pipeline:admin-record-correction-supersede', true);
  update public.recruitment_logs set superseded_at = now(), superseded_by_stage_instance_id = v_replacement_id, superseded_reason = 'pipeline record corrected by administrator' where log_id = v_row.log_id;
  perform set_config('app.action', 'pipeline:admin-record-correction-replacement', true);
  insert into public.recruitment_logs (stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, estimated_action_date, outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at, pending_edited_at, pending_edited_by, record_origin, migration_note, created_at)
  values (v_replacement_id, v_row.candidate_id, v_opened_date, v_row.recruitment_process, v_row.round, nullif(v_pending ->> 'interviewer', ''), case when v_row.result is null then null else v_result end, nullif(v_pending ->> 'remark', ''), v_estimated_action_date, case when v_row.result is null then null else v_outcome_date end, case when v_row.result is null then null else nullif(v_outcome ->> 'interviewer', '') end, case when v_row.result is null then null else nullif(v_outcome ->> 'remark', '') end, case when v_row.result is null then null else now() end, now(), auth.uid(), 'correction', concat_ws('; ', nullif(v_row.migration_note, ''), 'corrected from ' || v_row.stage_instance_id::text), v_row.created_at)
  returning * into v_replacement;
  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'superseded_stage_instance_id', v_row.stage_instance_id, 'replacement_stage_instance_id', v_replacement.stage_instance_id, 'updated_at', v_replacement.updated_at);
end;
$$;
revoke all on function public.app_correct_pipeline_stage_record_v3(jsonb) from public, anon, authenticated;
grant execute on function public.app_correct_pipeline_stage_record_v3(jsonb) to authenticated;
