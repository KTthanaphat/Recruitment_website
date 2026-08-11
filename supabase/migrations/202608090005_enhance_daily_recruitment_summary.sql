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
  open_requisition_docs as (
    select
      r.doc_id,
      r.site,
      coalesce(nullif(r.person_in_charge, ''), 'Unassigned') as person_in_charge,
      greatest(r.head_count - coalesce(a.accepted_count, 0), 0) as open_headcount
    from public.requisitions r
    left join accepted_by_doc a on a.doc_id = r.doc_id
    where r.status not in ('filled', 'cancel')
      and greatest(r.head_count - coalesce(a.accepted_count, 0), 0) > 0
  ),
  responsibility_totals as (
    select site, person_in_charge, sum(open_headcount)::int as responsible_vacancy, count(*)::int as open_requisition_count
    from open_requisition_docs
    group by site, person_in_charge
  ),
  responsibility_candidates as (
    select distinct o.site, o.person_in_charge, c.candidate_id
    from open_requisition_docs o
    join public.document_groups dg on dg.doc_id = o.doc_id
    join public.candidates c on c.doc_group_id = dg.doc_group_id
  ),
  latest_candidate_logs as (
    select distinct on (l.candidate_id)
      l.candidate_id,
      l.recruitment_process,
      l.result
    from public.recruitment_logs l
    where l.superseded_at is null
      and l.superseded_by_stage_instance_id is null
    order by l.candidate_id, l.log_id desc
  ),
  candidate_state_counts as (
    select
      rc.site,
      rc.person_in_charge,
      case
        when l.candidate_id is null then 'No activity'
        when l.result = 1 then l.recruitment_process || ' — Passed'
        when l.result = 0 then l.recruitment_process || ' — Failed'
        else l.recruitment_process || ' — Pending'
      end as state,
      count(distinct rc.candidate_id)::int as candidate_count
    from responsibility_candidates rc
    left join latest_candidate_logs l on l.candidate_id = rc.candidate_id
    group by rc.site, rc.person_in_charge, state
  ),
  open_responsibilities as (
    select
      rt.site,
      rt.person_in_charge,
      rt.responsible_vacancy,
      rt.open_requisition_count,
      coalesce((
        select jsonb_object_agg(csc.state, csc.candidate_count order by csc.state)
        from candidate_state_counts csc
        where csc.site = rt.site and csc.person_in_charge = rt.person_in_charge
      ), '{}'::jsonb) as candidate_states
    from responsibility_totals rt
  ),
  yesterday_new as (
    select doc_id, site, position, coalesce(nullif(person_in_charge, ''), 'Unassigned') as person_in_charge
    from public.requisitions
    where pr_approved_date = p_report_date - 1
  ),
  yesterday_filled_base as (
    select distinct on (l.doc_id)
      l.doc_id,
      r.site,
      r.position,
      coalesce(nullif(r.person_in_charge, ''), 'Unassigned') as person_in_charge
    from public.requisition_logs l
    join public.requisitions r on r.doc_id = l.doc_id
    where l.log_date = p_report_date - 1 and l.status = 'filled'
    order by l.doc_id, l.log_id desc
  ),
  yesterday_filled as (
    select
      yf.*,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'candidate_id', candidates_for_requisition.candidate_id,
          'name', candidates_for_requisition.name,
          'first_contact_date', candidates_for_requisition.first_contact_date
        ) order by candidates_for_requisition.name, candidates_for_requisition.candidate_id)
        from (
          select distinct c.candidate_id, c.name, c.first_contact_date
          from public.document_groups dg
          join public.candidates c on c.doc_group_id = dg.doc_group_id
          where dg.doc_id = yf.doc_id
            and (c.created_at at time zone 'Asia/Bangkok')::date = p_report_date - 1
        ) candidates_for_requisition
      ), '[]'::jsonb) as new_candidates
    from yesterday_filled_base yf
  ),
  yesterday_accepted as (
    select o.doc_id, r.site, r.position, coalesce(nullif(r.person_in_charge, ''), 'Unassigned') as person_in_charge
    from public.offers o
    join public.requisitions r on r.doc_id = o.doc_id
    where o.accepted_date = p_report_date - 1
  )
  select jsonb_build_object(
    'report_date', p_report_date,
    'open_responsibilities', coalesce(
      (select jsonb_agg(to_jsonb(row) order by row.site, row.person_in_charge) from open_responsibilities row),
      '[]'::jsonb
    ),
    'yesterday', jsonb_build_object(
      'new_requisitions', coalesce((select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from yesterday_new row), '[]'::jsonb),
      'filled_requisitions', coalesce((select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from yesterday_filled row), '[]'::jsonb),
      'accepted_offers', coalesce((select jsonb_agg(to_jsonb(row) order by row.site, row.doc_id) from yesterday_accepted row), '[]'::jsonb)
    )
  );
$$;
