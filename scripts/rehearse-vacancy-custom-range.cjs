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
 const migrationFile=fs.readdirSync(path.join(root,'supabase/migrations')).filter(file=>file.endsWith('_dashboard_custom_range_history.sql')).at(-1);
 const migration=fs.readFileSync(path.join(root,'supabase/migrations',migrationFile),'utf8').replaceAll('\r\n','\n');
 const rollback=migration.replace('      exists(select 1 from app_private.report_requisition_logs l where l.doc_id=b.doc_id) has_logs,\n','').replace("and not (not v.has_logs and v.status='cancel')","and (v.last_status is not null or v.status is distinct from 'cancel')");
 fs.mkdirSync(path.join(root,'outputs'),{recursive:true});fs.writeFileSync(path.join(root,'outputs/dashboard-custom-history-rollback.sql'),rollback);
 await db.exec(rollback);await db.exec('set role authenticated');
 assert.deepEqual((await db.query("select app_private.dashboard_company_waterfall_v1('2026-11-07','2026-11-13','custom','{\"headerPic\":\"Future Cancel\"}') v")).rows[0].v,[],'reproduces prior historical omission');
 await db.exec('reset role');await db.exec(migration);
 const dates=['2026-11-07','2026-11-13'];
 for(const [i,role] of roles.entries()){
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[i]]);await db.exec('set role authenticated');
  const scope={headerPic:'Future Cancel'};
  const rows=(await db.query("select public.app_dashboard_active_requisitions_page_v1($1,$2,'custom','status',$3) v",[...dates,JSON.stringify(scope)])).rows[0].v;
  assert.equal(rows.total,1,role+' historical table includes future cancellation');
  const waterfall=(await db.query("select app_private.dashboard_company_waterfall_v1($1,$2,'custom',$3) v",[...dates,JSON.stringify(scope)])).rows[0].v;
  assert.equal(waterfall.find(row=>row.waterfall_category==='Week Start')?.vacancy_count,3,role+' custom Waterfall includes same future cancellation as table');
  const all=(await db.query("select public.app_dashboard_active_requisitions_page_v1($1,$2,'custom','status','{}') v",dates)).rows[0].v;
  assert.deepEqual(all.rows.map(r=>r.doc_id).sort(),['WEEK-A','WEEK-B','WEEK-C','WEEK-H','WEEK-I']);
  const movements=(await db.query("select app_private.dashboard_company_waterfall_v1($1,$2,'custom','{}') v",dates)).rows[0].v;
  assert.equal(movements.find(row=>row.waterfall_category==='Filled').vacancy_count,-2,role+' accepted offers include start and end');
  assert.equal(movements.find(row=>row.waterfall_category==='Open').vacancy_count,3,role+' PR dates include start and end');
  const oneDay=(await db.query("select public.app_dashboard_active_requisitions_page_v1($1,$1,'custom','status','{}') v",[dates[0]])).rows[0].v;
  assert.deepEqual(oneDay.rows.map(row=>row.doc_id).sort(),['WEEK-A','WEEK-B','WEEK-F','WEEK-H','WEEK-I'],role+' one-day snapshot');
  assert.equal(all.rows.find(r=>r.doc_id==='WEEK-H').filled_date,'2026-11-07');assert.equal(all.rows.find(r=>r.doc_id==='WEEK-I').filled_date,'2026-11-13');
  await assert.rejects(db.query("select public.app_dashboard_active_requisitions_page_v1($2,$1,'custom','status','{}')",dates),/REPORT_RANGE_INVALID/);
  await db.exec('reset role');
 }
 await db.exec('set role anon');await assert.rejects(db.query("select app_private.dashboard_company_waterfall_v1('2026-11-07','2026-11-13','custom','{}')"),/permission denied/);await db.exec('reset role');
 await db.exec(rollback);await db.exec(migration);
 console.log('PASS: current-schema custom range 7–13 November, all four roles, inclusive PR/close boundaries, future cancellation, missing PR, cancelled/closed/confidential exclusions and reversed range rejection.');
}finally{await db.close()}})().catch(e=>{console.error(e.message);process.exitCode=1});
