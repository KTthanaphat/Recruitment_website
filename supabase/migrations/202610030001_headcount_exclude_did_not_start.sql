begin;

do $$
declare
  v_function_name text;
  v_definition text;
  v_updated text;
  v_functions text[] := array[
    'public.app_create_and_match_sourcing_group(jsonb)',
    'public.app_upsert_candidate(jsonb)'
  ];
begin
  foreach v_function_name in array v_functions loop
    select pg_get_functiondef(v_function_name::regprocedure)
    into v_definition;

    if v_definition is null then
      raise exception 'HEADCOUNT_MIGRATION_PRECONDITION: missing function %.', v_function_name;
    end if;
    if position('o.start_confirmation is distinct from ''did_not_start''' in v_definition) > 0 then
      continue;
    end if;
    if length(v_definition) - length(replace(v_definition, 'o.accepted_date is not null', ''))
        <> length('o.accepted_date is not null') then
      raise exception 'HEADCOUNT_MIGRATION_PRECONDITION: expected one accepted-offer predicate in %.', v_function_name;
    end if;

    v_updated := replace(
      v_definition,
      'o.accepted_date is not null',
      'o.accepted_date is not null and o.start_confirmation is distinct from ''did_not_start'''
    );
    execute v_updated;
  end loop;
end;
$$;

commit;
