-- Keep the existing site-home-site authorization result, but check application existence once instead of looping every linked group first.
create or replace function app_private.can_read_candidate(p_candidate_id text) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_created_by uuid; v_home_site text; v_group text; v_profile_site text;
begin
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role not in ('system_admin','admin_recruiter','site_recruiter','viewer') then return false; end if;
 select c.created_by,c.home_site into v_created_by,v_home_site from public.candidates c where c.candidate_id=p_candidate_id;
 if not found then return false; end if;
 if v_role in ('system_admin','admin_recruiter') or v_created_by=auth.uid() then return true; end if;
 if v_role='viewer' then
   return exists(select 1 from public.candidate_applications a where a.candidate_id=p_candidate_id);
 end if;
 v_profile_site:=app_private.current_profile_site();
 if v_home_site is not null and v_home_site=v_profile_site then
   return exists(select 1 from public.candidate_applications a where a.candidate_id=p_candidate_id);
 end if;
 for v_group in select a.group_id from public.candidate_applications a where a.candidate_id=p_candidate_id loop
   if app_private.can_read_position_group(v_group) then return true; end if;
 end loop;
 return false;
end
$$;
