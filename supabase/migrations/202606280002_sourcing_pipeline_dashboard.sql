create table if not exists public.sourcing_weekly_updates (
  group_id text not null references public.position_groups(group_id) on delete cascade,
  week_start date not null,
  channel_fb boolean not null default false,
  channel_jobthai boolean not null default false,
  channel_jobtopgun boolean not null default false,
  channel_jobdb boolean not null default false,
  applicants_fb integer not null default 0 check (applicants_fb >= 0),
  applicants_jobthai integer not null default 0 check (applicants_jobthai >= 0),
  applicants_jobtopgun integer not null default 0 check (applicants_jobtopgun >= 0),
  applicants_jobdb integer not null default 0 check (applicants_jobdb >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (group_id, week_start)
);

create table if not exists public.vacancy_weekly_snapshots (
  snapshot_id bigserial primary key,
  week_start date not null,
  waterfall_category text not null check (waterfall_category in ('Week Start', 'Open', 'Filled', 'Total')),
  site text not null,
  request_type text not null check (request_type in ('New', 'Replacement')),
  vacancy_count integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (week_start, waterfall_category, site, request_type)
);

create index if not exists idx_sourcing_weekly_updates_week on public.sourcing_weekly_updates(week_start);
create index if not exists idx_vacancy_weekly_snapshots_week on public.vacancy_weekly_snapshots(week_start);
create index if not exists idx_vacancy_weekly_snapshots_site on public.vacancy_weekly_snapshots(site);

drop trigger if exists set_sourcing_weekly_updates_updated_at on public.sourcing_weekly_updates;
create trigger set_sourcing_weekly_updates_updated_at before update on public.sourcing_weekly_updates
for each row execute function public.set_updated_at();

drop trigger if exists set_vacancy_weekly_snapshots_updated_at on public.vacancy_weekly_snapshots;
create trigger set_vacancy_weekly_snapshots_updated_at before update on public.vacancy_weekly_snapshots
for each row execute function public.set_updated_at();

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_action text;
  v_entity_id text;
  v_email text;
begin
  v_row := coalesce(to_jsonb(new), to_jsonb(old));
  v_entity_id := coalesce(
    v_row ->> 'doc_id',
    v_row ->> 'candidate_id',
    v_row ->> 'group_id',
    v_row ->> 'doc_group_id',
    v_row ->> 'offer_id',
    v_row ->> 'snapshot_id',
    v_row ->> 'log_id',
    v_row ->> 'week_start',
    'unknown'
  );
  v_action := coalesce(nullif(current_setting('app.action', true), ''), lower(tg_op));
  v_email := coalesce(
    (select email from public.profiles where id = auth.uid()),
    auth.jwt() ->> 'email'
  );

  insert into public.change_logs (entity, entity_id, action, changed_by, changed_by_email, old_data, new_data)
  values (
    tg_table_name,
    v_entity_id,
    v_action,
    auth.uid(),
    v_email,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_sourcing_weekly_updates on public.sourcing_weekly_updates;
create trigger audit_sourcing_weekly_updates after insert or update or delete on public.sourcing_weekly_updates
for each row execute function public.audit_row_change();

drop trigger if exists audit_vacancy_weekly_snapshots on public.vacancy_weekly_snapshots;
create trigger audit_vacancy_weekly_snapshots after insert or update or delete on public.vacancy_weekly_snapshots
for each row execute function public.audit_row_change();

create or replace function public.has_open_group_requisition(p_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_groups dg
    join public.requisitions r on r.doc_id = dg.doc_id
    left join lateral (
      select count(*)::integer as accepted_count
      from public.offers o
      where o.doc_id = r.doc_id
        and o.accepted_date is not null
    ) accepted on true
    where dg.group_id = p_group_id
      and r.status = 'ongoing'
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
  )
$$;

create or replace function public.can_read_sourcing_group(p_group_id text)
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
        from public.document_groups dg
        join public.requisitions r on r.doc_id = dg.doc_id
        where dg.group_id = p_group_id
          and r.person_in_charge = public.current_profile_nickname()
      )
    )
