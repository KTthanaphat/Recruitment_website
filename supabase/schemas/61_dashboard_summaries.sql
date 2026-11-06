-- Company-wide report summaries preserve the guarded, anonymized population from 55.
create or replace function app_private.dashboard_performance_summary_range_v1(
  p_start date,
  p_end date,
  p_period text,
  p_scope jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id=auth.uid()) then
    raise exception 'AUTHENTICATED_PROFILE_REQUIRED';
  end if;
  with requisitions as (
    select r.doc_id,r.is_priority,r.pr_approved_date,r.site,r.position,r.department,r.section,
      r.level,r.head_count,r.person_in_charge,r.request_type,r.status,r.created_at
    from public.requisitions r
  ), requisition_logs as (
    select l.log_id,l.doc_id,l.log_date,l.status,l.remark,l.created_at from public.requisition_logs l
  ), offers as (
    select o.offer_id,null::text as candidate_id,o.doc_id,o.accepted_date,o.first_working_date,
      o.remark,o.start_confirmation,o.start_confirmed_at,null::uuid as start_confirmed_by,
      null::text as start_confirmation_reason,o.created_at,o.updated_at
    from public.offers o where o.accepted_date is not null
  ), scoped as (
    select r.*,
      case
        when btrim(coalesce(r.level,'')) !~* '^L?(0|[1-9]|1[0-4])$' then 'Unknown'
        when substring(btrim(r.level) from '([0-9]+)$')::integer <= 3 then 'NML'
        when substring(btrim(r.level) from '([0-9]+)$')::integer <= 6 then 'FML'
        when substring(btrim(r.level) from '([0-9]+)$')::integer <= 9 then 'MML'
        when substring(btrim(r.level) from '([0-9]+)$')::integer <= 12 then 'SML'
        else 'Executive'
      end as band,
      case
        when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::integer <= 6 then 30
        when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::integer <= 9 then 45
        when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then 60
        else null
      end as sla_days,
      greatest(coalesce(r.head_count,0),0) as capacity
    from requisitions r
    where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(coalesce(r.person_in_charge,''))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in (select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists (
        select 1 from jsonb_array_elements_text(p_scope->'levels') selected(band)
        where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$'
          and substring(btrim(r.level) from '([0-9]+)$')::integer between split_part(selected.band,'-',1)::integer and split_part(selected.band,'-',2)::integer
      ))
  ), state_at_end as (
    select r.*,
      coalesce((select l.status from requisition_logs l where l.doc_id=r.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1),
        case when r.created_at::date>p_end then 'ongoing' else r.status end) as period_status
    from scoped r
  ), eligibility_inputs as (
    select r.*,
      (select count(*) from offers o where o.doc_id=r.doc_id and o.accepted_date<=p_start-1 and
        (o.start_confirmation is distinct from 'did_not_start' or (o.start_confirmed_at is not null and o.start_confirmed_at::date>p_start-1))) as accepted_before,
      (select count(*) from offers o where o.doc_id=r.doc_id) as related_offer_count,
      exists(select 1 from requisition_logs l where l.doc_id=r.doc_id and l.status='filled' and l.log_date<p_start) as filled_before,
      exists(select 1 from offers o where o.doc_id=r.doc_id and o.start_confirmation='did_not_start' and o.start_confirmed_at::date between p_start and p_end) as reopened_in_range
    from state_at_end r
  ), eligible as (
    select r.*
    from eligibility_inputs r
    where r.pr_approved_date is not null and r.pr_approved_date<=p_end and r.period_status<>'cancel'
      and (not ((r.accepted_before>=r.head_count or (r.related_offer_count=0 and r.filled_before)) and not r.reopened_in_range))
      and (p_period in ('pim','custom') or (r.sla_days is not null and r.pr_approved_date+r.sla_days>=p_start))
  ), counted_candidates as (
    select r.doc_id,r.site,r.band,r.request_type,r.capacity,r.pr_approved_date,r.sla_days,
      o.offer_id,o.accepted_date,o.start_confirmation,o.start_confirmed_at,
      row_number() over(partition by r.doc_id order by o.accepted_date,o.offer_id) as accepted_rank
    from eligible r
    join offers o on o.doc_id=r.doc_id and o.accepted_date between p_start and p_end
      and (o.start_confirmation is distinct from 'did_not_start' or (o.start_confirmed_at is not null and o.start_confirmed_at::date>p_end))
  ), counted as (
    select c.*,
      case
        when c.sla_days is null then null
        when coalesce((select max(restart.start_confirmed_at::date) from offers restart where restart.doc_id=c.doc_id and restart.start_confirmation='did_not_start' and restart.start_confirmed_at::date<=c.accepted_date),c.pr_approved_date)>c.accepted_date then null
        when c.accepted_date-coalesce((select max(restart.start_confirmed_at::date) from offers restart where restart.doc_id=c.doc_id and restart.start_confirmation='did_not_start' and restart.start_confirmed_at::date<=c.accepted_date),c.pr_approved_date)<=c.sla_days then true
        else false
      end as in_sla,
      case when c.pr_approved_date is not null and c.accepted_date>=c.pr_approved_date then c.accepted_date-c.pr_approved_date else null end as days_to_fill
    from counted_candidates c
    where c.accepted_rank<=c.capacity
  ), counted_by_requisition as (
    select doc_id,count(*)::integer as filled,
      count(*) filter(where in_sla is true)::integer as on_time,
      count(*) filter(where in_sla is false)::integer as late,
      count(*) filter(where in_sla is null)::integer as unknown_sla
    from counted group by doc_id
  ), cells as (
    select r.site,r.band,
      sum(r.capacity)::integer as vacancies,
      sum(coalesce(c.filled,0))::integer as filled,
      greatest(sum(r.capacity)-sum(coalesce(c.filled,0)),0)::integer as open,
      sum(coalesce(c.on_time,0))::integer as on_time,
      sum(coalesce(c.late,0))::integer as late,
      sum(coalesce(c.unknown_sla,0))::integer as unknown_sla,
      sum(case when r.request_type='Replacement' then 0 else r.capacity end)::integer as new_vacancies,
      sum(case when r.request_type='Replacement' then r.capacity else 0 end)::integer as replacement_vacancies
    from eligible r left join counted_by_requisition c using(doc_id)
    group by r.site,r.band
  ), totals as (
    select coalesce(sum(vacancies),0)::integer as vacancies,coalesce(sum(filled),0)::integer as filled,
      coalesce(sum(on_time),0)::integer as on_time,coalesce(sum(late),0)::integer as late,coalesce(sum(unknown_sla),0)::integer as unknown_sla
    from cells
  ), time_totals as (
    select coalesce(sum(days_to_fill),0)::numeric as total, count(days_to_fill)::integer as count from counted
  ),
  final_cells as (
    select coalesce(jsonb_agg(jsonb_build_object('site',site,'band',band,'vacancies',vacancies,'filled',filled,'open',open,'onTime',on_time,'late',late,'unknownSla',unknown_sla,'newVacancies',new_vacancies,'replacementVacancies',replacement_vacancies)
      order by site,case band when 'NML' then 1 when 'FML' then 2 when 'MML' then 3 when 'SML' then 4 when 'Executive' then 5 else 6 end),'[]'::jsonb) as cells
    from cells
  ), site_json as (
    select coalesce(jsonb_agg(site order by site),'[]'::jsonb) as sites from (select distinct site from cells) s
  )
  select jsonb_build_object(
    'range',jsonb_build_object('start',p_start,'end',p_end),
    'metrics',jsonb_build_object('vacancies',t.vacancies,'filled',t.filled,'open',greatest(t.vacancies-t.filled,0),
      'filledPct',case when t.vacancies>0 then t.filled::numeric/t.vacancies*100 else null end,
      'slaPct',case when t.on_time+t.late>0 then t.on_time::numeric/(t.on_time+t.late)*100 else null end,
      'avgTimeToFill',case when tt.count>0 then tt.total/tt.count else null end,
      'onTime',t.on_time,'late',t.late,'unknownSla',t.unknown_sla),
    'cells',fc.cells,'sites',sj.sites
  ) into v_result
  from totals t cross join time_totals tt cross join final_cells fc cross join site_json sj;

  return v_result;
end;
$$;

create or replace function public.app_dashboard_performance_summary_v1(
  p_start date,
  p_end date,
  p_prior_start date,
  p_prior_end date,
  p_period text,
  p_scope jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_current jsonb;
  v_prior jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id=auth.uid()) then
    raise exception 'AUTHENTICATED_PROFILE_REQUIRED';
  end if;
  if p_start is null or p_end is null or p_prior_start is null or p_prior_end is null or p_start>p_end or p_prior_start>p_prior_end then
    raise exception 'REPORT_RANGE_INVALID';
  end if;
  if p_period not in ('mtd','ytd','pim','custom') then raise exception 'REPORT_PERIOD_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string')
    or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean')
    or exists(select 1 from unnest(array['sites','departments','levels']) k where p_scope ? k and jsonb_typeof(p_scope->k)<>'array')
    or exists(select 1 from unnest(array['sites','departments','levels']) k cross join lateral jsonb_array_elements(case when jsonb_typeof(p_scope->k)='array' then p_scope->k else '[]'::jsonb end) v where jsonb_typeof(v)<>'string') then raise exception 'REPORT_SCOPE_INVALID'; end if;
  v_current:=app_private.dashboard_performance_summary_range_v1(p_start,p_end,p_period,coalesce(p_scope,'{}'::jsonb));
  v_prior:=app_private.dashboard_performance_summary_range_v1(p_prior_start,p_prior_end,p_period,coalesce(p_scope,'{}'::jsonb));
  return jsonb_build_object('current',v_current,'prior',v_prior,'priorRange',jsonb_build_object('start',p_prior_start,'end',p_prior_end));
end;
$$;

revoke all on function app_private.dashboard_performance_summary_range_v1(date,date,text,jsonb) from public,anon;
grant execute on function app_private.dashboard_performance_summary_range_v1(date,date,text,jsonb) to authenticated;
revoke all on function public.app_dashboard_performance_summary_v1(date,date,date,date,text,jsonb) from public,anon,authenticated;
grant execute on function public.app_dashboard_performance_summary_v1(date,date,date,date,text,jsonb) to authenticated;

