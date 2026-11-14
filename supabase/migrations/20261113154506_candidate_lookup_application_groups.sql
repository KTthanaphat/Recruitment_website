create or replace function public.app_candidate_lookup_applications_v1(p_candidate_id text,p_after_id uuid default null,p_limit integer default 5)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_limit<1 or p_limit>10 then raise exception 'LOOKUP_LIMIT_INVALID'; end if;
  if not app_private.can_read_candidate(p_candidate_id) then return jsonb_build_object('items','[]'::jsonb,'next_cursor',null); end if;
  with matches as materialized (
    select a.application_id,a.group_id,a.state,coalesce(g.group_position,a.group_id) group_position,
      coalesce(l.recruitment_process,'Not started') stage,l.result
    from public.candidate_applications a left join public.position_groups g using(group_id)
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
