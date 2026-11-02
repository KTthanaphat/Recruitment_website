const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PGlite } = require(path.join(process.env.TEMP, 'recruitment-db-tools/node_modules/@electric-sql/pglite'));
const root = path.resolve(__dirname, '..');
const db = new PGlite();
async function main() {
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema app_private;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
    create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('email','migration@example.test')$$;`);
  for (const file of ['10_tables.sql','30_triggers_audit.sql','50_rpc_functions.sql','40_rls_policies.sql','90_grants.sql']) {
    const source = execFileSync('git',['show',`HEAD:supabase/schemas/${file}`],{cwd:root,encoding:'utf8'}).replace('constraint offers_start_confirmation_check check','constraint offers_start_confirmation_details_check check');
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
  console.log('Migration applied to disposable PostgreSQL; legacy profile and stage preserved.');
  const testFile=path.join(root,'tests/db/candidate-applications.sql');
  if(fs.existsSync(testFile)) await db.exec(fs.readFileSync(testFile,'utf8'));
  console.log('Application SQL assertions passed.');
  await db.close();
}
main().catch(async error=>{ console.error(error.message); if(error.query) console.error(error.query.slice(0,500)); await db.close(); process.exitCode=1; });
