-- Repair legacy alias spelling missed by the original repeat-round migration.
-- Preserve installed function bodies, authorization, ownership and grants.
do $migration$
declare
  v_function regprocedure;
  v_definition text;
  v_alias text;
begin
  foreach v_function in array array[
    'app_private.derive_pipeline_pending_date()'::regprocedure,
    'app_private.propagate_corrected_outcome_date()'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    foreach v_alias in array array['log', 'l'] loop
      v_definition := replace(v_definition,
        v_alias || '.recruitment_process = ''Test'' and new.recruitment_process = ''Test''',
        v_alias || '.recruitment_process in (''Line Interview'', ''Test'') and ' || v_alias || '.recruitment_process = new.recruitment_process');
    end loop;
    if position('''Line Interview''' in v_definition) = 0 then
      raise exception 'Unrecognized repeat-round function definition: %', v_function;
    end if;
    execute v_definition;
  end loop;
end;
$migration$;
