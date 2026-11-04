-- Database-wide, cursor-paged recruitment list projections.
-- Remove legacy shorter-arity RPCs before defining the current signatures; otherwise PostgREST sees overloads and old limit gates remain callable.
drop function if exists public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean);
drop function if exists public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean);
drop function if exists public.app_recruitment_history_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean);
create or replace function public.app_recruitment_applications_page_v1(
  p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer,
  p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_search text := lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
  v_sort text := coalesce(nullif(p_sort,''),'latest_log_date');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_stage text := coalesce(p_filters->>'stage','');
  v_board text := coalesce(p_filters->>'boardFilter','all');
  v_group text := coalesce(p_filters->>'groupId','');
  v_since date;
  v_embedded_all_time boolean := coalesce((p_filters->>'embeddedAllTime')::boolean,false);
  v_home_tab text := coalesce(p_filters->>'homeTab','');
  v_active_board boolean := coalesce((p_filters->>'activeBoard')::boolean,false);
  v_as_of date := coalesce(nullif(p_filters->>'asOf','')::date,current_date);
  v_global_reader boolean := app_private.is_global_recruitment_reader();
  v_cursor text := p_cursor_value #>> '{}';
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('latest_log_date','candidate_id','name','application_id','home_oldest_touch','home_newest_touch','home_progression','board_last_update') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_direction not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if v_board not in ('all','aging','no_activity','offer_pending','over_sla','failed','passed_offer') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_home_tab not in ('','active_pipeline') or p_filters ?| array['scope','site','owner'] or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('stage','boardFilter','asOf','recentSince','groupId','headerSite','headerPic','priorityOnly','embeddedAllTime','candidateId','homeTab','activeBoard')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_active_board and v_stage not in ('No activity','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_embedded_all_time then v_since := null;
  elsif nullif(p_filters->>'recentSince','') is not null then v_since := (p_filters->>'recentSince')::date;
  else v_since := v_as_of - 7; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if p_before and p_cursor_value is null then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with eligible_applications as materialized (
    select a.* from public.candidate_applications a
    where case when v_global_reader then true else app_private.can_read_application(a.application_id) end and case when v_global_reader then true else app_private.can_read_candidate(a.candidate_id) end
      and (coalesce(p_filters->>'candidateId','')='' or a.candidate_id=p_filters->>'candidateId')
      and (v_group='' or a.group_id=v_group)
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))

  ), latest as (
    select distinct on (l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l join eligible_applications eligible on eligible.application_id=l.application_id
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
        when 'home_oldest_touch' then (case when coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end) is null then '1' else '0' end)||coalesce(coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end)::text,'')
        when 'home_newest_touch' then (case when coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end) is null then '0' else '1' end)||coalesce(coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end)::text,'')
        when 'home_progression' then lpad((case coalesce(lat.recruitment_process,'No activity') when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end)::text,2,'0')
        when 'board_last_update' then coalesce(lat.log_date::text,c.updated_at::text,'')
        when 'candidate_id' then case when c.candidate_id ~* '^CAN-[0-9]+$' then
          lower(split_part(c.candidate_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||
          coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0')||'-'||lower(c.candidate_id) else lower(c.candidate_id) end
        when 'name' then lower(coalesce(c.name,c.nickname,''))
        when 'application_id' then a.application_id::text
        else coalesce(to_char(lat.log_date,'YYYY-MM-DD'),'')
      end as sort_value,
      (lat.log_date is null) as no_activity,
      (lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null
       and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) as aging,
      coalesce(lat.recruitment_process='Offer' and lat.result=1,false) as passed_offer
    from eligible_applications a
    join public.candidates c on c.candidate_id=a.candidate_id
    left join public.position_groups pg on pg.group_id=a.group_id
    left join latest lat on lat.application_id=a.application_id
    left join lateral (select max(event.touch_date) last_touch from public.recruitment_logs t cross join lateral(values(t.log_date),(t.outcome_date)) event(touch_date) where t.application_id=a.application_id and t.superseded_at is null and t.superseded_by_stage_instance_id is null and event.touch_date is not null and event.touch_date<=v_as_of) home_touch on true
    left join lateral (select min(o.accepted_date) accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') off on true
    left join lateral (
      select array_agg(distinct d.doc_id order by d.doc_id) doc_ids,
        array_agg(distinct r.site order by r.site) sites,
        array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners
      from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id where d.group_id=a.group_id
    ) ctx on true
    where true
      and (v_stage='' or coalesce(lat.recruitment_process,'No activity')=v_stage)
      and (not v_active_board or (coalesce(lat.recruitment_process,'No activity') in ('No activity','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and lat.result is distinct from 0 and not coalesce(lat.recruitment_process='Offer' and lat.result=1,false)))
      and (not v_active_board or v_board<>'offer_pending' or off.accepted_date is null)
      and (v_home_tab='' or (v_home_tab='active_pipeline' and lat.application_id is not null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and lat.result is distinct from 0 and not exists(select 1 from public.offers any_offer where any_offer.candidate_id=a.candidate_id and app_private.can_read_application(any_offer.application_id))))
      and (v_board='all'
        or (v_board in ('aging','over_sla') and lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer'))
        or (v_board='no_activity' and lat.application_id is null)
        or (v_board='offer_pending' and lat.recruitment_process='Offer' and lat.result is null)
        or (v_board='failed' and lat.result=0 and (v_since is null or coalesce(lat.outcome_date,lat.log_date) between v_since and v_as_of))
        or (v_board='passed_offer' and lat.recruitment_process='Offer' and lat.result=1 and (v_since is null or lat.log_date between v_since and v_as_of)))
      and (v_search='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),greatest(5,length(split_part(c.candidate_id,'-',2))),'0') else c.candidate_id end,
        a.group_id,case when a.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(a.group_id,'-',2),greatest(5,length(split_part(a.group_id,'-',2))),'0') else a.group_id end,
        pg.group_position,c.name,c.nickname,c.phone_no,c.email,ctx.doc_ids::text,ctx.sites::text,ctx.owners::text) ilike '%'||v_search||'%')
  ), filtered as (
    select * from app_rows r where p_cursor_value is null or
      (not p_before and ((v_direction='desc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.application_id::text>p_cursor_id))) or (v_direction='asc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.application_id::text>p_cursor_id)))) or
      (p_before and ((v_direction='desc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.application_id::text<p_cursor_id))) or (v_direction='asc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.application_id::text<p_cursor_id))))))
  ), counted as (select count(*)::integer total_count from app_rows where p_limit=0), page_raw as (
    select application_id,sort_value from filtered order by
      case when not p_before and v_direction='desc' then sort_value end desc,
      case when not p_before and v_direction='asc' then sort_value end asc,
      case when p_before and v_direction='desc' then sort_value end asc,
      case when p_before and v_direction='asc' then sort_value end desc,
      case when p_before then application_id end desc, case when not p_before then application_id end asc limit p_limit+1
  ), page_keys as materialized (select * from page_raw order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,case when p_before then application_id end desc,case when not p_before then application_id end asc limit p_limit
  ), page_projection as materialized (
    select card from jsonb_array_elements(app_private.candidate_action_cards_v1(array(select application_id from page_keys),v_as_of)) card
  ), page_rows as (
    select k.application_id,k.sort_value,p.card-'has_readable_offer'-'has_priority_requisition' item
    from page_keys k join page_projection p on p.card->>'application_id'=k.application_id::text
  ), edges as (
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

revoke all on function public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) from public,anon;
grant execute on function public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) to authenticated;

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
  v_search text := lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
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
        when 'candidate' then case when c.candidate_id ~* '^CAN-[0-9]+$' then
          lower(split_part(c.candidate_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||
          coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0')||'-'||lower(c.candidate_id)
          else lower(c.candidate_id) end||'|'||lower(concat_ws(' ',c.name,c.nickname))
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
        c.name,c.nickname) ilike ('%'||(case when btrim(p_filters->>'candidate') ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(btrim(p_filters->>'candidate'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'candidate'),'-',2))),'0') else p_filters->>'candidate' end)||'%'))
      and (coalesce(p_filters->>'requisition','')='' or concat_ws(' ',pg.group_position,array_to_string(ctx.doc_ids,' '),a.group_id,
        case when a.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(a.group_id,'-',2),greatest(5,length(split_part(a.group_id,'-',2))),'0') else a.group_id end) ilike ('%'||(case when btrim(p_filters->>'requisition') ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(btrim(p_filters->>'requisition'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'requisition'),'-',2))),'0') else p_filters->>'requisition' end)||'%'))
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
        a.group_id,case when a.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(a.group_id,'-',2),greatest(5,length(split_part(a.group_id,'-',2))),'0') else a.group_id end,
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

