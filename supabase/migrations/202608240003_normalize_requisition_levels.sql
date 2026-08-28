-- The canonical persisted form is the numeric grade: 0 through 14.
-- Historical imports used an L prefix, while current forms already send digits.
update public.requisitions
set level = regexp_replace(btrim(level), '^L', '', 'i')
where btrim(level) ~* '^L(0|[1-9]|1[0-4])$';

alter table public.requisitions
  add constraint requisitions_level_format_check
  check (level is null or level ~ '^(0|[1-9]|1[0-4])$');

-- Accept legacy L-prefixed form input at the RPC boundary, but always store
-- the numeric canonical value.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.app_upsert_requisition(jsonb)'::regprocedure)
    into v_definition;

  v_definition := replace(
    v_definition,
    $match$nullif(payload ->> 'level', '')$match$,
    $replacement$nullif(regexp_replace(trim(payload ->> 'level'), '^L', '', 'i'), '')$replacement$
  );

  if position($needle$regexp_replace(trim(payload ->> 'level'), '^L', '', 'i')$needle$ in v_definition) = 0 then
    raise exception 'Unable to normalize requisition level input.';
  end if;

  execute v_definition;
end;
$$;
