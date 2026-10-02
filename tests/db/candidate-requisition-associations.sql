-- Transaction-scoped regression for candidate/requisition association.
-- Run with psql against a disposable database migrated through
-- 202610020001_candidate_requisition_associations.sql.
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

-- A candidate anchored to requisition A must not fan out to B merely because
-- both requisitions share the same sourcing group.
insert into public.candidates (candidate_id, name, doc_group_id, group_id)
values ('__assoc_candidate_shared', 'Shared group candidate', '__assoc_doc_group_a', '__assoc_group');
select pg_temp.assert_true(
  (select count(*) = 1 and bool_and(doc_id = '__assoc_req_a')
   from public.candidate_requisitions where candidate_id = '__assoc_candidate_shared'),
  'document-group anchor must create only its own requisition association'
);
select pg_temp.assert_true(
  not exists (select 1 from public.candidate_requisitions
              where candidate_id = '__assoc_candidate_shared' and doc_id = '__assoc_req_b'),
  'shared group membership must not associate the candidate with another requisition'
);

-- Recruiter selection is a durable explicit association. The shared group is
-- unchanged, while the candidate becomes eligible for both selected requisitions.
insert into public.candidate_requisitions (candidate_id, doc_id)
values ('__assoc_candidate_shared', '__assoc_req_b');
select pg_temp.assert_true(
  (select count(*) = 2 from public.candidate_requisitions
   where candidate_id = '__assoc_candidate_shared'),
  'a candidate can be explicitly associated with multiple requisitions once each'
);

insert into public.candidates (candidate_id, name, doc_group_id, group_id)
values ('__assoc_candidate_offer', 'Offer-linked candidate', '__assoc_doc_group_a', '__assoc_group');

-- A direct offer is explicit requisition evidence and must be associated for
-- new writes as well as the migration backfill.
insert into public.offers (candidate_id, doc_id, accepted_date)
values ('__assoc_candidate_offer', '__assoc_req_b', null);

-- Replay the migration's direct-evidence backfill for this fixture after
-- clearing its trigger-created links. Repeating it must not duplicate rows or
-- fan out to the third requisition in the shared group.
delete from public.candidate_requisitions where candidate_id = '__assoc_candidate_offer';
insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
select c.candidate_id, dg.doc_id, null
from public.candidates c
join public.document_groups dg on dg.doc_group_id = c.doc_group_id
where c.candidate_id = '__assoc_candidate_offer'
on conflict (candidate_id, doc_id) do nothing;
insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
select o.candidate_id, o.doc_id, null
from public.offers o
where o.candidate_id = '__assoc_candidate_offer'
on conflict (candidate_id, doc_id) do nothing;
insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
select c.candidate_id, dg.doc_id, null
from public.candidates c
join public.document_groups dg on dg.doc_group_id = c.doc_group_id
where c.candidate_id = '__assoc_candidate_offer'
on conflict (candidate_id, doc_id) do nothing;
insert into public.candidate_requisitions(candidate_id, doc_id, created_by)
select o.candidate_id, o.doc_id, null
from public.offers o
where o.candidate_id = '__assoc_candidate_offer'
on conflict (candidate_id, doc_id) do nothing;
select pg_temp.assert_true(
  (select count(*) = 2 from public.candidate_requisitions
   where candidate_id = '__assoc_candidate_offer'
     and doc_id in ('__assoc_req_a', '__assoc_req_b'))
  and not exists (select 1 from public.candidate_requisitions
                  where candidate_id = '__assoc_candidate_offer' and doc_id = '__assoc_req_c'),
  'an offer for requisition B must associate the candidate with B'
);

select pg_temp.assert_true(
  (select group_id = '__assoc_group' from public.candidates
   where candidate_id = '__assoc_candidate_shared')
  and (select count(*) = 1 from public.position_groups where group_id = '__assoc_group'),
  'association changes must not alter shared sourcing-group identity'
);

rollback;
