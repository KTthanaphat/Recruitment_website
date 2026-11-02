-- Authorization is checked on every journey; profile visibility does not authorize its other applications.
create or replace function app_private.is_profile_admin() returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.current_app_role() in ('system_admin','admin_recruiter')
$$;
create or replace function app_private.is_group_pic(p_group text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.is_recruitment_writer() and exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) join public.profiles p on p.id=auth.uid() where d.group_id=p_group and nullif(btrim(r.person_in_charge),'') is not null and lower(btrim(r.person_in_charge)) in (lower(btrim(p.nickname)),lower(btrim(p.full_name))))
$$;
create or replace function app_private.can_read_requisition(p_doc_id text) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_req_site text; v_pic text; v_profile_site text; v_nickname text; v_full_name text;
begin
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role in ('system_admin','admin_recruiter','viewer') then return true; end if;
 if v_role<>'site_recruiter' then return false; end if;
 select r.site,r.person_in_charge into v_req_site,v_pic from public.requisitions r where r.doc_id=p_doc_id;
 if not found then return false; end if;
 v_profile_site:=app_private.current_profile_site();
 if v_req_site=v_profile_site then return true; end if;
 select p.nickname,p.full_name into v_nickname,v_full_name from public.profiles p where p.id=auth.uid();
 if lower(btrim(v_pic)) in (lower(btrim(v_nickname)),lower(btrim(v_full_name))) then return true; end if;
 return exists(select 1 from public.document_groups d where d.doc_id=p_doc_id and app_private.is_group_pic(d.group_id));
end
$$;
create or replace function app_private.can_read_application(p_id uuid) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_group text;
begin
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role not in ('system_admin','admin_recruiter','site_recruiter','viewer') then return false; end if;
 select a.group_id into v_group from public.candidate_applications a where a.application_id=p_id;
 if not found then return false; end if;
 if v_role in ('system_admin','admin_recruiter','viewer') then return true; end if;
 return app_private.can_read_position_group(v_group);
