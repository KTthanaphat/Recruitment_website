alter table public.requisitions add column if not exists is_secret boolean not null default false;
alter table public.position_groups add column if not exists is_secret boolean not null default false;
alter table public.change_logs add column if not exists is_secret boolean not null default false;
-- Non-reporting access and reporting membership are deliberately separate.
create or replace function app_private.secret_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and role in ('system_admin','admin_recruiter'))
$$;
create or replace function app_private.secret_requisition_access(p_id text) returns boolean language sql stable security definer set search_path='' as $$
 select case when app_private.secret_admin() then true else exists(select 1 from public.requisitions where doc_id=p_id and not is_secret) end
$$;
create or replace function app_private.secret_group_access(p_id text) returns boolean language sql stable security definer set search_path='' as $$
 select case when app_private.secret_admin() then true else exists(select 1 from public.position_groups where group_id=p_id and not is_secret) end
$$;
create or replace function app_private.secret_application_access(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when app_private.secret_admin() then true else exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where application_id=p_id and not g.is_secret) end
$$;
create or replace function app_private.secret_candidate_access(p_id text) returns boolean language sql stable security definer set search_path='' as $$
 select case when app_private.secret_admin() then true else
   not exists(select 1 from public.candidate_applications where candidate_id=p_id)
   or exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where a.candidate_id=p_id and not g.is_secret) end
$$;
create or replace function app_private.report_application(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where a.application_id=p_id and not g.is_secret)
$$;
create or replace function app_private.secret_audit_access(p_entity text,p_id text,p_old jsonb,p_new jsonb) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v jsonb:=coalesce(p_new,p_old,'{}'); v_group text; v_doc text; v_app uuid;
begin
 if app_private.secret_admin() then return true; end if;
 if coalesce((p_old->>'is_secret')::boolean,false) or coalesce((p_new->>'is_secret')::boolean,false) then return false; end if;
 if p_entity='requisitions' then return app_private.secret_requisition_access(p_id); end if;
 if p_entity='position_groups' then return app_private.secret_group_access(p_id); end if;
 v_group:=coalesce(v->>'group_id',p_old->>'group_id'); v_doc:=coalesce(v->>'doc_id',p_old->>'doc_id');
 v_app:=coalesce(nullif(v->>'application_id',''),nullif(p_old->>'application_id',''))::uuid;
 if v_group is not null and not app_private.secret_group_access(v_group) then return false; end if;
 if v_doc is not null and not app_private.secret_requisition_access(v_doc) then return false; end if;
 if v_app is not null and not app_private.secret_application_access(v_app) then return false; end if;
 if p_entity='candidates' then return app_private.secret_candidate_access(p_id); end if;
 if v->>'candidate_id' is not null then return app_private.secret_candidate_access(v->>'candidate_id'); end if;
 return true;
end $$;

create or replace view app_private.report_requisitions with (security_invoker=true) as select * from public.requisitions where not is_secret;
create or replace view app_private.report_position_groups with (security_invoker=true) as select * from public.position_groups where not is_secret;
create or replace view app_private.report_document_groups with (security_invoker=true) as select d.* from public.document_groups d join public.requisitions r using(doc_id) left join public.position_groups g using(group_id) where not r.is_secret and g.is_secret is not true;
create or replace view app_private.report_requisition_logs with (security_invoker=true) as select l.* from public.requisition_logs l join public.requisitions r using(doc_id) where not r.is_secret;
create or replace view app_private.report_candidate_applications with (security_invoker=true) as select a.* from public.candidate_applications a join public.position_groups g using(group_id) where not g.is_secret;
create or replace view app_private.report_candidate_application_assignments with (security_invoker=true) as select x.* from public.candidate_application_assignments x join public.position_groups g using(group_id) where not g.is_secret and app_private.report_application(x.application_id);
create or replace view app_private.report_recruitment_logs with (security_invoker=true) as select l.* from public.recruitment_logs l where app_private.report_application(l.application_id);
create or replace view app_private.report_offers with (security_invoker=true) as select o.* from public.offers o join public.requisitions r using(doc_id) where not r.is_secret and app_private.report_application(o.application_id);
create or replace view app_private.report_sourcing_weekly_updates with (security_invoker=true) as select s.* from public.sourcing_weekly_updates s join public.position_groups g using(group_id) where not g.is_secret;
create or replace view app_private.report_candidate_requisitions with (security_invoker=true) as select c.* from public.candidate_requisitions c join public.requisitions r using(doc_id) where not r.is_secret and app_private.report_application(c.application_id);
create or replace view app_private.report_candidates with (security_invoker=true) as
 select (jsonb_populate_record(null::public.candidates,to_jsonb(c)||jsonb_build_object('group_id',(select a.group_id from public.candidate_applications a join public.position_groups g using(group_id) where a.candidate_id=c.candidate_id and not g.is_secret order by a.created_at,a.application_id limit 1),'doc_group_id',null))).*
 from public.candidates c where not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id) or exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where a.candidate_id=c.candidate_id and not g.is_secret);
create or replace view app_private.report_change_logs with (security_invoker=true) as select l.* from public.change_logs l where not l.is_secret;

revoke all on function app_private.secret_admin(),app_private.secret_requisition_access(text),app_private.secret_group_access(text),app_private.secret_application_access(uuid),app_private.secret_candidate_access(text),app_private.report_application(uuid),app_private.secret_audit_access(text,text,jsonb,jsonb) from public,anon;
grant execute on function app_private.secret_admin(),app_private.secret_requisition_access(text),app_private.secret_group_access(text),app_private.secret_application_access(uuid),app_private.secret_candidate_access(text),app_private.report_application(uuid),app_private.secret_audit_access(text,text,jsonb,jsonb) to authenticated,service_role;
grant select on app_private.report_requisitions,app_private.report_position_groups,app_private.report_document_groups,app_private.report_requisition_logs,app_private.report_candidate_applications,app_private.report_candidate_application_assignments,app_private.report_recruitment_logs,app_private.report_offers,app_private.report_sourcing_weekly_updates,app_private.report_candidate_requisitions,app_private.report_candidates,app_private.report_change_logs to authenticated,service_role;

