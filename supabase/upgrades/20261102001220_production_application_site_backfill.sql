-- Independent profiles and durable hiring journeys. Additive upgrade of legacy records.
-- Backfill must not re-derive historical dates or rewrite saved timestamps.
create temporary table application_backfill_trigger_state on commit drop as
select tgrelid::regclass::text as table_name,tgname,tgenabled from pg_trigger
where not tgisinternal and tgrelid in ('public.candidates'::regclass,'public.recruitment_logs'::regclass,'public.offers'::regclass,'public.candidate_reference_checks'::regclass,'public.candidate_requisitions'::regclass);
do $$ declare row record; begin
  for row in select * from application_backfill_trigger_state loop
    execute format('alter table %s disable trigger %I',row.table_name,row.tgname);
  end loop;
end $$;
alter table public.candidates alter column group_id drop not null;
alter table public.candidates add column if not exists home_site text;
alter table public.candidates add column if not exists responsible_recruiter_id uuid references public.profiles(id);
alter table public.candidates add column if not exists position_interests text;

create table if not exists public.candidate_applications (
  application_id uuid primary key default gen_random_uuid(),
  candidate_id text not null references public.candidates(candidate_id) on delete cascade,
  group_id text not null references public.position_groups(group_id) on delete restrict,
  state text not null default 'active' check (state in ('active', 'closed')),
  closure_reason text,
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, candidate_id),
  check ((state = 'active' and closed_at is null and closure_reason is null) or (state = 'closed' and closed_at is not null and closure_reason is not null))
);
create unique index if not exists candidate_applications_active_group on public.candidate_applications(candidate_id, group_id) where state = 'active';
create index if not exists candidate_applications_group on public.candidate_applications(group_id);

create table if not exists public.candidate_application_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.candidate_applications(application_id) on delete cascade,
  group_id text not null references public.position_groups(group_id),
  from_group_id text references public.position_groups(group_id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  actor_id uuid references public.profiles(id),
  reason text,
  attribution_inferred boolean not null default false,
  unique (assignment_id, application_id),
  check (ended_at is null or ended_at >= started_at),
  check (from_group_id is null or nullif(btrim(reason), '') is not null)
);
create unique index if not exists candidate_application_current_assignment on public.candidate_application_assignments(application_id) where ended_at is null;
create index if not exists candidate_assignment_group_date on public.candidate_application_assignments(group_id, started_at);

