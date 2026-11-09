-- Decode existing checkbox JSON without changing scalar-filter compatibility.
create or replace function app_private.recruitment_category_values_v1(p_filter text,p_kind text default '')
returns text[] language plpgsql immutable security invoker set search_path='' as $category_values$
declare v_json jsonb; v_values text[]; v_value text; v_result text[]:='{}'::text[];
begin
 if left(btrim(coalesce(p_filter,'')),1)='[' then
  begin v_json:=p_filter::jsonb;
  exception when invalid_text_representation then raise exception 'RECRUITMENT_LIST_FILTER_INVALID';
  end;
  if jsonb_typeof(v_json)<>'array' or exists(select 1 from jsonb_array_elements(v_json) x where jsonb_typeof(x)<>'string') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  select coalesce(array_agg(x #>> '{}'),'{}'::text[]) into v_values from jsonb_array_elements(v_json) x;
 else v_values:=array[coalesce(p_filter,'')]; end if;
 foreach v_value in array v_values loop
  if p_kind='sourcing_status' then
   v_value:=case lower(btrim(v_value)) when 'recorded' then 'saved' when 'บันทึกแล้ว' then 'saved' when 'needs recording' then 'needs_recording' when 'ต้องบันทึก' then 'needs_recording' else v_value end;
  elsif p_kind='sourcing_applicants' then
   v_value:=case lower(btrim(v_value)) when 'has applicants' then 'has' when 'มีผู้สมัคร' then 'has' when 'ศูนย์' then 'zero' when 'ไม่ทราบ' then 'unknown' else lower(v_value) end;
  elsif p_kind='offer_status' then
   v_value:=case v_value when 'เริ่มงานแล้ว' then 'Started' when 'รอดำเนินการ' then 'Pending' when 'ขาดวันเริ่มงาน' then 'Missing start date' when 'ใกล้วันเริ่มงาน' then 'First day upcoming' when 'รับข้อเสนอแล้ว' then 'Accepted' else v_value end;
  elsif p_kind='offer_impact' then
   v_value:=coalesce(substring(v_value from '^[0-9]+/[0-9]+'),v_value);
  end if;
  v_result:=array_append(v_result,v_value);
 end loop;
 return case when cardinality(v_result)=0 then array['']::text[] else v_result end;
end;
$category_values$;
revoke all on function app_private.recruitment_category_values_v1(text,text) from public,anon;
grant execute on function app_private.recruitment_category_values_v1(text,text) to authenticated,service_role;

CREATE OR REPLACE FUNCTION public.app_recruitment_offers_page_v1(p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer, p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_sort text:=coalesce(nullif(p_sort,''),'accepted'); v_dir text:=lower(coalesce(p_direction,'desc')); v_cursor text:=p_cursor_value #>> '{}'; v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end); v_home_tab text:=coalesce(p_filters->>'homeTab',''); v_today date:=coalesce(nullif(p_filters->>'today','')::date,timezone('Asia/Bangkok',now())::date);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (7,10,25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('candidate','doc_id','position','status','impact','accepted','first_working','age','home_first_working') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_dir not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if v_home_tab not in ('','start_confirmation') or jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('candidate','doc_id','position','status','impact','accepted','first_working','age','headerSite','headerPic','priorityOnly','homeTab','today')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or p_cursor_id !~ '^[0-9]+$') then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if (p_cursor_value is null)<>(p_cursor_id is null) or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with source_rows as not materialized (
    select o.offer_id,o.application_id,o.candidate_id,o.doc_id,o.accepted_date,o.first_working_date,o.start_confirmation,o.start_confirmed_at,o.start_confirmed_by,o.start_confirmation_reason,o.remark,o.created_at,o.updated_at,
      c.name,c.nickname,r.position,r.level,r.site,r.person_in_charge,r.request_type,r.head_count,
      coalesce((select count(*) from public.offers x where x.doc_id=o.doc_id and x.accepted_date is not null and x.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(x.application_id)),0)::integer accepted_count,
      case when o.start_confirmation='did_not_start' then 'Did not start' when o.start_confirmation='started' then 'Started' when o.accepted_date is null then 'Pending' when o.first_working_date is null then 'Missing start date' when o.first_working_date>=current_date and o.first_working_date<=current_date+14 then 'First day upcoming' else 'Accepted' end status,
      case when o.accepted_date is null then current_date-o.created_at::date when o.first_working_date is null then current_date-o.accepted_date else abs(current_date-o.first_working_date) end::integer age_days,
      case v_sort when 'home_first_working' then coalesce(o.first_working_date::text,'') when 'candidate' then case when c.candidate_id ~* '^CAN-[0-9]+$' then lower(split_part(c.candidate_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0')||'-'||lower(c.candidate_id) else lower(c.candidate_id) end||'|'||lower(concat_ws(' ',c.name,c.nickname)) when 'doc_id' then lower(o.doc_id) when 'position' then lower(concat_ws(' ',r.position,r.level)) when 'status' then lower(case when o.accepted_date is null then 'pending' when o.start_confirmation='did_not_start' then 'did not start' when o.start_confirmation='started' then 'started' when o.first_working_date is null then 'missing start date' else 'accepted' end) when 'impact' then lpad(coalesce((select count(*) from public.offers x where x.doc_id=o.doc_id and x.accepted_date is not null and x.start_confirmation is distinct from 'did_not_start'),0)::text,8,'0')||'/'||lpad(r.head_count::text,8,'0') when 'first_working' then coalesce(o.first_working_date::text,'') when 'age' then lpad((2147483647-coalesce(case when o.accepted_date is null then current_date-o.created_at::date else current_date-o.accepted_date end,0))::text,10,'0') else coalesce(o.accepted_date::text,'') end sort_value
    from public.offers o join public.candidates c on c.candidate_id=o.candidate_id join public.requisitions r on r.doc_id=o.doc_id
    where app_private.can_read_application(o.application_id) and app_private.can_read_candidate(o.candidate_id) and app_private.can_read_requisition(o.doc_id)
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite') and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
      and (v_home_tab='' or (v_home_tab='start_confirmation' and o.accepted_date is not null and o.first_working_date is not null and o.first_working_date<=v_today and o.start_confirmation is null))
      and (coalesce(p_filters->>'candidate','')='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),greatest(5,length(split_part(c.candidate_id,'-',2))),'0') else c.candidate_id end,
        c.name,c.nickname) ilike '%'||(case when btrim(p_filters->>'candidate') ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(btrim(p_filters->>'candidate'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'candidate'),'-',2))),'0') else p_filters->>'candidate' end)||'%')
      and (coalesce(p_filters->>'doc_id','')='' or o.doc_id ilike '%'||(p_filters->>'doc_id')||'%')
      and (coalesce(p_filters->>'position','')='' or concat_ws(' ',r.position,r.level) ilike '%'||(p_filters->>'position')||'%')
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'status','offer_status')) as category_value(value) where (coalesce(category_value.value,'')='' or (case when left(btrim(coalesce(p_filters->>'status','')),1)='[' then (case when o.start_confirmation='did_not_start' then 'Did not start' when o.start_confirmation='started' then 'Started' when o.accepted_date is null then 'Pending' when o.first_working_date is null then 'Missing start date' when o.first_working_date>v_today and o.first_working_date<=v_today+14 then 'First day upcoming' when o.first_working_date<=v_today then 'Started' else 'Accepted' end) else (case when o.accepted_date is null then 'Pending' when o.start_confirmation='did_not_start' then 'Did not start' when o.start_confirmation='started' then 'Started' when o.first_working_date is null then 'Missing start date' else 'Accepted' end) end) ilike '%'||(category_value.value)||'%')))
      and (v_search='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),greatest(5,length(split_part(c.candidate_id,'-',2))),'0') else c.candidate_id end,
        c.name,c.nickname,o.doc_id,r.position,r.level,r.site,r.person_in_charge) ilike '%'||v_search||'%')
  ), filtered as (select * from source_rows s where (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'impact','offer_impact')) as category_value(value) where (coalesce(category_value.value,'')='' or (s.accepted_count::text||'/'||s.head_count::text) ilike '%'||(category_value.value)||'%'))) and (coalesce(p_filters->>'accepted','')='' or coalesce(s.accepted_date::text,'') ilike '%'||(p_filters->>'accepted')||'%') and (coalesce(p_filters->>'first_working','')='' or coalesce(s.first_working_date::text,'') ilike '%'||(p_filters->>'first_working')||'%') and (coalesce(p_filters->>'age','')='' or s.age_days::text ilike '%'||(p_filters->>'age')||'%')),
  cursor_rows as (select * from filtered f where p_cursor_value is null or
    (not p_before and ((v_dir='asc' and f.sort_value>v_cursor) or (v_dir='desc' and f.sort_value<v_cursor) or (f.sort_value=v_cursor and f.offer_id>p_cursor_id::bigint)))
    or (p_before and ((v_dir='asc' and f.sort_value<v_cursor) or (v_dir='desc' and f.sort_value>v_cursor) or (f.sort_value=v_cursor and f.offer_id<p_cursor_id::bigint)))),
  page_raw as (select * from cursor_rows order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then offer_id end desc,case when not p_before then offer_id end asc limit greatest(p_limit,0)+1), page_rows as (select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then offer_id end desc,case when not p_before then offer_id end asc limit greatest(p_limit,0)), info as(select count(*)>p_limit extra from page_raw), edges as(select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,offer_id))[1] first_value,(array_agg(offer_id::text order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,offer_id))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,offer_id desc))[1] last_value,(array_agg(offer_id::text order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,offer_id desc))[1] last_id from page_rows)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('offer_id',offer_id,'application_id',application_id,'candidate_id',candidate_id,'candidate_name',concat_ws(' ',name,nickname),'doc_id',doc_id,'accepted_date',accepted_date,'first_working_date',first_working_date,'start_confirmation',start_confirmation,'start_confirmed_at',start_confirmed_at,'start_confirmed_by',start_confirmed_by,'start_confirmation_reason',start_confirmation_reason,'remark',remark,'created_at',created_at,'updated_at',updated_at,'position',position,'level',level,'site',site,'person_in_charge',person_in_charge,'request_type',request_type,'head_count',head_count,'accepted_count',accepted_count,'status',status,'age_days',age_days) order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,offer_id) from page_rows),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from filtered) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_value,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_value,'id',edges.first_id) else null end) into v_result from edges cross join info;
  return v_result;
