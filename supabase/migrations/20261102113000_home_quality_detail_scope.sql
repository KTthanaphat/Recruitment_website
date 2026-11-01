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
    left join lateral (select array_agg(distinct d.group_id) filter(where d.group_id is not null) group_ids from public.document_groups d where d.doc_id=r.doc_id) g on true),
  visible_apps as materialized (select distinct a.application_id,a.candidate_id,a.group_id,c.name,c.nickname,to_jsonb(c)->>'phone_no' phone_no,to_jsonb(c)->>'candidate_folder_url' candidate_folder_url,(to_jsonb(a)->>'created_at')::timestamptz created_at,(to_jsonb(c)->>'updated_at')::timestamptz updated_at,c.channel
    from public.candidate_applications a join public.candidates c using(candidate_id)
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and exists(select 1 from public.document_groups d join scoped_reqs r using(doc_id) where d.group_id=a.group_id)),
  latest_apps as (select a.*,
      (select l.recruitment_process from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_process,
      (select l.result from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_result,
      (select l.log_date from public.recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 else 6 end desc,l.round desc,l.log_id desc limit 1) latest_log_date,
      (select o.accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null order by o.accepted_date desc,o.offer_id desc limit 1) accepted_date
    from visible_apps a),
  candidate_rows as (select a.* from latest_apps a),
  group_rows as (select d.group_id,pg.group_position,coalesce(sum(r.open_headcount),0)::integer open_headcount,
      array_agg(distinct r.doc_id order by r.doc_id) doc_ids,max(u.updated_at) latest_update,
      array_agg(distinct r.site) sites,string_agg(distinct r.person_in_charge,', ') owners
    from public.document_groups d join req_metrics r on d.doc_id=r.doc_id left join public.position_groups pg using(group_id)
    left join public.sourcing_weekly_updates u using(group_id) where r.status='ongoing' group by d.group_id,pg.group_position),
  issues as (
    select 'warning'::text severity,'candidate'::text entity,c.candidate_id entity_id,'Possible duplicate candidate'::text title,'Another record has the same phone, name, or folder URL.'::text detail,'Review candidate'::text action_label,
      '/candidates?detailType=candidate&detailId='||c.candidate_id href,'duplicateCandidate'::text workspace_code,
      jsonb_build_object('fields',concat_ws(',',case when exists(select 1 from public.candidates d where d.candidate_id<>c.candidate_id and nullif(c.phone_no,'') is not null and to_jsonb(d)->>'phone_no'=c.phone_no and app_private.can_read_candidate(d.candidate_id)) then 'phone' end,case when exists(select 1 from public.candidates d where d.candidate_id<>c.candidate_id and lower(btrim(d.name))=lower(btrim(c.name)) and app_private.can_read_candidate(d.candidate_id)) then 'name' end,case when exists(select 1 from public.candidates d where d.candidate_id<>c.candidate_id and nullif(c.candidate_folder_url,'') is not null and to_jsonb(d)->>'candidate_folder_url'=c.candidate_folder_url and app_private.can_read_candidate(d.candidate_id)) then 'folder' end)) workspace_params,c.application_id::text journey_id
    from candidate_rows c where exists(select 1 from public.candidates d where d.candidate_id<>c.candidate_id and ((nullif(c.phone_no,'') is not null and to_jsonb(d)->>'phone_no'=c.phone_no) or lower(btrim(d.name))=lower(btrim(c.name)) or (nullif(c.candidate_folder_url,'') is not null and to_jsonb(d)->>'candidate_folder_url'=c.candidate_folder_url)) and app_private.can_read_candidate(d.candidate_id))
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
