-- Production-only creator provenance preparation.
-- Run immediately before the original 20261015074832 privacy migration.
alter table public.candidates add column if not exists created_by uuid;

create temporary table candidate_creator_trigger_state on commit drop as
select tgname,tgenabled
from pg_trigger
where tgrelid='public.candidates'::regclass and not tgisinternal;

do $$ declare r record; begin
  for r in select * from candidate_creator_trigger_state loop
    execute format('alter table public.candidates disable trigger %I',r.tgname);
  end loop;
end $$;

do $$ begin
  if exists (
    select 1
    from public.candidates c
    where c.created_by is null
      and exists (
        select 1 from public.change_logs imported
        where imported.entity='candidates'
          and imported.entity_id=c.candidate_id
          and imported.action like 'migration:%'
      )
      and (
        select count(*)
        from public.change_logs l
        join public.profiles p on p.id=l.changed_by
        where l.entity='candidates'
          and l.entity_id=c.candidate_id
          and l.action like 'migration:%'
          and l.old_data is null
          and l.new_data->>'candidate_id'=c.candidate_id
          and l.new_data->'created_at'=to_jsonb(c.created_at)
      ) <> 1
  ) then
    raise exception 'PROFILE_CREATOR_RECONCILIATION_REQUIRED: Each null creator needs exactly one validated migration INSERT snapshot.';
  end if;
end $$;

update public.candidates c
set created_by=(
  select l.changed_by
  from public.change_logs l
  join public.profiles p on p.id=l.changed_by
  where l.entity='candidates'
    and l.entity_id=c.candidate_id
    and l.action like 'migration:%'
    and l.old_data is null
    and l.new_data->>'candidate_id'=c.candidate_id
    and l.new_data->'created_at'=to_jsonb(c.created_at)
)
where c.created_by is null
  and exists (
    select 1 from public.change_logs imported
    where imported.entity='candidates'
      and imported.entity_id=c.candidate_id
      and imported.action like 'migration:%'
  );

do $$ declare r record; begin
  for r in select * from candidate_creator_trigger_state loop
    execute format('alter table public.candidates %s trigger %I',
      case r.tgenabled when 'O' then 'enable' when 'A' then 'enable always'
        when 'R' then 'enable replica' else 'disable' end,r.tgname);
  end loop;
end $$;
