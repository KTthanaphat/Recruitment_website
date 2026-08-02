begin;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'Assertion failed: %', p_message;
  end if;
end;
$$;

create function pg_temp.expect_error(p_statement text, p_expected_message text)
returns void language plpgsql as $$
declare
  v_error text;
begin
  begin
    execute p_statement;
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is null or position(p_expected_message in v_error) = 0 then
    raise exception 'Expected error containing "%", got "%".', p_expected_message, coalesce(v_error, '<no error>');
  end if;
end;
$$;

grant execute on function pg_temp.assert_true(boolean, text) to authenticated;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

insert into auth.users (id, email, raw_user_meta_data)
values ('a1200000-0000-0000-0000-000000000001', 'paired-pipeline-admin@example.test', '{"nickname":"Pipeline Admin"}'::jsonb);

update public.profiles
set site = '__paired_pipeline_site', role = 'system_admin'
where id = 'a1200000-0000-0000-0000-000000000001';

insert into public.requisitions (doc_id, site, position, department, person_in_charge, status, head_count)
values
  ('__paired_pipeline_open', '__paired_pipeline_site', 'Open role', 'Test', 'Pipeline Admin', 'ongoing', 1),
  ('__paired_pipeline_closed', '__paired_pipeline_site', 'Closed role', 'Test', 'Pipeline Admin', 'filled', 1);

insert into public.position_groups (group_id, group_position)
values
  ('__paired_pipeline_open_group', 'Open role'),
  ('__paired_pipeline_closed_group', 'Closed role');

insert into public.document_groups (doc_group_id, doc_id, group_id, group_position)
values
  ('__paired_pipeline_open_link', '__paired_pipeline_open', '__paired_pipeline_open_group', 'Open role'),
  ('__paired_pipeline_closed_link', '__paired_pipeline_closed', '__paired_pipeline_closed_group', 'Closed role');

insert into public.candidates (candidate_id, name, doc_group_id, first_contact_date)
values
  ('__paired_pipeline_candidate', 'Paired Pipeline Candidate', '__paired_pipeline_open_link', app_private.pipeline_business_date() - 2),
  ('__paired_pipeline_offer_candidate', 'Ineligible Offer Candidate', '__paired_pipeline_closed_link', app_private.pipeline_business_date() - 7);

insert into public.recruitment_logs (
  candidate_id, log_date, recruitment_process, round, interviewer, result, remark, record_origin
)
values (
  '__paired_pipeline_candidate', app_private.pipeline_business_date() - 2,
  'Phone Screen', 1, 'Pending interviewer', null, 'Pending remark', 'user'
);

-- Declarative paired-status checks reject Outcome fields on Pending rows.
select pg_temp.expect_error(
  $$insert into public.recruitment_logs (
      candidate_id, log_date, recruitment_process, round, result, outcome_interviewer
    ) values (
      '__paired_pipeline_candidate', app_private.pipeline_business_date(), 'HR Interview', 1, null, 'not allowed'
    )$$,
  'violates check constraint'
);

-- Offer fixture: five canonical Pass rows and one Offer Pending row, but no
-- eligible ongoing requisition exists for its group.
insert into public.recruitment_logs (
  candidate_id, log_date, recruitment_process, round, result,
  outcome_date, outcome_recorded_at, record_origin
)
select '__paired_pipeline_offer_candidate', app_private.pipeline_business_date() - (7 - stage_order), stage, 1, 1,
  app_private.pipeline_business_date() - (7 - stage_order), now(), 'migration'
from (values
  (1, 'Phone Screen'),
  (2, 'HR Interview'),
  (3, 'Line Interview'),
  (4, 'Test'),
  (5, 'Reference Check')
) stages(stage_order, stage);

