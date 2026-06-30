alter table public.requisitions
  add column if not exists replacement_names text;

alter table public.candidates
  add column if not exists candidate_folder_url text;

alter table public.offers
  drop column if exists offered_type,
  drop column if exists replaced;

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
  v_replacement_names text := nullif(payload ->> 'replacement_names', '');
begin
  perform public.assert_recruitment_writer();
  if v_doc_id is null then raise exception 'Doc ID is required.'; end if;
  if v_mode not in ('new', 'change') then raise exception 'mode must be new or change'; end if;
  if v_status not in ('ongoing', 'cancel') then raise exception 'Requisition status can only be ongoing or cancel. Filled is automatic.'; end if;
  if v_request_type not in ('New', 'Replacement') then raise exception 'Request type must be New or Replacement.'; end if;
  if v_request_type = 'Replacement' and v_replacement_names is null then raise exception 'Replacement names are required for replacement requisitions.'; end if;
  if v_request_type = 'New' then v_replacement_names := null; end if;

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
    head_count, person_in_charge, line_manager, request_type, replacement_names, status
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
    v_replacement_names,
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
    replacement_names = excluded.replacement_names,
    status = excluded.status;

  perform set_config('app.action', 'auto-status', true);
  perform public.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_doc_id);
end;
$$;

create or replace function public.app_upsert_candidate(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_doc_group_id text := nullif(payload ->> 'doc_group_id', '');
  v_exists boolean;
  v_initial_log_date date;
begin
  perform public.assert_recruitment_writer();
  if not public.can_manage_doc_group(v_doc_group_id) then raise exception 'You can create candidates only for requisitions where you are person in charge.'; end if;

  if v_mode = 'new' then
    v_candidate_id := public.next_app_id('candidates', 'CAN');
  elsif v_candidate_id is null then
    raise exception 'Candidate ID is required in Change mode.';
  end if;

  select exists(select 1 from public.candidates where candidate_id = v_candidate_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Candidate ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Candidate ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not public.can_manage_candidate(v_candidate_id) then raise exception 'You can edit candidates only for requisitions where you are person in charge.'; end if;

  perform set_config('app.action', 'candidate:' || v_mode, true);
  insert into public.candidates (candidate_id, name, phone_no, doc_group_id, channel, ref_name, first_contact_date, candidate_folder_url)
  values (
    v_candidate_id,
    nullif(payload ->> 'name', ''),
    nullif(payload ->> 'phone_no', ''),
    v_doc_group_id,
    nullif(payload ->> 'channel', ''),
    nullif(payload ->> 'ref_name', ''),
    nullif(payload ->> 'first_contact_date', '')::date,
    nullif(payload ->> 'candidate_folder_url', '')
  )
  on conflict (candidate_id) do update set
    name = excluded.name,
    phone_no = excluded.phone_no,
    doc_group_id = excluded.doc_group_id,
    channel = excluded.channel,
    ref_name = excluded.ref_name,
    first_contact_date = excluded.first_contact_date,
    candidate_folder_url = excluded.candidate_folder_url;

  if v_mode = 'new' then
    v_initial_log_date := coalesce(nullif(payload ->> 'first_contact_date', '')::date, current_date);
    perform set_config('app.action', 'recruitment_log:auto-phone-screen', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
    values (v_candidate_id, v_initial_log_date, 'Phone Screen', 1, null, null, 'Initial pending phone screening');
  end if;

  return jsonb_build_object('ok', true, 'id', v_candidate_id);
end;
$$;

create or replace function public.app_upsert_offer(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_exists boolean;
  v_offer_id bigint;
begin
  perform public.assert_recruitment_writer();
  if not public.can_manage_requisition(v_doc_id) or not public.can_manage_candidate(v_candidate_id) then
    raise exception 'You can create offers only for requisitions where you are person in charge.';
  end if;

  select exists(select 1 from public.offers where candidate_id = v_candidate_id and doc_id = v_doc_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'This offer already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'This offer does not exist. Switch to New mode to create it.'; end if;

  perform set_config('app.action', 'offer:' || v_mode, true);
  insert into public.offers (candidate_id, doc_id, accepted_date, first_working_date, remark)
  values (
    v_candidate_id,
    v_doc_id,
    nullif(payload ->> 'accepted_date', '')::date,
    nullif(payload ->> 'first_working_date', '')::date,
    nullif(payload ->> 'remark', '')
  )
  on conflict (candidate_id, doc_id) do update set
    accepted_date = excluded.accepted_date,
    first_working_date = excluded.first_working_date,
    remark = excluded.remark
  returning offer_id into v_offer_id;

  perform set_config('app.action', 'auto-status', true);
  perform public.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_offer_id::text);
end;
$$;
