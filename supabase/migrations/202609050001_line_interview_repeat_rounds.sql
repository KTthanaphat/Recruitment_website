-- Make Line Interview a repeatable canonical stage with the same round
-- chronology and optimistic-completion contract already used by Test.
do $migration$
declare
  v_definition text;
  v_function regprocedure;
begin
  foreach v_function in array array[
    'app_private.derive_pipeline_pending_date()'::regprocedure,
    'app_private.propagate_corrected_outcome_date()'::regprocedure,
    'public.app_complete_pipeline_stage_v2(jsonb)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_function);
    v_definition := replace(
      v_definition,
      $text$l.recruitment_process = 'Test' and new.recruitment_process = 'Test'$text$,
      $text$l.recruitment_process in ('Line Interview', 'Test') and l.recruitment_process = new.recruitment_process$text$
    );
    v_definition := replace(
      v_definition,
      $text$v_row.recruitment_process = 'Test' and v_next_stage = 'Test'$text$,
      $text$v_row.recruitment_process in ('Line Interview', 'Test') and v_next_stage = v_row.recruitment_process$text$
    );
    v_definition := replace(
      v_definition,
      $text$The next Test round must be current round plus one.$text$,
      $text$The next repeatable-stage round must be current round plus one.$text$
    );
    execute v_definition;
  end loop;
end;
$migration$;
