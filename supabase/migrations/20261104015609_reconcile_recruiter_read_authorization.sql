-- Forward reconciliation for databases missing the November authorization fast paths.
-- No policy, membership, or public RPC privilege changes.
begin;

create or replace function app_private.can_read_requisition(p_doc_id text) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_req_site text; v_pic text; v_profile_site text; v_nickname text; v_full_name text;
begin
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role in ('system_admin','admin_recruiter','viewer') then return true; end if;
 if v_role<>'site_recruiter' then return false; end if;
 select r.site,r.person_in_charge into v_req_site,v_pic from public.requisitions r where r.doc_id=p_doc_id;
 if not found then return false; end if;
 v_profile_site:=app_private.current_profile_site();
 if v_req_site=v_profile_site then return true; end if;
 select p.nickname,p.full_name into v_nickname,v_full_name from public.profiles p where p.id=auth.uid();
 if lower(btrim(v_pic)) in (lower(btrim(v_nickname)),lower(btrim(v_full_name))) then return true; end if;
 return exists(select 1 from public.document_groups d where d.doc_id=p_doc_id and app_private.is_group_pic(d.group_id));
end
$$;

create or replace function app_private.can_read_position_group(p_group_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text; v_site text; v_nickname text; v_full_name text; v_doc_id text; v_req_site text; v_pic text;
begin
  if auth.uid() is null then return false; end if;
  v_role:=app_private.current_app_role();
  if v_role in ('system_admin','admin_recruiter') then return true; end if;
  if v_role='viewer' then
    return exists(select 1 from public.document_groups dg join public.requisitions r using(doc_id) where dg.group_id=p_group_id);
  end if;
  if v_role<>'site_recruiter' then return false; end if;
  v_site:=app_private.current_profile_site();
  select p.nickname,p.full_name into v_nickname,v_full_name from public.profiles p where p.id=auth.uid();
  for v_doc_id in select dg.doc_id from public.document_groups dg where dg.group_id=p_group_id loop
    select r.site,r.person_in_charge into v_req_site,v_pic from public.requisitions r where r.doc_id=v_doc_id;
    if not found then continue; end if;
    if v_req_site=v_site then return true; end if;
    if lower(btrim(v_pic)) in (lower(btrim(v_nickname)),lower(btrim(v_full_name))) then return true; end if;
    if exists(
      select 1 from public.document_groups shared
      where shared.doc_id=v_doc_id and exists(
        select 1 from public.document_groups claimed join public.requisitions owner_req on owner_req.doc_id=claimed.doc_id
        where claimed.group_id=shared.group_id
          and nullif(btrim(owner_req.person_in_charge),'') is not null
          and lower(btrim(owner_req.person_in_charge)) in (lower(btrim(v_nickname)),lower(btrim(v_full_name)))
      )
    ) then return true; end if;
  end loop;
  return false;
end
$$;

create or replace function app_private.can_read_application(p_id uuid) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_group text;
begin
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role not in ('system_admin','admin_recruiter','site_recruiter','viewer') then return false; end if;
 select a.group_id into v_group from public.candidate_applications a where a.application_id=p_id;
 if not found then return false; end if;
 if v_role in ('system_admin','admin_recruiter','viewer') then return true; end if;
 return app_private.can_read_position_group(v_group);
end
$$;

create or replace function app_private.can_read_candidate(p_candidate_id text) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_created_by uuid; v_home_site text; v_group text; v_profile_site text;
begin
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role not in ('system_admin','admin_recruiter','site_recruiter','viewer') then return false; end if;
 select c.created_by,c.home_site into v_created_by,v_home_site from public.candidates c where c.candidate_id=p_candidate_id;
 if not found then return false; end if;
 if v_role in ('system_admin','admin_recruiter') or v_created_by=auth.uid() then return true; end if;
 if v_role='viewer' then
   return exists(select 1 from public.candidate_applications a where a.candidate_id=p_candidate_id);
 end if;
 v_profile_site:=app_private.current_profile_site();
 if v_home_site is not null and v_home_site=v_profile_site then
   return exists(select 1 from public.candidate_applications a where a.candidate_id=p_candidate_id);
 end if;
 for v_group in select a.group_id from public.candidate_applications a where a.candidate_id=p_candidate_id loop
   if app_private.can_read_position_group(v_group) then return true; end if;
 end loop;
 return false;
end
$$;

revoke all on function app_private.can_read_requisition(text) from public,anon;
grant execute on function app_private.can_read_requisition(text) to authenticated;
revoke all on function app_private.can_read_position_group(text) from public,anon;
grant execute on function app_private.can_read_position_group(text) to authenticated;
revoke all on function app_private.can_read_application(uuid) from public,anon;
grant execute on function app_private.can_read_application(uuid) to authenticated;
revoke all on function app_private.can_read_candidate(text) from public,anon;
grant execute on function app_private.can_read_candidate(text) to authenticated;

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
  with eligible_applications as materialized (
    select a.* from public.candidate_applications a join public.candidates c on c.candidate_id=a.candidate_id
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and (p_group_id is null or a.group_id=p_group_id)
      and (coalesce(p_scope->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_scope->>'headerSite'))
      and (coalesce(p_scope->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_scope->>'headerPic'))))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))
  ), accepted_offers as materialized (
    select o.application_id,min(o.accepted_date) accepted_date from public.offers o
    join eligible_applications a on a.application_id=o.application_id
    where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start'
    group by o.application_id
  ), latest as (
    select distinct on(l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l join eligible_applications eligible on eligible.application_id=l.application_id where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc
  ), rows as (
    select a.application_id,a.group_id,a.state,coalesce(lat.recruitment_process,'No activity') stage,lat.result,lat.log_date,lat.outcome_date,
      off.accepted_date,
      (lat.log_date is not null and p_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) aging,
      (lat.application_id is null) no_activity,
      coalesce(lat.recruitment_process='Offer' and lat.result=1,false) passed_offer
    from eligible_applications a
    left join latest lat on lat.application_id=a.application_id
    left join accepted_offers off on off.application_id=a.application_id
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

commit;