create or replace function public.app_recruitment_groups_page_v1(
  p_search text,p_filters jsonb,p_sort text,p_direction text,p_limit integer,p_cursor_value jsonb,p_cursor_id text,p_before boolean,p_count_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_sort text:=coalesce(nullif(p_sort,''),'attention'); v_dir text:=case when coalesce(nullif(p_sort,''),'attention') in ('attention','name','oldest') then 'asc' else lower(coalesce(p_direction,'desc')) end; v_scope text:=coalesce(p_filters->>'scope','ongoing'); v_cursor text:=p_cursor_value #>> '{}'; v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end); v_week_start date:=coalesce(nullif(p_filters->>'weekStart','')::date,(timezone('Asia/Bangkok',now())::date-((extract(dow from timezone('Asia/Bangkok',now()))::integer+1)%7)::integer));
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_scope not in ('ongoing','all') or v_sort not in ('attention','name','oldest') or v_dir not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('scope','group_id','exactGroupId','position','site','owner','doc_id','readiness','headerSite','headerPic','priorityOnly','weekStart')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if (p_cursor_value is null)<>(p_cursor_id is null) or (p_cursor_value is not null and jsonb_typeof(p_cursor_value)<>'string') or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with latest as (
    select distinct on(l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc
  ), app_rows as (
    select a.application_id,a.candidate_id,a.group_id,a.state,lat.recruitment_process,lat.result,lat.log_date,off.accepted_date,
      (a.state='active' and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) active
    from public.candidate_applications a left join latest lat on lat.application_id=a.application_id
    left join lateral(select min(o.accepted_date) accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(o.application_id)) off on true
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
  ), assignment_stats as (
    select x.group_id,count(distinct a.candidate_id)::integer candidate_count,
      count(distinct a.application_id) filter(where a.group_id=x.group_id and a.active)::integer active_count,
      count(distinct a.candidate_id) filter(where a.group_id=x.group_id and a.active and a.recruitment_process in ('Reference Check','Offer'))::integer late_count,
      count(distinct a.candidate_id) filter(where a.group_id=x.group_id and a.active and a.log_date is not null and timezone('Asia/Bangkok',now())::date-a.log_date>7)::integer aging_count
    from public.candidate_application_assignments x join app_rows a on a.application_id=x.application_id
    group by x.group_id
  ), base as not materialized (
    select g.group_id,g.group_position,g.created_at,g.updated_at,
      coalesce(links.sites,'{}'::text[]) sites,coalesce(links.owners,'{}'::text[]) owners,coalesce(links.doc_ids,'{}'::text[]) doc_ids,
      coalesce(links.open_headcount,0)::integer open_headcount,coalesce(stats.candidate_count,0)::integer candidate_count,
      coalesce(links.demand_count,0)::integer demand_count,coalesce(links.filled_count,0)::integer filled_count,coalesce(stats.active_count,0)::integer active_candidate_count,
      case when coalesce(links.open_req_count,0)=0 then null when coalesce(stats.candidate_count,0)=0 then 'No coverage' when coalesce(stats.late_count,0)>0 then 'Late-stage coverage' when coalesce(stats.aging_count,0)>0 then 'Aging coverage' when coalesce(stats.active_count,0)>0 then 'Active coverage' else 'Needs candidate' end readiness_label,
      case when coalesce(links.open_req_count,0)=0 then null when coalesce(stats.candidate_count,0)=0 then 0 when coalesce(stats.late_count,0)>0 then 4 when coalesce(stats.aging_count,0)>0 then 2 when coalesce(stats.active_count,0)>0 then 3 else 1 end readiness_rank,
      case when coalesce(links.open_req_count,0)=0 then 0 else links.open_req_count end readiness_count,case when coalesce(links.open_req_count,0)=0 then 0 else links.open_req_count end readiness_total,
      g.channel_fb channel_fb,g.channel_jobthai channel_jobthai,g.channel_jobtopgun channel_jobtopgun,g.channel_jobdb channel_jobdb,
      g.channel_jobbkk channel_jobbkk,g.channel_linkedin channel_linkedin,g.channel_walkin channel_walkin,g.channel_referral channel_referral,
      g.channel_others channel_others,selected.update latest_update,latest_saved.updated_at latest_saved_at,
      case when v_sort='name' then lower(g.group_position) when v_sort='oldest' then case when selected.update is null then '0|' else '1|'||to_char(selected.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
        else lpad(coalesce(case when coalesce(links.open_req_count,0)=0 then 5 else case when coalesce(stats.candidate_count,0)=0 then 0 when coalesce(stats.late_count,0)>0 then 4 when coalesce(stats.aging_count,0)>0 then 2 when coalesce(stats.active_count,0)>0 then 3 else 1 end end,5)::text,2,'0')||'|'||lpad((999999-coalesce(links.demand_count,0))::text,12,'0')||'|'||lower(g.group_position) end sort_value
    from public.position_groups g
    left join lateral (
      select array_agg(distinct r.site order by r.site) filter(where r.site is not null) sites,
        array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners,
        array_agg(distinct r.doc_id order by r.doc_id) doc_ids,
        sum(greatest(r.head_count-coalesce(ofr.accepted,0),0)) filter(where r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0) open_headcount,
        sum(r.head_count) filter(where r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0) demand_count,
        sum(least(r.head_count,coalesce(ofr.accepted,0))) filter(where r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0) filled_count,
        count(*) filter(where r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0)::integer open_req_count,
        bool_or(d.channel_fb) channel_fb,bool_or(d.channel_jobthai) channel_jobthai,bool_or(d.channel_jobtopgun) channel_jobtopgun,
        bool_or(d.channel_jobdb) channel_jobdb,bool_or(d.channel_jobbkk) channel_jobbkk,bool_or(d.channel_linkedin) channel_linkedin,
        bool_or(d.channel_walkin) channel_walkin,bool_or(d.channel_referral) channel_referral,bool_or(d.channel_others) channel_others
      from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id
      left join lateral(select count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')::integer accepted from public.offers o where o.doc_id=r.doc_id and app_private.can_read_application(o.application_id)) ofr on true
      where d.group_id=g.group_id and app_private.can_read_requisition(r.doc_id)
        and (v_scope='all' or r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0)
        and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
        and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
        and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
    ) links on true
    left join assignment_stats stats on stats.group_id=g.group_id
    left join lateral(select to_jsonb(u) update,u.updated_at from public.sourcing_weekly_updates u where u.group_id=g.group_id and u.week_start in (v_week_start,v_week_start+2) order by case when u.week_start=v_week_start then 0 else 1 end,u.updated_at desc limit 1) selected on true
    left join lateral(select max(u.updated_at) updated_at from public.sourcing_weekly_updates u where u.group_id=g.group_id) latest_saved on true
    where app_private.can_read_position_group(g.group_id) and cardinality(coalesce(links.doc_ids,'{}'::text[]))>0
      and (coalesce(p_filters->>'group_id','')='' or g.group_id ilike '%'||(case when btrim(p_filters->>'group_id') ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(btrim(p_filters->>'group_id'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'group_id'),'-',2))),'0') else p_filters->>'group_id' end)||'%' or
        (g.group_id ~* '^GRP-[0-9]+$' and ('GRP-'||lpad(split_part(g.group_id,'-',2),greatest(5,length(split_part(g.group_id,'-',2))),'0')) ilike '%'||(case when btrim(p_filters->>'group_id') ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(btrim(p_filters->>'group_id'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'group_id'),'-',2))),'0') else p_filters->>'group_id' end)||'%'))
      and (coalesce(p_filters->>'exactGroupId','')='' or g.group_id=p_filters->>'exactGroupId')
      and (coalesce(p_filters->>'position','')='' or g.group_position ilike '%'||(p_filters->>'position')||'%')
      and (coalesce(p_filters->>'site','')='' or array_to_string(links.sites,' ') ilike '%'||(p_filters->>'site')||'%')
      and (coalesce(p_filters->>'owner','')='' or array_to_string(links.owners,' ') ilike '%'||(p_filters->>'owner')||'%')
      and (coalesce(p_filters->>'doc_id','')='' or array_to_string(links.doc_ids,' ') ilike '%'||(p_filters->>'doc_id')||'%')
      and (coalesce(p_filters->>'readiness','')='' or case lower(p_filters->>'readiness') when 'linked' then cardinality(links.doc_ids)>0 else coalesce(case when coalesce(links.open_req_count,0)=0 then 'filled' when coalesce(stats.candidate_count,0)=0 then 'no coverage' when coalesce(stats.late_count,0)>0 then 'late-stage coverage' when coalesce(stats.aging_count,0)>0 then 'aging coverage' when coalesce(stats.active_count,0)>0 then 'active coverage' else 'needs candidate' end,'') ilike '%'||(p_filters->>'readiness')||'%' end)
      and (v_search='' or concat_ws(' ',g.group_id,
        case when g.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(g.group_id,'-',2),greatest(5,length(split_part(g.group_id,'-',2))),'0') else g.group_id end,
        array_to_string(array(select case when x ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(x,'-',2),greatest(5,length(split_part(x,'-',2))),'0') else x end from unnest(coalesce(links.doc_ids,'{}'::text[])) x),' '),
        g.group_position,links.sites,links.owners,links.doc_ids) ilike '%'||v_search||'%')
  ), filtered as (select * from base b where p_cursor_value is null or (not p_before and ((v_dir='asc' and (sort_value>v_cursor or sort_value=v_cursor and group_id>p_cursor_id)) or (v_dir='desc' and (sort_value<v_cursor or sort_value=v_cursor and group_id>p_cursor_id))) or (p_before and ((v_dir='asc' and (sort_value<v_cursor or sort_value=v_cursor and group_id<p_cursor_id)) or (v_dir='desc' and (sort_value>v_cursor or sort_value=v_cursor and group_id<p_cursor_id))))) ),
  page_raw as (select * from filtered order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then group_id end desc,case when not p_before then group_id end asc limit p_limit+1),
  page_rows as (select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then group_id end desc,case when not p_before then group_id end asc limit p_limit),
  edges as (select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,group_id asc))[1] first_sort,(array_agg(group_id order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,group_id asc))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,group_id desc))[1] last_sort,(array_agg(group_id order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,group_id desc))[1] last_id from page_rows),
  info as (select count(*)>p_limit extra from page_raw)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('group_id',p.group_id,'group_position',p.group_position,'sites',p.sites,'owners',p.owners,'doc_ids',p.doc_ids,'open_headcount',p.open_headcount,'candidate_count',p.candidate_count,'demand_count',p.demand_count,'filled_count',p.filled_count,'active_candidate_count',p.active_candidate_count,'readiness_label',p.readiness_label,'readiness_count',p.readiness_count,'readiness_total',p.readiness_total,'channel_fb',p.channel_fb,'channel_jobthai',p.channel_jobthai,'channel_jobtopgun',p.channel_jobtopgun,'channel_jobdb',p.channel_jobdb,'channel_jobbkk',p.channel_jobbkk,'channel_linkedin',p.channel_linkedin,'channel_walkin',p.channel_walkin,'channel_referral',p.channel_referral,'channel_others',p.channel_others,'latest_update',p.latest_update,'latest_saved_at',p.latest_saved_at) order by case when v_dir='asc' then p.sort_value end asc,case when v_dir='desc' then p.sort_value end desc,p.group_id) from page_rows p),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from base) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_sort,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_sort,'id',edges.first_id) else null end)
  into v_result from edges cross join info;
  return v_result;
