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
create or replace function app_private.is_profile_admin() returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.current_app_role() in ('system_admin','admin_recruiter')
$$;
create or replace function app_private.is_group_pic(p_group text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.is_recruitment_writer() and exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) join public.profiles p on p.id=auth.uid() where d.group_id=p_group and nullif(btrim(r.person_in_charge),'') is not null and lower(btrim(r.person_in_charge)) in (lower(btrim(p.nickname)),lower(btrim(p.full_name))))
$$;
create or replace function app_private.can_read_application(p_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select exists(select 1 from public.candidate_applications a where a.application_id=p_id and (app_private.is_global_recruitment_reader() or app_private.can_read_position_group(a.group_id)))
$$;
create or replace function app_private.can_manage_application(p_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.is_recruitment_writer() and exists(select 1 from public.candidate_applications a where a.application_id=p_id and (app_private.is_profile_admin() or app_private.is_group_pic(a.group_id)))
$$;
create or replace function app_private.can_read_candidate(p_candidate_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select app_private.is_recruitment_reader() and exists(select 1 from public.candidates c where c.candidate_id=p_candidate_id and (
 app_private.is_profile_admin() or c.created_by=auth.uid() or (exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id) and (
 app_private.is_global_recruitment_reader() or c.home_site=app_private.current_profile_site() or exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id and app_private.can_read_application(a.application_id))))))
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

drop policy if exists note_read on public.candidate_notes;
create policy note_read on public.candidate_notes for select to authenticated using(app_private.can_read_profile_note(candidate_id));
drop policy if exists change_logs_read on public.change_logs;
create policy change_logs_read on public.change_logs for select to authenticated using(app_private.can_read_candidate_audit(entity,entity_id,old_data,new_data));
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
  if exists(select 1 from public.candidate_applications where candidate_id=v_candidate and group_id=v_group and state='active') then raise exception 'APPLICATION_ALREADY_ACTIVE'; end if;
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
-- Authenticated, minimal projections. Definer RPCs explicitly filter every returned row.
create or replace function public.app_masked_candidate_pool_v1() returns jsonb language sql stable security definer set search_path=public,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('candidate_id',c.candidate_id,'position_interests',c.position_interests,'created_by',c.created_by,'creator_label',coalesce(p.nickname,p.full_name,'Unknown'),'created_at',c.created_at) order by c.created_at desc),'[]'::jsonb)
 from public.candidates c left join public.profiles p on p.id=c.created_by where auth.uid() is not null and app_private.is_recruitment_reader() and not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id) and not app_private.can_read_candidate(c.candidate_id)
$$;
create or replace function public.app_candidate_profile_capabilities_v1() returns jsonb language sql stable security definer set search_path=public,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('candidate_id',c.candidate_id,'creator_label',coalesce(p.nickname,p.full_name,'Unknown'),'can_edit',app_private.can_manage_candidate(c.candidate_id),'can_read_note',app_private.can_read_profile_note(c.candidate_id),'can_edit_note',app_private.can_edit_profile_note(c.candidate_id),'can_add_application',app_private.can_match_candidate(c.candidate_id))),'[]'::jsonb)
 from public.candidates c left join public.profiles p on p.id=c.created_by where auth.uid() is not null and app_private.can_read_candidate(c.candidate_id)
