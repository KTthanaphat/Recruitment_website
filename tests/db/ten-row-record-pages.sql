-- Read-only compatibility regression, with transaction-local authentication and rollback.
begin;
do $checks$
declare
 v_actor uuid; v_entity text; v_sort text; v_limit integer; v_page jsonb;
begin
 select id into strict v_actor from public.profiles where role='system_admin' limit 1;
 perform set_config('request.jwt.claim.sub',v_actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
 for v_entity,v_sort in select * from (values
 ('requisitions','updated_at'),('candidate_registry','updated_at'),
 ('sourcing_records','week'),('pipeline_history','log_date'),
 ('offers','accepted'),('audit_log','changed_at')) cases(entity,sort_key)
 loop
  foreach v_limit in array array[10,25,50,100] loop
   v_page:=public.app_recruitment_list_v1(p_entity=>v_entity,p_sort=>v_sort,p_limit=>v_limit);
   if jsonb_array_length(v_page->'items')>v_limit then raise exception 'Oversized page: % / %',v_entity,v_limit; end if;
  end loop;
  perform public.app_recruitment_list_v1(p_entity=>v_entity,p_sort=>v_sort,p_limit=>0,p_count_only=>true);
  begin
   perform public.app_recruitment_list_v1(p_entity=>v_entity,p_sort=>v_sort,p_limit=>11);
   raise exception 'Unsupported limit accepted: %',v_entity;
  exception when others then
   if sqlerrm not like '%LIMIT_INVALID%' then raise; end if;
  end;
 end loop;
end;
$checks$;
rollback;
