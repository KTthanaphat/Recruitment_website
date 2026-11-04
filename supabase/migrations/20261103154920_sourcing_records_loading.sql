begin;

create or replace function public.app_recruitment_sourcing_records_page_v1(
  p_search text,p_filters jsonb,p_sort text,p_direction text,p_limit integer,p_cursor_value jsonb,p_cursor_id text,p_before boolean,p_count_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_sort text:=coalesce(nullif(p_sort,''),'week'); v_dir text:=lower(coalesce(p_direction,'desc')); v_surface text:=coalesce(p_filters->>'surface','history'); v_week_start date:=nullif(p_filters->>'weekStart','')::date; v_cursor text:=p_cursor_value #>> '{}'; v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_surface not in ('board','history') or v_sort not in ('group','position','week','status','applicants','saved') or v_dir not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('surface','weekStart','from','to','group','position','week','status','applicants','saved','groupId','headerSite','headerPic','priorityOnly')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if (p_cursor_value is null)<>(p_cursor_id is null) or (p_cursor_value is not null and jsonb_typeof(p_cursor_value)<>'string') or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with authorized_links as materialized (
    select d.group_id,r.* from public.document_groups d join public.requisitions r using(doc_id)
    join public.position_groups g on g.group_id=d.group_id
    where app_private.can_read_requisition(r.doc_id) and app_private.can_read_sourcing_group(d.group_id)
      and app_private.can_read_position_group(d.group_id)
      and (coalesce(p_filters->>'groupId','')='' or d.group_id=p_filters->>'groupId')
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
      and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
  ), accepted as materialized (
    select o.doc_id,count(*)::integer accepted from public.offers o
    where o.doc_id in (select doc_id from authorized_links) and o.accepted_date is not null
      and o.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(o.application_id) group by o.doc_id
  ), terminal_dates as materialized (
    select l.doc_id,max(l.log_date) terminal_day from public.requisition_logs l
    where l.doc_id in (select doc_id from authorized_links where status in ('filled','cancel')) and l.status in ('filled','cancel') group by l.doc_id
  ), group_bounds as materialized (
    select r.group_id,min(r.pr_approved_date) first_approved,bool_and(r.status in ('filled','cancel')) all_terminal,
      max(case when r.status in ('filled','cancel') then coalesce(t.terminal_day,r.updated_at::date) end) terminal_day,
      array_agg(distinct r.site order by r.site) filter(where r.site is not null) sites,
      array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners,
      array_agg(distinct r.doc_id order by r.doc_id) doc_ids,
      coalesce(sum(greatest(r.head_count-coalesce(a.accepted,0),0)) filter(where r.status='ongoing'),0)::integer open_headcount
    from authorized_links r left join accepted a using(doc_id) left join terminal_dates t using(doc_id) group by r.group_id
  ), bounds as materialized (
    select b.*,coalesce(first_approved,timezone('Asia/Bangkok',now())::date)-((extract(dow from coalesce(first_approved,timezone('Asia/Bangkok',now())::date))::integer+1)%7) start_week,
      case when all_terminal then coalesce(terminal_day,timezone('Asia/Bangkok',now())::date)-((extract(dow from coalesce(terminal_day,timezone('Asia/Bangkok',now())::date))::integer+1)%7)
        else timezone('Asia/Bangkok',now())::date-((extract(dow from timezone('Asia/Bangkok',now()))::integer+1)%7) end end_week from group_bounds b
  ), weeks as (
    select b.group_id,v_week_start week_start from bounds b where v_surface='board' and extract(dow from v_week_start)=6 and v_week_start between b.start_week and b.end_week and b.open_headcount>0
      and (coalesce(p_filters->>'from','')='' or v_week_start>=(p_filters->>'from')::date)
      and (coalesce(p_filters->>'to','')='' or v_week_start<=(p_filters->>'to')::date)
    union all
    select b.group_id,gs.week_start::date from bounds b cross join lateral generate_series(
      b.start_week+greatest(0,ceil((coalesce(nullif(p_filters->>'from','')::date,b.start_week)-b.start_week)::numeric/7)::integer)*7,
      least(b.end_week,coalesce(nullif(p_filters->>'to','')::date,b.end_week)),interval '7 days') gs(week_start) where v_surface='history'
  ), raw_rows as not materialized (
    select w.group_id,w.week_start,u.update,u.week_start update_week,
      coalesce((u.update->>'channel_fb')::boolean,g.channel_fb,false) fb,
      coalesce((u.update->>'channel_jobthai')::boolean,g.channel_jobthai,false) jobthai,
      coalesce((u.update->>'channel_jobtopgun')::boolean,g.channel_jobtopgun,false) jobtopgun,
      coalesce((u.update->>'channel_jobdb')::boolean,g.channel_jobdb,false) jobdb,
      coalesce((u.update->>'channel_jobbkk')::boolean,g.channel_jobbkk,false) jobbkk,
      coalesce((u.update->>'channel_linkedin')::boolean,g.channel_linkedin,false) linkedin,
      coalesce((u.update->>'channel_walkin')::boolean,g.channel_walkin,false) walkin,
      coalesce((u.update->>'channel_referral')::boolean,g.channel_referral,false) referral,
      coalesce((u.update->>'channel_others')::boolean,g.channel_others,false) others,
      g.group_position,b.open_headcount,coalesce(b.sites,'{}'::text[]) sites,coalesce(b.owners,'{}'::text[]) owners,b.doc_ids,
g.channel_fb,g.channel_jobthai,g.channel_jobtopgun,g.channel_jobdb,g.channel_jobbkk,g.channel_linkedin,g.channel_walkin,g.channel_referral,g.channel_others,coalesce(u.update->>'updated_at','') saved_at
    from weeks w join bounds b using(group_id) join public.position_groups g using(group_id)
    left join lateral (select to_jsonb(x) update,x.week_start from public.sourcing_weekly_updates x
      where x.group_id=w.group_id and x.week_start in (w.week_start,w.week_start+2) and app_private.can_read_sourcing_group(x.group_id)
      order by case when x.week_start=w.week_start then 0 else 1 end,x.updated_at desc limit 1) u on true
  ), calc_rows as not materialized (
    select r.*,
      case when r.update is null then null when (r.fb or r.jobthai or r.jobtopgun or r.jobdb or r.jobbkk or r.linkedin or r.walkin or r.referral or r.others) and
        ((r.fb and r.update->'applicants_fb'='null'::jsonb) or (r.jobthai and r.update->'applicants_jobthai'='null'::jsonb) or (r.jobtopgun and r.update->'applicants_jobtopgun'='null'::jsonb) or (r.jobdb and r.update->'applicants_jobdb'='null'::jsonb) or (r.jobbkk and r.update->'applicants_jobbkk'='null'::jsonb) or (r.linkedin and r.update->'applicants_linkedin'='null'::jsonb) or (r.walkin and r.update->'applicants_walkin'='null'::jsonb) or (r.referral and r.update->'applicants_referral'='null'::jsonb) or (r.others and r.update->'applicants_others'='null'::jsonb)) then null
        else (case when r.fb then coalesce((r.update->>'applicants_fb')::integer,0) else 0 end)+(case when r.jobthai then coalesce((r.update->>'applicants_jobthai')::integer,0) else 0 end)+(case when r.jobtopgun then coalesce((r.update->>'applicants_jobtopgun')::integer,0) else 0 end)+(case when r.jobdb then coalesce((r.update->>'applicants_jobdb')::integer,0) else 0 end)+(case when r.jobbkk then coalesce((r.update->>'applicants_jobbkk')::integer,0) else 0 end)+(case when r.linkedin then coalesce((r.update->>'applicants_linkedin')::integer,0) else 0 end)+(case when r.walkin then coalesce((r.update->>'applicants_walkin')::integer,0) else 0 end)+(case when r.referral then coalesce((r.update->>'applicants_referral')::integer,0) else 0 end)+(case when r.others then coalesce((r.update->>'applicants_others')::integer,0) else 0 end) end::integer applicants,
      case when r.update is not null and (r.fb or r.jobthai or r.jobtopgun or r.jobdb or r.jobbkk or r.linkedin or r.walkin or r.referral or r.others) and not ((r.fb and r.update->'applicants_fb'='null'::jsonb) or (r.jobthai and r.update->'applicants_jobthai'='null'::jsonb) or (r.jobtopgun and r.update->'applicants_jobtopgun'='null'::jsonb) or (r.jobdb and r.update->'applicants_jobdb'='null'::jsonb) or (r.jobbkk and r.update->'applicants_jobbkk'='null'::jsonb) or (r.linkedin and r.update->'applicants_linkedin'='null'::jsonb) or (r.walkin and r.update->'applicants_walkin'='null'::jsonb) or (r.referral and r.update->'applicants_referral'='null'::jsonb) or (r.others and r.update->'applicants_others'='null'::jsonb)) then 'saved' else 'needs_recording' end status
    from raw_rows r
  ), source_rows as not materialized (
    select c.*,case v_sort when 'group' then case when c.group_id ~* '^GRP-[0-9]+$' then
      lower(split_part(c.group_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(c.group_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||
      coalesce(nullif(ltrim(split_part(c.group_id,'-',2),'0'),''),'0')||'-'||lower(c.group_id) else lower(c.group_id) end
      when 'position' then lower(c.group_position) when 'status' then case when c.status='saved' then '0-saved' else '1-needs_recording' end when 'applicants' then lpad((coalesce(c.applicants,-1)+1)::text,12,'0') else case when v_sort='saved' then c.saved_at else c.week_start::text end end sort_value
    from calc_rows c
  )
  , filtered as (
    select * from source_rows s where (v_surface<>'board' or s.open_headcount>0)
      and (coalesce(p_filters->>'groupId','')='' or s.group_id=p_filters->>'groupId')
      and (coalesce(p_filters->>'group','')='' or s.group_id ilike '%'||(case when btrim(p_filters->>'group') ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(btrim(p_filters->>'group'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'group'),'-',2))),'0') else p_filters->>'group' end)||'%' or
        (s.group_id ~* '^GRP-[0-9]+$' and ('GRP-'||lpad(split_part(s.group_id,'-',2),greatest(5,length(split_part(s.group_id,'-',2))),'0')) ilike '%'||(case when btrim(p_filters->>'group') ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(btrim(p_filters->>'group'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'group'),'-',2))),'0') else p_filters->>'group' end)||'%'))
      and (coalesce(p_filters->>'position','')='' or s.group_position ilike '%'||(p_filters->>'position')||'%')
      and (coalesce(p_filters->>'week','')='' or s.week_start::text ilike '%'||(p_filters->>'week')||'%')
      and (coalesce(p_filters->>'status','') in ('','all') or s.status=p_filters->>'status')
      and (coalesce(p_filters->>'applicants','') in ('','all') or (p_filters->>'applicants'='has' and s.applicants>0) or (p_filters->>'applicants'='zero' and s.applicants=0) or (p_filters->>'applicants'='unknown' and s.applicants is null))
      and (coalesce(p_filters->>'saved','')='' or s.saved_at ilike '%'||(p_filters->>'saved')||'%')
      and (v_search='' or concat_ws(' ',s.group_id,
        case when s.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(s.group_id,'-',2),greatest(5,length(split_part(s.group_id,'-',2))),'0') else s.group_id end,
        s.group_position,s.week_start,s.status,s.applicants,s.saved_at,s.sites,s.owners) ilike '%'||v_search||'%')
      and (p_cursor_value is null or (not p_before and ((v_dir='asc' and (s.sort_value>v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)>p_cursor_id)) or (v_dir='desc' and (s.sort_value<v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)>p_cursor_id))) or (p_before and ((v_dir='asc' and (s.sort_value<v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)<p_cursor_id)) or (v_dir='desc' and (s.sort_value>v_cursor or s.sort_value=v_cursor and (s.group_id||'|'||s.week_start::text)<p_cursor_id))))))
  ), page_raw as (select * from filtered where not p_count_only order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then (group_id||'|'||week_start::text) end desc,case when not p_before then (group_id||'|'||week_start::text) end asc limit p_limit+1), page_rows as (select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then (group_id||'|'||week_start::text) end desc,case when not p_before then (group_id||'|'||week_start::text) end asc limit p_limit), edges as (select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,(group_id||'|'||week_start::text) asc))[1] first_sort,(array_agg((group_id||'|'||week_start::text) order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,(group_id||'|'||week_start::text) asc))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,(group_id||'|'||week_start::text) desc))[1] last_sort,(array_agg((group_id||'|'||week_start::text) order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,(group_id||'|'||week_start::text) desc))[1] last_id from page_rows), info as (select count(*)>p_limit extra from page_raw)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('group',jsonb_build_object('group_id',p.group_id,'group_position',p.group_position,'sites',p.sites,'owners',p.owners,'doc_ids',p.doc_ids,'open_headcount',p.open_headcount,'channel_fb',p.channel_fb,'channel_jobthai',p.channel_jobthai,'channel_jobtopgun',p.channel_jobtopgun,'channel_jobdb',p.channel_jobdb,'channel_jobbkk',p.channel_jobbkk,'channel_linkedin',p.channel_linkedin,'channel_walkin',p.channel_walkin,'channel_referral',p.channel_referral,'channel_others',p.channel_others,'latest_update',p.update),'week_start',p.week_start,'update',p.update,'status',p.status) order by case when v_dir='asc' then p.sort_value end asc,case when v_dir='desc' then p.sort_value end desc,p.group_id,p.week_start) from page_rows p),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from filtered) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_sort,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_sort,'id',edges.first_id) else null end) into v_result from edges cross join info;
  return v_result;
