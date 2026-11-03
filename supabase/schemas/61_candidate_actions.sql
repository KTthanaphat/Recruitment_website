-- Additive committed candidate receipts and bounded destination location.
create or replace function app_private.candidate_action_cards_v1(p_application_ids uuid[],p_as_of date default current_date) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_search text := '';
  v_sort text := 'board_last_update';
  v_direction text := 'asc';
  v_stage text := coalesce('{}'::jsonb->>'stage','');
  v_board text := coalesce('{}'::jsonb->>'boardFilter','all');
  v_group text := coalesce('{}'::jsonb->>'groupId','');
  v_since date;
  v_embedded_all_time boolean := coalesce(('{}'::jsonb->>'embeddedAllTime')::boolean,false);
  v_home_tab text := coalesce('{}'::jsonb->>'homeTab','');
  v_active_board boolean := coalesce(('{}'::jsonb->>'activeBoard')::boolean,false);
  v_as_of date := coalesce(p_as_of,current_date);
  v_global_reader boolean := app_private.is_global_recruitment_reader();
  v_cursor text;
  v_result jsonb; p_search text:=''; p_filters jsonb:='{}'; p_sort text:='board_last_update'; p_direction text:='asc';
begin
if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  with eligible_applications as materialized (
    select a.* from public.candidate_applications a
    where case when v_global_reader then true else app_private.can_read_application(a.application_id) end and case when v_global_reader then true else app_private.can_read_candidate(a.candidate_id) end
      and (coalesce(p_filters->>'candidateId','')='' or a.candidate_id=p_filters->>'candidateId')
      and (v_group='' or a.group_id=v_group)
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))

      and a.application_id=any(p_application_ids)
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

  ) select coalesce(jsonb_agg(item||jsonb_build_object(
 'has_readable_offer',exists(select 1 from public.offers o where o.candidate_id=app_rows.candidate_id and app_private.can_read_application(o.application_id)),
 'has_priority_requisition',exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=app_rows.group_id and r.is_priority))),'[]'::jsonb) into v_result from app_rows;
return v_result; end; $$;
revoke all on function app_private.candidate_action_cards_v1(uuid[],date) from public,anon;
grant execute on function app_private.candidate_action_cards_v1(uuid[],date) to authenticated;

-- Authorized board position; never returns records outside the supplied criteria.
create or replace function public.app_pipeline_card_location_v1(p_application_id uuid,p_search text default '',p_filters jsonb default '{}'::jsonb,p_sort text default 'board_last_update',p_direction text default 'asc') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
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
  v_cursor text;
  v_result jsonb;
  p_limit integer := 25; p_count_only boolean := false; p_before boolean := false;
  p_cursor_value jsonb := null; p_cursor_id text := null;
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

  ), ranked as (
 select application_id,sort_value,row_number() over(order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,application_id asc)-1 position from app_rows
), target as (select * from ranked where application_id=p_application_id)
select jsonb_build_object('application_id',target.application_id,'offset',target.position%25,'page',target.position/5+1,'block',target.position/25,
 'cursor',(select jsonb_build_object('value',sort_value,'id',application_id::text) from ranked where position=(target.position/25)*25-1)) into v_result from target;
return coalesce(v_result,jsonb_build_object('excluded',true));
end; $$;
revoke all on function public.app_pipeline_card_location_v1(uuid,text,jsonb,text,text) from public,anon;
grant execute on function public.app_pipeline_card_location_v1(uuid,text,jsonb,text,text) to authenticated;