create or replace function app_private.can_read_requisition(p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
 select (app_private.secret_requisition_access(p_doc_id)) and (app_private.is_global_recruitment_reader()
    or (
      app_private.current_app_role() = 'site_recruiter'
      and exists (
        select 1
        from public.requisitions r
        where r.doc_id = p_doc_id
          and (
            r.site = app_private.current_profile_site()
            or r.person_in_charge = app_private.current_profile_nickname()
          )
      )
    ))
$$;

create or replace function app_private.can_manage_requisition(p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
 select (app_private.secret_requisition_access(p_doc_id)) and (app_private.current_app_role() in ('system_admin', 'admin_recruiter')
    or (
      app_private.current_app_role() = 'site_recruiter'
      and exists (
        select 1
        from public.requisitions r
        where r.doc_id = p_doc_id
        and (
          r.site = app_private.current_profile_site()
          or r.person_in_charge = app_private.current_profile_nickname()
        )
      )
    ))
$$;

create or replace function app_private.can_manage_candidate(p_candidate_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
 select (app_private.secret_candidate_access(p_candidate_id)) and (app_private.current_app_role() in ('system_admin', 'admin_recruiter')
    or exists (
      select 1
      from public.candidates c
      join public.document_groups dg on dg.group_id = c.group_id
      where c.candidate_id = p_candidate_id
        and app_private.can_manage_requisition(dg.doc_id)
    ))
$$;

create or replace function app_private.can_read_candidate(p_candidate_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
 select (app_private.secret_candidate_access(p_candidate_id)) and (app_private.is_global_recruitment_reader()
    or exists (
      select 1
      from public.candidates c
      join public.document_groups dg on dg.group_id = c.group_id
      where c.candidate_id = p_candidate_id
        and app_private.can_read_requisition(dg.doc_id)
    ))
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
 if not (app_private.secret_group_access(p_group_id)) then return false; end if;
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

create or replace function app_private.can_manage_sourcing_group(p_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
 select (app_private.secret_group_access(p_group_id)) and (app_private.current_app_role() in ('system_admin', 'admin_recruiter')
    or (
      app_private.current_app_role() = 'site_recruiter'
      and exists (
        select 1
        from public.document_groups dg
        join public.requisitions r on r.doc_id = dg.doc_id
        left join lateral (
          select count(*)::integer as accepted_count
          from public.offers o
          where o.doc_id = r.doc_id
            and o.accepted_date is not null
            and o.start_confirmation is distinct from 'did_not_start'
        ) accepted on true
        where dg.group_id = p_group_id
          and r.status = 'ongoing'
          and (
            r.site = app_private.current_profile_site()
            or r.person_in_charge = app_private.current_profile_nickname()
          )
          and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
      )
    ))
$$;

create or replace function app_private.is_group_pic(p_group text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select (app_private.secret_group_access(p_group)) and (app_private.is_recruitment_writer() and exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) join public.profiles p on p.id=auth.uid() where d.group_id=p_group and nullif(btrim(r.person_in_charge),'') is not null and lower(btrim(r.person_in_charge)) in (lower(btrim(p.nickname)),lower(btrim(p.full_name)))))
$$;

create or replace function app_private.can_read_requisition(p_doc_id text) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_req_site text; v_pic text; v_profile_site text; v_nickname text; v_full_name text;
begin
 if not (app_private.secret_requisition_access(p_doc_id)) then return false; end if;
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
 if not (app_private.secret_application_access(p_id)) then return false; end if;
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role not in ('system_admin','admin_recruiter','site_recruiter','viewer') then return false; end if;
 select a.group_id into v_group from public.candidate_applications a where a.application_id=p_id;
 if not found then return false; end if;
 if v_role in ('system_admin','admin_recruiter','viewer') then return true; end if;
 return app_private.can_read_position_group(v_group);
end
$$;

create or replace function app_private.can_manage_application(p_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select (app_private.secret_application_access(p_id)) and (app_private.is_recruitment_writer() and exists(select 1 from public.candidate_applications a where a.application_id=p_id and (app_private.is_profile_admin() or app_private.is_group_pic(a.group_id))))
$$;

create or replace function app_private.can_read_candidate(p_candidate_id text) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_created_by uuid; v_home_site text; v_group text; v_profile_site text;
begin
 if not (app_private.secret_candidate_access(p_candidate_id)) then return false; end if;
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

create or replace function app_private.can_manage_candidate(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select (app_private.secret_candidate_access(p_candidate_id)) and (app_private.is_recruitment_writer() and exists(select 1 from public.candidates c where c.candidate_id=p_candidate_id and (app_private.is_profile_admin() or c.created_by=auth.uid() or exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id and app_private.is_group_pic(a.group_id)))))
$$;

create or replace function app_private.can_read_profile_note(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select (app_private.secret_candidate_access(p_candidate_id)) and (app_private.is_recruitment_reader() and exists(select 1 from public.candidates c where c.candidate_id=p_candidate_id and (app_private.is_profile_admin() or c.created_by=auth.uid() or exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id and app_private.is_group_pic(a.group_id)))))
$$;

create or replace function app_private.can_edit_profile_note(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select (app_private.secret_candidate_access(p_candidate_id)) and (app_private.is_recruitment_writer() and exists(select 1 from public.candidates c where c.candidate_id=p_candidate_id and (app_private.is_profile_admin() or c.created_by=auth.uid())))
$$;

create or replace function app_private.can_read_candidate_audit(p_entity text,p_id text,p_old jsonb,p_new jsonb) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v jsonb:=coalesce(p_new,p_old,'{}'::jsonb); v_candidate text; v_application uuid;
begin
 if not (app_private.secret_audit_access(p_entity,p_id,p_old,p_new)) then return false; end if;
 if not app_private.is_global_recruitment_reader() then return false; end if;
 if app_private.is_profile_admin() then return true; end if;
 if p_entity='candidates' then return app_private.can_read_candidate(p_id); end if;
 v_candidate:=coalesce(v->>'candidate_id',p_old->>'candidate_id');
 if p_entity='candidate_notes' then return app_private.can_read_profile_note(v_candidate); end if;
 if p_entity='candidate_references' then return app_private.can_read_candidate(v_candidate); end if;
 if p_entity in ('candidate_applications','candidate_application_assignments','recruitment_logs','offers','candidate_reference_checks','candidate_requisitions') then
   v_application:=coalesce(nullif(v->>'application_id',''),nullif(p_old->>'application_id',''))::uuid;
   if v_application is not null then return app_private.can_read_application(v_application); end if;
   return v_candidate is not null and app_private.can_read_candidate(v_candidate);
 end if;
 return true;
end $$;

create or replace function public.app_upsert_requisition(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_doc_id text := nullif(btrim(payload ->> 'doc_id'), '');
  v_previous_doc_id text := nullif(btrim(payload ->> 'previous_doc_id'), '');
  v_exists boolean;
  v_status text := coalesce(nullif(payload ->> 'status', ''), 'ongoing');
  v_role text := app_private.current_app_role();
  v_site text := nullif(payload ->> 'site', '');
  v_person_in_charge text := nullif(payload ->> 'person_in_charge', '');
  v_request_type text := coalesce(nullif(payload ->> 'request_type', ''), 'New');
  v_replacement_names text := nullif(payload ->> 'replacement_names', '');
  v_department text := nullif(payload ->> 'department', '');
  v_section text := nullif(payload ->> 'section', '');
  v_canonical_department text;
  v_canonical_section text;
begin
  perform app_private.assert_recruitment_writer();
  if v_doc_id is null then raise exception 'Doc ID is required.'; end if;
  if v_mode not in ('new', 'change') then raise exception 'mode must be new or change'; end if;
  if v_mode = 'change' then v_previous_doc_id := coalesce(v_previous_doc_id, v_doc_id); end if;
  if v_status not in ('ongoing', 'cancel') then raise exception 'Requisition status can only be ongoing or cancel. Filled is automatic.'; end if;
  if v_request_type not in ('New', 'Replacement') then raise exception 'Request type must be New or Replacement.'; end if;
  if v_request_type = 'Replacement' and v_replacement_names is null then raise exception 'Replacement names are required for replacement requisitions.'; end if;
  if v_request_type = 'New' then v_replacement_names := null; end if;

  if v_role = 'site_recruiter' and v_mode = 'new' then
    v_site := app_private.current_profile_site();
    v_person_in_charge := app_private.current_profile_nickname();
    if v_site is null or v_person_in_charge is null then
      raise exception 'Site recruiter accounts require assigned site and nickname.';
    end if;
  end if;

  select exists(select 1 from public.requisitions where doc_id = v_doc_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Requisition Doc ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' then
    if not exists(select 1 from public.requisitions where doc_id = v_previous_doc_id) then raise exception 'Requisition Doc ID does not exist. Switch to New mode to create it.'; end if;
    if not app_private.can_manage_requisition(v_previous_doc_id) then raise exception 'You can edit only requisitions where you are the person in charge or assigned to the site.'; end if;
    if v_doc_id <> v_previous_doc_id and v_exists then raise exception 'Requisition Doc ID already exists. Choose a unique ID.'; end if;
  end if;

  if v_role = 'site_recruiter' and v_mode = 'change' then
    select site, person_in_charge into v_site, v_person_in_charge
    from public.requisitions where doc_id = v_previous_doc_id;
  end if;

  -- The directory is optional in deployed databases. Resolve labels only when
  -- it exists, and preserve the submitted values when there is no match.
  if to_regclass('public.department_section_directory') is not null then
    execute 'select d.department_th, coalesce(d.section_th, $3)
      from public.department_section_directory d
      where d.site = $1
        and ($2 = d.department_th or $2 = d.department_en)
        and ($3 is null or $3 = d.section_th or $3 = d.section_en)
      limit 1'
      into v_canonical_department, v_canonical_section
      using v_site, v_department, v_section;
    if v_canonical_department is not null then
      v_department := v_canonical_department;
      v_section := v_canonical_section;
    end if;
  end if;

  perform set_config('app.action', 'requisition:' || v_mode, true);

  if v_mode = 'change' then
    update public.requisitions set
      is_secret=case when payload ? 'is_secret' then (payload->>'is_secret')::boolean else is_secret end,
      doc_id = v_doc_id,
      pr_approved_date = nullif(payload ->> 'pr_approved_date', '')::date,
      site = v_site,
      position = nullif(payload ->> 'position', ''),
      department = v_department,
      section = v_section,
      level = nullif(payload ->> 'level', ''),
      head_count = coalesce(nullif(payload ->> 'head_count', '')::integer, 1),
      person_in_charge = v_person_in_charge,
      line_manager = nullif(payload ->> 'line_manager', ''),
      request_type = v_request_type,
      replacement_names = v_replacement_names,
      status = v_status
    where doc_id = v_previous_doc_id;
  else
    insert into public.requisitions (
      is_secret, doc_id, pr_approved_date, site, position, department, section, level,
      head_count, person_in_charge, line_manager, request_type, replacement_names, status
    )
    values (
      coalesce((payload->>'is_secret')::boolean,false), v_doc_id,
      nullif(payload ->> 'pr_approved_date', '')::date,
      v_site,
      nullif(payload ->> 'position', ''),
      v_department,
      v_section,
      nullif(payload ->> 'level', ''),
      coalesce(nullif(payload ->> 'head_count', '')::integer, 1),
      v_person_in_charge,
      nullif(payload ->> 'line_manager', ''),
      v_request_type,
      v_replacement_names,
      v_status
    );
  end if;

  perform set_config('app.action', 'auto-status', true);
  perform app_private.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_doc_id);
end;
$$;

create or replace function public.app_create_group_match(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_doc_group_id text;
  v_group public.position_groups%rowtype;
begin
  if coalesce((payload->>'secret_link_confirmed')::boolean,false) and app_private.secret_admin() then perform set_config('app.secret_link_ack',payload->>'group_id',true); end if;
  perform app_private.assert_recruitment_writer();
  if v_doc_id is null or not exists(select 1 from public.requisitions where doc_id = v_doc_id) then
    raise exception 'Requisition does not exist.';
  end if;
  if not app_private.can_manage_requisition(v_doc_id) then
    raise exception 'You can match only requisitions where you are person in charge.';
  end if;
  select * into v_group from public.position_groups where group_id = v_group_id;
  if not found then raise exception 'Group ID does not exist.'; end if;
  if exists(select 1 from public.document_groups where doc_id = v_doc_id) then
    raise exception 'This requisition is already matched.';
  end if;
  perform app_private.assert_group_site_match(v_group_id, v_doc_id);

  v_doc_group_id := app_private.next_app_id('document_groups', 'DGRP');
  perform set_config('app.action', 'document_group:new', true);
  insert into public.document_groups (
    doc_group_id, doc_id, group_id, group_position,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_jobbkk,
    channel_linkedin, channel_walkin, channel_referral, channel_others
  )
  values (
    v_doc_group_id, v_doc_id, v_group_id, v_group.group_position,
    v_group.channel_fb, v_group.channel_jobthai, v_group.channel_jobtopgun, v_group.channel_jobdb, v_group.channel_jobbkk,
    v_group.channel_linkedin, v_group.channel_walkin, v_group.channel_referral, v_group.channel_others
  );

  return jsonb_build_object('ok', true, 'id', v_doc_group_id);
end;
$$;

create or replace function public.app_create_and_match_sourcing_group_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_group_position text := nullif(btrim(payload ->> 'group_position'), '');
  v_doc_ids text[];
  v_group_id text;
  v_doc_group_ids text[] := array[]::text[];
  v_site_count integer;
  v_invalid_count integer;
  v_doc_id text;
  v_doc_group_id text;
begin
  perform app_private.assert_recruitment_writer();
  if v_group_position is null then
    raise exception 'SOURCING_GROUP_POSITION_REQUIRED: Group Position is required.';
  end if;
  if jsonb_typeof(payload -> 'doc_ids') <> 'array' then
    raise exception 'SOURCING_GROUP_REQUISITIONS_REQUIRED: Select at least one requisition.';
  end if;

  select array_agg(doc_id order by doc_id)
    into v_doc_ids
  from (
    select nullif(btrim(value), '') as doc_id
    from jsonb_array_elements_text(payload -> 'doc_ids') as item(value)
  ) ids
  where doc_id is not null;

  if coalesce(array_length(v_doc_ids, 1), 0) = 0
    or cardinality(v_doc_ids) <> cardinality(array(select distinct unnest(v_doc_ids))) then
    raise exception 'SOURCING_GROUP_REQUISITIONS_INVALID: Select one or more distinct requisitions.';
  end if;

  select count(distinct r.site), count(*) filter (where r.doc_id is null
      or r.status <> 'ongoing'
      or coalesce((select count(*) from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null), 0) >= r.head_count
      or exists (select 1 from public.document_groups dg where dg.doc_id = r.doc_id)
      or not app_private.can_manage_requisition(r.doc_id))
    into v_site_count, v_invalid_count
  from unnest(v_doc_ids) requested(doc_id)
  left join public.requisitions r on r.doc_id = requested.doc_id;

  if v_site_count <> 1 then
    raise exception 'SOURCING_GROUP_SITE_MISMATCH: Group ID can only be matched to requisitions at one site.';
  end if;
  if v_invalid_count > 0 then
    raise exception 'SOURCING_GROUP_REQUISITION_DENIED: Every requisition must exist, be open, unmatched, and be manageable by you.';
  end if;

  v_group_id := app_private.next_app_id('position_groups', 'GRP');
  perform set_config('app.action', 'position_group:create_and_match', true);
  insert into public.position_groups (
    group_id, group_position,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_jobbkk,
    channel_linkedin, channel_walkin, channel_referral, channel_others
  ) values (
    v_group_id, v_group_position,
    coalesce((payload ->> 'channel_fb')::boolean, false),
    coalesce((payload ->> 'channel_jobthai')::boolean, false),
    coalesce((payload ->> 'channel_jobtopgun')::boolean, false),
    coalesce((payload ->> 'channel_jobdb')::boolean, false),
    coalesce((payload ->> 'channel_jobbkk')::boolean, false),
    coalesce((payload ->> 'channel_linkedin')::boolean, false),
    coalesce((payload ->> 'channel_walkin')::boolean, false),
    coalesce((payload ->> 'channel_referral')::boolean, false),
    coalesce((payload ->> 'channel_others')::boolean, false)
  );

  if coalesce((payload->>'secret_link_confirmed')::boolean,false) and app_private.secret_admin() then perform set_config('app.secret_link_ack',v_group_id,true); end if;
  foreach v_doc_id in array v_doc_ids loop
    v_doc_group_id := app_private.next_app_id('document_groups', 'DGRP');
    insert into public.document_groups (
      doc_group_id, doc_id, group_id, group_position,
      channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_jobbkk,
      channel_linkedin, channel_walkin, channel_referral, channel_others
    )
    select v_doc_group_id, v_doc_id, group_id, group_position,
      channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb, channel_jobbkk,
      channel_linkedin, channel_walkin, channel_referral, channel_others
    from public.position_groups where group_id = v_group_id;
    v_doc_group_ids := array_append(v_doc_group_ids, v_doc_group_id);
  end loop;

  return jsonb_build_object('ok', true, 'id', v_group_id, 'doc_group_ids', to_jsonb(v_doc_group_ids));
end;
$$;

create or replace function app_private.assert_application_destination(p_candidate text,p_group text) returns void language plpgsql security definer set search_path=public,app_private as $$
begin
 if not app_private.secret_group_access(p_group) then raise exception 'APPLICATION_GROUP_NOT_AVAILABLE'; end if;
 if not app_private.has_open_group_requisition(p_group) then raise exception 'APPLICATION_GROUP_NOT_AVAILABLE: Select a group with remaining open demand.'; end if;
end $$;

create or replace function public.app_application_destinations_v1() returns jsonb language sql stable security definer set search_path=public,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('group_id',g.group_id,'group_position',g.group_position,'sites',x.sites,'owners',x.owners,'doc_ids',x.doc_ids) order by g.group_position,g.group_id),'[]'::jsonb)
 from public.position_groups g join lateral (
 select array_agg(distinct r.site) sites,array_remove(array_agg(distinct r.person_in_charge),null) owners,array_agg(distinct r.doc_id) doc_ids from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=g.group_id and app_private.can_read_requisition(r.doc_id) and r.status='ongoing' and r.head_count>(select count(*) from public.offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')
 ) x on cardinality(x.doc_ids)>0 where auth.uid() is not null and app_private.is_recruitment_writer() and app_private.can_read_position_group(g.group_id)
$$;

create or replace function public.app_recruitment_applications_page_v1(
  p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer,
  p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_search text := lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
  v_sort text := coalesce(nullif(p_sort,''),'latest_log_date');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_stage text := coalesce(p_filters->>'stage','');
  v_board text := coalesce(p_filters->>'boardFilter','all');
  v_group text := coalesce(p_filters->>'groupId','');
  v_since date;
  v_embedded_all_time boolean := coalesce((p_filters->>'embeddedAllTime')::boolean,false);
  v_home_tab text := coalesce(p_filters->>'homeTab','');
  v_active_board boolean := coalesce((p_filters->>'activeBoard')::boolean,false);
  v_as_of date := coalesce(nullif(p_filters->>'asOf','')::date,current_date);
  v_global_reader boolean := app_private.is_global_recruitment_reader();
  v_cursor text := p_cursor_value #>> '{}';
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and (p_limit < 1 or p_limit > 100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('latest_log_date','candidate_id','name','application_id','home_oldest_touch','home_newest_touch','home_progression','board_last_update') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_direction not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if v_board not in ('all','aging','no_activity','offer_pending','over_sla','failed','passed_offer') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_home_tab not in ('','active_pipeline') or p_filters ?| array['scope','site','owner'] or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('stage','boardFilter','asOf','recentSince','groupId','headerSite','headerPic','priorityOnly','embeddedAllTime','candidateId','homeTab','activeBoard')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_active_board and v_stage not in ('No activity','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_embedded_all_time then v_since := null;
  elsif nullif(p_filters->>'recentSince','') is not null then v_since := (p_filters->>'recentSince')::date;
  else v_since := v_as_of - 7; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if p_before and p_cursor_value is null then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with eligible_applications as materialized (
    select a.* from public.candidate_applications a
    where case when v_global_reader then (app_private.secret_application_access(a.application_id) and (v_home_tab='' or app_private.report_application(a.application_id))) else (app_private.can_read_application(a.application_id) and (v_home_tab='' or app_private.report_application(a.application_id))) end and case when v_global_reader then app_private.secret_candidate_access(a.candidate_id) else app_private.can_read_candidate(a.candidate_id) end
      and (coalesce(p_filters->>'candidateId','')='' or a.candidate_id=p_filters->>'candidateId')
      and (v_group='' or a.group_id=v_group)
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))

  ), latest as (
    select distinct on (l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l join eligible_applications eligible on eligible.application_id=l.application_id
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,
      case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,
      l.round desc,l.log_id desc
  ), app_rows as not materialized (
    select a.application_id,a.candidate_id,a.group_id,a.state,a.created_at as application_created_at,
      c.name,c.nickname,c.phone_no,c.email,c.first_contact_date,c.channel,c.updated_at,c.home_site,c.created_by,c.responsible_recruiter_id,c.doc_group_id,c.ref_name,c.candidate_folder_url,
      coalesce(lat.recruitment_process,'No activity') as latest_process,lat.result as latest_result,lat.log_date as latest_log_date,lat.outcome_date,
      off.accepted_date,pg.group_position,
      coalesce(ctx.doc_ids,'{}'::text[]) as doc_ids,coalesce(ctx.sites,'{}'::text[]) as sites,coalesce(ctx.owners,'{}'::text[]) as person_in_charges,
      case v_sort
        when 'home_oldest_touch' then (case when coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end) is null then '1' else '0' end)||coalesce(coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end)::text,'')
        when 'home_newest_touch' then (case when coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end) is null then '0' else '1' end)||coalesce(coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end)::text,'')
        when 'home_progression' then lpad((case coalesce(lat.recruitment_process,'No activity') when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end)::text,2,'0')
        when 'board_last_update' then coalesce(lat.log_date::text,c.updated_at::text,'')
        when 'candidate_id' then case when c.candidate_id ~* '^CAN-[0-9]+$' then
          lower(split_part(c.candidate_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||
          coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0')||'-'||lower(c.candidate_id) else lower(c.candidate_id) end
        when 'name' then lower(coalesce(c.name,c.nickname,''))
        when 'application_id' then a.application_id::text
        else coalesce(to_char(lat.log_date,'YYYY-MM-DD'),'')
      end as sort_value,
      (lat.log_date is null) as no_activity,
      (lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null
       and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) as aging,
      coalesce(lat.recruitment_process='Offer' and lat.result=1,false) as passed_offer
    from eligible_applications a
    join public.candidates c on c.candidate_id=a.candidate_id
    left join public.position_groups pg on pg.group_id=a.group_id
    left join latest lat on lat.application_id=a.application_id
    left join lateral (select max(event.touch_date) last_touch from public.recruitment_logs t cross join lateral(values(t.log_date),(t.outcome_date)) event(touch_date) where t.application_id=a.application_id and t.superseded_at is null and t.superseded_by_stage_instance_id is null and event.touch_date is not null and event.touch_date<=v_as_of) home_touch on true
    left join lateral (select min(o.accepted_date) accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') off on true
    left join lateral (
      select array_agg(distinct d.doc_id order by d.doc_id) doc_ids,
        array_agg(distinct r.site order by r.site) sites,
        array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners
      from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id where d.group_id=a.group_id
    ) ctx on true
    where true
      and (v_stage='' or coalesce(lat.recruitment_process,'No activity')=v_stage)
      and (not v_active_board or (coalesce(lat.recruitment_process,'No activity') in ('No activity','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and lat.result is distinct from 0 and not coalesce(lat.recruitment_process='Offer' and lat.result=1,false)))
      and (not v_active_board or v_board<>'offer_pending' or off.accepted_date is null)
      and (v_home_tab='' or (v_home_tab='active_pipeline' and lat.application_id is not null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and lat.result is distinct from 0 and not exists(select 1 from public.offers any_offer where any_offer.candidate_id=a.candidate_id and (app_private.can_read_application(any_offer.application_id) and (v_home_tab='' or app_private.report_application(any_offer.application_id))))))
      and (v_board='all'
        or (v_board in ('aging','over_sla') and lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer'))
        or (v_board='no_activity' and lat.application_id is null)
        or (v_board='offer_pending' and lat.recruitment_process='Offer' and lat.result is null)
        or (v_board='failed' and lat.result=0 and (v_since is null or coalesce(lat.outcome_date,lat.log_date) between v_since and v_as_of))
        or (v_board='passed_offer' and lat.recruitment_process='Offer' and lat.result=1 and (v_since is null or lat.log_date between v_since and v_as_of)))
      and (v_search='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),greatest(5,length(split_part(c.candidate_id,'-',2))),'0') else c.candidate_id end,
        a.group_id,case when a.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(a.group_id,'-',2),greatest(5,length(split_part(a.group_id,'-',2))),'0') else a.group_id end,
        pg.group_position,c.name,c.nickname,c.phone_no,c.email,ctx.doc_ids::text,ctx.sites::text,ctx.owners::text) ilike '%'||v_search||'%')
  ), filtered as (
    select * from app_rows r where p_cursor_value is null or
      (not p_before and ((v_direction='desc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.application_id::text>p_cursor_id))) or (v_direction='asc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.application_id::text>p_cursor_id)))) or
      (p_before and ((v_direction='desc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.application_id::text<p_cursor_id))) or (v_direction='asc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.application_id::text<p_cursor_id))))))
  ), counted as (select count(*)::integer total_count from app_rows where p_limit=0), page_raw as (
    select application_id,sort_value from filtered order by
      case when not p_before and v_direction='desc' then sort_value end desc,
      case when not p_before and v_direction='asc' then sort_value end asc,
      case when p_before and v_direction='desc' then sort_value end asc,
      case when p_before and v_direction='asc' then sort_value end desc,
      case when p_before then application_id end desc, case when not p_before then application_id end asc limit p_limit+1
  ), page_keys as materialized (select * from page_raw order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,case when p_before then application_id end desc,case when not p_before then application_id end asc limit p_limit
  ), page_projection as materialized (
    select card from jsonb_array_elements(app_private.candidate_action_cards_v1(array(select application_id from page_keys),v_as_of)) card
  ), page_rows as (
    select k.application_id,k.sort_value,p.card-'has_readable_offer'-'has_priority_requisition' item
    from page_keys k join page_projection p on p.card->>'application_id'=k.application_id::text
  ), edges as (
    select (array_agg(sort_value order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,application_id asc))[1] first_sort,
      (array_agg(application_id::text order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,application_id asc))[1] first_id,
      (array_agg(sort_value order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,application_id desc))[1] last_sort,
      (array_agg(application_id::text order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,application_id desc))[1] last_id from page_rows
  ), page_info as (select count(*)>p_limit has_extra from page_raw
  )
  select jsonb_build_object('items',coalesce((select jsonb_agg(item order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,application_id asc) from page_rows),'[]'::jsonb),
    'total_count',case when p_limit=0 then (select total_count from counted) else null end,
    'has_more',case when p_before then exists(select 1 from page_rows) else page_info.has_extra end,
    'has_more_before',case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end,
    'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else page_info.has_extra end) then jsonb_build_object('value',to_jsonb(edges.last_sort),'id',edges.last_id) else null end,
    'previous_cursor',case when (case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',to_jsonb(edges.first_sort),'id',edges.first_id) else null end)
  into v_result from edges cross join page_info;
  return v_result;
end; $$;

create or replace function public.app_recruitment_requisitions_page_v1(
  p_search text, p_filters jsonb, p_sort text, p_direction text, p_limit integer,
  p_cursor_value jsonb, p_cursor_id text, p_before boolean, p_count_only boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_search text := lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
  v_sort text := coalesce(nullif(p_sort,''),'updated_at');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_cursor text := p_cursor_value #>> '{}';
  v_home_tab text := coalesce(p_filters->>'homeTab','');
  v_managed_only boolean := coalesce((p_filters->>'managedOnly')::boolean,false);
  v_unmatched_only boolean := coalesce((p_filters->>'unmatchedOnly')::boolean,false);
  v_link_to_group_id text := nullif(p_filters->>'linkToGroupId','');
  v_profile_admin boolean := app_private.current_app_role() in ('system_admin','admin_recruiter');
  v_fast_base_criteria boolean;
  v_exact_count integer;
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and (p_limit < 1 or p_limit > 100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('docIds','doc_id','position','status','open_headcount','readiness','sla','age','owner','department','request_type','section','head_count','accepted_count','candidate_count','req_date','updated_at','home_oldest','home_demand','home_position') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_direction not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if v_home_tab not in ('','open_headcount') or jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('docIds','doc_id','position','status','open_headcount','readiness','sla','age','owner','department','request_type','section','head_count','accepted_count','candidate_count','req_date','updated_at','site','level','headerSite','headerPic','priorityOnly','homeTab','managedOnly','unmatchedOnly','linkToGroupId')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if (p_filters ? 'managedOnly' and jsonb_typeof(p_filters->'managedOnly')<>'boolean')
    or (p_filters ? 'unmatchedOnly' and jsonb_typeof(p_filters->'unmatchedOnly')<>'boolean')
    or (p_filters ? 'linkToGroupId' and jsonb_typeof(p_filters->'linkToGroupId') not in ('string','null')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_filters ? 'docIds' then
    if jsonb_typeof(p_filters->'docIds')<>'array' then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
    if jsonb_array_length(p_filters->'docIds')>100 or exists(select 1 from jsonb_array_elements(p_filters->'docIds') id where jsonb_typeof(id)<>'string' or btrim(id#>>'{}')='') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if (p_cursor_value is null) <> (p_cursor_id is null) or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  v_fast_base_criteria := v_search='' and v_home_tab=''
    and not (coalesce(p_filters,'{}'::jsonb) ?| array['open_headcount','readiness','sla','age','accepted_count','candidate_count']);

  -- Count-only requests with base-column criteria do not need per-requisition candidate/offer enrichment.
  -- Keep aggregate-dependent filters and all free-text search on the original complete path below.
  if p_count_only and v_fast_base_criteria then
    select count(*)::integer into v_exact_count
    from public.requisitions r
    where (app_private.can_read_requisition(r.doc_id) and (v_home_tab='' or not r.is_secret))
      and (not (p_filters ? 'docIds') or r.doc_id in (select jsonb_array_elements_text(p_filters->'docIds')))
      and (not v_managed_only or app_private.can_manage_requisition(r.doc_id))
      and (not v_unmatched_only or not exists(select 1 from public.document_groups unmatched where unmatched.doc_id=r.doc_id))
      and (v_link_to_group_id is null or (
        exists(select 1 from public.position_groups target_group where target_group.group_id=v_link_to_group_id and app_private.can_read_position_group(target_group.group_id))
        and (v_profile_admin or exists(select 1 from public.document_groups target_link join public.requisitions target_req on target_req.doc_id=target_link.doc_id where target_link.group_id=v_link_to_group_id and target_req.site=r.site))
      ))
      and (coalesce(p_filters->>'site','')='' or r.site ilike ('%'||(p_filters->>'site')||'%'))
      and (coalesce(p_filters->>'level','')='' or r.level ilike ('%'||(p_filters->>'level')||'%'))
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
      and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
      and (coalesce(p_filters->>'doc_id','')='' or r.doc_id ilike ('%'||(p_filters->>'doc_id')||'%'))
      and (coalesce(p_filters->>'position','')='' or (case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end) ilike ('%'||(p_filters->>'position')||'%'))
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'status','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'ongoing' then r.status='ongoing' when 'กำลังดำเนินการ' then r.status='ongoing' when 'filled' then r.status='filled' when 'ครบแล้ว' then r.status='filled' when 'cancel' then r.status='cancel' when 'cancelled' then r.status='cancel' when 'ยกเลิก' then r.status='cancel' else concat_ws(' ',r.status,r.site,r.department) ilike ('%'||(category_value.value)||'%') end)))
      and (coalesce(p_filters->>'owner','')='' or coalesce(r.person_in_charge,'') ilike ('%'||(p_filters->>'owner')||'%'))
      and (coalesce(p_filters->>'department','')='' or r.department ilike ('%'||(p_filters->>'department')||'%'))
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'request_type','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike ('%'||(category_value.value)||'%') end)))
      and (coalesce(p_filters->>'section','')='' or coalesce(r.section,'') ilike ('%'||(p_filters->>'section')||'%'))
      and (coalesce(p_filters->>'head_count','')='' or r.head_count::text ilike ('%'||(p_filters->>'head_count')||'%'))
      and (coalesce(p_filters->>'req_date','')='' or concat_ws(' ',r.pr_approved_date::text,to_char(r.pr_approved_date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'req_date')||'%'))
      and (coalesce(p_filters->>'updated_at','')='' or concat_ws(' ',r.updated_at::date::text,to_char(r.updated_at::date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'updated_at')||'%'));
    v_result := jsonb_build_object('items','[]'::jsonb,'total_count',v_exact_count,'has_more',false,'has_more_before',false,'next_cursor',null,'previous_cursor',null);
    return v_result;
  end if;

  -- For the default date sort with base-only filters, page requisition keys first and enrich only those rows.
  -- Filters/search/sorts that depend on candidate or offer aggregates deliberately use the original path.
  if not p_count_only and p_limit>0 and v_fast_base_criteria and v_sort='updated_at' then
    with base_rows as not materialized (
      select r.doc_id,r.updated_at,
        to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_value
      from public.requisitions r
      where (app_private.can_read_requisition(r.doc_id) and (v_home_tab='' or not r.is_secret))
      and (not (p_filters ? 'docIds') or r.doc_id in (select jsonb_array_elements_text(p_filters->'docIds')))
        and (not v_managed_only or app_private.can_manage_requisition(r.doc_id))
        and (not v_unmatched_only or not exists(select 1 from public.document_groups unmatched where unmatched.doc_id=r.doc_id))
        and (v_link_to_group_id is null or (
          exists(select 1 from public.position_groups target_group where target_group.group_id=v_link_to_group_id and app_private.can_read_position_group(target_group.group_id))
          and (v_profile_admin or exists(select 1 from public.document_groups target_link join public.requisitions target_req on target_req.doc_id=target_link.doc_id where target_link.group_id=v_link_to_group_id and target_req.site=r.site))
        ))
        and (coalesce(p_filters->>'site','')='' or r.site ilike ('%'||(p_filters->>'site')||'%'))
        and (coalesce(p_filters->>'level','')='' or r.level ilike ('%'||(p_filters->>'level')||'%'))
        and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
        and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
        and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
        and (coalesce(p_filters->>'doc_id','')='' or r.doc_id ilike ('%'||(p_filters->>'doc_id')||'%'))
        and (coalesce(p_filters->>'position','')='' or (case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end) ilike ('%'||(p_filters->>'position')||'%'))
        and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'status','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'ongoing' then r.status='ongoing' when 'กำลังดำเนินการ' then r.status='ongoing' when 'filled' then r.status='filled' when 'ครบแล้ว' then r.status='filled' when 'cancel' then r.status='cancel' when 'cancelled' then r.status='cancel' when 'ยกเลิก' then r.status='cancel' else concat_ws(' ',r.status,r.site,r.department) ilike ('%'||(category_value.value)||'%') end)))
        and (coalesce(p_filters->>'owner','')='' or coalesce(r.person_in_charge,'') ilike ('%'||(p_filters->>'owner')||'%'))
        and (coalesce(p_filters->>'department','')='' or r.department ilike ('%'||(p_filters->>'department')||'%'))
        and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'request_type','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike ('%'||(category_value.value)||'%') end)))
        and (coalesce(p_filters->>'section','')='' or coalesce(r.section,'') ilike ('%'||(p_filters->>'section')||'%'))
        and (coalesce(p_filters->>'head_count','')='' or r.head_count::text ilike ('%'||(p_filters->>'head_count')||'%'))
        and (coalesce(p_filters->>'req_date','')='' or concat_ws(' ',r.pr_approved_date::text,to_char(r.pr_approved_date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'req_date')||'%'))
        and (coalesce(p_filters->>'updated_at','')='' or concat_ws(' ',r.updated_at::date::text,to_char(r.updated_at::date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'updated_at')||'%'))
    ), filtered as (
      select b.* from base_rows b where p_cursor_value is null or
        (not p_before and ((v_direction='desc' and (b.sort_value<v_cursor or (b.sort_value=v_cursor and b.doc_id>p_cursor_id))) or (v_direction='asc' and (b.sort_value>v_cursor or (b.sort_value=v_cursor and b.doc_id>p_cursor_id)))) or
        (p_before and ((v_direction='desc' and (b.sort_value>v_cursor or (b.sort_value=v_cursor and b.doc_id<p_cursor_id))) or (v_direction='asc' and (b.sort_value<v_cursor or (b.sort_value=v_cursor and b.doc_id<p_cursor_id))))))
    ), page_raw as materialized (
      select * from filtered order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,
        case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,
        case when p_before then doc_id end desc,case when not p_before then doc_id end asc limit p_limit+1
    ), page_keys as materialized (
      select * from page_raw order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,
        case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,
        case when p_before then doc_id end desc,case when not p_before then doc_id end asc limit p_limit
    ), edges as (
      select (array_agg(sort_value order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,doc_id asc))[1] first_sort,
        (array_agg(doc_id order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,doc_id asc))[1] first_id,
        (array_agg(sort_value order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,doc_id desc))[1] last_sort,
        (array_agg(doc_id order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,doc_id desc))[1] last_id from page_keys
    ), page_info as (select count(*)>p_limit has_extra from page_raw), enriched as (
      select k.sort_value,r.doc_id,r.is_secret,r.is_priority,r.pr_approved_date,r.site,r.position,r.department,r.section,r.level,r.head_count,
        r.person_in_charge,r.line_manager,r.request_type,r.replacement_names,r.status,r.created_at,r.updated_at,
        coalesce(links.sourcing_group_ids,'{}'::text[]) sourcing_group_ids,
        coalesce(cands.candidate_count,0)::integer candidate_count,
        coalesce(ofrs.accepted_count,0)::integer accepted_count,
        greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::integer open_headcount,
        ofrs.sla_restart_date
      from page_keys k join public.requisitions r on r.doc_id=k.doc_id
      left join lateral (select array_agg(distinct d.group_id order by d.group_id) filter(where d.group_id is not null) sourcing_group_ids from public.document_groups d where d.doc_id=r.doc_id) links on true
      left join lateral (
        select count(distinct c.candidate_id)::integer candidate_count
        from public.candidate_applications a join public.candidates c on c.candidate_id=a.candidate_id
        join lateral unnest(coalesce(links.sourcing_group_ids,'{}'::text[])) target_group(group_id) on target_group.group_id=a.group_id where true
          and app_private.can_read_application(a.application_id) and app_private.can_read_candidate(c.candidate_id)
      ) cands on true
      left join lateral (
        select count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')::integer accepted_count,
          max(o.start_confirmed_at::date) filter(where o.start_confirmation='did_not_start' and o.start_confirmed_at is not null) sla_restart_date
        from public.offers o where o.doc_id=r.doc_id and app_private.can_read_application(o.application_id)
      ) ofrs on true
    ) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
        'doc_id',e.doc_id,'is_secret',e.is_secret,'is_priority',e.is_priority,'pr_approved_date',e.pr_approved_date,'site',e.site,'position',e.position,'department',e.department,'section',e.section,'level',e.level,'head_count',e.head_count,
        'person_in_charge',e.person_in_charge,'line_manager',e.line_manager,'request_type',e.request_type,'replacement_names',e.replacement_names,'status',e.status,'created_at',e.created_at,'updated_at',e.updated_at,
        'sourcing_group_ids',e.sourcing_group_ids,'candidate_count',e.candidate_count,'accepted_count',e.accepted_count,'open_headcount',e.open_headcount,'sla_restart_date',e.sla_restart_date)
      order by case when v_direction='desc' then e.sort_value end desc,case when v_direction='asc' then e.sort_value end asc,e.doc_id asc) from enriched e),'[]'::jsonb),
      'total_count',null,'has_more',case when p_before then exists(select 1 from page_keys) else page_info.has_extra end,
      'has_more_before',case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_keys) end,
      'next_cursor',case when (case when p_before then exists(select 1 from page_keys) else page_info.has_extra end) then jsonb_build_object('value',to_jsonb(edges.last_sort),'id',edges.last_id) else null end,
      'previous_cursor',case when (case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_keys) end) then jsonb_build_object('value',to_jsonb(edges.first_sort),'id',edges.first_id) else null end)
    into v_result from edges cross join page_info;
    return v_result;
  end if;

  with rows as not materialized (
    select r.doc_id,r.is_secret,r.is_priority,r.pr_approved_date,r.site,r.position,r.department,r.section,r.level,r.head_count,
      r.person_in_charge,r.line_manager,r.request_type,r.replacement_names,r.status,r.created_at,r.updated_at,
      coalesce(links.sourcing_group_ids,'{}'::text[]) sourcing_group_ids,
      coalesce(cands.candidate_count,0)::integer candidate_count,
      coalesce(ofrs.accepted_count,0)::integer accepted_count,
      greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::integer open_headcount,
      ofrs.sla_restart_date,
      case when links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 then 'linked' else 'missing' end readiness,
      case when age.age_days is null or sla.sla_days is null then null else age.age_days>sla.sla_days end is_overdue,
      age.age_days,
      case v_sort
        when 'home_oldest' then lpad(coalesce(age.age_days,0)::text,12,'0')||':'||lpad(greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::text,12,'0')
        when 'home_demand' then lpad(greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::text,12,'0')||':'||lpad(coalesce(age.age_days,0)::text,12,'0')
        when 'home_position' then lower(case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end)
        when 'doc_id' then lower(r.doc_id)
        when 'position' then lower(case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end)
        when 'status' then lower(case r.status when 'ongoing' then 'ongoing กำลังดำเนินการ' when 'filled' then 'filled ครบแล้ว' else 'cancel cancelled ยกเลิก' end)
        when 'open_headcount' then lpad(greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::text,12,'0')
        when 'readiness' then case when links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 then '1-linked-เชื่อมแล้ว' else '0-missing-not linked-ยังไม่เชื่อม' end
        when 'sla' then lower(case when age.age_days is null or sla.sla_days is null then '-' else age.age_days||'d / '||sla.sla_days||'d' end)
        when 'age' then lpad(coalesce(age.age_days,999999)::text,12,'0')
        when 'owner' then lower(coalesce(r.person_in_charge,''))
        when 'department' then lower(r.department)
        when 'request_type' then lower(case r.request_type when 'New' then 'new อัตราใหม่' else 'replacement ทดแทน' end)
        when 'section' then lower(coalesce(r.section,''))
        when 'head_count' then lpad(r.head_count::text,12,'0')
        when 'accepted_count' then lpad(coalesce(ofrs.accepted_count,0)::text,12,'0')
        when 'candidate_count' then lpad(coalesce(cands.candidate_count,0)::text,12,'0')
        when 'req_date' then coalesce(r.pr_approved_date::text,'')
        else to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end as sort_value
    from public.requisitions r
    left join lateral (
      select array_agg(distinct d.group_id order by d.group_id) filter(where d.group_id is not null) sourcing_group_ids
      from public.document_groups d where d.doc_id=r.doc_id
    ) links on true
    left join lateral (
      select count(distinct c.candidate_id)::integer candidate_count
      from public.candidate_applications a join public.candidates c on c.candidate_id=a.candidate_id
      join lateral unnest(coalesce(links.sourcing_group_ids,'{}'::text[])) target_group(group_id) on target_group.group_id=a.group_id where true
        and app_private.can_read_application(a.application_id) and app_private.can_read_candidate(c.candidate_id)
    ) cands on true
    left join lateral (
      select count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')::integer accepted_count,
        max(o.start_confirmed_at::date) filter(where o.start_confirmation='did_not_start' and o.start_confirmed_at is not null) sla_restart_date
      from public.offers o where o.doc_id=r.doc_id and app_private.can_read_application(o.application_id)
    ) ofrs on true
    left join lateral (select greatest((timezone('Asia/Bangkok',now())::date-coalesce(ofrs.sla_restart_date,r.pr_approved_date)),0)::integer age_days) age on true
    left join lateral (select case when r.level is null or r.level !~ '^(L)?(0|[1-9]|1[0-4])$' then null
      when replace(r.level,'L','')::integer<=6 then 30 when replace(r.level,'L','')::integer<=9 then 45 else 60 end::integer sla_days) sla on true
    where (app_private.can_read_requisition(r.doc_id) and (v_home_tab='' or not r.is_secret))
      and (not (p_filters ? 'docIds') or r.doc_id in (select jsonb_array_elements_text(p_filters->'docIds')))
      and (not v_managed_only or app_private.can_manage_requisition(r.doc_id))
      and (not v_unmatched_only or not exists(select 1 from public.document_groups unmatched where unmatched.doc_id=r.doc_id))
      and (v_link_to_group_id is null or (
        exists(select 1 from public.position_groups target_group where target_group.group_id=v_link_to_group_id and app_private.can_read_position_group(target_group.group_id))
        and (v_profile_admin or exists(
          select 1 from public.document_groups target_link join public.requisitions target_req on target_req.doc_id=target_link.doc_id
          where target_link.group_id=v_link_to_group_id and target_req.site=r.site
        ))
      ))
      and (coalesce(p_filters->>'site','')='' or r.site ilike ('%'||(p_filters->>'site')||'%'))
      and (coalesce(p_filters->>'level','')='' or r.level ilike ('%'||(p_filters->>'level')||'%'))
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
      and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
      and (v_home_tab='' or (v_home_tab='open_headcount' and r.status not in ('filled','cancel') and greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)>0))
      and (coalesce(p_filters->>'doc_id','')='' or r.doc_id ilike ('%'||(p_filters->>'doc_id')||'%'))
      and (coalesce(p_filters->>'position','')='' or (case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end) ilike ('%'||(p_filters->>'position')||'%'))
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'status','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'ongoing' then r.status='ongoing' when 'กำลังดำเนินการ' then r.status='ongoing' when 'filled' then r.status='filled' when 'ครบแล้ว' then r.status='filled' when 'cancel' then r.status='cancel' when 'cancelled' then r.status='cancel' when 'ยกเลิก' then r.status='cancel' else concat_ws(' ',r.status,r.site,r.department) ilike ('%'||(category_value.value)||'%') end)))
      and (coalesce(p_filters->>'open_headcount','')='' or greatest(r.head_count-coalesce(ofrs.accepted_count,0),0)::text ilike ('%'||(p_filters->>'open_headcount')||'%'))
      and (coalesce(p_filters->>'readiness','')='' or case lower(btrim(p_filters->>'readiness')) when 'linked' then links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 when 'เชื่อมแล้ว' then links.sourcing_group_ids is not null and cardinality(links.sourcing_group_ids)>0 when 'missing' then links.sourcing_group_ids is null or cardinality(links.sourcing_group_ids)=0 when 'not linked' then links.sourcing_group_ids is null or cardinality(links.sourcing_group_ids)=0 when 'ยังไม่เชื่อม' then links.sourcing_group_ids is null or cardinality(links.sourcing_group_ids)=0 else coalesce(array_to_string(links.sourcing_group_ids,' '),'') ilike ('%'||(p_filters->>'readiness')||'%') end)
      and (coalesce(p_filters->>'sla','')='' or (case when age.age_days is null or sla.sla_days is null then '-' else age.age_days||'d / '||sla.sla_days||'d' end) ilike ('%'||(p_filters->>'sla')||'%'))
      and (coalesce(p_filters->>'age','')='' or concat_ws(' ',coalesce(age.age_days::text||'d','-'),age.age_days) ilike ('%'||(p_filters->>'age')||'%'))
      and (coalesce(p_filters->>'owner','')='' or coalesce(r.person_in_charge,'') ilike ('%'||(p_filters->>'owner')||'%'))
      and (coalesce(p_filters->>'department','')='' or r.department ilike ('%'||(p_filters->>'department')||'%'))
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'request_type','')) as category_value(value) where (coalesce(category_value.value,'')='' or case lower(btrim(category_value.value)) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike ('%'||(category_value.value)||'%') end)))
      and (coalesce(p_filters->>'section','')='' or coalesce(r.section,'') ilike ('%'||(p_filters->>'section')||'%'))
      and (coalesce(p_filters->>'head_count','')='' or r.head_count::text ilike ('%'||(p_filters->>'head_count')||'%'))
      and (coalesce(p_filters->>'accepted_count','')='' or coalesce(ofrs.accepted_count,0)::text ilike ('%'||(p_filters->>'accepted_count')||'%'))
      and (coalesce(p_filters->>'candidate_count','')='' or coalesce(cands.candidate_count,0)::text ilike ('%'||(p_filters->>'candidate_count')||'%'))
      and (coalesce(p_filters->>'req_date','')='' or concat_ws(' ',r.pr_approved_date::text,to_char(r.pr_approved_date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'req_date')||'%'))
      and (coalesce(p_filters->>'updated_at','')='' or concat_ws(' ',r.updated_at::date::text,to_char(r.updated_at::date,'DD/MM/YYYY')) ilike ('%'||(p_filters->>'updated_at')||'%'))
      and (v_search='' or concat_ws(' ',r.doc_id,case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then coalesce(nullif(btrim(r.position),''),'-')||' (L'||regexp_replace(btrim(r.level),'^L','', 'i')||')' else coalesce(nullif(btrim(r.position),''),'-') end,r.level,r.status,r.site,r.department,r.section,r.person_in_charge,r.line_manager,r.request_type,r.replacement_names,r.head_count,
        greatest(r.head_count-coalesce(ofrs.accepted_count,0),0),coalesce(array_to_string(links.sourcing_group_ids,' '),''),
        array_to_string(array(select case when x ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(x,'-',2),greatest(5,length(split_part(x,'-',2))),'0') else x end from unnest(coalesce(links.sourcing_group_ids,'{}'::text[])) x),' '),
        cands.candidate_count,ofrs.accepted_count) ilike '%'||v_search||'%')
  ), filtered as (
    select * from rows r where p_cursor_value is null or
      (not p_before and ((v_direction='desc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.doc_id>p_cursor_id))) or (v_direction='asc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.doc_id>p_cursor_id)))) or
      (p_before and ((v_direction='desc' and (r.sort_value>v_cursor or (r.sort_value=v_cursor and r.doc_id<p_cursor_id))) or (v_direction='asc' and (r.sort_value<v_cursor or (r.sort_value=v_cursor and r.doc_id<p_cursor_id))))))
  ), counted as (select count(*)::integer total_count from rows where p_limit=0), page_raw as (
    select * from filtered order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,
      case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,
      case when p_before then doc_id end desc,case when not p_before then doc_id end asc limit p_limit+1
  ), page_rows as (select * from page_raw order by case when not p_before and v_direction='desc' then sort_value end desc,case when not p_before and v_direction='asc' then sort_value end asc,case when p_before and v_direction='desc' then sort_value end asc,case when p_before and v_direction='asc' then sort_value end desc,case when p_before then doc_id end desc,case when not p_before then doc_id end asc limit p_limit), edges as (
    select (array_agg(sort_value order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,doc_id asc))[1] first_sort,
      (array_agg(doc_id order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,doc_id asc))[1] first_id,
      (array_agg(sort_value order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,doc_id desc))[1] last_sort,
      (array_agg(doc_id order by case when v_direction='desc' then sort_value end asc,case when v_direction='asc' then sort_value end desc,doc_id desc))[1] last_id from page_rows
  ), page_info as (select count(*)>p_limit as has_extra from page_raw) select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('doc_id',p.doc_id,'is_priority',p.is_priority,'pr_approved_date',p.pr_approved_date,'site',p.site,'position',p.position,'department',p.department,'section',p.section,'level',p.level,'head_count',p.head_count,'person_in_charge',p.person_in_charge,'line_manager',p.line_manager,'request_type',p.request_type,'replacement_names',p.replacement_names,'status',p.status,'created_at',p.created_at,'updated_at',p.updated_at,'sourcing_group_ids',p.sourcing_group_ids,'candidate_count',p.candidate_count,'accepted_count',p.accepted_count,'open_headcount',p.open_headcount,'sla_restart_date',p.sla_restart_date) order by case when v_direction='desc' then p.sort_value end desc,case when v_direction='asc' then p.sort_value end asc,p.doc_id asc) from page_rows p),'[]'::jsonb),
      'total_count',case when p_limit=0 then (select total_count from counted) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else page_info.has_extra end,'has_more_before',case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end,
      'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else page_info.has_extra end) then jsonb_build_object('value',to_jsonb(edges.last_sort),'id',edges.last_id) else null end,
      'previous_cursor',case when (case when p_before then page_info.has_extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',to_jsonb(edges.first_sort),'id',edges.first_id) else null end)
    into v_result from edges cross join page_info;
  return v_result;
end; $$;

create or replace function public.app_recruitment_groups_page_v1(
  p_search text,p_filters jsonb,p_sort text,p_direction text,p_limit integer,p_cursor_value jsonb,p_cursor_id text,p_before boolean,p_count_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_sort text:=coalesce(nullif(p_sort,''),'attention'); v_dir text:=case when coalesce(nullif(p_sort,''),'attention') in ('attention','name','oldest') then 'asc' else lower(coalesce(p_direction,'desc')) end; v_scope text:=coalesce(p_filters->>'scope','ongoing'); v_cursor text:=p_cursor_value #>> '{}'; v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end); v_week_start date:=coalesce(nullif(p_filters->>'weekStart','')::date,(timezone('Asia/Bangkok',now())::date-((extract(dow from timezone('Asia/Bangkok',now()))::integer+1)%7)::integer));
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and (p_limit < 1 or p_limit > 100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_scope not in ('ongoing','all') or v_sort not in ('attention','name','oldest') or v_dir not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('scope','group_id','exactGroupId','position','site','owner','doc_id','readiness','headerSite','headerPic','priorityOnly','weekStart','reportOnly')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if (p_cursor_value is null)<>(p_cursor_id is null) or (p_cursor_value is not null and jsonb_typeof(p_cursor_value)<>'string') or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with latest as (
    select distinct on(l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc
  ), app_rows as (
    select a.application_id,a.candidate_id,a.group_id,a.state,lat.recruitment_process,lat.result,lat.log_date,off.accepted_date,
      (a.state='active' and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) active
    from public.candidate_applications a left join latest lat on lat.application_id=a.application_id
    left join lateral(select min(o.accepted_date) accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(o.application_id)) off on true
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
  ), assignment_stats as (
    select x.group_id,count(distinct a.candidate_id)::integer candidate_count,
      count(distinct a.application_id) filter(where a.group_id=x.group_id and a.active)::integer active_count,
      count(distinct a.candidate_id) filter(where a.group_id=x.group_id and a.active and a.recruitment_process in ('Reference Check','Offer'))::integer late_count,
      count(distinct a.candidate_id) filter(where a.group_id=x.group_id and a.active and a.log_date is not null and timezone('Asia/Bangkok',now())::date-a.log_date>7)::integer aging_count
    from public.candidate_application_assignments x join app_rows a on a.application_id=x.application_id
    group by x.group_id
  ), base as not materialized (
    select g.group_id,g.is_secret,g.group_position,g.created_at,g.updated_at,
      coalesce(links.sites,'{}'::text[]) sites,coalesce(links.owners,'{}'::text[]) owners,coalesce(links.doc_ids,'{}'::text[]) doc_ids,
      coalesce(links.open_headcount,0)::integer open_headcount,coalesce(stats.candidate_count,0)::integer candidate_count,
      coalesce(links.demand_count,0)::integer demand_count,coalesce(links.filled_count,0)::integer filled_count,coalesce(stats.active_count,0)::integer active_candidate_count,
      case when coalesce(links.open_req_count,0)=0 then null when coalesce(stats.candidate_count,0)=0 then 'No coverage' when coalesce(stats.late_count,0)>0 then 'Late-stage coverage' when coalesce(stats.aging_count,0)>0 then 'Aging coverage' when coalesce(stats.active_count,0)>0 then 'Active coverage' else 'Needs candidate' end readiness_label,
      case when coalesce(links.open_req_count,0)=0 then null when coalesce(stats.candidate_count,0)=0 then 0 when coalesce(stats.late_count,0)>0 then 4 when coalesce(stats.aging_count,0)>0 then 2 when coalesce(stats.active_count,0)>0 then 3 else 1 end readiness_rank,
      case when coalesce(links.open_req_count,0)=0 then 0 else links.open_req_count end readiness_count,case when coalesce(links.open_req_count,0)=0 then 0 else links.open_req_count end readiness_total,
      g.channel_fb channel_fb,g.channel_jobthai channel_jobthai,g.channel_jobtopgun channel_jobtopgun,g.channel_jobdb channel_jobdb,
      g.channel_jobbkk channel_jobbkk,g.channel_linkedin channel_linkedin,g.channel_walkin channel_walkin,g.channel_referral channel_referral,
      g.channel_others channel_others,selected.update latest_update,latest_saved.updated_at latest_saved_at,
      case when v_sort='name' then lower(g.group_position) when v_sort='oldest' then case when selected.update is null then '0|' else '1|'||to_char(selected.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
        else lpad(coalesce(case when coalesce(links.open_req_count,0)=0 then 5 else case when coalesce(stats.candidate_count,0)=0 then 0 when coalesce(stats.late_count,0)>0 then 4 when coalesce(stats.aging_count,0)>0 then 2 when coalesce(stats.active_count,0)>0 then 3 else 1 end end,5)::text,2,'0')||'|'||lpad((999999-coalesce(links.demand_count,0))::text,12,'0')||'|'||lower(g.group_position) end sort_value
    from public.position_groups g
    left join lateral (
      select array_agg(distinct r.site order by r.site) filter(where r.site is not null) sites,
        array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners,
        array_agg(distinct r.doc_id order by r.doc_id) doc_ids,
        sum(greatest(r.head_count-coalesce(ofr.accepted,0),0)) filter(where r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0) open_headcount,
        sum(r.head_count) filter(where r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0) demand_count,
        sum(least(r.head_count,coalesce(ofr.accepted,0))) filter(where r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0) filled_count,
        count(*) filter(where r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0)::integer open_req_count,
        bool_or(d.channel_fb) channel_fb,bool_or(d.channel_jobthai) channel_jobthai,bool_or(d.channel_jobtopgun) channel_jobtopgun,
        bool_or(d.channel_jobdb) channel_jobdb,bool_or(d.channel_jobbkk) channel_jobbkk,bool_or(d.channel_linkedin) channel_linkedin,
        bool_or(d.channel_walkin) channel_walkin,bool_or(d.channel_referral) channel_referral,bool_or(d.channel_others) channel_others
      from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id
      left join lateral(select count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')::integer accepted from public.offers o where o.doc_id=r.doc_id and app_private.can_read_application(o.application_id)) ofr on true
      where d.group_id=g.group_id and app_private.can_read_requisition(r.doc_id)
        and (v_scope='all' or r.status='ongoing' and greatest(r.head_count-coalesce(ofr.accepted,0),0)>0)
        and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite')
        and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
        and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
    ) links on true
    left join assignment_stats stats on stats.group_id=g.group_id
    left join lateral(select to_jsonb(u) update,u.updated_at from public.sourcing_weekly_updates u where u.group_id=g.group_id and u.week_start in (v_week_start,v_week_start+2) order by case when u.week_start=v_week_start then 0 else 1 end,u.updated_at desc limit 1) selected on true
    left join lateral(select max(u.updated_at) updated_at from public.sourcing_weekly_updates u where u.group_id=g.group_id) latest_saved on true
    where (app_private.can_read_position_group(g.group_id) and (coalesce((p_filters->>'reportOnly')::boolean,false)=false or not g.is_secret)) and cardinality(coalesce(links.doc_ids,'{}'::text[]))>0
      and (coalesce(p_filters->>'group_id','')='' or g.group_id ilike '%'||(case when btrim(p_filters->>'group_id') ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(btrim(p_filters->>'group_id'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'group_id'),'-',2))),'0') else p_filters->>'group_id' end)||'%' or
        (g.group_id ~* '^GRP-[0-9]+$' and ('GRP-'||lpad(split_part(g.group_id,'-',2),greatest(5,length(split_part(g.group_id,'-',2))),'0')) ilike '%'||(case when btrim(p_filters->>'group_id') ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(btrim(p_filters->>'group_id'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'group_id'),'-',2))),'0') else p_filters->>'group_id' end)||'%'))
      and (coalesce(p_filters->>'exactGroupId','')='' or g.group_id=p_filters->>'exactGroupId')
      and (coalesce(p_filters->>'position','')='' or g.group_position ilike '%'||(p_filters->>'position')||'%')
      and (coalesce(p_filters->>'site','')='' or array_to_string(links.sites,' ') ilike '%'||(p_filters->>'site')||'%')
      and (coalesce(p_filters->>'owner','')='' or array_to_string(links.owners,' ') ilike '%'||(p_filters->>'owner')||'%')
      and (coalesce(p_filters->>'doc_id','')='' or array_to_string(links.doc_ids,' ') ilike '%'||(p_filters->>'doc_id')||'%')
      and (coalesce(p_filters->>'readiness','')='' or case lower(p_filters->>'readiness') when 'linked' then cardinality(links.doc_ids)>0 else coalesce(case when coalesce(links.open_req_count,0)=0 then 'filled' when coalesce(stats.candidate_count,0)=0 then 'no coverage' when coalesce(stats.late_count,0)>0 then 'late-stage coverage' when coalesce(stats.aging_count,0)>0 then 'aging coverage' when coalesce(stats.active_count,0)>0 then 'active coverage' else 'needs candidate' end,'') ilike '%'||(p_filters->>'readiness')||'%' end)
      and (v_search='' or concat_ws(' ',g.group_id,
        case when g.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(g.group_id,'-',2),greatest(5,length(split_part(g.group_id,'-',2))),'0') else g.group_id end,
        array_to_string(array(select case when x ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(x,'-',2),greatest(5,length(split_part(x,'-',2))),'0') else x end from unnest(coalesce(links.doc_ids,'{}'::text[])) x),' '),
        g.group_position,links.sites,links.owners,links.doc_ids) ilike '%'||v_search||'%')
  ), filtered as (select * from base b where p_cursor_value is null or (not p_before and ((v_dir='asc' and (sort_value>v_cursor or sort_value=v_cursor and group_id>p_cursor_id)) or (v_dir='desc' and (sort_value<v_cursor or sort_value=v_cursor and group_id>p_cursor_id))) or (p_before and ((v_dir='asc' and (sort_value<v_cursor or sort_value=v_cursor and group_id<p_cursor_id)) or (v_dir='desc' and (sort_value>v_cursor or sort_value=v_cursor and group_id<p_cursor_id))))) ),
  page_raw as (select * from filtered order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then group_id end desc,case when not p_before then group_id end asc limit p_limit+1),
  page_rows as (select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then group_id end desc,case when not p_before then group_id end asc limit p_limit),
  edges as (select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,group_id asc))[1] first_sort,(array_agg(group_id order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,group_id asc))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,group_id desc))[1] last_sort,(array_agg(group_id order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,group_id desc))[1] last_id from page_rows),
  info as (select count(*)>p_limit extra from page_raw)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('group_id',p.group_id,'is_secret',p.is_secret,'group_position',p.group_position,'sites',p.sites,'owners',p.owners,'doc_ids',p.doc_ids,'open_headcount',p.open_headcount,'candidate_count',p.candidate_count,'demand_count',p.demand_count,'filled_count',p.filled_count,'active_candidate_count',p.active_candidate_count,'readiness_label',p.readiness_label,'readiness_count',p.readiness_count,'readiness_total',p.readiness_total,'channel_fb',p.channel_fb,'channel_jobthai',p.channel_jobthai,'channel_jobtopgun',p.channel_jobtopgun,'channel_jobdb',p.channel_jobdb,'channel_jobbkk',p.channel_jobbkk,'channel_linkedin',p.channel_linkedin,'channel_walkin',p.channel_walkin,'channel_referral',p.channel_referral,'channel_others',p.channel_others,'latest_update',p.latest_update,'latest_saved_at',p.latest_saved_at) order by case when v_dir='asc' then p.sort_value end asc,case when v_dir='desc' then p.sort_value end desc,p.group_id) from page_rows p),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from base) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_sort,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_sort,'id',edges.first_id) else null end)
  into v_result from edges cross join info;
  return v_result;
