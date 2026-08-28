-- Trigger integration test. Run against a disposable database migrated through
-- 202608270001_refresh_requisition_status_on_offer_change.sql.
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

insert into public.requisitions (doc_id, site, position, department, person_in_charge, status, head_count)
values
  ('__offer_status_old', '__offer_status_site', 'Old role', 'Test', 'Test Owner', 'ongoing', 1),
  ('__offer_status_new', '__offer_status_site', 'New role', 'Test', 'Test Owner', 'ongoing', 1);

insert into public.position_groups (group_id, group_position)
values ('__offer_status_group', 'Test role');

insert into public.document_groups (doc_group_id, doc_id, group_id, group_position)
values ('__offer_status_link', '__offer_status_old', '__offer_status_group', 'Test role');

insert into public.candidates (candidate_id, name, doc_group_id, group_id)
values ('__offer_status_candidate', 'Offer status fixture', '__offer_status_link', '__offer_status_group');

insert into public.offers (candidate_id, doc_id, accepted_date)
values ('__offer_status_candidate', '__offer_status_old', current_date);

select pg_temp.assert_true(
  (select status = 'filled' from public.requisitions where doc_id = '__offer_status_old'),
  'an accepted offer must fill its requisition'
);

update public.offers
set doc_id = '__offer_status_new'
where candidate_id = '__offer_status_candidate';

select pg_temp.assert_true(
  (select status = 'ongoing' from public.requisitions where doc_id = '__offer_status_old')
  and (select status = 'filled' from public.requisitions where doc_id = '__offer_status_new'),
  'a Doc ID reassignment must refresh both the old and new requisitions'
);

update public.offers
set start_confirmation = 'did_not_start'
where candidate_id = '__offer_status_candidate';

select pg_temp.assert_true(
  (select status = 'ongoing' from public.requisitions where doc_id = '__offer_status_new'),
  'a confirmed no-show must reopen its requisition'
);

update public.offers
set start_confirmation = 'started'
where candidate_id = '__offer_status_candidate';

select pg_temp.assert_true(
  (select status = 'filled' from public.requisitions where doc_id = '__offer_status_new'),
  'a confirmed start must fill its requisition again'
);

delete from public.offers where candidate_id = '__offer_status_candidate';

select pg_temp.assert_true(
  (select status = 'ongoing' from public.requisitions where doc_id = '__offer_status_new'),
  'deleting an offer must refresh its requisition'
);

rollback;
