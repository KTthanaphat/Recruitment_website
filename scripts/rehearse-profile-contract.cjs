const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { execFileSync } = require('child_process');
const { PGlite } = require(path.join(process.env.TEMP, 'recruitment-db-tools/node_modules/@electric-sql/pglite'));
const root = path.resolve(__dirname, '..');
const db = new PGlite();
const legacyRef = "8fc4b3a65614add9e137817accb0558c0665a956"; // Legacy base before additive application migrations.
const productionUpgradeMode = process.argv.includes('--production-upgrades');


async function checkHomeSectionParity(label) {
  const row=(await db.query("select public.app_home_core_summary_v1('{}') core,public.app_home_summary_v1('{}') legacy,public.app_home_welcome_summary_v1() welcome,public.test_previous_welcome_summary() old_welcome")).rows[0];
  const {workQueue,recentActivity,...expected}=row.legacy;const {qualityIssues,...counts}=expected.counts;
  assert.deepEqual(row.core,{...expected,counts},label+' core parity under real RLS');
  assert.deepEqual(row.welcome,row.old_welcome,label+' Welcome parity under real RLS');
  await assert.rejects(db.query('select public.app_pipeline_summary_v1(\'{"groupId":"TEST-G1"}\')'),/RECRUITMENT_LIST_FILTER_INVALID/);
  await db.query("select public.app_pipeline_summary_v1('{}','TEST-G1')");
}