end; $$;

create or replace function public.app_recruitment_sourcing_page_v1(
  p_search text,p_filters jsonb,p_sort text,p_direction text,p_limit integer,p_cursor_value jsonb,p_cursor_id text,p_before boolean,p_count_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_sort text:=coalesce(nullif(p_sort,''),'week'); v_dir text:=lower(coalesce(p_direction,'desc')); v_surface text:=coalesce(p_filters->>'surface','history'); v_week_start date:=nullif(p_filters->>'weekStart','')::date; v_cursor text:=p_cursor_value #>> '{}'; v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_surface not in ('board','history') or v_sort not in ('group','position','week','status','applicants','saved') or v_dir not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('surface','weekStart','from','to','group','position','week','status','applicants','saved','groupId','headerSite','headerPic','priorityOnly')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if (p_cursor_value is null)<>(p_cursor_id is null) or (p_cursor_value is not null and jsonb_typeof(p_cursor_value)<>'string') or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with group_bounds as not materialized (
    select d.group_id,min(r.pr_approved_date) first_approved,bool_and(r.status in ('filled','cancel')) all_terminal,
      max(case when r.status in ('filled','cancel') then coalesce((select max(l.log_date) from public.requisition_logs l where l.doc_id=r.doc_id and l.status in ('filled','cancel')),r.updated_at::date) end) terminal_day
    from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id
    where d.group_id is not null and app_private.can_read_requisition(r.doc_id)
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
      and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
      and app_private.can_read_sourcing_group(d.group_id)
    group by d.group_id
  ), bounds as (
    select group_id,
      coalesce(first_approved,timezone('Asia/Bangkok',now())::date)-((extract(dow from coalesce(first_approved,timezone('Asia/Bangkok',now())::date))::integer+1)%7) start_week,
      case when all_terminal then coalesce(terminal_day,timezone('Asia/Bangkok',now())::date)-((extract(dow from coalesce(terminal_day,timezone('Asia/Bangkok',now())::date))::integer+1)%7)
        else timezone('Asia/Bangkok',now())::date-((extract(dow from timezone('Asia/Bangkok',now()))::integer+1)%7) end end_week
    from group_bounds
  ), weeks as (
    select b.group_id,gs.week_start::date week_start from bounds b cross join lateral generate_series(b.start_week,b.end_week,interval '7 days') gs(week_start)
    where (v_surface<>'board' or (v_week_start is not null and gs.week_start::date=v_week_start))
      and (coalesce(p_filters->>'from','')='' or gs.week_start::date>=(p_filters->>'from')::date)
      and (coalesce(p_filters->>'to','')='' or gs.week_start::date<=(p_filters->>'to')::date)
  ), raw_rows as not materialized (
    select w.group_id,w.week_start,u.update,u.week_start update_week,
      coalesce((u.update->>'channel_fb')::boolean,(g.group_json->>'channel_fb')::boolean,false) fb,
      coalesce((u.update->>'channel_jobthai')::boolean,(g.group_json->>'channel_jobthai')::boolean,false) jobthai,
      coalesce((u.update->>'channel_jobtopgun')::boolean,(g.group_json->>'channel_jobtopgun')::boolean,false) jobtopgun,
      coalesce((u.update->>'channel_jobdb')::boolean,(g.group_json->>'channel_jobdb')::boolean,false) jobdb,
      coalesce((u.update->>'channel_jobbkk')::boolean,(g.group_json->>'channel_jobbkk')::boolean,false) jobbkk,
      coalesce((u.update->>'channel_linkedin')::boolean,(g.group_json->>'channel_linkedin')::boolean,false) linkedin,
      coalesce((u.update->>'channel_walkin')::boolean,(g.group_json->>'channel_walkin')::boolean,false) walkin,
      coalesce((u.update->>'channel_referral')::boolean,(g.group_json->>'channel_referral')::boolean,false) referral,
      coalesce((u.update->>'channel_others')::boolean,(g.group_json->>'channel_others')::boolean,false) others,
      g.group_json,
      g.group_json->>'group_position' group_position,
      coalesce((g.group_json->>'open_headcount')::integer,0) open_headcount,
      coalesce(g.group_json->'sites','[]'::jsonb) sites,coalesce(g.group_json->'owners','[]'::jsonb) owners,
      coalesce((u.update->>'applicants_fb')::integer,0) applicants_fb,coalesce((u.update->>'applicants_jobthai')::integer,0) applicants_jobthai,
      coalesce((u.update->>'applicants_jobtopgun')::integer,0) applicants_jobtopgun,coalesce((u.update->>'applicants_jobdb')::integer,0) applicants_jobdb,
      coalesce((u.update->>'applicants_jobbkk')::integer,0) applicants_jobbkk,coalesce((u.update->>'applicants_linkedin')::integer,0) applicants_linkedin,
      coalesce((u.update->>'applicants_walkin')::integer,0) applicants_walkin,coalesce((u.update->>'applicants_referral')::integer,0) applicants_referral,
      coalesce((u.update->>'applicants_others')::integer,0) applicants_others,
      coalesce(u.update->>'updated_at','') saved_at
    from weeks w
    left join lateral (select to_jsonb(x) update,x.week_start from public.sourcing_weekly_updates x where x.group_id=w.group_id and x.week_start in (w.week_start,w.week_start+2) and app_private.can_read_sourcing_group(x.group_id) order by case when x.week_start=w.week_start then 0 else 1 end,x.updated_at desc limit 1) u on true
    left join lateral (select item group_json from jsonb_array_elements(public.app_recruitment_groups_page_v1('',jsonb_build_object('scope','all','exactGroupId',w.group_id,'weekStart',w.week_start::text,'headerSite',coalesce(p_filters->>'headerSite',''),'headerPic',coalesce(p_filters->>'headerPic',''),'priorityOnly',coalesce((p_filters->>'priorityOnly')::boolean,false)),'name','asc',25,null,null,false,false)->'items') item limit 1) g on true
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
      and (coalesce(p_filters->>'status','') in ('','all') or s.status=p_filters->>'status')
      and (coalesce(p_filters->>'applicants','') in ('','all') or (p_filters->>'applicants'='has' and s.applicants>0) or (p_filters->>'applicants'='zero' and s.applicants=0) or (p_filters->>'applicants'='unknown' and s.applicants is null))
      and (coalesce(p_filters->>'saved','')='' or s.saved_at ilike '%'||(p_filters->>'saved')||'%')
      and (v_search='' or concat_ws(' ',s.group_id,
        case when s.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(s.group_id,'-',2),greatest(5,length(split_part(s.group_id,'-',2))),'0') else s.group_id end,
        s.group_position,s.week_start,s.status,s.applicants,s.saved_at,s.sites,s.owners) ilike '%'||v_search||'%')
      and (p_cursor_value is null or (not p_before and ((v_dir='asc' and (s.sort_value>v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)>p_cursor_id)) or (v_dir='desc' and (s.sort_value<v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)>p_cursor_id))) or (p_before and ((v_dir='asc' and (s.sort_value<v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)<p_cursor_id)) or (v_dir='desc' and (s.sort_value>v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)<p_cursor_id))))))
  ), page_raw as (select * from filtered order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then (group_id||'|'||week_start::text) end desc,case when not p_before then (group_id||'|'||week_start::text) end asc limit p_limit+1), page_rows as (select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then (group_id||'|'||week_start::text) end desc,case when not p_before then (group_id||'|'||week_start::text) end asc limit p_limit), edges as (select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,(group_id||'|'||week_start::text) asc))[1] first_sort,(array_agg((group_id||'|'||week_start::text) order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,(group_id||'|'||week_start::text) asc))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,(group_id||'|'||week_start::text) desc))[1] last_sort,(array_agg((group_id||'|'||week_start::text) order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,(group_id||'|'||week_start::text) desc))[1] last_id from page_rows), info as (select count(*)>p_limit extra from page_raw)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('group',p.group_json,'week_start',p.week_start,'update',p.update,'status',p.status) order by case when v_dir='asc' then p.sort_value end asc,case when v_dir='desc' then p.sort_value end desc,p.group_id,p.week_start) from page_rows p),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from filtered) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_sort,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_sort,'id',edges.first_id) else null end) into v_result from edges cross join info;
  return v_result;
