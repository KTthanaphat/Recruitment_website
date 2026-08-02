-- Migration integration test.
-- Prerequisite: migrate a disposable database through 202607250001, then run
-- this file with psql. It seeds legacy rows, applies the paired-status migration,
-- verifies reconciliation, and rolls everything back.
\set ON_ERROR_STOP on

begin;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'Assertion failed: %', p_message;
  end if;
end;
$$;

insert into public.requisitions (doc_id, site, position, department, person_in_charge, status)
values ('__paired_migration_req', '__paired_migration_site', 'Migration fixture', 'Test', 'Migration Owner', 'ongoing');

insert into public.document_groups (doc_group_id, doc_id, group_position)
values ('__paired_migration_link', '__paired_migration_req', 'Migration fixture');

insert into public.candidates (candidate_id, name, doc_group_id, first_contact_date)
values
  ('__migration_outcome_only', 'Outcome Only', '__paired_migration_link', date '2026-07-02'),
  ('__migration_clamped_fallback', 'Clamped Fallback', '__paired_migration_link', date '2026-07-20'),
  ('__migration_pending_chain', 'Pending Chain', '__paired_migration_link', date '2026-07-01'),
  ('__migration_fail_conflict', 'Fail Conflict', '__paired_migration_link', date '2026-07-01'),
  ('__migration_legacy_only', 'Legacy Only', '__paired_migration_link', date '2026-07-01');

-- Outcome-only canonical rows: Phone uses first contact; HR uses previous
-- canonical Outcome. The latest HR Pass must also create Line Interview Pending.
insert into public.recruitment_logs (
  candidate_id, log_date, recruitment_process, round, interviewer, result, remark, created_at
)
values
  ('__migration_outcome_only', date '2026-07-05', 'Phone Screen', 1, 'Phone outcome interviewer', 1, 'Phone outcome', timestamptz '2026-07-05 09:00:00+07'),
  ('__migration_outcome_only', date '2026-07-08', 'HR Interview', 1, 'HR outcome interviewer', 1, 'HR outcome', timestamptz '2026-07-08 09:00:00+07'),
  ('__migration_clamped_fallback', date '2026-07-10', 'Phone Screen', 1, 'Outcome interviewer', 1, 'Outcome before bad first contact', timestamptz '2026-07-10 09:00:00+07');

-- Earlier Pending-only activity followed by another canonical stage becomes
-- an inferred Pass. Only the latest unresolved Pending survives.
insert into public.recruitment_logs (
  candidate_id, log_date, recruitment_process, round, interviewer, result, remark, created_at
)
values
  ('__migration_pending_chain', date '2026-07-01', 'Phone Screen', 1, 'Phone pending', null, 'Pending only', timestamptz '2026-07-01 09:00:00+07'),
  ('__migration_pending_chain', date '2026-07-03', 'HR Interview', 1, 'HR pending', null, 'Latest unresolved', timestamptz '2026-07-03 09:00:00+07');

-- Later active rows after Fail are conflict history, not canonical activity.
insert into public.recruitment_logs (
  candidate_id, log_date, recruitment_process, round, interviewer, result, remark, created_at
)
values
  ('__migration_fail_conflict', date '2026-07-01', 'Phone Screen', 1, 'Phone', 1, 'Pass', timestamptz '2026-07-01 09:00:00+07'),
  ('__migration_fail_conflict', date '2026-07-02', 'HR Interview', 1, 'HR', 0, 'Fail', timestamptz '2026-07-02 09:00:00+07'),
  ('__migration_fail_conflict', date '2026-07-03', 'Line Interview', 1, 'Line', null, 'Invalid downstream Pending', timestamptz '2026-07-03 09:00:00+07');

-- Legacy-only history must remain audit history without an invented active row.
insert into public.recruitment_logs (
  candidate_id, log_date, recruitment_process, round, interviewer, result, remark, created_at
)
values
  ('__migration_legacy_only', date '2026-07-01', 'First Contact', 1, null, null, 'Contacted', timestamptz '2026-07-01 09:00:00+07'),
  ('__migration_legacy_only', date '2026-07-02', 'Withdrawn', 1, null, null, 'Withdrew', timestamptz '2026-07-02 09:00:00+07');

