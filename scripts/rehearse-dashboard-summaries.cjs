// Disposable PGlite contract check for summary DTOs and auth boundaries. Never connects to a server.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const pnpmModules = path.join(__dirname, '..', 'node_modules', '.pnpm');
const typescriptPackage = fs.existsSync(path.join(__dirname, '..', 'node_modules', 'typescript')) ? path.join(__dirname, '..', 'node_modules', 'typescript') : path.join(pnpmModules, fs.readdirSync(pnpmModules).find(name => name.startsWith('typescript@')), 'node_modules', 'typescript');
const ts = require(typescriptPackage);
const { PGlite } = require(path.join(process.env.TEMP, 'recruitment-db-tools/node_modules/@electric-sql/pglite'));

const db = new PGlite();
const root = path.resolve(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'supabase/schemas/61_dashboard_summaries.sql'), 'utf8').replaceAll('\r\n','\n');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261101130623_dashboard_summaries.sql'), 'utf8');
const qualityScopeBaseMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261102113000_home_quality_detail_scope.sql'), 'utf8');
const qualityScopeMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261102114500_home_quality_exact_group_scope.sql'), 'utf8');
const qualityPrecomputeMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261102123000_home_quality_duplicate_key_precompute.sql'), 'utf8');
const ownerOptionsMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261101183700_dashboard_owner_filter_options.sql'), 'utf8');
const rejectionAliasMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261101184800_rejection_id_alias_search.sql'), 'utf8');
const companyFeed = fs.readFileSync(path.join(root, 'supabase/schemas/55_dashboard_report.sql'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/fixtures/dashboard-summaries.json'), 'utf8'));
const qualityStart = schema.indexOf('create or replace function public.app_home_quality_page_v1(');
const qualityEnd = schema.indexOf('-- Compact sourcing chart inputs', qualityStart);
assert.ok(qualityStart >= 0 && qualityEnd > qualityStart, 'quality function block exists in declarative schema');
assert.equal(qualityPrecomputeMigration.replaceAll('\r\n','\n').trimEnd(), schema.slice(qualityStart, qualityEnd).trimEnd(), 'quality precompute migration matches the declarative function and ACL block');
const optionsStart = schema.indexOf('create or replace function app_private.dashboard_filter_options_v1(');
const optionsEnd = schema.indexOf('-- Database aggregates for the Pipeline funnel', optionsStart);
assert.ok(optionsStart >= 0 && optionsEnd > optionsStart, 'filter options function block exists in declarative schema');
assert.equal(ownerOptionsMigration.replaceAll('\r\n','\n').replace(/^begin;\s*/, '').replace(/\s*commit;\s*$/, '').trimEnd(), schema.slice(optionsStart, optionsEnd).trimEnd(), 'owner options migration matches the declarative function and ACL block');
assert.match(ownerOptionsMigration, /app_dashboard_company_report\(\)/, 'owner options derive from the existing authenticated company feed');
assert.doesNotMatch(ownerOptionsMigration, /security\s+definer/i, 'owner options do not add privileged execution');
assert.doesNotMatch(ownerOptionsMigration, /from\s+public\.requisitions/i, 'owner options do not bypass requisition RLS with a direct table scan');
const rejectionStart = schema.indexOf('create or replace function public.app_dashboard_rejection_summary_v1(');
const rejectionEnd = schema.indexOf('-- Home queue is a compact ranked projection', rejectionStart);
assert.ok(rejectionStart >= 0 && rejectionEnd > rejectionStart, 'Rejection summary/page functions exist in declarative schema');
const rejectionMigrationBody = rejectionAliasMigration.replaceAll('\r\n','\n').replace(/^begin;\s*/, '').replace(/\s*commit;\s*$/, '').trimEnd();
const rejectionSchemaBody = schema.slice(rejectionStart, rejectionEnd).trimEnd();
if (rejectionMigrationBody !== rejectionSchemaBody) {
  let mismatch = 0; while (mismatch < Math.min(rejectionMigrationBody.length, rejectionSchemaBody.length) && rejectionMigrationBody[mismatch] === rejectionSchemaBody[mismatch]) mismatch++;
  throw new Error(`Rejection migration/schema mismatch at ${mismatch}; migration ${rejectionMigrationBody.length}, schema ${rejectionSchemaBody.length}`);
}
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const file = path.join(root, 'src', request.slice(2)) + '.ts';
    if (fs.existsSync(file)) return file;
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpile(fs.readFileSync(filename, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }), filename);

async function main() {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema app_private; grant usage on schema app_private to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),'')::uuid,'00000000-0000-0000-0000-000000000001'::uuid) $$;
    create function app_private.is_recruitment_reader() returns boolean language sql stable as $$ select true $$;
    create function app_private.can_read_candidate(text) returns boolean language sql stable as $$ select coalesce(current_setting('test.candidate_access',true),'true') <> 'false' and $1 is distinct from nullif(current_setting('test.hidden_candidate',true),'') $$;
    create function app_private.can_read_application(uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.application_access',true),'true') <> 'false' $$;
    create function app_private.can_read_requisition(text) returns boolean language sql stable as $$ select coalesce(current_setting('test.requisition_access',true),'true') <> 'false' $$;
    create function app_private.can_read_sourcing_group(text) returns boolean language sql stable as $$ select coalesce(current_setting('test.sourcing_access',true),'true') <> 'false' $$;
    create table public.profiles(id uuid primary key,role text,site text);
    grant select on public.profiles to authenticated;
    create table public.requisitions(doc_id text primary key,is_priority boolean,pr_approved_date date,site text,position text,department text,section text,level text,head_count integer,person_in_charge text,request_type text,status text,created_at timestamptz,updated_at timestamptz);
    create table public.requisition_logs(log_id bigint primary key,doc_id text,log_date date,status text,remark text,created_at timestamptz);
    create table public.offers(offer_id bigint primary key,candidate_id text,doc_id text,application_id uuid,accepted_date date,first_working_date date,start_confirmation text,start_confirmed_at timestamptz,remark text,created_at timestamptz,updated_at timestamptz);
    create table public.candidates(candidate_id text primary key,name text,nickname text,channel text,group_id text,doc_group_id text);
    create table public.candidate_applications(application_id uuid primary key,candidate_id text,group_id text,state text);
    create table public.document_groups(doc_group_id text,doc_id text,group_id text);
    create table public.position_groups(group_id text,group_position text,channel_fb boolean default false,channel_jobthai boolean default false,channel_jobtopgun boolean default false,channel_jobdb boolean default false,channel_jobbkk boolean default false,channel_linkedin boolean default false,channel_walkin boolean default false,channel_referral boolean default false,channel_others boolean default false);
    create table public.recruitment_logs(log_id bigint primary key,candidate_id text,application_id uuid,result smallint,superseded_at timestamptz,superseded_by_stage_instance_id uuid,recruitment_process text,estimated_action_date date,round integer,log_date date,outcome_date date,stage_instance_id uuid unique,interviewer text,remark text,outcome_remark text,updated_at timestamptz,entry_assignment_id uuid,outcome_assignment_id uuid,failure_actor text,failure_main_reason_id uuid,failure_detail_reason_id uuid,failure_reason_snapshot jsonb);
    create table public.sourcing_weekly_updates(group_id text,week_start date,updated_at timestamptz,channel_fb boolean default false,channel_jobthai boolean default false,channel_jobtopgun boolean default false,channel_jobdb boolean default false,channel_jobbkk boolean default false,channel_linkedin boolean default false,channel_walkin boolean default false,channel_referral boolean default false,channel_others boolean default false,applicants_fb integer,applicants_jobthai integer,applicants_jobtopgun integer,applicants_jobdb integer,applicants_jobbkk integer,applicants_linkedin integer,applicants_walkin integer,applicants_referral integer,applicants_others integer);
    create table public.candidate_application_assignments(assignment_id uuid,application_id uuid,group_id text,from_group_id text,started_at timestamptz);
    create table public.change_logs(log_id bigint,entity text,entity_id text,action text,changed_at timestamptz,changed_by_email text,old_data jsonb,new_data jsonb);
    insert into profiles values ('00000000-0000-0000-0000-000000000001','system_admin',null),('00000000-0000-0000-0000-000000000002','site_recruiter','KT1');
    insert into requisitions values
      ('REQ-CURRENT',true,'2026-07-01','KT1','Operator','Production','Line','L0',2,'Recruiter A','New','open','2026-06-25T00:00:00Z',now()),
      ('REQ-PRIOR',false,'2026-06-01','KT2','Technician','Maintenance','Plant','L4',1,'Recruiter B','New','open','2026-05-20T00:00:00Z',now()),
      ('REQ-OPEN',false,'2026-08-01','KT1','Assistant','Operations','Plant','L4',1,'Recruiter A','New','open','2026-07-01T00:00:00Z',now());
    insert into requisition_logs values (1,'REQ-CURRENT','2026-07-01','open',null,now()),(2,'REQ-PRIOR','2026-06-01','open',null,now());
    insert into offers values
      (1,'CAN-1','REQ-CURRENT',null,'2026-07-10','2026-08-10',null,null,null,now(),now()),
      (2,'CAN-2','REQ-CURRENT','10000000-0000-0000-0000-000000000002','2026-07-21','2026-07-28','started','2026-07-28T03:00:00Z',null,now(),now()),
      (3,'CAN-3','REQ-CURRENT',null,'2026-07-20','2026-07-30','did_not_start','2026-07-25T03:00:00Z',null,now(),now()),
      (4,'CAN-4','REQ-PRIOR',null,'2026-06-15','2026-06-30',null,null,null,now(),now());
    insert into candidates values ('CAN-1','Test Candidate','TC',' Facebook ','GRP-1',null),('CAN-2','Started Candidate','SC','JobThai','GRP-1',null),('CAN-3','Restart Candidate',null,'Others','GRP-1',null),('CAN-4','Prior Candidate',null,'Others','GRP-1',null);
    insert into candidate_applications values ('10000000-0000-0000-0000-000000000001','CAN-1','GRP-1','active'),('10000000-0000-0000-0000-000000000002','CAN-2','GRP-1','active');
    insert into document_groups values ('DG-1','REQ-CURRENT','GRP-1');
    insert into position_groups(group_id,group_position) values ('GRP-1','Operator');
    insert into recruitment_logs(log_id,candidate_id,application_id,result,superseded_at,superseded_by_stage_instance_id,recruitment_process,estimated_action_date,round,log_date,outcome_date,stage_instance_id,interviewer,remark,updated_at) values
      (10,'CAN-1','10000000-0000-0000-0000-000000000001',null,null,null,'Phone Screen','2026-07-22',1,'2026-07-01',null,'20000000-0000-0000-0000-000000000001','Interviewer A','Follow up','2026-07-01T00:00:00Z'),
      (11,'CAN-1','10000000-0000-0000-0000-000000000001',1,null,null,'Phone Screen',null,1,'2026-07-15','2026-07-15','20000000-0000-0000-0000-000000000011','Interviewer A','Passed','2026-07-15T00:00:00Z'),
      (12,'CAN-2','10000000-0000-0000-0000-000000000002',1,null,null,'Phone Screen',null,1,'2026-07-02','2026-07-05','20000000-0000-0000-0000-000000000012','Interviewer B','Passed','2026-07-05T00:00:00Z'),
      (13,'CAN-2','10000000-0000-0000-0000-000000000002',null,null,null,'Phone Screen','2026-07-28',2,'2026-07-20',null,'20000000-0000-0000-0000-000000000013','Interviewer B','Pending round 2','2026-07-20T00:00:00Z');
  `);
  await db.exec(`alter table public.candidates add column created_at timestamptz default '2026-06-01T00:00:00Z';
    alter table public.candidate_applications add column created_at timestamptz default now();
    insert into public.candidate_application_assignments(assignment_id,application_id,group_id,from_group_id,started_at) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','GRP-1',null,'2026-06-01T00:00:00Z');
    insert into public.candidate_application_assignments(assignment_id,application_id,group_id,from_group_id,started_at) values ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','GRP-1','GRP-OLD','2026-07-01T00:00:00Z');
    update public.recruitment_logs set entry_assignment_id='30000000-0000-0000-0000-000000000001',outcome_assignment_id=case when result is not null then '30000000-0000-0000-0000-000000000001'::uuid end where application_id='10000000-0000-0000-0000-000000000001';
    update public.recruitment_logs set entry_assignment_id='30000000-0000-0000-0000-000000000002',outcome_assignment_id=case when result is not null then '30000000-0000-0000-0000-000000000002'::uuid end where application_id='10000000-0000-0000-0000-000000000002'`);
  await db.exec(companyFeed);
  await db.exec(migration);
  await db.exec(ownerOptionsMigration);
  await db.exec(rejectionAliasMigration);
  await db.exec(qualityScopeBaseMigration);
  await db.exec(qualityScopeMigration);
  await db.exec(qualityPrecomputeMigration);
  const query = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const {loadBottleneckPage}=require(path.join(root,'src/lib/dashboard-summary-client.ts'));
  const sqlQueueEnvelope={rows:[],hasMore:false,hasMoreBefore:false,nextCursor:null,previousCursor:null};
  const queueClient={supabaseUrl:'http://disposable.invalid',auth:{getSession:async()=>({data:{session:{user:{id:'00000000-0000-0000-0000-000000000001'}}}})},rpc:async(name,args)=>{
    assert.equal(name,'app_dashboard_bottleneck_queue_v1');assert.equal(args.p_limit,20);return {data:sqlQueueEnvelope,error:null};
  }};
  const bridgedQueue=await loadBottleneckPage(queueClient,{asOf:'2026-07-31',scope:{headerSite:'',headerPic:'',priorityOnly:false,sites:[],departments:[],levels:[]},channel:'all',stage:'',status:'all',pic:'',search:'',profileKey:'fixture-profile'});
  assert.deepEqual(bridgedQueue,sqlQueueEnvelope,'current Bottleneck client accepts SQL cursor envelope without requiring a nonexistent total field');
  const activeReqPage=(await query(`select public.app_dashboard_active_requisitions_page_v1('2026-07-01','2026-07-31','custom','status','{}'::jsonb,null,null,25) as data`)).data;
  assert.equal(activeReqPage.total,1,'active requisition page applies historical report eligibility rather than current list state');
  assert.equal(activeReqPage.rows[0].doc_id,'REQ-CURRENT');
  assert.equal(activeReqPage.rows[0].stage_counts['Phone Screen'],2,'active requisition stage counts preserve distinct candidates across repeated rounds and assignment transfer');
  assert.deepEqual((await query(`select public.app_dashboard_filter_options_v1('{}'::jsonb) as data`)).data.owners,['Recruiter A','Recruiter B'],'authorized options include distinct normalized requisition owners');
  assert.deepEqual((await query(`select public.app_dashboard_filter_options_v1('{"sites":["KT1"]}'::jsonb) as data`)).data.owners,['Recruiter A'],'owner options honor selected site scope');
  await db.exec(`grant usage on schema auth to authenticated; set role authenticated`);
  assert.deepEqual((await query(`select public.app_dashboard_filter_options_v1('{}'::jsonb) as data`)).data.owners,['Recruiter A','Recruiter B'],'authenticated caller receives options from the guarded report feed');
  await db.exec(`reset role; set role anon`);
  await assert.rejects(query(`select public.app_dashboard_filter_options_v1('{}'::jsonb)`),/permission denied|AUTHENTICATED_PROFILE_REQUIRED/i,'anon caller cannot execute owner options');
  await db.exec(`reset role`);
  const stagePage=(await query(`select public.app_dashboard_active_requisition_candidates_v1('REQ-CURRENT','Phone Screen','2026-07-01','2026-07-31','2026-07-01','status',null,null,1) as data`)).data;
  assert.equal(stagePage.total,2);assert.equal(stagePage.matches[0].candidateId,'CAN-2');assert(stagePage.hasMore&&stagePage.nextCursor,'repeated-round drilldown returns a bounded candidate page');
  const stageNext=(await query(`select public.app_dashboard_active_requisition_candidates_v1('REQ-CURRENT','Phone Screen','2026-07-01','2026-07-31','2026-07-01','status',$1,$2,1) as data`,[stagePage.nextCursor.name,stagePage.nextCursor.applicationId])).data;
  assert.equal(stageNext.total,2);assert.equal(stageNext.matches[0].candidateId,'CAN-1');assert.equal(stageNext.hasMore,false,'application cursor traverses the transferred journey without duplicate candidates');
  for(const mode of ['activity','accum']){
    const modePage=(await query(`select public.app_dashboard_active_requisition_candidates_v1('REQ-CURRENT','Phone Screen','2026-07-01','2026-07-31','2026-07-01',$1,null,null,25) as data`,[mode])).data;
    assert.equal(modePage.total,2,`${mode} stage candidate page preserves distinct transferred journeys across repeated rounds`);
    const modeReport=(await query(`select public.app_dashboard_active_requisitions_page_v1('2026-07-01','2026-07-31','custom',$1,'{}'::jsonb,null,null,25) as data`,[mode])).data;
    assert.equal(modeReport.rows[0].stage_counts['Phone Screen'],2,`${mode} report rows match the distinct candidate count across repeated rounds`);
  }
  await query(`select set_config('test.requisition_access','false',false)`);
  assert.equal((await query(`select public.app_dashboard_active_requisitions_page_v1('2026-07-01','2026-07-31','custom','status','{}'::jsonb,null,null,25) as data`)).data.total,0,'active requisition report respects requisition authorization');
  await assert.rejects(query(`select public.app_dashboard_active_requisition_candidates_v1('REQ-CURRENT','Phone Screen','2026-07-01','2026-07-31','2026-07-01','status',null,null,25)`),/RECRUITMENT_READ_NOT_AUTHORIZED/,'row drilldown checks requisition authorization before candidate projection');
  await query(`select set_config('test.requisition_access','true',false)`);
  const summary = (await query(`select public.app_dashboard_performance_summary_v1($1,$2,$3,$4,'custom','{}'::jsonb) as data`, [fixture.performance.current.start, fixture.performance.current.end, fixture.performance.prior.start, fixture.performance.prior.end])).data;
  const { buildPerformanceReport, performanceBand } = require(path.join(root, 'src/lib/recruitment-performance.ts'));
  const reportRequisitions = [
    { doc_id:'REQ-CURRENT',is_priority:true,pr_approved_date:'2026-07-01',site:'KT1',position:'Operator',department:'Production',section:'Line',level:'L0',head_count:2,person_in_charge:'Recruiter A',request_type:'New',status:'open',created_at:'2026-06-25T00:00:00Z',sla_restart_date:'2026-07-25',open_headcount:0,accepted_count:2,sourcing_group_ids:[],candidate_count:0 },
    { doc_id:'REQ-PRIOR',is_priority:false,pr_approved_date:'2026-06-01',site:'KT2',position:'Technician',department:'Maintenance',section:'Plant',level:'L4',head_count:1,person_in_charge:'Recruiter B',request_type:'New',status:'open',created_at:'2026-05-20T00:00:00Z',sla_restart_date:null,open_headcount:0,accepted_count:1,sourcing_group_ids:[],candidate_count:0 }
  ];
  const reportOffers = [
    { offer_id:1,candidate_id:null,doc_id:'REQ-CURRENT',accepted_date:'2026-07-10',first_working_date:'2026-08-10',start_confirmation:null,start_confirmed_at:null,created_at:'',updated_at:'',remark:null,start_confirmed_by:null,start_confirmation_reason:null },
    { offer_id:2,candidate_id:null,doc_id:'REQ-CURRENT',accepted_date:'2026-07-21',first_working_date:'2026-07-28',start_confirmation:'started',start_confirmed_at:'2026-07-28T03:00:00Z',created_at:'',updated_at:'',remark:null,start_confirmed_by:null,start_confirmation_reason:null },
    { offer_id:3,candidate_id:null,doc_id:'REQ-CURRENT',accepted_date:'2026-07-20',first_working_date:'2026-07-30',start_confirmation:'did_not_start',start_confirmed_at:'2026-07-25T03:00:00Z',created_at:'',updated_at:'',remark:null,start_confirmed_by:null,start_confirmation_reason:null },
    { offer_id:4,candidate_id:null,doc_id:'REQ-PRIOR',accepted_date:'2026-06-15',first_working_date:'2026-06-30',start_confirmation:null,start_confirmed_at:null,created_at:'',updated_at:'',remark:null,start_confirmed_by:null,start_confirmation_reason:null }
  ];
  const tsData = { requisition_logs:[{log_id:1,doc_id:'REQ-CURRENT',log_date:'2026-07-01',status:'open'},{log_id:2,doc_id:'REQ-PRIOR',log_date:'2026-06-01',status:'open'}], offers:reportOffers };
  const { isReportEligible, requisitionSnapshotAt, dateOnly, validDateOnly }=require(path.join(root,'src/lib/dashboard-report-eligibility.ts'));
  const tsEligibleRows=reportRequisitions.filter(row=>isReportEligible(row,tsData,'2026-07-01','2026-07-31','custom'));
  assert.equal(activeReqPage.total,tsEligibleRows.length,'bounded active requisition SQL population matches the actual eligibility/snapshot builder');
  assert.deepEqual(activeReqPage.rows.map(row=>row.doc_id),tsEligibleRows.map(row=>row.doc_id),'bounded active requisition rows preserve eligible builder identities and ordering on fixture');
  const tsCurrent = buildPerformanceReport(tsData, reportRequisitions, reportOffers, {start:fixture.performance.current.start,end:fixture.performance.current.end}, 'custom');
  const tsPrior = buildPerformanceReport(tsData, reportRequisitions, reportOffers, {start:fixture.performance.prior.start,end:fixture.performance.prior.end}, 'custom');
  assert.equal(summary.current.metrics.filled, tsCurrent.metrics.filled, 'current SQL filled matches TypeScript model');
  assert.equal(summary.current.metrics.onTime, tsCurrent.metrics.onTime, 'current SQL SLA matches TypeScript model');
  assert.equal(summary.current.metrics.avgTimeToFill, tsCurrent.metrics.avgTimeToFill, 'current SQL fill time matches TypeScript model');
  assert.equal(summary.prior.metrics.filled, tsPrior.metrics.filled, 'prior SQL filled matches TypeScript model');
  assert.equal(summary.current.metrics.vacancies, fixture.performance.current.expectedVacancies);
  assert.equal(summary.current.metrics.filled, fixture.performance.current.expectedFilled);
  assert.equal(summary.current.metrics.open, fixture.performance.current.expectedOpen);
  assert.equal(summary.current.metrics.onTime, fixture.performance.current.expectedOnTime);
  assert.equal(Number(summary.current.metrics.avgTimeToFill), fixture.performance.current.expectedAvgTimeToFill);
  assert.equal(summary.prior.metrics.vacancies, fixture.performance.prior.expectedVacancies);
  assert.equal(summary.prior.metrics.filled, fixture.performance.prior.expectedFilled);
  assert.equal(summary.current.cells.length, 1);
  assert.deepEqual(summary.current.sites, ['KT1']);
  const scoped = (await query(`select public.app_dashboard_performance_summary_v1($1,$2,$3,$4,'custom',$5::jsonb) as data`, [fixture.performance.current.start, fixture.performance.current.end, fixture.performance.prior.start, fixture.performance.prior.end, JSON.stringify({ sites: ['KT2'] })])).data;
  assert.equal(scoped.current.metrics.vacancies, 0);
  assert.deepEqual(scoped.current.cells, []);
  const events = (await query(`select public.app_recruitment_calendar_v1($1,$2,'{}'::jsonb) as data`, [fixture.calendar.start, fixture.calendar.end])).data.events;
  assert.equal(events.length, fixture.calendar.expectedEvents+1,'repeated-round SQL stage fixture adds its one dated outcome calendar event');
  assert(events.some(row => row.id === 'log:10' && row.candidateName === 'Test Candidate (TC)' && row.logId === 10 && row.stageInstanceId === '20000000-0000-0000-0000-000000000001' && row.interviewer === 'Interviewer A' && row.remark === 'Follow up'));
  await assert.rejects(query(`select public.app_recruitment_calendar_v1('2026-07-01','2026-07-31','{}'::jsonb,null,null,null)`), /CALENDAR_CURSOR_INVALID/);
  assert(events.some(row => row.id === 'offer:2' && row.startWorkStatus === 'started'));
  assert(events.some(row => row.id==='log:13'&&row.candidateId==='CAN-2'&&row.logDate==='2026-07-20'));
  await assert.rejects(query(`select public.app_recruitment_calendar_v1('2026-01-01','2026-03-10','{}'::jsonb)`), /CALENDAR_RANGE_INVALID/);
  const home = (await query(`select public.app_home_summary_v1('{}'::jsonb) as data`)).data;
  assert.equal(home.requisitions.open, fixture.home.openRequisitions);
  assert.equal(home.requisitions.priorityOpen, fixture.home.priorityOpen);
  assert.equal(home.needsAction.pendingCandidates, fixture.home.pendingCandidates);
  assert.equal(home.candidatePipeline.length, 0, 'offers exclude the candidate from the existing Home pipeline list');
  assert.equal(home.recentActivity.length, 0);
  await db.exec(`insert into public.candidates values ('CAN-PAR','Parallel Candidate',null,'Facebook','GRP-1',null);
    insert into public.candidate_applications values ('10000000-0000-0000-0000-000000000003','CAN-PAR','GRP-1','active'),('10000000-0000-0000-0000-000000000004','CAN-PAR','GRP-1','active'),('10000000-0000-0000-0000-000000000005','CAN-PAR','GRP-1','active');
    insert into public.recruitment_logs(log_id,candidate_id,application_id,result,superseded_at,superseded_by_stage_instance_id,recruitment_process,estimated_action_date,round,log_date,outcome_date,stage_instance_id,interviewer,remark,updated_at) values
      (20,'CAN-PAR','10000000-0000-0000-0000-000000000003',null,null,null,'HR Interview',null,1,'2026-07-01',null,'20000000-0000-0000-0000-000000000020',null,null,now()),
      (21,'CAN-PAR','10000000-0000-0000-0000-000000000003',null,null,null,'Phone Screen',null,1,'2026-07-20',null,'20000000-0000-0000-0000-000000000021',null,null,now()),
      (22,'CAN-PAR','10000000-0000-0000-0000-000000000004',null,null,null,'Test',null,1,'2026-07-10',null,'20000000-0000-0000-0000-000000000022',null,null,now()),(23,'CAN-PAR','10000000-0000-0000-0000-000000000005',null,null,null,'HR Interview',null,1,'2026-07-05',null,'20000000-0000-0000-0000-000000000023',null,null,now());
    insert into public.requisitions values ('REQ-STALE-10',false,'2026-07-01','KT1','Stale 10','Ops','Plant','L0',1,'Recruiter A','New','open',now(),now()),('REQ-STALE-6',false,'2026-07-01','KT1','Stale 6','Ops','Plant','L0',1,'Recruiter A','New','open',now(),now()),('REQ-FRESH-5',false,'2026-07-01','KT1','Fresh 5','Ops','Plant','L0',1,'Recruiter A','New','open',now(),now()),('REQ-OLD-KT2',false,'2026-06-01','KT2','Old Site Open','Ops','Plant','L0',4,'Recruiter B','New','open',now(),now());
    insert into public.document_groups values ('DG-STALE-10','REQ-STALE-10','GRP-STALE-10'),('DG-STALE-6','REQ-STALE-6','GRP-STALE-6'),('DG-FRESH-5','REQ-FRESH-5','GRP-FRESH-5');
    insert into public.sourcing_weekly_updates(group_id,week_start,updated_at) values
      ('GRP-STALE-10',(now() at time zone 'Asia/Bangkok')::date - 10,(((now() at time zone 'Asia/Bangkok')::date - 10)::timestamp at time zone 'Asia/Bangkok')),
      ('GRP-STALE-6',(now() at time zone 'Asia/Bangkok')::date - 6,(((now() at time zone 'Asia/Bangkok')::date - 6)::timestamp at time zone 'Asia/Bangkok')),
      ('GRP-FRESH-5',(now() at time zone 'Asia/Bangkok')::date - 5,(((now() at time zone 'Asia/Bangkok')::date - 5)::timestamp at time zone 'Asia/Bangkok'));`);
  const homeParity=(await query(`select public.app_home_summary_v1('{}'::jsonb) as data`)).data;
  assert.equal(homeParity.candidatePipeline.some(row=>row.stage==='Phone Screen'),false,'the later lower-stage log does not replace the canonical higher-stage record');
  assert.equal(homeParity.candidatePipeline.find(row=>row.stage==='HR Interview')?.count,2,'parallel journeys are counted separately and latest stage follows stage-round-log ordering');
  assert.equal(homeParity.candidatePipeline.find(row=>row.stage==='Test')?.count,1,'parallel journeys for one candidate remain separate');
  assert.equal(homeParity.needsAction.pendingCandidates,5,'pending journey counts preserve application grain');
  assert.equal(homeParity.sourcing.staleGroups,2,'six-day boundary and ten-day stale sourcing match Home baseline');
  assert(homeParity.workQueue.items.length<=10&&homeParity.workQueue.totalCount>=homeParity.workQueue.items.length,'Home work queue carries a bounded ranked page and exact population count');
  assert.deepEqual(homeParity.counts,{openRequisitions:homeParity.requisitions.open,activePipeline:homeParity.candidatePipeline.reduce((sum,row)=>sum+row.count,0),staleSourcing:homeParity.sourcing.staleGroups,pendingOffers:2,qualityIssues:homeParity.counts.qualityIssues},'Home tab counts are computed in SQL alongside the summary');
  await db.exec(`insert into public.sourcing_weekly_updates(group_id,week_start,updated_at,channel_fb,channel_jobthai,applicants_fb,applicants_jobthai,applicants_jobtopgun,applicants_jobdb,applicants_jobbkk,applicants_linkedin,applicants_walkin,applicants_referral,applicants_others) values ('GRP-1','2026-07-04',now(),true,true,3,2,0,0,0,0,0,0,0);`);
  await db.exec(`insert into public.requisitions values ('REQ-OLD-OPEN',false,'2026-06-01','KT1','Old open','Ops','Plant','L0',4,'Recruiter A','New','open',now(),now())`);
  const pipelineSummary=(await query(`select public.app_dashboard_pipeline_summary_v1('2026-07-01','2026-07-31','custom','{}'::jsonb,'all') as data`)).data;
  const { buildPipelineReport } = require(path.join(root, 'src/lib/pipeline-report.ts'));
  const { buildVacancyRiskReport } = require(path.join(root, 'src/lib/vacancy-risk-report.ts'));
  const { previousPerformanceRange } = require(path.join(root, 'src/lib/recruitment-performance.ts'));
  const { enrichRequisitions } = require(path.join(root, 'src/lib/data.ts'));
  const { countsTowardHeadcountAt } = require(path.join(root, 'src/lib/offer-headcount.ts'));
  const { filledSlaAtAcceptance } = require(path.join(root, 'src/lib/vacancy-executive.ts'));
  const viewText=fs.readFileSync(path.join(root,'src/components/dashboard/VacancyWaterfallView.tsx'),'utf8');
  const viewAst=ts.createSourceFile('VacancyWaterfallView.tsx',viewText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const functionSource=name=>{const node=viewAst.statements.find(item=>ts.isFunctionDeclaration(item)&&item.name?.text===name);assert(node,`missing ${name}`);return viewText.slice(node.getFullStart(),node.getEnd());};
  const extractedWaterfall=ts.transpile(['waterfallRow','aggregateWaterfallRows','buildLiveWaterfallRows'].map(functionSource).join('\n'),{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022});
  const modelWaterfall=new Function('isReportEligible','requisitionSnapshotAt','dateOnly','countsTowardHeadcountAt','filledSlaAtAcceptance',`${extractedWaterfall}; return buildLiveWaterfallRows;`)(isReportEligible,requisitionSnapshotAt,dateOnly,countsTowardHeadcountAt,filledSlaAtAcceptance);
  const readRows = async table => (await db.query(`select * from public.${table}`)).rows;
  const isoRows = rows => rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,value instanceof Date?value.toISOString():value])));
  const [pipelineCandidates,pipelineLogs,pipelineGroups,pipelineApps,pipelineAssignments,pipelineOffers,pipelineRequisitions,pipelineSourcing,pipelinePositionGroups] = await Promise.all(['candidates','recruitment_logs','document_groups','candidate_applications','candidate_application_assignments','offers','requisitions','sourcing_weekly_updates','position_groups'].map(readRows));
  const oldOpen = pipelineRequisitions.find(row=>row.doc_id==='REQ-OLD-OPEN');
  const oldSiteOpen = pipelineRequisitions.find(row=>row.doc_id==='REQ-OLD-KT2');
  const currentReq = reportRequisitions[0];
  const tsPipelineReqs = [currentReq,{...isoRows([oldOpen])[0],open_headcount:4,accepted_count:0,sla_restart_date:null,sourcing_group_ids:[],candidate_count:0},{...isoRows([oldSiteOpen])[0],open_headcount:4,accepted_count:0,sla_restart_date:null,sourcing_group_ids:[],candidate_count:0}];
  const tsPipelineData = { candidates:isoRows(pipelineCandidates), recruitment_logs:isoRows(pipelineLogs), requisition_logs:isoRows(await readRows('requisition_logs')), document_groups:isoRows(pipelineGroups), candidate_applications:isoRows(pipelineApps),candidate_application_assignments:isoRows(pipelineAssignments), offers:isoRows(pipelineOffers), requisitions:isoRows(pipelineRequisitions), sourcing_weekly_updates:isoRows(pipelineSourcing), position_groups:isoRows(pipelinePositionGroups) };
  const { ACTIVE_PIPELINE_STAGES }=require(path.join(root,'src/lib/constants.ts'));
  const { applicationCandidates,applicationKey,belongsToApplication,assignmentGroup }=require(path.join(root,'src/lib/applications.ts'));
  const oldStageText=['groupIdsForRequisition','docGroupIdsForGroupIds','emptyStageCounts','candidatesForDocGroups','logBelongsToDocGroups','stageCandidatesForRequisition','pipelineStatusCountsForDocGroups','stageActivityCountsForDocGroups','stageAccumCountsForDocGroups'].map(functionSource).join('\n');
  const oldStage=new Function('detailStages','applicationCandidates','applicationKey','belongsToApplication','assignmentGroup','dateOnly','validDateOnly',`${ts.transpile(oldStageText,{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022})};return {groupIdsForRequisition,docGroupIdsForGroupIds,stageCandidatesForRequisition,pipelineStatusCountsForDocGroups,stageActivityCountsForDocGroups,stageAccumCountsForDocGroups};`)(ACTIVE_PIPELINE_STAGES,applicationCandidates,applicationKey,belongsToApplication,assignmentGroup,dateOnly,validDateOnly);
  const currentDocGroups=oldStage.docGroupIdsForGroupIds(tsPipelineData,oldStage.groupIdsForRequisition(tsPipelineData,'REQ-CURRENT'));
  const statusStageCounts=oldStage.pipelineStatusCountsForDocGroups(tsPipelineData,currentDocGroups,'2026-07-31');
  const activityStageCounts=oldStage.stageActivityCountsForDocGroups(tsPipelineData,currentDocGroups,'2026-07-01','2026-07-31');
  const accumStageCounts=oldStage.stageAccumCountsForDocGroups(tsPipelineData,currentDocGroups,'2026-07-01','2026-07-31');
  const parityActiveReqPage=(await query(`select public.app_dashboard_active_requisitions_page_v1('2026-07-01','2026-07-31','custom','status','{}'::jsonb,null,null,25) as data`)).data;
  assert.deepEqual(parityActiveReqPage.rows.find(row=>row.doc_id==='REQ-CURRENT').stage_counts,statusStageCounts,'active requisition SQL status counts match the actual pipelineStatusCountsForDocGroups builder');
  for(const [mode,expected] of [['activity',activityStageCounts],['accum',accumStageCounts]]){
    const sqlMode=(await query(`select public.app_dashboard_active_requisitions_page_v1('2026-07-01','2026-07-31','custom',$1,'{}'::jsonb,null,null,25) as data`,[mode])).data;
    assert.deepEqual(sqlMode.rows.find(row=>row.doc_id==='REQ-CURRENT').stage_counts,expected,`active requisition SQL ${mode} counts match the actual stage-count builder`);
  }
  for(const mode of ['status','activity','accum']){
    const expected=oldStage.stageCandidatesForRequisition(tsPipelineData,'REQ-CURRENT','Phone Screen',mode,'2026-07-01','2026-07-31');
    const page=(await query(`select public.app_dashboard_active_requisition_candidates_v1('REQ-CURRENT','Phone Screen','2026-07-01','2026-07-31','2026-07-01',$1,null,null,25) as data`,[mode])).data;
    const normalize=rows=>rows.map(row=>[row.applicationId??row.application_id,row.candidateId??row.candidate_id,dateOnly(row.pendingDate??row.pending_date),dateOnly(row.resultDate??row.result_date),row.remark,row.result]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    assert.deepEqual(normalize(page.matches),normalize(expected),`active requisition SQL ${mode} candidate pages match the actual stageCandidatesForRequisition builder across repeated rounds/assignment transfer`);
  }
  const { deriveWorkQueue }=require(path.join(root,'src/lib/operations.ts'));
  const { enrichCandidates,enrichOffers,enrichSourcingGroups }=require(path.join(root,'src/lib/data.ts'));
  const { formatLocalDateInput }=require(path.join(root,'src/lib/dates.ts'));
  const homeProfile={role:'system_admin',site:null,nickname:null,full_name:null};
  const tsHomeQueue=deriveWorkQueue({candidates:enrichCandidates(tsPipelineData),offers:enrichOffers(tsPipelineData),profile:homeProfile,requisitions:enrichRequisitions(tsPipelineData),staleSourcingGroups:enrichSourcingGroups(tsPipelineData,formatLocalDateInput())});
  const sqlHomeQueue=(await query(`select public.app_home_work_queue_v1('{}'::jsonb,(now() at time zone 'Asia/Bangkok')::date) as data`)).data;
  const queueProjection=rows=>rows.map(({id,title,meta,actionLabel,priority,recordId,tone,type})=>({id,title,meta,actionLabel,priority,recordId,tone,type}));
  assert.deepEqual(queueProjection(sqlHomeQueue.items),queueProjection(tsHomeQueue),'Home work queue ranked rows match deriveWorkQueue');
  if(tsHomeQueue.length<10)assert.equal(sqlHomeQueue.totalCount,tsHomeQueue.length,'Home work queue total is exact when the queue fits within the bounded first page');
  const tsPipeline = buildPipelineReport(tsPipelineData,tsPipelineData.offers.filter(row=>row.candidate_id),tsPipelineReqs,{start:'2026-07-01',end:'2026-07-31',valid:true},'custom',[],'all','en');
  for (const row of pipelineSummary.funnelRows) assert.equal(row.count,tsPipeline.funnelRows.find(candidate=>candidate.key===row.key)?.count,`SQL/TypeScript pipeline funnel parity for ${row.key}`);
  for (const row of pipelineSummary.sourceRows) {
    const expected=tsPipeline.sourceRows.find(candidate=>candidate.label===row.label);
    assert.deepEqual([row.applicants,row.phone,row.hired],expected?[expected.applicants,expected.phone,expected.hired]:[0,0,0],`SQL/TypeScript source parity for ${row.label}`);
  }
  const allTsRequisitions=enrichRequisitions(tsPipelineData);
  const tsWaterfall=modelWaterfall(tsPipelineData,allTsRequisitions,tsPipelineData.offers.map(row=>({...row,doc_id:row.doc_id})), '2026-07-01','2026-07-31','custom');
  const sqlWaterfall=(await query(`select public.app_dashboard_pipeline_summary_v1('2026-07-01','2026-07-31','custom','{}'::jsonb,'all')->'waterfallRows' as rows`)).rows;
  const canonicalMovement=rows=>rows.map(row=>[row.waterfall_category,row.site,row.request_type,row.vacancy_count]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  assert.deepEqual(canonicalMovement(sqlWaterfall),canonicalMovement(tsWaterfall),'SQL company waterfall movements match buildLiveWaterfallRows across opening, offers, no-shows, headcount caps, restarts, and status history');
  await db.exec(`insert into public.requisitions values
    ('REQ-RISK-HISTORY',false,'2026-06-01','KT1','Risk history','Ops','Plant','L0',2,'Recruiter A','New','open',now(),now()),
    ('REQ-RISK-RESTART',false,'2026-06-01','KT1','Risk same-day restart','Ops','Plant','L0',1,'Recruiter A','New','open',now(),now()),
    ('REQ-RISK-FUTURE-LOG',false,'2026-06-01','KT1','Risk future log','Ops','Plant','L0',1,'Recruiter A','New','cancel',now(),now()),
    ('REQ-RISK-L05',false,'2026-06-01','KT1','Risk invalid L05','Ops','Plant','L05',1,'Recruiter A','New','open',now(),now()),
    ('REQ-RISK-JUNK',false,'2026-06-01','KT1','Risk invalid junk','Ops','Plant','5junk',1,'Recruiter A','New','open',now(),now());
    insert into public.requisition_logs values
    (40,'REQ-RISK-HISTORY','2026-07-02','filled',null,now()),(41,'REQ-RISK-HISTORY','2026-07-15','open',null,now()),
    (42,'REQ-RISK-RESTART','2026-07-10','filled',null,now()),(43,'REQ-RISK-FUTURE-LOG','2026-08-01','cancel',null,now());
    insert into public.offers(offer_id,candidate_id,doc_id,application_id,accepted_date,first_working_date,start_confirmation,start_confirmed_at,remark,created_at,updated_at)
    values (40,null,'REQ-RISK-RESTART',null,'2026-06-15','2026-07-10','did_not_start','2026-07-10T04:00:00Z',null,now(),now())`);
  const riskRange={start:'2026-07-01',end:'2026-07-31'},riskPrior=previousPerformanceRange('pim',riskRange);
  const riskSummary=(await query(`select public.app_dashboard_risk_summary_v1($1,$2,$3,$4,'{}'::jsonb,'["2026-07-01","2026-07-15","2026-07-31"]'::jsonb) as data`,[riskRange.start,riskRange.end,riskPrior.start,riskPrior.end])).data;
  const riskData={...tsPipelineData,requisitions:isoRows(await readRows('requisitions')),requisition_logs:isoRows(await readRows('requisition_logs')),offers:isoRows(await readRows('offers'))};
  const riskRequisitions=enrichRequisitions(riskData);
  const { historicalVacancy }=require(path.join(root,'src/lib/dashboard-history.ts'));
  assert.equal(historicalVacancy(riskData,riskRequisitions.find(row=>row.doc_id==='REQ-RISK-HISTORY'),'2026-07-31').remaining,2,'multi-status historical risk fixture follows existing TypeScript event ordering');
  const tsRisk=buildVacancyRiskReport(riskData,riskRequisitions,riskRange,'2026-08-01',riskPrior);
  assert.deepEqual(riskSummary.totals,tsRisk.totals,'risk totals preserve legacy historical log ordering, same-day restart, future-only log cancel fallback, and strict SLA levels');
  const riskParityPage=(await query(`select public.app_dashboard_risk_page_v1('2026-07-31','{}'::jsonb,'all','site','',null,null,null,null,100) as data`)).data;
  assert.equal(riskParityPage.total,tsRisk.rows.length,'Risk page population matches actual buildVacancyRiskReport rows');
  assert.deepEqual(riskParityPage.rows.map(row=>row.docId).sort(),tsRisk.rows.map(row=>row.requisition.doc_id).sort(),'Risk page rows preserve legacy report identities');
  assert(riskParityPage.rows.some(row=>row.docId==='REQ-RISK-HISTORY'),'multi-status history follows existing TypeScript event ordering');
  assert(riskParityPage.rows.some(row=>row.docId==='REQ-RISK-RESTART'),'same-day no-show restart reopens a filled requisition');
  assert(riskParityPage.rows.some(row=>row.docId==='REQ-RISK-FUTURE-LOG'),'future-only log prevents current-status cancel fallback');
  assert.equal(riskParityPage.rows.find(row=>row.docId==='REQ-RISK-L05')?.kind,'unknown');
  assert.equal(riskParityPage.rows.find(row=>row.docId==='REQ-RISK-JUNK')?.kind,'unknown');
  assert.deepEqual(riskSummary.trends.map(row=>row.date),['2026-07-01','2026-07-15','2026-07-31']);
  assert.equal(Object.hasOwn(riskSummary,'rows'),false,'risk summary DTO excludes requisition row ledgers');
  const riskPage1=(await query(`select public.app_dashboard_risk_page_v1('2026-07-31','{}'::jsonb,'all','site','',null,null,null,null,1) as data`)).data;
  assert.equal(riskPage1.rows.length,1);assert(riskPage1.total>1);assert(riskPage1.hasMore&&riskPage1.nextCursor);
  const riskPage2=(await query(`select public.app_dashboard_risk_page_v1('2026-07-31','{}'::jsonb,'all','site','',$1,$2,$3,$4,1) as data`,[riskPage1.nextCursor.kind,riskPage1.nextCursor.remaining,riskPage1.nextCursor.open,riskPage1.nextCursor.docId])).data;
  assert.equal(riskPage2.rows.length,1);assert.notEqual(riskPage2.rows[0].docId,riskPage1.rows[0].docId,'risk detail cursors advance without repeating rows');
  assert.equal(pipelineSummary.funnelRows.find(row=>row.key==='applicants')?.count,5,'pipeline applicants aggregate weekly channel counts');
  assert.equal(pipelineSummary.funnelRows.find(row=>row.key==='Resume Screening')?.count,3,'resume screening is distinct phone-stage entry across parallel application journeys');
  assert.equal(pipelineSummary.sourceRows.find(row=>row.label==='Facebook')?.applicants,3);
  assert.equal(pipelineSummary.sourceRows.find(row=>row.label==='Facebook')?.phone,1,'trimmed stored channel preserves the matching stage contribution');
  assert.equal(pipelineSummary.sourceRows.find(row=>row.label==='JobThai')?.hired,1,'authorized candidate offer contributions are grouped by source');
  assert(pipelineSummary.waterfallRows.some(row=>row.waterfall_category==='Filled'&&row.vacancy_count===-3));
  const openingSummary=(await query(`select public.app_dashboard_pipeline_summary_v1('2026-07-01','2026-07-31','custom','{}'::jsonb,'all') as data`)).data;
  assert.equal(openingSummary.waterfallRows.filter(row=>row.waterfall_category==='Week Start').reduce((total,row)=>total+row.vacancy_count,0),12,'opening category is unfilled capacity across baseline and historical-risk fixtures');
  const selectedChannel=(await query(`select public.app_dashboard_pipeline_summary_v1('2026-07-01','2026-07-31','custom','{}'::jsonb,'Facebook') as data`)).data;
  assert.equal(selectedChannel.funnelRows.find(row=>row.key==='Phone Screen')?.count,1,'trimmed selected channel preserves the distinct passed-stage contribution');
  assert(selectedChannel.channelOptions.includes('Facebook'));
  const sourcingSummary=(await query(`select public.app_recruitment_sourcing_summary_v1('2026-07-04','GRP-1','{}'::jsonb) as data`)).data;
  assert.equal(sourcingSummary.expectedRows,2,'sourcing aggregate includes generated lifecycle slots before selected week');
  assert.equal(sourcingSummary.updatedWeeks,1);
  assert.equal(sourcingSummary.totalApplicants,5);
  assert.equal(sourcingSummary.selectedApplicants,5);
  assert.equal(sourcingSummary.channels.channel_fb,3);assert.equal(sourcingSummary.channels.channel_jobthai,2);
  assert(sourcingSummary.stageChannels&&sourcingSummary.weeks.length<=8,'sourcing aggregate returns bounded weekly trends and selected-group stage DTO');
  const {deriveSourcingStageChannels}=require(path.join(root,'src/lib/sourcing-stage-channels.ts'));
  const sourcingStageData={candidates:isoRows(await readRows('candidates')),candidate_applications:isoRows(await readRows('candidate_applications')),candidate_application_assignments:isoRows(await readRows('candidate_application_assignments')),recruitment_logs:isoRows(await readRows('recruitment_logs')),document_groups:isoRows(await readRows('document_groups'))};
  assert.deepEqual(sourcingSummary.stageChannels,deriveSourcingStageChannels(sourcingStageData,'GRP-1','2026-07-04'),'sourcing stage-channel summary matches deriveSourcingStageChannels at the same cutoff');
  await query(`select set_config('test.requisition_access','false',true)`);
  const siteRolePipeline=(await query(`select public.app_dashboard_pipeline_summary_v1('2026-07-01','2026-07-31','custom','{}'::jsonb,'all') as data`)).data;
  assert(siteRolePipeline.waterfallRows.some(row=>row.site==='KT2'), 'guarded waterfall helper preserves company-wide anonymized aggregates for recruiter callers whose direct requisition read scope excludes another site');
  const siteRoleRiskPage=(await query(`select public.app_dashboard_risk_page_v1('2026-07-31','{}'::jsonb,'all','site','',null,null,null,null,1) as data`)).data;
  assert.deepEqual(siteRoleRiskPage.rows,riskPage1.rows,'Risk detail uses the existing authorized anonymized company feed for the same population as its summary');
  assert.equal(siteRoleRiskPage.total,riskPage1.total);
  await assert.rejects(query(`select public.app_dashboard_risk_page_v1('2026-07-31','{}'::jsonb,null,'site','',null,null,null,null,1)`), /RISK_FILTER_INVALID/);
  await query(`select set_config('test.requisition_access','true',true)`);
  assert.equal(Object.hasOwn(pipelineSummary,'stageRecords'),false,'pipeline screen summary excludes contribution ledgers');
  await db.exec(`insert into public.requisitions values ('REQ-TRIMMED',false,'2026-07-02','KT1','Trimmed','Ops','Plant',' L12 ',1,'Recruiter A','New','open',now(),now()),('REQ-INVALID',false,'2026-07-03','KT1','Invalid','Ops','Plant','L99',1,'Recruiter A','New','open',now(),now()),('REQ-NULL',false,'2026-07-04','KT1','Null level','Ops','Plant',null,1,'Recruiter A','New','open',now(),now()),('REQ-EMPTY',false,'2026-07-05','KT1','Empty level','Ops','Plant','',1,'Recruiter A','New','open',now(),now())`);
  const levelRows = (await query(`select jsonb_agg(jsonb_build_object('band',cell->>'band','vacancies',(cell->>'vacancies')::int)) as rows from jsonb_array_elements((public.app_dashboard_performance_summary_v1('2026-07-01','2026-07-31','2026-06-01','2026-06-30','custom','{}'::jsonb)->'current'->'cells')) cell`)).rows;
  assert(levelRows.some(row => row.band === 'SML' && row.vacancies === 1), 'trimmed L12 maps to SML');
  assert(levelRows.some(row => row.band === 'Unknown' && row.vacancies >= 3), 'NULL, empty and invalid levels map to Unknown, not Executive');
  assert.equal(performanceBand(null), 'Unknown');
  assert.equal(performanceBand(''), 'Unknown');
  assert.equal(performanceBand('L99'), 'Unknown');
  assert.equal(performanceBand(' L12 '), 'SML');
  assert.deepEqual((await query(`select public.app_dashboard_filter_options_v1('{}'::jsonb) as data`)).data.sites, ['HQ','KT1','KT2'].filter(site => site !== 'HQ'));
  await db.exec(`
    insert into candidates select 'CAN-BULK-'||n,'Bulk Candidate',null,'Facebook','GRP-1',null from generate_series(1,501) n;
    insert into candidate_applications select md5('app-'||n)::uuid,'CAN-BULK-'||n,'GRP-1','active' from generate_series(1,501) n;
    insert into recruitment_logs(log_id,candidate_id,application_id,result,superseded_at,superseded_by_stage_instance_id,recruitment_process,estimated_action_date,round,log_date,outcome_date,stage_instance_id,interviewer,remark,updated_at) select 100+n,'CAN-BULK-'||n,md5('app-'||n)::uuid,null,null,null,'Phone Screen','2026-07-22',1,'2026-07-01',null,md5('stage-'||n)::uuid,'Interviewer B','Bulk',now() from generate_series(1,501) n;
  `);
  const calendarPages = [];
  let cursor = null;
  for (;;) {
    const page = (await query(`select public.app_recruitment_calendar_v1($1,$2,'{}'::jsonb,$3,$4,200) as data`, ['2026-07-01','2026-07-31',cursor?.date ?? null,cursor?.id ?? null])).data;
    assert(page.events.length <= 200);
    calendarPages.push(...page.events);
    if (!page.hasMore) break;
    assert(page.nextCursor && page.events.length > 0);
    cursor = page.nextCursor;
  }
  assert.equal(calendarPages.length, 504, 'cursor pages return every matching event beyond 500, including the added application-grain fixture event');
  assert.equal(new Set(calendarPages.map(row => row.id)).size, calendarPages.length);
  await assert.rejects(query(`select public.app_recruitment_calendar_v1('2026-01-01','2026-03-10','{}'::jsonb)`), /CALENDAR_RANGE_INVALID/);
  assert.equal((await query(`select has_function_privilege('anon','app_private.dashboard_performance_summary_range_v1(date,date,text,jsonb)','execute') as allowed`)).allowed, false, 'private summary helper is not callable by anon');
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)`);
  const adminTotals = (await query(`select public.app_dashboard_performance_summary_v1('2026-07-01','2026-07-31','2026-06-01','2026-06-30','custom','{}'::jsonb) as data`)).data.current.metrics;
  await db.exec(`select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false)`);
  const siteSummary = (await query(`select public.app_dashboard_performance_summary_v1('2026-07-01','2026-07-31','2026-06-01','2026-06-30','custom','{}'::jsonb) as data`)).data;
  assert.equal(siteSummary.current.metrics.vacancies, adminTotals.vacancies, 'site recruiter receives company-wide anonymized totals');
  assert.equal(siteSummary.current.metrics.filled, adminTotals.filled);
  assert.equal(Object.hasOwn(siteSummary.current, 'requisitions'), false, 'site summary has no candidate-linked ledger');
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)`);
  assert.equal(JSON.stringify(summary).length < 4_000, true, 'summary response stays aggregate-sized');
  assert.equal(Object.hasOwn(summary.current, 'requisitions'), false, 'summary DTO contains no source ledger');
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schemas/55_dashboard_report.sql'), 'utf8'));
  await db.exec(`insert into public.requisitions(doc_id,is_priority,pr_approved_date,site,position,department,section,level,head_count,person_in_charge,request_type,status,created_at,updated_at)
    select 'BULK-'||n,false,'2026-07-01','KT1','Bulk','Operations','Plant','L0',1,'Recruiter A','New','open',now(),now() from generate_series(1,1001) n`);
  const complete = (await query(`select public.app_dashboard_company_report() as data`)).data;
  assert.equal(complete.requisitions.length, 1018, 'explicit export feed returns all rows beyond the PostgREST page size, including historical-risk edge fixtures');
  assert.equal(complete.offers.length, 5, 'complete export includes the historical-risk same-day restart offer');
  await db.exec(`insert into public.candidates values ('CAN-REJ','Rejection Fixture',null,'Others','GRP-REJ',null);
    insert into public.candidate_applications values ('10000000-0000-0000-0000-000000000006','CAN-REJ','GRP-REJ','active');
    insert into public.document_groups values ('DG-REJ','REQ-CURRENT','GRP-REJ');
    insert into public.position_groups(group_id,group_position) values ('GRP-REJ','Rejection Role');
    insert into public.recruitment_logs(log_id,candidate_id,application_id,result,superseded_at,superseded_by_stage_instance_id,recruitment_process,estimated_action_date,round,log_date,outcome_date,stage_instance_id,interviewer,remark,updated_at,outcome_assignment_id,failure_actor,failure_main_reason_id,failure_detail_reason_id,failure_reason_snapshot) values
      (30,'CAN-REJ','10000000-0000-0000-0000-000000000006',0,null,null,'Phone Screen',null,1,'2026-07-01','2026-07-08','20000000-0000-0000-0000-000000000030',null,null,now(),null,'company',null,null,'{"main_en":"Not suitable","main_th":"ไม่เหมาะสม","detail_en":"Experience","detail_th":"ประสบการณ์"}'),
      (31,'CAN-REJ','10000000-0000-0000-0000-000000000006',0,null,null,'Phone Screen',null,2,'2026-07-10','2026-07-15','20000000-0000-0000-0000-000000000031',null,null,now(),null,'candidate',null,null,'{"main_en":"Not suitable","main_th":"ไม่เหมาะสม","detail_en":"Experience","detail_th":"ประสบการณ์"}'),
      (34,'CAN-REJ','10000000-0000-0000-0000-000000000006',0,null,null,'Phone Screen',null,3,'2026-07-20',null,null,null,null,now(),null,'company',null,null,'{"main_en":"Not suitable","main_th":"ไม่เหมาะสม","detail_en":"Experience","detail_th":"ประสบการณ์"}'),
      (35,'CAN-REJ','10000000-0000-0000-0000-000000000006',0,null,null,'Legacy Rejected',null,1,'2026-07-21','2026-07-21',null,null,null,now(),null,'candidate',null,null,'{"main_en":"Not suitable","main_th":"ไม่เหมาะสม","detail_en":"Experience","detail_th":"ประสบการณ์"}');`);
  const rejectionRange={start:'2026-07-01',end:'2026-07-31'},rejectionScope={};
  const sqlRejections=(await query(`select public.app_dashboard_rejection_summary_v1($1,$2,'{}'::jsonb,'{}'::jsonb) as data`,[rejectionRange.start,rejectionRange.end])).data;
  const { buildRejectionReport } = require(path.join(root,'src/lib/rejection-report.ts'));
  const rejectionData={...tsPipelineData,candidates:isoRows(await readRows('candidates')),candidate_applications:isoRows(await readRows('candidate_applications')),candidate_application_assignments:isoRows(await readRows('candidate_application_assignments')),recruitment_logs:isoRows(await readRows('recruitment_logs')),requisitions:isoRows(await readRows('requisitions')),document_groups:isoRows(await readRows('document_groups')),position_groups:isoRows(await readRows('position_groups'))};
  const tsRejections=buildRejectionReport(rejectionData,enrichRequisitions(rejectionData),rejectionRange);
  assert.equal(sqlRejections.total,tsRejections.total,'Rejection aggregate total matches buildRejectionReport');
  assert.equal(sqlRejections.people,tsRejections.people);assert.equal(sqlRejections.applications,tsRejections.applications);
  assert.deepEqual(sqlRejections.actors,tsRejections.actors);
  assert.deepEqual(sqlRejections.mainReasons.map(row=>row.key),tsRejections.mainReasons.map(row=>row.key),'compact SQL reason keys match persisted TypeScript JSON.stringify keys');
  assert.deepEqual(sqlRejections.stageOptions,tsRejections.periodEvents.map(row=>row.stage).filter((stage,index,all)=>all.indexOf(stage)===index).sort((a,b)=>{const active=['Phone Screen','HR Interview','Line Interview','Test','Reference Check','Offer'];return (active.indexOf(a)<0?6:active.indexOf(a))-(active.indexOf(b)<0?6:active.indexOf(b))||a.localeCompare(b);}), 'stage options remain based on full period events independently from local filters');
  assert.equal(sqlRejections.diagnostics.undated,tsRejections.diagnostics.undated,'legacy active-stage failures without an outcome date use log_date');
  const companyFiltered=(await query(`select public.app_dashboard_rejection_summary_v1($1,$2,'{}'::jsonb,'{"actor":"company"}'::jsonb) as data`,[rejectionRange.start,rejectionRange.end])).data;
  assert(companyFiltered.stageOptions.includes('Legacy Rejected'),'historical stage labels remain available under actor filters');
  assert.equal(companyFiltered.stages.find(row=>row.stage==='Legacy Rejected').count,0,'historical stage remains as a zero-count row when local actor filtering removes it');
  const compactMain=tsRejections.mainReasons.find(row=>row.actor==='company').key,compactDetail=tsRejections.detailedReasons.find(row=>row.actor==='company').key;
  const crossfiltered=(await query(`select public.app_dashboard_rejection_summary_v1($1,$2,'{}'::jsonb,$3::jsonb) as data`,[rejectionRange.start,rejectionRange.end,JSON.stringify({actor:'company',main:compactMain,detail:compactDetail})])).data;
  assert.equal(crossfiltered.total,2);assert.equal(crossfiltered.comparison.total,2,'Treemap comparison population retains parent main but ignores detail');
  const rejectionPage=(await query(`select public.app_dashboard_rejection_page_v1($1,$2,'{}'::jsonb,'{}'::jsonb,'date-desc',null,null,1) as data`,[rejectionRange.start,rejectionRange.end])).data;
  assert.equal(rejectionPage.events.length,1);assert.equal(rejectionPage.total,4);assert(rejectionPage.hasMore&&rejectionPage.nextCursor);
  const rejectionNext=(await query(`select public.app_dashboard_rejection_page_v1($1,$2,'{}'::jsonb,'{}'::jsonb,'date-desc',$3,$4,1) as data`,[rejectionRange.start,rejectionRange.end,rejectionPage.nextCursor.value,rejectionPage.nextCursor.logId])).data;
  assert.equal(rejectionNext.events.length,1);assert.notEqual(rejectionNext.events[0].id,rejectionPage.events[0].id,'Rejection keyset pages advance without duplicate event IDs');
  await db.exec(`insert into public.candidates values ('CAN-33','Alias Candidate',null,'Others','GRP-42',null);
    insert into public.candidate_applications values ('10000000-0000-0000-0000-000000000009','CAN-33','GRP-42','active');
    insert into public.document_groups values ('DG-42','REQ-CURRENT','GRP-42');
    insert into public.position_groups(group_id,group_position) values ('GRP-42','Alias Role');
    insert into public.candidate_application_assignments(assignment_id,application_id,group_id,from_group_id,started_at) values ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000009','GRP-42',null,'2026-07-01T00:00:00Z');
    insert into public.recruitment_logs(log_id,candidate_id,application_id,result,superseded_at,superseded_by_stage_instance_id,recruitment_process,estimated_action_date,round,log_date,outcome_date,stage_instance_id,updated_at,outcome_assignment_id,failure_actor,failure_reason_snapshot) values
      (36,'CAN-33','10000000-0000-0000-0000-000000000009',0,null,null,'Phone Screen',null,1,'2026-07-20','2026-07-22','20000000-0000-0000-0000-000000000036',now(),'30000000-0000-0000-0000-000000000003','company','{"main_en":"Not suitable","main_th":"ไม่เหมาะสม","detail_en":"Experience","detail_th":"ประสบการณ์"}');`);
  const aliasData={...rejectionData,candidates:isoRows(await readRows('candidates')),candidate_applications:isoRows(await readRows('candidate_applications')),candidate_application_assignments:isoRows(await readRows('candidate_application_assignments')),recruitment_logs:isoRows(await readRows('recruitment_logs')),document_groups:isoRows(await readRows('document_groups')),position_groups:isoRows(await readRows('position_groups')),requisitions:isoRows(await readRows('requisitions'))};
  for(const [term,field] of [['CAN-00033','candidateId'],['GRP-00042','groupId']]){
    const filters={actor:'',stage:'',main:'',detail:'',search:term},sqlAlias=(await query(`select public.app_dashboard_rejection_summary_v1($1,$2,'{}'::jsonb,$3::jsonb) as data`,[rejectionRange.start,rejectionRange.end,JSON.stringify(filters)])).data;
    const tsAlias=buildRejectionReport(aliasData,enrichRequisitions(aliasData),rejectionRange,filters);
    assert.equal(sqlAlias.total,1,`${field} padded alias search returns the exact raw identifier row`);assert.equal(sqlAlias.total,tsAlias.total,`${field} alias search matches the TypeScript model`);
    const aliasPage=(await query(`select public.app_dashboard_rejection_page_v1($1,$2,'{}'::jsonb,$3::jsonb,'date-desc',null,null,25) as data`,[rejectionRange.start,rejectionRange.end,JSON.stringify(filters)])).data;
    assert.equal(aliasPage.total,1);assert.equal(aliasPage.events[0][field==='candidateId'?'candidateId':'groupId'],field==='candidateId'?'CAN-33':'GRP-42','page results preserve raw storage IDs');
  }
  await query(`select set_config('test.application_access','false',false)`);
  assert.equal((await query(`select public.app_dashboard_rejection_summary_v1($1,$2,'{}'::jsonb,'{}'::jsonb) as data`,[rejectionRange.start,rejectionRange.end])).data.total,0,'candidate/application RLS helpers exclude failure events from summary totals');
  assert.equal((await query(`select public.app_dashboard_rejection_page_v1($1,$2,'{}'::jsonb,'{}'::jsonb,'date-desc',null,null,25) as data`,[rejectionRange.start,rejectionRange.end])).data.events.length,0,'candidate/application RLS helpers exclude identities from row pages');
  await query(`select set_config('test.application_access','true',false)`);
  await db.exec(`insert into public.recruitment_logs(log_id,candidate_id,application_id,result,superseded_at,superseded_by_stage_instance_id,recruitment_process,estimated_action_date,round,log_date,outcome_date,stage_instance_id,updated_at,failure_actor,failure_reason_snapshot) values
      (32,'CAN-REJ','10000000-0000-0000-0000-000000000006',0,null,null,'HR Interview',null,1,'2026-08-01','2026-08-07','20000000-0000-0000-0000-000000000032',now(),'company','{"main_en":"Not suitable","main_th":"ไม่เหมาะสม","detail_en":"Experience","detail_th":"ประสบการณ์"}'),
      (33,'CAN-REJ','10000000-0000-0000-0000-000000000006',0,null,null,'HR Interview',null,2,'2026-08-01','2026-08-08','20000000-0000-0000-0000-000000000033',now(),'company','{"main_en":"Not suitable","main_th":"ไม่เหมาะสม","detail_en":"Experience","detail_th":"ประสบการณ์"}');`);
  const weeklyRejection=(await query(`select public.app_dashboard_rejection_summary_v1('2026-08-01','2026-09-01','{}'::jsonb,'{}'::jsonb) as data`)).data;
  assert.equal(weeklyRejection.granularity,'weekly');assert.deepEqual(weeklyRejection.trends.slice(0,2).map(row=>[row.start,row.end,row.count]),[['2026-08-01','2026-08-07',1],['2026-08-08','2026-08-14',1]],'weekly rejection buckets start Saturday and end Friday');
  await db.exec(`alter table public.candidates add column phone_no text, add column candidate_folder_url text;
    insert into public.candidates(candidate_id,name,nickname,channel,group_id,doc_group_id,phone_no,candidate_folder_url) values
      ('CAN-Q1','',null,'Others','GRP-1',null,'555-0100','https://drive.test/duplicate'),
      ('CAN-Q2','  ',null,'Others','GRP-1',null,'555-0100','https://drive.test/duplicate');
    insert into public.candidate_applications values ('10000000-0000-0000-0000-000000000007','CAN-Q1','GRP-1','active'),('10000000-0000-0000-0000-000000000008','CAN-Q2','GRP-1','active');`);
  const qualityRangeDate='2026-11-01';
  const qualityPage=(await query(`select public.app_home_quality_page_v1('{}'::jsonb,$1,null,null,null,1) as data`,[qualityRangeDate])).data;
  assert.equal(qualityPage.items.length,1);assert(qualityPage.totalCount>=2&&qualityPage.hasMore&&qualityPage.nextCursor,'Home quality feed reports exact total and a bounded cursor');
  const qualityNext=(await query(`select public.app_home_quality_page_v1('{}'::jsonb,$1,$2,$3,$4,1) as data`,[qualityRangeDate,qualityPage.nextCursor.severity,qualityPage.nextCursor.title,qualityPage.nextCursor.id])).data;
  assert.equal(qualityNext.items.length,1);assert.notEqual(qualityNext.items[0].cursorId,qualityPage.items[0].cursorId,'Home quality keyset cursor advances across duplicate candidate issues at application grain');
  const qualityAll=[...qualityPage.items,...qualityNext.items];let qualityCursor=qualityNext.nextCursor;
  while(qualityCursor){const next=(await query(`select public.app_home_quality_page_v1('{}'::jsonb,$1,$2,$3,$4,50) as data`,[qualityRangeDate,qualityCursor.severity,qualityCursor.title,qualityCursor.id])).data;qualityAll.push(...next.items);qualityCursor=next.nextCursor;}
  assert.equal(qualityAll.length,qualityPage.totalCount,'Home quality cursor pages exhaust the independently reported total');
  for (const candidateId of ['CAN-Q1','CAN-Q2']) {
    const duplicateIssue=qualityAll.find(row=>row.entityId===candidateId&&row.workspaceCode==='duplicateCandidate');
    assert(duplicateIssue,'blank-name candidate participates in globally authorized duplicate matching');
    assert.equal(duplicateIssue.workspaceParams.fields,'phone,name,folder','precomputed duplicate flags preserve exact phone/name/folder reporting order and semantics');
  }
  const { deriveDataQualityIssues } = require(path.join(root,'src/lib/operations.ts'));
  const qualityData={...tsPipelineData,candidates:isoRows(await readRows('candidates')),candidate_applications:isoRows(await readRows('candidate_applications')),candidate_application_assignments:isoRows(await readRows('candidate_application_assignments')),recruitment_logs:isoRows(await readRows('recruitment_logs')),requisitions:isoRows(await readRows('requisitions')),document_groups:isoRows(await readRows('document_groups')),position_groups:isoRows(await readRows('position_groups')),offers:isoRows(await readRows('offers')),sourcing_weekly_updates:isoRows(await readRows('sourcing_weekly_updates'))};
  const tsQualityIds=deriveDataQualityIssues(qualityData).map(row=>row.id).sort(),sqlQualityIds=qualityAll.map(row=>row.id).sort();
  assert.deepEqual(sqlQualityIds,tsQualityIds,'Home quality issue identity and multiplicity match deriveDataQualityIssues at application grain');
  await db.exec(`insert into public.requisitions(doc_id,is_priority,pr_approved_date,site,position,department,section,level,head_count,person_in_charge,request_type,status,created_at,updated_at)
      values ('REQ-Q-1',false,'2026-07-01'::date,'KT1','Quality One','Ops','Plant','L2',1,'Recruiter A','New','ongoing',now(),now()),
        ('REQ-Q-10',false,'2026-07-01'::date,'KT1','Quality Ten','Ops','Plant','L2',1,'Recruiter A','New','ongoing',now(),now())
      union all select 'REQ-Q-1-'||lpad(n::text,2,'0'),false,'2026-07-01'::date,'KT1','Scoped '||n,'Ops','Plant','L2',1,'Recruiter A','New','ongoing',now(),now() from generate_series(2,35) n;
    insert into document_groups(doc_group_id,doc_id,group_id) values ('DG-Q-1','REQ-Q-1','GRP-Q-1'),('DG-Q-1-SHARED','REQ-Q-1','GRP-Q-10'),('DG-Q-10','REQ-Q-10','GRP-Q-10')
      union all select 'DG-Q-'||n,'REQ-Q-1-'||lpad(n::text,2,'0'),'GRP-Q-1' from generate_series(2,35) n;
    insert into candidates(candidate_id,name,nickname,channel,group_id,doc_group_id,phone_no,candidate_folder_url) values
      ('CAN-Q-G1','Group One Person',null,'Referral','GRP-Q-1',null,'GROUP-GLOBAL-DUPE',null),
      ('CAN-Q-G10','Group Ten Person',null,'Referral','GRP-Q-10',null,null,null),
      ('CAN-Q-REMOTE','Remote same phone',null,'Referral','GRP-Q-10',null,'GROUP-GLOBAL-DUPE',null);
    insert into candidate_applications values ('10000000-0000-0000-0000-000000000041','CAN-Q-G1','GRP-Q-1','active'),('10000000-0000-0000-0000-000000000042','CAN-Q-G10','GRP-Q-10','active');
    insert into offers(offer_id,candidate_id,doc_id,application_id,accepted_date,first_working_date,start_confirmation,created_at,updated_at) values
      (41,'CAN-Q-G1','REQ-Q-1','10000000-0000-0000-0000-000000000041','2026-10-01',null,null,now(),now()),
      (42,'CAN-Q-G10','REQ-Q-1','10000000-0000-0000-0000-000000000042','2026-10-01',null,null,now(),now());
    insert into recruitment_logs(log_id,candidate_id,application_id,result,superseded_at,superseded_by_stage_instance_id,recruitment_process,round,log_date,outcome_date,stage_instance_id,updated_at) values
      (41,'CAN-Q-G1','10000000-0000-0000-0000-000000000041',null,null,null,'Offer',1,'2026-10-01',null,'20000000-0000-0000-0000-000000000041',now()),
      (42,'CAN-Q-G1','10000000-0000-0000-0000-000000000041',null,null,null,'Phone Screen',1,'2026-10-02',null,'20000000-0000-0000-0000-000000000042',now()),
      (43,'CAN-Q-G10','10000000-0000-0000-0000-000000000042',null,null,null,'Offer',1,'2026-10-01',null,'20000000-0000-0000-0000-000000000043',now()),
      (44,'CAN-Q-G10','10000000-0000-0000-0000-000000000042',null,null,null,'Phone Screen',1,'2026-10-02',null,'20000000-0000-0000-0000-000000000044',now());`);
  const groupQuality=(await query(`select public.app_home_quality_page_v1('{"groupId":"GRP-Q-1"}'::jsonb,$1,null,null,null,25) as data`,[qualityRangeDate])).data;
  assert(groupQuality.totalCount>25&&groupQuality.hasMore,'group-scoped quality total counts the full population beyond the first cursor page');
  assert(groupQuality.items.every(row=>row.entityId!=='REQ-Q-10'&&row.entityId!=='GRP-Q-10'),'exact group ID avoids prefix-collision issues from a neighboring group');
  const groupQualityTail=(await query(`select public.app_home_quality_page_v1('{"groupId":"GRP-Q-1"}'::jsonb,$1,$2,$3,$4,25) as data`,[qualityRangeDate,groupQuality.nextCursor.severity,groupQuality.nextCursor.title,groupQuality.nextCursor.id])).data;
  assert(groupQualityTail.items.length>0&&groupQualityTail.items.every(row=>row.entityId!=='REQ-Q-10'&&row.entityId!=='GRP-Q-10'),'group cursor remains within the exact group scope');
  const scopedQualityRows=[...groupQuality.items,...groupQualityTail.items];let scopedCursor=groupQualityTail.nextCursor;
  while(scopedCursor){const next=(await query(`select public.app_home_quality_page_v1('{"groupId":"GRP-Q-1"}'::jsonb,$1,$2,$3,$4,50) as data`,[qualityRangeDate,scopedCursor.severity,scopedCursor.title,scopedCursor.id])).data;scopedQualityRows.push(...next.items);scopedCursor=next.nextCursor;}
  assert.equal(scopedQualityRows.length,groupQuality.totalCount,'group-scoped cursor pages exhaust exact count without gaps');
  assert(scopedQualityRows.some(row=>row.entityId==='CAN-Q-G1'&&row.workspaceCode==='pipelineOrder'),'quality page includes selected-group authorized application issues');
  const globalDuplicate=scopedQualityRows.find(row=>row.entityId==='CAN-Q-G1'&&row.workspaceCode==='duplicateCandidate');
  assert(globalDuplicate&&globalDuplicate.workspaceParams.fields==='phone','duplicate matching remains globally scoped to authorized candidates outside the selected group');
  await query(`select set_config('test.hidden_candidate','CAN-Q-REMOTE',false)`);
  const hiddenDuplicate=(await query(`select public.app_home_quality_page_v1('{"groupId":"GRP-Q-1"}'::jsonb,$1,null,null,null,50) as data`,[qualityRangeDate])).data;
  assert(!hiddenDuplicate.items.some(row=>row.entityId==='CAN-Q-G1'&&row.workspaceCode==='duplicateCandidate'),'candidate RLS prevents hidden outside-group identities from influencing duplicate flags');
  await query(`select set_config('test.hidden_candidate','',false)`);
  assert(!scopedQualityRows.some(row=>row.entityId==='CAN-Q-G10'),'shared requisition does not pull people from neighboring group');
  assert(scopedQualityRows.some(row=>row.entityId==='GRP-Q-1'&&row.workspaceCode==='groupSourcingStale'),'group quality page includes selected-group sourcing issue');
  assert(!scopedQualityRows.some(row=>row.entityId==='GRP-Q-10'&&row.workspaceCode==='groupSourcingStale'),'shared requisition does not pull neighboring group sourcing issues');
  assert(scopedQualityRows.some(row=>row.entityId==='41'&&row.workspaceCode==='offerMissingStart')&&scopedQualityRows.some(row=>row.entityId==='42'&&row.workspaceCode==='offerMissingStart'),'group quality retains all offers linked to the selected requisition, matching the saved context');
  await query(`select set_config('test.application_access','false',false)`);
  const deniedGroupQuality=(await query(`select public.app_home_quality_page_v1('{"groupId":"GRP-Q-1"}'::jsonb,$1,null,null,null,50) as data`,[qualityRangeDate])).data;
  assert(!deniedGroupQuality.items.some(row=>row.entityId==='CAN-Q-G1')&&deniedGroupQuality.totalCount>0,'candidate journey RLS removes people issues while scoped requisition issues remain');
  await query(`select set_config('test.application_access','true',false)`);
  const exactDocQuality=(await query(`select public.app_home_quality_page_v1('{"docId":"REQ-Q-1"}'::jsonb,$1,null,null,null,50) as data`,[qualityRangeDate])).data;
  assert(exactDocQuality.totalCount>0&&exactDocQuality.items.some(row=>row.entityId==='REQ-Q-1'));
  assert(exactDocQuality.items.every(row=>row.entityId!=='REQ-Q-10'),'exact requisition ID excludes prefix-collision requisition');
  assert(exactDocQuality.items.some(row=>row.entityId==='CAN-Q-G10'&&row.workspaceCode==='pipelineOrder')&&exactDocQuality.items.some(row=>row.entityId==='42'&&row.workspaceCode==='offerMissingStart'),'requisition scope preserves all issues linked to its groups and offers');
  const intersectQuality=(await query(`select public.app_home_quality_page_v1('{"groupId":"GRP-Q-1","docId":"REQ-Q-10"}'::jsonb,$1,null,null,null,50) as data`,[qualityRangeDate])).data;
  assert.equal(intersectQuality.totalCount,0,'group and requisition scope keys intersect rather than widening scope');
  const globalQuality=(await query(`select public.app_home_quality_page_v1('{}'::jsonb,$1,null,null,null,50) as data`,[qualityRangeDate])).data;
  assert(globalQuality.totalCount>=qualityAll.length,'omitting detail keys preserves the unfiltered Home population');
  await assert.rejects(query(`select public.app_home_quality_page_v1('{"groupId":""}'::jsonb,$1,null,null,null,25) as data`,[qualityRangeDate]),/HOME_SCOPE_INVALID/);
  await db.exec(`insert into public.requisitions(doc_id,is_priority,pr_approved_date,site,position,department,section,level,head_count,person_in_charge,request_type,status,created_at,updated_at)
    select 'REQ-SORT-'||lpad(n::text,3,'0'),false,'2026-07-01','KT1','Aardvark '||lpad(n::text,3,'0'),'Ops','Plant','L2',1,'Recruiter A','New','open',now(),now() from generate_series(1,30) n`);
  const requisitionsSort1=(await query(`select public.app_dashboard_active_requisitions_page_v1('2026-07-01','2026-07-31','custom','status','{}'::jsonb,null,null,25,'','{"position":"Aardvark"}'::jsonb,'position','desc') as data`)).data;
  assert.equal(requisitionsSort1.total,30,'server filters report population before returning a bounded row page');
  assert.equal(requisitionsSort1.rows.length,25);assert.equal(requisitionsSort1.rows[0].doc_id,'REQ-SORT-030');assert.equal(requisitionsSort1.rows[24].doc_id,'REQ-SORT-006');
  assert(requisitionsSort1.hasMore&&requisitionsSort1.nextCursor,'server sorted page exposes a continuation cursor');
  const requisitionsSort2=(await query(`select public.app_dashboard_active_requisitions_page_v1('2026-07-01','2026-07-31','custom','status','{}'::jsonb,$1,$2,25,'','{"position":"Aardvark"}'::jsonb,'position','desc') as data`,[requisitionsSort1.nextCursor.value,requisitionsSort1.nextCursor.id])).data;
  assert.equal(requisitionsSort2.rows.length,5);assert.equal(requisitionsSort2.rows[0].doc_id,'REQ-SORT-005');assert.equal(requisitionsSort2.hasMore,false);
  assert.equal(new Set([...requisitionsSort1.rows,...requisitionsSort2.rows].map(row=>row.doc_id)).size,30,'global sort cursor pages have no duplicates or gaps beyond the first 25 matches');
  const requisitionSearch=(await query(`select public.app_dashboard_active_requisitions_page_v1('2026-07-01','2026-07-31','custom','status','{}'::jsonb,null,null,25,'Aardvark 030','{}'::jsonb,'position','asc') as data`)).data;
  assert.equal(requisitionSearch.total,1);assert.equal(requisitionSearch.rows[0].doc_id,'REQ-SORT-030','global report search is applied before page selection');
  await db.exec(`delete from public.profiles where id='00000000-0000-0000-0000-000000000001'`);
  await assert.rejects(query(`select public.app_dashboard_performance_summary_v1('2026-07-01','2026-07-31','2026-06-01','2026-06-30','custom','{}'::jsonb)`), /AUTHENTICATED_PROFILE_REQUIRED/);
  await assert.rejects(query(`select public.app_dashboard_company_report()`), /authenticated application profile is required/i);
  const { loadHomeSummary, clearDashboardSummaryCache } = require(path.join(root, 'src/lib/dashboard-summary-client.ts'));
  clearDashboardSummaryCache();
  const summaryClient = (value, userId) => ({
    supabaseUrl:'https://project.example',
    auth:{getSession:async()=>({data:{session:{user:{id:userId}}},error:null})},
    rpc:async()=>({data:{requisitions:{open:value,priorityOpen:0},candidatePipeline:[],sourcing:{staleGroups:0,latestWeek:null},needsAction:{pendingCandidates:0,overduePending:0},counts:{openRequisitions:value,activePipeline:0,staleSourcing:0,pendingOffers:0,qualityIssues:0},workQueue:{items:[],totalCount:0},recentActivity:[]},error:null})
  });
  const sharedScope={headerSite:'',headerPic:'',priorityOnly:false};
  const cacheA=summaryClient(2,'user-a'),cacheB=summaryClient(9,'user-a');
  assert.equal((await loadHomeSummary(cacheA,sharedScope,'same-profile-key')).requisitions.open,2);
  assert.equal((await loadHomeSummary(cacheB,sharedScope,'same-profile-key')).requisitions.open,9,'different database clients must not share a cached user summary');
  const cacheDifferentUser=summaryClient(7,'user-b');
  assert.equal((await loadHomeSummary(cacheA,sharedScope,'same-profile-key')).requisitions.open,2);
  assert.equal((await loadHomeSummary(cacheDifferentUser,sharedScope,'same-profile-key')).requisitions.open,7,'different authenticated identities must not share cached summaries');

  // Compare the complete pre-optimization output with the YTD materialization migration.
  await db.exec(`insert into public.profiles(id,role,site) values('00000000-0000-0000-0000-000000000001','system_admin',null)`);
  await db.exec(`insert into public.recruitment_logs(log_id,candidate_id,application_id,recruitment_process,round,log_date,outcome_date,result,stage_instance_id,superseded_at)
    select 90000+n,'CAN-1','10000000-0000-0000-0000-000000000001'::uuid,'Phone Screen',1+n,
      date '2026-01-01'+(n%300),date '2026-01-01'+(n%300),(n%2)::smallint,md5('ytd-rank-'||n)::uuid,
      case when n%7=0 then '2026-10-31T00:00:00Z'::timestamptz end from generate_series(1,1001) n`);
  const ytdCases=[
    {period:'ytd',start:'2026-01-01',end:'2026-10-31',scope:{},channel:'all'},
    {period:'ytd',start:'2026-01-01',end:'2026-10-31',scope:{sites:['KT1'],priorityOnly:true},channel:'all'},
    {period:'ytd',start:'2026-01-01',end:'2026-10-31',scope:{headerPic:'Recruiter A',departments:['Production'],levels:['0-3']},channel:'Facebook'},
    {period:'mtd',start:'2026-07-01',end:'2026-07-31',scope:{},channel:'all'},
    {period:'custom',start:'2026-06-01',end:'2026-07-31',scope:{},channel:'JobThai'},
    {period:'pim',start:'2026-01-01',end:'2026-10-31',scope:{},channel:'all'},
    {period:'ytd',start:'2025-01-01',end:'2025-10-31',scope:{},channel:'all'},
    {period:'ytd',start:'2026-01-01',end:'2026-10-31',scope:{},channel:'all',hidden:'CAN-1'},
    {period:'ytd',start:'2026-01-01',end:'2026-10-31',scope:{},channel:'all',candidateAccess:'false'},
    {period:'ytd',start:'2026-01-01',end:'2026-10-31',scope:{},channel:'all',applicationAccess:'false'},
    {period:'ytd',start:'2026-01-01',end:'2026-10-31',scope:{},channel:'all',requisitionAccess:'false'}
  ];
  async function captureYtdCases() {
    const results=[];
    for(const c of ytdCases) {
      await db.query("select set_config('test.hidden_candidate',$1,false),set_config('test.candidate_access',$2,false),set_config('test.application_access',$3,false),set_config('test.requisition_access',$4,false)",
        [c.hidden??'',c.candidateAccess??'true',c.applicationAccess??'true',c.requisitionAccess??'true']);
      const scope=JSON.stringify(c.scope);
      const pipeline=(await query('select public.app_dashboard_pipeline_summary_v1($1,$2,$3,$4::jsonb,$5) data',[c.start,c.end,c.period,scope,c.channel])).data;
      const pages=[];
      for(const mode of ['activity','status','accum']) {
        const first=(await query('select public.app_dashboard_active_requisitions_page_v1($1,$2,$3,$4,$5::jsonb,null,null,25) data',[c.start,c.end,c.period,mode,scope])).data;
        const second=first.nextCursor?(await query('select public.app_dashboard_active_requisitions_page_v1($1,$2,$3,$4,$5::jsonb,$6,$7,25) data',[c.start,c.end,c.period,mode,scope,first.nextCursor.value,first.nextCursor.id])).data:null;
        pages.push({first,second});
      }
      results.push({pipeline,pages});
    }
    return results;
  }
  const authorizationSnapshot=await db.query("select proname,pg_get_functiondef(oid) definition from pg_proc where pronamespace='app_private'::regnamespace and proname like 'can_%' order by oid");
  const beforeYtd=await captureYtdCases();
  const ytdMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261102123500_ytd_report_materialization.sql'),'utf8');
  await db.exec(ytdMigration);
  assert.deepEqual(await captureYtdCases(),beforeYtd,'YTD/MTD/PIM/custom complete JSON parity, all scopes, channels, stage modes, cursor pages and denied/hidden candidates');
  assert.deepEqual(await db.query("select proname,pg_get_functiondef(oid) definition from pg_proc where pronamespace='app_private'::regnamespace and proname like 'can_%' order by oid"),authorizationSnapshot,'materialization does not change authorization helpers');
  assert.match(ytdMigration,/resume_ranks as materialized/);
  assert.match(ytdMigration,/pass_ranks as materialized/);
  assert.match(ytdMigration,/stage_pivot as materialized/);
  console.log('YTD materialization: 1,001 extra historical stages; 11 scope/access cases, all three stage modes, full JSON and cursor parity passed.');

  console.log('Performance/Rejection SQL parity, role boundaries, cross-filters, cursor paging, Saturday–Friday trends, trimmed/invalid levels, calendar metadata, Home DTO, and cache isolation passed.');
  await db.close();
}
main().catch(async error => { console.error(error); if(error.internalQuery&&error.internalPosition)console.error('query-context',error.internalQuery.slice(Number(error.internalPosition)-200,Number(error.internalPosition)+200)); await db.close(); process.exitCode = 1; });