$$;

create or replace function public.can_manage_sourcing_group(p_group_id text)
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
        from public.document_groups dg
        join public.requisitions r on r.doc_id = dg.doc_id
        left join lateral (
          select count(*)::integer as accepted_count
          from public.offers o
          where o.doc_id = r.doc_id
            and o.accepted_date is not null
        ) accepted on true
        where dg.group_id = p_group_id
          and r.status = 'ongoing'
          and r.person_in_charge = public.current_profile_nickname()
          and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
      )
    )
$$;

alter table public.sourcing_weekly_updates enable row level security;
alter table public.vacancy_weekly_snapshots enable row level security;

drop policy if exists sourcing_weekly_updates_read on public.sourcing_weekly_updates;
create policy sourcing_weekly_updates_read on public.sourcing_weekly_updates
for select to authenticated
using (public.can_read_sourcing_group(group_id));

drop policy if exists vacancy_weekly_snapshots_read on public.vacancy_weekly_snapshots;
create policy vacancy_weekly_snapshots_read on public.vacancy_weekly_snapshots
for select to authenticated
using (
  public.is_global_recruitment_reader()
  or (
    public.current_app_role() = 'site_recruiter'
    and site = public.current_profile_site()
  )
);

grant select on public.sourcing_weekly_updates to authenticated;
grant select on public.vacancy_weekly_snapshots to authenticated;

create or replace function public.app_upsert_sourcing_weekly_update(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_week_start date := nullif(payload ->> 'week_start', '')::date;
begin
  perform public.assert_recruitment_writer();
  if v_group_id is null then raise exception 'Group ID is required.'; end if;
  if v_week_start is null then raise exception 'Week start is required.'; end if;
  if not public.has_open_group_requisition(v_group_id) then raise exception 'Group has no unfilled active requisition.'; end if;
  if not public.can_manage_sourcing_group(v_group_id) then raise exception 'You can update only sourcing groups where you are responsible.'; end if;

  perform set_config('app.action', 'sourcing_update:upsert', true);
  insert into public.sourcing_weekly_updates (
    group_id, week_start, channel_fb, channel_jobthai, channel_jobtopgun, channel_jobdb,
    applicants_fb, applicants_jobthai, applicants_jobtopgun, applicants_jobdb, updated_by
  )
  values (
    v_group_id,
    v_week_start,
    coalesce((payload ->> 'channel_fb')::boolean, false),
    coalesce((payload ->> 'channel_jobthai')::boolean, false),
    coalesce((payload ->> 'channel_jobtopgun')::boolean, false),
    coalesce((payload ->> 'channel_jobdb')::boolean, false),
    coalesce(nullif(payload ->> 'applicants_fb', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_jobthai', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_jobtopgun', '')::integer, 0),
    coalesce(nullif(payload ->> 'applicants_jobdb', '')::integer, 0),
    auth.uid()
  )
  on conflict (group_id, week_start) do update set
    channel_fb = excluded.channel_fb,
    channel_jobthai = excluded.channel_jobthai,
    channel_jobtopgun = excluded.channel_jobtopgun,
    channel_jobdb = excluded.channel_jobdb,
    applicants_fb = excluded.applicants_fb,
    applicants_jobthai = excluded.applicants_jobthai,
    applicants_jobtopgun = excluded.applicants_jobtopgun,
    applicants_jobdb = excluded.applicants_jobdb,
    updated_by = excluded.updated_by;

  return jsonb_build_object('ok', true, 'id', v_group_id);
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
  if public.current_app_role() not in ('system_admin', 'admin_recruiter') then
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
  perform public.assert_recruitment_writer();
  if not public.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;

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

grant execute on function public.app_upsert_sourcing_weekly_update(jsonb) to authenticated;
grant execute on function public.app_upsert_vacancy_weekly_snapshot(jsonb) to authenticated;
