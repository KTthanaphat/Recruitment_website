-- Canonical declarative schema source. Edit this file set, not historical migrations.

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
  v_role text := app_private.current_app_role();
  v_site text := nullif(payload ->> 'site', '');
  v_person_in_charge text := nullif(payload ->> 'person_in_charge', '');
  v_request_type text := coalesce(nullif(payload ->> 'request_type', ''), 'New');
  v_replacement_names text := nullif(payload ->> 'replacement_names', '');
begin
  perform app_private.assert_recruitment_writer();
  if v_doc_id is null then raise exception 'Doc ID is required.'; end if;
  if v_mode not in ('new', 'change') then raise exception 'mode must be new or change'; end if;
  if v_status not in ('ongoing', 'cancel') then raise exception 'Requisition status can only be ongoing or cancel. Filled is automatic.'; end if;
  if v_request_type not in ('New', 'Replacement') then raise exception 'Request type must be New or Replacement.'; end if;
  if v_request_type = 'Replacement' and v_replacement_names is null then raise exception 'Replacement names are required for replacement requisitions.'; end if;
  if v_request_type = 'New' then v_replacement_names := null; end if;

  if v_role = 'site_recruiter' then
    v_site := app_private.current_profile_site();
    v_person_in_charge := app_private.current_profile_nickname();
    if v_site is null or v_person_in_charge is null then
      raise exception 'Site recruiter accounts require assigned site and nickname.';
    end if;
  end if;

  select exists(select 1 from public.requisitions where doc_id = v_doc_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Requisition Doc ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Requisition Doc ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_requisition(v_doc_id) then raise exception 'You can edit only requisitions where you are person in charge.'; end if;

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
  perform app_private.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_doc_id);
end;
$$;

