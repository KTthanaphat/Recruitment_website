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
      'public.app_create_group_match(jsonb)'::regprocedure
    )
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC must not have EXECUTE on workspace group RPCs'
);
select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.app_upsert_position_group(jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.app_create_group_match(jsonb)', 'EXECUTE'),
  'anon must not have EXECUTE on workspace group RPCs'
);
select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.app_upsert_position_group(jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.app_create_group_match(jsonb)', 'EXECUTE'),
  'authenticated must have EXECUTE on workspace group RPCs'
);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a1100000-0000-0000-0000-000000000001', 'workspace-scope-owner@example.test', '{"nickname":"Scope Owner"}'::jsonb),
  ('a1100000-0000-0000-0000-000000000002', 'workspace-scope-admin@example.test', '{"nickname":"Scope Admin"}'::jsonb),
  ('a1100000-0000-0000-0000-000000000003', 'workspace-scope-viewer@example.test', '{"nickname":"Scope Viewer"}'::jsonb);

update public.profiles
set site = '__authz_test_site', role = 'site_recruiter'
where id = 'a1100000-0000-0000-0000-000000000001';

update public.profiles
set site = '__authz_test_site', role = 'admin_recruiter'
where id = 'a1100000-0000-0000-0000-000000000002';

update public.profiles
set site = '__authz_test_site', role = 'viewer'
where id = 'a1100000-0000-0000-0000-000000000003';

insert into public.requisitions (
  doc_id, site, position, department, person_in_charge, status
)
values
  ('__authz_test_match_owned', '__authz_test_site', 'Owned match', 'Test', 'Scope Owner', 'ongoing'),
  ('__authz_test_match_foreign', '__authz_test_site', 'Foreign match', 'Test', 'Other Owner', 'ongoing'),
  ('__authz_test_edit_owned', '__authz_test_site', 'Owned edit', 'Test', 'Scope Owner', 'ongoing'),
  ('__authz_test_edit_foreign', '__authz_test_site', 'Foreign edit', 'Test', 'Other Owner', 'ongoing');

insert into public.position_groups (group_id, group_position)
values
  ('__authz_test_match_group', 'Match target'),
  ('__authz_test_owned_group', 'Owned group'),
  ('__authz_test_foreign_group', 'Foreign group'),
  ('__authz_test_unlinked_group', 'Unlinked group');

insert into public.document_groups (doc_group_id, doc_id, group_id, group_position)
values
  ('__authz_test_owned_link', '__authz_test_edit_owned', '__authz_test_owned_group', 'Owned group'),
  ('__authz_test_foreign_link', '__authz_test_edit_foreign', '__authz_test_foreign_group', 'Foreign group');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-0000-0000-000000000001', true);

select pg_temp.assert_true(
  (public.app_upsert_position_group(
    '{"mode":"new","group_position":"Writer-created group"}'::jsonb
  ) ->> 'ok')::boolean,
  'a recruitment writer can create a new unlinked group'
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

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-0000-0000-000000000003', true);

select pg_temp.expect_error(
  $sql$
    select public.app_upsert_position_group(
      '{"mode":"new","group_position":"Viewer-created group"}'::jsonb
    )
  $sql$,
  'Recruitment write role is required.'
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
  (select group_position from public.position_groups where group_id = '__authz_test_owned_group') = 'Owned group updated',
  'the authorized site recruiter group change was applied inside the test transaction'
);
select pg_temp.assert_true(
  (select group_position from public.position_groups where group_id = '__authz_test_unlinked_group') = 'Admin unlinked update',
  'the global recruiter updated the unlinked group while the invalid mode remained blocked'
);

select 'workspace group authorization tests passed' as result;

rollback;
