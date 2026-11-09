-- No business rows are written. Exercise actual authenticated RPC filtering and roll back.
begin;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where role='system_admin' limit 1),true) is not null as authenticated;
set local role authenticated;
do $category_checks$
declare
 v_entity text; v_key text; v_selection jsonb; v_scalar bigint; v_array bigint;
 v_total bigint; v_page jsonb; v_item jsonb; v_impact text;
begin
 if app_private.recruitment_category_values_v1('["Recorded","ต้องบันทึก"]','sourcing_status')<>array['saved','needs_recording'] then raise exception 'Sourcing status aliases failed'; end if;
 if app_private.recruitment_category_values_v1('["มีผู้สมัคร","ศูนย์","ไม่ทราบ"]','sourcing_applicants')<>array['has','zero','unknown'] then raise exception 'Sourcing applicant aliases failed'; end if;
 for v_entity,v_key,v_selection in select * from (values
  ('requisitions','status','["ongoing","filled","cancel"]'::jsonb),
  ('requisitions','request_type','["New","Replacement"]'::jsonb),
  ('offers','status','["Did not start","Started","Pending","Missing start date","First day upcoming","Accepted"]'::jsonb),
  ('sourcing_records','status','["Recorded","Needs recording"]'::jsonb),
  ('sourcing_records','applicants','["Has applicants","Zero","Unknown"]'::jsonb)
 ) cases(entity,key,selection)
 loop
  v_total:=public.app_recruitment_list_count_v1(v_entity,'','{}'::jsonb);
  v_array:=public.app_recruitment_list_count_v1(v_entity,'',jsonb_build_object(v_key,v_selection::text));
  if v_array<>v_total then raise exception 'Category union mismatch: % / % (% versus %)',v_entity,v_key,v_array,v_total; end if;
  v_page:=public.app_recruitment_list_v1(p_entity=>v_entity,p_filters=>jsonb_build_object(v_key,v_selection::text),p_limit=>7);
  if jsonb_array_length(v_page->'items')<>least(v_total,7) then raise exception 'Filtered page/count mismatch: % / %',v_entity,v_key; end if;
 end loop;
 v_scalar:=public.app_recruitment_list_count_v1('requisitions','',jsonb_build_object('status','ongoing'));
 v_array:=public.app_recruitment_list_count_v1('requisitions','',jsonb_build_object('status','["ongoing"]'::text));
 if v_array<>v_scalar then raise exception 'Ongoing checkbox mismatch'; end if;
 v_array:=public.app_recruitment_list_count_v1('requisitions','',jsonb_build_object('status','["กำลังดำเนินการ"]'::text));
 if v_array<>v_scalar then raise exception 'Thai ongoing checkbox mismatch'; end if;
 v_page:=public.app_recruitment_list_v1(p_entity=>'offers',p_limit=>100);
 for v_item in select * from jsonb_array_elements(v_page->'items') loop
  v_impact:=coalesce(v_item->>'accepted_count','0')||'/'||(v_item->>'head_count')||' accepted - selected impact';
  if v_item->>'head_count' is not null then
   v_array:=public.app_recruitment_list_count_v1('offers','',jsonb_build_object('impact',jsonb_build_array(v_impact)::text));
   if v_array=0 then raise exception 'Offer displayed impact checkbox mismatch'; end if;
  end if;
 end loop;
 begin
  perform app_private.recruitment_category_values_v1('[1]','');
  raise exception 'Non-string category was accepted';
 exception when others then if sqlerrm<>'RECRUITMENT_LIST_FILTER_INVALID' then raise; end if; end;
end;
$category_checks$;
rollback;
