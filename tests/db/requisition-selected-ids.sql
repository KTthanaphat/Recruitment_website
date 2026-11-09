begin;
create temporary table selection_actors as select id,role from public.profiles;
create temporary table selection_ids as select doc_id from public.requisitions order by doc_id limit 5;
grant select on selection_actors,selection_ids to authenticated;
create temporary table selection_results(role text,checks integer);
grant insert,select on selection_results to authenticated;
do $checks$
declare actor record; base jsonb; ids jsonb; mode jsonb; result jsonb; expected integer; actual integer; bad jsonb; total integer;
begin
 select coalesce(jsonb_agg(doc_id),'[]')||'["NO-SUCH-DOCUMENT"]'::jsonb into ids from selection_ids;
 for actor in select * from selection_actors loop
  perform set_config('request.jwt.claim.sub',actor.id::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  base:=public.app_recruitment_list_v1(p_entity=>'requisitions',p_limit=>100);
  select count(*) into expected from jsonb_array_elements(base->'items') row where ids ? (row->>'doc_id');
  total:=0;
  for mode in select value from jsonb_array_elements(jsonb_build_array(jsonb_build_object('docIds',ids),jsonb_build_object('docIds',ids,'open_headcount',''))) loop
   result:=public.app_recruitment_list_v1(p_entity=>'requisitions',p_filters=>mode,p_limit=>100);
   actual:=(public.app_recruitment_list_v1(p_entity=>'requisitions',p_filters=>mode,p_limit=>0,p_count_only=>true)->>'total_count')::integer;
   if actual<>expected or jsonb_array_length(result->'items')<>expected then raise exception 'ID batch list/count/RLS mismatch: %',actor.role;end if;total:=total+1;
  end loop;
  result:=public.app_recruitment_list_v1(p_entity=>'requisitions',p_filters=>'{"docIds":[]}',p_limit=>7);
  if jsonb_array_length(result->'items')<>0 then raise exception 'Empty selection returned rows';end if;total:=total+1;
  for bad in select value from jsonb_array_elements(jsonb_build_array('{"docIds":null}'::jsonb,'{"docIds":"wrong"}'::jsonb,'{"docIds":[2]}'::jsonb,'{"docIds":[""]}'::jsonb,jsonb_build_object('docIds',(select jsonb_agg('R'||g) from generate_series(1,101)g)))) loop
   begin perform public.app_recruitment_list_v1(p_entity=>'requisitions',p_filters=>bad,p_limit=>7);raise exception 'Invalid docIds accepted';
   exception when others then if sqlerrm<>'RECRUITMENT_LIST_FILTER_INVALID' then raise;end if;end;total:=total+1;
  end loop;
  insert into selection_results values(actor.role,total);execute 'reset role';
 end loop;
end;$checks$;
select role,sum(checks)checks from selection_results group by role;
rollback;
