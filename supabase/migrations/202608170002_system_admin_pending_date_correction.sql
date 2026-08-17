-- System Admin Pending-date corrections preserve the submitted date instead of
-- replacing it with the derived preceding Outcome date.
create or replace function app_private.derive_pipeline_pending_date()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_first date;
  v_previous date;
  v_has_previous boolean;
begin
  if new.superseded_at is not null then
    return new;
  end if;

  if new.record_origin = 'correction' and app_private.is_system_admin() then
    if new.estimated_action_date is not null and new.estimated_action_date < new.log_date then
      raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Estimated action date cannot precede the corrected Pending date.';
    end if;
    return new;
  end if;

  select exists (
    select 1
    from public.recruitment_logs log
    where log.candidate_id = new.candidate_id
      and log.superseded_at is null
      and log.log_id is distinct from new.log_id
  ) into v_has_previous;

  if not v_has_previous then
    select first_contact_date into v_first
    from public.candidates
    where candidate_id = new.candidate_id;
    if v_first is null then
      raise exception 'PIPELINE_FIRST_CONTACT_REQUIRED: Add First Contact Date before starting Phone Screen.';
    end if;
    new.log_date := v_first;
  else
    select log.outcome_date into v_previous
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
    if v_previous is null then
      raise exception 'PIPELINE_DATE_ORDER: Pending date must derive from the previous passed Outcome.';
    end if;
    new.log_date := v_previous;
  end if;

  if new.estimated_action_date is not null and new.estimated_action_date < new.log_date then
    raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Estimated action date cannot precede the derived Pending date.';
  end if;
  return new;
end;
$$;
