-- Database-wide, cursor-paged recruitment list projections.
create or replace function public.app_recruitment_applications_page_v1(
  p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer,
  p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_sort text := coalesce(nullif(p_sort,''),'latest_log_date');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_stage text := coalesce(p_filters->>'stage','');
  v_board text := coalesce(p_filters->>'boardFilter','all');
  v_group text := coalesce(p_filters->>'groupId','');
  v_since date;
  v_embedded_all_time boolean := coalesce((p_filters->>'embeddedAllTime')::boolean,false);
  v_as_of date := coalesce(nullif(p_filters->>'asOf','')::date,current_date);
  v_cursor text := p_cursor_value #>> '{}';
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('latest_log_date','candidate_id','name','application_id') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_direction not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if v_board not in ('all','aging','no_activity','offer_pending','over_sla','failed','passed_offer') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_filters ?| array['scope','site','owner'] or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('stage','boardFilter','asOf','recentSince','groupId','headerSite','headerPic','priorityOnly','embeddedAllTime','candidateId')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_embedded_all_time then v_since := null;
  elsif nullif(p_filters->>'recentSince','') is not null then v_since := (p_filters->>'recentSince')::date;
  else v_since := v_as_of - 7; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if p_before and p_cursor_value is null then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with latest as (
    select distinct on (l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,
      case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,
      l.round desc,l.log_id desc
  ), app_rows as not materialized (
    select a.application_id,a.candidate_id,a.group_id,a.state,a.created_at as application_created_at,
      c.name,c.nickname,c.phone_no,c.email,c.first_contact_date,c.channel,c.updated_at,c.home_site,c.created_by,c.responsible_recruiter_id,c.doc_group_id,c.ref_name,c.candidate_folder_url,
      coalesce(lat.recruitment_process,'No activity') as latest_process,lat.result as latest_result,lat.log_date as latest_log_date,lat.outcome_date,
      off.accepted_date,pg.group_position,
      coalesce(ctx.doc_ids,'{}'::text[]) as doc_ids,coalesce(ctx.sites,'{}'::text[]) as sites,coalesce(ctx.owners,'{}'::text[]) as person_in_charges,
      case v_sort
        when 'candidate_id' then lower(c.candidate_id)
        when 'name' then lower(coalesce(c.name,c.nickname,''))
        when 'application_id' then a.application_id::text
        else coalesce(to_char(lat.log_date,'YYYY-MM-DD'),'')
      end as sort_value,
      (lat.log_date is null) as no_activity,
      (lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null
       and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) as aging,
      coalesce(lat.recruitment_process='Offer' and lat.result=1,false) as passed_offer,
      jsonb_build_object('candidate_id',c.candidate_id,'name',c.name,'nickname',c.nickname,'phone_no',c.phone_no,'email',c.email,'home_site',c.home_site,
        'created_by',c.created_by,'responsible_recruiter_id',c.responsible_recruiter_id,'doc_group_id',c.doc_group_id,'ref_name',c.ref_name,'candidate_folder_url',c.candidate_folder_url,
        'first_contact_date',c.first_contact_date,'channel',c.channel,'updated_at',c.updated_at,'created_at',a.created_at,
        'application_id',a.application_id,'application_state',a.state,'group_id',a.group_id,'doc_ids',coalesce(ctx.doc_ids,'{}'::text[]),
        'doc_id',array_to_string(ctx.doc_ids,', '),'group_position',pg.group_position,'sites',coalesce(ctx.sites,'{}'::text[]),
        'person_in_charges',coalesce(ctx.owners,'{}'::text[]),'site',array_to_string(ctx.sites,', '),
        'person_in_charge',array_to_string(ctx.owners,', '),'latest_process',coalesce(lat.recruitment_process,'No activity'),
        'latest_result',lat.result,'latest_log_date',lat.log_date,'accepted_date',off.accepted_date) as item
    from public.candidate_applications a
    join public.candidates c on c.candidate_id=a.candidate_id
    left join public.position_groups pg on pg.group_id=a.group_id
    left join latest lat on lat.application_id=a.application_id
    left join lateral (select min(o.accepted_date) accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') off on true
    left join lateral (
      select array_agg(distinct d.doc_id order by d.doc_id) doc_ids,
        array_agg(distinct r.site order by r.site) sites,
        array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners
      from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id where d.group_id=a.group_id
    ) ctx on true
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and (coalesce(p_filters->>'candidateId','')='' or c.candidate_id=p_filters->>'candidateId')
      and (v_group='' or a.group_id=v_group)
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))
      and (v_stage='' or coalesce(lat.recruitment_process,'No activity')=v_stage)
      and (v_board='all'
        or (v_board in ('aging','over_sla') and lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer'))
        or (v_board='no_activity' and lat.application_id is null)
        or (v_board='offer_pending' and lat.recruitment_process='Offer' and lat.result is null)
        or (v_board='failed' and lat.result=0 and (v_since is null or coalesce(lat.outcome_date,lat.log_date) between v_since and v_as_of))
        or (v_board='passed_offer' and lat.recruitment_process='Offer' and lat.result=1 and (v_since is null or lat.log_date between v_since and v_as_of)))
      and (v_search='' or concat_ws(' ',c.candidate_id,c.name,c.nickname,c.phone_no,c.email,pg.group_position,ctx.doc_ids::text,ctx.sites::text,ctx.owners::text) ilike '%'||v_search||'%')
  ), filtered as (
    select * from app_rows r where p_cursor_value is null or
      (not p_before and ((v_direction='desc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.application_id::text>p_cursor_id))) or (v_direction='asc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.application_id::text>p_cursor_id)))) or
      (p_before and ((v_direction='desc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.application_id::text<p_cursor_id))) or (v_direction='asc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.application_id::text<p_cursor_id))))))
  ), counted as (select count(*)::integer total_count from app_rows where p_limit=0), page_raw as (
    select * from filtered order by
      case when not p_before and v_direction='desc' then sort_value end desc,
      case when not p_before and v_direction='asc' then sort_value end asc,
      case when p_before and v_direction='desc' then sort_value end asc,
      case when p_before and v_direction='asc' then sort_value end desc,
      case when p_before then application_id end desc, case when not p_before then application_id end asc limit p_limit+1
  ), page_rows as (select * from page_raw order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,case when p_before then application_id end desc,case when not p_before then application_id end asc limit p_limit), edges as (
    select (array_agg(sort_value order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,application_id asc))[1] first_sort,
      (array_agg(application_id::text order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,application_id asc))[1] first_id,
      (array_agg(sort_value order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,application_id desc))[1] last_sort,
      (array_agg(application_id::text order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,application_id desc))[1] last_id from page_rows
  ), page_info as (select count(*)>p_limit has_extra from page_raw
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(item order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,application_id asc) from page_rows),'[]'::jsonb),
    'total_count',case when p_limit=0 then (select total_count from counted) else null end,
    'has_more',case when p_before then exists(select 1 from page_rows) else page_info.has_extra end,
    'has_more_before',case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end,
    'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else page_info.has_extra end) then jsonb_build_object('value',to_jsonb(edges.last_sort),'id',edges.last_id) else null end,
    'previous_cursor',case when (case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',to_jsonb(edges.first_sort),'id',edges.first_id) else null end)
  into v_result from edges cross join page_info;
  return v_result;
end; $$;

create or replace function public.app_recruitment_list_count_v1(
  p_entity text, p_search text default '', p_filters jsonb default '{}'::jsonb
) returns integer
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_result jsonb;
  v_count integer;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  v_result := public.app_recruitment_list_v1(p_entity,p_search,p_filters,'','desc',0,null,null,false,true);
  v_count := nullif(v_result->>'total_count','')::integer;
  if v_count is null or v_count<0 then raise exception 'RECRUITMENT_LIST_COUNT_INVALID'; end if;
  return v_count;
end; $$;

create or replace function public.app_recruitment_history_page_v1(
  p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer,
  p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_sort text := coalesce(nullif(p_sort,''),'log_date');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_show_audit boolean := coalesce((p_filters->>'showAudit')::boolean,false);
  v_cursor text := p_cursor_value #>> '{}';
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('candidate','requisition','site','owner','stage','pending','outcome','date','log_date','log_id') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_direction not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('showAudit','candidate','candidateId','applicationId','requisition','site','owner','stage','pending','outcome','date','headerSite','headerPic','priorityOnly')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or p_cursor_id !~ '^[0-9]+$') then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if (p_cursor_value is null) <> (p_cursor_id is null) or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with log_rows as not materialized (
    select l.log_id,l.application_id,l.candidate_id,l.log_date,l.recruitment_process,l.round,l.interviewer,l.result,l.remark,
      l.estimated_action_date,l.created_at,l.updated_at,l.stage_instance_id,l.outcome_date,l.outcome_interviewer,l.outcome_remark,
      l.failure_actor,l.failure_main_reason_id,l.failure_detail_reason_id,l.failure_reason_snapshot,l.outcome_recorded_at,
      l.pending_edited_at,l.pending_edited_by,l.record_origin,l.migration_note,l.superseded_at,l.superseded_by_stage_instance_id,l.superseded_reason,
      a.state as application_state,a.group_id,c.name,c.nickname,c.phone_no,c.email,c.first_contact_date,c.channel,c.updated_at as candidate_updated_at,c.home_site,c.created_by,c.responsible_recruiter_id,c.doc_group_id,c.ref_name,c.candidate_folder_url,
      pg.group_position,coalesce(ctx.doc_ids,'{}'::text[]) doc_ids,coalesce(ctx.sites,'{}'::text[]) sites,coalesce(ctx.owners,'{}'::text[]) owners,
      coalesce(to_char(coalesce(l.outcome_date,l.log_date),'YYYY-MM-DD'),'') as event_date,
      case v_sort
        when 'candidate' then lower(concat_ws(' ',c.candidate_id,c.name,c.nickname))
        when 'requisition' then lower(concat_ws(' ',pg.group_position,array_to_string(ctx.doc_ids,' ')))
        when 'site' then lower(array_to_string(ctx.sites,' '))
        when 'owner' then lower(array_to_string(ctx.owners,' '))
        when 'stage' then lower(concat_ws(' ',l.recruitment_process,l.round::text))
        when 'pending' then lower(concat_ws(' ',l.log_date,l.estimated_action_date,l.interviewer,l.remark))
        when 'outcome' then lower(concat_ws(' ',case l.result when 1 then 'pass ผ่าน' when 0 then 'fail ไม่ผ่าน' else 'pending รอดำเนินการ' end,l.outcome_date,l.outcome_interviewer,l.failure_reason_snapshot::text,l.outcome_remark))
        when 'log_id' then lpad(l.log_id::text,20,'0')
        else coalesce(to_char(coalesce(l.outcome_date,l.log_date),'YYYY-MM-DD'),'') end as sort_value,
      jsonb_build_object('candidate',jsonb_build_object('candidate_id',c.candidate_id,'name',c.name,'nickname',c.nickname,'phone_no',c.phone_no,'email',c.email,'home_site',c.home_site,
        'created_by',c.created_by,'responsible_recruiter_id',c.responsible_recruiter_id,'doc_group_id',c.doc_group_id,'ref_name',c.ref_name,'candidate_folder_url',c.candidate_folder_url,
        'first_contact_date',c.first_contact_date,'channel',c.channel,'updated_at',c.updated_at,'created_at',a.created_at,
        'application_id',a.application_id,'application_state',a.state,'group_id',a.group_id,'doc_ids',coalesce(ctx.doc_ids,'{}'::text[]),
        'doc_id',array_to_string(ctx.doc_ids,', '),'group_position',pg.group_position,'sites',coalesce(ctx.sites,'{}'::text[]),
        'person_in_charges',coalesce(ctx.owners,'{}'::text[]),'site',array_to_string(ctx.sites,', '),'person_in_charge',array_to_string(ctx.owners,', '),
        'latest_process',coalesce(lat.recruitment_process,'No activity'),'latest_result',lat.result,'latest_log_date',lat.log_date,'accepted_date',off.accepted_date),
        'log',jsonb_build_object('application_id',l.application_id,'log_id',l.log_id,'candidate_id',l.candidate_id,'log_date',l.log_date,
        'recruitment_process',l.recruitment_process,'round',l.round,'interviewer',l.interviewer,'result',l.result,'remark',l.remark,
        'estimated_action_date',l.estimated_action_date,'created_at',l.created_at,'updated_at',l.updated_at,'stage_instance_id',l.stage_instance_id,
        'outcome_date',l.outcome_date,'outcome_interviewer',l.outcome_interviewer,'outcome_remark',l.outcome_remark,'failure_actor',l.failure_actor,
        'failure_main_reason_id',l.failure_main_reason_id,'failure_detail_reason_id',l.failure_detail_reason_id,'failure_reason_snapshot',l.failure_reason_snapshot,
        'outcome_recorded_at',l.outcome_recorded_at,'pending_edited_at',l.pending_edited_at,'pending_edited_by',l.pending_edited_by,
        'record_origin',l.record_origin,'migration_note',l.migration_note,'superseded_at',l.superseded_at,
        'superseded_by_stage_instance_id',l.superseded_by_stage_instance_id,'superseded_reason',l.superseded_reason),
        'audit',(l.superseded_at is not null or l.superseded_by_stage_instance_id is not null)) as item
    from public.recruitment_logs l
    join public.candidate_applications a on a.application_id=l.application_id
    join public.candidates c on c.candidate_id=l.candidate_id
    left join public.position_groups pg on pg.group_id=a.group_id
    left join lateral(select array_agg(distinct d.doc_id order by d.doc_id) doc_ids,array_agg(distinct r.site order by r.site) sites,
      array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners
      from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id where d.group_id=a.group_id) ctx on true
    left join lateral(select distinct on(ll.application_id) ll.recruitment_process,ll.result,ll.log_date from public.recruitment_logs ll where ll.application_id=a.application_id and ll.superseded_at is null and ll.superseded_by_stage_instance_id is null
      order by ll.application_id,case ll.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,ll.round desc,ll.log_id desc) lat on true
    left join lateral(select min(o.accepted_date) accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') off on true
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(c.candidate_id)
      and (coalesce(p_filters->>'candidateId','')='' or c.candidate_id=p_filters->>'candidateId')
      and (coalesce(p_filters->>'applicationId','')='' or a.application_id::text=p_filters->>'applicationId')
      and (v_show_audit or (l.superseded_at is null and l.superseded_by_stage_instance_id is null))
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))
      and (coalesce(p_filters->>'candidate','')='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' and length(split_part(c.candidate_id,'-',2))<5 then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),5,'0') else upper(c.candidate_id) end,
        c.name,c.nickname) ilike ('%'||(p_filters->>'candidate')||'%'))
      and (coalesce(p_filters->>'requisition','')='' or concat_ws(' ',pg.group_position,array_to_string(ctx.doc_ids,' ')) ilike ('%'||(p_filters->>'requisition')||'%'))
      and (coalesce(p_filters->>'site','')='' or array_to_string(ctx.sites,' ') ilike ('%'||(p_filters->>'site')||'%'))
      and (coalesce(p_filters->>'owner','')='' or array_to_string(ctx.owners,' ') ilike ('%'||(p_filters->>'owner')||'%'))
      and (coalesce(p_filters->>'stage','')='' or concat_ws(' ',l.recruitment_process,l.round::text) ilike ('%'||(p_filters->>'stage')||'%'))
      and (coalesce(p_filters->>'pending','')='' or concat_ws(' ',l.log_date,l.estimated_action_date,l.interviewer,l.remark) ilike ('%'||(p_filters->>'pending')||'%'))
      and (coalesce(p_filters->>'outcome','')='' or (
        case lower(btrim(p_filters->>'outcome'))
          when 'pass' then l.result=1 when 'ผ่าน' then l.result=1
          when 'fail' then l.result=0 when 'ไม่ผ่าน' then l.result=0
          when 'pending' then l.result is null when 'รอดำเนินการ' then l.result is null
          else concat_ws(' ',case l.result when 1 then 'Pass ผ่าน' when 0 then 'Fail ไม่ผ่าน' else 'Pending รอดำเนินการ' end,l.outcome_date,l.outcome_interviewer,l.outcome_remark,l.failure_reason_snapshot::text) ilike ('%'||(p_filters->>'outcome')||'%')
        end))
      and (coalesce(p_filters->>'date','')='' or concat_ws(' ',coalesce(l.outcome_date,l.log_date)::text,to_char(coalesce(l.outcome_date,l.log_date),'DD/MM/YYYY')) ilike ('%'||(p_filters->>'date')||'%'))
      and (v_search='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' and length(split_part(c.candidate_id,'-',2))<5 then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),5,'0') else upper(c.candidate_id) end,
        c.name,c.nickname,l.recruitment_process,l.round,l.log_date,l.estimated_action_date,l.interviewer,l.remark,
        case l.result when 1 then 'Pass ผ่าน' when 0 then 'Fail ไม่ผ่าน' else 'Pending รอดำเนินการ' end,l.outcome_date,l.outcome_interviewer,l.outcome_remark,l.failure_reason_snapshot::text,
        pg.group_position,ctx.doc_ids::text,ctx.sites::text,ctx.owners::text) ilike '%'||v_search||'%')
  ), filtered as (
    select * from log_rows r where p_cursor_value is null or
      (not p_before and ((v_direction='desc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.log_id>p_cursor_id::bigint))) or (v_direction='asc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.log_id>p_cursor_id::bigint)))) or
      (p_before and ((v_direction='desc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.log_id<p_cursor_id::bigint))) or (v_direction='asc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.log_id<p_cursor_id::bigint))))))
  ), counted as(select count(*)::integer total_count from log_rows where p_limit=0), page_raw as (
    select * from filtered order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,
      case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,
      case when p_before then log_id end desc,case when not p_before then log_id end asc limit p_limit+1
  ), page_rows as(select * from page_raw order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,case when p_before then log_id end desc,case when not p_before then log_id end asc limit p_limit), edges as(
    select (array_agg(sort_value order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,log_id asc))[1] first_sort,
      (array_agg(log_id order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,log_id asc))[1] first_id,
      (array_agg(sort_value order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,log_id desc))[1] last_sort,
      (array_agg(log_id order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,log_id desc))[1] last_id from page_rows
  ), page_info as(select count(*)>p_limit has_extra from page_raw
  ) select jsonb_build_object('items',coalesce((select jsonb_agg(item order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,log_id asc) from page_rows),'[]'::jsonb),
      'total_count',case when p_limit=0 then (select total_count from counted) else null end,
      'has_more',case when p_before then exists(select 1 from page_rows) else page_info.has_extra end,
      'has_more_before',case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end,
      'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else page_info.has_extra end) then jsonb_build_object('value',to_jsonb(edges.last_sort),'id',edges.last_id::text) else null end,
      'previous_cursor',case when (case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',to_jsonb(edges.first_sort),'id',edges.first_id::text) else null end)
    into v_result from edges cross join page_info;
  return v_result;
end; $$;

create or replace function public.app_recruitment_requisitions_page_v1(
  p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer,
  p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_sort text := coalesce(nullif(p_sort,''),'updated_at');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_cursor text := p_cursor_value #>> '{}';
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('doc_id','position','status','open_headcount','readiness','sla','age','owner','department','request_type','section','head_count','accepted_count','candidate_count','req_date','updated_at') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_direction not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('doc_id','position','status','open_headcount','readiness','sla','age','owner','department','request_type','section','head_count','accepted_count','candidate_count','req_date','updated_at','site','level','headerSite','headerPic','priorityOnly')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if (p_cursor_value is null) <> (p_cursor_id is null) or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
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
      and (coalesce(p_filters->>'site','')='' or r.site ilike ('%'||(p_filters->>'site')||'%'))
      and (coalesce(p_filters->>'level','')='' or r.level ilike ('%'||(p_filters->>'level')||'%'))
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
      and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
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
        greatest(r.head_count-coalesce(ofrs.accepted_count,0),0),coalesce(array_to_string(links.sourcing_group_ids,' '),''),cands.candidate_count,ofrs.accepted_count) ilike '%'||v_search||'%')
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

create or replace function public.app_candidate_profile_detail_v1(p_candidate_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_candidate public.candidates%rowtype;
  v_read boolean;
  v_unmatched boolean;
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if nullif(btrim(p_candidate_id),'') is null then raise exception 'CANDIDATE_ID_REQUIRED'; end if;
  select c.* into v_candidate from public.candidates c where c.candidate_id=p_candidate_id;
  if not found then return jsonb_build_object('candidate',null,'masked',null,'capabilities',null); end if;
  v_read := app_private.can_read_candidate(p_candidate_id);
  v_unmatched := not exists(select 1 from public.candidate_applications a where a.candidate_id=p_candidate_id);
  if v_read then
    return jsonb_build_object(
      'candidate',jsonb_build_object('candidate_id',v_candidate.candidate_id,'name',v_candidate.name,'nickname',v_candidate.nickname,
        'phone_no',v_candidate.phone_no,'email',v_candidate.email,'doc_group_id',v_candidate.doc_group_id,'group_id',v_candidate.group_id,
        'channel',v_candidate.channel,'ref_name',v_candidate.ref_name,'first_contact_date',v_candidate.first_contact_date,
        'candidate_folder_url',v_candidate.candidate_folder_url,'created_at',v_candidate.created_at,'updated_at',v_candidate.updated_at,
        'home_site',v_candidate.home_site,'created_by',v_candidate.created_by,'responsible_recruiter_id',v_candidate.responsible_recruiter_id,
        'position_interests',v_candidate.position_interests),
      'masked',null,
      'capabilities',jsonb_build_object('candidate_id',v_candidate.candidate_id,
        'creator_label',(select coalesce(p.nickname,p.full_name,'Unknown') from public.profiles p where p.id=v_candidate.created_by),
        'can_edit',app_private.can_manage_candidate(v_candidate.candidate_id),
        'can_read_note',app_private.can_read_profile_note(v_candidate.candidate_id),
        'can_edit_note',app_private.can_edit_profile_note(v_candidate.candidate_id),
        'can_add_application',app_private.can_match_candidate(v_candidate.candidate_id),
        'is_unmatched',v_unmatched,
        'note_editor_label',case when app_private.can_read_profile_note(v_candidate.candidate_id) then
          (select coalesce(pn.nickname,pn.full_name,'Recruiter') from public.candidate_notes n left join public.profiles pn on pn.id=coalesce(n.updated_by,n.created_by) where n.candidate_id=v_candidate.candidate_id order by n.created_at desc limit 1) end));
  elsif v_unmatched then
    return jsonb_build_object('candidate',null,'masked',jsonb_build_object('candidate_id',v_candidate.candidate_id,
      'position_interests',v_candidate.position_interests,'created_by',v_candidate.created_by,
      'creator_label',(select coalesce(p.nickname,p.full_name,'Unknown') from public.profiles p where p.id=v_candidate.created_by),
      'created_at',v_candidate.created_at),'capabilities',null);
  end if;
  return jsonb_build_object('candidate',null,'masked',null,'capabilities',null);
end; $$;

create or replace function public.app_recruitment_list_v1(
  p_entity text,
  p_search text default '',
  p_filters jsonb default '{}'::jsonb,
  p_sort text default '',
  p_direction text default 'desc',
  p_limit integer default 50,
  p_cursor_value jsonb default null,
  p_cursor_id text default null,
  p_before boolean default false,
  p_count_only boolean default false
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_scope text := coalesce(nullif(p_filters->>'scope',''), 'all');
  v_site text := coalesce(p_filters->>'site','');
  v_owner text := coalesce(p_filters->>'owner','');
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_sort text := coalesce(nullif(p_sort,''), 'updated_at');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_cursor_value text;
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then
    raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED';
  end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then
    raise exception 'RECRUITMENT_LIST_LIMIT_INVALID';
  end if;
  if p_entity='pipeline_history' then
    return public.app_recruitment_history_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='requisitions' then
    return public.app_recruitment_requisitions_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity in ('candidate_applications','pipeline_stage') then
    return public.app_recruitment_applications_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity <> 'candidate_registry' then
    raise exception 'RECRUITMENT_LIST_ENTITY_UNSUPPORTED';
  end if;
  if v_scope not in ('all','pool','active','history') then
    raise exception 'RECRUITMENT_LIST_SCOPE_INVALID';
  end if;
  if v_sort not in ('updated_at','candidate_id','name','active_application_count') then
    raise exception 'RECRUITMENT_LIST_SORT_INVALID';
  end if;
  if v_direction not in ('asc','desc') then
    raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb)) <> 'object' then
    raise exception 'RECRUITMENT_LIST_FILTER_INVALID';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) key_name where key_name not in ('scope','site','owner','candidateId')) then
    raise exception 'RECRUITMENT_LIST_FILTER_INVALID';
  end if;
  if (p_cursor_value is null) <> (p_cursor_id is null) then
    raise exception 'RECRUITMENT_LIST_CURSOR_INVALID';
  end if;
  if p_cursor_value is not null and jsonb_typeof(p_cursor_value) <> 'string' then
    raise exception 'RECRUITMENT_LIST_CURSOR_INVALID';
  end if;
  if p_cursor_value is not null and (p_cursor_id = '' or p_cursor_id is null) then
    raise exception 'RECRUITMENT_LIST_CURSOR_INVALID';
  end if;
  if p_before and p_cursor_value is null then
    raise exception 'RECRUITMENT_LIST_CURSOR_INVALID';
  end if;
  v_cursor_value := p_cursor_value #>> '{}';

  with capabilities as (
    select c.candidate_id,c.creator_label,c.is_unmatched
    from jsonb_to_recordset(public.app_candidate_profile_capabilities_v1()) as c(
      candidate_id text, creator_label text, can_edit boolean, can_read_note boolean,
      can_edit_note boolean, can_add_application boolean, is_unmatched boolean, note_editor_label text
    )
  ), readable_candidates as (
    select
      c.candidate_id,
      true as readable,
      false as masked,
      c.name,
      c.nickname,
      c.phone_no,
      c.email,
      c.home_site,
      caps.creator_label,
      c.channel,
      c.position_interests,
      apps.active_count as active_application_count,
      apps.has_closed,
      caps.is_unmatched,
      c.created_at,
      c.updated_at
    from public.candidates c
    join capabilities caps on caps.candidate_id = c.candidate_id
    cross join lateral (
      select
        count(*) filter (where a.state = 'active')::integer as active_count,
        coalesce(bool_or(a.state = 'closed'),false) as has_closed
      from public.candidate_applications a
      where a.candidate_id = c.candidate_id
    ) apps
    where app_private.can_read_candidate(c.candidate_id)
  ), masked_candidates as (
    select
      m.candidate_id,
      false as readable,
      true as masked,
      null::text as name,
      null::text as nickname,
      null::text as phone_no,
      null::text as email,
      null::text as home_site,
      m.creator_label,
      null::text as channel,
      m.position_interests,
      null::integer as active_application_count,
      false as has_closed,
      true as is_unmatched,
      m.created_at,
      null::timestamptz as updated_at
    from jsonb_to_recordset(public.app_masked_candidate_pool_v1()) as m(
      candidate_id text, position_interests text, created_by uuid, creator_label text, created_at timestamptz
    )
  ), candidate_base as (
    select * from readable_candidates
    union all
    select * from masked_candidates
  ), candidate_projection as (
    select
      b.*,
      jsonb_build_object(
        'candidate_id', b.candidate_id,
        'name', case when b.masked then null else b.name end,
        'nickname', case when b.masked then null else b.nickname end,
        'phone_no', case when b.masked then null else b.phone_no end,
        'email', case when b.masked then null else b.email end,
        'home_site', case when b.masked then null else b.home_site end,
        'creator_label', b.creator_label,
        'channel', case when b.masked then null else b.channel end,
        'position_interests', b.position_interests,
        'active_application_count', case when b.masked then null else b.active_application_count end,
        'updated_at', case when b.masked then null else b.updated_at end,
        'created_at', b.created_at,
        'masked', b.masked,
        'is_unmatched', b.is_unmatched
      ) as item,
      case v_sort
        when 'candidate_id' then lower(b.candidate_id)
        when 'name' then lower(coalesce(b.name,b.nickname,''))
        when 'active_application_count' then lpad(coalesce(b.active_application_count,0)::text,12,'0')
        else to_char(coalesce(b.updated_at,b.created_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      end as sort_value
    from candidate_base b
    where (b.readable or (b.masked and v_scope in ('all','pool')))
      and (v_site = '' or b.masked or b.home_site = v_site)
      and (v_owner = '' or b.creator_label = v_owner)
      and (coalesce(p_filters->>'candidateId','')='' or b.candidate_id=p_filters->>'candidateId')
      and (v_scope = 'all' or (v_scope = 'pool' and coalesce(b.is_unmatched,false)) or (v_scope = 'active' and coalesce(b.active_application_count,0) > 0) or (v_scope = 'history' and coalesce(b.has_closed,false)))
      and (
        v_search = ''
        or (
        lower(b.candidate_id) like '%' || v_search || '%'
        or lower(case when b.candidate_id ~* '^(CAN|GRP)-[0-9]+$' then
          upper(substring(b.candidate_id from '^([A-Za-z]+)-')) || '-' ||
          case when length(substring(b.candidate_id from '-([0-9]+)$')) < 5
            then lpad(substring(b.candidate_id from '-([0-9]+)$'),5,'0')
            else substring(b.candidate_id from '-([0-9]+)$') end
          else b.candidate_id end) like '%' || v_search || '%'
        or (not b.masked and concat_ws(' ',b.name,b.nickname,b.phone_no,b.email,b.position_interests) ilike '%' || v_search || '%')
        or (b.masked and concat_ws(' ',b.position_interests,b.creator_label) ilike '%' || v_search || '%')
        )
      )
  ), filtered as (
    select * from candidate_projection f
    where p_cursor_value is null
      or (not p_before and (
        (v_direction='asc' and (f.sort_value > v_cursor_value or (f.sort_value=v_cursor_value and f.candidate_id > p_cursor_id)))
        or (v_direction='desc' and (f.sort_value < v_cursor_value or (f.sort_value=v_cursor_value and f.candidate_id > p_cursor_id)))
      ))
      or (p_before and (
        (v_direction='asc' and (f.sort_value < v_cursor_value or (f.sort_value=v_cursor_value and f.candidate_id < p_cursor_id)))
        or (v_direction='desc' and (f.sort_value > v_cursor_value or (f.sort_value=v_cursor_value and f.candidate_id < p_cursor_id)))
      ))
  ), matched_count as (
    select count(*)::integer as total_count from candidate_projection where p_limit=0
  ), page_raw as (
    select * from filtered
    order by
      case when not p_before and v_direction='asc' then sort_value end asc,
      case when not p_before and v_direction='desc' then sort_value end desc,
      case when p_before and v_direction='asc' then sort_value end desc,
      case when p_before and v_direction='desc' then sort_value end asc,
      case when p_before then candidate_id end desc,
      case when not p_before then candidate_id end asc
    limit p_limit
  ), page_rows as (
    select * from page_raw
    order by
      case when v_direction='asc' then sort_value end asc,
      case when v_direction='desc' then sort_value end desc,
      candidate_id asc
  ), page_edges as (
    select
      (array_agg(sort_value order by case when v_direction='asc' then sort_value end asc, case when v_direction='desc' then sort_value end desc, candidate_id asc))[1] as first_sort,
      (array_agg(candidate_id order by case when v_direction='asc' then sort_value end asc, case when v_direction='desc' then sort_value end desc, candidate_id asc))[1] as first_id,
      (array_agg(sort_value order by case when v_direction='asc' then sort_value end desc, case when v_direction='desc' then sort_value end asc, candidate_id desc))[1] as last_sort,
      (array_agg(candidate_id order by case when v_direction='asc' then sort_value end desc, case when v_direction='desc' then sort_value end asc, candidate_id desc))[1] as last_id
    from page_rows
  ), availability as (
    select
      exists(select 1 from candidate_projection f cross join page_edges e where e.last_id is not null and ((v_direction='asc' and (f.sort_value>e.last_sort or (f.sort_value=e.last_sort and f.candidate_id>e.last_id))) or (v_direction='desc' and (f.sort_value<e.last_sort or (f.sort_value=e.last_sort and f.candidate_id>e.last_id))))) as has_more,
      exists(select 1 from candidate_projection f cross join page_edges e where e.first_id is not null and ((v_direction='asc' and (f.sort_value<e.first_sort or (f.sort_value=e.first_sort and f.candidate_id<e.first_id))) or (v_direction='desc' and (f.sort_value>e.first_sort or (f.sort_value=e.first_sort and f.candidate_id<e.first_id))))) as has_more_before
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(item order by case when v_direction='asc' then sort_value end asc, case when v_direction='desc' then sort_value end desc, candidate_id asc) from page_rows),'[]'::jsonb),
    'total_count', case when p_limit=0 then (select total_count from matched_count) else null end,
    'has_more', availability.has_more,
    'has_more_before', availability.has_more_before,
    'next_cursor', case when availability.has_more then jsonb_build_object('value',to_jsonb(page_edges.last_sort),'id',page_edges.last_id) else null end,
    'previous_cursor', case when availability.has_more_before then jsonb_build_object('value',to_jsonb(page_edges.first_sort),'id',page_edges.first_id) else null end
  ) into v_result
  from page_edges cross join availability;

  return v_result;