end; $$;

create or replace function public.app_recruitment_offers_page_v1(
  p_search text,p_filters jsonb,p_sort text,p_direction text,p_limit integer,
  p_cursor_value jsonb,p_cursor_id text,p_before boolean,p_count_only boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_sort text:=coalesce(nullif(p_sort,''),'accepted'); v_dir text:=lower(coalesce(p_direction,'desc')); v_cursor text:=p_cursor_value #>> '{}'; v_result jsonb; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end); v_home_tab text:=coalesce(p_filters->>'homeTab',''); v_today date:=coalesce(nullif(p_filters->>'today','')::date,timezone('Asia/Bangkok',now())::date);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and (p_limit < 1 or p_limit > 100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('candidate','doc_id','position','status','impact','accepted','first_working','age','home_first_working') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_dir not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if v_home_tab not in ('','start_confirmation') or jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('candidate','doc_id','position','status','impact','accepted','first_working','age','headerSite','headerPic','priorityOnly','homeTab','today')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or p_cursor_id !~ '^[0-9]+$') then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if (p_cursor_value is null)<>(p_cursor_id is null) or (p_before and p_cursor_value is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  with source_rows as not materialized (
    select o.offer_id,o.application_id,o.candidate_id,o.doc_id,o.accepted_date,o.first_working_date,o.start_confirmation,o.start_confirmed_at,o.start_confirmed_by,o.start_confirmation_reason,o.remark,o.created_at,o.updated_at,
      c.name,c.nickname,r.position,r.level,r.site,r.person_in_charge,r.request_type,r.head_count,
      coalesce((select count(*) from public.offers x where x.doc_id=o.doc_id and x.accepted_date is not null and x.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(x.application_id)),0)::integer accepted_count,
      case when o.start_confirmation='did_not_start' then 'Did not start' when o.start_confirmation='started' then 'Started' when o.accepted_date is null then 'Pending' when o.first_working_date is null then 'Missing start date' when o.first_working_date>=current_date and o.first_working_date<=current_date+14 then 'First day upcoming' else 'Accepted' end status,
      case when o.accepted_date is null then current_date-o.created_at::date when o.first_working_date is null then current_date-o.accepted_date else abs(current_date-o.first_working_date) end::integer age_days,
      case v_sort when 'home_first_working' then coalesce(o.first_working_date::text,'') when 'candidate' then case when c.candidate_id ~* '^CAN-[0-9]+$' then lower(split_part(c.candidate_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0')||'-'||lower(c.candidate_id) else lower(c.candidate_id) end||'|'||lower(concat_ws(' ',c.name,c.nickname)) when 'doc_id' then lower(o.doc_id) when 'position' then lower(concat_ws(' ',r.position,r.level)) when 'status' then lower(case when o.accepted_date is null then 'pending' when o.start_confirmation='did_not_start' then 'did not start' when o.start_confirmation='started' then 'started' when o.first_working_date is null then 'missing start date' else 'accepted' end) when 'impact' then lpad(coalesce((select count(*) from public.offers x where x.doc_id=o.doc_id and x.accepted_date is not null and x.start_confirmation is distinct from 'did_not_start'),0)::text,8,'0')||'/'||lpad(r.head_count::text,8,'0') when 'first_working' then coalesce(o.first_working_date::text,'') when 'age' then lpad((2147483647-coalesce(case when o.accepted_date is null then current_date-o.created_at::date else current_date-o.accepted_date end,0))::text,10,'0') else coalesce(o.accepted_date::text,'') end sort_value
    from public.offers o join public.candidates c on c.candidate_id=o.candidate_id join public.requisitions r on r.doc_id=o.doc_id
    where app_private.can_read_application(o.application_id) and app_private.can_read_candidate(o.candidate_id) and (app_private.can_read_requisition(o.doc_id) and (v_home_tab='' or exists(select 1 from public.requisitions home_r where home_r.doc_id=o.doc_id and not home_r.is_secret)))
      and (coalesce(p_filters->>'headerSite','')='' or r.site=p_filters->>'headerSite') and (coalesce(p_filters->>'headerPic','')='' or lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic')))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or r.is_priority)
      and (v_home_tab='' or (v_home_tab='start_confirmation' and o.accepted_date is not null and o.first_working_date is not null and o.first_working_date<=v_today and o.start_confirmation is null))
      and (coalesce(p_filters->>'candidate','')='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),greatest(5,length(split_part(c.candidate_id,'-',2))),'0') else c.candidate_id end,
        c.name,c.nickname) ilike '%'||(case when btrim(p_filters->>'candidate') ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(btrim(p_filters->>'candidate'),'-',2),greatest(5,length(split_part(btrim(p_filters->>'candidate'),'-',2))),'0') else p_filters->>'candidate' end)||'%')
      and (coalesce(p_filters->>'doc_id','')='' or o.doc_id ilike '%'||(p_filters->>'doc_id')||'%')
      and (coalesce(p_filters->>'position','')='' or concat_ws(' ',r.position,r.level) ilike '%'||(p_filters->>'position')||'%')
      and (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'status','offer_status')) as category_value(value) where (coalesce(category_value.value,'')='' or (case when left(btrim(coalesce(p_filters->>'status','')),1)='[' then (case when o.start_confirmation='did_not_start' then 'Did not start' when o.start_confirmation='started' then 'Started' when o.accepted_date is null then 'Pending' when o.first_working_date is null then 'Missing start date' when o.first_working_date>v_today and o.first_working_date<=v_today+14 then 'First day upcoming' when o.first_working_date<=v_today then 'Started' else 'Accepted' end) else (case when o.accepted_date is null then 'Pending' when o.start_confirmation='did_not_start' then 'Did not start' when o.start_confirmation='started' then 'Started' when o.first_working_date is null then 'Missing start date' else 'Accepted' end) end) ilike '%'||(category_value.value)||'%')))
      and (v_search='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),greatest(5,length(split_part(c.candidate_id,'-',2))),'0') else c.candidate_id end,
        c.name,c.nickname,o.doc_id,r.position,r.level,r.site,r.person_in_charge) ilike '%'||v_search||'%')
  ), filtered as (select * from source_rows s where (exists(select 1 from unnest(app_private.recruitment_category_values_v1(p_filters->>'impact','offer_impact')) as category_value(value) where (coalesce(category_value.value,'')='' or (s.accepted_count::text||'/'||s.head_count::text) ilike '%'||(category_value.value)||'%'))) and (coalesce(p_filters->>'accepted','')='' or coalesce(s.accepted_date::text,'') ilike '%'||(p_filters->>'accepted')||'%') and (coalesce(p_filters->>'first_working','')='' or coalesce(s.first_working_date::text,'') ilike '%'||(p_filters->>'first_working')||'%') and (coalesce(p_filters->>'age','')='' or s.age_days::text ilike '%'||(p_filters->>'age')||'%')),
  cursor_rows as (select * from filtered f where p_cursor_value is null or
    (not p_before and ((v_dir='asc' and f.sort_value>v_cursor) or (v_dir='desc' and f.sort_value<v_cursor) or (f.sort_value=v_cursor and f.offer_id>p_cursor_id::bigint)))
    or (p_before and ((v_dir='asc' and f.sort_value<v_cursor) or (v_dir='desc' and f.sort_value>v_cursor) or (f.sort_value=v_cursor and f.offer_id<p_cursor_id::bigint)))),
  page_raw as (select * from cursor_rows order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then offer_id end desc,case when not p_before then offer_id end asc limit greatest(p_limit,0)+1), page_rows as (select * from page_raw order by case when not p_before and v_dir='asc' then sort_value end asc,case when not p_before and v_dir='desc' then sort_value end desc,case when p_before and v_dir='asc' then sort_value end desc,case when p_before and v_dir='desc' then sort_value end asc,case when p_before then offer_id end desc,case when not p_before then offer_id end asc limit greatest(p_limit,0)), info as(select count(*)>p_limit extra from page_raw), edges as(select (array_agg(sort_value order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,offer_id))[1] first_value,(array_agg(offer_id::text order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,offer_id))[1] first_id,(array_agg(sort_value order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,offer_id desc))[1] last_value,(array_agg(offer_id::text order by case when v_dir='asc' then sort_value end desc,case when v_dir='desc' then sort_value end asc,offer_id desc))[1] last_id from page_rows)
  select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('offer_id',offer_id,'application_id',application_id,'candidate_id',candidate_id,'candidate_name',concat_ws(' ',name,nickname),'doc_id',doc_id,'accepted_date',accepted_date,'first_working_date',first_working_date,'start_confirmation',start_confirmation,'start_confirmed_at',start_confirmed_at,'start_confirmed_by',start_confirmed_by,'start_confirmation_reason',start_confirmation_reason,'remark',remark,'created_at',created_at,'updated_at',updated_at,'position',position,'level',level,'site',site,'person_in_charge',person_in_charge,'request_type',request_type,'head_count',head_count,'accepted_count',accepted_count,'status',status,'age_days',age_days) order by case when v_dir='asc' then sort_value end asc,case when v_dir='desc' then sort_value end desc,offer_id) from page_rows),'[]'::jsonb),'total_count',case when p_count_only then (select count(*)::integer from filtered) else null end,'has_more',case when p_before then exists(select 1 from page_rows) else info.extra end,'has_more_before',case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end,'next_cursor',case when (case when p_before then exists(select 1 from page_rows) else info.extra end) then jsonb_build_object('value',edges.last_value,'id',edges.last_id) else null end,'previous_cursor',case when (case when p_before then info.extra else p_cursor_value is not null and exists(select 1 from page_rows) end) then jsonb_build_object('value',edges.first_value,'id',edges.first_id) else null end) into v_result from edges cross join info;
  return v_result;
end; $$;

create or replace function app_private.candidate_action_cards_v1(p_application_ids uuid[],p_as_of date default current_date) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  v_search text := '';
  v_sort text := 'board_last_update';
  v_direction text := 'asc';
  v_stage text := coalesce('{}'::jsonb->>'stage','');
  v_board text := coalesce('{}'::jsonb->>'boardFilter','all');
  v_group text := coalesce('{}'::jsonb->>'groupId','');
  v_since date;
  v_embedded_all_time boolean := coalesce(('{}'::jsonb->>'embeddedAllTime')::boolean,false);
  v_home_tab text := coalesce('{}'::jsonb->>'homeTab','');
  v_active_board boolean := coalesce(('{}'::jsonb->>'activeBoard')::boolean,false);
  v_as_of date := coalesce(p_as_of,current_date);
  v_global_reader boolean := app_private.is_global_recruitment_reader();
  v_cursor text;
  v_result jsonb; p_search text:=''; p_filters jsonb:='{}'; p_sort text:='board_last_update'; p_direction text:='asc';
begin
if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  with eligible_applications as materialized (
    select a.* from public.candidate_applications a
    where case when v_global_reader then app_private.secret_application_access(a.application_id) else app_private.can_read_application(a.application_id) end and case when v_global_reader then app_private.secret_candidate_access(a.candidate_id) else app_private.can_read_candidate(a.candidate_id) end
      and (coalesce(p_filters->>'candidateId','')='' or a.candidate_id=p_filters->>'candidateId')
      and (v_group='' or a.group_id=v_group)
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))

      and a.application_id=any(p_application_ids)
  ), latest as (
    select distinct on (l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l join eligible_applications eligible on eligible.application_id=l.application_id
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,
      case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,
      l.round desc,l.log_id desc
  ), app_rows as not materialized (
    select a.application_id,a.candidate_id,a.group_id,a.state,a.created_at as application_created_at,
      c.name,c.nickname,c.phone_no,c.email,c.first_contact_date,c.channel,c.updated_at,c.home_site,c.created_by,c.responsible_recruiter_id,c.doc_group_id,c.ref_name,c.candidate_folder_url,
      coalesce(lat.recruitment_process,'No activity') as latest_process,lat.result as latest_result,lat.log_date as latest_log_date,lat.outcome_date,
      off.accepted_date,pg.group_position,
      coalesce(ctx.doc_ids,'{}'::text[]) as doc_ids,coalesce(ctx.sites,'{}'::text[]) as sites,coalesce(ctx.owners,'{}'::text[]) as person_in_charges,
      case v_sort
        when 'home_oldest_touch' then (case when coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end) is null then '1' else '0' end)||coalesce(coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end)::text,'')
        when 'home_newest_touch' then (case when coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end) is null then '0' else '1' end)||coalesce(coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end)::text,'')
        when 'home_progression' then lpad((case coalesce(lat.recruitment_process,'No activity') when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end)::text,2,'0')
        when 'board_last_update' then coalesce(lat.log_date::text,c.updated_at::text,'')
        when 'candidate_id' then case when c.candidate_id ~* '^CAN-[0-9]+$' then
          lower(split_part(c.candidate_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||
          coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0')||'-'||lower(c.candidate_id) else lower(c.candidate_id) end
        when 'name' then lower(coalesce(c.name,c.nickname,''))
        when 'application_id' then a.application_id::text
        else coalesce(to_char(lat.log_date,'YYYY-MM-DD'),'')
      end as sort_value,
      (lat.log_date is null) as no_activity,
      (lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null
       and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) as aging,
      coalesce(lat.recruitment_process='Offer' and lat.result=1,false) as passed_offer,
      jsonb_build_object('candidate_id',c.candidate_id,'name',c.name,'nickname',c.nickname,'phone_no',c.phone_no,'email',c.email,'home_site',c.home_site,
        'created_by',c.created_by,'responsible_recruiter_id',c.responsible_recruiter_id,'doc_group_id',c.doc_group_id,'ref_name',c.ref_name,'candidate_folder_url',c.candidate_folder_url,
        'first_contact_date',c.first_contact_date,'channel',c.channel,'updated_at',c.updated_at,'created_at',a.created_at,
        'application_id',a.application_id,'application_state',a.state,'group_id',a.group_id,'doc_ids',coalesce(ctx.doc_ids,'{}'::text[]),
        'doc_id',array_to_string(ctx.doc_ids,', '),'group_position',pg.group_position,'sites',coalesce(ctx.sites,'{}'::text[]),
        'person_in_charges',coalesce(ctx.owners,'{}'::text[]),'site',array_to_string(ctx.sites,', '),
        'person_in_charge',array_to_string(ctx.owners,', '),'latest_process',coalesce(lat.recruitment_process,'No activity'),
        'latest_result',lat.result,'latest_log_date',lat.log_date,'accepted_date',off.accepted_date,
        'home_last_touch_date',coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end),'home_pending_remark',(select l2.remark from public.recruitment_logs l2 where l2.application_id=a.application_id and l2.superseded_at is null and l2.superseded_by_stage_instance_id is null and l2.result is null order by case l2.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l2.round desc,l2.log_id desc limit 1)) as item
    from eligible_applications a
    join public.candidates c on c.candidate_id=a.candidate_id
    left join public.position_groups pg on pg.group_id=a.group_id
    left join latest lat on lat.application_id=a.application_id
    left join lateral (select max(event.touch_date) last_touch from public.recruitment_logs t cross join lateral(values(t.log_date),(t.outcome_date)) event(touch_date) where t.application_id=a.application_id and t.superseded_at is null and t.superseded_by_stage_instance_id is null and event.touch_date is not null and event.touch_date<=v_as_of) home_touch on true
    left join lateral (select min(o.accepted_date) accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') off on true
    left join lateral (
      select array_agg(distinct d.doc_id order by d.doc_id) doc_ids,
        array_agg(distinct r.site order by r.site) sites,
        array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners
      from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id where d.group_id=a.group_id
    ) ctx on true
    where case when v_global_reader then app_private.secret_application_access(a.application_id) else app_private.can_read_application(a.application_id) end and case when v_global_reader then app_private.secret_candidate_access(a.candidate_id) else app_private.can_read_candidate(a.candidate_id) end
      and (coalesce(p_filters->>'candidateId','')='' or c.candidate_id=p_filters->>'candidateId')
      and (v_group='' or a.group_id=v_group)
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))
      and (v_stage='' or coalesce(lat.recruitment_process,'No activity')=v_stage)
      and (not v_active_board or (coalesce(lat.recruitment_process,'No activity') in ('No activity','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and lat.result is distinct from 0 and not coalesce(lat.recruitment_process='Offer' and lat.result=1,false)))
      and (not v_active_board or v_board<>'offer_pending' or off.accepted_date is null)
      and (v_home_tab='' or (v_home_tab='active_pipeline' and lat.application_id is not null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and lat.result is distinct from 0 and not exists(select 1 from public.offers any_offer where any_offer.candidate_id=a.candidate_id and app_private.can_read_application(any_offer.application_id))))
      and (v_board='all'
        or (v_board in ('aging','over_sla') and lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer'))
        or (v_board='no_activity' and lat.application_id is null)
        or (v_board='offer_pending' and lat.recruitment_process='Offer' and lat.result is null)
        or (v_board='failed' and lat.result=0 and (v_since is null or coalesce(lat.outcome_date,lat.log_date) between v_since and v_as_of))
        or (v_board='passed_offer' and lat.recruitment_process='Offer' and lat.result=1 and (v_since is null or lat.log_date between v_since and v_as_of)))
      and (v_search='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),greatest(5,length(split_part(c.candidate_id,'-',2))),'0') else c.candidate_id end,
        a.group_id,case when a.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(a.group_id,'-',2),greatest(5,length(split_part(a.group_id,'-',2))),'0') else a.group_id end,
        pg.group_position,c.name,c.nickname,c.phone_no,c.email,ctx.doc_ids::text,ctx.sites::text,ctx.owners::text) ilike '%'||v_search||'%')

  ) select coalesce(jsonb_agg(item||jsonb_build_object(
 'has_readable_offer',exists(select 1 from public.offers o where o.candidate_id=app_rows.candidate_id and app_private.can_read_application(o.application_id)),
 'has_priority_requisition',exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=app_rows.group_id and r.is_priority))),'[]'::jsonb) into v_result from app_rows;
return v_result; end; $$;

create or replace function public.app_pipeline_card_location_v1(p_application_id uuid,p_search text default '',p_filters jsonb default '{}'::jsonb,p_sort text default 'board_last_update',p_direction text default 'asc') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare
  v_search text := lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
  v_sort text := coalesce(nullif(p_sort,''),'latest_log_date');
  v_direction text := lower(coalesce(p_direction,'desc'));
  v_stage text := coalesce(p_filters->>'stage','');
  v_board text := coalesce(p_filters->>'boardFilter','all');
  v_group text := coalesce(p_filters->>'groupId','');
  v_since date;
  v_embedded_all_time boolean := coalesce((p_filters->>'embeddedAllTime')::boolean,false);
  v_home_tab text := coalesce(p_filters->>'homeTab','');
  v_active_board boolean := coalesce((p_filters->>'activeBoard')::boolean,false);
  v_as_of date := coalesce(nullif(p_filters->>'asOf','')::date,current_date);
  v_global_reader boolean := app_private.is_global_recruitment_reader();
  v_cursor text;
  v_result jsonb;
  p_limit integer := 25; p_count_only boolean := false; p_before boolean := false;
  p_cursor_value jsonb := null; p_cursor_id text := null;
