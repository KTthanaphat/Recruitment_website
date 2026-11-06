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
