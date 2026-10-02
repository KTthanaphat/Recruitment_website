begin;

alter table public.requisition_logs drop constraint if exists requisition_logs_doc_id_fkey;
alter table public.requisition_logs add constraint requisition_logs_doc_id_fkey foreign key (doc_id) references public.requisitions(doc_id) on update cascade on delete cascade;

alter table public.document_groups drop constraint if exists document_groups_doc_id_fkey;
alter table public.document_groups add constraint document_groups_doc_id_fkey foreign key (doc_id) references public.requisitions(doc_id) on update cascade on delete cascade;

alter table public.offers drop constraint if exists offers_doc_id_fkey;
alter table public.offers add constraint offers_doc_id_fkey foreign key (doc_id) references public.requisitions(doc_id) on update cascade on delete cascade;

alter table public.candidate_requisitions drop constraint if exists candidate_requisitions_doc_id_fkey;
alter table public.candidate_requisitions add constraint candidate_requisitions_doc_id_fkey foreign key (doc_id) references public.requisitions(doc_id) on update cascade on delete cascade;
create or replace function app_private.associate_candidate_with_offer_requisition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The requisition primary-key cascade moves the candidate link itself.
  -- Avoid inserting a duplicate link while dependent rows are cascading.
  if tg_op = 'UPDATE' and current_setting('app.action', true) = 'requisition:change' then
    return new;
  end if;
  insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
  values (new.candidate_id, new.doc_id, auth.uid())
  on conflict (candidate_id, doc_id) do nothing;
  return new;
end;
$$;

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

  select d.department_th, coalesce(d.section_th, v_section) into v_department, v_section
  from public.department_section_directory d
  where d.site = v_site
    and (v_department = d.department_th or v_department = d.department_en)
    and (v_section is null or v_section = d.section_th or v_section = d.section_en)
  limit 1;

  perform set_config('app.action', 'requisition:' || v_mode, true);

  if v_mode = 'change' then
    update public.requisitions set
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
      doc_id, pr_approved_date, site, position, department, section, level,
      head_count, person_in_charge, line_manager, request_type, replacement_names, status
    )
    values (
      v_doc_id,
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
commit;
