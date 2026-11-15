// Disposable full-schema before/after parity for the page-bounded process-history lookup.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {PGlite}=require(path.join(process.env.RECRUITMENT_DB_TOOLS||path.join(process.env.TEMP,'recruitment-db-tools'),'node_modules/@electric-sql/pglite'));
const root=path.resolve(__dirname,'..');
(async()=>{const db=new PGlite();try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create schema cron;create table cron.job(jobname text);create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;create function cron.unschedule(text) returns boolean language sql as $$select true$$;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;");
 for(const m of fs.readFileSync(path.join(root,'supabase/config.toml'),'utf8').matchAll(/"\.\/schemas\/([^"]+)"/g)){await db.exec(fs.readFileSync(path.join(root,'supabase/schemas',m[1]),'utf8').replace(/^create extension.*;\s*$/gm,''));}
 const roles=['system_admin','admin_recruiter','site_recruiter','viewer'],ids=roles.map((_,i)=>`b1000000-0000-4000-8000-00000000000${i+1}`);
 for(const [i,role] of roles.entries()){await db.query('insert into auth.users(id,email) values($1,$2)',[ids[i],`range-${i}@example.test`]);await db.query("update profiles set role=$1,site='HQ',nickname='Alice',full_name='Alice' where id=$2",[role,ids[i]]);}
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[0]]);
 await db.exec(`insert into requisitions(doc_id,site,department,position,level,head_count,status,pr_approved_date,person_in_charge,is_priority,is_secret) values
 ('WEEK-A','HQ','Ops','Future cancellation','3',3,'cancel','2026-11-01','Future Cancel',false,false),
 ('WEEK-B','HQ','Ops','Opened at start','3',2,'ongoing','2026-11-07','Alice',true,false),
 ('WEEK-C','HQ','Ops','Opened at end','3',1,'ongoing','2026-11-13','Alice',false,false),
 ('WEEK-D','HQ','Ops','Future opening','3',1,'ongoing','2026-11-14','Alice',false,false),
 ('WEEK-E','HQ','Ops','Missing PR','3',1,'ongoing',null,'Alice',false,false),
 ('WEEK-F','HQ','Ops','Cancelled within','3',1,'cancel','2026-11-01','Alice',false,false),
 ('WEEK-G','HQ','Ops','Closed before','3',1,'filled','2026-11-01','Alice',false,false),
 ('WEEK-H','HQ','Ops','Closed at start','3',1,'filled','2026-11-01','Alice',false,false),
 ('WEEK-I','HQ','Ops','Closed at end','3',1,'filled','2026-11-01','Alice',false,false),
 ('WEEK-SECRET','HQ','Ops','Confidential','3',99,'ongoing','2026-11-01','Future Cancel',false,true);
 alter table requisition_logs disable trigger user;
 insert into requisition_logs(doc_id,log_date,status) values('WEEK-A','2026-11-14','cancel'),('WEEK-F','2026-11-10','cancel'),('WEEK-G','2026-11-06','filled'),('WEEK-H','2026-11-07','filled'),('WEEK-I','2026-11-13','filled');
 alter table requisition_logs enable trigger user;`);
 await db.exec(`insert into position_groups(group_id,group_position) values('WEEK-GB','B'),('WEEK-GC','C');
 alter table document_groups disable trigger user;
 insert into document_groups(doc_group_id,doc_id,group_id,group_position) values('WEEK-DB','WEEK-B','WEEK-GB','B'),('WEEK-DC','WEEK-C','WEEK-GC','C');
 alter table document_groups enable trigger user;
 alter table candidates disable trigger user;
 insert into candidates(candidate_id,name,home_site,created_by) values('WEEK-CB','Synthetic B','HQ','${ids[0]}'),('WEEK-CC','Synthetic C','HQ','${ids[0]}');
 alter table candidates enable trigger user;alter table candidate_applications disable trigger user;
 insert into candidate_applications(application_id,candidate_id,group_id) values(md5('week-b')::uuid,'WEEK-CB','WEEK-GB'),(md5('week-c')::uuid,'WEEK-CC','WEEK-GC');
 alter table candidate_applications enable trigger user;alter table offers disable trigger user;
 insert into offers(candidate_id,application_id,doc_id,accepted_date) values('WEEK-CB',md5('week-b')::uuid,'WEEK-B','2026-11-07'),('WEEK-CC',md5('week-c')::uuid,'WEEK-C','2026-11-13');
 alter table offers enable trigger user;`);
 await db.exec(`
 insert into requisitions(doc_id,site,department,position,level,head_count,status,pr_approved_date,person_in_charge)
 select 'PAGE-'||lpad(n::text,3,'0'),'HQ','Ops','Page position '||n,'3',1,'ongoing','2026-11-07','Alice' from generate_series(1,32)n;
 alter table document_groups disable trigger user;
 insert into document_groups(doc_group_id,doc_id,group_id,group_position)
 select 'PAGE-LINK-'||n,'PAGE-'||lpad(n::text,3,'0'),'WEEK-GB','B' from generate_series(1,32)n;
 alter table document_groups enable trigger user;
 insert into candidate_application_assignments(assignment_id,application_id,group_id)
 values(md5('week-b-assignment')::uuid,md5('week-b')::uuid,'WEEK-GB'),(md5('week-c-assignment')::uuid,md5('week-c')::uuid,'WEEK-GC');
 insert into position_groups(group_id,group_position,is_secret) values('PAGE-SECRET','Confidential',true);
 alter table candidate_applications disable trigger user;
 insert into candidate_applications(application_id,candidate_id,group_id) values(md5('page-secret')::uuid,'WEEK-CB','PAGE-SECRET');
 alter table candidate_applications enable trigger user;
 insert into candidate_application_assignments(assignment_id,application_id,group_id) values(md5('page-secret-assignment')::uuid,md5('page-secret')::uuid,'PAGE-SECRET');
 alter table recruitment_logs disable trigger user;
 insert into recruitment_logs(candidate_id,application_id,entry_assignment_id,outcome_assignment_id,recruitment_process,log_date,outcome_date,result,outcome_recorded_at)
 values('WEEK-CB',md5('week-b')::uuid,md5('week-b-assignment')::uuid,md5('week-b-assignment')::uuid,'Phone Screen','2026-11-06','2026-11-08',1,'2026-11-08T12:00:00Z'),
 ('WEEK-CB',md5('week-b')::uuid,md5('week-b-assignment')::uuid,null,'HR Interview','2026-11-08',null,null,null),
 ('WEEK-CC',md5('week-c')::uuid,md5('week-c-assignment')::uuid,null,'Phone Screen','2026-11-13',null,null,null),
 ('WEEK-CB',md5('page-secret')::uuid,md5('page-secret-assignment')::uuid,null,'Test','2026-11-09',null,null,null);
 set constraints all immediate;alter table recruitment_logs enable trigger user;`);
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261115131614_dashboard_active_page_history_lookup.sql'),'utf8').replaceAll('\r\n','\n');
 const original=migration.replace(/    join lateral \(\n      select l\.\* from app_private\.report_recruitment_logs l\n      where l\.application_id=ca\.application_id and l\.candidate_id=c\.candidate_id offset 0\n    \) l on true/,'    join app_private.report_recruitment_logs l on l.candidate_id=c.candidate_id and l.application_id=ca.application_id');
 assert.notEqual(original,migration,'rollback reverses the bounded lookup');
 fs.mkdirSync(path.join(root,'outputs'),{recursive:true});fs.writeFileSync(path.join(root,'outputs/dashboard-active-page-rollback.sql'),original);
 const cases=[
  {},{scope:{headerSite:'HQ',headerPic:'Alice',priorityOnly:true,sites:['HQ'],departments:['Ops'],levels:['0-3']}},
  {scope:{headerSite:'KT2'}},{filters:{'HR Interview':'1'}},{sort:'HR Interview',direction:'desc'},
  {search:'Page position'},{filters:{position:'Page'},sort:'position',direction:'desc'},
  {filters:{status:'ongoing'},sort:'requisition_date',direction:'asc'},
 ];
 async function readAll(mode,test){const rows=[];let cursor=null,total=null;for(let page=0;page<10;page++){
  const result=(await db.query('select app_dashboard_active_requisitions_page_v1($1,$2,$3,$4,$5,$6,$7,25,$8,$9,$10,$11) v',
   ['2026-11-07','2026-11-13','custom',mode,JSON.stringify(test.scope||{}),cursor?.value??null,cursor?.id??null,test.search||'',JSON.stringify(test.filters||{}),test.sort??null,test.direction??null])).rows[0].v;
  if(total!==null)assert.equal(result.total,total);total=result.total;rows.push(...result.rows);if(!result.hasMore){assert.equal(rows.length,total);return {rows,total};}assert.ok(result.nextCursor);cursor=result.nextCursor;
 }throw Error('non-advancing pagination');}
 let comparisons=0;
 for(const [i,role] of roles.entries())for(const mode of ['status','activity','accum'])for(const test of cases){
  await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[i]]);await db.exec(original);await db.exec('set role authenticated');const before=await readAll(mode,test);
  await db.exec('reset role');await db.exec(migration);await db.exec('set role authenticated');const after=await readAll(mode,test);assert.deepEqual(after,before,`${role} ${mode} ${JSON.stringify(test)}`);comparisons++;
  for(const row of after.rows)assert.equal(row.stage_counts.Test,0,'confidential journey excluded');
  if(!Object.keys(test).length){assert.equal(after.total,37);const b=after.rows.find(row=>row.doc_id==='WEEK-B');assert.equal(b.stage_counts['HR Interview'],1);assert.equal(b.stage_counts['Phone Screen'],mode==='activity'?1:0);}
 }
 await db.exec('reset role;set role anon');await assert.rejects(db.query("select app_dashboard_active_requisitions_page_v1('2026-11-07','2026-11-13','custom','status')"),/permission denied/);
 await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role authenticated");await assert.rejects(db.query("select app_dashboard_active_requisitions_page_v1('2026-11-07','2026-11-13','custom','status')"),/RECRUITMENT_READ_NOT_AUTHORIZED/);
 await db.exec('reset role');await db.exec(original);await db.exec(migration);
 console.log(`PASS: ${comparisons} full-result comparisons across four roles, three stage modes, shared groups, private journeys, filters/search/sorts, all cursor pages, anonymous/missing-auth denial and rollback/reapply.`);
}finally{await db.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