-- Bounded calendar events; rows are emitted only for applications readable by the caller.
create or replace function public.app_recruitment_calendar_v1(
  p_start date, p_end date, p_scope jsonb default '{}'::jsonb,
  p_after_date date default null, p_after_id text default null, p_limit integer default 200
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_events jsonb; v_count integer; v_has_more boolean; v_next_cursor jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_end-p_start>61 then raise exception 'CALENDAR_RANGE_INVALID'; end if;
  if p_limit is null or p_limit not in (50,100,200) or (p_after_date is null)<>(p_after_id is null) or (p_after_date is not null and (p_after_date<p_start or p_after_date>p_end or p_after_id='')) then raise exception 'CALENDAR_CURSOR_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'CALENDAR_SCOPE_INVALID'; end if;
  with rows as (
    select 'log:'||l.log_id::text as id,l.candidate_id,c.name,c.nickname,l.application_id,
      l.estimated_action_date as event_date,'stage'::text as event_type,l.estimated_action_date<((now() at time zone 'Asia/Bangkok')::date) as overdue,
      l.round,l.recruitment_process as stage,a.group_id, null::text as start_status,l.log_id,l.stage_instance_id,l.log_date,l.interviewer,l.remark,l.updated_at
    from public.recruitment_logs l
    join public.candidates c on c.candidate_id=l.candidate_id and app_private.can_read_candidate(c.candidate_id)
    join public.candidate_applications a on a.application_id=l.application_id and app_private.can_read_application(a.application_id)
    where l.result is null and l.superseded_at is null and l.superseded_by_stage_instance_id is null
      and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and l.estimated_action_date between p_start and p_end
    union all
    select 'offer:'||o.offer_id::text,o.candidate_id,c.name,c.nickname,o.application_id,
      o.first_working_date,'start_work',false,1,'Offer',a.group_id,
      case when o.start_confirmation='started' then 'started' when o.first_working_date<=((now() at time zone 'Asia/Bangkok')::date) then 'confirmation_pending' else 'scheduled' end,null::bigint,null::uuid,null::date,null::text,null::text,null::timestamptz
    from public.offers o
    join public.candidates c on c.candidate_id=o.candidate_id and app_private.can_read_candidate(c.candidate_id)
    join public.candidate_applications a on a.application_id=o.application_id and app_private.can_read_application(a.application_id)
    where o.accepted_date is not null and o.first_working_date between p_start and p_end
      and o.start_confirmation is distinct from 'did_not_start'
  ), visible as (
    select rows.*,coalesce(nullif(btrim(rows.name),''),nullif(btrim(rows.nickname),''),'-') || case when nullif(btrim(rows.name),'') is not null and nullif(btrim(rows.nickname),'') is not null then ' ('||btrim(rows.nickname)||')' else '' end as candidate_name,
      (select string_agg(distinct nullif(btrim(r.person_in_charge),''),', ' order by nullif(btrim(r.person_in_charge),'')) from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=rows.group_id
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)) as owner,
      (select string_agg(distinct r.site,', ' order by r.site) from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=rows.group_id
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)) as site,
      (select min(g.group_position) from public.position_groups g where g.group_id=rows.group_id) as position
    from rows
  ), scoped as (
    select * from visible where site is not null
  ), page_candidates as (
    select * from scoped where p_after_date is null or event_date>p_after_date or (event_date=p_after_date and id>p_after_id)
    order by event_date,id limit p_limit+1
  ), limited as (
    select * from page_candidates order by event_date,id limit p_limit
  )
  select (select count(*)>p_limit from page_candidates),
    coalesce((select count(*) from page_candidates),0),
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'candidateId',candidate_id,'applicationId',application_id,'candidateName',candidate_name,'date',event_date,'eventType',event_type,'overdue',overdue,'owner',owner,'round',round,'site',site,'stage',stage,'position',position,'startWorkStatus',start_status,'logId',log_id,'stageInstanceId',stage_instance_id,'logDate',log_date,'interviewer',interviewer,'remark',remark,'updatedAt',updated_at) order by event_date,id) from limited),'[]'::jsonb),
    (select jsonb_build_object('date',event_date,'id',id) from limited order by event_date desc,id desc limit 1)
  into v_has_more,v_count,v_events,v_next_cursor;
  if v_has_more and v_next_cursor is null then raise exception 'CALENDAR_CURSOR_INVALID'; end if;
  return jsonb_build_object('events',v_events,'hasMore',v_has_more,'nextCursor',case when v_has_more then v_next_cursor else null end);
end $$;

-- Compact Home values use the same access helpers as record reads; row lists stay paged.
create or replace function public.app_home_summary_v1(p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb; v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'HOME_SCOPE_INVALID'; end if;
  with scope_reqs as (
    select r.doc_id,r.is_priority,r.head_count,r.status,r.site,r.person_in_charge
    from public.requisitions r where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and app_private.can_read_requisition(r.doc_id)
  ), req as (
    select r.doc_id,r.is_priority,r.head_count,r.status,greatest(r.head_count-coalesce((select count(*) from public.offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start'),0),0) as open_headcount
    from scope_reqs r where r.status not in ('filled','cancel')
  ), scope_apps as (
    select a.application_id,a.candidate_id,a.group_id,a.state from public.candidate_applications a
    join public.candidates c on c.candidate_id=a.candidate_id and app_private.can_read_candidate(c.candidate_id)
    where app_private.can_read_application(a.application_id)
      and exists(select 1 from public.document_groups d join scope_reqs r using(doc_id) where d.group_id=a.group_id)
  ), active_apps as (
    select a.application_id,a.candidate_id,a.group_id from scope_apps a
    where a.state='active'
      and exists(select 1 from public.document_groups d join req r using(doc_id) where d.group_id=a.group_id)
  ), latest as (
    select distinct on (l.application_id) l.application_id,l.candidate_id,l.recruitment_process,l.result,l.estimated_action_date,l.log_id
    from public.recruitment_logs l join active_apps a using(application_id)
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc
  ), pipeline as (
    select recruitment_process as stage,count(*)::integer as count from latest
    where result is distinct from 0 and recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and not exists(select 1 from public.offers o where o.candidate_id=latest.candidate_id)
    group by recruitment_process
  ), pending as (
    select count(distinct (a.candidate_id,l.application_id))::integer as all_pending,
      count(distinct (a.candidate_id,l.application_id)) filter(where l.estimated_action_date<v_today)::integer as overdue
    from public.recruitment_logs l join active_apps a using(application_id)
    where l.result is null and l.superseded_at is null and l.superseded_by_stage_instance_id is null
  ), week as (select max(week_start) as latest_week from public.sourcing_weekly_updates),
  open_groups as (select distinct d.group_id from public.document_groups d join req r using(doc_id) where r.open_headcount>0),
  stale as (select count(*)::integer as n from open_groups g where not exists(select 1 from public.sourcing_weekly_updates u where u.group_id=g.group_id and (u.updated_at at time zone 'Asia/Bangkok')::date > v_today-6)),
  req_totals as (select count(*) filter(where open_headcount>0)::integer as open,count(*) filter(where open_headcount>0 and is_priority)::integer as priority_open from req),
  recent as (
    select coalesce(jsonb_agg(jsonb_build_object('log_id',l.log_id,'entity',l.entity,'entity_id',l.entity_id,'action',l.action,'changed_at',l.changed_at,'changed_by_email',l.changed_by_email) order by l.changed_at desc,l.log_id desc),'[]'::jsonb) as rows
    from (select cl.* from public.change_logs cl where
      (cl.entity='candidates' and exists(select 1 from scope_apps a where a.candidate_id=cl.entity_id))
      or (cl.entity='candidate_applications' and exists(select 1 from scope_apps a where a.application_id::text=cl.entity_id))
      or (cl.entity='requisitions' and exists(select 1 from scope_reqs r where r.doc_id=cl.entity_id))
      order by cl.changed_at desc,cl.log_id desc limit 10) l
  )
  select jsonb_build_object('requisitions',jsonb_build_object('open',req_totals.open,'priorityOpen',req_totals.priority_open),
    'candidatePipeline',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'count',count) order by case stage when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 else 6 end) from pipeline),'[]'::jsonb),
    'sourcing',jsonb_build_object('staleGroups',stale.n,'latestWeek',week.latest_week),
    'needsAction',jsonb_build_object('pendingCandidates',pending.all_pending,'overduePending',pending.overdue),'recentActivity',recent.rows,
    'workQueue',public.app_home_work_queue_v1(coalesce(p_scope,'{}'::jsonb),v_today),
    'counts',jsonb_build_object('openRequisitions',req_totals.open,'activePipeline',coalesce((select sum(count) from pipeline),0),'staleSourcing',stale.n,
      'pendingOffers',(select count(*)::integer from public.offers o join scope_reqs r using(doc_id) where o.accepted_date is not null and o.first_working_date is not null and o.first_working_date<=v_today and o.start_confirmation is null and app_private.can_read_application(o.application_id)),
      'qualityIssues',(public.app_home_quality_page_v1(coalesce(p_scope,'{}'::jsonb),v_today,null,null,null,1)->>'totalCount')::integer))
  into v_result from req_totals cross join stale cross join week cross join pending cross join recent;
  return v_result;
end $$;

revoke all on function public.app_recruitment_calendar_v1(date,date,jsonb,date,text,integer) from public,anon,authenticated;
grant execute on function public.app_recruitment_calendar_v1(date,date,jsonb,date,text,integer) to authenticated;
revoke all on function public.app_home_summary_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_home_summary_v1(jsonb) to authenticated;

