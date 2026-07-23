\set ON_ERROR_STOP on

begin;

create temporary table _workspace_group_authz_test_session (
  singleton boolean
) on commit drop;

create function pg_temp.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is distinct from true then
    raise exception 'Assertion failed: %', p_message;
  end if;
end;
$$;

create function pg_temp.expect_error(p_statement text, p_expected_message text)
returns void
language plpgsql
as $$
declare
  v_error text;
begin
  begin
    execute p_statement;
  exception
    when others then
      v_error := sqlerrm;
  end;

  if v_error is null then
    raise exception 'Expected error containing "%", but the statement succeeded.', p_expected_message;
  end if;
  if position(p_expected_message in v_error) = 0 then
    raise exception 'Expected error containing "%", got "%".', p_expected_message, v_error;
  end if;
end;
$$;

grant execute on function pg_temp.assert_true(boolean, text) to authenticated;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

select pg_temp.assert_true(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
    where p.oid in (
      'public.app_upsert_position_group(jsonb)'::regprocedure,
      'public.app_create_group_match(jsonb)'::regprocedure,
      'public.app_unmatch_group_requisition(jsonb)'::regprocedure,
      'public.app_delete_recruitment_record(jsonb)'::regprocedure
    )
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC must not have EXECUTE on workspace group RPCs'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.app_upsert_position_group(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.app_create_group_match(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.app_unmatch_group_requisition(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.app_delete_recruitment_record(jsonb)', 'EXECUTE'),
  'anon must not have EXECUTE on workspace group RPCs'
);
select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.app_upsert_position_group(jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.app_create_group_match(jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.app_unmatch_group_requisition(jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.app_delete_recruitment_record(jsonb)', 'EXECUTE'),
  'authenticated must have EXECUTE on workspace group RPCs'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a1100000-0000-0000-0000-000000000001', 'workspace-scope-owner@example.test', '{"nickname":"Scope Owner"}'::jsonb),
  ('a1100000-0000-0000-0000-000000000002', 'workspace-scope-admin@example.test', '{"nickname":"Scope Admin"}'::jsonb),
  ('a1100000-0000-0000-0000-000000000003', 'workspace-scope-viewer@example.test', '{"nickname":"Scope Viewer"}'::jsonb),
  ('a1100000-0000-0000-0000-000000000004', 'workspace-scope-system@example.test', '{"nickname":"Scope System"}'::jsonb);

update public.profiles
set site = '__authz_test_site', role = 'site_recruiter'
where id = 'a1100000-0000-0000-0000-000000000001';

update public.profiles
set site = '__authz_test_site', role = 'admin_recruiter'
where id = 'a1100000-0000-0000-0000-000000000002';

update public.profiles
set site = '__authz_test_site', role = 'viewer'
where id = 'a1100000-0000-0000-0000-000000000003';

update public.profiles
set site = '__authz_test_site', role = 'system_admin'
where id = 'a1100000-0000-0000-0000-000000000004';

insert into public.requisitions (
  doc_id, site, position, department, person_in_charge, status
)
values
  ('__authz_test_match_owned', '__authz_test_site', 'Owned match', 'Test', 'Scope Owner', 'ongoing'),
  ('__authz_test_match_foreign', '__authz_test_site', 'Foreign match', 'Test', 'Other Owner', 'ongoing'),
  ('__authz_test_edit_owned', '__authz_test_site', 'Owned edit', 'Test', 'Scope Owner', 'ongoing'),
  ('__authz_test_edit_foreign', '__authz_test_site', 'Foreign edit', 'Test', 'Other Owner', 'ongoing'),
  ('__authz_test_unmatch_empty', '__authz_test_site', 'Owned unmatch', 'Test', 'Scope Owner', 'ongoing'),
  ('__authz_test_unmatch_blocked', '__authz_test_site', 'Blocked unmatch', 'Test', 'Scope Owner', 'ongoing'),
  ('__authz_test_admin_unmatch', '__authz_test_site', 'Admin unmatch', 'Test', 'Other Owner', 'ongoing');

insert into public.position_groups (group_id, group_position)
values
  ('__authz_test_match_group', 'Match target'),
  ('__authz_test_owned_group', 'Owned group'),
  ('__authz_test_foreign_group', 'Foreign group'),
  ('__authz_test_unlinked_group', 'Unlinked group'),
  ('__authz_test_unmatch_group', 'Unmatch group'),
  ('__authz_test_unmatch_blocked_group', 'Blocked unmatch group'),
  ('__authz_test_admin_unmatch_group', 'Admin unmatch group'),
  ('__authz_test_delete_group', 'Delete target group');

insert into public.document_groups (doc_group_id, doc_id, group_id, group_position)
values
  ('__authz_test_owned_link', '__authz_test_edit_owned', '__authz_test_owned_group', 'Owned group'),
  ('__authz_test_foreign_link', '__authz_test_edit_foreign', '__authz_test_foreign_group', 'Foreign group'),
  ('__authz_test_unmatch_link', '__authz_test_unmatch_empty', '__authz_test_unmatch_group', 'Unmatch group'),
  ('__authz_test_unmatch_blocked_link', '__authz_test_unmatch_blocked', '__authz_test_unmatch_blocked_group', 'Blocked unmatch group'),
  ('__authz_test_admin_unmatch_link', '__authz_test_admin_unmatch', '__authz_test_admin_unmatch_group', 'Admin unmatch group');

insert into public.candidates (candidate_id, name, phone_no, doc_group_id, channel, first_contact_date)
values
  ('__authz_test_blocking_candidate', 'Blocking Candidate', '0999999999', '__authz_test_unmatch_blocked_link', 'Facebook', current_date),
  ('__authz_test_pipeline_candidate', 'Pipeline Candidate', '0999999998', '__authz_test_owned_link', 'Facebook', current_date);

insert into public.recruitment_logs (candidate_id, log_date, recruitment_process, round, interviewer, result, remark)
values
  ('__authz_test_pipeline_candidate', current_date, 'Phone Screen', 1, 'QA', null, 'Current pending stage');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-0000-0000-000000000001', true);

select pg_temp.assert_true(
  (public.app_upsert_position_group(
    '{"mode":"new","group_position":"Writer-created group"}'::jsonb
  ) ->> 'ok')::boolean,
  'a recruitment writer can create a new unlinked group'
);

select pg_temp.assert_true(
  (public.app_upsert_requisition(
    '{"mode":"new","doc_id":"__authz_test_site_assignment","site":"other-site","position":"Site assignment","department":"Test","person_in_charge":"Other Owner","status":"ongoing"}'::jsonb
  ) ->> 'ok')::boolean,
  'a site recruiter can create a requisition'
);

select pg_temp.assert_true(
  (public.app_upsert_position_group(
    '{"mode":"change","group_id":"__authz_test_owned_group","group_position":"Owned group updated"}'::jsonb
  ) ->> 'ok')::boolean,
  'a site recruiter can change a group linked to a manageable requisition'
);

select pg_temp.assert_true(
  (public.app_create_group_match(
    '{"doc_id":"__authz_test_match_owned","group_id":"__authz_test_match_group"}'::jsonb
  ) ->> 'ok')::boolean,
  'a site recruiter can match an existing manageable requisition'
);

select pg_temp.assert_true(
  (public.app_unmatch_group_requisition(
    '{"doc_group_id":"__authz_test_unmatch_link"}'::jsonb
  ) ->> 'ok')::boolean,
  'a site recruiter can unmatch an empty manageable requisition/group link'
);

select pg_temp.assert_true(
  (public.app_insert_pipeline_passes(
    jsonb_build_object(
      'candidate_id', '__authz_test_pipeline_candidate',
      'target_stage', 'Line Interview',
      'stages', jsonb_build_array(
        jsonb_build_object('index', 0, 'stage', 'Phone Screen', 'log_date', current_date::text, 'round', 1),
        jsonb_build_object('index', 1, 'stage', 'HR Interview', 'log_date', current_date::text, 'round', 1)
      )
    )
  ) ->> 'ok')::boolean,
  'a site recruiter can full-jump a manageable candidate with complete crossed stages'
);

select pg_temp.assert_true(
  exists (
    select 1
    from public.recruitment_logs pending_hr
    join public.recruitment_logs passed_hr
      on passed_hr.candidate_id = pending_hr.candidate_id
      and passed_hr.recruitment_process = pending_hr.recruitment_process
      and passed_hr.round = pending_hr.round
      and passed_hr.result = 1
      and passed_hr.log_id > pending_hr.log_id
    where pending_hr.candidate_id = '__authz_test_pipeline_candidate'
      and pending_hr.recruitment_process = 'HR Interview'
      and pending_hr.result is null
  )
  and exists (
    select 1
    from public.recruitment_logs
    where candidate_id = '__authz_test_pipeline_candidate'
      and recruitment_process = 'Line Interview'
      and result is null
  ),
  'pipeline full jump must create pending-then-pass crossed stages and final pending stage'
);

select pg_temp.expect_error(
  $sql$
    select public.app_unmatch_group_requisition(
      '{"doc_group_id":"__authz_test_unmatch_blocked_link"}'::jsonb
    )
  $sql$,
  'Cannot unmatch because candidates are linked to this match.'
);

select pg_temp.expect_error(
  $sql$
    select public.app_create_group_match(
      '{"doc_id":"__authz_test_missing","group_id":"__authz_test_match_group"}'::jsonb
    )
  $sql$,
  'Requisition does not exist.'
);

select pg_temp.expect_error(
  $sql$
    select public.app_create_group_match(
      '{"doc_id":"__authz_test_match_foreign","group_id":"__authz_test_match_group"}'::jsonb
    )
  $sql$,
  'You can match only requisitions where you are person in charge.'
);

select pg_temp.expect_error(
  $sql$
    select public.app_upsert_position_group(
      '{"mode":"change","group_id":"__authz_test_foreign_group","group_position":"Forbidden update"}'::jsonb
    )
  $sql$,
  'You can edit only sourcing groups linked to requisitions where you are responsible.'
);

select pg_temp.expect_error(
  $sql$
    select public.app_upsert_position_group(
      '{"mode":"bypass","group_id":"__authz_test_unlinked_group","group_position":"Forbidden bypass"}'::jsonb
    )
  $sql$,
  'mode must be new or change'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-0000-0000-000000000002', true);

select pg_temp.assert_true(
  exists (select 1 from public.profiles where role = 'site_recruiter'),
  'an admin recruiter can read site recruiter profiles for requisition assignment'
);

select pg_temp.assert_true(
  (public.app_upsert_position_group(
    '{"mode":"change","group_id":"__authz_test_foreign_group","group_position":"Admin linked update"}'::jsonb
  ) ->> 'ok')::boolean,
  'an admin recruiter can change a linked group'
);

select pg_temp.assert_true(
  (public.app_upsert_position_group(
    '{"mode":"change","group_id":"__authz_test_unlinked_group","group_position":"Admin unlinked update"}'::jsonb
  ) ->> 'ok')::boolean,
  'an admin recruiter can change an unlinked group'
);

select pg_temp.assert_true(
  (public.app_upsert_requisition(
    '{"mode":"new","doc_id":"__authz_test_admin_assignment","site":"__authz_test_site","position":"Admin assignment","department":"Test","person_in_charge":"Scope Owner","status":"ongoing"}'::jsonb
  ) ->> 'ok')::boolean,
  'an admin recruiter can assign a different recruiter as person in charge'
);

select pg_temp.assert_true(
  (public.app_unmatch_group_requisition(
    '{"doc_group_id":"__authz_test_admin_unmatch_link"}'::jsonb
  ) ->> 'ok')::boolean,
  'an admin recruiter can unmatch an empty requisition/group link'
);

select pg_temp.expect_error(
  $sql$
    select public.app_delete_recruitment_record(
      '{"entity":"position_group","id":"__authz_test_delete_group"}'::jsonb
    )
  $sql$,
  'System admin role is required.'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-0000-0000-000000000003', true);

select pg_temp.assert_true(
  (select count(*) from public.profiles) = 1,
  'a viewer can read only their own profile'
);

select pg_temp.expect_error(
  $sql$
    select public.app_upsert_position_group(
      '{"mode":"new","group_position":"Viewer-created group"}'::jsonb
    )
  $sql$,
  'Recruitment write role is required.'
);

select pg_temp.expect_error(
  $sql$
    select public.app_unmatch_group_requisition(
      '{"doc_group_id":"__authz_test_unmatch_blocked_link"}'::jsonb
    )
  $sql$,
  'Recruitment write role is required.'
);

select pg_temp.expect_error(
  $sql$
    select public.app_delete_recruitment_record(
      '{"entity":"position_group","id":"__authz_test_delete_group"}'::jsonb
    )
  $sql$,
  'System admin role is required.'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-0000-0000-000000000004', true);

select pg_temp.assert_true(
  (public.app_delete_recruitment_record(
    '{"entity":"position_group","id":"__authz_test_delete_group"}'::jsonb
  ) ->> 'ok')::boolean,
  'a system admin can delete an allowed recruitment record'
);

reset role;

select pg_temp.assert_true(
  exists (
    select 1
    from public.document_groups
    where doc_id = '__authz_test_match_owned'
      and group_id = '__authz_test_match_group'
  ),
  'the authorized group match was inserted inside the test transaction'
);
select pg_temp.assert_true(
  not exists (
    select 1
    from public.document_groups
    where doc_group_id in ('__authz_test_unmatch_link', '__authz_test_admin_unmatch_link')
  ),
  'authorized unmatch operations removed empty document group links'
);
select pg_temp.assert_true(
  exists (
    select 1
    from public.document_groups
    where doc_group_id = '__authz_test_unmatch_blocked_link'
  ),
  'the candidate-linked match stayed intact after blocked unmatch attempts'
);
select pg_temp.assert_true(
  not exists (
    select 1
    from public.position_groups
    where group_id = '__authz_test_delete_group'
  ),
  'system admin delete removed the allowed recruitment record'
);
select pg_temp.assert_true(
  (select group_position from public.position_groups where group_id = '__authz_test_owned_group') = 'Owned group updated',
  'the authorized site recruiter group change was applied inside the test transaction'
);
select pg_temp.assert_true(
  (select group_position from public.position_groups where group_id = '__authz_test_unlinked_group') = 'Admin unlinked update',
  'the global recruiter updated the unlinked group while the invalid mode remained blocked'
);
select pg_temp.assert_true(
  (select site from public.requisitions where doc_id = '__authz_test_site_assignment') = '__authz_test_site'
    and (select person_in_charge from public.requisitions where doc_id = '__authz_test_site_assignment') = 'Scope Owner',
  'a site recruiter requisition is forced to the recruiter assigned site and nickname'
);
select pg_temp.assert_true(
  (select person_in_charge from public.requisitions where doc_id = '__authz_test_admin_assignment') = 'Scope Owner',
  'an admin recruiter can persist another eligible recruiter as person in charge'
);

select 'workspace group authorization tests passed' as result;

rollback;
