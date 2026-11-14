const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
module.exports=async(db,root)=>{
 const admin='11111111-1111-1111-1111-111111111111';
 const queries=["public.app_home_core_summary_v1('{}')","public.app_home_welcome_summary_v1()","public.app_home_banner_summary_v1('{}')","public.app_dashboard_company_report()","public.app_recruitment_sourcing_summary_v1(current_date,null,'{}')","public.app_dashboard_pipeline_summary_v1('2026-01-01','2026-12-31','custom','{}','all')","public.app_dashboard_rejection_summary_v1('2026-01-01','2026-12-31','{}','{}')"];
 queries.push("public.app_dashboard_performance_summary_v1('2026-01-01','2026-12-31','2025-01-01','2025-12-31','custom','{}')","public.app_dashboard_risk_summary_v1('2026-01-01','2026-12-31','2025-01-01','2025-12-31','{}')","public.app_dashboard_bottleneck_summary_v1('2026-01-01','2026-12-31','2025-01-01','2025-12-31','{}')","public.app_dashboard_active_requisitions_page_v1('2026-01-01','2026-12-31','custom','status','{}')","public.app_dashboard_filter_options_v1('{}')","public.app_recruitment_calendar_v1(current_date,current_date+1,'{}')","public.app_home_work_queue_v1('{}')","public.app_home_quality_page_v1('{}')");
 const snapshot=async()=>{const rows=[];for(const query of queries)rows.push((await db.query('select '+query+' result')).rows[0].result);return rows;};
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${admin}',false);set role authenticated;`);
 await db.exec('reset role'); const categorySource=fs.readFileSync(path.join(root,'supabase/schemas/60_recruitment_list.sql'),'utf8'); await db.exec(categorySource.slice(categorySource.indexOf('create or replace function app_private.recruitment_category_values_v1'),categorySource.indexOf('$category_values$;')+'$category_values$;'.length));
 await db.exec('set role authenticated'); const before=await snapshot();await db.exec('reset role');
 await db.exec(`create table if not exists public.recruitment_notifications(notification_id uuid primary key default gen_random_uuid(),recipient_id uuid,doc_id text,application_id uuid);alter table public.recruitment_notifications enable row level security;grant select on public.recruitment_notifications to authenticated;create policy test_notification_own on public.recruitment_notifications for select to authenticated using(recipient_id=auth.uid());`);
 await db.exec('create role service_role');
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261113151831_confidential_requisitions.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_confidential_report_summaries.sql'))),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_admin_unlinked_groups.sql'))),'utf8'));
 await db.exec('set role authenticated');assert.deepEqual(await snapshot(),before,'ordinary-only reports remain identical after migration');await db.exec('reset role');
 await db.exec(`insert into public.requisitions(doc_id,position,site,department,head_count,is_secret) values('SECRET-R','Secret role','TEST','Test',1,true),('SECRET-R2','Other secret','TEST','Test',1,true);
 insert into public.position_groups(group_id,group_position,is_secret) values('SECRET-G','Secret group',true),('ADOPT-G','Adopted group',false),('SECRET-UNLINKED','Unlinked secret',true);
 insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('SECRET-L','SECRET-R','SECRET-G','Secret group'),('SECRET-L2','SECRET-R2','SECRET-G','Secret group');
 insert into public.candidates(candidate_id,name,phone_no,home_site,created_by) values('SECRET-C','Secret candidate','0899999999','TEST','${admin}');
 insert into public.candidate_applications(application_id,candidate_id,group_id) values(md5('secret-app')::uuid,'SECRET-C','SECRET-G'),(md5('shared-secret-app')::uuid,'TEST-C1','SECRET-G');
 alter table public.recruitment_logs disable trigger user;
 insert into public.candidate_application_assignments(assignment_id,application_id,group_id) values(md5('secret-assignment')::uuid,md5('secret-app')::uuid,'SECRET-G');
 insert into public.recruitment_logs(application_id,entry_assignment_id,candidate_id,recruitment_process,round,log_date) values(md5('secret-app')::uuid,md5('secret-assignment')::uuid,'SECRET-C','Phone Screen',1,current_date);
 set constraints all immediate;alter table public.recruitment_logs enable trigger user;
 alter table public.offers disable trigger user;
 insert into public.offers(candidate_id,application_id,doc_id,accepted_date,first_working_date) values('SECRET-C',md5('secret-app')::uuid,'SECRET-R',current_date,current_date);
 set constraints all immediate;alter table public.offers enable trigger user;
 insert into public.recruitment_notifications(recipient_id,doc_id,application_id) values('${admin}','SECRET-R',md5('secret-app')::uuid),('22222222-2222-2222-2222-222222222222','SECRET-R',md5('secret-app')::uuid);
 set role authenticated;`);
 await db.query("select public.app_upsert_requisition('{\"mode\":\"new\",\"doc_id\":\"RPC-SECRET\",\"site\":\"TEST\",\"position\":\"RPC secret\",\"department\":\"Test\",\"is_secret\":true}')");
 assert.equal((await db.query("select public.app_secret_link_review_v1('{\"doc_ids\":[\"RPC-SECRET\"]}') p")).rows[0].p.requires_confirmation,true);
 const createdGroup=(await db.query("select public.app_create_and_match_sourcing_group_v2('{\"group_position\":\"RPC secret group\",\"doc_ids\":[\"RPC-SECRET\"],\"secret_link_confirmed\":true}') p")).rows[0].p;
 assert.equal((await db.query('select is_secret from public.position_groups where group_id=$1',[createdGroup.id])).rows[0].is_secret,true,'real new-group RPC classifies its first secret link atomically');
 const secretSnapshot=JSON.stringify(await snapshot());assert.ok(!secretSnapshot.includes('SECRET-'),'reports omit secret identity and activity');
 assert.deepEqual(await snapshot(),before,'secret requisitions, applications, stages and hires cannot change report totals');
 assert.equal((await db.query("select count(*)::int n from public.requisitions where doc_id='SECRET-R'")).rows[0].n,1,'admin operational read');
 assert.ok((await db.query('select public.app_unlinked_groups_page_v1(null,50) p')).rows[0].p.items.some(row=>row.group_id==='SECRET-UNLINKED'),'admins can manage an unlinked secret group');

 for(const [entity,filters] of [["requisitions",{homeTab:"open_headcount"}],["candidate_applications",{homeTab:"active_pipeline"}],["position_groups",{scope:"ongoing",reportOnly:true}],["offers",{homeTab:"start_confirmation"}]]){
  const output=(await db.query("select public.app_recruitment_list_v1($1,'',$2,'','asc',25,null,null,false) p",[entity,JSON.stringify(filters)])).rows[0].p;
  assert.ok(!JSON.stringify(output).includes('SECRET-'),entity+' Home records exclude secret activity');
 }

 await assert.rejects(db.query("select public.app_reveal_secret_requisition_v1(jsonb_build_object('doc_id','SECRET-R','confirmed',true,'expected_updated_at',(select updated_at from public.requisitions where doc_id='SECRET-R')) )"),/SECRET_MIXED_GROUPS/);
 await db.exec('reset role');
 await assert.rejects(db.query("update public.requisitions set is_secret=true where doc_id='TEST-R1'"),/ORDINARY_CANNOT_BECOME_SECRET/);
 await assert.rejects(db.query("insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('BAD-L','TEST-R1','SECRET-G','Bad')"),/SECRET_MIXED_GROUPS/);
 await assert.rejects(db.query("update public.candidate_applications set group_id='TEST-G1' where candidate_id='SECRET-C'"),/SECRET_CROSS_TYPE_TRANSFER/);
 await assert.rejects(db.query("insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('ADOPT-L','SECRET-R','ADOPT-G','Adopted')"),/SECRET_LINK_CONFIRMATION_REQUIRED/);
 await db.exec("select set_config('app.secret_link_ack','ADOPT-G',false);insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('ADOPT-L','SECRET-R','ADOPT-G','Adopted');delete from public.document_groups where doc_group_id='ADOPT-L'");
 assert.equal((await db.query("select is_secret from public.position_groups where group_id='ADOPT-G'")).rows[0].is_secret,true,'unlink retains secrecy');
 await db.exec(`insert into public.candidates(candidate_id,name,phone_no,home_site,created_by) values('LOOKUP-SHARED-SECRET','Lookup shared fixture','0876500001','TEST','${admin}');
 insert into public.candidate_applications(application_id,candidate_id,group_id,state,closure_reason,closed_at) values
 (md5('lookup-shared-closed')::uuid,'LOOKUP-SHARED-SECRET','TEST-G1','closed','fixture',now()),
 (md5('lookup-shared-secret')::uuid,'LOOKUP-SHARED-SECRET','SECRET-G','active',null,null);set role authenticated;`);
 assert.equal((await db.query("select public.app_candidate_contact_lookup_v2('08765',null,10,true) p")).rows[0].p.items.length,1,'admin sees authorized secret active application');
 await db.exec('reset role');
 for(const role of ['site_recruiter','viewer']){
  await db.exec('reset role');await db.query('update public.profiles set role=$1,site=$2 where id=$3',[role,'TEST','22222222-2222-2222-2222-222222222222']);await db.exec("select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);set role authenticated");
  await assert.rejects(db.query('select public.app_unlinked_groups_page_v1()'),/SECRET_ADMIN_REQUIRED/);
  for(const active of [false,true])assert.deepEqual((await db.query("select public.app_candidate_contact_lookup_v2('08999',null,10,$1) p",[active])).rows[0].p,{items:[],next_cursor:null},role+' prefix hides secret-only candidates');
  assert.equal((await db.query("select public.app_candidate_contact_lookup_v2('08765') p")).rows[0].p.items.length,1,role+' shared ordinary profile remains discoverable');
  assert.deepEqual((await db.query("select public.app_candidate_contact_lookup_v2('08765',null,10,true) p")).rows[0].p,{items:[],next_cursor:null},role+' secret-only active journey cannot satisfy the switch');

  if ((await db.query("select to_regprocedure('public.app_candidate_contact_lookup_v1(text,text,integer)') present")).rows[0].present) assert.deepEqual((await db.query("select public.app_candidate_contact_lookup_v1('0899999999') p")).rows[0].p,{items:[],next_cursor:null},role+' contact lookup hides secret-only profile');
  for(const [table,condition] of [['requisitions',"doc_id='SECRET-R'"],['position_groups',"group_id='SECRET-G'"],['candidate_applications',"group_id='SECRET-G'"],['candidates',"candidate_id='SECRET-C'"],['document_groups',"doc_id='SECRET-R'"],['recruitment_notifications',"doc_id='SECRET-R'"]])assert.equal((await db.query(`select count(*)::int n from public.${table} where ${condition}`)).rows[0].n,0,role+' '+table);
  assert.equal((await db.query("select count(*)::int n from public.candidates where candidate_id='TEST-C1'")).rows[0].n,1,role+' retains shared ordinary profile');
  assert.ok(!JSON.stringify((await db.query("select public.app_recruitment_list_v1('candidate_applications','','{}','latest_log_date','desc',25,null,null,false) p")).rows[0]).includes('SECRET-'),role+' global-reader list respects secrecy');
  assert.ok(!JSON.stringify((await db.query("select public.app_application_destinations_v1() p")).rows[0]).includes('SECRET-'),role+' destinations do not leak');
  await assert.rejects(db.query("select public.app_reveal_secret_group_v1('{\"group_id\":\"ADOPT-G\",\"confirmed\":true}')"),/SECRET_ADMIN_REQUIRED/);
 }
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${admin}',false);delete from public.document_groups where doc_group_id='SECRET-L2';set role authenticated;`);
 await db.query("select public.app_reveal_secret_requisition_v1(jsonb_build_object('doc_id','SECRET-R','confirmed',true,'expected_updated_at',(select updated_at from public.requisitions where doc_id='SECRET-R'))) ");
 assert.ok(JSON.stringify(await snapshot()).includes('SECRET-R'),'revealed history is in reports');
 assert.equal((await db.query("select is_secret from public.position_groups where group_id='SECRET-G'")).rows[0].is_secret,false,'linked group reveals together');
 await db.query("select public.app_reveal_secret_group_v1(jsonb_build_object('group_id','ADOPT-G','confirmed',true,'expected_updated_at',(select updated_at from public.position_groups where group_id='ADOPT-G'))) ");
 await db.exec('reset role;set role anon');await assert.rejects(db.query("select public.app_reveal_secret_group_v1('{}')"),/permission denied/);await db.exec('reset role');
 console.log('Confidentiality: ordinary-report parity, role RLS, privileged lists/destinations, mixed links, persistent groups, one-way reveal, notifications and transfers passed.');
};
