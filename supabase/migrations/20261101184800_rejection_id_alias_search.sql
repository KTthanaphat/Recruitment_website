begin;

create or replace function public.app_dashboard_rejection_summary_v1(p_start date,p_end date,p_scope jsonb default '{}'::jsonb,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end then raise exception 'REPORT_RANGE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels')) then raise exception 'REPORT_SCOPE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('actor','stage','main','detail','search'))
    or exists(select 1 from jsonb_each(coalesce(p_filters,'{}'::jsonb)) e where jsonb_typeof(e.value)<>'string') then raise exception 'REJECTION_FILTER_INVALID'; end if;
  with search_term as (select nullif(btrim(p_filters->>'search'),'') raw,
      case when btrim(coalesce(p_filters->>'search','')) ~* '^(CAN|GRP)-[0-9]+$'
        then lower(upper(split_part(btrim(p_filters->>'search'),'-',1))||'-'||lpad(split_part(btrim(p_filters->>'search'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'search'),'-',2))),'0')) end normalized_id),
  events as materialized (select * from app_private.dashboard_rejection_events_v1(p_start,p_end,coalesce(p_scope,'{}'::jsonb))),
  period_events as (select e.* from events e where e.scope_context and e.event_date between p_start and p_end),
  searchable as (select e.*,
      case when e.candidate_id ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(e.candidate_id,'-',1))||'-'||lpad(split_part(e.candidate_id,'-',2),greatest(5,length(split_part(e.candidate_id,'-',2))),'0') else e.candidate_id end display_candidate_id,
      case when e.group_id ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(e.group_id,'-',1))||'-'||lpad(split_part(e.group_id,'-',2),greatest(5,length(split_part(e.group_id,'-',2))),'0') else e.group_id end display_group_id
    from period_events e),
  filtered as (select e.* from searchable e cross join search_term q where (coalesce(p_filters->>'actor','')='' or e.actor=p_filters->>'actor') and (coalesce(p_filters->>'stage','')='' or e.stage=p_filters->>'stage')
    and (coalesce(p_filters->>'main','')='' or e.main_key=p_filters->>'main') and (coalesce((p_filters->>'detail'),'')='' or e.detail_key=(p_filters->>'detail'))
    and (q.raw is null or lower(e.candidate_name||' '||e.candidate_id||' '||coalesce(e.application_id::text,'')||' '||coalesce(e.group_id,'')||' '||coalesce((select string_agg(x.value->>'doc_id',' ') from jsonb_array_elements(e.requisitions) x(value)),'')) like '%'||lower(q.raw)||'%'
      or q.normalized_id is not null and (lower(e.candidate_id) like '%'||q.normalized_id||'%' or lower(e.display_candidate_id) like '%'||q.normalized_id||'%' or lower(e.group_id) like '%'||q.normalized_id||'%' or lower(e.display_group_id) like '%'||q.normalized_id||'%'))),
  comparison_base as (select e.* from searchable e cross join search_term q where (coalesce(p_filters->>'actor','')='' or e.actor=p_filters->>'actor') and (coalesce(p_filters->>'stage','')='' or e.stage=p_filters->>'stage')
    and (q.raw is null or lower(e.candidate_name||' '||e.candidate_id||' '||coalesce(e.application_id::text,'')||' '||coalesce(e.group_id,'')||' '||coalesce((select string_agg(x.value->>'doc_id',' ') from jsonb_array_elements(e.requisitions) x(value)),'')) like '%'||lower(q.raw)||'%'
      or q.normalized_id is not null and (lower(e.candidate_id) like '%'||q.normalized_id||'%' or lower(e.display_candidate_id) like '%'||q.normalized_id||'%' or lower(e.group_id) like '%'||q.normalized_id||'%' or lower(e.display_group_id) like '%'||q.normalized_id||'%'))),
  comparison_events as (select e.* from comparison_base e where coalesce(p_filters->>'main','')='' or e.main_key=p_filters->>'main'),
  selected_counts as (select count(*)::int total,count(distinct candidate_id)::int people,count(distinct coalesce(application_id::text,'legacy:'||candidate_id))::int applications,
    count(*) filter(where actor='company')::int company,count(*) filter(where actor='candidate')::int candidate,count(*) filter(where actor='unclassified')::int unclassified from filtered),
  actor_rows as (select actor,count(*)::int n from filtered group by actor),
  main_reasons as (select main_key key,actor,min(main_en) en,min(main_th) th,count(*)::int n from filtered group by main_key,actor),
  detail_reasons as (select detail_key key,actor,min(detail_en) en,min(detail_th) th,count(*)::int n from filtered group by detail_key,actor),
  main_options as (select main_key key,actor,min(main_en) en,min(main_th) th,count(*)::int n from period_events where coalesce(p_filters->>'actor','')='' or actor=p_filters->>'actor' group by main_key,actor),
  detail_options as (select detail_key key,actor,min(detail_en) en,min(detail_th) th,count(*)::int n from period_events where main_key=coalesce(p_filters->>'main','') and (coalesce(p_filters->>'actor','')='' or actor=p_filters->>'actor') group by detail_key,actor),
  comparison_reasons as (select case when coalesce(p_filters->>'main','')='' then main_key else detail_key end key,actor,
      min(case when coalesce(p_filters->>'main','')='' then main_en else detail_en end) en,min(case when coalesce(p_filters->>'main','')='' then main_th else detail_th end) th,count(*)::int n
    from comparison_events group by 1,actor),
  stage_names as (select stage,case stage when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 7 end ord from (select unnest(array['Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer']) stage union select distinct stage from period_events) s),
  stage_counts as (select n.stage,n.ord,count(f.*)::int total,count(*) filter(where f.actor='company')::int company,count(*) filter(where f.actor='candidate')::int candidate,count(*) filter(where f.actor='unclassified')::int unclassified from stage_names n left join filtered f on f.stage=n.stage group by n.stage,n.ord),
  stage_options as (select coalesce(jsonb_agg(stage order by ord,stage),'[]'::jsonb) rows from (select stage,min(case stage when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 7 end) ord from period_events group by stage) x),
  bounds as (select case when p_end-p_start+1<=31 then 'daily' when p_end-p_start+1<=120 then 'weekly' else 'monthly' end granularity),
  starts as (select d::date start_date,b.granularity from generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d cross join bounds b
    where d::date=p_start or (b.granularity='weekly' and extract(dow from d)=6) or (b.granularity='monthly' and extract(day from d)=1)),
  buckets as (select s.start_date,coalesce(lead(s.start_date) over(order by s.start_date)-1,p_end) end_date from starts s),
  trends as (select b.start_date,b.end_date,count(f.*)::int total,count(*) filter(where f.actor='company')::int company,count(*) filter(where f.actor='candidate')::int candidate,count(*) filter(where f.actor='unclassified')::int unclassified
    from buckets b left join filtered f on f.event_date between b.start_date and b.end_date group by b.start_date,b.end_date),
  reason_json as (select source,coalesce(jsonb_agg(jsonb_build_object('key',key,'label',jsonb_build_object('en',en,'th',th),'count',n,'share',case when denom>0 then n::numeric/denom else 0 end,'actor',actor) order by n desc,key),'[]'::jsonb) rows
    from (select 'main' source,r.*, (select total from selected_counts) denom from main_reasons r union all select 'detail',r.*,(select total from selected_counts) from detail_reasons r
      union all select 'mainOptions',r.*,(select count(*) from period_events where coalesce(p_filters->>'actor','')='' or actor=p_filters->>'actor') from main_options r
      union all select 'detailOptions',r.*,(select count(*) from period_events where main_key=coalesce(p_filters->>'main','') and (coalesce(p_filters->>'actor','')='' or actor=p_filters->>'actor')) from detail_options r
      union all select 'comparison',r.*,(select count(*) from comparison_events) from comparison_reasons r) q group by source),
  active_stages as (select coalesce(jsonb_agg(jsonb_build_object('stage',stage,'count',total,'company',company,'candidate',candidate,'unclassified',unclassified) order by ord,stage),'[]'::jsonb) rows from stage_counts),
  trend_json as (select coalesce(jsonb_agg(jsonb_build_object('start',start_date,'end',end_date,'count',total,'company',company,'candidate',candidate,'unclassified',unclassified) order by start_date),'[]'::jsonb) rows from trends)
  select jsonb_build_object('range',jsonb_build_object('start',p_start,'end',p_end),'total',c.total,'people',c.people,'applications',c.applications,
    'actors',jsonb_build_object('company',c.company,'candidate',c.candidate,'unclassified',c.unclassified),'periodTotal',(select count(*) from period_events),
    'diagnostics',jsonb_build_object('undated',(select count(*) from events where undated and scope_context),'unresolvedContext',(select count(*) from events where unresolved_context and (undated or event_date between p_start and p_end))),
    'stages',s.rows,'stageOptions',(select rows from stage_options),'trends',t.rows,'granularity',(select granularity from bounds),
    'mainReasons',coalesce((select rows from reason_json where source='main'),'[]'::jsonb),'detailedReasons',coalesce((select rows from reason_json where source='detail'),'[]'::jsonb),
    'mainOptions',coalesce((select rows from reason_json where source='mainOptions'),'[]'::jsonb),'detailOptions',coalesce((select rows from reason_json where source='detailOptions'),'[]'::jsonb),
    'comparison',jsonb_build_object('total',(select count(*) from comparison_events),'level',case when coalesce(p_filters->>'main','')='' then 'main' else 'detail' end,
      'reasons',coalesce((select rows from reason_json where source='comparison'),'[]'::jsonb),'main',coalesce(p_filters->>'main',''),
      'label',(select jsonb_build_object('en',main_en,'th',main_th) from period_events where main_key=p_filters->>'main' limit 1),'selected',coalesce((p_filters->>'detail'),'')))
  into v_result from selected_counts c cross join active_stages s cross join trend_json t;
  return v_result;
