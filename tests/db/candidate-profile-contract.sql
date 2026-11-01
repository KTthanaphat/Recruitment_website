-- Synthetic contract fixtures only; the entire test is rolled back on the remote project.
begin;
create function pg_temp.check_profile(p boolean,m text) returns void language plpgsql as $$ begin if p is distinct from true then raise exception 'PROFILE assertion: %',m; end if; end $$;
create function pg_temp.profile_error(q text,m text) returns void language plpgsql as $$ declare e text; begin begin execute q; exception when others then e:=sqlerrm; end; if e is null or position(m in e)=0 then raise exception 'Expected %, got %',m,e; end if; end $$;
insert into auth.users(id,email,raw_user_meta_data) values
 ('51111111-1111-1111-1111-111111111111','profile-creator@example.invalid','{"nickname":"PROFILE Creator"}'),
 ('52222222-2222-2222-2222-222222222222','profile-pic@example.invalid','{"nickname":"PROFILE PIC"}'),
 ('53333333-3333-3333-3333-333333333333','profile-colleague@example.invalid','{"nickname":"PROFILE Other"}'),
 ('54444444-4444-4444-4444-444444444444','profile-viewer@example.invalid','{"nickname":"PROFILE Viewer"}'),
 ('55555555-5555-5555-5555-555555555555','profile-admin@example.invalid','{"nickname":"PROFILE Admin"}'),
 ('56666666-6666-6666-6666-666666666666','profile-next@example.invalid','{"nickname":"PROFILE Next"}');
update public.profiles set role=case when id='54444444-4444-4444-4444-444444444444' then 'viewer' when id='55555555-5555-5555-5555-555555555555' then 'system_admin' else 'site_recruiter' end,
 site=case when id='52222222-2222-2222-2222-222222222222' then 'PROFILE-B' when id='56666666-6666-6666-6666-666666666666' then 'PROFILE-C' when id='55555555-5555-5555-5555-555555555555' then null else 'PROFILE-A' end
 where id::text like '5%-%' and email like 'profile-%@example.invalid';
insert into public.requisitions(doc_id,site,position,department,head_count,status,person_in_charge) values
 ('PROFILE-QA-R1','PROFILE-B','QA role','QA',5,'ongoing','PROFILE PIC'),('PROFILE-QA-R2','PROFILE-C','QA next','QA',5,'ongoing','PROFILE Next');