begin

  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_count_only is null or p_before is null or (p_count_only and p_limit<>0) or (not p_count_only and p_limit not in (7,10,25,50,100)) then raise exception 'RECRUITMENT_LIST_LIMIT_INVALID'; end if;
  if v_sort not in ('latest_log_date','candidate_id','name','application_id','home_oldest_touch','home_newest_touch','home_progression','board_last_update') then raise exception 'RECRUITMENT_LIST_SORT_INVALID'; end if;
  if v_direction not in ('asc','desc') then raise exception 'RECRUITMENT_LIST_DIRECTION_INVALID'; end if;
  if v_board not in ('all','aging','no_activity','offer_pending','over_sla','failed','passed_offer') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_home_tab not in ('','active_pipeline') or p_filters ?| array['scope','site','owner'] or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('stage','boardFilter','asOf','recentSince','groupId','headerSite','headerPic','priorityOnly','embeddedAllTime','candidateId','homeTab','activeBoard')) then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_active_board and v_stage not in ('No activity','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') then raise exception 'RECRUITMENT_LIST_FILTER_INVALID'; end if;
  if v_embedded_all_time then v_since := null;
  elsif nullif(p_filters->>'recentSince','') is not null then v_since := (p_filters->>'recentSince')::date;
  else v_since := v_as_of - 7; end if;
  if p_cursor_value is not null and (jsonb_typeof(p_cursor_value)<>'string' or nullif(p_cursor_id,'') is null) then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;
  if p_before and p_cursor_value is null then raise exception 'RECRUITMENT_LIST_CURSOR_INVALID'; end if;

  with eligible_applications as materialized (
    select a.* from public.candidate_applications a
    where case when v_global_reader then app_private.secret_application_access(a.application_id) else app_private.can_read_application(a.application_id) end and case when v_global_reader then app_private.secret_candidate_access(a.candidate_id) else app_private.can_read_candidate(a.candidate_id) end
      and (coalesce(p_filters->>'candidateId','')='' or a.candidate_id=p_filters->>'candidateId')
      and (v_group='' or a.group_id=v_group)
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))

  ), latest as (
    select distinct on (l.application_id) l.application_id,l.recruitment_process,l.result,l.log_date,l.outcome_date,l.round,l.log_id
    from public.recruitment_logs l join eligible_applications eligible on eligible.application_id=l.application_id
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,
      case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,
      l.round desc,l.log_id desc
  ), app_rows as not materialized (
    select a.application_id,a.candidate_id,a.group_id,a.state,a.created_at as application_created_at,
      c.name,c.nickname,c.phone_no,c.email,c.first_contact_date,c.channel,c.updated_at,c.home_site,c.created_by,c.responsible_recruiter_id,c.doc_group_id,c.ref_name,c.candidate_folder_url,
      coalesce(lat.recruitment_process,'No activity') as latest_process,lat.result as latest_result,lat.log_date as latest_log_date,lat.outcome_date,
      off.accepted_date,pg.group_position,
      coalesce(ctx.doc_ids,'{}'::text[]) as doc_ids,coalesce(ctx.sites,'{}'::text[]) as sites,coalesce(ctx.owners,'{}'::text[]) as person_in_charges,
      case v_sort
        when 'home_oldest_touch' then (case when coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end) is null then '1' else '0' end)||coalesce(coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end)::text,'')
        when 'home_newest_touch' then (case when coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end) is null then '0' else '1' end)||coalesce(coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end)::text,'')
        when 'home_progression' then lpad((case coalesce(lat.recruitment_process,'No activity') when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end)::text,2,'0')
        when 'board_last_update' then coalesce(lat.log_date::text,c.updated_at::text,'')
        when 'candidate_id' then case when c.candidate_id ~* '^CAN-[0-9]+$' then
          lower(split_part(c.candidate_id,'-',1))||'-'||lpad(length(coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0'))::text,20,'0')||'-'||
          coalesce(nullif(ltrim(split_part(c.candidate_id,'-',2),'0'),''),'0')||'-'||lower(c.candidate_id) else lower(c.candidate_id) end
        when 'name' then lower(coalesce(c.name,c.nickname,''))
        when 'application_id' then a.application_id::text
        else coalesce(to_char(lat.log_date,'YYYY-MM-DD'),'')
      end as sort_value,
      (lat.log_date is null) as no_activity,
      (lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null
       and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')) as aging,
      coalesce(lat.recruitment_process='Offer' and lat.result=1,false) as passed_offer,
      jsonb_build_object('candidate_id',c.candidate_id,'name',c.name,'nickname',c.nickname,'phone_no',c.phone_no,'email',c.email,'home_site',c.home_site,
        'created_by',c.created_by,'responsible_recruiter_id',c.responsible_recruiter_id,'doc_group_id',c.doc_group_id,'ref_name',c.ref_name,'candidate_folder_url',c.candidate_folder_url,
        'first_contact_date',c.first_contact_date,'channel',c.channel,'updated_at',c.updated_at,'created_at',a.created_at,
        'application_id',a.application_id,'application_state',a.state,'group_id',a.group_id,'doc_ids',coalesce(ctx.doc_ids,'{}'::text[]),
        'doc_id',array_to_string(ctx.doc_ids,', '),'group_position',pg.group_position,'sites',coalesce(ctx.sites,'{}'::text[]),
        'person_in_charges',coalesce(ctx.owners,'{}'::text[]),'site',array_to_string(ctx.sites,', '),
        'person_in_charge',array_to_string(ctx.owners,', '),'latest_process',coalesce(lat.recruitment_process,'No activity'),
        'latest_result',lat.result,'latest_log_date',lat.log_date,'accepted_date',off.accepted_date,
        'home_last_touch_date',coalesce(home_touch.last_touch,case when c.first_contact_date<=v_as_of then c.first_contact_date end),'home_pending_remark',(select l2.remark from public.recruitment_logs l2 where l2.application_id=a.application_id and l2.superseded_at is null and l2.superseded_by_stage_instance_id is null and l2.result is null order by case l2.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l2.round desc,l2.log_id desc limit 1)) as item
    from eligible_applications a
    join public.candidates c on c.candidate_id=a.candidate_id
    left join public.position_groups pg on pg.group_id=a.group_id
    left join latest lat on lat.application_id=a.application_id
    left join lateral (select max(event.touch_date) last_touch from public.recruitment_logs t cross join lateral(values(t.log_date),(t.outcome_date)) event(touch_date) where t.application_id=a.application_id and t.superseded_at is null and t.superseded_by_stage_instance_id is null and event.touch_date is not null and event.touch_date<=v_as_of) home_touch on true
    left join lateral (select min(o.accepted_date) accepted_date from public.offers o where o.application_id=a.application_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') off on true
    left join lateral (
      select array_agg(distinct d.doc_id order by d.doc_id) doc_ids,
        array_agg(distinct r.site order by r.site) sites,
        array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null) owners
      from public.document_groups d join public.requisitions r on r.doc_id=d.doc_id where d.group_id=a.group_id
    ) ctx on true
    where case when v_global_reader then app_private.secret_application_access(a.application_id) else app_private.can_read_application(a.application_id) end and case when v_global_reader then app_private.secret_candidate_access(a.candidate_id) else app_private.can_read_candidate(a.candidate_id) end
      and (coalesce(p_filters->>'candidateId','')='' or c.candidate_id=p_filters->>'candidateId')
      and (v_group='' or a.group_id=v_group)
      and (coalesce(p_filters->>'headerSite','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.site=p_filters->>'headerSite'))
      and (coalesce(p_filters->>'headerPic','')='' or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and lower(btrim(r.person_in_charge))=lower(btrim(p_filters->>'headerPic'))))
      and (not coalesce((p_filters->>'priorityOnly')::boolean,false) or exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=a.group_id and r.is_priority))
      and (v_stage='' or coalesce(lat.recruitment_process,'No activity')=v_stage)
      and (not v_active_board or (coalesce(lat.recruitment_process,'No activity') in ('No activity','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and lat.result is distinct from 0 and not coalesce(lat.recruitment_process='Offer' and lat.result=1,false)))
      and (not v_active_board or v_board<>'offer_pending' or off.accepted_date is null)
      and (v_home_tab='' or (v_home_tab='active_pipeline' and lat.application_id is not null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and lat.result is distinct from 0 and not exists(select 1 from public.offers any_offer where any_offer.candidate_id=a.candidate_id and app_private.can_read_application(any_offer.application_id))))
      and (v_board='all'
        or (v_board in ('aging','over_sla') and lat.log_date is not null and v_as_of-lat.log_date>7 and lat.result is distinct from 0 and off.accepted_date is null and lat.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer'))
        or (v_board='no_activity' and lat.application_id is null)
        or (v_board='offer_pending' and lat.recruitment_process='Offer' and lat.result is null)
        or (v_board='failed' and lat.result=0 and (v_since is null or coalesce(lat.outcome_date,lat.log_date) between v_since and v_as_of))
        or (v_board='passed_offer' and lat.recruitment_process='Offer' and lat.result=1 and (v_since is null or lat.log_date between v_since and v_as_of)))
      and (v_search='' or concat_ws(' ',c.candidate_id,
        case when c.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(c.candidate_id,'-',2),greatest(5,length(split_part(c.candidate_id,'-',2))),'0') else c.candidate_id end,
        a.group_id,case when a.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(a.group_id,'-',2),greatest(5,length(split_part(a.group_id,'-',2))),'0') else a.group_id end,
        pg.group_position,c.name,c.nickname,c.phone_no,c.email,ctx.doc_ids::text,ctx.sites::text,ctx.owners::text) ilike '%'||v_search||'%')

  ), ranked as (
 select application_id,sort_value,row_number() over(order by case when v_direction='desc' then sort_value end desc,case when v_direction='asc' then sort_value end asc,application_id asc)-1 position from app_rows
), target as (select * from ranked where application_id=p_application_id)
select jsonb_build_object('application_id',target.application_id,'offset',target.position%25,'page',target.position/5+1,'block',target.position/25,
 'cursor',(select jsonb_build_object('value',sort_value,'id',application_id::text) from ranked where position=(target.position/25)*25-1)) into v_result from target;
return coalesce(v_result,jsonb_build_object('excluded',true));
end; $$;

create or replace function public.app_dashboard_company_report()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'An authenticated application profile is required.';
  end if;
  return jsonb_build_object(
    'requisitions', coalesce((select jsonb_agg(jsonb_build_object(
      'doc_id', r.doc_id, 'is_priority', r.is_priority, 'pr_approved_date', r.pr_approved_date, 'site', r.site,
      'position', r.position, 'department', r.department, 'section', r.section,
      'level', r.level, 'head_count', r.head_count, 'person_in_charge', r.person_in_charge,
      'line_manager', null, 'request_type', r.request_type, 'replacement_names', null,
      'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at
    ) order by r.site, r.doc_id) from app_private.report_requisitions r), '[]'::jsonb),
    'requisition_logs', coalesce((select jsonb_agg(jsonb_build_object(
      'log_id', l.log_id, 'doc_id', l.doc_id, 'log_date', l.log_date,
      'status', l.status, 'remark', l.remark, 'created_at', l.created_at
    ) order by l.log_date, l.log_id) from app_private.report_requisition_logs l), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object(
      'offer_id', o.offer_id, 'candidate_id', null, 'doc_id', o.doc_id,
      'accepted_date', o.accepted_date, 'first_working_date', o.first_working_date,
      'remark', o.remark, 'start_confirmation', o.start_confirmation,
      'start_confirmed_at', o.start_confirmed_at, 'start_confirmed_by', null,
      'start_confirmation_reason', null, 'created_at', o.created_at, 'updated_at', o.updated_at
    ) order by o.accepted_date, o.offer_id) from app_private.report_offers o where o.accepted_date is not null), '[]'::jsonb)
  );
end;
$$;

create or replace function app_private.dashboard_performance_summary_range_v1(
  p_start date,
  p_end date,
  p_period text,
  p_scope jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id=auth.uid()) then
    raise exception 'AUTHENTICATED_PROFILE_REQUIRED';
  end if;
  with requisitions as (
    select r.doc_id,r.is_priority,r.pr_approved_date,r.site,r.position,r.department,r.section,
      r.level,r.head_count,r.person_in_charge,r.request_type,r.status,r.created_at
    from app_private.report_requisitions r
  ), requisition_logs as (
    select l.log_id,l.doc_id,l.log_date,l.status,l.remark,l.created_at from app_private.report_requisition_logs l
  ), offers as (
    select o.offer_id,null::text as candidate_id,o.doc_id,o.accepted_date,o.first_working_date,
      o.remark,o.start_confirmation,o.start_confirmed_at,null::uuid as start_confirmed_by,
      null::text as start_confirmation_reason,o.created_at,o.updated_at
    from app_private.report_offers o where o.accepted_date is not null
  ), scoped as (
    select r.*,
      case
        when btrim(coalesce(r.level,'')) !~* '^L?(0|[1-9]|1[0-4])$' then 'Unknown'
        when substring(btrim(r.level) from '([0-9]+)$')::integer <= 3 then 'NML'
        when substring(btrim(r.level) from '([0-9]+)$')::integer <= 6 then 'FML'
        when substring(btrim(r.level) from '([0-9]+)$')::integer <= 9 then 'MML'
        when substring(btrim(r.level) from '([0-9]+)$')::integer <= 12 then 'SML'
        else 'Executive'
      end as band,
      case
        when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::integer <= 6 then 30
        when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::integer <= 9 then 45
        when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then 60
        else null
      end as sla_days,
      greatest(coalesce(r.head_count,0),0) as capacity
    from requisitions r
    where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(coalesce(r.person_in_charge,''))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in (select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists (
        select 1 from jsonb_array_elements_text(p_scope->'levels') selected(band)
        where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$'
          and substring(btrim(r.level) from '([0-9]+)$')::integer between split_part(selected.band,'-',1)::integer and split_part(selected.band,'-',2)::integer
      ))
  ), state_at_end as (
    select r.*,
      coalesce((select l.status from requisition_logs l where l.doc_id=r.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1),
        case when r.created_at::date>p_end then 'ongoing' else r.status end) as period_status
    from scoped r
  ), eligibility_inputs as (
    select r.*,
      (select count(*) from offers o where o.doc_id=r.doc_id and o.accepted_date<=p_start-1 and
        (o.start_confirmation is distinct from 'did_not_start' or (o.start_confirmed_at is not null and o.start_confirmed_at::date>p_start-1))) as accepted_before,
      (select count(*) from offers o where o.doc_id=r.doc_id) as related_offer_count,
      exists(select 1 from requisition_logs l where l.doc_id=r.doc_id and l.status='filled' and l.log_date<p_start) as filled_before,
      exists(select 1 from offers o where o.doc_id=r.doc_id and o.start_confirmation='did_not_start' and o.start_confirmed_at::date between p_start and p_end) as reopened_in_range
    from state_at_end r
  ), eligible as (
    select r.*
    from eligibility_inputs r
    where r.pr_approved_date is not null and r.pr_approved_date<=p_end and r.period_status<>'cancel'
      and (not ((r.accepted_before>=r.head_count or (r.related_offer_count=0 and r.filled_before)) and not r.reopened_in_range))
      and (p_period in ('pim','custom') or (r.sla_days is not null and r.pr_approved_date+r.sla_days>=p_start))
  ), counted_candidates as (
    select r.doc_id,r.site,r.band,r.request_type,r.capacity,r.pr_approved_date,r.sla_days,
      o.offer_id,o.accepted_date,o.start_confirmation,o.start_confirmed_at,
      row_number() over(partition by r.doc_id order by o.accepted_date,o.offer_id) as accepted_rank
    from eligible r
    join offers o on o.doc_id=r.doc_id and o.accepted_date between p_start and p_end
      and (o.start_confirmation is distinct from 'did_not_start' or (o.start_confirmed_at is not null and o.start_confirmed_at::date>p_end))
  ), counted as (
    select c.*,
      case
        when c.sla_days is null then null
        when coalesce((select max(restart.start_confirmed_at::date) from offers restart where restart.doc_id=c.doc_id and restart.start_confirmation='did_not_start' and restart.start_confirmed_at::date<=c.accepted_date),c.pr_approved_date)>c.accepted_date then null
        when c.accepted_date-coalesce((select max(restart.start_confirmed_at::date) from offers restart where restart.doc_id=c.doc_id and restart.start_confirmation='did_not_start' and restart.start_confirmed_at::date<=c.accepted_date),c.pr_approved_date)<=c.sla_days then true
        else false
      end as in_sla,
      case when c.pr_approved_date is not null and c.accepted_date>=c.pr_approved_date then c.accepted_date-c.pr_approved_date else null end as days_to_fill
    from counted_candidates c
    where c.accepted_rank<=c.capacity
  ), counted_by_requisition as (
    select doc_id,count(*)::integer as filled,
      count(*) filter(where in_sla is true)::integer as on_time,
      count(*) filter(where in_sla is false)::integer as late,
      count(*) filter(where in_sla is null)::integer as unknown_sla
    from counted group by doc_id
  ), cells as (
    select r.site,r.band,
      sum(r.capacity)::integer as vacancies,
      sum(coalesce(c.filled,0))::integer as filled,
      greatest(sum(r.capacity)-sum(coalesce(c.filled,0)),0)::integer as open,
      sum(coalesce(c.on_time,0))::integer as on_time,
      sum(coalesce(c.late,0))::integer as late,
      sum(coalesce(c.unknown_sla,0))::integer as unknown_sla,
      sum(case when r.request_type='Replacement' then 0 else r.capacity end)::integer as new_vacancies,
      sum(case when r.request_type='Replacement' then r.capacity else 0 end)::integer as replacement_vacancies
    from eligible r left join counted_by_requisition c using(doc_id)
    group by r.site,r.band
  ), totals as (
    select coalesce(sum(vacancies),0)::integer as vacancies,coalesce(sum(filled),0)::integer as filled,
      coalesce(sum(on_time),0)::integer as on_time,coalesce(sum(late),0)::integer as late,coalesce(sum(unknown_sla),0)::integer as unknown_sla
    from cells
  ), time_totals as (
    select coalesce(sum(days_to_fill),0)::numeric as total, count(days_to_fill)::integer as count from counted
  ),
  final_cells as (
    select coalesce(jsonb_agg(jsonb_build_object('site',site,'band',band,'vacancies',vacancies,'filled',filled,'open',open,'onTime',on_time,'late',late,'unknownSla',unknown_sla,'newVacancies',new_vacancies,'replacementVacancies',replacement_vacancies)
      order by site,case band when 'NML' then 1 when 'FML' then 2 when 'MML' then 3 when 'SML' then 4 when 'Executive' then 5 else 6 end),'[]'::jsonb) as cells
    from cells
  ), site_json as (
    select coalesce(jsonb_agg(site order by site),'[]'::jsonb) as sites from (select distinct site from cells) s
  )
  select jsonb_build_object(
    'range',jsonb_build_object('start',p_start,'end',p_end),
    'metrics',jsonb_build_object('vacancies',t.vacancies,'filled',t.filled,'open',greatest(t.vacancies-t.filled,0),
      'filledPct',case when t.vacancies>0 then t.filled::numeric/t.vacancies*100 else null end,
      'slaPct',case when t.on_time+t.late>0 then t.on_time::numeric/(t.on_time+t.late)*100 else null end,
      'avgTimeToFill',case when tt.count>0 then tt.total/tt.count else null end,
      'onTime',t.on_time,'late',t.late,'unknownSla',t.unknown_sla),
    'cells',fc.cells,'sites',sj.sites
  ) into v_result
  from totals t cross join time_totals tt cross join final_cells fc cross join site_json sj;

  return v_result;
end;
$$;

create or replace function public.app_recruitment_calendar_v1(
  p_start date, p_end date, p_scope jsonb default '{}'::jsonb,
  p_after_date date default null, p_after_id text default null, p_limit integer default 200
) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare v_events jsonb; v_count integer; v_has_more boolean; v_next_cursor jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_end-p_start>61 then raise exception 'CALENDAR_RANGE_INVALID'; end if;
  if p_limit is null or p_limit not in (50,100,200) or (p_after_date is null)<>(p_after_id is null) or (p_after_date is not null and (p_after_date<p_start or p_after_date>p_end or p_after_id='')) then raise exception 'CALENDAR_CURSOR_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'CALENDAR_SCOPE_INVALID'; end if;
  with rows as (
    select 'log:'||l.log_id::text as id,l.candidate_id,c.name,c.nickname,l.application_id,
      l.estimated_action_date as event_date,'stage'::text as event_type,l.estimated_action_date<((now() at time zone 'Asia/Bangkok')::date) as overdue,
      l.round,l.recruitment_process as stage,a.group_id, null::text as start_status,l.log_id,l.stage_instance_id,l.log_date,l.interviewer,l.remark,l.updated_at
    from app_private.report_recruitment_logs l
    join app_private.report_candidates c on c.candidate_id=l.candidate_id and app_private.can_read_candidate(c.candidate_id)
    join app_private.report_candidate_applications a on a.application_id=l.application_id and app_private.can_read_application(a.application_id)
    where l.result is null and l.superseded_at is null and l.superseded_by_stage_instance_id is null
      and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and l.estimated_action_date between p_start and p_end
    union all
    select 'offer:'||o.offer_id::text,o.candidate_id,c.name,c.nickname,o.application_id,
      o.first_working_date,'start_work',false,1,'Offer',a.group_id,
      case when o.start_confirmation='started' then 'started' when o.first_working_date<=((now() at time zone 'Asia/Bangkok')::date) then 'confirmation_pending' else 'scheduled' end,null::bigint,null::uuid,null::date,null::text,null::text,null::timestamptz
    from app_private.report_offers o
    join app_private.report_candidates c on c.candidate_id=o.candidate_id and app_private.can_read_candidate(c.candidate_id)
    join app_private.report_candidate_applications a on a.application_id=o.application_id and app_private.can_read_application(a.application_id)
    where o.accepted_date is not null and o.first_working_date between p_start and p_end
      and o.start_confirmation is distinct from 'did_not_start'
  ), visible as (
    select rows.*,coalesce(nullif(btrim(rows.name),''),nullif(btrim(rows.nickname),''),'-') || case when nullif(btrim(rows.name),'') is not null and nullif(btrim(rows.nickname),'') is not null then ' ('||btrim(rows.nickname)||')' else '' end as candidate_name,
      (select string_agg(distinct nullif(btrim(r.person_in_charge),''),', ' order by nullif(btrim(r.person_in_charge),'')) from app_private.report_document_groups d join app_private.report_requisitions r using(doc_id) where d.group_id=rows.group_id
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)) as owner,
      (select string_agg(distinct r.site,', ' order by r.site) from app_private.report_document_groups d join app_private.report_requisitions r using(doc_id) where d.group_id=rows.group_id
        and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
        and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)) as site,
      (select min(g.group_position) from app_private.report_position_groups g where g.group_id=rows.group_id) as position
    from rows
  ), scoped as (
    select * from visible where site is not null
  ), page_candidates as (
    select * from scoped where p_after_date is null or event_date>p_after_date or (event_date=p_after_date and id>p_after_id)
    order by event_date,id limit p_limit+1
  ), limited as (
    select * from page_candidates order by event_date,id limit p_limit
  )
  select (select count(*)>p_limit from page_candidates),
    coalesce((select count(*) from page_candidates),0),
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'candidateId',candidate_id,'applicationId',application_id,'candidateName',candidate_name,'date',event_date,'eventType',event_type,'overdue',overdue,'owner',owner,'round',round,'site',site,'stage',stage,'position',position,'startWorkStatus',start_status,'logId',log_id,'stageInstanceId',stage_instance_id,'logDate',log_date,'interviewer',interviewer,'remark',remark,'updatedAt',updated_at) order by event_date,id) from limited),'[]'::jsonb),
    (select jsonb_build_object('date',event_date,'id',id) from limited order by event_date desc,id desc limit 1)
  into v_has_more,v_count,v_events,v_next_cursor;
  if v_has_more and v_next_cursor is null then raise exception 'CALENDAR_CURSOR_INVALID'; end if;
  return jsonb_build_object('events',v_events,'hasMore',v_has_more,'nextCursor',case when v_has_more then v_next_cursor else null end);
end $$;

create or replace function public.app_home_summary_v1(p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb; v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'HOME_SCOPE_INVALID'; end if;
  with scope_reqs as (
    select r.doc_id,r.is_priority,r.head_count,r.status,r.site,r.person_in_charge
    from app_private.report_requisitions r where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and app_private.can_read_requisition(r.doc_id)
  ), req as (
    select r.doc_id,r.is_priority,r.head_count,r.status,greatest(r.head_count-coalesce((select count(*) from app_private.report_offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start'),0),0) as open_headcount
    from scope_reqs r where r.status not in ('filled','cancel')
  ), scope_apps as (
    select a.application_id,a.candidate_id,a.group_id,a.state from app_private.report_candidate_applications a
    join app_private.report_candidates c on c.candidate_id=a.candidate_id and app_private.can_read_candidate(c.candidate_id)
    where app_private.can_read_application(a.application_id)
      and exists(select 1 from app_private.report_document_groups d join scope_reqs r using(doc_id) where d.group_id=a.group_id)
  ), active_apps as (
    select a.application_id,a.candidate_id,a.group_id from scope_apps a
    where a.state='active'
      and exists(select 1 from app_private.report_document_groups d join req r using(doc_id) where d.group_id=a.group_id)
  ), latest as (
    select distinct on (l.application_id) l.application_id,l.candidate_id,l.recruitment_process,l.result,l.estimated_action_date,l.log_id
    from app_private.report_recruitment_logs l join active_apps a using(application_id)
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc
  ), pipeline as (
    select recruitment_process as stage,count(*)::integer as count from latest
    where result is distinct from 0 and recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and not exists(select 1 from app_private.report_offers o where o.candidate_id=latest.candidate_id)
    group by recruitment_process
  ), pending as (
    select count(distinct (a.candidate_id,l.application_id))::integer as all_pending,
      count(distinct (a.candidate_id,l.application_id)) filter(where l.estimated_action_date<v_today)::integer as overdue
    from app_private.report_recruitment_logs l join active_apps a using(application_id)
    where l.result is null and l.superseded_at is null and l.superseded_by_stage_instance_id is null
  ), week as (select max(week_start) as latest_week from app_private.report_sourcing_weekly_updates),
  open_groups as (select distinct d.group_id from app_private.report_document_groups d join req r using(doc_id) where r.open_headcount>0),
  stale as (select count(*)::integer as n from open_groups g where not exists(select 1 from app_private.report_sourcing_weekly_updates u where u.group_id=g.group_id and (u.updated_at at time zone 'Asia/Bangkok')::date > v_today-6)),
  req_totals as (select count(*) filter(where open_headcount>0)::integer as open,count(*) filter(where open_headcount>0 and is_priority)::integer as priority_open from req),
  recent as (
    select coalesce(jsonb_agg(jsonb_build_object('log_id',l.log_id,'entity',l.entity,'entity_id',l.entity_id,'action',l.action,'changed_at',l.changed_at,'changed_by_email',l.changed_by_email) order by l.changed_at desc,l.log_id desc),'[]'::jsonb) as rows
    from (select cl.* from app_private.report_change_logs cl where
      (cl.entity='candidates' and exists(select 1 from scope_apps a where a.candidate_id=cl.entity_id))
      or (cl.entity='candidate_applications' and exists(select 1 from scope_apps a where a.application_id::text=cl.entity_id))
      or (cl.entity='requisitions' and exists(select 1 from scope_reqs r where r.doc_id=cl.entity_id))
      order by cl.changed_at desc,cl.log_id desc limit 10) l
  )
  select jsonb_build_object('requisitions',jsonb_build_object('open',req_totals.open,'priorityOpen',req_totals.priority_open),
    'candidatePipeline',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'count',count) order by case stage when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 else 6 end) from pipeline),'[]'::jsonb),
    'sourcing',jsonb_build_object('staleGroups',stale.n,'latestWeek',week.latest_week),
    'needsAction',jsonb_build_object('pendingCandidates',pending.all_pending,'overduePending',pending.overdue),'recentActivity',recent.rows,
    'workQueue',public.app_home_work_queue_v1(coalesce(p_scope,'{}'::jsonb),v_today),
    'counts',jsonb_build_object('openRequisitions',req_totals.open,'activePipeline',coalesce((select sum(count) from pipeline),0),'staleSourcing',stale.n,
      'pendingOffers',(select count(*)::integer from app_private.report_offers o join scope_reqs r using(doc_id) where o.accepted_date is not null and o.first_working_date is not null and o.first_working_date<=v_today and o.start_confirmation is null and app_private.can_read_application(o.application_id)),
      'qualityIssues',(public.app_home_quality_page_v1(coalesce(p_scope,'{}'::jsonb),v_today,null,null,null,1)->>'totalCount')::integer))
  into v_result from req_totals cross join stale cross join week cross join pending cross join recent;
  return v_result;
end $$;

