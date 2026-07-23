-- Canonical declarative schema source. Edit this file set, not historical migrations.

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create or replace function app_private.handle_new_auth_user()
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


create or replace function app_private.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon')
$$;

create or replace function app_private.current_profile_nickname()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif((select nickname from public.profiles where id = auth.uid()), '')
$$;

create or replace function app_private.current_profile_site()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif((select site from public.profiles where id = auth.uid()), '')
$$;

create or replace function app_private.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_private.current_app_role() = 'system_admin'
$$;

create or replace function app_private.is_global_recruitment_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_private.current_app_role() in ('system_admin', 'admin_recruiter', 'viewer')
$$;

create or replace function app_private.is_recruitment_reader()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_private.current_app_role() in ('system_admin', 'admin_recruiter', 'site_recruiter', 'viewer')
$$;

create or replace function app_private.is_recruitment_writer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_private.current_app_role() in ('system_admin', 'admin_recruiter', 'site_recruiter')
$$;

create or replace function app_private.assert_system_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app_private.is_system_admin() then
    raise exception 'System admin role is required.';
  end if;
end;
$$;

create or replace function app_private.assert_recruitment_writer()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not app_private.is_recruitment_writer() then
    raise exception 'Recruitment write role is required.';
  end if;
end;
$$;

create or replace function app_private.can_read_requisition(p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    app_private.is_global_recruitment_reader()
    or (
      app_private.current_app_role() = 'site_recruiter'
      and exists (
        select 1
        from public.requisitions r
        where r.doc_id = p_doc_id
          and r.site = app_private.current_profile_site()
      )
    )
$$;

create or replace function app_private.can_manage_requisition(p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    app_private.current_app_role() in ('system_admin', 'admin_recruiter')
    or (
      app_private.current_app_role() = 'site_recruiter'
      and exists (
        select 1
        from public.requisitions r
        where r.doc_id = p_doc_id
          and r.site = app_private.current_profile_site()
          and r.person_in_charge = app_private.current_profile_nickname()
      )
    )
$$;

create or replace function app_private.can_manage_doc_group(p_doc_group_id text)
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
      and app_private.can_manage_requisition(dg.doc_id)
  )
$$;

create or replace function app_private.can_manage_candidate(p_candidate_id text)
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
      and app_private.can_manage_requisition(dg.doc_id)
  )
$$;

create or replace function app_private.has_open_group_requisition(p_group_id text)
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

create or replace function app_private.can_read_sourcing_group(p_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    app_private.is_global_recruitment_reader()
    or (
      app_private.current_app_role() = 'site_recruiter'
      and exists (
        select 1
        from public.document_groups dg
        join public.requisitions r on r.doc_id = dg.doc_id
        where dg.group_id = p_group_id
          and r.person_in_charge = app_private.current_profile_nickname()
      )
    )
$$;

create or replace function app_private.can_manage_sourcing_group(p_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    app_private.current_app_role() in ('system_admin', 'admin_recruiter')
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
        ) accepted on true
        where dg.group_id = p_group_id
          and r.status = 'ongoing'
          and r.person_in_charge = app_private.current_profile_nickname()
          and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
      )
    )
$$;

