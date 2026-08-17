-- Some deployed app_create_group_match variants use a compact multiline
-- column list, so add JobBKK separately and idempotently.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.app_create_group_match(jsonb)'::regprocedure)
    into v_definition;

  v_definition := replace(
    v_definition,
    'channel_jobtopgun, channel_jobdb,',
    'channel_jobtopgun, channel_jobdb, channel_jobbkk,'
  );
  v_definition := replace(
    v_definition,
    'v_group.channel_jobtopgun, v_group.channel_jobdb,',
    'v_group.channel_jobtopgun, v_group.channel_jobdb, v_group.channel_jobbkk,'
  );

  execute v_definition;
end;
$$;