end;
$$;

create or replace function public.app_pipeline_summary_v1(
  p_scope jsonb default '{}'::jsonb,
  p_group_id text default null,
  p_as_of date default current_date,
  p_recent_days integer default 7
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_recent_days not between 1 and 90 then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  with latest as (
    select distinct on(l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc
  ), rows as (
    select a.application_id,a.group_id,a.state,coalesce(lat.recruitment_process,'No activity') stage,lat.result,lat.log_date,lat.outcome_date,
      off.accepted_date,
      (lat.log_date is not null and p_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) aging,
      (lat.application_id is null) no_activity,
      coalesce(lat.recruitment_process='Offer' and lat.result=1,false) passed_offer
    from public.candidate_applications a join public.candidates c on c.candidate_id=a.candidate_id
    left join latest lat on lat.application_id=a.application_id
    left join lateral(select min(o.accepted_date) accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') off on true
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and (p_group_id is null or a.group_id=p_group_id)
      and (coalesce(p_scope->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_scope->>'headerSite'))
      and (coalesce(p_scope->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_scope->>'headerPic'))))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))
  ), active_rows as (select * from rows where state='active' and result is distinct from 0 and not passed_offer),
  stage_counts as (select stage,count(*)::integer as count from active_rows group by stage)
  select jsonb_build_object(
    'as_of',p_as_of,'recent_since',p_as_of-p_recent_days,
    'active',(select count(*)::integer from active_rows),
    'aging',(select count(*)::integer from active_rows where aging),
    'failed',(select count(*)::integer from rows where result=0 and coalesce(outcome_date,log_date) between p_as_of-p_recent_days and p_as_of),
    'passed_offer',(select count(*)::integer from rows where passed_offer and log_date between p_as_of-p_recent_days and p_as_of),
    'no_activity',(select count(*)::integer from active_rows where no_activity),
    'by_stage',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'count',count) order by case stage when 'No activity' then 0 when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 7 end) from stage_counts),'[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

revoke all on function public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean,boolean) to authenticated;
revoke all on function public.app_recruitment_list_count_v1(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.app_recruitment_list_count_v1(text,text,jsonb) to authenticated;
revoke all on function public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_history_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_candidate_profile_detail_v1(text), public.app_pipeline_summary_v1(jsonb,text,date,integer) from public, anon, authenticated;
grant execute on function public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_history_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_candidate_profile_detail_v1(text), public.app_pipeline_summary_v1(jsonb,text,date,integer) to authenticated;
revoke all on function public.app_recruitment_requisitions_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.app_recruitment_requisitions_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) to authenticated;