end; $$;

create or replace function public.app_recruitment_sourcing_records_page_v1(
  p_search text,p_filters jsonb,p_sort text,p_direction text,p_limit integer,p_cursor_value jsonb,p_cursor_id text,p_before boolean,p_count_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_sort text:=coalesce(nullif(p_sort,''),'week'); v_dir text:=lower(coalesce(p_direction,'desc')); v_surface text:=coalesce(p_filters->>'surface','history'); v_week_start date:=nullif(p_filters->>'weekStart','')::date; v_cursor text:=p_cursor_value #>> '{}'; v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
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
      and (coalesce(p_filters->>'status','') in ('','all') or s.status=p_filters->>'status')
      and (coalesce(p_filters->>'applicants','') in ('','all') or (p_filters->>'applicants'='has' and s.applicants>0) or (p_filters->>'applicants'='zero' and s.applicants=0) or (p_filters->>'applicants'='unknown' and s.applicants is null))
      and (coalesce(p_filters->>'saved','')='' or s.saved_at ilike '%'||(p_filters->>'saved')||'%')
      and (v_search='' or concat_ws(' ',s.group_id,
        case when s.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(s.group_id,'-',2),greatest(5,length(split_part(s.group_id,'-',2))),'0') else s.group_id end,
        s.group_position,s.week_start,s.status,s.applicants,s.saved_at,s.sites,s.owners) ilike '%'||v_search||'%')
      and (p_cursor_value is null or (not p_before and ((v_dir='asc' and (s.sort_value>v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)>p_cursor_id)) or (v_dir='desc' and (s.sort_value<v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)>p_cursor_id))) or (p_before and ((v_dir='asc' and (s.sort_value<v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)<p_cursor_id)) or (v_dir='desc' and (s.sort_value>v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)<p_cursor_id))))))
  ), page_raw as (select * from filtered where not p_count_only order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then (group_id||'|'||week_start::text) end desc,case when not p_before then (group_id||'|'||week_start::text) end asc limit p_limit+1), page_rows as (select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then (group_id||'|'||week_start::text) end desc,case when not p_before then (group_id||'|'||week_start::text) end asc limit p_limit), edges as (select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,(group_id||'|'||week_start::text) asc))[1] first_sort,(array_agg((group_id||'|'||week_start::text) order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,(group_id||'|'||week_start::text) asc))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,(group_id||'|'||week_start::text) desc))[1] last_sort,(array_agg((group_id||'|'||week_start::text) order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,(group_id||'|'||week_start::text) desc))[1] last_id from page_rows), info as (select count(*)>p_limit extra from page_raw)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('group',jsonb_build_object('group_id',p.group_id,'group_position',p.group_position,'sites',p.sites,'owners',p.owners,'doc_ids',p.doc_ids,'open_headcount',p.open_headcount,'channel_fb',p.channel_fb,'channel_jobthai',p.channel_jobthai,'channel_jobtopgun',p.channel_jobtopgun,'channel_jobdb',p.channel_jobdb,'channel_jobbkk',p.channel_jobbkk,'channel_linkedin',p.channel_linkedin,'channel_walkin',p.channel_walkin,'channel_referral',p.channel_referral,'channel_others',p.channel_others,'latest_update',p.update),'week_start',p.week_start,'update',p.update,'status',p.status) order by case when v_dir='asc' then p.sort_value end asc,case when v_dir='desc' then p.sort_value end desc,p.group_id,p.week_start) from page_rows p),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from filtered) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_sort,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_sort,'id',edges.first_id) else null end) into v_result from edges cross join info;
  return v_result;