-- Static dispatch preserves every existing validation, audit, concurrency and offer handoff.
create or replace function public.app_candidate_action_v1(p_operation text,p_payload jsonb,p_request_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 v_result jsonb; v_candidate text:=nullif(p_payload->>'candidate_id','');
 v_ids uuid[]; v_before_ids uuid[]; v_source_groups text[]; v_source_stages text[]; v_source_docs text[]; v_removed uuid[];
 v_projection jsonb; v_cards jsonb; v_apps jsonb; v_logs jsonb; v_assignments jsonb; v_notes jsonb; v_references jsonb;
 v_effects text[];
begin
 if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'CANDIDATE_ACTION_INVALID'; end if;
 if p_operation not in ('app_start_pipeline_stage_v2','app_update_pipeline_pending_v2','app_complete_pipeline_stage_v2','app_pass_pipeline_jump_v2','app_correct_pipeline_stage_record_v3','app_upsert_candidate_profile_v2','app_upsert_candidate_note_v2','app_create_candidate_application_v1','app_transfer_candidate_application_v1') then raise exception 'CANDIDATE_ACTION_OPERATION_INVALID'; end if;
 if v_candidate is null and nullif(p_payload->>'application_id','') is not null then
  select candidate_id into v_candidate from public.candidate_applications where application_id=(p_payload->>'application_id')::uuid;
 end if;
 select coalesce(array_agg(application_id),'{}'),coalesce(array_agg(distinct group_id),'{}') into v_before_ids,v_source_groups
 from public.candidate_applications where candidate_id=v_candidate and (nullif(p_payload->>'application_id','') is null or application_id=(p_payload->>'application_id')::uuid)
 and app_private.can_read_application(application_id);
 select coalesce(array_agg(distinct d.doc_id),'{}') into v_source_docs from public.document_groups d where d.group_id=any(v_source_groups);
 select coalesce(array_agg(distinct coalesce(lat.recruitment_process,'No activity')),'{}') into v_source_stages
 from unnest(v_before_ids) id left join lateral (
 select recruitment_process from public.recruitment_logs l where l.application_id=id and l.superseded_at is null and l.superseded_by_stage_instance_id is null
 order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1
 ) lat on true;
 case p_operation
 when 'app_start_pipeline_stage_v2' then v_result:=public.app_start_pipeline_stage_v2(p_payload);
 when 'app_update_pipeline_pending_v2' then v_result:=public.app_update_pipeline_pending_v2(p_payload);
 when 'app_complete_pipeline_stage_v2' then v_result:=public.app_complete_pipeline_stage_v2(p_payload);
 when 'app_pass_pipeline_jump_v2' then v_result:=public.app_pass_pipeline_jump_v2(p_payload);
 when 'app_correct_pipeline_stage_record_v3' then v_result:=public.app_correct_pipeline_stage_record_v3(p_payload);
 when 'app_upsert_candidate_profile_v2' then v_result:=public.app_upsert_candidate_profile_v2(p_payload);
 when 'app_upsert_candidate_note_v2' then v_result:=public.app_upsert_candidate_note_v2(p_payload);
 when 'app_create_candidate_application_v1' then v_result:=public.app_create_candidate_application_v1(p_payload);
 when 'app_transfer_candidate_application_v1' then v_result:=public.app_transfer_candidate_application_v1(p_payload);
 else raise exception 'CANDIDATE_ACTION_OPERATION_INVALID'; end case;
 if coalesce((v_result->>'ok')::boolean,false) is not true or v_result ? 'error' then return v_result; end if;
 v_candidate:=coalesce(v_result->>'candidate_id',v_candidate,v_result->>'id');
 select coalesce(array_agg(distinct id),'{}') into v_ids from (
  select unnest(v_before_ids) id union select nullif(v_result->>'application_id','')::uuid
  union select application_id from public.candidate_applications where candidate_id=v_candidate and p_operation in ('app_upsert_candidate_profile_v2','app_upsert_candidate_note_v2') and app_private.can_read_application(application_id)
 ) ids where id is not null;
 select coalesce(array_agg(id),'{}') into v_removed from unnest(v_ids) id where not app_private.can_read_application(id);
 v_projection:=public.app_candidate_profile_detail_v1(v_candidate);
 v_cards:=app_private.candidate_action_cards_v1(v_ids);
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into v_apps from public.candidate_applications a where application_id=any(v_ids) and app_private.can_read_application(application_id);
 select coalesce(jsonb_agg(to_jsonb(l)),'[]') into v_logs from public.recruitment_logs l where application_id=any(v_ids) and app_private.can_read_application(application_id);
 select coalesce(jsonb_agg(to_jsonb(a)),'[]') into v_assignments from public.candidate_application_assignments a where application_id=any(v_ids) and app_private.can_read_application(application_id);
 select coalesce(jsonb_agg(to_jsonb(n)),'[]') into v_notes from public.candidate_notes n where candidate_id=v_candidate and app_private.can_read_candidate(v_candidate);
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into v_references from public.candidate_references r where candidate_id=v_candidate and app_private.can_read_candidate(v_candidate);
 v_effects:=case
 when p_operation='app_upsert_candidate_note_v2' then array['detail','audit']
 when p_operation='app_upsert_candidate_profile_v2' and nullif(v_result->>'application_id','') is null then array['registry','records','detail','audit']
 when p_operation='app_update_pipeline_pending_v2' then array['records','detail','calendar','metrics','audit']
 else array['records','detail','counts','summary','calendar','reports','audit'] end;
 return v_result||jsonb_build_object('action_result',jsonb_build_object('version',1,'request_id',p_request_id,'operation',p_operation,'candidate_id',v_candidate,
  'application_ids',v_ids,'context',jsonb_build_object(
 'groups',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from public.position_groups g where exists(select 1 from jsonb_array_elements(v_apps) a where a->>'group_id'=g.group_id)),
 'links',(select coalesce(jsonb_agg(to_jsonb(d)),'[]') from public.document_groups d where exists(select 1 from jsonb_array_elements(v_apps) a where a->>'group_id'=d.group_id)),
 'requisitions',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.requisitions r where exists(select 1 from public.document_groups d where d.doc_id=r.doc_id and exists(select 1 from jsonb_array_elements(v_apps) a where a->>'group_id'=d.group_id)))),
 'profile',v_projection,'cards',v_cards,'applications',v_apps,'history',v_logs,'assignments',v_assignments,'notes',v_notes,'references',v_references,
  'removed_applications',v_removed,'source_docs',v_source_docs,'source_stages',v_source_stages,'source_groups',v_source_groups,'groups',(select coalesce(jsonb_agg(distinct a->>'group_id'),'[]') from jsonb_array_elements(v_apps) a),'effects',v_effects));
end; $$;
revoke all on function public.app_candidate_action_v1(text,jsonb,uuid) from public,anon;
grant execute on function public.app_candidate_action_v1(text,jsonb,uuid) to authenticated;
