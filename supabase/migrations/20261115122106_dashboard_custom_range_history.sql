create or replace function app_private.dashboard_company_waterfall_v1(p_start date,p_end date,p_period text,p_scope jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'AUTHENTICATED_PROFILE_REQUIRED'; end if;
  with base as (
    select r.doc_id,r.site,r.department,r.person_in_charge,r.is_priority,r.level,r.head_count,r.request_type,r.status,r.pr_approved_date,r.created_at
    from app_private.report_requisitions r
    where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in (select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
  ), valid as (
    select b.*,
      (select l.status from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) last_status,
      (select l.log_date from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.status='filled' and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) logged_filled,
      exists(select 1 from app_private.report_requisition_logs l where l.doc_id=b.doc_id) has_logs,
      greatest(coalesce(b.head_count,0)-(select count(*) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date is not null and o.accepted_date<p_start and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'UTC')::date>=p_start)),0)::int open_at_start,
      (select max(o.accepted_date) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date<=p_end and (select count(*) from app_private.report_offers x where x.doc_id=b.doc_id and x.accepted_date is not null and x.accepted_date<=o.accepted_date and (x.start_confirmation is distinct from 'did_not_start' or x.start_confirmed_at is null or (x.start_confirmed_at at time zone 'UTC')::date>=p_end+1))>=b.head_count) offer_filled
    from base b
  ), eligible as (
    select v.*,coalesce(v.offer_filled,case when v.last_status='filled' then v.logged_filled end) filled_date,coalesce(v.pr_approved_date,(v.created_at at time zone 'UTC')::date) opened_date
    from valid v where v.pr_approved_date is not null and v.pr_approved_date<=p_end and v.last_status is distinct from 'cancel'
      and not (not v.has_logs and v.status='cancel')
      and (coalesce(v.offer_filled,case when v.last_status='filled' then v.logged_filled end) is null or coalesce(v.offer_filled,case when v.last_status='filled' then v.logged_filled end)>=p_start)
      and (p_period in ('pim','custom') or (case when btrim(coalesce(v.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then case when substring(btrim(v.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(v.level) from '([0-9]+)$')::int<=9 then 45 else 60 end end is not null and v.pr_approved_date+(case when substring(btrim(v.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(v.level) from '([0-9]+)$')::int<=9 then 45 else 60 end)>=p_start))
  ), movement as (
    select 'Week Start'::text category,e.site,coalesce(e.request_type,'New') request_type,e.open_at_start::int vacancy_count,0::int filled_in_sla,0::int filled_sla_unknown from eligible e where e.opened_date<p_start and e.open_at_start>0
    union all select 'Open',e.site,coalesce(e.request_type,'New'),e.head_count,0,0 from eligible e where e.opened_date between p_start and p_end
    union all select 'Filled',e.site,coalesce(e.request_type,'New'),-1,case when sla.in_sla is true then 1 else 0 end,case when sla.in_sla is null then 1 else 0 end
      from app_private.report_offers o join eligible e using(doc_id) cross join lateral (select coalesce((select max((n.start_confirmed_at at time zone 'UTC')::date) from app_private.report_offers n where n.doc_id=e.doc_id and n.start_confirmation='did_not_start' and (n.start_confirmed_at at time zone 'UTC')::date<=o.accepted_date),e.pr_approved_date) start_date) restart
      cross join lateral (select case when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([0-9]+)')::int between 0 and 6 then 30 when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([0-9]+)')::int between 7 and 9 then 45 when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([0-9]+)')::int between 10 and 14 then 60 else null end sla_days) sla_policy
      cross join lateral (select case when sla_policy.sla_days is null or restart.start_date is null or restart.start_date>o.accepted_date then null when o.accepted_date-restart.start_date<=sla_policy.sla_days then true else false end in_sla) sla
      where o.accepted_date between p_start and p_end and e.last_status is distinct from 'cancel'
    union all select 'Open',e.site,coalesce(e.request_type,'New'),1,0,0 from app_private.report_offers o join eligible e using(doc_id) where o.start_confirmation='did_not_start' and (o.start_confirmed_at at time zone 'UTC')::date between p_start and p_end and e.last_status is distinct from 'cancel'
  ), grouped as (select category,site,request_type,sum(vacancy_count)::int vacancy_count,sum(filled_in_sla)::int filled_in_sla,sum(filled_sla_unknown)::int filled_sla_unknown from movement group by category,site,request_type), allrows as (
    select * from grouped union all select 'Total',site,request_type,sum(vacancy_count)::int,sum(filled_in_sla)::int,sum(filled_sla_unknown)::int from grouped group by site,request_type
  ) select coalesce(jsonb_agg(jsonb_build_object('waterfall_category',category,'site',site,'request_type',request_type,'vacancy_count',vacancy_count,'filledInSla',filled_in_sla,'filledSlaUnknown',filled_sla_unknown) order by site,request_type,case category when 'Week Start' then 1 when 'Open' then 2 when 'Filled' then 3 else 4 end),'[]'::jsonb) into v_rows from allrows;
  return v_rows;
end;
$$;
revoke all on function app_private.dashboard_company_waterfall_v1(date,date,text,jsonb) from public,anon,authenticated;
grant execute on function app_private.dashboard_company_waterfall_v1(date,date,text,jsonb) to authenticated;
