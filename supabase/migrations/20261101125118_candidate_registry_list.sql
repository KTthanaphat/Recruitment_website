-- Database-wide, cursor-paged recruitment list projections.
create index if not exists candidate_applications_candidate_state on public.candidate_applications(candidate_id,state);

create or replace function public.app_recruitment_list_v1(
  p_entity text,
  p_search text default '',
  p_filters jsonb default '{}'::jsonb,
  p_sort text default '',
  p_direction text default 'desc',
  p_limit integer default 50,
  p_cursor_value jsonb default null,
  p_cursor_id text default null,
  p_before boolean default false
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_scope text := coalesce(nullif(p_filters->>'scope',''), 'all');
  v_site text := coalesce(p_filters->>'site','');
  v_owner text := coalesce(p_filters->>'owner','');
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_sort text := coalesce(nullif(p_sort,''), 'updated_at');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_cursor_value text;
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then
    raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED';
  end if;
  if p_entity <> 'candidate_registry' then
    raise exception 'RECRUITMENT_LIST_ENTITY_UNSUPPORTED';
  end if;
  if p_limit not in (25,50,100) then
    raise exception 'RECRUITMENT_LIST_LIMIT_INVALID';
  end if;
  if v_scope not in ('all','pool','active','history') then
    raise exception 'RECRUITMENT_LIST_SCOPE_INVALID';
  end if;
  if v_sort not in ('updated_at','candidate_id','name','active_application_count') then
    raise exception 'RECRUITMENT_LIST_SORT_INVALID';
  end if;
  if v_direction not in ('asc','desc') then
    raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID';
  end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb)) <> 'object' then
    raise exception 'RECRUITMENT_LIST_FILTER_INVALID';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) key_name where key_name not in ('scope','site','owner')) then
    raise exception 'RECRUITMENT_LIST_FILTER_INVALID';
  end if;
  if (p_cursor_value is null) <> (p_cursor_id is null) then
    raise exception 'RECRUITMENT_LIST_CURSOR_INVALID';
  end if;
  if p_cursor_value is not null and jsonb_typeof(p_cursor_value) <> 'string' then
    raise exception 'RECRUITMENT_LIST_CURSOR_INVALID';
  end if;
  if p_cursor_value is not null and (p_cursor_id = '' or p_cursor_id is null) then
    raise exception 'RECRUITMENT_LIST_CURSOR_INVALID';
  end if;
  if p_before and p_cursor_value is null then
    raise exception 'RECRUITMENT_LIST_CURSOR_INVALID';
  end if;
  v_cursor_value := p_cursor_value #>> '{}';

  with capabilities as (
    select c.candidate_id,c.creator_label,c.is_unmatched
    from jsonb_to_recordset(public.app_candidate_profile_capabilities_v1()) as c(
      candidate_id text, creator_label text, can_edit boolean, can_read_note boolean,
      can_edit_note boolean, can_add_application boolean, is_unmatched boolean, note_editor_label text
    )
  ), readable_candidates as (
    select
      c.candidate_id,
      true as readable,
      false as masked,
      c.name,
      c.nickname,
      c.phone_no,
      c.email,
      c.home_site,
      caps.creator_label,
      c.channel,
      c.position_interests,
      apps.active_count as active_application_count,
      apps.has_closed,
      caps.is_unmatched,
      c.created_at,
      c.updated_at
    from public.candidates c
    join capabilities caps on caps.candidate_id = c.candidate_id
    cross join lateral (
      select
        count(*) filter (where a.state = 'active')::integer as active_count,
        coalesce(bool_or(a.state = 'closed'),false) as has_closed
      from public.candidate_applications a
      where a.candidate_id = c.candidate_id
    ) apps
    where app_private.can_read_candidate(c.candidate_id)
  ), masked_candidates as (
    select
      m.candidate_id,
      false as readable,
      true as masked,
      null::text as name,
      null::text as nickname,
      null::text as phone_no,
      null::text as email,
      null::text as home_site,
      m.creator_label,
      null::text as channel,
      m.position_interests,
      null::integer as active_application_count,
      false as has_closed,
      true as is_unmatched,
      m.created_at,
      null::timestamptz as updated_at
    from jsonb_to_recordset(public.app_masked_candidate_pool_v1()) as m(
      candidate_id text, position_interests text, created_by uuid, creator_label text, created_at timestamptz
    )
  ), candidate_base as (
    select * from readable_candidates
    union all
    select * from masked_candidates
  ), candidate_projection as (
    select
      b.*,
      jsonb_build_object(
        'candidate_id', b.candidate_id,
        'name', case when b.masked then null else b.name end,
        'nickname', case when b.masked then null else b.nickname end,
        'phone_no', case when b.masked then null else b.phone_no end,
        'email', case when b.masked then null else b.email end,
        'home_site', case when b.masked then null else b.home_site end,
        'creator_label', b.creator_label,
        'channel', case when b.masked then null else b.channel end,
        'position_interests', b.position_interests,
        'active_application_count', case when b.masked then null else b.active_application_count end,
        'updated_at', case when b.masked then null else b.updated_at end,
        'created_at', b.created_at,
        'masked', b.masked,
        'is_unmatched', b.is_unmatched
      ) as item,
      case v_sort
        when 'candidate_id' then lower(b.candidate_id)
        when 'name' then lower(coalesce(b.name,b.nickname,''))
        when 'active_application_count' then lpad(coalesce(b.active_application_count,0)::text,12,'0')
        else to_char(coalesce(b.updated_at,b.created_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      end as sort_value
    from candidate_base b
    where (b.readable or (b.masked and v_scope in ('all','pool')))
      and (v_site = '' or b.masked or b.home_site = v_site)
      and (v_owner = '' or b.creator_label = v_owner)
      and (v_scope = 'all' or (v_scope = 'pool' and coalesce(b.is_unmatched,false)) or (v_scope = 'active' and coalesce(b.active_application_count,0) > 0) or (v_scope = 'history' and coalesce(b.has_closed,false)))
      and (
        v_search = ''
        or (
        lower(b.candidate_id) like '%' || v_search || '%'
        or lower(case when b.candidate_id ~* '^(CAN|GRP)-[0-9]+$' then
          upper(substring(b.candidate_id from '^([A-Za-z]+)-')) || '-' ||
          case when length(substring(b.candidate_id from '-([0-9]+)$')) < 5
            then lpad(substring(b.candidate_id from '-([0-9]+)$'),5,'0')
            else substring(b.candidate_id from '-([0-9]+)$') end
          else b.candidate_id end) like '%' || v_search || '%'
        or (not b.masked and concat_ws(' ',b.name,b.nickname,b.phone_no,b.email,b.position_interests) ilike '%' || v_search || '%')
        or (b.masked and concat_ws(' ',b.position_interests,b.creator_label) ilike '%' || v_search || '%')
        )
      )
  ), filtered as (
    select * from candidate_projection f
    where p_cursor_value is null
      or (not p_before and (
        (v_direction='asc' and (f.sort_value > v_cursor_value or (f.sort_value=v_cursor_value and f.candidate_id > p_cursor_id)))
        or (v_direction='desc' and (f.sort_value < v_cursor_value or (f.sort_value=v_cursor_value and f.candidate_id > p_cursor_id)))
      ))
      or (p_before and (
        (v_direction='asc' and (f.sort_value < v_cursor_value or (f.sort_value=v_cursor_value and f.candidate_id < p_cursor_id)))
        or (v_direction='desc' and (f.sort_value > v_cursor_value or (f.sort_value=v_cursor_value and f.candidate_id < p_cursor_id)))
      ))
  ), matched_count as (
    select count(*)::integer as total_count from candidate_projection
  ), page_raw as (
    select * from filtered
    order by
      case when not p_before and v_direction='asc' then sort_value end asc,
      case when not p_before and v_direction='desc' then sort_value end desc,
      case when p_before and v_direction='asc' then sort_value end desc,
      case when p_before and v_direction='desc' then sort_value end asc,
      case when p_before then candidate_id end desc,
      case when not p_before then candidate_id end asc
    limit p_limit
  ), page_rows as (
    select * from page_raw
    order by
      case when v_direction='asc' then sort_value end asc,
      case when v_direction='desc' then sort_value end desc,
      candidate_id asc
  ), page_edges as (
    select
      (array_agg(sort_value order by case when v_direction='asc' then sort_value end asc, case when v_direction='desc' then sort_value end desc, candidate_id asc))[1] as first_sort,
      (array_agg(candidate_id order by case when v_direction='asc' then sort_value end asc, case when v_direction='desc' then sort_value end desc, candidate_id asc))[1] as first_id,
      (array_agg(sort_value order by case when v_direction='asc' then sort_value end desc, case when v_direction='desc' then sort_value end asc, candidate_id desc))[1] as last_sort,
      (array_agg(candidate_id order by case when v_direction='asc' then sort_value end desc, case when v_direction='desc' then sort_value end asc, candidate_id desc))[1] as last_id
    from page_rows
  ), availability as (
    select
      exists(select 1 from candidate_projection f cross join page_edges e where e.last_id is not null and ((v_direction='asc' and (f.sort_value>e.last_sort or (f.sort_value=e.last_sort and f.candidate_id>e.last_id))) or (v_direction='desc' and (f.sort_value<e.last_sort or (f.sort_value=e.last_sort and f.candidate_id>e.last_id))))) as has_more,
      exists(select 1 from candidate_projection f cross join page_edges e where e.first_id is not null and ((v_direction='asc' and (f.sort_value<e.first_sort or (f.sort_value=e.first_sort and f.candidate_id<e.first_id))) or (v_direction='desc' and (f.sort_value>e.first_sort or (f.sort_value=e.first_sort and f.candidate_id<e.first_id))))) as has_more_before
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(item order by case when v_direction='asc' then sort_value end asc, case when v_direction='desc' then sort_value end desc, candidate_id asc) from page_rows),'[]'::jsonb),
    'total_count', (select total_count from matched_count),
    'has_more', availability.has_more,
    'has_more_before', availability.has_more_before,
    'next_cursor', case when availability.has_more then jsonb_build_object('value',to_jsonb(page_edges.last_sort),'id',page_edges.last_id) else null end,
    'previous_cursor', case when availability.has_more_before then jsonb_build_object('value',to_jsonb(page_edges.first_sort),'id',page_edges.first_id) else null end
  ) into v_result
  from page_edges cross join availability;

  return v_result;
end;
$$;

revoke all on function public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean) from public, anon, authenticated;
grant execute on function public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean) to authenticated;