$$;
create or replace function public.app_application_destinations_v1() returns jsonb language sql stable security definer set search_path=public,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('group_id',g.group_id,'group_position',g.group_position,'sites',x.sites,'owners',x.owners,'doc_ids',x.doc_ids) order by g.group_position,g.group_id),'[]'::jsonb)
 from public.position_groups g join lateral (
 select array_agg(distinct r.site) sites,array_remove(array_agg(distinct r.person_in_charge),null) owners,array_agg(distinct r.doc_id) doc_ids from public.document_groups d join public.requisitions r using(doc_id) where d.group_id=g.group_id and r.status='ongoing' and r.head_count>(select count(*) from public.offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start')
 ) x on cardinality(x.doc_ids)>0 where auth.uid() is not null and app_private.is_recruitment_writer()
$$;
create or replace function public.app_candidate_duplicate_matches_v1(payload jsonb) returns jsonb language sql stable security definer set search_path=public,app_private as $$
 select coalesce(jsonb_agg(jsonb_build_object('candidate_id',c.candidate_id,'phone',nullif(regexp_replace(payload->>'phone_no','[^0-9]','','g'),'') is not null and regexp_replace(c.phone_no,'[^0-9]','','g')=regexp_replace(payload->>'phone_no','[^0-9]','','g'),'email',nullif(lower(btrim(payload->>'email')),'') is not null and lower(btrim(c.email))=lower(btrim(payload->>'email'))) order by c.candidate_id),'[]'::jsonb)
 from public.candidates c where auth.uid() is not null and app_private.is_recruitment_writer() and c.candidate_id is distinct from nullif(payload->>'candidate_id','') and app_private.can_read_candidate(c.candidate_id) and (
 (nullif(regexp_replace(payload->>'phone_no','[^0-9]','','g'),'') is not null and regexp_replace(c.phone_no,'[^0-9]','','g')=regexp_replace(payload->>'phone_no','[^0-9]','','g')) or (nullif(lower(btrim(payload->>'email')),'') is not null and lower(btrim(c.email))=lower(btrim(payload->>'email'))))
$$;

create or replace function public.app_upsert_candidate_note_v2(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_candidate text:=payload->>'candidate_id'; v_note public.candidate_notes%rowtype; v_body text:=nullif(btrim(payload->>'body'),'');
begin
 perform app_private.assert_recruitment_writer();
 if not app_private.can_edit_profile_note(v_candidate) then raise exception 'PROFILE_NOTE_NOT_AUTHORIZED'; end if;
 perform 1 from public.candidates where candidate_id=v_candidate for update;
 select * into v_note from public.candidate_notes where candidate_id=v_candidate for update;
 if v_note.note_id is not null then
  if v_note.note_id is distinct from nullif(payload->>'expected_note_id','')::uuid or v_note.version is distinct from nullif(payload->>'expected_version','')::integer then raise exception 'PROFILE_NOTE_STALE_WRITE: Reload the current note before saving.'; end if;
 elsif nullif(payload->>'expected_note_id','') is not null then raise exception 'PROFILE_NOTE_STALE_WRITE'; end if;
 perform set_config('app.action','candidate-note:save',true);
 if v_body is null then delete from public.candidate_notes where candidate_id=v_candidate;
 elsif v_note.note_id is null then insert into public.candidate_notes(candidate_id,body,created_by,updated_by) values(v_candidate,v_body,auth.uid(),auth.uid()) returning * into v_note;
 else update public.candidate_notes set body=v_body,updated_by=auth.uid(),updated_at=clock_timestamp(),version=version+1 where candidate_id=v_candidate returning * into v_note;
 end if;
 return jsonb_build_object('ok',true,'id',v_candidate,'note_id',case when v_body is not null then v_note.note_id end,'version',case when v_body is not null then v_note.version end);
end $$;
create or replace function public.app_add_candidate_note_v1(payload jsonb) returns jsonb language sql security definer set search_path=public,app_private as $$
 select public.app_upsert_candidate_note_v2(payload)
$$;

create or replace function public.app_upsert_candidate_profile_v2(payload jsonb) returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare v_id text:=nullif(payload->>'candidate_id',''); v_mode text:=coalesce(payload->>'mode','new'); v_previous public.candidates%rowtype;
 v_home text; v_creator uuid:=auth.uid(); v_owner uuid:=auth.uid(); v_phone text:=nullif(btrim(payload->>'phone_no'),''); v_email text:=nullif(btrim(payload->>'email'),''); v_matches jsonb; v_result jsonb; v_ref jsonb; v_note public.candidate_notes%rowtype;
begin
 perform app_private.assert_recruitment_writer();
 if v_mode not in ('new','change') then raise exception 'PROFILE_MODE_INVALID'; end if;
 if v_mode='change' then
  if not app_private.can_manage_candidate(v_id) then raise exception 'PROFILE_NOT_AUTHORIZED'; end if;
  select * into v_previous from public.candidates where candidate_id=v_id for update;
  v_home:=v_previous.home_site;v_creator:=v_previous.created_by;v_owner:=v_previous.responsible_recruiter_id;
 else
  v_id:=app_private.next_app_id('candidates','CAN');
  if app_private.current_app_role()='site_recruiter' then
   v_home:=nullif(btrim(app_private.current_profile_site()),'');
   if v_home is null then raise exception 'PROFILE_ACCOUNT_SITE_REQUIRED: Ask an administrator to configure your account site.'; end if;
  end if;
 end if;
 if nullif(btrim(payload->>'name'),'') is null then raise exception 'PROFILE_REQUIRED: Candidate name is required.'; end if;
 if (v_mode='change' and v_phone is null) or (v_phone is not null and v_phone !~ '^0[0-9]{9}$') then raise exception 'CANDIDATE_PHONE_INVALID'; end if;
 if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'CANDIDATE_EMAIL_INVALID'; end if;
 if nullif(payload->>'first_contact_date','')::date>(now() at time zone 'Asia/Bangkok')::date then raise exception 'PIPELINE_DATE_ORDER'; end if;
 v_matches:=public.app_candidate_duplicate_matches_v1(payload||jsonb_build_object('candidate_id',case when v_mode='change' then v_id end));
 if jsonb_array_length(v_matches)>0 and not(coalesce(payload->'duplicate_review'->'matches','null'::jsonb)=v_matches and coalesce(payload->'duplicate_review'->>'phone','')=coalesce(v_phone,'') and coalesce(payload->'duplicate_review'->>'email','')=coalesce(lower(v_email),'')) then
  raise exception 'PROFILE_DUPLICATE_REVIEW_REQUIRED' using detail=jsonb_build_object('code','PROFILE_DUPLICATE_REVIEW_REQUIRED','matches',v_matches)::text;
 end if;
 perform set_config('app.action','candidate-profile:'||v_mode,true);
 insert into public.candidates(candidate_id,created_by,name,nickname,phone_no,email,home_site,responsible_recruiter_id,position_interests,channel,ref_name,first_contact_date,candidate_folder_url)
 values(v_id,v_creator,btrim(payload->>'name'),nullif(btrim(payload->>'nickname'),''),v_phone,v_email,v_home,v_owner,nullif(btrim(payload->>'position_interests'),''),nullif(payload->>'channel',''),nullif(payload->>'ref_name',''),nullif(payload->>'first_contact_date','')::date,nullif(payload->>'candidate_folder_url',''))
 on conflict(candidate_id) do update set name=excluded.name,nickname=excluded.nickname,phone_no=excluded.phone_no,email=excluded.email,position_interests=excluded.position_interests,channel=excluded.channel,ref_name=excluded.ref_name,first_contact_date=excluded.first_contact_date,candidate_folder_url=excluded.candidate_folder_url;
 if payload ? 'note' then
  select * into v_note from public.candidate_notes where candidate_id=v_id;
  if nullif(btrim(payload->>'note'),'') is distinct from v_note.body then
   perform public.app_upsert_candidate_note_v2(jsonb_build_object('candidate_id',v_id,'body',payload->>'note','expected_note_id',payload->>'expected_note_id','expected_version',payload->>'expected_note_version'));
  end if;
 end if;
 for v_ref in select value from jsonb_array_elements(coalesce(payload->'references','[]'::jsonb)) loop
  perform public.app_upsert_candidate_reference_v1(v_ref||jsonb_build_object('candidate_id',v_id));
 end loop;
 v_result:=jsonb_build_object('ok',true,'id',v_id,'candidate_id',v_id);
 if v_mode='new' and nullif(payload->>'group_id','') is not null then
  v_result:=public.app_create_candidate_application_v1(jsonb_build_object('candidate_id',v_id,'group_id',payload->>'group_id','opened_date',payload->>'first_contact_date'));
 end if;
 return v_result;
end $$;
create or replace function public.app_upsert_candidate_profile_v1(payload jsonb) returns jsonb language sql security definer set search_path=public,app_private as $$
 select public.app_upsert_candidate_profile_v2(payload)
$$;

-- Shared server capability for service-backed meeting and letter handlers.
create or replace function public.app_can_manage_application_v1(p_application_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$
 select auth.uid() is not null and app_private.can_manage_application(p_application_id)
$$;

revoke all on function public.app_masked_candidate_pool_v1(),public.app_candidate_profile_capabilities_v1(),public.app_application_destinations_v1(),public.app_candidate_duplicate_matches_v1(jsonb),public.app_upsert_candidate_note_v2(jsonb),public.app_upsert_candidate_profile_v2(jsonb),public.app_can_manage_application_v1(uuid) from public,anon,authenticated;
grant execute on function public.app_masked_candidate_pool_v1(),public.app_candidate_profile_capabilities_v1(),public.app_application_destinations_v1(),public.app_candidate_duplicate_matches_v1(jsonb),public.app_upsert_candidate_note_v2(jsonb),public.app_upsert_candidate_profile_v2(jsonb),public.app_can_manage_application_v1(uuid) to authenticated;
revoke all on all functions in schema app_private from public,anon;
grant execute on all functions in schema app_private to authenticated;
