-- A System Admin may correct an Outcome while retaining completed downstream history.
-- Other roles remain subject to the downstream-history safeguard.
create or replace function app_private.propagate_corrected_outcome_date()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_next public.recruitment_logs%rowtype;
begin
  if new.superseded_at is not null or new.record_origin <> 'correction' or new.result <> 1 then
    return new;
  end if;

  if exists (
    select 1
    from public.recruitment_logs log
    where log.candidate_id = new.candidate_id
      and log.superseded_at is null
      and log.result is not null
      and (
        app_private.pipeline_stage_index(log.recruitment_process) > app_private.pipeline_stage_index(new.recruitment_process)
        or (log.recruitment_process = 'Test' and new.recruitment_process = 'Test' and log.round > new.round)
      )
  ) and not app_private.is_system_admin() then
    raise exception 'PIPELINE_DOWNSTREAM_HISTORY: Outcome date cannot change after a later completed stage exists.';
  end if;

  select * into v_next
  from public.recruitment_logs log
  where log.candidate_id = new.candidate_id
    and log.superseded_at is null
    and (
      app_private.pipeline_stage_index(log.recruitment_process) > app_private.pipeline_stage_index(new.recruitment_process)
      or (log.recruitment_process = 'Test' and new.recruitment_process = 'Test' and log.round > new.round)
    )
  order by app_private.pipeline_stage_index(log.recruitment_process), log.round, log.log_id
  limit 1
  for update;

  if new.recruitment_process <> 'Offer' and not found then
    raise exception 'PIPELINE_NEXT_PENDING_REQUIRED: A next unresolved Pending stage is required for this Outcome correction.';
  end if;

  -- Completed records are historical facts.  A System Admin correction leaves
  -- them intact; only an unresolved immediate successor is re-derived.
  if found and v_next.result is null then
    if v_next.estimated_action_date is not null and v_next.estimated_action_date < new.outcome_date then
      raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Corrected Outcome would exceed the next Pending estimate.';
    end if;
    perform set_config('app.action', 'pipeline:derived-next-pending-date', true);
    update public.recruitment_logs
    set log_date = new.outcome_date
    where log_id = v_next.log_id;
  end if;

  return new;
end;
$$;
