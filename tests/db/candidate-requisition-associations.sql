-- Transaction-scoped regression for offer-backed candidate/requisition links.
-- Run with psql against a disposable database migrated through the current
-- offer-association synchronization migration.
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
  ('__assoc_req_a', '__assoc_site', 'Shared role A', 'Test', 'Association Owner', 'ongoing', 1),
  ('__assoc_req_b', '__assoc_site', 'Shared role B', 'Test', 'Association Owner', 'ongoing', 1),
  ('__assoc_req_c', '__assoc_site', 'Shared role C', 'Test', 'Association Owner', 'ongoing', 1);
insert into public.position_groups (group_id, group_position)
values ('__assoc_group', 'Shared role');
insert into public.document_groups (doc_group_id, doc_id, group_id, group_position)
values
  ('__assoc_doc_group_a', '__assoc_req_a', '__assoc_group', 'Shared role'),
  ('__assoc_doc_group_b', '__assoc_req_b', '__assoc_group', 'Shared role'),
  ('__assoc_doc_group_c', '__assoc_req_c', '__assoc_group', 'Shared role');

insert into public.candidates (candidate_id, name, doc_group_id, group_id)
values
  ('__assoc_candidate_a', 'Pre-offer candidate A', '__assoc_doc_group_a', '__assoc_group'),
  ('__assoc_candidate_b', 'Pre-offer candidate B', '__assoc_doc_group_b', '__assoc_group');

select pg_temp.assert_true(
  not exists (select 1 from public.candidate_requisitions
              where candidate_id in ('__assoc_candidate_a', '__assoc_candidate_b')),
  'candidate creation must not create a premature exact-requisition link'
);

-- Model the cleanup of links created by the previous behavior. Any pair with
-- a formal offer survives; an unbacked pre-offer link is removed.
insert into public.candidate_requisitions (candidate_id, doc_id)
values ('__assoc_candidate_a', '__assoc_req_a');
delete from public.candidate_requisitions cr
where cr.candidate_id in ('__assoc_candidate_a', '__assoc_candidate_b')
  and not exists (
    select 1 from public.offers o
    where o.candidate_id = cr.candidate_id and o.doc_id = cr.doc_id
  );
select pg_temp.assert_true(
  not exists (select 1 from public.candidate_requisitions
              where candidate_id = '__assoc_candidate_a' and doc_id = '__assoc_req_a'),
  'cleanup must remove a candidate link without an offer'
);

-- A formal offer creates the exact link, even while the offer is pending.
insert into public.offers (candidate_id, doc_id)
values ('__assoc_candidate_a', '__assoc_req_b');
select pg_temp.assert_true(
  exists (select 1 from public.candidate_requisitions
          where candidate_id = '__assoc_candidate_a' and doc_id = '__assoc_req_b'),
  'an offer must create its exact candidate/requisition link'
);

-- Backfill restores a missing link when the offer already exists.
delete from public.candidate_requisitions
where candidate_id = '__assoc_candidate_a' and doc_id = '__assoc_req_b';
insert into public.candidate_requisitions (candidate_id, doc_id, created_by)
select o.candidate_id, o.doc_id, null
from public.offers o
where o.candidate_id = '__assoc_candidate_a'
on conflict (candidate_id, doc_id) do nothing;
select pg_temp.assert_true(
  exists (select 1 from public.candidate_requisitions
          where candidate_id = '__assoc_candidate_a' and doc_id = '__assoc_req_b'),
  'backfill must restore an exact link for every existing offer'
);

-- Moving an offer removes the old exact link and creates the new one.
update public.offers
set doc_id = '__assoc_req_c'
where candidate_id = '__assoc_candidate_a' and doc_id = '__assoc_req_b';
select pg_temp.assert_true(
  not exists (select 1 from public.candidate_requisitions
              where candidate_id = '__assoc_candidate_a' and doc_id = '__assoc_req_b')
  and exists (select 1 from public.candidate_requisitions
              where candidate_id = '__assoc_candidate_a' and doc_id = '__assoc_req_c'),
  'updating an offer must move its exact candidate/requisition link'
);

-- The second candidate's link remains independent when the first offer is
-- deleted, and is removed only when its own offer is deleted.
insert into public.offers (candidate_id, doc_id)
values ('__assoc_candidate_b', '__assoc_req_c');
delete from public.offers
where candidate_id = '__assoc_candidate_a' and doc_id = '__assoc_req_c';
select pg_temp.assert_true(
  not exists (select 1 from public.candidate_requisitions
              where candidate_id = '__assoc_candidate_a' and doc_id = '__assoc_req_c')
  and exists (select 1 from public.candidate_requisitions
              where candidate_id = '__assoc_candidate_b' and doc_id = '__assoc_req_c'),
  'deleting an offer must remove only that candidate/requisition link'
);
delete from public.offers
where candidate_id = '__assoc_candidate_b' and doc_id = '__assoc_req_c';
select pg_temp.assert_true(
  not exists (select 1 from public.candidate_requisitions
              where candidate_id = '__assoc_candidate_b' and doc_id = '__assoc_req_c'),
  'deleting the last offer must remove its exact link'
);

select pg_temp.assert_true(
  (select group_id = '__assoc_group' from public.candidates
   where candidate_id = '__assoc_candidate_a')
  and (select count(*) = 1 from public.position_groups where group_id = '__assoc_group'),
  'offer-link changes must preserve shared sourcing-group identity'
);

rollback;