create or replace function app_private.dashboard_pipeline_summary_data_v1(p_start date,p_end date,p_period text,p_scope jsonb,p_channel text) returns jsonb
language sql stable security invoker set search_path = '' as $$
with report_candidates as materialized (
    select c.candidate_id,c.channel,c.group_id,c.doc_group_id from app_private.report_candidates c where app_private.can_read_candidate(c.candidate_id)
  ), base as (
    select r.doc_id,r.site,r.department,r.section,r.position,r.level,r.head_count,r.request_type,r.status,r.pr_approved_date,r.created_at
    from app_private.report_requisitions r where app_private.can_read_requisition(r.doc_id)
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in (select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
  ), req_state as (
    select b.*,
      (select l.status from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) as last_status,
      exists(select 1 from app_private.report_requisition_logs l where l.doc_id=b.doc_id) as has_logs,
      (select l.log_date from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.status='filled' and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) as logged_filled_date,
      (select max(o.accepted_date) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date<=p_end and (select count(*) from app_private.report_offers cap where cap.doc_id=b.doc_id and cap.accepted_date is not null and cap.accepted_date<=o.accepted_date and (cap.start_confirmation is distinct from 'did_not_start' or (cap.start_confirmed_at is null or (cap.start_confirmed_at at time zone 'UTC')::date >= o.accepted_date+1))) >= b.head_count) as offer_filled_date,
      greatest(coalesce(b.head_count,0)-(select count(*) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date is not null and o.accepted_date<p_start and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'UTC')::date>=p_start)),0)::int as open_at_start
    from base b
  ), eligible as (
    select s.*,
      case when s.last_status='cancel' or (not s.has_logs and s.status='cancel') then 'cancel'
           when s.offer_filled_date is not null or s.last_status='filled' then 'filled' else 'ongoing' end as period_status,
      coalesce(s.offer_filled_date,case when s.last_status='filled' then s.logged_filled_date end) as filled_date,
      coalesce(s.pr_approved_date,(s.created_at at time zone 'UTC')::date) as opened_date
    from req_state s
    where s.pr_approved_date is not null and s.pr_approved_date<=p_end
      and (s.last_status is distinct from 'cancel') and (s.has_logs or s.status is distinct from 'cancel')
      and (coalesce(s.offer_filled_date,case when s.last_status='filled' then s.logged_filled_date end) is null or coalesce(s.offer_filled_date,case when s.last_status='filled' then s.logged_filled_date end)>=p_start)
      and (p_period in ('pim','custom') or (case when btrim(coalesce(s.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then case when substring(btrim(s.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(s.level) from '([0-9]+)$')::int<=9 then 45 else 60 end end is not null and p_start<=p_end and s.pr_approved_date+(case when substring(btrim(s.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(s.level) from '([0-9]+)$')::int<=9 then 45 else 60 end)>=p_start))
  ), group_docs as (
    select d.group_id,array_agg(distinct e.doc_id order by e.doc_id) as docs
    from eligible e join app_private.report_document_groups d on d.doc_id=e.doc_id where d.group_id is not null group by d.group_id
  ), source_rows as (
    select u.group_id,u.week_start,u.applicants_fb,u.applicants_jobthai,u.applicants_jobtopgun,u.applicants_jobdb,u.applicants_jobbkk,u.applicants_linkedin,u.applicants_walkin,u.applicants_referral,u.applicants_others
    from app_private.report_sourcing_weekly_updates u join group_docs g using(group_id) where u.week_start between p_start and p_end
  ), source_channel_rows as (
    select s.group_id,s.week_start,x.label,coalesce(x.applicants,0)::int as applicants
    from source_rows s cross join lateral (values
      ('Facebook',s.applicants_fb),('JobThai',s.applicants_jobthai),('JobTopGun',s.applicants_jobtopgun),('JobsDB',s.applicants_jobdb),('JobBKK',s.applicants_jobbkk),('LinkedIn',s.applicants_linkedin),('Walk-in',s.applicants_walkin),('Referral',s.applicants_referral),('Others',s.applicants_others)
    ) x(label,applicants)
  ), date_scoped_logs as materialized (
    select l.* from app_private.report_recruitment_logs l
    where l.superseded_at is null
      and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end) between p_start and p_end
  ), group_scoped_logs as materialized (
    select l.log_id,l.application_id,l.candidate_id,l.recruitment_process,l.round,l.log_date,l.outcome_date,l.result,
      btrim(coalesce(c.channel,'')) as channel,
      coalesce(a.group_id,c.group_id,dg.group_id) as group_id,
      case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end as activity_date
    from date_scoped_logs l
    join report_candidates c on c.candidate_id=l.candidate_id
    left join app_private.report_candidate_application_assignments a on a.assignment_id=case when l.result is null then l.entry_assignment_id else l.outcome_assignment_id end and (l.application_id is null or a.application_id=l.application_id)
    left join app_private.report_document_groups dg on dg.doc_group_id=c.doc_group_id
    where (p_channel='all' or btrim(coalesce(c.channel,''))=p_channel)
      and coalesce(a.group_id,c.group_id,dg.group_id) in (select group_id from group_docs)
  ), readable_log_applications as materialized (
    select application_id from (select distinct application_id from group_scoped_logs where application_id is not null) a
    where app_private.can_read_application(a.application_id)
  ), raw_logs as materialized (
    select l.* from group_scoped_logs l
    left join readable_log_applications a using(application_id)
    where l.application_id is null or a.application_id is not null
  ), resume_ranks as materialized (
    select l.log_id,row_number() over(partition by l.candidate_id order by l.activity_date,l.log_id) as resume_rank
    from raw_logs l where l.recruitment_process='Phone Screen'
  ), pass_ranks as materialized (
    select l.log_id,row_number() over(partition by l.candidate_id,l.recruitment_process order by l.activity_date,l.log_id) as pass_rank
    from raw_logs l where l.result=1
  ), stage_values as (
    select x.*,case when rr.resume_rank=1 then 1 else 0 end as resume,case when pr.pass_rank=1 then 1 else 0 end as passed
    from raw_logs x left join resume_ranks rr using(log_id) left join pass_ranks pr using(log_id)
  ), candidate_sources as (
    select c.candidate_id,btrim(coalesce(c.channel,'')) as channel from report_candidates c
  ),
  hire_rows as (
    select o.offer_id,o.candidate_id,btrim(coalesce(c.channel,'')) as channel,o.accepted_date,
      row_number() over(partition by o.candidate_id order by o.accepted_date,o.offer_id) as hire_rank
    from app_private.report_offers o join eligible e on e.doc_id=o.doc_id
    join report_candidates c on c.candidate_id=o.candidate_id
    where o.accepted_date between p_start and p_end and (p_channel='all' or btrim(coalesce(c.channel,''))=p_channel)
  ),
  channel_rows as (
    select case when p_channel<>'all' then p_channel when x.label in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then x.label else 'Unknown' end as label,
      case when x.label='Facebook' then 'channel_fb' when x.label='JobThai' then 'channel_jobthai' when x.label='JobTopGun' then 'channel_jobtopgun' when x.label='JobsDB' then 'channel_jobdb' when x.label='JobBKK' then 'channel_jobbkk' when x.label='LinkedIn' then 'channel_linkedin' when x.label='Walk-in' then 'channel_walkin' when x.label='Referral' then 'channel_referral' when x.label='Others' then 'channel_others' else 'unknown' end as key,
      coalesce(sum(s.applicants),0)::int as applicants,
      (select count(*)::int from stage_values v where (p_channel<>'all' and v.channel=p_channel or p_channel='all' and (case when btrim(coalesce(v.channel,'')) in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then btrim(v.channel) else 'Unknown' end)=x.label) and v.recruitment_process='Phone Screen' and v.result=1 and v.passed=1) as phone,
      (select count(*)::int from hire_rows h where h.hire_rank=1 and (case when p_channel<>'all' then h.channel when h.channel in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then h.channel else 'Unknown' end)=x.label) as hired
    from (select unnest(case when p_channel='all' then array['Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others','Unknown'] else array[p_channel] end) as label) x
    left join source_channel_rows s on (p_channel='all' and s.label=x.label or p_channel<>'all' and s.label=p_channel)
    group by x.label
  ), funnel_stages as (
    select unnest(array['applicants','Resume Screening','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer']) as stage,generate_series(1,8) as ordinal
  ), funnel_counts as (
    select fs.stage,fs.ordinal,
      case when fs.stage='applicants' then coalesce((select sum(applicants) from channel_rows),0)::int
           when fs.stage='Resume Screening' then (select count(*)::int from (select distinct v.candidate_id from stage_values v where v.recruitment_process='Phone Screen' and v.resume=1) z)
           else (select count(*)::int from stage_values v where v.recruitment_process=fs.stage and v.result=1 and v.passed=1) end as count
    from funnel_stages fs
  ), funnel_json as (
    select coalesce(jsonb_agg(jsonb_build_object('key',stage,'label',stage,'count',count,'conversionRate',case when previous_count>0 then count::numeric/previous_count else null end,'yieldRate',case when applicant_count>0 then count::numeric/applicant_count else null end,'barRatio',case when applicant_count>0 then least(count::numeric/applicant_count,1) else null end,'segments',segments) order by ordinal),'[]'::jsonb) as rows
    from (select f.*,lag(count) over(order by ordinal) as previous_count,first_value(count) over(order by ordinal) as applicant_count,
      (select coalesce(jsonb_agg(jsonb_build_object('key',c.key,'label',c.label,'count',case when f.stage='applicants' then c.applicants when f.stage='Resume Screening' then (select count(distinct v.candidate_id)::int from stage_values v where v.recruitment_process='Phone Screen' and v.resume=1 and (case when p_channel<>'all' then v.channel when v.channel in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then v.channel else 'Unknown' end)=c.label) else (select count(*)::int from stage_values v where v.recruitment_process=f.stage and v.result=1 and v.passed=1 and (case when p_channel<>'all' then v.channel when v.channel in ('Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others') then v.channel else 'Unknown' end)=c.label) end,'color',case c.key when 'channel_fb' then '#3B6FE8' when 'channel_jobthai' then '#F28C45' when 'channel_jobtopgun' then '#31B978' when 'channel_jobdb' then '#7666E4' when 'channel_jobbkk' then '#E76683' when 'channel_linkedin' then '#26A6C6' when 'channel_walkin' then '#23B4A4' when 'channel_referral' then '#B477D3' when 'channel_others' then '#70829A' else '#94A3B8' end) order by case c.key when 'channel_fb' then 1 when 'channel_jobthai' then 2 when 'channel_jobtopgun' then 3 when 'channel_jobdb' then 4 when 'channel_jobbkk' then 5 when 'channel_linkedin' then 6 when 'channel_walkin' then 7 when 'channel_referral' then 8 when 'channel_others' then 9 else 10 end),'[]'::jsonb) from channel_rows c) as segments
      from funnel_counts f) q
  ), stage_flags as (
    select unnest(array['Facebook','JobThai','JobTopGun','JobsDB','JobBKK','LinkedIn','Walk-in','Referral','Others']) as channel,unnest(array['applicants_fb','applicants_jobthai','applicants_jobtopgun','applicants_jobdb','applicants_jobbkk','applicants_linkedin','applicants_walkin','applicants_referral','applicants_others']) as count_column
  ), movement as (
    select 'Week Start'::text as waterfall_category,e.site,coalesce(e.request_type,'New') as request_type,e.open_at_start::int as vacancy_count,0::int as filled_in_sla,0::int as filled_sla_unknown from eligible e where e.opened_date<p_start and e.open_at_start>0
    union all
    select 'Open',e.site,coalesce(e.request_type,'New'),e.head_count,0,0 from eligible e where e.opened_date between p_start and p_end
    union all
    select 'Filled',e.site,coalesce(e.request_type,'New'),-1,case when sla.sla_result is true then 1 else 0 end,case when sla.sla_result is null then 1 else 0 end
    from app_private.report_offers o join eligible e on e.doc_id=o.doc_id
    cross join lateral (select (select max((no_show.start_confirmed_at at time zone 'UTC')::date) from app_private.report_offers no_show where no_show.doc_id=e.doc_id and no_show.start_confirmation='did_not_start' and (no_show.start_confirmed_at at time zone 'UTC')::date<=o.accepted_date) as restart) restart
    cross join lateral (select case when btrim(coalesce(e.level,'')) !~* '^L?(0|[1-9]|1[0-4])$' then null when coalesce(restart.restart,e.pr_approved_date)>o.accepted_date then null when o.accepted_date-coalesce(restart.restart,e.pr_approved_date)<=case when substring(btrim(e.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(e.level) from '([0-9]+)$')::int<=9 then 45 else 60 end then true else false end as sla_result) sla
    where o.accepted_date between p_start and p_end and e.period_status<>'cancel'
    union all
    select 'Open',e.site,coalesce(e.request_type,'New'),1,0,0 from app_private.report_offers o join eligible e on e.doc_id=o.doc_id and e.period_status<>'cancel' where o.start_confirmation='did_not_start' and (o.start_confirmed_at at time zone 'UTC')::date between p_start and p_end
  ), waterfall_base as (
    select waterfall_category,site,request_type,sum(vacancy_count)::int as vacancy_count,sum(filled_in_sla)::int as filled_in_sla,sum(filled_sla_unknown)::int as filled_sla_unknown from movement group by waterfall_category,site,request_type
  ), waterfall_all as (
    select * from waterfall_base union all select 'Total',site,request_type,sum(vacancy_count)::int,sum(filled_in_sla)::int,sum(filled_sla_unknown)::int from waterfall_base group by site,request_type
  ), waterfall_json as (
    select coalesce(jsonb_agg(jsonb_build_object('waterfall_category',waterfall_category,'site',site,'request_type',request_type,'vacancy_count',vacancy_count,'filledInSla',filled_in_sla,'filledSlaUnknown',filled_sla_unknown) order by site,request_type,case waterfall_category when 'Week Start' then 1 when 'Open' then 2 when 'Filled' then 3 else 4 end),'[]'::jsonb) as rows from waterfall_all
  ), reassignment_json as (
    select jsonb_build_object('in',count(*) filter(where a.group_id in (select group_id from group_docs))::int,'out',count(*) filter(where a.from_group_id in (select group_id from group_docs))::int) as values
    from app_private.report_candidate_application_assignments a where a.from_group_id is not null and app_private.can_read_application(a.application_id) and (a.started_at at time zone 'Asia/Bangkok')::date between p_start and p_end
      and (a.group_id in (select group_id from group_docs) or a.from_group_id in (select group_id from group_docs))
  ), options_json as (
    select coalesce(jsonb_agg(channel order by ordinal,channel),'[]'::jsonb) as options from (
      select channel,min(ordinal) as ordinal from (
        select label as channel,ordinal from (values ('Facebook',1),('JobThai',2),('JobTopGun',3),('JobsDB',4),('JobBKK',5),('LinkedIn',6),('Walk-in',7),('Referral',8),('Others',9)) fixed(label,ordinal)
        union all select distinct btrim(c.channel),10 from report_candidates c where nullif(btrim(c.channel),'') is not null
      ) raw_options group by channel
    ) o
  )
  select jsonb_build_object('range',jsonb_build_object('start',p_start,'end',p_end),'reassignments',r.values,'funnelRows',f.rows,'sourceRows',coalesce((select jsonb_agg(jsonb_build_object('key',key,'label',label,'color',case key when 'channel_fb' then '#3B6FE8' when 'channel_jobthai' then '#F28C45' when 'channel_jobtopgun' then '#31B978' when 'channel_jobdb' then '#7666E4' when 'channel_jobbkk' then '#E76683' when 'channel_linkedin' then '#26A6C6' when 'channel_walkin' then '#23B4A4' when 'channel_referral' then '#B477D3' when 'channel_others' then '#70829A' else '#94A3B8' end,'applicants',applicants,'phone',phone,'hired',hired) order by applicants desc,case key when 'channel_fb' then 1 when 'channel_jobthai' then 2 when 'channel_jobtopgun' then 3 when 'channel_jobdb' then 4 when 'channel_jobbkk' then 5 when 'channel_linkedin' then 6 when 'channel_walkin' then 7 when 'channel_referral' then 8 when 'channel_others' then 9 else 10 end) from channel_rows where applicants+phone+hired>0),'[]'::jsonb),'waterfallRows',w.rows,'channelOptions',o.options)
from reassignment_json r cross join funnel_json f cross join waterfall_json w cross join options_json o;
$$;

create or replace function app_private.dashboard_company_waterfall_v1(p_start date,p_end date,p_period text,p_scope jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'AUTHENTICATED_PROFILE_REQUIRED'; end if;
  with base as (
    select r.doc_id,r.site,r.department,r.person_in_charge,r.is_priority,r.level,r.head_count,r.request_type,r.status,r.pr_approved_date,r.created_at
    from app_private.report_requisitions r
    where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in (select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in (select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
  ), valid as (
    select b.*,
      (select l.status from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) last_status,
      (select l.log_date from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.status='filled' and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) logged_filled,
      greatest(coalesce(b.head_count,0)-(select count(*) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date is not null and o.accepted_date<p_start and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'UTC')::date>=p_start)),0)::int open_at_start,
      (select max(o.accepted_date) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date<=p_end and (select count(*) from app_private.report_offers x where x.doc_id=b.doc_id and x.accepted_date is not null and x.accepted_date<=o.accepted_date and (x.start_confirmation is distinct from 'did_not_start' or x.start_confirmed_at is null or (x.start_confirmed_at at time zone 'UTC')::date>=p_end+1))>=b.head_count) offer_filled
    from base b
  ), eligible as (
    select v.*,coalesce(v.offer_filled,case when v.last_status='filled' then v.logged_filled end) filled_date,coalesce(v.pr_approved_date,(v.created_at at time zone 'UTC')::date) opened_date
    from valid v where v.pr_approved_date is not null and v.pr_approved_date<=p_end and v.last_status is distinct from 'cancel'
      and (v.last_status is not null or v.status is distinct from 'cancel')
      and (coalesce(v.offer_filled,case when v.last_status='filled' then v.logged_filled end) is null or coalesce(v.offer_filled,case when v.last_status='filled' then v.logged_filled end)>=p_start)
      and (p_period in ('pim','custom') or (case when btrim(coalesce(v.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then case when substring(btrim(v.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(v.level) from '([0-9]+)$')::int<=9 then 45 else 60 end end is not null and v.pr_approved_date+(case when substring(btrim(v.level) from '([0-9]+)$')::int<=6 then 30 when substring(btrim(v.level) from '([0-9]+)$')::int<=9 then 45 else 60 end)>=p_start))
  ), movement as (
    select 'Week Start'::text category,e.site,coalesce(e.request_type,'New') request_type,e.open_at_start::int vacancy_count,0::int filled_in_sla,0::int filled_sla_unknown from eligible e where e.opened_date<p_start and e.open_at_start>0
    union all select 'Open',e.site,coalesce(e.request_type,'New'),e.head_count,0,0 from eligible e where e.opened_date between p_start and p_end
    union all select 'Filled',e.site,coalesce(e.request_type,'New'),-1,case when sla.in_sla is true then 1 else 0 end,case when sla.in_sla is null then 1 else 0 end
      from app_private.report_offers o join eligible e using(doc_id) cross join lateral (select coalesce((select max((n.start_confirmed_at at time zone 'UTC')::date) from app_private.report_offers n where n.doc_id=e.doc_id and n.start_confirmation='did_not_start' and (n.start_confirmed_at at time zone 'UTC')::date<=o.accepted_date),e.pr_approved_date) start_date) restart
      cross join lateral (select case when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([0-9]+)')::int between 0 and 6 then 30 when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([0-9]+)')::int between 7 and 9 then 45 when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([0-9]+)')::int between 10 and 14 then 60 else null end sla_days) sla_policy
      cross join lateral (select case when sla_policy.sla_days is null or restart.start_date is null or restart.start_date>o.accepted_date then null when o.accepted_date-restart.start_date<=sla_policy.sla_days then true else false end in_sla) sla
      where o.accepted_date between p_start and p_end and e.last_status is distinct from 'cancel'
    union all select 'Open',e.site,coalesce(e.request_type,'New'),1,0,0 from app_private.report_offers o join eligible e using(doc_id) where o.start_confirmation='did_not_start' and (o.start_confirmed_at at time zone 'UTC')::date between p_start and p_end and e.last_status is distinct from 'cancel'
  ), grouped as (select category,site,request_type,sum(vacancy_count)::int vacancy_count,sum(filled_in_sla)::int filled_in_sla,sum(filled_sla_unknown)::int filled_sla_unknown from movement group by category,site,request_type), allrows as (
    select * from grouped union all select 'Total',site,request_type,sum(vacancy_count)::int,sum(filled_in_sla)::int,sum(filled_sla_unknown)::int from grouped group by site,request_type
  ) select coalesce(jsonb_agg(jsonb_build_object('waterfall_category',category,'site',site,'request_type',request_type,'vacancy_count',vacancy_count,'filledInSla',filled_in_sla,'filledSlaUnknown',filled_sla_unknown) order by site,request_type,case category when 'Week Start' then 1 when 'Open' then 2 when 'Filled' then 3 else 4 end),'[]'::jsonb) into v_rows from allrows;
  return v_rows;
end;
$$;

create or replace function app_private.dashboard_rejection_events_v1(p_start date,p_end date,p_scope jsonb,p_include_undated boolean)
returns table(event_id text,log_id bigint,application_id uuid,candidate_id text,candidate_name text,group_id text,position_name text,event_date date,stage text,round integer,actor text,main_key text,detail_key text,main_en text,main_th text,detail_en text,detail_th text,requisitions jsonb,scope_context boolean,unresolved_context boolean,undated boolean)
language sql stable security invoker set search_path = '' as $$
with failure_logs as materialized (
  select l.*,d.failure_date from app_private.report_recruitment_logs l
  cross join lateral (select case when l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and l.stage_instance_id is not null then l.outcome_date else coalesce(l.outcome_date,l.log_date) end as failure_date) d
  where (d.failure_date between p_start and p_end or (p_include_undated and d.failure_date is null))
    and l.result=0 and l.superseded_at is null and l.superseded_by_stage_instance_id is null
), needed_candidate_ids as materialized (
  select distinct candidate_id from failure_logs
), authorized_candidates as materialized (
  select c.candidate_id,c.name,c.group_id,c.doc_group_id
  from app_private.report_candidates c join needed_candidate_ids n using(candidate_id)
  where app_private.can_read_candidate(c.candidate_id)
), needed_application_ids as materialized (
  select distinct application_id,candidate_id from failure_logs where application_id is not null
), authorized_applications as materialized (
  select a.application_id,a.candidate_id,a.group_id
  from app_private.report_candidate_applications a join needed_application_ids n using(application_id,candidate_id)
  where app_private.can_read_application(a.application_id)
), assignment_history as materialized (
  select a.application_id from authorized_applications a
  where exists (select 1 from app_private.report_candidate_application_assignments h where h.application_id=a.application_id)
), failures as (
  select l.*,c.name candidate_name,a.group_id application_group,
    case when l.outcome_assignment_id is not null then assignment.group_id
      when history.application_id is not null then null
      else coalesce(a.group_id,c.group_id,(select dg.group_id from app_private.report_document_groups dg where dg.doc_group_id=c.doc_group_id limit 1)) end resolved_group,
    case when l.failure_actor in ('company','candidate') then l.failure_actor else 'unclassified' end normalized_actor,
    case when nullif(btrim(l.failure_reason_snapshot->>'main_en'),'') is not null or nullif(btrim(l.failure_reason_snapshot->>'main_th'),'') is not null then coalesce(nullif(l.failure_reason_snapshot->>'main_en',''),l.failure_reason_snapshot->>'main_th') else 'Unclassified reason' end normalized_main_en,
    case when nullif(btrim(l.failure_reason_snapshot->>'main_en'),'') is not null or nullif(btrim(l.failure_reason_snapshot->>'main_th'),'') is not null then coalesce(nullif(l.failure_reason_snapshot->>'main_th',''),l.failure_reason_snapshot->>'main_en') else 'ไม่ได้ระบุเหตุผล' end normalized_main_th,
    case when nullif(btrim(l.failure_reason_snapshot->>'detail_en'),'') is not null or nullif(btrim(l.failure_reason_snapshot->>'detail_th'),'') is not null then coalesce(nullif(l.failure_reason_snapshot->>'detail_en',''),l.failure_reason_snapshot->>'detail_th') else 'Unclassified reason' end normalized_detail_en,
    case when nullif(btrim(l.failure_reason_snapshot->>'detail_en'),'') is not null or nullif(btrim(l.failure_reason_snapshot->>'detail_th'),'') is not null then coalesce(nullif(l.failure_reason_snapshot->>'detail_th',''),l.failure_reason_snapshot->>'detail_en') else 'ไม่ได้ระบุเหตุผล' end normalized_detail_th,
    case when l.failure_reason_snapshot is null or (nullif(btrim(l.failure_reason_snapshot->>'main_en'),'') is null and nullif(btrim(l.failure_reason_snapshot->>'main_th'),'') is null) then to_jsonb('unclassified'::text)
      when l.failure_main_reason_id is not null then to_jsonb(l.failure_main_reason_id::text)
      else jsonb_build_array(coalesce(nullif(l.failure_reason_snapshot->>'main_en',''),l.failure_reason_snapshot->>'main_th'),coalesce(nullif(l.failure_reason_snapshot->>'main_th',''),l.failure_reason_snapshot->>'main_en')) end main_value,
    case when l.failure_reason_snapshot is null or (nullif(btrim(l.failure_reason_snapshot->>'detail_en'),'') is null and nullif(btrim(l.failure_reason_snapshot->>'detail_th'),'') is null) then to_jsonb('unclassified'::text)
      when l.failure_detail_reason_id is not null then to_jsonb(l.failure_detail_reason_id::text)
      else jsonb_build_array(coalesce(nullif(l.failure_reason_snapshot->>'detail_en',''),l.failure_reason_snapshot->>'detail_th'),coalesce(nullif(l.failure_reason_snapshot->>'detail_th',''),l.failure_reason_snapshot->>'detail_en')) end detail_value
  from failure_logs l join authorized_candidates c on c.candidate_id=l.candidate_id
  left join authorized_applications a on a.application_id=l.application_id and a.candidate_id=l.candidate_id
  left join assignment_history history on history.application_id=l.application_id
  left join app_private.report_candidate_application_assignments assignment on assignment.assignment_id=l.outcome_assignment_id and assignment.application_id=l.application_id
  where l.application_id is null or a.application_id is not null
), keyed as (
  select f.*,coalesce(f.application_id::text,f.candidate_id)||':'||coalesce(f.stage_instance_id::text,'legacy-'||f.log_id::text) event_id,
    app_private.dashboard_json_compact_v1(jsonb_build_array(normalized_actor,main_value)) main_key,
    app_private.dashboard_json_compact_v1(jsonb_build_array(app_private.dashboard_json_compact_v1(jsonb_build_array(normalized_actor,main_value)),detail_value)) detail_key
  from failures f
), failure_groups as materialized (
  select distinct resolved_group from failures where resolved_group is not null
), group_links as materialized (
  select dg.group_id,dg.doc_id from failure_groups g join app_private.report_document_groups dg on dg.group_id=g.resolved_group
), scoped_requisitions as materialized (
  select r.doc_id,r.site,r.department,r.position,r.person_in_charge,r.level,r.is_priority
  from (select distinct doc_id from group_links) links join app_private.report_requisitions r using(doc_id)
  where app_private.can_read_requisition(r.doc_id)
    and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
    and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
    and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
    and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
    and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
), group_context as materialized (
  select g.resolved_group,coalesce(max(pg.group_position),min(r.position)) position_name,
    bool_or(dg.group_id is not null) has_links,bool_or(r.doc_id is not null) has_scope_context,
    coalesce(jsonb_agg(jsonb_build_object('doc_id',r.doc_id,'site',r.site,'department',r.department,'position',r.position,'person_in_charge',r.person_in_charge) order by r.doc_id) filter(where r.doc_id is not null),'[]'::jsonb) requisitions
  from failure_groups g
  left join group_links dg on dg.group_id=g.resolved_group
  left join app_private.report_position_groups pg on pg.group_id=dg.group_id
  left join scoped_requisitions r on r.doc_id=dg.doc_id
  group by g.resolved_group
), context_rows as (
  select k.*,context.position_name,coalesce(context.requisitions,'[]'::jsonb) requisitions,context.has_links,context.has_scope_context
  from keyed k left join group_context context using(resolved_group)
)
select c.event_id,c.log_id,c.application_id,c.candidate_id,c.candidate_name,c.resolved_group,c.position_name,c.failure_date,c.recruitment_process,c.round,c.normalized_actor,c.main_key,c.detail_key,
  c.normalized_main_en,c.normalized_main_th,c.normalized_detail_en,c.normalized_detail_th,c.requisitions,coalesce(c.has_scope_context,false),
  c.resolved_group is null or coalesce(c.has_links,false)=false,c.failure_date is null
from context_rows c
$$;

create or replace function public.app_home_work_queue_v1(p_scope jsonb default '{}'::jsonb,p_today date default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_today date:=coalesce(p_today,(now() at time zone 'Asia/Bangkok')::date);v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_today is not null and (p_today<(now() at time zone 'Asia/Bangkok')::date-3650 or p_today>(now() at time zone 'Asia/Bangkok')::date+3650) then raise exception 'HOME_DATE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'HOME_SCOPE_INVALID'; end if;
  with profile as (select p.role,p.site,coalesce(to_jsonb(p)->>'nickname','') nickname,coalesce(to_jsonb(p)->>'full_name','') full_name from public.profiles p where p.id=auth.uid()),
  scoped_reqs as materialized (select r.* from app_private.report_requisitions r where app_private.can_read_requisition(r.doc_id)
    and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
    and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)),
  reqs as (select r.*,greatest(r.head_count-coalesce(o.accepted,0),0)::integer open_headcount,
      coalesce(restart.restart_date,r.pr_approved_date) sla_start,
      case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then case when substring(btrim(r.level) from '([0-9]+)$')::integer<=6 then 30 when substring(btrim(r.level) from '([0-9]+)$')::integer<=9 then 45 else 60 end end sla_days
    from scoped_reqs r
    left join lateral (select count(*)::integer accepted from app_private.report_offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(o.application_id)) o on true
    left join lateral (select max(o.start_confirmed_at::date) restart_date from app_private.report_offers o where o.doc_id=r.doc_id and o.start_confirmation='did_not_start' and o.start_confirmed_at is not null and o.start_confirmed_at::date<=v_today) restart on true),
  req_items as (select 'req:'||r.doc_id id,coalesce(nullif(btrim(r.position),''),'-')||case when btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' then ' (L'||substring(btrim(r.level) from '([0-9]+)$')||')' else '' end title,
    r.doc_id||' - '||coalesce(r.site,'-')||' - '||coalesce(r.person_in_charge,'Unassigned')||' - '||r.open_headcount||' open - '||(v_today-r.sla_start)||'d / '||r.sla_days||'d' meta,'Overdue SLA' action_label,
    10+greatest(v_today-r.sla_start,0) priority,'danger' tone,'requisition' type,r.doc_id record_id,1 sort_group
    from reqs r cross join profile p where r.status='ongoing' and r.open_headcount>0 and r.sla_start is not null and r.sla_days is not null and v_today-r.sla_start>r.sla_days
    and (p.role in ('system_admin','admin_recruiter','viewer') or (p.nickname<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(r.site,'') ilike '%'||p.site||'%'))),
  active_apps as (select a.application_id,a.candidate_id,a.group_id,c.name,c.nickname,to_jsonb(c)->>'home_site' home_site,(to_jsonb(c)->>'created_at')::timestamptz created_at,(to_jsonb(c)->>'updated_at')::timestamptz updated_at,
      (select l.log_date from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_touch,
      (select l.recruitment_process from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_stage,
      (select l.result from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_result,
      (select array_agg(distinct r.site) from app_private.report_document_groups d join reqs r using(doc_id) where d.group_id=a.group_id) sites,
      (select string_agg(distinct r.person_in_charge,', ') from app_private.report_document_groups d join reqs r using(doc_id) where d.group_id=a.group_id) owners
    from app_private.report_candidate_applications a join app_private.report_candidates c using(candidate_id)
    where a.state='active' and app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and exists(select 1 from app_private.report_document_groups d join scoped_reqs r using(doc_id) where d.group_id=a.group_id)),
  candidate_items as (select 'cand:'||c.candidate_id id,coalesce(nullif(btrim(c.name),''),nullif(btrim(c.nickname),''),'-')||case when nullif(btrim(c.nickname),'') is not null and nullif(btrim(c.name),'') is not null then ' ('||c.nickname||')' else '' end title,
      coalesce(nullif(array_to_string(c.sites,', '),''),to_jsonb(c)->>'home_site','-')||' - '||case c.latest_stage when 'Phone Screen' then 'Phone Screening' else coalesce(c.latest_stage,'No activity') end||' - last touched '||(v_today-coalesce(c.latest_touch::date,(to_jsonb(c)->>'updated_at')::date,(to_jsonb(c)->>'created_at')::date))||'d ago' meta,
      'Aging candidate' action_label,8+greatest(v_today-coalesce(c.latest_touch::date,(to_jsonb(c)->>'updated_at')::date,(to_jsonb(c)->>'created_at')::date),0) priority,'warning' tone,'candidate' type,c.candidate_id record_id,2 sort_group
    from active_apps c cross join profile p
    where c.latest_stage in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and c.latest_result is distinct from 0
      and not exists(select 1 from app_private.report_offers o where o.application_id=c.application_id)
      and v_today-coalesce(c.latest_touch::date,(to_jsonb(c)->>'updated_at')::date,(to_jsonb(c)->>'created_at')::date)>7
      and (p.role in ('system_admin','admin_recruiter','viewer') or (p.nickname<>'' and coalesce(c.owners,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(c.owners,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(array_to_string(c.sites,','),to_jsonb(c)->>'home_site','') ilike '%'||p.site||'%'))
    ),
  stale_groups as (select d.group_id,coalesce(pg.group_position,'-') group_position,array_agg(distinct r.doc_id order by r.doc_id) doc_ids,
      array_agg(distinct r.site) sites,string_agg(distinct r.person_in_charge,', ') owners,sum(r.open_headcount)::integer open_headcount,
      max(u.updated_at) latest_update
    from app_private.report_document_groups d join reqs r using(doc_id) left join app_private.report_position_groups pg using(group_id)
      left join app_private.report_sourcing_weekly_updates u on u.group_id=d.group_id
    where r.status not in ('filled','cancel') and r.open_headcount>0 group by d.group_id,pg.group_position
    having max(u.updated_at) is null or (v_today-max(u.updated_at at time zone 'Asia/Bangkok')::date)>14),
  source_items as (select 'source:'||g.group_id id,g.group_id||' - '||g.group_position title,g.open_headcount||' open - '||array_to_string(g.doc_ids,', ')||' - last saved '||coalesce((v_today-(g.latest_update at time zone 'Asia/Bangkok')::date)::text||'d ago','never') meta,
      'Stale sourcing' action_label,7+case when g.latest_update is null then 20 else greatest(v_today-(g.latest_update at time zone 'Asia/Bangkok')::date,0) end priority,'warning' tone,'sourcing' type,g.group_id record_id,3 sort_group
    from stale_groups g cross join profile p where (p.role<>'site_recruiter' or (p.nickname<>'' and coalesce(g.owners,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(g.owners,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(array_to_string(g.sites,','),'') ilike '%'||p.site||'%'))),
  offer_items as (select 'offer:'||o.offer_id id,coalesce(nullif(btrim(c.name),''),nullif(btrim(c.nickname),''),c.candidate_id,'-') title,
      coalesce(r.position,'-')||' - '||o.doc_id||' - '||case when o.accepted_date is not null then 'Missing start date' else 'Pending' end meta,
      case when o.accepted_date is not null then 'Missing start date' else 'Pending' end action_label,
      case when o.accepted_date is not null then 9 else 6+greatest(v_today-coalesce(o.created_at::date,v_today),0) end priority,
      case when o.accepted_date is not null then 'danger' else 'warning' end tone,'offer' type,c.candidate_id record_id,4 sort_group
    from app_private.report_offers o join reqs r on r.doc_id=o.doc_id join app_private.report_candidates c on c.candidate_id=o.candidate_id cross join profile p
    where (o.application_id is null or app_private.can_read_application(o.application_id)) and app_private.can_read_candidate(c.candidate_id)
      and (p.role in ('system_admin','admin_recruiter','viewer') or (p.nickname<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.nickname||'%') or (p.full_name<>'' and coalesce(r.person_in_charge,'') ilike '%'||p.full_name||'%') or (coalesce(p.site,'')<>'' and coalesce(r.site,'') ilike '%'||p.site||'%'))
      and o.start_confirmation is distinct from 'did_not_start' and o.start_confirmation is distinct from 'started'
      and (o.accepted_date is null or o.first_working_date is null)),
  all_items as (select * from req_items union all select * from candidate_items union all select * from source_items union all select * from offer_items),
  result as (select count(*)::integer total_count,coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'meta',meta,'actionLabel',action_label,'priority',priority,'recordId',record_id,'tone',tone,'type',type) order by priority desc,sort_group,id) from (select * from all_items order by priority desc,sort_group,id limit 10) top_rows),'[]'::jsonb) items from all_items)
  select jsonb_build_object('items',items,'totalCount',total_count) into v_result from result;
  return v_result;
end $$;

create or replace function public.app_home_quality_page_v1(p_scope jsonb default '{}'::jsonb,p_today date default null,p_after_severity integer default null,p_after_title text default null,p_after_id text default null,p_limit integer default 25)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_today date:=coalesce(p_today,(now() at time zone 'Asia/Bangkok')::date);v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_limit is null or p_limit not between 1 and 50 or (p_after_severity is null)<>(p_after_title is null) or (p_after_title is null)<>(p_after_id is null) then raise exception 'HOME_QUALITY_PAGE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','groupId','docId'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean')
    or (p_scope ? 'groupId' and (jsonb_typeof(p_scope->'groupId')<>'string' or p_scope->>'groupId'=''))
    or (p_scope ? 'docId' and (jsonb_typeof(p_scope->'docId')<>'string' or p_scope->>'docId'='')) then raise exception 'HOME_SCOPE_INVALID'; end if;
  with scoped_reqs as materialized (select r.* from app_private.report_requisitions r where app_private.can_read_requisition(r.doc_id)
    and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
    and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
    and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
    and (not (p_scope ? 'docId') or r.doc_id=p_scope->>'docId')
    and (not (p_scope ? 'groupId') or exists(select 1 from app_private.report_document_groups exact_link where exact_link.doc_id=r.doc_id and exact_link.group_id=p_scope->>'groupId'))),
  req_metrics as (select r.doc_id,r.is_priority,r.status,r.head_count,r.pr_approved_date,r.created_at,r.updated_at,r.site,r.department,r.position,r.level,r.person_in_charge,r.request_type,
      greatest(r.head_count-coalesce(o.accepted_count,0),0)::integer open_headcount,coalesce(o.accepted_count,0)::integer accepted_count,
      coalesce(c.candidate_count,0)::integer candidate_count,coalesce(g.group_ids,'{}'::text[]) group_ids
    from scoped_reqs r
    left join lateral (select count(*)::integer accepted_count from app_private.report_offers x where x.doc_id=r.doc_id and x.accepted_date is not null and x.start_confirmation is distinct from 'did_not_start' and app_private.can_read_application(x.application_id)) o on true
    left join lateral (select count(distinct a.application_id)::integer candidate_count from app_private.report_document_groups d join app_private.report_candidate_applications a on a.group_id=d.group_id and app_private.can_read_application(a.application_id) join app_private.report_candidates c on c.candidate_id=a.candidate_id and app_private.can_read_candidate(c.candidate_id) where d.doc_id=r.doc_id) c on true
    left join lateral (select array_agg(distinct d.group_id) filter(where d.group_id is not null) group_ids from app_private.report_document_groups d where d.doc_id=r.doc_id and (not (p_scope ? 'groupId') or d.group_id=p_scope->>'groupId')) g on true),
  visible_apps as materialized (select distinct a.application_id,a.candidate_id,a.group_id,c.name,c.nickname,to_jsonb(c)->>'phone_no' phone_no,to_jsonb(c)->>'candidate_folder_url' candidate_folder_url,(to_jsonb(a)->>'created_at')::timestamptz created_at,(to_jsonb(c)->>'updated_at')::timestamptz updated_at,c.channel
    from app_private.report_candidate_applications a join app_private.report_candidates c using(candidate_id)
    where app_private.can_read_application(a.application_id) and app_private.can_read_candidate(a.candidate_id)
      and (not (p_scope ? 'groupId') or a.group_id=p_scope->>'groupId')
      and exists(select 1 from app_private.report_document_groups d join scoped_reqs r using(doc_id) where d.group_id=a.group_id)),
  latest_apps as (select a.*,
      (select l.recruitment_process from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_process,
      (select l.result from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc limit 1) latest_result,
      (select l.log_date from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null order by case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 else 6 end desc,l.round desc,l.log_id desc limit 1) latest_log_date,
      (select o.accepted_date from app_private.report_offers o where o.application_id=a.application_id and o.accepted_date is not null order by o.accepted_date desc,o.offer_id desc limit 1) accepted_date
    from visible_apps a),
  candidate_rows as (select a.* from latest_apps a),
  authorized_candidates as materialized (
    select c.candidate_id,c.name,to_jsonb(c)->>'phone_no' phone_no,to_jsonb(c)->>'candidate_folder_url' candidate_folder_url
    from app_private.report_candidates c where app_private.can_read_candidate(c.candidate_id)
  ),
  candidate_match_keys as materialized (
    select candidate_id,'phone'::text match_kind,phone_no match_value from authorized_candidates where nullif(phone_no,'') is not null
    union all
    select candidate_id,'name',lower(btrim(name)) from authorized_candidates where name is not null
    union all
    select candidate_id,'folder',candidate_folder_url from authorized_candidates where nullif(candidate_folder_url,'') is not null
  ),
  duplicate_match_keys as materialized (
    select match_kind,match_value from candidate_match_keys group by match_kind,match_value having count(distinct candidate_id)>1
  ),
  duplicate_flags as materialized (
    select k.candidate_id,bool_or(k.match_kind='phone') has_phone,bool_or(k.match_kind='name') has_name,bool_or(k.match_kind='folder') has_folder
    from candidate_match_keys k join duplicate_match_keys d using(match_kind,match_value) group by k.candidate_id
  ),
  group_rows as (select d.group_id,pg.group_position,coalesce(sum(r.open_headcount),0)::integer open_headcount,
      array_agg(distinct r.doc_id order by r.doc_id) doc_ids,max(u.updated_at) latest_update,
      array_agg(distinct r.site) sites,string_agg(distinct r.person_in_charge,', ') owners
    from app_private.report_document_groups d join req_metrics r on d.doc_id=r.doc_id left join app_private.report_position_groups pg using(group_id)
    left join app_private.report_sourcing_weekly_updates u using(group_id) where r.status='ongoing' and (not (p_scope ? 'groupId') or d.group_id=p_scope->>'groupId') group by d.group_id,pg.group_position),
  issues as (
    select 'warning'::text severity,'candidate'::text entity,c.candidate_id entity_id,'Possible duplicate candidate'::text title,'Another record has the same phone, name, or folder URL.'::text detail,'Review candidate'::text action_label,
      '/candidates?detailType=candidate&detailId='||c.candidate_id href,'duplicateCandidate'::text workspace_code,
      jsonb_build_object('fields',concat_ws(',',case when d.has_phone then 'phone' end,case when d.has_name then 'name' end,case when d.has_folder then 'folder' end)) workspace_params,c.application_id::text journey_id
    from candidate_rows c join duplicate_flags d using(candidate_id)
    union all select 'info','candidate',c.candidate_id,'Candidate has no activity','Candidate has been created but has no process update.','Start process','/pipeline?detailType=candidate&detailId='||c.candidate_id,'candidateNoActivity',jsonb_build_object('days',v_today-c.created_at::date),c.application_id::text
      from candidate_rows c where c.latest_process is null and c.created_at is not null and v_today-c.created_at::date>2
    union all select 'warning','candidate',c.candidate_id,'Candidate linked to closed requisition',closed.doc_id||' is '||closed.status||'.','Review match','/workspace?type=requisition&id='||closed.doc_id,'candidateClosedRequest',jsonb_build_object('docId',closed.doc_id),c.application_id::text||':'||closed.doc_id
      from candidate_rows c join lateral (select r.doc_id,r.status from app_private.report_document_groups d join scoped_reqs r using(doc_id) where d.group_id=c.group_id and r.status<>'ongoing' order by r.doc_id limit 1) closed on true
      where c.latest_result is distinct from 0 and c.accepted_date is null
    union all select 'warning','requisition',r.doc_id,'Accepted offers meet headcount','Requisition is still ongoing even though accepted offers meet requested headcount.','Review status','/workspace?type=requisition&id='||r.doc_id,'headcountFilled','{}'::jsonb,r.doc_id::text from req_metrics r where r.status='ongoing' and r.open_headcount<=0
    union all select 'warning','requisition',r.doc_id,'Open headcount without candidates','No candidates are linked to this open requisition.','Add candidate','/workspace?type=requisition&id='||r.doc_id,'headcountNoCandidates',jsonb_build_object('open',r.open_headcount),r.doc_id::text from req_metrics r where r.status='ongoing' and r.open_headcount>0 and r.candidate_count=0
    union all select 'info','requisition',r.doc_id,'Sourcing update is stale','Open requisition has no sourcing update saved in the last 14 days.','Update sourcing','/workspace?type=requisition&id='||r.doc_id,'requisitionSourcingStale','{}'::jsonb,r.doc_id::text
      from req_metrics r where r.status='ongoing' and r.open_headcount>0 and cardinality(r.group_ids)>0 and not exists(select 1 from app_private.report_sourcing_weekly_updates u where u.group_id=any(r.group_ids) and (v_today-(u.updated_at at time zone 'Asia/Bangkok')::date)<=14)
    union all select 'warning','offer',o.offer_id::text,'Accepted offer missing first working date','Accepted offers need a first working date for follow-up and reporting.','Review offer','/offers?offerSearch='||o.candidate_id,'offerMissingStart',jsonb_build_object('candidateId',o.candidate_id),o.offer_id::text
      from app_private.report_offers o join app_private.report_candidates c on c.candidate_id=o.candidate_id and app_private.can_read_candidate(c.candidate_id) where (o.application_id is null or app_private.can_read_application(o.application_id)) and exists(select 1 from scoped_reqs r where r.doc_id=o.doc_id) and o.accepted_date is not null and o.first_working_date is null
    union all select 'warning','offer',o.offer_id::text,'New hire confirmation due','Confirm whether the candidate started work on the first working date.','Confirm start','/home','startConfirmationDue',jsonb_build_object('candidateId',o.candidate_id),o.offer_id::text
      from app_private.report_offers o join app_private.report_candidates c on c.candidate_id=o.candidate_id and app_private.can_read_candidate(c.candidate_id) where (o.application_id is null or app_private.can_read_application(o.application_id)) and exists(select 1 from scoped_reqs r where r.doc_id=o.doc_id) and o.accepted_date is not null and o.first_working_date is not null and o.start_confirmation is null and o.first_working_date<=v_today
    union all select 'info','offer',o.offer_id::text,'Offer may fill requisition','Accepted offers meet requested headcount while requisition remains ongoing.','Review requisition','/workspace?type=requisition&id='||o.doc_id,'offerFillsRequest',jsonb_build_object('docId',o.doc_id),o.offer_id::text
      from app_private.report_offers o join app_private.report_candidates c on c.candidate_id=o.candidate_id and app_private.can_read_candidate(c.candidate_id) join req_metrics r using(doc_id) where (o.application_id is null or app_private.can_read_application(o.application_id)) and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start' and r.status='ongoing' and r.accepted_count>=r.head_count
    union all select 'info','sourcing',g.group_id,'Sourcing group needs update','Open headcount exists but sourcing has not been updated in 14 days.','Update sourcing','/workspace?type=group&id='||g.group_id,'groupSourcingStale','{}'::jsonb,g.group_id::text
      from group_rows g where g.open_headcount>0 and (g.latest_update is null or v_today-(g.latest_update at time zone 'Asia/Bangkok')::date>14)
    union all select 'warning','pipeline',a.candidate_id,'Process history is out of order','A later log appears to move backward in the pipeline.','Review history','/candidates?detailType=candidate&detailId='||a.candidate_id,'pipelineOrder',jsonb_build_object('previous',bad.previous_stage,'later',bad.later_stage),a.application_id::text
      from candidate_rows a join lateral (with seq as (select l.recruitment_process,case l.recruitment_process when 'Resume Screening' then 1 when 'Phone Screen' then 2 when 'HR Interview' then 3 when 'Line Interview' then 4 when 'Test' then 5 when 'Reference Check' then 6 when 'Offer' then 7 else -1 end idx,row_number() over(order by l.log_date,l.log_id) rn
        from app_private.report_recruitment_logs l where l.application_id=a.application_id and l.superseded_at is null and l.superseded_by_stage_instance_id is null),ordered as (select *,max(idx) over(order by rn rows between unbounded preceding and 1 preceding) prior from seq where idx<>-1)
        select case when idx>=0 then (select recruitment_process from seq where idx=prior and rn<ordered.rn order by rn desc limit 1) else null end previous_stage,recruitment_process later_stage from ordered where prior>idx and recruitment_process<>'Test' order by rn limit 1) bad on true
  ),
  ranked as (select i.*,case severity when 'blocking' then 3 when 'warning' then 2 else 1 end severity_rank,(''||entity||':'||entity_id||':'||title) issue_id,(''||entity||':'||entity_id||':'||title||':'||coalesce(journey_id,'')) cursor_id,
      jsonb_build_object('id',entity||':'||entity_id||':'||title,'cursorId',entity||':'||entity_id||':'||title||':'||coalesce(journey_id,''),'severity',severity,'entity',entity,'entityId',entity_id,'title',title,'detail',detail,'actionLabel',action_label,'href',href,'workspaceCode',workspace_code,'workspaceParams',workspace_params) dto from issues i),
  counted as (select count(*)::integer total_count from ranked),
  page as (select * from ranked where p_after_severity is null or severity_rank<p_after_severity or (severity_rank=p_after_severity and (title>p_after_title or (title=p_after_title and cursor_id>p_after_id))) order by severity_rank desc,title,cursor_id limit p_limit+1),
  limited as (select * from page order by severity_rank desc,title,cursor_id limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(dto order by severity_rank desc,title,cursor_id) from limited),'[]'::jsonb),'totalCount',counted.total_count,'hasMore',exists(select 1 from page offset p_limit),
    'nextCursor',case when exists(select 1 from page offset p_limit) then (select jsonb_build_object('severity',severity_rank,'title',title,'id',cursor_id) from limited order by severity_rank asc,title desc,cursor_id desc limit 1) else null end)
    into v_result from counted;
  return v_result;
end $$;

create or replace function public.app_dashboard_active_requisitions_page_v1(
  p_start date,p_end date,p_period text,p_stage_mode text,p_scope jsonb default '{}'::jsonb,
  p_after_value text default null,p_after_id text default null,p_limit integer default 25,
  p_search text default '',p_filters jsonb default '{}'::jsonb,p_sort text default null,p_direction text default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_needs_metric_membership boolean; v_sort text:=coalesce(nullif(p_sort,''),'report'); v_direction text:=lower(coalesce(nullif(p_direction,''),'asc'));
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or p_period not in ('mtd','ytd','pim','custom') then raise exception 'REPORT_RANGE_INVALID'; end if;
  if p_stage_mode not in ('status','activity','accum') then raise exception 'REPORT_STAGE_MODE_INVALID'; end if;
  if p_limit is null or p_limit not in (25,50) then raise exception 'REPORT_PAGE_LIMIT_INVALID'; end if;
  if (p_after_value is null)<>(p_after_id is null) then raise exception 'REPORT_CURSOR_INVALID'; end if;
  if p_search is null or length(p_search)>200 or jsonb_typeof(coalesce(p_filters,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_filters,'{}'::jsonb)) k where k not in ('site','department','section','position','level','vacancy','request_type','requisition_date','person_in_charge','status','detail','applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer','actual_age','sla','filled_date'))
    or exists(select 1 from jsonb_each(coalesce(p_filters,'{}'::jsonb)) f where jsonb_typeof(f.value)<>'string' or length(f.value #>> '{}')>200) then raise exception 'REPORT_FILTER_INVALID'; end if;
  if v_direction not in ('asc','desc') or v_sort not in ('report','site','department','section','position','level','vacancy','request_type','requisition_date','person_in_charge','status','detail','applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer','actual_age','sla','filled_date') then raise exception 'REPORT_SORT_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'REPORT_SCOPE_INVALID'; end if;
  v_needs_metric_membership := p_search<>'' or exists(select 1 from jsonb_each_text(coalesce(p_filters,'{}'::jsonb)) f where f.key in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and f.value<>'');
  with base as materialized (
    select r.doc_id,r.site,r.department,r.section,r.position,r.level,r.head_count,r.request_type,r.status,r.person_in_charge,r.pr_approved_date,r.is_priority
    from app_private.report_requisitions r where app_private.can_read_requisition(r.doc_id)
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band) where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(btrim(r.level) from '([0-9]+)$')::int between split_part(x.band,'-',1)::int and split_part(x.band,'-',2)::int))
  ), evaluated as materialized (
    select b.*,
      (select l.status from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) last_status,
      (select l.remark from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) last_remark,
      (select l.log_date from app_private.report_requisition_logs l where l.doc_id=b.doc_id and l.status='filled' and l.log_date<=p_end order by l.log_date desc,l.log_id desc limit 1) logged_filled,
      exists(select 1 from app_private.report_requisition_logs l where l.doc_id=b.doc_id) has_logs,
      coalesce((select count(*) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date<p_end+1 and (o.start_confirmation is distinct from 'did_not_start' or o.start_confirmed_at is null or (o.start_confirmed_at at time zone 'UTC')::date>=p_end+1)),0)::integer covered_end,
      (select max(o.accepted_date) from app_private.report_offers o where o.doc_id=b.doc_id and o.accepted_date<=p_end and
        (select count(*) from app_private.report_offers q where q.doc_id=b.doc_id and q.accepted_date<o.accepted_date+1 and (q.start_confirmation is distinct from 'did_not_start' or q.start_confirmed_at is null or (q.start_confirmed_at at time zone 'UTC')::date>=o.accepted_date+1))>=b.head_count) offer_filled
    from base b
  ), eligible0 as (
    select e.*,case when e.offer_filled is not null or e.last_status='filled' then 'filled' else 'ongoing' end period_status,
      case when e.covered_end>=e.head_count then e.offer_filled when e.last_status='filled' then e.logged_filled else null end filled_date,
      coalesce(e.pr_approved_date,'9999-12-31'::date) req_date,
      coalesce((select max((o.start_confirmed_at at time zone 'UTC')::date) from app_private.report_offers o where o.doc_id=e.doc_id and o.start_confirmation='did_not_start' and o.start_confirmed_at is not null),e.pr_approved_date) sla_start,
      case when nullif(substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)'), '') is null then null
        when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 0 and 6 then 30
        when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 7 and 9 then 45
        when substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 10 and 14 then 60 else null end sla_days
    from evaluated e
  ), eligible as materialized (
    select e.* from eligible0 e where e.req_date<=p_end and e.last_status is distinct from 'cancel'
      and not (not e.has_logs and e.status='cancel')
      and (case when e.covered_end>=e.head_count then e.offer_filled when e.last_status='filled' then e.logged_filled else null end is null
        or case when e.covered_end>=e.head_count then e.offer_filled when e.last_status='filled' then e.logged_filled else null end>=p_start)
      and (p_period in ('pim','custom') or (case when nullif(substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)'), '') is not null and substring(regexp_replace(btrim(coalesce(e.level,'')),'^L','','i') from '^([+-]?[0-9]+)')::integer between 0 and 14 then case when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=6 then 30 when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=9 then 45 else 60 end end is not null and e.pr_approved_date+(case when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=6 then 30 when substring(regexp_replace(btrim(e.level),'^L','','i') from '^([+-]?[0-9]+)')::integer<=9 then 45 else 60 end)>=p_start))
  ), cheap_rows as (
    select e.*,
      case v_sort when 'site' then lower(e.site) when 'department' then lower(e.department) when 'section' then lower(coalesce(e.section,'')) when 'position' then lower(e.position)
        when 'level' then lower(coalesce(e.level,'')) when 'vacancy' then lpad(e.head_count::text,12,'0') when 'request_type' then lower(coalesce(e.request_type,''))
        when 'requisition_date' then e.req_date::text when 'person_in_charge' then lower(coalesce(e.person_in_charge,''))
        when 'status' then case e.period_status when 'ongoing' then '0-ongoing' else '1-filled' end when 'detail' then lower(coalesce(e.last_remark,''))
        when 'actual_age' then lpad(greatest((timezone('Asia/Bangkok',now())::date-e.req_date),0)::text,12,'0')
        when 'sla' then lpad(greatest((coalesce(case when e.period_status='filled' then e.filled_date end,p_end)-e.sla_start),0)::text,12,'0')
        when 'filled_date' then coalesce(e.filled_date::text,'9999-12-31')
        else concat(e.site,chr(31),case when e.period_status='ongoing' then '0' else '1' end,chr(31),coalesce(e.filled_date::text,'9999-12-31'),chr(31),e.req_date::text) end sort_value
    from eligible e
  ), base_matches as materialized (
    select r.* from cheap_rows r where true
      and (coalesce((p_filters->>'site'),'')='' or r.site ilike '%'||(p_filters->>'site')||'%')
      and (coalesce((p_filters->>'department'),'')='' or r.department ilike '%'||(p_filters->>'department')||'%')
      and (coalesce((p_filters->>'section'),'')='' or coalesce(r.section,'-') ilike '%'||(p_filters->>'section')||'%')
      and (coalesce((p_filters->>'position'),'')='' or r.position ilike '%'||(p_filters->>'position')||'%')
      and (coalesce((p_filters->>'level'),'')='' or coalesce(r.level,'-') ilike '%'||(p_filters->>'level')||'%')
      and (coalesce((p_filters->>'vacancy'),'')='' or r.head_count::text ilike '%'||(p_filters->>'vacancy')||'%')
      and (coalesce((p_filters->>'request_type'),'')='' or case lower(btrim((p_filters->>'request_type'))) when 'new' then r.request_type='New' when 'อัตราใหม่' then r.request_type='New' when 'replacement' then r.request_type='Replacement' when 'ทดแทน' then r.request_type='Replacement' else r.request_type ilike '%'||(p_filters->>'request_type')||'%' end)
      and (coalesce((p_filters->>'requisition_date'),'')='' or concat_ws(' ',r.req_date::text,to_char(r.req_date,'DD/MM/YYYY')) ilike '%'||(p_filters->>'requisition_date')||'%')
      and (coalesce((p_filters->>'person_in_charge'),'')='' or coalesce(r.person_in_charge,'-') ilike '%'||(p_filters->>'person_in_charge')||'%')
      and (coalesce((p_filters->>'status'),'')='' or case lower(btrim((p_filters->>'status'))) when 'ongoing' then r.period_status='ongoing' when 'กำลังดำเนินการ' then r.period_status='ongoing' when 'filled' then r.period_status='filled' when 'ครบแล้ว' then r.period_status='filled' else concat_ws(' ',r.period_status,r.site,r.department) ilike '%'||(p_filters->>'status')||'%' end)
      and (coalesce((p_filters->>'detail'),'')='' or coalesce(r.last_remark,'-') ilike '%'||(p_filters->>'detail')||'%')
      and (coalesce((p_filters->>'actual_age'),'')='' or greatest((timezone('Asia/Bangkok',now())::date-r.req_date),0)::text ilike '%'||replace((p_filters->>'actual_age'),'d','')||'%')
      and (coalesce((p_filters->>'sla'),'')='' or (case when r.sla_start is null or r.sla_days is null then '-' else (case when greatest((coalesce(case when r.period_status='filled' then r.filled_date end,p_end)-r.sla_start),0)<=r.sla_days then 'In SLA อยู่ใน SLA' else 'Over SLA เกิน SLA' end)||' ('||greatest((coalesce(case when r.period_status='filled' then r.filled_date end,p_end)-r.sla_start),0)||'d)' end) ilike '%'||(p_filters->>'sla')||'%')
      and (coalesce((p_filters->>'filled_date'),'')='' or concat_ws(' ',coalesce(r.filled_date::text,'-'),coalesce(to_char(r.filled_date,'DD/MM/YYYY'),'-'),coalesce(to_char(r.filled_date,'Mon DD, YYYY'),'-')) ilike '%'||(p_filters->>'filled_date')||'%')
  ), enrichment_keys as materialized (
    select doc_id from base_matches where v_needs_metric_membership or v_sort in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
    union all
    select doc_id from (
      select doc_id from base_matches r where not v_needs_metric_membership and v_sort not in ('applicants','Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') and (case when v_sort='report' or v_direction='asc' then p_after_value is null or r.sort_value>p_after_value or (r.sort_value=p_after_value and r.doc_id>p_after_id)
        else p_after_value is null or r.sort_value<p_after_value or (r.sort_value=p_after_value and r.doc_id>p_after_id) end)
      order by case when v_direction='asc' then sort_value end asc,case when v_direction='desc' then sort_value end desc,doc_id asc limit p_limit+1
    ) page_keys
  ), stage_apps as materialized (
    select distinct k.doc_id,d.group_id,ca.application_id,ca.candidate_id
    from enrichment_keys k join app_private.report_document_groups d using(doc_id)
    join lateral (select a.application_id,a.candidate_id from app_private.report_candidate_applications a where a.group_id=d.group_id offset 0) ca on true
  ), allowed_stage_applications as materialized (
    select application_id from (select distinct application_id from stage_apps) a
    where app_private.can_read_application(a.application_id)
  ), allowed_stage_candidates as materialized (
    select c.candidate_id from (select distinct candidate_id from stage_apps join allowed_stage_applications using(application_id)) k
    join app_private.report_candidates c using(candidate_id) where app_private.can_read_candidate(c.candidate_id)
  ), stage_counts as (
    select e.doc_id,l.recruitment_process,count(distinct case when p_stage_mode='status' then ca.application_id::text else l.candidate_id end)::integer n
    from stage_apps ca join allowed_stage_applications aa using(application_id) join base_matches e using(doc_id)
    join allowed_stage_candidates c on c.candidate_id=ca.candidate_id
    join app_private.report_recruitment_logs l on l.candidate_id=c.candidate_id and l.application_id=ca.application_id
    left join app_private.report_candidate_application_assignments a on a.assignment_id=case when l.result is null then l.entry_assignment_id else l.outcome_assignment_id end and a.application_id=ca.application_id
    where l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (p_stage_mode='status' or a.group_id=ca.group_id or a.assignment_id is null)
      and case p_stage_mode when 'activity' then (case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end) between p_start and p_end
        when 'accum' then l.superseded_at is null and l.log_date between coalesce(e.pr_approved_date,p_end) and p_end
        else l.log_date<=p_end and (l.outcome_date is null or l.outcome_date>p_end or l.result is null)
          and not exists(select 1 from app_private.report_recruitment_logs newer where newer.application_id=ca.application_id and newer.candidate_id=c.candidate_id
            and newer.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
            and newer.log_date<=p_end and (newer.outcome_date is null or newer.outcome_date>p_end or newer.result is null)
            and (newer.log_date>l.log_date or (newer.log_date=l.log_date and newer.log_id>l.log_id))) end
    group by e.doc_id,l.recruitment_process
  ), stage_pivot as materialized (
    select doc_id,
      coalesce(max(n) filter(where recruitment_process='Phone Screen'),0)::integer phone_screen,
      coalesce(max(n) filter(where recruitment_process='HR Interview'),0)::integer hr_interview,
      coalesce(max(n) filter(where recruitment_process='Line Interview'),0)::integer line_interview,
      coalesce(max(n) filter(where recruitment_process='Test'),0)::integer test_count,
      coalesce(max(n) filter(where recruitment_process='Reference Check'),0)::integer reference_check,
      coalesce(max(n) filter(where recruitment_process='Offer'),0)::integer offer_count
    from stage_counts group by doc_id
  ), rows as (
    select e.*, coalesce(metric_sort.value,e.sort_value) as report_sort_value,
      coalesce(st.phone_screen,0)::integer phone_screen,coalesce(st.hr_interview,0)::integer hr_interview,coalesce(st.line_interview,0)::integer line_interview,
      coalesce(st.test_count,0)::integer test_count,coalesce(st.reference_check,0)::integer reference_check,coalesce(st.offer_count,0)::integer offer_count,
      coalesce(src.applicants,0)::integer applicant_count,coalesce(src.channel_fb,0)::integer channel_fb,coalesce(src.channel_jobthai,0)::integer channel_jobthai,
      coalesce(src.channel_jobtopgun,0)::integer channel_jobtopgun,coalesce(src.channel_jobdb,0)::integer channel_jobdb,coalesce(src.channel_jobbkk,0)::integer channel_jobbkk,
      coalesce(src.channel_linkedin,0)::integer channel_linkedin,coalesce(src.channel_walkin,0)::integer channel_walkin,coalesce(src.channel_referral,0)::integer channel_referral,coalesce(src.channel_others,0)::integer channel_others
    from enrichment_keys k join base_matches e using(doc_id) left join stage_pivot st using(doc_id) left join lateral (
      select sum(coalesce(u.applicants_fb,0)+coalesce(u.applicants_jobthai,0)+coalesce(u.applicants_jobtopgun,0)+coalesce(u.applicants_jobdb,0)+coalesce(u.applicants_jobbkk,0)+coalesce(u.applicants_linkedin,0)+coalesce(u.applicants_walkin,0)+coalesce(u.applicants_referral,0)+coalesce(u.applicants_others,0))::integer applicants,
        sum(coalesce(u.applicants_fb,0))::integer channel_fb,sum(coalesce(u.applicants_jobthai,0))::integer channel_jobthai,sum(coalesce(u.applicants_jobtopgun,0))::integer channel_jobtopgun,sum(coalesce(u.applicants_jobdb,0))::integer channel_jobdb,
        sum(coalesce(u.applicants_jobbkk,0))::integer channel_jobbkk,sum(coalesce(u.applicants_linkedin,0))::integer channel_linkedin,sum(coalesce(u.applicants_walkin,0))::integer channel_walkin,sum(coalesce(u.applicants_referral,0))::integer channel_referral,sum(coalesce(u.applicants_others,0))::integer channel_others
      from app_private.report_document_groups d join app_private.report_sourcing_weekly_updates u on u.group_id=d.group_id
      where d.doc_id=e.doc_id and u.week_start between p_start and p_end and app_private.can_read_sourcing_group(u.group_id)
    ) src on true
    cross join lateral (select case v_sort
      when 'applicants' then lpad(coalesce(src.applicants,0)::text,12,'0')
      when 'Phone Screen' then lpad(coalesce(st.phone_screen,0)::text,12,'0')
      when 'HR Interview' then lpad(coalesce(st.hr_interview,0)::text,12,'0')
      when 'Line Interview' then lpad(coalesce(st.line_interview,0)::text,12,'0')
      when 'Test' then lpad(coalesce(st.test_count,0)::text,12,'0')
      when 'Reference Check' then lpad(coalesce(st.reference_check,0)::text,12,'0')
      when 'Offer' then lpad(coalesce(st.offer_count,0)::text,12,'0') end value) metric_sort
  ), matched as materialized (
    select r.* from rows r where true
      and (coalesce(p_search,'')='' or concat_ws(' ',r.doc_id,r.site,r.department,r.section,r.position,r.level,r.head_count,r.request_type,r.req_date,r.person_in_charge,r.period_status,r.last_remark,r.applicant_count,r.phone_screen,r.hr_interview,r.line_interview,r.test_count,r.reference_check,r.offer_count,r.filled_date) ilike '%'||btrim(p_search)||'%')
      and (coalesce((p_filters->>'applicants'),'')='' or r.applicant_count::text ilike '%'||(p_filters->>'applicants')||'%')
      and (coalesce((p_filters->>'Phone Screen'),'')='' or r.phone_screen::text ilike '%'||(p_filters->>'Phone Screen')||'%')
      and (coalesce((p_filters->>'HR Interview'),'')='' or r.hr_interview::text ilike '%'||(p_filters->>'HR Interview')||'%')
      and (coalesce((p_filters->>'Line Interview'),'')='' or r.line_interview::text ilike '%'||(p_filters->>'Line Interview')||'%')
      and (coalesce((p_filters->>'Test'),'')='' or r.test_count::text ilike '%'||(p_filters->>'Test')||'%')
      and (coalesce((p_filters->>'Reference Check'),'')='' or r.reference_check::text ilike '%'||(p_filters->>'Reference Check')||'%')
      and (coalesce((p_filters->>'Offer'),'')='' or r.offer_count::text ilike '%'||(p_filters->>'Offer')||'%')
  ), page_raw as (
    select * from matched r where (case when v_sort='report' or v_direction='asc' then p_after_value is null or r.report_sort_value>p_after_value or (r.report_sort_value=p_after_value and r.doc_id>p_after_id)
        else p_after_value is null or r.report_sort_value<p_after_value or (r.report_sort_value=p_after_value and r.doc_id>p_after_id) end)
    order by case when v_direction='asc' then report_sort_value end asc,case when v_direction='desc' then report_sort_value end desc,doc_id asc limit p_limit+1
  ), page_rows as (
    select * from page_raw order by case when v_direction='asc' then report_sort_value end asc,case when v_direction='desc' then report_sort_value end desc,doc_id asc limit p_limit
  ), counted as (
    select case when v_needs_metric_membership then (select count(*) from matched) else (select count(*) from base_matches) end::integer total
  ),
  page_info as (select count(*)>p_limit more from page_raw)
  select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('doc_id',p.doc_id,'site',p.site,'department',p.department,'section',p.section,'position',p.position,'level',coalesce(p.level,'-'),'vacancy',p.head_count,
      'applicant_count',p.applicant_count,'applicant_channels',jsonb_build_object('applicants_fb',p.channel_fb,'applicants_jobthai',p.channel_jobthai,'applicants_jobtopgun',p.channel_jobtopgun,'applicants_jobdb',p.channel_jobdb,'applicants_jobbkk',p.channel_jobbkk,'applicants_linkedin',p.channel_linkedin,'applicants_walkin',p.channel_walkin,'applicants_referral',p.channel_referral,'applicants_others',p.channel_others),
      'request_type',p.request_type,'requisition_date',p.req_date,'actual_age_days',greatest((timezone('Asia/Bangkok',now())::date-p.req_date),0),'person_in_charge',coalesce(p.person_in_charge,'-'),
      'stage_counts',jsonb_build_object('Phone Screen',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Phone Screen'),0),'HR Interview',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='HR Interview'),0),'Line Interview',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Line Interview'),0),'Test',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Test'),0),'Reference Check',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Reference Check'),0),'Offer',coalesce((select n from stage_counts s where s.doc_id=p.doc_id and s.recruitment_process='Offer'),0)),
      'sla_state',jsonb_build_object('ageDays',case when p.sla_start is null then null else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0) end,
        'endDate',coalesce(case when p.period_status='filled' then p.filled_date end,p_end),'inSla',case when p.sla_start is null or p.sla_days is null then null else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)<=p.sla_days end,
        'isOverdue',case when p.sla_start is null or p.sla_days is null then false else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)>p.sla_days end,
        'label',case when p.sla_start is null or p.sla_days is null then '-' else greatest((coalesce(case when p.period_status='filled' then p.filled_date end,p_end)-p.sla_start),0)||'d / '||p.sla_days||'d' end,
        'slaDays',p.sla_days,'startDate',p.sla_start),
      'filled_date',p.filled_date,'period_status',p.period_status,'period_detail',p.last_remark) order by case when v_direction='asc' then p.report_sort_value end asc,case when v_direction='desc' then p.report_sort_value end desc,p.doc_id asc) from page_rows p),'[]'::jsonb),
    'total',(select total from counted),'hasMore',(select more from page_info),
    'nextCursor',case when (select more from page_info) then (select jsonb_build_object('value',report_sort_value,'id',doc_id) from page_rows order by case when v_direction='asc' then report_sort_value end desc,case when v_direction='desc' then report_sort_value end asc,doc_id desc limit 1) else null end)
  into v_result;
  return v_result;
