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

create or replace function public.app_create_candidate_application_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_candidate text:=nullif(payload->>'candidate_id',''); v_group text:=nullif(payload->>'group_id',''); v_id uuid; v_date date:=coalesce(nullif(payload->>'opened_date','')::date,(now() at time zone 'Asia/Bangkok')::date);
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_match_candidate(v_candidate) then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  perform 1 from public.candidates where candidate_id=v_candidate for update;
  perform app_private.assert_application_destination(v_candidate,v_group);
  if v_date>(now() at time zone 'Asia/Bangkok')::date then raise exception 'PIPELINE_DATE_ORDER'; end if;
  if exists(select 1 from app_private.candidate_group_journey_claims where candidate_id=v_candidate and group_id=v_group) then raise exception 'APPLICATION_GROUP_ALREADY_USED'; end if;
  perform set_config('app.action','application:create',true);
  insert into public.candidate_applications(candidate_id,group_id,created_by) values(v_candidate,v_group,auth.uid()) returning application_id into v_id;
  insert into public.candidate_application_assignments(application_id,group_id,actor_id) values(v_id,v_group,auth.uid());
  perform set_config('app.application_id',v_id::text,true);
  insert into public.recruitment_logs(application_id,candidate_id,log_date,recruitment_process,round,result,remark,record_origin)
    values(v_id,v_candidate,v_date,'Phone Screen',1,null,'Initial pending phone screening','auto');
  -- Legacy anchors remain usable only while exactly one journey exists.
  update public.candidates set group_id=case when (select count(*) from public.candidate_applications where candidate_id=v_candidate)=1 then v_group else null end,doc_group_id=null,updated_at=now() where candidate_id=v_candidate;
  return jsonb_build_object('ok',true,'id',v_candidate,'candidate_id',v_candidate,'application_id',v_id);
end $$;
create or replace function public.app_transfer_candidate_application_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_id uuid:=app_private.resolve_application(payload); v_group text:=nullif(payload->>'group_id',''); v_reason text:=nullif(btrim(payload->>'reason'),''); v_row public.candidate_applications%rowtype; v_source_site text; v_destination_site text;
begin
  select * into v_row from public.candidate_applications where application_id=v_id for update;
  if v_row.state<>'active' then raise exception 'APPLICATION_CLOSED'; end if;
  if nullif(payload->>'expected_version','')::integer is distinct from v_row.version then raise exception 'APPLICATION_STALE_WRITE: Refresh before reassigning.'; end if;
  if v_reason is null or v_group is null or v_group=v_row.group_id then raise exception 'APPLICATION_TRANSFER_INVALID: Choose another group and enter a reason.'; end if;
  perform 1 from public.candidates where candidate_id=v_row.candidate_id for update;
  perform app_private.assert_application_destination(v_row.candidate_id,v_group);
  select min(r.site) into v_source_site from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=v_row.group_id;
  select min(r.site) into v_destination_site from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=v_group;
  if exists(select 1 from app_private.candidate_group_journey_claims where candidate_id=v_row.candidate_id and group_id=v_group and application_id<>v_id) then raise exception 'APPLICATION_GROUP_ALREADY_USED'; end if;
  if exists(select 1 from public.offers where candidate_id=v_row.candidate_id and accepted_date is not null and start_confirmation is distinct from 'did_not_start') then raise exception 'APPLICATION_ACCEPTED_OFFER_BLOCKS_TRANSFER'; end if;
  if exists(select 1 from public.interview_meetings m join public.recruitment_logs l on l.stage_instance_id=m.stage_instance_id where l.application_id=v_id and m.status in ('creating','scheduled','rescheduling','cancelling')) then raise exception 'APPLICATION_MEETING_REQUIRES_RESOLUTION: Resolve the scheduled Teams meeting before reassignment.'; end if;
  perform set_config('app.action','application:reassign',true);
  update public.candidate_application_assignments set ended_at=now() where application_id=v_id and ended_at is null;
  insert into public.candidate_application_assignments(application_id,group_id,from_group_id,actor_id,reason) values(v_id,v_group,v_row.group_id,auth.uid(),v_reason);
  update public.candidate_applications set group_id=v_group,version=version+1,updated_at=now() where application_id=v_id;
  update public.candidates set group_id=case when (select count(*) from public.candidate_applications where candidate_id=v_row.candidate_id)=1 then v_group else null end,doc_group_id=null,updated_at=now() where candidate_id=v_row.candidate_id;
  return jsonb_build_object('ok',true,'id',v_row.candidate_id,'application_id',v_id,'version',v_row.version+1);
end $$;
