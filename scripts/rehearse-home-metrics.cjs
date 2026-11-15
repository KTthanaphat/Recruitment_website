const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require(path.join(process.env.RECRUITMENT_DB_TOOLS || path.join(process.env.TEMP || '/tmp','recruitment-db-tools'),'node_modules/@electric-sql/pglite'));
const root=path.resolve(__dirname,'..');
(async()=>{const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create schema cron;create table cron.job(jobname text);create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;create function cron.unschedule(text) returns boolean language sql as $$select true$$;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
 const config=fs.readFileSync(path.join(root,'supabase/config.toml'),'utf8');
 for(const m of config.matchAll(/"\.\/schemas\/([^"]+)"/g)){
  const file=m[1],sql=fs.readFileSync(path.join(root,'supabase/schemas',file),'utf8').replace(/^create extension.*;\s*$/gm,'');
  try{await db.exec('begin;'+sql+'\ncommit;');}catch(e){throw new Error(file+': '+e.message);}
 }
 const roles=['system_admin','admin_recruiter','site_recruiter','viewer'];
 const users=roles.map((role,i)=>({role,id:String(i+1).repeat(8)+'-'+String(i+1).repeat(4)+'-'+String(i+1).repeat(4)+'-'+String(i+1).repeat(4)+'-'+String(i+1).repeat(12)}));
 for(const u of users) await db.query("insert into auth.users(id,email) values($1,$2)",[u.id,u.role+'@example.test']);
 for(const u of users) await db.query("update public.profiles set role=$1,site='KT1',nickname='Alice',full_name='Alice' where id=$2",[u.role,u.id]);
 async function checkWelcomeMessage(label) {
  for (const u of users) {
   await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u.id]);await db.exec('set role authenticated');
   const full=(await db.query('select public.app_home_welcome_summary_v1() value')).rows[0].value;
   const message=(await db.query('select public.app_home_welcome_message_v1() value')).rows[0].value;
   assert.deepEqual(message,Object.fromEntries(['filledThisMonth','responsibleVacancyTotal','filledResponsibleVacancyRatio','filledResponsibleVacancyBucket'].map(key=>[key,full[key]])),label+' message parity '+u.role);
  }
  await db.exec('reset role');
 }
 await checkWelcomeMessage('empty');
 await db.exec(`select set_config('request.jwt.claim.sub','${users[0].id}',false);
 insert into public.requisitions(doc_id,site,position,department,head_count,status,pr_approved_date,person_in_charge)
 select 'METRIC-R-'||lpad(n::text,3,'0'),case when n<=10 then 'KT1' else 'KT2' end,'Metric position '||n,'Test',3,'ongoing',current_date-90,'Alice' from generate_series(1,12)n;
 insert into public.position_groups(group_id,group_position) select 'METRIC-G-'||lpad(n::text,3,'0'),'Metric group '||n from generate_series(1,12)n;
 alter table public.document_groups disable trigger user;
 insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) select 'METRIC-D-'||n,'METRIC-R-'||lpad(n::text,3,'0'),'METRIC-G-'||lpad(n::text,3,'0'),'Metric group '||n from generate_series(1,12)n;
 alter table public.document_groups enable trigger user;
 alter table public.candidates disable trigger user;
 insert into public.candidates(candidate_id,name,phone_no,home_site,created_by) select 'METRIC-C-'||n,'Candidate '||n,'08'||lpad(n::text,8,'0'),'KT1','${users[0].id}' from generate_series(1,12)n;
 alter table public.candidates enable trigger user;
 alter table public.candidate_applications disable trigger user;
 insert into public.candidate_applications(application_id,candidate_id,group_id) select md5('metric-app-'||n)::uuid,'METRIC-C-'||n,'METRIC-G-'||lpad(n::text,3,'0') from generate_series(1,12)n;
 alter table public.candidate_applications enable trigger user;
 insert into public.candidate_application_assignments(assignment_id,application_id,group_id) select md5('metric-assign-'||n)::uuid,md5('metric-app-'||n)::uuid,'METRIC-G-'||lpad(n::text,3,'0') from generate_series(1,12)n;
 alter table public.recruitment_logs disable trigger user;
 insert into public.recruitment_logs(candidate_id,application_id,entry_assignment_id,recruitment_process,log_date,estimated_action_date)
 select 'METRIC-C-'||n,md5('metric-app-'||n)::uuid,md5('metric-assign-'||n)::uuid,'Phone Screen',current_date-20,current_date-2 from generate_series(1,12)n;
 insert into public.recruitment_logs(candidate_id,application_id,entry_assignment_id,recruitment_process,log_date,estimated_action_date,superseded_at,record_origin,superseded_reason,migration_note) values('METRIC-C-1',md5('metric-app-1')::uuid,md5('metric-assign-1')::uuid,'HR Interview',current_date-19,current_date-1,now(),'migration','fixture archive','legacy-only archive without canonical replacement');
 set constraints all immediate; alter table public.recruitment_logs enable trigger user;
 alter table public.offers disable trigger user;
 insert into public.offers(candidate_id,application_id,doc_id) values('METRIC-C-1',md5('metric-app-1')::uuid,'METRIC-R-001');
 set constraints all immediate; alter table public.offers enable trigger user;
 insert into public.requisitions(doc_id,site,position,department,head_count,status,pr_approved_date,is_secret) values('METRIC-SECRET-R','KT1','Secret','Test',3,'ongoing',current_date-90,true);
 insert into public.position_groups(group_id,group_position,is_secret) values('METRIC-SECRET-G','Secret',true);
 insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('METRIC-SECRET-D','METRIC-SECRET-R','METRIC-SECRET-G','Secret');
 alter table public.candidate_applications disable trigger user;
 insert into public.candidate_applications(application_id,candidate_id,group_id) values(md5('metric-secret-app')::uuid,'METRIC-C-1','METRIC-SECRET-G');
 alter table public.candidate_applications enable trigger user;
 insert into public.candidate_application_assignments(assignment_id,application_id,group_id) values(md5('metric-secret-assign')::uuid,md5('metric-secret-app')::uuid,'METRIC-SECRET-G');
 alter table public.recruitment_logs disable trigger user;
 insert into public.recruitment_logs(candidate_id,application_id,entry_assignment_id,recruitment_process,log_date,estimated_action_date) values('METRIC-C-1',md5('metric-secret-app')::uuid,md5('metric-secret-assign')::uuid,'Phone Screen',current_date-20,current_date-3);
 set constraints all immediate; alter table public.recruitment_logs enable trigger user;`);
 async function check(label){
 for(const u of (label==='upgrade'?users.slice(0,1):users)){ console.log(label+' '+u.role);
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${u.id}',false);set role authenticated;`);
  for(const scope of (u.role==='system_admin'?[{},{headerSite:'KT1',headerPic:'Alice',priorityOnly:false},{headerSite:'KT2'},{priorityOnly:true}]:[{}])){
   const core=(await db.query("select public.app_home_core_summary_v1($1) value",[JSON.stringify(scope)])).rows[0].value;
   const queue=(await db.query("select public.app_home_work_queue_v1($1) value",[JSON.stringify(scope)])).rows[0].value;
   for(const [metric,expected] of [['open',core.counts.openRequisitions],['aging',core.needsAction.overduePending],['sourcing',core.counts.staleSourcing],['urgent',queue.totalCount]]){
    let cursor=null,items=[],pages=0;
    do{
     const value=(await db.query("select public.app_home_metric_page_v1($1,$2,$3,$4,7) value",[metric,JSON.stringify(scope),cursor?.priority??null,cursor?.id??null])).rows[0].value;
     assert.equal(value.totalCount,expected,label+' '+u.role+' '+metric+' count parity');
     assert.ok(!JSON.stringify(value).includes('SECRET'),metric+' excludes secret context/IDs');
     items.push(...value.items);cursor=value.hasMore?value.nextCursor:null;assert.ok(++pages<30);
    }while(cursor);
    assert.equal(items.length,expected,metric+' all pages exact');
    assert.equal(new Set(items.map(x=>x.id)).size,items.length,'stable unique cursor identities');
    if(metric==='aging') for(const item of items) assert.ok(item.applicationId,'application detail identity');
   }
  }
 }
 }

 const viewSchema=fs.readFileSync(path.join(root,'supabase/schemas/29_confidentiality_primitives.sql'),'utf8');
 const optimizedView=viewSchema.slice(viewSchema.indexOf('create or replace view app_private.report_candidates '),viewSchema.indexOf('create or replace view app_private.report_change_logs'));
 const legacyView="create or replace view app_private.report_candidates with (security_invoker=true) as\r\n select (jsonb_populate_record(null::public.candidates,to_jsonb(c)||jsonb_build_object('group_id',case when exists(select 1 from public.position_groups g where g.group_id=c.group_id and not g.is_secret) then c.group_id end,'doc_group_id',case when exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) left join public.position_groups g using(group_id) where d.doc_group_id=c.doc_group_id and not r.is_secret and g.is_secret is not true) then c.doc_group_id end))).*\r\n from public.candidates c where not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id) or exists(select 1 from public.candidate_applications a join public.position_groups g using(group_id) where a.candidate_id=c.candidate_id and not g.is_secret);\r\n";
 for(const u of users){
  const results=[];
  for(const definition of [legacyView,fs.readFileSync(path.join(root,"supabase/migrations/20261115062118_home_candidate_projection.sql"),"utf8"),legacyView]){
   await db.exec('reset role;'+definition);
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[u.id]);await db.exec('set role authenticated');
   results.push({rows:(await db.query('select * from app_private.report_candidates order by candidate_id')).rows,core:(await db.query("select public.app_home_core_summary_v1('{}') value")).rows[0].value,urgent:(await db.query("select public.app_home_work_queue_v1('{}') value")).rows[0].value});
  }
  assert.deepEqual(results[0],results[1],'candidate masking and Home parity for '+u.role);
  assert.deepEqual(results[0],results[2],'rollback parity for '+u.role);
 }
 await db.exec('reset role;'+optimizedView);
 await check('fresh');
 await db.exec('reset role;drop function public.app_home_metric_page_v1(text,jsonb,integer,text,integer);');
 const migration=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('_home_metric_drilldowns.sql')).at(-1);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
 await check('upgrade');
 await checkWelcomeMessage('populated confidential fixture');
 await db.exec("reset role;drop function public.app_home_welcome_message_v1();");
 const messageMigration=fs.readdirSync(path.join(root,'supabase/migrations')).filter(file=>file.endsWith('_home_welcome_message.sql')).at(-1);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',messageMigration),'utf8'));
 await checkWelcomeMessage('forward migration');
 assert.equal((await db.query("select has_function_privilege('anon','public.app_home_welcome_message_v1()','execute') allowed")).rows[0].allowed,false);
 await db.exec("select set_config('request.jwt.claim.sub','',false);set role authenticated");
 await assert.rejects(db.query('select public.app_home_welcome_message_v1()'),/RECRUITMENT_READ_NOT_AUTHORIZED/);
 await db.exec('reset role');
 await db.exec("alter table public.offers disable trigger user;update public.offers set accepted_date=(now() at time zone 'Asia/Bangkok')::date;alter table public.offers enable trigger user;");
 await checkWelcomeMessage('accepted this Bangkok month');
 await db.exec("alter table public.offers disable trigger user;update public.offers set accepted_date=(now() at time zone 'Asia/Bangkok')::date+1;alter table public.offers enable trigger user;");
 await checkWelcomeMessage('future acceptance excluded');
 await db.exec("alter table public.offers disable trigger user;update public.offers set accepted_date=date_trunc('month',now() at time zone 'Asia/Bangkok')::date-1;alter table public.offers enable trigger user;");
 await checkWelcomeMessage('prior-month resolved close');
 await db.exec("alter table public.offers disable trigger user;update public.offers set accepted_date=null;insert into public.offers(candidate_id,application_id,doc_id,accepted_date) values('METRIC-C-1',md5('metric-secret-app')::uuid,'METRIC-SECRET-R',(now() at time zone 'Asia/Bangkok')::date);alter table public.offers enable trigger user;");
 await checkWelcomeMessage('prior-month close and accepted secret offer excluded');
 console.log('PASS: independent Welcome message exact ratio parity for four roles, empty/confidential/accepted/future fixtures, forward migration and unauthorized access.');
 await db.exec('reset role');
 assert.equal((await db.query("select has_function_privilege('anon','public.app_home_metric_page_v1(text,jsonb,integer,text,integer)','execute') allowed")).rows[0].allowed,false);
 await db.exec("select set_config('request.jwt.claim.sub','',false);set role authenticated;");
 await assert.rejects(db.query("select public.app_home_metric_page_v1('open')"),/RECRUITMENT_READ_NOT_AUTHORIZED/);
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${users[0].id}',false);set role authenticated;`);
 for(const q of ["public.app_home_metric_page_v1('bad')","public.app_home_metric_page_v1('open','{\"bad\":true}')","public.app_home_metric_page_v1('open','{}',null,null,51)","public.app_home_metric_page_v1('open','{}',1,null,25)"]) await assert.rejects(db.query('select '+q),/HOME_/);
 console.log('PASS: fresh + forward migration, four roles, all four exact metric counts, scoped reads, full keyset pagination >10 rows, superseded pending exclusion, shared secret journey exclusion, anonymous/missing authentication and invalid input rejection.');
 }finally{await db.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