end $$;
revoke all on function public.app_dashboard_rejection_summary_v1(date,date,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.app_dashboard_rejection_summary_v1(date,date,jsonb,jsonb) to authenticated;

create or replace function public.app_dashboard_rejection_page_v1(p_start date,p_end date,p_scope jsonb default '{}'::jsonb,p_filters jsonb default '{}'::jsonb,p_sort text default 'date-desc',p_after_value text default null,p_after_log_id bigint default null,p_limit integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_events jsonb;v_total integer;v_has_more boolean;v_cursor jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_limit is null or p_limit not between 1 and 100 then raise exception 'REJECTION_PAGE_INVALID'; end if;
  if p_sort is null or p_sort not in ('date-desc','date-asc','candidate-asc','stage-asc') then raise exception 'REJECTION_SORT_INVALID'; end if;
  if (p_after_value is null)<>(p_after_log_id is null) then raise exception 'REJECTION_CURSOR_INVALID'; end if;
  with search_term as (select nullif(btrim(p_filters->>'search'),'') raw,
      case when btrim(coalesce(p_filters->>'search','')) ~* '^(CAN|GRP)-[0-9]+$'
        then lower(upper(split_part(btrim(p_filters->>'search'),'-',1))||'-'||lpad(split_part(btrim(p_filters->>'search'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'search'),'-',2))),'0')) end normalized_id),
  events as materialized (select * from app_private.dashboard_rejection_events_v1(p_start,p_end,coalesce(p_scope,'{}'::jsonb))),
  period_events as (select e.* from events e where e.scope_context and e.event_date between p_start and p_end),
  searchable as (select e.*,
      case when e.candidate_id ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(e.candidate_id,'-',1))||'-'||lpad(split_part(e.candidate_id,'-',2),greatest(5,length(split_part(e.candidate_id,'-',2))),'0') else e.candidate_id end display_candidate_id,
      case when e.group_id ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(e.group_id,'-',1))||'-'||lpad(split_part(e.group_id,'-',2),greatest(5,length(split_part(e.group_id,'-',2))),'0') else e.group_id end display_group_id
    from period_events e),
  filtered as (select e.*,case p_sort when 'date-desc' then e.event_date::text when 'date-asc' then e.event_date::text when 'candidate-asc' then lower(e.candidate_name) else lower(e.stage) end sort_value
    from searchable e cross join search_term q where (coalesce(p_filters->>'actor','')='' or e.actor=p_filters->>'actor') and (coalesce(p_filters->>'stage','')='' or e.stage=p_filters->>'stage')
      and (coalesce(p_filters->>'main','')='' or e.main_key=p_filters->>'main') and (coalesce((p_filters->>'detail'),'')='' or e.detail_key=(p_filters->>'detail'))
      and (q.raw is null or lower(e.candidate_name||' '||e.candidate_id||' '||coalesce(e.application_id::text,'')||' '||coalesce(e.group_id,'')||' '||coalesce((select string_agg(x.value->>'doc_id',' ') from jsonb_array_elements(e.requisitions) x(value)),'')) like '%'||lower(q.raw)||'%'
        or q.normalized_id is not null and (lower(e.candidate_id) like '%'||q.normalized_id||'%' or lower(e.display_candidate_id) like '%'||q.normalized_id||'%' or lower(e.group_id) like '%'||q.normalized_id||'%' or lower(e.display_group_id) like '%'||q.normalized_id||'%'))),
  matched as (select f.*,count(*) over()::int total_count from filtered f),
  page as (select * from matched f where p_after_value is null or
      (p_sort='date-desc' and (f.sort_value<p_after_value or f.sort_value=p_after_value and f.log_id<p_after_log_id)) or
      (p_sort<>'date-desc' and (f.sort_value>p_after_value or f.sort_value=p_after_value and f.log_id<p_after_log_id))
      order by case when p_sort='date-desc' then f.event_date end desc,case when p_sort='date-asc' then f.event_date end asc,
        case when p_sort='candidate-asc' then f.sort_value end asc,case when p_sort='stage-asc' then f.sort_value end asc,f.log_id desc limit p_limit+1),
  limited as (select * from page order by case when p_sort='date-desc' then event_date end desc,case when p_sort='date-asc' then event_date end asc,
      case when p_sort='candidate-asc' then sort_value end asc,case when p_sort='stage-asc' then sort_value end asc,log_id desc limit p_limit)
  select coalesce((select jsonb_agg(jsonb_build_object('id',event_id,'logId',log_id,'applicationId',application_id,'candidateId',candidate_id,'name',candidate_name,'groupId',group_id,'position',position_name,'date',event_date,'stage',stage,'round',round,'actor',actor,'mainKey',main_key,'detailKey',detail_key,'main',jsonb_build_object('en',main_en,'th',main_th),'detail',jsonb_build_object('en',detail_en,'th',detail_th),'requisitions',requisitions) order by case when p_sort='date-desc' then event_date end desc,case when p_sort='date-asc' then event_date end asc,case when p_sort='candidate-asc' then sort_value end asc,case when p_sort='stage-asc' then sort_value end asc,log_id desc) from limited),'[]'::jsonb),coalesce((select max(total_count) from matched),0),exists(select 1 from page offset p_limit),
    (select jsonb_build_object('value',sort_value,'logId',log_id) from limited order by case when p_sort='date-desc' then event_date end asc,case when p_sort='date-asc' then event_date end desc,case when p_sort='candidate-asc' then sort_value end desc,case when p_sort='stage-asc' then sort_value end desc,log_id asc limit 1)
    into v_events,v_total,v_has_more,v_cursor;
  if v_has_more and v_cursor is null then raise exception 'REJECTION_CURSOR_INVALID'; end if;
  return jsonb_build_object('events',v_events,'total',v_total,'hasMore',v_has_more,'nextCursor',case when v_has_more then v_cursor else null end);
end $$;
revoke all on function public.app_dashboard_rejection_page_v1(date,date,jsonb,jsonb,text,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.app_dashboard_rejection_page_v1(date,date,jsonb,jsonb,text,text,bigint,integer) to authenticated;

commit;
