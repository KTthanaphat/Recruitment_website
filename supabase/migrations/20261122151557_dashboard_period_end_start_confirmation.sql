-- Period-end reporting reads audit values inside the database. Offer snapshots never
-- leave app_private; public reports return only requisition fields and aggregate counts.
create or replace function app_private.dashboard_period_cutoff(p_end date)
returns timestamptz language sql stable set search_path='' as $$
  select least(statement_timestamp(), (p_end + 1)::timestamp at time zone 'Asia/Bangkok')
$$;

create or replace function app_private.dashboard_period_requisitions(
  p_cutoff timestamptz, p_scope jsonb, p_company boolean
) returns setof public.requisitions language sql stable set search_path='' as $$
  select h.*
  from app_private.report_requisitions r
  left join lateral (
    select l.old_data from app_private.report_change_logs l
    where r.updated_at >= p_cutoff and l.entity='requisitions' and l.entity_id=r.doc_id
      and l.changed_at>=p_cutoff
    order by l.changed_at,l.log_id limit 1
  ) after_end on true
  left join lateral (
    select l.new_data from app_private.report_change_logs l
    where r.updated_at >= p_cutoff and after_end.old_data is null
      and l.entity='requisitions' and l.entity_id=r.doc_id and l.changed_at<p_cutoff
    order by l.changed_at desc,l.log_id desc limit 1
  ) before_end on true
  cross join lateral jsonb_populate_record(null::public.requisitions,
    case when r.updated_at<p_cutoff then to_jsonb(r)
      else coalesce(after_end.old_data,before_end.new_data,
        to_jsonb(r) || jsonb_build_object('status','unavailable','person_in_charge',null)) end) h
  where auth.uid() is not null and (p_company or app_private.can_read_requisition(r.doc_id))
    and r.created_at<p_cutoff and h.doc_id is not null and h.is_secret is not true
    and (coalesce(p_scope->>'headerSite','')='' or h.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(h.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
    and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or h.is_priority)
    and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or h.site in(select jsonb_array_elements_text(p_scope->'sites')))
    and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or h.department in(select jsonb_array_elements_text(p_scope->'departments')))
    and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists (
      select 1 from jsonb_array_elements_text(p_scope->'levels') x(band)
      where case when btrim(coalesce(h.level,'')) ~* '^L?(0|[1-9]|1[0-4])$'
        then substring(btrim(h.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int end
    ))
$$;
revoke all on function app_private.dashboard_period_requisitions(timestamptz,jsonb,boolean) from public,anon,authenticated;

-- The audit entity ID for offers is generally the requisition ID. Use the offer ID
-- from the snapshots as the stable identity, including when the offer was moved.
create index if not exists dashboard_offer_audit_identity_idx on public.change_logs
  ((coalesce(new_data->>'offer_id',old_data->>'offer_id')),changed_at,log_id)
  where entity='offers' and not is_secret;
create index if not exists dashboard_offer_audit_previous_doc_idx on public.change_logs
  ((old_data->>'doc_id')) where entity='offers' and not is_secret;

create or replace function app_private.dashboard_period_offers(
  p_cutoff timestamptz, p_doc_ids text[], p_company boolean
) returns table (
  offer_id bigint, doc_id text, accepted_date date, first_working_date date,
  outcome text, outcome_at timestamptz, coverage_events jsonb, history_incomplete boolean
) language sql stable set search_path='' as $$
  with candidates as materialized (
    select o.offer_id::text id from app_private.report_offers o where o.doc_id=any(p_doc_ids)
    union
    select coalesce(l.new_data->>'offer_id',l.old_data->>'offer_id')
    from app_private.report_change_logs l where l.entity='offers' and not l.is_secret
      and (l.entity_id=any(p_doc_ids) or l.old_data->>'doc_id'=any(p_doc_ids))
  ), versions as materialized (
    select k.id, to_jsonb(o) current_data,
      case when o.updated_at<p_cutoff then to_jsonb(o)
        when after_end.found then after_end.old_data else before_end.new_data end snapshot,
      o.offer_id is not null and o.created_at<p_cutoff and o.updated_at>=p_cutoff
        and not coalesce(after_end.found,false) history_incomplete
    from candidates k
    left join public.offers o on o.offer_id=k.id::bigint
    left join lateral (
      select true found,l.old_data from app_private.report_change_logs l
      where l.entity='offers' and not l.is_secret and coalesce(l.new_data->>'offer_id',l.old_data->>'offer_id')=k.id
        and l.changed_at>=p_cutoff
      order by l.changed_at,l.log_id limit 1
    ) after_end on true
    left join lateral (
      select l.new_data from app_private.report_change_logs l
      where not coalesce(after_end.found,false) and (o.offer_id is null or o.updated_at>=p_cutoff)
        and l.entity='offers' and not l.is_secret and coalesce(l.new_data->>'offer_id',l.old_data->>'offer_id')=k.id
        and l.changed_at<p_cutoff
      order by l.changed_at desc,l.log_id desc limit 1
    ) before_end on true
    where k.id is not null
  ), visible as materialized (
    select v.*, h.doc_id,h.accepted_date,h.first_working_date,h.start_confirmation,h.start_confirmed_at
    from versions v
    cross join lateral jsonb_populate_record(null::public.offers,
      coalesce(v.snapshot,case when v.history_incomplete then v.current_data end)) h
    where auth.uid() is not null and h.doc_id=any(p_doc_ids) and h.created_at<p_cutoff
      and app_private.report_application(h.application_id)
      and (p_company or app_private.can_read_application(h.application_id))
      and (v.current_data is null or (
        app_private.report_application((v.current_data->>'application_id')::uuid)
        and exists(select 1 from app_private.report_requisitions r where r.doc_id=v.current_data->>'doc_id'
          and (p_company or app_private.can_read_requisition(r.doc_id)))
        and (p_company or app_private.can_read_application((v.current_data->>'application_id')::uuid))
      ))
  )
  select v.id::bigint,v.doc_id,
    case when not v.history_incomplete then v.accepted_date end,
    case when not v.history_incomplete then v.first_working_date end,
    case when v.start_confirmed_at<p_cutoff and not v.history_incomplete then v.start_confirmation end,
    case when v.start_confirmed_at<p_cutoff and not v.history_incomplete then v.start_confirmed_at end,
    coalesce(events.changes,'[]'::jsonb),v.history_incomplete
  from visible v
  left join lateral (
    with transitions as (
      select l.changed_at event_at,l.log_id id,(l.old_data->>'start_confirmed_at')::timestamptz prior_confirmation,
        case when l.new_data->>'start_confirmation'='did_not_start' then -1 else 1 end delta,
        row_number() over(order by l.changed_at,l.log_id) event_number
      from app_private.report_change_logs l
      where v.accepted_date is not null and not v.history_incomplete and l.entity='offers' and not l.is_secret
        and coalesce(l.new_data->>'offer_id',l.old_data->>'offer_id')=v.id
        and l.changed_at<p_cutoff and l.new_data is not null
        and coalesce(l.new_data->>'start_confirmation'='did_not_start',false)
          <> coalesce(l.old_data->>'start_confirmation'='did_not_start',false)
    ), complete as (
      select event_at,id,delta from transitions
      union all
      select least(prior_confirmation,event_at),-id,-1 from transitions
      where event_number=1 and delta=1 and prior_confirmation is not null
    )
    select jsonb_agg(jsonb_build_object('at',event_at,'id',id,'delta',delta)
      order by event_at,id) changes from complete
  ) events on true
$$;
revoke all on function app_private.dashboard_period_offers(timestamptz,text[],boolean) from public,anon,authenticated;

create or replace function app_private.dashboard_start_attendance(p_start date,p_end date,p_scope jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  with bounds as (select app_private.dashboard_period_cutoff(p_end) cutoff),
  scope as materialized (
    select r.* from bounds b
    cross join lateral app_private.dashboard_period_requisitions(b.cutoff,p_scope,true) r
    where exists(select 1 from public.profiles where id=auth.uid())
  ), offers as materialized (
    select o.* from bounds b
    cross join lateral app_private.dashboard_period_offers(b.cutoff,array(select doc_id from scope),true) o
  ), counts as (
    select r.site,count(*) filter(where due.eligible)::int due,
      count(*) filter(where due.eligible and o.outcome='started')::int started,
      count(*) filter(where due.eligible and o.outcome='did_not_start')::int no_show,
      bool_or(r.status='unavailable' or coalesce(o.history_incomplete,false)) incomplete
    from scope r cross join bounds b left join offers o using(doc_id)
    cross join lateral (select r.status<>'unavailable' and o.accepted_date<=least(p_end,(b.cutoff at time zone 'Asia/Bangkok')::date)
      and o.first_working_date between p_start and least(p_end,(b.cutoff at time zone 'Asia/Bangkok')::date) eligible) due
    where coalesce((select l.status from app_private.report_requisition_logs l where l.doc_id=r.doc_id
      and l.log_date<=least(p_end,(b.cutoff at time zone 'Asia/Bangkok')::date) and l.created_at<b.cutoff
      order by l.log_date desc,l.log_id desc limit 1),r.status)<>'cancel'
    group by r.site
  )
  select coalesce(jsonb_agg(jsonb_build_object('site',site,'due',due,'started',started,'didNotStart',no_show,
    'historyIncomplete',incomplete) order by site),'[]'::jsonb) from counts
$$;
revoke all on function app_private.dashboard_start_attendance(date,date,jsonb) from public,anon,authenticated;
grant execute on function app_private.dashboard_start_attendance(date,date,jsonb) to authenticated;

create or replace function app_private.dashboard_vacancy_period(p_start date,p_end date,p_period text,p_scope jsonb,p_cutoff timestamptz)
returns table (
  doc_id text, site text, department text, section text, "position" text, level text, head_count int,
  request_type text, person_in_charge text, pr_approved_date date, req_date date, period_status text, last_remark text,
  filled_date date, sla_start date, sla_days int, opened_in_period boolean, open_headcount int,
  start_statuses jsonb, history_incomplete boolean, opening int, opened int, reopened int,
  fills int, fills_in_sla int, fills_sla_unknown int
) language sql stable security definer set search_path='' as $$
  with bounds as (
    select least(p_cutoff,app_private.dashboard_period_cutoff(p_end)) cutoff,
      least(p_end,(least(p_cutoff,app_private.dashboard_period_cutoff(p_end)) at time zone 'Asia/Bangkok')::date) cutoff_day
  ), scope as materialized (
    select r.*,b.cutoff,b.cutoff_day, greatest(r.head_count,0) capacity,
      case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then
        case when substring(btrim(r.level) from '([0-9]+)$')::int<=6 then 30
          when substring(btrim(r.level) from '([0-9]+)$')::int<=9 then 45 else 60 end end threshold
    from bounds b cross join lateral app_private.dashboard_period_requisitions(b.cutoff,p_scope,false) r
    where app_private.is_recruitment_reader()
      and r.pr_approved_date<=b.cutoff_day
  ), authorized as materialized (
    select r.*,latest.remark status_remark,
      case when coalesce(latest.status,r.status)='filled' then latest.log_date end legacy_filled
    from scope r left join lateral (
      select l.status,l.log_date,l.remark from app_private.report_requisition_logs l
      where l.doc_id=r.doc_id and l.log_date<=r.cutoff_day and l.created_at<r.cutoff
      order by l.log_date desc,l.log_id desc limit 1
    ) latest on true
    where coalesce(latest.status,r.status)<>'cancel'
      and (p_period in ('custom','pim') or r.pr_approved_date+r.threshold>=p_start)
  ), offers as materialized (
    select r.cutoff_day,r.pr_approved_date,o.*
    from bounds b cross join lateral app_private.dashboard_period_offers(b.cutoff,array(select a.doc_id from authorized a),false) o
    join authorized r on r.doc_id=o.doc_id
    where o.accepted_date<=r.cutoff_day or o.history_incomplete
  ), attendance as (
    select o.doc_id, count(*) filter(where not o.history_incomplete) known_offers, bool_or(o.history_incomplete) incomplete,
      jsonb_build_object(
        'started',count(*) filter(where o.outcome='started'),
        'didNotStart',count(*) filter(where o.outcome='did_not_start'),
        'scheduled',count(*) filter(where o.outcome is null and o.first_working_date>o.cutoff_day),
        'awaiting',count(*) filter(where o.outcome is null and o.first_working_date<=o.cutoff_day),
        'unavailable',count(*) filter(where o.history_incomplete or o.first_working_date is null and o.outcome is null)
      ) states
    from offers o group by o.doc_id
  ), events as (
    select o.doc_id,(greatest(o.accepted_date,o.pr_approved_date)::timestamp at time zone 'Asia/Bangkok') at,0 priority,o.offer_id seq,1 delta
      from offers o where o.accepted_date is not null
    union all
    select o.doc_id,greatest(e.at,greatest(o.accepted_date,o.pr_approved_date)::timestamp at time zone 'Asia/Bangkok'),1,e.id,e.delta
      from offers o cross join lateral jsonb_to_recordset(o.coverage_events) e(at timestamptz,id bigint,delta int)
      where o.accepted_date is not null
    union all
    select o.doc_id,greatest(o.outcome_at,greatest(o.accepted_date,o.pr_approved_date)::timestamp at time zone 'Asia/Bangkok'),1,o.offer_id,-1
      from offers o where o.accepted_date is not null and o.outcome='did_not_start'
        and (select coalesce(sum(e.delta),0) from jsonb_to_recordset(o.coverage_events) e(delta int))=0
    union all
    select r.doc_id,greatest(r.legacy_filled,r.pr_approved_date)::timestamp at time zone 'Asia/Bangkok',0,0,r.capacity
      from authorized r left join attendance a on a.doc_id=r.doc_id
      where coalesce(a.known_offers,0)=0 and not coalesce(a.incomplete,false) and r.legacy_filled is not null
  ), counted as (
    select e.*,(e.at at time zone 'Asia/Bangkok')::date event_day,r.capacity,r.threshold,r.pr_approved_date,
      sum(e.delta) over(ordering) running,
      coalesce(sum(e.delta) over(ordering rows between unbounded preceding and 1 preceding),0) previous
    from events e join authorized r on r.doc_id=e.doc_id
    window ordering as (partition by e.doc_id order by e.at,e.priority,e.seq)
  ), movement as (
    select c.*,
      least(c.capacity,greatest(0,c.running))-least(c.capacity,greatest(0,c.previous)) change,
      coalesce(max(c.event_day) filter(where c.delta<0 and c.previous<=c.capacity) over(
        partition by c.doc_id order by c.at,c.priority,c.seq rows between unbounded preceding and 1 preceding),c.pr_approved_date) sla_at_event
    from counted c
  ), totals as (
    select m.doc_id,coalesce(sum(m.change) filter(where m.event_day<p_start),0)::int covered_before,
      sum(m.change)::int covered_end,
      coalesce(sum(m.change) filter(where m.event_day>=p_start and m.change>0),0)::int filled,
      -coalesce(sum(m.change) filter(where m.event_day>=p_start and m.change<0),0)::int reopened,
      coalesce(sum(m.change) filter(where m.event_day>=p_start and m.change>0 and m.event_day-m.sla_at_event<=m.threshold),0)::int filled_in_sla,
      coalesce(sum(m.change) filter(where m.event_day>=p_start and m.change>0 and m.threshold is null),0)::int filled_sla_unknown,
      max(m.event_day) filter(where m.change>0 and least(m.capacity,greatest(0,m.running))=m.capacity) most_recent_fill
    from movement m group by m.doc_id
  ), states as (
    select r.*,t.covered_before,t.covered_end,t.filled,t.reopened,t.filled_in_sla,t.filled_sla_unknown,(r.status='unavailable' or coalesce(a.incomplete,false)) incomplete,coalesce(a.states,'{}'::jsonb) states,
      case when r.capacity>0 and t.covered_end=r.capacity then t.most_recent_fill end fill_date
    from authorized r left join totals t using(doc_id) left join attendance a using(doc_id)
    where r.status='unavailable' or coalesce(a.incomplete,false) or r.pr_approved_date>=p_start or coalesce(t.covered_before,0)<r.capacity or t.reopened>0
  )
  select s.doc_id,s.site,s.department,s.section,s.position,s.level,s.capacity,coalesce(s.request_type,'New'),s.person_in_charge,
    s.pr_approved_date,s.pr_approved_date,case when s.incomplete then 'unavailable' when s.fill_date is not null then 'filled' else 'ongoing' end,
    s.status_remark,case when not s.incomplete then s.fill_date end,
    coalesce((select max(m.event_day) from movement m where m.doc_id=s.doc_id and m.change<0 and m.event_day<=coalesce(s.fill_date,s.cutoff_day)),s.pr_approved_date),
    s.threshold,s.pr_approved_date>=p_start,case when not s.incomplete then s.capacity-coalesce(s.covered_end,0) end,
    s.states,s.incomplete,case when s.pr_approved_date<p_start then s.capacity-coalesce(s.covered_before,0) else 0 end,
    case when s.pr_approved_date>=p_start then s.capacity else 0 end,
    coalesce(s.reopened,0),coalesce(s.filled,0),coalesce(s.filled_in_sla,0),coalesce(s.filled_sla_unknown,0)
  from states s
$$;
revoke all on function app_private.dashboard_vacancy_period(date,date,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function app_private.dashboard_vacancy_period(date,date,text,jsonb,timestamptz) to authenticated;

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
  v_current:=v_current || jsonb_build_object('attendance',app_private.dashboard_start_attendance(p_start,p_end,coalesce(p_scope,'{}'::jsonb)));
  v_prior:=app_private.dashboard_performance_summary_range_v1(p_prior_start,p_prior_end,p_period,coalesce(p_scope,'{}'::jsonb));
  return jsonb_build_object('current',v_current,'prior',v_prior,'priorRange',jsonb_build_object('start',p_prior_start,'end',p_prior_end));
end;
$$;

create or replace function public.app_dashboard_active_requisitions_page_v2(
  p_start date,p_end date,p_period text,p_stage_mode text,p_scope jsonb default '{}'::jsonb,
  p_after_value text default null,p_after_id text default null,p_limit integer default 25,
  p_search text default '',p_filters jsonb default '{}'::jsonb,p_sort text default null,p_direction text default null,p_as_of timestamptz default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_cutoff timestamptz; v_needs_metric_membership boolean; v_sort text:=coalesce(nullif(p_sort,''),'report'); v_direction text:=lower(coalesce(nullif(p_direction,''),'asc'));
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_period not in ('mtd','ytd','pim','custom') then raise exception 'REPORT_RANGE_INVALID'; end if;
  if p_stage_mode not in ('status','activity','accum') then raise exception 'REPORT_STAGE_MODE_INVALID'; end if;
  if p_limit is null or p_limit not in (25,50) then raise exception 'REPORT_PAGE_LIMIT_INVALID'; end if;
  if (p_after_value is null)<>(p_after_id is null) then raise exception 'REPORT_CURSOR_INVALID'; end if;
  if p_search is null or length(p_search)>200 or jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('site','department','section','position','level','vacancy','request_type','requisition_date','person_in_charge','status','detail','applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer','actual_age','sla','filled_date','start_status','opened_in_period'))
    or exists(select 1 from jsonb_each(coalesce(p_filters,'{}'::jsonb)) f where jsonb_typeof(f.value)<>'string' or length(f.value #>> '{}')>200) then raise exception 'REPORT_FILTER_INVALID'; end if;
  if v_direction not in ('asc','desc') or v_sort not in ('report','site','department','section','position','level','vacancy','request_type','requisition_date','person_in_charge','status','detail','applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer','actual_age','sla','filled_date','start_status','opened_in_period') then raise exception 'REPORT_SORT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'REPORT_SCOPE_INVALID'; end if;
  v_needs_metric_membership := p_search<>'' or exists(select 1 from jsonb_each_text(coalesce(p_filters,'{}'::jsonb)) f where f.key in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and f.value<>'');
  v_cutoff:=least(p_as_of,app_private.dashboard_period_cutoff(p_end));
  p_end:=least(p_end,(v_cutoff at time zone 'Asia/Bangkok')::date);
  with eligible as materialized (
    select e.*, concat_ws(' ',
      case when (e.start_statuses->>'started')::int>0 then 'Started เริ่มงานแล้ว' end,
      case when (e.start_statuses->>'scheduled')::int>0 then 'Scheduled มีกำหนดเริ่มงาน' end,
      case when (e.start_statuses->>'awaiting')::int>0 then 'Awaiting confirmation รอยืนยัน' end,
      case when (e.start_statuses->>'didNotStart')::int>0 then 'Did not start ไม่มาเริ่มงาน' end,
      case when (e.start_statuses->>'unavailable')::int>0 then 'Start date unavailable ไม่ทราบวันเริ่มงาน' end
    ) start_status_text
    from app_private.dashboard_vacancy_period(p_start,p_end,p_period,coalesce(p_scope,'{}'::jsonb),v_cutoff) e
  ), cheap_rows as (
    select e.*,
      case v_sort when 'site' then lower(e.site) when 'department' then lower(e.department) when 'section' then lower(coalesce(e.section,'')) when 'position' then lower(e.position)
        when 'level' then lower(coalesce(e.level,'')) when 'vacancy' then lpad(e.head_count::text,12,'0') when 'request_type' then lower(coalesce(e.request_type,''))
        when 'requisition_date' then e.req_date::text when 'person_in_charge' then lower(coalesce(e.person_in_charge,''))
        when 'status' then case e.period_status when 'ongoing' then '0-ongoing' else '1-filled' end when 'detail' then lower(coalesce(e.last_remark,''))
        when 'actual_age' then lpad(greatest((timezone('Asia/Bangkok',now())::date-e.req_date),0)::text,12,'0')
        when 'sla' then lpad(greatest((coalesce(case when e.period_status='filled' then e.filled_date end,p_end)-e.sla_start),0)::text,12,'0')
        when 'start_status' then lower(e.start_status_text) when 'opened_in_period' then e.opened_in_period::int::text
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
      and (coalesce((p_filters->>'vacancy'),'')='' or concat_ws(' ',r.head_count,r.open_headcount) ilike '%'||(p_filters->>'vacancy')||'%')
      and (coalesce((p_filters->>'request_type'),'')='' or case lower(btrim((p_filters->>'request_type'))) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike '%'||(p_filters->>'request_type')||'%' end)
      and (coalesce((p_filters->>'requisition_date'),'')='' or concat_ws(' ',r.req_date::text,to_char(r.req_date,'DD/MM/YYYY')) ilike '%'||(p_filters->>'requisition_date')||'%')
      and (coalesce((p_filters->>'person_in_charge'),'')='' or coalesce(r.person_in_charge,'-') ilike '%'||(p_filters->>'person_in_charge')||'%')
      and (coalesce((p_filters->>'status'),'')='' or case lower(btrim((p_filters->>'status'))) when 'ongoing' then r.period_status='ongoing' when 'กำลังดำเนินการ' then r.period_status='ongoing' when 'filled' then r.period_status='filled' when 'ครบแล้ว' then r.period_status='filled' else concat_ws(' ',r.period_status,r.site,r.department) ilike '%'||(p_filters->>'status')||'%' end)
      and (coalesce((p_filters->>'detail'),'')='' or coalesce(r.last_remark,'-') ilike '%'||(p_filters->>'detail')||'%')
      and (coalesce((p_filters->>'actual_age'),'')='' or greatest((timezone('Asia/Bangkok',now())::date-r.req_date),0)::text ilike '%'||replace((p_filters->>'actual_age'),'d','')||'%')
      and (coalesce((p_filters->>'sla'),'')='' or (case when r.sla_start is null or r.sla_days is null then '-' else (case when greatest((coalesce(case when r.period_status='filled' then r.filled_date end,p_end)-r.sla_start),0)<=r.sla_days then 'In SLA อยู่ใน SLA' else 'Over SLA เกิน SLA' end)||' ('||greatest((coalesce(case when r.period_status='filled' then r.filled_date end,p_end)-r.sla_start),0)||'d)' end) ilike '%'||(p_filters->>'sla')||'%')
      and (coalesce(p_filters->>'start_status','')='' or r.start_status_text ilike '%'||(p_filters->>'start_status')||'%')
      and (coalesce(p_filters->>'opened_in_period','')='' or case lower(btrim(p_filters->>'opened_in_period'))
        when 'yes' then r.opened_in_period when 'ใช่' then r.opened_in_period
        when 'no' then not r.opened_in_period when 'ไม่ใช่' then not r.opened_in_period
        else (case when r.opened_in_period then 'Yes ใช่' else 'No ไม่ใช่' end) ilike '%'||(p_filters->>'opened_in_period')||'%' end)
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
    from enrichment_keys k join app_private.report_document_groups d using(doc_id)
    join lateral (select a.application_id,a.candidate_id from app_private.report_candidate_applications a where a.group_id=d.group_id offset 0) ca on true
  ), allowed_stage_applications as materialized (
    select application_id from (select distinct application_id from stage_apps) a
    where app_private.can_read_application(a.application_id)
  ), allowed_stage_candidates as materialized (
    select c.candidate_id from (select distinct candidate_id from stage_apps join allowed_stage_applications using(application_id)) k
    join app_private.report_candidates c using(candidate_id) where app_private.can_read_candidate(c.candidate_id)
  ), stage_counts as (
    select e.doc_id,l.recruitment_process,count(distinct case when p_stage_mode='status' then ca.application_id::text else l.candidate_id end)::integer n
    from stage_apps ca join allowed_stage_applications aa using(application_id) join base_matches e using(doc_id)
    join allowed_stage_candidates c on c.candidate_id=ca.candidate_id
    join lateral (
      select l.* from app_private.report_recruitment_logs l
      where l.application_id=ca.application_id and l.candidate_id=c.candidate_id offset 0
    ) l on true
    left join app_private.report_candidate_application_assignments a on a.assignment_id=case when l.result is null then l.entry_assignment_id else l.outcome_assignment_id end and a.application_id=ca.application_id
    where l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (p_stage_mode='status' or a.group_id=ca.group_id or a.assignment_id is null)
      and case p_stage_mode when 'activity' then (case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end) between p_start and p_end
        when 'accum' then l.superseded_at is null and l.log_date between coalesce(e.pr_approved_date,p_end) and p_end
        else l.log_date<=p_end and (l.outcome_date is null or l.outcome_date>p_end or l.result is null)
          and not exists(select 1 from app_private.report_recruitment_logs newer where newer.application_id=ca.application_id and newer.candidate_id=c.candidate_id
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
      from app_private.report_document_groups d join app_private.report_sourcing_weekly_updates u on u.group_id=d.group_id
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
      and (coalesce(p_search,'')='' or concat_ws(' ',r.doc_id,r.site,r.department,r.section,r.position,r.level,r.head_count,r.request_type,r.req_date,r.person_in_charge,r.period_status,r.last_remark,r.applicant_count,r.phone_screen,r.hr_interview,r.line_interview,r.test_count,r.reference_check,r.offer_count,r.filled_date,r.open_headcount,r.start_status_text,case when r.opened_in_period then 'Yes ใช่' else 'No ไม่ใช่' end) ilike '%'||btrim(p_search)||'%')
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
  page_info as (select count(*)>p_limit more from page_raw),
  waterfall as (
    select m.category,e.site,e.request_type,sum(m.amount)::int amount,
      sum(m.in_sla)::int in_sla,sum(m.unknown_sla)::int unknown_sla,
      coalesce(sum(m.amount) filter(where m.is_reopen),0)::int reopened
    from eligible e cross join lateral (values
      ('Week Start',e.opening,0,0,false),('Open',e.opened,0,0,false),('Open',e.reopened,0,0,true),
      ('Filled',-e.fills,e.fills_in_sla,e.fills_sla_unknown,false),('Total',e.open_headcount,0,0,false)
    ) m(category,amount,in_sla,unknown_sla,is_reopen)
    where p_after_id is null and not e.history_incomplete and m.amount<>0
    group by m.category,e.site,e.request_type
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('doc_id',p.doc_id,'site',p.site,'department',p.department,'section',p.section,'position',p.position,'level',coalesce(p.level,'-'),'vacancy',p.head_count,
      'applicant_count',p.applicant_count,'applicant_channels',jsonb_build_object('applicants_fb',p.channel_fb,'applicants_jobthai',p.channel_jobthai,'applicants_jobtopgun',p.channel_jobtopgun,'applicants_jobdb',p.channel_jobdb,'applicants_jobbkk',p.channel_jobbkk,'applicants_linkedin',p.channel_linkedin,'applicants_walkin',p.channel_walkin,'applicants_referral',p.channel_referral,'applicants_others',p.channel_others),
      'request_type',p.request_type,'requisition_date',p.req_date,'actual_age_days',greatest((timezone('Asia/Bangkok',now())::date-p.req_date),0),'person_in_charge',coalesce(p.person_in_charge,'-'),
      'stage_counts',jsonb_build_object('Phone Screen',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Phone Screen'),0),'HR Interview',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='HR Interview'),0),'Line Interview',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Line Interview'),0),'Test',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Test'),0),'Reference Check',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Reference Check'),0),'Offer',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Offer'),0)),
      'sla_state',jsonb_build_object('ageDays',case when p.history_incomplete or p.sla_start is null then null else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0) end,
        'endDate',coalesce(case when p.period_status='filled' then p.filled_date end,p_end),'inSla',case when p.history_incomplete or p.sla_start is null or p.sla_days is null then null else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)<=p.sla_days end,
        'isOverdue',case when p.history_incomplete or p.sla_start is null or p.sla_days is null then false else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)>p.sla_days end,
        'label',case when p.history_incomplete or p.sla_start is null or p.sla_days is null then '-' else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)||'d / '||p.sla_days||'d' end,
        'slaDays',case when not p.history_incomplete then p.sla_days end,'startDate',case when not p.history_incomplete then p.sla_start end),
      'filled_date',p.filled_date,'period_status',p.period_status,'period_detail',p.last_remark,
      'open_headcount',p.open_headcount,'opened_in_period',p.opened_in_period,'start_statuses',p.start_statuses,'history_incomplete',p.history_incomplete) order by case when v_direction='asc' then p.report_sort_value end asc,case when v_direction='desc' then p.report_sort_value end desc,p.doc_id asc) from page_rows p),'[]'::jsonb),
    'total',(select total from counted),'hasMore',(select more from page_info),'asOf',v_cutoff,
    'historyIncomplete',exists(select 1 from eligible where history_incomplete),
    'waterfallRows',case when p_after_id is null then coalesce((select jsonb_agg(jsonb_build_object(
      'waterfall_category',category,'site',site,'request_type',request_type,'vacancy_count',amount,
      'filledInSla',in_sla,'filledSlaUnknown',unknown_sla,'reopened',reopened) order by site,request_type,category) from waterfall),'[]'::jsonb) end,
    'nextCursor',case when (select more from page_info) then (select jsonb_build_object('value',report_sort_value,'id',doc_id) from page_rows order by case when v_direction='asc' then report_sort_value end desc,case when v_direction='desc' then report_sort_value end asc,doc_id desc limit 1) else null end)
  into v_result;
  return v_result;
end $$;
revoke all on function public.app_dashboard_active_requisitions_page_v2(date,date,text,text,jsonb,text,text,integer,text,jsonb,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.app_dashboard_active_requisitions_page_v2(date,date,text,text,jsonb,text,text,integer,text,jsonb,text,text,timestamptz) to authenticated;