create or replace function public.app_insert_requisition_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_status text := nullif(payload ->> 'status', '');
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_requisition(v_doc_id) then raise exception 'You can update status only for requisitions where you are person in charge.'; end if;
  if v_status not in ('ongoing', 'filled', 'cancel') then raise exception 'Status must be ongoing, filled, or cancel.'; end if;

  perform set_config('app.action', 'requisition:status', true);
  insert into public.requisition_logs (doc_id, log_date, status, remark)
  values (v_doc_id, nullif(payload ->> 'log_date', '')::date, v_status, nullif(payload ->> 'remark', ''));

  update public.requisitions set status = v_status where doc_id = v_doc_id;
  perform set_config('app.action', 'auto-status', true);
  perform app_private.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.app_upsert_position_group(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_exists boolean;
begin
  perform app_private.assert_recruitment_writer();
  if v_mode not in ('new', 'change') then
    raise exception 'mode must be new or change';
  end if;
  if v_mode = 'new' then
    v_group_id := app_private.next_app_id('position_groups', 'GRP');
  elsif v_group_id is null then
    raise exception 'Group ID is required in Change mode.';
  end if;

  select exists(select 1 from public.position_groups where group_id = v_group_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Group ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Group ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_sourcing_group(v_group_id) then
    raise exception 'You can edit only sourcing groups linked to requisitions where you are responsible.';
  end if;

  perform set_config('app.action', 'position_group:' || v_mode, true);
  insert into public.position_groups (
    group_id, group_position,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb,
    channel_linkedin, channel_walkin, channel_referral, channel_others
  )
  values (
    v_group_id,
    nullif(payload ->> 'group_position', ''),
    coalesce((payload ->> 'channel_fb')::boolean, false),
    coalesce((payload ->> 'channel_jobthai')::boolean, false),
    coalesce((payload ->> 'channel_jobtopgun')::boolean, false),
    coalesce((payload ->> 'channel_jobdb')::boolean, false),
    coalesce((payload ->> 'channel_linkedin')::boolean, false),
    coalesce((payload ->> 'channel_walkin')::boolean, false),
    coalesce((payload ->> 'channel_referral')::boolean, false),
    coalesce((payload ->> 'channel_others')::boolean, false)
  )
  on conflict (group_id) do update set
    group_position = excluded.group_position,
    channel_fb = excluded.channel_fb,
    channel_jobthai = excluded.channel_jobthai,
    channel_jobtopgun = excluded.channel_jobtopgun,
    channel_jobdb = excluded.channel_jobdb,
    channel_linkedin = excluded.channel_linkedin,
    channel_walkin = excluded.channel_walkin,
    channel_referral = excluded.channel_referral,
    channel_others = excluded.channel_others;

  return jsonb_build_object('ok', true, 'id', v_group_id);
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

  v_doc_group_id := app_private.next_app_id('document_groups', 'DGRP');
  perform set_config('app.action', 'document_group:new', true);
  insert into public.document_groups (
    doc_group_id, doc_id, group_id, group_position,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb,
    channel_linkedin, channel_walkin, channel_referral, channel_others
  )
  values (
    v_doc_group_id, v_doc_id, v_group_id, v_group.group_position,
    v_group.channel_fb, v_group.channel_jobthai, v_group.channel_jobtopgun, v_group.channel_jobdb,
    v_group.channel_linkedin, v_group.channel_walkin, v_group.channel_referral, v_group.channel_others
  );

  return jsonb_build_object('ok', true, 'id', v_doc_group_id);
end;
$$;

create or replace function public.app_unmatch_group_requisition(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_group_id text := nullif(payload ->> 'doc_group_id', '');
  v_references jsonb := coalesce(payload -> 'references', '[]'::jsonb);
  v_reference jsonb;
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_match public.document_groups%rowtype;
begin
  perform app_private.assert_recruitment_writer();

  if v_doc_group_id is not null then
    select * into v_match
    from public.document_groups
    where doc_group_id = v_doc_group_id;
  else
    if v_doc_id is null or v_group_id is null then
      raise exception 'Doc ID and Group ID are required to unmatch.';
    end if;

    select * into v_match
    from public.document_groups
    where doc_id = v_doc_id
      and group_id = v_group_id;
  end if;

  if not found then
    raise exception 'Group requisition match does not exist.';
  end if;

  if v_match.group_id is null then
    raise exception 'This requisition is not linked to an active sourcing group.';
  end if;

  if not app_private.can_manage_requisition(v_match.doc_id) then
    raise exception 'You can unmatch only requisitions where you are person in charge.';
  end if;

  if not app_private.can_manage_sourcing_group(v_match.group_id) then
    raise exception 'You can unmatch only sourcing groups where you are responsible.';
  end if;

  if exists(select 1 from public.candidates where doc_group_id = v_match.doc_group_id) then
    raise exception 'Cannot unmatch because candidates are linked to this match.';
  end if;

  perform set_config('app.action', 'document_group:unmatch', true);
  delete from public.document_groups
  where doc_group_id = v_match.doc_group_id;

  return jsonb_build_object('ok', true, 'id', v_match.doc_group_id);
end;
$$;

create or replace function app_private.assert_pipeline_log_deletable(p_log_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.recruitment_logs where log_id = p_log_id and superseded_at is null) then
    raise exception 'Canonical pipeline stage records cannot be deleted; use app_correct_pipeline_outcome_v2.';
  end if;
end;
$$;

create or replace function public.app_delete_recruitment_record(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(payload ->> 'entity', '');
  v_id text := nullif(payload ->> 'id', '');
  v_week_start date := nullif(payload ->> 'week_start', '')::date;
  v_deleted integer := 0;
begin
  perform app_private.assert_system_admin();

  if v_entity is null or v_id is null then
    raise exception 'Entity and ID are required.';
  end if;

  if v_entity = 'requisition' then
    if exists (
      select 1
      from public.candidates c
      join public.document_groups dg on dg.doc_group_id = c.doc_group_id
      where dg.doc_id = v_id
    ) then
      raise exception 'Cannot delete requisition because candidates are linked to it.';
    end if;

    perform set_config('app.action', 'requisition:delete', true);
    delete from public.requisitions where doc_id = v_id;

  elsif v_entity = 'requisition_log' then
    perform set_config('app.action', 'requisition_log:delete', true);
    delete from public.requisition_logs where log_id = v_id::bigint;

  elsif v_entity = 'position_group' then
    if exists(select 1 from public.document_groups where group_id = v_id) then
      raise exception 'Cannot delete sourcing group because requisitions are matched to it.';
    end if;

    perform set_config('app.action', 'position_group:delete', true);
    delete from public.position_groups where group_id = v_id;

  elsif v_entity = 'document_group' then
    if exists(select 1 from public.candidates where doc_group_id = v_id) then
      raise exception 'Cannot delete match because candidates are linked to it.';
    end if;

    perform set_config('app.action', 'document_group:delete', true);
    delete from public.document_groups where doc_group_id = v_id;

  elsif v_entity = 'candidate' then
    perform set_config('app.action', 'candidate:delete', true);
    delete from public.candidates where candidate_id = v_id;

  elsif v_entity = 'recruitment_log' then
    perform app_private.assert_pipeline_log_deletable(v_id::bigint);
    perform set_config('app.action', 'recruitment_log:delete', true);
    delete from public.recruitment_logs where log_id = v_id::bigint;

  elsif v_entity = 'offer' then
    perform set_config('app.action', 'offer:delete', true);
    delete from public.offers where offer_id = v_id::bigint;

  elsif v_entity = 'sourcing_weekly_update' then
    if v_week_start is null then
      raise exception 'Week start is required to delete a sourcing weekly update.';
    end if;

    perform set_config('app.action', 'sourcing_update:delete', true);
    delete from public.sourcing_weekly_updates
    where group_id = v_id
      and week_start = v_week_start;

  elsif v_entity = 'vacancy_weekly_snapshot' then
    perform set_config('app.action', 'vacancy_snapshot:delete', true);
    delete from public.vacancy_weekly_snapshots where snapshot_id = v_id::bigint;

  else
    raise exception 'Delete is not allowed for entity "%".', v_entity;
  end if;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Record not found.';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'entity', v_entity);
end;
$$;

create or replace function public.app_upsert_sourcing_weekly_update(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_week_start date := nullif(payload ->> 'week_start', '')::date;
  v_group public.position_groups%rowtype;
begin
  perform app_private.assert_recruitment_writer();
  if v_group_id is null then raise exception 'Group ID is required.'; end if;
  if v_week_start is null then raise exception 'Week start is required.'; end if;
  if not app_private.has_open_group_requisition(v_group_id) then raise exception 'Group has no unfilled active requisition.'; end if;
  if not app_private.can_manage_sourcing_group(v_group_id) then raise exception 'You can update only sourcing groups where you are responsible.'; end if;
  select * into v_group from public.position_groups where group_id = v_group_id;

  perform set_config('app.action', 'sourcing_update:upsert', true);
  insert into public.sourcing_weekly_updates (
    group_id, week_start,
    channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb,
    channel_linkedin, channel_walkin, channel_referral, channel_others,
    applicants_fb, applicants_jobthai, applicants_jobtopgun, applicants_jobdb,
    applicants_linkedin, applicants_walkin, applicants_referral, applicants_others,
    updated_by
  )
  values (
    v_group_id,
    v_week_start,
    case when payload ? 'channel_fb' then (payload ->> 'channel_fb')::boolean else coalesce(v_group.channel_fb, false) end,
    case when payload ? 'channel_jobthai' then (payload ->> 'channel_jobthai')::boolean else coalesce(v_group.channel_jobthai, false) end,
    case when payload ? 'channel_jobtopgun' then (payload ->> 'channel_jobtopgun')::boolean else coalesce(v_group.channel_jobtopgun, false) end,
    case when payload ? 'channel_jobdb' then (payload ->> 'channel_jobdb')::boolean else coalesce(v_group.channel_jobdb, false) end,
    case when payload ? 'channel_linkedin' then (payload ->> 'channel_linkedin')::boolean else coalesce(v_group.channel_linkedin, false) end,
    case when payload ? 'channel_walkin' then (payload ->> 'channel_walkin')::boolean else coalesce(v_group.channel_walkin, false) end,
    case when payload ? 'channel_referral' then (payload ->> 'channel_referral')::boolean else coalesce(v_group.channel_referral, false) end,
    case when payload ? 'channel_others' then (payload ->> 'channel_others')::boolean else coalesce(v_group.channel_others, false) end,
    coalesce(nullif(payload ->> 'applicants_fb', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_jobthai', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_jobtopgun', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_jobdb', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_linkedin', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_walkin', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_referral', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_others', '')::integer, 0),
    auth.uid()
  )
  on conflict (group_id, week_start) do update set
    channel_fb = case when payload ? 'channel_fb' then excluded.channel_fb else sourcing_weekly_updates.channel_fb end,
    channel_jobthai = case when payload ? 'channel_jobthai' then excluded.channel_jobthai else sourcing_weekly_updates.channel_jobthai end,
    channel_jobtopgun = case when payload ? 'channel_jobtopgun' then excluded.channel_jobtopgun else sourcing_weekly_updates.channel_jobtopgun end,
    channel_jobdb = case when payload ? 'channel_jobdb' then excluded.channel_jobdb else sourcing_weekly_updates.channel_jobdb end,
    channel_linkedin = case when payload ? 'channel_linkedin' then excluded.channel_linkedin else sourcing_weekly_updates.channel_linkedin end,
    channel_walkin = case when payload ? 'channel_walkin' then excluded.channel_walkin else sourcing_weekly_updates.channel_walkin end,
    channel_referral = case when payload ? 'channel_referral' then excluded.channel_referral else sourcing_weekly_updates.channel_referral end,
    channel_others = case when payload ? 'channel_others' then excluded.channel_others else sourcing_weekly_updates.channel_others end,
    applicants_fb = excluded.applicants_fb,
    applicants_jobthai = excluded.applicants_jobthai,
    applicants_jobtopgun = excluded.applicants_jobtopgun,
    applicants_jobdb = excluded.applicants_jobdb,
    applicants_linkedin = excluded.applicants_linkedin,
    applicants_walkin = excluded.applicants_walkin,
    applicants_referral = excluded.applicants_referral,
    applicants_others = excluded.applicants_others,
    updated_by = excluded.updated_by;

  return jsonb_build_object('ok', true, 'id', v_group_id);
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
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_doc_group(v_doc_group_id) then raise exception 'You can create candidates only for requisitions where you are person in charge.'; end if;

  if v_mode = 'new' then
    v_candidate_id := app_private.next_app_id('candidates', 'CAN');
  elsif v_candidate_id is null then
    raise exception 'Candidate ID is required in Change mode.';
  end if;

  select exists(select 1 from public.candidates where candidate_id = v_candidate_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Candidate ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Candidate ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can edit candidates only for requisitions where you are person in charge.'; end if;

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

  for v_reference in select value from jsonb_array_elements(v_references) loop
    if nullif(btrim(coalesce(v_reference ->> 'reference_name', '')), '') is null
      or nullif(btrim(coalesce(v_reference ->> 'relationship', '')), '') is null
      or lower(coalesce(nullif(v_reference ->> 'channel_type', ''), '')) not in ('phone', 'email', 'line', 'other')
      or nullif(btrim(coalesce(v_reference ->> 'channel_value', '')), '') is null
      or (lower(v_reference ->> 'channel_type') = 'other' and nullif(btrim(coalesce(v_reference ->> 'other_channel_label', '')), '') is null)
    then
      raise exception 'REFERENCE_INVALID_PAYLOAD: Each candidate reference needs name, relationship, channel, and contact value; Other requires a label.';
    end if;
    perform set_config('app.action', 'candidate-reference:add', true);
    insert into public.candidate_references (
      candidate_id, reference_name, relationship, channel_type, channel_value, other_channel_label, created_by, updated_by
    ) values (
      v_candidate_id, btrim(v_reference ->> 'reference_name'), btrim(v_reference ->> 'relationship'), lower(v_reference ->> 'channel_type'),
      btrim(v_reference ->> 'channel_value'), case when lower(v_reference ->> 'channel_type') = 'other' then nullif(btrim(v_reference ->> 'other_channel_label'), '') else null end,
      auth.uid(), auth.uid()
    );
  end loop;

  if v_mode = 'new' then
    v_initial_log_date := coalesce(nullif(payload ->> 'first_contact_date', '')::date, current_date);
    if v_initial_log_date > (now() at time zone 'Asia/Bangkok')::date then
      raise exception 'PIPELINE_DATE_ORDER: Initial Pending date cannot be after the Bangkok business date.';
    end if;
    perform set_config('app.action', 'recruitment_log:auto-phone-screen', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin)
    values (v_candidate_id, v_initial_log_date, 'Phone Screen', 1, null, null, 'Initial pending phone screening', 'auto');
  end if;

  return jsonb_build_object('ok', true, 'id', v_candidate_id);
end;
$$;

create or replace function public.app_insert_recruitment_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage text := nullif(payload ->> 'recruitment_process', '');
  v_result smallint := nullif(payload ->> 'result', '')::smallint;
  v_source text := coalesce(nullif(payload ->> 'source', ''), 'manual');
  v_current_stage text;
  v_current_result smallint;
  v_current_index integer;
  v_next_index integer;
  v_log_id bigint;
  v_stages text[] := array[
    'First Contact', 'Phone Screen', 'HR Interview', 'Line Interview', 'Test',
    'Reference Check', 'Offer', 'Rejected', 'Withdrawn'
  ];
  v_active_stages text[] := array[
    'Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer'
  ];
  v_auto_next_stage text;
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result
    into v_current_stage, v_current_result
  from public.recruitment_logs
  where candidate_id = v_candidate_id
  order by log_id desc
  limit 1;

  if v_source = 'pipeline' then
    v_current_index := coalesce(array_position(v_stages, v_current_stage), 0);
    v_next_index := coalesce(array_position(v_stages, v_stage), 0);

    if v_next_index <= v_current_index then
      raise exception 'Pipeline cards can move forward only.';
    end if;
  end if;

  perform set_config('app.action', 'recruitment_log:new', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    nullif(payload ->> 'log_date', '')::date,
    v_stage,
    coalesce(nullif(payload ->> 'round', '')::integer, 1),
    nullif(payload ->> 'interviewer', ''),
    v_result,
    nullif(payload ->> 'remark', '')
  )
  returning log_id into v_log_id;

  if v_result = 1
    and v_current_stage = v_stage
    and v_current_result is null
    and array_position(v_active_stages, v_stage) is not null
    and array_position(v_active_stages, v_stage) < array_length(v_active_stages, 1)
  then
    v_auto_next_stage := v_active_stages[array_position(v_active_stages, v_stage) + 1];
    perform set_config('app.action', 'recruitment_log:auto-next-pending', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
    values (
      v_candidate_id,
      nullif(payload ->> 'log_date', '')::date,
      v_auto_next_stage,
      1,
      null,
      null,
      'Auto-progressed after pass'
    );
  end if;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'id', v_log_id::text);
end;
$$;

create or replace function public.app_insert_pipeline_passes(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_target_stage text := nullif(payload ->> 'target_stage', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_current_stage text;
  v_current_result smallint;
  v_current_index integer;
  v_target_index integer;
  v_stage_count integer := jsonb_array_length(v_stages);
  v_active_stages text[] := array[
    'Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer'
  ];
  v_item jsonb;
  v_expected_stage text;
  v_log_id bigint;
  v_pass_stage text;
  v_pass_round integer;
  v_pass_date date;
begin
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if v_target_stage is null then raise exception 'Target stage is required.'; end if;
  if v_stage_count = 0 then raise exception 'At least one passed stage is required.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result
    into v_current_stage, v_current_result
  from public.recruitment_logs
  where candidate_id = v_candidate_id
  order by log_id desc
  limit 1;

  v_current_index := coalesce(array_position(v_active_stages, v_current_stage), 0);
  v_target_index := coalesce(array_position(v_active_stages, v_target_stage), 0);

  if v_current_index = 0 then raise exception 'Candidate is not in an active pipeline stage.'; end if;
  if v_current_result is not null then raise exception 'Latest candidate stage is already completed.'; end if;
  if v_target_index <= v_current_index then raise exception 'Pipeline cards can move forward only.'; end if;
  if v_target_index <> v_current_index + v_stage_count then
    raise exception 'All passed stages between current and target must be confirmed.';
  end if;

  for v_item in select value from jsonb_array_elements(v_stages)
  loop
    v_expected_stage := v_active_stages[v_current_index + coalesce((v_item ->> 'index')::integer, 0)];
    if nullif(v_item ->> 'stage', '') <> v_expected_stage then
      raise exception 'Passed stages must be consecutive from the current stage.';
    end if;
  end loop;

  perform set_config('app.action', 'recruitment_log:pipeline-pass', true);
  for v_item in select value from jsonb_array_elements(v_stages)
  loop
    v_pass_stage := nullif(v_item ->> 'stage', '');
    v_pass_round := coalesce(nullif(v_item ->> 'round', '')::integer, 1);
    v_pass_date := nullif(v_item ->> 'log_date', '')::date;
    if v_pass_stage is null or v_pass_date is null then
      raise exception 'Every crossed stage needs a stage and result date.';
    end if;
    if v_pass_round < 1 then
      raise exception 'Every crossed stage needs a valid round.';
    end if;

    perform set_config('app.action', 'recruitment_log:pipeline-pending', true);
    if not exists (
      select 1
      from public.recruitment_logs
      where candidate_id = v_candidate_id
        and recruitment_process = v_pass_stage
        and round = v_pass_round
        and result is null
    ) then
      insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
      values (
        v_candidate_id,
        v_pass_date,
        v_pass_stage,
        v_pass_round,
        nullif(v_item ->> 'interviewer', ''),
        null,
        coalesce(nullif(v_item ->> 'pending_remark', ''), 'Pending stage confirmed before pipeline pass')
      )
      returning log_id into v_log_id;
    end if;

    perform set_config('app.action', 'recruitment_log:pipeline-pass', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
    values (
      v_candidate_id,
      v_pass_date,
      v_pass_stage,
      v_pass_round,
      nullif(v_item ->> 'interviewer', ''),
      1,
      nullif(v_item ->> 'remark', '')
    )
    returning log_id into v_log_id;
  end loop;

  perform set_config('app.action', 'recruitment_log:auto-next-pending', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    coalesce(nullif((v_stages -> (v_stage_count - 1)) ->> 'log_date', '')::date, current_date),
    v_target_stage,
    1,
    null,
    null,
    'Auto-created pending stage after pipeline drag and drop'
  );

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'id', v_log_id::text);
end;
$$;

create or replace function public.app_insert_test_maintenance(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_current_test jsonb := coalesce(payload -> 'current_test', '{}'::jsonb);
  v_next_test jsonb := coalesce(payload -> 'next_test', '{}'::jsonb);
  v_current_stage text;
  v_current_result smallint;
  v_latest_round integer;
  v_current_round integer := coalesce(nullif(v_current_test ->> 'round', '')::integer, 1);
  v_next_round integer := coalesce(nullif(v_next_test ->> 'round', '')::integer, v_current_round + 1);
  v_log_id bigint;
begin
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result, round
    into v_current_stage, v_current_result, v_latest_round
  from public.recruitment_logs
  where candidate_id = v_candidate_id
  order by log_id desc
  limit 1;

  if v_current_stage <> 'Test' or v_current_result is not null then
    raise exception 'Candidate must be in a pending Test round.';
  end if;
  if v_current_round <> v_latest_round then
    raise exception 'Current Test round does not match the latest pending Test round.';
  end if;
  if v_next_round <= v_current_round then
    raise exception 'Next Test round must be greater than the current round.';
  end if;

  perform set_config('app.action', 'recruitment_log:test-current-pass', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    nullif(v_current_test ->> 'log_date', '')::date,
    'Test',
    v_current_round,
    nullif(v_current_test ->> 'interviewer', ''),
    1,
    nullif(v_current_test ->> 'remark', '')
  )
  returning log_id into v_log_id;

  perform set_config('app.action', 'recruitment_log:test-next-pending', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    nullif(v_next_test ->> 'log_date', '')::date,
    'Test',
    v_next_round,
    nullif(v_next_test ->> 'interviewer', ''),
    null,
    nullif(v_next_test ->> 'remark', '')
  )
  returning log_id into v_log_id;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'id', v_log_id::text);
end;
$$;

create or replace function public.app_insert_pipeline_test_exit(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_target_stage text := nullif(payload ->> 'target_stage', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_extra_rounds jsonb := coalesce(payload -> 'extra_test_rounds', '[]'::jsonb);
  v_stage_count integer := jsonb_array_length(v_stages);
  v_current_stage text;
  v_current_result smallint;
  v_latest_round integer;
  v_pass_stage jsonb;
  v_pass_round integer;
  v_item jsonb;
  v_log_id bigint;
begin
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if v_target_stage <> 'Reference Check' then raise exception 'Test exit target must be Reference Check.'; end if;
  if v_stage_count <> 1 then raise exception 'Test exit must pass exactly one Test stage.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result, round
    into v_current_stage, v_current_result, v_latest_round
  from public.recruitment_logs
  where candidate_id = v_candidate_id
  order by log_id desc
  limit 1;

  if v_current_stage <> 'Test' or v_current_result is not null then
    raise exception 'Candidate must be in a pending Test round.';
  end if;

  v_pass_stage := v_stages -> 0;
  if nullif(v_pass_stage ->> 'stage', '') <> 'Test' then
    raise exception 'Test exit must pass the Test stage.';
  end if;
  v_pass_round := coalesce(nullif(v_pass_stage ->> 'round', '')::integer, 1);
  if v_pass_round <> v_latest_round then
    raise exception 'Test exit pass round must match the latest pending Test round.';
  end if;

  perform set_config('app.action', 'recruitment_log:test-extra-pending', true);
  for v_item in select value from jsonb_array_elements(v_extra_rounds)
  loop
    if coalesce(nullif(v_item ->> 'round', '')::integer, 0) <= v_pass_round then
      raise exception 'Additional Test rounds must be greater than the pass round.';
    end if;
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
    values (
      v_candidate_id,
      nullif(v_item ->> 'log_date', '')::date,
      'Test',
      coalesce(nullif(v_item ->> 'round', '')::integer, v_pass_round + 1),
      nullif(v_item ->> 'interviewer', ''),
      null,
      nullif(v_item ->> 'remark', '')
    )
    returning log_id into v_log_id;
  end loop;

  perform set_config('app.action', 'recruitment_log:test-pass', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    nullif(v_pass_stage ->> 'log_date', '')::date,
    'Test',
    v_pass_round,
    nullif(v_pass_stage ->> 'interviewer', ''),
    1,
    nullif(v_pass_stage ->> 'remark', '')
  )
  returning log_id into v_log_id;

  perform set_config('app.action', 'recruitment_log:auto-next-pending', true);
  insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
  values (
    v_candidate_id,
    coalesce(nullif(v_pass_stage ->> 'log_date', '')::date, current_date),
    'Reference Check',
    1,
    null,
    null,
    'Auto-created pending stage after Test exit'
  );

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'id', v_log_id::text);
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
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_requisition(v_doc_id) or not app_private.can_manage_candidate(v_candidate_id) then
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
  perform app_private.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_offer_id::text);
end;
$$;

create or replace function public.app_upsert_vacancy_weekly_snapshot(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_week_start date := nullif(payload ->> 'week_start', '')::date;
  v_category text := nullif(payload ->> 'waterfall_category', '');
  v_site text := nullif(payload ->> 'site', '');
  v_request_type text := nullif(payload ->> 'request_type', '');
  v_snapshot_id bigint;
begin
  if app_private.current_app_role() not in ('system_admin', 'admin_recruiter') then
    raise exception 'System admin or admin recruiter role is required.';
  end if;
  if v_week_start is null then raise exception 'Week start is required.'; end if;
  if v_category not in ('Week Start', 'Open', 'Filled', 'Total') then raise exception 'Invalid waterfall category.'; end if;
  if v_site is null then raise exception 'Site is required.'; end if;
  if v_request_type not in ('New', 'Replacement') then raise exception 'Invalid request type.'; end if;

  perform set_config('app.action', 'vacancy_snapshot:upsert', true);
  insert into public.vacancy_weekly_snapshots (
    week_start, waterfall_category, site, request_type, vacancy_count, updated_by
  )
  values (
    v_week_start,
    v_category,
    v_site,
    v_request_type,
    coalesce(nullif(payload ->> 'vacancy_count', '')::integer, 0),
    auth.uid()
  )
  on conflict (week_start, waterfall_category, site, request_type) do update set
    vacancy_count = excluded.vacancy_count,
    updated_by = excluded.updated_by
  returning snapshot_id into v_snapshot_id;

  return jsonb_build_object('ok', true, 'id', v_snapshot_id::text);
end;
$$;

-- Candidate pipeline v2. A canonical row owns both the editable Pending fields
-- and its immutable Outcome. Superseded rows remain available for audit/history.
create or replace function app_private.pipeline_stage_index(p_stage text)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select array_position(
    array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[],
    p_stage
  )
$$;

create or replace function app_private.pipeline_business_date()
returns date
language sql
stable
set search_path = pg_catalog
as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;

create or replace function app_private.lock_pipeline_candidate(p_candidate_id text)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  perform app_private.assert_recruitment_writer();
  if p_candidate_id is null then raise exception 'PIPELINE_CANDIDATE_REQUIRED: Candidate is required.'; end if;
  if not app_private.can_manage_candidate(p_candidate_id) then
    raise exception 'PIPELINE_NOT_AUTHORIZED: You can update process only for candidates where you are person in charge.';
  end if;
  perform 1 from public.candidates where candidate_id = p_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;
end;
$$;

create or replace function public.app_start_pipeline_stage_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_pending jsonb := coalesce(payload -> 'pending', '{}'::jsonb);
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_row public.recruitment_logs%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_opened_date is null then raise exception 'PIPELINE_INVALID_PAYLOAD: Pending opened date is required.'; end if;
  if v_opened_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Pending opened date cannot be after the Bangkok business date.';
  end if;
  if exists (
    select 1 from public.recruitment_logs
    where candidate_id = v_candidate_id and superseded_at is null
  ) then
    raise exception 'PIPELINE_INVALID_TRANSITION: A canonical Pipeline stage already exists.';
  end if;

  perform set_config('app.action', 'pipeline:start', true);
  insert into public.recruitment_logs (
    candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin
  ) values (
    v_candidate_id, v_opened_date, 'Phone Screen', 1,
    nullif(v_pending ->> 'interviewer', ''), null, nullif(v_pending ->> 'remark', ''), 'user'
  ) returning * into v_row;
  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'id', v_row.log_id::text,
    'stage_instance_id', v_row.stage_instance_id,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.app_update_pipeline_pending_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_pending jsonb := coalesce(payload -> 'pending', '{}'::jsonb);
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_previous_outcome_date date;
  v_row public.recruitment_logs%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage_instance_id, expected_updated_at, and pending.opened_date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id
    and stage_instance_id = v_stage_instance_id
    and superseded_at is null
  for update;

  if not found or v_row.result is not null then
    raise exception 'PIPELINE_NOT_CURRENT: The selected stage is not the current Pending stage.';
  end if;
  if v_row.updated_at <> v_expected_updated_at then
    raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.';
  end if;
  if exists (
    select 1 from public.recruitment_logs later
    where later.candidate_id = v_candidate_id
      and later.superseded_at is null
      and later.log_id > v_row.log_id
  ) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Pending opened date must be between the previous Outcome and the Bangkok business date.';
  end if;

  perform set_config('app.action', 'pipeline:pending-edit', true);
  update public.recruitment_logs
  set log_date = v_opened_date,
      interviewer = nullif(v_pending ->> 'interviewer', ''),
      remark = nullif(v_pending ->> 'remark', ''),
      pending_edited_at = now(),
      pending_edited_by = auth.uid()
  where log_id = v_row.log_id
  returning * into v_row;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'stage_instance_id', v_row.stage_instance_id, 'updated_at', v_row.updated_at);
end;
$$;

create or replace function public.app_complete_pipeline_stage_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_pending jsonb := coalesce(payload -> 'pending', '{}'::jsonb);
  v_outcome jsonb := coalesce(payload -> 'outcome', '{}'::jsonb);
  v_next jsonb := coalesce(payload -> 'next_pending', '{}'::jsonb);
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_next_stage text := nullif(v_next ->> 'stage', '');
  v_next_round integer := coalesce(nullif(v_next ->> 'round', '')::integer, 1);
  v_next_opened_date date := nullif(v_next ->> 'opened_date', '')::date;
  v_expected_next_stage text;
  v_previous_outcome_date date;
  v_row public.recruitment_logs%rowtype;
  v_next_row public.recruitment_logs%rowtype;
  v_next_id uuid;
  v_handoff jsonb;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null or v_outcome_date is null or v_result is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage instance, expected timestamp, Pending date, and Pass/Fail outcome date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id
    and stage_instance_id = v_stage_instance_id
    and superseded_at is null
  for update;

  if not found or v_row.result is not null then raise exception 'PIPELINE_NOT_CURRENT: The selected stage is not Pending.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.superseded_at is null and later.log_id > v_row.log_id) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or v_outcome_date > app_private.pipeline_business_date()
    or v_outcome_date < v_opened_date
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must satisfy previous Outcome <= Pending <= Outcome <= Bangkok business date.';
  end if;

  if v_result = 0 then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Fail cannot create a next Pending stage.'; end if;
  elsif v_row.recruitment_process = 'Offer' then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Offer Pass uses handoff and cannot create a next Pending stage.'; end if;
  elsif v_row.recruitment_process = 'Test' and v_next_stage = 'Test' then
    if v_next_round <> v_row.round + 1 then raise exception 'PIPELINE_INVALID_TRANSITION: The next Test round must be current round plus one.'; end if;
  else
    v_expected_next_stage := (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[app_private.pipeline_stage_index(v_row.recruitment_process) + 1];
    if v_next_stage is distinct from v_expected_next_stage or v_next_round <> 1 then
      raise exception 'PIPELINE_NEXT_PENDING_REQUIRED: Pass must create the immediate next stage as round 1 Pending.';
    end if;
  end if;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    if v_next_opened_date is null or v_next_opened_date < v_outcome_date or v_next_opened_date > app_private.pipeline_business_date() then
      raise exception 'PIPELINE_DATE_ORDER: Next Pending opened date must be between the Outcome and Bangkok business date.';
    end if;
  end if;

  perform set_config('app.action', case when v_result = 1 then 'pipeline:pass' else 'pipeline:fail' end, true);
  update public.recruitment_logs
  set log_date = v_opened_date,
      interviewer = nullif(v_pending ->> 'interviewer', ''),
      remark = nullif(v_pending ->> 'remark', ''),
      pending_edited_at = now(),
      pending_edited_by = auth.uid(),
      result = v_result,
      outcome_date = v_outcome_date,
      outcome_interviewer = nullif(v_outcome ->> 'interviewer', ''),
      outcome_remark = nullif(v_outcome ->> 'remark', ''),
      outcome_recorded_at = now()
  where log_id = v_row.log_id
  returning * into v_row;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    v_next_id := gen_random_uuid();
    perform set_config('app.action', 'pipeline:next-pending', true);
    insert into public.recruitment_logs (
      stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin
    ) values (
      v_next_id, v_candidate_id, v_next_opened_date, v_next_stage, v_next_round,
      nullif(v_next ->> 'interviewer', ''), null, nullif(v_next ->> 'remark', ''), 'auto'
    ) returning * into v_next_row;
    v_next_id := v_next_row.stage_instance_id;
  end if;

  if v_result = 1 and v_row.recruitment_process = 'Offer' then
    select jsonb_build_object(
      'candidate_id', v_candidate_id,
      'passed_date', v_outcome_date,
      'group_id', anchor.group_id,
      'requisitions', coalesce(jsonb_agg(jsonb_build_object(
        'doc_group_id', peer.doc_group_id,
        'doc_id', r.doc_id,
        'site', r.site,
        'position', r.position,
        'open_headcount', greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0)
      ) order by r.doc_id) filter (where r.doc_id is not null), '[]'::jsonb)
    ) into v_handoff
    from public.candidates c
    join public.document_groups anchor on anchor.doc_group_id = c.doc_group_id
    join public.document_groups peer on (anchor.group_id is not null and peer.group_id = anchor.group_id) or peer.doc_group_id = anchor.doc_group_id
    join public.requisitions r on r.doc_id = peer.doc_id and r.status = 'ongoing'
    left join lateral (
      select count(*)::integer accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null
    ) accepted on true
    where c.candidate_id = v_candidate_id
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
    group by anchor.group_id;

    if v_handoff is null
      or jsonb_array_length(coalesce(v_handoff -> 'requisitions', '[]'::jsonb)) = 0
    then
      raise exception 'PIPELINE_OFFER_HANDOFF_INELIGIBLE: Offer Pass requires an eligible ongoing requisition with open headcount.';
    end if;
  end if;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'completed_stage', jsonb_build_object(
      'stage_instance_id', v_row.stage_instance_id, 'stage', v_row.recruitment_process,
      'round', v_row.round, 'result', v_row.result, 'outcome_date', v_row.outcome_date,
      'updated_at', v_row.updated_at
    ),
    'next_stage', case when v_next_id is null then null else jsonb_build_object(
      'stage_instance_id', v_next_row.stage_instance_id, 'stage', v_next_row.recruitment_process,
      'round', v_next_row.round, 'opened_date', v_next_row.log_date, 'updated_at', v_next_row.updated_at
    ) end,
    'terminal', v_result = 0 or v_row.recruitment_process = 'Offer',
    'offer_handoff', v_handoff
  );
end;
$$;

create or replace function public.app_pass_pipeline_jump_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'current_stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_stages jsonb := coalesce(payload -> 'passed_stages', '[]'::jsonb);
  v_target jsonb := coalesce(payload -> 'target_pending', '{}'::jsonb);
  v_target_stage text := nullif(v_target ->> 'stage', '');
  v_target_date date := nullif(v_target ->> 'opened_date', '')::date;
  v_current public.recruitment_logs%rowtype;
  v_item jsonb;
  v_pending jsonb;
  v_outcome jsonb;
  v_stage text;
  v_opened_date date;
  v_outcome_date date;
  v_previous_date date;
  v_previous_outcome_date date;
  v_current_index integer;
  v_count integer := jsonb_array_length(v_stages);
  v_i integer;
  v_new_id uuid;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_count < 1 or v_target_stage is null or v_target_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: current instance, expected timestamp, passed stages, and target Pending are required.';
  end if;

  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found or v_current.result is not null then raise exception 'PIPELINE_NOT_CURRENT: Jump requires the current Pending stage.'; end if;
  if v_current.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.superseded_at is null and later.log_id > v_current.log_id) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_current.log_id
  order by log_id desc limit 1;

  v_current_index := app_private.pipeline_stage_index(v_current.recruitment_process);
  if v_current_index is null or v_current_index + v_count > 6 then raise exception 'PIPELINE_INVALID_TRANSITION: Jump exceeds the active pipeline.'; end if;
  if v_target_stage <> (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[v_current_index + v_count] then
    raise exception 'PIPELINE_INVALID_TRANSITION: Jump target must immediately follow all confirmed Pass stages.';
  end if;

  for v_i in 0..v_count - 1 loop
    v_item := v_stages -> v_i;
    v_stage := nullif(v_item ->> 'stage', '');
    v_pending := coalesce(v_item -> 'pending', '{}'::jsonb);
    v_outcome := coalesce(v_item -> 'outcome', '{}'::jsonb);
    v_opened_date := nullif(v_pending ->> 'opened_date', '')::date;
    v_outcome_date := nullif(v_outcome ->> 'date', '')::date;
    if lower(coalesce(v_outcome ->> 'result', '')) not in ('pass', '1') then
      raise exception 'PIPELINE_INVALID_TRANSITION: Every jump Outcome must explicitly be Pass.';
    end if;
    if v_stage <> (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[v_current_index + v_i] then
      raise exception 'PIPELINE_INVALID_TRANSITION: Passed stages must be consecutive.';
    end if;
    if v_opened_date is null or v_outcome_date is null
      or v_opened_date > app_private.pipeline_business_date()
      or v_outcome_date > app_private.pipeline_business_date()
      or v_outcome_date < v_opened_date
      or (v_previous_outcome_date is not null and v_i = 0 and v_opened_date < v_previous_outcome_date)
      or (v_previous_date is not null and v_opened_date < v_previous_date)
    then
      raise exception 'PIPELINE_DATE_ORDER: Jump stage dates must be complete and nondecreasing.';
    end if;

    if v_i = 0 then
      if v_stage <> v_current.recruitment_process or coalesce(nullif(v_item ->> 'round', '')::integer, v_current.round) <> v_current.round then
        raise exception 'PIPELINE_INVALID_TRANSITION: The first passed stage must match the current Pending stage and round.';
      end if;
      perform set_config('app.action', 'pipeline:jump-pass', true);
      update public.recruitment_logs
      set log_date = v_opened_date,
          interviewer = nullif(v_pending ->> 'interviewer', ''),
          remark = nullif(v_pending ->> 'remark', ''),
          pending_edited_at = now(),
          pending_edited_by = auth.uid(),
          result = 1,
          outcome_date = v_outcome_date,
          outcome_interviewer = nullif(v_outcome ->> 'interviewer', ''),
          outcome_remark = nullif(v_outcome ->> 'remark', ''),
          outcome_recorded_at = now()
      where log_id = v_current.log_id;
    else
      perform set_config('app.action', 'pipeline:jump-pass', true);
      insert into public.recruitment_logs (
        candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
        outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at, record_origin
      ) values (
        v_candidate_id, v_opened_date, v_stage, coalesce(nullif(v_item ->> 'round', '')::integer, 1),
        nullif(v_pending ->> 'interviewer', ''), 1, nullif(v_pending ->> 'remark', ''),
        v_outcome_date, nullif(v_outcome ->> 'interviewer', ''),
        nullif(v_outcome ->> 'remark', ''), now(), 'auto'
      );
    end if;
    v_previous_date := v_outcome_date;
  end loop;

  if v_target_date < v_previous_date or v_target_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Target Pending date must be between the last Pass and Bangkok business date.';
  end if;
  v_new_id := gen_random_uuid();
  perform set_config('app.action', 'pipeline:jump-target-pending', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin
  ) values (
    v_new_id, v_candidate_id, v_target_date, v_target_stage, coalesce(nullif(v_target ->> 'round', '')::integer, 1),
    nullif(v_target ->> 'interviewer', ''), null, nullif(v_target ->> 'remark', ''), 'auto'
  );

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'completed_stage_instance_ids', (
      select coalesce(jsonb_agg(stage_instance_id order by log_id), '[]'::jsonb)
      from public.recruitment_logs
      where candidate_id = v_candidate_id and superseded_at is null and result = 1
        and log_id >= v_current.log_id and log_id < (select log_id from public.recruitment_logs where stage_instance_id = v_new_id)
    ),
    'next_stage', jsonb_build_object('stage_instance_id', v_new_id, 'stage', v_target_stage, 'round', coalesce(nullif(v_target ->> 'round', '')::integer, 1), 'opened_date', v_target_date)
  );
end;
$$;

create or replace function public.app_correct_pipeline_outcome_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage_instance_id uuid := nullif(payload ->> 'stage_instance_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_outcome jsonb := coalesce(payload -> 'outcome', '{}'::jsonb);
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_row public.recruitment_logs%rowtype;
  v_replacement public.recruitment_logs%rowtype;
  v_replacement_id uuid := gen_random_uuid();
  v_previous_outcome_date date;
  v_next_opened_date date;
begin
  perform app_private.assert_system_admin();
  if v_candidate_id is null or v_stage_instance_id is null or v_expected_updated_at is null or v_result is null or v_outcome_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: candidate, stage instance, expected timestamp, and corrected Outcome are required.';
  end if;
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;

  select * into v_row from public.recruitment_logs
  where candidate_id = v_candidate_id and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found or v_row.result is null then raise exception 'PIPELINE_NOT_FOUND: A canonical completed stage is required.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Outcome changed after it was opened.'; end if;
  if v_result is distinct from v_row.result then
    raise exception 'PIPELINE_CORRECTION_RESULT_IMMUTABLE: Outcome correction cannot change Pass/Fail.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  select log_date into v_next_opened_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and log_id > v_row.log_id
  order by log_id limit 1;
  if v_outcome_date > app_private.pipeline_business_date()
    or v_outcome_date < v_row.log_date
    or (v_previous_outcome_date is not null and v_row.log_date < v_previous_outcome_date)
    or (v_next_opened_date is not null and v_outcome_date > v_next_opened_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must satisfy previous Outcome <= Pending <= corrected Outcome <= next Pending <= Bangkok business date.';
  end if;

  perform set_config('app.action', 'pipeline:outcome-correction-supersede', true);
  update public.recruitment_logs
  set superseded_at = now(),
      superseded_by_stage_instance_id = v_replacement_id,
      superseded_reason = 'outcome corrected by system admin'
  where log_id = v_row.log_id;

  perform set_config('app.action', 'pipeline:outcome-correction-replacement', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
    outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at,
    pending_edited_at, pending_edited_by, record_origin, migration_note,
    created_at
  ) values (
    v_replacement_id, v_row.candidate_id, v_row.log_date, v_row.recruitment_process, v_row.round, v_row.interviewer,
    v_row.result, v_row.remark, v_outcome_date, nullif(v_outcome ->> 'interviewer', ''),
    nullif(v_outcome ->> 'remark', ''), now(), v_row.pending_edited_at, v_row.pending_edited_by,
    'correction', concat_ws('; ', nullif(v_row.migration_note, ''), 'corrected from ' || v_row.stage_instance_id::text),
    v_row.created_at
  ) returning * into v_replacement;

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'superseded_stage_instance_id', v_row.stage_instance_id,
    'replacement_stage', jsonb_build_object(
      'stage_instance_id', v_replacement.stage_instance_id,
      'stage', v_replacement.recruitment_process,
      'round', v_replacement.round,
      'result', v_replacement.result,
      'outcome_date', v_replacement.outcome_date,
      'updated_at', v_replacement.updated_at
    )
  );
end;
$$;

-- Legacy endpoints are compatibility adapters over the locked v2 transition
-- contract. They no longer accept arbitrary manual stage insertion.
create or replace function public.app_insert_recruitment_log(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stage text := nullif(payload ->> 'recruitment_process', '');
  v_result smallint := nullif(payload ->> 'result', '')::smallint;
  v_event_date date := nullif(payload ->> 'log_date', '')::date;
  v_current public.recruitment_logs%rowtype;
  v_next_stage text;
  v_next jsonb := null;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_event_date is null then raise exception 'PIPELINE_INVALID_PAYLOAD: Date is required.'; end if;
  if v_event_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Date cannot be after the Bangkok business date.';
  end if;

  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is null
  order by log_id desc limit 1 for update;

  if not found then
    if v_stage <> 'Phone Screen' or v_result is not null
      or exists (select 1 from public.recruitment_logs where candidate_id = v_candidate_id and superseded_at is null)
    then
      raise exception 'PIPELINE_INVALID_TRANSITION: A candidate without canonical activity must start at Phone Screen Pending.';
    end if;
    perform set_config('app.action', 'pipeline:legacy-start-pending', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin)
    values (
      v_candidate_id, v_event_date, 'Phone Screen', 1, nullif(payload ->> 'interviewer', ''), null,
      nullif(payload ->> 'remark', ''), 'user'
    ) returning * into v_current;
    update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
    return jsonb_build_object('ok', true, 'id', v_current.log_id::text, 'stage_instance_id', v_current.stage_instance_id);
  end if;

  if v_stage <> v_current.recruitment_process then
    raise exception 'PIPELINE_INVALID_TRANSITION: Legacy Process Update can edit or complete only the current Pending stage.';
  end if;
  if v_result is null then
    return public.app_update_pipeline_pending_v2(jsonb_build_object(
      'candidate_id', v_candidate_id,
      'stage_instance_id', v_current.stage_instance_id,
      'expected_updated_at', v_current.updated_at,
      'pending', jsonb_build_object(
        'opened_date', v_event_date,
        'interviewer', nullif(payload ->> 'interviewer', ''),
        'remark', nullif(payload ->> 'remark', '')
      )
    ));
  end if;

  if v_result = 1 and v_current.recruitment_process <> 'Offer' then
    v_next_stage := (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[app_private.pipeline_stage_index(v_current.recruitment_process) + 1];
    v_next := jsonb_build_object('stage', v_next_stage, 'round', 1, 'opened_date', v_event_date);
  end if;
  return public.app_complete_pipeline_stage_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'pending', jsonb_build_object(
      'opened_date', v_current.log_date,
      'interviewer', coalesce(nullif(payload ->> 'interviewer', ''), v_current.interviewer),
      'remark', coalesce(nullif(payload ->> 'remark', ''), v_current.remark)
    ),
    'outcome', jsonb_build_object(
      'result', v_result,
      'date', v_event_date,
      'interviewer', nullif(payload ->> 'interviewer', ''),
      'remark', nullif(payload ->> 'remark', '')
    ),
    'next_pending', v_next
  ));
end;
$$;

create or replace function public.app_insert_pipeline_passes(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_target_stage text := nullif(payload ->> 'target_stage', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_current public.recruitment_logs%rowtype;
  v_item jsonb;
  v_passed jsonb := '[]'::jsonb;
  v_last_date date;
  v_i integer;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is null
  order by log_id desc limit 1 for update;
  if not found then raise exception 'PIPELINE_NOT_CURRENT: A current Pending stage is required.'; end if;
  if jsonb_array_length(v_stages) < 1 then raise exception 'PIPELINE_INVALID_PAYLOAD: At least one passed stage is required.'; end if;

  for v_i in 0..jsonb_array_length(v_stages) - 1 loop
    v_item := v_stages -> v_i;
    v_last_date := nullif(v_item ->> 'log_date', '')::date;
    v_passed := v_passed || jsonb_build_array(jsonb_build_object(
      'stage', nullif(v_item ->> 'stage', ''),
      'round', coalesce(nullif(v_item ->> 'round', '')::integer, 1),
      'pending', jsonb_build_object(
        'opened_date', case when v_i = 0 then v_current.log_date else v_last_date end,
        'interviewer', coalesce(nullif(v_item ->> 'interviewer', ''), case when v_i = 0 then v_current.interviewer else null end),
        'remark', case when v_i = 0 then v_current.remark else nullif(v_item ->> 'pending_remark', '') end
      ),
      'outcome', jsonb_build_object(
        'result', 'pass', 'date', v_last_date,
        'interviewer', nullif(v_item ->> 'interviewer', ''), 'remark', nullif(v_item ->> 'remark', '')
      )
    ));
  end loop;

  return public.app_pass_pipeline_jump_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'current_stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'passed_stages', v_passed,
    'target_pending', jsonb_build_object('stage', v_target_stage, 'round', 1, 'opened_date', v_last_date)
  ));
end;
$$;

create or replace function public.app_insert_test_maintenance(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_current_test jsonb := coalesce(payload -> 'current_test', '{}'::jsonb);
  v_next_test jsonb := coalesce(payload -> 'next_test', '{}'::jsonb);
  v_current public.recruitment_logs%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is null
  order by log_id desc limit 1 for update;
  if not found or v_current.recruitment_process <> 'Test' then raise exception 'PIPELINE_NOT_CURRENT: Candidate must be in a Pending Test round.'; end if;
  if coalesce(nullif(v_current_test ->> 'round', '')::integer, v_current.round) <> v_current.round then
    raise exception 'PIPELINE_INVALID_TRANSITION: Current Test round does not match.';
  end if;
  return public.app_complete_pipeline_stage_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'pending', jsonb_build_object(
      'opened_date', v_current.log_date,
      'interviewer', coalesce(nullif(v_current_test ->> 'interviewer', ''), v_current.interviewer),
      'remark', coalesce(nullif(v_current_test ->> 'remark', ''), v_current.remark)
    ),
    'outcome', jsonb_build_object(
      'result', 'pass', 'date', nullif(v_current_test ->> 'log_date', '')::date,
      'interviewer', nullif(v_current_test ->> 'interviewer', ''), 'remark', nullif(v_current_test ->> 'remark', '')
    ),
    'next_pending', jsonb_build_object(
      'stage', 'Test', 'round', nullif(v_next_test ->> 'round', '')::integer,
      'opened_date', nullif(v_next_test ->> 'log_date', '')::date,
      'interviewer', nullif(v_next_test ->> 'interviewer', ''), 'remark', nullif(v_next_test ->> 'remark', '')
    )
  ));
end;
$$;

create or replace function public.app_insert_pipeline_test_exit(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_stages jsonb := coalesce(payload -> 'stages', '[]'::jsonb);
  v_extra jsonb := coalesce(payload -> 'extra_test_rounds', '[]'::jsonb);
  v_item jsonb;
  v_current public.recruitment_logs%rowtype;
begin
  if jsonb_array_length(v_extra) > 0 then
    raise exception 'PIPELINE_INVALID_TRANSITION: Complete additional Test rounds with Test maintenance before exiting Test.';
  end if;
  if payload ->> 'target_stage' <> 'Reference Check' or jsonb_array_length(v_stages) <> 1 then
    raise exception 'PIPELINE_INVALID_TRANSITION: Test exit must Pass one current Test round into Reference Check.';
  end if;
  v_item := v_stages -> 0;
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and superseded_at is null and result is null
  order by log_id desc limit 1 for update;
  if not found or v_current.recruitment_process <> 'Test' or coalesce(nullif(v_item ->> 'round', '')::integer, 0) <> v_current.round then
    raise exception 'PIPELINE_NOT_CURRENT: Test exit must use the current Pending Test round.';
  end if;
  return public.app_complete_pipeline_stage_v2(jsonb_build_object(
    'candidate_id', v_candidate_id,
    'stage_instance_id', v_current.stage_instance_id,
    'expected_updated_at', v_current.updated_at,
    'pending', jsonb_build_object('opened_date', v_current.log_date, 'interviewer', coalesce(nullif(v_item ->> 'interviewer', ''), v_current.interviewer), 'remark', v_current.remark),
    'outcome', jsonb_build_object('result', 'pass', 'date', nullif(v_item ->> 'log_date', '')::date, 'interviewer', nullif(v_item ->> 'interviewer', ''), 'remark', nullif(v_item ->> 'remark', '')),
    'next_pending', jsonb_build_object('stage', 'Reference Check', 'round', 1, 'opened_date', nullif(v_item ->> 'log_date', '')::date)
  ));
end;
$$;

revoke all on function public.app_start_pipeline_stage_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_start_pipeline_stage_v2(jsonb) to authenticated;
revoke all on function public.app_update_pipeline_pending_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_update_pipeline_pending_v2(jsonb) to authenticated;
revoke all on function public.app_complete_pipeline_stage_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_complete_pipeline_stage_v2(jsonb) to authenticated;
revoke all on function public.app_pass_pipeline_jump_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_pass_pipeline_jump_v2(jsonb) to authenticated;
revoke all on function public.app_correct_pipeline_outcome_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_correct_pipeline_outcome_v2(jsonb) to authenticated;

drop function if exists public.app_insert_recruitment_log(jsonb);
drop function if exists public.app_insert_pipeline_passes(jsonb);
drop function if exists public.app_insert_test_maintenance(jsonb);
drop function if exists public.app_insert_pipeline_test_exit(jsonb);

create or replace function public.app_upsert_candidate_reference_v1(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_reference_id uuid := nullif(payload ->> 'reference_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_channel_type text := lower(coalesce(nullif(payload ->> 'channel_type', ''), ''));
  v_other_label text := nullif(btrim(coalesce(payload ->> 'other_channel_label', '')), '');
  v_row public.candidate_references%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  if nullif(btrim(coalesce(payload ->> 'reference_name', '')), '') is null
    or nullif(btrim(coalesce(payload ->> 'relationship', '')), '') is null
    or nullif(btrim(coalesce(payload ->> 'channel_value', '')), '') is null
    or v_channel_type not in ('phone', 'email', 'line', 'other')
    or (v_channel_type = 'other' and v_other_label is null)
  then
    raise exception 'REFERENCE_INVALID_PAYLOAD: name, relationship, channel type, and contact value are required; Other requires a label.';
  end if;

  if v_reference_id is null then
    perform set_config('app.action', 'candidate-reference:add', true);
    insert into public.candidate_references (
      candidate_id, reference_name, relationship, channel_type, channel_value, other_channel_label, created_by, updated_by
    ) values (
      v_candidate_id, btrim(payload ->> 'reference_name'), btrim(payload ->> 'relationship'), v_channel_type,
      btrim(payload ->> 'channel_value'), case when v_channel_type = 'other' then v_other_label else null end, auth.uid(), auth.uid()
    ) returning * into v_row;
  else
    if v_expected_updated_at is null then raise exception 'REFERENCE_STALE_WRITE: expected_updated_at is required when editing a reference.'; end if;
    select * into v_row from public.candidate_references
    where reference_id = v_reference_id and candidate_id = v_candidate_id for update;
    if not found then raise exception 'REFERENCE_NOT_FOUND: Reference does not belong to this candidate.'; end if;
    if v_row.updated_at <> v_expected_updated_at then raise exception 'REFERENCE_STALE_WRITE: The reference changed after it was opened.'; end if;
    perform set_config('app.action', 'candidate-reference:edit', true);
    update public.candidate_references
    set reference_name = btrim(payload ->> 'reference_name'),
        relationship = btrim(payload ->> 'relationship'),
        channel_type = v_channel_type,
        channel_value = btrim(payload ->> 'channel_value'),
        other_channel_label = case when v_channel_type = 'other' then v_other_label else null end,
        updated_by = auth.uid()
    where reference_id = v_reference_id
    returning * into v_row;
  end if;
  return jsonb_build_object('ok', true, 'reference_id', v_row.reference_id, 'updated_at', v_row.updated_at);
end;
$$;

create or replace function public.app_set_candidate_reference_status_v1(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_reference_id uuid := nullif(payload ->> 'reference_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_status text := lower(coalesce(nullif(payload ->> 'status', ''), ''));
  v_reason text := nullif(btrim(coalesce(payload ->> 'reason', '')), '');
  v_row public.candidate_references%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  if v_reference_id is null or v_expected_updated_at is null or v_status not in ('available', 'unavailable', 'archived') then
    raise exception 'REFERENCE_INVALID_PAYLOAD: reference, expected timestamp, and a valid status are required.';
  end if;
  if v_status in ('unavailable', 'archived') and v_reason is null then
    raise exception 'REFERENCE_STATUS_REASON_REQUIRED: Unavailable and archived references require a reason.';
  end if;
  select * into v_row from public.candidate_references
  where reference_id = v_reference_id and candidate_id = v_candidate_id for update;
  if not found then raise exception 'REFERENCE_NOT_FOUND: Reference does not belong to this candidate.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'REFERENCE_STALE_WRITE: The reference changed after it was opened.'; end if;
  perform set_config('app.action', 'candidate-reference:' || v_status, true);
  update public.candidate_references
  set status = v_status,
      status_reason = case when v_status = 'available' then null else v_reason end,
      updated_by = auth.uid()
  where reference_id = v_reference_id
  returning * into v_row;
  return jsonb_build_object('ok', true, 'reference_id', v_row.reference_id, 'status', v_row.status, 'updated_at', v_row.updated_at);
end;
$$;

create or replace function public.app_save_candidate_reference_check_v1(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_reference_id uuid := nullif(payload ->> 'reference_id', '')::uuid;
  v_expected_updated_at timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_checked_date date := nullif(payload ->> 'checked_date', '')::date;
  v_duration integer := nullif(payload ->> 'duration_minutes', '')::integer;
  v_summary text := nullif(btrim(coalesce(payload ->> 'conversation_summary', '')), '');
  v_reference public.candidate_references%rowtype;
  v_check public.candidate_reference_checks%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  if v_reference_id is null or v_checked_date is null or v_duration is null or v_duration <= 0 or v_summary is null then
    raise exception 'REFERENCE_CHECK_INVALID_PAYLOAD: reference, checked date, positive duration, and summary are required.';
  end if;
  if v_checked_date > app_private.pipeline_business_date() then
    raise exception 'REFERENCE_CHECK_DATE_ORDER: Check date cannot be after the Bangkok business date.';
  end if;
  select * into v_reference from public.candidate_references
  where reference_id = v_reference_id and candidate_id = v_candidate_id for update;
  if not found then raise exception 'REFERENCE_NOT_FOUND: Reference does not belong to this candidate.'; end if;
  if v_reference.status <> 'available' then raise exception 'REFERENCE_NOT_AVAILABLE: Only Available references can receive a saved check.'; end if;
  select * into v_check from public.candidate_reference_checks where reference_id = v_reference_id for update;
  if found then
    if v_expected_updated_at is null or v_check.updated_at <> v_expected_updated_at then
      raise exception 'REFERENCE_STALE_WRITE: The saved check changed after it was opened.';
    end if;
    perform set_config('app.action', 'candidate-reference-check:edit', true);
    update public.candidate_reference_checks
    set checked_date = v_checked_date, duration_minutes = v_duration, conversation_summary = v_summary, checked_by = auth.uid()
    where reference_id = v_reference_id returning * into v_check;
  else
    if v_expected_updated_at is not null then raise exception 'REFERENCE_STALE_WRITE: No saved check exists for the supplied timestamp.'; end if;
    perform set_config('app.action', 'candidate-reference-check:save', true);
    insert into public.candidate_reference_checks (
      reference_id, checked_date, duration_minutes, conversation_summary, checked_by
    ) values (v_reference_id, v_checked_date, v_duration, v_summary, auth.uid()) returning * into v_check;
  end if;
  return jsonb_build_object('ok', true, 'check_id', v_check.check_id, 'updated_at', v_check.updated_at);
end;
$$;