end; $$;

revoke all on function public.app_recruitment_sourcing_records_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.app_recruitment_sourcing_records_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) to authenticated;

create or replace function public.app_recruitment_offers_page_v1(
  p_search text,p_filters jsonb,p_sort text,p_direction text,p_limit integer,
  p_cursor_value jsonb,p_cursor_id text,p_before boolean,p_count_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_sort text:=coalesce(nullif(p_sort,''),'accepted'); v_dir text:=lower(coalesce(p_direction,'desc')); v_cursor text:=p_cursor_value #>> '{}'; v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end); v_home_tab text:=coalesce(p_filters->>'homeTab',''); v_today date:=coalesce(nullif(p_filters->>'today','')::date,timezone('Asia/Bangkok',now())::date);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
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
      and (coalesce(p_filters->>'status','')='' or (case when o.accepted_date is null then 'Pending' when o.start_confirmation='did_not_start' then 'Did not start' when o.start_confirmation='started' then 'Started' when o.first_working_date is null then 'Missing start date' else 'Accepted' end) ilike '%'||(p_filters->>'status')||'%')
      and (v_search='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),greatest(5,length(split_part(c.candidate_id,'-',2))),'0') else c.candidate_id end,
        c.name,c.nickname,o.doc_id,r.position,r.level,r.site,r.person_in_charge) ilike '%'||v_search||'%')
  ), filtered as (select * from source_rows s where (coalesce(p_filters->>'impact','')='' or (s.accepted_count::text||'/'||s.head_count::text) ilike '%'||(p_filters->>'impact')||'%') and (coalesce(p_filters->>'accepted','')='' or coalesce(s.accepted_date::text,'') ilike '%'||(p_filters->>'accepted')||'%') and (coalesce(p_filters->>'first_working','')='' or coalesce(s.first_working_date::text,'') ilike '%'||(p_filters->>'first_working')||'%') and (coalesce(p_filters->>'age','')='' or s.age_days::text ilike '%'||(p_filters->>'age')||'%')),
  cursor_rows as (select * from filtered f where p_cursor_value is null or
    (not p_before and ((v_dir='asc' and f.sort_value>v_cursor) or (v_dir='desc' and f.sort_value<v_cursor) or (f.sort_value=v_cursor and f.offer_id>p_cursor_id::bigint)))
    or (p_before and ((v_dir='asc' and f.sort_value<v_cursor) or (v_dir='desc' and f.sort_value>v_cursor) or (f.sort_value=v_cursor and f.offer_id<p_cursor_id::bigint)))),
  page_raw as (select * from cursor_rows order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then offer_id end desc,case when not p_before then offer_id end asc limit greatest(p_limit,0)+1), page_rows as (select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then offer_id end desc,case when not p_before then offer_id end asc limit greatest(p_limit,0)), info as(select count(*)>p_limit extra from page_raw), edges as(select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,offer_id))[1] first_value,(array_agg(offer_id::text order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,offer_id))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,offer_id desc))[1] last_value,(array_agg(offer_id::text order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,offer_id desc))[1] last_id from page_rows)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('offer_id',offer_id,'application_id',application_id,'candidate_id',candidate_id,'candidate_name',concat_ws(' ',name,nickname),'doc_id',doc_id,'accepted_date',accepted_date,'first_working_date',first_working_date,'start_confirmation',start_confirmation,'start_confirmed_at',start_confirmed_at,'start_confirmed_by',start_confirmed_by,'start_confirmation_reason',start_confirmation_reason,'remark',remark,'created_at',created_at,'updated_at',updated_at,'position',position,'level',level,'site',site,'person_in_charge',person_in_charge,'request_type',request_type,'head_count',head_count,'accepted_count',accepted_count,'status',status,'age_days',age_days) order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,offer_id) from page_rows),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from filtered) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_value,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_value,'id',edges.first_id) else null end) into v_result from edges cross join info;
  return v_result;
