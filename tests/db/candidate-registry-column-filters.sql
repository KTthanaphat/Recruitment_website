begin;
create temporary table candidate_filter_actors as select id,role from public.profiles;
grant select on candidate_filter_actors to authenticated;
create temporary table candidate_filter_results(role text,checks integer);
grant insert,select on candidate_filter_results to authenticated;
do $checks$
declare actor record; base jsonb; page jsonb; filters jsonb; sample jsonb; expected integer; total integer; n integer; bad jsonb; cursor jsonb; seen text[]; item jsonb;
begin
 for actor in select * from candidate_filter_actors loop
  perform set_config('request.jwt.claim.sub',actor.id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor.id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  base:=public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_limit=>100);
  if (public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_limit=>0,p_count_only=>true)->>'total_count')::integer>100 then raise exception 'Regression population exceeds bounded baseline'; end if;
  sample:=base->'items'->0;n:=0;
  for filters in select value from jsonb_array_elements(jsonb_build_array(
   '{}'::jsonb,'{"candidateText":"%"}'::jsonb,'{"candidateText":"_"}'::jsonb,'{"contactText":"%"}'::jsonb,
   jsonb_build_object('candidateText',coalesce(sample->>'candidate_id','none')),
   jsonb_build_object('creatorText',coalesce(sample->>'creator_label','none')),
   jsonb_build_object('candidateSite',coalesce(sample->>'home_site','nonexistent')),
   jsonb_build_object('sourceText',coalesce(sample->>'channel','nonexistent')),
   '{"activeMin":"0"}'::jsonb,'{"activeMax":"0"}'::jsonb,'{"activeMin":"1","activeMax":"3"}'::jsonb,
   '{"updatedFrom":"2020-01-01","updatedTo":"2030-12-31"}'::jsonb,
   jsonb_build_object('candidateIds',jsonb_build_array(sample->>'candidate_id')),
   '{"candidateIds":[]}'::jsonb,'{"contactText":"0","activeMin":"1","updatedFrom":"2020-01-01"}'::jsonb
  )) loop
   select count(*) into expected from jsonb_array_elements(base->'items') row
   where (not(filters?'candidateIds') or row->>'candidate_id' in(select jsonb_array_elements_text(filters->'candidateIds')))
   and (coalesce(filters->>'candidateText','')='' or strpos(lower(concat_ws(' ',row->>'candidate_id',row->>'name',row->>'nickname')),lower(filters->>'candidateText'))>0)
   and (coalesce(filters->>'contactText','')='' or (not(row->>'masked')::boolean and strpos(lower(concat_ws(' ',row->>'phone_no',row->>'email')),lower(filters->>'contactText'))>0))
   and (coalesce(filters->>'candidateSite','')='' or (not(row->>'masked')::boolean and strpos(lower(coalesce(row->>'home_site','')),lower(filters->>'candidateSite'))>0))
   and (coalesce(filters->>'creatorText','')='' or strpos(lower(coalesce(row->>'creator_label','')),lower(filters->>'creatorText'))>0)
   and (coalesce(filters->>'sourceText','')='' or (not(row->>'masked')::boolean and strpos(lower(coalesce(row->>'channel','')),lower(filters->>'sourceText'))>0))
   and (coalesce(filters->>'interestsText','')='' or strpos(lower(coalesce(row->>'position_interests','')),lower(filters->>'interestsText'))>0)
   and (coalesce(filters->>'activeMin','')='' or (not(row->>'masked')::boolean and (row->>'active_application_count')::integer >= (filters->>'activeMin')::integer))
   and (coalesce(filters->>'activeMax','')='' or (not(row->>'masked')::boolean and (row->>'active_application_count')::integer <= (filters->>'activeMax')::integer))
   and (coalesce(filters->>'updatedFrom','')='' or left(coalesce(row->>'updated_at',row->>'created_at'),10)>=filters->>'updatedFrom')
   and (coalesce(filters->>'updatedTo','')='' or left(coalesce(row->>'updated_at',row->>'created_at'),10)<=filters->>'updatedTo');
   page:=public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_filters=>filters,p_limit=>100);
   total:=(public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_filters=>filters,p_limit=>0,p_count_only=>true)->>'total_count')::integer;
   if total<>expected or jsonb_array_length(page->'items')<>expected then raise exception 'Filter/count mismatch for % / %: % vs %',actor.role,filters,total,expected;end if;
   for item in select value from jsonb_array_elements(page->'items') loop
    if jsonb_typeof(item->'has_priority_requisition')<>'boolean' then raise exception 'Missing priority';end if;
    if (item->>'masked')::boolean and (item->>'updated_at' is not null or item->>'phone_no' is not null or item->>'email' is not null) then raise exception 'Private data exposed';end if;
   end loop;
   n:=n+1;
  end loop;
  cursor:=null;seen:=array[]::text[];
  loop
   page:=public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_filters=>'{"updatedFrom":"2020-01-01"}'::jsonb,p_limit=>7,p_sort=>'updated_at',p_direction=>'asc',p_cursor_value=>cursor->'value',p_cursor_id=>cursor->>'id');
   for item in select value from jsonb_array_elements(page->'items') loop
    if item->>'candidate_id'=any(seen) then raise exception 'Duplicate cursor row';end if;seen:=array_append(seen,item->>'candidate_id');
   end loop;
   exit when not(page->>'has_more')::boolean;cursor:=page->'next_cursor';
  end loop;
  if cardinality(seen)<>(public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_filters=>'{"updatedFrom":"2020-01-01"}'::jsonb,p_limit=>0,p_count_only=>true)->>'total_count')::integer then raise exception 'Incomplete cursor traversal';end if;
  for bad in select value from jsonb_array_elements(jsonb_build_array('{"activeMin":"-1"}'::jsonb,'{"activeMin":"2","activeMax":"1"}'::jsonb,'{"activeMin":"2147483648"}'::jsonb,'{"activeMax":null}'::jsonb,'{"updatedFrom":"2026-02-30"}'::jsonb,'{"updatedFrom":"2026-12-01","updatedTo":"2026-01-01"}'::jsonb,'{"candidateIds":"bad"}'::jsonb,'{"candidateIds":[1]}'::jsonb,'{"contactText":true}'::jsonb,jsonb_build_object('candidateIds',(select jsonb_agg('ID-'||g)from generate_series(1,101)g)))) loop
   begin
    perform public.app_recruitment_list_v1(p_entity=>'candidate_registry',p_filters=>bad,p_limit=>7);
    raise exception 'Invalid filter accepted';
   exception when others then if sqlerrm<>'RECRUITMENT_LIST_FILTER_INVALID' then raise;end if;end;
   n:=n+1;
  end loop;
  insert into candidate_filter_results values(actor.role,n+1);
  execute 'reset role';
 end loop;
end;$checks$;
select role,sum(checks) checks from candidate_filter_results group by role;
rollback;
