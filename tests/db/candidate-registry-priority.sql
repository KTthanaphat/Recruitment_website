begin;
create temporary table priority_test_actors as select id,role from public.profiles;
grant select on priority_test_actors to authenticated;
create temporary table priority_test_results(role text,rows_checked integer);
grant insert,select on priority_test_results to authenticated;
do $checks$
declare actor record; page jsonb; item jsonb; expected boolean; checked integer;
begin
 for actor in select * from priority_test_actors loop
  perform set_config('request.jwt.claim.sub',actor.id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  page:=public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_limit=>100,p_sort=>'updated_at');
  checked:=0;
  for item in select value from jsonb_array_elements(page->'items') loop
   if jsonb_typeof(item->'has_priority_requisition') is distinct from 'boolean' then raise exception 'Missing boolean for role %',actor.role; end if;
   expected:=not coalesce((item->>'masked')::boolean,false) and exists(
    select 1 from public.candidate_applications a join public.document_groups g on g.group_id=a.group_id
    join public.requisitions r on r.doc_id=g.doc_id
    where a.candidate_id=item->>'candidate_id' and a.state='active' and r.is_priority is true
    and app_private.can_read_application(a.application_id) and app_private.can_read_requisition(r.doc_id));
   if (item->>'has_priority_requisition')::boolean is distinct from expected then raise exception 'Priority authorization mismatch for role %',actor.role; end if;
   if coalesce((item->>'masked')::boolean,false) and item->>'updated_at' is not null then raise exception 'Masked update timestamp leaked'; end if;
   checked:=checked+1;
  end loop;
  insert into priority_test_results values(actor.role,checked);
  execute 'reset role';
 end loop;
end;$checks$;
do $toggle$
declare actor uuid; candidate text; document text; page jsonb; flag boolean;
begin
 select id into strict actor from public.profiles where role='system_admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select a.candidate_id,g.doc_id into candidate,document from public.candidate_applications a join public.document_groups g on g.group_id=a.group_id where a.state='active' limit 1;
 if candidate is null then raise exception 'No active linked fixture available'; end if;
 update public.requisitions set is_priority=false where doc_id in(select g.doc_id from public.document_groups g join public.candidate_applications a on a.group_id=g.group_id where a.candidate_id=candidate and a.state='active');
 execute 'set local role authenticated';
 page:=public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_limit=>7,p_search=>candidate);
 select (item->>'has_priority_requisition')::boolean into strict flag from jsonb_array_elements(page->'items') item where item->>'candidate_id'=candidate;
 if flag is not false then raise exception 'Unprioritized fixture returned true'; end if;
 execute 'reset role';
 update public.requisitions set is_priority=true where doc_id=document;
 execute 'set local role authenticated';
 page:=public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_limit=>7,p_search=>candidate);
 select (item->>'has_priority_requisition')::boolean into strict flag from jsonb_array_elements(page->'items') item where item->>'candidate_id'=candidate;
 if flag is not true then raise exception 'Priority change was not projected'; end if;
 execute 'reset role';
end;$toggle$;
select role,sum(rows_checked)::integer rows_checked from priority_test_results group by role;
rollback;