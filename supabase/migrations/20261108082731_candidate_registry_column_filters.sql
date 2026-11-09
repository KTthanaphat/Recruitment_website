CREATE OR REPLACE FUNCTION public.app_recruitment_list_v1(p_entity text, p_search text DEFAULT ''::text, p_filters jsonb DEFAULT '{}'::jsonb, p_sort text DEFAULT ''::text, p_direction text DEFAULT 'desc'::text, p_limit integer DEFAULT 50, p_cursor_value jsonb DEFAULT NULL::jsonb, p_cursor_id text DEFAULT NULL::text, p_before boolean DEFAULT false, p_count_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_scope text := coalesce(nullif(p_filters->>'scope',''), 'all');
  v_site text := coalesce(p_filters->>'site','');
  v_owner text := coalesce(p_filters->>'owner','');
  v_search text := lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
  v_sort text := coalesce(nullif(p_sort,''), 'updated_at');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_cursor_value text;
  v_result jsonb;
  v_filter_key text;
  v_filter_date date;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then
    raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED';
  end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (7,10,25,50,100)) then
    raise exception 'RECRUITMENT_LIST_LIMIT_INVALID';
  end if;
  if p_entity='pipeline_history' then
    return public.app_recruitment_history_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='requisitions' then
    return public.app_recruitment_requisitions_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='position_groups' then
    return public.app_recruitment_groups_page_v1(p_search,p_filters,coalesce(nullif(p_sort,''),'attention'),p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='sourcing_records' then
    return public.app_recruitment_sourcing_records_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='sourcing' then
    return public.app_recruitment_sourcing_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='offers' then
    return public.app_recruitment_offers_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='audit_log' then
    return public.app_recruitment_audit_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='pipeline_stage' then
    return public.app_recruitment_applications_page_v1(p_search,coalesce(p_filters,'{}'::jsonb)||jsonb_build_object('activeBoard',true),coalesce(nullif(p_sort,''),'board_last_update'),case when nullif(p_sort,'') is null then 'asc' else p_direction end,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity='candidate_applications' then
    return public.app_recruitment_applications_page_v1(p_search,p_filters,p_sort,p_direction,p_limit,p_cursor_value,p_cursor_id,p_before,p_count_only);
  end if;
  if p_entity <> 'candidate_registry' then
    raise exception 'RECRUITMENT_LIST_ENTITY_UNSUPPORTED';
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
  if exists (select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) key_name where key_name not in ('scope','site','owner','candidateId','candidateText','contactText','candidateSite','creatorText','sourceText','interestsText','activeMin','activeMax','updatedFrom','updatedTo','candidateIds')) then
    raise exception 'RECRUITMENT_LIST_FILTER_INVALID';
  end if;

  -- Authorized candidate column filters and bounded selected-ID export.
  foreach v_filter_key in array array['candidateText','contactText','candidateSite','creatorText','sourceText','interestsText','updatedFrom','updatedTo'] loop
    if p_filters ? v_filter_key and jsonb_typeof(p_filters->v_filter_key) <> 'string' then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  end loop;
  foreach v_filter_key in array array['activeMin','activeMax'] loop
    if p_filters ? v_filter_key and jsonb_typeof(p_filters->v_filter_key) not in ('string','number') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
    if coalesce(p_filters->>v_filter_key,'')<>'' then
      if (p_filters->>v_filter_key)!~'^[0-9]+$' or length(p_filters->>v_filter_key)>10 then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
      if (p_filters->>v_filter_key)::numeric>2147483647 then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
    end if;
  end loop;
  if coalesce(p_filters->>'activeMin','')<>'' and coalesce(p_filters->>'activeMax','')<>'' and (p_filters->>'activeMin')::integer>(p_filters->>'activeMax')::integer then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  foreach v_filter_key in array array['updatedFrom','updatedTo'] loop
    if coalesce(p_filters->>v_filter_key,'')<>'' then
      begin
        if (p_filters->>v_filter_key)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
        v_filter_date:=(p_filters->>v_filter_key)::date;
      exception when others then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end;
    end if;
  end loop;
  if coalesce(p_filters->>'updatedFrom','')<>'' and coalesce(p_filters->>'updatedTo','')<>'' and (p_filters->>'updatedFrom')::date>(p_filters->>'updatedTo')::date then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_filters ? 'candidateIds' then
    if jsonb_typeof(p_filters->'candidateIds')<>'array' then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
    if jsonb_array_length(p_filters->'candidateIds')>100 or exists(select 1 from jsonb_array_elements(p_filters->'candidateIds') id where jsonb_typeof(id)<>'string' or btrim(id#>>'{}')='') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
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
        when 'candidate_id' then case when b.candidate_id ~* '^CAN-[0-9]+$' then
          lower(split_part(b.candidate_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(b.candidate_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||
          coalesce(nullif(ltrim(split_part(b.candidate_id,'-',2),'0'),''),'0')||'-'||lower(b.candidate_id) else lower(b.candidate_id) end
        when 'name' then lower(coalesce(b.name,b.nickname,''))
        when 'active_application_count' then lpad(coalesce(b.active_application_count,0)::text,12,'0')
        else to_char(coalesce(b.updated_at,b.created_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      end as sort_value
    from candidate_base b
    where (b.readable or (b.masked and v_scope in ('all','pool')))
      and (v_site = '' or b.masked or b.home_site = v_site)
      and (v_owner = '' or b.creator_label = v_owner)
      and (coalesce(p_filters->>'candidateId','')='' or b.candidate_id=p_filters->>'candidateId')
      and (not (p_filters ? 'candidateIds') or b.candidate_id in (select jsonb_array_elements_text(p_filters->'candidateIds')))
      and (coalesce(p_filters->>'candidateText','')='' or (strpos(lower(concat_ws(' ',b.candidate_id,case when b.candidate_id ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(b.candidate_id,'-',1))||'-'||lpad(split_part(b.candidate_id,'-',2),greatest(5,length(split_part(b.candidate_id,'-',2))),'0') else b.candidate_id end,case when not b.masked then b.name end,case when not b.masked then b.nickname end)),lower(btrim(p_filters->>'candidateText')))>0))
      and (coalesce(p_filters->>'contactText','')='' or (not b.masked and strpos(lower(concat_ws(' ',b.phone_no,b.email)),lower(btrim(p_filters->>'contactText')))>0))
      and (coalesce(p_filters->>'candidateSite','')='' or (not b.masked and strpos(lower(coalesce(b.home_site,'')),lower(btrim(p_filters->>'candidateSite')))>0))
      and (coalesce(p_filters->>'creatorText','')='' or (strpos(lower(coalesce(b.creator_label,'')),lower(btrim(p_filters->>'creatorText')))>0))
      and (coalesce(p_filters->>'sourceText','')='' or (not b.masked and strpos(lower(coalesce(b.channel,'')),lower(btrim(p_filters->>'sourceText')))>0))
      and (coalesce(p_filters->>'interestsText','')='' or (strpos(lower(coalesce(b.position_interests,'')),lower(btrim(p_filters->>'interestsText')))>0))
      and (coalesce(p_filters->>'activeMin','')='' or (not b.masked and b.active_application_count >= (p_filters->>'activeMin')::integer))
      and (coalesce(p_filters->>'activeMax','')='' or (not b.masked and b.active_application_count <= (p_filters->>'activeMax')::integer))
      and (coalesce(p_filters->>'updatedFrom','')='' or (coalesce(b.updated_at,b.created_at) at time zone 'UTC')::date >= (p_filters->>'updatedFrom')::date)
      and (coalesce(p_filters->>'updatedTo','')='' or (coalesce(b.updated_at,b.created_at) at time zone 'UTC')::date <= (p_filters->>'updatedTo')::date)
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
    select count(*)::integer as total_count from candidate_projection where p_limit=0
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
    'items', coalesce((select jsonb_agg((item || jsonb_build_object('has_priority_requisition',case when coalesce((item->>'masked')::boolean,false) then false else exists(select 1 from public.candidate_applications priority_app join public.document_groups priority_link on priority_link.group_id=priority_app.group_id join public.requisitions priority_req on priority_req.doc_id=priority_link.doc_id where priority_app.candidate_id=page_rows.candidate_id and priority_app.state='active' and priority_req.is_priority is true and app_private.can_read_application(priority_app.application_id) and app_private.can_read_requisition(priority_req.doc_id)) end)) order by case when v_direction='asc' then sort_value end asc, case when v_direction='desc' then sort_value end desc, candidate_id asc) from page_rows),'[]'::jsonb),
    'total_count', case when p_limit=0 then (select total_count from matched_count) else null end,
    'has_more', availability.has_more,
    'has_more_before', availability.has_more_before,
    'next_cursor', case when availability.has_more then jsonb_build_object('value',to_jsonb(page_edges.last_sort),'id',page_edges.last_id) else null end,
    'previous_cursor', case when availability.has_more_before then jsonb_build_object('value',to_jsonb(page_edges.first_sort),'id',page_edges.first_id) else null end
  ) into v_result
  from page_edges cross join availability;

  return v_result;
end;
$function$