async function seedProductionLegacyFixture() {
  await db.exec(`alter table public.candidates add column if not exists home_site text;
    insert into auth.users(id,email,raw_user_meta_data) values('11111111-1111-1111-1111-111111111111','migration@example.test','{"nickname":"Migration"}');
    update public.profiles set role='system_admin',site='KT1' where id='11111111-1111-1111-1111-111111111111';
    insert into public.requisitions(doc_id,site,position,department,head_count,status) values
      ('TEST-R1','KT1','Engineer','Test',3,'ongoing'),('TEST-R2','KT1','Analyst','Test',3,'ongoing');
    insert into public.position_groups(group_id,group_position) values('TEST-G1','Engineer'),('TEST-G2','Analyst');
    alter table public.document_groups disable trigger enforce_document_group_site;
    insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('TEST-D1','TEST-R1','TEST-G1','Engineer'),('TEST-D2','TEST-R2','TEST-G2','Analyst');
    insert into public.position_groups(group_id,group_position)
      select 'PROD-G-S-'||lpad(n::text,4,'0'),'Single Site '||n from generate_series(1,1037) n;
    insert into public.requisitions(doc_id,site,position,department,head_count,status)
      select 'PROD-R-S-'||lpad(n::text,4,'0'),'KT1','Single Site '||n,'Test',1,'ongoing' from generate_series(1,1037) n;
    insert into public.document_groups(doc_group_id,doc_id,group_id,group_position)
      select 'PROD-D-S-'||lpad(n::text,4,'0'),'PROD-R-S-'||lpad(n::text,4,'0'),'PROD-G-S-'||lpad(n::text,4,'0'),'Single Site '||n from generate_series(1,1037) n;
    insert into public.position_groups(group_id,group_position)
      select 'PROD-G-M-'||lpad(n::text,3,'0'),'Multi Site '||n from generate_series(1,94) n;
    insert into public.requisitions(doc_id,site,position,department,head_count,status)
      select 'PROD-R-M-'||lpad(n::text,3,'0')||'-'||site,'KT'||site,'Multi Site '||n,'Test',1,'ongoing'
      from generate_series(1,94) n cross join generate_series(1,2) site;
    insert into public.document_groups(doc_group_id,doc_id,group_id,group_position)
      select 'PROD-D-M-'||lpad(n::text,3,'0')||'-'||site,'PROD-R-M-'||lpad(n::text,3,'0')||'-'||site,'PROD-G-M-'||lpad(n::text,3,'0'),'Multi Site '||n
      from generate_series(1,94) n cross join generate_series(1,2) site;
    alter table public.document_groups enable trigger enforce_document_group_site;
    alter table public.candidates disable trigger user;
    insert into public.candidates(candidate_id,name,nickname,phone_no,email,group_id,doc_group_id,home_site,channel,ref_name,first_contact_date,candidate_folder_url,created_at,updated_at)
      values('TEST-C1','Legacy person','Legacy','0812345678','test-c1@example.test','TEST-G1','TEST-D1','PRESERVED-EXISTING','Synthetic','Legacy ref',date '2020-01-01','https://example.test/test-c1',timestamptz '2020-01-01 00:00:00+00',timestamptz '2020-01-02 00:00:00+00');
    insert into public.candidates(candidate_id,name,nickname,phone_no,email,group_id,doc_group_id,channel,ref_name,first_contact_date,candidate_folder_url,created_at,updated_at)
      select 'PROD-CAN-S-'||lpad(n::text,4,'0'),'Synthetic single '||n,'Single '||n,'100'||lpad(n::text,7,'0'),'single-'||n||'@example.test','PROD-G-S-'||lpad(n::text,4,'0'),'PROD-D-S-'||lpad(n::text,4,'0'),'Synthetic','Seed',date '2020-01-01'+n,'https://example.test/single/'||n,
        timestamptz '2020-01-01 00:00:00+00'+n*interval '1 second',timestamptz '2020-01-02 00:00:00+00'+n*interval '1 second'
      from generate_series(1,1037) n;
    insert into public.candidates(candidate_id,name,nickname,phone_no,email,group_id,doc_group_id,channel,ref_name,first_contact_date,candidate_folder_url,created_at,updated_at)
      select 'PROD-CAN-M-'||lpad(n::text,3,'0'),'Synthetic shared '||n,'Shared '||n,'200'||lpad(n::text,7,'0'),'shared-'||n||'@example.test','PROD-G-M-'||lpad(n::text,3,'0'),
        case when n<=41 then 'PROD-D-M-'||lpad(n::text,3,'0')||'-1' else null end,'Synthetic','Seed',date '2020-03-01'+n,'https://example.test/shared/'||n,
        timestamptz '2020-03-01 00:00:00+00'+n*interval '1 second',timestamptz '2020-03-02 00:00:00+00'+n*interval '1 second'
      from generate_series(1,94) n;
    alter table public.candidates enable trigger user;
    insert into public.candidate_requisitions(candidate_id,doc_id)
      select 'TEST-C1','TEST-R1'
      union all select 'PROD-CAN-S-'||lpad(n::text,4,'0'),'PROD-R-S-'||lpad(n::text,4,'0') from generate_series(1,1037) n
      union all select 'PROD-CAN-M-'||lpad(n::text,3,'0'),'PROD-R-M-'||lpad(n::text,3,'0')||'-'||site from generate_series(1,94) n cross join generate_series(1,2) site;
    insert into public.change_logs(entity,entity_id,action,changed_at,changed_by,old_data,new_data)
      select 'candidates',c.candidate_id,
        case when c.candidate_id='TEST-C1' or c.candidate_id like 'PROD-CAN-S-%' and split_part(c.candidate_id,'-',4)::integer>610 then 'candidate:new'
          when c.candidate_id like 'PROD-CAN-S-%' and split_part(c.candidate_id,'-',4)::integer<=300 then 'migration:kt1-batch1-20261026-01a173c9'
          when c.candidate_id like 'PROD-CAN-S-%' then 'migration:kt2-batch1-20261031-01a173c9'
          when split_part(c.candidate_id,'-',4)::integer<=83 then 'migration:kt2-batch1-20261031-01a173c9'
          else 'migration:vena-batch1-20261101-01a173c9' end,
        c.created_at,'11111111-1111-1111-1111-111111111111',null,
        jsonb_build_object('candidate_id',c.candidate_id,'created_at',c.created_at,'name',c.name)
      from public.candidates c;
    select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
    select public.app_start_pipeline_stage_v2('{"candidate_id":"TEST-C1","pending":{"opened_date":"2026-10-10"}}');
    create temporary table production_candidate_baseline as
      select candidate_id,name,nickname,phone_no,email,group_id,doc_group_id,channel,ref_name,first_contact_date,candidate_folder_url,created_at,updated_at from public.candidates;
    create temporary table production_link_baseline as select candidate_id,doc_id from public.candidate_requisitions;
    create temporary table production_audit_baseline as select log_id,entity,entity_id,action,changed_at,changed_by,old_data,new_data from public.change_logs;`);
  await db.exec(`alter table public.candidates enable replica trigger audit_candidates;`);
  await db.exec(`create temporary table production_trigger_baseline as
    select tgname,tgenabled from pg_trigger where tgrelid='public.candidates'::regclass and not tgisinternal;`);
}

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
  if (productionUpgradeMode) {
    await seedProductionLegacyFixture();
  } else {
    await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values('11111111-1111-1111-1111-111111111111','migration@example.test','{"nickname":"Migration"}');
      update public.profiles set role='system_admin',site='TEST' where id='11111111-1111-1111-1111-111111111111';
      insert into public.requisitions(doc_id,site,position,department,head_count,status) values('TEST-R1','TEST','Engineer','Test',3,'ongoing'),('TEST-R2','TEST','Analyst','Test',3,'ongoing');
      insert into public.position_groups(group_id,group_position) values('TEST-G1','Engineer'),('TEST-G2','Analyst');
      insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('TEST-D1','TEST-R1','TEST-G1','Engineer'),('TEST-D2','TEST-R2','TEST-G2','Analyst');
      insert into public.candidates(candidate_id,name,group_id,phone_no,first_contact_date) values('TEST-C1','Legacy person','TEST-G1','0812345678',current_date-2);
      select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
      select public.app_start_pipeline_stage_v2('{"candidate_id":"TEST-C1","pending":{"opened_date":"2026-10-10"}}');`);
  }
  const migrationFile = fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_independent_candidate_applications.sql'));
  const applicationMigrationPath = productionUpgradeMode
    ? path.join(root,'supabase/upgrades/20261102001220_production_application_site_backfill.sql')
    : path.join(root,'supabase/migrations',migrationFile);
  if (productionUpgradeMode) {
    const crypto = require('crypto');
    const original = fs.readFileSync(path.join(root,'supabase/migrations',migrationFile),'utf8');
    const variant = fs.readFileSync(applicationMigrationPath,'utf8');
    const originalHash = crypto.createHash('sha256').update(original).digest('hex').toUpperCase();
    assert.equal(originalHash,'E2FF6D5B187D176CBC790B1B4A5FA29D57A593D28CB04DF6436C61151535C370','versioned application migration remains byte-identical to the reviewed source');
    const siteMarker='-- Never guess a site during backfill.';
    const adapterMarker='-- Preserve an existing home_site.';
    const nextMarker='insert into public.candidate_applications(candidate_id, group_id, created_at, updated_at, state, closed_at, closure_reason)';
    const markerIndex=original.indexOf(siteMarker);
    const nextIndex=original.indexOf(nextMarker,markerIndex);
    assert.ok(markerIndex>=0 && nextIndex>markerIndex,'original application migration has one known site backfill block');
    assert.ok(variant.includes(adapterMarker),'production site adapter has its explicit block marker');
    assert.equal(variant.slice(0,variant.indexOf(adapterMarker)),original.slice(0,markerIndex),'production adapter prefix is byte-identical');
    assert.equal(variant.slice(variant.indexOf(nextMarker)),original.slice(nextIndex),'production adapter suffix is byte-identical');
    const originalProfile=fs.readFileSync(path.join(root,'supabase/migrations/20261015074832_candidate_profile_privacy_tabs.sql'),'utf8');
    assert.equal(crypto.createHash('sha256').update(originalProfile).digest('hex').toUpperCase(),'F0E5999B61ACDFBB2176B2A971DFDB721EF84751524D3F64D471CD43EA1EE9FE','versioned privacy migration remains byte-identical to the reviewed source');
    const siteAdapter=fs.readFileSync(applicationMigrationPath,'utf8');
    const guardStart=siteAdapter.indexOf('-- Preserve an existing home_site.');
    const guardEnd=siteAdapter.indexOf('end $$;',guardStart)+'end $$;'.length;
    const guardSql=siteAdapter.slice(guardStart,guardEnd);
    await db.exec(`begin; savepoint bad_anchor; insert into public.candidates(candidate_id,name,group_id,doc_group_id) values('NEG-ANCHOR','Negative anchor','TEST-G1','TEST-D2');`);
    await assert.rejects(db.exec(guardSql),/APPLICATION_MIGRATION_RECONCILIATION/,'wrong-group exact document anchors are rejected');
    await db.exec('rollback to savepoint bad_anchor; release savepoint bad_anchor; commit;');
    await db.exec(`insert into public.position_groups(group_id,group_position) values('NEG-EMPTY-GROUP','No requisitions');
      begin; savepoint unknown_site; insert into public.candidates(candidate_id,name,group_id) values('NEG-UNKNOWN-SITE','Unknown site','NEG-EMPTY-GROUP');`);
    await assert.rejects(db.exec(guardSql),/APPLICATION_MIGRATION_RECONCILIATION/,'a candidate with no known group sites is rejected');
    await db.exec('rollback to savepoint unknown_site; release savepoint unknown_site; rollback;');
  }
  await db.exec(fs.readFileSync(applicationMigrationPath,'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261011160759_application_context_hardening.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261011162307_application_no_show_reapplication.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261011163003_application_correction_attribution.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261011165617_application_stage_chronology.sql'),'utf8'));
  if (productionUpgradeMode) {
    const creatorPrep=fs.readFileSync(path.join(root,'supabase/upgrades/20261102001228_production_creator_provenance_prep.sql'),'utf8');
    const ambiguousId='PROD-CAN-S-0001';
    await db.exec(`begin; insert into public.change_logs(entity,entity_id,action,changed_at,changed_by,old_data,new_data)
      select entity,entity_id,'migration:ambiguous-test',changed_at,changed_by,old_data,new_data from public.change_logs where entity='candidates' and entity_id='${ambiguousId}' and action like 'migration:%';
      savepoint ambiguous_creator_guard;`);
    await assert.rejects(db.exec(creatorPrep),/PROFILE_CREATOR_RECONCILIATION_REQUIRED/,'duplicate validated import snapshots are rejected');
    await db.exec(`rollback to savepoint ambiguous_creator_guard; release savepoint ambiguous_creator_guard;
      delete from public.change_logs where entity='candidates' and entity_id='${ambiguousId}' and action='migration:ambiguous-test'; commit;`);
    const invalidActor='22222222-2222-2222-2222-222222222222';
    await db.exec(`begin; insert into auth.users(id,email,raw_user_meta_data) values('${invalidActor}','no-profile@example.test','{"nickname":"No Profile"}');
      delete from public.profiles where id='${invalidActor}';
      insert into public.change_logs(entity,entity_id,action,changed_at,changed_by,old_data,new_data)
        select 'candidates','PROD-CAN-S-0611','migration:invalid-actor-test',c.created_at,'${invalidActor}',null,jsonb_build_object('candidate_id',c.candidate_id,'created_at',c.created_at)
        from public.candidates c where c.candidate_id='PROD-CAN-S-0611';
      savepoint invalid_creator_guard;`);
    await assert.rejects(db.exec(creatorPrep),/PROFILE_CREATOR_RECONCILIATION_REQUIRED/,'an import marker with an actor lacking a profile is rejected');
    await db.exec(`rollback to savepoint invalid_creator_guard; release savepoint invalid_creator_guard;
      delete from public.change_logs where entity='candidates' and entity_id='PROD-CAN-S-0611' and action='migration:invalid-actor-test'; commit;`);
    await db.exec(creatorPrep);
    const creatorCounts=(await db.query(`select count(*) filter(where c.created_by is not null) as populated,
      count(*) filter(where c.created_by is null) as left_for_original,
      count(*) filter(where c.candidate_id like 'PROD-CAN-M-%' and c.created_by is not null) as shared_populated
      from public.candidates c`)).rows[0];
    assert.deepEqual(creatorCounts,{populated:704,left_for_original:428,shared_populated:94},'prep records precisely the proven 704 migration actors and leaves 428 normal rows for the original migration');
  } else {
    await db.exec(`update public.change_logs set changed_by='11111111-1111-1111-1111-111111111111',action='candidate:new' where entity='candidates' and entity_id='TEST-C1' and old_data is null;`);
  }
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015074832_candidate_profile_privacy_tabs.sql'),'utf8'));
  if (productionUpgradeMode) {
    const auditRewrite=(await db.query(`select (select count(*) from production_audit_baseline)-count(*) as changed from production_audit_baseline b
      join public.change_logs a on a.log_id=b.log_id
      where row(a.entity,a.entity_id,a.action,a.changed_at,a.changed_by,a.old_data,a.new_data)
        is not distinct from row(b.entity,b.entity_id,b.action,b.changed_at,b.changed_by,b.old_data,b.new_data)`)).rows[0].changed;
    assert.equal(auditRewrite,0,'site/application and creator adapters preserve every pre-existing audit row before later semantic migrations');
  }
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015080617_profile_registry_context.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015083414_group_pic_offer_context.sql'),'utf8'));
  if (!productionUpgradeMode) await db.exec(fs.readFileSync(path.join(root,'tests/db/candidate-profile-contract.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261015091726_candidate_group_journey_claims.sql'),'utf8'));
  if (productionUpgradeMode) await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261026040217_fix_line_interview_round_date_derivation.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101124015_five_digit_app_ids.sql'),'utf8'));
  // Keep this newly reviewed index out of the early declarative replay: its additive migration must install it at the correct chronological point.
  const assignmentHistoryMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261102123400_candidate_assignment_application_history_index.sql'),'utf8');
  const declarativeIndexes=fs.readFileSync(path.join(root,'supabase/schemas/20_indexes.sql'),'utf8');
  const historyIndexDeclaration=/create index if not exists idx_candidate_application_assignments_application_id\s+on public\.candidate_application_assignments\(application_id\);/g;
  assert.equal((declarativeIndexes.match(historyIndexDeclaration)||[]).length,1,'one canonical all-history application index declaration exists');
  assert.equal(assignmentHistoryMigration.replace(/\s+/g,' ').trim(),declarativeIndexes.match(historyIndexDeclaration)[0].replace(/\s+/g,' ').trim(),'additive history index migration matches its declarative source');
  await db.exec(declarativeIndexes.replace(historyIndexDeclaration,''));
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
  if (!productionUpgradeMode) {
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101180543_scoped_application_read_fastpath.sql'),'utf8'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101183410_candidate_home_site_auth_fastpath.sql'),'utf8'));
  }
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101183700_dashboard_owner_filter_options.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261101184800_rejection_id_alias_search.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102101500_home_recruitment_list_filters.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102113000_home_quality_detail_scope.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102114500_home_quality_exact_group_scope.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102120000_pipeline_stage_board_membership.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102121000_requisition_link_option_filters.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102122000_home_welcome_summaries.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102123000_home_quality_duplicate_key_precompute.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102123100_requisition_page_enrichment_after_limit.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102123200_bottleneck_authorization_key_memoization.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261102123300_rejection_distinct_authorization_precompute.sql'),'utf8'));
  await db.exec('alter function public.app_home_welcome_summary_v1() rename to test_previous_welcome_summary');
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261103023353_home_loading_sections.sql'),'utf8'));

  if (process.argv.includes('--candidate-latency')) {
    await db.exec('alter function public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) rename to test_previous_candidate_page');
  }
  await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261103080120_candidate_pipeline_latency.sql'),'utf8'));
  assert.equal((await db.query("select to_regclass('public.idx_candidate_application_assignments_application_id') as idx")).rows[0].idx,null,'chronological index migration is not masked by the early schema20 replay');
  await db.exec(assignmentHistoryMigration);
  assert.deepEqual((await db.query("select i.indisvalid valid,i.indisready ready,i.indpred is null all_history from pg_index i where i.indexrelid='public.idx_candidate_application_assignments_application_id'::regclass")).rows[0],{valid:true,ready:true,all_history:true},'additive migration creates a valid ready all-history index without a partial predicate');
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
  if (productionUpgradeMode) {
    const counts=(await db.query(`select
      (select count(*) from public.candidates) candidates,
      (select count(*) from public.candidate_applications) applications,
      (select count(*) from public.candidate_application_assignments) assignments,
      (select count(*) from public.candidate_requisitions) links,
      (select count(*) from public.candidates where created_by is not null) creators,
      (select count(*) from public.candidates where candidate_id like 'PROD-CAN-M-%' and home_site='KT1') anchored_shared,
      (select count(*) from public.candidates where candidate_id like 'PROD-CAN-M-%' and home_site is null) ambiguous_shared,
      (select count(*) from public.candidates where candidate_id like 'PROD-CAN-S-%' and home_site='KT1') single_site`)).rows[0];
    assert.deepEqual(counts,{candidates:1132,applications:1132,assignments:1132,links:1226,creators:1132,anchored_shared:41,ambiguous_shared:53,single_site:1037},'production upgrade population, identities, creator coverage, and site adjudication match the verified fixture');
    assert.equal((await db.query(`select count(*) from public.candidates where candidate_id='TEST-C1' and home_site='PRESERVED-EXISTING'`)).rows[0].count,1,'existing home_site values remain untouched');
    assert.equal((await db.query(`select count(*) from public.candidates where home_site is not null and home_site not in ('KT1','PRESERVED-EXISTING')`)).rows[0].count,0,'site backfill never invents values outside the known fixture sites');
    const changed=(await db.query(`select count(*) from production_candidate_baseline b join public.candidates c using(candidate_id)
      where row(c.name,c.nickname,c.phone_no,c.email,c.group_id,c.doc_group_id,c.channel,c.ref_name,c.first_contact_date,c.candidate_folder_url,c.created_at,c.updated_at)
        is distinct from row(b.name,b.nickname,b.phone_no,b.email,b.group_id,b.doc_group_id,b.channel,b.ref_name,b.first_contact_date,b.candidate_folder_url,b.created_at,b.updated_at)`)).rows[0].count;
    assert.equal(changed,0,'all captured candidate business columns and original timestamps remain unchanged');
    const identityDiff=(await db.query(`select count(*) from (
      (select candidate_id from production_candidate_baseline except select candidate_id from public.candidates)
      union all (select candidate_id from public.candidates except select candidate_id from production_candidate_baseline)
    ) ids`)).rows[0].count;
    assert.equal(identityDiff,0,'all 1,132 original raw candidate identifiers are preserved exactly');
    const missingLinks=(await db.query(`select count(*) from (
      (select candidate_id,doc_id from production_link_baseline except select candidate_id,doc_id from public.candidate_requisitions)
      union all
      (select candidate_id,doc_id from public.candidate_requisitions except select candidate_id,doc_id from production_link_baseline)
    ) link_diff`)).rows[0].count;
    assert.equal(missingLinks,0,'all captured candidate-to-requisition links survive with their raw identities');
    const badJourney=(await db.query(`select count(*) from public.candidate_applications a join public.candidates c using(candidate_id)
      left join public.candidate_application_assignments x using(application_id)
      where a.created_at is distinct from c.created_at or a.updated_at is distinct from c.updated_at
        or x.assignment_id is null or x.started_at is distinct from c.created_at`)).rows[0].count;
    assert.equal(badJourney,0,'application and initial assignment timestamps preserve their source candidate timestamps');
    assert.equal((await db.query(`select count(*) from (select candidate_id from public.candidate_applications group by candidate_id having count(*)<>1) journeys`)).rows[0].count,0,'migration creates one independent application per original candidate');
    assert.equal((await db.query(`select count(*) from public.candidate_requisitions cr join public.candidate_applications a using(candidate_id)
      where cr.application_id is distinct from a.application_id`)).rows[0].count,0,'each retained requisition link is attached to its candidate journey');
    assert.equal((await db.query(`select attnotnull from pg_attribute where attrelid='public.candidates'::regclass and attname='home_site' and not attisdropped`)).rows[0].attnotnull,false,'home_site remains nullable for ambiguous multi-site candidates');
    assert.equal((await db.query(`select count(*) from production_trigger_baseline b join pg_trigger t on t.tgrelid='public.candidates'::regclass and t.tgname=b.tgname where t.tgenabled is distinct from b.tgenabled`)).rows[0].count,0,'pre-existing candidate trigger modes are restored exactly');
    const provenance=(await db.query(`select action,count(*)::int as n from public.change_logs where entity='candidates' and action like 'migration:%' group by action order by action`)).rows;
    assert.deepEqual(provenance,[
      {action:'migration:kt1-batch1-20261026-01a173c9',n:300},
      {action:'migration:kt2-batch1-20261031-01a173c9',n:393},
      {action:'migration:vena-batch1-20261101-01a173c9',n:11}
    ],'all three import batch labels and audited row counts are retained exactly');
    const migrationActors=(await db.query(`select count(*) from public.candidates c where c.candidate_id<>'TEST-C1' and c.candidate_id not like 'PROD-CAN-S-%' and c.created_by='11111111-1111-1111-1111-111111111111'`)).rows[0].count;
    assert.equal(migrationActors,94,'all shared-site import creators are populated only from proven matching migration snapshots');
    const normalActors=(await db.query(`select count(*) from public.candidates c where (c.candidate_id='TEST-C1' or c.candidate_id like 'PROD-CAN-S-%' and split_part(c.candidate_id,'-',4)::integer>610) and c.created_by='11111111-1111-1111-1111-111111111111'`)).rows[0].count;
    assert.equal(normalActors,428,'the original privacy migration resolves all 428 regular creator audit rows');

    await db.exec('set role authenticated');
    assert.equal((await db.query('select count(*) from public.candidates')).rows[0].count,1132,'actual system-admin RLS can read the complete candidate population');
    assert.equal((await db.query(`select count(*) from public.candidate_applications`)).rows[0].count,1132,'actual system-admin RLS can read the complete application population');
    await db.exec('reset role');
    await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values
      ('33333333-3333-3333-3333-333333333333','kt1@example.test','{"nickname":"KT1"}'),
      ('44444444-4444-4444-4444-444444444444','kt2@example.test','{"nickname":"KT2"}'),
      ('55555555-5555-5555-5555-555555555555','viewer@example.test','{"nickname":"Viewer"}');
      update public.profiles set role='site_recruiter',site='KT1' where id='33333333-3333-3333-3333-333333333333';
      update public.profiles set role='site_recruiter',site='KT2' where id='44444444-4444-4444-4444-444444444444';
      update public.profiles set role='viewer',site=null where id='55555555-5555-5555-5555-555555555555';`);
    await db.exec(`select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false); set role authenticated;`);
    assert.equal((await db.query(`select count(*) from public.candidates where candidate_id='TEST-C1'`)).rows[0].count,1,'KT1 site-reader policy can read the matching application despite preserved legacy home_site');
    assert.deepEqual((await db.query(`select
      (select count(*) from public.candidates where candidate_id like 'PROD-CAN-M-%' and home_site is null) profiles,
      (select count(*) from public.candidate_applications a join public.candidates c using(candidate_id) where c.candidate_id like 'PROD-CAN-M-%' and c.home_site is null) applications,
      (select count(*) from public.candidate_application_assignments x join public.candidate_applications a using(application_id) join public.candidates c using(candidate_id) where c.candidate_id like 'PROD-CAN-M-%' and c.home_site is null) assignments`)).rows[0],
      {profiles:53,applications:53,assignments:53},'site-reader RLS retains all 53 NULL-home shared-group journeys without assigning a home site');
    await db.exec(`select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);`);
    assert.equal((await db.query(`select count(*) from public.candidates where candidate_id='TEST-C1'`)).rows[0].count,0,'KT2 site-reader policy does not see the unrelated KT1 application');
    assert.deepEqual((await db.query(`select
      (select count(*) from public.candidates where candidate_id like 'PROD-CAN-M-%' and home_site is null) profiles,
      (select count(*) from public.candidate_applications a join public.candidates c using(candidate_id) where c.candidate_id like 'PROD-CAN-M-%' and c.home_site is null) applications,
      (select count(*) from public.candidate_application_assignments x join public.candidate_applications a using(application_id) join public.candidates c using(candidate_id) where c.candidate_id like 'PROD-CAN-M-%' and c.home_site is null) assignments`)).rows[0],
      {profiles:53,applications:53,assignments:53},'site-reader RLS retains all 53 NULL-home shared-group journeys without assigning a home site');
    await db.exec(`select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);`);
    assert.equal((await db.query(`select count(*) from public.candidates where candidate_id='TEST-C1'`)).rows[0].count,1,'viewer read access follows the existing global-reader policy');
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select count(*) from public.candidates'),/permission denied/,'anonymous role cannot read candidate records');
    await db.exec('reset role');
    console.log('Production adapter rehearsal passed: 1,132 profiles, 94 shared-site cases, 704 provenance imports, all raw links/timestamps/audit rows preserved, and KT1/KT2/viewer/anon RLS verified.');
    return;
  }
  await db.exec('set role authenticated');
  const candidatePage = await db.query(`select public.app_recruitment_list_v1(
    p_entity=>'candidate_applications',p_search=>'',p_filters=>'{}'::jsonb,p_sort=>'latest_log_date',p_direction=>'desc',
    p_limit=>25,p_cursor_value=>null,p_cursor_id=>null,p_before=>false) as page`);
  if (!candidatePage.rows[0].page.items.some(row=>row.candidate_id==='TEST-C1')) throw new Error('Actual authenticated candidate list did not return the authorized legacy journey.');
  const candidateCount = await db.query("select public.app_recruitment_list_count_v1('candidate_applications','','{}'::jsonb) as count");
  assert.equal(candidateCount.rows[0].count,1,'actual list count and page share application authorization scope');
  await checkHomeSectionParity('administrator');
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
  await checkHomeSectionParity('restricted site recruiter');
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
  await db.exec(`reset role;
    insert into auth.users(id,email,raw_user_meta_data) values('88888888-8888-8888-8888-888888888888','home-viewer@example.test','{"nickname":"Home Viewer"}');
    update public.profiles set role='viewer',site=null where id='88888888-8888-8888-8888-888888888888';
    select set_config('request.jwt.claim.sub','88888888-8888-8888-8888-888888888888',false); set role authenticated;`);
  await checkHomeSectionParity('viewer');
  await db.exec('reset role; set role anon');
  await assert.rejects(db.query("select public.app_home_core_summary_v1('{}')"),/permission denied/);
  await db.exec('reset role');
  console.log('Home core/Welcome parity verified under administrator, restricted site recruiter and viewer RLS; anonymous execution rejected.');
  if (process.argv.includes('--candidate-latency')) await require('./verify-candidate-latency.cjs')(db, root);
  await db.close();
}
main().catch(async error=>{console.error(error.message);await db.close();process.exitCode=1;});
