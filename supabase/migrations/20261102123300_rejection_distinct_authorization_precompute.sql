create or replace function app_private.dashboard_rejection_events_v1(p_start date,p_end date,p_scope jsonb)
returns table(event_id text,log_id bigint,application_id uuid,candidate_id text,candidate_name text,group_id text,position_name text,event_date date,stage text,round integer,actor text,main_key text,detail_key text,main_en text,main_th text,detail_en text,detail_th text,requisitions jsonb,scope_context boolean,unresolved_context boolean,undated boolean)
language sql stable security invoker set search_path = '' as $$
with scoped_requisitions as (
  select r.doc_id,r.site,r.department,r.position,r.person_in_charge,r.level,r.is_priority
  from public.requisitions r where app_private.can_read_requisition(r.doc_id)
    and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
    and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
    and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
    and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
    and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
), failure_logs as materialized (
  select l.* from public.recruitment_logs l
  where l.result=0 and l.superseded_at is null and l.superseded_by_stage_instance_id is null
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
), failures as (
  select l.*,c.name candidate_name,a.group_id application_group,
    case when l.outcome_assignment_id is not null then assignment.group_id
      when exists(select 1 from public.candidate_application_assignments history where history.application_id=l.application_id) then null
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
      else jsonb_build_array(coalesce(nullif(l.failure_reason_snapshot->>'detail_en',''),l.failure_reason_snapshot->>'detail_th'),coalesce(nullif(l.failure_reason_snapshot->>'detail_th',''),l.failure_reason_snapshot->>'detail_en')) end detail_value,
    case when l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and l.stage_instance_id is not null then l.outcome_date else coalesce(l.outcome_date,l.log_date) end failure_date
  from failure_logs l join authorized_candidates c on c.candidate_id=l.candidate_id
  left join authorized_applications a on a.application_id=l.application_id and a.candidate_id=l.candidate_id
  left join public.candidate_application_assignments assignment on assignment.assignment_id=l.outcome_assignment_id and assignment.application_id=l.application_id
  where l.application_id is null or a.application_id is not null
), keyed as (
  select f.*,coalesce(f.application_id::text,f.candidate_id)||':'||coalesce(f.stage_instance_id::text,'legacy-'||f.log_id::text) event_id,
    app_private.dashboard_json_compact_v1(jsonb_build_array(normalized_actor,main_value)) main_key,
    app_private.dashboard_json_compact_v1(jsonb_build_array(app_private.dashboard_json_compact_v1(jsonb_build_array(normalized_actor,main_value)),detail_value)) detail_key
  from failures f
), context_rows as (
  select k.*,context.position_name,context.requisitions,context.has_links,context.has_scope_context
  from keyed k left join lateral (
    select coalesce(max(pg.group_position),min(r.position)) position_name,bool_or(true) has_links,bool_or(r.doc_id is not null) has_scope_context,
      coalesce(jsonb_agg(jsonb_build_object('doc_id',r.doc_id,'site',r.site,'department',r.department,'position',r.position,'person_in_charge',r.person_in_charge) order by r.doc_id) filter(where r.doc_id is not null),'[]'::jsonb) requisitions
    from public.document_groups dg left join public.position_groups pg on pg.group_id=dg.group_id
    left join scoped_requisitions r on r.doc_id=dg.doc_id where k.resolved_group is not null and dg.group_id=k.resolved_group
  ) context on true
)
select c.event_id,c.log_id,c.application_id,c.candidate_id,c.candidate_name,c.resolved_group,c.position_name,c.failure_date,c.recruitment_process,c.round,c.normalized_actor,c.main_key,c.detail_key,
  c.normalized_main_en,c.normalized_main_th,c.normalized_detail_en,c.normalized_detail_th,c.requisitions,coalesce(c.has_scope_context,false),
  c.resolved_group is null or coalesce(c.has_links,false)=false,c.failure_date is null
from context_rows c
$$;
revoke all on function app_private.dashboard_rejection_events_v1(date,date,jsonb) from public,anon;
grant execute on function app_private.dashboard_rejection_events_v1(date,date,jsonb) to authenticated;
