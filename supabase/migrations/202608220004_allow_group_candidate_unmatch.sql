-- Candidates belong to position_groups.  A requisition can therefore be
-- unmatched without deleting or blocking the group's candidate pool.
alter table public.candidates alter column doc_group_id drop not null;
alter table public.candidates drop constraint if exists candidates_doc_group_id_fkey;
alter table public.candidates add constraint candidates_doc_group_id_fkey
  foreign key (doc_group_id) references public.document_groups(doc_group_id) on delete set null;

create or replace function public.app_unmatch_group_requisition(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc_group_id text := nullif(payload ->> 'doc_group_id', '');
  v_doc_id text := nullif(payload ->> 'doc_id', '');
  v_group_id text := nullif(payload ->> 'group_id', '');
  v_match public.document_groups%rowtype;
  v_replacement_doc_group_id text;
begin
  perform app_private.assert_recruitment_writer();

  if v_doc_group_id is not null then
    select * into v_match from public.document_groups where doc_group_id = v_doc_group_id;
  else
    if v_doc_id is null or v_group_id is null then
      raise exception 'Doc ID and Group ID are required to unmatch.';
    end if;
    select * into v_match from public.document_groups where doc_id = v_doc_id and group_id = v_group_id;
  end if;

  if not found then raise exception 'Group requisition match does not exist.'; end if;
  if v_match.group_id is null then raise exception 'This requisition is not linked to an active sourcing group.'; end if;
  if not app_private.can_manage_requisition(v_match.doc_id) then raise exception 'You can unmatch only requisitions you can manage.'; end if;
  if not app_private.can_manage_sourcing_group(v_match.group_id) then raise exception 'You can unmatch only sourcing groups you can manage.'; end if;

  perform set_config('app.action', 'document_group:unmatch', true);
  select doc_group_id into v_replacement_doc_group_id
  from public.document_groups
  where group_id = v_match.group_id and doc_group_id <> v_match.doc_group_id
  order by doc_group_id limit 1;

  update public.candidates
  set doc_group_id = v_replacement_doc_group_id
  where group_id = v_match.group_id and doc_group_id = v_match.doc_group_id;

  delete from public.document_groups where doc_group_id = v_match.doc_group_id;
  return jsonb_build_object('ok', true, 'id', v_match.doc_group_id);
end;
$$;
