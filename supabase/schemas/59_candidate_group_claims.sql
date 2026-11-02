-- One journey per candidate/group across current and historical assignments.
-- This internal ledger is deliberately absent from the Data API.
lock table public.candidate_applications, public.candidate_application_assignments in share row exclusive mode;
do $$ begin
  if exists (
    select candidate_id, group_id from (
      select candidate_id, group_id, application_id from public.candidate_applications
      union select a.candidate_id, s.group_id, s.application_id
      from public.candidate_application_assignments s join public.candidate_applications a using(application_id)
    ) visits group by candidate_id, group_id having count(distinct application_id)>1
  ) then raise exception 'APPLICATION_GROUP_RECONCILIATION_REQUIRED'; end if;
end $$;

create table if not exists app_private.candidate_group_journey_claims (
  candidate_id text not null references public.candidates(candidate_id) on delete cascade,
  group_id text not null references public.position_groups(group_id) on delete restrict,
  application_id uuid not null,
  primary key(candidate_id, group_id),
  foreign key(application_id,candidate_id) references public.candidate_applications(application_id,candidate_id)
    on delete cascade deferrable initially deferred
);
alter table app_private.candidate_group_journey_claims enable row level security;
revoke all on app_private.candidate_group_journey_claims from public,anon,authenticated;
insert into app_private.candidate_group_journey_claims(candidate_id,group_id,application_id)
select candidate_id,group_id,application_id from public.candidate_applications
union select a.candidate_id,s.group_id,s.application_id
from public.candidate_application_assignments s join public.candidate_applications a using(application_id)
on conflict(candidate_id,group_id) do nothing;

create or replace function app_private.claim_candidate_application_group() returns trigger
language plpgsql security definer set search_path=public,app_private as $$
declare v_candidate text; v_claim uuid;
begin
  if tg_table_name='candidate_applications' then
    if tg_op='UPDATE' and (new.application_id<>old.application_id or new.candidate_id<>old.candidate_id) then
      raise exception 'APPLICATION_IDENTITY_IMMUTABLE';
    end if;
    v_candidate:=new.candidate_id;
  else
    if tg_op='UPDATE' and new.application_id<>old.application_id then raise exception 'APPLICATION_IDENTITY_IMMUTABLE'; end if;
    select candidate_id into strict v_candidate from public.candidate_applications where application_id=new.application_id;
  end if;
  -- The unique key serializes competing claims, including direct/legacy writes.
  insert into app_private.candidate_group_journey_claims(candidate_id,group_id,application_id)
  values(v_candidate,new.group_id,new.application_id)
  on conflict(candidate_id,group_id) do update set application_id=excluded.application_id
    where candidate_group_journey_claims.application_id=excluded.application_id
  returning application_id into v_claim;
  if v_claim is null then raise exception 'APPLICATION_GROUP_ALREADY_USED'; end if;
  return new;
end $$;
revoke all on function app_private.claim_candidate_application_group() from public,anon,authenticated;
drop trigger if exists a_candidate_application_group_claim on public.candidate_applications;
create trigger a_candidate_application_group_claim before insert or update of application_id,candidate_id,group_id
  on public.candidate_applications for each row execute function app_private.claim_candidate_application_group();
drop trigger if exists a_candidate_assignment_group_claim on public.candidate_application_assignments;
create trigger a_candidate_assignment_group_claim before insert or update of application_id,group_id
  on public.candidate_application_assignments for each row execute function app_private.claim_candidate_application_group();
