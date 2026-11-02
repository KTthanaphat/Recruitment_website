-- Bounded requisition page and base-criteria exact-count paths; invoker/RLS predicates preserved.
create or replace function public.app_recruitment_requisitions_page_v1(
  p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer,
  p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
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
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
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
      and (coalesce(p_filters->>'status','')='' or case lower(btrim(p_filters->>'status')) when 'ongoing' then r.status='ongoing' when 'กำลังดำเนินการ' then r.status='ongoing' when 'filled' then r.status='filled' when 'ครบแล้ว' then r.status='filled' when 'cancel' then r.status='cancel' when 'cancelled' then r.status='cancel' when 'ยกเลิก' then r.status='cancel' else concat_ws(' ',r.status,r.site,r.department) ilike ('%'||(p_filters->>'status')||'%') end)
      and (coalesce(p_filters->>'owner','')='' or coalesce(r.person_in_charge,'') ilike ('%'||(p_filters->>'owner')||'%'))
      and (coalesce(p_filters->>'department','')='' or r.department ilike ('%'||(p_filters->>'department')||'%'))
      and (coalesce(p_filters->>'request_type','')='' or case lower(btrim(p_filters->>'request_type')) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike ('%'||(p_filters->>'request_type')||'%') end)
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
        and (coalesce(p_filters->>'status','')='' or case lower(btrim(p_filters->>'status')) when 'ongoing' then r.status='ongoing' when 'กำลังดำเนินการ' then r.status='ongoing' when 'filled' then r.status='filled' when 'ครบแล้ว' then r.status='filled' when 'cancel' then r.status='cancel' when 'cancelled' then r.status='cancel' when 'ยกเลิก' then r.status='cancel' else concat_ws(' ',r.status,r.site,r.department) ilike ('%'||(p_filters->>'status')||'%') end)
        and (coalesce(p_filters->>'owner','')='' or coalesce(r.person_in_charge,'') ilike ('%'||(p_filters->>'owner')||'%'))
        and (coalesce(p_filters->>'department','')='' or r.department ilike ('%'||(p_filters->>'department')||'%'))
        and (coalesce(p_filters->>'request_type','')='' or case lower(btrim(p_filters->>'request_type')) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike ('%'||(p_filters->>'request_type')||'%') end)
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
      and (coalesce(p_filters->>'status','')='' or case lower(btrim(p_filters->>'status')) when 'ongoing' then r.status='ongoing' when 'กำลังดำเนินการ' then r.status='ongoing' when 'filled' then r.status='filled' when 'ครบแล้ว' then r.status='filled' when 'cancel' then r.status='cancel' when 'cancelled' then r.status='cancel' when 'ยกเลิก' then r.status='cancel' else concat_ws(' ',r.status,r.site,r.department) ilike ('%'||(p_filters->>'status')||'%') end)
      and (coalesce(p_filters->>'open_headcount','')='' or greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::text ilike ('%'||(p_filters->>'open_headcount')||'%'))
      and (coalesce(p_filters->>'readiness','')='' or case lower(btrim(p_filters->>'readiness')) when 'linked' then links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 when 'เชื่อมแล้ว' then links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 when 'missing' then links.sourcing_group_ids is null or cardinality(links.sourcing_group_ids)=0 when 'not linked' then links.sourcing_group_ids is null or cardinality(links.sourcing_group_ids)=0 when 'ยังไม่เชื่อม' then links.sourcing_group_ids is null or cardinality(links.sourcing_group_ids)=0 else coalesce(array_to_string(links.sourcing_group_ids,' '),'') ilike ('%'||(p_filters->>'readiness')||'%') end)
      and (coalesce(p_filters->>'sla','')='' or (case when age.age_days is null or sla.sla_days is null then '-' else age.age_days||'d / '||sla.sla_days||'d' end) ilike ('%'||(p_filters->>'sla')||'%'))
      and (coalesce(p_filters->>'age','')='' or concat_ws(' ',coalesce(age.age_days::text||'d','-'),age.age_days) ilike ('%'||(p_filters->>'age')||'%'))
      and (coalesce(p_filters->>'owner','')='' or coalesce(r.person_in_charge,'') ilike ('%'||(p_filters->>'owner')||'%'))
      and (coalesce(p_filters->>'department','')='' or r.department ilike ('%'||(p_filters->>'department')||'%'))
      and (coalesce(p_filters->>'request_type','')='' or case lower(btrim(p_filters->>'request_type')) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike ('%'||(p_filters->>'request_type')||'%') end)
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
end; $$;
