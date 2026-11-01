create or replace function app_private.can_manage_application(p_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$
  select exists(select 1 from public.candidate_applications a where a.application_id=p_id and app_private.is_recruitment_writer() and exists(select 1 from public.document_groups dg where dg.group_id=a.group_id and app_private.can_manage_requisition(dg.doc_id)))
$$;
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
  if v_source_site is distinct from v_destination_site and app_private.current_app_role() not in ('system_admin','admin_recruiter') then raise exception 'APPLICATION_CROSS_SITE_ADMIN_REQUIRED'; end if;
  if exists(select 1 from public.candidate_applications where candidate_id=v_row.candidate_id and group_id=v_group and state='active') then raise exception 'APPLICATION_ALREADY_ACTIVE'; end if;
  if exists(select 1 from public.offers where candidate_id=v_row.candidate_id and accepted_date is not null and start_confirmation is distinct from 'did_not_start') then raise exception 'APPLICATION_ACCEPTED_OFFER_BLOCKS_TRANSFER'; end if;
  if exists(select 1 from public.interview_meetings m join public.recruitment_logs l on l.stage_instance_id=m.stage_instance_id where l.application_id=v_id and m.status in ('creating','scheduled','rescheduling','cancelling')) then raise exception 'APPLICATION_MEETING_REQUIRES_RESOLUTION: Resolve the scheduled Teams meeting before reassignment.'; end if;
  perform set_config('app.action','application:reassign',true);
  update public.candidate_application_assignments set ended_at=now() where application_id=v_id and ended_at is null;
  insert into public.candidate_application_assignments(application_id,group_id,from_group_id,actor_id,reason) values(v_id,v_group,v_row.group_id,auth.uid(),v_reason);
  update public.candidate_applications set group_id=v_group,version=version+1,updated_at=now() where application_id=v_id;
  update public.candidates set group_id=case when (select count(*) from public.candidate_applications where candidate_id=v_row.candidate_id)=1 then v_group else null end,doc_group_id=null,updated_at=now() where candidate_id=v_row.candidate_id;
  return jsonb_build_object('ok',true,'id',v_row.candidate_id,'application_id',v_id,'version',v_row.version+1);
end $$;
