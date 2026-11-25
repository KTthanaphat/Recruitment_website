create or replace function public.app_normalize_lookup_phone_prefix(p_value text)
returns text language sql immutable strict set search_path='' as $$
  select case when btrim(p_value) ~ '^\+[0-9 () .-]+$' then
           case when digits ~ '^66[0-9]{4,9}$' then '0'||substr(digits,3) end
         when btrim(p_value) ~ '^[0-9 () .-]+$' then
           case when digits ~ '^66[0-9]{9}$' then '0'||substr(digits,3)
                when digits ~ '^[0-9]{4,10}$' then digits end
         end
  from (select regexp_replace(p_value,'[^0-9]','','g') digits) x
$$;

create or replace function public.app_candidate_contact_lookup_v2(p_contact text,p_after_id text default null,p_limit integer default 10,p_active_only boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_value text; v_email boolean:=strpos(coalesce(p_contact,''),'@')>0; v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_limit<1 or p_limit>10 or p_active_only is null or length(coalesce(p_contact,''))>320 then raise exception 'LOOKUP_INPUT_INVALID'; end if;
  if v_email then
    v_value:=lower(btrim(p_contact));
    if v_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'LOOKUP_INPUT_INVALID'; end if;
  else
    v_value:=public.app_normalize_lookup_phone_prefix(p_contact);
    if v_value is null then raise exception 'LOOKUP_INPUT_INVALID'; end if;
  end if;
  -- Match normalized phone substrings and keep the authorized page bounded before enrichment.
  with contact_matches as not materialized (
    select c.candidate_id,c.name,c.nickname,c.phone_no,c.email from public.candidates c
    where v_email and lower(btrim(c.email))=v_value and (p_after_id is null or c.candidate_id>p_after_id)
    union all
    select c.candidate_id,c.name,c.nickname,c.phone_no,c.email from public.candidates c
    where not v_email and public.app_normalize_lookup_phone(c.phone_no) like '%'||v_value||'%'
      and (p_after_id is null or c.candidate_id>p_after_id)
  ), matches as materialized (
    select c.* from contact_matches c where app_private.can_read_candidate(c.candidate_id)
      and (not p_active_only or exists(
        select 1 from public.candidate_applications a
        where a.candidate_id=c.candidate_id and a.state='active' and app_private.can_read_application(a.application_id)
      ))
    order by c.candidate_id limit p_limit+1
  ), page as (select * from matches order by candidate_id limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('applications',public.app_candidate_lookup_applications_v2(p.candidate_id,null,5,p_active_only)) order by candidate_id) from page p),'[]'::jsonb),
    'next_cursor',case when (select count(*) from matches)>p_limit then (select candidate_id from page order by candidate_id desc limit 1) end) into v_result;
  return v_result;
end $$;
revoke all on function public.app_normalize_lookup_phone_prefix(text),public.app_candidate_contact_lookup_v2(text,text,integer,boolean),public.app_candidate_lookup_applications_v2(text,uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.app_normalize_lookup_phone_prefix(text),public.app_candidate_contact_lookup_v2(text,text,integer,boolean),public.app_candidate_lookup_applications_v2(text,uuid,integer,boolean) to authenticated;
