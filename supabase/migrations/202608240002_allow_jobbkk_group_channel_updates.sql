-- JobBKK was added after this channel-control RPC. Extend its allow-list so
-- managed open groups can enable or disable JobBKK like every other channel.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.app_set_sourcing_group_channel_v1(jsonb)'::regprocedure)
    into v_definition;

  v_definition := replace(
    v_definition,
    '''fb'',''jobthai'',''jobtopgun'',''jobdb'',''linkedin'',''walkin'',''referral'',''others''',
    '''fb'',''jobthai'',''jobtopgun'',''jobdb'',''jobbkk'',''linkedin'',''walkin'',''referral'',''others'''
  );

  if position('''jobbkk''' in v_definition) = 0 then
    raise exception 'Unable to add JobBKK to the sourcing channel allow-list.';
  end if;

  execute v_definition;
end;
$$;
