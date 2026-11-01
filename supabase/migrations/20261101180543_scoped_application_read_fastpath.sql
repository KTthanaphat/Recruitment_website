create or replace function app_private.can_read_requisition(p_doc_id text) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_req_site text; v_pic text; v_profile_site text; v_nickname text; v_full_name text;
begin
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role in ('system_admin','admin_recruiter','viewer') then return true; end if;
 if v_role<>'site_recruiter' then return false; end if;
 select r.site,r.person_in_charge into v_req_site,v_pic from public.requisitions r where r.doc_id=p_doc_id;
 if not found then return false; end if;
 v_profile_site:=app_private.current_profile_site();
 if v_req_site=v_profile_site then return true; end if;
 select p.nickname,p.full_name into v_nickname,v_full_name from public.profiles p where p.id=auth.uid();
 if lower(btrim(v_pic)) in (lower(btrim(v_nickname)),lower(btrim(v_full_name))) then return true; end if;
 return exists(select 1 from public.document_groups d where d.doc_id=p_doc_id and app_private.is_group_pic(d.group_id));
end
$$;

create or replace function app_private.can_read_application(p_id uuid) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_group text;
begin
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role not in ('system_admin','admin_recruiter','site_recruiter','viewer') then return false; end if;
 select a.group_id into v_group from public.candidate_applications a where a.application_id=p_id;
 if not found then return false; end if;
 if v_role in ('system_admin','admin_recruiter','viewer') then return true; end if;
 return app_private.can_read_position_group(v_group);
end
$$;

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

create or replace function app_private.can_read_position_group(p_group_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_role text; v_site text; v_nickname text; v_full_name text; v_doc_id text; v_req_site text; v_pic text;
begin
  if auth.uid() is null then return false; end if;
  v_role:=app_private.current_app_role();
  if v_role in ('system_admin','admin_recruiter') then return true; end if;
  if v_role='viewer' then
    return exists(select 1 from public.document_groups dg join public.requisitions r using(doc_id) where dg.group_id=p_group_id);
  end if;
  if v_role<>'site_recruiter' then return false; end if;
  v_site:=app_private.current_profile_site();
  select p.nickname,p.full_name into v_nickname,v_full_name from public.profiles p where p.id=auth.uid();
  for v_doc_id in select dg.doc_id from public.document_groups dg where dg.group_id=p_group_id loop
    select r.site,r.person_in_charge into v_req_site,v_pic from public.requisitions r where r.doc_id=v_doc_id;
    if not found then continue; end if;
    if v_req_site=v_site then return true; end if;
    if lower(btrim(v_pic)) in (lower(btrim(v_nickname)),lower(btrim(v_full_name))) then return true; end if;
    if exists(
      select 1 from public.document_groups shared
      where shared.doc_id=v_doc_id and exists(
        select 1 from public.document_groups claimed join public.requisitions owner_req on owner_req.doc_id=claimed.doc_id
        where claimed.group_id=shared.group_id
          and nullif(btrim(owner_req.person_in_charge),'') is not null
          and lower(btrim(owner_req.person_in_charge)) in (lower(btrim(v_nickname)),lower(btrim(v_full_name)))
      )
    ) then return true; end if;
  end loop;
  return false;
end
$$;
