alter table public.profiles
  add column if not exists nickname text,
  add column if not exists site text;

alter table public.profiles
  drop constraint if exists profiles_role_check;

update public.profiles
set role = case role
  when 'admin' then 'system_admin'
  when 'recruiter' then 'admin_recruiter'
  else role
end
where role in ('admin', 'recruiter');

update public.profiles
set nickname = coalesce(nullif(nickname, ''), nullif(full_name, ''), split_part(coalesce(email, id::text), '@', 1))
where nickname is null or nickname = '';

alter table public.profiles
  alter column role set default 'viewer',
  add constraint profiles_role_check check (role in ('system_admin', 'admin_recruiter', 'site_recruiter', 'viewer'));

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, nickname, site, role)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'nickname', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, new.id::text), '@', 1)
    ),
    nullif(new.raw_user_meta_data ->> 'site', ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'viewer')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    nickname = coalesce(public.profiles.nickname, excluded.nickname),
    site = coalesce(public.profiles.site, excluded.site),
    role = coalesce(public.profiles.role, excluded.role);
  return new;
end;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon')
$$;

create or replace function public.current_profile_nickname()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif((select nickname from public.profiles where id = auth.uid()), '')
$$;

create or replace function public.current_profile_site()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif((select site from public.profiles where id = auth.uid()), '')
$$;

create or replace function public.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'system_admin'
$$;

create or replace function public.is_global_recruitment_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('system_admin', 'admin_recruiter', 'viewer')
$$;

create or replace function public.is_recruitment_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('system_admin', 'admin_recruiter', 'site_recruiter', 'viewer')
$$;

create or replace function public.is_recruitment_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() in ('system_admin', 'admin_recruiter', 'site_recruiter')
$$;

create or replace function public.assert_recruitment_writer()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_recruitment_writer() then
    raise exception 'Recruitment write role is required.';
  end if;
end;
$$;

create or replace function public.assert_system_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_system_admin() then
    raise exception 'System admin role is required.';
  end if;
end;
$$;

