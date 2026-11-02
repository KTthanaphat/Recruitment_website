-- Bounded search over the existing authorization-filtered destination projection.
-- The underlying profile-contract RPC remains the sole owner of destination access rules.
create or replace function public.app_application_destinations_page_v1(
  p_search text default '',
  p_after_group_id text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, app_private
as $$
declare
  v_limit integer := coalesce(p_limit, 50);
  v_search text := btrim(coalesce(p_search, ''));
  v_result jsonb;
begin
  if v_limit < 1 or v_limit > 100 then raise exception 'DESTINATION_PAGE_LIMIT_INVALID'; end if;

  with authorized_destinations as materialized (
    select d.group_id, d.group_position, coalesce(d.sites, '{}'::text[]) sites,
      coalesce(d.owners, '{}'::text[]) owners, coalesce(d.doc_ids, '{}'::text[]) doc_ids
    from jsonb_to_recordset(public.app_application_destinations_v1()) as d(
      group_id text, group_position text, sites text[], owners text[], doc_ids text[]
    )
  ), filtered as (
    select d.*
    from authorized_destinations d
    where (p_after_group_id is null or d.group_id > p_after_group_id)
      and (v_search = '' or concat_ws(' ', d.group_id,
        case when d.group_id ~* '^GRP-[0-9]+$' then split_part(d.group_id, '-', 1) || '-' ||
          lpad(split_part(d.group_id, '-', 2), greatest(5, length(split_part(d.group_id, '-', 2))), '0') else d.group_id end,
        d.group_position, array_to_string(d.sites, ' '), array_to_string(d.owners, ' '), array_to_string(d.doc_ids, ' ')
      ) ilike '%' || v_search || '%')
    order by d.group_id
    limit v_limit + 1
  ), page_rows as (
    select * from filtered order by group_id limit v_limit
  ), page_info as (
    select count(*) > v_limit has_more from filtered
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'group_id', group_id, 'group_position', group_position, 'sites', sites, 'owners', owners, 'doc_ids', doc_ids
    ) order by group_id) from page_rows), '[]'::jsonb),
    'has_more', (select has_more from page_info),
    'next_cursor', (select case when has_more then jsonb_build_object('group_id', (select group_id from page_rows order by group_id desc limit 1)) else null end from page_info)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.app_application_destinations_page_v1(text,text,integer) from public, anon, authenticated;
grant execute on function public.app_application_destinations_page_v1(text,text,integer) to authenticated;

-- Searchable, bounded offer-candidate options for forms that previously loaded every application.
create or replace function public.app_offer_candidates_page_v1(
  p_search text default '',
  p_after_candidate_id text default null,
  p_after_application_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := coalesce(p_limit, 50);
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if v_limit < 1 or v_limit > 100 then raise exception 'OFFER_CANDIDATE_PAGE_LIMIT_INVALID'; end if;
  if (p_after_candidate_id is null) <> (p_after_application_id is null) then raise exception 'OFFER_CANDIDATE_CURSOR_INVALID'; end if;

  with latest as (
    select distinct on (l.application_id)
      l.application_id, l.recruitment_process, l.result, l.round, l.log_id
    from public.recruitment_logs l
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,
      case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,
      l.round desc, l.log_id desc
  ), eligible as (
    select a.application_id, a.candidate_id, c.name, pg.group_position,
      case when c.candidate_id ~* '^CAN-[0-9]+$' then
        lower(split_part(c.candidate_id, '-', 1)) || '-' ||
        lpad(length(coalesce(nullif(ltrim(split_part(c.candidate_id, '-', 2), '0'), ''), '0'))::text, 20, '0') || '-' ||
        coalesce(nullif(ltrim(split_part(c.candidate_id, '-', 2), '0'), ''), '0') || '-' || lower(c.candidate_id)
        else lower(c.candidate_id) end as id_sort,
      docs.doc_ids
    from public.candidate_applications a
    join public.candidates c on c.candidate_id = a.candidate_id
    join public.position_groups pg on pg.group_id = a.group_id
    join latest l on l.application_id = a.application_id and l.recruitment_process = 'Offer' and l.result = 1
    join lateral (
      select array_agg(open_req.doc_id order by open_req.doc_id) as doc_ids
      from (
        select d.doc_id
        from public.document_groups d
        join public.requisitions r on r.doc_id = d.doc_id
        where d.group_id = a.group_id and r.status = 'ongoing'
          and app_private.can_read_requisition(r.doc_id)
          and greatest(r.head_count - coalesce((
            select count(*)::integer from public.offers counted
            where counted.doc_id = r.doc_id and counted.accepted_date is not null
              and counted.start_confirmation is distinct from 'did_not_start'
              and app_private.can_read_application(counted.application_id)
          ), 0), 0) > 0
      ) open_req
    ) docs on cardinality(docs.doc_ids) > 0
    where a.state = 'active'
      and app_private.can_read_application(a.application_id)
      and app_private.can_read_candidate(a.candidate_id)
      and not exists(select 1 from public.offers o where o.application_id = a.application_id)
      and (v_search = '' or concat_ws(' ', c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then
          upper(split_part(c.candidate_id, '-', 1)) || '-' ||
          lpad(split_part(c.candidate_id, '-', 2), greatest(5, length(split_part(c.candidate_id, '-', 2))), '0')
          else c.candidate_id end,
        c.name, pg.group_position, array_to_string(docs.doc_ids, ' ')
      ) ilike '%' || v_search || '%')
  ), filtered as (
    select * from eligible e
    where p_after_candidate_id is null or
      (e.id_sort, e.candidate_id, e.application_id) > (
        case when p_after_candidate_id ~* '^CAN-[0-9]+$' then
          lower(split_part(p_after_candidate_id, '-', 1)) || '-' ||
          lpad(length(coalesce(nullif(ltrim(split_part(p_after_candidate_id, '-', 2), '0'), ''), '0'))::text, 20, '0') || '-' ||
          coalesce(nullif(ltrim(split_part(p_after_candidate_id, '-', 2), '0'), ''), '0') || '-' || lower(p_after_candidate_id)
          else lower(p_after_candidate_id) end,
        p_after_candidate_id, p_after_application_id
      )
    order by e.id_sort, e.candidate_id, e.application_id
    limit v_limit + 1
  ), page_rows as (
    select * from filtered order by id_sort, candidate_id, application_id limit v_limit
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'candidate_id', candidate_id, 'application_id', application_id, 'name', name,
      'group_position', group_position, 'doc_ids', doc_ids
    ) order by id_sort, candidate_id, application_id) from page_rows), '[]'::jsonb),
    'has_more', (select count(*) > v_limit from filtered),
    'next_cursor', (select case when count(*) > v_limit then (
      select jsonb_build_object('candidate_id', candidate_id, 'application_id', application_id)
      from page_rows order by id_sort desc, candidate_id desc, application_id desc limit 1
    ) else null end from filtered)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.app_offer_candidates_page_v1(text,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.app_offer_candidates_page_v1(text,text,uuid,integer) to authenticated;