insert into public.recruitment_logs (
  candidate_id, log_date, recruitment_process, round, result, record_origin
)
values (
  '__paired_pipeline_offer_candidate', app_private.pipeline_business_date() - 1, 'Offer', 1, null, 'auto'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1200000-0000-0000-0000-000000000001', true);

update public.requisitions
set person_in_charge = 'Unowned Recruiter'
where doc_id = '__paired_pipeline_open';

select pg_temp.assert_true(
  (public.app_update_pipeline_pending_v2(jsonb_build_object(
    'candidate_id', '__paired_pipeline_candidate',
    'stage_instance_id', (select stage_instance_id from public.recruitment_logs where candidate_id = '__paired_pipeline_candidate' and result is null and superseded_at is null),
    'expected_updated_at', (select updated_at from public.recruitment_logs where candidate_id = '__paired_pipeline_candidate' and result is null and superseded_at is null),
    'pending', jsonb_build_object('opened_date', (app_private.pipeline_business_date() - 2)::text, 'interviewer', 'System Admin', 'remark', 'System-wide pending edit')
  )) ->> 'ok')::boolean,
  'a system admin can edit a current Pending stage outside PIC ownership'
);

select pg_temp.assert_true(
  (public.app_upsert_candidate_reference_v1(jsonb_build_object(
    'candidate_id', '__paired_pipeline_candidate',
    'reference_name', 'Reference Manager',
    'relationship', 'Former manager',
    'channel_type', 'phone',
    'channel_value', '0812345678'
  )) ->> 'ok')::boolean,
  'a scoped recruiter can add an Available candidate reference'
);

select pg_temp.expect_error(
  $$select app_private.assert_reference_check_passable('__paired_pipeline_candidate')$$,
  'PIPELINE_REFERENCE_CHECKS_REQUIRED'
);

select pg_temp.assert_true(
  (public.app_save_candidate_reference_check_v1(jsonb_build_object(
    'candidate_id', '__paired_pipeline_candidate',
    'reference_id', (select reference_id from public.candidate_references where candidate_id = '__paired_pipeline_candidate'),
    'checked_date', app_private.pipeline_business_date()::text,
    'duration_minutes', 15,
    'conversation_summary', 'Confirmed the candidate collaboration history.'
  )) ->> 'ok')::boolean,
  'a scoped recruiter can save the one required final reference check'
);
select app_private.assert_reference_check_passable('__paired_pipeline_candidate');
select pg_temp.assert_true(
  (select duration_minutes = 15 and conversation_summary = 'Confirmed the candidate collaboration history'
   from public.candidate_reference_checks
   where reference_id = (select reference_id from public.candidate_references where candidate_id = '__paired_pipeline_candidate')),
  'a final reference check retains duration and summary'
);

-- Completing a Pending stage updates that row in place and atomically creates
-- the immediate next Pending stage.
select public.app_complete_pipeline_stage_v2(jsonb_build_object(
  'candidate_id', '__paired_pipeline_candidate',
  'stage_instance_id', (select stage_instance_id from public.recruitment_logs where candidate_id = '__paired_pipeline_candidate' and recruitment_process = 'Phone Screen' and superseded_at is null),
  'expected_updated_at', (select updated_at from public.recruitment_logs where candidate_id = '__paired_pipeline_candidate' and recruitment_process = 'Phone Screen' and superseded_at is null),
  'pending', jsonb_build_object(
    'opened_date', app_private.pipeline_business_date() - 2,
    'interviewer', 'Edited pending interviewer',
    'remark', 'Edited pending remark'
  ),
  'outcome', jsonb_build_object(
    'result', 'pass',
    'date', app_private.pipeline_business_date() - 1,
    'interviewer', '',
    'remark', 'Passed'
  ),
  'next_pending', jsonb_build_object(
    'stage', 'HR Interview',
    'round', 1,
    'opened_date', app_private.pipeline_business_date() - 1
  )
));

select pg_temp.assert_true(
  (select count(*) = 1 and min(result) = 1 and min(outcome_interviewer) is null
   from public.recruitment_logs
   where candidate_id = '__paired_pipeline_candidate'
     and recruitment_process = 'Phone Screen'
     and superseded_at is null),
  'completion must keep one canonical stage row and permit a blank Outcome interviewer'
);
select pg_temp.assert_true(
  (select count(*) = 1
   from public.recruitment_logs
   where candidate_id = '__paired_pipeline_candidate'
     and recruitment_process = 'HR Interview'
     and result is null and superseded_at is null),
  'a Pass must create exactly one next Pending stage'
);

create temporary table _paired_pipeline_before_correction on commit drop as
select stage_instance_id, log_id
from public.recruitment_logs
where candidate_id = '__paired_pipeline_candidate'
  and recruitment_process = 'Phone Screen'
  and superseded_at is null;

select public.app_correct_pipeline_outcome_v2(jsonb_build_object(
  'candidate_id', '__paired_pipeline_candidate',
  'stage_instance_id', (select stage_instance_id from _paired_pipeline_before_correction),
  'expected_updated_at', (select updated_at from public.recruitment_logs where stage_instance_id = (select stage_instance_id from _paired_pipeline_before_correction)),
  'outcome', jsonb_build_object(
    'result', 'pass',
    'date', app_private.pipeline_business_date() - 1,
    'interviewer', '',
    'remark', 'Corrected note'
  )
));

select pg_temp.assert_true(
  (select old.superseded_at is not null
      and old.superseded_by_stage_instance_id = replacement.stage_instance_id
      and old.stage_instance_id <> replacement.stage_instance_id
      and replacement.record_origin = 'correction'
      and replacement.result = old.result
   from public.recruitment_logs old
   join public.recruitment_logs replacement
     on replacement.stage_instance_id = old.superseded_by_stage_instance_id
   where old.stage_instance_id = (select stage_instance_id from _paired_pipeline_before_correction)),
  'correction must supersede the old row with a new canonical stage instance while preserving result'
);
select pg_temp.assert_true(
  (select count(*) = 1
   from public.recruitment_logs
   where candidate_id = '__paired_pipeline_candidate'
     and recruitment_process = 'HR Interview'
     and result is null and superseded_at is null),
  'correction must preserve downstream Pending state'
);

select pg_temp.expect_error(
  format(
    'select public.app_correct_pipeline_outcome_v2(%L::jsonb)',
    jsonb_build_object(
      'candidate_id', '__paired_pipeline_candidate',
      'stage_instance_id', (select stage_instance_id from public.recruitment_logs where candidate_id = '__paired_pipeline_candidate' and recruitment_process = 'Phone Screen' and superseded_at is null),
      'expected_updated_at', (select updated_at from public.recruitment_logs where candidate_id = '__paired_pipeline_candidate' and recruitment_process = 'Phone Screen' and superseded_at is null),
      'outcome', jsonb_build_object('result', 'fail', 'date', app_private.pipeline_business_date() - 1)
    )::text
  ),
  'PIPELINE_CORRECTION_RESULT_IMMUTABLE'
);

select pg_temp.expect_error(
  format(
    'select public.app_delete_recruitment_record(%L::jsonb)',
    jsonb_build_object(
      'entity', 'recruitment_log',
      'id', (select log_id from public.recruitment_logs where candidate_id = '__paired_pipeline_candidate' and recruitment_process = 'Phone Screen' and superseded_at is null)::text
    )::text
  ),
  'Canonical pipeline stage records cannot be deleted'
);

select pg_temp.expect_error(
  format(
    'select public.app_complete_pipeline_stage_v2(%L::jsonb)',
    jsonb_build_object(
      'candidate_id', '__paired_pipeline_offer_candidate',
      'stage_instance_id', (select stage_instance_id from public.recruitment_logs where candidate_id = '__paired_pipeline_offer_candidate' and recruitment_process = 'Offer' and superseded_at is null),
      'expected_updated_at', (select updated_at from public.recruitment_logs where candidate_id = '__paired_pipeline_offer_candidate' and recruitment_process = 'Offer' and superseded_at is null),
      'pending', jsonb_build_object('opened_date', app_private.pipeline_business_date() - 1),
      'outcome', jsonb_build_object('result', 'pass', 'date', app_private.pipeline_business_date()),
      'next_pending', '{}'::jsonb
    )::text
  ),
  'PIPELINE_OFFER_HANDOFF_INELIGIBLE'
);
select pg_temp.assert_true(
  (select result is null and outcome_date is null
   from public.recruitment_logs
   where candidate_id = '__paired_pipeline_offer_candidate'
     and recruitment_process = 'Offer' and superseded_at is null),
  'ineligible Offer Pass must roll back and leave Offer Pending'
);

rollback;
