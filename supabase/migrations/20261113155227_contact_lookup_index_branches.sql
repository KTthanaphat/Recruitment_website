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
  -- Separate equality branches keep both contact indexes usable under generic plans.
  with contact_matches as not materialized (
    select c.candidate_id,c.name,c.nickname,c.phone_no,c.email from public.candidates c
    where v_email and lower(btrim(c.email))=v_value and (p_after_id is null or c.candidate_id>p_after_id)
    union all
    select c.candidate_id,c.name,c.nickname,c.phone_no,c.email from public.candidates c
    where not v_email and public.app_normalize_lookup_phone(c.phone_no)=v_value and (p_after_id is null or c.candidate_id>p_after_id)
  ), matches as materialized (
    select c.* from contact_matches c where app_private.can_read_candidate(c.candidate_id)
    order by c.candidate_id limit p_limit+1
  ), page as (select * from matches order by candidate_id limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('applications',public.app_candidate_lookup_applications_v1(p.candidate_id)) order by candidate_id) from page p),'[]'::jsonb),
    'next_cursor',case when (select count(*) from matches)>p_limit then (select candidate_id from page order by candidate_id desc limit 1) end) into v_result;
  return v_result;
end $$;
