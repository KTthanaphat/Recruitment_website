-- Repair only candidate deletion in both legacy and application-aware deployments.
-- Keep each deployment's existing authorization, grants, and other entity branches.
do $candidate_delete_repair$
declare
  v_definition text := replace(pg_get_functiondef('public.app_delete_recruitment_record(jsonb)'::regprocedure), chr(13), '');
  v_start integer;
  v_next integer;
  v_candidate_block text := $candidate_block$
  elsif v_entity = 'candidate' then
    -- Profiles can have no legacy group anchor and several current/historical journeys.
    select coalesce(array_agg(distinct doc_id) filter (where doc_id is not null), '{}'::text[])
      into v_affected_doc_ids
    from (
      select dg.doc_id
      from public.candidate_applications a
      join public.document_groups dg on dg.group_id = a.group_id
      where a.candidate_id = v_id
      union
      select dg.doc_id
      from public.candidate_applications a
      join public.candidate_application_assignments s on s.application_id = a.application_id
      join public.document_groups dg on dg.group_id = s.group_id
      where a.candidate_id = v_id
      union
      select cr.doc_id from public.candidate_requisitions cr where cr.candidate_id = v_id
      union
      select dg.doc_id
      from public.candidates c
      join public.document_groups dg on dg.doc_group_id = c.doc_group_id or dg.group_id = c.group_id
      where c.candidate_id = v_id
      union
      select o.doc_id from public.offers o where o.candidate_id = v_id
    ) affected;
    perform set_config('app.action', 'candidate:delete', true);
    delete from public.candidates where candidate_id = v_id;

$candidate_block$;
begin
  if to_regclass('public.candidate_applications') is null
    or to_regclass('public.candidate_application_assignments') is null
    or to_regclass('public.candidate_requisitions') is null then
    raise exception 'Candidate application schema must be installed before candidate-delete repair.';
  end if;
  v_start := strpos(v_definition, '  elsif v_entity = ''candidate'' then');
  v_next := strpos(substr(v_definition, v_start), '  elsif v_entity = ''recruitment_log'' then');
  if v_start = 0 or v_next = 0 then
    raise exception 'Unexpected delete RPC structure; candidate-delete repair was not applied.';
  end if;
  v_definition := substr(v_definition, 1, v_start - 1)
    || ltrim(v_candidate_block, chr(10))
    || substr(v_definition, v_start + v_next - 1);
  if strpos(v_definition, 'foreach v_affected_doc_id in array v_affected_doc_ids loop') = 0
    and strpos(v_definition, 'foreach v_affected_doc_id in array coalesce(v_affected_doc_ids, ''{}''::text[]) loop') = 0 then
    raise exception 'Unexpected requisition refresh loop; candidate-delete repair was not applied.';
  end if;
  v_definition := replace(v_definition,
    'foreach v_affected_doc_id in array v_affected_doc_ids loop',
    'foreach v_affected_doc_id in array coalesce(v_affected_doc_ids, ''{}''::text[]) loop');
  execute v_definition;
end;
$candidate_delete_repair$;
