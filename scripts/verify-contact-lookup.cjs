const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
module.exports=async function(db,root){
 await db.exec(fs.readFileSync(path.join(root,'supabase/schemas/67_candidate_contact_lookup.sql'),'utf8'));
 await db.exec(`reset role; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
   insert into public.candidates(candidate_id,name,phone_no,email,home_site,created_by) select 'LOOKUP-'||lpad(n::text,2,'0'),'Lookup fixture '||n,'+66 81 765 4321',' Duplicate@Example.test ','TEST','11111111-1111-1111-1111-111111111111'::uuid from generate_series(1,12) n;
   insert into public.position_groups(group_id,group_position) select 'LOOKUP-G'||n,'Lookup group '||n from generate_series(1,7) n;
   insert into public.candidate_applications(application_id,candidate_id,group_id,state,closure_reason,closed_at) select md5('lookup-app-'||n)::uuid,'LOOKUP-01','LOOKUP-G'||n,'closed','test',now() from generate_series(1,7) n;
   set role authenticated;`);
 const lookup=async(contact,cursor=null)=> (await db.query('select public.app_candidate_contact_lookup_v1($1,$2) page',[contact,cursor])).rows[0].page;
 const phone=await lookup('0817654321');assert.equal(phone.items.length,10);assert.ok(phone.next_cursor);
 assert.deepEqual(await lookup('+66 (81) 765-4321'),phone);
 assert.deepEqual(await lookup('DUPLICATE@example.TEST'),phone);
 const next=await lookup('0817654321',phone.next_cursor);assert.equal(next.items.length,2);assert.equal(next.next_cursor,null);
 assert.equal(phone.items[0].applications.items.length,5);
 const apps=(await db.query('select public.app_candidate_lookup_applications_v1($1,$2) page',['LOOKUP-01',phone.items[0].applications.next_cursor])).rows[0].page;assert.equal(apps.items.length,2);
 assert.deepEqual(await lookup('0900000000'),{items:[],next_cursor:null});
 await assert.rejects(lookup('0817'),/LOOKUP_INPUT_INVALID/);
 await assert.rejects(lookup('081letters7654321'),/LOOKUP_INPUT_INVALID/);
 await assert.rejects(lookup('x@invalid'),/LOOKUP_INPUT_INVALID/);
 for(const role of ['system_admin','admin_recruiter']){
   await db.exec('reset role');await db.query('update public.profiles set role=$1 where id=$2',[role,'11111111-1111-1111-1111-111111111111']);await db.exec('set role authenticated');assert.equal((await lookup('0817654321')).items.length,10);
 }
 await db.exec("reset role; update public.profiles set role='system_admin' where id='11111111-1111-1111-1111-111111111111'; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);set role authenticated;");
 assert.deepEqual(await lookup('0817654321'),{items:[],next_cursor:null},'site recruiter cannot infer other site contacts');
 assert.deepEqual((await db.query("select public.app_candidate_lookup_applications_v1('LOOKUP-01') page")).rows[0].page,{items:[],next_cursor:null});
 await db.exec("reset role;select set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',false);set role authenticated;");
 assert.equal((await lookup('0817654321')).items.length,1,'viewer sees only the profile with an application');
 assert.equal((await lookup('0817654321')).items[0].applications.items.length,5,'authorized application IDs remain visible when group labels are unavailable');
 await db.exec('reset role;set role anon');await assert.rejects(lookup('0817654321'),/permission denied/);
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role authenticated");await assert.rejects(lookup('0817654321'),/RECRUITMENT_READ_NOT_AUTHORIZED/);
 await db.exec("reset role;select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)");
 await require('./verify-contact-lookup-prefix.cjs')(db,root);
 console.log('Contact lookup: normalization, real RLS role matrix, duplicate/application paging and anonymous denial passed.');
};
