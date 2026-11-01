begin;

create or replace function app_private.dashboard_filter_options_v1(p_scope jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'AUTHENTICATED_PROFILE_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites'))
    or jsonb_typeof(coalesce(p_scope->'sites','[]'::jsonb))<>'array'
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string')
    or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean')
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_scope->'sites')='array' then p_scope->'sites' else '[]'::jsonb end) v where jsonb_typeof(v)<>'string') then raise exception 'REPORT_SCOPE_INVALID'; end if;
  with feed as (select public.app_dashboard_company_report() as payload),
  report_requisitions as (
    select r.* from feed f cross join lateral jsonb_to_recordset(f.payload->'requisitions') as r(
      doc_id text,is_priority boolean,site text,department text,person_in_charge text)
  )
  select jsonb_build_object(
    'sites',coalesce((
      select jsonb_agg(s.site order by case s.site when 'HQ' then 1 when 'KT1' then 2 when 'KT2' then 3 else 4 end,s.site)
      from (select distinct r.site from report_requisitions r where nullif(r.site,'') is not null
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)) s
    ),'[]'::jsonb),
    'owners',coalesce((
      select jsonb_agg(o.owner order by o.owner)
      from (select distinct btrim(r.person_in_charge) owner from report_requisitions r where nullif(btrim(r.person_in_charge),'') is not null
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
        and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      ) o
    ),'[]'::jsonb),
    'departments',coalesce((
      select jsonb_agg(d.department order by d.department)
      from (select distinct r.department from report_requisitions r where nullif(r.department,'') is not null
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
        and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      ) d
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
create or replace function public.app_dashboard_filter_options_v1(p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) then raise exception 'AUTHENTICATED_PROFILE_REQUIRED'; end if;
  return app_private.dashboard_filter_options_v1(coalesce(p_scope,'{}'::jsonb));
end $$;
revoke all on function app_private.dashboard_filter_options_v1(jsonb) from public,anon;
grant execute on function app_private.dashboard_filter_options_v1(jsonb) to authenticated;
revoke all on function public.app_dashboard_filter_options_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_dashboard_filter_options_v1(jsonb) to authenticated;

commit;