\ir ../../supabase/migrations/202608010001_candidate_pipeline_paired_status.sql

select pg_temp.assert_true(
  (select log_date = date '2026-07-02'
      and outcome_date = date '2026-07-05'
      and interviewer is null
      and outcome_interviewer = 'Phone outcome interviewer'
      and migration_note like '%candidate first_contact_date%'
   from public.recruitment_logs
   where candidate_id = '__migration_outcome_only'
     and recruitment_process = 'Phone Screen' and superseded_at is null),
  'outcome-only first stage must reconstruct Pending from first contact while preserving Outcome fields'
);

select pg_temp.assert_true(
  (select log_date = date '2026-07-05'
      and outcome_date = date '2026-07-08'
      and migration_note like '%previous canonical Outcome%'
   from public.recruitment_logs
   where candidate_id = '__migration_outcome_only'
     and recruitment_process = 'HR Interview' and superseded_at is null),
  'outcome-only later stage must prefer the previous canonical Outcome fallback'
);

select pg_temp.assert_true(
  (select log_date = date '2026-07-10'
      and migration_note like '%clamped for chronology%'
   from public.recruitment_logs
   where candidate_id = '__migration_clamped_fallback'
     and recruitment_process = 'Phone Screen' and superseded_at is null),
  'outcome-only fallback after Outcome must be clamped and migration-noted'
);

select pg_temp.assert_true(
  (select result = 1
      and outcome_date = date '2026-07-03'
      and outcome_interviewer is null
      and migration_note like '%Pass inferred from later canonical stage%'
   from public.recruitment_logs
   where candidate_id = '__migration_pending_chain'
     and recruitment_process = 'Phone Screen' and superseded_at is null),
  'Pending-only stage followed by canonical activity must infer a blank-interviewer Pass'
);

select pg_temp.assert_true(
  (select count(*) = 1
   from public.recruitment_logs
   where candidate_id = '__migration_pending_chain'
     and superseded_at is null and result is null
     and recruitment_process = 'HR Interview'),
  'the latest unresolved Pending must remain canonical'
);

select pg_temp.assert_true(
  (select count(*) = 1
      and min(log_date) = date '2026-07-08'
      and min(migration_note) like '%immediate next Pending inferred%'
   from public.recruitment_logs
   where candidate_id = '__migration_outcome_only'
     and recruitment_process = 'Line Interview'
     and superseded_at is null and result is null),
  'latest non-Offer Pass must create its immediate next Pending stage'
);

select pg_temp.assert_true(
  (select migration_note like '%canonical Fail had later active history%'
   from public.recruitment_logs
   where candidate_id = '__migration_fail_conflict'
     and recruitment_process = 'HR Interview' and superseded_at is null and result = 0),
  'canonical Fail must be migration-noted when later active history conflicts'
);
select pg_temp.assert_true(
  (select later.superseded_at is not null
      and later.superseded_by_stage_instance_id = failed.stage_instance_id
      and later.migration_note like '%earlier canonical stage failed%'
   from public.recruitment_logs later
   join public.recruitment_logs failed
     on failed.candidate_id = later.candidate_id
    and failed.recruitment_process = 'HR Interview' and failed.superseded_at is null
   where later.candidate_id = '__migration_fail_conflict'
     and later.recruitment_process = 'Line Interview'),
  'later canonical activity must become superseded conflict history linked to Fail'
);

select pg_temp.assert_true(
  not exists (
    select 1 from public.recruitment_logs
    where candidate_id = '__migration_legacy_only'
      and superseded_at is null
      and recruitment_process in ('Phone Screen', 'HR Interview', 'Line Interview', 'Test', 'Reference Check', 'Offer')
  ),
  'legacy-only candidates must not receive invented active history'
);
select pg_temp.assert_true(
  (select count(*) = 2
      and count(*) filter (where superseded_at is not null and superseded_by_stage_instance_id is null) = 2
      and count(*) filter (where migration_note like '%legacy-only archive without canonical replacement%') = 2
   from public.recruitment_logs
   where candidate_id = '__migration_legacy_only'),
  'legacy-only rows must use the documented null-replacement audit exception'
);

rollback;