end; $$;

revoke all on function public.app_recruitment_sourcing_records_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.app_recruitment_sourcing_records_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) to authenticated;

create or replace function public.app_recruitment_list_v1(
  p_entity text,
  p_search text default '',
  p_filters jsonb default '{}'::jsonb,
  p_sort text default '',
  p_direction text default 'desc',
  p_limit integer default 50,
  p_cursor_value jsonb default null,
  p_cursor_id text default null,
  p_before boolean default false,
  p_count_only boolean default false
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
  v_search text := lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
  v_sort text := coalesce(nullif(p_sort,''), 'updated_at');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_cursor_value text;
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then
    raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED';
  end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (25,50,100)) then
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
  if exists (select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) key_name where key_name not in ('scope','site','owner','candidateId')) then
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
    'items', coalesce((select jsonb_agg(item order by case when v_direction='asc' then sort_value end asc, case when v_direction='desc' then sort_value end desc, candidate_id asc) from page_rows),'[]'::jsonb),
    'total_count', case when p_limit=0 then (select total_count from matched_count) else null end,
    'has_more', availability.has_more,
    'has_more_before', availability.has_more_before,
    'next_cursor', case when availability.has_more then jsonb_build_object('value',to_jsonb(page_edges.last_sort),'id',page_edges.last_id) else null end,
    'previous_cursor', case when availability.has_more_before then jsonb_build_object('value',to_jsonb(page_edges.first_sort),'id',page_edges.first_id) else null end
  ) into v_result
  from page_edges cross join availability;

  return v_result;
end;
$$;

commit;
