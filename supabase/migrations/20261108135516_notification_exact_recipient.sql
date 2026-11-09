create or replace function app_private.notification_assigned_recruiter_v1(p_doc_id text)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then min(p.id::text)::uuid else null::uuid end
  from public.requisitions r
  join public.profiles p on p.role in ('site_recruiter','admin_recruiter','system_admin')
    and ((nullif(btrim(p.nickname),'') is not null and lower(btrim(p.nickname)) = lower(btrim(coalesce(r.person_in_charge,''))))
      or (nullif(btrim(p.full_name),'') is not null and lower(btrim(p.full_name)) = lower(btrim(coalesce(r.person_in_charge,'')))))
  where r.doc_id = p_doc_id;
$$;
revoke all on function app_private.notification_assigned_recruiter_v1(text) from public, anon, authenticated;

do $migration$
declare
  v_definition text := pg_get_functiondef('app_private.generate_recruitment_notifications_v1()'::regprocedure);
  v_role text := $old$p.role in ('site_recruiter', 'admin_recruiter', 'system_admin')$old$;
  v_nick text := $old$position(lower(btrim(p.nickname)) in lower(coalesce(r.person_in_charge, ''))) > 0$old$;
  v_full text := $old$position(lower(btrim(p.full_name)) in lower(coalesce(r.person_in_charge, ''))) > 0$old$;
begin
  if (length(v_definition)-length(replace(v_definition,v_role,'')))/length(v_role) <> 2
    or (length(v_definition)-length(replace(v_definition,v_nick,'')))/length(v_nick) <> 2
    or (length(v_definition)-length(replace(v_definition,v_full,'')))/length(v_full) <> 2
  then raise exception 'Notification generator definition differs from expected; migration stopped'; end if;
  v_definition := replace(v_definition, v_role, v_role || ' and p.id = app_private.notification_assigned_recruiter_v1(r.doc_id)');
  v_definition := replace(v_definition, v_nick, $new$lower(btrim(p.nickname)) = lower(btrim(coalesce(r.person_in_charge, '')))$new$);
  v_definition := replace(v_definition, v_full, $new$lower(btrim(p.full_name)) = lower(btrim(coalesce(r.person_in_charge, '')))$new$);
  execute v_definition;
end;
$migration$;

select app_private.generate_recruitment_notifications_v1();
