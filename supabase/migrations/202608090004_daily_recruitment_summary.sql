-- Read-only summary for the protected Power Automate daily-email endpoint.
create or replace function public.app_daily_recruitment_summary(p_report_date date)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with accepted_by_doc as (
    select doc_id, count(*)::int as accepted_count
    from public.offers
    where accepted_date is not null
    group by doc_id
  ),
  open_requisitions as (
    select
      r.doc_id,
      r.site,
      r.department,
      r.position,
      r.person_in_charge,
      greatest(r.head_count - coalesce(a.accepted_count, 0), 0) as open_headcount
    from public.requisitions r
    left join accepted_by_doc a on a.doc_id = r.doc_id
    where r.status not in ('filled', 'cancel')
      and greatest(r.head_count - coalesce(a.accepted_count, 0), 0) > 0
  ),
  yesterday_new as (
    select doc_id, site, position, person_in_charge
    from public.requisitions
    where pr_approved_date = p_report_date - 1
  ),
  yesterday_filled as (
    select distinct on (l.doc_id) l.doc_id, r.site, r.position, r.person_in_charge
    from public.requisition_logs l
    join public.requisitions r on r.doc_id = l.doc_id
    where l.log_date = p_report_date - 1
      and l.status = 'filled'
    order by l.doc_id, l.log_id desc
  ),
  yesterday_accepted as (
    select o.doc_id, r.site, r.position, r.person_in_charge
    from public.offers o
    join public.requisitions r on r.doc_id = o.doc_id
    where o.accepted_date = p_report_date - 1
  )
  select jsonb_build_object(
    'report_date', p_report_date,
    'open_requisitions', coalesce(
      (select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from open_requisitions row),
      '[]'::jsonb
    ),
    'yesterday', jsonb_build_object(
      'new_requisitions', coalesce(
        (select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from yesterday_new row),
        '[]'::jsonb
      ),
      'filled_requisitions', coalesce(
        (select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from yesterday_filled row),
        '[]'::jsonb
      ),
      'accepted_offers', coalesce(
        (select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from yesterday_accepted row),
        '[]'::jsonb
      )
    )
  );
$$;

revoke all on function public.app_daily_recruitment_summary(date) from public;
revoke all on function public.app_daily_recruitment_summary(date) from anon;
revoke all on function public.app_daily_recruitment_summary(date) from authenticated;
grant execute on function public.app_daily_recruitment_summary(date) to service_role;
