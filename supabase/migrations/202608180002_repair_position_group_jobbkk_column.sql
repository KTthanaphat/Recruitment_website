-- Repair deployed app_upsert_position_group variants where the JobBKK value
-- was added without its corresponding INSERT target column.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.app_upsert_position_group(jsonb)'::regprocedure)
    into v_definition;

  v_definition := replace(
    v_definition,
    'channel_jobdb,' || chr(13) || chr(10) || '    channel_linkedin',
    'channel_jobdb, channel_jobbkk,' || chr(13) || chr(10) || '    channel_linkedin'
  );
  v_definition := replace(
    v_definition,
    'channel_jobdb,' || chr(10) || '    channel_linkedin',
    'channel_jobdb, channel_jobbkk,' || chr(10) || '    channel_linkedin'
  );

  if position('channel_jobdb, channel_jobbkk,' in v_definition) = 0 then
    raise exception 'Unable to locate the position-group channel column list.';
  end if;

  execute v_definition;
end;
$$;
