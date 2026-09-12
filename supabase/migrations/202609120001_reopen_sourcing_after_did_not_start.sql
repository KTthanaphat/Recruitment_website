-- A candidate who accepted an offer but did not start reopens the vacancy.
-- Keep sourcing eligibility aligned with requisition status calculation.
create or replace function app_private.has_open_group_requisition(p_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_groups dg
    join public.requisitions r on r.doc_id = dg.doc_id
    left join lateral (
      select count(*)::integer as accepted_count
      from public.offers o
      where o.doc_id = r.doc_id
        and o.accepted_date is not null
        and o.start_confirmation is distinct from 'did_not_start'
    ) accepted on true
    where dg.group_id = p_group_id
      and r.status = 'ongoing'
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
  )
$$;
