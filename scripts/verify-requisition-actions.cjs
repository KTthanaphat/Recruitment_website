const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
module.exports=async(db,root)=>{
 const migration=fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_requisition_committed_results.sql'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
 const admin='11111111-1111-1111-1111-111111111111';
 const profiles=[['d1111111-1111-4111-8111-111111111111','admin_recruiter','TEST','Req Admin'],['d2222222-2222-4222-8222-222222222222','site_recruiter','TEST','Req Site'],['d3333333-3333-4333-8333-333333333333','site_recruiter','OTHER','Restricted'],['d4444444-4444-4444-8444-444444444444','viewer',null,'Req Viewer']];
 await db.exec('reset role');
 for(const [id,role,site,nickname]of profiles){
  await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",[id,id+'@example.test',JSON.stringify({nickname})]);
  await db.query("update public.profiles set role=$2,site=$3,nickname=$4,full_name=$4 where id=$1",[id,role,site,nickname]);
 }
 const as=async(id)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');};
 const action=async(operation,payload)=> (await db.query("select public.app_requisition_action_v1($1) result",[JSON.stringify({operation,payload,request_id:'fixture-request'})])).rows[0].result;
 await as(admin);
 const create={mode:'new',doc_id:'RECEIPT-R1',site:'TEST',position:'Receipt Engineer',department:'Test',head_count:2,person_in_charge:'Req Site',request_type:'New',status:'ongoing'};
 const created=await action('app_upsert_requisition',create);assert.equal(created.action_result.requisition.doc_id,'RECEIPT-R1');
 assert.equal(created.action_result.requisition.status,'ongoing');
 const times=[];
 for(let i=0;i<30;i++){const start=performance.now();await action('app_insert_requisition_log',{doc_id:'RECEIPT-R1',status:'ongoing',log_date:'2026-11-04'});times.push(performance.now()-start);}
 const changed=await action('app_insert_requisition_log',{doc_id:'RECEIPT-R1',status:'cancel',log_date:'2026-11-04',remark:'Receipt'});
 assert.equal(changed.action_result.requisition.status,'cancel');assert.equal(changed.action_result.status_log.log_id,changed.log_id);assert.equal(changed.action_result.status_log.remark,'Receipt');
 const reopened=await action('app_insert_requisition_log',{doc_id:'RECEIPT-R1',status:'filled',log_date:'2026-11-04'});
 assert.equal(reopened.action_result.requisition.status,'ongoing','server recalculation overrides submitted filled without accepted offers');
 await db.exec("reset role; insert into public.requisitions(doc_id,site,position,department,head_count,status,person_in_charge) values('RECEIPT-OFFER','TEST','Offer fixture','Test',1,'ongoing','Req Site');insert into public.position_groups(group_id,group_position) values('RECEIPT-G','Offer fixture');insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('RECEIPT-D','RECEIPT-OFFER','RECEIPT-G','Offer fixture');insert into public.candidates(candidate_id,name,home_site,created_by,responsible_recruiter_id) values('RECEIPT-C','Receipt offer fixture','TEST','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111');insert into public.candidate_applications(application_id,candidate_id,group_id,state,created_by) values('e1111111-1111-4111-8111-111111111111','RECEIPT-C','RECEIPT-G','active','11111111-1111-1111-1111-111111111111');insert into public.offers(candidate_id,application_id,doc_id,accepted_date) values('RECEIPT-C','e1111111-1111-4111-8111-111111111111','RECEIPT-OFFER','2026-11-04');");
 await as(admin);
 const filled=await action('app_insert_requisition_log',{doc_id:'RECEIPT-OFFER',status:'ongoing',log_date:'2026-11-04'});
 assert.equal(filled.action_result.requisition.status,'filled');assert.equal(filled.action_result.display.accepted_count,1);assert.equal(filled.action_result.display.open_headcount,0);
 await db.exec("reset role; update public.offers set start_confirmation='did_not_start',start_confirmed_at=now(),start_confirmed_by='11111111-1111-1111-1111-111111111111',start_confirmation_reason='Fixture no-show' where doc_id='RECEIPT-OFFER';");
 await as(admin);
 const noShow=await action('app_insert_requisition_log',{doc_id:'RECEIPT-OFFER',status:'filled',log_date:'2026-11-04'});
 assert.equal(noShow.action_result.requisition.status,'ongoing');assert.equal(noShow.action_result.display.accepted_count,0);assert.equal(noShow.action_result.display.open_headcount,1);
 const renamed=await action('app_upsert_requisition',{...create,mode:'change',previous_doc_id:'RECEIPT-R1',doc_id:'RECEIPT-R2'});
 assert.equal(renamed.action_result.previous_doc_id,'RECEIPT-R1');assert.equal(renamed.action_result.doc_id,'RECEIPT-R2');
 const priority=await action('app_set_requisition_priority_v1',{doc_id:'RECEIPT-R2',is_priority:true,expected_updated_at:renamed.action_result.updated_at});
 assert.equal(priority.action_result.requisition.is_priority,true);
 await assert.rejects(action('app_set_requisition_priority_v1',{doc_id:'RECEIPT-R2',is_priority:false,expected_updated_at:'2000-01-01T00:00:00Z'}),/STALE/);
 await assert.rejects(action('app_delete_recruitment_record',{doc_id:'RECEIPT-R2'}),/REQUISITION_ACTION_INVALID/);
 await as(profiles[0][0]);assert.equal((await action('app_insert_requisition_log',{doc_id:'RECEIPT-R2',status:'ongoing',log_date:'2026-11-04'})).ok,true);
 await as(profiles[1][0]);assert.equal((await action('app_insert_requisition_log',{doc_id:'RECEIPT-R2',status:'ongoing',log_date:'2026-11-04'})).action_result.requisition.doc_id,'RECEIPT-R2');
 for(const profile of profiles.slice(2)){await as(profile[0]);await assert.rejects(action('app_insert_requisition_log',{doc_id:'RECEIPT-R2',status:'cancel',log_date:'2026-11-04'}));}
 await db.exec("reset role; create policy receipt_fixture_redaction on public.requisitions as restrictive for select to authenticated using(auth.uid()<>'d2222222-2222-4222-8222-222222222222'::uuid or status<>'cancel');");
 await as(profiles[1][0]);
 const removed=await action('app_insert_requisition_log',{doc_id:'RECEIPT-R2',status:'cancel',log_date:'2026-11-04'});
 assert.equal(removed.action_result.removed,true);assert.equal(removed.action_result.requisition,null);assert.equal(removed.action_result.status_log,null);
 await db.exec('reset role; drop policy receipt_fixture_redaction on public.requisitions');
 const acl=(await db.query("select p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p where p.proname='app_requisition_action_v1'")).rows[0];
 assert.deepEqual(acl,{prosecdef:false,anon:false,authenticated:true});
 await db.exec('set role anon');await assert.rejects(action('app_insert_requisition_log',{doc_id:'RECEIPT-R2',status:'cancel'}),/permission denied/);await db.exec('reset role');
 // Replay is additive and legacy outputs retain their existing success fields.
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
 await as(admin);const legacy=(await db.query("select public.app_insert_requisition_log('{\"doc_id\":\"RECEIPT-R2\",\"status\":\"ongoing\",\"log_date\":\"2026-11-04\"}') result")).rows[0].result;assert.equal(legacy.ok,true);
 await db.exec('reset role');
 times.sort((a,b)=>a-b);console.log(JSON.stringify({kind:'requisition-receipts',samples:30,total_action_median_ms:times[15],total_action_p95_ms:times[28],roles:5,permissions:'passed',replay:'passed',note:'Disposable PGlite action timings; not production projection overhead or browser latency'}));
};