end; $function$;

CREATE OR REPLACE FUNCTION public.app_recruitment_requisitions_page_v1(p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer, p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_search text := lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
  v_sort text := coalesce(nullif(p_sort,''),'updated_at');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_cursor text := p_cursor_value #>> '{}';
  v_home_tab text := coalesce(p_filters->>'homeTab','');
  v_managed_only boolean := coalesce((p_filters->>'managedOnly')::boolean,false);
  v_unmatched_only boolean := coalesce((p_filters->>'unmatchedOnly')::boolean,false);
  v_link_to_group_id text := nullif(p_filters->>'linkToGroupId','');
  v_profile_admin boolean := app_private.current_app_role() in ('system_admin','admin_recruiter');
  v_fast_base_criteria boolean;
  v_exact_count integer;
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (7,10,25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('doc_id','position','status','open_headcount','readiness','sla','age','owner','department','request_type','section','head_count','accepted_count','candidate_count','req_date','updated_at','home_oldest','home_demand','home_position') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_direction not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if v_home_tab not in ('','open_headcount') or jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('doc_id','position','status','open_headcount','readiness','sla','age','owner','department','request_type','section','head_count','accepted_count','candidate_count','req_date','updated_at','site','level','headerSite','headerPic','priorityOnly','homeTab','managedOnly','unmatchedOnly','linkToGroupId')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if (p_filters ? 'managedOnly' and jsonb_typeof(p_filters->'managedOnly')<>'boolean')
    or (p_filters ? 'unmatchedOnly' and jsonb_typeof(p_filters->'unmatchedOnly')<>'boolean')
    or (p_filters ? 'linkToGroupId' and jsonb_typeof(p_filters->'linkToGroupId') not in ('string','null')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if (p_cursor_value is null) <> (p_cursor_id is null) or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  v_fast_base_criteria := v_search='' and v_home_tab=''
    and not (coalesce(p_filters,'{}'::jsonb) ?| array['open_headcount','readiness','sla','age','accepted_count','candidate_count']);

  -- Count-only requests with base-column criteria do not need per-requisition candidate/offer enrichment.
  -- Keep aggregate-dependent filters and all free-text search on the original complete path below.
  if p_count_only and v_fast_base_criteria then
    select count(*)::integer into v_exact_count
    from public.requisitions r
    where app_private.can_read_requisition(r.doc_id)
      and (not v_managed_only or app_private.can_manage_requisition(r.doc_id))
      and (not v_unmatched_only or not exists(select 1 from public.document_groups unmatched where unmatched.doc_id=r.doc_id))
      and (v_link_to_group_id is null or (
        exists(select 1 from public.position_groups target_group where target_group.group_id=v_link_to_group_id and app_private.can_read_position_group(target_group.group_id))
        and (v_profile_admin or exists(select 1 from public.document_groups target_link join public.requisitions target_req on target_req.doc_id=target_link.doc_id where target_link.group_id=v_link_to_group_id and target_req.site=r.site))
      ))
      and (coalesce(p_filters->>'site','')='' or r.site ilike ('%'||(p_filters->>'site')||'%'))
      and (coalesce(p_filters->>'level','')='' or r.level ilike ('%'||(p_filters->>'level')||'%'))
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
      and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
      and (coalesce(p_filters->>'doc_id','')='' or r.doc_id ilike ('%'||(p_filters->>'doc_id')||'%'))
      and (coalesce(p_filters->>'position','')='' or (case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end) ilike ('%'||(p_filters->>'position')||'%'))
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'status','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'ongoing' then r.status='ongoing' when 'กำลังดำเนินการ' then r.status='ongoing' when 'filled' then r.status='filled' when 'ครบแล้ว' then r.status='filled' when 'cancel' then r.status='cancel' when 'cancelled' then r.status='cancel' when 'ยกเลิก' then r.status='cancel' else concat_ws(' ',r.status,r.site,r.department) ilike ('%'||(category_value.value)||'%') end)))
      and (coalesce(p_filters->>'owner','')='' or coalesce(r.person_in_charge,'') ilike ('%'||(p_filters->>'owner')||'%'))
      and (coalesce(p_filters->>'department','')='' or r.department ilike ('%'||(p_filters->>'department')||'%'))
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'request_type','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike ('%'||(category_value.value)||'%') end)))
      and (coalesce(p_filters->>'section','')='' or coalesce(r.section,'') ilike ('%'||(p_filters->>'section')||'%'))
      and (coalesce(p_filters->>'head_count','')='' or r.head_count::text ilike ('%'||(p_filters->>'head_count')||'%'))
      and (coalesce(p_filters->>'req_date','')='' or concat_ws(' ',r.pr_approved_date::text,to_char(r.pr_approved_date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'req_date')||'%'))
      and (coalesce(p_filters->>'updated_at','')='' or concat_ws(' ',r.updated_at::date::text,to_char(r.updated_at::date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'updated_at')||'%'));
    v_result := jsonb_build_object('items','[]'::jsonb,'total_count',v_exact_count,'has_more',false,'has_more_before',false,'next_cursor',null,'previous_cursor',null);
    return v_result;
  end if;

  -- For the default date sort with base-only filters, page requisition keys first and enrich only those rows.
  -- Filters/search/sorts that depend on candidate or offer aggregates deliberately use the original path.
  if not p_count_only and p_limit>0 and v_fast_base_criteria and v_sort='updated_at' then
    with base_rows as not materialized (
      select r.doc_id,r.updated_at,
        to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_value
      from public.requisitions r
      where app_private.can_read_requisition(r.doc_id)
        and (not v_managed_only or app_private.can_manage_requisition(r.doc_id))
        and (not v_unmatched_only or not exists(select 1 from public.document_groups unmatched where unmatched.doc_id=r.doc_id))
        and (v_link_to_group_id is null or (
          exists(select 1 from public.position_groups target_group where target_group.group_id=v_link_to_group_id and app_private.can_read_position_group(target_group.group_id))
          and (v_profile_admin or exists(select 1 from public.document_groups target_link join public.requisitions target_req on target_req.doc_id=target_link.doc_id where target_link.group_id=v_link_to_group_id and target_req.site=r.site))
        ))
        and (coalesce(p_filters->>'site','')='' or r.site ilike ('%'||(p_filters->>'site')||'%'))
        and (coalesce(p_filters->>'level','')='' or r.level ilike ('%'||(p_filters->>'level')||'%'))
        and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
        and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
        and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
        and (coalesce(p_filters->>'doc_id','')='' or r.doc_id ilike ('%'||(p_filters->>'doc_id')||'%'))
        and (coalesce(p_filters->>'position','')='' or (case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end) ilike ('%'||(p_filters->>'position')||'%'))
        and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'status','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'ongoing' then r.status='ongoing' when 'กำลังดำเนินการ' then r.status='ongoing' when 'filled' then r.status='filled' when 'ครบแล้ว' then r.status='filled' when 'cancel' then r.status='cancel' when 'cancelled' then r.status='cancel' when 'ยกเลิก' then r.status='cancel' else concat_ws(' ',r.status,r.site,r.department) ilike ('%'||(category_value.value)||'%') end)))
        and (coalesce(p_filters->>'owner','')='' or coalesce(r.person_in_charge,'') ilike ('%'||(p_filters->>'owner')||'%'))
        and (coalesce(p_filters->>'department','')='' or r.department ilike ('%'||(p_filters->>'department')||'%'))
        and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'request_type','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike ('%'||(category_value.value)||'%') end)))
        and (coalesce(p_filters->>'section','')='' or coalesce(r.section,'') ilike ('%'||(p_filters->>'section')||'%'))
        and (coalesce(p_filters->>'head_count','')='' or r.head_count::text ilike ('%'||(p_filters->>'head_count')||'%'))
        and (coalesce(p_filters->>'req_date','')='' or concat_ws(' ',r.pr_approved_date::text,to_char(r.pr_approved_date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'req_date')||'%'))
        and (coalesce(p_filters->>'updated_at','')='' or concat_ws(' ',r.updated_at::date::text,to_char(r.updated_at::date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'updated_at')||'%'))
    ), filtered as (
      select b.* from base_rows b where p_cursor_value is null or
        (not p_before and ((v_direction='desc' and (b.sort_value<v_cursor or (b.sort_value=v_cursor and b.doc_id>p_cursor_id))) or (v_direction='asc' and (b.sort_value>v_cursor or (b.sort_value=v_cursor and b.doc_id>p_cursor_id)))) or
        (p_before and ((v_direction='desc' and (b.sort_value>v_cursor or (b.sort_value=v_cursor and b.doc_id<p_cursor_id))) or (v_direction='asc' and (b.sort_value<v_cursor or (b.sort_value=v_cursor and b.doc_id<p_cursor_id))))))
    ), page_raw as materialized (
      select * from filtered order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,
        case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,
        case when p_before then doc_id end desc,case when not p_before then doc_id end asc limit p_limit+1
    ), page_keys as materialized (
      select * from page_raw order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,
        case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,
        case when p_before then doc_id end desc,case when not p_before then doc_id end asc limit p_limit
    ), edges as (
      select (array_agg(sort_value order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,doc_id asc))[1] first_sort,
        (array_agg(doc_id order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,doc_id asc))[1] first_id,
        (array_agg(sort_value order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,doc_id desc))[1] last_sort,
        (array_agg(doc_id order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,doc_id desc))[1] last_id from page_keys
    ), page_info as (select count(*)>p_limit has_extra from page_raw), enriched as (
      select k.sort_value,r.doc_id,r.is_priority,r.pr_approved_date,r.site,r.position,r.department,r.section,r.level,r.head_count,
        r.person_in_charge,r.line_manager,r.request_type,r.replacement_names,r.status,r.created_at,r.updated_at,
        coalesce(links.sourcing_group_ids,'{}'::text[]) sourcing_group_ids,
        coalesce(cands.candidate_count,0)::integer candidate_count,
        coalesce(ofrs.accepted_count,0)::integer accepted_count,
        greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::integer open_headcount,
        ofrs.sla_restart_date
      from page_keys k join public.requisitions r on r.doc_id=k.doc_id
      left join lateral (select array_agg(distinct d.group_id order by d.group_id) filter(where d.group_id is not null) sourcing_group_ids from public.document_groups d where d.doc_id=r.doc_id) links on true
      left join lateral (
        select count(distinct c.candidate_id)::integer candidate_count
        from public.candidate_applications a join public.candidates c on c.candidate_id=a.candidate_id
        where a.group_id=any(coalesce(links.sourcing_group_ids,'{}'::text[]))
          and app_private.can_read_application(a.application_id) and app_private.can_read_candidate(c.candidate_id)
      ) cands on true
      left join lateral (
        select count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')::integer accepted_count,
          max(o.start_confirmed_at::date) filter(where o.start_confirmation='did_not_start' and o.start_confirmed_at is not null) sla_restart_date
        from public.offers o where o.doc_id=r.doc_id and app_private.can_read_application(o.application_id)
      ) ofrs on true
    ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
        'doc_id',e.doc_id,'is_priority',e.is_priority,'pr_approved_date',e.pr_approved_date,'site',e.site,'position',e.position,'department',e.department,'section',e.section,'level',e.level,'head_count',e.head_count,
        'person_in_charge',e.person_in_charge,'line_manager',e.line_manager,'request_type',e.request_type,'replacement_names',e.replacement_names,'status',e.status,'created_at',e.created_at,'updated_at',e.updated_at,
        'sourcing_group_ids',e.sourcing_group_ids,'candidate_count',e.candidate_count,'accepted_count',e.accepted_count,'open_headcount',e.open_headcount,'sla_restart_date',e.sla_restart_date)
      order by case when v_direction='desc' then e.sort_value end desc,case when v_direction='asc' then e.sort_value end asc,e.doc_id asc) from enriched e),'[]'::jsonb),
      'total_count',null,'has_more',case when p_before then exists(select 1 from page_keys) else page_info.has_extra end,
      'has_more_before',case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_keys) end,
      'next_cursor',case when (case when p_before then exists(select 1 from page_keys) else page_info.has_extra end) then jsonb_build_object('value',to_jsonb(edges.last_sort),'id',edges.last_id) else null end,
      'previous_cursor',case when (case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_keys) end) then jsonb_build_object('value',to_jsonb(edges.first_sort),'id',edges.first_id) else null end)
    into v_result from edges cross join page_info;
    return v_result;
  end if;

  with rows as not materialized (
    select r.doc_id,r.is_priority,r.pr_approved_date,r.site,r.position,r.department,r.section,r.level,r.head_count,
      r.person_in_charge,r.line_manager,r.request_type,r.replacement_names,r.status,r.created_at,r.updated_at,
      coalesce(links.sourcing_group_ids,'{}'::text[]) sourcing_group_ids,
      coalesce(cands.candidate_count,0)::integer candidate_count,
      coalesce(ofrs.accepted_count,0)::integer accepted_count,
      greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::integer open_headcount,
      ofrs.sla_restart_date,
      case when links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 then 'linked' else 'missing' end readiness,
      case when age.age_days is null or sla.sla_days is null then null else age.age_days>sla.sla_days end is_overdue,
      age.age_days,
      case v_sort
        when 'home_oldest' then lpad(coalesce(age.age_days,0)::text,12,'0')||':'||lpad(greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::text,12,'0')
        when 'home_demand' then lpad(greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::text,12,'0')||':'||lpad(coalesce(age.age_days,0)::text,12,'0')
        when 'home_position' then lower(case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end)
        when 'doc_id' then lower(r.doc_id)
        when 'position' then lower(case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end)
        when 'status' then lower(case r.status when 'ongoing' then 'ongoing กำลังดำเนินการ' when 'filled' then 'filled ครบแล้ว' else 'cancel cancelled ยกเลิก' end)
        when 'open_headcount' then lpad(greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::text,12,'0')
        when 'readiness' then case when links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 then '1-linked-เชื่อมแล้ว' else '0-missing-not linked-ยังไม่เชื่อม' end
        when 'sla' then lower(case when age.age_days is null or sla.sla_days is null then '-' else age.age_days||'d / '||sla.sla_days||'d' end)
        when 'age' then lpad(coalesce(age.age_days,999999)::text,12,'0')
        when 'owner' then lower(coalesce(r.person_in_charge,''))
        when 'department' then lower(r.department)
        when 'request_type' then lower(case r.request_type when 'New' then 'new อัตราใหม่' else 'replacement ทดแทน' end)
        when 'section' then lower(coalesce(r.section,''))
        when 'head_count' then lpad(r.head_count::text,12,'0')
        when 'accepted_count' then lpad(coalesce(ofrs.accepted_count,0)::text,12,'0')
        when 'candidate_count' then lpad(coalesce(cands.candidate_count,0)::text,12,'0')
        when 'req_date' then coalesce(r.pr_approved_date::text,'')
        else to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as sort_value
    from public.requisitions r
    left join lateral (
      select array_agg(distinct d.group_id order by d.group_id) filter(where d.group_id is not null) sourcing_group_ids
      from public.document_groups d where d.doc_id=r.doc_id
    ) links on true
    left join lateral (
      select count(distinct c.candidate_id)::integer candidate_count
      from public.candidate_applications a join public.candidates c on c.candidate_id=a.candidate_id
      where a.group_id=any(coalesce(links.sourcing_group_ids,'{}'::text[]))
        and app_private.can_read_application(a.application_id) and app_private.can_read_candidate(c.candidate_id)
    ) cands on true
    left join lateral (
      select count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')::integer accepted_count,
        max(o.start_confirmed_at::date) filter(where o.start_confirmation='did_not_start' and o.start_confirmed_at is not null) sla_restart_date
      from public.offers o where o.doc_id=r.doc_id and app_private.can_read_application(o.application_id)
    ) ofrs on true
    left join lateral (select greatest((timezone('Asia/Bangkok',now())::date-coalesce(ofrs.sla_restart_date,r.pr_approved_date)),0)::integer age_days) age on true
    left join lateral (select case when r.level is null or r.level !~ '^(L)?(0|[1-9]|1[0-4])$' then null
      when replace(r.level,'L','')::integer<=6 then 30 when replace(r.level,'L','')::integer<=9 then 45 else 60 end::integer sla_days) sla on true
    where app_private.can_read_requisition(r.doc_id)
      and (not v_managed_only or app_private.can_manage_requisition(r.doc_id))
      and (not v_unmatched_only or not exists(select 1 from public.document_groups unmatched where unmatched.doc_id=r.doc_id))
      and (v_link_to_group_id is null or (
        exists(select 1 from public.position_groups target_group where target_group.group_id=v_link_to_group_id and app_private.can_read_position_group(target_group.group_id))
        and (v_profile_admin or exists(
          select 1 from public.document_groups target_link join public.requisitions target_req on target_req.doc_id=target_link.doc_id
          where target_link.group_id=v_link_to_group_id and target_req.site=r.site
        ))
      ))
      and (coalesce(p_filters->>'site','')='' or r.site ilike ('%'||(p_filters->>'site')||'%'))
      and (coalesce(p_filters->>'level','')='' or r.level ilike ('%'||(p_filters->>'level')||'%'))
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
      and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
      and (v_home_tab='' or (v_home_tab='open_headcount' and r.status not in ('filled','cancel') and greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)>0))
      and (coalesce(p_filters->>'doc_id','')='' or r.doc_id ilike ('%'||(p_filters->>'doc_id')||'%'))
      and (coalesce(p_filters->>'position','')='' or (case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end) ilike ('%'||(p_filters->>'position')||'%'))
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'status','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'ongoing' then r.status='ongoing' when 'กำลังดำเนินการ' then r.status='ongoing' when 'filled' then r.status='filled' when 'ครบแล้ว' then r.status='filled' when 'cancel' then r.status='cancel' when 'cancelled' then r.status='cancel' when 'ยกเลิก' then r.status='cancel' else concat_ws(' ',r.status,r.site,r.department) ilike ('%'||(category_value.value)||'%') end)))
      and (coalesce(p_filters->>'open_headcount','')='' or greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::text ilike ('%'||(p_filters->>'open_headcount')||'%'))
      and (coalesce(p_filters->>'readiness','')='' or case lower(btrim(p_filters->>'readiness')) when 'linked' then links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 when 'เชื่อมแล้ว' then links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 when 'missing' then links.sourcing_group_ids is null or cardinality(links.sourcing_group_ids)=0 when 'not linked' then links.sourcing_group_ids is null or cardinality(links.sourcing_group_ids)=0 when 'ยังไม่เชื่อม' then links.sourcing_group_ids is null or cardinality(links.sourcing_group_ids)=0 else coalesce(array_to_string(links.sourcing_group_ids,' '),'') ilike ('%'||(p_filters->>'readiness')||'%') end)
      and (coalesce(p_filters->>'sla','')='' or (case when age.age_days is null or sla.sla_days is null then '-' else age.age_days||'d / '||sla.sla_days||'d' end) ilike ('%'||(p_filters->>'sla')||'%'))
      and (coalesce(p_filters->>'age','')='' or concat_ws(' ',coalesce(age.age_days::text||'d','-'),age.age_days) ilike ('%'||(p_filters->>'age')||'%'))
      and (coalesce(p_filters->>'owner','')='' or coalesce(r.person_in_charge,'') ilike ('%'||(p_filters->>'owner')||'%'))
      and (coalesce(p_filters->>'department','')='' or r.department ilike ('%'||(p_filters->>'department')||'%'))
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'request_type','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike ('%'||(category_value.value)||'%') end)))
      and (coalesce(p_filters->>'section','')='' or coalesce(r.section,'') ilike ('%'||(p_filters->>'section')||'%'))
      and (coalesce(p_filters->>'head_count','')='' or r.head_count::text ilike ('%'||(p_filters->>'head_count')||'%'))
      and (coalesce(p_filters->>'accepted_count','')='' or coalesce(ofrs.accepted_count,0)::text ilike ('%'||(p_filters->>'accepted_count')||'%'))
      and (coalesce(p_filters->>'candidate_count','')='' or coalesce(cands.candidate_count,0)::text ilike ('%'||(p_filters->>'candidate_count')||'%'))
      and (coalesce(p_filters->>'req_date','')='' or concat_ws(' ',r.pr_approved_date::text,to_char(r.pr_approved_date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'req_date')||'%'))
      and (coalesce(p_filters->>'updated_at','')='' or concat_ws(' ',r.updated_at::date::text,to_char(r.updated_at::date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'updated_at')||'%'))
      and (v_search='' or concat_ws(' ',r.doc_id,case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end,r.level,r.status,r.site,r.department,r.section,r.person_in_charge,r.line_manager,r.request_type,r.replacement_names,r.head_count,
        greatest(r.head_count-coalesce(ofrs.accepted_count,0),0),coalesce(array_to_string(links.sourcing_group_ids,' '),''),
        array_to_string(array(select case when x ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(x,'-',2),greatest(5,length(split_part(x,'-',2))),'0') else x end from unnest(coalesce(links.sourcing_group_ids,'{}'::text[])) x),' '),
        cands.candidate_count,ofrs.accepted_count) ilike '%'||v_search||'%')
  ), filtered as (
    select * from rows r where p_cursor_value is null or
      (not p_before and ((v_direction='desc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.doc_id>p_cursor_id))) or (v_direction='asc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.doc_id>p_cursor_id)))) or
      (p_before and ((v_direction='desc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.doc_id<p_cursor_id))) or (v_direction='asc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.doc_id<p_cursor_id))))))
  ), counted as (select count(*)::integer total_count from rows where p_limit=0), page_raw as (
    select * from filtered order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,
      case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,
      case when p_before then doc_id end desc,case when not p_before then doc_id end asc limit p_limit+1
  ), page_rows as (select * from page_raw order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,case when p_before then doc_id end desc,case when not p_before then doc_id end asc limit p_limit), edges as (
    select (array_agg(sort_value order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,doc_id asc))[1] first_sort,
      (array_agg(doc_id order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,doc_id asc))[1] first_id,
      (array_agg(sort_value order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,doc_id desc))[1] last_sort,
      (array_agg(doc_id order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,doc_id desc))[1] last_id from page_rows
  ), page_info as (select count(*)>p_limit as has_extra from page_raw) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('doc_id',p.doc_id,'is_priority',p.is_priority,'pr_approved_date',p.pr_approved_date,'site',p.site,'position',p.position,'department',p.department,'section',p.section,'level',p.level,'head_count',p.head_count,'person_in_charge',p.person_in_charge,'line_manager',p.line_manager,'request_type',p.request_type,'replacement_names',p.replacement_names,'status',p.status,'created_at',p.created_at,'updated_at',p.updated_at,'sourcing_group_ids',p.sourcing_group_ids,'candidate_count',p.candidate_count,'accepted_count',p.accepted_count,'open_headcount',p.open_headcount,'sla_restart_date',p.sla_restart_date) order by case when v_direction='desc' then p.sort_value end desc,case when v_direction='asc' then p.sort_value end asc,p.doc_id asc) from page_rows p),'[]'::jsonb),
      'total_count',case when p_limit=0 then (select total_count from counted) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else page_info.has_extra end,'has_more_before',case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end,
      'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else page_info.has_extra end) then jsonb_build_object('value',to_jsonb(edges.last_sort),'id',edges.last_id) else null end,
      'previous_cursor',case when (case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',to_jsonb(edges.first_sort),'id',edges.first_id) else null end)
    into v_result from edges cross join page_info;
  return v_result;
end; $function$;

CREATE OR REPLACE FUNCTION public.app_recruitment_sourcing_records_page_v1(p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer, p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare v_sort text:=coalesce(nullif(p_sort,''),'week'); v_dir text:=lower(coalesce(p_direction,'desc')); v_surface text:=coalesce(p_filters->>'surface','history'); v_week_start date:=nullif(p_filters->>'weekStart','')::date; v_cursor text:=p_cursor_value #>> '{}'; v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (7,10,25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_surface not in ('board','history') or v_sort not in ('group','position','week','status','applicants','saved') or v_dir not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('surface','weekStart','from','to','group','position','week','status','applicants','saved','groupId','headerSite','headerPic','priorityOnly')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if (p_cursor_value is null)<>(p_cursor_id is null) or (p_cursor_value is not null and jsonb_typeof(p_cursor_value)<>'string') or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with authorized_links as materialized (
    select d.group_id,r.* from public.document_groups d join public.requisitions r using(doc_id)
    join public.position_groups g on g.group_id=d.group_id
    where app_private.can_read_requisition(r.doc_id) and app_private.can_read_sourcing_group(d.group_id)
      and app_private.can_read_position_group(d.group_id)
      and (coalesce(p_filters->>'groupId','')='' or d.group_id=p_filters->>'groupId')
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
      and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
  ), accepted as materialized (
    select o.doc_id,count(*)::integer accepted from public.offers o
    where o.doc_id in (select doc_id from authorized_links) and o.accepted_date is not null
      and o.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(o.application_id) group by o.doc_id
  ), terminal_dates as materialized (
    select l.doc_id,max(l.log_date) terminal_day from public.requisition_logs l
    where l.doc_id in (select doc_id from authorized_links where status in ('filled','cancel')) and l.status in ('filled','cancel') group by l.doc_id
  ), group_bounds as materialized (
    select r.group_id,min(r.pr_approved_date) first_approved,bool_and(r.status in ('filled','cancel')) all_terminal,
      max(case when r.status in ('filled','cancel') then coalesce(t.terminal_day,r.updated_at::date) end) terminal_day,
      array_agg(distinct r.site order by r.site) filter(where r.site is not null) sites,
      array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners,
      array_agg(distinct r.doc_id order by r.doc_id) doc_ids,
      coalesce(sum(greatest(r.head_count-coalesce(a.accepted,0),0)) filter(where r.status='ongoing'),0)::integer open_headcount
    from authorized_links r left join accepted a using(doc_id) left join terminal_dates t using(doc_id) group by r.group_id
  ), bounds as materialized (
    select b.*,coalesce(first_approved,timezone('Asia/Bangkok',now())::date)-((extract(dow from coalesce(first_approved,timezone('Asia/Bangkok',now())::date))::integer+1)%7) start_week,
      case when all_terminal then coalesce(terminal_day,timezone('Asia/Bangkok',now())::date)-((extract(dow from coalesce(terminal_day,timezone('Asia/Bangkok',now())::date))::integer+1)%7)
        else timezone('Asia/Bangkok',now())::date-((extract(dow from timezone('Asia/Bangkok',now()))::integer+1)%7) end end_week from group_bounds b
  ), weeks as (
    select b.group_id,v_week_start week_start from bounds b where v_surface='board' and extract(dow from v_week_start)=6 and v_week_start between b.start_week and b.end_week and b.open_headcount>0
      and (coalesce(p_filters->>'from','')='' or v_week_start>=(p_filters->>'from')::date)
      and (coalesce(p_filters->>'to','')='' or v_week_start<=(p_filters->>'to')::date)
    union all
    select b.group_id,gs.week_start::date from bounds b cross join lateral generate_series(
      b.start_week+greatest(0,ceil((coalesce(nullif(p_filters->>'from','')::date,b.start_week)-b.start_week)::numeric/7)::integer)*7,
      least(b.end_week,coalesce(nullif(p_filters->>'to','')::date,b.end_week)),interval '7 days') gs(week_start) where v_surface='history'
  ), raw_rows as not materialized (
    select w.group_id,w.week_start,u.update,u.week_start update_week,
      coalesce((u.update->>'channel_fb')::boolean,g.channel_fb,false) fb,
      coalesce((u.update->>'channel_jobthai')::boolean,g.channel_jobthai,false) jobthai,
      coalesce((u.update->>'channel_jobtopgun')::boolean,g.channel_jobtopgun,false) jobtopgun,
      coalesce((u.update->>'channel_jobdb')::boolean,g.channel_jobdb,false) jobdb,
      coalesce((u.update->>'channel_jobbkk')::boolean,g.channel_jobbkk,false) jobbkk,
      coalesce((u.update->>'channel_linkedin')::boolean,g.channel_linkedin,false) linkedin,
      coalesce((u.update->>'channel_walkin')::boolean,g.channel_walkin,false) walkin,
      coalesce((u.update->>'channel_referral')::boolean,g.channel_referral,false) referral,
      coalesce((u.update->>'channel_others')::boolean,g.channel_others,false) others,
      g.group_position,b.open_headcount,coalesce(b.sites,'{}'::text[]) sites,coalesce(b.owners,'{}'::text[]) owners,b.doc_ids,
g.channel_fb,g.channel_jobthai,g.channel_jobtopgun,g.channel_jobdb,g.channel_jobbkk,g.channel_linkedin,g.channel_walkin,g.channel_referral,g.channel_others,coalesce(u.update->>'updated_at','') saved_at
    from weeks w join bounds b using(group_id) join public.position_groups g using(group_id)
    left join lateral (select to_jsonb(x) update,x.week_start from public.sourcing_weekly_updates x
      where x.group_id=w.group_id and x.week_start in (w.week_start,w.week_start+2) and app_private.can_read_sourcing_group(x.group_id)
      order by case when x.week_start=w.week_start then 0 else 1 end,x.updated_at desc limit 1) u on true
  ), calc_rows as not materialized (
    select r.*,
      case when r.update is null then null when (r.fb or r.jobthai or r.jobtopgun or r.jobdb or r.jobbkk or r.linkedin or r.walkin or r.referral or r.others) and
        ((r.fb and r.update->'applicants_fb'='null'::jsonb) or (r.jobthai and r.update->'applicants_jobthai'='null'::jsonb) or (r.jobtopgun and r.update->'applicants_jobtopgun'='null'::jsonb) or (r.jobdb and r.update->'applicants_jobdb'='null'::jsonb) or (r.jobbkk and r.update->'applicants_jobbkk'='null'::jsonb) or (r.linkedin and r.update->'applicants_linkedin'='null'::jsonb) or (r.walkin and r.update->'applicants_walkin'='null'::jsonb) or (r.referral and r.update->'applicants_referral'='null'::jsonb) or (r.others and r.update->'applicants_others'='null'::jsonb)) then null
        else (case when r.fb then coalesce((r.update->>'applicants_fb')::integer,0) else 0 end)+(case when r.jobthai then coalesce((r.update->>'applicants_jobthai')::integer,0) else 0 end)+(case when r.jobtopgun then coalesce((r.update->>'applicants_jobtopgun')::integer,0) else 0 end)+(case when r.jobdb then coalesce((r.update->>'applicants_jobdb')::integer,0) else 0 end)+(case when r.jobbkk then coalesce((r.update->>'applicants_jobbkk')::integer,0) else 0 end)+(case when r.linkedin then coalesce((r.update->>'applicants_linkedin')::integer,0) else 0 end)+(case when r.walkin then coalesce((r.update->>'applicants_walkin')::integer,0) else 0 end)+(case when r.referral then coalesce((r.update->>'applicants_referral')::integer,0) else 0 end)+(case when r.others then coalesce((r.update->>'applicants_others')::integer,0) else 0 end) end::integer applicants,
      case when r.update is not null and (r.fb or r.jobthai or r.jobtopgun or r.jobdb or r.jobbkk or r.linkedin or r.walkin or r.referral or r.others) and not ((r.fb and r.update->'applicants_fb'='null'::jsonb) or (r.jobthai and r.update->'applicants_jobthai'='null'::jsonb) or (r.jobtopgun and r.update->'applicants_jobtopgun'='null'::jsonb) or (r.jobdb and r.update->'applicants_jobdb'='null'::jsonb) or (r.jobbkk and r.update->'applicants_jobbkk'='null'::jsonb) or (r.linkedin and r.update->'applicants_linkedin'='null'::jsonb) or (r.walkin and r.update->'applicants_walkin'='null'::jsonb) or (r.referral and r.update->'applicants_referral'='null'::jsonb) or (r.others and r.update->'applicants_others'='null'::jsonb)) then 'saved' else 'needs_recording' end status
    from raw_rows r
  ), source_rows as not materialized (
    select c.*,case v_sort when 'group' then case when c.group_id ~* '^GRP-[0-9]+$' then
      lower(split_part(c.group_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(c.group_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||
      coalesce(nullif(ltrim(split_part(c.group_id,'-',2),'0'),''),'0')||'-'||lower(c.group_id) else lower(c.group_id) end
      when 'position' then lower(c.group_position) when 'status' then case when c.status='saved' then '0-saved' else '1-needs_recording' end when 'applicants' then lpad((coalesce(c.applicants,-1)+1)::text,12,'0') else case when v_sort='saved' then c.saved_at else c.week_start::text end end sort_value
    from calc_rows c
  )
  , filtered as (
    select * from source_rows s where (v_surface<>'board' or s.open_headcount>0)
      and (coalesce(p_filters->>'groupId','')='' or s.group_id=p_filters->>'groupId')
      and (coalesce(p_filters->>'group','')='' or s.group_id ilike '%'||(case when btrim(p_filters->>'group') ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(btrim(p_filters->>'group'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'group'),'-',2))),'0') else p_filters->>'group' end)||'%' or
        (s.group_id ~* '^GRP-[0-9]+$' and ('GRP-'||lpad(split_part(s.group_id,'-',2),greatest(5,length(split_part(s.group_id,'-',2))),'0')) ilike '%'||(case when btrim(p_filters->>'group') ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(btrim(p_filters->>'group'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'group'),'-',2))),'0') else p_filters->>'group' end)||'%'))
      and (coalesce(p_filters->>'position','')='' or s.group_position ilike '%'||(p_filters->>'position')||'%')
      and (coalesce(p_filters->>'week','')='' or s.week_start::text ilike '%'||(p_filters->>'week')||'%')
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'status','sourcing_status')) as category_value(value) where (coalesce(category_value.value,'') in ('','all') or s.status=category_value.value)))
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'applicants','sourcing_applicants')) as category_value(value) where (coalesce(category_value.value,'') in ('','all') or (category_value.value='has' and s.applicants>0) or (category_value.value='zero' and s.applicants=0) or (category_value.value='unknown' and s.applicants is null))))
      and (coalesce(p_filters->>'saved','')='' or s.saved_at ilike '%'||(p_filters->>'saved')||'%')
      and (v_search='' or concat_ws(' ',s.group_id,
        case when s.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(s.group_id,'-',2),greatest(5,length(split_part(s.group_id,'-',2))),'0') else s.group_id end,
        s.group_position,s.week_start,s.status,s.applicants,s.saved_at,s.sites,s.owners) ilike '%'||v_search||'%')
      and (p_cursor_value is null or (not p_before and ((v_dir='asc' and (s.sort_value>v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)>p_cursor_id)) or (v_dir='desc' and (s.sort_value<v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)>p_cursor_id))) or (p_before and ((v_dir='asc' and (s.sort_value<v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)<p_cursor_id)) or (v_dir='desc' and (s.sort_value>v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)<p_cursor_id))))))
  ), page_raw as (select * from filtered where not p_count_only order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then (group_id||'|'||week_start::text) end desc,case when not p_before then (group_id||'|'||week_start::text) end asc limit p_limit+1), page_rows as (select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then (group_id||'|'||week_start::text) end desc,case when not p_before then (group_id||'|'||week_start::text) end asc limit p_limit), edges as (select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,(group_id||'|'||week_start::text) asc))[1] first_sort,(array_agg((group_id||'|'||week_start::text) order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,(group_id||'|'||week_start::text) asc))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,(group_id||'|'||week_start::text) desc))[1] last_sort,(array_agg((group_id||'|'||week_start::text) order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,(group_id||'|'||week_start::text) desc))[1] last_id from page_rows), info as (select count(*)>p_limit extra from page_raw)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('group',jsonb_build_object('group_id',p.group_id,'group_position',p.group_position,'sites',p.sites,'owners',p.owners,'doc_ids',p.doc_ids,'open_headcount',p.open_headcount,'channel_fb',p.channel_fb,'channel_jobthai',p.channel_jobthai,'channel_jobtopgun',p.channel_jobtopgun,'channel_jobdb',p.channel_jobdb,'channel_jobbkk',p.channel_jobbkk,'channel_linkedin',p.channel_linkedin,'channel_walkin',p.channel_walkin,'channel_referral',p.channel_referral,'channel_others',p.channel_others,'latest_update',p.update),'week_start',p.week_start,'update',p.update,'status',p.status) order by case when v_dir='asc' then p.sort_value end asc,case when v_dir='desc' then p.sort_value end desc,p.group_id,p.week_start) from page_rows p),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from filtered) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_sort,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_sort,'id',edges.first_id) else null end) into v_result from edges cross join info;
  return v_result;
end; $function$;
