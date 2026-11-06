begin;

create or replace function app_private.dashboard_rejection_events_v1(p_start date,p_end date,p_scope jsonb,p_include_undated boolean)
returns table(event_id text,log_id bigint,application_id uuid,candidate_id text,candidate_name text,group_id text,position_name text,event_date date,stage text,round integer,actor text,main_key text,detail_key text,main_en text,main_th text,detail_en text,detail_th text,requisitions jsonb,scope_context boolean,unresolved_context boolean,undated boolean)
language sql stable security invoker set search_path = '' as $$
with failure_logs as materialized (
  select l.*,d.failure_date from public.recruitment_logs l
  cross join lateral (select case when l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and l.stage_instance_id is not null then l.outcome_date else coalesce(l.outcome_date,l.log_date) end as failure_date) d
  where (d.failure_date between p_start and p_end or (p_include_undated and d.failure_date is null))
    and l.result=0 and l.superseded_at is null and l.superseded_by_stage_instance_id is null
), needed_candidate_ids as materialized (
  select distinct candidate_id from failure_logs
), authorized_candidates as materialized (
  select c.candidate_id,c.name,c.group_id,c.doc_group_id
  from public.candidates c join needed_candidate_ids n using(candidate_id)
  where app_private.can_read_candidate(c.candidate_id)
), needed_application_ids as materialized (
  select distinct application_id,candidate_id from failure_logs where application_id is not null
), authorized_applications as materialized (
  select a.application_id,a.candidate_id,a.group_id
  from public.candidate_applications a join needed_application_ids n using(application_id,candidate_id)
  where app_private.can_read_application(a.application_id)
), assignment_history as materialized (
  select a.application_id from authorized_applications a
  where exists (select 1 from public.candidate_application_assignments h where h.application_id=a.application_id)
), failures as (
  select l.*,c.name candidate_name,a.group_id application_group,
    case when l.outcome_assignment_id is not null then assignment.group_id
      when history.application_id is not null then null
      else coalesce(a.group_id,c.group_id,(select dg.group_id from public.document_groups dg where dg.doc_group_id=c.doc_group_id limit 1)) end resolved_group,
    case when l.failure_actor in ('company','candidate') then l.failure_actor else 'unclassified' end normalized_actor,
    case when nullif(btrim(l.failure_reason_snapshot->>'main_en'),'') is not null or nullif(btrim(l.failure_reason_snapshot->>'main_th'),'') is not null then coalesce(nullif(l.failure_reason_snapshot->>'main_en',''),l.failure_reason_snapshot->>'main_th') else 'Unclassified reason' end normalized_main_en,
    case when nullif(btrim(l.failure_reason_snapshot->>'main_en'),'') is not null or nullif(btrim(l.failure_reason_snapshot->>'main_th'),'') is not null then coalesce(nullif(l.failure_reason_snapshot->>'main_th',''),l.failure_reason_snapshot->>'main_en') else 'ไม่ได้ระบุเหตุผล' end normalized_main_th,
    case when nullif(btrim(l.failure_reason_snapshot->>'detail_en'),'') is not null or nullif(btrim(l.failure_reason_snapshot->>'detail_th'),'') is not null then coalesce(nullif(l.failure_reason_snapshot->>'detail_en',''),l.failure_reason_snapshot->>'detail_th') else 'Unclassified reason' end normalized_detail_en,
    case when nullif(btrim(l.failure_reason_snapshot->>'detail_en'),'') is not null or nullif(btrim(l.failure_reason_snapshot->>'detail_th'),'') is not null then coalesce(nullif(l.failure_reason_snapshot->>'detail_th',''),l.failure_reason_snapshot->>'detail_en') else 'ไม่ได้ระบุเหตุผล' end normalized_detail_th,
    case when l.failure_reason_snapshot is null or (nullif(btrim(l.failure_reason_snapshot->>'main_en'),'') is null and nullif(btrim(l.failure_reason_snapshot->>'main_th'),'') is null) then to_jsonb('unclassified'::text)
      when l.failure_main_reason_id is not null then to_jsonb(l.failure_main_reason_id::text)
      else jsonb_build_array(coalesce(nullif(l.failure_reason_snapshot->>'main_en',''),l.failure_reason_snapshot->>'main_th'),coalesce(nullif(l.failure_reason_snapshot->>'main_th',''),l.failure_reason_snapshot->>'main_en')) end main_value,
    case when l.failure_reason_snapshot is null or (nullif(btrim(l.failure_reason_snapshot->>'detail_en'),'') is null and nullif(btrim(l.failure_reason_snapshot->>'detail_th'),'') is null) then to_jsonb('unclassified'::text)
      when l.failure_detail_reason_id is not null then to_jsonb(l.failure_detail_reason_id::text)
      else jsonb_build_array(coalesce(nullif(l.failure_reason_snapshot->>'detail_en',''),l.failure_reason_snapshot->>'detail_th'),coalesce(nullif(l.failure_reason_snapshot->>'detail_th',''),l.failure_reason_snapshot->>'detail_en')) end detail_value
  from failure_logs l join authorized_candidates c on c.candidate_id=l.candidate_id
  left join authorized_applications a on a.application_id=l.application_id and a.candidate_id=l.candidate_id
  left join assignment_history history on history.application_id=l.application_id
  left join public.candidate_application_assignments assignment on assignment.assignment_id=l.outcome_assignment_id and assignment.application_id=l.application_id
  where l.application_id is null or a.application_id is not null
), keyed as (
  select f.*,coalesce(f.application_id::text,f.candidate_id)||':'||coalesce(f.stage_instance_id::text,'legacy-'||f.log_id::text) event_id,
    app_private.dashboard_json_compact_v1(jsonb_build_array(normalized_actor,main_value)) main_key,
    app_private.dashboard_json_compact_v1(jsonb_build_array(app_private.dashboard_json_compact_v1(jsonb_build_array(normalized_actor,main_value)),detail_value)) detail_key
  from failures f
), failure_groups as materialized (
  select distinct resolved_group from failures where resolved_group is not null
), group_links as materialized (
  select dg.group_id,dg.doc_id from failure_groups g join public.document_groups dg on dg.group_id=g.resolved_group
), scoped_requisitions as materialized (
  select r.doc_id,r.site,r.department,r.position,r.person_in_charge,r.level,r.is_priority
  from (select distinct doc_id from group_links) links join public.requisitions r using(doc_id)
  where app_private.can_read_requisition(r.doc_id)
    and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
    and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
    and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
    and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
    and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
), group_context as materialized (
  select g.resolved_group,coalesce(max(pg.group_position),min(r.position)) position_name,
    bool_or(dg.group_id is not null) has_links,bool_or(r.doc_id is not null) has_scope_context,
    coalesce(jsonb_agg(jsonb_build_object('doc_id',r.doc_id,'site',r.site,'department',r.department,'position',r.position,'person_in_charge',r.person_in_charge) order by r.doc_id) filter(where r.doc_id is not null),'[]'::jsonb) requisitions
  from failure_groups g
  left join group_links dg on dg.group_id=g.resolved_group
  left join public.position_groups pg on pg.group_id=dg.group_id
  left join scoped_requisitions r on r.doc_id=dg.doc_id
  group by g.resolved_group
), context_rows as (
  select k.*,context.position_name,coalesce(context.requisitions,'[]'::jsonb) requisitions,context.has_links,context.has_scope_context
  from keyed k left join group_context context using(resolved_group)
)
select c.event_id,c.log_id,c.application_id,c.candidate_id,c.candidate_name,c.resolved_group,c.position_name,c.failure_date,c.recruitment_process,c.round,c.normalized_actor,c.main_key,c.detail_key,
  c.normalized_main_en,c.normalized_main_th,c.normalized_detail_en,c.normalized_detail_th,c.requisitions,coalesce(c.has_scope_context,false),
  c.resolved_group is null or coalesce(c.has_links,false)=false,c.failure_date is null
from context_rows c
$$;
revoke all on function app_private.dashboard_rejection_events_v1(date,date,jsonb,boolean) from public,anon;
grant execute on function app_private.dashboard_rejection_events_v1(date,date,jsonb,boolean) to authenticated;

create or replace function app_private.dashboard_rejection_events_v1(p_start date,p_end date,p_scope jsonb)
returns table(event_id text,log_id bigint,application_id uuid,candidate_id text,candidate_name text,group_id text,position_name text,event_date date,stage text,round integer,actor text,main_key text,detail_key text,main_en text,main_th text,detail_en text,detail_th text,requisitions jsonb,scope_context boolean,unresolved_context boolean,undated boolean)
language sql stable security invoker set search_path = '' as $$
  select * from app_private.dashboard_rejection_events_v1(p_start,p_end,p_scope,true)
$$;
revoke all on function app_private.dashboard_rejection_events_v1(date,date,jsonb) from public,anon;
grant execute on function app_private.dashboard_rejection_events_v1(date,date,jsonb) to authenticated;

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
  events as materialized (select * from app_private.dashboard_rejection_events_v1(p_start,p_end,coalesce(p_scope,'{}'::jsonb),false)),
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

