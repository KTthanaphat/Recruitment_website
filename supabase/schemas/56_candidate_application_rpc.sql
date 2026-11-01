create or replace function app_private.assert_application_destination(p_candidate text,p_group text) returns void language plpgsql security definer set search_path=public,app_private as $$
begin
 if not app_private.has_open_group_requisition(p_group) then raise exception 'APPLICATION_GROUP_NOT_AVAILABLE: Select a group with remaining open demand.'; end if;
end $$;

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

create or replace function public.app_upsert_candidate_profile_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_id text:=nullif(payload->>'candidate_id',''); v_mode text:=coalesce(payload->>'mode','new'); v_home text:=nullif(btrim(payload->>'home_site'),''); v_previous public.candidates%rowtype;
  v_owner uuid:=coalesce(nullif(payload->>'responsible_recruiter_id','')::uuid,auth.uid()); v_phone text:=nullif(btrim(payload->>'phone_no'),''); v_email text:=nullif(btrim(payload->>'email'),''); v_result jsonb; v_ref jsonb;
begin
  perform app_private.assert_recruitment_writer();
  if v_mode not in ('new','change') then raise exception 'PROFILE_MODE_INVALID'; end if;
  if v_mode='change' then
    if not app_private.can_manage_candidate(v_id) then raise exception 'PROFILE_NOT_AUTHORIZED'; end if;
    select * into v_previous from public.candidates where candidate_id=v_id for update;
    if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
    v_owner:=coalesce(nullif(payload->>'responsible_recruiter_id','')::uuid,v_previous.responsible_recruiter_id);
    if app_private.current_app_role()='site_recruiter' and (v_home is distinct from v_previous.home_site or (v_owner is distinct from v_previous.responsible_recruiter_id and not (v_previous.responsible_recruiter_id is null and v_owner=auth.uid()))) then raise exception 'PROFILE_OWNERSHIP_ADMIN_REQUIRED'; end if;
  else
    v_id:=app_private.next_app_id('candidates','CAN');
    if app_private.current_app_role()='site_recruiter' then v_home:=app_private.current_profile_site(); v_owner:=auth.uid(); end if;
  end if;
  if v_home is null or nullif(btrim(payload->>'name'),'') is null then raise exception 'PROFILE_REQUIRED: Name and home site are required.'; end if;
  if (v_mode='change' and v_phone is null) or (v_phone is not null and v_phone !~ '^0[0-9]{9}$') then raise exception 'CANDIDATE_PHONE_INVALID'; end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'CANDIDATE_EMAIL_INVALID'; end if;
  if nullif(payload->>'first_contact_date','')::date>(now() at time zone 'Asia/Bangkok')::date then raise exception 'PIPELINE_DATE_ORDER'; end if;
  if coalesce((payload->>'duplicate_acknowledged')::boolean,false)=false and exists(select 1 from public.candidates c where c.candidate_id<>v_id and app_private.can_read_candidate(c.candidate_id) and ((v_phone is not null and regexp_replace(c.phone_no,'[^0-9]','','g')=v_phone) or (v_email is not null and lower(btrim(c.email))=lower(v_email)))) then raise exception 'PROFILE_DUPLICATE_ACKNOWLEDGEMENT_REQUIRED: Review matching profiles before saving.'; end if;
  perform set_config('app.action','candidate-profile:'||v_mode,true);
  insert into public.candidates(candidate_id,name,nickname,phone_no,email,home_site,responsible_recruiter_id,position_interests,channel,ref_name,first_contact_date,candidate_folder_url)
    values(v_id,btrim(payload->>'name'),nullif(btrim(payload->>'nickname'),''),v_phone,v_email,v_home,v_owner,nullif(btrim(payload->>'position_interests'),''),nullif(payload->>'channel',''),nullif(payload->>'ref_name',''),nullif(payload->>'first_contact_date','')::date,nullif(payload->>'candidate_folder_url',''))
    on conflict(candidate_id) do update set name=excluded.name,nickname=excluded.nickname,phone_no=excluded.phone_no,email=excluded.email,home_site=excluded.home_site,responsible_recruiter_id=excluded.responsible_recruiter_id,position_interests=excluded.position_interests,channel=excluded.channel,ref_name=excluded.ref_name,first_contact_date=excluded.first_contact_date,candidate_folder_url=excluded.candidate_folder_url;
  if nullif(btrim(payload->>'note'),'') is not null then insert into public.candidate_notes(candidate_id,body,created_by) values(v_id,btrim(payload->>'note'),auth.uid()); end if;
  for v_ref in select value from jsonb_array_elements(coalesce(payload->'references','[]'::jsonb)) loop
    perform public.app_upsert_candidate_reference_v1(v_ref||jsonb_build_object('candidate_id',v_id));
  end loop;
  v_result:=jsonb_build_object('ok',true,'id',v_id,'candidate_id',v_id);
  if v_mode='new' and nullif(payload->>'group_id','') is not null then
    v_result:=public.app_create_candidate_application_v1(jsonb_build_object('candidate_id',v_id,'group_id',payload->>'group_id','opened_date',payload->>'first_contact_date'));
  end if;
  return v_result;
end $$;

create or replace function public.app_upsert_candidate(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_home text; v_candidate public.candidates%rowtype;
begin
  if nullif(payload->>'group_id','') is null and nullif(payload->>'doc_group_id','') is not null then
    payload:=payload||jsonb_build_object('group_id',(select group_id from public.document_groups where doc_group_id=payload->>'doc_group_id'));
  end if;
  if payload->>'mode'='change' then
    select * into v_candidate from public.candidates where candidate_id=payload->>'candidate_id';
    v_home:=v_candidate.home_site;
    if nullif(payload->>'group_id','') is not null and payload->>'group_id' is distinct from v_candidate.group_id then raise exception 'APPLICATION_TRANSFER_REQUIRED: Reassign the application instead of editing profile group.'; end if;
  else
    select min(r.site) into v_home from public.document_groups dg join public.requisitions r on r.doc_id=dg.doc_id where dg.group_id=payload->>'group_id';
  end if;
  return public.app_upsert_candidate_profile_v1(jsonb_build_object('home_site',v_home,'responsible_recruiter_id',coalesce(v_candidate.responsible_recruiter_id,auth.uid()))||payload);
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

create or replace function public.app_add_candidate_note_v1(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_id uuid;
begin
  perform app_private.assert_recruitment_writer();
  if not app_private.can_manage_candidate(payload->>'candidate_id') then raise exception 'PROFILE_NOT_AUTHORIZED'; end if;
  insert into public.candidate_notes(candidate_id,body,created_by) values(payload->>'candidate_id',btrim(payload->>'body'),auth.uid()) returning note_id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

revoke all on function public.app_upsert_candidate_profile_v1(jsonb),public.app_create_candidate_application_v1(jsonb),public.app_transfer_candidate_application_v1(jsonb),public.app_add_candidate_note_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_upsert_candidate_profile_v1(jsonb),public.app_create_candidate_application_v1(jsonb),public.app_transfer_candidate_application_v1(jsonb),public.app_add_candidate_note_v1(jsonb) to authenticated;
revoke all on all functions in schema app_private from public,anon;
grant execute on all functions in schema app_private to authenticated;
