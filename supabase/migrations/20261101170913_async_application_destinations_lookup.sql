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