create or replace function app_private.dashboard_pipeline_summary_data_v1(p_start date,p_end date,p_period text,p_scope jsonb,p_channel text) returns jsonb
language sql stable security invoker set search_path = '' as $$
with report_candidates as materialized (
    select c.candidate_id,c.channel,c.group_id,c.doc_group_id from public.candidates c where app_private.can_read_candidate(c.candidate_id)
  ), base as (
    select r.doc_id,r.site,r.department,r.section,r.position,r.level,r.head_count,r.request_type,r.status,r.pr_approved_date,r.created_at
    from public.requisitions r where app_private.can_read_requisition(r.doc_id)
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in (select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
  ), req_state as (
    select b.*,
      (select l.status from public.requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) as last_status,
      exists(select 1 from public.requisition_logs l where l.doc_id=b.doc_id) as has_logs,
      (select l.log_date from public.requisition_logs l where l.doc_id=b.doc_id and l.status='filled' and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) as logged_filled_date,
      (select max(o.accepted_date) from public.offers o where o.doc_id=b.doc_id and o.accepted_date<=p_end and (select count(*) from public.offers cap where cap.doc_id=b.doc_id and cap.accepted_date is not null and cap.accepted_date<=o.accepted_date and (cap.start_confirmation is distinct from 'did_not_start' or (cap.start_confirmed_at is null or (cap.start_confirmed_at at time zone 'UTC')::date >= o.accepted_date+1))) >= b.head_count) as offer_filled_date,
      greatest(coalesce(b.head_count,0)-(select count(*) from public.offers o where o.doc_id=b.doc_id and o.accepted_date is not null and o.accepted_date<p_start and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'UTC')::date>=p_start)),0)::int as open_at_start
    from base b
  ), eligible as (
    select s.*,
      case when s.last_status='cancel' or (not s.has_logs and s.status='cancel') then 'cancel'
           when s.offer_filled_date is not null or s.last_status='filled' then 'filled' else 'ongoing' end as period_status,
      coalesce(s.offer_filled_date,case when s.last_status='filled' then s.logged_filled_date end) as filled_date,
      coalesce(s.pr_approved_date,(s.created_at at time zone 'UTC')::date) as opened_date
    from req_state s
    where s.pr_approved_date is not null and s.pr_approved_date<=p_end
      and (s.last_status is distinct from 'cancel') and (s.has_logs or s.status is distinct from 'cancel')
      and (coalesce(s.offer_filled_date,case when s.last_status='filled' then s.logged_filled_date end) is null or coalesce(s.offer_filled_date,case when s.last_status='filled' then s.logged_filled_date end)>=p_start)
      and (p_period in ('pim','custom') or (case when btrim(coalesce(s.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then case when substring(btrim(s.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(s.level) from '([0-9]+)$')::int<=9 then 45 else 60 end end is not null and p_start<=p_end and s.pr_approved_date+(case when substring(btrim(s.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(s.level) from '([0-9]+)$')::int<=9 then 45 else 60 end)>=p_start))
  ), group_docs as (
    select d.group_id,array_agg(distinct e.doc_id order by e.doc_id) as docs
    from eligible e join public.document_groups d on d.doc_id=e.doc_id where d.group_id is not null group by d.group_id
  ), source_rows as (
    select u.group_id,u.week_start,u.applicants_fb,u.applicants_jobthai,u.applicants_jobtopgun,u.applicants_jobdb,u.applicants_jobbkk,u.applicants_linkedin,u.applicants_walkin,u.applicants_referral,u.applicants_others
    from public.sourcing_weekly_updates u join group_docs g using(group_id) where u.week_start between p_start and p_end
  ), source_channel_rows as (
    select s.group_id,s.week_start,x.label,coalesce(x.applicants,0)::int as applicants
    from source_rows s cross join lateral (values
      ('Facebook',s.applicants_fb),('JobThai',s.applicants_jobthai),('JobTopGun',s.applicants_jobtopgun),('JobsDB',s.applicants_jobdb),('JobBKK',s.applicants_jobbkk),('LinkedIn',s.applicants_linkedin),('Walk-in',s.applicants_walkin),('Referral',s.applicants_referral),('Others',s.applicants_others)
    ) x(label,applicants)
  ), date_scoped_logs as materialized (
    select l.* from public.recruitment_logs l
    where l.superseded_at is null
      and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end) between p_start and p_end
  ), group_scoped_logs as materialized (
    select l.log_id,l.application_id,l.candidate_id,l.recruitment_process,l.round,l.log_date,l.outcome_date,l.result,
      btrim(coalesce(c.channel,'')) as channel,
      coalesce(a.group_id,c.group_id,dg.group_id) as group_id,
      case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end as activity_date
    from date_scoped_logs l
    join report_candidates c on c.candidate_id=l.candidate_id
    left join public.candidate_application_assignments a on a.assignment_id=case when l.result is null then l.entry_assignment_id else l.outcome_assignment_id end and (l.application_id is null or a.application_id=l.application_id)
    left join public.document_groups dg on dg.doc_group_id=c.doc_group_id
    where (p_channel='all' or btrim(coalesce(c.channel,''))=p_channel)
      and coalesce(a.group_id,c.group_id,dg.group_id) in (select group_id from group_docs)
  ), readable_log_applications as materialized (
    select application_id from (select distinct application_id from group_scoped_logs where application_id is not null) a
    where app_private.can_read_application(a.application_id)
  ), raw_logs as materialized (
    select l.* from group_scoped_logs l
    left join readable_log_applications a using(application_id)
    where l.application_id is null or a.application_id is not null
  ), resume_ranks as materialized (
    select l.log_id,row_number() over(partition by l.candidate_id order by l.activity_date,l.log_id) as resume_rank
    from raw_logs l where l.recruitment_process='Phone Screen'
  ), pass_ranks as materialized (
    select l.log_id,row_number() over(partition by l.candidate_id,l.recruitment_process order by l.activity_date,l.log_id) as pass_rank
    from raw_logs l where l.result=1
  ), stage_values as (
    select x.*,case when rr.resume_rank=1 then 1 else 0 end as resume,case when pr.pass_rank=1 then 1 else 0 end as passed
    from raw_logs x left join resume_ranks rr using(log_id) left join pass_ranks pr using(log_id)
  ), candidate_sources as (
    select c.candidate_id,btrim(coalesce(c.channel,'')) as channel from report_candidates c
  ),
  hire_rows as (
    select o.offer_id,o.candidate_id,btrim(coalesce(c.channel,'')) as channel,o.accepted_date,
      row_number() over(partition by o.candidate_id order by o.accepted_date,o.offer_id) as hire_rank
    from public.offers o join eligible e on e.doc_id=o.doc_id
    join report_candidates c on c.candidate_id=o.candidate_id
    where o.accepted_date between p_start and p_end and (p_channel='all' or btrim(coalesce(c.channel,''))=p_channel)
  ),
  channel_rows as (
    select case when p_channel<>'all' then p_channel when x.label in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then x.label else 'Unknown' end as label,
      case when x.label='Facebook' then 'channel_fb' when x.label='JobThai' then 'channel_jobthai' when x.label='JobTopGun' then 'channel_jobtopgun' when x.label='JobsDB' then 'channel_jobdb' when x.label='JobBKK' then 'channel_jobbkk' when x.label='LinkedIn' then 'channel_linkedin' when x.label='Walk-in' then 'channel_walkin' when x.label='Referral' then 'channel_referral' when x.label='Others' then 'channel_others' else 'unknown' end as key,
      coalesce(sum(s.applicants),0)::int as applicants,
      (select count(*)::int from stage_values v where (p_channel<>'all' and v.channel=p_channel or p_channel='all' and (case when btrim(coalesce(v.channel,'')) in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then btrim(v.channel) else 'Unknown' end)=x.label) and v.recruitment_process='Phone Screen' and v.result=1 and v.passed=1) as phone,
      (select count(*)::int from hire_rows h where h.hire_rank=1 and (case when p_channel<>'all' then h.channel when h.channel in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then h.channel else 'Unknown' end)=x.label) as hired
    from (select unnest(case when p_channel='all' then array['Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others','Unknown'] else array[p_channel] end) as label) x
    left join source_channel_rows s on (p_channel='all' and s.label=x.label or p_channel<>'all' and s.label=p_channel)
    group by x.label
  ), funnel_stages as (
    select unnest(array['applicants','Resume Screening','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer']) as stage,generate_series(1,8) as ordinal
  ), funnel_counts as (
    select fs.stage,fs.ordinal,
      case when fs.stage='applicants' then coalesce((select sum(applicants) from channel_rows),0)::int
           when fs.stage='Resume Screening' then (select count(*)::int from (select distinct v.candidate_id from stage_values v where v.recruitment_process='Phone Screen' and v.resume=1) z)
           else (select count(*)::int from stage_values v where v.recruitment_process=fs.stage and v.result=1 and v.passed=1) end as count
    from funnel_stages fs
  ), funnel_json as (
    select coalesce(jsonb_agg(jsonb_build_object('key',stage,'label',stage,'count',count,'conversionRate',case when previous_count>0 then count::numeric/previous_count else null end,'yieldRate',case when applicant_count>0 then count::numeric/applicant_count else null end,'barRatio',case when applicant_count>0 then least(count::numeric/applicant_count,1) else null end,'segments',segments) order by ordinal),'[]'::jsonb) as rows
    from (select f.*,lag(count) over(order by ordinal) as previous_count,first_value(count) over(order by ordinal) as applicant_count,
      (select coalesce(jsonb_agg(jsonb_build_object('key',c.key,'label',c.label,'count',case when f.stage='applicants' then c.applicants when f.stage='Resume Screening' then (select count(distinct v.candidate_id)::int from stage_values v where v.recruitment_process='Phone Screen' and v.resume=1 and (case when p_channel<>'all' then v.channel when v.channel in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then v.channel else 'Unknown' end)=c.label) else (select count(*)::int from stage_values v where v.recruitment_process=f.stage and v.result=1 and v.passed=1 and (case when p_channel<>'all' then v.channel when v.channel in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then v.channel else 'Unknown' end)=c.label) end,'color',case c.key when 'channel_fb' then '#3B6FE8' when 'channel_jobthai' then '#F28C45' when 'channel_jobtopgun' then '#31B978' when 'channel_jobdb' then '#7666E4' when 'channel_jobbkk' then '#E76683' when 'channel_linkedin' then '#26A6C6' when 'channel_walkin' then '#23B4A4' when 'channel_referral' then '#B477D3' when 'channel_others' then '#70829A' else '#94A3B8' end) order by case c.key when 'channel_fb' then 1 when 'channel_jobthai' then 2 when 'channel_jobtopgun' then 3 when 'channel_jobdb' then 4 when 'channel_jobbkk' then 5 when 'channel_linkedin' then 6 when 'channel_walkin' then 7 when 'channel_referral' then 8 when 'channel_others' then 9 else 10 end),'[]'::jsonb) from channel_rows c) as segments
      from funnel_counts f) q
  ), stage_flags as (
    select unnest(array['Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others']) as channel,unnest(array['applicants_fb','applicants_jobthai','applicants_jobtopgun','applicants_jobdb','applicants_jobbkk','applicants_linkedin','applicants_walkin','applicants_referral','applicants_others']) as count_column
  ), movement as (
    select 'Week Start'::text as waterfall_category,e.site,coalesce(e.request_type,'New') as request_type,e.open_at_start::int as vacancy_count,0::int as filled_in_sla,0::int as filled_sla_unknown from eligible e where e.opened_date<p_start and e.open_at_start>0
    union all
    select 'Open',e.site,coalesce(e.request_type,'New'),e.head_count,0,0 from eligible e where e.opened_date between p_start and p_end
    union all
    select 'Filled',e.site,coalesce(e.request_type,'New'),-1,case when sla.sla_result is true then 1 else 0 end,case when sla.sla_result is null then 1 else 0 end
    from public.offers o join eligible e on e.doc_id=o.doc_id
    cross join lateral (select (select max((no_show.start_confirmed_at at time zone 'UTC')::date) from public.offers no_show where no_show.doc_id=e.doc_id and no_show.start_confirmation='did_not_start' and (no_show.start_confirmed_at at time zone 'UTC')::date<=o.accepted_date) as restart) restart
    cross join lateral (select case when btrim(coalesce(e.level,'')) !~* '^L?(0|[1-9]|1[0-4])$' then null when coalesce(restart.restart,e.pr_approved_date)>o.accepted_date then null when o.accepted_date-coalesce(restart.restart,e.pr_approved_date)<=case when substring(btrim(e.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(e.level) from '([0-9]+)$')::int<=9 then 45 else 60 end then true else false end as sla_result) sla
    where o.accepted_date between p_start and p_end and e.period_status<>'cancel'
    union all
    select 'Open',e.site,coalesce(e.request_type,'New'),1,0,0 from public.offers o join eligible e on e.doc_id=o.doc_id and e.period_status<>'cancel' where o.start_confirmation='did_not_start' and (o.start_confirmed_at at time zone 'UTC')::date between p_start and p_end
  ), waterfall_base as (
    select waterfall_category,site,request_type,sum(vacancy_count)::int as vacancy_count,sum(filled_in_sla)::int as filled_in_sla,sum(filled_sla_unknown)::int as filled_sla_unknown from movement group by waterfall_category,site,request_type
  ), waterfall_all as (
    select * from waterfall_base union all select 'Total',site,request_type,sum(vacancy_count)::int,sum(filled_in_sla)::int,sum(filled_sla_unknown)::int from waterfall_base group by site,request_type
  ), waterfall_json as (
    select coalesce(jsonb_agg(jsonb_build_object('waterfall_category',waterfall_category,'site',site,'request_type',request_type,'vacancy_count',vacancy_count,'filledInSla',filled_in_sla,'filledSlaUnknown',filled_sla_unknown) order by site,request_type,case waterfall_category when 'Week Start' then 1 when 'Open' then 2 when 'Filled' then 3 else 4 end),'[]'::jsonb) as rows from waterfall_all
  ), reassignment_json as (
    select jsonb_build_object('in',count(*) filter(where a.group_id in (select group_id from group_docs))::int,'out',count(*) filter(where a.from_group_id in (select group_id from group_docs))::int) as values
    from public.candidate_application_assignments a where a.from_group_id is not null and app_private.can_read_application(a.application_id) and (a.started_at at time zone 'Asia/Bangkok')::date between p_start and p_end
      and (a.group_id in (select group_id from group_docs) or a.from_group_id in (select group_id from group_docs))
  ), options_json as (
    select coalesce(jsonb_agg(channel order by ordinal,channel),'[]'::jsonb) as options from (
      select channel,min(ordinal) as ordinal from (
        select label as channel,ordinal from (values ('Facebook',1),('JobThai',2),('JobTopGun',3),('JobsDB',4),('JobBKK',5),('LinkedIn',6),('Walk-in',7),('Referral',8),('Others',9)) fixed(label,ordinal)
        union all select distinct btrim(c.channel),10 from report_candidates c where nullif(btrim(c.channel),'') is not null
      ) raw_options group by channel
    ) o
  )
  select jsonb_build_object('range',jsonb_build_object('start',p_start,'end',p_end),'reassignments',r.values,'funnelRows',f.rows,'sourceRows',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'color',case key when 'channel_fb' then '#3B6FE8' when 'channel_jobthai' then '#F28C45' when 'channel_jobtopgun' then '#31B978' when 'channel_jobdb' then '#7666E4' when 'channel_jobbkk' then '#E76683' when 'channel_linkedin' then '#26A6C6' when 'channel_walkin' then '#23B4A4' when 'channel_referral' then '#B477D3' when 'channel_others' then '#70829A' else '#94A3B8' end,'applicants',applicants,'phone',phone,'hired',hired) order by applicants desc,case key when 'channel_fb' then 1 when 'channel_jobthai' then 2 when 'channel_jobtopgun' then 3 when 'channel_jobdb' then 4 when 'channel_jobbkk' then 5 when 'channel_linkedin' then 6 when 'channel_walkin' then 7 when 'channel_referral' then 8 when 'channel_others' then 9 else 10 end) from channel_rows where applicants+phone+hired>0),'[]'::jsonb),'waterfallRows',w.rows,'channelOptions',o.options)
