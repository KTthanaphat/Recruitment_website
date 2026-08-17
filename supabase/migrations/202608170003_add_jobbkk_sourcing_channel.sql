alter table public.position_groups add column if not exists channel_jobbkk boolean not null default false;
alter table public.document_groups add column if not exists channel_jobbkk boolean not null default false;
alter table public.sourcing_weekly_updates add column if not exists channel_jobbkk boolean not null default false;
alter table public.sourcing_weekly_updates add column if not exists applicants_jobbkk integer not null default 0 check (applicants_jobbkk >= 0);

-- Preserve existing candidate attribution while correcting the display name.
update public.candidates set channel = 'JobsDB' where lower(trim(coalesce(channel, ''))) = 'jobdb';

-- The existing write RPCs are updated in place so JobBKK is persisted in new
-- groups, group matches, and weekly sourcing updates.
do $$
declare
  v_function regprocedure;
  v_definition text;
begin
  for v_function in
    select procedure::regprocedure
    from unnest(array[
      to_regprocedure('public.app_upsert_position_group(jsonb)'),
      to_regprocedure('public.app_create_group_match(jsonb)'),
      to_regprocedure('public.app_create_and_match_sourcing_group(jsonb)'),
      to_regprocedure('public.app_upsert_sourcing_weekly_update(jsonb)'),
      to_regprocedure('public.app_upsert_sourcing_weekly_update_v1(jsonb)')
    ]) as procedure
    where procedure is not null
  loop
    select pg_get_functiondef(v_function) into v_definition;
    v_definition := replace(v_definition, 'channel_jobdb, channel_linkedin', 'channel_jobdb, channel_jobbkk, channel_linkedin');
    v_definition := replace(v_definition, 'channel_jobdb, channel_walkin', 'channel_jobdb, channel_jobbkk, channel_walkin');
    v_definition := replace(v_definition, 'channel_jobdb, channel_referral', 'channel_jobdb, channel_jobbkk, channel_referral');
    v_definition := replace(v_definition, 'v_group.channel_jobdb, v_group.channel_linkedin', 'v_group.channel_jobdb, v_group.channel_jobbkk, v_group.channel_linkedin');
    v_definition := replace(v_definition, 'channel_jobtopgun, channel_jobdb, channel_linkedin', 'channel_jobtopgun, channel_jobdb, channel_jobbkk, channel_linkedin');
    v_definition := replace(v_definition, 'applicants_jobtopgun, applicants_jobdb, applicants_linkedin', 'applicants_jobtopgun, applicants_jobdb, applicants_jobbkk, applicants_linkedin');
    v_definition := replace(v_definition, 'coalesce((payload ->> ''channel_jobdb'')::boolean, false),', 'coalesce((payload ->> ''channel_jobdb'')::boolean, false),' || chr(10) || '    coalesce((payload ->> ''channel_jobbkk'')::boolean, false),');
    v_definition := replace(v_definition, 'case when payload ? ''channel_jobdb'' then (payload ->> ''channel_jobdb'')::boolean else coalesce(v_group.channel_jobdb, false) end,', 'case when payload ? ''channel_jobdb'' then (payload ->> ''channel_jobdb'')::boolean else coalesce(v_group.channel_jobdb, false) end,' || chr(10) || '    case when payload ? ''channel_jobbkk'' then (payload ->> ''channel_jobbkk'')::boolean else coalesce(v_group.channel_jobbkk, false) end,');
    v_definition := replace(v_definition, 'nullif(payload ->> ''applicants_jobdb'', '''')::integer,', 'nullif(payload ->> ''applicants_jobdb'', '''')::integer,' || chr(10) || '    nullif(payload ->> ''applicants_jobbkk'', '''')::integer,');
    v_definition := replace(v_definition, 'coalesce(nullif(payload ->> ''applicants_jobdb'', '''')::integer, 0),', 'coalesce(nullif(payload ->> ''applicants_jobdb'', '''')::integer, 0),' || chr(10) || '    coalesce(nullif(payload ->> ''applicants_jobbkk'', '''')::integer, 0),');
    v_definition := replace(v_definition, 'channel_jobdb = excluded.channel_jobdb,', 'channel_jobdb = excluded.channel_jobdb,' || chr(10) || '    channel_jobbkk = excluded.channel_jobbkk,');
    v_definition := replace(v_definition, 'channel_jobdb = case when payload ? ''channel_jobdb'' then excluded.channel_jobdb else sourcing_weekly_updates.channel_jobdb end,', 'channel_jobdb = case when payload ? ''channel_jobdb'' then excluded.channel_jobdb else sourcing_weekly_updates.channel_jobdb end,' || chr(10) || '    channel_jobbkk = case when payload ? ''channel_jobbkk'' then excluded.channel_jobbkk else sourcing_weekly_updates.channel_jobbkk end,');
    v_definition := replace(v_definition, 'applicants_jobdb = excluded.applicants_jobdb,', 'applicants_jobdb = excluded.applicants_jobdb,' || chr(10) || '    applicants_jobbkk = excluded.applicants_jobbkk,');
    execute v_definition;
  end loop;
end;
$$;
