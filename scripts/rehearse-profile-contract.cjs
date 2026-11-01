const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('child_process');
const { PGlite } = require(path.join(process.env.TEMP, 'recruitment-db-tools/node_modules/@electric-sql/pglite'));
const root = path.resolve(__dirname, '..');
const db = new PGlite();
const legacyRef = "8fc4b3a65614add9e137817accb0558c0665a956"; // Legacy base before additive application migrations.
async function main() {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema app_private;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email','migration@example.test')$$;`);
  await db.exec('grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;');
  for (const file of ['10_tables.sql','30_triggers_audit.sql','50_rpc_functions.sql','40_rls_policies.sql','90_grants.sql']) {
    const source = execFileSync('git',['show',`${legacyRef}:supabase/schemas/${file}`],{cwd:root,encoding:'utf8'}).replace('constraint offers_start_confirmation_check check','constraint offers_start_confirmation_details_check check');
    await db.exec(source);
  }
  await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values('11111111-1111-1111-1111-111111111111','migration@example.test','{"nickname":"Migration"}');
    update public.profiles set role='system_admin',site='TEST' where id='11111111-1111-1111-1111-111111111111';
    insert into public.requisitions(doc_id,site,position,department,head_count,status) values('TEST-R1','TEST','Engineer','Test',3,'ongoing'),('TEST-R2','TEST','Analyst','Test',3,'ongoing');
    insert into public.position_groups(group_id,group_position) values('TEST-G1','Engineer'),('TEST-G2','Analyst');
    insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('TEST-D1','TEST-R1','TEST-G1','Engineer'),('TEST-D2','TEST-R2','TEST-G2','Analyst');
    insert into public.candidates(candidate_id,name,group_id,phone_no,first_contact_date) values('TEST-C1','Legacy person','TEST-G1','0812345678',current_date-2);
    select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
    select public.app_start_pipeline_stage_v2('{"candidate_id":"TEST-C1","pending":{"opened_date":"2026-10-10"}}');`);
  const migrationFile = fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_independent_candidate_applications.sql'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migrationFile),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261011160759_application_context_hardening.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261011162307_application_no_show_reapplication.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261011163003_application_correction_attribution.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261011165617_application_stage_chronology.sql'),'utf8'));
  await db.exec(`update public.change_logs set changed_by='11111111-1111-1111-1111-111111111111',action='candidate:new' where entity='candidates' and entity_id='TEST-C1' and old_data is null;`);
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015074832_candidate_profile_privacy_tabs.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015080617_profile_registry_context.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015083414_group_pic_offer_context.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'tests/db/candidate-profile-contract.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015091726_candidate_group_journey_claims.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101124015_five_digit_app_ids.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/schemas/20_indexes.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/schemas/55_dashboard_report.sql'),'utf8'));
  for (const name of [
    '20261101125118_candidate_registry_list.sql',
    '20261101130623_dashboard_summaries.sql',
    '20261101130720_operational_pipeline_lists.sql',
    '20261101133343_pipeline_history_list.sql',
    '20261101134435_pipeline_history_sort_filter_contract.sql',
    '20261101134656_requisition_list_endpoint.sql',
    '20261101140739_recruitment_list_optimization.sql',
    '20261101152821_stage_bottleneck_summaries.sql'
  ]) await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',name),'utf8'));
  const destinationPageMigration = fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_async_application_destinations_lookup.sql'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',destinationPageMigration),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101174258_offer_candidates_lookup.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101180543_scoped_application_read_fastpath.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101183410_candidate_home_site_auth_fastpath.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101183700_dashboard_owner_filter_options.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101184800_rejection_id_alias_search.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102101500_home_recruitment_list_filters.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102113000_home_quality_detail_scope.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102114500_home_quality_exact_group_scope.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102120000_pipeline_stage_board_membership.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102121000_requisition_link_option_filters.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102122000_home_welcome_summaries.sql'),'utf8'));
  if (process.argv.includes('--inline-auth-experiment')) {
    await db.exec(fs.readFileSync(path.join(root,'tests/db/scoped-auth-inline-experiment.sql'),'utf8'));
  }
  const preFinalGrantAnonFunctions = await db.query(`select n.nspname,p.proname,p.pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where ((n.nspname='public' and (p.proname like 'app_recruitment_%' or p.proname like 'app_dashboard_%' or p.proname like 'app_application_destinations%' or p.proname like 'app_offer_candidates%' or p.proname like 'app_home_%'))
      or n.nspname='app_private') and has_function_privilege('anon',p.oid,'execute') order by n.nspname,p.proname,p.pronargs`);
  assert.deepEqual(preFinalGrantAnonFunctions.rows,[], 'ordered feature migrations explicitly keep new RPCs and internal authorization helpers unavailable to anon before schema90');
  await db.exec(fs.readFileSync(path.join(root,'supabase/schemas/90_grants.sql'),'utf8'));
  const anonApiFunctions = await db.query(`select p.proname,p.pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'app_recruitment_%' or p.proname like 'app_dashboard_%' or p.proname like 'app_application_destinations%' or p.proname like 'app_offer_candidates%' or p.proname like 'app_home_%')
      and has_function_privilege('anon',p.oid,'execute') order by p.proname,p.pronargs`);
  assert.deepEqual(anonApiFunctions.rows,[],'final ordered grants do not expose any recruitment, dashboard, or destination RPC to anon');
  const homeSummaryGrants = await db.query(`select p.proname,has_function_privilege('anon',p.oid,'execute') as anon_exec,
    has_function_privilege('authenticated',p.oid,'execute') as authenticated_exec from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('app_home_welcome_summary_v1','app_home_banner_summary_v1') order by p.proname`);
  assert.deepEqual(homeSummaryGrants.rows,[
    {proname:'app_home_banner_summary_v1',anon_exec:false,authenticated_exec:true},
    {proname:'app_home_welcome_summary_v1',anon_exec:false,authenticated_exec:true}
  ],'ordered migration and final grants expose both new invoker summaries only to authenticated users');
  const anonPrivateFunctions = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app_private' and has_function_privilege('anon',p.oid,'execute') order by p.proname`);
  assert.deepEqual(anonPrivateFunctions.rows,[],'internal authorization/row helpers remain unavailable to anon after final grants');
  const bottleneckDefiner = await db.query(`select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and proname in ('app_dashboard_bottleneck_summary_v1','app_dashboard_bottleneck_queue_v1') and prosecdef`);
  assert.deepEqual(bottleneckDefiner.rows,[],'bottleneck endpoints remain SECURITY INVOKER in the full ordered schema chain');
  const recruitmentListSignatures = await db.query(`select pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='app_recruitment_list_v1' order by pronargs`);
  assert.deepEqual(recruitmentListSignatures.rows,[{pronargs:10}], 'ordered list migrations leave one current named-argument PostgREST signature');
  await db.exec('set role authenticated');
  const candidatePage = await db.query(`select public.app_recruitment_list_v1(
    p_entity=>'candidate_applications',p_search=>'',p_filters=>'{}'::jsonb,p_sort=>'latest_log_date',p_direction=>'desc',
    p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) as page`);
  if (!candidatePage.rows[0].page.items.some(row=>row.candidate_id==='TEST-C1')) throw new Error('Actual authenticated candidate list did not return the authorized legacy journey.');
  const candidateCount = await db.query("select public.app_recruitment_list_count_v1('candidate_applications','','{}'::jsonb) as count");
  assert.equal(candidateCount.rows[0].count,1,'actual list count and page share application authorization scope');
  const welcomeSummary = await db.query('select public.app_home_welcome_summary_v1() as summary');
  for (const key of ['openRequisitions','openVacancy','activeCandidates','offerFinalizationNeeded','filledThisMonth','responsibleVacancyTotal','filledResponsibleVacancyRatio','filledResponsibleVacancyBucket']) assert.equal(typeof welcomeSummary.rows[0].summary[key],'number',`ordered migration returns typed welcome field ${key}`);
  const homeBanner = await db.query("select public.app_home_banner_summary_v1('{\"headerSite\":\"TEST\",\"headerPic\":\"\",\"priorityOnly\":false}'::jsonb) as summary");
  assert.equal(typeof homeBanner.rows[0].summary.monthlyFillCapacity,'number','ordered migration returns monthly capacity');
  assert.equal(typeof homeBanner.rows[0].summary.monthlyFilledCount,'number','ordered migration returns monthly accepted count');
  const stageBoardPage = await db.query(`select public.app_recruitment_list_v1(
    p_entity=>'pipeline_stage',p_search=>'Legacy person',p_filters=>' {"stage":"Phone Screen"}'::jsonb,p_sort=>'board_last_update',p_direction=>'asc',
    p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) as page`);
  assert.ok(stageBoardPage.rows[0].page.items.some(row=>row.candidate_id==='TEST-C1'),'full ordered chain returns the authorized legacy application in its exact active stage column');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('pipeline_stage','Legacy person','{\"stage\":\"Phone Screen\"}'::jsonb) as count")).rows[0].count,1,'ordered stage-board count uses the same active-board membership and RLS scope');
  await db.exec('reset role');
  await db.exec(`insert into public.requisitions(doc_id,site,person_in_charge,position,department,level,head_count,status) values
      ('TEST-R3','OTHER','Site Reader','Engineer','Test','5',2,'ongoing'),
      ('TEST-R4','OTHER','Site Reader','Analyst','Test','5',2,'ongoing'),
      ('TEST-R5','PIC-SITE','Site Reader','Supervisor','Test','5',2,'ongoing');
    insert into public.position_groups(group_id,group_position) values('TEST-G3','Other-site group'),('TEST-G4','PIC-site group');
    insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values
      ('TEST-D3','TEST-R3','TEST-G3','Engineer'),('TEST-D5','TEST-R5','TEST-G4','Supervisor');`);
  await db.exec('set role authenticated');
  const adminReqPage = await db.query(`select public.app_recruitment_list_v1(p_entity=>'requisitions',p_search=>'',p_filters=>'{}'::jsonb,p_sort=>'doc_id',p_direction=>'asc',p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) page`);
  assert.equal(adminReqPage.rows[0].page.items.length,5,'absent optional requisition filters preserve the complete existing authorized population');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('requisitions','','{\"unmatchedOnly\":true}'::jsonb) count")).rows[0].count,1,'unmatchedOnly excludes requisitions linked anywhere');
  const adminCrossSite = await db.query(`select public.app_recruitment_list_v1(p_entity=>'requisitions',p_search=>'',p_filters=>'{"linkToGroupId":"TEST-G1"}'::jsonb,p_sort=>'doc_id',p_direction=>'asc',p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) page`);
  assert.ok(adminCrossSite.rows[0].page.items.some(row=>row.doc_id==='TEST-R3'),'administrator can link across group sites as the mutation guard permits');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('requisitions','','{\"linkToGroupId\":\"MISSING-GROUP\"}'::jsonb) count")).rows[0].count,0,'missing destination groups do not produce options');
  await assert.rejects(db.query("select public.app_recruitment_list_count_v1('requisitions','','{\"managedOnly\":\"true\"}'::jsonb)"),/RECRUITMENT_LIST_FILTER_INVALID/,'optional boolean filters reject non-boolean JSON');
  await db.exec('reset role');
  await db.exec('alter table public.recruitment_logs disable trigger user');
  await db.exec(`insert into public.candidates(candidate_id,name,home_site,created_by,created_at,updated_at)
      values('TEST-C-HIDDEN-OFFER','Hidden Offer Candidate','TEST','11111111-1111-1111-1111-111111111111',now(),now());
    insert into public.candidate_applications(application_id,candidate_id,group_id,state)
      values(md5('hidden-offer-app')::uuid,'TEST-C-HIDDEN-OFFER','TEST-G2','active');
    with assignment as (
      insert into public.candidate_application_assignments(application_id,group_id)
        values(md5('hidden-offer-app')::uuid,'TEST-G2') returning assignment_id
    ) insert into public.recruitment_logs(application_id,entry_assignment_id,recruitment_process,result,log_date,outcome_date,outcome_recorded_at,round,log_id,candidate_id)
      select md5('hidden-offer-app')::uuid,assignment_id,'Offer',1,current_date,current_date,now(),1,90001,'TEST-C-HIDDEN-OFFER' from assignment;`);
  await db.exec('alter table public.recruitment_logs enable trigger user');
  await db.exec('set role authenticated');
  const authorizedOfferCandidate = await db.query("select public.app_offer_candidates_page_v1('TEST-C-HIDDEN-OFFER',null,null,10) as page");
  if (!authorizedOfferCandidate.rows[0].page.items.some(row=>row.candidate_id==='TEST-C-HIDDEN-OFFER')) throw new Error('Authorized system administrator did not receive the eligible offer candidate option.');
  await db.exec('reset role');
  await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values('22222222-2222-2222-2222-222222222222','site-reader@example.test','{"nickname":"Site Reader"}');
    update public.profiles set role='site_recruiter',site='OTHER' where id='22222222-2222-2222-2222-222222222222';
    select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);`);
  await db.exec('set role authenticated');
  const siteReaderPage = await db.query(`select public.app_recruitment_list_v1(
    p_entity=>'candidate_applications',p_search=>'Legacy person',p_filters=>'{}'::jsonb,p_sort=>'latest_log_date',p_direction=>'desc',
    p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) as page`);
  assert.deepEqual(siteReaderPage.rows[0].page.items,[],'actual site reader cannot infer another site application through search/page');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('candidate_applications','Legacy person','{}'::jsonb) as count")).rows[0].count,0,'filtered count uses the same actual application access predicate');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('requisitions','','{}'::jsonb) count")).rows[0].count,3,'requisition list preserves the actual site/PIC readable population when flags are absent');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('requisitions','','{\"managedOnly\":true}'::jsonb) count")).rows[0].count,3,'managedOnly includes site-managed and PIC-managed requisitions');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('requisitions','','{\"unmatchedOnly\":true}'::jsonb) count")).rows[0].count,1,'unmatchedOnly excludes linked rows that the site recruiter can read');
  const siteGroupOptions = await db.query("select public.app_recruitment_list_v1(p_entity=>'requisitions',p_search=>'',p_filters=>'{\"linkToGroupId\":\"TEST-G3\"}'::jsonb,p_sort=>'doc_id',p_direction=>'asc',p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) page");
  assert.deepEqual(siteGroupOptions.rows[0].page.items.map(row=>row.doc_id),['TEST-R3','TEST-R4'],'site role gets only same-site rows eligible for the readable group');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('requisitions','','{\"linkToGroupId\":\"TEST-G4\"}'::jsonb) count")).rows[0].count,1,'person-in-charge access authorizes the matching-site requisition and target group');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('requisitions','','{\"linkToGroupId\":\"TEST-G3\",\"site\":\"PIC-SITE\"}'::jsonb) count")).rows[0].count,0,'a PIC-managed requisition at another site cannot be linked to a mismatched group');
  const siteUnmatchedPage = await db.query("select public.app_recruitment_list_v1(p_entity=>'requisitions',p_search=>'',p_filters=>'{\"managedOnly\":true,\"unmatchedOnly\":true,\"linkToGroupId\":\"TEST-G3\"}'::jsonb,p_sort=>'doc_id',p_direction=>'asc',p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) page");
  assert.deepEqual(siteUnmatchedPage.rows[0].page.items.map(row=>row.doc_id),['TEST-R4'],'managed/unmatched/group predicates are applied together before pagination');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('requisitions','','{\"managedOnly\":true,\"unmatchedOnly\":true,\"linkToGroupId\":\"TEST-G3\"}'::jsonb) count")).rows[0].count,1,'page and exact count share all optional requisition predicates');
  assert.equal((await db.query("select public.app_recruitment_list_count_v1('requisitions','','{\"linkToGroupId\":\"TEST-G1\"}'::jsonb) count")).rows[0].count,0,'site role cannot query options for an inaccessible cross-site target group');
  const hiddenOfferCandidate = await db.query("select public.app_offer_candidates_page_v1('TEST-C-HIDDEN-OFFER',null,null,10) as page");
  assert.deepEqual(hiddenOfferCandidate.rows[0].page.items,[],'site reader cannot infer hidden eligible offer candidates through form search');
  await db.exec('reset role');
  await db.exec("select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)");
  const anonListGrant = await db.query("select has_function_privilege('anon','public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean,boolean)','execute') as execute");
  assert.equal(anonListGrant.rows[0].execute,false,'anonymous role cannot invoke the recruitment list');
  await db.exec('set role anon');
  await assert.rejects(db.query(`select public.app_recruitment_list_v1(
    p_entity=>'candidate_applications',p_search=>'',p_filters=>'{}'::jsonb,p_sort=>'latest_log_date',p_direction=>'desc',
    p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false)`),/permission denied/);
  await db.exec('reset role');
  const destinationPage = await db.query("select public.app_application_destinations_page_v1('',null,10) as page");
  if (!destinationPage.rows[0].page.items.some(row=>row.group_id==='TEST-G1')) throw new Error('Destination page did not preserve the actual profile-contract writer scope.');
  const destinationGrant = await db.query(`select has_function_privilege('anon','public.app_application_destinations_page_v1(text,text,integer)','execute') as anon_exec,
    has_function_privilege('authenticated','public.app_application_destinations_page_v1(text,text,integer)','execute') as authenticated_exec`);
  if (destinationGrant.rows[0].anon_exec || !destinationGrant.rows[0].authenticated_exec) throw new Error('Destination lookup execute grants are incorrect after the profile migrations.');
  await db.exec('set role authenticated');
  const authenticatedDestinationPage = await db.query("select public.app_application_destinations_page_v1('',null,10) as page");
  if (!authenticatedDestinationPage.rows[0].page.items.some(row=>row.group_id==='TEST-G1')) throw new Error('Authenticated writer could not use the destination page RPC.');
  await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(db.query("select public.app_application_destinations_page_v1('',null,10)"),/permission denied/);
  await db.exec('reset role');
  await db.exec('set role authenticated');
  const offerCandidatePage = await db.query("select public.app_offer_candidates_page_v1('',null,null,10) as page");
  if (!Array.isArray(offerCandidatePage.rows[0].page.items) || offerCandidatePage.rows[0].page.items.length > 10) throw new Error('Authenticated role received an invalid offer-candidate lookup page.');
  await db.exec('reset role');
  await db.exec('set role anon');
  await assert.rejects(db.query("select public.app_offer_candidates_page_v1('',null,null,10)"),/permission denied/);
  await db.exec('reset role');
  console.log('Profile migration rehearsed; legacy creator backfilled.');
  console.log('Profile contract assertions passed.');
  if (process.argv.includes('--group-claims')) {
    await db.exec(fs.readFileSync(path.join(root,'tests/db/candidate-group-claims.sql'),'utf8'));
    console.log('Lifetime group claims migration and contract assertions passed.');
  }
  const listBenchArg = process.argv.find(arg=>arg.startsWith('--list-bench='));
  if (listBenchArg) {
    const benchRows = Number(listBenchArg.split('=')[1]);
    if (!Number.isInteger(benchRows) || benchRows < 1 || benchRows > 100000) throw new Error('Use --list-bench=1..100000');
    await db.exec(`insert into public.candidates(candidate_id,name,created_by,home_site,created_at,updated_at)
      select 'BENCH-CAN-'||lpad(n::text,7,'0'),'Bench Candidate '||n,'11111111-1111-1111-1111-111111111111','TEST',now(),now()
      from generate_series(1,${benchRows}) n;
      insert into public.candidate_applications(application_id,candidate_id,group_id,state,created_at)
      select md5('bench-app-'||n)::uuid,'BENCH-CAN-'||lpad(n::text,7,'0'),'TEST-G1','active',now()
      from generate_series(1,${benchRows}) n;`);
    const pageStart=performance.now();
    const benchPage=await db.query(`select public.app_recruitment_list_v1(
      p_entity=>'candidate_applications',p_search=>'',p_filters=>'{}'::jsonb,p_sort=>'latest_log_date',p_direction=>'desc',
      p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) as page`);
    const pageMs=performance.now()-pageStart;
    const countStart=performance.now();
    const benchCount=await db.query("select public.app_recruitment_list_count_v1('candidate_applications','','{}'::jsonb) as count");
    const countMs=performance.now()-countStart;
    const functionDef=(await db.query("select pg_get_functiondef('public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean)'::regprocedure) as body")).rows[0].body;
    const cteStart=functionDef.indexOf('with latest as (');
    const returnStart=functionDef.indexOf('return v_result;',cteStart);
    let innerSql=functionDef.slice(cteStart,returnStart).replace(/\s+into v_result(\s+from edges)/i,'$1');
    const substitutions={
      v_search:"''",v_sort:"'latest_log_date'",v_direction:"'desc'",v_stage:"''",v_board:"'all'",v_group:"''",v_global_reader:'true',
      v_since:'NULL::date',v_embedded_all_time:'false',v_home_tab:"''",v_as_of:"DATE '2026-10-31'",v_cursor:'NULL::text',
      p_filters:"'{}'::jsonb",p_limit:'25',p_before:'false',p_cursor_value:'NULL::jsonb',p_cursor_id:'NULL::text'
    };
    for (const [name,value] of Object.entries(substitutions)) innerSql=innerSql.replace(new RegExp(`\\b${name}\\b`,'g'),value);
    if (!innerSql.trimEnd().endsWith(';')) throw new Error('Could not extract the exact list page SQL for EXPLAIN ANALYZE');
    const plan=(await db.query(`explain (analyze,format text) ${innerSql}`)).rows.map(row=>row[Object.keys(row)[0]]).join('\n');
    console.log(JSON.stringify({kind:'recruitment-list-benchmark',rows:benchRows,total:benchCount.rows[0].count,page_items:benchPage.rows[0].page.items.length,page_ms:Number(pageMs.toFixed(2)),count_ms:Number(countMs.toFixed(2)),inner_plan:plan}));
    if (process.argv.includes('--list-bench-site')) {
      const siteId='99999999-9999-9999-9999-999999999999';
      await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values('${siteId}','bench-site@example.test','{"nickname":"Bench Site"}');
        update public.profiles set email='bench-site@example.test',nickname='Bench Site',full_name='Bench Site',role='site_recruiter',site='TEST' where id='${siteId}';
        select set_config('request.jwt.claim.sub','${siteId}',false);
        set role authenticated;`);
      const sitePageStart=performance.now();
      const sitePage=await db.query(`select public.app_recruitment_list_v1(
        p_entity=>'candidate_applications',p_search=>'',p_filters=>'{}'::jsonb,p_sort=>'latest_log_date',p_direction=>'desc',
        p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) as page`);
      const sitePageMs=performance.now()-sitePageStart;
      const siteCountStart=performance.now();
      const siteCount=await db.query("select public.app_recruitment_list_count_v1('candidate_applications','','{}'::jsonb) as count");
      const siteCountMs=performance.now()-siteCountStart;
      let siteInnerSql=functionDef.slice(cteStart,returnStart).replace(/\s+into v_result(\s+from edges)/i,'$1');
      for (const [name,value] of Object.entries({...substitutions,v_global_reader:'false'})) siteInnerSql=siteInnerSql.replace(new RegExp(`\\b${name}\\b`,'g'),value);
      const sitePlan=(await db.query(`explain (analyze,format text) ${siteInnerSql}`)).rows.map(row=>row[Object.keys(row)[0]]).join('\n');
      console.log(JSON.stringify({kind:'recruitment-list-site-reader-benchmark',rows:benchRows,total:siteCount.rows[0].count,page_items:sitePage.rows[0].page.items.length,page_ms:Number(sitePageMs.toFixed(2)),count_ms:Number(siteCountMs.toFixed(2)),inner_plan:sitePlan}));
      await db.exec('reset role');
    }
  }
  await db.close();
}
main().catch(async error=>{console.error(error.message);await db.close();process.exitCode=1;});
