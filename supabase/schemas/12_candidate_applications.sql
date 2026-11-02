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
create index if not exists candidate_applications_candidate_state on public.candidate_applications(candidate_id, state);
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

-- Never guess a site during backfill.
do $$ begin
  if exists (select 1 from public.candidates c where c.home_site is null and
    (select count(distinct r.site) from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=c.group_id) <> 1)
  then raise exception 'APPLICATION_MIGRATION_RECONCILIATION: Every legacy candidate must resolve to exactly one site.'; end if;
end $$;
update public.candidates c set home_site = (
  select min(r.site) from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=c.group_id
) where home_site is null;
alter table public.candidates alter column home_site set not null;

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
