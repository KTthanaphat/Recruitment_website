-- Additive correction for the application stage board endpoint.
-- Generated from supabase/schemas/60_recruitment_list.sql; preserves existing function ACLs.
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
      coalesce(lat.recruitment_process='Offer' and lat.result=1,false) as passed_offer,
      jsonb_build_object('candidate_id',c.candidate_id,'name',c.name,'nickname',c.nickname,'phone_no',c.phone_no,'email',c.email,'home_site',c.home_site,
        'created_by',c.created_by,'responsible_recruiter_id',c.responsible_recruiter_id,'doc_group_id',c.doc_group_id,'ref_name',c.ref_name,'candidate_folder_url',c.candidate_folder_url,
        'first_contact_date',c.first_contact_date,'channel',c.channel,'updated_at',c.updated_at,'created_at',a.created_at,
        'application_id',a.application_id,'application_state',a.state,'group_id',a.group_id,'doc_ids',coalesce(ctx.doc_ids,'{}'::text[]),
        'doc_id',array_to_string(ctx.doc_ids,', '),'group_position',pg.group_position,'sites',coalesce(ctx.sites,'{}'::text[]),
        'person_in_charges',coalesce(ctx.owners,'{}'::text[]),'site',array_to_string(ctx.sites,', '),
        'person_in_charge',array_to_string(ctx.owners,', '),'latest_process',coalesce(lat.recruitment_process,'No activity'),
        'latest_result',lat.result,'latest_log_date',lat.log_date,'accepted_date',off.accepted_date,
        'home_last_touch_date',coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end),'home_pending_remark',(select l2.remark from public.recruitment_logs l2 where l2.application_id=a.application_id and l2.superseded_at is null and l2.superseded_by_stage_instance_id is null and l2.result is null order by case l2.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l2.round desc,l2.log_id desc limit 1)) as item
    from public.candidate_applications a
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
    where case when v_global_reader then true else app_private.can_read_application(a.application_id) end and case when v_global_reader then true else app_private.can_read_candidate(a.candidate_id) end
      and (coalesce(p_filters->>'candidateId','')='' or c.candidate_id=p_filters->>'candidateId')
      and (v_group='' or a.group_id=v_group)
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))
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
  ), page_keys as (select * from page_raw order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,case when p_before then application_id end desc,case when not p_before then application_id end asc limit p_limit
  ), page_rows as (select k.application_id,k.sort_value,r.item from page_keys k join app_rows r using(application_id)), edges as (
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