alter table public.requisitions
  add column if not exists request_type text not null default 'New';

alter table public.requisitions
  drop constraint if exists requisitions_request_type_check;

alter table public.requisitions
  add constraint requisitions_request_type_check check (request_type in ('New', 'Replacement'));

create or replace function public.app_upsert_requisition(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_exists boolean;
  v_status text := coalesce(nullif(payload ->> 'status', ''), 'ongoing');
  v_role text := public.current_app_role();
  v_site text := nullif(payload ->> 'site', '');
  v_person_in_charge text := nullif(payload ->> 'person_in_charge', '');
  v_request_type text := coalesce(nullif(payload ->> 'request_type', ''), 'New');
begin
  perform public.assert_recruitment_writer();
  if v_mode not in ('new', 'change') then raise exception 'mode must be new or change'; end if;
  if v_status not in ('ongoing', 'cancel') then raise exception 'Requisition status can only be ongoing or cancel. Filled is automatic.'; end if;
  if v_request_type not in ('New', 'Replacement') then raise exception 'Request type must be New or Replacement.'; end if;

  if v_role = 'site_recruiter' then
    v_site := public.current_profile_site();
    v_person_in_charge := public.current_profile_nickname();
    if v_site is null or v_person_in_charge is null then
      raise exception 'Site recruiter accounts require assigned site and nickname.';
    end if;
  end if;

  select exists(select 1 from public.requisitions where doc_id = v_doc_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Requisition Doc ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Requisition Doc ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not public.can_manage_requisition(v_doc_id) then raise exception 'You can edit only requisitions where you are person in charge.'; end if;

  perform set_config('app.action', 'requisition:' || v_mode, true);

  insert into public.requisitions (
    doc_id, pr_approved_date, site, position, department, section, level,
    head_count, person_in_charge, line_manager, request_type, status
  )
  values (
    v_doc_id,
    nullif(payload ->> 'pr_approved_date', '')::date,
    v_site,
    nullif(payload ->> 'position', ''),
    nullif(payload ->> 'department', ''),
    nullif(payload ->> 'section', ''),
    nullif(payload ->> 'level', ''),
    coalesce(nullif(payload ->> 'head_count', '')::integer, 1),
    v_person_in_charge,
    nullif(payload ->> 'line_manager', ''),
    v_request_type,
    v_status
  )
  on conflict (doc_id) do update set
    pr_approved_date = excluded.pr_approved_date,
    site = excluded.site,
    position = excluded.position,
    department = excluded.department,
    section = excluded.section,
    level = excluded.level,
    head_count = excluded.head_count,
    person_in_charge = excluded.person_in_charge,
    line_manager = excluded.line_manager,
    request_type = excluded.request_type,
    status = excluded.status;

  perform set_config('app.action', 'auto-status', true);
  perform public.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_doc_id);
end;
$$;
