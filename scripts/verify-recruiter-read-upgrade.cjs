// Full-schema upgrade/parity rehearsal. Runs only in disposable PGlite; never connects to a server.
const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');const {performance}=require('node:perf_hooks');
module.exports=async(db,root)=>{
 const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/db/fixtures/deployed-authorization-20261104.json'),'utf8'));
 const migrationName=fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_reconcile_recruiter_read_authorization.sql'));
 const migration=fs.readFileSync(path.join(root,'supabase/migrations',migrationName),'utf8');
 await db.exec(`reset role;
  insert into auth.users(id,email,raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000001','auth-admin@test.invalid','{"nickname":"Auth Admin"}'),
  ('a1000000-0000-4000-8000-000000000002','auth-site@test.invalid','{"nickname":"Owner Nick"}'),
  ('a1000000-0000-4000-8000-000000000003','auth-pic@test.invalid','{"nickname":"Owner Full"}'),
  ('a1000000-0000-4000-8000-000000000004','auth-null@test.invalid','{"nickname":"Unassigned"}');
  update public.profiles set role='admin_recruiter',site='TEST' where id='a1000000-0000-4000-8000-000000000001';
  update public.profiles set role='site_recruiter',site='TEST',full_name='Owner Full' where id='a1000000-0000-4000-8000-000000000002';
  update public.profiles set role='site_recruiter',site='OTHER' where id='a1000000-0000-4000-8000-000000000003';
  update public.profiles set role='site_recruiter',site=null where id='a1000000-0000-4000-8000-000000000004';
  update public.requisitions set person_in_charge='Owner Full',pr_approved_date=current_date-60 where doc_id='TEST-R1';
  insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('AUTH-SHARED','TEST-R2','TEST-G1','Shared Group');
  insert into public.candidates(candidate_id,name,created_by,home_site) values('AUTH-CREATOR','Creator only','a1000000-0000-4000-8000-000000000004',null);
  insert into public.candidate_applications(application_id,candidate_id,group_id,state) values(md5('AUTH-PARALLEL')::uuid,'TEST-C1','TEST-G2','active');`);
 // The previously prepared sourcing migration is a dependency, not a second implementation.
 const sourcing=fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_sourcing_records_loading.sql'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',sourcing),'utf8'));
 const profiles=(await db.query("select id,role from public.profiles where role in ('system_admin','admin_recruiter','site_recruiter','viewer') order by role,id")).rows;
 const entities=['candidate_registry','candidate_applications','requisitions','position_groups','sourcing_records','offers','audit_log','pipeline_history'];
 const requests=entities.map(entity=>({name:'records:'+entity,sql:`select public.app_recruitment_list_v1('${entity}','','{}','','asc',25,null,null,false) result`}));
 requests.push(
 {name:'pipeline:active',sql:`select public.app_recruitment_list_v1('pipeline_stage','','{"stage":"Phone Screen"}','board_last_update','asc',25,null,null,false) result`},
 {name:'pipeline:failed-stage',sql:`select public.app_recruitment_list_v1('candidate_applications','','{"boardFilter":"failed","stage":"HR Interview","embeddedAllTime":true}','latest_log_date','desc',25,null,null,false) result`},
 {name:'home:records',sql:`select public.app_recruitment_list_v1('candidate_applications','','{"homeTab":"active_pipeline"}','home_oldest_touch','asc',50,null,null,false) result`},
 {name:'home:core',sql:`select public.app_home_core_summary_v1('{}') result`},
 {name:'home:banner',sql:`select public.app_home_banner_summary_v1('{}') result`},
 {name:'home:work',sql:`select public.app_home_work_queue_v1('{}') result`},
 {name:'home:quality',sql:`select public.app_home_quality_page_v1('{}') result`},
 {name:'home:welcome',sql:`select public.app_home_welcome_summary_v1() result`},
 {name:'calendar',sql:`select public.app_recruitment_calendar_v1(current_date-7,current_date+7,'{}') result`},
 {name:'workspace:group',sql:`select public.app_recruitment_groups_page_v1('','{"scope":"all","exactGroupId":"TEST-G1"}','name','asc',25,null,null,false,false) result`},
 {name:'workspace:pipeline-summary',sql:`select public.app_pipeline_summary_v1('{}','TEST-G1') result`},
 {name:'workspace:sourcing-summary',sql:`select public.app_recruitment_sourcing_summary_v1(current_date-((extract(dow from current_date)::integer+1)%7),'TEST-G1','{}') result`},
 {name:'candidate:detail',sql:`select public.app_candidate_profile_detail_v1('TEST-C1') result`},
 {name:'candidate:creator-detail',sql:`select public.app_candidate_profile_detail_v1('AUTH-CREATOR') result`},
 {name:'dashboard:filters',sql:`select public.app_dashboard_filter_options_v1('{}') result`},
 {name:'dashboard:pipeline',sql:`select public.app_dashboard_pipeline_summary_v1(current_date-30,current_date,'custom','{}') result`},
 {name:'dashboard:performance',sql:`select public.app_dashboard_performance_summary_v1(current_date-30,current_date,current_date-61,current_date-31,'custom','{}') result`},
 {name:'dashboard:risk',sql:`select public.app_dashboard_risk_summary_v1(current_date-30,current_date,current_date-61,current_date-31,'{}') result`},
 {name:'dashboard:rejection',sql:`select public.app_dashboard_rejection_summary_v1(current_date-30,current_date,'{}') result`}
 );
 const tables=(await db.query("select distinct tablename from pg_policies where schemaname='public' order by tablename")).rows.map(row=>row.tablename);
 // The live position_groups SELECT policy differs from a fresh schema replay. Reproduce live policies in the disposable fixture only.
 const identifier=value=>'"'+value.replaceAll('"','""')+'"';
 for(const policy of fixture.policies){
  const roles=policy.roles.map(identifier).join(',');
  await db.exec(`alter policy ${identifier(policy.policyname)} on public.${identifier(policy.tablename)} to ${roles}${policy.qual?' using ('+policy.qual+')':''}${policy.with_check?' with check ('+policy.with_check+')':''}`);
 }
 const baselinePolicies=(await db.query("select tablename,policyname,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname")).rows;
 const deployedPolicies=fixture.policies.map(({tablename,policyname,qual,with_check})=>({tablename,policyname,qual,with_check}));
 assert.deepEqual(baselinePolicies,deployedPolicies,'the upgrade rehearsal starts with the actual deployed policy expressions');
 async function selectActor(profile){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[profile.id]);await db.exec('set role authenticated');}
 async function snapshot(){
  const result={};
  for(const profile of profiles){
   await selectActor(profile);const visible={tables:{},requests:{},counts:{},helpers:{}};
   for(const table of tables) visible.tables[table]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) rows from public.${table} t`)).rows;
   for(const request of requests){try{visible.requests[request.name]=(await db.query(request.sql)).rows;}catch(error){throw Error(profile.role+' '+request.name+': '+error.message);}}
   for(const entity of entities)visible.counts[entity]=(await db.query(`select public.app_recruitment_list_count_v1('${entity}','','{}') total`)).rows;
   for(const [name,table,key] of [['can_read_requisition','requisitions','doc_id'],['can_read_position_group','position_groups','group_id'],['can_read_application','candidate_applications','application_id'],['can_read_candidate','candidates','candidate_id']]){
    // Explicit IDs are fixture-only; never serialize this snapshot into an output artifact.
    await db.exec('reset role');const ids=(await db.query(`select ${key} id from public.${table}`)).rows.map(row=>row.id);await db.exec('set role authenticated');
    visible.helpers[name]=[];for(const id of ids)visible.helpers[name].push((await db.query(`select app_private.${name}($1) allowed`,[id])).rows[0].allowed);
   }
   result[profile.id]=visible;
  }await db.exec('reset role');return result;
 }
 for(const helper of fixture.helpers)await db.exec(helper.definition);
 console.log('Rehearsing the actual deployed SQL helpers before upgrade.');
 const before=await snapshot();
 const baselineTimings=[];
 for(const role of ['system_admin','site_recruiter']){
  const profile=profiles.find(row=>row.role===role&&(role!=='site_recruiter'||row.id==='a1000000-0000-4000-8000-000000000002'));await selectActor(profile);
  for(const request of requests.filter(row=>['records:candidate_applications','pipeline:active','workspace:group','home:records'].includes(row.name))){
   const values=[];for(let n=0;n<30;n++){const started=performance.now();await db.query(request.sql);values.push(performance.now()-started);}values.sort((a,b)=>a-b);
   baselineTimings.push({role,request:request.name,observations:30,median_ms:values[14],p95_ms:values[28]});
  }
 }await db.exec('reset role');
 await db.exec(migration);
 const after=await snapshot();
 await selectActor(profiles.find(row=>row.role==='system_admin'));
 await assert.rejects(db.query("select public.app_pipeline_summary_v1('{\"groupId\":\"TEST-G1\"}')"),/FILTER_INVALID/);
 await assert.rejects(db.query("select public.app_recruitment_list_v1('candidate_applications','','{\"unsupported\":true}','name','asc',25,null,null,false)"),/FILTER_INVALID/);
 await db.exec('reset role');
 assert.deepEqual(after,before,'upgrade preserves every readable row, projection, count, detail and helper decision');
 assert.deepEqual((await db.query("select tablename,policyname,qual,with_check from pg_policies where schemaname='public' order by tablename,policyname")).rows,baselinePolicies,'RLS policies are unchanged');
 for(const helper of fixture.helpers){const arg=helper.name==='can_read_application'?'uuid':'text';const row=(await db.query(`select p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p where p.oid='app_private.${helper.name}(${arg})'::regprocedure`)).rows[0];assert.deepEqual(row,{prosecdef:true,anon:false,authenticated:true});}
 const timings=[];
 for(const role of ['system_admin','admin_recruiter','site_recruiter']){
  const profile=profiles.find(row=>row.role===role&&(role!=='site_recruiter'||row.id==='a1000000-0000-4000-8000-000000000002'));await selectActor(profile);
  for(const request of requests){const values=[];for(let n=0;n<30;n++){const start=performance.now();await db.query(request.sql);values.push(performance.now()-start);}values.sort((a,b)=>a-b);timings.push({role,request:request.name,observations:30,median_ms:values[14],p95_ms:values[28]});}
 }await db.exec('reset role');
 const source=fs.readFileSync(path.join(root,'supabase/schemas/60_recruitment_list.sql'),'utf8');let body=source.slice(source.indexOf('create or replace function public.app_recruitment_applications_page_v1('));body=body.slice(0,body.indexOf('create or replace function ',40));
 let inner='with '+body.slice(body.indexOf('  with ')+7,body.indexOf('  return v_result;')).replace(/\s+into v_result(\s+from edges)/i,'$1');
 const values={p_filters:`'{"stage":"Phone Screen","activeBoard":true}'::jsonb`,p_limit:'25',p_cursor_value:'null::jsonb',p_cursor_id:'null::text',p_before:'false',p_count_only:'false',v_global_reader:'false',v_stage:"'Phone Screen'",v_board:"'all'",v_direction:"'asc'",v_filter:"'all'",v_sort:"'board_last_update'",v_dir:"'asc'",v_cursor:'null::text',v_group:"''",v_search:"''",v_home_tab:"''",v_active_board:'true',v_embedded_all_time:'false',v_as_of:'current_date',v_since:'current_date-7'};
 for(const [key,value]of Object.entries(values))inner=inner.replace(new RegExp('\\b'+key+'\\b','g'),value);
 await selectActor(profiles.find(row=>row.id==='a1000000-0000-4000-8000-000000000002'));
 const plan=(await db.query('explain (analyze,buffers,format json) '+inner)).rows;await db.exec('reset role');
 const output=path.join(root,'outputs/recruiter-read-upgrade');fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,'fixture-plan.json'),JSON.stringify(plan,null,2));
 fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({environment:'disposable PGlite fixture, not production or cold-cache verification',profiles:profiles.map(row=>row.role),requests:requests.map(row=>row.name),table_count:tables.length,parity:true,baselineTimings,timings},null,2));
 await db.exec('set role anon');await assert.rejects(db.query("select public.app_home_core_summary_v1('{}')"),/permission denied/);await db.exec('reset role');
 console.log(JSON.stringify({kind:'deployed-authorization-upgrade',profiles:profiles.length,requests:requests.length,tables:tables.length,parity:true,samples:timings.length*30}));
};
