-- Exact Today’s Work drilldowns. Populations mirror existing Home aggregates.
-- Invoker rights + report views preserve RLS and omit confidential activity for every role.
create or replace function public.app_home_metric_page_v1(
  p_metric text,p_scope jsonb default '{}'::jsonb,
  p_after_priority integer default null,p_after_id text default null,p_limit integer default 25
) returns jsonb language plpgsql stable security invoker set search_path='' as $home_metric$
declare v_today date:=(now() at time zone 'Asia/Bangkok')::date; v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_metric is null or p_metric not in ('open','urgent','aging','sourcing') then raise exception 'HOME_METRIC_INVALID'; end if;
  if p_limit is null or p_limit not between 1 and 50 or (p_after_priority is null)<>(p_after_id is null) or p_after_id='' or length(p_after_id)>300 then raise exception 'HOME_METRIC_PAGE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'HOME_SCOPE_INVALID'; end if;
  if p_metric='urgent' then
  with profile as (select p.role,p.site,coalesce(to_jsonb(p)->>'nickname','') nickname,coalesce(to_jsonb(p)->>'full_name','') full_name from public.profiles p where p.id=auth.uid()),
  scoped_reqs as materialized (select r.* from app_private.report_requisitions r where app_private.can_read_requisition(r.doc_id)
    and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
    and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)),
  reqs as (select r.*,greatest(r.head_count-coalesce(o.accepted,0),0)::integer open_headcount,
      coalesce(restart.restart_date,r.pr_approved_date) sla_start,
      case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then case when substring(btrim(r.level) from '([0-9]+)$')::integer<=6 then 30 when substring(btrim(r.level) from '([0-9]+)$')::integer<=9 then 45 else 60 end end sla_days
    from scoped_reqs r
    left join lateral (select count(*)::integer accepted from app_private.report_offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(o.application_id)) o on true
    left join lateral (select max(o.start_confirmed_at::date) restart_date from app_private.report_offers o where o.doc_id=r.doc_id and o.start_confirmation='did_not_start' and o.start_confirmed_at is not null and o.start_confirmed_at::date<=v_today) restart on true),
  req_items as (select 'req:'||r.doc_id id,coalesce(nullif(btrim(r.position),''),'-')||case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then ' (L'||substring(btrim(r.level) from '([0-9]+)$')||')' else '' end title,
    r.doc_id||' - '||coalesce(r.site,'-')||' - '||coalesce(r.person_in_charge,'Unassigned')||' - '||r.open_headcount||' open - '||(v_today-r.sla_start)||'d / '||r.sla_days||'d' meta,'Overdue SLA' action_label,
    10+greatest(v_today-r.sla_start,0) priority,'danger' tone,'requisition' type,r.doc_id record_id,1 sort_group
    from reqs r cross join profile p where r.status='ongoing' and r.open_headcount>0 and r.sla_start is not null and r.sla_days is not null and v_today-r.sla_start>r.sla_days
    and (p.role in ('system_admin','admin_recruiter','viewer') or (p.nickname<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(r.site,'') ilike '%'||p.site||'%'))),
  active_apps as (select a.application_id,a.candidate_id,a.group_id,c.name,c.nickname,to_jsonb(c)->>'home_site' home_site,(to_jsonb(c)->>'created_at')::timestamptz created_at,(to_jsonb(c)->>'updated_at')::timestamptz updated_at,
      (select l.log_date from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_touch,
      (select l.recruitment_process from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_stage,
      (select l.result from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_result,
      (select array_agg(distinct r.site) from app_private.report_document_groups d join reqs r using(doc_id) where d.group_id=a.group_id) sites,
      (select string_agg(distinct r.person_in_charge,', ') from app_private.report_document_groups d join reqs r using(doc_id) where d.group_id=a.group_id) owners
    from app_private.report_candidate_applications a join app_private.report_candidates c using(candidate_id)
    where a.state='active' and app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and exists(select 1 from app_private.report_document_groups d join scoped_reqs r using(doc_id) where d.group_id=a.group_id)),
  candidate_items as (select 'cand:'||c.application_id::text id,coalesce(nullif(btrim(c.name),''),nullif(btrim(c.nickname),''),'-')||case when nullif(btrim(c.nickname),'') is not null and nullif(btrim(c.name),'') is not null then ' ('||c.nickname||')' else '' end title,
      coalesce(nullif(array_to_string(c.sites,', '),''),to_jsonb(c)->>'home_site','-')||' - '||case c.latest_stage when 'Phone Screen' then 'Phone Screening' else coalesce(c.latest_stage,'No activity') end||' - last touched '||(v_today-coalesce(c.latest_touch::date,(to_jsonb(c)->>'updated_at')::date,(to_jsonb(c)->>'created_at')::date))||'d ago' meta,
      'Aging candidate' action_label,8+greatest(v_today-coalesce(c.latest_touch::date,(to_jsonb(c)->>'updated_at')::date,(to_jsonb(c)->>'created_at')::date),0) priority,'warning' tone,'candidate' type,c.candidate_id record_id,2 sort_group
    from active_apps c cross join profile p
    where c.latest_stage in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and c.latest_result is distinct from 0
      and not exists(select 1 from app_private.report_offers o where o.application_id=c.application_id)
      and v_today-coalesce(c.latest_touch::date,(to_jsonb(c)->>'updated_at')::date,(to_jsonb(c)->>'created_at')::date)>7
      and (p.role in ('system_admin','admin_recruiter','viewer') or (p.nickname<>'' and coalesce(c.owners,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(c.owners,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(array_to_string(c.sites,','),to_jsonb(c)->>'home_site','') ilike '%'||p.site||'%'))
    ),
  stale_groups as (select d.group_id,coalesce(pg.group_position,'-') group_position,array_agg(distinct r.doc_id order by r.doc_id) doc_ids,
      array_agg(distinct r.site) sites,string_agg(distinct r.person_in_charge,', ') owners,sum(r.open_headcount)::integer open_headcount,
      max(u.updated_at) latest_update
    from app_private.report_document_groups d join reqs r using(doc_id) left join app_private.report_position_groups pg using(group_id)
      left join app_private.report_sourcing_weekly_updates u on u.group_id=d.group_id
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
    from app_private.report_offers o join reqs r on r.doc_id=o.doc_id join app_private.report_candidates c on c.candidate_id=o.candidate_id cross join profile p
    where (o.application_id is null or app_private.can_read_application(o.application_id)) and app_private.can_read_candidate(c.candidate_id)
      and (p.role in ('system_admin','admin_recruiter','viewer') or (p.nickname<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(r.site,'') ilike '%'||p.site||'%'))
      and o.start_confirmation is distinct from 'did_not_start' and o.start_confirmation is distinct from 'started'
      and (o.accepted_date is null or o.first_working_date is null)),
  all_items as (select * from req_items union all select * from candidate_items union all select * from source_items union all select * from offer_items),

  metric_rows as (
    select id,type,record_id,case when type='candidate' then substring(id from 6)::uuid
      when type='offer' then (select o.application_id from app_private.report_offers o where o.offer_id=substring(id from 7)::bigint) else null::uuid end application_id,
      title,meta,case action_label when 'Overdue SLA' then 'overdueSla' when 'Aging candidate' then 'agingCandidate' when 'Stale sourcing' then 'staleSourcing' when 'Missing start date' then 'missingStartDate' else 'pendingOffer' end reason,
      null::date action_date,null::integer quantity,priority::integer priority from all_items
  ),

  page_rows as materialized (
    select * from metric_rows
    where p_after_priority is null or priority<p_after_priority or (priority=p_after_priority and id>p_after_id)
    order by priority desc,id limit p_limit+1
  ), limited as (select * from page_rows order by priority desc,id limit p_limit)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',type,'recordId',record_id,'applicationId',application_id,'title',title,'meta',meta,'reason',reason,'actionDate',action_date,'quantity',quantity) order by priority desc,id) from limited),'[]'::jsonb),
    'totalCount',(select count(*) from metric_rows),
    'hasMore',(select count(*)>p_limit from page_rows),
    'nextCursor',(select jsonb_build_object('priority',priority,'id',id) from limited order by priority asc,id desc limit 1)
  ) into v_result;

  else
  with scope_reqs as materialized (
    select r.doc_id,r.is_priority,r.head_count,r.status,r.site,r.person_in_charge,r.position
    from app_private.report_requisitions r where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and app_private.can_read_requisition(r.doc_id)
  ), offer_totals as (
    select o.doc_id,count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') as accepted
    from app_private.report_offers o join scope_reqs r using(doc_id) group by o.doc_id
  ), req as (
    select r.doc_id,r.is_priority,r.head_count,r.status,greatest(r.head_count-coalesce(o.accepted,0),0) as open_headcount
    from scope_reqs r left join offer_totals o using(doc_id) where r.status not in ('filled','cancel')
  ), scope_apps as materialized (
    select a.application_id,a.candidate_id,a.group_id,a.state from app_private.report_candidate_applications a
    join app_private.report_candidates c on c.candidate_id=a.candidate_id and app_private.can_read_candidate(c.candidate_id)
    where app_private.can_read_application(a.application_id)
      and exists(select 1 from app_private.report_document_groups d join scope_reqs r using(doc_id) where d.group_id=a.group_id)
  ), active_apps as (
    select a.application_id,a.candidate_id,a.group_id from scope_apps a
    where a.state='active'
      and exists(select 1 from app_private.report_document_groups d join req r using(doc_id) where d.group_id=a.group_id)
  ),
  open_groups as (select distinct d.group_id from app_private.report_document_groups d join req r using(doc_id) where r.open_headcount>0),
  metric_rows as (
    select 'req:'||r.doc_id id,'requisition'::text type,r.doc_id record_id,null::uuid application_id,
      coalesce(nullif(btrim(s.position),''),r.doc_id) title,concat_ws(' · ',s.site,nullif(s.person_in_charge,'')) meta,
      'openHeadcount'::text reason,null::date action_date,r.open_headcount::integer quantity,0::integer priority
    from req r join scope_reqs s using(doc_id) where p_metric='open' and r.open_headcount>0
    union all
    select 'app:'||a.application_id::text,'candidate',a.candidate_id,a.application_id,
      coalesce(nullif(btrim(c.name),''),nullif(btrim(c.nickname),''),a.candidate_id),
      concat_ws(' · ',a.group_id,g.group_position),'overdueAction',min(l.estimated_action_date),null::integer,
      (v_today-min(l.estimated_action_date))::integer
    from active_apps a join app_private.report_candidates c using(candidate_id)
    left join app_private.report_position_groups g on g.group_id=a.group_id
    join app_private.report_recruitment_logs l using(application_id)
    where p_metric='aging' and l.result is null and l.superseded_at is null and l.superseded_by_stage_instance_id is null and l.estimated_action_date<v_today
    group by a.application_id,a.candidate_id,c.name,c.nickname,a.group_id,g.group_position
    union all
    select 'group:'||g.group_id,'sourcing',g.group_id,null::uuid,
      coalesce(nullif(btrim(pg.group_position),''),g.group_id),g.group_id,'sourcingGap',
      (select max(u.updated_at at time zone 'Asia/Bangkok')::date from app_private.report_sourcing_weekly_updates u where u.group_id=g.group_id),null::integer,0::integer
    from open_groups g left join app_private.report_position_groups pg using(group_id)
    where p_metric='sourcing' and not exists(select 1 from app_private.report_sourcing_weekly_updates u where u.group_id=g.group_id and (u.updated_at at time zone 'Asia/Bangkok')::date>v_today-6)
  ),

  page_rows as materialized (
    select * from metric_rows
    where p_after_priority is null or priority<p_after_priority or (priority=p_after_priority and id>p_after_id)
    order by priority desc,id limit p_limit+1
  ), limited as (select * from page_rows order by priority desc,id limit p_limit)
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',type,'recordId',record_id,'applicationId',application_id,'title',title,'meta',meta,'reason',reason,'actionDate',action_date,'quantity',quantity) order by priority desc,id) from limited),'[]'::jsonb),
    'totalCount',(select count(*) from metric_rows),
    'hasMore',(select count(*)>p_limit from page_rows),
    'nextCursor',(select jsonb_build_object('priority',priority,'id',id) from limited order by priority asc,id desc limit 1)
  ) into v_result;

  end if;
  return v_result;
end $home_metric$;
revoke all on function public.app_home_metric_page_v1(text,jsonb,integer,text,integer) from public,anon,authenticated;
grant execute on function public.app_home_metric_page_v1(text,jsonb,integer,text,integer) to authenticated;
