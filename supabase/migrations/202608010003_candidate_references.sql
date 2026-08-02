-- Candidate reference contacts and the Reference Check Pass gate.

create table if not exists public.candidate_references (
  reference_id uuid primary key default gen_random_uuid(),
  candidate_id text not null references public.candidates(candidate_id) on delete cascade,
  reference_name text not null check (btrim(reference_name) <> ''),
  relationship text not null check (btrim(relationship) <> ''),
  channel_type text not null check (channel_type in ('phone', 'email', 'line', 'other')),
  channel_value text not null check (btrim(channel_value) <> ''),
  other_channel_label text,
  status text not null default 'available' check (status in ('available', 'unavailable', 'archived')),
  status_reason text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((channel_type = 'other' and nullif(btrim(other_channel_label), '') is not null) or (channel_type <> 'other' and other_channel_label is null)),
  check ((status = 'available' and status_reason is null) or (status in ('unavailable', 'archived') and nullif(btrim(status_reason), '') is not null))
);
create table if not exists public.candidate_reference_checks (
  check_id uuid primary key default gen_random_uuid(),
  reference_id uuid not null unique references public.candidate_references(reference_id) on delete cascade,
  checked_date date not null,
  duration_minutes integer not null check (duration_minutes > 0),
  conversation_summary text not null check (btrim(conversation_summary) <> ''),
  checked_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_candidate_references_candidate_status on public.candidate_references(candidate_id, status, updated_at desc);
create index if not exists idx_candidate_reference_checks_reference on public.candidate_reference_checks(reference_id);

create or replace function app_private.can_read_candidate(p_candidate_id text) returns boolean language sql stable security definer set search_path = public as $$
  select app_private.is_global_recruitment_reader() or (
    app_private.current_app_role() = 'site_recruiter' and exists (
      select 1 from public.candidates c join public.document_groups dg on dg.doc_group_id = c.doc_group_id join public.requisitions r on r.doc_id = dg.doc_id
      where c.candidate_id = p_candidate_id and r.site = app_private.current_profile_site()
    )
  )
$$;

create or replace function app_private.audit_row_change() returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb; v_action text; v_entity_id text; v_email text;
begin
  v_row := coalesce(to_jsonb(new), to_jsonb(old));
  v_entity_id := case when tg_table_name = 'candidate_references' then v_row ->> 'reference_id' when tg_table_name = 'candidate_reference_checks' then v_row ->> 'check_id' else coalesce(v_row ->> 'doc_id',v_row ->> 'candidate_id',v_row ->> 'group_id',v_row ->> 'doc_group_id',v_row ->> 'offer_id',v_row ->> 'snapshot_id',v_row ->> 'log_id',v_row ->> 'week_start','unknown') end;
  v_action := coalesce(nullif(current_setting('app.action', true), ''), lower(tg_op));
  v_email := coalesce((select email from public.profiles where id = auth.uid()),auth.jwt() ->> 'email');
  insert into public.change_logs(entity,entity_id,action,changed_by,changed_by_email,old_data,new_data) values(tg_table_name,v_entity_id,v_action,auth.uid(),v_email,case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end);
  return coalesce(new,old);
end;
$$;

create or replace function app_private.assert_reference_check_passable(p_candidate_id text) returns void language plpgsql security definer set search_path = public as $$
declare v_unresolved integer;
begin
  select count(*)::integer into v_unresolved from public.candidate_references reference
  left join public.candidate_reference_checks checked on checked.reference_id = reference.reference_id
  where reference.candidate_id = p_candidate_id and reference.status = 'available' and checked.reference_id is null;
  if v_unresolved > 0 then raise exception 'PIPELINE_REFERENCE_CHECKS_REQUIRED: % available reference(s) still need a saved check.', v_unresolved; end if;
end;
$$;
create or replace function app_private.enforce_reference_check_pass_gate() returns trigger language plpgsql security definer set search_path = public, app_private as $$
begin
  if new.recruitment_process = 'Reference Check' and new.result = 1 and coalesce(current_setting('app.action', true), '') in ('pipeline:pass', 'pipeline:jump-pass') then
    perform app_private.assert_reference_check_passable(new.candidate_id);
  end if;
  return new;
end;
$$;
drop trigger if exists set_candidate_references_updated_at on public.candidate_references;
create trigger set_candidate_references_updated_at before update on public.candidate_references for each row execute function app_private.set_updated_at();
drop trigger if exists set_candidate_reference_checks_updated_at on public.candidate_reference_checks;
create trigger set_candidate_reference_checks_updated_at before update on public.candidate_reference_checks for each row execute function app_private.set_updated_at();
drop trigger if exists enforce_reference_check_pass_gate on public.recruitment_logs;
create trigger enforce_reference_check_pass_gate before insert or update of result on public.recruitment_logs for each row execute function app_private.enforce_reference_check_pass_gate();
drop trigger if exists audit_candidate_references on public.candidate_references;
create trigger audit_candidate_references after insert or update or delete on public.candidate_references for each row execute function app_private.audit_row_change();
drop trigger if exists audit_candidate_reference_checks on public.candidate_reference_checks;
create trigger audit_candidate_reference_checks after insert or update or delete on public.candidate_reference_checks for each row execute function app_private.audit_row_change();

alter table public.candidate_references enable row level security;
alter table public.candidate_reference_checks enable row level security;
grant select on public.candidate_references, public.candidate_reference_checks to authenticated;
drop policy if exists candidate_references_scoped_read on public.candidate_references;
create policy candidate_references_scoped_read on public.candidate_references for select to authenticated using ((select app_private.can_read_candidate(candidate_id)));
drop policy if exists candidate_reference_checks_scoped_read on public.candidate_reference_checks;
create policy candidate_reference_checks_scoped_read on public.candidate_reference_checks for select to authenticated using (exists (select 1 from public.candidate_references reference where reference.reference_id = candidate_reference_checks.reference_id and (select app_private.can_read_candidate(reference.candidate_id))));

create or replace function public.app_upsert_candidate_reference_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_candidate_id text := nullif(payload ->> 'candidate_id', ''); v_reference_id uuid := nullif(payload ->> 'reference_id', '')::uuid; v_expected timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz; v_channel text := lower(coalesce(nullif(payload ->> 'channel_type', ''), '')); v_other text := nullif(btrim(coalesce(payload ->> 'other_channel_label', '')), ''); v_row public.candidate_references%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  if nullif(btrim(coalesce(payload ->> 'reference_name', '')), '') is null or nullif(btrim(coalesce(payload ->> 'relationship', '')), '') is null or nullif(btrim(coalesce(payload ->> 'channel_value', '')), '') is null or v_channel not in ('phone','email','line','other') or (v_channel = 'other' and v_other is null) then raise exception 'REFERENCE_INVALID_PAYLOAD: name, relationship, channel type, and contact value are required; Other requires a label.'; end if;
  if v_reference_id is null then
    perform set_config('app.action','candidate-reference:add',true);
    insert into public.candidate_references(candidate_id,reference_name,relationship,channel_type,channel_value,other_channel_label,created_by,updated_by) values(v_candidate_id,btrim(payload ->> 'reference_name'),btrim(payload ->> 'relationship'),v_channel,btrim(payload ->> 'channel_value'),case when v_channel='other' then v_other else null end,auth.uid(),auth.uid()) returning * into v_row;
  else
    if v_expected is null then raise exception 'REFERENCE_STALE_WRITE: expected_updated_at is required when editing a reference.'; end if;
    select * into v_row from public.candidate_references where reference_id=v_reference_id and candidate_id=v_candidate_id for update;
    if not found then raise exception 'REFERENCE_NOT_FOUND: Reference does not belong to this candidate.'; end if;
    if v_row.updated_at <> v_expected then raise exception 'REFERENCE_STALE_WRITE: The reference changed after it was opened.'; end if;
    perform set_config('app.action','candidate-reference:edit',true);
    update public.candidate_references set reference_name=btrim(payload ->> 'reference_name'),relationship=btrim(payload ->> 'relationship'),channel_type=v_channel,channel_value=btrim(payload ->> 'channel_value'),other_channel_label=case when v_channel='other' then v_other else null end,updated_by=auth.uid() where reference_id=v_reference_id returning * into v_row;
  end if;
  return jsonb_build_object('ok',true,'reference_id',v_row.reference_id,'updated_at',v_row.updated_at);
end;
$$;

create or replace function public.app_set_candidate_reference_status_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_candidate_id text := nullif(payload ->> 'candidate_id', ''); v_reference_id uuid := nullif(payload ->> 'reference_id', '')::uuid; v_expected timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz; v_status text := lower(coalesce(nullif(payload ->> 'status', ''), '')); v_reason text := nullif(btrim(coalesce(payload ->> 'reason','')), ''); v_row public.candidate_references%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  if v_reference_id is null or v_expected is null or v_status not in ('available','unavailable','archived') then raise exception 'REFERENCE_INVALID_PAYLOAD: reference, expected timestamp, and valid status are required.'; end if;
  if v_status in ('unavailable','archived') and v_reason is null then raise exception 'REFERENCE_STATUS_REASON_REQUIRED: Unavailable and archived references require a reason.'; end if;
  select * into v_row from public.candidate_references where reference_id=v_reference_id and candidate_id=v_candidate_id for update;
  if not found then raise exception 'REFERENCE_NOT_FOUND: Reference does not belong to this candidate.'; end if;
  if v_row.updated_at <> v_expected then raise exception 'REFERENCE_STALE_WRITE: The reference changed after it was opened.'; end if;
  perform set_config('app.action','candidate-reference:' || v_status,true);
  update public.candidate_references set status=v_status,status_reason=case when v_status='available' then null else v_reason end,updated_by=auth.uid() where reference_id=v_reference_id returning * into v_row;
  return jsonb_build_object('ok',true,'reference_id',v_row.reference_id,'status',v_row.status,'updated_at',v_row.updated_at);
end;
$$;

create or replace function public.app_save_candidate_reference_check_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_candidate_id text := nullif(payload ->> 'candidate_id',''); v_reference_id uuid := nullif(payload ->> 'reference_id','')::uuid; v_expected timestamptz := nullif(payload ->> 'expected_updated_at','')::timestamptz; v_date date := nullif(payload ->> 'checked_date','')::date; v_duration integer := nullif(payload ->> 'duration_minutes','')::integer; v_summary text := nullif(btrim(coalesce(payload ->> 'conversation_summary','')), ''); v_reference public.candidate_references%rowtype; v_check public.candidate_reference_checks%rowtype;
begin
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  if v_reference_id is null or v_date is null or v_duration is null or v_duration <= 0 or v_summary is null then raise exception 'REFERENCE_CHECK_INVALID_PAYLOAD: reference, checked date, positive duration, and summary are required.'; end if;
  if v_date > app_private.pipeline_business_date() then raise exception 'REFERENCE_CHECK_DATE_ORDER: Check date cannot be after the Bangkok business date.'; end if;
  select * into v_reference from public.candidate_references where reference_id=v_reference_id and candidate_id=v_candidate_id for update;
  if not found then raise exception 'REFERENCE_NOT_FOUND: Reference does not belong to this candidate.'; end if;
  if v_reference.status <> 'available' then raise exception 'REFERENCE_NOT_AVAILABLE: Only Available references can receive a saved check.'; end if;
  select * into v_check from public.candidate_reference_checks where reference_id=v_reference_id for update;
  if found then
    if v_expected is null or v_check.updated_at <> v_expected then raise exception 'REFERENCE_STALE_WRITE: The saved check changed after it was opened.'; end if;
    perform set_config('app.action','candidate-reference-check:edit',true);
    update public.candidate_reference_checks set checked_date=v_date,duration_minutes=v_duration,conversation_summary=v_summary,checked_by=auth.uid() where reference_id=v_reference_id returning * into v_check;
  else
    if v_expected is not null then raise exception 'REFERENCE_STALE_WRITE: No saved check exists for the supplied timestamp.'; end if;
    perform set_config('app.action','candidate-reference-check:save',true);
    insert into public.candidate_reference_checks(reference_id,checked_date,duration_minutes,conversation_summary,checked_by) values(v_reference_id,v_date,v_duration,v_summary,auth.uid()) returning * into v_check;
  end if;
  return jsonb_build_object('ok',true,'check_id',v_check.check_id,'updated_at',v_check.updated_at);
end;
$$;

create or replace function public.app_upsert_candidate(payload jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mode text := coalesce(payload ->> 'mode', 'new');
  v_candidate_id text := nullif(payload ->> 'candidate_id', '');
  v_doc_group_id text := nullif(payload ->> 'doc_group_id', '');
  v_references jsonb := coalesce(payload -> 'references', '[]'::jsonb);
  v_reference jsonb;
  v_exists boolean;
  v_initial_log_date date;
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_doc_group(v_doc_group_id) then raise exception 'You can create candidates only for requisitions where you are person in charge.'; end if;
  if v_mode = 'new' then v_candidate_id := app_private.next_app_id('candidates', 'CAN'); elsif v_candidate_id is null then raise exception 'Candidate ID is required in Change mode.'; end if;
  select exists(select 1 from public.candidates where candidate_id = v_candidate_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'Candidate ID already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'Candidate ID does not exist. Switch to New mode to create it.'; end if;
  if v_mode = 'change' and not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can edit candidates only for requisitions where you are person in charge.'; end if;
  perform set_config('app.action', 'candidate:' || v_mode, true);
  insert into public.candidates(candidate_id,name,phone_no,doc_group_id,channel,ref_name,first_contact_date,candidate_folder_url)
  values(v_candidate_id,nullif(payload ->> 'name',''),nullif(payload ->> 'phone_no',''),v_doc_group_id,nullif(payload ->> 'channel',''),nullif(payload ->> 'ref_name',''),nullif(payload ->> 'first_contact_date','')::date,nullif(payload ->> 'candidate_folder_url',''))
  on conflict(candidate_id) do update set name=excluded.name,phone_no=excluded.phone_no,doc_group_id=excluded.doc_group_id,channel=excluded.channel,ref_name=excluded.ref_name,first_contact_date=excluded.first_contact_date,candidate_folder_url=excluded.candidate_folder_url;
  for v_reference in select value from jsonb_array_elements(v_references) loop
    if nullif(btrim(coalesce(v_reference ->> 'reference_name','')),'') is null or nullif(btrim(coalesce(v_reference ->> 'relationship','')),'') is null or lower(coalesce(nullif(v_reference ->> 'channel_type',''),'')) not in ('phone','email','line','other') or nullif(btrim(coalesce(v_reference ->> 'channel_value','')),'') is null or (lower(v_reference ->> 'channel_type')='other' and nullif(btrim(coalesce(v_reference ->> 'other_channel_label','')),'') is null) then raise exception 'REFERENCE_INVALID_PAYLOAD: Each candidate reference needs name, relationship, channel, and contact value; Other requires a label.'; end if;
    perform set_config('app.action','candidate-reference:add',true);
    insert into public.candidate_references(candidate_id,reference_name,relationship,channel_type,channel_value,other_channel_label,created_by,updated_by)
    values(v_candidate_id,btrim(v_reference ->> 'reference_name'),btrim(v_reference ->> 'relationship'),lower(v_reference ->> 'channel_type'),btrim(v_reference ->> 'channel_value'),case when lower(v_reference ->> 'channel_type')='other' then nullif(btrim(v_reference ->> 'other_channel_label'),'') else null end,auth.uid(),auth.uid());
  end loop;
  if v_mode = 'new' then
    v_initial_log_date := coalesce(nullif(payload ->> 'first_contact_date','')::date,current_date);
    if v_initial_log_date > (now() at time zone 'Asia/Bangkok')::date then raise exception 'PIPELINE_DATE_ORDER: Initial Pending date cannot be after the Bangkok business date.'; end if;
    perform set_config('app.action','recruitment_log:auto-phone-screen',true);
    insert into public.recruitment_logs(candidate_id,log_date,recruitment_process,round,interviewer,result,remark,record_origin) values(v_candidate_id,v_initial_log_date,'Phone Screen',1,null,null,'Initial pending phone screening','auto');
  end if;
  return jsonb_build_object('ok',true,'id',v_candidate_id);
end;
$$;

revoke all on function public.app_upsert_candidate_reference_v1(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_candidate_reference_v1(jsonb) to authenticated;
revoke all on function public.app_set_candidate_reference_status_v1(jsonb) from public, anon, authenticated;
grant execute on function public.app_set_candidate_reference_status_v1(jsonb) to authenticated;
revoke all on function public.app_save_candidate_reference_check_v1(jsonb) from public, anon, authenticated;
grant execute on function public.app_save_candidate_reference_check_v1(jsonb) to authenticated;
