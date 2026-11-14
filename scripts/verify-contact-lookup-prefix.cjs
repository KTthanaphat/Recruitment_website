const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
module.exports=async(db,root)=>{
 const admin='11111111-1111-1111-1111-111111111111';
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${admin}',false);
 insert into public.candidates(candidate_id,name,phone_no,email,home_site,created_by) values
 ('PREFIX-A','Prefix active','0987610001','prefix@example.test','TEST','${admin}'),
 ('PREFIX-C','Prefix closed','0987610002','prefix@example.test','TEST','${admin}'),
 ('PREFIX-P','Prefix pool','0987610003','prefix@example.test','TEST','${admin}'),
 ('PREFIX-M','Prefix mixed','+66 98 761 0004','prefix@example.test','TEST','${admin}');
 insert into public.position_groups(group_id,group_position) select 'PREFIX-G'||n,'Prefix group '||n from generate_series(1,7) n;
 insert into public.candidate_applications(application_id,candidate_id,group_id,state,closure_reason,closed_at) values
 (md5('prefix-a')::uuid,'PREFIX-A','LOOKUP-G1','active',null,null),
 (md5('prefix-c')::uuid,'PREFIX-C','LOOKUP-G1','closed','test',now()),
 (md5('prefix-m-active')::uuid,'PREFIX-M','LOOKUP-G1','active',null,null),
 (md5('prefix-m-closed')::uuid,'PREFIX-M','LOOKUP-G2','closed','test',now());
 insert into public.candidate_applications(application_id,candidate_id,group_id,state)
 select md5('prefix-m-extra-'||n)::uuid,'PREFIX-M','PREFIX-G'||n,'active' from generate_series(1,7) n;
 set role authenticated;`);
 const lookup=async(contact,active=false,cursor=null,limit=10)=>(await db.query('select public.app_candidate_contact_lookup_v2($1,$2,$3,$4) page',[contact,cursor,limit,active])).rows[0].page;
 const apps=async(active,cursor=null)=>(await db.query("select public.app_candidate_lookup_applications_v2('PREFIX-M',$1,5,$2) page",[cursor,active])).rows[0].page;
 const all=await lookup('09876');assert.equal(all.items.length,4);
 assert.deepEqual(await lookup('098761'),all);assert.deepEqual(await lookup('+66 (98) 76'),all);
 assert.equal((await lookup('0987610001')).items[0].candidate_id,'PREFIX-A');
 assert.deepEqual(await lookup(' PREFIX@EXAMPLE.TEST '),all);
 assert.deepEqual(await lookup('07610'),{items:[],next_cursor:null},'prefix, not substring');
 const active=await lookup('09876',true);assert.deepEqual(active.items.map(row=>row.candidate_id),['PREFIX-A','PREFIX-M']);
 assert.ok(active.items.every(row=>row.applications.items.every(app=>app.state==='active')));
 assert.deepEqual(await lookup('prefix@example.test',true),active);
 for(const enabled of [false,true]){let cursor=null,ids=[];do{const page=await lookup('09876',enabled,cursor,1);ids.push(...page.items.map(row=>row.candidate_id));cursor=page.next_cursor;}while(cursor);assert.deepEqual(ids,enabled?['PREFIX-A','PREFIX-M']:['PREFIX-A','PREFIX-C','PREFIX-M','PREFIX-P']);}
 const first=await apps(true);assert.equal(first.items.length,5);assert.ok(first.next_cursor);const next=await apps(true,first.next_cursor);assert.equal(next.items.length,3);assert.equal(next.next_cursor,null);assert.ok([...first.items,...next.items].every(row=>row.state==='active'));
 const unfiltered=await apps(false);assert.ok(unfiltered.next_cursor);assert.equal((await apps(false,unfiltered.next_cursor)).items.length,4);
 for(const value of ['0987','098letters76','09876%','09876_','++669876','x@invalid'])await assert.rejects(lookup(value),/LOOKUP_INPUT_INVALID/);
 await assert.rejects(lookup('09876',null),/LOOKUP_INPUT_INVALID/);
 await assert.rejects(db.query("select public.app_candidate_contact_lookup_v1('09876')"),/LOOKUP_INPUT_INVALID/,'v1 remains exact');
 for(const role of ['system_admin','admin_recruiter']){await db.exec('reset role');await db.query('update public.profiles set role=$1 where id=$2',[role,admin]);await db.exec('set role authenticated');assert.equal((await lookup('09876',true)).items.length,2);}
 await db.exec(`reset role;update public.profiles set role='system_admin' where id='${admin}';select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);set role authenticated;`);
 for(const enabled of [false,true])assert.deepEqual(await lookup('09876',enabled),{items:[],next_cursor:null},'out-of-scope prefixes remain indistinguishable from misses');
 await db.exec("reset role;select set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',false);set role authenticated;");
 assert.equal((await lookup('09876')).items.length,3,'viewer cannot discover unmatched pool contact');assert.equal((await lookup('09876',true)).items.length,2);
 await db.exec('reset role;set role anon');await assert.rejects(lookup('09876'),/permission denied/);await assert.rejects(apps(true),/permission denied/);
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role authenticated");await assert.rejects(lookup('09876'),/RECRUITMENT_READ_NOT_AUTHORIZED/);
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${admin}',false)`);
 const migration=fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_candidate_lookup_prefix_active.sql'));
 assert.ok(migration,'CLI migration exists');
 // Reconstruct the prior application-page definition, then exercise the real forward upgrade.
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261113154506_candidate_lookup_application_groups.sql'),'utf8'));
 await db.exec('drop function public.app_candidate_contact_lookup_v2(text,text,integer,boolean);drop function public.app_candidate_lookup_applications_v2(text,uuid,integer,boolean);drop function public.app_normalize_lookup_phone_prefix(text);drop index public.candidates_lookup_phone_prefix_idx;');
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
 await db.exec('set role authenticated');assert.deepEqual(await lookup('09876',true),active);await db.exec('reset role');
 const security=(await db.query("select bool_and(not prosecdef and proconfig=array['search_path=\"\"']) safe from pg_proc where oid in ('public.app_candidate_contact_lookup_v2(text,text,integer,boolean)'::regprocedure,'public.app_candidate_lookup_applications_v2(text,uuid,integer,boolean)'::regprocedure)")).rows[0];assert.equal(security.safe,true);
 console.log('Prefix/active lookup: normalized prefixes, exact email, active-only candidate/application paging, v1 compatibility, role privacy and forward upgrade passed.');
};