end; $$;

create or replace function public.app_recruitment_audit_page_v1(
  p_search text,p_filters jsonb,p_sort text,p_direction text,p_limit integer,
  p_cursor_value jsonb,p_cursor_id text,p_before boolean,p_count_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_dir text:=lower(coalesce(p_direction,'desc')); v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if coalesce(nullif(p_sort,''),'changed_at') not in ('changed_at','log_id') or v_dir not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('entity','action','changedBy','entityId','start','end')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or p_cursor_id !~ '^[0-9]+$') then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if (p_cursor_value is null)<>(p_cursor_id is null) or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with rows as not materialized (select l.*,case when coalesce(nullif(p_sort,''),'changed_at')='log_id' then lpad(l.log_id::text,20,'0') else to_char(l.changed_at at time zone 'Asia/Bangkok','YYYY-MM-DD HH24:MI:SS.US') end sort_value from public.change_logs l where app_private.can_read_candidate_audit(l.entity,l.entity_id,l.old_data,l.new_data)
    and (coalesce(p_filters->>'entity','')='' or l.entity ilike '%'||(p_filters->>'entity')||'%') and (coalesce(p_filters->>'action','')='' or l.action ilike '%'||(p_filters->>'action')||'%')
    and (coalesce(p_filters->>'changedBy','')='' or coalesce(l.changed_by_email,l.changed_by::text,'') ilike '%'||(p_filters->>'changedBy')||'%') and (coalesce(p_filters->>'entityId','')='' or l.entity_id ilike '%'||(case when btrim(p_filters->>'entityId') ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_filters->>'entityId'),'-',1))||'-'||lpad(split_part(btrim(p_filters->>'entityId'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'entityId'),'-',2))),'0') else p_filters->>'entityId' end)||'%' or
      (l.entity_id ~* '^(CAN|GRP)-[0-9]+$' and (upper(split_part(l.entity_id,'-',1))||'-'||lpad(split_part(l.entity_id,'-',2),greatest(5,length(split_part(l.entity_id,'-',2))),'0')) ilike '%'||(case when btrim(p_filters->>'entityId') ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_filters->>'entityId'),'-',1))||'-'||lpad(split_part(btrim(p_filters->>'entityId'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'entityId'),'-',2))),'0') else p_filters->>'entityId' end)||'%'))
    and (coalesce(p_filters->>'start','')='' or l.changed_at::date >= (p_filters->>'start')::date) and (coalesce(p_filters->>'end','')='' or l.changed_at::date <= (p_filters->>'end')::date)
    and (v_search='' or concat_ws(' ',l.entity,l.entity_id,
      case when l.entity_id ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(l.entity_id,'-',1))||'-'||lpad(split_part(l.entity_id,'-',2),greatest(5,length(split_part(l.entity_id,'-',2))),'0') else l.entity_id end,
      l.action,l.changed_by_email) ilike '%'||v_search||'%')),
  filtered as(select * from rows r where p_cursor_value is null or
    (not p_before and ((v_dir='asc' and r.sort_value>p_cursor_value#>>'{}') or (v_dir='desc' and r.sort_value<p_cursor_value#>>'{}') or (r.sort_value=p_cursor_value#>>'{}' and r.log_id>p_cursor_id::bigint)))
    or (p_before and ((v_dir='asc' and r.sort_value<p_cursor_value#>>'{}') or (v_dir='desc' and r.sort_value>p_cursor_value#>>'{}') or (r.sort_value=p_cursor_value#>>'{}' and r.log_id<p_cursor_id::bigint)))),
  page_raw as(select * from filtered order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then log_id end desc,case when not p_before then log_id end asc limit greatest(p_limit,0)+1),page_rows as(select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then log_id end desc,case when not p_before then log_id end asc limit greatest(p_limit,0)),info as(select count(*)>p_limit extra from page_raw),edges as(select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,log_id))[1] first_value,(array_agg(log_id::text order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,log_id))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,log_id desc))[1] last_value,(array_agg(log_id::text order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,log_id desc))[1] last_id from page_rows)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page_rows)-'sort_value' order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,log_id) from page_rows),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from filtered) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_value,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_value,'id',edges.first_id) else null end) into v_result from edges cross join info;
  return v_result;
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
  v_search text := lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
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
  if p_entity='position_groups' then
    return public.app_recruitment_groups_page_v1(p_search,p_filters,coalesce(nullif(p_sort,''),'attention'),p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='sourcing_records' then
    return public.app_recruitment_sourcing_records_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='sourcing' then
    return public.app_recruitment_sourcing_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='offers' then
    return public.app_recruitment_offers_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='audit_log' then
    return public.app_recruitment_audit_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='pipeline_stage' then
    return public.app_recruitment_applications_page_v1(p_search,coalesce(p_filters,'{}'::jsonb)||jsonb_build_object('activeBoard',true),coalesce(nullif(p_sort,''),'board_last_update'),case when nullif(p_sort,'') is null then 'asc' else p_direction end,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='candidate_applications' then
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
        when 'candidate_id' then case when b.candidate_id ~* '^CAN-[0-9]+$' then
          lower(split_part(b.candidate_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(b.candidate_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||
          coalesce(nullif(ltrim(split_part(b.candidate_id,'-',2),'0'),''),'0')||'-'||lower(b.candidate_id) else lower(b.candidate_id) end
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
  with eligible_applications as materialized (
    select a.* from public.candidate_applications a join public.candidates c on c.candidate_id=a.candidate_id
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and (p_group_id is null or a.group_id=p_group_id)
      and (coalesce(p_scope->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_scope->>'headerSite'))
      and (coalesce(p_scope->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_scope->>'headerPic'))))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))
  ), accepted_offers as materialized (
    select o.application_id,min(o.accepted_date) accepted_date from public.offers o
    join eligible_applications a on a.application_id=o.application_id
    where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start'
    group by o.application_id
  ), latest as (
    select distinct on(l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l join eligible_applications eligible on eligible.application_id=l.application_id where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc
  ), rows as (
    select a.application_id,a.group_id,a.state,coalesce(lat.recruitment_process,'No activity') stage,lat.result,lat.log_date,lat.outcome_date,
      off.accepted_date,
      (lat.log_date is not null and p_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) aging,
      (lat.application_id is null) no_activity,
      coalesce(lat.recruitment_process='Offer' and lat.result=1,false) passed_offer
    from eligible_applications a
    left join latest lat on lat.application_id=a.application_id
    left join accepted_offers off on off.application_id=a.application_id
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
