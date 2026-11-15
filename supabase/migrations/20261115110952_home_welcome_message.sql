create or replace function public.app_home_welcome_message_v1()
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
    from app_private.report_requisitions r
    where app_private.can_read_requisition(r.doc_id)
      and (v_profile.role in ('system_admin','admin_recruiter')
        or (coalesce(v_profile.nickname,'')<>'' and position(lower(v_profile.nickname) in lower(coalesce(r.person_in_charge,'')))>0)
        or (coalesce(v_profile.full_name,'')<>'' and position(lower(v_profile.full_name) in lower(coalesce(r.person_in_charge,'')))>0)
        or (coalesce(v_profile.site,'')<>'' and position(lower(v_profile.site) in lower(coalesce(r.site,'')))>0))
  ), readable_offers as materialized (
    select o.* from app_private.report_offers o where app_private.can_read_application(o.application_id)
  ), offer_totals as (
    select o.doc_id,count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') as accepted,
      max(o.accepted_date) as close_date
    from readable_offers o group by o.doc_id
  ), filled_dates as (
    select l.doc_id,max(l.log_date) as close_date from app_private.report_requisition_logs l
    join responsible_requisitions r using(doc_id) where l.status='filled' group by l.doc_id
  ), pim_requisitions as (
    select r.doc_id,r.head_count,
      coalesce(f.close_date,o.close_date) as close_date
    from responsible_requisitions r left join offer_totals o using(doc_id) left join filled_dates f using(doc_id)
    where r.pr_approved_date is not null and r.pr_approved_date<=v_month_end and r.status<>'cancel'
  ), eligible_pim as (
    select p.* from pim_requisitions p where p.close_date is null or p.close_date>=v_month_start
  ), counts as (
    select
      (select count(*)::integer from readable_offers o join eligible_pim p using(doc_id)
        where o.accepted_date between v_month_start and v_today and app_private.can_read_application(o.application_id)
          and app_private.can_read_requisition(o.doc_id)) as filled_this_month,
      (select coalesce(sum(head_count),0)::integer from eligible_pim) as responsible_vacancy_total
  )
  select jsonb_build_object(
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
revoke all on function public.app_home_welcome_message_v1() from public,anon,authenticated;
grant execute on function public.app_home_welcome_message_v1() to authenticated;
