// Disposable PGlite parity check for Rejection event authorization materialization.
// No network or production database is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(path.join(process.env.TEMP, 'recruitment-db-tools/node_modules/@electric-sql/pglite'));

const root=path.resolve(__dirname,'..');
const base=fs.readFileSync(path.join(root,'supabase/migrations/20261101130623_dashboard_summaries.sql'),'utf8');
const current=fs.readFileSync(path.join(root,'supabase/schemas/61_dashboard_summaries.sql'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261102123300_rejection_distinct_authorization_precompute.sql'),'utf8');
const rejectionReportMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261101184800_rejection_id_alias_search.sql'),'utf8');
const fnName='create or replace function app_private.dashboard_rejection_events_v1(';
function block(source){
  const start=source.indexOf(fnName);
  const grantAt=source.indexOf('grant execute on function app_private.dashboard_rejection_events_v1',start);
  const end=source.indexOf(';',grantAt)+1;
  assert(start>=0&&grantAt>start&&end>grantAt,'event helper and ACL block exist');
  return source.slice(start,end).replaceAll('\r\n','\n').trimEnd();
}
const oldBlock=block(base),newBlock=block(current),migrationBlock=block(fs.readFileSync(path.join(root,'supabase/migrations/20261106032530_dashboard_report_loading.sql'),'utf8'));
const compatibilityStart=current.indexOf(fnName,current.indexOf(fnName)+fnName.length);
const compatibilityBlock=block(current.slice(compatibilityStart));
assert.equal(newBlock,migrationBlock,'Rejection helper migration matches schema61, including its ACL');
assert.match(newBlock,/language sql stable security invoker/i,'helper remains invoker');
assert.doesNotMatch(newBlock,/security\s+definer/i,'no privileged helper added');
assert.match(newBlock,/failure_logs as materialized/i);
assert.match(newBlock,/needed_candidate_ids as materialized/i);
assert.match(newBlock,/needed_application_ids as materialized/i);
assert.match(newBlock,/where app_private\.can_read_candidate\(c\.candidate_id\)/i);
assert.match(newBlock,/where app_private\.can_read_application\(a\.application_id\)/i);

async function main(){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema app_private; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
    create function app_private.is_recruitment_reader() returns boolean language sql stable as $$ select true $$;
    create table public.profiles(id uuid primary key);
    insert into public.profiles values ('00000000-0000-0000-0000-000000000001');
    create function app_private.can_read_candidate(text) returns boolean language sql stable as $$
      select $1 is distinct from nullif(current_setting('test.hidden_candidate',true),'')
    $$;
    create function app_private.can_read_application(uuid) returns boolean language sql stable as $$
      select $1 is distinct from nullif(current_setting('test.hidden_application',true),'')::uuid
    $$;
    create function app_private.can_read_requisition(text) returns boolean language sql stable as $$ select true $$;
    create function app_private.dashboard_json_compact_v1(jsonb) returns text language sql immutable as $$ select $1::text $$;
    create table public.requisitions(doc_id text primary key,site text,department text,position text,person_in_charge text,level text,is_priority boolean);
    create table public.candidates(candidate_id text primary key,name text,group_id text,doc_group_id text);
    create table public.candidate_applications(application_id uuid primary key,candidate_id text,group_id text);
    create table public.candidate_application_assignments(assignment_id uuid primary key,application_id uuid,group_id text,from_group_id text,started_at timestamptz);
    create table public.document_groups(doc_group_id text,group_id text,doc_id text);
    create table public.position_groups(group_id text,group_position text);
    create table public.recruitment_logs(log_id bigint primary key,candidate_id text,application_id uuid,result smallint,superseded_at timestamptz,superseded_by_stage_instance_id uuid,outcome_assignment_id uuid,failure_actor text,failure_reason_snapshot jsonb,failure_main_reason_id uuid,failure_detail_reason_id uuid,recruitment_process text,stage_instance_id uuid,round integer,outcome_date date,log_date date);
    insert into requisitions values
      ('REQ-1','KT1','Ops','Operator','Owner A','L2',false),('REQ-2','KT2','Ops','Technician','Owner B','L4',true);
    insert into candidates values
      ('CAN-1','Candidate One','GRP-SHARED',null),('CAN-2','Candidate Two','GRP-2',null),
      ('CAN-3','Candidate Missing App','GRP-SHARED',null),('CAN-4','Unresolved Candidate','GRP-ORPHAN',null),
      ('CAN-5','Undated Candidate','GRP-SHARED',null),('CAN-6','No Group','GRP-SHARED',null);
    insert into candidate_applications values
      ('10000000-0000-0000-0000-000000000001','CAN-1','GRP-SHARED'),
      ('10000000-0000-0000-0000-000000000002','CAN-2','GRP-2'),
      ('10000000-0000-0000-0000-000000000003','CAN-3','GRP-SHARED'),
      ('10000000-0000-0000-0000-000000000004','CAN-4','GRP-ORPHAN'),
      ('10000000-0000-0000-0000-000000000005','CAN-5','GRP-SHARED'),
      ('10000000-0000-0000-0000-000000000006','CAN-6','GRP-SHARED');
    insert into candidate_application_assignments values
      ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','GRP-2','GRP-SHARED','2026-09-01'),
      ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','GRP-SHARED','GRP-2','2026-10-01');
    insert into document_groups values
      ('DG-1','GRP-SHARED','REQ-1'),('DG-2','GRP-SHARED','REQ-2'),('DG-3','GRP-2','REQ-2');
    insert into position_groups values ('GRP-SHARED','Shared Position'),('GRP-2','Second Position');
    insert into recruitment_logs values
      (1,'CAN-1','10000000-0000-0000-0000-000000000001',0,null,null,'20000000-0000-0000-0000-000000000001','company','{"main_en":"Skills","main_th":"ทักษะ","detail_en":"Experience","detail_th":"ประสบการณ์"}',null,null,'HR Interview','30000000-0000-0000-0000-000000000001',1,'2026-10-04','2026-10-02'),
      (2,'CAN-1','10000000-0000-0000-0000-000000000001',0,null,null,null,'candidate',null,null,null,'Phone Screen',null,1,null,'2026-10-03'),
      (3,'CAN-1','10000000-0000-0000-0000-000000000001',0,'2026-10-06',null,null,'company',null,null,null,'Test',null,1,'2026-10-05','2026-10-04'),
      (4,'CAN-1','10000000-0000-0000-0000-000000000001',0,null,'40000000-0000-0000-0000-000000000004',null,'company',null,null,null,'Offer',null,1,'2026-10-05','2026-10-04'),
      (5,'CAN-2','10000000-0000-0000-0000-000000000001',0,null,null,null,'candidate',null,null,null,'HR Interview',null,1,'2026-10-06','2026-10-05'),
      (6,'CAN-3','10000000-0000-0000-0000-000000000099',0,null,null,null,'other',null,null,null,'HR Interview',null,1,'2026-10-06','2026-10-05'),
      (7,'CAN-3',null,0,null,null,null,'other',null,null,null,'HR Interview',null,1,'2026-10-07','2026-10-06'),
      (8,'CAN-4','10000000-0000-0000-0000-000000000004',0,null,null,null,'other',null,null,null,'Line Interview',null,1,null,null),
      (9,'CAN-5','10000000-0000-0000-0000-000000000005',0,null,null,null,'company','{"main_en":"","main_th":"   "}',null,null,'Offer','30000000-0000-0000-0000-000000000009',1,null,null),
      (10,'CAN-6','10000000-0000-0000-0000-000000000006',0,null,null,null,'candidate',null,null,null,'HR Interview',null,1,'2026-10-08','2026-10-07');
  `);
  const rows=async()=> (await db.query(`select * from app_private.dashboard_rejection_events_v1('2026-10-01','2026-10-31',$1::jsonb) order by log_id`,[JSON.stringify({})])).rows;
  await db.exec(oldBlock);
  const originalGlobal=await rows();
  assert.deepEqual(originalGlobal.map(r=>r.log_id),[1,2,7,8,9,10],'legacy preserves null-application rows while excluding missing/mismatched and both superseded forms');
  const originalSite=(await db.query(`select * from app_private.dashboard_rejection_events_v1('2026-10-01','2026-10-31','{"headerSite":"KT1"}'::jsonb) order by log_id`)).rows;
  const originalFilter=(await db.query(`select * from app_private.dashboard_rejection_events_v1('2026-10-01','2026-10-31','{"sites":["KT1"],"departments":["Ops"],"levels":["2-2"]}'::jsonb) order by log_id`)).rows;
  await db.exec(rejectionReportMigration);
  const summarySql=`select public.app_dashboard_rejection_summary_v1('2026-10-01','2026-10-31',$1::jsonb,$2::jsonb) data`;
  const pageSql=`select public.app_dashboard_rejection_page_v1('2026-10-01','2026-10-31',$1::jsonb,$2::jsonb,'date-asc',null,null,25) data`;
  const beforeSummary=[];const beforePages=[];
  for(const [scope,filters] of [[{},{}],[{headerSite:'KT1'},{actor:'company'}],[{sites:['KT1'],departments:['Ops'],levels:['2-2']},{stage:'HR Interview'}]]){
    beforeSummary.push((await db.query(summarySql,[JSON.stringify(scope),JSON.stringify(filters)])).rows[0].data);
    beforePages.push((await db.query(pageSql,[JSON.stringify(scope),JSON.stringify(filters)])).rows[0].data);
  }
  await db.exec(newBlock); await db.exec(compatibilityBlock);
  for(const [label,sql,params,baseline] of [
    ['global',`select * from app_private.dashboard_rejection_events_v1('2026-10-01','2026-10-31',$1::jsonb) order by log_id`,[JSON.stringify({})],originalGlobal],
    ['site',`select * from app_private.dashboard_rejection_events_v1('2026-10-01','2026-10-31','{"headerSite":"KT1"}'::jsonb) order by log_id`,[],originalSite],
    ['combined filters',`select * from app_private.dashboard_rejection_events_v1('2026-10-01','2026-10-31','{"sites":["KT1"],"departments":["Ops"],"levels":["2-2"]}'::jsonb) order by log_id`,[],originalFilter]
  ]) assert.deepEqual((await db.query(sql,params)).rows,baseline,`${label} output matches legacy helper exactly`);
  let index=0;
  for(const [scope,filters] of [[{},{}],[{headerSite:'KT1'},{actor:'company'}],[{sites:['KT1'],departments:['Ops'],levels:['2-2']},{stage:'HR Interview'}]]){
    assert.deepEqual((await db.query(summarySql,[JSON.stringify(scope),JSON.stringify(filters)])).rows[0].data,beforeSummary[index],`summary same-period/filter output ${index+1} is unchanged`);
    assert.deepEqual((await db.query(pageSql,[JSON.stringify(scope),JSON.stringify(filters)])).rows[0].data,beforePages[index],`page same-period/filter output ${index+1} is unchanged`);
    index++;
  }
  const global=(await db.query(`select * from app_private.dashboard_rejection_events_v1('2026-10-01','2026-10-31','{}'::jsonb) order by log_id`)).rows;
  assert.equal(global.find(r=>r.log_id===1).group_id,'GRP-2','outcome assignment still attributes the historical destination group');
  assert.equal(global.find(r=>r.log_id===7).application_id,null,'null-application historical row remains included');
  assert.equal(global.find(r=>r.log_id===8).unresolved_context,true,'orphan group remains visible as unresolved context');
  assert.equal(global.find(r=>r.log_id===9).undated,true,'missing dated outcome remains a diagnostic event');
  assert.equal(global.find(r=>r.log_id===9).actor,'company','unclassified reason does not alter classified actor');
  assert.equal(global.find(r=>r.log_id===9).main_en,'Unclassified reason','empty translated reason remains unclassified');
  await db.query(`select set_config('test.hidden_candidate','CAN-1',false)`);
  await db.exec(oldBlock);
  const hiddenCandidateOld=await rows();
  await db.exec(newBlock);
  assert.deepEqual(await rows(),hiddenCandidateOld,'candidate helper scope remains identical when one candidate is hidden');
  await db.query(`select set_config('test.hidden_candidate','',false)`);
  await db.query(`select set_config('test.hidden_application','10000000-0000-0000-0000-000000000001',false)`);
  await db.exec(oldBlock);
  const hiddenApplicationOld=await rows();
  await db.exec(newBlock);
  assert.deepEqual(await rows(),hiddenApplicationOld,'application helper scope remains identical while null-application rows survive');
  assert((await rows()).some(r=>r.log_id===7),'null application event is not removed by application authorization materialization');
  const authKeySql=`with failure_logs as materialized (select l.* from public.recruitment_logs l where l.result=0 and l.superseded_at is null and l.superseded_by_stage_instance_id is null),
    needed_candidate_ids as materialized (select distinct candidate_id from failure_logs),
    authorized_candidates as materialized (select c.candidate_id from public.candidates c join needed_candidate_ids n using(candidate_id) where app_private.can_read_candidate(c.candidate_id)),
    needed_application_ids as materialized (select distinct application_id,candidate_id from failure_logs where application_id is not null),
    authorized_applications as materialized (select a.application_id from public.candidate_applications a join needed_application_ids n using(application_id,candidate_id) where app_private.can_read_application(a.application_id))
    select (select count(*) from authorized_candidates)+(select count(*) from authorized_applications) authorized_keys`;
  const authPlan=(await db.query(`explain (analyze, format json) ${authKeySql}`)).rows[0]['QUERY PLAN'][0];
  const ctes=[];const visit=node=>{if(node['CTE Name'])ctes.push({name:node['CTE Name'],loops:node['Actual Loops'],rows:node['Actual Rows'],ms:Number(node['Actual Total Time']?.toFixed(3)??0)});for(const child of node.Plans??[])visit(child)};visit(authPlan.Plan);
  for(const required of ['failure_logs','needed_candidate_ids','authorized_candidates','needed_application_ids','authorized_applications']) assert(ctes.some(node=>node.name===required),`inner plan materializes ${required}`);
  process.stdout.write(JSON.stringify({status:'pass',test:'rejection auth materialization parity',legacy_rows:originalGlobal.length,site_rows:originalSite.length,combined_filter_rows:originalFilter.length,report_filter_sets:beforeSummary.length,report_page_sets:beforePages.length,authorization_inner_plan_execution_ms:Number(authPlan['Execution Time'].toFixed(3)),authorization_ctes:ctes,security:'invoker; existing candidate/application/requisition helpers unchanged'},null,2)+'\n');
  await db.close();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