insert into public.position_groups(group_id,group_position) values('PROFILE-QA-G1','QA role'),('PROFILE-QA-G2','QA next');
insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('PROFILE-QA-D1','PROFILE-QA-R1','PROFILE-QA-G1','QA role'),('PROFILE-QA-D2','PROFILE-QA-R2','PROFILE-QA-G2','QA next');
select set_config('request.jwt.claim.sub','51111111-1111-1111-1111-111111111111',true);
select set_config('app.application_id','',true);
create temp table profile_result as select public.app_upsert_candidate_profile_v2('{"name":"PROFILE PRIVATE NAME","phone_no":"0898765432","email":"profile-private@example.invalid","home_site":"WRONG","responsible_recruiter_id":"52222222-2222-2222-2222-222222222222","position_interests":"Quality","note":"PROFILE PRIVATE NOTE"}') as response;
create temp table profile_ids as select response->>'candidate_id' candidate_id from profile_result;
grant select on profile_ids to authenticated;
select pg_temp.check_profile((select created_by='51111111-1111-1111-1111-111111111111' and responsible_recruiter_id=created_by and home_site='PROFILE-A' from public.candidates where candidate_id=(select candidate_id from profile_ids)),'server owns creator/recruiter/site');
select pg_temp.check_profile(not exists(select 1 from public.recruitment_logs where candidate_id=(select candidate_id from profile_ids)),'pool has no activity');
select public.app_upsert_candidate_reference_v1(jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'reference_name','PROFILE PRIVATE REFERENCE','relationship','Manager','channel_type','phone','channel_value','0811111111'));
select set_config('request.jwt.claim.sub','53333333-3333-3333-3333-333333333333',true);
set local role authenticated;
select pg_temp.check_profile(not exists(select 1 from public.candidates where candidate_id=(select candidate_id from profile_ids)),'same-site noncreator cannot read unmatched profile');
select pg_temp.check_profile(not exists(select 1 from public.candidate_notes where candidate_id=(select candidate_id from profile_ids)),'same-site note denied');
select pg_temp.check_profile(not exists(select 1 from public.candidate_references where candidate_id=(select candidate_id from profile_ids)),'unmatched reference denied');
select pg_temp.check_profile(public.app_masked_candidate_pool_v1()::text like '%Quality%' and public.app_masked_candidate_pool_v1()::text not like '%PROFILE PRIVATE%','masked projection has no secrets');
select pg_temp.check_profile(public.app_candidate_duplicate_matches_v1('{"phone_no":"0898765432"}')='[]'::jsonb,'hidden contact excluded from duplicates');
select pg_temp.profile_error(format('select public.app_create_candidate_application_v1(%L::jsonb)',jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'group_id','PROFILE-QA-G1')),'APPLICATION_NOT_AUTHORIZED');
reset role;
select set_config('request.jwt.claim.sub','54444444-4444-4444-4444-444444444444',true);
set local role authenticated;
select pg_temp.check_profile(not exists(select 1 from public.change_logs where entity='candidates' and entity_id=(select candidate_id from profile_ids)),'viewer audit hides unmatched identity');
select pg_temp.check_profile(not exists(select 1 from public.candidates where candidate_id=(select candidate_id from profile_ids)),'viewer cannot read unmatched profile');
select pg_temp.profile_error('select public.app_upsert_candidate_profile_v2(''{"name":"No"}''::jsonb)','Recruitment write role');
reset role;
select set_config('request.jwt.claim.sub','51111111-1111-1111-1111-111111111111',true);
create temp table profile_app as select (public.app_create_candidate_application_v1(jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'group_id','PROFILE-QA-G1'))->>'application_id')::uuid application_id;
select pg_temp.check_profile(not app_private.can_read_application((select application_id from profile_app)),'creator gains no foreign journey read access');
select pg_temp.profile_error(format('select public.app_start_pipeline_stage_v2(%L::jsonb)',jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'application_id',(select application_id from profile_app))),'APPLICATION_NOT_AUTHORIZED');
select pg_temp.profile_error('select public.app_upsert_candidate_profile_v2(''{"name":"Duplicate","phone_no":"0898765432"}''::jsonb)','PROFILE_DUPLICATE_REVIEW_REQUIRED');
select set_config('request.jwt.claim.sub','52222222-2222-2222-2222-222222222222',true);
select pg_temp.check_profile(app_private.can_manage_application((select application_id from profile_app)),'destination PIC manages journey');
select pg_temp.check_profile(app_private.can_read_profile_note((select candidate_id from profile_ids)),'PIC reads note');
select pg_temp.profile_error(format('select public.app_upsert_candidate_note_v2(%L::jsonb)',jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'body','Injected')),'PROFILE_NOTE_NOT_AUTHORIZED');
select public.app_upsert_candidate_profile_v2(jsonb_build_object('mode','change','candidate_id',(select candidate_id from profile_ids),'name','PROFILE PRIVATE NAME UPDATED','phone_no','0898765432','home_site','WRONG','responsible_recruiter_id','52222222-2222-2222-2222-222222222222'));
select pg_temp.check_profile((select created_by='51111111-1111-1111-1111-111111111111' and home_site='PROFILE-A' and responsible_recruiter_id=created_by from public.candidates where candidate_id=(select candidate_id from profile_ids)),'PIC edit preserves owner/site');
select pg_temp.profile_error(format('select public.app_upsert_candidate_profile_v2(%L::jsonb)',jsonb_build_object('mode','change','candidate_id',(select candidate_id from profile_ids),'name','Inject','phone_no','0898765432','note','Injected')),'PROFILE_NOTE_NOT_AUTHORIZED');
select set_config('request.jwt.claim.sub','53333333-3333-3333-3333-333333333333',true);
select pg_temp.profile_error(format('select public.app_create_candidate_application_v1(%L::jsonb)',jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'group_id','PROFILE-QA-G2')),'APPLICATION_NOT_AUTHORIZED');
-- A same-site group reader is still not a journey writer.
update public.profiles set site='PROFILE-B' where id='53333333-3333-3333-3333-333333333333';
select pg_temp.check_profile(app_private.can_read_application((select application_id from profile_app)) and not app_private.can_manage_application((select application_id from profile_app)),'site reader is not PIC');
select pg_temp.profile_error(format('select public.app_update_pipeline_pending_v2(%L::jsonb)',jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'application_id',(select application_id from profile_app))),'APPLICATION_NOT_AUTHORIZED');
select pg_temp.check_profile(not app_private.can_manage_candidate((select candidate_id from profile_ids)) and not app_private.can_read_profile_note((select candidate_id from profile_ids)),'reader has no profile/note mutation');
-- Every linked requisition PIC qualifies.
insert into public.requisitions(doc_id,site,position,department,head_count,status,person_in_charge) values('PROFILE-QA-R3','PROFILE-B','QA other','QA',2,'ongoing','PROFILE Other');
insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('PROFILE-QA-D3','PROFILE-QA-R3','PROFILE-QA-G1','QA role');
select pg_temp.check_profile(app_private.can_manage_application((select application_id from profile_app)),'second linked PIC qualifies');
select public.app_transfer_candidate_application_v1(jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'application_id',(select application_id from profile_app),'group_id','PROFILE-QA-G2','expected_version',1,'reason','QA cross-site transfer'));
select pg_temp.check_profile(not app_private.can_manage_application((select application_id from profile_app)) and not app_private.can_read_profile_note((select candidate_id from profile_ids)),'former PIC loses special access');
select set_config('request.jwt.claim.sub','56666666-6666-6666-6666-666666666666',true);
select public.app_create_candidate_application_v1(jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'group_id','PROFILE-QA-G1'));
select pg_temp.check_profile((select count(*)=2 from public.candidate_applications where candidate_id=(select candidate_id from profile_ids)),'PIC starts independent cross-site journey');
update public.candidate_applications set state='closed',closed_at=now(),closure_reason='QA closure' where candidate_id=(select candidate_id from profile_ids);
select set_config('request.jwt.claim.sub','54444444-4444-4444-4444-444444444444',true);
select pg_temp.check_profile(not exists(select 1 from jsonb_array_elements(public.app_masked_candidate_pool_v1()) j where j->>'candidate_id'=(select candidate_id from profile_ids)),'closed history never reappears as globally unmatched');
set local role authenticated;
select pg_temp.check_profile(not exists(select 1 from public.candidate_notes where candidate_id=(select candidate_id from profile_ids)),'viewer note remains private after match');
select pg_temp.check_profile(not exists(select 1 from public.change_logs where entity='candidate_notes' and coalesce(new_data,old_data)->>'candidate_id'=(select candidate_id from profile_ids)),'viewer note audit denied');
reset role;
select set_config('request.jwt.claim.sub','51111111-1111-1111-1111-111111111111',true);
create temp table original_note as select * from public.candidate_notes where candidate_id=(select candidate_id from profile_ids);
select public.app_upsert_candidate_note_v2(jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'body','PROFILE PRIVATE REVISION','expected_note_id',(select note_id from original_note),'expected_version',1));
select pg_temp.profile_error(format('select public.app_upsert_candidate_note_v2(%L::jsonb)',jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'body','STALE','expected_note_id',(select note_id from original_note),'expected_version',1)),'PROFILE_NOTE_STALE_WRITE');
select pg_temp.check_profile((select count(*)=1 from public.candidate_notes where candidate_id=(select candidate_id from profile_ids)),'one current note');
select pg_temp.check_profile(exists(select 1 from public.change_logs where entity='candidate_notes' and old_data->>'body'='PROFILE PRIVATE NOTE' and new_data->>'body'='PROFILE PRIVATE REVISION'),'revision audited');
select public.app_upsert_candidate_note_v2(jsonb_build_object('candidate_id',(select candidate_id from profile_ids),'body','','expected_note_id',(select note_id from original_note),'expected_version',2));
select pg_temp.check_profile(not exists(select 1 from public.candidate_notes where candidate_id=(select candidate_id from profile_ids)),'note clearing');
select pg_temp.profile_error('select public.app_upsert_candidate_profile_v2(''{"name":"PROFILE stale duplicate review","phone_no":"0898765432","duplicate_review":{"phone":"0898765432","email":"","matches":[]}}''::jsonb)','PROFILE_DUPLICATE_REVIEW_REQUIRED');
create temp table acknowledged_duplicate as select public.app_upsert_candidate_profile_v2(jsonb_build_object('name','PROFILE acknowledged duplicate','phone_no','0898765432','duplicate_review',jsonb_build_object('phone','0898765432','email','','matches',public.app_candidate_duplicate_matches_v1('{"phone_no":"0898765432"}')))) response;
select pg_temp.check_profile(not exists(select 1 from public.recruitment_logs where candidate_id=(select response->>'candidate_id' from acknowledged_duplicate)),'acknowledged separate profile creates no journey');
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',true);
select pg_temp.check_profile(app_private.can_read_candidate_audit('candidates','PROFILE deleted fixture','{}'::jsonb,null),'administrators retain deleted-record audit oversight');
create temp table admin_profile as select public.app_upsert_candidate_profile_v1('{"name":"PROFILE ADMIN WITHOUT SITE"}') response;
select pg_temp.check_profile((select home_site is null and created_by='55555555-5555-5555-5555-555555555555' from public.candidates where candidate_id=(select response->>'candidate_id' from admin_profile)),'admin needs no home site');
-- A linked group PIC can manage an offer against another PIC's linked requisition.
create temp table offer_fixture as select public.app_upsert_candidate_profile_v2('{"name":"PROFILE QA GROUP OFFER","group_id":"PROFILE-QA-G1"}') response;
select set_config('app.application_id',(select response->>'application_id' from offer_fixture),true);
update public.recruitment_logs set result=1,outcome_date=current_date,outcome_recorded_at=now() where application_id=(select (response->>'application_id')::uuid from offer_fixture);
insert into public.recruitment_logs(candidate_id,application_id,log_date,recruitment_process,round,result,outcome_date,outcome_recorded_at) select response->>'candidate_id',(response->>'application_id')::uuid,current_date,'Offer',1,1,current_date,now() from offer_fixture;
update public.profiles set site='PROFILE-A' where id='53333333-3333-3333-3333-333333333333';
select set_config('request.jwt.claim.sub','53333333-3333-3333-3333-333333333333',true);
select pg_temp.check_profile(not app_private.can_manage_requisition('PROFILE-QA-R1'),'group PIC does not gain requisition writes');
select pg_temp.check_profile(app_private.can_read_requisition('PROFILE-QA-R1'),'all linked offer context readable');
select public.app_upsert_offer(jsonb_build_object('candidate_id',(select response->>'candidate_id' from offer_fixture),'application_id',(select response->>'application_id' from offer_fixture),'doc_id','PROFILE-QA-R1','accepted_date',current_date,'first_working_date',current_date));
grant select on offer_fixture to authenticated;
set local role authenticated;
select pg_temp.check_profile(exists(select 1 from public.offers where application_id=(select (response->>'application_id')::uuid from offer_fixture)),'group PIC reads other linked requisition offer');
reset role;
select public.app_confirm_offer_start_v1(jsonb_build_object('offer_id',(select offer_id from public.offers where application_id=(select (response->>'application_id')::uuid from offer_fixture)),'expected_updated_at',(select updated_at from public.offers where application_id=(select (response->>'application_id')::uuid from offer_fixture)),'start_confirmation','started'));
update public.profiles set site=null where id='51111111-1111-1111-1111-111111111111';
select set_config('request.jwt.claim.sub','51111111-1111-1111-1111-111111111111',true);
select pg_temp.profile_error('select public.app_upsert_candidate_profile_v2(''{"name":"No site"}''::jsonb)','PROFILE_ACCOUNT_SITE_REQUIRED');
rollback;
