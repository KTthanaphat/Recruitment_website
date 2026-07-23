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
begin
  perform app_private.assert_recruitment_writer();

  if v_doc_group_id is not null then
    select * into v_match
    from public.document_groups
    where doc_group_id = v_doc_group_id;
  else
    if v_doc_id is null or v_group_id is null then
      raise exception 'Doc ID and Group ID are required to unmatch.';
    end if;

    select * into v_match
    from public.document_groups
    where doc_id = v_doc_id
      and group_id = v_group_id;
  end if;

  if not found then
    raise exception 'Group requisition match does not exist.';
  end if;

  if v_match.group_id is null then
    raise exception 'This requisition is not linked to an active sourcing group.';
  end if;

  if not app_private.can_manage_requisition(v_match.doc_id) then
    raise exception 'You can unmatch only requisitions where you are person in charge.';
  end if;

  if not app_private.can_manage_sourcing_group(v_match.group_id) then
    raise exception 'You can unmatch only sourcing groups where you are responsible.';
  end if;

  if exists(select 1 from public.candidates where doc_group_id = v_match.doc_group_id) then
    raise exception 'Cannot unmatch because candidates are linked to this match.';
  end if;

  perform set_config('app.action', 'document_group:unmatch', true);
  delete from public.document_groups
  where doc_group_id = v_match.doc_group_id;

  return jsonb_build_object('ok', true, 'id', v_match.doc_group_id);
end;
$$;

create or replace function public.app_delete_recruitment_record(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(payload ->> 'entity', '');
  v_id text := nullif(payload ->> 'id', '');
  v_week_start date := nullif(payload ->> 'week_start', '')::date;
  v_deleted integer := 0;
begin
  perform app_private.assert_system_admin();

  if v_entity is null or v_id is null then
    raise exception 'Entity and ID are required.';
  end if;

  if v_entity = 'requisition' then
    if exists (
      select 1
      from public.candidates c
      join public.document_groups dg on dg.doc_group_id = c.doc_group_id
      where dg.doc_id = v_id
    ) then
      raise exception 'Cannot delete requisition because candidates are linked to it.';
    end if;

    perform set_config('app.action', 'requisition:delete', true);
    delete from public.requisitions where doc_id = v_id;

  elsif v_entity = 'requisition_log' then
    perform set_config('app.action', 'requisition_log:delete', true);
    delete from public.requisition_logs where log_id = v_id::bigint;

  elsif v_entity = 'position_group' then
    if exists(select 1 from public.document_groups where group_id = v_id) then
      raise exception 'Cannot delete sourcing group because requisitions are matched to it.';
    end if;

    perform set_config('app.action', 'position_group:delete', true);
    delete from public.position_groups where group_id = v_id;

  elsif v_entity = 'document_group' then
    if exists(select 1 from public.candidates where doc_group_id = v_id) then
      raise exception 'Cannot delete match because candidates are linked to it.';
    end if;

    perform set_config('app.action', 'document_group:delete', true);
    delete from public.document_groups where doc_group_id = v_id;

  elsif v_entity = 'candidate' then
    perform set_config('app.action', 'candidate:delete', true);
    delete from public.candidates where candidate_id = v_id;

  elsif v_entity = 'recruitment_log' then
    perform set_config('app.action', 'recruitment_log:delete', true);
    delete from public.recruitment_logs where log_id = v_id::bigint;

  elsif v_entity = 'offer' then
    perform set_config('app.action', 'offer:delete', true);
    delete from public.offers where offer_id = v_id::bigint;

  elsif v_entity = 'sourcing_weekly_update' then
    if v_week_start is null then
      raise exception 'Week start is required to delete a sourcing weekly update.';
    end if;

    perform set_config('app.action', 'sourcing_update:delete', true);
    delete from public.sourcing_weekly_updates
    where group_id = v_id
      and week_start = v_week_start;

  elsif v_entity = 'vacancy_weekly_snapshot' then
    perform set_config('app.action', 'vacancy_snapshot:delete', true);
    delete from public.vacancy_weekly_snapshots where snapshot_id = v_id::bigint;

  else
    raise exception 'Delete is not allowed for entity "%".', v_entity;
  end if;

  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    raise exception 'Record not found.';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'entity', v_entity);
end;
$$;

revoke all on function public.app_unmatch_group_requisition(jsonb) from public, anon, authenticated;
grant execute on function public.app_unmatch_group_requisition(jsonb) to authenticated;
revoke all on function public.app_delete_recruitment_record(jsonb) from public, anon, authenticated;
grant execute on function public.app_delete_recruitment_record(jsonb) to authenticated;
