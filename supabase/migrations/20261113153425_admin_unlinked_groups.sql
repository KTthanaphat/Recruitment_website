create or replace function public.app_unlinked_groups_page_v1(p_after_id text default null,p_limit integer default 10)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
 if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED';end if;
 if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'GROUP_PAGE_LIMIT_INVALID';end if;
 with matches as materialized (
  select g.group_id,g.group_position,g.is_secret,g.updated_at from public.position_groups g
  where not exists(select 1 from public.document_groups d where d.group_id=g.group_id) and (p_after_id is null or g.group_id>p_after_id)
  order by g.group_id limit p_limit+1
 ),page as (select * from matches order by group_id limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by group_id) from page p),'[]'::jsonb),'next_cursor',case when (select count(*) from matches)>p_limit then (select group_id from page order by group_id desc limit 1) end) into v_result;
 return v_result;
end $$;
revoke all on function public.app_unlinked_groups_page_v1(text,integer) from public,anon,authenticated;
grant execute on function public.app_unlinked_groups_page_v1(text,integer) to authenticated;