end $$;

create or replace function public.app_dashboard_active_requisition_candidates_v1(
  p_doc_id text,p_stage text,p_start date,p_end date,p_requisition_date date,p_stage_mode text,
  p_after_name text default null,p_after_application_id uuid default null,p_limit integer default 25
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if not app_private.can_read_requisition(p_doc_id) then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if nullif(btrim(p_doc_id),'') is null or p_start is null or p_end is null or p_start>p_end or p_stage not in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') or p_stage_mode not in ('status','activity','accum') then raise exception 'REPORT_DRILLDOWN_INVALID'; end if;
  if p_limit is null or p_limit not in (1,25,50) or (p_after_name is null)<>(p_after_application_id is null) then raise exception 'REPORT_CURSOR_INVALID'; end if;
  with doc_groups as materialized(select d.doc_group_id,d.group_id from app_private.report_document_groups d where d.doc_id=p_doc_id and d.group_id is not null), candidates as (
    select distinct ca.application_id,c.candidate_id,c.name,coalesce(ca.group_id,c.group_id) group_id
    from doc_groups d join app_private.report_candidate_applications ca on ca.group_id=d.group_id
    join app_private.report_candidates c on c.candidate_id=ca.candidate_id and app_private.can_read_candidate(c.candidate_id)
    where app_private.can_read_application(ca.application_id)
  ), matching as (
    select c.application_id,c.candidate_id,c.name,l.log_id,l.log_date,l.outcome_date,l.result,l.outcome_remark,l.remark,
      row_number() over(partition by c.application_id order by case when p_stage_mode='accum' then l.log_date end asc,case when p_stage_mode='accum' then l.log_id end asc,
        case when p_stage_mode='status' then l.log_date end desc,case when p_stage_mode='status' then l.log_id end desc,l.log_id asc) rn
    from candidates c join app_private.report_recruitment_logs l on l.candidate_id=c.candidate_id and l.application_id=c.application_id
    left join app_private.report_candidate_application_assignments a on a.assignment_id=case when l.result is null then l.entry_assignment_id else l.outcome_assignment_id end and a.application_id=c.application_id
    where l.recruitment_process=p_stage and l.superseded_at is null
      and (a.group_id=c.group_id or a.assignment_id is null)
      and case p_stage_mode when 'activity' then (case when l.result=1 then coalesce(l.outcome_date,l.log_date) else l.log_date end) between p_start and p_end
        when 'accum' then p_requisition_date is not null and l.log_date between p_requisition_date and p_end
        else l.log_date<=p_end and (l.outcome_date is null or l.outcome_date>p_end or l.result is null) end
  ), selected as (select * from matching m where m.rn=1 and (p_after_name is null or (m.name,m.application_id)>(p_after_name,p_after_application_id))), page_raw as (
    select * from selected order by name,application_id limit p_limit+1
  ), page_rows as (select * from page_raw order by name,application_id limit p_limit), total as (select count(*)::integer n from matching where rn=1), page_info as (select count(*)>p_limit more from page_raw)
  select jsonb_build_object('matches',coalesce((select jsonb_agg(jsonb_build_object('applicationId',application_id,'candidateId',candidate_id,'name',name,'stage',p_stage,'pendingDate',log_date,'resultDate',outcome_date,'remark',coalesce(outcome_remark,remark),'result',result) order by name,application_id) from page_rows),'[]'::jsonb),
    'total',(select n from total),'hasMore',(select more from page_info),'nextCursor',case when (select more from page_info) then (select jsonb_build_object('name',name,'applicationId',application_id) from page_rows order by name desc,application_id desc limit 1) else null end)
  into v_result;
  return v_result;
end $$;

create or replace function public.app_home_core_summary_v1(p_scope jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb; v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid()) or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string') or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'HOME_SCOPE_INVALID'; end if;
  with scope_reqs as materialized (
    select r.doc_id,r.is_priority,r.head_count,r.status,r.site,r.person_in_charge
    from app_private.report_requisitions r where (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(p_scope->>'headerPic'))
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
      and app_private.can_read_requisition(r.doc_id)
  ), offer_totals as (
    select o.doc_id,count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') as accepted
    from app_private.report_offers o join scope_reqs r using(doc_id) group by o.doc_id
  ), req as (
    select r.doc_id,r.is_priority,r.head_count,r.status,greatest(r.head_count-coalesce(o.accepted,0),0) as open_headcount
    from scope_reqs r left join offer_totals o using(doc_id) where r.status not in ('filled','cancel')
  ), scope_apps as materialized (
    select a.application_id,a.candidate_id,a.group_id,a.state from app_private.report_candidate_applications a
    join app_private.report_candidates c on c.candidate_id=a.candidate_id and app_private.can_read_candidate(c.candidate_id)
    where app_private.can_read_application(a.application_id)
      and exists(select 1 from app_private.report_document_groups d join scope_reqs r using(doc_id) where d.group_id=a.group_id)
  ), active_apps as (
    select a.application_id,a.candidate_id,a.group_id from scope_apps a
    where a.state='active'
      and exists(select 1 from app_private.report_document_groups d join req r using(doc_id) where d.group_id=a.group_id)
  ), latest as (
    select distinct on (l.application_id) l.application_id,l.candidate_id,l.recruitment_process,l.result,l.estimated_action_date,l.log_id
    from app_private.report_recruitment_logs l join active_apps a using(application_id)
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,l.round desc,l.log_id desc
  ), pipeline as (
    select recruitment_process as stage,count(*)::integer as count from latest
    where result is distinct from 0 and recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and not exists(select 1 from app_private.report_offers o where o.candidate_id=latest.candidate_id)
    group by recruitment_process
  ), pending as (
    select count(distinct (a.candidate_id,l.application_id))::integer as all_pending,
      count(distinct (a.candidate_id,l.application_id)) filter(where l.estimated_action_date<v_today)::integer as overdue
    from app_private.report_recruitment_logs l join active_apps a using(application_id)
    where l.result is null and l.superseded_at is null and l.superseded_by_stage_instance_id is null
  ), week as (select max(week_start) as latest_week from app_private.report_sourcing_weekly_updates),
  open_groups as (select distinct d.group_id from app_private.report_document_groups d join req r using(doc_id) where r.open_headcount>0),
  stale as (select count(*)::integer as n from open_groups g where not exists(select 1 from app_private.report_sourcing_weekly_updates u where u.group_id=g.group_id and (u.updated_at at time zone 'Asia/Bangkok')::date > v_today-6)),
  req_totals as (select count(*) filter(where open_headcount>0)::integer as open,count(*) filter(where open_headcount>0 and is_priority)::integer as priority_open from req)
  select jsonb_build_object('requisitions',jsonb_build_object('open',req_totals.open,'priorityOpen',req_totals.priority_open),
    'candidatePipeline',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'count',count) order by case stage when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 else 6 end) from pipeline),'[]'::jsonb),
    'sourcing',jsonb_build_object('staleGroups',stale.n,'latestWeek',week.latest_week),
    'needsAction',jsonb_build_object('pendingCandidates',pending.all_pending,'overduePending',pending.overdue),
    'counts',jsonb_build_object('openRequisitions',req_totals.open,'activePipeline',coalesce((select sum(count) from pipeline),0),'staleSourcing',stale.n,
      'pendingOffers',(select count(*)::integer from app_private.report_offers o join scope_reqs r using(doc_id) where o.accepted_date is not null and o.first_working_date is not null and o.first_working_date<=v_today and o.start_confirmation is null and app_private.can_read_application(o.application_id))))
  into v_result from req_totals cross join stale cross join week cross join pending;
  return v_result;
