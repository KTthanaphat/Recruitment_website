create or replace function app_private.sync_application_lifecycle() returns trigger language plpgsql security definer set search_path=public,app_private as $$
begin
  if tg_table_name='recruitment_logs' then
   if new.result=0 and new.superseded_at is null then
    update public.candidate_applications set state='closed',closure_reason='failed_stage',closed_at=now(),updated_at=now(),version=version+1 where application_id=new.application_id;
   else
    update public.candidate_applications set state='active',closure_reason=null,closed_at=null,updated_at=now(),version=version+1 where application_id=new.application_id and closure_reason='failed_stage' and not exists(select 1 from public.recruitment_logs l where l.application_id=new.application_id and l.result=0 and l.superseded_at is null);
   end if;
  elsif tg_table_name='offers' then
    if new.accepted_date is not null and new.start_confirmation is distinct from 'did_not_start' then
      update public.candidate_applications set state='closed',closure_reason='accepted_offer',closed_at=coalesce(closed_at,now()),updated_at=now(),version=version+1 where application_id=new.application_id;
    elsif tg_op='UPDATE' and old.accepted_date is not null and old.start_confirmation is distinct from 'did_not_start' then
      update public.candidate_applications a set state=case when exists(select 1 from public.candidate_applications other where other.candidate_id=a.candidate_id and other.group_id=a.group_id and other.state='active' and other.application_id<>a.application_id) then 'closed' else 'active' end,
        closure_reason=case when exists(select 1 from public.candidate_applications other where other.candidate_id=a.candidate_id and other.group_id=a.group_id and other.state='active' and other.application_id<>a.application_id) then 'did_not_start' else null end,
        closed_at=case when exists(select 1 from public.candidate_applications other where other.candidate_id=a.candidate_id and other.group_id=a.group_id and other.state='active' and other.application_id<>a.application_id) then coalesce(a.closed_at,now()) else null end,
        updated_at=now(),version=version+1 where a.application_id=new.application_id and a.closure_reason='accepted_offer';
    end if;
  end if;
  return new;
end $$;
create or replace function app_private.derive_pipeline_pending_date() returns trigger language plpgsql security definer set search_path = public, app_private as $$
declare v_first date; v_previous date; v_has_previous boolean;
begin
  if new.superseded_at is not null then return new; end if;
  if new.record_origin = 'correction' and app_private.is_system_admin() then
    if new.estimated_action_date is not null and new.estimated_action_date < new.log_date then raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Estimated action date cannot precede the corrected Pending date.'; end if;
    return new;
  end if;
  select exists(select 1 from public.recruitment_logs l where l.application_id = new.application_id and l.superseded_at is null and l.log_id is distinct from new.log_id) into v_has_previous;
  if new.recruitment_process='Phone Screen' then
    -- A fresh application has its own entry date; shared profile outreach is not its stage entry.
    if tg_op='UPDATE' then new.log_date:=old.log_date;
    else new.log_date:=coalesce(new.log_date,(now() at time zone 'Asia/Bangkok')::date); end if;
  else
    select l.outcome_date into v_previous from public.recruitment_logs l where l.application_id = new.application_id and l.superseded_at is null and l.result = 1 and (app_private.pipeline_stage_index(l.recruitment_process) < app_private.pipeline_stage_index(new.recruitment_process) or (l.recruitment_process in ('Line Interview', 'Test') and l.recruitment_process = new.recruitment_process and l.round < new.round)) order by app_private.pipeline_stage_index(l.recruitment_process) desc, l.round desc, l.log_id desc limit 1;
    if v_previous is null then raise exception 'PIPELINE_DATE_ORDER: Pending date must derive from the previous passed Outcome.'; end if;
    new.log_date := v_previous;
  end if;
  if new.estimated_action_date is not null and new.estimated_action_date < new.log_date then raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Estimated action date cannot precede the derived Pending date.'; end if;
  return new;
end;
$$;