end
$$;
create or replace function app_private.can_manage_application(p_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.is_recruitment_writer() and exists(select 1 from public.candidate_applications a where a.application_id=p_id and (app_private.is_profile_admin() or app_private.is_group_pic(a.group_id)))
$$;
create or replace function app_private.can_read_candidate(p_candidate_id text) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v_role text; v_created_by uuid; v_home_site text; v_group text; v_profile_site text;
begin
 if auth.uid() is null then return false; end if;
 v_role:=app_private.current_app_role();
 if v_role not in ('system_admin','admin_recruiter','site_recruiter','viewer') then return false; end if;
 select c.created_by,c.home_site into v_created_by,v_home_site from public.candidates c where c.candidate_id=p_candidate_id;
 if not found then return false; end if;
 if v_role in ('system_admin','admin_recruiter') or v_created_by=auth.uid() then return true; end if;
 if v_role='viewer' then
   return exists(select 1 from public.candidate_applications a where a.candidate_id=p_candidate_id);
 end if;
 v_profile_site:=app_private.current_profile_site();
 if v_home_site is not null and v_home_site=v_profile_site then
   return exists(select 1 from public.candidate_applications a where a.candidate_id=p_candidate_id);
 end if;
 for v_group in select a.group_id from public.candidate_applications a where a.candidate_id=p_candidate_id loop
   if app_private.can_read_position_group(v_group) then return true; end if;
 end loop;
 return false;
end
$$;
create or replace function app_private.can_manage_candidate(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.is_recruitment_writer() and exists(select 1 from public.candidates c where c.candidate_id=p_candidate_id and (app_private.is_profile_admin() or c.created_by=auth.uid() or exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id and app_private.is_group_pic(a.group_id))))
$$;
create or replace function app_private.can_read_profile_note(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.is_recruitment_reader() and exists(select 1 from public.candidates c where c.candidate_id=p_candidate_id and (app_private.is_profile_admin() or c.created_by=auth.uid() or exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id and app_private.is_group_pic(a.group_id))))
$$;
create or replace function app_private.can_edit_profile_note(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.is_recruitment_writer() and exists(select 1 from public.candidates c where c.candidate_id=p_candidate_id and (app_private.is_profile_admin() or c.created_by=auth.uid()))
$$;
create or replace function app_private.can_match_candidate(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.can_manage_candidate(p_candidate_id)
$$;
create or replace function app_private.can_read_candidate_audit(p_entity text,p_id text,p_old jsonb,p_new jsonb) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
declare v jsonb:=coalesce(p_new,p_old,'{}'::jsonb); v_candidate text; v_application uuid;
begin
 if not app_private.is_global_recruitment_reader() then return false; end if;
 if app_private.is_profile_admin() then return true; end if;
 if p_entity='candidates' then return app_private.can_read_candidate(p_id); end if;
 v_candidate:=coalesce(v->>'candidate_id',p_old->>'candidate_id');
 if p_entity='candidate_notes' then return app_private.can_read_profile_note(v_candidate); end if;
 if p_entity='candidate_references' then return app_private.can_read_candidate(v_candidate); end if;
 if p_entity in ('candidate_applications','candidate_application_assignments','recruitment_logs','offers','candidate_reference_checks','candidate_requisitions') then
   v_application:=coalesce(nullif(v->>'application_id',''),nullif(p_old->>'application_id',''))::uuid;
   if v_application is not null then return app_private.can_read_application(v_application); end if;
   return v_candidate is not null and app_private.can_read_candidate(v_candidate);
 end if;
 return true;
end $$;
create or replace function app_private.current_application_id() returns uuid language sql stable set search_path=pg_catalog as $$
  select nullif(current_setting('app.application_id',true),'')::uuid
$$;
create or replace function app_private.resolve_application(payload jsonb) returns uuid language plpgsql security definer set search_path=public,app_private as $$
declare v_id uuid:=nullif(payload->>'application_id','')::uuid; v_candidate text:=nullif(payload->>'candidate_id',''); v_count integer; v_record uuid;
begin
  perform app_private.assert_recruitment_writer();
  if nullif(payload->>'stage_instance_id','') is not null then
    select application_id into v_record from public.recruitment_logs where stage_instance_id=(payload->>'stage_instance_id')::uuid;
  elsif nullif(payload->>'offer_id','') is not null then
    select application_id into v_record from public.offers where offer_id=(payload->>'offer_id')::bigint;
  end if;
  if v_id is not null and v_record is not null and v_id<>v_record then raise exception 'APPLICATION_RECORD_MISMATCH'; end if;
  v_id:=coalesce(v_id,v_record,app_private.current_application_id());
  if v_id is null then
    select count(*), (array_agg(application_id))[1] into v_count,v_id from public.candidate_applications where candidate_id=v_candidate and state='active';
    if v_count=0 then
      select count(*), (array_agg(application_id))[1] into v_count,v_id from public.candidate_applications where candidate_id=v_candidate;
    end if;
    if v_count<>1 then raise exception 'APPLICATION_SELECTION_REQUIRED: Select a hiring application explicitly.'; end if;
  end if;
  if not exists(select 1 from public.candidate_applications where application_id=v_id and (v_candidate is null or candidate_id=v_candidate)) then raise exception 'APPLICATION_CANDIDATE_MISMATCH'; end if;
  if not app_private.can_manage_application(v_id) then raise exception 'APPLICATION_NOT_AUTHORIZED'; end if;
  perform 1 from public.candidate_applications where application_id=v_id for update;
  perform set_config('app.application_id',v_id::text,true);
  return v_id;
end $$;
create or replace function app_private.lock_pipeline_candidate(p_candidate_id text) returns void language plpgsql security definer set search_path=public,app_private as $$
begin
  perform app_private.assert_recruitment_writer();
  if app_private.current_application_id() is null or not exists(select 1 from public.candidate_applications where application_id=app_private.current_application_id() and candidate_id=p_candidate_id) or not app_private.can_manage_application(app_private.current_application_id()) then raise exception 'APPLICATION_SELECTION_REQUIRED'; end if;
  perform 1 from public.candidates where candidate_id=p_candidate_id for update;
end $$;
create or replace function app_private.assert_candidate_pipeline_open(p_candidate_id text) returns void language plpgsql stable security definer set search_path=public,app_private as $$
begin
  if not exists(select 1 from public.candidate_applications where application_id=app_private.current_application_id() and candidate_id=p_candidate_id and state='active') then raise exception 'APPLICATION_CLOSED: Start a new application for another attempt.'; end if;
  if exists(select 1 from public.recruitment_logs where application_id=app_private.current_application_id() and superseded_at is null and result=0) then raise exception 'Pipeline update unavailable because this application has a failed stage.'; end if;
  if exists(select 1 from public.recruitment_logs where application_id=app_private.current_application_id() and superseded_at is null and recruitment_process='Offer' and result=1) then raise exception 'Pipeline update unavailable because this application completed all stages.'; end if;
end $$;

create or replace function app_private.stamp_application_activity() returns trigger language plpgsql security definer set search_path=public,app_private as $$
declare v_candidate text; v_assignment uuid; v_original public.recruitment_logs%rowtype;
begin
  if tg_table_name='candidate_reference_checks' then
    select candidate_id into v_candidate from public.candidate_references where reference_id=new.reference_id;
  else v_candidate:=new.candidate_id; end if;
  if tg_op='UPDATE' and new.application_id is distinct from old.application_id then raise exception 'APPLICATION_IMMUTABLE: Activity cannot move between journeys.'; end if;
  if new.application_id is null then new.application_id:=coalesce(app_private.current_application_id(),app_private.resolve_application(jsonb_build_object('candidate_id',v_candidate))); end if;
  if not exists(select 1 from public.candidate_applications where application_id=new.application_id and candidate_id=v_candidate) then raise exception 'APPLICATION_CANDIDATE_MISMATCH'; end if;
  if tg_table_name='recruitment_logs' then
    if tg_op='INSERT' and new.record_origin='correction' then
      select * into v_original from public.recruitment_logs where application_id=new.application_id and superseded_by_stage_instance_id=new.stage_instance_id;
      if not found then raise exception 'APPLICATION_CORRECTION_CONTEXT_REQUIRED'; end if;
      new.entry_assignment_id:=v_original.entry_assignment_id;
      new.outcome_assignment_id:=v_original.outcome_assignment_id;
      return new;
    end if;
    select assignment_id into v_assignment from public.candidate_application_assignments where application_id=new.application_id and ended_at is null;
    if tg_op='INSERT' then new.entry_assignment_id:=v_assignment;
    elsif new.entry_assignment_id is distinct from old.entry_assignment_id then raise exception 'APPLICATION_ATTRIBUTION_IMMUTABLE'; end if;
    if new.result is not null and (tg_op='INSERT' or old.result is null) then new.outcome_assignment_id:=v_assignment; end if;
  end if;
  return new;
end $$;
drop trigger if exists aa_stamp_application on public.recruitment_logs;
create trigger aa_stamp_application before insert or update on public.recruitment_logs for each row execute function app_private.stamp_application_activity();
drop trigger if exists aa_stamp_application on public.offers;
create trigger aa_stamp_application before insert or update on public.offers for each row execute function app_private.stamp_application_activity();
drop trigger if exists aa_stamp_application on public.candidate_reference_checks;
create trigger aa_stamp_application before insert or update on public.candidate_reference_checks for each row execute function app_private.stamp_application_activity();

create or replace function app_private.sync_application_lifecycle() returns trigger language plpgsql security definer set search_path=public,app_private as $$
begin
  if tg_table_name='recruitment_logs' then
   if new.result=0 and new.superseded_at is null then
    update public.candidate_applications set state='closed',closure_reason='failed_stage',closed_at=now(),updated_at=now(),version=version+1 where application_id=new.application_id;
   else
    update public.candidate_applications a set state='active',closure_reason=null,closed_at=null,updated_at=now(),version=version+1 where a.application_id=new.application_id and a.closure_reason='failed_stage' and not exists(select 1 from public.recruitment_logs l where l.application_id=new.application_id and l.result=0 and l.superseded_at is null) and not exists(select 1 from public.candidate_applications other where other.candidate_id=a.candidate_id and other.group_id=a.group_id and other.state='active' and other.application_id<>a.application_id);
   end if;
  elsif tg_table_name='offers' then
    if new.accepted_date is not null and new.start_confirmation is distinct from 'did_not_start' then
      update public.candidate_applications set state='closed',closure_reason='accepted_offer',closed_at=coalesce(closed_at,now()),updated_at=now(),version=version+1 where application_id=new.application_id;
    elsif tg_op='UPDATE' and old.accepted_date is not null and old.start_confirmation is distinct from 'did_not_start' then
      update public.candidate_applications a set state=case when exists(select 1 from public.candidate_applications other where other.candidate_id=a.candidate_id and other.group_id=a.group_id and other.state='active' and other.application_id<>a.application_id) then 'closed' else 'active' end,
        closure_reason=case when exists(select 1 from public.candidate_applications other where other.candidate_id=a.candidate_id and other.group_id=a.group_id and other.state='active' and other.application_id<>a.application_id) then 'did_not_start' else null end,
        closed_at=case when exists(select 1 from public.candidate_applications other where other.candidate_id=a.candidate_id and other.group_id=a.group_id and other.state='active' and other.application_id<>a.application_id) then coalesce(a.closed_at,now()) else null end,
        updated_at=now(),version=version+1 where a.application_id=new.application_id and a.closure_reason='accepted_offer';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists sync_application_lifecycle on public.recruitment_logs;
create trigger sync_application_lifecycle after insert or update on public.recruitment_logs for each row execute function app_private.sync_application_lifecycle();
drop trigger if exists sync_application_lifecycle on public.offers;
create trigger sync_application_lifecycle after insert or update on public.offers for each row execute function app_private.sync_application_lifecycle();

create or replace function app_private.associate_candidate_with_offer_requisition() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    delete from public.candidate_requisitions cr where cr.application_id=old.application_id and cr.doc_id=old.doc_id and not exists(select 1 from public.offers o where o.application_id=old.application_id and o.doc_id=old.doc_id);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    insert into public.candidate_requisitions(application_id,candidate_id,doc_id,created_by) values(new.application_id,new.candidate_id,new.doc_id,auth.uid()) on conflict(application_id,doc_id) do nothing;
  end if;
  return null;
end $$;

alter table public.candidate_applications enable row level security;
alter table public.candidate_application_assignments enable row level security;
alter table public.candidate_notes enable row level security;
create policy application_read on public.candidate_applications for select to authenticated using(app_private.can_read_application(application_id));
create policy assignment_read on public.candidate_application_assignments for select to authenticated using(app_private.can_read_application(application_id));
create policy note_read on public.candidate_notes for select to authenticated using(app_private.can_read_profile_note(candidate_id));
revoke all on public.candidate_applications, public.candidate_application_assignments, public.candidate_notes from anon,authenticated;
grant select on public.candidate_applications, public.candidate_application_assignments, public.candidate_notes to authenticated;

create trigger audit_candidate_applications after insert or update or delete on public.candidate_applications for each row execute function app_private.audit_row_change();
create trigger audit_application_assignments after insert or update or delete on public.candidate_application_assignments for each row execute function app_private.audit_row_change();
create trigger audit_candidate_notes after insert or update or delete on public.candidate_notes for each row execute function app_private.audit_row_change();
create trigger set_candidate_applications_updated_at before update on public.candidate_applications for each row execute function app_private.set_updated_at();