from reassignment_json r cross join funnel_json f cross join waterfall_json w cross join options_json o;
$$;
revoke all on function app_private.dashboard_pipeline_summary_data_v1(date,date,text,jsonb,text) from public,anon,authenticated;
grant execute on function app_private.dashboard_pipeline_summary_data_v1(date,date,text,jsonb,text) to authenticated;
create or replace function public.app_dashboard_active_requisitions_page_v1(
  p_start date,p_end date,p_period text,p_stage_mode text,p_scope jsonb default '{}'::jsonb,
  p_after_value text default null,p_after_id text default null,p_limit integer default 25,
  p_search text default '',p_filters jsonb default '{}'::jsonb,p_sort text default null,p_direction text default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_needs_metric_membership boolean; v_sort text:=coalesce(nullif(p_sort,''),'report'); v_direction text:=lower(coalesce(nullif(p_direction,''),'asc'));
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_period not in ('mtd','ytd','pim','custom') then raise exception 'REPORT_RANGE_INVALID'; end if;
  if p_stage_mode not in ('status','activity','accum') then raise exception 'REPORT_STAGE_MODE_INVALID'; end if;
  if p_limit is null or p_limit not in (25,50) then raise exception 'REPORT_PAGE_LIMIT_INVALID'; end if;
  if (p_after_value is null)<>(p_after_id is null) then raise exception 'REPORT_CURSOR_INVALID'; end if;
  if p_search is null or length(p_search)>200 or jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('site','department','section','position','level','vacancy','request_type','requisition_date','person_in_charge','status','detail','applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer','actual_age','sla','filled_date'))
    or exists(select 1 from jsonb_each(coalesce(p_filters,'{}'::jsonb)) f where jsonb_typeof(f.value)<>'string' or length(f.value #>> '{}')>200) then raise exception 'REPORT_FILTER_INVALID'; end if;
  if v_direction not in ('asc','desc') or v_sort not in ('report','site','department','section','position','level','vacancy','request_type','requisition_date','person_in_charge','status','detail','applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer','actual_age','sla','filled_date') then raise exception 'REPORT_SORT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'REPORT_SCOPE_INVALID'; end if;
  v_needs_metric_membership := p_search<>'' or exists(select 1 from jsonb_each_text(coalesce(p_filters,'{}'::jsonb)) f where f.key in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and f.value<>'');
  with base as materialized (
    select r.doc_id,r.site,r.department,r.section,r.position,r.level,r.head_count,r.request_type,r.status,r.person_in_charge,r.pr_approved_date,r.is_priority
    from public.requisitions r where app_private.can_read_requisition(r.doc_id)
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
  ), evaluated as materialized (
    select b.*,
      (select l.status from public.requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) last_status,
      (select l.remark from public.requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) last_remark,
      (select l.log_date from public.requisition_logs l where l.doc_id=b.doc_id and l.status='filled' and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) logged_filled,
      exists(select 1 from public.requisition_logs l where l.doc_id=b.doc_id) has_logs,
      coalesce((select count(*) from public.offers o where o.doc_id=b.doc_id and o.accepted_date<p_end+1 and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'UTC')::date>=p_end+1)),0)::integer covered_end,
      (select max(o.accepted_date) from public.offers o where o.doc_id=b.doc_id and o.accepted_date<=p_end and
        (select count(*) from public.offers q where q.doc_id=b.doc_id and q.accepted_date<o.accepted_date+1 and (q.start_confirmation is distinct from 'did_not_start' or q.start_confirmed_at is null or (q.start_confirmed_at at time zone 'UTC')::date>=o.accepted_date+1))>=b.head_count) offer_filled
    from base b
  ), eligible0 as (
    select e.*,case when e.offer_filled is not null or e.last_status='filled' then 'filled' else 'ongoing' end period_status,
      case when e.covered_end>=e.head_count then e.offer_filled when e.last_status='filled' then e.logged_filled else null end filled_date,
      coalesce(e.pr_approved_date,'9999-12-31'::date) req_date,
      coalesce((select max((o.start_confirmed_at at time zone 'UTC')::date) from public.offers o where o.doc_id=e.doc_id and o.start_confirmation='did_not_start' and o.start_confirmed_at is not null),e.pr_approved_date) sla_start,
      case when nullif(substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)'), '') is null then null
        when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 0 and 6 then 30
        when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 7 and 9 then 45
        when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 10 and 14 then 60 else null end sla_days
    from evaluated e
  ), eligible as materialized (
    select e.* from eligible0 e where e.req_date<=p_end and e.last_status is distinct from 'cancel'
      and not (not e.has_logs and e.status='cancel')
      and (case when e.covered_end>=e.head_count then e.offer_filled when e.last_status='filled' then e.logged_filled else null end is null
        or case when e.covered_end>=e.head_count then e.offer_filled when e.last_status='filled' then e.logged_filled else null end>=p_start)
      and (p_period in ('pim','custom') or (case when nullif(substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)'), '') is not null and substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 0 and 14 then case when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=6 then 30 when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=9 then 45 else 60 end end is not null and e.pr_approved_date+(case when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=6 then 30 when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=9 then 45 else 60 end)>=p_start))
  ), cheap_rows as (
    select e.*,
      case v_sort when 'site' then lower(e.site) when 'department' then lower(e.department) when 'section' then lower(coalesce(e.section,'')) when 'position' then lower(e.position)
        when 'level' then lower(coalesce(e.level,'')) when 'vacancy' then lpad(e.head_count::text,12,'0') when 'request_type' then lower(coalesce(e.request_type,''))
        when 'requisition_date' then e.req_date::text when 'person_in_charge' then lower(coalesce(e.person_in_charge,''))
        when 'status' then case e.period_status when 'ongoing' then '0-ongoing' else '1-filled' end when 'detail' then lower(coalesce(e.last_remark,''))
        when 'actual_age' then lpad(greatest((timezone('Asia/Bangkok',now())::date-e.req_date),0)::text,12,'0')
        when 'sla' then lpad(greatest((coalesce(case when e.period_status='filled' then e.filled_date end,p_end)-e.sla_start),0)::text,12,'0')
        when 'filled_date' then coalesce(e.filled_date::text,'9999-12-31')
        else concat(e.site,chr(31),case when e.period_status='ongoing' then '0' else '1' end,chr(31),coalesce(e.filled_date::text,'9999-12-31'),chr(31),e.req_date::text) end sort_value
    from eligible e
  ), base_matches as materialized (
    select r.* from cheap_rows r where true
      and (coalesce((p_filters->>'site'),'')='' or r.site ilike '%'||(p_filters->>'site')||'%')
      and (coalesce((p_filters->>'department'),'')='' or r.department ilike '%'||(p_filters->>'department')||'%')
      and (coalesce((p_filters->>'section'),'')='' or coalesce(r.section,'-') ilike '%'||(p_filters->>'section')||'%')
      and (coalesce((p_filters->>'position'),'')='' or r.position ilike '%'||(p_filters->>'position')||'%')
      and (coalesce((p_filters->>'level'),'')='' or coalesce(r.level,'-') ilike '%'||(p_filters->>'level')||'%')
      and (coalesce((p_filters->>'vacancy'),'')='' or r.head_count::text ilike '%'||(p_filters->>'vacancy')||'%')
      and (coalesce((p_filters->>'request_type'),'')='' or case lower(btrim((p_filters->>'request_type'))) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike '%'||(p_filters->>'request_type')||'%' end)
      and (coalesce((p_filters->>'requisition_date'),'')='' or concat_ws(' ',r.req_date::text,to_char(r.req_date,'DD/MM/YYYY')) ilike '%'||(p_filters->>'requisition_date')||'%')
      and (coalesce((p_filters->>'person_in_charge'),'')='' or coalesce(r.person_in_charge,'-') ilike '%'||(p_filters->>'person_in_charge')||'%')
      and (coalesce((p_filters->>'status'),'')='' or case lower(btrim((p_filters->>'status'))) when 'ongoing' then r.period_status='ongoing' when 'กำลังดำเนินการ' then r.period_status='ongoing' when 'filled' then r.period_status='filled' when 'ครบแล้ว' then r.period_status='filled' else concat_ws(' ',r.period_status,r.site,r.department) ilike '%'||(p_filters->>'status')||'%' end)
      and (coalesce((p_filters->>'detail'),'')='' or coalesce(r.last_remark,'-') ilike '%'||(p_filters->>'detail')||'%')
      and (coalesce((p_filters->>'actual_age'),'')='' or greatest((timezone('Asia/Bangkok',now())::date-r.req_date),0)::text ilike '%'||replace((p_filters->>'actual_age'),'d','')||'%')
      and (coalesce((p_filters->>'sla'),'')='' or (case when r.sla_start is null or r.sla_days is null then '-' else (case when greatest((coalesce(case when r.period_status='filled' then r.filled_date end,p_end)-r.sla_start),0)<=r.sla_days then 'In SLA อยู่ใน SLA' else 'Over SLA เกิน SLA' end)||' ('||greatest((coalesce(case when r.period_status='filled' then r.filled_date end,p_end)-r.sla_start),0)||'d)' end) ilike '%'||(p_filters->>'sla')||'%')
      and (coalesce((p_filters->>'filled_date'),'')='' or concat_ws(' ',coalesce(r.filled_date::text,'-'),coalesce(to_char(r.filled_date,'DD/MM/YYYY'),'-'),coalesce(to_char(r.filled_date,'Mon DD, YYYY'),'-')) ilike '%'||(p_filters->>'filled_date')||'%')
  ), enrichment_keys as materialized (
    select doc_id from base_matches where v_needs_metric_membership or v_sort in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
    union all
    select doc_id from (
      select doc_id from base_matches r where not v_needs_metric_membership and v_sort not in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and (case when v_sort='report' or v_direction='asc' then p_after_value is null or r.sort_value>p_after_value or (r.sort_value=p_after_value and r.doc_id>p_after_id)
        else p_after_value is null or r.sort_value<p_after_value or (r.sort_value=p_after_value and r.doc_id>p_after_id) end)
      order by case when v_direction='asc' then sort_value end asc,case when v_direction='desc' then sort_value end desc,doc_id asc limit p_limit+1
    ) page_keys
  ), stage_apps as materialized (
    select distinct k.doc_id,d.group_id,ca.application_id,ca.candidate_id
    from enrichment_keys k join public.document_groups d using(doc_id)
    join lateral (select a.application_id,a.candidate_id from public.candidate_applications a where a.group_id=d.group_id offset 0) ca on true
  ), allowed_stage_applications as materialized (
    select application_id from (select distinct application_id from stage_apps) a
    where app_private.can_read_application(a.application_id)
  ), allowed_stage_candidates as materialized (
    select c.candidate_id from (select distinct candidate_id from stage_apps join allowed_stage_applications using(application_id)) k
    join public.candidates c using(candidate_id) where app_private.can_read_candidate(c.candidate_id)
  ), stage_counts as (
    select e.doc_id,l.recruitment_process,count(distinct case when p_stage_mode='status' then ca.application_id::text else l.candidate_id end)::integer n
    from stage_apps ca join allowed_stage_applications aa using(application_id) join base_matches e using(doc_id)
    join allowed_stage_candidates c on c.candidate_id=ca.candidate_id
    join public.recruitment_logs l on l.candidate_id=c.candidate_id and l.application_id=ca.application_id
    left join public.candidate_application_assignments a on a.assignment_id=case when l.result is null then l.entry_assignment_id else l.outcome_assignment_id end and a.application_id=ca.application_id
    where l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (p_stage_mode='status' or a.group_id=ca.group_id or a.assignment_id is null)
      and case p_stage_mode when 'activity' then (case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end) between p_start and p_end
        when 'accum' then l.superseded_at is null and l.log_date between coalesce(e.pr_approved_date,p_end) and p_end
        else l.log_date<=p_end and (l.outcome_date is null or l.outcome_date>p_end or l.result is null)
          and not exists(select 1 from public.recruitment_logs newer where newer.application_id=ca.application_id and newer.candidate_id=c.candidate_id
            and newer.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
            and newer.log_date<=p_end and (newer.outcome_date is null or newer.outcome_date>p_end or newer.result is null)
            and (newer.log_date>l.log_date or (newer.log_date=l.log_date and newer.log_id>l.log_id))) end
    group by e.doc_id,l.recruitment_process
  ), stage_pivot as materialized (
    select doc_id,
      coalesce(max(n) filter(where recruitment_process='Phone Screen'),0)::integer phone_screen,
      coalesce(max(n) filter(where recruitment_process='HR Interview'),0)::integer hr_interview,
      coalesce(max(n) filter(where recruitment_process='Line Interview'),0)::integer line_interview,
      coalesce(max(n) filter(where recruitment_process='Test'),0)::integer test_count,
      coalesce(max(n) filter(where recruitment_process='Reference Check'),0)::integer reference_check,
      coalesce(max(n) filter(where recruitment_process='Offer'),0)::integer offer_count
    from stage_counts group by doc_id
  ), rows as (
    select e.*, coalesce(metric_sort.value,e.sort_value) as report_sort_value,
      coalesce(st.phone_screen,0)::integer phone_screen,coalesce(st.hr_interview,0)::integer hr_interview,coalesce(st.line_interview,0)::integer line_interview,
      coalesce(st.test_count,0)::integer test_count,coalesce(st.reference_check,0)::integer reference_check,coalesce(st.offer_count,0)::integer offer_count,
      coalesce(src.applicants,0)::integer applicant_count,coalesce(src.channel_fb,0)::integer channel_fb,coalesce(src.channel_jobthai,0)::integer channel_jobthai,
      coalesce(src.channel_jobtopgun,0)::integer channel_jobtopgun,coalesce(src.channel_jobdb,0)::integer channel_jobdb,coalesce(src.channel_jobbkk,0)::integer channel_jobbkk,
      coalesce(src.channel_linkedin,0)::integer channel_linkedin,coalesce(src.channel_walkin,0)::integer channel_walkin,coalesce(src.channel_referral,0)::integer channel_referral,coalesce(src.channel_others,0)::integer channel_others
    from enrichment_keys k join base_matches e using(doc_id) left join stage_pivot st using(doc_id) left join lateral (
      select sum(coalesce(u.applicants_fb,0)+coalesce(u.applicants_jobthai,0)+coalesce(u.applicants_jobtopgun,0)+coalesce(u.applicants_jobdb,0)+coalesce(u.applicants_jobbkk,0)+coalesce(u.applicants_linkedin,0)+coalesce(u.applicants_walkin,0)+coalesce(u.applicants_referral,0)+coalesce(u.applicants_others,0))::integer applicants,
        sum(coalesce(u.applicants_fb,0))::integer channel_fb,sum(coalesce(u.applicants_jobthai,0))::integer channel_jobthai,sum(coalesce(u.applicants_jobtopgun,0))::integer channel_jobtopgun,sum(coalesce(u.applicants_jobdb,0))::integer channel_jobdb,
        sum(coalesce(u.applicants_jobbkk,0))::integer channel_jobbkk,sum(coalesce(u.applicants_linkedin,0))::integer channel_linkedin,sum(coalesce(u.applicants_walkin,0))::integer channel_walkin,sum(coalesce(u.applicants_referral,0))::integer channel_referral,sum(coalesce(u.applicants_others,0))::integer channel_others
      from public.document_groups d join public.sourcing_weekly_updates u on u.group_id=d.group_id
      where d.doc_id=e.doc_id and u.week_start between p_start and p_end and app_private.can_read_sourcing_group(u.group_id)
    ) src on true
    cross join lateral (select case v_sort
      when 'applicants' then lpad(coalesce(src.applicants,0)::text,12,'0')
      when 'Phone Screen' then lpad(coalesce(st.phone_screen,0)::text,12,'0')
      when 'HR Interview' then lpad(coalesce(st.hr_interview,0)::text,12,'0')
      when 'Line Interview' then lpad(coalesce(st.line_interview,0)::text,12,'0')
      when 'Test' then lpad(coalesce(st.test_count,0)::text,12,'0')
      when 'Reference Check' then lpad(coalesce(st.reference_check,0)::text,12,'0')
      when 'Offer' then lpad(coalesce(st.offer_count,0)::text,12,'0') end value) metric_sort
  ), matched as materialized (
    select r.* from rows r where true
      and (coalesce(p_search,'')='' or concat_ws(' ',r.doc_id,r.site,r.department,r.section,r.position,r.level,r.head_count,r.request_type,r.req_date,r.person_in_charge,r.period_status,r.last_remark,r.applicant_count,r.phone_screen,r.hr_interview,r.line_interview,r.test_count,r.reference_check,r.offer_count,r.filled_date) ilike '%'||btrim(p_search)||'%')
      and (coalesce((p_filters->>'applicants'),'')='' or r.applicant_count::text ilike '%'||(p_filters->>'applicants')||'%')
      and (coalesce((p_filters->>'Phone Screen'),'')='' or r.phone_screen::text ilike '%'||(p_filters->>'Phone Screen')||'%')
      and (coalesce((p_filters->>'HR Interview'),'')='' or r.hr_interview::text ilike '%'||(p_filters->>'HR Interview')||'%')
      and (coalesce((p_filters->>'Line Interview'),'')='' or r.line_interview::text ilike '%'||(p_filters->>'Line Interview')||'%')
      and (coalesce((p_filters->>'Test'),'')='' or r.test_count::text ilike '%'||(p_filters->>'Test')||'%')
      and (coalesce((p_filters->>'Reference Check'),'')='' or r.reference_check::text ilike '%'||(p_filters->>'Reference Check')||'%')
      and (coalesce((p_filters->>'Offer'),'')='' or r.offer_count::text ilike '%'||(p_filters->>'Offer')||'%')
  ), page_raw as (
    select * from matched r where (case when v_sort='report' or v_direction='asc' then p_after_value is null or r.report_sort_value>p_after_value or (r.report_sort_value=p_after_value and r.doc_id>p_after_id)
        else p_after_value is null or r.report_sort_value<p_after_value or (r.report_sort_value=p_after_value and r.doc_id>p_after_id) end)
    order by case when v_direction='asc' then report_sort_value end asc,case when v_direction='desc' then report_sort_value end desc,doc_id asc limit p_limit+1
  ), page_rows as (
    select * from page_raw order by case when v_direction='asc' then report_sort_value end asc,case when v_direction='desc' then report_sort_value end desc,doc_id asc limit p_limit
  ), counted as (
    select case when v_needs_metric_membership then (select count(*) from matched) else (select count(*) from base_matches) end::integer total
  ),
  page_info as (select count(*)>p_limit more from page_raw)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('doc_id',p.doc_id,'site',p.site,'department',p.department,'section',p.section,'position',p.position,'level',coalesce(p.level,'-'),'vacancy',p.head_count,
      'applicant_count',p.applicant_count,'applicant_channels',jsonb_build_object('applicants_fb',p.channel_fb,'applicants_jobthai',p.channel_jobthai,'applicants_jobtopgun',p.channel_jobtopgun,'applicants_jobdb',p.channel_jobdb,'applicants_jobbkk',p.channel_jobbkk,'applicants_linkedin',p.channel_linkedin,'applicants_walkin',p.channel_walkin,'applicants_referral',p.channel_referral,'applicants_others',p.channel_others),
      'request_type',p.request_type,'requisition_date',p.req_date,'actual_age_days',greatest((timezone('Asia/Bangkok',now())::date-p.req_date),0),'person_in_charge',coalesce(p.person_in_charge,'-'),
      'stage_counts',jsonb_build_object('Phone Screen',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Phone Screen'),0),'HR Interview',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='HR Interview'),0),'Line Interview',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Line Interview'),0),'Test',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Test'),0),'Reference Check',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Reference Check'),0),'Offer',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Offer'),0)),
      'sla_state',jsonb_build_object('ageDays',case when p.sla_start is null then null else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0) end,
        'endDate',coalesce(case when p.period_status='filled' then p.filled_date end,p_end),'inSla',case when p.sla_start is null or p.sla_days is null then null else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)<=p.sla_days end,
        'isOverdue',case when p.sla_start is null or p.sla_days is null then false else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)>p.sla_days end,
        'label',case when p.sla_start is null or p.sla_days is null then '-' else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)||'d / '||p.sla_days||'d' end,
        'slaDays',p.sla_days,'startDate',p.sla_start),
      'filled_date',p.filled_date,'period_status',p.period_status,'period_detail',p.last_remark) order by case when v_direction='asc' then p.report_sort_value end asc,case when v_direction='desc' then p.report_sort_value end desc,p.doc_id asc) from page_rows p),'[]'::jsonb),
    'total',(select total from counted),'hasMore',(select more from page_info),
    'nextCursor',case when (select more from page_info) then (select jsonb_build_object('value',report_sort_value,'id',doc_id) from page_rows order by case when v_direction='asc' then report_sort_value end desc,case when v_direction='desc' then report_sort_value end asc,doc_id desc limit 1) else null end)
  into v_result;
  return v_result;