create table if not exists public.candidate_notes (
  note_id uuid primary key default gen_random_uuid(),
  candidate_id text not null references public.candidates(candidate_id) on delete cascade,
  body text not null check (btrim(body) <> ''),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists candidate_notes_candidate on public.candidate_notes(candidate_id, created_at);

-- Preserve an existing home_site. For null values, a valid exact historical
-- document-group anchor wins; otherwise only a single known group site is safe.
do $$ begin
  if exists (
    select 1
    from public.candidates c
    left join public.document_groups dg on dg.doc_group_id=c.doc_group_id
    where c.doc_group_id is not null
      and (dg.doc_group_id is null or dg.group_id is distinct from c.group_id)
  ) then
    raise exception 'APPLICATION_MIGRATION_RECONCILIATION: Candidate document anchor conflicts with its group.';
  end if;

  if exists (
    select 1 from public.candidates c
    where c.home_site is null
      and c.doc_group_id is not null
      and not exists (
        select 1 from public.document_groups dg
        join public.requisitions r on r.doc_id=dg.doc_id
        where dg.doc_group_id=c.doc_group_id
          and dg.group_id=c.group_id
          and nullif(btrim(r.site),'') is not null
      )
  ) then
    raise exception 'APPLICATION_MIGRATION_RECONCILIATION: Exact candidate document anchor has no known site.';
  end if;

  if exists (
    select 1 from public.candidates c
    where c.home_site is null
      and c.doc_group_id is null
      and (
        select count(distinct nullif(btrim(r.site),''))
        from public.document_groups dg
        join public.requisitions r on r.doc_id=dg.doc_id
        where dg.group_id=c.group_id
          and nullif(btrim(r.site),'') is not null
      ) = 0
  ) then
    raise exception 'APPLICATION_MIGRATION_RECONCILIATION: Candidate group has no known site.';
  end if;
end $$;

update public.candidates c
set home_site = coalesce(
  (
    select nullif(btrim(r.site),'')
    from public.document_groups dg
    join public.requisitions r on r.doc_id=dg.doc_id
    where dg.doc_group_id=c.doc_group_id and dg.group_id=c.group_id
  ),
  (
    select min(nullif(btrim(r.site),''))
    from public.document_groups dg
    join public.requisitions r on r.doc_id=dg.doc_id
    where dg.group_id=c.group_id
      and nullif(btrim(r.site),'') is not null
    having count(distinct nullif(btrim(r.site),'')) = 1
  )
)
where c.home_site is null;

insert into public.candidate_applications(candidate_id, group_id, created_at, updated_at, state, closed_at, closure_reason)
select c.candidate_id, c.group_id, c.created_at, c.updated_at,
  case when exists(select 1 from public.recruitment_logs l where l.candidate_id=c.candidate_id and l.superseded_at is null and l.result=0)
    or exists(select 1 from public.offers o where o.candidate_id=c.candidate_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') then 'closed' else 'active' end,
  case when exists(select 1 from public.recruitment_logs l where l.candidate_id=c.candidate_id and l.superseded_at is null and l.result=0)
    or exists(select 1 from public.offers o where o.candidate_id=c.candidate_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') then c.updated_at else null end,
  case when exists(select 1 from public.offers o where o.candidate_id=c.candidate_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start') then 'accepted_offer'
    when exists(select 1 from public.recruitment_logs l where l.candidate_id=c.candidate_id and l.superseded_at is null and l.result=0) then 'failed_stage' else null end
from public.candidates c where c.group_id is not null and not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id);
insert into public.candidate_application_assignments(application_id, group_id, started_at, attribution_inferred)
select a.application_id, a.group_id, a.created_at, true from public.candidate_applications a
where not exists(select 1 from public.candidate_application_assignments x where x.application_id=a.application_id);

alter table public.recruitment_logs add column if not exists application_id uuid;
alter table public.recruitment_logs add column if not exists entry_assignment_id uuid;
alter table public.recruitment_logs add column if not exists outcome_assignment_id uuid;
alter table public.offers add column if not exists application_id uuid;
alter table public.candidate_reference_checks add column if not exists application_id uuid;
alter table public.candidate_requisitions add column if not exists application_id uuid;
update public.recruitment_logs l set application_id=a.application_id, entry_assignment_id=x.assignment_id,
  outcome_assignment_id=case when l.result is not null then x.assignment_id end
from public.candidate_applications a join public.candidate_application_assignments x on x.application_id=a.application_id
where a.candidate_id=l.candidate_id and l.application_id is null;
update public.offers o set application_id=a.application_id from public.candidate_applications a where a.candidate_id=o.candidate_id and o.application_id is null;
update public.candidate_reference_checks c set application_id=a.application_id from public.candidate_references r join public.candidate_applications a on a.candidate_id=r.candidate_id where c.reference_id=r.reference_id and c.application_id is null;
update public.candidate_requisitions c set application_id=a.application_id from public.candidate_applications a where c.candidate_id=a.candidate_id and c.application_id is null;

alter table public.recruitment_logs alter column application_id set not null;
alter table public.recruitment_logs alter column entry_assignment_id set not null;
alter table public.offers alter column application_id set not null;
alter table public.candidate_reference_checks alter column application_id set not null;
alter table public.candidate_requisitions alter column application_id set not null;
alter table public.recruitment_logs add constraint recruitment_logs_application_candidate_fk foreign key(application_id,candidate_id) references public.candidate_applications(application_id,candidate_id) on delete cascade;
alter table public.recruitment_logs add constraint recruitment_logs_entry_assignment_fk foreign key(entry_assignment_id,application_id) references public.candidate_application_assignments(assignment_id,application_id);
alter table public.recruitment_logs add constraint recruitment_logs_outcome_assignment_fk foreign key(outcome_assignment_id,application_id) references public.candidate_application_assignments(assignment_id,application_id);
alter table public.offers add constraint offers_application_candidate_fk foreign key(application_id,candidate_id) references public.candidate_applications(application_id,candidate_id) on delete cascade;
alter table public.candidate_reference_checks add constraint reference_checks_application_fk foreign key(application_id) references public.candidate_applications(application_id) on delete cascade;
alter table public.candidate_requisitions add constraint candidate_requisitions_application_candidate_fk foreign key(application_id,candidate_id) references public.candidate_applications(application_id,candidate_id) on delete cascade;
alter table public.candidate_reference_checks drop constraint if exists candidate_reference_checks_reference_id_key;
alter table public.candidate_reference_checks add constraint reference_checks_per_application unique(reference_id,application_id);
alter table public.offers drop constraint if exists offers_candidate_id_doc_id_key;
alter table public.offers add constraint offers_per_application unique(application_id,doc_id);
alter table public.candidate_requisitions drop constraint if exists candidate_requisitions_pkey;
alter table public.candidate_requisitions add primary key(application_id,doc_id);
drop index if exists public.uq_recruitment_logs_canonical_stage_round;
drop index if exists public.uq_recruitment_logs_current_pending;
create unique index uq_recruitment_logs_canonical_stage_round on public.recruitment_logs(application_id,recruitment_process,round) where superseded_at is null;
create unique index uq_recruitment_logs_current_pending on public.recruitment_logs(application_id) where superseded_at is null and result is null;
create unique index if not exists offers_one_current_acceptance on public.offers(candidate_id) where accepted_date is not null and start_confirmation is distinct from 'did_not_start';
do $$ declare row record; begin
  for row in select * from application_backfill_trigger_state loop
    execute format('alter table %s %s trigger %I',row.table_name,case row.tgenabled when 'O' then 'enable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'disable' end,row.tgname);
  end loop;
end $$;


create or replace function app_private.can_read_position_group(p_group_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    app_private.current_app_role() in ('system_admin', 'admin_recruiter')
    or exists (
      select 1
      from public.document_groups dg
      where dg.group_id = p_group_id
        and app_private.can_read_requisition(dg.doc_id)
    )
$$;

-- Authorization is checked on every journey; profile visibility does not authorize its other applications.
create or replace function app_private.can_read_application(p_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$
  select exists(select 1 from public.candidate_applications a where a.application_id=p_id and (app_private.is_global_recruitment_reader() or app_private.can_read_position_group(a.group_id)))
$$;
create or replace function app_private.can_manage_application(p_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$
  select exists(select 1 from public.candidate_applications a where a.application_id=p_id and app_private.is_recruitment_writer() and app_private.can_manage_sourcing_group(a.group_id))
$$;
create or replace function app_private.can_read_candidate(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
  select exists(select 1 from public.candidates c where c.candidate_id=p_candidate_id and (
    app_private.is_global_recruitment_reader() or (app_private.is_recruitment_reader() and c.home_site=app_private.current_profile_site())
    or exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id and app_private.can_read_application(a.application_id))))
$$;
create or replace function app_private.can_manage_candidate(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
  select app_private.is_recruitment_writer() and exists(select 1 from public.candidates c where c.candidate_id=p_candidate_id and (
    app_private.current_app_role() in ('system_admin','admin_recruiter') or c.home_site=app_private.current_profile_site() or c.responsible_recruiter_id=auth.uid()))
$$;
create or replace function app_private.current_application_id() returns uuid language sql stable as $$
  select nullif(current_setting('app.application_id',true),'')::uuid
$$;
create or replace function app_private.resolve_application(payload jsonb) returns uuid language plpgsql security definer set search_path=public,app_private as $$
declare v_id uuid:=nullif(payload->>'application_id','')::uuid; v_candidate text:=nullif(payload->>'candidate_id',''); v_count integer; v_record uuid;
begin
  perform app_private.assert_recruitment_writer();
  if nullif(payload->>'stage_instance_id','') is not null then
    select application_id into v_record from public.recruitment_logs where stage_instance_id=(payload->>'stage_instance_id')::uuid;
  elsif nullif(payload->>'offer_id','') is not null then
    select application_id into v_record from public.offers where offer_id=(payload->>'offer_id')::bigint;
  end if;
  if v_id is not null and v_record is not null and v_id<>v_record then raise exception 'APPLICATION_RECORD_MISMATCH'; end if;
  v_id:=coalesce(v_id,v_record,app_private.current_application_id());
  if v_id is null then
    select count(*), (array_agg(application_id))[1] into v_count,v_id from public.candidate_applications where candidate_id=v_candidate and state='active';
    if v_count=0 then
      select count(*), (array_agg(application_id))[1] into v_count,v_id from public.candidate_applications where candidate_id=v_candidate;
    end if;
    if v_count<>1 then raise exception 'APPLICATION_SELECTION_REQUIRED: Select a hiring application explicitly.'; end if;
  end if;
  if not exists(select 1 from public.candidate_applications where application_id=v_id and (v_candidate is null or candidate_id=v_candidate)) then raise exception 'APPLICATION_CANDIDATE_MISMATCH'; end if;
  if not app_private.can_manage_application(v_id) then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  perform 1 from public.candidate_applications where application_id=v_id for update;
  perform set_config('app.application_id',v_id::text,true);
  return v_id;
end $$;
create or replace function app_private.lock_pipeline_candidate(p_candidate_id text) returns void language plpgsql security definer set search_path=public,app_private as $$
begin
  perform app_private.assert_recruitment_writer();
  if app_private.current_application_id() is null or not exists(select 1 from public.candidate_applications where application_id=app_private.current_application_id() and candidate_id=p_candidate_id) or not app_private.can_manage_application(app_private.current_application_id()) then raise exception 'APPLICATION_SELECTION_REQUIRED'; end if;
  perform 1 from public.candidates where candidate_id=p_candidate_id for update;
end $$;
create or replace function app_private.assert_candidate_pipeline_open(p_candidate_id text) returns void language plpgsql stable security definer set search_path=public,app_private as $$
begin
  if not exists(select 1 from public.candidate_applications where application_id=app_private.current_application_id() and candidate_id=p_candidate_id and state='active') then raise exception 'APPLICATION_CLOSED: Start a new application for another attempt.'; end if;
  if exists(select 1 from public.recruitment_logs where application_id=app_private.current_application_id() and superseded_at is null and result=0) then raise exception 'Pipeline update unavailable because this application has a failed stage.'; end if;
  if exists(select 1 from public.recruitment_logs where application_id=app_private.current_application_id() and superseded_at is null and recruitment_process='Offer' and result=1) then raise exception 'Pipeline update unavailable because this application completed all stages.'; end if;
end $$;

create or replace function app_private.stamp_application_activity() returns trigger language plpgsql security definer set search_path=public,app_private as $$
declare v_candidate text; v_assignment uuid;
begin
  if tg_table_name='candidate_reference_checks' then
    select candidate_id into v_candidate from public.candidate_references where reference_id=new.reference_id;
  else v_candidate:=new.candidate_id; end if;
  if tg_op='UPDATE' and new.application_id is distinct from old.application_id then raise exception 'APPLICATION_IMMUTABLE: Activity cannot move between journeys.'; end if;
  if new.application_id is null then new.application_id:=coalesce(app_private.current_application_id(),app_private.resolve_application(jsonb_build_object('candidate_id',v_candidate))); end if;
  if not exists(select 1 from public.candidate_applications where application_id=new.application_id and candidate_id=v_candidate) then raise exception 'APPLICATION_CANDIDATE_MISMATCH'; end if;
  if tg_table_name='recruitment_logs' then
    select assignment_id into v_assignment from public.candidate_application_assignments where application_id=new.application_id and ended_at is null;
    if tg_op='INSERT' then new.entry_assignment_id:=v_assignment;
    elsif new.entry_assignment_id is distinct from old.entry_assignment_id then raise exception 'APPLICATION_ATTRIBUTION_IMMUTABLE'; end if;
    if new.result is not null and (tg_op='INSERT' or old.result is null) then new.outcome_assignment_id:=v_assignment; end if;
  end if;
  return new;
end $$;
drop trigger if exists aa_stamp_application on public.recruitment_logs;
create trigger aa_stamp_application before insert or update on public.recruitment_logs for each row execute function app_private.stamp_application_activity();
drop trigger if exists aa_stamp_application on public.offers;
create trigger aa_stamp_application before insert or update on public.offers for each row execute function app_private.stamp_application_activity();
drop trigger if exists aa_stamp_application on public.candidate_reference_checks;
create trigger aa_stamp_application before insert or update on public.candidate_reference_checks for each row execute function app_private.stamp_application_activity();

create or replace function app_private.sync_application_lifecycle() returns trigger language plpgsql security definer set search_path=public,app_private as $$
begin
  if tg_table_name='recruitment_logs' and new.result=0 and new.superseded_at is null then
    update public.candidate_applications set state='closed',closure_reason='failed_stage',closed_at=now(),updated_at=now(),version=version+1 where application_id=new.application_id;
  elsif tg_table_name='recruitment_logs' then
    update public.candidate_applications set state='active',closure_reason=null,closed_at=null,updated_at=now(),version=version+1 where application_id=new.application_id and closure_reason='failed_stage' and not exists(select 1 from public.recruitment_logs l where l.application_id=new.application_id and l.result=0 and l.superseded_at is null);
  elsif tg_table_name='offers' then
    if new.accepted_date is not null and new.start_confirmation is distinct from 'did_not_start' then
      update public.candidate_applications set state='closed',closure_reason='accepted_offer',closed_at=coalesce(closed_at,now()),updated_at=now(),version=version+1 where application_id=new.application_id;
    elsif tg_op='UPDATE' and old.accepted_date is not null and old.start_confirmation is distinct from 'did_not_start' then
      update public.candidate_applications set state='active',closure_reason=null,closed_at=null,updated_at=now(),version=version+1 where application_id=new.application_id and closure_reason='accepted_offer';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sync_application_lifecycle on public.recruitment_logs;
create trigger sync_application_lifecycle after insert or update on public.recruitment_logs for each row execute function app_private.sync_application_lifecycle();
drop trigger if exists sync_application_lifecycle on public.offers;
create trigger sync_application_lifecycle after insert or update on public.offers for each row execute function app_private.sync_application_lifecycle();

create or replace function app_private.associate_candidate_with_offer_requisition() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    delete from public.candidate_requisitions cr where cr.application_id=old.application_id and cr.doc_id=old.doc_id and not exists(select 1 from public.offers o where o.application_id=old.application_id and o.doc_id=old.doc_id);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    insert into public.candidate_requisitions(application_id,candidate_id,doc_id,created_by) values(new.application_id,new.candidate_id,new.doc_id,auth.uid()) on conflict(application_id,doc_id) do nothing;
  end if;
  return null;
end $$;

alter table public.candidate_applications enable row level security;
alter table public.candidate_application_assignments enable row level security;
alter table public.candidate_notes enable row level security;
create policy application_read on public.candidate_applications for select to authenticated using(app_private.can_read_application(application_id));
create policy assignment_read on public.candidate_application_assignments for select to authenticated using(app_private.can_read_application(application_id));
create policy note_read on public.candidate_notes for select to authenticated using(app_private.can_read_candidate(candidate_id));
revoke all on public.candidate_applications, public.candidate_application_assignments, public.candidate_notes from anon,authenticated;
grant select on public.candidate_applications, public.candidate_application_assignments, public.candidate_notes to authenticated;

create trigger audit_candidate_applications after insert or update or delete on public.candidate_applications for each row execute function app_private.audit_row_change();
create trigger audit_application_assignments after insert or update or delete on public.candidate_application_assignments for each row execute function app_private.audit_row_change();
create trigger audit_candidate_notes after insert or update or delete on public.candidate_notes for each row execute function app_private.audit_row_change();
create trigger set_candidate_applications_updated_at before update on public.candidate_applications for each row execute function app_private.set_updated_at();


create or replace function app_private.assert_reference_check_passable(p_candidate_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unresolved_count integer;
begin
  select count(*)::integer into v_unresolved_count
  from public.candidate_references reference
  left join public.candidate_reference_checks checked on checked.reference_id = reference.reference_id and checked.application_id = app_private.current_application_id()
  where reference.candidate_id = p_candidate_id
    and reference.status = 'available'
    and checked.reference_id is null;

  if v_unresolved_count > 0 then
    raise exception 'PIPELINE_REFERENCE_CHECKS_REQUIRED: % available reference(s) still need a saved check.', v_unresolved_count;
  end if;
end;
$$;

create or replace function app_private.derive_pipeline_pending_date() returns trigger language plpgsql security definer set search_path = public, app_private as $$
declare v_first date; v_previous date; v_has_previous boolean;
begin
  if new.superseded_at is not null then return new; end if;
  if new.record_origin = 'correction' and app_private.is_system_admin() then
    if new.estimated_action_date is not null and new.estimated_action_date < new.log_date then raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Estimated action date cannot precede the corrected Pending date.'; end if;
    return new;
  end if;
  select exists(select 1 from public.recruitment_logs l where l.application_id = new.application_id and l.superseded_at is null and l.log_id is distinct from new.log_id) into v_has_previous;
  if not v_has_previous then
    select first_contact_date into v_first from public.candidates where candidate_id = new.candidate_id;
    if v_first is null then raise exception 'PIPELINE_FIRST_CONTACT_REQUIRED: Add First Contact Date before starting Phone Screen.'; end if;
    new.log_date := v_first;
  else
    select l.outcome_date into v_previous from public.recruitment_logs l where l.application_id = new.application_id and l.superseded_at is null and l.result = 1 and (app_private.pipeline_stage_index(l.recruitment_process) < app_private.pipeline_stage_index(new.recruitment_process) or (l.recruitment_process in ('Line Interview', 'Test') and l.recruitment_process = new.recruitment_process and l.round < new.round)) order by app_private.pipeline_stage_index(l.recruitment_process) desc, l.round desc, l.log_id desc limit 1;
    if v_previous is null then raise exception 'PIPELINE_DATE_ORDER: Pending date must derive from the previous passed Outcome.'; end if;
    new.log_date := v_previous;
  end if;
  if new.estimated_action_date is not null and new.estimated_action_date < new.log_date then raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Estimated action date cannot precede the derived Pending date.'; end if;
  return new;
end;
$$;

create or replace function app_private.propagate_corrected_outcome_date() returns trigger language plpgsql security definer set search_path = public, app_private as $$
declare v_next public.recruitment_logs%rowtype;
begin
  if new.superseded_at is not null or new.record_origin <> 'correction' or new.result <> 1 then return new; end if;
  if exists(select 1 from public.recruitment_logs l where l.application_id = new.application_id and l.superseded_at is null and l.result is not null and (app_private.pipeline_stage_index(l.recruitment_process) > app_private.pipeline_stage_index(new.recruitment_process) or (l.recruitment_process in ('Line Interview', 'Test') and l.recruitment_process = new.recruitment_process and l.round > new.round))) and not app_private.is_system_admin() then raise exception 'PIPELINE_DOWNSTREAM_HISTORY: Outcome date cannot change after a later completed stage exists.'; end if;
  select * into v_next from public.recruitment_logs l where l.application_id = new.application_id and l.superseded_at is null and (app_private.pipeline_stage_index(l.recruitment_process) > app_private.pipeline_stage_index(new.recruitment_process) or (l.recruitment_process in ('Line Interview', 'Test') and l.recruitment_process = new.recruitment_process and l.round > new.round)) order by app_private.pipeline_stage_index(l.recruitment_process), l.round, l.log_id limit 1 for update;
  if new.recruitment_process <> 'Offer' and not found then raise exception 'PIPELINE_NEXT_PENDING_REQUIRED: A next unresolved Pending stage is required for this Outcome correction.'; end if;
  if found then
    if v_next.result is null then
      if v_next.estimated_action_date is not null and v_next.estimated_action_date < new.outcome_date then raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Corrected Outcome would exceed the next Pending estimate.'; end if;
      perform set_config('app.action', 'pipeline:derived-next-pending-date', true);
      update public.recruitment_logs set log_date = new.outcome_date where log_id = v_next.log_id;
    end if;
  end if;
  return new;
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
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result
    into v_current_stage, v_current_result
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
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
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if v_target_stage is null then raise exception 'Target stage is required.'; end if;
  if v_stage_count = 0 then raise exception 'At least one passed stage is required.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result
    into v_current_stage, v_current_result
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
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
      where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
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
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result, round
    into v_current_stage, v_current_result, v_latest_round
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
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
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if v_candidate_id is null then raise exception 'Candidate is required.'; end if;
  if v_target_stage <> 'Reference Check' then raise exception 'Test exit target must be Reference Check.'; end if;
  if v_stage_count <> 1 then raise exception 'Test exit must pass exactly one Test stage.'; end if;
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'You can update process only for candidates where you are person in charge.'; end if;
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);

  select recruitment_process, result, round
    into v_current_stage, v_current_result, v_latest_round
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
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
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_requisition(v_doc_id) or not app_private.can_manage_application(app_private.current_application_id()) then
    raise exception 'You can create offers only for requisitions where you are person in charge.';
  end if;
  if not exists (
    select 1
    from public.candidate_applications c
    join public.document_groups dg on dg.group_id = c.group_id
    where c.candidate_id = v_candidate_id and c.application_id = app_private.current_application_id() and dg.doc_id = v_doc_id
  ) then
    raise exception 'OFFER_CANDIDATE_GROUP_MISMATCH: Candidate must belong to the selected requisition''s sourcing group.';
  end if;

  select exists(select 1 from public.offers where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and doc_id = v_doc_id) into v_exists;
  if v_mode = 'new' and v_exists then raise exception 'This offer already exists. Switch to Change mode to edit it.'; end if;
  if v_mode = 'change' and not v_exists then raise exception 'This offer does not exist. Switch to New mode to create it.'; end if;

  perform set_config('app.action', 'offer:' || v_mode, true);
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not exists(select 1 from public.recruitment_logs where application_id=app_private.current_application_id() and recruitment_process='Offer' and result=1 and superseded_at is null) then raise exception 'OFFER_PASS_REQUIRED'; end if;
  if v_mode='new' and not exists(select 1 from public.requisitions r where r.doc_id=v_doc_id and r.status='ongoing' and r.head_count>(select count(*) from public.offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')) then raise exception 'OFFER_REQUISITION_NOT_AVAILABLE'; end if;
  insert into public.offers (candidate_id, doc_id, accepted_date, first_working_date, remark)
  values (
    v_candidate_id,
    v_doc_id,
    nullif(payload ->> 'accepted_date', '')::date,
    nullif(payload ->> 'first_working_date', '')::date,
    nullif(payload ->> 'remark', '')
  )
  on conflict (application_id, doc_id) do update set
    accepted_date = excluded.accepted_date,
    first_working_date = excluded.first_working_date,
    remark = excluded.remark
  returning offer_id into v_offer_id;

  perform set_config('app.action', 'auto-status', true);
  perform app_private.refresh_requisition_status(v_doc_id);
  return jsonb_build_object('ok', true, 'id', v_offer_id::text);
end;
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
  if not app_private.can_manage_application(app_private.current_application_id()) then
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
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_row public.recruitment_logs%rowtype;
begin
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_opened_date is null then raise exception 'PIPELINE_INVALID_PAYLOAD: Pending opened date is required.'; end if;
  if v_opened_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Pending opened date cannot be after the Bangkok business date.';
  end if;
  if v_estimated_action_date is not null and v_estimated_action_date < v_opened_date then
    raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Estimated action date cannot be before the Pending opened date.';
  end if;
  if exists (
    select 1 from public.recruitment_logs
    where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null
  ) then
    raise exception 'PIPELINE_INVALID_TRANSITION: A canonical Pipeline stage already exists.';
  end if;

  perform set_config('app.action', 'pipeline:start', true);
  insert into public.recruitment_logs (
    candidate_id, log_date, recruitment_process, round, interviewer, result, remark, estimated_action_date, record_origin
  ) values (
    v_candidate_id, v_opened_date, 'Phone Screen', 1,
    nullif(v_pending ->> 'interviewer', ''), null, nullif(v_pending ->> 'remark', ''), v_estimated_action_date, 'user'
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
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_previous_outcome_date date;
  v_row public.recruitment_logs%rowtype;
begin
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage_instance_id, expected_updated_at, and pending.opened_date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
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
    where later.candidate_id = v_candidate_id and later.application_id = app_private.current_application_id()
      and later.superseded_at is null
      and later.log_id > v_row.log_id
  ) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
    or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Pending opened date must follow the previous Outcome, and the estimate cannot precede the Pending opened date.';
  end if;

  perform set_config('app.action', 'pipeline:pending-edit', true);
  update public.recruitment_logs
  set log_date = v_opened_date,
      interviewer = nullif(v_pending ->> 'interviewer', ''),
      remark = nullif(v_pending ->> 'remark', ''),
      estimated_action_date = v_estimated_action_date,
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
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_next_estimated_action_date date := nullif(v_next ->> 'estimated_action_date', '')::date;
  v_expected_next_stage text;
  v_previous_outcome_date date;
  v_next_opened_date date;
  v_row public.recruitment_logs%rowtype;
  v_next_row public.recruitment_logs%rowtype;
  v_next_id uuid;
  v_handoff jsonb;
  v_failure_snapshot jsonb;
begin
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null or v_outcome_date is null or v_result is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: stage instance, expected timestamp, Pending date, and Pass/Fail outcome date are required.';
  end if;

  select * into v_row
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id()
    and stage_instance_id = v_stage_instance_id
    and superseded_at is null
  for update;

  if not found or v_row.result is not null then raise exception 'PIPELINE_NOT_CURRENT: The selected stage is not Pending.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.application_id = app_private.current_application_id() and later.superseded_at is null and later.log_id > v_row.log_id) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or v_outcome_date > app_private.pipeline_business_date()
    or v_outcome_date < v_opened_date
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
    or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date)
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must satisfy previous Outcome <= Pending <= Outcome <= Bangkok business date.';
  end if;

  if v_result = 0 then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Fail cannot create a next Pending stage.'; end if;
    v_failure_snapshot := app_private.failure_reason_snapshot(nullif(v_outcome ->> 'failure_actor', ''), nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid);
  elsif v_row.recruitment_process = 'Offer' then
    if v_next_stage is not null then raise exception 'PIPELINE_INVALID_TRANSITION: Offer Pass uses handoff and cannot create a next Pending stage.'; end if;
  elsif v_row.recruitment_process in ('Line Interview', 'Test') and v_next_stage = v_row.recruitment_process then
    if v_next_round <> v_row.round + 1 then raise exception 'PIPELINE_INVALID_TRANSITION: The next repeatable-stage round must be current round plus one.'; end if;
  else
    v_expected_next_stage := (array['Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer']::text[])[app_private.pipeline_stage_index(v_row.recruitment_process) + 1];
    if v_next_stage is distinct from v_expected_next_stage or v_next_round <> 1 then
      raise exception 'PIPELINE_NEXT_PENDING_REQUIRED: Pass must create the immediate next stage as round 1 Pending.';
    end if;
  end if;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    -- The next Pending is created as part of this completion, so its date is
    -- always the selected Outcome date. Ignore legacy client-supplied values.
    v_next_opened_date := v_outcome_date;
    if v_next_estimated_action_date is not null and v_next_estimated_action_date < v_next_opened_date then
      raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Next estimated action date cannot be before the next Pending opened date.';
    end if;
  end if;

  perform set_config('app.action', case when v_result = 1 then 'pipeline:pass' else 'pipeline:fail' end, true);
  update public.recruitment_logs
  set log_date = v_opened_date,
      interviewer = nullif(v_pending ->> 'interviewer', ''),
      remark = nullif(v_pending ->> 'remark', ''),
      estimated_action_date = v_estimated_action_date,
      pending_edited_at = now(),
      pending_edited_by = auth.uid(),
      result = v_result,
      outcome_date = v_outcome_date,
      outcome_interviewer = nullif(v_outcome ->> 'interviewer', ''),
      outcome_remark = nullif(v_outcome ->> 'remark', ''),
      failure_actor = case when v_result = 0 then v_outcome ->> 'failure_actor' else null end,
      failure_main_reason_id = case when v_result = 0 then nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid else null end,
      failure_detail_reason_id = case when v_result = 0 then nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid else null end,
      failure_reason_snapshot = v_failure_snapshot,
      outcome_recorded_at = now()
  where log_id = v_row.log_id
  returning * into v_row;

  if v_result = 1 and v_row.recruitment_process <> 'Offer' then
    v_next_id := gen_random_uuid();
    perform set_config('app.action', 'pipeline:next-pending', true);
    insert into public.recruitment_logs (
      stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, estimated_action_date, record_origin
    ) values (
      v_next_id, v_candidate_id, v_next_opened_date, v_next_stage, v_next_round,
      nullif(v_next ->> 'interviewer', ''), null, nullif(v_next ->> 'remark', ''), v_next_estimated_action_date, 'auto'
    ) returning * into v_next_row;
    v_next_id := v_next_row.stage_instance_id;
  end if;

  if v_result = 1 and v_row.recruitment_process = 'Offer' then
    select jsonb_build_object(
      'candidate_id', v_candidate_id,
      'passed_date', v_outcome_date,
      'group_id', c.group_id,
      'requisitions', coalesce(jsonb_agg(jsonb_build_object(
        'doc_group_id', peer.doc_group_id,
        'doc_id', r.doc_id,
        'site', r.site,
        'position', r.position,
        'open_headcount', greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0)
      ) order by r.doc_id) filter (where r.doc_id is not null), '[]'::jsonb)
    ) into v_handoff
    from public.candidate_applications c
    join public.document_groups peer on peer.group_id = c.group_id
    join public.requisitions r on r.doc_id = peer.doc_id and r.status = 'ongoing'
    left join lateral (
      select count(*)::integer accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start'
    ) accepted on true
    where c.candidate_id = v_candidate_id and c.application_id = app_private.current_application_id()
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
    group by c.group_id;

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
  v_target_estimated_action_date date := nullif(v_target ->> 'estimated_action_date', '')::date;
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
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_stage_instance_id is null or v_expected_updated_at is null or v_count < 1 or v_target_stage is null or v_target_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: current instance, expected timestamp, passed stages, and target Pending are required.';
  end if;

  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found or v_current.result is not null then raise exception 'PIPELINE_NOT_CURRENT: Jump requires the current Pending stage.'; end if;
  if v_current.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Pending stage changed after it was opened.'; end if;
  if exists (select 1 from public.recruitment_logs later where later.candidate_id = v_candidate_id and later.application_id = app_private.current_application_id() and later.superseded_at is null and later.log_id > v_current.log_id) then
    raise exception 'PIPELINE_NOT_CURRENT: A later canonical stage already exists.';
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and log_id < v_current.log_id
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
          estimated_action_date = nullif(v_pending ->> 'estimated_action_date', '')::date,
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
  if v_target_estimated_action_date is not null and v_target_estimated_action_date < v_target_date then
    raise exception 'PIPELINE_ESTIMATED_DATE_ORDER: Target estimated action date cannot be before the target Pending opened date.';
  end if;
  v_new_id := gen_random_uuid();
  perform set_config('app.action', 'pipeline:jump-target-pending', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark, estimated_action_date, record_origin
  ) values (
    v_new_id, v_candidate_id, v_target_date, v_target_stage, coalesce(nullif(v_target ->> 'round', '')::integer, 1),
    nullif(v_target ->> 'interviewer', ''), null, nullif(v_target ->> 'remark', ''), v_target_estimated_action_date, 'auto'
  );

  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object(
    'ok', true,
    'completed_stage_instance_ids', (
      select coalesce(jsonb_agg(stage_instance_id order by log_id), '[]'::jsonb)
      from public.recruitment_logs
      where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result = 1
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
  v_failure_snapshot jsonb;
begin
  perform app_private.resolve_application(payload);
  perform app_private.assert_system_admin();
  if v_candidate_id is null or v_stage_instance_id is null or v_expected_updated_at is null or v_result is null or v_outcome_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: candidate, stage instance, expected timestamp, and corrected Outcome are required.';
  end if;
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;

  select * into v_row from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found or v_row.result is null then raise exception 'PIPELINE_NOT_FOUND: A canonical completed stage is required.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The Outcome changed after it was opened.'; end if;
  if v_result is distinct from v_row.result then
    raise exception 'PIPELINE_CORRECTION_RESULT_IMMUTABLE: Outcome correction cannot change Pass/Fail.';
  end if;
  if v_row.result = 0 then
    if v_outcome ? 'failure_actor' or v_outcome ? 'failure_main_reason_id' or v_outcome ? 'failure_detail_reason_id' then
      v_failure_snapshot := app_private.failure_reason_snapshot(nullif(v_outcome ->> 'failure_actor', ''), nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid);
    else
      v_failure_snapshot := v_row.failure_reason_snapshot;
    end if;
  end if;
  select outcome_date into v_previous_outcome_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  select log_date into v_next_opened_date
  from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and log_id > v_row.log_id
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
    failure_actor, failure_main_reason_id, failure_detail_reason_id, failure_reason_snapshot,
    pending_edited_at, pending_edited_by, record_origin, migration_note,
    created_at
  ) values (
    v_replacement_id, v_row.candidate_id, v_row.log_date, v_row.recruitment_process, v_row.round, v_row.interviewer,
    v_row.result, v_row.remark, v_outcome_date, nullif(v_outcome ->> 'interviewer', ''),
    nullif(v_outcome ->> 'remark', ''), now(),
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_actor', ''), v_row.failure_actor) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, v_row.failure_main_reason_id) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid, v_row.failure_detail_reason_id) else null end,
    v_failure_snapshot, v_row.pending_edited_at, v_row.pending_edited_by,
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

create or replace function public.app_confirm_offer_start_v1(payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare
  v_offer public.offers%rowtype;
  v_outcome text := nullif(payload ->> 'start_confirmation', '');
  v_reason text := nullif(btrim(payload ->> 'reason'), '');
  v_expected timestamptz := nullif(payload ->> 'expected_updated_at', '')::timestamptz;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform app_private.resolve_application(payload);
  perform app_private.assert_recruitment_writer();
  select * into v_offer from public.offers where offer_id = nullif(payload ->> 'offer_id', '')::bigint for update;
  if not found then raise exception 'OFFER_NOT_FOUND: Offer not found.'; end if;
  if not app_private.can_manage_requisition(v_offer.doc_id) or not app_private.can_manage_candidate(v_offer.candidate_id) then raise exception 'OFFER_PERMISSION_DENIED: You cannot confirm this offer.'; end if;
  if v_expected is null or v_offer.updated_at <> v_expected then raise exception 'OFFER_STALE_WRITE: This offer changed after it was opened.'; end if;
  if v_outcome not in ('started', 'did_not_start') then raise exception 'OFFER_CONFIRMATION_INVALID: Select Started or Did not start.'; end if;
  if v_offer.accepted_date is null or v_offer.first_working_date is null or v_offer.first_working_date > v_today then raise exception 'OFFER_CONFIRMATION_NOT_DUE: Confirmation is available on or after the first working date.'; end if;
  if v_outcome = 'did_not_start' and v_reason is null then raise exception 'OFFER_CONFIRMATION_REASON_REQUIRED: Did not start requires a reason.'; end if;
  if v_offer.start_confirmation is not null and app_private.current_app_role() not in ('system_admin', 'admin_recruiter') then raise exception 'OFFER_CONFIRMATION_CORRECTION_DENIED: Only an administrator can correct a saved confirmation.'; end if;
  perform set_config('app.action', case when v_offer.start_confirmation is null then 'offer:start-confirmed' else 'offer:start-confirmation-corrected' end, true);
  update public.offers set start_confirmation = v_outcome, start_confirmed_at = now(), start_confirmed_by = auth.uid(), start_confirmation_reason = case when v_outcome = 'did_not_start' then v_reason else null end where offer_id = v_offer.offer_id;
  perform set_config('app.action', 'auto-status', true);
  perform app_private.refresh_requisition_status(v_offer.doc_id);
  return jsonb_build_object('ok', true, 'id', v_offer.offer_id::text);
end;
$$;

create or replace function public.app_correct_pipeline_stage_record_v3(payload jsonb)
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
  v_outcome jsonb := payload -> 'outcome';
  v_opened_date date := nullif(v_pending ->> 'opened_date', '')::date;
  v_estimated_action_date date := nullif(v_pending ->> 'estimated_action_date', '')::date;
  v_outcome_date date := nullif(v_outcome ->> 'date', '')::date;
  v_result smallint := case lower(coalesce(v_outcome ->> 'result', '')) when 'pass' then 1 when '1' then 1 when 'fail' then 0 when '0' then 0 else null end;
  v_row public.recruitment_logs%rowtype;
  v_replacement public.recruitment_logs%rowtype;
  v_replacement_id uuid := gen_random_uuid();
  v_previous_outcome_date date;
  v_next_opened_date date;
  v_failure_snapshot jsonb;
begin
  perform app_private.resolve_application(payload);
  if app_private.current_app_role() not in ('system_admin', 'admin_recruiter') then
    raise exception 'PIPELINE_ADMIN_REQUIRED: System admin or admin recruiter role is required.';
  end if;
  if v_candidate_id is null or v_stage_instance_id is null or v_expected_updated_at is null or v_opened_date is null then
    raise exception 'PIPELINE_INVALID_PAYLOAD: candidate, stage instance, expected timestamp, and Pending date are required.';
  end if;
  perform 1 from public.candidates where candidate_id = v_candidate_id for update;
  if not found then raise exception 'PIPELINE_CANDIDATE_NOT_FOUND: Candidate does not exist.'; end if;

  select * into v_row from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and stage_instance_id = v_stage_instance_id and superseded_at is null
  for update;
  if not found then raise exception 'PIPELINE_NOT_FOUND: A canonical pipeline record is required.'; end if;
  if v_row.updated_at <> v_expected_updated_at then raise exception 'PIPELINE_STALE_WRITE: The pipeline record changed after it was opened.'; end if;
  if (v_row.result is null and v_outcome is not null) or (v_row.result is not null and (v_outcome is null or v_result is null or v_outcome_date is null)) then
    raise exception 'PIPELINE_INVALID_PAYLOAD: Pending records have no Outcome; completed records require result and Outcome date.';
  end if;
  if v_row.result is not null and v_result is distinct from v_row.result then
    raise exception 'PIPELINE_CORRECTION_RESULT_IMMUTABLE: Outcome correction cannot change Pass/Fail.';
  end if;
  if v_row.result = 0 then
    if v_outcome ? 'failure_actor' or v_outcome ? 'failure_main_reason_id' or v_outcome ? 'failure_detail_reason_id' then
      v_failure_snapshot := app_private.failure_reason_snapshot(nullif(v_outcome ->> 'failure_actor', ''), nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid);
    else
      v_failure_snapshot := v_row.failure_reason_snapshot;
    end if;
  end if;

  select outcome_date into v_previous_outcome_date from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is not null and log_id < v_row.log_id
  order by log_id desc limit 1;
  if v_opened_date > app_private.pipeline_business_date()
    or (v_previous_outcome_date is not null and v_opened_date < v_previous_outcome_date)
    or (v_estimated_action_date is not null and v_estimated_action_date < v_opened_date)
    or (v_row.result is not null and (v_outcome_date > app_private.pipeline_business_date() or v_outcome_date < v_opened_date))
  then
    raise exception 'PIPELINE_DATE_ORDER: Dates must remain within the previous Outcome and this Pending/Outcome.';
  end if;

  perform set_config('app.action', 'pipeline:admin-record-correction-supersede', true);
  update public.recruitment_logs set superseded_at = now(), superseded_by_stage_instance_id = v_replacement_id,
    superseded_reason = 'pipeline record corrected by administrator' where log_id = v_row.log_id;
  perform set_config('app.action', 'pipeline:admin-record-correction-replacement', true);
  insert into public.recruitment_logs (
    stage_instance_id, candidate_id, log_date, recruitment_process, round, interviewer, result, remark,
    estimated_action_date, outcome_date, outcome_interviewer, outcome_remark, outcome_recorded_at,
    failure_actor, failure_main_reason_id, failure_detail_reason_id, failure_reason_snapshot,
    pending_edited_at, pending_edited_by, record_origin, migration_note, created_at
  ) values (
    v_replacement_id, v_row.candidate_id, v_opened_date, v_row.recruitment_process, v_row.round,
    nullif(v_pending ->> 'interviewer', ''), case when v_row.result is null then null else v_result end, nullif(v_pending ->> 'remark', ''),
    v_estimated_action_date,
    case when v_row.result is null then null else v_outcome_date end,
    case when v_row.result is null then null else nullif(v_outcome ->> 'interviewer', '') end,
    case when v_row.result is null then null else nullif(v_outcome ->> 'remark', '') end,
    case when v_row.result is null then null else now() end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_actor', ''), v_row.failure_actor) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_main_reason_id', '')::uuid, v_row.failure_main_reason_id) else null end,
    case when v_result = 0 then coalesce(nullif(v_outcome ->> 'failure_detail_reason_id', '')::uuid, v_row.failure_detail_reason_id) else null end,
    v_failure_snapshot,
    now(), auth.uid(), 'correction', concat_ws('; ', nullif(v_row.migration_note, ''), 'corrected from ' || v_row.stage_instance_id::text), v_row.created_at
  ) returning * into v_replacement;
  update public.candidates set updated_at = now() where candidate_id = v_candidate_id;
  return jsonb_build_object('ok', true, 'superseded_stage_instance_id', v_row.stage_instance_id,
    'replacement_stage_instance_id', v_replacement.stage_instance_id, 'updated_at', v_replacement.updated_at);
end;
$$;

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
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  if v_event_date is null then raise exception 'PIPELINE_INVALID_PAYLOAD: Date is required.'; end if;
  if v_event_date > app_private.pipeline_business_date() then
    raise exception 'PIPELINE_DATE_ORDER: Date cannot be after the Bangkok business date.';
  end if;

  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is null
  order by log_id desc limit 1 for update;

  if not found then
    if v_stage <> 'Phone Screen' or v_result is not null
      or exists (select 1 from public.recruitment_logs where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null)
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
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is null
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
  perform app_private.resolve_application(payload);
  perform app_private.lock_pipeline_candidate(v_candidate_id);
  perform app_private.assert_candidate_pipeline_open(v_candidate_id);
  select * into v_current from public.recruitment_logs
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is null
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
  perform app_private.resolve_application(payload);
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
  where candidate_id = v_candidate_id and application_id = app_private.current_application_id() and superseded_at is null and result is null
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
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'PROFILE_NOT_AUTHORIZED'; end if;
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
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_candidate(v_candidate_id) then raise exception 'PROFILE_NOT_AUTHORIZED'; end if;
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
  perform app_private.resolve_application(payload);
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
  select * into v_check from public.candidate_reference_checks where reference_id = v_reference_id and application_id = app_private.current_application_id() for update;
  if found then
    if v_expected_updated_at is null or v_check.updated_at <> v_expected_updated_at then
      raise exception 'REFERENCE_STALE_WRITE: The saved check changed after it was opened.';
    end if;
    perform set_config('app.action', 'candidate-reference-check:edit', true);
    update public.candidate_reference_checks
    set checked_date = v_checked_date, duration_minutes = v_duration, conversation_summary = v_summary, checked_by = auth.uid()
    where reference_id = v_reference_id and application_id = app_private.current_application_id() returning * into v_check;
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

create or replace function app_private.assert_application_destination(p_candidate text,p_group text) returns void language plpgsql security definer set search_path=public,app_private as $$
declare v_site text; v_home text;
begin
  if not app_private.can_manage_sourcing_group(p_group) or not app_private.has_open_group_requisition(p_group) then raise exception 'APPLICATION_GROUP_NOT_AVAILABLE: Select a group you manage with remaining open demand.'; end if;
  select home_site into v_home from public.candidates where candidate_id=p_candidate;
  select min(r.site) into v_site from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=p_group;
  if v_site is distinct from v_home and app_private.current_app_role() not in ('system_admin','admin_recruiter') then raise exception 'APPLICATION_CROSS_SITE_ADMIN_REQUIRED'; end if;
end $$;

create or replace function public.app_create_candidate_application_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_candidate text:=nullif(payload->>'candidate_id',''); v_group text:=nullif(payload->>'group_id',''); v_id uuid; v_date date:=coalesce(nullif(payload->>'opened_date','')::date,(now() at time zone 'Asia/Bangkok')::date);
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_read_candidate(v_candidate) then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  perform 1 from public.candidates where candidate_id=v_candidate for update;
  perform app_private.assert_application_destination(v_candidate,v_group);
  if v_date>(now() at time zone 'Asia/Bangkok')::date then raise exception 'PIPELINE_DATE_ORDER'; end if;
  if exists(select 1 from public.candidate_applications where candidate_id=v_candidate and group_id=v_group and state='active') then raise exception 'APPLICATION_ALREADY_ACTIVE'; end if;
  perform set_config('app.action','application:create',true);
  insert into public.candidate_applications(candidate_id,group_id,created_by) values(v_candidate,v_group,auth.uid()) returning application_id into v_id;
  insert into public.candidate_application_assignments(application_id,group_id,actor_id) values(v_id,v_group,auth.uid());
  perform set_config('app.application_id',v_id::text,true);
  insert into public.recruitment_logs(application_id,candidate_id,log_date,recruitment_process,round,result,remark,record_origin)
    values(v_id,v_candidate,v_date,'Phone Screen',1,null,'Initial pending phone screening','auto');
  -- Legacy anchors remain usable only while exactly one journey exists.
  update public.candidates set group_id=case when (select count(*) from public.candidate_applications where candidate_id=v_candidate)=1 then v_group else null end,doc_group_id=null,updated_at=now() where candidate_id=v_candidate;
  return jsonb_build_object('ok',true,'id',v_candidate,'candidate_id',v_candidate,'application_id',v_id);
end $$;

create or replace function public.app_upsert_candidate_profile_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_id text:=nullif(payload->>'candidate_id',''); v_mode text:=coalesce(payload->>'mode','new'); v_home text:=nullif(btrim(payload->>'home_site'),''); v_previous public.candidates%rowtype;
  v_owner uuid:=coalesce(nullif(payload->>'responsible_recruiter_id','')::uuid,auth.uid()); v_phone text:=nullif(btrim(payload->>'phone_no'),''); v_email text:=nullif(btrim(payload->>'email'),''); v_result jsonb; v_ref jsonb;
begin
  perform app_private.assert_recruitment_writer();
  if v_mode not in ('new','change') then raise exception 'PROFILE_MODE_INVALID'; end if;
  if v_mode='change' then
    if not app_private.can_manage_candidate(v_id) then raise exception 'PROFILE_NOT_AUTHORIZED'; end if;
    select * into v_previous from public.candidates where candidate_id=v_id for update;
    if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
    v_owner:=coalesce(nullif(payload->>'responsible_recruiter_id','')::uuid,v_previous.responsible_recruiter_id);
    if app_private.current_app_role()='site_recruiter' and (v_home is distinct from v_previous.home_site or (v_owner is distinct from v_previous.responsible_recruiter_id and not (v_previous.responsible_recruiter_id is null and v_owner=auth.uid()))) then raise exception 'PROFILE_OWNERSHIP_ADMIN_REQUIRED'; end if;
  else
    v_id:=app_private.next_app_id('candidates','CAN');
    if app_private.current_app_role()='site_recruiter' then v_home:=app_private.current_profile_site(); v_owner:=auth.uid(); end if;
  end if;
  if v_home is null or nullif(btrim(payload->>'name'),'') is null then raise exception 'PROFILE_REQUIRED: Name and home site are required.'; end if;
  if (v_mode='change' and v_phone is null) or (v_phone is not null and v_phone !~ '^0[0-9]{9}$') then raise exception 'CANDIDATE_PHONE_INVALID'; end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'CANDIDATE_EMAIL_INVALID'; end if;
  if nullif(payload->>'first_contact_date','')::date>(now() at time zone 'Asia/Bangkok')::date then raise exception 'PIPELINE_DATE_ORDER'; end if;
  if coalesce((payload->>'duplicate_acknowledged')::boolean,false)=false and exists(select 1 from public.candidates c where c.candidate_id<>v_id and app_private.can_read_candidate(c.candidate_id) and ((v_phone is not null and regexp_replace(c.phone_no,'[^0-9]','','g')=v_phone) or (v_email is not null and lower(btrim(c.email))=lower(v_email)))) then raise exception 'PROFILE_DUPLICATE_ACKNOWLEDGEMENT_REQUIRED: Review matching profiles before saving.'; end if;
  perform set_config('app.action','candidate-profile:'||v_mode,true);
  insert into public.candidates(candidate_id,name,nickname,phone_no,email,home_site,responsible_recruiter_id,position_interests,channel,ref_name,first_contact_date,candidate_folder_url)
    values(v_id,btrim(payload->>'name'),nullif(btrim(payload->>'nickname'),''),v_phone,v_email,v_home,v_owner,nullif(btrim(payload->>'position_interests'),''),nullif(payload->>'channel',''),nullif(payload->>'ref_name',''),nullif(payload->>'first_contact_date','')::date,nullif(payload->>'candidate_folder_url',''))
    on conflict(candidate_id) do update set name=excluded.name,nickname=excluded.nickname,phone_no=excluded.phone_no,email=excluded.email,home_site=excluded.home_site,responsible_recruiter_id=excluded.responsible_recruiter_id,position_interests=excluded.position_interests,channel=excluded.channel,ref_name=excluded.ref_name,first_contact_date=excluded.first_contact_date,candidate_folder_url=excluded.candidate_folder_url;
  if nullif(btrim(payload->>'note'),'') is not null then insert into public.candidate_notes(candidate_id,body,created_by) values(v_id,btrim(payload->>'note'),auth.uid()); end if;
  for v_ref in select value from jsonb_array_elements(coalesce(payload->'references','[]'::jsonb)) loop
    perform public.app_upsert_candidate_reference_v1(v_ref||jsonb_build_object('candidate_id',v_id));
  end loop;
  v_result:=jsonb_build_object('ok',true,'id',v_id,'candidate_id',v_id);
  if v_mode='new' and nullif(payload->>'group_id','') is not null then
    v_result:=public.app_create_candidate_application_v1(jsonb_build_object('candidate_id',v_id,'group_id',payload->>'group_id','opened_date',payload->>'first_contact_date'));
  end if;
  return v_result;
end $$;

create or replace function public.app_upsert_candidate(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_home text; v_candidate public.candidates%rowtype;
begin
  if payload->>'mode'='change' then
    select * into v_candidate from public.candidates where candidate_id=payload->>'candidate_id';
    v_home:=v_candidate.home_site;
    if nullif(payload->>'group_id','') is not null and payload->>'group_id' is distinct from v_candidate.group_id then raise exception 'APPLICATION_TRANSFER_REQUIRED: Reassign the application instead of editing profile group.'; end if;
  else
    select min(r.site) into v_home from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=payload->>'group_id';
  end if;
  return public.app_upsert_candidate_profile_v1(jsonb_build_object('home_site',v_home,'responsible_recruiter_id',coalesce(v_candidate.responsible_recruiter_id,auth.uid()))||payload);
end $$;

create or replace function public.app_transfer_candidate_application_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_id uuid:=app_private.resolve_application(payload); v_group text:=nullif(payload->>'group_id',''); v_reason text:=nullif(btrim(payload->>'reason'),''); v_row public.candidate_applications%rowtype; v_source_site text; v_destination_site text;
begin
  select * into v_row from public.candidate_applications where application_id=v_id for update;
  if v_row.state<>'active' then raise exception 'APPLICATION_CLOSED'; end if;
  if nullif(payload->>'expected_version','')::integer is distinct from v_row.version then raise exception 'APPLICATION_STALE_WRITE: Refresh before reassigning.'; end if;
  if v_reason is null or v_group is null or v_group=v_row.group_id then raise exception 'APPLICATION_TRANSFER_INVALID: Choose another group and enter a reason.'; end if;
  perform 1 from public.candidates where candidate_id=v_row.candidate_id for update;
  perform app_private.assert_application_destination(v_row.candidate_id,v_group);
  select min(r.site) into v_source_site from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=v_row.group_id;
  select min(r.site) into v_destination_site from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=v_group;
  if v_source_site is distinct from v_destination_site and app_private.current_app_role() not in ('system_admin','admin_recruiter') then raise exception 'APPLICATION_CROSS_SITE_ADMIN_REQUIRED'; end if;
  if exists(select 1 from public.candidate_applications where candidate_id=v_row.candidate_id and group_id=v_group and state='active') then raise exception 'APPLICATION_ALREADY_ACTIVE'; end if;
  if exists(select 1 from public.offers where application_id=v_id and accepted_date is not null and start_confirmation is distinct from 'did_not_start') then raise exception 'APPLICATION_ACCEPTED_OFFER_BLOCKS_TRANSFER'; end if;
  if exists(select 1 from public.interview_meetings m join public.recruitment_logs l on l.stage_instance_id=m.stage_instance_id where l.application_id=v_id and m.status in ('creating','scheduled','rescheduling','cancelling')) then raise exception 'APPLICATION_MEETING_REQUIRES_RESOLUTION: Resolve the scheduled Teams meeting before reassignment.'; end if;
  perform set_config('app.action','application:reassign',true);
  update public.candidate_application_assignments set ended_at=now() where application_id=v_id and ended_at is null;
  insert into public.candidate_application_assignments(application_id,group_id,from_group_id,actor_id,reason) values(v_id,v_group,v_row.group_id,auth.uid(),v_reason);
  update public.candidate_applications set group_id=v_group,version=version+1,updated_at=now() where application_id=v_id;
  update public.candidates set group_id=case when (select count(*) from public.candidate_applications where candidate_id=v_row.candidate_id)=1 then v_group else null end,doc_group_id=null,updated_at=now() where candidate_id=v_row.candidate_id;
  return jsonb_build_object('ok',true,'id',v_row.candidate_id,'application_id',v_id,'version',v_row.version+1);
end $$;

create or replace function public.app_add_candidate_note_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_id uuid;
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_candidate(payload->>'candidate_id') then raise exception 'PROFILE_NOT_AUTHORIZED'; end if;
  insert into public.candidate_notes(candidate_id,body,created_by) values(payload->>'candidate_id',btrim(payload->>'body'),auth.uid()) returning note_id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

revoke all on function public.app_upsert_candidate_profile_v1(jsonb),public.app_create_candidate_application_v1(jsonb),public.app_transfer_candidate_application_v1(jsonb),public.app_add_candidate_note_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_upsert_candidate_profile_v1(jsonb),public.app_create_candidate_application_v1(jsonb),public.app_transfer_candidate_application_v1(jsonb),public.app_add_candidate_note_v1(jsonb) to authenticated;
revoke all on all functions in schema app_private from public,anon;
grant execute on all functions in schema app_private to authenticated;


drop policy if exists candidates_read on public.candidates;
create policy candidates_read on public.candidates
for select to authenticated
using (app_private.can_read_candidate(candidate_id));

drop policy if exists candidate_requisitions_scoped_read on public.candidate_requisitions;
create policy candidate_requisitions_scoped_read on public.candidate_requisitions
for select to authenticated
using (app_private.can_read_requisition(doc_id) and app_private.can_read_application(application_id));

drop policy if exists recruitment_logs_read on public.recruitment_logs;
create policy recruitment_logs_read on public.recruitment_logs
for select to authenticated
using (
  app_private.can_read_application(recruitment_logs.application_id)
);

drop policy if exists offers_read on public.offers;
create policy offers_read on public.offers
for select to authenticated
using (app_private.can_read_requisition(doc_id) and app_private.can_read_application(application_id));

drop policy if exists rejection_letter_drafts_read on public.rejection_letter_drafts;
create policy rejection_letter_drafts_read on public.rejection_letter_drafts for select to authenticated using (exists(select 1 from public.recruitment_logs l where l.stage_instance_id=rejection_letter_drafts.failed_stage_instance_id and app_private.can_read_application(l.application_id)));

drop policy if exists interview_meetings_read on public.interview_meetings;
create policy interview_meetings_read on public.interview_meetings for select to authenticated using (exists(select 1 from public.recruitment_logs l where l.stage_instance_id=interview_meetings.stage_instance_id and app_private.can_read_application(l.application_id)));

drop policy if exists candidate_reference_checks_scoped_read on public.candidate_reference_checks;
create policy candidate_reference_checks_scoped_read on public.candidate_reference_checks
for select to authenticated
using (
  exists (
    select 1 from public.candidate_references reference
    where reference.reference_id = candidate_reference_checks.reference_id
      and (select app_private.can_read_application(candidate_reference_checks.application_id))
  )
);