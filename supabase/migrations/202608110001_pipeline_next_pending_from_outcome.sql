-- Derive the immediate next Pending date from the completion Outcome date.
-- The dynamic patch preserves the deployed v2 RPC body and its audit/offer
-- handoff behavior while remaining insensitive to its line endings.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.app_complete_pipeline_stage_v2(jsonb)'::regprocedure)
  into v_definition;

  if position('v_next_opened_date date := nullif(v_next ->> ''opened_date'', '''')::date;' in v_definition) = 0
    or position('PIPELINE_DATE_ORDER: Next Pending opened date must be between the Outcome and Bangkok business date.' in v_definition) = 0
  then
    raise exception 'PIPELINE_MIGRATION_PRECONDITION: app_complete_pipeline_stage_v2 is not the expected v2 definition.';
  end if;

  v_definition := replace(
    v_definition,
    'v_next_opened_date date := nullif(v_next ->> ''opened_date'', '''')::date;',
    'v_next_opened_date date;'
  );
  v_definition := regexp_replace(
    v_definition,
    'if v_next_opened_date is null or v_next_opened_date < v_outcome_date or v_next_opened_date > app_private\\.pipeline_business_date\\(\\) then\\s+raise exception ''PIPELINE_DATE_ORDER: Next Pending opened date must be between the Outcome and Bangkok business date\\.'';\\s+end if;',
    'v_next_opened_date := v_outcome_date;',
    'g'
  );
  execute v_definition;
end;
$$;
