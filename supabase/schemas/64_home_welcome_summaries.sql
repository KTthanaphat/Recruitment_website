-- Complete-population Home banner aggregates. Keep these distinct: the welcome
-- prompt uses responsibility/PIM eligibility; the Home banner uses header scope.
create or replace function public.app_home_welcome_summary_v1()
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_month_start date := date_trunc('month',(now() at time zone 'Asia/Bangkok'))::date;
  v_month_end date := (date_trunc('month',(now() at time zone 'Asia/Bangkok')) + interval '1 month - 1 day')::date;
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then
    raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED';
  end if;
  select p.* into v_profile from public.profiles p where p.id=auth.uid();
  if not found then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;

  with responsible_requisitions as materialized (
    select r.doc_id,r.site,r.person_in_charge,r.status,r.head_count,r.pr_approved_date
    from public.requisitions r
    where app_private.can_read_requisition(r.doc_id)
      and (v_profile.role in ('system_admin','admin_recruiter')
        or (coalesce(v_profile.nickname,'')<>'' and position(lower(v_profile.nickname) in lower(coalesce(r.person_in_charge,'')))>0)
        or (coalesce(v_profile.full_name,'')<>'' and position(lower(v_profile.full_name) in lower(coalesce(r.person_in_charge,'')))>0)
        or (coalesce(v_profile.site,'')<>'' and position(lower(v_profile.site) in lower(coalesce(r.site,'')))>0))
  ), readable_offers as materialized (
    select o.* from public.offers o where app_private.can_read_application(o.application_id)
  ), offer_totals as (
    select o.doc_id,count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') as accepted,
      max(o.accepted_date) as close_date
    from readable_offers o group by o.doc_id
  ), filled_dates as (
    select l.doc_id,max(l.log_date) as close_date from public.requisition_logs l
    join responsible_requisitions r using(doc_id) where l.status='filled' group by l.doc_id
  ), actionable_requisitions as (
    select r.doc_id,r.head_count,
      greatest(r.head_count-coalesce(o.accepted,0),0) as open_headcount
    from responsible_requisitions r left join offer_totals o using(doc_id)
    where r.status not in ('filled','cancel')
  ), pim_requisitions as (
    select r.doc_id,r.head_count,
      coalesce(f.close_date,o.close_date) as close_date
    from responsible_requisitions r left join offer_totals o using(doc_id) left join filled_dates f using(doc_id)
    where r.pr_approved_date is not null and r.pr_approved_date<=v_month_end and r.status<>'cancel'
  ), eligible_pim as (
    select p.* from pim_requisitions p where p.close_date is null or p.close_date>=v_month_start
  ), visible_apps as materialized (
    select a.application_id,a.candidate_id,a.group_id
    from public.candidate_applications a
    join public.candidates c on c.candidate_id=a.candidate_id and app_private.can_read_candidate(c.candidate_id)
    where app_private.can_read_application(a.application_id)
      and (
        v_profile.role in ('system_admin','admin_recruiter')
        or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id)
          where d.group_id=a.group_id and (
            app_private.can_read_requisition(r.doc_id) and (
            (coalesce(v_profile.nickname,'')<>'' and position(lower(v_profile.nickname) in lower(coalesce(r.person_in_charge,'')))>0)
            or (coalesce(v_profile.full_name,'')<>'' and position(lower(v_profile.full_name) in lower(coalesce(r.person_in_charge,'')))>0)
            or (coalesce(v_profile.site,'')<>'' and position(lower(v_profile.site) in lower(coalesce(r.site,'')))>0))))
      )
  ), latest_logs as (
    select distinct on (l.application_id) l.application_id,l.recruitment_process,l.result
    from public.recruitment_logs l join visible_apps a using(application_id)
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,
      case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,
      l.round desc,l.log_id desc
  ), active_candidates as (
    select l.application_id,a.candidate_id,l.recruitment_process,l.result
    from latest_logs l join visible_apps a using(application_id)
    where l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and l.result is distinct from 0
      and not exists(select 1 from readable_offers o
        where o.application_id=l.application_id
          and app_private.can_read_requisition(o.doc_id)
          and app_private.can_read_application(o.application_id))
  ), counts as (
    select
      (select count(*)::integer from actionable_requisitions where open_headcount>0) as open_requisitions,
      (select coalesce(sum(open_headcount),0)::integer from actionable_requisitions) as open_vacancy,
      (select count(*)::integer from active_candidates) as active_candidates,
      (select count(*)::integer from active_candidates where recruitment_process='Offer' and result=1) as offer_finalization_needed,
      (select count(*)::integer from readable_offers o join eligible_pim p using(doc_id)
        where o.accepted_date between v_month_start and v_today and app_private.can_read_application(o.application_id)
          and app_private.can_read_requisition(o.doc_id)) as filled_this_month,
      (select coalesce(sum(head_count),0)::integer from eligible_pim) as responsible_vacancy_total
  )
  select jsonb_build_object(
    'openRequisitions',open_requisitions,
    'openVacancy',open_vacancy,
    'activeCandidates',active_candidates,
    'offerFinalizationNeeded',offer_finalization_needed,
    'filledThisMonth',filled_this_month,
    'responsibleVacancyTotal',responsible_vacancy_total,
    'filledResponsibleVacancyRatio',case when responsible_vacancy_total>0 then floor(filled_this_month::numeric/responsible_vacancy_total*100)::integer else 0 end,
    'filledResponsibleVacancyBucket',case when responsible_vacancy_total>0 then
      case when floor(filled_this_month::numeric/responsible_vacancy_total*100)>=100 then 100
        when floor(filled_this_month::numeric/responsible_vacancy_total*100)>=75 then 75
        when floor(filled_this_month::numeric/responsible_vacancy_total*100)>=50 then 50
        when floor(filled_this_month::numeric/responsible_vacancy_total*100)>=25 then 25 else 0 end else 0 end
  ) into v_result from counts;
  return v_result;
end $$;

create or replace function public.app_home_banner_summary_v1(p_scope jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_month text := to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM');
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string')
    or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'HOME_SCOPE_INVALID'; end if;
  with scoped_reqs as (
    select r.doc_id,r.head_count,r.status from public.requisitions r
    where app_private.can_read_requisition(r.doc_id)
      and (coalesce(btrim(p_scope->>'headerSite'),'')='' or position(lower(btrim(p_scope->>'headerSite')) in lower(coalesce(r.site,'')))>0)
      and (coalesce(btrim(p_scope->>'headerPic'),'')='' or position(lower(btrim(p_scope->>'headerPic')) in lower(coalesce(r.person_in_charge,'')))>0)
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
  )
  select jsonb_build_object(
    'monthlyFillCapacity',coalesce((select sum(head_count)::integer from scoped_reqs where status<>'cancel'),0),
    'monthlyFilledCount',(select count(*)::integer from public.offers o join scoped_reqs r using(doc_id)
      where left(o.accepted_date::text,7)=v_month
        and app_private.can_read_requisition(o.doc_id) and app_private.can_read_application(o.application_id))
  ) into v_result;
  return v_result;
end $$;

revoke all on function public.app_home_welcome_summary_v1() from public,anon,authenticated;
grant execute on function public.app_home_welcome_summary_v1() to authenticated;
revoke all on function public.app_home_banner_summary_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_home_banner_summary_v1(jsonb) to authenticated;
