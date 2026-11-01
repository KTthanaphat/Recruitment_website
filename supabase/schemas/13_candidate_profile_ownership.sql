-- Creator identity is independent of application responsibility. Preserve legacy timestamps.
alter table public.candidates add column if not exists created_by uuid;
alter table public.candidates alter column home_site drop not null;
create temporary table profile_backfill_triggers on commit drop as
select tgname,tgenabled from pg_trigger where tgrelid='public.candidates'::regclass and not tgisinternal;
do $$ declare r record; begin
  for r in select * from profile_backfill_triggers loop execute format('alter table public.candidates disable trigger %I',r.tgname); end loop;
  if exists(select 1 from public.candidates c where c.created_by is null and
    (select count(distinct changed_by) from public.change_logs l where l.entity='candidates' and l.entity_id=c.candidate_id and l.action in ('candidate:new','candidate-profile:new') and l.changed_by is not null)<>1)
  then raise exception 'PROFILE_CREATOR_RECONCILIATION_REQUIRED'; end if;
end $$;
update public.candidates c set created_by=(select (array_agg(distinct changed_by))[1] from public.change_logs l where l.entity='candidates' and l.entity_id=c.candidate_id and l.action in ('candidate:new','candidate-profile:new') and l.changed_by is not null) where created_by is null;
update public.candidates c set responsible_recruiter_id=created_by where responsible_recruiter_id is null and exists(select 1 from public.profiles p where p.id=c.created_by);
do $$ declare r record; begin
  for r in select * from profile_backfill_triggers loop execute format('alter table public.candidates %s trigger %I',case r.tgenabled when 'O' then 'enable' when 'A' then 'enable always' when 'R' then 'enable replica' else 'disable' end,r.tgname); end loop;
end $$;
alter table public.candidates alter column created_by set not null;
create index if not exists candidates_creator on public.candidates(created_by);

-- One current note; the existing audit trigger preserves every previous revision.
do $$ begin if exists(select 1 from public.candidate_notes group by candidate_id having count(*)>1) then raise exception 'PROFILE_NOTE_RECONCILIATION_REQUIRED'; end if; end $$;
alter table public.candidate_notes add column if not exists updated_at timestamptz not null default now();
alter table public.candidate_notes add column if not exists updated_by uuid references public.profiles(id) on delete set null;
alter table public.candidate_notes add column if not exists version integer not null default 1;
alter table public.candidate_notes add constraint candidate_notes_one_current unique(candidate_id);

create or replace function app_private.protect_candidate_creator() returns trigger language plpgsql set search_path=public,app_private as $$
begin
 if tg_op='INSERT' then
   if auth.uid() is not null then new.created_by:=auth.uid(); new.responsible_recruiter_id:=auth.uid(); end if;
 elsif new.created_by is distinct from old.created_by then raise exception 'PROFILE_CREATOR_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger protect_candidate_creator before insert or update on public.candidates for each row execute function app_private.protect_candidate_creator();
