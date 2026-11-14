-- Bounded exact-contact reads; SECURITY INVOKER preserves the existing row policies.
create or replace function public.app_normalize_lookup_phone(p_value text)
returns text language sql immutable strict set search_path='' as $$
  select case when p_value ~ '^[+0-9 () .-]+$' then
    case when digits ~ '^0[0-9]{9}$' then digits
         when digits ~ '^66[0-9]{9}$' then '0'||substr(digits,3) end end
  from (select regexp_replace(p_value,'[^0-9]','','g') digits) x
$$;

create index if not exists candidates_lookup_phone_idx on public.candidates(public.app_normalize_lookup_phone(phone_no),candidate_id);
create index if not exists candidates_lookup_email_idx on public.candidates(lower(btrim(email)),candidate_id);

create or replace function public.app_candidate_lookup_applications_v1(p_candidate_id text,p_after_id uuid default null,p_limit integer default 5)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_limit<1 or p_limit>10 then raise exception 'LOOKUP_LIMIT_INVALID'; end if;
  if not app_private.can_read_candidate(p_candidate_id) then return jsonb_build_object('items','[]'::jsonb,'next_cursor',null); end if;
  with matches as materialized (
    select a.application_id,a.group_id,a.state,g.group_position,
      coalesce(l.recruitment_process,'Not started') stage,l.result
    from public.candidate_applications a join public.position_groups g using(group_id)
    left join lateral (
      select r.recruitment_process,r.result from public.recruitment_logs r
      where r.application_id=a.application_id and r.superseded_at is null and r.superseded_by_stage_instance_id is null
      order by case r.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,r.round desc,r.log_id desc limit 1
    ) l on true
    where a.candidate_id=p_candidate_id and app_private.can_read_application(a.application_id)
      and (p_after_id is null or a.application_id>p_after_id)
    order by a.application_id limit p_limit+1
  ), page as (select * from matches order by application_id limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by application_id) from page p),'[]'::jsonb),
    'next_cursor',case when (select count(*) from matches)>p_limit then (select application_id from page order by application_id desc limit 1) end) into v_result;
  return v_result;
end $$;

create or replace function public.app_candidate_contact_lookup_v1(p_contact text,p_after_id text default null,p_limit integer default 10)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_value text; v_email boolean:=strpos(coalesce(p_contact,''),'@')>0; v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_limit<1 or p_limit>10 or length(coalesce(p_contact,''))>320 then raise exception 'LOOKUP_INPUT_INVALID'; end if;
  if v_email then
    v_value:=lower(btrim(p_contact));
    if v_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'LOOKUP_INPUT_INVALID'; end if;
  else
    v_value:=public.app_normalize_lookup_phone(p_contact);
    if v_value is null then raise exception 'LOOKUP_INPUT_INVALID'; end if;
  end if;
  with matches as materialized (
    select c.candidate_id,c.name,c.nickname,c.phone_no,c.email from public.candidates c
    where app_private.can_read_candidate(c.candidate_id)
      and case when v_email then lower(btrim(c.email))=v_value else public.app_normalize_lookup_phone(c.phone_no)=v_value end
      and (p_after_id is null or c.candidate_id>p_after_id)
    order by c.candidate_id limit p_limit+1
  ), page as (select * from matches order by candidate_id limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('applications',public.app_candidate_lookup_applications_v1(p.candidate_id)) order by candidate_id) from page p),'[]'::jsonb),
    'next_cursor',case when (select count(*) from matches)>p_limit then (select candidate_id from page order by candidate_id desc limit 1) end) into v_result;
  return v_result;
end $$;
revoke all on function public.app_normalize_lookup_phone(text),public.app_candidate_contact_lookup_v1(text,text,integer),public.app_candidate_lookup_applications_v1(text,uuid,integer) from public,anon,authenticated;
grant execute on function public.app_normalize_lookup_phone(text),public.app_candidate_contact_lookup_v1(text,text,integer),public.app_candidate_lookup_applications_v1(text,uuid,integer) to authenticated;
