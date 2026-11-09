do $migration$
declare
  v_definition text := pg_get_functiondef('app_private.generate_recruitment_notifications_v1()'::regprocedure);
  v_old text := 'on conflict (recipient_id, notification_key) do nothing;';
  v_new text := $replacement$on conflict (recipient_id, notification_key) do update
    set resolved_at = null, resolution_reason = null
    where public.recruitment_notifications.resolved_at is not null
      and (excluded.notification_type = 'new_hire_confirmation'
        or excluded.first_working_date + excluded.milestone_days >= v_today);$replacement$;
begin
  if position(v_old in v_definition) = 0 then
    raise exception 'Notification generator conflict handling differs from expected; migration stopped';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$migration$;
select app_private.generate_recruitment_notifications_v1();
