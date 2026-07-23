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

  if v_mode = 'new' then
    v_initial_log_date := coalesce(nullif(payload ->> 'first_contact_date', '')::date, current_date);
    perform set_config('app.action', 'recruitment_log:auto-phone-screen', true);
    insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
    values (v_candidate_id, v_initial_log_date, 'Phone Screen', 1, null, null, 'Initial pending phone screening');
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