create or replace function app_private.dashboard_filter_options_v1(p_scope jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'AUTHENTICATED_PROFILE_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites'))
    or jsonb_typeof(coalesce(p_scope->'sites','[]'::jsonb))<>'array'
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string')
    or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean')
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_scope->'sites')='array' then p_scope->'sites' else '[]'::jsonb end) v where jsonb_typeof(v)<>'string') then raise exception 'REPORT_SCOPE_INVALID'; end if;
  with feed as (select public.app_dashboard_company_report() as payload),
  report_requisitions as (
    select r.* from feed f cross join lateral jsonb_to_recordset(f.payload->'requisitions') as r(
      doc_id text,is_priority boolean,site text,department text,person_in_charge text)
  )
  select jsonb_build_object(
    'sites',coalesce((
      select jsonb_agg(s.site order by case s.site when 'HQ' then 1 when 'KT1' then 2 when 'KT2' then 3 else 4 end,s.site)
      from (select distinct r.site from report_requisitions r where nullif(r.site,'') is not null
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)) s
    ),'[]'::jsonb),
    'owners',coalesce((
      select jsonb_agg(o.owner order by o.owner)
      from (select distinct btrim(r.person_in_charge) owner from report_requisitions r where nullif(btrim(r.person_in_charge),'') is not null
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
        and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      ) o
    ),'[]'::jsonb),
    'departments',coalesce((
      select jsonb_agg(d.department order by d.department)
      from (select distinct r.department from report_requisitions r where nullif(r.department,'') is not null
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
        and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      ) d
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
create or replace function public.app_dashboard_filter_options_v1(p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'AUTHENTICATED_PROFILE_REQUIRED'; end if;
  return app_private.dashboard_filter_options_v1(coalesce(p_scope,'{}'::jsonb));
end $$;
revoke all on function app_private.dashboard_filter_options_v1(jsonb) from public,anon;
grant execute on function app_private.dashboard_filter_options_v1(jsonb) to authenticated;
revoke all on function public.app_dashboard_filter_options_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_dashboard_filter_options_v1(jsonb) to authenticated;
-- Database aggregates for the Pipeline funnel, Source effectiveness, and vacancy movements.
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
create or replace function app_private.dashboard_company_waterfall_v1(p_start date,p_end date,p_period text,p_scope jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'AUTHENTICATED_PROFILE_REQUIRED'; end if;
  with base as (
    select r.doc_id,r.site,r.department,r.person_in_charge,r.is_priority,r.level,r.head_count,r.request_type,r.status,r.pr_approved_date,r.created_at
    from public.requisitions r
    where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in (select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
  ), valid as (
    select b.*,
      (select l.status from public.requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) last_status,
      (select l.log_date from public.requisition_logs l where l.doc_id=b.doc_id and l.status='filled' and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) logged_filled,
      greatest(coalesce(b.head_count,0)-(select count(*) from public.offers o where o.doc_id=b.doc_id and o.accepted_date is not null and o.accepted_date<p_start and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'UTC')::date>=p_start)),0)::int open_at_start,
      (select max(o.accepted_date) from public.offers o where o.doc_id=b.doc_id and o.accepted_date<=p_end and (select count(*) from public.offers x where x.doc_id=b.doc_id and x.accepted_date is not null and x.accepted_date<=o.accepted_date and (x.start_confirmation is distinct from 'did_not_start' or x.start_confirmed_at is null or (x.start_confirmed_at at time zone 'UTC')::date>=p_end+1))>=b.head_count) offer_filled
    from base b
  ), eligible as (
    select v.*,coalesce(v.offer_filled,case when v.last_status='filled' then v.logged_filled end) filled_date,coalesce(v.pr_approved_date,(v.created_at at time zone 'UTC')::date) opened_date
    from valid v where v.pr_approved_date is not null and v.pr_approved_date<=p_end and v.last_status is distinct from 'cancel'
      and (v.last_status is not null or v.status is distinct from 'cancel')
      and (coalesce(v.offer_filled,case when v.last_status='filled' then v.logged_filled end) is null or coalesce(v.offer_filled,case when v.last_status='filled' then v.logged_filled end)>=p_start)
      and (p_period in ('pim','custom') or (case when btrim(coalesce(v.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then case when substring(btrim(v.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(v.level) from '([0-9]+)$')::int<=9 then 45 else 60 end end is not null and v.pr_approved_date+(case when substring(btrim(v.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(v.level) from '([0-9]+)$')::int<=9 then 45 else 60 end)>=p_start))
  ), movement as (
    select 'Week Start'::text category,e.site,coalesce(e.request_type,'New') request_type,e.open_at_start::int vacancy_count,0::int filled_in_sla,0::int filled_sla_unknown from eligible e where e.opened_date<p_start and e.open_at_start>0
    union all select 'Open',e.site,coalesce(e.request_type,'New'),e.head_count,0,0 from eligible e where e.opened_date between p_start and p_end
    union all select 'Filled',e.site,coalesce(e.request_type,'New'),-1,case when sla.in_sla is true then 1 else 0 end,case when sla.in_sla is null then 1 else 0 end
      from public.offers o join eligible e using(doc_id) cross join lateral (select coalesce((select max((n.start_confirmed_at at time zone 'UTC')::date) from public.offers n where n.doc_id=e.doc_id and n.start_confirmation='did_not_start' and (n.start_confirmed_at at time zone 'UTC')::date<=o.accepted_date),e.pr_approved_date) start_date) restart
      cross join lateral (select case when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([0-9]+)')::int between 0 and 6 then 30 when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([0-9]+)')::int between 7 and 9 then 45 when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([0-9]+)')::int between 10 and 14 then 60 else null end sla_days) sla_policy
      cross join lateral (select case when sla_policy.sla_days is null or restart.start_date is null or restart.start_date>o.accepted_date then null when o.accepted_date-restart.start_date<=sla_policy.sla_days then true else false end in_sla) sla
      where o.accepted_date between p_start and p_end and e.last_status is distinct from 'cancel'
    union all select 'Open',e.site,coalesce(e.request_type,'New'),1,0,0 from public.offers o join eligible e using(doc_id) where o.start_confirmation='did_not_start' and (o.start_confirmed_at at time zone 'UTC')::date between p_start and p_end and e.last_status is distinct from 'cancel'
  ), grouped as (select category,site,request_type,sum(vacancy_count)::int vacancy_count,sum(filled_in_sla)::int filled_in_sla,sum(filled_sla_unknown)::int filled_sla_unknown from movement group by category,site,request_type), allrows as (
    select * from grouped union all select 'Total',site,request_type,sum(vacancy_count)::int,sum(filled_in_sla)::int,sum(filled_sla_unknown)::int from grouped group by site,request_type
  ) select coalesce(jsonb_agg(jsonb_build_object('waterfall_category',category,'site',site,'request_type',request_type,'vacancy_count',vacancy_count,'filledInSla',filled_in_sla,'filledSlaUnknown',filled_sla_unknown) order by site,request_type,case category when 'Week Start' then 1 when 'Open' then 2 when 'Filled' then 3 else 4 end),'[]'::jsonb) into v_rows from allrows;
  return v_rows;
end;
$$;
revoke all on function app_private.dashboard_company_waterfall_v1(date,date,text,jsonb) from public,anon,authenticated;
grant execute on function app_private.dashboard_company_waterfall_v1(date,date,text,jsonb) to authenticated;
create or replace function public.app_dashboard_pipeline_summary_v1(
  p_start date, p_end date, p_period text, p_scope jsonb default '{}'::jsonb, p_channel text default 'all'
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_period not in ('mtd','ytd','pim','custom') then raise exception 'REPORT_RANGE_INVALID'; end if;
  if p_channel is null or btrim(p_channel)='' then raise exception 'PIPELINE_CHANNEL_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string')
    or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean')
    or exists(select 1 from unnest(array['sites','departments','levels']) k where p_scope ? k and jsonb_typeof(p_scope->k)<>'array')
    or exists(select 1 from unnest(array['sites','departments','levels']) k cross join lateral jsonb_array_elements(case when jsonb_typeof(p_scope->k)='array' then p_scope->k else '[]'::jsonb end) x where jsonb_typeof(x)<>'string') then raise exception 'PIPELINE_SCOPE_INVALID'; end if;
  v_result:=app_private.dashboard_pipeline_summary_data_v1(p_start,p_end,p_period,coalesce(p_scope,'{}'::jsonb),p_channel);
  v_result:=jsonb_set(v_result,'{waterfallRows}',app_private.dashboard_company_waterfall_v1(p_start,p_end,p_period,coalesce(p_scope,'{}'::jsonb)));
  return v_result;
end; $$;
revoke all on function public.app_dashboard_pipeline_summary_v1(date,date,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.app_dashboard_pipeline_summary_v1(date,date,text,jsonb,text) to authenticated;

-- Compact vacancy-risk aggregates; row drilldowns remain separate and caller-authorized.
create or replace function app_private.dashboard_risk_at_v1(p_as_of date,p_scope jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
with feed as (select public.app_dashboard_company_report() payload),
report_requisitions as (
  select x.* from feed f cross join lateral jsonb_to_recordset(f.payload->'requisitions') as x(
    doc_id text,is_priority boolean,pr_approved_date date,site text,position text,department text,section text,level text,head_count integer,
    person_in_charge text,line_manager text,request_type text,replacement_names text,status text,created_at timestamptz,updated_at timestamptz)
), report_logs as (
  select x.* from feed f cross join lateral jsonb_to_recordset(f.payload->'requisition_logs') as x(log_id bigint,doc_id text,log_date date,status text,remark text,created_at timestamptz)
), report_offers as (
  select x.* from feed f cross join lateral jsonb_to_recordset(f.payload->'offers') as x(offer_id bigint,candidate_id text,doc_id text,accepted_date date,first_working_date date,remark text,start_confirmation text,start_confirmed_at timestamptz,start_confirmed_by uuid,start_confirmation_reason text,created_at timestamptz,updated_at timestamptz)
), base as (
  select r.doc_id,r.site,r.department,r.is_priority,r.level,r.head_count,r.pr_approved_date,r.created_at,r.status,r.person_in_charge
  from report_requisitions r where true
    and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
    and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
    and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
    and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
    and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
), raw as (
  select b.*,latest.status latest_status,latest.log_date latest_log_date,
    greatest(coalesce(b.head_count,0)-(select count(*) from report_offers o where o.doc_id=b.doc_id and o.accepted_date<=p_as_of and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'Asia/Bangkok')::date>p_as_of)),0)::int covered_remaining,
    (select max((o.start_confirmed_at at time zone 'Asia/Bangkok')::date) from report_offers o where o.doc_id=b.doc_id and o.start_confirmation='did_not_start' and (o.start_confirmed_at at time zone 'Asia/Bangkok')::date<=p_as_of) restart_date,
    (coalesce(b.pr_approved_date,(b.created_at at time zone 'Asia/Bangkok')::date)<=p_as_of) existed
  from base b left join lateral(select l.status,l.log_date from report_logs l where l.doc_id=b.doc_id and l.log_date<=p_as_of order by l.log_date desc,l.log_id desc limit 1) latest on true
), open_rows as (
  select r.*,case when (r.latest_status='cancel' or (r.latest_status is null and r.status='cancel' and not exists(select 1 from report_logs l where l.doc_id=r.doc_id)) or not r.existed or (r.latest_status='filled' and not(r.restart_date is not null and r.restart_date>=r.latest_log_date))) then 0 else greatest(coalesce(r.head_count,0)-(coalesce(r.head_count,0)-r.covered_remaining),0) end::int as open,
    coalesce(r.restart_date,r.pr_approved_date) as start_date,
    case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between 0 and 6 then 30 when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between 7 and 9 then 45 when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then 60 else null end as sla_days
  from raw r
), classified as (
  select o.*,case when start_date is null or sla_days is null then null else start_date+sla_days-p_as_of end as remaining from open_rows o
), items as (
  select c.*,case when remaining is null then 'unknown' when remaining<0 then 'overdue' when remaining<=7 then 'near' else 'track' end as kind from classified c where open>0
), totals as (
  select coalesce(sum(open),0)::int open,coalesce(sum(open) filter(where kind='track'),0)::int track,coalesce(sum(open) filter(where kind='near'),0)::int near,
    coalesce(sum(open) filter(where kind='overdue'),0)::int overdue,coalesce(sum(open) filter(where kind='unknown'),0)::int unknown,
    coalesce(sum(open) filter(where is_priority),0)::int priorityOpen,coalesce(sum(open) filter(where is_priority and kind in ('near','overdue')),0)::int priority from items
), group_rows as (
  select 'site'::text grouping,site as name,kind,open,is_priority from items
  union all select 'department',department,kind,open,is_priority from items
  union all select 'department-site',site||' · '||department,kind,open,is_priority from items
), groups as (
  select grouping,name,jsonb_build_object('track',coalesce(sum(open) filter(where kind='track'),0),'near',coalesce(sum(open) filter(where kind='near'),0),'overdue',coalesce(sum(open) filter(where kind='overdue'),0),'unknown',coalesce(sum(open) filter(where kind='unknown'),0),'open',sum(open),'priorityOpen',coalesce(sum(open) filter(where is_priority),0),'priority',coalesce(sum(open) filter(where is_priority and kind in ('near','overdue')),0),'known',sum(open)-coalesce(sum(open) filter(where kind='unknown'),0),'exposure',case when sum(open)-coalesce(sum(open) filter(where kind='unknown'),0)>0 then (coalesce(sum(open) filter(where kind='near'),0)+coalesce(sum(open) filter(where kind='overdue'),0))::numeric/(sum(open)-coalesce(sum(open) filter(where kind='unknown'),0)) else null end) values
  from group_rows group by grouping,name
), group_json as (select grouping,coalesce(jsonb_agg(jsonb_build_object('name',name)||values order by name),'[]'::jsonb) values from groups group by grouping)
select jsonb_build_object('totals',jsonb_build_object('track',t.track,'near',t.near,'overdue',t.overdue,'unknown',t.unknown,'open',t.open,'priorityOpen',t.priorityOpen,'priority',t.priority,'known',t.open-t.unknown,'exposure',case when t.open-t.unknown>0 then (t.near+t.overdue)::numeric/(t.open-t.unknown) else null end),
 'groups',jsonb_build_object('site',coalesce((select values from group_json where grouping='site'),'[]'::jsonb),'department',coalesce((select values from group_json where grouping='department'),'[]'::jsonb),'department-site',coalesce((select values from group_json where grouping='department-site'),'[]'::jsonb))) from totals t;
$$;
revoke all on function app_private.dashboard_risk_at_v1(date,jsonb) from public,anon;
grant execute on function app_private.dashboard_risk_at_v1(date,jsonb) to authenticated;

create or replace function public.app_dashboard_risk_summary_v1(p_start date,p_end date,p_prior_start date,p_prior_end date,p_scope jsonb default '{}'::jsonb,p_trend_dates jsonb default '[]'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_as_of date;v_current jsonb;v_prior jsonb;v_trends jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_prior_start is null or p_prior_end is null or p_start>p_end or p_prior_start>p_prior_end then raise exception 'REPORT_RANGE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_trend_dates,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_trend_dates,'[]'::jsonb))>8 then raise exception 'REPORT_TRENDS_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string') or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean')
    or exists(select 1 from unnest(array['sites','departments','levels']) k where p_scope ? k and jsonb_typeof(p_scope->k)<>'array')
    or exists(select 1 from unnest(array['sites','departments','levels']) k cross join lateral jsonb_array_elements(case when jsonb_typeof(p_scope->k)='array' then p_scope->k else '[]'::jsonb end) x where jsonb_typeof(x)<>'string') then raise exception 'REPORT_SCOPE_INVALID'; end if;
  v_as_of:=least(p_end,(now() at time zone 'Asia/Bangkok')::date);
  v_current:=app_private.dashboard_risk_at_v1(v_as_of,coalesce(p_scope,'{}'::jsonb));
  if p_start>v_as_of then v_prior:=null; else v_prior:=app_private.dashboard_risk_at_v1(p_prior_end,coalesce(p_scope,'{}'::jsonb)); end if;
  select coalesce(jsonb_agg(jsonb_build_object('date',d::date,'totals',app_private.dashboard_risk_at_v1(d::date,coalesce(p_scope,'{}'::jsonb))->'totals') order by d),'[]'::jsonb) into v_trends from jsonb_array_elements_text(coalesce(p_trend_dates,'[]'::jsonb)) x(d);
  return jsonb_build_object('asOf',v_as_of,'future',p_start>v_as_of,'totals',v_current->'totals','groups',v_current->'groups','priorTotals',v_prior->'totals','priorRange',jsonb_build_object('start',p_prior_start,'end',p_prior_end),'trends',v_trends);
end $$;
revoke all on function public.app_dashboard_risk_summary_v1(date,date,date,date,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.app_dashboard_risk_summary_v1(date,date,date,date,jsonb,jsonb) to authenticated;

create or replace function public.app_dashboard_risk_page_v1(p_as_of date,p_scope jsonb default '{}'::jsonb,p_filter text default 'all',p_grouping text default 'department-site',p_group text default '',p_after_kind integer default null,p_after_remaining integer default null,p_after_open integer default null,p_after_doc text default null,p_limit integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_rows jsonb;v_total integer;v_has_more boolean;v_cursor jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_as_of is null or p_limit is null or p_limit not between 1 and 100 then raise exception 'RISK_PAGE_INVALID'; end if;
  if (p_after_doc is null)<>(p_after_kind is null) or (p_after_doc is null)<>(p_after_remaining is null) or (p_after_doc is null)<>(p_after_open is null) then raise exception 'RISK_CURSOR_INVALID'; end if;
  if p_filter is null or p_grouping is null or p_group is null or p_filter not in ('all','attention','track','near','overdue','unknown','priority') or p_grouping not in ('site','department','department-site') then raise exception 'RISK_FILTER_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string') or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean')
    or exists(select 1 from unnest(array['sites','departments','levels']) k where p_scope ? k and jsonb_typeof(p_scope->k)<>'array')
    or exists(select 1 from unnest(array['sites','departments','levels']) k cross join lateral jsonb_array_elements(case when jsonb_typeof(p_scope->k)='array' then p_scope->k else '[]'::jsonb end) x where jsonb_typeof(x)<>'string') then raise exception 'RISK_SCOPE_INVALID'; end if;
  with feed as (select public.app_dashboard_company_report() payload),
  report_requisitions as (
    select x.* from feed f cross join lateral jsonb_to_recordset(f.payload->'requisitions') as x(
      doc_id text,is_priority boolean,pr_approved_date date,site text,position text,department text,section text,level text,head_count integer,
      person_in_charge text,line_manager text,request_type text,replacement_names text,status text,created_at timestamptz,updated_at timestamptz)
  ), report_logs as (
    select x.* from feed f cross join lateral jsonb_to_recordset(f.payload->'requisition_logs') as x(log_id bigint,doc_id text,log_date date,status text,remark text,created_at timestamptz)
  ), report_offers as (
    select x.* from feed f cross join lateral jsonb_to_recordset(f.payload->'offers') as x(offer_id bigint,candidate_id text,doc_id text,accepted_date date,first_working_date date,remark text,start_confirmation text,start_confirmed_at timestamptz,start_confirmed_by uuid,start_confirmation_reason text,created_at timestamptz,updated_at timestamptz)
  ), base as (
    select r.doc_id,r.site,r.department,r.position,r.person_in_charge,r.is_priority,r.level,r.head_count,r.pr_approved_date,r.created_at,r.status
    from report_requisitions r where true
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
  ), raw as (
    select b.*,latest.status latest_status,latest.log_date latest_log_date,
      greatest(coalesce(b.head_count,0)-(select count(*) from report_offers o where o.doc_id=b.doc_id and o.accepted_date<=p_as_of and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'Asia/Bangkok')::date>p_as_of)),0)::int open,
      (select max((o.start_confirmed_at at time zone 'Asia/Bangkok')::date) from report_offers o where o.doc_id=b.doc_id and o.start_confirmation='did_not_start' and (o.start_confirmed_at at time zone 'Asia/Bangkok')::date<=p_as_of) restart
  from base b left join lateral(select l.status,l.log_date from report_logs l where l.doc_id=b.doc_id and l.log_date<=p_as_of order by l.log_date desc,l.log_id desc limit 1) latest on true
  ), items as (
    select r.*,coalesce(r.restart,r.pr_approved_date) start_date,
      case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between 0 and 6 then 30 when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between 7 and 9 then 45 when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then 60 else null end sla_days,
      (coalesce(r.pr_approved_date,(r.created_at at time zone 'Asia/Bangkok')::date)<=p_as_of and r.latest_status is distinct from 'cancel' and not(r.latest_status is null and r.status='cancel' and not exists(select 1 from report_logs l where l.doc_id=r.doc_id)) and (r.latest_status is distinct from 'filled' or (r.restart is not null and r.restart>=r.latest_log_date))) as open_at_asof
    from raw r
  ), classified as (
    select i.*,case when start_date is null or sla_days is null then null else start_date+sla_days-p_as_of end remaining from items i where open_at_asof and open>0
  ), filtered as (
    select c.*,case when remaining is null then 'unknown' when remaining<0 then 'overdue' when remaining<=7 then 'near' else 'track' end kind,
      case when remaining is null then 2147483647 else remaining end sort_remaining,
      case p_grouping when 'site' then site when 'department' then department else site||' · '||department end group_name,
      case when remaining is null then 1 else 0 end kind_rank
    from classified c
  ), matched as (
    select f.*,count(*) over()::int total_count from filtered f where
      (p_filter='all' or p_filter='priority' and is_priority and kind in ('near','overdue') or p_filter='attention' and kind in ('near','overdue') or p_filter=kind)
      and (p_group='' or p_group=group_name)
  ), page as (
    select * from matched m where p_after_doc is null or (m.kind_rank,m.sort_remaining,-m.open,m.doc_id)>(p_after_kind,p_after_remaining,-p_after_open,p_after_doc)
    order by kind_rank,sort_remaining,open desc,doc_id limit p_limit+1
  ), limited as (select * from page order by kind_rank,sort_remaining,open desc,doc_id limit p_limit)
  select coalesce((select jsonb_agg(jsonb_build_object('docId',doc_id,'site',site,'department',department,'position',position,'personInCharge',person_in_charge,'priority',is_priority,'level',level,'headCount',head_count,'open',open,'kind',kind,'startDate',start_date,'restartDate',restart,'age',case when start_date is null then null else p_as_of-start_date end,'remaining',remaining) order by kind_rank,sort_remaining,open desc,doc_id) from limited),'[]'::jsonb),coalesce((select max(total_count) from matched),0),exists(select 1 from page offset p_limit), (select jsonb_build_object('kind',kind_rank,'remaining',sort_remaining,'open',open,'docId',doc_id) from limited order by kind_rank desc,sort_remaining desc,open asc,doc_id desc limit 1)
  into v_rows,v_total,v_has_more,v_cursor;
  if v_has_more and v_cursor is null then raise exception 'RISK_CURSOR_INVALID'; end if;
  return jsonb_build_object('rows',v_rows,'total',v_total,'hasMore',v_has_more,'nextCursor',case when v_has_more then v_cursor else null end);
end $$;
revoke all on function public.app_dashboard_risk_page_v1(date,jsonb,text,text,text,integer,integer,integer,text,integer) from public,anon,authenticated;
grant execute on function public.app_dashboard_risk_page_v1(date,jsonb,text,text,text,integer,integer,integer,text,integer) to authenticated;

-- JSON key text must match the compact JSON.stringify representation persisted in URL filters.
create or replace function app_private.dashboard_json_compact_v1(p_value jsonb) returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare v_type text; v_result text;
begin
  v_type:=jsonb_typeof(p_value);
  if v_type='array' then
    select '['||coalesce(string_agg(app_private.dashboard_json_compact_v1(value),',' order by ordinality),'')||']' into v_result from jsonb_array_elements(p_value) with ordinality;
    return v_result;
  elsif v_type='object' then
    select '{'||coalesce(string_agg(to_json(key)::text||':'||app_private.dashboard_json_compact_v1(value),',' order by key),'')||'}' into v_result from jsonb_each(p_value);
    return v_result;
  end if;
  return p_value::text;
end $$;
revoke all on function app_private.dashboard_json_compact_v1(jsonb) from public,anon;
grant execute on function app_private.dashboard_json_compact_v1(jsonb) to authenticated;

-- Rejection event aggregation is caller-authorized and keeps candidate detail behind a separate page RPC.
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

-- Home queue is a compact ranked projection; operational tabs continue to use the list endpoints.
create or replace function public.app_home_work_queue_v1(p_scope jsonb default '{}'::jsonb,p_today date default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_today date:=coalesce(p_today,(now() at time zone 'Asia/Bangkok')::date);v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_today is not null and (p_today<(now() at time zone 'Asia/Bangkok')::date-3650 or p_today>(now() at time zone 'Asia/Bangkok')::date+3650) then raise exception 'HOME_DATE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'HOME_SCOPE_INVALID'; end if;
  with profile as (select p.role,p.site,coalesce(to_jsonb(p)->>'nickname','') nickname,coalesce(to_jsonb(p)->>'full_name','') full_name from public.profiles p where p.id=auth.uid()),
  scoped_reqs as materialized (select r.* from public.requisitions r where app_private.can_read_requisition(r.doc_id)
    and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
    and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)),
  reqs as (select r.*,greatest(r.head_count-coalesce(o.accepted,0),0)::integer open_headcount,
      coalesce(restart.restart_date,r.pr_approved_date) sla_start,
      case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then case when substring(btrim(r.level) from '([0-9]+)$')::integer<=6 then 30 when substring(btrim(r.level) from '([0-9]+)$')::integer<=9 then 45 else 60 end end sla_days
    from scoped_reqs r
    left join lateral (select count(*)::integer accepted from public.offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(o.application_id)) o on true
    left join lateral (select max(o.start_confirmed_at::date) restart_date from public.offers o where o.doc_id=r.doc_id and o.start_confirmation='did_not_start' and o.start_confirmed_at is not null and o.start_confirmed_at::date<=v_today) restart on true),
  req_items as (select 'req:'||r.doc_id id,coalesce(nullif(btrim(r.position),''),'-')||case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then ' (L'||substring(btrim(r.level) from '([0-9]+)$')||')' else '' end title,
    r.doc_id||' - '||coalesce(r.site,'-')||' - '||coalesce(r.person_in_charge,'Unassigned')||' - '||r.open_headcount||' open - '||(v_today-r.sla_start)||'d / '||r.sla_days||'d' meta,'Overdue SLA' action_label,
    10+greatest(v_today-r.sla_start,0) priority,'danger' tone,'requisition' type,r.doc_id record_id,1 sort_group
    from reqs r cross join profile p where r.status='ongoing' and r.open_headcount>0 and r.sla_start is not null and r.sla_days is not null and v_today-r.sla_start>r.sla_days
    and (p.role in ('system_admin','admin_recruiter','viewer') or (p.nickname<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(r.site,'') ilike '%'||p.site||'%'))),
  active_apps as (select a.application_id,a.candidate_id,a.group_id,c.name,c.nickname,to_jsonb(c)->>'home_site' home_site,(to_jsonb(c)->>'created_at')::timestamptz created_at,(to_jsonb(c)->>'updated_at')::timestamptz updated_at,
      (select l.log_date from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_touch,
      (select l.recruitment_process from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_stage,
      (select l.result from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_result,
      (select array_agg(distinct r.site) from public.document_groups d join reqs r using(doc_id) where d.group_id=a.group_id) sites,
      (select string_agg(distinct r.person_in_charge,', ') from public.document_groups d join reqs r using(doc_id) where d.group_id=a.group_id) owners
    from public.candidate_applications a join public.candidates c using(candidate_id)
    where a.state='active' and app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and exists(select 1 from public.document_groups d join scoped_reqs r using(doc_id) where d.group_id=a.group_id)),
  candidate_items as (select 'cand:'||c.candidate_id id,coalesce(nullif(btrim(c.name),''),nullif(btrim(c.nickname),''),'-')||case when nullif(btrim(c.nickname),'') is not null and nullif(btrim(c.name),'') is not null then ' ('||c.nickname||')' else '' end title,
      coalesce(nullif(array_to_string(c.sites,', '),''),to_jsonb(c)->>'home_site','-')||' - '||case c.latest_stage when 'Phone Screen' then 'Phone Screening' else coalesce(c.latest_stage,'No activity') end||' - last touched '||(v_today-coalesce(c.latest_touch::date,(to_jsonb(c)->>'updated_at')::date,(to_jsonb(c)->>'created_at')::date))||'d ago' meta,
      'Aging candidate' action_label,8+greatest(v_today-coalesce(c.latest_touch::date,(to_jsonb(c)->>'updated_at')::date,(to_jsonb(c)->>'created_at')::date),0) priority,'warning' tone,'candidate' type,c.candidate_id record_id,2 sort_group
    from active_apps c cross join profile p
    where c.latest_stage in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and c.latest_result is distinct from 0
      and not exists(select 1 from public.offers o where o.application_id=c.application_id)
      and v_today-coalesce(c.latest_touch::date,(to_jsonb(c)->>'updated_at')::date,(to_jsonb(c)->>'created_at')::date)>7
      and (p.role in ('system_admin','admin_recruiter','viewer') or (p.nickname<>'' and coalesce(c.owners,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(c.owners,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(array_to_string(c.sites,','),to_jsonb(c)->>'home_site','') ilike '%'||p.site||'%'))
    ),
  stale_groups as (select d.group_id,coalesce(pg.group_position,'-') group_position,array_agg(distinct r.doc_id order by r.doc_id) doc_ids,
      array_agg(distinct r.site) sites,string_agg(distinct r.person_in_charge,', ') owners,sum(r.open_headcount)::integer open_headcount,
      max(u.updated_at) latest_update
    from public.document_groups d join reqs r using(doc_id) left join public.position_groups pg using(group_id)
      left join public.sourcing_weekly_updates u on u.group_id=d.group_id
    where r.status not in ('filled','cancel') and r.open_headcount>0 group by d.group_id,pg.group_position
    having max(u.updated_at) is null or (v_today-max(u.updated_at at time zone 'Asia/Bangkok')::date)>14),
  source_items as (select 'source:'||g.group_id id,g.group_id||' - '||g.group_position title,g.open_headcount||' open - '||array_to_string(g.doc_ids,', ')||' - last saved '||coalesce((v_today-(g.latest_update at time zone 'Asia/Bangkok')::date)::text||'d ago','never') meta,
      'Stale sourcing' action_label,7+case when g.latest_update is null then 20 else greatest(v_today-(g.latest_update at time zone 'Asia/Bangkok')::date,0) end priority,'warning' tone,'sourcing' type,g.group_id record_id,3 sort_group
    from stale_groups g cross join profile p where (p.role<>'site_recruiter' or (p.nickname<>'' and coalesce(g.owners,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(g.owners,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(array_to_string(g.sites,','),'') ilike '%'||p.site||'%'))),
  offer_items as (select 'offer:'||o.offer_id id,coalesce(nullif(btrim(c.name),''),nullif(btrim(c.nickname),''),c.candidate_id,'-') title,
      coalesce(r.position,'-')||' - '||o.doc_id||' - '||case when o.accepted_date is not null then 'Missing start date' else 'Pending' end meta,
      case when o.accepted_date is not null then 'Missing start date' else 'Pending' end action_label,
      case when o.accepted_date is not null then 9 else 6+greatest(v_today-coalesce(o.created_at::date,v_today),0) end priority,
      case when o.accepted_date is not null then 'danger' else 'warning' end tone,'offer' type,c.candidate_id record_id,4 sort_group
    from public.offers o join reqs r on r.doc_id=o.doc_id join public.candidates c on c.candidate_id=o.candidate_id cross join profile p
    where (o.application_id is null or app_private.can_read_application(o.application_id)) and app_private.can_read_candidate(c.candidate_id)
      and (p.role in ('system_admin','admin_recruiter','viewer') or (p.nickname<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(r.site,'') ilike '%'||p.site||'%'))
      and o.start_confirmation is distinct from 'did_not_start' and o.start_confirmation is distinct from 'started'
      and (o.accepted_date is null or o.first_working_date is null)),
  all_items as (select * from req_items union all select * from candidate_items union all select * from source_items union all select * from offer_items),
  result as (select count(*)::integer total_count,coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'meta',meta,'actionLabel',action_label,'priority',priority,'recordId',record_id,'tone',tone,'type',type) order by priority desc,sort_group,id) from (select * from all_items order by priority desc,sort_group,id limit 10) top_rows),'[]'::jsonb) items from all_items)
  select jsonb_build_object('items',items,'totalCount',total_count) into v_result from result;
  return v_result;
end $$;
revoke all on function public.app_home_work_queue_v1(jsonb,date) from public,anon,authenticated;
grant execute on function public.app_home_work_queue_v1(jsonb,date) to authenticated;

-- Bounded operational issue feed; only caller-readable candidates/applications/requisitions contribute.
create or replace function public.app_home_quality_page_v1(p_scope jsonb default '{}'::jsonb,p_today date default null,p_after_severity integer default null,p_after_title text default null,p_after_id text default null,p_limit integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_today date:=coalesce(p_today,(now() at time zone 'Asia/Bangkok')::date);v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_limit not between 1 and 50 or (p_after_severity is null)<>(p_after_title is null) or (p_after_title is null)<>(p_after_id is null) then raise exception 'HOME_QUALITY_PAGE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','groupId','docId'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean')
    or (p_scope ? 'groupId' and (jsonb_typeof(p_scope->'groupId')<>'string' or p_scope->>'groupId'=''))
    or (p_scope ? 'docId' and (jsonb_typeof(p_scope->'docId')<>'string' or p_scope->>'docId'='')) then raise exception 'HOME_SCOPE_INVALID'; end if;
  with scoped_reqs as materialized (select r.* from public.requisitions r where app_private.can_read_requisition(r.doc_id)
    and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
    and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
    and (not (p_scope ? 'docId') or r.doc_id=p_scope->>'docId')
    and (not (p_scope ? 'groupId') or exists(select 1 from public.document_groups exact_link where exact_link.doc_id=r.doc_id and exact_link.group_id=p_scope->>'groupId'))),
  req_metrics as (select r.doc_id,r.is_priority,r.status,r.head_count,r.pr_approved_date,r.created_at,r.updated_at,r.site,r.department,r.position,r.level,r.person_in_charge,r.request_type,
      greatest(r.head_count-coalesce(o.accepted_count,0),0)::integer open_headcount,coalesce(o.accepted_count,0)::integer accepted_count,
      coalesce(c.candidate_count,0)::integer candidate_count,coalesce(g.group_ids,'{}'::text[]) group_ids
    from scoped_reqs r
    left join lateral (select count(*)::integer accepted_count from public.offers x where x.doc_id=r.doc_id and x.accepted_date is not null and x.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(x.application_id)) o on true
    left join lateral (select count(distinct a.application_id)::integer candidate_count from public.document_groups d join public.candidate_applications a on a.group_id=d.group_id and app_private.can_read_application(a.application_id) join public.candidates c on c.candidate_id=a.candidate_id and app_private.can_read_candidate(c.candidate_id) where d.doc_id=r.doc_id) c on true
    left join lateral (select array_agg(distinct d.group_id) filter(where d.group_id is not null) group_ids from public.document_groups d where d.doc_id=r.doc_id and (not (p_scope ? 'groupId') or d.group_id=p_scope->>'groupId')) g on true),
  visible_apps as materialized (select distinct a.application_id,a.candidate_id,a.group_id,c.name,c.nickname,to_jsonb(c)->>'phone_no' phone_no,to_jsonb(c)->>'candidate_folder_url' candidate_folder_url,(to_jsonb(a)->>'created_at')::timestamptz created_at,(to_jsonb(c)->>'updated_at')::timestamptz updated_at,c.channel
    from public.candidate_applications a join public.candidates c using(candidate_id)
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and (not (p_scope ? 'groupId') or a.group_id=p_scope->>'groupId')
      and exists(select 1 from public.document_groups d join scoped_reqs r using(doc_id) where d.group_id=a.group_id)),
  latest_apps as (select a.*,
      (select l.recruitment_process from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_process,
      (select l.result from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_result,
      (select l.log_date from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 else 6 end desc,l.round desc,l.log_id desc limit 1) latest_log_date,
      (select o.accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null order by o.accepted_date desc,o.offer_id desc limit 1) accepted_date
    from visible_apps a),
  candidate_rows as (select a.* from latest_apps a),
  authorized_candidates as materialized (
    select c.candidate_id,c.name,to_jsonb(c)->>'phone_no' phone_no,to_jsonb(c)->>'candidate_folder_url' candidate_folder_url
    from public.candidates c where app_private.can_read_candidate(c.candidate_id)
  ),
  candidate_match_keys as materialized (
    select candidate_id,'phone'::text match_kind,phone_no match_value from authorized_candidates where nullif(phone_no,'') is not null
    union all
    select candidate_id,'name',lower(btrim(name)) from authorized_candidates where name is not null
    union all
    select candidate_id,'folder',candidate_folder_url from authorized_candidates where nullif(candidate_folder_url,'') is not null
  ),
  duplicate_match_keys as materialized (
    select match_kind,match_value from candidate_match_keys group by match_kind,match_value having count(distinct candidate_id)>1
  ),
  duplicate_flags as materialized (
    select k.candidate_id,bool_or(k.match_kind='phone') has_phone,bool_or(k.match_kind='name') has_name,bool_or(k.match_kind='folder') has_folder
    from candidate_match_keys k join duplicate_match_keys d using(match_kind,match_value) group by k.candidate_id
  ),
  group_rows as (select d.group_id,pg.group_position,coalesce(sum(r.open_headcount),0)::integer open_headcount,
      array_agg(distinct r.doc_id order by r.doc_id) doc_ids,max(u.updated_at) latest_update,
      array_agg(distinct r.site) sites,string_agg(distinct r.person_in_charge,', ') owners
    from public.document_groups d join req_metrics r on d.doc_id=r.doc_id left join public.position_groups pg using(group_id)
    left join public.sourcing_weekly_updates u using(group_id) where r.status='ongoing' and (not (p_scope ? 'groupId') or d.group_id=p_scope->>'groupId') group by d.group_id,pg.group_position),
  issues as (
    select 'warning'::text severity,'candidate'::text entity,c.candidate_id entity_id,'Possible duplicate candidate'::text title,'Another record has the same phone, name, or folder URL.'::text detail,'Review candidate'::text action_label,
      '/candidates?detailType=candidate&detailId='||c.candidate_id href,'duplicateCandidate'::text workspace_code,
      jsonb_build_object('fields',concat_ws(',',case when d.has_phone then 'phone' end,case when d.has_name then 'name' end,case when d.has_folder then 'folder' end)) workspace_params,c.application_id::text journey_id
    from candidate_rows c join duplicate_flags d using(candidate_id)
    union all select 'info','candidate',c.candidate_id,'Candidate has no activity','Candidate has been created but has no process update.','Start process','/pipeline?detailType=candidate&detailId='||c.candidate_id,'candidateNoActivity',jsonb_build_object('days',v_today-c.created_at::date),c.application_id::text
      from candidate_rows c where c.latest_process is null and c.created_at is not null and v_today-c.created_at::date>2
    union all select 'warning','candidate',c.candidate_id,'Candidate linked to closed requisition',closed.doc_id||' is '||closed.status||'.','Review match','/workspace?type=requisition&id='||closed.doc_id,'candidateClosedRequest',jsonb_build_object('docId',closed.doc_id),c.application_id::text||':'||closed.doc_id
      from candidate_rows c join lateral (select r.doc_id,r.status from public.document_groups d join scoped_reqs r using(doc_id) where d.group_id=c.group_id and r.status<>'ongoing' order by r.doc_id limit 1) closed on true
      where c.latest_result is distinct from 0 and c.accepted_date is null
    union all select 'warning','requisition',r.doc_id,'Accepted offers meet headcount','Requisition is still ongoing even though accepted offers meet requested headcount.','Review status','/workspace?type=requisition&id='||r.doc_id,'headcountFilled','{}'::jsonb,r.doc_id::text from req_metrics r where r.status='ongoing' and r.open_headcount<=0
    union all select 'warning','requisition',r.doc_id,'Open headcount without candidates','No candidates are linked to this open requisition.','Add candidate','/workspace?type=requisition&id='||r.doc_id,'headcountNoCandidates',jsonb_build_object('open',r.open_headcount),r.doc_id::text from req_metrics r where r.status='ongoing' and r.open_headcount>0 and r.candidate_count=0
    union all select 'info','requisition',r.doc_id,'Sourcing update is stale','Open requisition has no sourcing update saved in the last 14 days.','Update sourcing','/workspace?type=requisition&id='||r.doc_id,'requisitionSourcingStale','{}'::jsonb,r.doc_id::text
      from req_metrics r where r.status='ongoing' and r.open_headcount>0 and cardinality(r.group_ids)>0 and not exists(select 1 from public.sourcing_weekly_updates u where u.group_id=any(r.group_ids) and (v_today-(u.updated_at at time zone 'Asia/Bangkok')::date)<=14)
    union all select 'warning','offer',o.offer_id::text,'Accepted offer missing first working date','Accepted offers need a first working date for follow-up and reporting.','Review offer','/offers?offerSearch='||o.candidate_id,'offerMissingStart',jsonb_build_object('candidateId',o.candidate_id),o.offer_id::text
      from public.offers o join public.candidates c on c.candidate_id=o.candidate_id and app_private.can_read_candidate(c.candidate_id) where (o.application_id is null or app_private.can_read_application(o.application_id)) and exists(select 1 from scoped_reqs r where r.doc_id=o.doc_id) and o.accepted_date is not null and o.first_working_date is null
    union all select 'warning','offer',o.offer_id::text,'New hire confirmation due','Confirm whether the candidate started work on the first working date.','Confirm start','/home','startConfirmationDue',jsonb_build_object('candidateId',o.candidate_id),o.offer_id::text
      from public.offers o join public.candidates c on c.candidate_id=o.candidate_id and app_private.can_read_candidate(c.candidate_id) where (o.application_id is null or app_private.can_read_application(o.application_id)) and exists(select 1 from scoped_reqs r where r.doc_id=o.doc_id) and o.accepted_date is not null and o.first_working_date is not null and o.start_confirmation is null and o.first_working_date<=v_today
    union all select 'info','offer',o.offer_id::text,'Offer may fill requisition','Accepted offers meet requested headcount while requisition remains ongoing.','Review requisition','/workspace?type=requisition&id='||o.doc_id,'offerFillsRequest',jsonb_build_object('docId',o.doc_id),o.offer_id::text
      from public.offers o join public.candidates c on c.candidate_id=o.candidate_id and app_private.can_read_candidate(c.candidate_id) join req_metrics r using(doc_id) where (o.application_id is null or app_private.can_read_application(o.application_id)) and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start' and r.status='ongoing' and r.accepted_count>=r.head_count
    union all select 'info','sourcing',g.group_id,'Sourcing group needs update','Open headcount exists but sourcing has not been updated in 14 days.','Update sourcing','/workspace?type=group&id='||g.group_id,'groupSourcingStale','{}'::jsonb,g.group_id::text
      from group_rows g where g.open_headcount>0 and (g.latest_update is null or v_today-(g.latest_update at time zone 'Asia/Bangkok')::date>14)
    union all select 'warning','pipeline',a.candidate_id,'Process history is out of order','A later log appears to move backward in the pipeline.','Review history','/candidates?detailType=candidate&detailId='||a.candidate_id,'pipelineOrder',jsonb_build_object('previous',bad.previous_stage,'later',bad.later_stage),a.application_id::text
      from candidate_rows a join lateral (with seq as (select l.recruitment_process,case l.recruitment_process when 'Resume Screening' then 1 when 'Phone Screen' then 2 when 'HR Interview' then 3 when 'Line Interview' then 4 when 'Test' then 5 when 'Reference Check' then 6 when 'Offer' then 7 else -1 end idx,row_number() over(order by l.log_date,l.log_id) rn
        from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null),ordered as (select *,max(idx) over(order by rn rows between unbounded preceding and 1 preceding) prior from seq where idx<>-1)
        select case when idx>=0 then (select recruitment_process from seq where idx=prior and rn<ordered.rn order by rn desc limit 1) else null end previous_stage,recruitment_process later_stage from ordered where prior>idx and recruitment_process<>'Test' order by rn limit 1) bad on true
  ),
  ranked as (select i.*,case severity when 'blocking' then 3 when 'warning' then 2 else 1 end severity_rank,(''||entity||':'||entity_id||':'||title) issue_id,(''||entity||':'||entity_id||':'||title||':'||coalesce(journey_id,'')) cursor_id,
      jsonb_build_object('id',entity||':'||entity_id||':'||title,'cursorId',entity||':'||entity_id||':'||title||':'||coalesce(journey_id,''),'severity',severity,'entity',entity,'entityId',entity_id,'title',title,'detail',detail,'actionLabel',action_label,'href',href,'workspaceCode',workspace_code,'workspaceParams',workspace_params) dto from issues i),
  counted as (select count(*)::integer total_count from ranked),
  page as (select * from ranked where p_after_severity is null or severity_rank<p_after_severity or (severity_rank=p_after_severity and (title>p_after_title or (title=p_after_title and cursor_id>p_after_id))) order by severity_rank desc,title,cursor_id limit p_limit+1),
  limited as (select * from page order by severity_rank desc,title,cursor_id limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(dto order by severity_rank desc,title,cursor_id) from limited),'[]'::jsonb),'totalCount',counted.total_count,'hasMore',exists(select 1 from page offset p_limit),
    'nextCursor',case when exists(select 1 from page offset p_limit) then (select jsonb_build_object('severity',severity_rank,'title',title,'id',cursor_id) from limited order by severity_rank asc,title desc,cursor_id desc limit 1) else null end)
    into v_result from counted;
  return v_result;
end $$;
revoke all on function public.app_home_quality_page_v1(jsonb,date,integer,text,text,integer) from public,anon,authenticated;
grant execute on function public.app_home_quality_page_v1(jsonb,date,integer,text,text,integer) to authenticated;

-- Compact sourcing chart inputs over the complete authorized lifecycle population.
create or replace function app_private.dashboard_sourcing_stage_channels_v1(p_group_id text,p_selected_week date,p_today date) returns jsonb
language sql stable security invoker set search_path='' as $$
with cutoff as (select least(p_selected_week+6,p_today) cutoff_day), candidates as (
  select c.candidate_id,c.channel from public.candidates c cross join cutoff t
  where app_private.can_read_candidate(c.candidate_id)
    and coalesce((to_jsonb(c)->>'first_contact_date')::date,left(to_jsonb(c)->>'created_at',10)::date)<=t.cutoff_day
    and exists(select 1 from public.recruitment_logs l join public.candidate_application_assignments a on a.assignment_id=l.entry_assignment_id where l.candidate_id=c.candidate_id and a.group_id=p_group_id)
), logs as (
  select c.candidate_id,c.channel,l.log_id,l.stage_instance_id,l.recruitment_process,l.round,l.result,l.log_date,l.superseded_at,l.superseded_by_stage_instance_id
  from candidates c join public.recruitment_logs l on l.candidate_id=c.candidate_id cross join cutoff t
  where l.log_date<=t.cutoff_day and l.superseded_at is null and l.superseded_by_stage_instance_id is null
    and exists(select 1 from public.candidate_application_assignments a where a.assignment_id=l.entry_assignment_id and a.group_id=p_group_id)
    and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
), canonical as (
  select candidate_id,recruitment_process stage,channel from logs where stage_instance_id is not null
  and exists(select 1 from logs x where x.candidate_id=logs.candidate_id and x.stage_instance_id is not null)
), legacy as (
  select distinct on(candidate_id,recruitment_process,round) candidate_id,recruitment_process stage,channel
  from logs where stage_instance_id is null order by candidate_id,recruitment_process,round,case when result is null then 0 else 1 end,case when result is null then log_id end asc,case when result is not null then log_id end desc
), reached as (select * from canonical union all select l.* from legacy l where not exists(select 1 from canonical c where c.candidate_id=l.candidate_id)),
stages as (select unnest(array['Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer']) stage,unnest(array[1,2,3,4,5,6]) rank),
keys as (select unnest(array['channel_fb','channel_jobthai','channel_jobtopgun','channel_jobdb','channel_jobbkk','channel_linkedin','channel_walkin','channel_referral','channel_others','unknown']) key),
counts as (select s.stage,s.rank,k.key,count(distinct r.candidate_id)::integer count from stages s cross join keys k left join reached r on r.stage=s.stage and k.key=case lower(btrim(coalesce(r.channel,''))) when 'facebook' then 'channel_fb' when 'jobthai' then 'channel_jobthai' when 'jobtopgun' then 'channel_jobtopgun' when 'jobsdb' then 'channel_jobdb' when 'jobbkk' then 'channel_jobbkk' when 'linkedin' then 'channel_linkedin' when 'walk-in' then 'channel_walkin' when 'referral' then 'channel_referral' when 'others' then 'channel_others' else 'unknown' end group by s.stage,s.rank,k.key),
stage_json as (select stage,rank,sum(count)::integer total,coalesce(jsonb_agg(jsonb_build_object('key',key,'count',count) order by case key when 'channel_fb' then 1 when 'channel_jobthai' then 2 when 'channel_jobtopgun' then 3 when 'channel_jobdb' then 4 when 'channel_jobbkk' then 5 when 'channel_linkedin' then 6 when 'channel_walkin' then 7 when 'channel_referral' then 8 when 'channel_others' then 9 else 10 end) filter(where count>0),'[]'::jsonb) segments from counts group by stage,rank)
select jsonb_build_object('cutoff',least(p_selected_week+6,p_today),'stages',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'total',total,'segments',segments) order by rank) from stage_json),'[]'::jsonb),
 'legend',coalesce((select jsonb_agg(key order by ord) from (select k.key,case k.key when 'channel_fb' then 1 when 'channel_jobthai' then 2 when 'channel_jobtopgun' then 3 when 'channel_jobdb' then 4 when 'channel_jobbkk' then 5 when 'channel_linkedin' then 6 when 'channel_walkin' then 7 when 'channel_referral' then 8 when 'channel_others' then 9 else 10 end ord from keys k where exists(select 1 from counts c where c.key=k.key and c.count>0)) x),'[]'::jsonb))
$$;
revoke all on function app_private.dashboard_sourcing_stage_channels_v1(text,date,date) from public,anon;
grant execute on function app_private.dashboard_sourcing_stage_channels_v1(text,date,date) to authenticated;

create or replace function public.app_recruitment_sourcing_summary_v1(p_selected_week date,p_group_id text default null,p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;v_today date:=(timezone('Asia/Bangkok',now())::date);
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_selected_week is null or jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'SOURCING_SUMMARY_SCOPE_INVALID'; end if;
  with group_bounds as materialized (
    select d.group_id,min(r.pr_approved_date) first_approved,bool_and(r.status in ('filled','cancel')) all_terminal,
      max(case when r.status in ('filled','cancel') then coalesce((select max(l.log_date) from public.requisition_logs l where l.doc_id=r.doc_id and l.status in ('filled','cancel')),r.updated_at::date) end) terminal_day,
      bool_or(pg.channel_fb) channel_fb,bool_or(pg.channel_jobthai) channel_jobthai,bool_or(pg.channel_jobtopgun) channel_jobtopgun,bool_or(pg.channel_jobdb) channel_jobdb,
      bool_or(pg.channel_jobbkk) channel_jobbkk,bool_or(pg.channel_linkedin) channel_linkedin,bool_or(pg.channel_walkin) channel_walkin,bool_or(pg.channel_referral) channel_referral,bool_or(pg.channel_others) channel_others
    from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id join public.position_groups pg on pg.group_id=d.group_id
    where app_private.can_read_requisition(r.doc_id) and app_private.can_read_sourcing_group(d.group_id)
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
    group by d.group_id
  ), bounds as (
    select b.*,coalesce(first_approved,v_today)-((extract(dow from coalesce(first_approved,v_today))::integer+1)%7) start_week,
      case when all_terminal then coalesce(terminal_day,v_today)-((extract(dow from coalesce(terminal_day,v_today))::integer+1)%7) else v_today-((extract(dow from v_today)::integer+1)%7) end end_week
    from group_bounds b where p_group_id is null or b.group_id=p_group_id
  ), slots as (
    select b.group_id,g.group_position,gs.week_start::date week_start,b.channel_fb,b.channel_jobthai,b.channel_jobtopgun,b.channel_jobdb,b.channel_jobbkk,b.channel_linkedin,b.channel_walkin,b.channel_referral,b.channel_others,
      u.week_start update_week,u.updated_at update_at,u.channel_fb u_fb,u.channel_jobthai u_jobthai,u.channel_jobtopgun u_jobtopgun,u.channel_jobdb u_jobdb,u.channel_jobbkk u_jobbkk,u.channel_linkedin u_linkedin,u.channel_walkin u_walkin,u.channel_referral u_referral,u.channel_others u_others,
      u.applicants_fb,u.applicants_jobthai,u.applicants_jobtopgun,u.applicants_jobdb,u.applicants_jobbkk,u.applicants_linkedin,u.applicants_walkin,u.applicants_referral,u.applicants_others
    from bounds b join public.position_groups g using(group_id) cross join lateral generate_series(b.start_week,b.end_week,interval '7 days') gs(week_start)
    left join lateral(select x.* from public.sourcing_weekly_updates x where x.group_id=b.group_id and x.week_start in (gs.week_start::date,gs.week_start::date+2) and app_private.can_read_sourcing_group(x.group_id) order by case when x.week_start=gs.week_start::date then 0 else 1 end,x.updated_at desc limit 1) u on true
    where gs.week_start::date<=p_selected_week
  ), normalized as (
    select s.*,coalesce(u_fb,channel_fb,false) efb,coalesce(u_jobthai,channel_jobthai,false) ejobthai,coalesce(u_jobtopgun,channel_jobtopgun,false) ejobtopgun,
      coalesce(u_jobdb,channel_jobdb,false) ejobdb,coalesce(u_jobbkk,channel_jobbkk,false) ejobbkk,coalesce(u_linkedin,channel_linkedin,false) elinkedin,
      coalesce(u_walkin,channel_walkin,false) ewalkin,coalesce(u_referral,channel_referral,false) ereferral,coalesce(u_others,channel_others,false) eothers
    from slots s
  ), calculated as (
    select n.*,case when update_week is null then null when (efb or ejobthai or ejobtopgun or ejobdb or ejobbkk or elinkedin or ewalkin or ereferral or eothers)
      and ((efb and applicants_fb is null) or (ejobthai and applicants_jobthai is null) or (ejobtopgun and applicants_jobtopgun is null) or (ejobdb and applicants_jobdb is null) or (ejobbkk and applicants_jobbkk is null) or (elinkedin and applicants_linkedin is null) or (ewalkin and applicants_walkin is null) or (ereferral and applicants_referral is null) or (eothers and applicants_others is null)) then null
      when not (efb or ejobthai or ejobtopgun or ejobdb or ejobbkk or elinkedin or ewalkin or ereferral or eothers) then null
      else (case when efb then applicants_fb else 0 end)+(case when ejobthai then applicants_jobthai else 0 end)+(case when ejobtopgun then applicants_jobtopgun else 0 end)+(case when ejobdb then applicants_jobdb else 0 end)+(case when ejobbkk then applicants_jobbkk else 0 end)+(case when elinkedin then applicants_linkedin else 0 end)+(case when ewalkin then applicants_walkin else 0 end)+(case when ereferral then applicants_referral else 0 end)+(case when eothers then applicants_others else 0 end) end::integer applicants,
      (update_week is not null and (efb or ejobthai or ejobtopgun or ejobdb or ejobbkk or elinkedin or ewalkin or ereferral or eothers)
        and not ((efb and applicants_fb is null) or (ejobthai and applicants_jobthai is null) or (ejobtopgun and applicants_jobtopgun is null) or (ejobdb and applicants_jobdb is null) or (ejobbkk and applicants_jobbkk is null) or (elinkedin and applicants_linkedin is null) or (ewalkin and applicants_walkin is null) or (ereferral and applicants_referral is null) or (eothers and applicants_others is null))) saved
    from normalized n
  ), totals as (
    select count(*)::integer expected_rows,count(*) filter(where update_week is not null)::integer updated_weeks,
      coalesce(sum(applicants) filter(where saved),0)::integer total_applicants,
      count(*) filter(where group_id=p_group_id and week_start=p_selected_week and saved)::integer selected_saved,
      count(*) filter(where saved)::integer saved_rows,
      sum(applicants) filter(where group_id=p_group_id and week_start=p_selected_week and saved)::integer selected_applicants
    from calculated
  ), channels as (
    select coalesce(sum(applicants_fb) filter(where saved and efb),0)::integer channel_fb,coalesce(sum(applicants_jobthai) filter(where saved and ejobthai),0)::integer channel_jobthai,
      coalesce(sum(applicants_jobtopgun) filter(where saved and ejobtopgun),0)::integer channel_jobtopgun,coalesce(sum(applicants_jobdb) filter(where saved and ejobdb),0)::integer channel_jobdb,
      coalesce(sum(applicants_jobbkk) filter(where saved and ejobbkk),0)::integer channel_jobbkk,coalesce(sum(applicants_linkedin) filter(where saved and elinkedin),0)::integer channel_linkedin,
      coalesce(sum(applicants_walkin) filter(where saved and ewalkin),0)::integer channel_walkin,coalesce(sum(applicants_referral) filter(where saved and ereferral),0)::integer channel_referral,
      coalesce(sum(applicants_others) filter(where saved and eothers),0)::integer channel_others from calculated
  ), weekly as (
    select week_start,count(*)::integer expected_rows,count(*) filter(where update_week is not null)::integer updated_rows,
      case when count(*) filter(where not saved)>0 then null when bool_or(applicants is null) then null else coalesce(sum(applicants),0)::integer end applicants
    from calculated group by week_start order by week_start desc limit 8
  ), selected_update as (
    select * from calculated where group_id=p_group_id and week_start=p_selected_week limit 1
  )
  select jsonb_build_object('selectedWeek',p_selected_week,'groupId',p_group_id,'totalApplicants',case when t.saved_rows=0 then null else t.total_applicants end,
    'selectedApplicants',case when t.selected_saved>0 then t.selected_applicants else null end,'expectedRows',t.expected_rows,'updatedWeeks',t.updated_weeks,
    'completeness',case when t.expected_rows=0 then 0 else round(t.updated_weeks::numeric/t.expected_rows*100)::integer end,
    'channels',jsonb_build_object('channel_fb',ch.channel_fb,'channel_jobthai',ch.channel_jobthai,'channel_jobtopgun',ch.channel_jobtopgun,'channel_jobdb',ch.channel_jobdb,'channel_jobbkk',ch.channel_jobbkk,'channel_linkedin',ch.channel_linkedin,'channel_walkin',ch.channel_walkin,'channel_referral',ch.channel_referral,'channel_others',ch.channel_others),
    'weeks',coalesce((select jsonb_agg(jsonb_build_object('week_start',week_start,'expectedRows',expected_rows,'updatedRows',updated_rows,'applicants',applicants) order by week_start desc) from weekly),'[]'::jsonb),
    'stageChannels',case when p_group_id is null then null else app_private.dashboard_sourcing_stage_channels_v1(p_group_id,p_selected_week,v_today) end)
  into v_result from totals t cross join channels ch;
  return v_result;
end $$;
revoke all on function public.app_recruitment_sourcing_summary_v1(date,text,jsonb) from public,anon,authenticated;
grant execute on function public.app_recruitment_sourcing_summary_v1(date,text,jsonb) to authenticated;

-- Date-filtered requisition rows for the Vacancy Waterfall report. This stays
-- invoker/RLS scoped and returns a bounded cursor page; full exports use the
-- separately authorized complete-read loader.
drop function if exists public.app_dashboard_active_requisitions_page_v1(date,date,text,text,jsonb,text,text,integer);
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

create or replace function public.app_dashboard_active_requisition_candidates_v1(
  p_doc_id text,p_stage text,p_start date,p_end date,p_requisition_date date,p_stage_mode text,
  p_after_name text default null,p_after_application_id uuid default null,p_limit integer default 25
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if not app_private.can_read_requisition(p_doc_id) then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if nullif(btrim(p_doc_id),'') is null or p_start is null or p_end is null or p_start>p_end or p_stage not in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') or p_stage_mode not in ('status','activity','accum') then raise exception 'REPORT_DRILLDOWN_INVALID'; end if;
  if p_limit is null or p_limit not in (1,25,50) or (p_after_name is null)<>(p_after_application_id is null) then raise exception 'REPORT_CURSOR_INVALID'; end if;
  with doc_groups as materialized(select d.doc_group_id,d.group_id from public.document_groups d where d.doc_id=p_doc_id and d.group_id is not null), candidates as (
    select distinct ca.application_id,c.candidate_id,c.name,coalesce(ca.group_id,c.group_id) group_id
    from doc_groups d join public.candidate_applications ca on ca.group_id=d.group_id
    join public.candidates c on c.candidate_id=ca.candidate_id and app_private.can_read_candidate(c.candidate_id)
    where app_private.can_read_application(ca.application_id)
  ), matching as (
    select c.application_id,c.candidate_id,c.name,l.log_id,l.log_date,l.outcome_date,l.result,l.outcome_remark,l.remark,
      row_number() over(partition by c.application_id order by case when p_stage_mode='accum' then l.log_date end asc,case when p_stage_mode='accum' then l.log_id end asc,
        case when p_stage_mode='status' then l.log_date end desc,case when p_stage_mode='status' then l.log_id end desc,l.log_id asc) rn
    from candidates c join public.recruitment_logs l on l.candidate_id=c.candidate_id and l.application_id=c.application_id
    left join public.candidate_application_assignments a on a.assignment_id=case when l.result is null then l.entry_assignment_id else l.outcome_assignment_id end and a.application_id=c.application_id
    where l.recruitment_process=p_stage and l.superseded_at is null
      and (a.group_id=c.group_id or a.assignment_id is null)
      and case p_stage_mode when 'activity' then (case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end) between p_start and p_end
        when 'accum' then p_requisition_date is not null and l.log_date between p_requisition_date and p_end
        else l.log_date<=p_end and (l.outcome_date is null or l.outcome_date>p_end or l.result is null) end
  ), selected as (select * from matching m where m.rn=1 and (p_after_name is null or (m.name,m.application_id)>(p_after_name,p_after_application_id))), page_raw as (
    select * from selected order by name,application_id limit p_limit+1
  ), page_rows as (select * from page_raw order by name,application_id limit p_limit), total as (select count(*)::integer n from matching where rn=1), page_info as (select count(*)>p_limit more from page_raw)
  select jsonb_build_object('matches',coalesce((select jsonb_agg(jsonb_build_object('applicationId',application_id,'candidateId',candidate_id,'name',name,'stage',p_stage,'pendingDate',log_date,'resultDate',outcome_date,'remark',coalesce(outcome_remark,remark),'result',result) order by name,application_id) from page_rows),'[]'::jsonb),
    'total',(select n from total),'hasMore',(select more from page_info),'nextCursor',case when (select more from page_info) then (select jsonb_build_object('name',name,'applicationId',application_id) from page_rows order by name desc,application_id desc limit 1) else null end)
  into v_result;
  return v_result;
end $$;
revoke all on function public.app_dashboard_active_requisition_candidates_v1(text,text,date,date,date,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.app_dashboard_active_requisition_candidates_v1(text,text,date,date,date,text,text,uuid,integer) to authenticated;

-- Essential Home metrics deliberately exclude optional sections.
create or replace function public.app_home_core_summary_v1(p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb; v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'HOME_SCOPE_INVALID'; end if;
  with scope_reqs as materialized (
    select r.doc_id,r.is_priority,r.head_count,r.status,r.site,r.person_in_charge
    from public.requisitions r where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and app_private.can_read_requisition(r.doc_id)
  ), offer_totals as (
    select o.doc_id,count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') as accepted
    from public.offers o join scope_reqs r using(doc_id) group by o.doc_id
  ), req as (
    select r.doc_id,r.is_priority,r.head_count,r.status,greatest(r.head_count-coalesce(o.accepted,0),0) as open_headcount
    from scope_reqs r left join offer_totals o using(doc_id) where r.status not in ('filled','cancel')
  ), scope_apps as materialized (
    select a.application_id,a.candidate_id,a.group_id,a.state from public.candidate_applications a
    join public.candidates c on c.candidate_id=a.candidate_id and app_private.can_read_candidate(c.candidate_id)
    where app_private.can_read_application(a.application_id)
      and exists(select 1 from public.document_groups d join scope_reqs r using(doc_id) where d.group_id=a.group_id)
  ), active_apps as (
    select a.application_id,a.candidate_id,a.group_id from scope_apps a
    where a.state='active'
      and exists(select 1 from public.document_groups d join req r using(doc_id) where d.group_id=a.group_id)
  ), latest as (
    select distinct on (l.application_id) l.application_id,l.candidate_id,l.recruitment_process,l.result,l.estimated_action_date,l.log_id
    from public.recruitment_logs l join active_apps a using(application_id)
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc
  ), pipeline as (
    select recruitment_process as stage,count(*)::integer as count from latest
    where result is distinct from 0 and recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and not exists(select 1 from public.offers o where o.candidate_id=latest.candidate_id)
    group by recruitment_process
  ), pending as (
    select count(distinct (a.candidate_id,l.application_id))::integer as all_pending,
      count(distinct (a.candidate_id,l.application_id)) filter(where l.estimated_action_date<v_today)::integer as overdue
    from public.recruitment_logs l join active_apps a using(application_id)
    where l.result is null and l.superseded_at is null and l.superseded_by_stage_instance_id is null
  ), week as (select max(week_start) as latest_week from public.sourcing_weekly_updates),
  open_groups as (select distinct d.group_id from public.document_groups d join req r using(doc_id) where r.open_headcount>0),
  stale as (select count(*)::integer as n from open_groups g where not exists(select 1 from public.sourcing_weekly_updates u where u.group_id=g.group_id and (u.updated_at at time zone 'Asia/Bangkok')::date > v_today-6)),
  req_totals as (select count(*) filter(where open_headcount>0)::integer as open,count(*) filter(where open_headcount>0 and is_priority)::integer as priority_open from req)
  select jsonb_build_object('requisitions',jsonb_build_object('open',req_totals.open,'priorityOpen',req_totals.priority_open),
    'candidatePipeline',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'count',count) order by case stage when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 else 6 end) from pipeline),'[]'::jsonb),
    'sourcing',jsonb_build_object('staleGroups',stale.n,'latestWeek',week.latest_week),
    'needsAction',jsonb_build_object('pendingCandidates',pending.all_pending,'overduePending',pending.overdue),
    'counts',jsonb_build_object('openRequisitions',req_totals.open,'activePipeline',coalesce((select sum(count) from pipeline),0),'staleSourcing',stale.n,
      'pendingOffers',(select count(*)::integer from public.offers o join scope_reqs r using(doc_id) where o.accepted_date is not null and o.first_working_date is not null and o.first_working_date<=v_today and o.start_confirmation is null and app_private.can_read_application(o.application_id))))
  into v_result from req_totals cross join stale cross join week cross join pending;
  return v_result;
end $$;

revoke all on function public.app_home_core_summary_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_home_core_summary_v1(jsonb) to authenticated;
