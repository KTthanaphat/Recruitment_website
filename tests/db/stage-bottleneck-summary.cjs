const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { PGlite } = require(process.env.RECRUITMENT_PGLITE_PATH || "@electric-sql/pglite");
const sqlText = value => `'${String(value).replaceAll("'", "''")}'`;
const repoRoot = path.resolve(__dirname, "../..");
const pnpmModules = path.join(repoRoot, "node_modules", ".pnpm");
const typescriptPackage = fs.existsSync(path.join(repoRoot, "node_modules", "typescript")) ? path.join(repoRoot, "node_modules", "typescript") : path.join(pnpmModules, fs.readdirSync(pnpmModules).find(name => name.startsWith("typescript@")), "node_modules", "typescript");
const ts = require(typescriptPackage);
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    const base = path.join(repoRoot, "src", request.slice(2));
    for (const candidate of [base + ".ts", base + ".tsx", path.join(base, "index.ts")]) if (fs.existsSync(candidate)) return candidate;
  }
  return resolveFilename.call(this, request, parent, isMain, options);
};
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpile(fs.readFileSync(filename, "utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }), filename);

async function main() {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema app_private; create role authenticated; create role anon;
    create function auth.uid() returns uuid language sql stable as $$ select 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$;
    create function app_private.can_read_application(uuid) returns boolean language sql stable as $$ select true $$;
    create function app_private.can_read_candidate(text) returns boolean language sql stable as $$ select true $$;
    create function app_private.can_read_requisition(text) returns boolean language sql stable as $$ select true $$;
    create function app_private.is_recruitment_reader() returns boolean language sql stable as $$ select true $$;
    create table public.candidates(candidate_id text primary key,name text not null,channel text);
    create table public.candidate_applications(application_id uuid primary key,candidate_id text not null,group_id text not null,state text not null,created_at timestamptz default now());
    create table public.candidate_application_assignments(assignment_id uuid primary key,application_id uuid,group_id text,started_at timestamptz,ended_at timestamptz);
    create table public.recruitment_logs(log_id bigint primary key,stage_instance_id uuid,application_id uuid,candidate_id text,log_date date,recruitment_process text,round int,result smallint,outcome_date date,estimated_action_date date,pending_edited_at timestamptz,record_origin text,migration_note text,superseded_at timestamptz,superseded_by_stage_instance_id uuid,entry_assignment_id uuid,outcome_assignment_id uuid);
    create table public.requisitions(doc_id text primary key,site text,department text,position text,person_in_charge text,level text,is_priority boolean,head_count int,status text,created_at timestamptz,pr_approved_date date);
    create table public.document_groups(doc_group_id text,doc_id text,group_id text);
    create table public.requisition_logs(log_id bigint,doc_id text,log_date date,status text);
    create table public.offers(offer_id bigint,application_id uuid,candidate_id text,doc_id text,accepted_date date,start_confirmation text,start_confirmed_at timestamptz);
  `);
  await db.exec(`create function auth.test_inline_cte() returns integer language plpgsql as $$ declare v integer; begin v := (with x as (select 2 n) select n from x); return v; end; $$;`);
  assert.equal((await db.query(`select auth.test_inline_cte() value`)).rows[0].value, 2);
  await db.exec(`drop function auth.test_inline_cte()`);
  await db.exec(`create function auth.test_two_into() returns integer language plpgsql as $$ declare a integer; b integer; begin select 2 into a; select 3 into b; return a+b; end; $$;`);
  assert.equal((await db.query(`select auth.test_two_into() value`)).rows[0].value, 5);
  await db.exec(`drop function auth.test_two_into()`);
  const sql = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261101152821_stage_bottleneck_summaries.sql"), "utf8");
  const declarativeSql = fs.readFileSync(path.resolve(__dirname, "../../supabase/schemas/62_bottleneck_report.sql"), "utf8").replaceAll("\r\n", "\n");
  const migrationSql = sql.replaceAll("\r\n", "\n");
  assert.ok(migrationSql.startsWith(declarativeSql), "generated Bottleneck migration matches declarative schema");
  assert.equal(sql.includes("v_page:=public.app_dashboard_bottleneck_queue_v1"), false, "summary computes one SQL aggregate instead of iterating queue pages");
  await db.exec(sql);
  await db.exec(`revoke all on function public.app_dashboard_bottleneck_summary_v1(date,date,date,date,jsonb,text,date[]), public.app_dashboard_bottleneck_queue_v1(date,jsonb,text,text,text,text,text,text,text,text,text,integer) from public,anon,authenticated;
    grant execute on function public.app_dashboard_bottleneck_summary_v1(date,date,date,date,jsonb,text,date[]), public.app_dashboard_bottleneck_queue_v1(date,jsonb,text,text,text,text,text,text,text,text,text,integer) to authenticated;`);
  const access = await db.query(`select has_function_privilege('authenticated','public.app_dashboard_bottleneck_queue_v1(date,jsonb,text,text,text,text,text,text,text,text,text,integer)','EXECUTE') auth_ok,
    has_function_privilege('anon','public.app_dashboard_bottleneck_queue_v1(date,jsonb,text,text,text,text,text,text,text,text,text,integer)','EXECUTE') anon_ok,
    to_regprocedure('app_private.dashboard_bottleneck_attempts_v1()') helper`);
  assert.equal(access.rows[0].auth_ok, true);
  assert.equal(access.rows[0].anon_ok, false);
  assert.equal(access.rows[0].helper, null);
  await db.exec(`
    insert into candidates values ('CAN-0001','Waiting One','LinkedIn'),('CAN-0002','Waiting Two','Referral'),('CAN-0003','Hidden','Other');
    insert into candidate_applications(application_id,candidate_id,group_id,state) values
      ('10000000-0000-0000-0000-000000000001','CAN-0001','GRP-0001','active'),
      ('10000000-0000-0000-0000-000000000002','CAN-0002','GRP-0001','closed'),
      ('10000000-0000-0000-0000-000000000003','CAN-0003','GRP-0002','active');
    insert into requisitions values ('REQ-1','North','HR','Recruiter','Owner A','5',false,2,'ongoing','2026-01-01','2026-01-01');
    insert into document_groups values ('DG-1','REQ-1','GRP-0001');
    insert into recruitment_logs(log_id,stage_instance_id,application_id,candidate_id,log_date,recruitment_process,round,result,outcome_date,estimated_action_date,record_origin)
    values (1,'20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','CAN-0001','2026-10-20','HR Interview',1,null,null,'2026-10-25','user'),
      (2,'20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','CAN-0002','2026-10-21','Offer',1,null,null,'2026-11-01','user'),
      (3,'20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','CAN-0003','2026-10-22','Offer',1,null,null,'2026-11-01','user');
    insert into candidates select 'CAN-'||lpad(i::text,4,'0'),'Bulk '||i,'LinkedIn' from generate_series(4,28) i;
    insert into candidate_applications(application_id,candidate_id,group_id,state)
      select ('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'CAN-'||lpad(i::text,4,'0'),'GRP-0001','active' from generate_series(4,28) i;
    insert into recruitment_logs(log_id,stage_instance_id,application_id,candidate_id,log_date,recruitment_process,round,result,outcome_date,estimated_action_date,record_origin)
      select i,('20000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,('10000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
        'CAN-'||lpad(i::text,4,'0'),'2026-10-20','HR Interview',1,null,null,'2026-10-25','user' from generate_series(4,28) i;
    insert into candidates values ('CAN-0029','Legacy Completed','Referral');
    insert into candidate_applications(application_id,candidate_id,group_id,state) values ('10000000-0000-0000-0000-000000000029','CAN-0029','GRP-0001','closed');
    insert into recruitment_logs(log_id,stage_instance_id,application_id,candidate_id,log_date,recruitment_process,round,result,outcome_date,estimated_action_date,record_origin)
      values (29,null,'10000000-0000-0000-0000-000000000029','CAN-0029','2026-10-10','HR Interview',1,null,null,'2026-10-20','user'),
        (30,null,'10000000-0000-0000-0000-000000000029','CAN-0029','2026-10-14','HR Interview',1,1,null,null,'user');
    insert into candidates values ('CAN-0030','No Show Confirmation After As Of','Referral'),('CAN-0031','V2 Failure Missing Outcome','Referral'),('CAN-0032','Legacy Failure','Referral'),
      ('CAN-0033','Future Completed Outcome','Referral'),('CAN-0034','Zero Day Wait','Referral'),('CAN-0035','Transferred Completed Journey','Referral');
    insert into candidate_applications(application_id,candidate_id,group_id,state) values
      ('10000000-0000-0000-0000-000000000030','CAN-0030','GRP-0003','active'),
      ('10000000-0000-0000-0000-000000000031','CAN-0031','GRP-0004','active'),
      ('10000000-0000-0000-0000-000000000032','CAN-0032','GRP-0005','active'),
      ('10000000-0000-0000-0000-000000000033','CAN-0033','GRP-0001','active'),
      ('10000000-0000-0000-0000-000000000034','CAN-0034','GRP-0001','active'),
      ('10000000-0000-0000-0000-000000000035','CAN-0035','GRP-0006','closed');
    insert into requisitions values
      ('REQ-3','North','HR','Recruiter','Owner A','5',false,2,'ongoing','2026-01-01','2026-01-01'),
      ('REQ-4','North','HR','Recruiter','Owner A','5',false,1,'ongoing','2026-01-01','2026-01-01'),
      ('REQ-5','North','HR','Recruiter','Owner A','5',false,1,'ongoing','2026-01-01','2026-01-01');
    insert into document_groups values ('DG-3','REQ-3','GRP-0003'),('DG-4','REQ-4','GRP-0004'),('DG-5','REQ-5','GRP-0005');
    insert into offers(offer_id,application_id,candidate_id,doc_id,accepted_date,start_confirmation,start_confirmed_at)
      values (1,'10000000-0000-0000-0000-000000000030','CAN-0030','REQ-3','2026-10-30','did_not_start','2026-11-02 12:00:00+07');
    insert into recruitment_logs(log_id,stage_instance_id,application_id,candidate_id,log_date,recruitment_process,round,result,outcome_date,estimated_action_date,record_origin)
      values (35,'20000000-0000-0000-0000-000000000030','10000000-0000-0000-0000-000000000030','CAN-0030','2026-10-20','HR Interview',1,null,null,'2026-11-05','user'),
        (31,'20000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000031','CAN-0031','2026-10-20','HR Interview',1,null,null,'2026-11-05','user'),
        (32,'20000000-0000-0000-0000-000000000032','10000000-0000-0000-0000-000000000032','CAN-0032','2026-10-20','HR Interview',1,null,null,'2026-11-05','user'),
        (33,'20000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000031','CAN-0031','2026-10-29','HR Interview',2,0,null,null,'user'),
        (34,null,'10000000-0000-0000-0000-000000000032','CAN-0032','2026-10-29','HR Interview',2,0,null,null,'user'),
        (36,'20000000-0000-0000-0000-000000000036','10000000-0000-0000-0000-000000000033','CAN-0033','2026-10-20','HR Interview',1,1,'2026-11-03',null,'user'),
        (37,'20000000-0000-0000-0000-000000000037','10000000-0000-0000-0000-000000000034','CAN-0034','2026-11-01','Test',1,null,null,'2026-11-01','user'),
        (38,'20000000-0000-0000-0000-000000000038','10000000-0000-0000-0000-000000000035','CAN-0035','2026-10-20','Phone Screen',1,1,'2026-10-29',null,'user');
    insert into candidate_application_assignments(assignment_id,application_id,group_id,started_at,ended_at) values
      ('30000000-0000-0000-0000-000000000035','10000000-0000-0000-0000-000000000035','GRP-0001','2026-10-01','2026-10-30'),
      ('30000000-0000-0000-0000-000000000036','10000000-0000-0000-0000-000000000035','GRP-0006','2026-10-31',null);
    update recruitment_logs set outcome_assignment_id='30000000-0000-0000-0000-000000000035' where log_id=38;
  `);
  const firstPage = await db.query(`select public.app_dashboard_bottleneck_queue_v1('2026-11-01','{}'::jsonb,'all',null,null,null,'',null,null,null,null,20) page`);
  const pageOne = firstPage.rows[0].page;
  assert.equal(pageOne.rows.length, 20);
  assert.equal(pageOne.hasMore, true);
  assert.ok(pageOne.nextCursor);
  assert.equal(pageOne.rows[0].rows, undefined);
  assert.equal(pageOne.rows[0].instance.due, "2026-10-25");
  assert.equal(pageOne.rows[0].requisitions[0].doc_id, "REQ-1");
  const noShow = await db.query(`select public.app_dashboard_bottleneck_queue_v1('2026-11-01','{}'::jsonb,'all',null,null,null,'CAN-0030',null,null,null,null,20) page`);
  assert.equal(noShow.rows[0].page.rows.length, 1, "a did_not_start offer remains unaccepted even when confirmation is after as-of");
  const missingV2Outcome = await db.query(`select public.app_dashboard_bottleneck_queue_v1('2026-11-01','{}'::jsonb,'all',null,null,null,'CAN-0031',null,null,null,null,20) page`);
  assert.equal(missingV2Outcome.rows[0].page.rows.length, 1, "a v2 failure without outcome_date does not terminate a journey");
  const legacyFailure = await db.query(`select public.app_dashboard_bottleneck_queue_v1('2026-11-01','{}'::jsonb,'all',null,null,null,'CAN-0032',null,null,null,null,20) page`);
  assert.equal(legacyFailure.rows[0].page.rows.length, 0, "a legacy failure uses its log_date and terminates the journey");
  const futureOutcome = await db.query(`select public.app_dashboard_bottleneck_queue_v1('2026-11-01','{}'::jsonb,'all',null,null,null,'CAN-0033',null,null,null,null,20) page`);
  assert.equal(futureOutcome.rows[0].page.rows[0].instance.outcome, "2026-11-03", "future outcomes remain unresolved at the report as-of date");
  assert.equal(futureOutcome.rows[0].page.rows[0].instance.result, 1);
  const { buildStageBottleneckReport } = require(path.join(repoRoot, "src/lib/stage-bottleneck-report.ts"));
  const tsCandidates = (await db.query(`select candidate_id,name,null::text nickname,channel,null::text group_id,null::text doc_group_id from candidates`)).rows;
  const tsApplications = (await db.query(`select application_id,candidate_id,group_id,state from candidate_applications`)).rows;
  const tsLogs = (await db.query(`select log_id,stage_instance_id,application_id,candidate_id,log_date::text log_date,recruitment_process,round,result,outcome_date::text outcome_date,estimated_action_date::text estimated_action_date,pending_edited_at::text pending_edited_at,record_origin,migration_note,superseded_at,superseded_by_stage_instance_id,entry_assignment_id,outcome_assignment_id from recruitment_logs`)).rows;
  const tsReqs = (await db.query(`select doc_id,site,department,position,person_in_charge,level,is_priority,head_count,status,(created_at at time zone 'Asia/Bangkok')::date::text created_at,pr_approved_date::text pr_approved_date from requisitions`)).rows;
  const tsData = { candidates:tsCandidates,candidate_applications:tsApplications,candidate_application_assignments:(await db.query(`select assignment_id,application_id,group_id,started_at::text started_at,ended_at::text ended_at from candidate_application_assignments`)).rows,recruitment_logs:tsLogs,
    requisitions:tsReqs,document_groups:(await db.query(`select doc_group_id,doc_id,group_id from document_groups`)).rows,
    requisition_logs:(await db.query(`select log_id,doc_id,log_date,status from requisition_logs`)).rows,
    offers:(await db.query(`select offer_id,application_id,candidate_id,doc_id,accepted_date::text accepted_date,start_confirmation,start_confirmed_at::text start_confirmed_at from offers`)).rows };
  const range={start:"2026-10-01",end:"2026-11-01"},priorRange={start:"2026-09-01",end:"2026-09-30"};
  const modelReport=buildStageBottleneckReport(tsData,tsReqs,range,"2026-11-01",priorRange);
  const trendDates=modelReport.trends.map(row=>row.date);
  const summary = await db.query(`select public.app_dashboard_bottleneck_summary_v1('2026-10-01','2026-11-01','2026-09-01','2026-09-30','{}'::jsonb,'all',array[${trendDates.map(value=>`${sqlText(value)}::date`).join(",")}]) report`);
  const sqlReport=summary.rows[0].report;
  assert.deepEqual(sqlReport.metrics,modelReport.metrics,"SQL Bottleneck metrics match buildStageBottleneckReport");
  assert.deepEqual(sqlReport.stages.map(({stage,sample,median,p90,waiting,oldest})=>({stage,sample,median,p90,waiting,oldest})),modelReport.stages,"SQL stage rows match buildStageBottleneckReport");
  assert.deepEqual(sqlReport.priorMetrics,modelReport.prior.metrics,"SQL prior metrics match buildStageBottleneckReport");
  assert.deepEqual(sqlReport.trends,modelReport.trends,"SQL trend buckets match buildStageBottleneckReport");
  assert.equal(sqlReport.conflicts,modelReport.conflicts);
  assert.equal(sqlReport.trends.length,modelReport.trends.length);
  const hrSummary = sqlReport.stages.find(row => row.stage === "HR Interview");
  assert.equal(sqlReport.metrics.waiting, 31);
  assert.equal(sqlReport.statusCounts.overdue, 26);
  assert.equal(sqlReport.trends.length, modelReport.trends.length);
  assert.equal(hrSummary.sample, 1);
  assert.equal(hrSummary.median, 4);
  assert.equal(sqlReport.stages.find(row => row.stage === "Test").oldest, 0, "same-day waiting age stays zero rather than null");
  const lastPage = await db.query(`select public.app_dashboard_bottleneck_queue_v1('2026-11-01','{}'::jsonb,'all',null,null,null,'',${sqlText(pageOne.nextCursor.value)},${sqlText(pageOne.nextCursor.id)},null,null,20) page`);
  const pageTwo = lastPage.rows[0].page;
  assert.equal(pageTwo.rows.length, 11);
  assert.equal(pageTwo.hasMore, false);
  assert.equal(Object.hasOwn(pageTwo, "total"), false, "page envelope omits an expensive exact count");
  assert.deepEqual([...pageOne.rows,...pageTwo.rows].map(row => row.candidate.candidate_id),modelReport.waiting.map(row => row.candidate.candidate_id),"cursor pages exhaust SQL/TS queue rows in the same order");
  const previous = await db.query(`select public.app_dashboard_bottleneck_queue_v1('2026-11-01','{}'::jsonb,'all',null,null,null,'',null,null,${sqlText(pageTwo.previousCursor.value)},${sqlText(pageTwo.previousCursor.id)},20) page`);
  assert.deepEqual(previous.rows[0].page.rows.map(row => row.candidate.application_id), pageOne.rows.map(row => row.candidate.application_id));
  await db.exec(`insert into candidates values ('CAN-00001','Alias Collision','LinkedIn');
    insert into candidate_applications(application_id,candidate_id,group_id,state)
      values('10000000-0000-0000-0000-000000000036','CAN-00001','GRP-0001','active');
    insert into recruitment_logs(log_id,stage_instance_id,application_id,candidate_id,log_date,recruitment_process,round,result,estimated_action_date,record_origin)
      values(100,'20000000-0000-0000-0000-000000000100','10000000-0000-0000-0000-000000000036','CAN-00001','2026-10-20','HR Interview',1,null,'2026-11-05','user');`);
  for (const idSearch of ["CAN-0001", "CAN-00001"]) {
    const aliasQueue = await db.query(`select public.app_dashboard_bottleneck_queue_v1('2026-11-01','{}'::jsonb,'all',null,null,null,${sqlText(idSearch)},null,null,null,null,20) page`);
    assert.deepEqual(aliasQueue.rows[0].page.rows.map(row => row.candidate.candidate_id).sort(), ["CAN-00001", "CAN-0001"], `queue search ${idSearch} matches both padded/legacy candidates and preserves raw IDs`);
  }
  await db.exec(`update recruitment_logs set superseded_by_stage_instance_id='20000000-0000-0000-0000-000000000001' where log_id=2`);
  const superseded = await db.query(`select public.app_dashboard_bottleneck_queue_v1('2026-11-01','{}'::jsonb,'all',null,null,null,'CAN-0002',null,null,null,null,20) page`);
  assert.equal(superseded.rows[0].page.rows.length, 0);
  if (process.env.BOTTLENECK_10K_BENCH === "1") {
    const seedStarted = performance.now();
    await db.exec(`
      insert into candidates select 'LOAD-'||lpad(i::text,5,'0'),'Load '||i,'Referral' from generate_series(1,10000) i;
      insert into candidate_applications(application_id,candidate_id,group_id,state)
        select md5('load-app-'||i)::uuid,'LOAD-'||lpad(i::text,5,'0'),'GRP-0001','active' from generate_series(1,10000) i;
      insert into recruitment_logs(log_id,stage_instance_id,application_id,candidate_id,log_date,recruitment_process,round,result,outcome_date,estimated_action_date,record_origin)
        select 1000+i,md5('load-stage-'||i)::uuid,md5('load-app-'||i)::uuid,'LOAD-'||lpad(i::text,5,'0'),'2026-10-20','HR Interview',1,null,null,'2026-11-05','user'
        from generate_series(1,10000) i;
    `);
    const seedMs = Math.round(performance.now() - seedStarted);
    const started = performance.now();
    const plan = await db.query(`explain analyze select public.app_dashboard_bottleneck_summary_v1('2026-10-01','2026-11-01',null,null,'{}'::jsonb,'all','{}'::date[])`);
    const elapsedMs = Math.round(performance.now() - started);
    const planText = String(plan.rows[0]["QUERY PLAN"]);
    assert.match(planText, /Function Scan|Result/);
    console.log(JSON.stringify({ benchmark: "PGlite 10k authorized journeys", seedMs, queryMs: elapsedMs, topLevelSql: "EXPLAIN ANALYZE SELECT public.app_dashboard_bottleneck_summary_v1(...)", plan: planText, limitation: "PGlite embedded planner; inner PL/pgSQL statement count and production PostgreSQL plan are not exposed" }));
  }
  if (process.env.BOTTLENECK_INNER_BENCH === "1") {
    const benchCount = Math.max(1, Math.min(100000, Number.parseInt(process.env.BOTTLENECK_BENCH_ROWS || "1000", 10) || 1000));
    const seedStarted = performance.now();
    await db.exec(`
      insert into candidates select 'INNER-'||lpad(i::text,6,'0'),'Inner '||i,'Referral' from generate_series(1,${benchCount}) i;
      insert into candidate_applications(application_id,candidate_id,group_id,state)
        select md5('inner-app-'||i)::uuid,'INNER-'||lpad(i::text,6,'0'),'GRP-0001','active' from generate_series(1,${benchCount}) i;
      insert into candidate_application_assignments(assignment_id,application_id,group_id,started_at,ended_at)
        select md5('inner-assignment-'||i)::uuid,md5('inner-app-'||i)::uuid,'GRP-0001','2026-01-01',null from generate_series(1,${benchCount}) i;
      insert into recruitment_logs(log_id,stage_instance_id,application_id,candidate_id,log_date,recruitment_process,round,result,outcome_date,estimated_action_date,record_origin)
        select 20000+i,md5('inner-stage-'||i)::uuid,md5('inner-app-'||i)::uuid,'INNER-'||lpad(i::text,6,'0'),'2026-10-20','HR Interview',1,null,null,'2026-11-05','user'
        from generate_series(1,${benchCount}) i;
    `);
    const seedMs = Math.round(performance.now() - seedStarted);
    const start = sql.indexOf("    with authorized_logs as materialized (");
    const endToken = "    into v_queue_summary from status_counts cross join pic_counts;";
    const end = sql.indexOf(endToken, start);
    assert.ok(start >= 0 && end > start, "extract direct queue summary SQL for inner-plan profiling");
    const queueSql = sql.slice(start, end + endToken.length)
      .replace("into v_queue_summary ", "")
      .replace(/\bv_as_of\b/g, "'2026-11-01'::date")
      .replace(/\bp_scope\b/g, "'{}'::jsonb")
      .replace(/\bp_channel\b/g, "'all'::text");
    const explainSql = `explain analyze ${queueSql}`;
    const queryStarted = performance.now();
    const plan = await db.query(explainSql);
    const queryMs = Math.round(performance.now() - queryStarted);
    const indexStarted = performance.now();
    await db.exec(`create index bench_assignment_app_latest on candidate_application_assignments(application_id,started_at desc,assignment_id desc) include(group_id); analyze candidate_application_assignments;`);
    const indexSetupMs = Math.round(performance.now() - indexStarted);
    const indexedStarted = performance.now();
    const indexedPlan = await db.query(explainSql);
    const indexedQueryMs = Math.round(performance.now() - indexedStarted);
    const summaryStarted = performance.now();
    const summaryPlan = await db.query(`explain analyze select public.app_dashboard_bottleneck_summary_v1('2026-10-01','2026-11-01','2026-09-01','2026-09-30','{}'::jsonb,'all',array['2026-10-01','2026-10-05','2026-10-10','2026-10-14','2026-10-19','2026-10-23','2026-10-28','2026-11-01']::date[])`);
    const summaryMs = Math.round(performance.now() - summaryStarted);
    const planText = String(plan.rows[0]["QUERY PLAN"]);
    const artifactPath = path.join(os.tmpdir(), `bottleneck-inner-queue-summary-${benchCount}.txt`);
    fs.writeFileSync(artifactPath, `seedMs=${seedMs}\nqueryMs=${queryMs}\nsql=${explainSql}\n\n${planText}\n`);
    const planHotspots = plan.rows.map(row => String(row["QUERY PLAN"])).filter(line => {
      const loops = Number(line.match(/loops=(\d+)/)?.[1] || 0);
      return loops >= 10 || line.includes("SubPlan") || line.includes("Rows Removed by Join Filter") || line.includes("Execution Time:") || line.includes("ranked_attempts");
    });
    const execTime = rows => rows.map(row => String(row["QUERY PLAN"])).find(line => line.includes("Execution Time:"))?.match(/Execution Time: ([0-9.]+) ms/)?.[1] ?? null;
    const indexPlan = indexedPlan.rows.map(row => String(row["QUERY PLAN"])).filter(line => /candidate_application_assignments|Execution Time:|Index (Only )?Scan|Seq Scan/.test(line));
    console.log(JSON.stringify({ benchmark: `PGlite ${benchCount}-journey direct inner queue summary`, seedMs, queryMs, innerExecutionMs: execTime(plan.rows), indexSetupMs, indexedQueryMs, indexedExecutionMs: execTime(indexedPlan.rows), assignmentIndexPlan: indexPlan, summaryMs, artifactPath, planHotspots, wholeSummaryPlan: summaryPlan.rows.map(row => row["QUERY PLAN"]), limitation: "Embedded PGlite planner with primary-key fixture indexes; index comparison is disposable-only and production PostgreSQL/RLS not represented" }));
  }
  console.log("stage bottleneck migration PGlite assertions passed");
  await db.close();
}
main().catch(error => { console.error({ message: error.message, stack: error.stack, position: error.position, internalPosition: error.internalPosition }); process.exitCode = 1; });
