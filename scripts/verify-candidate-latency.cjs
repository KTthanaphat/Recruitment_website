const assert = require('node:assert/strict');
module.exports = async function(db,root) {
 await db.exec("reset role; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false); set role authenticated;");
 const privileges = (await db.query("select proname,prosecdef from pg_proc where proname in ('app_candidate_action_v1','app_pipeline_card_location_v1')")).rows;
 assert.equal(privileges.length,2); assert(privileges.every(row => row.prosecdef === false));
 await assert.rejects(db.query("select public.app_candidate_action_v1('app_delete_recruitment_record','{}',gen_random_uuid())"), /CANDIDATE_ACTION_OPERATION_INVALID/);
 const candidate = (await db.query("select candidate_id,application_id from public.candidate_applications order by application_id limit 1")).rows[0];
 const receipt = (await db.query("select public.app_candidate_action_v1('app_upsert_candidate_note_v2',$1,gen_random_uuid()) result", [JSON.stringify({candidate_id:candidate.candidate_id,body:'Committed receipt rehearsal'})])).rows[0].result;
 assert.equal(receipt.ok,true); assert.equal(receipt.action_result.notes[0].body,'Committed receipt rehearsal');
 assert.equal(receipt.action_result.candidate_id,candidate.candidate_id);
 for(const card of receipt.action_result.cards) assert.equal(card.candidate_id,candidate.candidate_id);
 const direct = (await db.query("select public.app_recruitment_list_v1('candidate_applications','',$1,'board_last_update','asc',25,null,null,false) page", [JSON.stringify({candidateId:candidate.candidate_id})])).rows[0].page;
 assert.deepEqual(receipt.action_result.cards.map(({has_readable_offer,has_priority_requisition,...row})=>row),direct.items);
 const location = (await db.query("select public.app_pipeline_card_location_v1($1,'','{}','board_last_update','asc') location",[candidate.application_id])).rows[0].location;
 assert(Number.isInteger(location.page)); assert.equal(Math.floor(location.offset/5),(location.page-1)%5);
 const excluded = (await db.query("select public.app_pipeline_card_location_v1($1,'NO-MATCH-SYNTHETIC','{}','board_last_update','asc') location",[candidate.application_id])).rows[0].location;
 assert.deepEqual(excluded,{excluded:true});

 const today=(await db.query("select app_private.pipeline_business_date()::text today")).rows[0].today;
 async function action(operation,payload) { return (await db.query("select public.app_candidate_action_v1($1,$2,gen_random_uuid()) result",[operation,JSON.stringify(payload)])).rows[0].result; }
 const created=await action('app_upsert_candidate_profile_v2',{mode:'new',name:'Receipt workflow',phone_no:'0899999876',first_contact_date:today});
 const person=created.action_result.candidate_id;
 const application=await action('app_create_candidate_application_v1',{candidate_id:person,group_id:'TEST-G1',opened_date:today});
 const app=application.application_id;
 let started=application;
 assert.equal(started.action_result.cards[0].latest_process,'Phone Screen');
 let pending=started.action_result.history.find(row=>row.result===null);
 const updated=await action('app_update_pipeline_pending_v2',{candidate_id:person,application_id:app,stage_instance_id:pending.stage_instance_id,expected_updated_at:pending.updated_at,pending:{opened_date:today,remark:'Committed estimate'}});
 assert(updated.action_result.history.some(row=>row.remark==='Committed estimate'));
 pending=updated.action_result.history.find(row=>row.result===null);
 const passed=await action('app_complete_pipeline_stage_v2',{candidate_id:person,application_id:app,stage_instance_id:pending.stage_instance_id,expected_updated_at:pending.updated_at,pending:{opened_date:today},outcome:{result:'pass',date:today},next_pending:{stage:'HR Interview',round:1,opened_date:today}});
 assert.equal(passed.action_result.cards[0].latest_process,'HR Interview');
 await assert.rejects(action('app_complete_pipeline_stage_v2',{candidate_id:person,application_id:app,stage_instance_id:pending.stage_instance_id,expected_updated_at:pending.updated_at,pending:{opened_date:today},outcome:{result:'pass',date:today}}),/PIPELINE_NOT_CURRENT|PIPELINE_STALE_WRITE/);
 const transfer=await action('app_transfer_candidate_application_v1',{candidate_id:person,application_id:app,group_id:'TEST-G2',expected_version:passed.action_result.applications[0].version,reason:'Receipt test'});
 assert.equal(transfer.action_result.cards[0].group_id,'TEST-G2');
 await db.exec('reset role');
 for (const population of [0,5,6,25,26,101]) {
  if (population) await db.query(`insert into public.candidates(candidate_id,name,phone_no,home_site,created_by) select 'LAT-'||$1||'-'||n,'LAT-N'||$1||' '||n,'0812345678','TEST','11111111-1111-1111-1111-111111111111' from generate_series(1,$1::integer) n`,[population]);
  if (population) await db.query(`insert into public.candidate_applications(application_id,candidate_id,group_id,state) select md5(candidate_id)::uuid,candidate_id,'TEST-G1','active' from public.candidates where candidate_id like 'LAT-'||$1||'-%'`,[population]);
  await db.exec('set role authenticated');
  const criteria={stage:'No activity',activeBoard:true,asOf:today};
  let cursor=null,total=0,seen=new Set();
  do {
   const args=['LAT-N'+population+' ',JSON.stringify(criteria),'board_last_update','asc',25,cursor?JSON.stringify(cursor.value):null,cursor?.id??null,false,false];
   const page=(await db.query('select public.app_recruitment_applications_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) page',args)).rows[0].page;
   const legacy=(await db.query('select public.test_previous_candidate_page($1,$2,$3,$4,$5,$6,$7,$8,$9) page',args)).rows[0].page;
   assert.deepEqual(page,legacy,'legacy parity for '+population);
   for (let index=0;index<page.items.length;index++) {
    const row=page.items[index]; assert(!seen.has(row.application_id)); seen.add(row.application_id);
    if(index!==0&&index!==page.items.length-1)continue;
    const position=(await db.query("select public.app_pipeline_card_location_v1($1,$2,$3,'board_last_update','asc') location",[row.application_id,'LAT-N'+population+' ',JSON.stringify(criteria)])).rows[0].location;
    assert.equal(position.block,Math.floor((total+index)/25)); assert.equal(position.offset,(total+index)%25); assert.equal(position.page,Math.floor((total+index)/5)+1);
    if (index===0) assert.deepEqual(position.cursor,cursor);
   }
   total+=page.items.length; cursor=page.next_cursor;
  } while(cursor);
  assert.equal(total,population); await db.exec('reset role');
 }
 const raw=(await db.query("select application_id,candidate_id from public.candidate_applications where candidate_id='LAT-5-1'")).rows[0];
 await db.query('insert into public.candidate_application_assignments(application_id,group_id,actor_id) values($1,$2,$3)',[raw.application_id,'TEST-G1','11111111-1111-1111-1111-111111111111']);
 await db.exec('set role authenticated');
 const rawStart=await action('app_start_pipeline_stage_v2',{candidate_id:raw.candidate_id,application_id:raw.application_id,pending:{opened_date:today}}); assert.equal(rawStart.action_result.cards[0].latest_process,'Phone Screen');
 await db.exec('reset role');
 console.log('Stage start/pending/pass, stale-write rejection, transfer, and 0/5/6/25/26/101 population cursor/location parity verified.');

 await db.exec('set role authenticated');
 const measurements={environment:'disposable PGlite full-schema RLS; synthetic fixtures; not production latency',indexes_added:[],page:{},projection:{}};
 const filters=JSON.stringify({candidateId:person,homeTab:'active_pipeline',asOf:today});
 for (const name of ['test_previous_candidate_page','app_recruitment_applications_page_v1']) {
  const samples=[]; for(let run=0;run<6;run++){const start=performance.now();await db.query(`select public.${name}('',$1,'home_oldest_touch','asc',25,null,null,false,false)`,[filters]);samples.push(performance.now()-start);}
  const definition=(await db.query("select pg_get_functiondef($1::regprocedure) body",['public.'+name+'(text,jsonb,text,text,integer,jsonb,text,boolean,boolean)'])).rows[0].body;
  const begin=definition.search(/with (latest|eligible_applications) as/i),end=definition.indexOf('return v_result;',begin);
  let inner=definition.slice(begin,end).replace(/\s+into v_result(\s+from edges)/i,'$1');
  const replacements={v_search:"''",v_sort:"'home_oldest_touch'",v_direction:"'asc'",v_stage:"''",v_board:"'all'",v_group:"''",v_since:'NULL::date',v_embedded_all_time:'false',v_home_tab:"'active_pipeline'",v_active_board:'false',v_as_of:"DATE '"+today+"'",v_global_reader:'true',v_cursor:'NULL::text',p_filters:"'"+filters+"'::jsonb",p_limit:'25',p_before:'false',p_cursor_value:'NULL::jsonb',p_cursor_id:'NULL::text'};
  for(const [key,value] of Object.entries(replacements))inner=inner.replace(new RegExp('\\b'+key+'\\b','g'),value);
  const plan=(await db.query('explain (analyze,format text) '+inner)).rows.map(row=>row['QUERY PLAN']).join('\n');
  measurements.page[name]={cold_ms:samples[0],warm_median_ms:samples.slice(1).sort((a,b)=>a-b)[2],plan};
 }
 const note=(await db.query('select note_id,version from public.candidate_notes where candidate_id=$1',[person])).rows[0];
 const payload=JSON.stringify({candidate_id:person,body:'Projection timing fixture',expected_note_id:note?.note_id,expected_version:note?.version});
 for(const wrapped of [false,true]){
  const samples=[];for(let run=0;run<5;run++){
   await db.exec('begin');const start=performance.now();
   if(wrapped)await db.query("select public.app_candidate_action_v1('app_upsert_candidate_note_v2',$1,gen_random_uuid())",[payload]);else await db.query('select public.app_upsert_candidate_note_v2($1)',[payload]);
   samples.push(performance.now()-start);await db.exec('rollback');
  }
  measurements.projection[wrapped?'wrapper_median_ms':'legacy_write_median_ms']=samples.sort((a,b)=>a-b)[2];
 }
 measurements.projection.added_median_ms=measurements.projection.wrapper_median_ms-measurements.projection.legacy_write_median_ms;
 const fs=require('node:fs'),path=require('node:path'),directory=path.join(root,'outputs/candidate-latency');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'sql-rehearsal.json'),JSON.stringify(measurements,null,2));
 console.log('Synthetic SQL timing/EXPLAIN artifact: outputs/candidate-latency/sql-rehearsal.json; no indexes retained.');

 await db.exec(`reset role;
 insert into auth.users(id,email,raw_user_meta_data) values('feef1111-1111-4111-8111-111111111111','latency-rls@example.test','{"nickname":"Latency PIC"}');
 update public.profiles set role='site_recruiter',site='LAT-SOURCE',nickname='Latency PIC',full_name='Latency PIC' where id='feef1111-1111-4111-8111-111111111111';
 insert into public.requisitions(doc_id,site,position,department,head_count,status,person_in_charge) values('LAT-SRC-R','LAT-SOURCE','Test','Test',5,'ongoing','Latency PIC'),('LAT-DST-R','LAT-RESTRICTED','Secret destination position','Test',5,'ongoing','Restricted PIC');
 insert into public.position_groups(group_id,group_position) values('LAT-SRC-G','Source'),('LAT-DST-G','Restricted destination group');
 insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('LAT-SRC-D','LAT-SRC-R','LAT-SRC-G','Source'),('LAT-DST-D','LAT-DST-R','LAT-DST-G','Restricted destination group');
 select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);set role authenticated;`);
 const restricted=await action('app_upsert_candidate_profile_v2',{mode:'new',name:'Permission loss fixture',phone_no:'0899999865',first_contact_date:today,group_id:'LAT-SRC-G'});
 await db.exec("reset role;select set_config('request.jwt.claim.sub','feef1111-1111-4111-8111-111111111111',false);set role authenticated;");
 const removed=await action('app_transfer_candidate_application_v1',{candidate_id:restricted.action_result.candidate_id,application_id:restricted.application_id,group_id:'LAT-DST-G',expected_version:restricted.action_result.applications[0].version,reason:'Permission loss fixture'});
 assert.deepEqual(removed.action_result.removed_applications,[restricted.application_id]);
 for(const key of ['cards','applications','history','assignments'])assert.deepEqual(removed.action_result[key],[],key+' hides inaccessible destination');
 assert.equal(removed.action_result.profile.candidate,null); assert.deepEqual(removed.action_result.context,{groups:[],links:[],requisitions:[]});
 const hidden=(await db.query("select public.app_pipeline_card_location_v1($1,'','{}','board_last_update','asc') result",[restricted.application_id])).rows[0].result;assert.deepEqual(hidden,{excluded:true});
 for(const identity of ['feef1111-1111-4111-8111-111111111111','88888888-8888-8888-8888-888888888888']) {
  await db.exec("reset role;select set_config('request.jwt.claim.sub','"+identity+"',false);set role authenticated;");
  const parity=(await db.query("select public.app_recruitment_applications_page_v1('','{}','board_last_update','asc',25,null,null,false,false) actual,public.test_previous_candidate_page('','{}','board_last_update','asc',25,null,null,false,false) expected")).rows[0];assert.deepEqual(parity.actual,parity.expected,'restricted/viewer page parity');
 }
 await assert.rejects(action('app_upsert_candidate_note_v2',{candidate_id:person,body:'Viewer forbidden'}),/authorized|permission|read.only|writer|write role/i);
 console.log('Real site-recruiter transfer permission loss redacts destination; location exclusion, viewer write rejection and restricted/viewer legacy page parity verified.');
 await db.exec('reset role; set role anon');
 await assert.rejects(db.query("select public.app_candidate_action_v1('app_upsert_candidate_note_v2','{}',gen_random_uuid())"),/permission denied/);
 await db.exec('reset role');
 console.log('Candidate receipt/location invoker contracts, exact projection parity, note save, operation allowlist, exclusion and anonymous denial verified in disposable full-schema PostgreSQL.');
};