end $$;
revoke all on function public.app_dashboard_active_requisitions_page_v1(date,date,text,text,jsonb,text,text,integer,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.app_dashboard_active_requisitions_page_v1(date,date,text,text,jsonb,text,text,integer,text,jsonb,text,text) to authenticated;

-- Caller-authorized stage bottleneck summaries and cursor-paged queue rows.
-- All public entry points are SECURITY INVOKER; row access stays within the caller's RLS scope.

create or replace function public.app_dashboard_bottleneck_summary_v1(
  p_start date,p_end date,p_prior_start date,p_prior_end date,p_scope jsonb default '{}'::jsonb,p_channel text default 'all',p_trend_dates date[] default '{}'
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_as_of date; v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or ((p_prior_start is null)<>(p_prior_end is null)) or (p_prior_start is not null and p_prior_start>p_prior_end) then raise exception 'REPORT_RANGE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels')) then raise exception 'REPORT_SCOPE_INVALID'; end if;
  if cardinality(coalesce(p_trend_dates,'{}'::date[]))>8 or exists(select 1 from unnest(coalesce(p_trend_dates,'{}'::date[])) d where d<p_start or d>p_end) then raise exception 'REPORT_RANGE_INVALID'; end if;
  v_as_of:=least(p_end,(now() at time zone 'Asia/Bangkok')::date);
  if exists(select 1 from (select d,lag(d) over(order by ord) prev from unnest(coalesce(p_trend_dates,'{}'::date[])) with ordinality t(d,ord)) x where d is null or d<=prev) then raise exception 'REPORT_RANGE_INVALID'; end if;
  with authorized_candidates as materialized (
    select c.candidate_id,c.name,c.channel from public.candidates c where app_private.can_read_candidate(c.candidate_id)
  ), authorized_applications as materialized (
    select a.application_id,a.candidate_id,a.group_id from public.candidate_applications a where app_private.can_read_application(a.application_id)
  ), authorized_logs as materialized (
    select l.* from public.recruitment_logs l join authorized_candidates c on c.candidate_id=l.candidate_id
      left join authorized_applications a on a.application_id=l.application_id
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
      and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (l.application_id is null or a.application_id is not null)
  ), direct_rows as (
    select l.stage_instance_id::text attempt_id,l.application_id,l.candidate_id,l.recruitment_process stage,l.round,l.log_id,l.log_date entry_date,
      case when l.result is null then null else l.outcome_date end outcome_date,l.result,l.estimated_action_date due_date,
      (l.pending_edited_at at time zone 'Asia/Bangkok')::date edited_date,(l.record_origin='migration' and l.pending_edited_at is null) unreliable,false invalid_due,
      case when l.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(l.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when l.log_date is null then 'Missing or invalid entry date' when l.result is not null and l.outcome_date is null then 'Missing or invalid outcome date'
        when l.outcome_date is not null and l.outcome_date<l.log_date then 'Outcome precedes entry' else null end exclusion,l.entry_assignment_id,l.outcome_assignment_id
    from authorized_logs l where l.stage_instance_id is not null
  ), legacy_grouped as (
    select l.*,coalesce(sum(case when l.result is not null then 1 else 0 end) over(partition by l.application_id,l.recruitment_process,l.round order by l.log_date,l.log_id rows between unbounded preceding and 1 preceding),0)::integer pair_group
    from authorized_logs l where l.stage_instance_id is null
  ), pending_rows as (
    select l.*,row_number() over(partition by l.application_id,l.recruitment_process,l.round,l.pair_group order by l.log_date desc,l.log_id desc) pending_rank from legacy_grouped l where l.result is null
  ), outcome_rows as (
    select l.*,p.log_id pending_log_id,p.log_date pending_log_date,p.estimated_action_date pending_due,p.pending_edited_at pending_edited,p.record_origin pending_origin
    from legacy_grouped l left join lateral(select p.log_id,p.log_date,p.estimated_action_date,p.pending_edited_at,p.record_origin from pending_rows p
      where p.application_id=l.application_id and p.recruitment_process=l.recruitment_process and p.round=l.round and p.pair_group=l.pair_group order by p.log_date desc,p.log_id desc limit 1) p on true where l.result is not null
  ), paired_results as (
    select ('legacy-'||o.log_id::text) attempt_id,o.application_id,o.candidate_id,o.recruitment_process stage,o.round,o.log_id,o.pending_log_date entry_date,coalesce(o.outcome_date,o.log_date) outcome_date,o.result,
      coalesce(o.pending_due,o.estimated_action_date) due_date,(coalesce(o.pending_edited,o.pending_edited_at) at time zone 'Asia/Bangkok')::date edited_date,
      (coalesce(o.pending_origin,o.record_origin)='migration' and coalesce(o.pending_edited,o.pending_edited_at) is null) unreliable,false invalid_due,
      case when o.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(o.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when o.pending_log_date is null then 'Missing or invalid entry date'
        when coalesce(o.outcome_date,o.log_date) is null then 'Missing or invalid outcome date'
        when coalesce(o.outcome_date,o.log_date)<o.pending_log_date then 'Outcome precedes entry' else null end exclusion,o.entry_assignment_id,o.outcome_assignment_id from outcome_rows o
  ), standalone_pending as (
    select ('legacy-'||p.log_id::text) attempt_id,p.application_id,p.candidate_id,p.recruitment_process stage,p.round,p.log_id,p.log_date entry_date,null::date outcome_date,null::smallint result,
      p.estimated_action_date due_date,(p.pending_edited_at at time zone 'Asia/Bangkok')::date edited_date,(p.record_origin='migration' and p.pending_edited_at is null) unreliable,false invalid_due,
      case when p.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(p.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when p.log_date is null then 'Missing or invalid entry date' else null end exclusion,p.entry_assignment_id,p.outcome_assignment_id from pending_rows p
    where not exists(select 1 from outcome_rows o where o.application_id=p.application_id and o.recruitment_process=p.recruitment_process and o.round=p.round and o.pair_group=p.pair_group and o.pending_log_id=p.log_id)
  ), attempts as materialized (
    select a.*,case when a.exclusion is null and a.entry_date is not null and a.outcome_date is not null then a.outcome_date-a.entry_date end::integer duration
    from (select * from direct_rows union all select * from paired_results union all select * from standalone_pending) a
    ), scoped_req as materialized (
      select r.doc_id,r.site,r.department,r.position,r.person_in_charge,r.level,r.is_priority,r.head_count,r.status,r.created_at,r.pr_approved_date,dg.group_id
      from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id
      where app_private.can_read_requisition(r.doc_id) and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
        and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
        and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
        and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
        and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band)
          where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(r.level from '([0-9]+)$')::integer between split_part(x.band,'-',1)::integer and split_part(x.band,'-',2)::integer))
    ), assignments as materialized (
      select aa.* from public.candidate_application_assignments aa join authorized_applications a using(application_id)
    ), scoped_logs as materialized (
      select l.* from public.requisition_logs l where exists(select 1 from scoped_req r where r.doc_id=l.doc_id)
    ), scoped_offers as materialized (
      select o.* from public.offers o where exists(select 1 from scoped_req r where r.doc_id=o.doc_id)
    ), terminal_events as materialized (
      select t.application_id,case when t.recruitment_process in ('Rejected','Withdrawn') or t.stage_instance_id is null then t.log_date else t.outcome_date end terminal_date
      from public.recruitment_logs t join authorized_applications a on a.application_id=t.application_id join authorized_candidates c on c.candidate_id=t.candidate_id
      where t.superseded_at is null and t.superseded_by_stage_instance_id is null and (t.recruitment_process in ('Rejected','Withdrawn') or t.result=0)
    ), accepted_apps as materialized (
      select o.application_id,o.accepted_date from public.offers o where o.application_id is not null and o.accepted_date<=v_as_of and o.start_confirmation is distinct from 'did_not_start'
    ), windows as (
      select 0::bigint ord,p_start starts,v_as_of as_of,p_end display_end
      union all select -1,p_prior_start,least(p_prior_end,v_as_of),p_prior_end where p_start<=v_as_of and p_prior_start<=v_as_of
      union all select ord,coalesce(lag(d) over(order by ord)+1,p_start),least(d,v_as_of),d from unnest(coalesce(p_trend_dates,'{}'::date[])) with ordinality t(d,ord)
    ), summaries as materialized (
      select w.*,report.metrics,report.detail from windows w cross join lateral (
        with assignment_at_date as materialized (
      select distinct on (aa.application_id) aa.application_id,aa.group_id from assignments aa
      where (aa.started_at at time zone 'Asia/Bangkok')::date<=w.as_of and (aa.ended_at is null or (aa.ended_at at time zone 'Asia/Bangkok')::date>w.as_of)
      order by aa.application_id,aa.started_at desc,aa.assignment_id desc
    ), app_context as materialized (
      select a.application_id,a.candidate_id,c.name,coalesce(aa.group_id,a.group_id) group_id
      from authorized_applications a join authorized_candidates c on c.candidate_id=a.candidate_id
      left join assignment_at_date aa on aa.application_id=a.application_id
      where (lower(coalesce(nullif(btrim(c.channel),''),'Others'))=lower(coalesce(nullif(btrim(p_channel),''),'all')) or lower(coalesce(p_channel,'all'))='all')
    ), requisition_history_any as materialized (
      select distinct doc_id from scoped_logs
    ), requisition_history_at_date as materialized (
      select distinct on (doc_id) doc_id,status from scoped_logs where log_date<=w.as_of order by doc_id,log_date asc,log_id desc
    ), requisition_filled_at_date as materialized (
      select doc_id,min(log_date) filled_log_date from scoped_logs where log_date<=w.as_of and status='filled' group by doc_id
    ), offer_by_doc as materialized (
      select doc_id,count(*) filter(where accepted_date<=w.as_of and (start_confirmation is distinct from 'did_not_start'
        or (start_confirmed_at at time zone 'Asia/Bangkok')::date>w.as_of))::integer accepted_at_date,
        max((start_confirmed_at at time zone 'Asia/Bangkok')::date) filter(where start_confirmation='did_not_start'
          and (start_confirmed_at at time zone 'Asia/Bangkok')::date<=w.as_of) no_show_date
      from scoped_offers group by doc_id
    ), req_state as (
      select r.*,case when ha.doc_id is not null then hd.status
        else case when (r.created_at at time zone 'Asia/Bangkok')::date>w.as_of then 'ongoing' else r.status end end state_at_date,
        hf.filled_log_date,coalesce(ob.accepted_at_date,0)::integer accepted_at_date,ob.no_show_date is not null has_no_show,ob.no_show_date
      from scoped_req r left join requisition_history_any ha on ha.doc_id=r.doc_id left join requisition_history_at_date hd on hd.doc_id=r.doc_id
        left join requisition_filled_at_date hf on hf.doc_id=r.doc_id left join offer_by_doc ob on ob.doc_id=r.doc_id
      where (r.created_at at time zone 'Asia/Bangkok')::date<=w.as_of and (r.pr_approved_date is null or r.pr_approved_date<=w.as_of)
    ), open_req as (
      select r.* from req_state r where coalesce(r.state_at_date,'ongoing')<>'cancel'
        and (coalesce(r.state_at_date,'ongoing')<>'filled' or (r.has_no_show and r.no_show_date>=r.filled_log_date))
        and greatest(coalesce(r.head_count,0)-r.accepted_at_date,0)>0
    ), contexts as (
      select c.application_id,c.candidate_id,c.name,c.group_id,count(distinct r.doc_id) filter(where r.doc_id is not null) req_count
      from app_context c left join open_req r on r.group_id=c.group_id group by c.application_id,c.candidate_id,c.name,c.group_id
    ), ranked_attempts as materialized (
      select a.*,count(*) filter(where a.outcome_date is null or a.outcome_date>w.as_of) over(partition by a.application_id)::integer unresolved_count,
        row_number() over(partition by a.application_id order by a.entry_date desc,a.round desc,a.log_id desc) latest_rank
      from attempts a where a.entry_date<=w.as_of and a.exclusion is null
    ), unresolved as (
      select a.* from ranked_attempts a where a.latest_rank=1 and (a.outcome_date is null or a.outcome_date>w.as_of)
    ), terminal_apps as (
      select application_id from terminal_events where terminal_date<=w.as_of
      union select application_id from accepted_apps where accepted_date<=w.as_of
    ), eligible_queue as (
      select u.*,c.name candidate_name,c.group_id,c.req_count,u.unresolved_count>1 conflict,(t.application_id is not null) terminal
      from unresolved u join contexts c on c.application_id=u.application_id left join terminal_apps t on t.application_id=u.application_id
      where c.req_count>0
    ), waiting_rows as (
      select q.*,greatest(w.as_of-q.entry_date,0)::integer wait_days,
        case when q.invalid_due or q.edited_date>w.as_of or (q.unreliable and w.as_of<(now() at time zone 'Asia/Bangkok')::date) then 'unavailable'
          when q.due_date is null then 'unscheduled' when q.due_date<w.as_of then 'overdue' when q.due_date=w.as_of then 'today' else 'upcoming' end status
      from eligible_queue q where not q.terminal and w.starts<=w.as_of
    ), stage_wait as (
      select stage,count(*)::integer waiting,max(wait_days)::integer oldest from waiting_rows group by stage
    ), status_counts as (
      select count(*)::integer waiting,count(*) filter(where status='overdue')::integer overdue,count(*) filter(where status='unavailable')::integer unavailable,
        max(wait_days)::integer longest,count(*) filter(where status='today')::integer today,count(*) filter(where status='upcoming')::integer upcoming,
        count(*) filter(where status='unscheduled')::integer unscheduled,count(*) filter(where conflict)::integer conflicts from waiting_rows
    ), pic_counts as (
      select coalesce(array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null),'{}'::text[]) pics
      from waiting_rows w join scoped_req r on r.group_id=w.group_id
    )
    , queue_summary as (
      select sc.*,coalesce((select jsonb_object_agg(stage,jsonb_build_object('waiting',waiting,'oldest',oldest)) from stage_wait where w.ord=0),'{}'::jsonb) stage_wait from status_counts sc
  ), eligible_attempts as (
    select x.* from attempts x join app_context c on c.application_id=x.application_id
    where (exists(select 1 from scoped_req r where r.group_id=coalesce((select aa.group_id from assignments aa
        where aa.assignment_id=case when x.result is null then x.entry_assignment_id else x.outcome_assignment_id end and aa.application_id=x.application_id),c.group_id))
      or not exists(select 1 from assignments aa where aa.assignment_id=case when x.result is null then x.entry_assignment_id else x.outcome_assignment_id end and aa.application_id=x.application_id)
        and exists(select 1 from scoped_req r where r.group_id=c.group_id))
  ), completed as (
    select * from eligible_attempts where result is not null and outcome_date between w.starts and w.as_of
  ), valid as (select * from completed where duration is not null and exclusion is null), stage_order as (
    select unnest(array['Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer']) stage,unnest(array[1,2,3,4,5,6]) ord
  ), completion_stats as (
    select stage,count(*)::integer sample,percentile_cont(.5) within group(order by duration)::numeric median,percentile_cont(.9) within group(order by duration)::numeric p90 from valid where w.ord=0 group by stage
  ), stage_rows as (
    select s.stage,coalesce(c.sample,0) sample,c.median,c.p90,
      coalesce((qs.stage_wait->s.stage->>'waiting')::integer,0) waiting,(qs.stage_wait->s.stage->>'oldest')::integer oldest,s.ord
    from stage_order s cross join queue_summary qs left join completion_stats c using(stage)
  ), primary_row as (select * from stage_rows where median is not null order by median desc,waiting desc,oldest desc nulls last,ord limit 1),
  channel_options as (select coalesce(jsonb_agg(distinct coalesce(nullif(btrim(c.channel),''),'Others') order by coalesce(nullif(btrim(c.channel),''),'Others')),'[]'::jsonb) values
    from authorized_candidates c),
  excluded as (select count(*)::integer n from eligible_attempts where exclusion is not null and ((outcome_date between w.starts and w.as_of) or (outcome_date is null and entry_date<=w.as_of))),
  med as (select percentile_cont(.5) within group(order by duration)::numeric value from valid)
  select jsonb_build_object('waiting',qs.waiting,'median',med.value,'overdue',qs.overdue,'longest',qs.longest,'unavailable',qs.unavailable) metrics,
    case when w.ord=0 then jsonb_build_object('asOf',w.as_of,'start',w.starts,'future',w.starts>w.as_of,'channel',coalesce(p_channel,'all'),
    'stages',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'sample',sample,'median',median,'p90',p90,'waiting',waiting,'oldest',oldest) order by ord) from stage_rows),'[]'::jsonb),
    'primary',(select jsonb_build_object('stage',stage,'sample',sample,'median',median,'p90',p90,'waiting',waiting,'oldest',oldest) from primary_row),
    'excluded',(select n from excluded),'conflicts',qs.conflicts,'statusCounts',jsonb_build_object('overdue',qs.overdue,'today',qs.today,'upcoming',qs.upcoming,'unscheduled',qs.unscheduled,'unavailable',qs.unavailable),'picOptions',to_jsonb((select pics from pic_counts)),'channelOptions',(select values from channel_options)) end detail
    from med cross join queue_summary qs
      ) report
    )
  select s.detail || jsonb_build_object('metrics',s.metrics,'priorMetrics',(select metrics from summaries where ord=-1),
    'priorRange',case when p_prior_start is null then null else jsonb_build_object('start',p_prior_start,'end',p_prior_end) end,
    'trends',coalesce((select jsonb_agg(metrics || jsonb_build_object('date',display_end,'overdue',case when (metrics->>'unavailable')::integer>0 then null else metrics->'overdue' end) order by ord) from summaries where ord>0),'[]'::jsonb))
  into v_result from summaries s where s.ord=0;
  return v_result;