create or replace function app_private.next_app_id(p_entity text, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value integer;
begin
  if p_entity is null or p_prefix is null then
    raise exception 'Entity and prefix are required.';
  end if;

  insert into public.app_id_counters (entity, next_value)
  values (p_entity, 1)
  on conflict (entity) do nothing;

  update public.app_id_counters
  set next_value = next_value + 1
  where entity = p_entity
  returning next_value - 1 into v_value;

  return p_prefix || '-' || lpad(v_value::text, 4, '0');
end;
$$;

create or replace function app_private.next_prefixed_id(p_table text, p_column text, p_prefix text)
returns text
language sql
security definer
set search_path = public
as $$
  select app_private.next_app_id(p_table, p_prefix)
$$;

create or replace function app_private.refresh_requisition_status(p_doc_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_head_count integer;
  v_status text;
  v_accepted_count integer;
  v_next_status text;
begin
  select head_count, status into v_head_count, v_status
  from public.requisitions
  where doc_id = p_doc_id;

  if not found or v_status = 'cancel' then
    return;
  end if;

  select count(*) into v_accepted_count
  from public.offers
  where doc_id = p_doc_id
    and accepted_date is not null;

  v_next_status := case when v_accepted_count >= v_head_count then 'filled' else 'ongoing' end;

  if v_next_status <> v_status then
    update public.requisitions
    set status = v_next_status
    where doc_id = p_doc_id;
  end if;
end;
$$;

create or replace function app_private.audit_row_change()
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

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
for each row execute function app_private.set_updated_at();

drop trigger if exists set_requisitions_updated_at on public.requisitions;
create trigger set_requisitions_updated_at before update on public.requisitions
for each row execute function app_private.set_updated_at();

drop trigger if exists set_position_groups_updated_at on public.position_groups;
create trigger set_position_groups_updated_at before update on public.position_groups
for each row execute function app_private.set_updated_at();

drop trigger if exists set_document_groups_updated_at on public.document_groups;
create trigger set_document_groups_updated_at before update on public.document_groups
for each row execute function app_private.set_updated_at();

drop trigger if exists set_candidates_updated_at on public.candidates;
create trigger set_candidates_updated_at before update on public.candidates
for each row execute function app_private.set_updated_at();

drop trigger if exists set_offers_updated_at on public.offers;
create trigger set_offers_updated_at before update on public.offers
for each row execute function app_private.set_updated_at();

drop trigger if exists set_sourcing_weekly_updates_updated_at on public.sourcing_weekly_updates;
create trigger set_sourcing_weekly_updates_updated_at before update on public.sourcing_weekly_updates
for each row execute function app_private.set_updated_at();

drop trigger if exists set_vacancy_weekly_snapshots_updated_at on public.vacancy_weekly_snapshots;
create trigger set_vacancy_weekly_snapshots_updated_at before update on public.vacancy_weekly_snapshots
for each row execute function app_private.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function app_private.handle_new_auth_user();
drop trigger if exists audit_requisitions on public.requisitions;
create trigger audit_requisitions after insert or update or delete on public.requisitions
for each row execute function app_private.audit_row_change();

drop trigger if exists audit_requisition_logs on public.requisition_logs;
create trigger audit_requisition_logs after insert or update or delete on public.requisition_logs
for each row execute function app_private.audit_row_change();

drop trigger if exists audit_position_groups on public.position_groups;
create trigger audit_position_groups after insert or update or delete on public.position_groups
for each row execute function app_private.audit_row_change();

drop trigger if exists audit_document_groups on public.document_groups;
create trigger audit_document_groups after insert or update or delete on public.document_groups
for each row execute function app_private.audit_row_change();

drop trigger if exists audit_candidates on public.candidates;
create trigger audit_candidates after insert or update or delete on public.candidates
for each row execute function app_private.audit_row_change();

drop trigger if exists audit_recruitment_logs on public.recruitment_logs;
create trigger audit_recruitment_logs after insert or update or delete on public.recruitment_logs
for each row execute function app_private.audit_row_change();

drop trigger if exists audit_offers on public.offers;
create trigger audit_offers after insert or update or delete on public.offers
for each row execute function app_private.audit_row_change();

drop trigger if exists audit_sourcing_weekly_updates on public.sourcing_weekly_updates;
create trigger audit_sourcing_weekly_updates after insert or update or delete on public.sourcing_weekly_updates
for each row execute function app_private.audit_row_change();

drop trigger if exists audit_vacancy_weekly_snapshots on public.vacancy_weekly_snapshots;
create trigger audit_vacancy_weekly_snapshots after insert or update or delete on public.vacancy_weekly_snapshots
for each row execute function app_private.audit_row_change();
