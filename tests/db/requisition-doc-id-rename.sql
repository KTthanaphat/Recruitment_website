-- Foreign-key cascade regression test. Run after the editable requisition ID
-- migration on a disposable database.
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

insert into public.requisitions (doc_id, site, position, department, person_in_charge)
values ('__rename_old', '__rename_site', 'Rename fixture', 'Test', 'Test Owner');

insert into public.position_groups (group_id, group_position)
values ('__rename_group', 'Rename fixture');

insert into public.document_groups (doc_group_id, doc_id, group_id, group_position)
values ('__rename_doc_group', '__rename_old', '__rename_group', 'Rename fixture');

insert into public.candidates (candidate_id, name, doc_group_id, group_id)
values ('__rename_candidate', 'Rename fixture', '__rename_doc_group', '__rename_group');

-- The offer creates its exact candidate/requisition link automatically.
insert into public.offers (candidate_id, doc_id)
values ('__rename_candidate', '__rename_old');

insert into public.requisition_logs (doc_id, log_date, status, remark)
values ('__rename_old', current_date, 'ongoing', 'History before ID change');

select set_config('app.action', 'requisition:change', true);
update public.requisitions set doc_id = '__rename_new' where doc_id = '__rename_old';

select pg_temp.assert_true(
  not exists (select 1 from public.requisitions where doc_id = '__rename_old')
  and exists (select 1 from public.requisitions where doc_id = '__rename_new'),
  'the requisition primary key must change'
);
select pg_temp.assert_true(
  (select doc_id = '__rename_new' from public.requisition_logs where remark = 'History before ID change')
  and (select doc_id = '__rename_new' from public.document_groups where doc_group_id = '__rename_doc_group')
  and (select doc_id = '__rename_new' from public.offers where candidate_id = '__rename_candidate')
  and (select doc_id = '__rename_new' from public.candidate_requisitions where candidate_id = '__rename_candidate'),
  'logs, sourcing links, offers, and explicit candidate links must follow the new ID'
);

rollback;