end $$;

create or replace function public.app_dashboard_bottleneck_summary_v1(
  p_start date,p_end date,p_prior_start date,p_prior_end date,p_scope jsonb default '{}'::jsonb,p_channel text default 'all',p_trend_dates date[] default '{}'
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_as_of date; v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_start is null or p_end is null or p_start>p_end or ((p_prior_start is null)<>(p_prior_end is null)) or (p_prior_start is not null and p_prior_start>p_prior_end) then raise exception 'REPORT_RANGE_INVALID'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object' or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels')) then raise exception 'REPORT_SCOPE_INVALID'; end if;
  if cardinality(coalesce(p_trend_dates,'{}'::date[]))>8 or exists(select 1 from unnest(coalesce(p_trend_dates,'{}'::date[])) d where d<p_start or d>p_end) then raise exception 'REPORT_RANGE_INVALID'; end if;
  v_as_of:=least(p_end,(now() at time zone 'Asia/Bangkok')::date);
  if exists(select 1 from (select d,lag(d) over(order by ord) prev from unnest(coalesce(p_trend_dates,'{}'::date[])) with ordinality t(d,ord)) x where d is null or d<=prev) then raise exception 'REPORT_RANGE_INVALID'; end if;
  with authorized_candidates as materialized (
    select c.candidate_id,c.name,c.channel from app_private.report_candidates c where app_private.can_read_candidate(c.candidate_id)
  ), authorized_applications as materialized (
    select a.application_id,a.candidate_id,a.group_id from app_private.report_candidate_applications a where app_private.can_read_application(a.application_id)
  ), authorized_logs as materialized (
    select l.* from app_private.report_recruitment_logs l join authorized_candidates c on c.candidate_id=l.candidate_id
      left join authorized_applications a on a.application_id=l.application_id
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
      and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (l.application_id is null or a.application_id is not null)
  ), direct_rows as (
    select l.stage_instance_id::text attempt_id,l.application_id,l.candidate_id,l.recruitment_process stage,l.round,l.log_id,l.log_date entry_date,
      case when l.result is null then null else l.outcome_date end outcome_date,l.result,l.estimated_action_date due_date,
      (l.pending_edited_at at time zone 'Asia/Bangkok')::date edited_date,(l.record_origin='migration' and l.pending_edited_at is null) unreliable,false invalid_due,
      case when l.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(l.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when l.log_date is null then 'Missing or invalid entry date' when l.result is not null and l.outcome_date is null then 'Missing or invalid outcome date'
        when l.outcome_date is not null and l.outcome_date<l.log_date then 'Outcome precedes entry' else null end exclusion,l.entry_assignment_id,l.outcome_assignment_id
    from authorized_logs l where l.stage_instance_id is not null
  ), legacy_grouped as (
    select l.*,coalesce(sum(case when l.result is not null then 1 else 0 end) over(partition by l.application_id,l.recruitment_process,l.round order by l.log_date,l.log_id rows between unbounded preceding and 1 preceding),0)::integer pair_group
    from authorized_logs l where l.stage_instance_id is null
  ), pending_rows as (
    select l.*,row_number() over(partition by l.application_id,l.recruitment_process,l.round,l.pair_group order by l.log_date desc,l.log_id desc) pending_rank from legacy_grouped l where l.result is null
  ), outcome_rows as (
    select l.*,p.log_id pending_log_id,p.log_date pending_log_date,p.estimated_action_date pending_due,p.pending_edited_at pending_edited,p.record_origin pending_origin
    from legacy_grouped l left join lateral(select p.log_id,p.log_date,p.estimated_action_date,p.pending_edited_at,p.record_origin from pending_rows p
      where p.application_id=l.application_id and p.recruitment_process=l.recruitment_process and p.round=l.round and p.pair_group=l.pair_group order by p.log_date desc,p.log_id desc limit 1) p on true where l.result is not null
  ), paired_results as (
    select ('legacy-'||o.log_id::text) attempt_id,o.application_id,o.candidate_id,o.recruitment_process stage,o.round,o.log_id,o.pending_log_date entry_date,coalesce(o.outcome_date,o.log_date) outcome_date,o.result,
      coalesce(o.pending_due,o.estimated_action_date) due_date,(coalesce(o.pending_edited,o.pending_edited_at) at time zone 'Asia/Bangkok')::date edited_date,
      (coalesce(o.pending_origin,o.record_origin)='migration' and coalesce(o.pending_edited,o.pending_edited_at) is null) unreliable,false invalid_due,
      case when o.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(o.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when o.pending_log_date is null then 'Missing or invalid entry date'
        when coalesce(o.outcome_date,o.log_date) is null then 'Missing or invalid outcome date'
        when coalesce(o.outcome_date,o.log_date)<o.pending_log_date then 'Outcome precedes entry' else null end exclusion,o.entry_assignment_id,o.outcome_assignment_id from outcome_rows o
  ), standalone_pending as (
    select ('legacy-'||p.log_id::text) attempt_id,p.application_id,p.candidate_id,p.recruitment_process stage,p.round,p.log_id,p.log_date entry_date,null::date outcome_date,null::smallint result,
      p.estimated_action_date due_date,(p.pending_edited_at at time zone 'Asia/Bangkok')::date edited_date,(p.record_origin='migration' and p.pending_edited_at is null) unreliable,false invalid_due,
      case when p.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(p.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when p.log_date is null then 'Missing or invalid entry date' else null end exclusion,p.entry_assignment_id,p.outcome_assignment_id from pending_rows p
    where not exists(select 1 from outcome_rows o where o.application_id=p.application_id and o.recruitment_process=p.recruitment_process and o.round=p.round and o.pair_group=p.pair_group and o.pending_log_id=p.log_id)
  ), attempts as materialized (
    select a.*,case when a.exclusion is null and a.entry_date is not null and a.outcome_date is not null then a.outcome_date-a.entry_date end::integer duration
    from (select * from direct_rows union all select * from paired_results union all select * from standalone_pending) a
    ), scoped_req as materialized (
      select r.doc_id,r.site,r.department,r.position,r.person_in_charge,r.level,r.is_priority,r.head_count,r.status,r.created_at,r.pr_approved_date,dg.group_id
      from app_private.report_document_groups dg join app_private.report_requisitions r on r.doc_id=dg.doc_id
      where app_private.can_read_requisition(r.doc_id) and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
        and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
        and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
        and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
        and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
        and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band)
          where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(r.level from '([0-9]+)$')::integer between split_part(x.band,'-',1)::integer and split_part(x.band,'-',2)::integer))
    ), assignments as materialized (
      select aa.* from app_private.report_candidate_application_assignments aa join authorized_applications a using(application_id)
    ), scoped_logs as materialized (
      select l.* from app_private.report_requisition_logs l where exists(select 1 from scoped_req r where r.doc_id=l.doc_id)
    ), scoped_offers as materialized (
      select o.* from app_private.report_offers o where exists(select 1 from scoped_req r where r.doc_id=o.doc_id)
    ), terminal_events as materialized (
      select t.application_id,case when t.recruitment_process in ('Rejected','Withdrawn') or t.stage_instance_id is null then t.log_date else t.outcome_date end terminal_date
      from app_private.report_recruitment_logs t join authorized_applications a on a.application_id=t.application_id join authorized_candidates c on c.candidate_id=t.candidate_id
      where t.superseded_at is null and t.superseded_by_stage_instance_id is null and (t.recruitment_process in ('Rejected','Withdrawn') or t.result=0)
    ), accepted_apps as materialized (
      select o.application_id,o.accepted_date from app_private.report_offers o where o.application_id is not null and o.accepted_date<=v_as_of and o.start_confirmation is distinct from 'did_not_start'
    ), windows as (
      select 0::bigint ord,p_start starts,v_as_of as_of,p_end display_end
      union all select -1,p_prior_start,least(p_prior_end,v_as_of),p_prior_end where p_start<=v_as_of and p_prior_start<=v_as_of
      union all select ord,coalesce(lag(d) over(order by ord)+1,p_start),least(d,v_as_of),d from unnest(coalesce(p_trend_dates,'{}'::date[])) with ordinality t(d,ord)
    ), summaries as materialized (
      select w.*,report.metrics,report.detail from windows w cross join lateral (
        with assignment_at_date as materialized (
      select distinct on (aa.application_id) aa.application_id,aa.group_id from assignments aa
      where (aa.started_at at time zone 'Asia/Bangkok')::date<=w.as_of and (aa.ended_at is null or (aa.ended_at at time zone 'Asia/Bangkok')::date>w.as_of)
      order by aa.application_id,aa.started_at desc,aa.assignment_id desc
    ), app_context as materialized (
      select a.application_id,a.candidate_id,c.name,coalesce(aa.group_id,a.group_id) group_id
      from authorized_applications a join authorized_candidates c on c.candidate_id=a.candidate_id
      left join assignment_at_date aa on aa.application_id=a.application_id
      where (lower(coalesce(nullif(btrim(c.channel),''),'Others'))=lower(coalesce(nullif(btrim(p_channel),''),'all')) or lower(coalesce(p_channel,'all'))='all')
    ), requisition_history_any as materialized (
      select distinct doc_id from scoped_logs
    ), requisition_history_at_date as materialized (
      select distinct on (doc_id) doc_id,status from scoped_logs where log_date<=w.as_of order by doc_id,log_date asc,log_id desc
    ), requisition_filled_at_date as materialized (
      select doc_id,min(log_date) filled_log_date from scoped_logs where log_date<=w.as_of and status='filled' group by doc_id
    ), offer_by_doc as materialized (
      select doc_id,count(*) filter(where accepted_date<=w.as_of and (start_confirmation is distinct from 'did_not_start'
        or (start_confirmed_at at time zone 'Asia/Bangkok')::date>w.as_of))::integer accepted_at_date,
        max((start_confirmed_at at time zone 'Asia/Bangkok')::date) filter(where start_confirmation='did_not_start'
          and (start_confirmed_at at time zone 'Asia/Bangkok')::date<=w.as_of) no_show_date
      from scoped_offers group by doc_id
    ), req_state as (
      select r.*,case when ha.doc_id is not null then hd.status
        else case when (r.created_at at time zone 'Asia/Bangkok')::date>w.as_of then 'ongoing' else r.status end end state_at_date,
        hf.filled_log_date,coalesce(ob.accepted_at_date,0)::integer accepted_at_date,ob.no_show_date is not null has_no_show,ob.no_show_date
      from scoped_req r left join requisition_history_any ha on ha.doc_id=r.doc_id left join requisition_history_at_date hd on hd.doc_id=r.doc_id
        left join requisition_filled_at_date hf on hf.doc_id=r.doc_id left join offer_by_doc ob on ob.doc_id=r.doc_id
      where (r.created_at at time zone 'Asia/Bangkok')::date<=w.as_of and (r.pr_approved_date is null or r.pr_approved_date<=w.as_of)
    ), open_req as (
      select r.* from req_state r where coalesce(r.state_at_date,'ongoing')<>'cancel'
        and (coalesce(r.state_at_date,'ongoing')<>'filled' or (r.has_no_show and r.no_show_date>=r.filled_log_date))
        and greatest(coalesce(r.head_count,0)-r.accepted_at_date,0)>0
    ), contexts as (
      select c.application_id,c.candidate_id,c.name,c.group_id,count(distinct r.doc_id) filter(where r.doc_id is not null) req_count
      from app_context c left join open_req r on r.group_id=c.group_id group by c.application_id,c.candidate_id,c.name,c.group_id
    ), ranked_attempts as materialized (
      select a.*,count(*) filter(where a.outcome_date is null or a.outcome_date>w.as_of) over(partition by a.application_id)::integer unresolved_count,
        row_number() over(partition by a.application_id order by a.entry_date desc,a.round desc,a.log_id desc) latest_rank
      from attempts a where a.entry_date<=w.as_of and a.exclusion is null
    ), unresolved as (
      select a.* from ranked_attempts a where a.latest_rank=1 and (a.outcome_date is null or a.outcome_date>w.as_of)
    ), terminal_apps as (
      select application_id from terminal_events where terminal_date<=w.as_of
      union select application_id from accepted_apps where accepted_date<=w.as_of
    ), eligible_queue as (
      select u.*,c.name candidate_name,c.group_id,c.req_count,u.unresolved_count>1 conflict,(t.application_id is not null) terminal
      from unresolved u join contexts c on c.application_id=u.application_id left join terminal_apps t on t.application_id=u.application_id
      where c.req_count>0
    ), waiting_rows as (
      select q.*,greatest(w.as_of-q.entry_date,0)::integer wait_days,
        case when q.invalid_due or q.edited_date>w.as_of or (q.unreliable and w.as_of<(now() at time zone 'Asia/Bangkok')::date) then 'unavailable'
          when q.due_date is null then 'unscheduled' when q.due_date<w.as_of then 'overdue' when q.due_date=w.as_of then 'today' else 'upcoming' end status
      from eligible_queue q where not q.terminal and w.starts<=w.as_of
    ), stage_wait as (
      select stage,count(*)::integer waiting,max(wait_days)::integer oldest from waiting_rows group by stage
    ), status_counts as (
      select count(*)::integer waiting,count(*) filter(where status='overdue')::integer overdue,count(*) filter(where status='unavailable')::integer unavailable,
        max(wait_days)::integer longest,count(*) filter(where status='today')::integer today,count(*) filter(where status='upcoming')::integer upcoming,
        count(*) filter(where status='unscheduled')::integer unscheduled,count(*) filter(where conflict)::integer conflicts from waiting_rows
    ), pic_counts as (
      select coalesce(array_agg(distinct r.person_in_charge order by r.person_in_charge) filter(where nullif(btrim(r.person_in_charge),'') is not null),'{}'::text[]) pics
      from waiting_rows w join scoped_req r on r.group_id=w.group_id
    )
    , queue_summary as (
      select sc.*,coalesce((select jsonb_object_agg(stage,jsonb_build_object('waiting',waiting,'oldest',oldest)) from stage_wait where w.ord=0),'{}'::jsonb) stage_wait from status_counts sc
  ), eligible_attempts as (
    select x.* from attempts x join app_context c on c.application_id=x.application_id
    where (exists(select 1 from scoped_req r where r.group_id=coalesce((select aa.group_id from assignments aa
        where aa.assignment_id=case when x.result is null then x.entry_assignment_id else x.outcome_assignment_id end and aa.application_id=x.application_id),c.group_id))
      or not exists(select 1 from assignments aa where aa.assignment_id=case when x.result is null then x.entry_assignment_id else x.outcome_assignment_id end and aa.application_id=x.application_id)
        and exists(select 1 from scoped_req r where r.group_id=c.group_id))
  ), completed as (
    select * from eligible_attempts where result is not null and outcome_date between w.starts and w.as_of
  ), valid as (select * from completed where duration is not null and exclusion is null), stage_order as (
    select unnest(array['Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer']) stage,unnest(array[1,2,3,4,5,6]) ord
  ), completion_stats as (
    select stage,count(*)::integer sample,percentile_cont(.5) within group(order by duration)::numeric median,percentile_cont(.9) within group(order by duration)::numeric p90 from valid where w.ord=0 group by stage
  ), stage_rows as (
    select s.stage,coalesce(c.sample,0) sample,c.median,c.p90,
      coalesce((qs.stage_wait->s.stage->>'waiting')::integer,0) waiting,(qs.stage_wait->s.stage->>'oldest')::integer oldest,s.ord
    from stage_order s cross join queue_summary qs left join completion_stats c using(stage)
  ), primary_row as (select * from stage_rows where median is not null order by median desc,waiting desc,oldest desc nulls last,ord limit 1),
  channel_options as (select coalesce(jsonb_agg(distinct coalesce(nullif(btrim(c.channel),''),'Others') order by coalesce(nullif(btrim(c.channel),''),'Others')),'[]'::jsonb) values
    from authorized_candidates c),
  excluded as (select count(*)::integer n from eligible_attempts where exclusion is not null and ((outcome_date between w.starts and w.as_of) or (outcome_date is null and entry_date<=w.as_of))),
  med as (select percentile_cont(.5) within group(order by duration)::numeric value from valid)
  select jsonb_build_object('waiting',qs.waiting,'median',med.value,'overdue',qs.overdue,'longest',qs.longest,'unavailable',qs.unavailable) metrics,
    case when w.ord=0 then jsonb_build_object('asOf',w.as_of,'start',w.starts,'future',w.starts>w.as_of,'channel',coalesce(p_channel,'all'),
    'stages',coalesce((select jsonb_agg(jsonb_build_object('stage',stage,'sample',sample,'median',median,'p90',p90,'waiting',waiting,'oldest',oldest) order by ord) from stage_rows),'[]'::jsonb),
    'primary',(select jsonb_build_object('stage',stage,'sample',sample,'median',median,'p90',p90,'waiting',waiting,'oldest',oldest) from primary_row),
    'excluded',(select n from excluded),'conflicts',qs.conflicts,'statusCounts',jsonb_build_object('overdue',qs.overdue,'today',qs.today,'upcoming',qs.upcoming,'unscheduled',qs.unscheduled,'unavailable',qs.unavailable),'picOptions',to_jsonb((select pics from pic_counts)),'channelOptions',(select values from channel_options)) end detail
    from med cross join queue_summary qs
      ) report
    )
  select s.detail || jsonb_build_object('metrics',s.metrics,'priorMetrics',(select metrics from summaries where ord=-1),
    'priorRange',case when p_prior_start is null then null else jsonb_build_object('start',p_prior_start,'end',p_prior_end) end,
    'trends',coalesce((select jsonb_agg(metrics || jsonb_build_object('date',display_end,'overdue',case when (metrics->>'unavailable')::integer>0 then null else metrics->'overdue' end) order by ord) from summaries where ord>0),'[]'::jsonb))
  into v_result from summaries s where s.ord=0;
  return v_result;
end; $$;

