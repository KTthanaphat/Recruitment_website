-- Rollback-only synthetic fixtures. No production identities or outcomes are changed.
begin;
create function pg_temp.check_claim(p boolean,m text) returns void language plpgsql as $$ begin if p is distinct from true then raise exception 'CLAIM assertion: %',m; end if; end $$;
create function pg_temp.claim_error(q text,m text) returns void language plpgsql as $$ declare e text; begin begin execute q; exception when others then e:=sqlerrm; end; if e is null or position(m in e)=0 then raise exception 'Expected %, got %',m,e; end if; end $$;
insert into auth.users(id,email,raw_user_meta_data) values('71111111-1111-1111-1111-111111111111','group-claim-qa@example.invalid','{"nickname":"Claim QA"}');
update public.profiles set role='system_admin' where id='71111111-1111-1111-1111-111111111111';
insert into public.requisitions(doc_id,site,position,department,head_count,status) values
 ('CLAIM-QA-R1','QA','One','QA',5,'ongoing'),('CLAIM-QA-R2','QA','Two','QA',5,'ongoing'),('CLAIM-QA-R3','QA','Three','QA',5,'ongoing');
insert into public.position_groups(group_id,group_position) values('CLAIM-QA-G1','One'),('CLAIM-QA-G2','Two'),('CLAIM-QA-G3','Three');
insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values
 ('CLAIM-QA-D1','CLAIM-QA-R1','CLAIM-QA-G1','One'),('CLAIM-QA-D2','CLAIM-QA-R2','CLAIM-QA-G2','Two'),('CLAIM-QA-D3','CLAIM-QA-R3','CLAIM-QA-G3','Three');
select set_config('request.jwt.claim.sub','71111111-1111-1111-1111-111111111111',true);
select set_config('app.application_id','',true);
create temp table claim_person as select public.app_upsert_candidate_profile_v2('{"name":"Claim QA","phone_no":"0891112233"}')->>'candidate_id' candidate_id;
create temp table claim_first as select public.app_create_candidate_application_v1(jsonb_build_object('candidate_id',candidate_id,'group_id','CLAIM-QA-G1'))->>'application_id' application_id from claim_person;
select pg_temp.claim_error(format('select public.app_create_candidate_application_v1(%L::jsonb)',jsonb_build_object('candidate_id',(select candidate_id from claim_person),'group_id','CLAIM-QA-G1')),'APPLICATION_GROUP_ALREADY_USED');
update public.candidate_applications set state='closed',closed_at=now(),closure_reason='failed_stage' where application_id=(select application_id::uuid from claim_first);
select pg_temp.claim_error(format('select public.app_create_candidate_application_v1(%L::jsonb)',jsonb_build_object('candidate_id',(select candidate_id from claim_person),'group_id','CLAIM-QA-G1')),'APPLICATION_GROUP_ALREADY_USED');
update public.candidate_applications set state='active',closed_at=null,closure_reason=null where application_id=(select application_id::uuid from claim_first);
select public.app_transfer_candidate_application_v1(jsonb_build_object('application_id',application_id,'group_id','CLAIM-QA-G2','expected_version',1,'reason','QA outbound')) from claim_first;
select public.app_transfer_candidate_application_v1(jsonb_build_object('application_id',application_id,'group_id','CLAIM-QA-G1','expected_version',2,'reason','QA return')) from claim_first;
select public.app_transfer_candidate_application_v1(jsonb_build_object('application_id',application_id,'group_id','CLAIM-QA-G2','expected_version',3,'reason','QA repeated outbound')) from claim_first;
select pg_temp.check_claim((select count(*)=4 from public.candidate_application_assignments where application_id=(select application_id::uuid from claim_first)),'same journey returns without losing assignment history');
create temp table claim_second as select public.app_create_candidate_application_v1(jsonb_build_object('candidate_id',candidate_id,'group_id','CLAIM-QA-G3'))->>'application_id' application_id from claim_person;
select pg_temp.claim_error(format('select public.app_transfer_candidate_application_v1(%L::jsonb)',jsonb_build_object('application_id',(select application_id from claim_second),'group_id','CLAIM-QA-G1','expected_version',1,'reason','QA historical conflict')),'APPLICATION_GROUP_ALREADY_USED');
select pg_temp.claim_error(format('insert into public.candidate_applications(candidate_id,group_id) values(%L,%L)',(select candidate_id from claim_person),'CLAIM-QA-G1'),'APPLICATION_GROUP_ALREADY_USED');
select pg_temp.claim_error(format('insert into public.candidate_application_assignments(application_id,group_id,ended_at) values(%L,%L,now())',(select application_id from claim_second),'CLAIM-QA-G1'),'APPLICATION_GROUP_ALREADY_USED');
select pg_temp.check_claim((select count(*)=3 from app_private.candidate_group_journey_claims where candidate_id=(select candidate_id from claim_person)),'one claim per visited group');
select pg_temp.check_claim(not has_table_privilege('authenticated','app_private.candidate_group_journey_claims','SELECT'),'claims are not discoverable');
select pg_temp.check_claim(not has_function_privilege('authenticated','app_private.claim_candidate_application_group()','EXECUTE'),'trigger function cannot be called by clients');
rollback;
