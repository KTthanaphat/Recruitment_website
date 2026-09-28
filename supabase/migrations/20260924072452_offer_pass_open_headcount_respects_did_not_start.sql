-- Preserve each environment's RPC body while aligning Offer-pass headcount with operational coverage.
do $migration$
declare
  v_definition text;
  v_old text := 'select count(*)::integer accepted_count from public.offers o where o.doc_id = r.doc_id and o.accepted_date is not null';
  v_new text := v_old || ' and o.start_confirmation is distinct from ''did_not_start''';
begin
  select pg_get_functiondef('public.app_complete_pipeline_stage_v2(jsonb)'::regprocedure)
    into v_definition;

  if position(v_new in v_definition) = 0 then
    if position(v_old in v_definition) = 0 then
      raise exception 'Expected Offer-pass accepted-count predicate was not found.';
    end if;

    execute replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;