create or replace function public.can_read_requisition(p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_global_recruitment_reader()
    or (
      public.current_app_role() = 'site_recruiter'
      and exists (
        select 1
        from public.requisitions r
        where r.doc_id = p_doc_id
          and r.site = public.current_profile_site()
      )
    )
$$;

create or replace function public.can_manage_requisition(p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_app_role() in ('system_admin', 'admin_recruiter')
    or (
      public.current_app_role() = 'site_recruiter'
      and exists (
        select 1
        from public.requisitions r
        where r.doc_id = p_doc_id
          and r.site = public.current_profile_site()
          and r.person_in_charge = public.current_profile_nickname()
      )
    )
$$;

create or replace function public.can_manage_doc_group(p_doc_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_groups dg
    where dg.doc_group_id = p_doc_group_id
      and public.can_manage_requisition(dg.doc_id)
  )
$$;

create or replace function public.can_manage_candidate(p_candidate_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.candidates c
    join public.document_groups dg on dg.doc_group_id = c.doc_group_id
    where c.candidate_id = p_candidate_id
      and public.can_manage_requisition(dg.doc_id)
  )
$$;

drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_system_admin());

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
for update to authenticated
using (public.is_system_admin())
with check (public.is_system_admin());

drop policy if exists requisitions_read on public.requisitions;
create policy requisitions_read on public.requisitions
for select to authenticated
using (
  public.is_global_recruitment_reader()
  or (
    public.current_app_role() = 'site_recruiter'
    and site = public.current_profile_site()
  )
);

drop policy if exists requisition_logs_read on public.requisition_logs;
create policy requisition_logs_read on public.requisition_logs
for select to authenticated
using (public.can_read_requisition(doc_id));

drop policy if exists position_groups_read on public.position_groups;
create policy position_groups_read on public.position_groups
for select to authenticated
using (public.is_recruitment_reader());

drop policy if exists document_groups_read on public.document_groups;
create policy document_groups_read on public.document_groups
for select to authenticated
using (public.can_read_requisition(doc_id));

drop policy if exists candidates_read on public.candidates;
create policy candidates_read on public.candidates
for select to authenticated
using (
  exists (
    select 1
    from public.document_groups dg
    where dg.doc_group_id = candidates.doc_group_id
      and public.can_read_requisition(dg.doc_id)
  )
);

drop policy if exists recruitment_logs_read on public.recruitment_logs;
create policy recruitment_logs_read on public.recruitment_logs
for select to authenticated
using (
  exists (
    select 1
    from public.candidates c
    join public.document_groups dg on dg.doc_group_id = c.doc_group_id
    where c.candidate_id = recruitment_logs.candidate_id
      and public.can_read_requisition(dg.doc_id)
  )
);

drop policy if exists offers_read on public.offers;
create policy offers_read on public.offers
for select to authenticated
using (public.can_read_requisition(doc_id));

drop policy if exists change_logs_read on public.change_logs;
create policy change_logs_read on public.change_logs
for select to authenticated
using (public.is_global_recruitment_reader());

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
begin
  perform public.assert_recruitment_writer();
  if v_mode not in ('new', 'change') then raise exception 'mode must be new or change'; end if;
  if v_status not in ('ongoing', 'cancel') then raise exception 'Requisition status can only be ongoing or cancel. Filled is automatic.'; end if;

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
    head_count, person_in_charge, line_manager, status
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
    status = excluded.status;

  perform set_config('app.action', 'auto-status', true);
  perform public.refresh_requisition_status(v_doc_id);
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
  perform public.assert_recruitment_writer();
  if not public.can_manage_requisition(v_doc_id) then raise exception 'You can update status only for requisitions where you are person in charge.'; end if;
  if v_status not in ('ongoing', 'filled', 'cancel') then raise exception 'Status must be ongoing, filled, or cancel.'; end if;

  perform set_config('app.action', 'requisition:status', true);
  insert into public.requisition_logs (doc_id, log_date, status, remark)
  values (v_doc_id, nullif(payload ->> 'log_date', '')::date, v_status, nullif(payload ->> 'remark', ''));

  update public.requisitions set status = v_status where doc_id = v_doc_id;
  perform set_config('app.action', 'auto-status', true);
  perform public.refresh_requisition_status(v_doc_id);
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
  perform public.assert_system_admin();
  if v_mode = 'new' then
    v_group_id := public.next_prefixed_id('position_groups', 'group_id', 'GRP');
  elsif v_group_id is null then
    raise exception 'Group ID is required in Change mode.';
  end if;

  select exists(select 1 from public.position_groups where group_id = v_group_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Group ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Group ID does not exist. Switch to New mode to create it.'; end if;

  perform set_config('app.action', 'position_group:' || v_mode, true);
  insert into public.position_groups (group_id, group_position, channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb)
  values (
    v_group_id,
    nullif(payload ->> 'group_position', ''),
    coalesce((payload ->> 'channel_fb')::boolean, false),
    coalesce((payload ->> 'channel_jobthai')::boolean, false),
    coalesce((payload ->> 'channel_jobtopgun')::boolean, false),
    coalesce((payload ->> 'channel_jobdb')::boolean, false)
  )
  on conflict (group_id) do update set
    group_position = excluded.group_position,
    channel_fb = excluded.channel_fb,
    channel_jobthai = excluded.channel_jobthai,
    channel_jobtopgun = excluded.channel_jobtopgun,
    channel_jobdb = excluded.channel_jobdb;

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
  perform public.assert_system_admin();
  select * into v_group from public.position_groups where group_id = v_group_id;
  if not found then raise exception 'Group ID does not exist.'; end if;
  if exists(select 1 from public.document_groups where doc_id = v_doc_id and group_id = v_group_id) then
    raise exception 'This requisition is already matched to that group.';
  end if;

  v_doc_group_id := public.next_prefixed_id('document_groups', 'doc_group_id', 'DGRP');
  perform set_config('app.action', 'document_group:new', true);
  insert into public.document_groups (
    doc_group_id, doc_id, group_id, group_position, channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb
  )
  values (
    v_doc_group_id, v_doc_id, v_group_id, v_group.group_position,
    v_group.channel_fb, v_group.channel_jobthai, v_group.channel_jobtopgun, v_group.channel_jobdb
  );

  return jsonb_build_object('ok', true, 'id', v_doc_group_id);
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
begin
  perform public.assert_recruitment_writer();
  if not public.can_manage_doc_group(v_doc_group_id) then raise exception 'You can create candidates only for requisitions where you are person in charge.'; end if;

  if v_mode = 'new' then
    v_candidate_id := public.next_prefixed_id('candidates', 'candidate_id', 'CAN');
  elsif v_candidate_id is null then
    raise exception 'Candidate ID is required in Change mode.';
  end if;

  select exists(select 1 from public.candidates where candidate_id = v_candidate_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Candidate ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Candidate ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not public.can_manage_candidate(v_candidate_id) then raise exception 'You can edit candidates only for requisitions where you are person in charge.'; end if;

  perform set_config('app.action', 'candidate:' || v_mode, true);
  insert into public.candidates (candidate_id, name, phone_no, doc_group_id, channel, ref_name, first_contact_date)
  values (
    v_candidate_id,
    nullif(payload ->> 'name', ''),
    nullif(payload ->> 'phone_no', ''),
    v_doc_group_id,
    nullif(payload ->> 'channel', ''),
    nullif(payload ->> 'ref_name', ''),
    nullif(payload ->> 'first_contact_date', '')::date
  )
  on conflict (candidate_id) do update set
    name = excluded.name,
    phone_no = excluded.phone_no,
    doc_group_id = excluded.doc_group_id,
    channel = excluded.channel,
    ref_name = excluded.ref_name,
    first_contact_date = excluded.first_contact_date;

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
  v_current_index integer;
  v_next_index integer;
  v_log_id bigint;
begin
  perform public.assert_recruitment_writer();
  if not public.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;

  if v_source = 'pipeline' then
    select recruitment_process into v_current_stage
    from public.recruitment_logs
    where candidate_id = v_candidate_id
    order by log_id desc
    limit 1;

    v_current_index := coalesce(array_position(array[
      'First Contact', 'Phone Screen', 'HR Interview', 'Line Interview', 'Test',
      'Reference Check', 'Offer', 'Rejected', 'Withdrawn'
    ], v_current_stage), 0);
    v_next_index := coalesce(array_position(array[
      'First Contact', 'Phone Screen', 'HR Interview', 'Line Interview', 'Test',
      'Reference Check', 'Offer', 'Rejected', 'Withdrawn'
    ], v_stage), 0);

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
  perform public.assert_recruitment_writer();
  if not public.can_manage_requisition(v_doc_id) or not public.can_manage_candidate(v_candidate_id) then
    raise exception 'You can create offers only for requisitions where you are person in charge.';
  end if;

  select exists(select 1 from public.offers where candidate_id = v_candidate_id and doc_id = v_doc_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'This offer already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'This offer does not exist. Switch to New mode to create it.'; end if;

  perform set_config('app.action', 'offer:' || v_mode, true);
  insert into public.offers (candidate_id, doc_id, accepted_date, first_working_date, offered_type, replaced, remark)
  values (
    v_candidate_id,
    v_doc_id,
    nullif(payload ->> 'accepted_date', '')::date,
    nullif(payload ->> 'first_working_date', '')::date,
    nullif(payload ->> 'offered_type', ''),
    nullif(payload ->> 'replaced', ''),
    nullif(payload ->> 'remark', '')
  )
  on conflict (candidate_id, doc_id) do update set
    accepted_date = excluded.accepted_date,
    first_working_date = excluded.first_working_date,
    offered_type = excluded.offered_type,
    replaced = excluded.replaced,
    remark = excluded.remark
  returning offer_id into v_offer_id;

  perform set_config('app.action', 'auto-status', true);
  perform public.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_offer_id::text);
end;
$$;
