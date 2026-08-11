-- New candidates may be created only for an authorized, open requisition link
-- with remaining headcount. Patch the deployed function in place so its
-- candidate-reference validation and insertion logic remains intact.
do $$
declare
  v_definition text;
  v_marker text := '  if v_mode = ''new'' then';
  v_guard text := $guard$
  if v_mode = 'new' and not exists (
    select 1
    from public.document_groups dg
    join public.requisitions r on r.doc_id = dg.doc_id
    left join lateral (
      select count(*)::integer accepted_count
      from public.offers o
      where o.doc_id = r.doc_id and o.accepted_date is not null
    ) accepted on true
    where dg.doc_group_id = v_doc_group_id
      and r.status = 'ongoing'
      and greatest(r.head_count - coalesce(accepted.accepted_count, 0), 0) > 0
  ) then
    raise exception 'CANDIDATE_GROUP_NOT_AVAILABLE: Group ID must be linked to an ongoing requisition with remaining headcount.';
  end if;
$guard$;
begin
  select pg_get_functiondef('public.app_upsert_candidate(jsonb)'::regprocedure)
  into v_definition;

  if position('CANDIDATE_GROUP_NOT_AVAILABLE' in v_definition) > 0 then
    raise exception 'CANDIDATE_MIGRATION_PRECONDITION: eligibility guard is already present.';
  end if;
  if position(v_marker in v_definition) = 0 then
    raise exception 'CANDIDATE_MIGRATION_PRECONDITION: expected new-candidate branch was not found.';
  end if;

  v_definition := replace(v_definition, v_marker, v_guard || E'\n' || v_marker);
  execute v_definition;
end;
$$;