end; $$;

create or replace function public.app_dashboard_bottleneck_queue_v1(
  p_as_of date,p_scope jsonb,p_channel text,p_stage text default null,p_status text default null,p_pic text default null,p_search text default '',
  p_after_value text default null,p_after_id text default null,p_before_value text default null,p_before_id text default null,p_limit integer default 20
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_resolved_status text; v_has_more boolean:=false; v_has_more_before boolean:=false; v_rows jsonb; v_first_value text; v_first_id text; v_last_value text; v_last_id text; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_as_of is null or p_limit is null or p_limit<1 or p_limit>20 or (p_after_value is null)<>(p_after_id is null)
    or (p_before_value is null)<>(p_before_id is null) or ((p_after_value is not null)::integer+(p_before_value is not null)::integer)>1
    or (p_after_value is null and p_before_value is null and (p_after_id is not null or p_before_id is not null)) then raise exception 'BOTTLENECK_CURSOR_INVALID'; end if;
  if p_status is not null and p_status not in ('auto','overdue','today','upcoming','unscheduled','unavailable') then raise exception 'BOTTLENECK_FILTER_INVALID'; end if;
  if p_stage is not null and p_stage not in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') then raise exception 'BOTTLENECK_FILTER_INVALID'; end if;
  if length(coalesce(p_search,''))>200 or jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels')) then raise exception 'BOTTLENECK_FILTER_INVALID'; end if;
  with authorized_candidates as materialized (
    select c.candidate_id,c.name,c.channel from public.candidates c where app_private.can_read_candidate(c.candidate_id)
  ), authorized_applications as materialized (
    select a.application_id,a.candidate_id,a.group_id from public.candidate_applications a where app_private.can_read_application(a.application_id)
  ), authorized_logs as materialized (
    select l.* from public.recruitment_logs l join authorized_candidates c on c.candidate_id=l.candidate_id
      left join authorized_applications a on a.application_id=l.application_id
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
      and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (l.application_id is null or a.application_id is not null)
  ), direct_rows as (
    select l.stage_instance_id::text attempt_id,l.application_id,l.candidate_id,l.recruitment_process stage,l.round,l.log_id,l.log_date entry_date,
      case when l.result is null then null else l.outcome_date end outcome_date,l.result,l.estimated_action_date due_date,
      (l.pending_edited_at at time zone 'Asia/Bangkok')::date edited_date,
      (l.record_origin='migration' and l.pending_edited_at is null) unreliable,false invalid_due,
      case when l.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(l.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when l.log_date is null then 'Missing or invalid entry date' when l.result is not null and l.outcome_date is null then 'Missing or invalid outcome date'
        when l.outcome_date is not null and l.outcome_date<l.log_date then 'Outcome precedes entry' else null end exclusion,
      l.entry_assignment_id,l.outcome_assignment_id
    from authorized_logs l where l.stage_instance_id is not null
  ), legacy_grouped as (
    select l.*,coalesce(sum(case when l.result is not null then 1 else 0 end) over(partition by l.application_id,l.recruitment_process,l.round
      order by l.log_date,l.log_id rows between unbounded preceding and 1 preceding),0)::integer pair_group
    from authorized_logs l where l.stage_instance_id is null
  ), pending_rows as (
    select l.*,row_number() over(partition by l.application_id,l.recruitment_process,l.round,l.pair_group order by l.log_date desc,l.log_id desc) pending_rank
    from legacy_grouped l where l.result is null
  ), outcome_rows as (
    select l.*,p.log_id pending_log_id,p.log_date pending_log_date,p.estimated_action_date pending_due,p.pending_edited_at pending_edited,p.record_origin pending_origin
    from legacy_grouped l left join lateral (select p.log_id,p.log_date,p.estimated_action_date,p.pending_edited_at,p.record_origin from pending_rows p
      where p.application_id=l.application_id and p.recruitment_process=l.recruitment_process and p.round=l.round and p.pair_group=l.pair_group
      order by p.log_date desc,p.log_id desc limit 1) p on true where l.result is not null
  ), paired_results as (
    select ('legacy-'||o.log_id::text) attempt_id,o.application_id,o.candidate_id,o.recruitment_process stage,o.round,o.log_id,o.pending_log_date entry_date,
      coalesce(o.outcome_date,o.log_date) outcome_date,o.result,coalesce(o.pending_due,o.estimated_action_date) due_date,(coalesce(o.pending_edited,o.pending_edited_at) at time zone 'Asia/Bangkok')::date edited_date,
      (coalesce(o.pending_origin,o.record_origin)='migration' and coalesce(o.pending_edited,o.pending_edited_at) is null) unreliable,false invalid_due,
      case when o.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(o.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when o.pending_log_date is null then 'Missing or invalid entry date'
        when coalesce(o.outcome_date,o.log_date) is null then 'Missing or invalid outcome date'
        when coalesce(o.outcome_date,o.log_date)<o.pending_log_date then 'Outcome precedes entry' else null end exclusion,o.entry_assignment_id,o.outcome_assignment_id
    from outcome_rows o
  ), standalone_pending as (
    select ('legacy-'||p.log_id::text) attempt_id,p.application_id,p.candidate_id,p.recruitment_process stage,p.round,p.log_id,p.log_date entry_date,
      null::date outcome_date,null::smallint result,p.estimated_action_date due_date,(p.pending_edited_at at time zone 'Asia/Bangkok')::date edited_date,
      (p.record_origin='migration' and p.pending_edited_at is null) unreliable,false invalid_due,
      case when p.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(p.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when p.log_date is null then 'Missing or invalid entry date' else null end exclusion,p.entry_assignment_id,p.outcome_assignment_id
    from pending_rows p where not exists(select 1 from outcome_rows o where o.application_id=p.application_id and o.recruitment_process=p.recruitment_process
      and o.round=p.round and o.pair_group=p.pair_group and o.pending_log_id=p.log_id)
  ), attempts as (
    select a.*,case when a.exclusion is null and a.entry_date is not null and a.outcome_date is not null then a.outcome_date-a.entry_date end::integer duration
    from (select * from direct_rows union all select * from paired_results union all select * from standalone_pending) a
  ), assignment_at_date as materialized (
    select distinct on (aa.application_id) aa.application_id,aa.group_id from public.candidate_application_assignments aa
    where (aa.started_at at time zone 'Asia/Bangkok')::date<=p_as_of and (aa.ended_at is null or (aa.ended_at at time zone 'Asia/Bangkok')::date>p_as_of)
    order by aa.application_id,aa.started_at desc,aa.assignment_id desc
  ), app_context as materialized (
    select a.application_id,a.candidate_id,c.name,coalesce(aa.group_id,a.group_id) group_id,
      lower(coalesce(nullif(btrim(c.channel),''),'Others')) channel_key
    from authorized_applications a join authorized_candidates c on c.candidate_id=a.candidate_id
    left join assignment_at_date aa on aa.application_id=a.application_id
    where (lower(coalesce(nullif(btrim(c.channel),''),'Others'))=lower(coalesce(nullif(btrim(p_channel),''),'all')) or lower(coalesce(p_channel,'all'))='all')
  ), scoped_req as (
    select r.doc_id,r.site,r.department,r.position,r.person_in_charge,r.level,r.is_priority,r.head_count,r.status,r.created_at,r.pr_approved_date,dg.group_id
    from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id
    where app_private.can_read_requisition(r.doc_id)
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band)
        where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(r.level from '([0-9]+)$')::integer between split_part(x.band,'-',1)::integer and split_part(x.band,'-',2)::integer))
  ), requisition_history_any as materialized (
    select distinct doc_id from public.requisition_logs
  ), requisition_history_at_date as materialized (
    select distinct on (doc_id) doc_id,status from public.requisition_logs where log_date<=p_as_of order by doc_id,log_date asc,log_id desc
  ), requisition_filled_at_date as materialized (
    select doc_id,min(log_date) filled_log_date from public.requisition_logs where log_date<=p_as_of and status='filled' group by doc_id
  ), offer_by_doc as materialized (
    select doc_id,count(*) filter(where accepted_date<=p_as_of and (start_confirmation is distinct from 'did_not_start'
      or (start_confirmed_at at time zone 'Asia/Bangkok')::date>p_as_of))::integer accepted_at_date,
      max((start_confirmed_at at time zone 'Asia/Bangkok')::date) filter(where start_confirmation='did_not_start'
        and (start_confirmed_at at time zone 'Asia/Bangkok')::date<=p_as_of) no_show_date
    from public.offers group by doc_id
  ), req_state as (
    select r.*,case when ha.doc_id is not null then hd.status
      else case when (r.created_at at time zone 'Asia/Bangkok')::date>p_as_of then 'ongoing' else r.status end end state_at_date,
      hf.filled_log_date,coalesce(ob.accepted_at_date,0)::integer accepted_at_date,ob.no_show_date is not null has_no_show,ob.no_show_date
    from scoped_req r left join requisition_history_any ha on ha.doc_id=r.doc_id left join requisition_history_at_date hd on hd.doc_id=r.doc_id
      left join requisition_filled_at_date hf on hf.doc_id=r.doc_id left join offer_by_doc ob on ob.doc_id=r.doc_id
    where (r.created_at at time zone 'Asia/Bangkok')::date<=p_as_of and (r.pr_approved_date is null or r.pr_approved_date<=p_as_of)
  ), open_req as (
    select r.* from req_state r where coalesce(r.state_at_date,'ongoing')<>'cancel'
      and (coalesce(r.state_at_date,'ongoing')<>'filled' or (r.has_no_show and r.no_show_date>=r.filled_log_date))
      and greatest(coalesce(r.head_count,0)-r.accepted_at_date,0)>0
  ), contexts as (
    select c.application_id,c.candidate_id,c.name,c.group_id,count(distinct r.doc_id) filter(where r.doc_id is not null) req_count
    from app_context c left join open_req r on r.group_id=c.group_id group by c.application_id,c.candidate_id,c.name,c.group_id
  ), ranked_attempts as materialized (
    select a.*,count(*) filter(where a.outcome_date is null or a.outcome_date>p_as_of) over(partition by a.application_id)::integer unresolved_count,
      row_number() over(partition by a.application_id order by a.entry_date desc,a.round desc,a.log_id desc) latest_rank
    from attempts a where a.entry_date<=p_as_of and a.exclusion is null
  ), unresolved as (
    select a.* from ranked_attempts a where a.latest_rank=1 and (a.outcome_date is null or a.outcome_date>p_as_of)
  ), terminal_apps as materialized (
    select t.application_id from public.recruitment_logs t join authorized_applications allowed_a on allowed_a.application_id=t.application_id
      join authorized_candidates allowed_c on allowed_c.candidate_id=t.candidate_id
    where t.application_id is not null and t.superseded_at is null and t.superseded_by_stage_instance_id is null
      and (t.recruitment_process in ('Rejected','Withdrawn') or t.result=0)
      and case when t.recruitment_process in ('Rejected','Withdrawn') or t.stage_instance_id is null then t.log_date else t.outcome_date end<=p_as_of
    group by t.application_id
    union
    select o.application_id from public.offers o where o.application_id is not null and o.accepted_date<=p_as_of and o.start_confirmation is distinct from 'did_not_start'
  ), eligible_queue as (
    select u.*,c.name candidate_name,c.group_id,c.req_count,u.unresolved_count>1 conflict,(t.application_id is not null) terminal
    from unresolved u join contexts c on c.application_id=u.application_id left join terminal_apps t on t.application_id=u.application_id where c.req_count>0
  ), normalized_queue as (
    select q.*,greatest(p_as_of-q.entry_date,0)::integer wait_days,
      case when q.invalid_due or q.edited_date>p_as_of or (q.unreliable and p_as_of<(now() at time zone 'Asia/Bangkok')::date) then 'unavailable'
        when q.due_date is null then 'unscheduled' when q.due_date<p_as_of then 'overdue' when q.due_date=p_as_of then 'today' else 'upcoming' end status
    from eligible_queue q where not q.terminal
  ), queue_status as (
    select case when p_status='auto' then case when exists(select 1 from normalized_queue where status='overdue') then 'overdue' end else p_status end resolved
  ), queue_source as (
    select q.*,lpad(case when status='overdue' then '0' else '1' end,1,'0')||':'||coalesce(to_char(due_date,'YYYY-MM-DD'),'9999-12-31')||':'||lpad(greatest(0,999999-wait_days)::text,6,'0') sort_value
    from normalized_queue q
  ), eligible as materialized (
    select q.* from queue_source q
    where (p_stage is null or q.stage=p_stage) and ((select resolved from queue_status) is null or q.status=(select resolved from queue_status))
      and (nullif(btrim(p_pic),'') is null or exists(select 1 from open_req r where r.group_id=q.group_id and lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_pic))))
      and (v_search='' or concat_ws(' ',q.candidate_id,
        case when q.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(q.candidate_id,'-',2),greatest(5,length(split_part(q.candidate_id,'-',2))),'0') else q.candidate_id end,
        q.group_id,case when q.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(q.group_id,'-',2),greatest(5,length(split_part(q.group_id,'-',2))),'0') else q.group_id end,
        q.candidate_name,q.application_id::text,q.stage) ilike '%'||v_search||'%'
        or exists(select 1 from scoped_req r where r.group_id=q.group_id and concat_ws(' ',r.group_id,
          case when r.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(r.group_id,'-',2),greatest(5,length(split_part(r.group_id,'-',2))),'0') else r.group_id end,
          r.doc_id,r.position,r.site,r.department,r.person_in_charge) ilike '%'||v_search||'%'))
  ),
  anchored as (
    select e.*,case when p_after_value is not null then (e.sort_value,e.application_id::text)>(p_after_value,p_after_id)
      when p_before_value is not null then (e.sort_value,e.application_id::text)<(p_before_value,p_before_id) else true end matches_cursor
    from eligible e
  ), page_raw as (
    select * from anchored where matches_cursor order by
      case when p_before_value is not null then sort_value end desc,
      case when p_before_value is not null then application_id::text end desc,
      case when p_before_value is null then sort_value end asc,
      case when p_before_value is null then application_id::text end asc
    limit p_limit+1
  ), selected as (select * from page_raw order by
      case when p_before_value is not null then sort_value end asc,
      case when p_before_value is not null then application_id::text end asc,
      case when p_before_value is null then sort_value end asc,
      case when p_before_value is null then application_id::text end asc limit p_limit),
  page_stats as (select min(sort_value) first_value,max(sort_value) last_value,
      (array_agg(application_id::text order by sort_value,application_id::text))[1] first_id,
      (array_agg(application_id::text order by sort_value desc,application_id::text desc))[1] last_id from selected),
  extra as (select count(*)::integer n from page_raw),
  items as (select coalesce(jsonb_agg(jsonb_build_object(
      'candidate',jsonb_build_object('candidate_id',s.candidate_id,'name',s.candidate_name,'application_id',s.application_id),
      'instance',jsonb_build_object('id',s.attempt_id,'logId',s.log_id,'candidateId',s.candidate_id,'applicationId',s.application_id,'groupId',s.group_id,
        'stage',s.stage,'round',s.round,'entry',s.entry_date,'outcome',s.outcome_date,'result',s.result,'due',s.due_date,'edited',s.edited_date,
        'unreliable',s.unreliable,'invalidDue',s.invalid_due,'duration',s.duration,'exclusion',s.exclusion),
      'requisitions',coalesce(detail.rows,'[]'::jsonb),'wait',s.wait_days,'status',s.status,'conflict',s.conflict) order by s.sort_value,s.application_id),'[]'::jsonb) rows
    from selected s cross join lateral(select jsonb_agg(jsonb_build_object('doc_id',r.doc_id,'position',r.position,'site',r.site,'department',r.department,'person_in_charge',r.person_in_charge) order by r.doc_id) rows
      from scoped_req r where r.group_id=s.group_id) detail)
  select (select n>p_limit from extra),(p_after_value is not null or (p_before_value is not null and (select n>p_limit from extra))),
    page_stats.first_value,page_stats.first_id,page_stats.last_value,page_stats.last_id,items.rows,coalesce((select resolved from queue_status),'all')
  into v_has_more,v_has_more_before,v_first_value,v_first_id,v_last_value,v_last_id,v_rows,v_resolved_status
  from page_stats cross join extra cross join items;
  if p_before_value is not null then v_has_more:=true; end if;
  return jsonb_build_object('rows',v_rows,'resolvedStatus',v_resolved_status,'hasMore',v_has_more,'hasMoreBefore',v_has_more_before,
    'nextCursor',case when v_has_more and v_last_id is not null then jsonb_build_object('value',v_last_value,'id',v_last_id) else null end,
    'previousCursor',case when v_has_more_before and v_first_id is not null then jsonb_build_object('value',v_first_value,'id',v_first_id) else null end);
end; $$;

commit;