create or replace function public.app_dashboard_bottleneck_queue_v1(
  p_as_of date,p_scope jsonb,p_channel text,p_stage text default null,p_status text default null,p_pic text default null,p_search text default '',
  p_after_value text default null,p_after_id text default null,p_before_value text default null,p_before_id text default null,p_limit integer default 20
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_resolved_status text; v_has_more boolean:=false; v_has_more_before boolean:=false; v_rows jsonb; v_first_value text; v_first_id text; v_last_value text; v_last_id text; v_search text:=lower(case when btrim(coalesce(p_search,'')) ~* '^(CAN|GRP)-[0-9]+$' then upper(split_part(btrim(p_search),'-',1))||'-'||lpad(split_part(btrim(p_search),'-',2),greatest(5,length(split_part(btrim(p_search),'-',2))),'0') else btrim(coalesce(p_search,'')) end);
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if p_as_of is null or p_limit is null or p_limit<1 or p_limit>20 or (p_after_value is null)<>(p_after_id is null)
    or (p_before_value is null)<>(p_before_id is null) or ((p_after_value is not null)::integer+(p_before_value is not null)::integer)>1
    or (p_after_value is null and p_before_value is null and (p_after_id is not null or p_before_id is not null)) then raise exception 'BOTTLENECK_CURSOR_INVALID'; end if;
  if p_status is not null and p_status not in ('auto','overdue','today','upcoming','unscheduled','unavailable') then raise exception 'BOTTLENECK_FILTER_INVALID'; end if;
  if p_stage is not null and p_stage not in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer') then raise exception 'BOTTLENECK_FILTER_INVALID'; end if;
  if length(coalesce(p_search,''))>200 or jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly','sites','departments','levels')) then raise exception 'BOTTLENECK_FILTER_INVALID'; end if;
  with authorized_candidates as materialized (
    select c.candidate_id,c.name,c.channel from app_private.report_candidates c where app_private.can_read_candidate(c.candidate_id)
  ), authorized_applications as materialized (
    select a.application_id,a.candidate_id,a.group_id from app_private.report_candidate_applications a where app_private.can_read_application(a.application_id)
  ), authorized_logs as materialized (
    select l.* from app_private.report_recruitment_logs l join authorized_candidates c on c.candidate_id=l.candidate_id
      left join authorized_applications a on a.application_id=l.application_id
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
      and l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and (l.application_id is null or a.application_id is not null)
  ), direct_rows as (
    select l.stage_instance_id::text attempt_id,l.application_id,l.candidate_id,l.recruitment_process stage,l.round,l.log_id,l.log_date entry_date,
      case when l.result is null then null else l.outcome_date end outcome_date,l.result,l.estimated_action_date due_date,
      (l.pending_edited_at at time zone 'Asia/Bangkok')::date edited_date,
      (l.record_origin='migration' and l.pending_edited_at is null) unreliable,false invalid_due,
      case when l.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(l.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when l.log_date is null then 'Missing or invalid entry date' when l.result is not null and l.outcome_date is null then 'Missing or invalid outcome date'
        when l.outcome_date is not null and l.outcome_date<l.log_date then 'Outcome precedes entry' else null end exclusion,
      l.entry_assignment_id,l.outcome_assignment_id
    from authorized_logs l where l.stage_instance_id is not null
  ), legacy_grouped as (
    select l.*,coalesce(sum(case when l.result is not null then 1 else 0 end) over(partition by l.application_id,l.recruitment_process,l.round
      order by l.log_date,l.log_id rows between unbounded preceding and 1 preceding),0)::integer pair_group
    from authorized_logs l where l.stage_instance_id is null
  ), pending_rows as (
    select l.*,row_number() over(partition by l.application_id,l.recruitment_process,l.round,l.pair_group order by l.log_date desc,l.log_id desc) pending_rank
    from legacy_grouped l where l.result is null
  ), outcome_rows as (
    select l.*,p.log_id pending_log_id,p.log_date pending_log_date,p.estimated_action_date pending_due,p.pending_edited_at pending_edited,p.record_origin pending_origin
    from legacy_grouped l left join lateral (select p.log_id,p.log_date,p.estimated_action_date,p.pending_edited_at,p.record_origin from pending_rows p
      where p.application_id=l.application_id and p.recruitment_process=l.recruitment_process and p.round=l.round and p.pair_group=l.pair_group
      order by p.log_date desc,p.log_id desc limit 1) p on true where l.result is not null
  ), paired_results as (
    select ('legacy-'||o.log_id::text) attempt_id,o.application_id,o.candidate_id,o.recruitment_process stage,o.round,o.log_id,o.pending_log_date entry_date,
      coalesce(o.outcome_date,o.log_date) outcome_date,o.result,coalesce(o.pending_due,o.estimated_action_date) due_date,(coalesce(o.pending_edited,o.pending_edited_at) at time zone 'Asia/Bangkok')::date edited_date,
      (coalesce(o.pending_origin,o.record_origin)='migration' and coalesce(o.pending_edited,o.pending_edited_at) is null) unreliable,false invalid_due,
      case when o.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(o.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when o.pending_log_date is null then 'Missing or invalid entry date'
        when coalesce(o.outcome_date,o.log_date) is null then 'Missing or invalid outcome date'
        when coalesce(o.outcome_date,o.log_date)<o.pending_log_date then 'Outcome precedes entry' else null end exclusion,o.entry_assignment_id,o.outcome_assignment_id
    from outcome_rows o
  ), standalone_pending as (
    select ('legacy-'||p.log_id::text) attempt_id,p.application_id,p.candidate_id,p.recruitment_process stage,p.round,p.log_id,p.log_date entry_date,
      null::date outcome_date,null::smallint result,p.estimated_action_date due_date,(p.pending_edited_at at time zone 'Asia/Bangkok')::date edited_date,
      (p.record_origin='migration' and p.pending_edited_at is null) unreliable,false invalid_due,
      case when p.migration_note ilike '%outcome-only%' then 'Outcome-only legacy record' when coalesce(p.migration_note,'') ~* '(inferred|clamped)' then 'Inferred or clamped migration date'
        when p.log_date is null then 'Missing or invalid entry date' else null end exclusion,p.entry_assignment_id,p.outcome_assignment_id
    from pending_rows p where not exists(select 1 from outcome_rows o where o.application_id=p.application_id and o.recruitment_process=p.recruitment_process
      and o.round=p.round and o.pair_group=p.pair_group and o.pending_log_id=p.log_id)
  ), attempts as (
    select a.*,case when a.exclusion is null and a.entry_date is not null and a.outcome_date is not null then a.outcome_date-a.entry_date end::integer duration
    from (select * from direct_rows union all select * from paired_results union all select * from standalone_pending) a
  ), assignment_at_date as materialized (
    select distinct on (aa.application_id) aa.application_id,aa.group_id from app_private.report_candidate_application_assignments aa
    where (aa.started_at at time zone 'Asia/Bangkok')::date<=p_as_of and (aa.ended_at is null or (aa.ended_at at time zone 'Asia/Bangkok')::date>p_as_of)
    order by aa.application_id,aa.started_at desc,aa.assignment_id desc
  ), app_context as materialized (
    select a.application_id,a.candidate_id,c.name,coalesce(aa.group_id,a.group_id) group_id,
      lower(coalesce(nullif(btrim(c.channel),''),'Others')) channel_key
    from authorized_applications a join authorized_candidates c on c.candidate_id=a.candidate_id
    left join assignment_at_date aa on aa.application_id=a.application_id
    where (lower(coalesce(nullif(btrim(c.channel),''),'Others'))=lower(coalesce(nullif(btrim(p_channel),''),'all')) or lower(coalesce(p_channel,'all'))='all')
  ), scoped_req as (
    select r.doc_id,r.site,r.department,r.position,r.person_in_charge,r.level,r.is_priority,r.head_count,r.status,r.created_at,r.pr_approved_date,dg.group_id
    from app_private.report_document_groups dg join app_private.report_requisitions r on r.doc_id=dg.doc_id
    where app_private.can_read_requisition(r.doc_id)
      and (coalesce(p_scope->>'headerSite','')='' or r.site=p_scope->>'headerSite')
      and (coalesce(p_scope->>'headerPic','')='' or lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_scope->>'headerPic')))
      and (not coalesce((p_scope->>'priorityOnly')::boolean,false) or r.is_priority)
      and (jsonb_array_length(coalesce(p_scope->'sites','[]'::jsonb))=0 or r.site in(select jsonb_array_elements_text(p_scope->'sites')))
      and (jsonb_array_length(coalesce(p_scope->'departments','[]'::jsonb))=0 or r.department in(select jsonb_array_elements_text(p_scope->'departments')))
      and (jsonb_array_length(coalesce(p_scope->'levels','[]'::jsonb))=0 or exists(select 1 from jsonb_array_elements_text(p_scope->'levels') x(band)
        where btrim(coalesce(r.level,'')) ~* '^L?(0|[1-9]|1[0-4])$' and substring(r.level from '([0-9]+)$')::integer between split_part(x.band,'-',1)::integer and split_part(x.band,'-',2)::integer))
  ), requisition_history_any as materialized (
    select distinct doc_id from app_private.report_requisition_logs
  ), requisition_history_at_date as materialized (
    select distinct on (doc_id) doc_id,status from app_private.report_requisition_logs where log_date<=p_as_of order by doc_id,log_date asc,log_id desc
  ), requisition_filled_at_date as materialized (
    select doc_id,min(log_date) filled_log_date from app_private.report_requisition_logs where log_date<=p_as_of and status='filled' group by doc_id
  ), offer_by_doc as materialized (
    select doc_id,count(*) filter(where accepted_date<=p_as_of and (start_confirmation is distinct from 'did_not_start'
      or (start_confirmed_at at time zone 'Asia/Bangkok')::date>p_as_of))::integer accepted_at_date,
      max((start_confirmed_at at time zone 'Asia/Bangkok')::date) filter(where start_confirmation='did_not_start'
        and (start_confirmed_at at time zone 'Asia/Bangkok')::date<=p_as_of) no_show_date
    from app_private.report_offers group by doc_id
  ), req_state as (
    select r.*,case when ha.doc_id is not null then hd.status
      else case when (r.created_at at time zone 'Asia/Bangkok')::date>p_as_of then 'ongoing' else r.status end end state_at_date,
      hf.filled_log_date,coalesce(ob.accepted_at_date,0)::integer accepted_at_date,ob.no_show_date is not null has_no_show,ob.no_show_date
    from scoped_req r left join requisition_history_any ha on ha.doc_id=r.doc_id left join requisition_history_at_date hd on hd.doc_id=r.doc_id
      left join requisition_filled_at_date hf on hf.doc_id=r.doc_id left join offer_by_doc ob on ob.doc_id=r.doc_id
    where (r.created_at at time zone 'Asia/Bangkok')::date<=p_as_of and (r.pr_approved_date is null or r.pr_approved_date<=p_as_of)
  ), open_req as (
    select r.* from req_state r where coalesce(r.state_at_date,'ongoing')<>'cancel'
      and (coalesce(r.state_at_date,'ongoing')<>'filled' or (r.has_no_show and r.no_show_date>=r.filled_log_date))
      and greatest(coalesce(r.head_count,0)-r.accepted_at_date,0)>0
  ), contexts as (
    select c.application_id,c.candidate_id,c.name,c.group_id,count(distinct r.doc_id) filter(where r.doc_id is not null) req_count
    from app_context c left join open_req r on r.group_id=c.group_id group by c.application_id,c.candidate_id,c.name,c.group_id
  ), ranked_attempts as materialized (
    select a.*,count(*) filter(where a.outcome_date is null or a.outcome_date>p_as_of) over(partition by a.application_id)::integer unresolved_count,
      row_number() over(partition by a.application_id order by a.entry_date desc,a.round desc,a.log_id desc) latest_rank
    from attempts a where a.entry_date<=p_as_of and a.exclusion is null
  ), unresolved as (
    select a.* from ranked_attempts a where a.latest_rank=1 and (a.outcome_date is null or a.outcome_date>p_as_of)
  ), terminal_apps as materialized (
    select t.application_id from app_private.report_recruitment_logs t join authorized_applications allowed_a on allowed_a.application_id=t.application_id
      join authorized_candidates allowed_c on allowed_c.candidate_id=t.candidate_id
    where t.application_id is not null and t.superseded_at is null and t.superseded_by_stage_instance_id is null
      and (t.recruitment_process in ('Rejected','Withdrawn') or t.result=0)
      and case when t.recruitment_process in ('Rejected','Withdrawn') or t.stage_instance_id is null then t.log_date else t.outcome_date end<=p_as_of
    group by t.application_id
    union
    select o.application_id from app_private.report_offers o where o.application_id is not null and o.accepted_date<=p_as_of and o.start_confirmation is distinct from 'did_not_start'
  ), eligible_queue as (
    select u.*,c.name candidate_name,c.group_id,c.req_count,u.unresolved_count>1 conflict,(t.application_id is not null) terminal
    from unresolved u join contexts c on c.application_id=u.application_id left join terminal_apps t on t.application_id=u.application_id where c.req_count>0
  ), normalized_queue as (
    select q.*,greatest(p_as_of-q.entry_date,0)::integer wait_days,
      case when q.invalid_due or q.edited_date>p_as_of or (q.unreliable and p_as_of<(now() at time zone 'Asia/Bangkok')::date) then 'unavailable'
        when q.due_date is null then 'unscheduled' when q.due_date<p_as_of then 'overdue' when q.due_date=p_as_of then 'today' else 'upcoming' end status
    from eligible_queue q where not q.terminal
  ), queue_status as (
    select case when p_status='auto' then case when exists(select 1 from normalized_queue where status='overdue') then 'overdue' end else p_status end resolved
  ), queue_source as (
    select q.*,lpad(case when status='overdue' then '0' else '1' end,1,'0')||':'||coalesce(to_char(due_date,'YYYY-MM-DD'),'9999-12-31')||':'||lpad(greatest(0,999999-wait_days)::text,6,'0') sort_value
    from normalized_queue q
  ), eligible as materialized (
    select q.* from queue_source q
    where (p_stage is null or q.stage=p_stage) and ((select resolved from queue_status) is null or q.status=(select resolved from queue_status))
      and (nullif(btrim(p_pic),'') is null or exists(select 1 from open_req r where r.group_id=q.group_id and lower(btrim(coalesce(r.person_in_charge,'')))=lower(btrim(p_pic))))
      and (v_search='' or concat_ws(' ',q.candidate_id,
        case when q.candidate_id ~* '^CAN-[0-9]+$' then 'CAN-'||lpad(split_part(q.candidate_id,'-',2),greatest(5,length(split_part(q.candidate_id,'-',2))),'0') else q.candidate_id end,
        q.group_id,case when q.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(q.group_id,'-',2),greatest(5,length(split_part(q.group_id,'-',2))),'0') else q.group_id end,
        q.candidate_name,q.application_id::text,q.stage) ilike '%'||v_search||'%'
        or exists(select 1 from scoped_req r where r.group_id=q.group_id and concat_ws(' ',r.group_id,
          case when r.group_id ~* '^GRP-[0-9]+$' then 'GRP-'||lpad(split_part(r.group_id,'-',2),greatest(5,length(split_part(r.group_id,'-',2))),'0') else r.group_id end,
          r.doc_id,r.position,r.site,r.department,r.person_in_charge) ilike '%'||v_search||'%'))
  ),
  anchored as (
    select e.*,case when p_after_value is not null then (e.sort_value,e.application_id::text)>(p_after_value,p_after_id)
      when p_before_value is not null then (e.sort_value,e.application_id::text)<(p_before_value,p_before_id) else true end matches_cursor
    from eligible e
  ), page_raw as (
    select * from anchored where matches_cursor order by
      case when p_before_value is not null then sort_value end desc,
      case when p_before_value is not null then application_id::text end desc,
      case when p_before_value is null then sort_value end asc,
      case when p_before_value is null then application_id::text end asc
    limit p_limit+1
  ), selected as (select * from page_raw order by
      case when p_before_value is not null then sort_value end asc,
      case when p_before_value is not null then application_id::text end asc,
      case when p_before_value is null then sort_value end asc,
      case when p_before_value is null then application_id::text end asc limit p_limit),
  page_stats as (select min(sort_value) first_value,max(sort_value) last_value,
      (array_agg(application_id::text order by sort_value,application_id::text))[1] first_id,
      (array_agg(application_id::text order by sort_value desc,application_id::text desc))[1] last_id from selected),
  extra as (select count(*)::integer n from page_raw),
  items as (select coalesce(jsonb_agg(jsonb_build_object(
      'candidate',jsonb_build_object('candidate_id',s.candidate_id,'name',s.candidate_name,'application_id',s.application_id),
      'instance',jsonb_build_object('id',s.attempt_id,'logId',s.log_id,'candidateId',s.candidate_id,'applicationId',s.application_id,'groupId',s.group_id,
        'stage',s.stage,'round',s.round,'entry',s.entry_date,'outcome',s.outcome_date,'result',s.result,'due',s.due_date,'edited',s.edited_date,
        'unreliable',s.unreliable,'invalidDue',s.invalid_due,'duration',s.duration,'exclusion',s.exclusion),
      'requisitions',coalesce(detail.rows,'[]'::jsonb),'wait',s.wait_days,'status',s.status,'conflict',s.conflict) order by s.sort_value,s.application_id),'[]'::jsonb) rows
    from selected s cross join lateral(select jsonb_agg(jsonb_build_object('doc_id',r.doc_id,'position',r.position,'site',r.site,'department',r.department,'person_in_charge',r.person_in_charge) order by r.doc_id) rows
      from scoped_req r where r.group_id=s.group_id) detail)
  select (select n>p_limit from extra),(p_after_value is not null or (p_before_value is not null and (select n>p_limit from extra))),
    page_stats.first_value,page_stats.first_id,page_stats.last_value,page_stats.last_id,items.rows,coalesce((select resolved from queue_status),'all')
  into v_has_more,v_has_more_before,v_first_value,v_first_id,v_last_value,v_last_id,v_rows,v_resolved_status
  from page_stats cross join extra cross join items;
  if p_before_value is not null then v_has_more:=true; end if;
  return jsonb_build_object('rows',v_rows,'resolvedStatus',v_resolved_status,'hasMore',v_has_more,'hasMoreBefore',v_has_more_before,
    'nextCursor',case when v_has_more and v_last_id is not null then jsonb_build_object('value',v_last_value,'id',v_last_id) else null end,
    'previousCursor',case when v_has_more_before and v_first_id is not null then jsonb_build_object('value',v_first_value,'id',v_first_id) else null end);
end; $$;

create or replace function public.app_home_welcome_summary_v1()
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_month_start date := date_trunc('month',(now() at time zone 'Asia/Bangkok'))::date;
  v_month_end date := (date_trunc('month',(now() at time zone 'Asia/Bangkok')) + interval '1 month - 1 day')::date;
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then
    raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED';
  end if;
  select p.* into v_profile from public.profiles p where p.id=auth.uid();
  if not found then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;

  with responsible_requisitions as materialized (
    select r.doc_id,r.site,r.person_in_charge,r.status,r.head_count,r.pr_approved_date
    from app_private.report_requisitions r
    where app_private.can_read_requisition(r.doc_id)
      and (v_profile.role in ('system_admin','admin_recruiter')
        or (coalesce(v_profile.nickname,'')<>'' and position(lower(v_profile.nickname) in lower(coalesce(r.person_in_charge,'')))>0)
        or (coalesce(v_profile.full_name,'')<>'' and position(lower(v_profile.full_name) in lower(coalesce(r.person_in_charge,'')))>0)
        or (coalesce(v_profile.site,'')<>'' and position(lower(v_profile.site) in lower(coalesce(r.site,'')))>0))
  ), readable_offers as materialized (
    select o.* from app_private.report_offers o where app_private.can_read_application(o.application_id)
  ), offer_totals as (
    select o.doc_id,count(*) filter(where o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') as accepted,
      max(o.accepted_date) as close_date
    from readable_offers o group by o.doc_id
  ), filled_dates as (
    select l.doc_id,max(l.log_date) as close_date from app_private.report_requisition_logs l
    join responsible_requisitions r using(doc_id) where l.status='filled' group by l.doc_id
  ), actionable_requisitions as (
    select r.doc_id,r.head_count,
      greatest(r.head_count-coalesce(o.accepted,0),0) as open_headcount
    from responsible_requisitions r left join offer_totals o using(doc_id)
    where r.status not in ('filled','cancel')
  ), pim_requisitions as (
    select r.doc_id,r.head_count,
      coalesce(f.close_date,o.close_date) as close_date
    from responsible_requisitions r left join offer_totals o using(doc_id) left join filled_dates f using(doc_id)
    where r.pr_approved_date is not null and r.pr_approved_date<=v_month_end and r.status<>'cancel'
  ), eligible_pim as (
    select p.* from pim_requisitions p where p.close_date is null or p.close_date>=v_month_start
  ), visible_apps as materialized (
    select a.application_id,a.candidate_id,a.group_id
    from app_private.report_candidate_applications a
    join app_private.report_candidates c on c.candidate_id=a.candidate_id and app_private.can_read_candidate(c.candidate_id)
    where app_private.can_read_application(a.application_id)
      and (
        v_profile.role in ('system_admin','admin_recruiter')
        or exists(select 1 from app_private.report_document_groups d join app_private.report_requisitions r using(doc_id)
          where d.group_id=a.group_id and (
            app_private.can_read_requisition(r.doc_id) and (
            (coalesce(v_profile.nickname,'')<>'' and position(lower(v_profile.nickname) in lower(coalesce(r.person_in_charge,'')))>0)
            or (coalesce(v_profile.full_name,'')<>'' and position(lower(v_profile.full_name) in lower(coalesce(r.person_in_charge,'')))>0)
            or (coalesce(v_profile.site,'')<>'' and position(lower(v_profile.site) in lower(coalesce(r.site,'')))>0))))
      )
  ), latest_logs as (
    select distinct on (l.application_id) l.application_id,l.recruitment_process,l.result
    from app_private.report_recruitment_logs l join visible_apps a using(application_id)
    where l.superseded_at is null and l.superseded_by_stage_instance_id is null
    order by l.application_id,
      case l.recruitment_process when 'Phone Screen' then 1 when 'HR Interview' then 2 when 'Line Interview' then 3 when 'Test' then 4 when 'Reference Check' then 5 when 'Offer' then 6 else 0 end desc,
      l.round desc,l.log_id desc
  ), active_candidates as (
    select l.application_id,a.candidate_id,l.recruitment_process,l.result
    from latest_logs l join visible_apps a using(application_id)
    where l.recruitment_process in ('Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer')
      and l.result is distinct from 0
      and not exists(select 1 from readable_offers o
        where o.application_id=l.application_id
          and app_private.can_read_requisition(o.doc_id)
          and app_private.can_read_application(o.application_id))
  ), counts as (
    select
      (select count(*)::integer from actionable_requisitions where open_headcount>0) as open_requisitions,
      (select coalesce(sum(open_headcount),0)::integer from actionable_requisitions) as open_vacancy,
      (select count(*)::integer from active_candidates) as active_candidates,
      (select count(*)::integer from active_candidates where recruitment_process='Offer' and result=1) as offer_finalization_needed,
      (select count(*)::integer from readable_offers o join eligible_pim p using(doc_id)
        where o.accepted_date between v_month_start and v_today and app_private.can_read_application(o.application_id)
          and app_private.can_read_requisition(o.doc_id)) as filled_this_month,
      (select coalesce(sum(head_count),0)::integer from eligible_pim) as responsible_vacancy_total
  )
  select jsonb_build_object(
    'openRequisitions',open_requisitions,
    'openVacancy',open_vacancy,
    'activeCandidates',active_candidates,
    'offerFinalizationNeeded',offer_finalization_needed,
    'filledThisMonth',filled_this_month,
    'responsibleVacancyTotal',responsible_vacancy_total,
    'filledResponsibleVacancyRatio',case when responsible_vacancy_total>0 then floor(filled_this_month::numeric/responsible_vacancy_total*100)::integer else 0 end,
    'filledResponsibleVacancyBucket',case when responsible_vacancy_total>0 then
      case when floor(filled_this_month::numeric/responsible_vacancy_total*100)>=100 then 100
        when floor(filled_this_month::numeric/responsible_vacancy_total*100)>=75 then 75
        when floor(filled_this_month::numeric/responsible_vacancy_total*100)>=50 then 50
        when floor(filled_this_month::numeric/responsible_vacancy_total*100)>=25 then 25 else 0 end else 0 end
  ) into v_result from counts;
  return v_result;
end $$;

create or replace function public.app_home_banner_summary_v1(p_scope jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_month text := to_char((now() at time zone 'Asia/Bangkok')::date,'YYYY-MM');
  v_result jsonb;
begin
  if auth.uid() is null or not app_private.is_recruitment_reader() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
  if jsonb_typeof(coalesce(p_scope,'{}'::jsonb))<>'object'
    or exists(select 1 from jsonb_object_keys(coalesce(p_scope,'{}'::jsonb)) k where k not in ('headerSite','headerPic','priorityOnly'))
    or (p_scope ? 'headerSite' and jsonb_typeof(p_scope->'headerSite')<>'string')
    or (p_scope ? 'headerPic' and jsonb_typeof(p_scope->'headerPic')<>'string')
    or (p_scope ? 'priorityOnly' and jsonb_typeof(p_scope->'priorityOnly')<>'boolean') then raise exception 'HOME_SCOPE_INVALID'; end if;
  with scoped_reqs as (
    select r.doc_id,r.head_count,r.status from app_private.report_requisitions r
    where app_private.can_read_requisition(r.doc_id)
      and (coalesce(btrim(p_scope->>'headerSite'),'')='' or position(lower(btrim(p_scope->>'headerSite')) in lower(coalesce(r.site,'')))>0)
      and (coalesce(btrim(p_scope->>'headerPic'),'')='' or position(lower(btrim(p_scope->>'headerPic')) in lower(coalesce(r.person_in_charge,'')))>0)
      and (coalesce((p_scope->>'priorityOnly')::boolean,false)=false or r.is_priority)
  )
  select jsonb_build_object(
    'monthlyFillCapacity',coalesce((select sum(head_count)::integer from scoped_reqs where status<>'cancel'),0),
    'monthlyFilledCount',(select count(*)::integer from app_private.report_offers o join scoped_reqs r using(doc_id)
      where left(o.accepted_date::text,7)=v_month
        and app_private.can_read_requisition(o.doc_id) and app_private.can_read_application(o.application_id))
  ) into v_result;
  return v_result;
end $$;

create or replace function app_private.notification_assigned_recruiter_v1(p_doc_id text)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then min(p.id::text)::uuid else null::uuid end
  from public.requisitions r
  join public.profiles p on p.role in ('site_recruiter','admin_recruiter','system_admin')
    and ((nullif(btrim(p.nickname),'') is not null and lower(btrim(p.nickname)) = lower(btrim(coalesce(r.person_in_charge,''))))
      or (nullif(btrim(p.full_name),'') is not null and lower(btrim(p.full_name)) = lower(btrim(coalesce(r.person_in_charge,'')))))
  where r.doc_id = p_doc_id and (not r.is_secret or p.role in ('system_admin','admin_recruiter'));
$$;
-- All classification/link transitions serialize through one transaction lock.
-- Row triggers protect legacy RPCs and direct writes as well as the new UI.
create or replace function app_private.guard_secret_requisition() returns trigger language plpgsql security definer set search_path='' as $$
declare v_conflicts text;
begin
 if tg_op='UPDATE' and new.is_secret is not distinct from old.is_secret then return new; end if;
 if tg_op='INSERT' and not new.is_secret then return new; end if;
 perform pg_advisory_xact_lock(714213,1);
 if tg_op='INSERT' then
   if new.is_secret and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 elsif new.is_secret is distinct from old.is_secret then
   if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
   if not old.is_secret then raise exception 'ORDINARY_CANNOT_BECOME_SECRET'; end if;
   if current_setting('app.secret_reveal',true) is distinct from old.doc_id then raise exception 'SECRET_REVEAL_CONFIRMATION_REQUIRED'; end if;
   select string_agg(distinct d.group_id,', ' order by d.group_id) into v_conflicts from public.document_groups d
     join public.document_groups other on other.group_id=d.group_id and other.doc_id<>old.doc_id
     join public.requisitions r on r.doc_id=other.doc_id where d.doc_id=old.doc_id and r.is_secret;
   if v_conflicts is not null then raise exception 'SECRET_MIXED_GROUPS: %',v_conflicts; end if;
 end if;
 return new;
end $$;
create or replace function app_private.guard_secret_group() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.is_secret is not distinct from old.is_secret then return new; end if;
 if tg_op='INSERT' and not new.is_secret then return new; end if;
 perform pg_advisory_xact_lock(714213,1);
 if tg_op='INSERT' then
   if new.is_secret and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 elsif new.is_secret is distinct from old.is_secret then
   if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
   if new.is_secret then
     if current_setting('app.secret_link_ack',true) is distinct from old.group_id then raise exception 'SECRET_LINK_CONFIRMATION_REQUIRED'; end if;
     if exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=old.group_id and not r.is_secret) then raise exception 'SECRET_MIXED_GROUPS'; end if;
     if exists(select 1 from public.candidate_application_assignments x join public.candidate_applications a using(application_id) where x.group_id=old.group_id and a.group_id<>old.group_id) or exists(select 1 from public.candidate_application_assignments x join public.candidate_applications a using(application_id) where a.group_id=old.group_id and x.group_id<>old.group_id) then raise exception 'SECRET_CROSS_TYPE_HISTORY: Use a separate group and applications.'; end if;
   else
     if current_setting('app.secret_group_reveal',true) is distinct from old.group_id then raise exception 'SECRET_REVEAL_CONFIRMATION_REQUIRED'; end if;
     if exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=old.group_id and r.is_secret) then raise exception 'SECRET_MIXED_GROUPS'; end if;
   end if;
 end if;
 return new;
end $$;
create or replace function app_private.guard_secret_link() returns trigger language plpgsql security definer set search_path='' as $$
declare v_req boolean; v_group boolean;
begin
 perform pg_advisory_xact_lock(714213,1);
 if tg_op='DELETE' then return old; end if;
 select is_secret into v_req from public.requisitions where doc_id=new.doc_id for update;
 if new.group_id is null then if v_req and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;return new; end if;
 select is_secret into v_group from public.position_groups where group_id=new.group_id for update;
 if (v_req or v_group) and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 if v_req and not v_group then
   if exists(select 1 from public.document_groups where group_id=new.group_id) then raise exception 'SECRET_MIXED_GROUPS'; end if;
   if current_setting('app.secret_link_ack',true) is distinct from new.group_id then raise exception 'SECRET_LINK_CONFIRMATION_REQUIRED'; end if;
   update public.position_groups set is_secret=true where group_id=new.group_id;
 elsif not v_req and v_group then raise exception 'SECRET_MIXED_GROUPS'; end if;
 return new;
end $$;
create or replace function app_private.guard_secret_transfer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.group_id=old.group_id then return new; end if;
 perform pg_advisory_xact_lock(714213,1);
 if tg_op='UPDATE' and new.group_id<>old.group_id and (select is_secret from public.position_groups where group_id=new.group_id) is distinct from (select is_secret from public.position_groups where group_id=old.group_id) then raise exception 'SECRET_CROSS_TYPE_TRANSFER: Create a separate application.'; end if;
 if (select is_secret from public.position_groups where group_id=new.group_id) and not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 return new;
end $$;
create or replace function app_private.after_secret_reveal() returns trigger language plpgsql security definer set search_path='' as $$
declare v_group text;
begin
 if old.is_secret and not new.is_secret then
  for v_group in select distinct group_id from public.document_groups where doc_id=new.doc_id and group_id is not null order by group_id loop
   perform set_config('app.secret_group_reveal',v_group,true);
   update public.position_groups set is_secret=false where group_id=v_group;
  end loop;
 end if;return new;
end $$;
create or replace function app_private.stamp_secret_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare v jsonb:=coalesce(new.new_data,new.old_data,'{}');v_group text;v_doc text;v_app uuid;
begin
 v_group:=coalesce(v->>'group_id',new.old_data->>'group_id');v_doc:=coalesce(v->>'doc_id',new.old_data->>'doc_id');v_app:=nullif(coalesce(v->>'application_id',new.old_data->>'application_id'),'')::uuid;
 new.is_secret:=coalesce((v->>'is_secret')::boolean,false) or coalesce((new.old_data->>'is_secret')::boolean,false)
   or coalesce((select is_secret from public.position_groups where group_id=v_group),false)
   or coalesce((select is_secret from public.requisitions where doc_id=v_doc),false)
   or exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where application_id=v_app and g.is_secret);
 return new;
end $$;
create or replace function app_private.classify_group_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.is_secret and not old.is_secret then
   update public.change_logs l set is_secret=true where (l.entity='position_groups' and l.entity_id=new.group_id)
    or coalesce(l.new_data->>'group_id',l.old_data->>'group_id')=new.group_id
    or coalesce(l.new_data->>'application_id',l.old_data->>'application_id') in (select application_id::text from public.candidate_applications where group_id=new.group_id)
    or (l.entity='candidates' and l.entity_id in(select candidate_id from public.candidate_applications where group_id=new.group_id));
 end if;return new;
end $$;
drop trigger if exists guard_secret_requisition on public.requisitions;
create trigger guard_secret_requisition before insert or update on public.requisitions for each row execute function app_private.guard_secret_requisition();
drop trigger if exists after_secret_reveal on public.requisitions;
create trigger after_secret_reveal after update on public.requisitions for each row execute function app_private.after_secret_reveal();
drop trigger if exists guard_secret_group on public.position_groups;
create trigger guard_secret_group before insert or update on public.position_groups for each row execute function app_private.guard_secret_group();
drop trigger if exists classify_group_audit on public.position_groups;
create trigger classify_group_audit after update on public.position_groups for each row execute function app_private.classify_group_audit();
drop trigger if exists guard_secret_link on public.document_groups;
create trigger guard_secret_link before insert or update or delete on public.document_groups for each row execute function app_private.guard_secret_link();
drop trigger if exists guard_secret_transfer on public.candidate_applications;
create trigger guard_secret_transfer before insert or update on public.candidate_applications for each row execute function app_private.guard_secret_transfer();
drop trigger if exists stamp_secret_audit on public.change_logs;
create trigger stamp_secret_audit before insert on public.change_logs for each row execute function app_private.stamp_secret_audit();

create or replace function public.app_reveal_secret_requisition_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.requisitions%rowtype;
begin
 if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 if coalesce((payload->>'confirmed')::boolean,false) is not true then raise exception 'SECRET_REVEAL_CONFIRMATION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(714213,1);
 select * into v from public.requisitions where doc_id=payload->>'doc_id' for update;
 if not found or not v.is_secret then raise exception 'SECRET_REQUISITION_UNAVAILABLE'; end if;
 if v.updated_at is distinct from (payload->>'expected_updated_at')::timestamptz then raise exception 'SECRET_STALE_WRITE'; end if;
 perform set_config('app.secret_reveal',v.doc_id,true);perform set_config('app.action','requisition:reveal',true);
 update public.requisitions set is_secret=false where doc_id=v.doc_id;
 return jsonb_build_object('ok',true,'id',v.doc_id);
end $$;
create or replace function public.app_reveal_secret_group_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.position_groups%rowtype;
begin
 if not app_private.secret_admin() then raise exception 'SECRET_ADMIN_REQUIRED'; end if;
 if coalesce((payload->>'confirmed')::boolean,false) is not true then raise exception 'SECRET_REVEAL_CONFIRMATION_REQUIRED'; end if;
 perform pg_advisory_xact_lock(714213,1);
 select * into v from public.position_groups where group_id=payload->>'group_id' for update;
 if not found or not v.is_secret then raise exception 'SECRET_GROUP_UNAVAILABLE'; end if;
 if exists(select 1 from public.document_groups where group_id=v.group_id) then raise exception 'SECRET_GROUP_MUST_BE_UNLINKED'; end if;
 if v.updated_at is distinct from (payload->>'expected_updated_at')::timestamptz then raise exception 'SECRET_STALE_WRITE'; end if;
 perform set_config('app.secret_group_reveal',v.group_id,true);perform set_config('app.action','group:reveal',true);
 update public.position_groups set is_secret=false where group_id=v.group_id;
 return jsonb_build_object('ok',true,'id',v.group_id);
end $$;
revoke all on function public.app_reveal_secret_requisition_v1(jsonb),public.app_reveal_secret_group_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_reveal_secret_requisition_v1(jsonb),public.app_reveal_secret_group_v1(jsonb) to authenticated;
do $$ declare f record;begin for f in select p.oid::regprocedure name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname in ('guard_secret_requisition','guard_secret_group','guard_secret_link','guard_secret_transfer','after_secret_reveal','stamp_secret_audit','classify_group_audit') loop execute format('revoke all on function %s from public,anon,authenticated',f.name);end loop;end $$;

drop policy if exists secret_audit_visibility on public.change_logs;
create policy secret_audit_visibility on public.change_logs as restrictive for select to authenticated using(not is_secret or app_private.secret_admin());
drop policy if exists secret_notification_visibility on public.recruitment_notifications;
create policy secret_notification_visibility on public.recruitment_notifications as restrictive for all to authenticated using(app_private.secret_requisition_access(doc_id) and app_private.secret_application_access(application_id)) with check(app_private.secret_requisition_access(doc_id) and app_private.secret_application_access(application_id));

create or replace function public.app_secret_link_review_v1(payload jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_ids text[];v_group text:=nullif(payload->>'group_id','');v_secret boolean;
begin
 if auth.uid() is null or not app_private.is_recruitment_writer() then raise exception 'RECRUITMENT_READ_NOT_AUTHORIZED'; end if;
 if jsonb_typeof(payload->'doc_ids')='array' then select array_agg(value) into v_ids from jsonb_array_elements_text(payload->'doc_ids');else v_ids:=array[payload->>'doc_id'];end if;
 if cardinality(v_ids) is null or cardinality(v_ids)<1 or exists(select 1 from unnest(v_ids) id where not app_private.can_read_requisition(id)) then raise exception 'REQUISITION_UNAVAILABLE';end if;
 select bool_or(is_secret) into v_secret from public.requisitions where doc_id=any(v_ids);
 if (select count(*) from public.requisitions where doc_id=any(v_ids))<>cardinality(v_ids) then raise exception 'REQUISITION_UNAVAILABLE';end if;
 if v_group is not null and not app_private.secret_group_access(v_group) then raise exception 'GROUP_UNAVAILABLE';end if;
 return jsonb_build_object('requires_confirmation',coalesce(v_secret,false));
end $$;
revoke all on function public.app_secret_link_review_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_secret_link_review_v1(jsonb) to authenticated;
revoke all on function public.app_create_and_match_sourcing_group_v2(jsonb) from public,anon,authenticated;
grant execute on function public.app_create_and_match_sourcing_group_v2(jsonb) to authenticated;
