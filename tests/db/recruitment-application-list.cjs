const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pglitePath = process.env.RECRUITMENT_PGLITE_PATH || path.join(process.env.LOCALAPPDATA || "C:/Users/thanaphat-krea/AppData/Local", "Temp/recruitment-db-tools/node_modules/@electric-sql/pglite");
const { PGlite } = require(pglitePath);

async function page(db, filters = {}, limit = 25, cursor = null, before = false, search = "", entity = "candidate_applications", sort = "latest_log_date", direction = "desc") {
  const result = await db.query(`select public.app_recruitment_list_v1($1,$2,$3::jsonb,$4,$9,$5,$6::jsonb,$7,$8) as page`, [entity, search, JSON.stringify(filters), sort, limit, cursor ? JSON.stringify(cursor.value) : null, cursor?.id ?? null, before, direction]);
  if (!result.rows?.[0]) throw new Error(`list rpc returned no rows: ${JSON.stringify(result)}`);
  const value = result.rows[0].page;
  value.total_count = (await db.query("select public.app_recruitment_list_count_v1($1,$2,$3::jsonb) as count", [entity, search, JSON.stringify(filters)])).rows[0].count;
  return value;
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const listSchema = fs.readFileSync(path.join(root, "supabase/schemas/60_recruitment_list.sql"), "utf8");
  const homeListMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261102101500_home_recruitment_list_filters.sql"), "utf8");
  const boardMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261102120000_pipeline_stage_board_membership.sql"), "utf8");
  const requisitionOptionMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261102121000_requisition_link_option_filters.sql"), "utf8");
  const offerCandidatesMigration = fs.readFileSync(path.join(root, "supabase/migrations/20261101174258_offer_candidates_lookup.sql"), "utf8");
  const functionSql = (source, functionName) => {
    const marker = `create or replace function public.${functionName}(`;
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, `${functionName} definition exists`);
    const end = source.indexOf("end; $$;", start);
    assert.notEqual(end, -1, `${functionName} definition is complete`);
    return source.slice(start, end + "end; $$;".length).trim();
  };
  assert.ok(homeListMigration.includes("create or replace function public.app_recruitment_applications_page_v1"), "the chronological Home list migration installs the pre-board list contract");
  assert.equal(functionSql(boardMigration, "app_recruitment_applications_page_v1"), functionSql(listSchema, "app_recruitment_applications_page_v1"), "the additive migration installs the exact declarative application projection");
  assert.equal(functionSql(boardMigration, "app_recruitment_list_v1"), functionSql(listSchema, "app_recruitment_list_v1"), "the additive migration installs the exact declarative dispatcher contract");
  assert.ok(boardMigration.startsWith("-- Additive correction for the application stage board endpoint."), "the new migration is additive after the chronological Home list migration");
  assert.equal(functionSql(requisitionOptionMigration, "app_recruitment_requisitions_page_v1"), functionSql(listSchema, "app_recruitment_requisitions_page_v1"), "the additive migration installs the exact declarative requisition filter projection");
  assert.match(homeListMigration, /revoke all on function public\.app_recruitment_list_v1[\s\S]*grant execute on function public\.app_recruitment_list_v1/, "the signature replacement migration restores authenticated-only dispatcher/count grants");
  assert.match(offerCandidatesMigration, /create or replace function public\.app_offer_candidates_page_v1[\s\S]*revoke all on function public\.app_offer_candidates_page_v1[\s\S]*grant execute on function public\.app_offer_candidates_page_v1/, "offer form lookup migration installs only an authenticated bounded RPC");
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create schema app_private; create role anon; create role authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function app_private.is_recruitment_reader() returns boolean language sql stable as $$select auth.uid() is not null$$;
      create function app_private.is_global_recruitment_reader() returns boolean language sql stable as $$select false$$;
      create function app_private.current_app_role() returns text language sql stable as $$select 'system_admin'::text$$;
      create function app_private.can_manage_requisition(p_id text) returns boolean language sql stable as $$select true$$;
      create function app_private.can_read_candidate(p_id text) returns boolean language sql stable as $$select p_id not in ('CAN-HIDDEN','CAN-MASKED')$$;
      create function app_private.can_read_requisition(p_id text) returns boolean language sql stable as $$select p_id<>'REQ-HIDDEN'$$;
      create function app_private.can_read_position_group(p_id text) returns boolean language sql stable as $$select true$$;
      create function app_private.can_read_sourcing_group(p_id text) returns boolean language sql stable as $$select true$$;
      create function app_private.can_read_candidate_audit(p_entity text,p_id text,p_old jsonb,p_new jsonb) returns boolean language sql stable as $$select p_id<>'HIDDEN'$$;
      create function app_private.can_manage_candidate(p_id text) returns boolean language sql stable as $$select p_id='CAN-00001'$$;
      create function app_private.can_read_profile_note(p_id text) returns boolean language sql stable as $$select p_id='CAN-00001'$$;
      create function app_private.can_edit_profile_note(p_id text) returns boolean language sql stable as $$select false$$;
      create function app_private.can_match_candidate(p_id text) returns boolean language sql stable as $$select p_id='CAN-00001'$$;
      create table public.candidates(candidate_id text primary key,name text not null,nickname text,phone_no text,email text,home_site text,channel text,position_interests text,first_contact_date date,created_by uuid,responsible_recruiter_id uuid,doc_group_id text,group_id text,ref_name text,candidate_folder_url text,created_at timestamptz not null,updated_at timestamptz not null);
      create table public.position_groups(group_id text primary key,group_position text not null,channel_fb boolean not null default false,channel_jobthai boolean not null default false,channel_jobtopgun boolean not null default false,channel_jobdb boolean not null default false,channel_jobbkk boolean not null default false,channel_linkedin boolean not null default false,channel_walkin boolean not null default false,channel_referral boolean not null default false,channel_others boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
      create table public.sourcing_weekly_updates(group_id text not null,week_start date not null,updated_at timestamptz not null default now(),channel_fb boolean not null default false,channel_jobthai boolean not null default false,channel_jobtopgun boolean not null default false,channel_jobdb boolean not null default false,channel_jobbkk boolean not null default false,channel_linkedin boolean not null default false,channel_walkin boolean not null default false,channel_referral boolean not null default false,channel_others boolean not null default false,applicants_fb integer,applicants_jobthai integer,applicants_jobtopgun integer,applicants_jobdb integer,applicants_jobbkk integer,applicants_linkedin integer,applicants_walkin integer,applicants_referral integer,applicants_others integer,updated_by uuid,created_at timestamptz not null default now(),primary key(group_id,week_start));
      create table public.requisitions(doc_id text primary key,site text not null,person_in_charge text,is_priority boolean not null default false,pr_approved_date date,position text not null default 'Role',department text not null default 'Department',section text,level text,head_count integer not null default 1,line_manager text,request_type text not null default 'New',replacement_names text,status text not null default 'ongoing',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
      create table public.requisition_logs(log_id bigint primary key,doc_id text not null,log_date date not null,status text not null);
      create table public.change_logs(log_id bigint primary key,entity text not null,entity_id text not null,action text not null,changed_at timestamptz not null,changed_by uuid,changed_by_email text,old_data jsonb,new_data jsonb);
      create table public.document_groups(doc_group_id text primary key,doc_id text not null,group_id text,group_position text not null,channel_fb boolean not null default false,channel_jobthai boolean not null default false,channel_jobtopgun boolean not null default false,channel_jobdb boolean not null default false,channel_jobbkk boolean not null default false,channel_linkedin boolean not null default false,channel_walkin boolean not null default false,channel_referral boolean not null default false,channel_others boolean not null default false);
      create table public.candidate_applications(application_id uuid primary key,candidate_id text not null,group_id text not null,state text not null,created_at timestamptz not null);
      create table public.candidate_application_assignments(assignment_id uuid primary key default gen_random_uuid(),application_id uuid not null,group_id text not null,from_group_id text,started_at timestamptz not null default now(),ended_at timestamptz,actor_id uuid,reason text,attribution_inferred boolean not null default false);
      create function app_private.can_read_application(p_id uuid) returns boolean language sql stable as $$select exists(select 1 from public.candidate_applications where application_id=p_id and candidate_id <> 'CAN-HIDDEN')$$;
      create table public.recruitment_logs(application_id uuid not null,recruitment_process text not null,result smallint,log_date date not null,outcome_date date,round int not null,log_id bigint primary key,superseded_at timestamptz,superseded_by_stage_instance_id uuid,
        candidate_id text,interviewer text,remark text,estimated_action_date date,created_at timestamptz default now(),updated_at timestamptz,stage_instance_id uuid,outcome_interviewer text,outcome_remark text,
        failure_actor text,failure_main_reason_id uuid,failure_detail_reason_id uuid,failure_reason_snapshot jsonb,outcome_recorded_at timestamptz,pending_edited_at timestamptz,pending_edited_by uuid,
        record_origin text,migration_note text,superseded_reason text);
      create table public.offers(offer_id bigint generated by default as identity primary key,application_id uuid not null,candidate_id text,doc_id text not null,accepted_date date,first_working_date date,start_confirmation text,start_confirmed_at timestamptz,start_confirmed_by uuid,start_confirmation_reason text,remark text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
      create table public.profiles(id uuid primary key,nickname text,full_name text);
      create table public.candidate_notes(note_id uuid primary key,candidate_id text,body text,created_by uuid,updated_by uuid,created_at timestamptz);
      create function public.app_candidate_profile_capabilities_v1() returns jsonb language sql stable as $$select '[]'::jsonb$$;
      create function public.app_masked_candidate_pool_v1() returns jsonb language sql stable as $$select '[]'::jsonb$$;
      insert into public.position_groups values('GRP-00001','Engineer');
      insert into public.position_groups(group_id,group_position) values('GRP-00002','No current apps'),('GRP-00003','No coverage'),('GRP-000010','A collision-prefix group');
      insert into public.profiles values('11111111-1111-1111-1111-111111111111','Test Recruiter','Test Recruiter');
      insert into public.requisitions(doc_id,site,person_in_charge,is_priority,pr_approved_date,position,department,section,level,head_count,request_type,status,created_at,updated_at) values('REQ-1','Site A','PIC',true,'2026-10-01','Engineer','Ops','Hiring','5',2,'New','ongoing','2026-10-01T00:00:00Z','2026-10-10T00:00:00Z');
      insert into public.requisitions(doc_id,site,person_in_charge,is_priority,pr_approved_date,position,department,section,level,head_count,request_type,status,created_at,updated_at)
        select 'REQ-'||n,case when n%2=0 then 'Site A' else 'Site B' end,'PIC',false,'2026-10-01','Role '||n,'Department','Hiring',case when n=130 then 'L5' else '5' end,1,'New','ongoing','2026-10-01T00:00:00Z','2026-10-10T00:00:00Z' from generate_series(2,130) n;
      insert into public.requisitions(doc_id,site,person_in_charge,is_priority,pr_approved_date,position,department,section,level,head_count,request_type,status,created_at,updated_at)
        select 'REQ-OFFER-'||lpad(n::text,3,'0'),'Test Site','PIC',false,'2026-10-01','Offer test '||n,'Test Department','Test','5',1,'New','ongoing','2026-10-01T00:00:00Z','2026-10-10T00:00:00Z' from generate_series(1,50) n;
      insert into public.document_groups values('DG-1','REQ-1','GRP-00001','Engineer');
      insert into public.document_groups values('DG-2','REQ-128','GRP-00002','Transferred'),('DG-3','REQ-127','GRP-00003','No coverage'),('DG-10','REQ-126','GRP-000010','A collision-prefix group');
      update public.requisitions set status='filled' where doc_id='REQ-126';
      insert into public.requisition_logs values(999,'REQ-126','2026-10-31','filled');
      insert into public.candidates(candidate_id,name,home_site,group_id,created_by,position_interests,created_at,updated_at)
        select 'CAN-'||lpad(n::text,5,'0'),'Candidate '||n,'Site A',null,'11111111-1111-1111-1111-111111111111','Engineer','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z' from generate_series(1,71) n;
      insert into public.candidates(candidate_id,name,home_site,created_by,position_interests,created_at,updated_at)
        values('CAN-MASKED','Hidden Pool','Site A','11111111-1111-1111-1111-111111111111','Designer','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
      insert into public.candidates(candidate_id,name,home_site,created_by,created_at,updated_at)
        values('CAN-HIDDEN','Foreign App Candidate','Site B','22222222-2222-2222-2222-222222222222','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
      insert into public.candidate_applications
        select md5(n::text)::uuid,'CAN-'||lpad(n::text,5,'0'),'GRP-00001',case when n in (1,2,6,7) then 'closed' else 'active' end,'2026-10-01T00:00:00Z' from generate_series(1,71) n;
      insert into public.candidate_applications values(md5('hidden')::uuid,'CAN-HIDDEN','GRP-00001','active','2026-10-01T00:00:00Z');
      insert into public.candidate_application_assignments(application_id,group_id) select application_id,'GRP-00001' from public.candidate_applications;
      insert into public.candidate_application_assignments(application_id,group_id,from_group_id,reason) values(md5('1')::uuid,'GRP-00002','GRP-00001','transfer');
      insert into public.sourcing_weekly_updates(group_id,week_start,updated_at,channel_fb,applicants_fb) values
        ('GRP-00001','2026-10-24','2026-10-25T00:00:00Z',true,7),('GRP-00001','2026-10-31','2026-10-31T12:00:00Z',true,8),('GRP-00001','2026-11-07','2026-11-01T00:00:00Z',true,9),('GRP-000010','2026-10-31','2026-10-31T11:00:00Z',true,6);
      insert into public.offers(application_id,candidate_id,doc_id,accepted_date,start_confirmation,start_confirmed_at) values
        (md5('1')::uuid,'CAN-00001','REQ-1','2026-10-20','started','2026-10-21T00:00:00Z'),
        (md5('2')::uuid,'CAN-00002','REQ-1','2026-10-22','did_not_start','2026-10-30T00:00:00Z');
      insert into public.offers(application_id,candidate_id,doc_id,accepted_date)
        select md5('1')::uuid,'CAN-00001','REQ-OFFER-'||lpad(n::text,3,'0'),'2026-10-29' from generate_series(1,50) n;
      insert into public.change_logs(log_id,entity,entity_id,action,changed_at,changed_by,changed_by_email,old_data,new_data) values
        (1,'offers','REQ-1','updated','2026-10-31T01:00:00Z','11111111-1111-1111-1111-111111111111','recruiter@example.test','{}','{"status":"accepted"}'),
        (2,'candidates','HIDDEN','updated','2026-10-31T02:00:00Z','11111111-1111-1111-1111-111111111111','recruiter@example.test','{}','{}');
      insert into public.change_logs(log_id,entity,entity_id,action,changed_at,changed_by,changed_by_email,old_data,new_data)
        select n,'offers','REQ-1','updated','2026-10-31T01:00:00Z','11111111-1111-1111-1111-111111111111','recruiter@example.test','{}','{}' from generate_series(3,52) n;
      insert into public.candidate_notes values(md5('note')::uuid,'CAN-00001','Private note','11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','2026-10-31T00:00:00Z');
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,round,log_id,candidate_id,interviewer,remark,created_at,stage_instance_id,record_origin)
        select md5(n::text)::uuid,case when n=3 then 'Offer' when n%2=0 then 'Phone Screen' else 'HR Interview' end,null,'2026-10-20',1,n,
          'CAN-'||lpad(n::text,5,'0'),case when n%2=0 then 'Interviewer A' else 'Interviewer B' end,'Pending details','2026-10-20T00:00:00Z',md5(('stage'||n)::text)::uuid,'user' from generate_series(1,70) n;
      update public.recruitment_logs set recruitment_process='Offer',result=1,log_date='2026-10-30',outcome_date='2026-10-30' where log_id=1;
      update public.recruitment_logs set result=0,outcome_date='2026-10-30' where log_id=2;
      update public.recruitment_logs set outcome_date='2026-10-30' where log_id=3;
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,outcome_date,round,log_id,superseded_at,superseded_by_stage_instance_id,candidate_id,created_at,record_origin)
        values(md5('4')::uuid,'Test',0,'2026-10-01','2026-10-20',1,100,'2026-10-21',md5('99')::uuid,'CAN-00004','2026-10-20T00:00:00Z','correction');
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,outcome_date,round,log_id,superseded_at,superseded_by_stage_instance_id,candidate_id,created_at,record_origin)
        values(md5('5')::uuid,'Offer',0,'2026-10-01','2026-10-20',1,101,null,md5('99')::uuid,'CAN-00005','2026-10-20T00:00:00Z','correction');
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,outcome_date,round,log_id,superseded_at,superseded_by_stage_instance_id,candidate_id,created_at,record_origin)
        values(md5('6')::uuid,'Phone Screen',0,'2026-10-01','2026-10-24',1,102,null,null,'CAN-00006','2026-10-20T00:00:00Z','user');
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,outcome_date,round,log_id,superseded_at,superseded_by_stage_instance_id,candidate_id,created_at,record_origin)
        values(md5('7')::uuid,'HR Interview',0,'2026-10-01','2026-10-23',1,103,null,null,'CAN-00007','2026-10-20T00:00:00Z','user');
      alter table public.candidate_applications enable row level security;
      alter table public.candidates enable row level security;
      alter table public.recruitment_logs enable row level security;
      create policy apps_read on public.candidate_applications for select to authenticated using(app_private.can_read_application(application_id));
      create policy candidate_read on public.candidates for select to authenticated using(app_private.can_read_candidate(candidate_id));
      create policy logs_read on public.recruitment_logs for select to authenticated using(app_private.can_read_application(application_id));
      grant usage on schema public,auth,app_private to authenticated;
      grant select on all tables in schema public to authenticated;
      grant execute on all functions in schema public,auth,app_private to authenticated;`);
    await db.exec(`create function public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean) returns jsonb language sql as $$select '{}'::jsonb$$;
      create function public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean) returns jsonb language sql as $$select '{}'::jsonb$$;
      create function public.app_recruitment_history_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean) returns jsonb language sql as $$select '{}'::jsonb$$;`);
    const sql = ["20261101140739_recruitment_list_optimization.sql", "20261102101500_home_recruitment_list_filters.sql"]
      .map((name) => fs.readFileSync(path.join(root, "supabase/migrations", name), "utf8")).join("\n");
    await db.exec(sql);
    await db.exec(offerCandidatesMigration);
    await db.exec(boardMigration);
    await db.exec(requisitionOptionMigration);
    const leftoverOverloads = await db.query(`select proname,pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('app_recruitment_list_v1','app_recruitment_applications_page_v1','app_recruitment_history_page_v1') order by proname,pronargs`);
    assert.deepEqual(leftoverOverloads.rows, [
      { proname: "app_recruitment_applications_page_v1", pronargs: 9 },
      { proname: "app_recruitment_history_page_v1", pronargs: 9 },
      { proname: "app_recruitment_list_v1", pronargs: 10 }
    ], "migration removes old shorter-arity PostgREST overloads before installing the current signatures");
    await db.query("select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)");
    const first = await page(db);
    const offerPage = await page(db, {}, 25, null, false, "", "offers", "accepted");
    assert.equal(offerPage.total_count, 52, "offers are scoped by authorized application and requisition visibility");
    assert.equal(offerPage.items[0].candidate_id, "CAN-00001");
    assert.equal(offerPage.items[0].candidate_name, "Candidate 1");
    assert.equal(offerPage.items[0].accepted_count, 1, "offer impact counts accepted offers within the linked requisition");
    const offerNext = await page(db, {}, 25, offerPage.next_cursor, false, "", "offers", "accepted");
    const offerPrev = await page(db, {}, 25, offerNext.previous_cursor, true, "", "offers", "accepted");
    assert.equal(new Set([...offerPage.items, ...offerNext.items].map(row => row.offer_id)).size, 50, "equal accepted dates use a stable numeric offer_id tie-break");
    assert.deepEqual(offerPrev.items.map(row => row.offer_id), offerPage.items.map(row => row.offer_id), "offers return to the same page across equal-date ties");
    const offerAsc = await page(db, {}, 25, null, false, "", "offers", "accepted", "asc");
    const offerAscNext = await page(db, {}, 25, offerAsc.next_cursor, false, "", "offers", "accepted", "asc");
    const offerAscPrev = await page(db, {}, 25, offerAscNext.previous_cursor, true, "", "offers", "accepted", "asc");
    assert.equal(new Set([...offerAsc.items, ...offerAscNext.items].map(row => row.offer_id)).size, 50, "ascending equal-date offer cursors are stable");
    assert.deepEqual(offerAscPrev.items.map(row => row.offer_id), offerAsc.items.map(row => row.offer_id));
    assert.equal((await page(db, { status: "Did not start" }, 25, null, false, "", "offers", "status")).total_count, 1);
    const auditPage = await page(db, {}, 25, null, false, "", "audit_log", "changed_at");
    assert.equal(auditPage.total_count, 51, "audit uses the authorization predicate and excludes hidden records");
    assert.equal(auditPage.items[0].entity_id, "REQ-1");
    const auditNext = await page(db, {}, 25, auditPage.next_cursor, false, "", "audit_log", "changed_at");
    const auditPrev = await page(db, {}, 25, auditNext.previous_cursor, true, "", "audit_log", "changed_at");
    assert.equal(new Set([...auditPage.items, ...auditNext.items].map(row => row.log_id)).size, 50, "equal audit timestamps use ascending numeric log_id consistently with page order");
    assert.deepEqual(auditPrev.items.map(row => row.log_id), auditPage.items.map(row => row.log_id), "audit returns to the same page across equal timestamps");
    const auditAsc = await page(db, {}, 25, null, false, "", "audit_log", "changed_at", "asc");
    const auditAscNext = await page(db, {}, 25, auditAsc.next_cursor, false, "", "audit_log", "changed_at", "asc");
    const auditAscPrev = await page(db, {}, 25, auditAscNext.previous_cursor, true, "", "audit_log", "changed_at", "asc");
    assert.equal(new Set([...auditAsc.items, ...auditAscNext.items].map(row => row.log_id)).size, 50);
    assert.deepEqual(auditAscPrev.items.map(row => row.log_id), auditAsc.items.map(row => row.log_id));
    assert.equal((await page(db, { changedBy: "recruiter@example.test", start: "2026-10-31", end: "2026-10-31" }, 25, null, false, "", "audit_log", "changed_at")).total_count, 51);
    const rawPage = (await db.query("select public.app_recruitment_list_v1('candidate_applications','', '{}'::jsonb,'latest_log_date','desc',25,null,null,false) as value")).rows[0].value;
    assert.equal(rawPage.total_count, null, "paged response does not repeat exact count work");
    await assert.rejects(() => page(db, {}, 0), /RECRUITMENT_LIST_LIMIT_INVALID/, "public page call cannot use the internal count-only limit");
    await assert.rejects(() => db.query("select public.app_recruitment_list_v1('requisitions','','{}'::jsonb,'updated_at','desc',5000,null,null,false,null)"), /RECRUITMENT_LIST_LIMIT_INVALID/, "large public limits are rejected even with NULL count_only");
    await assert.rejects(() => db.query("select public.app_recruitment_list_v1('requisitions','','{}'::jsonb,'updated_at','desc',50,null,null,false,null)"), /RECRUITMENT_LIST_LIMIT_INVALID/, "NULL count_only is rejected rather than bypassing the limit gate");
    await assert.rejects(() => db.query("select public.app_recruitment_list_v1('requisitions','','{}'::jsonb,'updated_at','desc',50,null,null,null,false)"), /RECRUITMENT_LIST_LIMIT_INVALID/, "NULL before is rejected consistently");
    assert.equal(first.total_count, 71);
    assert.equal(first.items.length, 25);
    assert.equal(first.has_more, true);
    assert.ok(first.next_cursor);
    assert.equal(first.items[0].application_id != null, true);
    assert.equal(first.items[0].latest_process, "Offer");
    assert.equal(first.items[0].application_state, "closed");
    await assert.rejects(() => page(db, {}, null), /RECRUITMENT_LIST_LIMIT_INVALID/, "explicit null limit is rejected, never unbounded");
    const second = await page(db, {}, 25, first.next_cursor);
    const previous = await page(db, {}, 25, second.previous_cursor, true);
    assert.deepEqual(previous.items.map(row => row.application_id), first.items.map(row => row.application_id));
    const third = await page(db, {}, 25, second.next_cursor);
    assert.equal(third.items.length, 21);
    assert.equal(third.has_more, false);
    assert.equal(third.next_cursor, null);
    assert.equal((await page(db, { headerSite: "Site B" })).total_count, 0);
    assert.equal((await page(db, { headerSite: "Site A", priorityOnly: true })).total_count, 71);
    assert.equal((await page(db, { groupId: "GRP-00001", stage: "HR Interview" })).total_count, 33);
    assert.equal((await page(db, { boardFilter: "failed", recentSince: "2026-10-25", asOf: "2026-10-31" })).total_count, 1);
    assert.equal((await page(db, { boardFilter: "failed", asOf: "2026-10-31" })).total_count, 2, "default standalone cutoff is inclusive asOf minus seven days");
    const allTimeFailures = await page(db, { boardFilter: "failed", embeddedAllTime: true, asOf: "2026-10-31" });
    assert.equal(allTimeFailures.total_count, 3, `embedded failed drilldown remains all time: ${allTimeFailures.items.map(row => row.candidate_id).join(',')}`);
    assert.equal((await page(db, { boardFilter: "failed", embeddedAllTime: true, asOf: "2026-10-31" },25,null,false,"CAN-00007")).total_count, 1);
    assert.equal((await page(db, { boardFilter: "passed_offer", recentSince: "2026-10-25", asOf: "2026-10-31" })).total_count, 1);
    assert.equal((await page(db, { boardFilter: "passed_offer", embeddedAllTime: true, asOf: "2026-10-31" })).total_count, 1);
    assert.equal((await page(db, { boardFilter: "aging", asOf: "2026-10-31" })).total_count, 66, "aging includes pending Offer and excludes closed failures/passes and superseded replacement-only failures");
    const summary = (await db.query("select public.app_pipeline_summary_v1('{}'::jsonb,null,'2026-10-31',7) as value")).rows[0].value;
    assert.equal(summary.active, 67);
    assert.equal(summary.aging, 66, "aging includes pending Offer; no-activity row is non-aging and closed rows do not count active");
    assert.equal(summary.failed, 2, "failed KPI includes closed apps and the inclusive 7-day cutoff, but not 8-day data");
    assert.equal(summary.passed_offer, 1);
    assert.equal(summary.no_activity, 1, "null latest-process flag remains a real active no-activity row");
    assert.deepEqual(summary.by_stage, [{ stage: "No activity", count: 1 }, { stage: "Phone Screen", count: 33 }, { stage: "HR Interview", count: 32 }, { stage: "Offer", count: 1 }]);

    const history = await page(db, {}, 25, null, false, "", "pipeline_history", "log_date");
    assert.equal(history.total_count, 72, "default history contains canonical log rows only");
    assert.equal(history.items.length, 25);
    assert.equal(history.has_more, true);
    assert.equal(history.items[0].candidate.application_id != null, true);
    assert.equal(history.items[0].log.log_id != null, true);
    assert.equal(history.items[0].audit, false);
    const historyNext = await page(db, {}, 25, history.next_cursor, false, "", "pipeline_history", "log_date");
    const historyPrevious = await page(db, {}, 25, historyNext.previous_cursor, true, "", "pipeline_history", "log_date");
    assert.deepEqual(historyPrevious.items.map(item => item.log.log_id), history.items.map(item => item.log.log_id));
    const auditHistory = await page(db, { showAudit: true }, 100, null, false, "", "pipeline_history", "log_date");
    assert.equal(auditHistory.total_count, 74, "audit mode includes both superseded marker forms");
    assert.equal(auditHistory.items.some(item => item.audit), true);
    assert.equal((await page(db, { candidate: "CAN-00007" }, 25, null, false, "", "pipeline_history", "log_date")).total_count, 2);
    assert.equal((await page(db, { stage: "HR Interview" }, 25, null, false, "", "pipeline_history", "stage")).total_count, 34);
    assert.equal((await page(db, { site: "Site A", owner: "PIC", requisition: "REQ-1" }, 25, null, false, "", "pipeline_history", "log_date")).total_count, 72);
    assert.equal((await page(db, { pending: "Interviewer A", outcome: "Pass" }, 25, null, false, "", "pipeline_history", "log_date")).total_count, 0);
    const historySorts = ["candidate", "requisition", "site", "owner", "stage", "pending", "outcome", "date"];
    for (const sort of historySorts) {
      const sortedFirst = await page(db, {}, 25, null, false, "", "pipeline_history", sort);
      const sortedSecond = await page(db, {}, 25, sortedFirst.next_cursor, false, "", "pipeline_history", sort);
      const sortedBack = await page(db, {}, 25, sortedSecond.previous_cursor, true, "", "pipeline_history", sort);
      assert.equal(sortedFirst.total_count, 72, `${sort} sort keeps the complete canonical history population`);
      assert.equal(new Set([...sortedFirst.items, ...sortedSecond.items].map(item => item.log.log_id)).size, 50, `${sort} has a stable distinct log_id tie-break across pages`);
      assert.deepEqual(sortedBack.items.map(item => item.log.log_id), sortedFirst.items.map(item => item.log.log_id), `${sort} previous cursor returns the exact prior page`);
    }
    const failEnglish = await page(db, { outcome: "Fail" }, 100, null, false, "", "pipeline_history", "outcome");
    const failThai = await page(db, { outcome: "ไม่ผ่าน" }, 100, null, false, "", "pipeline_history", "outcome");
    const passEnglish = await page(db, { outcome: "Pass" }, 100, null, false, "", "pipeline_history", "outcome");
    const passThai = await page(db, { outcome: "ผ่าน" }, 100, null, false, "", "pipeline_history", "outcome");
    const pendingEnglish = await page(db, { outcome: "Pending" }, 100, null, false, "", "pipeline_history", "outcome");
    const pendingThai = await page(db, { outcome: "รอดำเนินการ" }, 100, null, false, "", "pipeline_history", "outcome");
    assert.ok(failEnglish.total_count > 0);
    assert.equal(failThai.total_count, failEnglish.total_count, "localized Fail label matches the same outcome population");
    assert.ok(passEnglish.total_count > 0);
    assert.equal(passThai.total_count, passEnglish.total_count, "localized Pass label matches the same outcome population");
    assert.ok(pendingEnglish.total_count > 0);
    assert.equal(pendingThai.total_count, pendingEnglish.total_count, "localized Pending label matches the same outcome population");
    assert.ok((await page(db, {}, 25, null, false, "CAN-00007", "pipeline_history", "date")).total_count > 0, "global search resolves the formatted candidate ID alias");
    assert.ok((await page(db, { candidate: "CAN-00007" }, 25, null, false, "", "pipeline_history", "date")).total_count > 0, "candidate column filter resolves the formatted candidate ID alias");
    assert.equal((await page(db, { candidateId: "CAN-00007" }, 25, null, false, "", "pipeline_history", "log_date")).total_count, 2);
    assert.equal((await page(db, { applicationId: require("node:crypto").createHash("md5").update("7").digest("hex").replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, "$1-$2-$3-$4-$5") }, 25, null, false, "", "pipeline_history", "log_date")).total_count, 2);
    await assert.rejects(() => page(db, {}, null, null, false, "", "pipeline_history", "log_date"), /RECRUITMENT_LIST_LIMIT_INVALID/);

    const requisitions = await page(db, {}, 25, null, false, "", "requisitions", "updated_at");
    assert.equal(requisitions.total_count, 180);
    assert.equal(requisitions.items.length, 25);
    assert.equal(requisitions.has_more, true);
    assert.equal(requisitions.items[0].sourcing_group_ids[0], "GRP-00001");
    assert.equal(requisitions.items[0].candidate_count, 71, "candidate_count is a distinct candidate count over every application in linked group(s)");
    assert.equal(requisitions.items[0].accepted_count, 1, "did_not_start offers do not cover requisition headcount");
    assert.equal(requisitions.items[0].open_headcount, 1);
    assert.equal(requisitions.items[0].sla_restart_date, "2026-10-30");
    const homeReqs = await page(db, { homeTab: "open_headcount" }, 25, null, false, "", "requisitions", "home_oldest", "desc");
    assert.equal(homeReqs.total_count, (await db.query("select count(*)::int n from public.requisitions r where r.status not in ('filled','cancel') and greatest(r.head_count-coalesce((select count(*) from public.offers o where o.doc_id=r.doc_id and o.accepted_date is not null and o.start_confirmation is distinct from 'did_not_start'),0),0)>0")).rows[0].n, "Home open headcount is filtered and counted over the complete authorized population");
    assert.ok(homeReqs.items.every(row => row.status !== "filled" && row.status !== "cancel" && row.open_headcount > 0));
    const homeReqNext = await page(db, { homeTab: "open_headcount" }, 25, homeReqs.next_cursor, false, "", "requisitions", "home_oldest", "desc");
    const homeReqBack = await page(db, { homeTab: "open_headcount" }, 25, homeReqNext.previous_cursor, true, "", "requisitions", "home_oldest", "desc");
    assert.deepEqual(homeReqBack.items.map(row => row.doc_id), homeReqs.items.map(row => row.doc_id), "Home requisition sort keeps stable cursor anchors");
    const homePipeline = await page(db, { homeTab: "active_pipeline", asOf: "2026-10-31" }, 25, null, false, "", "candidate_applications", "home_oldest_touch", "asc");
    assert.ok(homePipeline.items.every(row => row.latest_process !== "No activity" && row.latest_result !== 0));
    assert.ok(homePipeline.items.every(row => row.home_last_touch_date === null || row.home_last_touch_date <= "2026-10-31"), "Home touch dates cap future events at the Bangkok as-of date");
    assert.ok(homePipeline.items.every(row => row.home_pending_remark === null || typeof row.home_pending_remark === "string"), "Home row carries canonical pending remark projection");
    const homePipelineNext = await page(db, { homeTab: "active_pipeline", asOf: "2026-10-31" }, 25, homePipeline.next_cursor, false, "", "candidate_applications", "home_oldest_touch", "asc");
    const homePipelineBack = await page(db, { homeTab: "active_pipeline", asOf: "2026-10-31" }, 25, homePipelineNext.previous_cursor, true, "", "candidate_applications", "home_oldest_touch", "asc");
    assert.deepEqual(homePipelineBack.items.map(row => row.application_id), homePipeline.items.map(row => row.application_id));
    const homeStarts = await page(db, { homeTab: "start_confirmation", today: "2026-10-31" }, 25, null, false, "", "offers", "home_first_working", "asc");
    assert.ok(homeStarts.items.every(row => row.accepted_date && row.first_working_date && row.first_working_date <= "2026-10-31" && row.start_confirmation === null), "Home confirmation rows use the Bangkok as-of day and require an unconfirmed start");
    assert.equal(homeStarts.total_count, (await db.query("select count(*)::int n from public.offers o where o.accepted_date is not null and o.first_working_date is not null and o.first_working_date<='2026-10-31' and o.start_confirmation is null")).rows[0].n);
    const requisitionSorts = ["doc_id", "position", "status", "open_headcount", "readiness", "sla", "age", "owner", "department", "request_type", "section", "head_count", "accepted_count", "candidate_count", "req_date", "updated_at"];
    for (const sort of requisitionSorts) {
      const sorted = await page(db, {}, 25, null, false, "", "requisitions", sort);
      const sortedNext = await page(db, {}, 25, sorted.next_cursor, false, "", "requisitions", sort);
      const sortedPrevious = await page(db, {}, 25, sortedNext.previous_cursor, true, "", "requisitions", sort);
      assert.equal(sorted.total_count, 180, `${sort} sort preserves complete requisition population`);
      assert.equal(sorted.items.length, 25);
      assert.equal(sorted.has_more, true);
      assert.equal(new Set([...sorted.items, ...sortedNext.items].map(row => row.doc_id)).size, 50, `${sort} has stable doc_id tie-break over a page boundary`);
      assert.deepEqual(sortedPrevious.items.map(row => row.doc_id), sorted.items.map(row => row.doc_id));
    }
    assert.equal((await page(db, { status: "ongoing", readiness: "Linked", candidate_count: "71", req_date: "01/10/2026" }, 25, null, false, "", "requisitions", "doc_id")).total_count, 1);
    assert.equal((await page(db, { status: "กำลังดำเนินการ", request_type: "อัตราใหม่" }, 25, null, false, "", "requisitions", "doc_id")).total_count, 179);
    assert.equal((await page(db, { owner: "PIC", department: "Ops", site: "Site A", headerSite: "Site A", headerPic: "PIC", priorityOnly: true }, 25, null, false, "Engineer", "requisitions", "doc_id")).total_count, 1);
    assert.equal((await page(db, { headerSite: "Site B" }, 25, null, false, "", "requisitions", "doc_id")).total_count, 64);
    const prefixGroups = await page(db, { scope: "all", weekStart: "2026-10-31" }, 25, null, false, "GRP-00001", "position_groups", "attention");
    assert.equal(prefixGroups.total_count, 2, "free-text group search retains distinct IDs that share a prefix");
    const groups = await page(db, { scope: "all", weekStart: "2026-10-31", exactGroupId: "GRP-00001" }, 25, null, false, "", "position_groups", "attention");
    assert.equal(groups.total_count, 1, "group list searches database-wide through linked requisition context");
    assert.equal(groups.items[0].group_id, "GRP-00001");
    assert.deepEqual(groups.items[0].doc_ids, ["REQ-1"]);
    assert.equal(groups.items[0].candidate_count, 71, "group card candidate total is not limited to the visible page");
    assert.equal(groups.items[0].latest_update.week_start, "2026-10-31", "group card uses the selected week rather than the latest week in all history");
    assert.equal(groups.items[0].latest_saved_at, "2026-11-01T07:00:00+07:00", "latest saved metadata remains independently available for stale checks");
    assert.ok(groups.items[0].readiness_label, "workspace group projection includes the readiness label used for attention sorting");
    const attentionGroups = await page(db, { scope: "all", weekStart: "2026-10-31" }, 25, null, false, "", "position_groups", "attention");
    assert.equal(attentionGroups.total_count, 4);
    assert.equal(attentionGroups.items[0].group_id, "GRP-00003", "attention sort prioritizes No coverage over a transferred or late-stage group");
    const oldestGroups = await page(db, { scope: "all", weekStart: "2026-10-31" }, 25, null, false, "", "position_groups", "oldest");
    assert.equal(oldestGroups.items[0].group_id, "GRP-00002", "oldest sort puts groups without a selected-week save first");
    assert.equal(oldestGroups.items[0].candidate_count, 1, "historical group count follows authorized assignments after transfer, not legacy candidate.group_id");
    const sourcing = await page(db, { surface: "history", from: "2026-10-31", to: "2026-10-31", groupId: "GRP-00001" }, 25, null, false, "GRP-00001", "sourcing", "week");
    assert.equal(sourcing.total_count, 1, "sourcing history is bounded by the selected week and group across full lifecycle data");
    assert.equal(sourcing.items[0].week_start, "2026-10-31");
    assert.equal(sourcing.items[0].status, "saved");
    assert.equal(sourcing.items[0].update.applicants_fb, 8);
    const sourcingSorts = ["group", "position", "week", "status", "applicants", "saved"];
    for (const sort of sourcingSorts) {
      const sorted = await page(db, { surface: "history", from: "2026-10-31", to: "2026-10-31" }, 25, null, false, "", "sourcing", sort);
      assert.equal(sorted.total_count, 4, `${sort} sort retains all authorized lifecycle rows for the selected range`);
      assert.equal(sorted.items.length, 4);
      assert.equal(new Set(sorted.items.map(row => `${row.group.group_id}|${row.week_start}`)).size, 4, `${sort} sort keeps group/week identities distinct`);
      assert.equal(sorted.items.find(row => row.group.group_id === "GRP-00001").group.group_position, "Engineer", "sourcing resolves group metadata by exact raw ID despite prefix collisions");
    }
    const sourcingFilters = [
      ["group", "GRP-00001", 2], ["group", "MISSING", 0], ["position", "Engineer", 1], ["position", "MISSING", 0],
      ["week", "2026-10-31", 4], ["week", "2025", 0], ["status", "saved", 2], ["status", "needs_recording", 2],
      ["applicants", "has", 2], ["applicants", "unknown", 2], ["applicants", "zero", 0], ["saved", "2026-10-31", 2], ["saved", "MISSING", 0]
    ];
    for (const [key, value, expected] of sourcingFilters) {
      assert.equal((await page(db, { surface: "history", from: "2026-10-31", to: "2026-10-31", [key]: value }, 25, null, false, "", "sourcing", "week")).total_count, expected, `${key} filter matches its visible lifecycle value`);
    }
    assert.equal((await page(db, { surface: "history", from: "2026-10-31", to: "2026-10-31", groupId: "GRP-00001" }, 25, null, false, "", "sourcing", "week")).total_count, 1, "exact group ID scope remains raw-key exact when an ID shares its prefix");
    const sourcingBoard = await page(db, { surface: "board", weekStart: "2026-10-31", groupId: "GRP-00001" }, 25, null, false, "", "sourcing", "group");
    assert.equal(sourcingBoard.total_count, 1, "weekly board only returns open groups for the selected Saturday");
    assert.equal((await page(db, { site: "no such site" }, 25, null, false, "", "requisitions", "doc_id")).total_count, 0);
    const requisitionFilters = {
      doc_id: ["REQ-130", "MISSING"], position: ["Role 130 (L5)", "MISSING"], status: ["ongoing", "MISSING"],
      open_headcount: ["1", "99"], readiness: ["Not linked", "NOPE"], sla: [" / 30d", "MISSING"], age: ["d", "999999d"],
      owner: ["PIC", "MISSING"], department: ["Department", "MISSING"], request_type: ["New", "MISSING"], section: ["Hiring", "MISSING"],
      head_count: ["1", "99"], accepted_count: ["0", "99"], candidate_count: ["0", "99"], req_date: ["01/10/2026", "31/12/2030"],
      updated_at: ["10/10/2026", "31/12/2030"]
    };
    for (const [key, [positive, negative]] of Object.entries(requisitionFilters)) {
      const positiveFilters = key === "doc_id" ? { doc_id: positive } : { doc_id: "REQ-130", [key]: positive };
      const negativeFilters = key === "doc_id" ? { doc_id: negative } : { doc_id: "REQ-130", [key]: negative };
      assert.equal((await page(db, positiveFilters, 25, null, false, "", "requisitions", "doc_id")).total_count, 1, `${key} filter matches its displayed value`);
      assert.equal((await page(db, negativeFilters, 25, null, false, "", "requisitions", "doc_id")).total_count, 0, `${key} filter excludes nonmatching displayed value`);
    }
    assert.equal((await page(db, {}, 25, null, false, "Engineer", "requisitions", "doc_id")).total_count, 1, "global search uses the displayed position/level title");
    const requisitionLookupFilters = { managedOnly: true, unmatchedOnly: true, linkToGroupId: "GRP-00001" };
    const requisitionLookupPage = await page(db, requisitionLookupFilters, 25, null, false, "", "requisitions", "doc_id");
    const requisitionLookupCount = (await db.query("select public.app_recruitment_list_count_v1('requisitions','',$1::jsonb) count", [JSON.stringify(requisitionLookupFilters)])).rows[0].count;
    assert.equal(requisitionLookupPage.total_count, requisitionLookupCount, "optional managed/unmatched/group eligibility uses identical rows for page and scalar count");
    assert.equal(requisitionLookupPage.items.every(row => !row.sourcing_group_ids.includes("GRP-00001")), true, "unmatchedOnly checks group links before page projection");
    assert.ok((await page(db, { managedOnly: true }, 25, null, false, "", "requisitions", "doc_id")).total_count > 0, "managedOnly preserves rows authorized by the existing can_manage_requisition predicate");
    assert.equal((await page(db, { linkToGroupId: "MISSING-GROUP" }, 25, null, false, "", "requisitions", "doc_id")).total_count, 0, "an absent target group produces no link options");
    await assert.rejects(() => page(db, { managedOnly: "true" }, 25, null, false, "", "requisitions", "doc_id"), /RECRUITMENT_LIST_FILTER_INVALID/, "managedOnly requires a JSON boolean");
    const displayedLevel = await page(db, { position: "Role 130 (L5)" }, 25, null, false, "Role 130 (L5)", "requisitions", "position");
    assert.equal(displayedLevel.total_count, 1, "prefixed legacy L5 level matches the formatted requisition title");
    assert.equal(displayedLevel.items[0].level, "L5", "the raw stored level is returned unchanged");

    // Add mixed-width identities after the broad-population assertions so this fixture
    // isolates normalized numeric ordering without changing established totals above.
    await db.exec(`update public.candidates set name='ID-SORT padded one' where candidate_id='CAN-00001';
      create or replace function public.app_candidate_profile_capabilities_v1() returns jsonb language sql stable as $$
        select coalesce(jsonb_agg(jsonb_build_object('candidate_id',c.candidate_id,'creator_label','Test Recruiter','is_unmatched',not exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id))),'[]'::jsonb)
        from public.candidates c where app_private.can_read_candidate(c.candidate_id)
      $$;
      insert into public.candidates(candidate_id,name,created_at,updated_at) values
        ('CAN-0001','ID-SORT legacy one',now(),now()),('CAN-1','ID-SORT raw one',now(),now()),
        ('CAN-0002','ID-SORT two',now(),now()),('CAN-9999','ID-SORT legacy boundary',now(),now()),
        ('CAN-10000','ID-SORT five digit boundary',now(),now()),('CAN-100000','ID-SORT six digit boundary',now(),now());
      insert into public.candidates(candidate_id,name,created_at,updated_at)
        select 'CAN-'||n::text,'ID-SORT extended '||n,now(),now() from generate_series(10001,10030) n;
      insert into public.candidates(candidate_id,name,created_at,updated_at) values('CAN-GROUP-ALIAS','Group Alias Candidate',now(),now());
      insert into public.candidate_applications(application_id,candidate_id,group_id,state,created_at)
        select md5('mixed-'||candidate_id)::uuid,candidate_id,'GRP-ID-SORT','active',now()
        from public.candidates where name like 'ID-SORT%';
      insert into public.candidate_applications(application_id,candidate_id,group_id,state,created_at)
        values(md5('group-alias')::uuid,'CAN-GROUP-ALIAS','GRP-0001','active',now());
      update public.position_groups set group_position='ID Sort' where group_id in ('GRP-00001','GRP-00002');
      insert into public.position_groups(group_id,group_position) values
        ('GRP-0001','ID Sort'),('GRP-09999','ID Sort'),('GRP-10000','ID Sort'),('GRP-100000','ID Sort');
      insert into public.requisitions(doc_id,site,position,department,level,head_count,status,pr_approved_date)
        values('REQ-ID-SORT-1','Site A','ID Sort','Test','5',1,'ongoing','2026-10-01'),
          ('REQ-ID-SORT-2','Site A','ID Sort','Test','5',1,'ongoing','2026-10-01'),
          ('REQ-ID-SORT-3','Site A','ID Sort','Test','5',1,'ongoing','2026-10-01'),
          ('REQ-ID-SORT-4','Site A','ID Sort','Test','5',1,'ongoing','2026-10-01');
      insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values
        ('DG-ID-SORT-1','REQ-ID-SORT-1','GRP-0001','ID Sort'),('DG-ID-SORT-2','REQ-ID-SORT-2','GRP-09999','ID Sort'),
        ('DG-ID-SORT-3','REQ-ID-SORT-3','GRP-10000','ID Sort'),('DG-ID-SORT-4','REQ-ID-SORT-4','GRP-100000','ID Sort');
      insert into public.sourcing_weekly_updates(group_id,week_start,updated_at,channel_fb,applicants_fb) values
        ('GRP-0001','2026-10-31',now(),true,1),('GRP-00002','2026-10-31',now(),true,1),
        ('GRP-09999','2026-10-31',now(),true,1),('GRP-10000','2026-10-31',now(),true,1),
        ('GRP-100000','2026-10-31',now(),true,1);
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,round,log_id,candidate_id)
        select md5('mixed-'||candidate_id)::uuid,'Phone Screen',1,'2026-10-31',1,9100+row_number() over(order by candidate_id),candidate_id
        from public.candidates where candidate_id in ('CAN-00001','CAN-0001','CAN-1');
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,round,log_id,candidate_id)
        values(md5('group-alias')::uuid,'Phone Screen',1,'2026-10-31',1,9199,'CAN-GROUP-ALIAS');
      insert into public.offers(application_id,candidate_id,doc_id,accepted_date)
        select md5('mixed-'||candidate_id)::uuid,candidate_id,'REQ-ID-SORT-1','2026-10-31'
        from public.candidates where candidate_id in ('CAN-00001','CAN-0001','CAN-1');
      insert into public.change_logs(log_id,entity,entity_id,action,changed_at,changed_by,changed_by_email,old_data,new_data)
        values(9101,'candidates','CAN-00001','updated','2026-10-31T02:00:00Z','11111111-1111-1111-1111-111111111111','recruiter@example.test','{}','{}'),
              (9102,'candidates','CAN-0001','updated','2026-10-31T02:00:00Z','11111111-1111-1111-1111-111111111111','recruiter@example.test','{}','{}'),
              (9103,'candidates','CAN-1','updated','2026-10-31T02:00:00Z','11111111-1111-1111-1111-111111111111','recruiter@example.test','{}','{}');`);
    const expectedCandidateIds = ["CAN-00001", "CAN-0001", "CAN-1", "CAN-0002", "CAN-9999", "CAN-10000", ...Array.from({length:30},(_,index)=>`CAN-${10001+index}`), "CAN-100000"];
    const appIdSort = await page(db, { groupId: "GRP-ID-SORT" }, 25, null, false, "", "candidate_applications", "candidate_id", "asc");
    const appIdSortNext = await page(db, { groupId: "GRP-ID-SORT" }, 25, appIdSort.next_cursor, false, "", "candidate_applications", "candidate_id", "asc");
    assert.deepEqual([...appIdSort.items,...appIdSortNext.items].map(row => row.candidate_id), expectedCandidateIds, "application ID sort orders numeric suffixes, then preserves distinct raw aliases");
    const registryIdSort = await page(db, {}, 25, null, false, "ID-SORT", "candidate_registry", "candidate_id", "asc");
    const registryIdSortNext = await page(db, {}, 25, registryIdSort.next_cursor, false, "ID-SORT", "candidate_registry", "candidate_id", "asc");
    assert.deepEqual([...registryIdSort.items,...registryIdSortNext.items].map(row => row.candidate_id), expectedCandidateIds, "candidate registry ID sort uses the same normalized numeric/raw-key ordering");
    for (const idSearch of ["CAN-0001","CAN-00001"]) {
      const registryAliases = await page(db, {}, 50, null, false, idSearch, "candidate_registry", "candidate_id");
      assert.deepEqual(registryAliases.items.map(row => row.candidate_id).sort(), ["CAN-00001","CAN-0001","CAN-1"], `candidate registry global search ${idSearch} returns all raw/display identities`);
    }
    const firstIdPage = await page(db, { groupId: "GRP-ID-SORT" }, 25, null, false, "", "candidate_applications", "candidate_id", "asc");
    const secondIdPage = await page(db, { groupId: "GRP-ID-SORT" }, 25, firstIdPage.next_cursor, false, "", "candidate_applications", "candidate_id", "asc");
    assert.deepEqual([...firstIdPage.items,...secondIdPage.items].map(row => row.candidate_id), expectedCandidateIds, "keyset pages retain canonical mixed-width ID order without gaps or duplicate aliases");
    const groupIdSort = await page(db, { surface: "history", from: "2026-10-31", to: "2026-10-31", position: "ID Sort" }, 25, null, false, "", "sourcing", "group", "asc");
    assert.deepEqual(groupIdSort.items.map(row => row.group.group_id), ["GRP-00001","GRP-0001","GRP-00002","GRP-09999","GRP-10000","GRP-100000"], "group-ID sort uses numeric suffix then raw ID as a stable tie-break");
    for (const search of ["CAN-0001","CAN-00001"]) {
      const aliasedApps = await page(db, { groupId: "GRP-ID-SORT" }, 50, null, false, search, "candidate_applications", "candidate_id");
      assert.deepEqual(aliasedApps.items.map(row => row.candidate_id).sort(), ["CAN-00001","CAN-0001","CAN-1"], `application search ${search} includes all raw/display aliases and preserves colliding raw IDs`);
    }
    const groupAliasApplicationId = (await db.query("select application_id::text from public.candidate_applications where candidate_id='CAN-GROUP-ALIAS'")).rows[0].application_id;
    for (const groupSearch of ["GRP-0001","GRP-00001"]) {
      const aliasHistoryFilter = await page(db, { applicationId: groupAliasApplicationId, requisition: groupSearch }, 25, null, false, "", "pipeline_history", "candidate");
      assert.equal(aliasHistoryFilter.total_count, 1, `history linked-requisition column filter ${groupSearch} resolves group aliases`);
      const aliasHistoryGroupSearch = await page(db, { applicationId: groupAliasApplicationId }, 25, null, false, groupSearch, "pipeline_history", "candidate");
      assert.equal(aliasHistoryGroupSearch.total_count, 1, `history global search ${groupSearch} resolves group aliases`);
    }
    const aliasHistoryApp = await page(db, { applicationId: require("node:crypto").createHash("md5").update("mixed-CAN-0001").digest("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,"$1-$2-$3-$4-$5"), candidate: "CAN-00001" }, 25, null, false, "", "pipeline_history", "candidate");
    assert.equal(aliasHistoryApp.total_count, 1, "history candidate column filter accepts padded aliases for a legacy stored key");
    const aliasHistorySearch = await page(db, { applicationId: aliasHistoryApp.items[0].log.application_id }, 25, null, false, "CAN-00001", "pipeline_history", "candidate");
    assert.ok(aliasHistorySearch.total_count > 0 && aliasHistorySearch.items.every(row => row.log.candidate_id === "CAN-0001"), "history global search accepts padded aliases for a legacy stored key while retaining its raw identity");
    for (const search of ["CAN-0001","CAN-00001"]) {
      const aliasOffers = await page(db, { doc_id: "REQ-ID-SORT-1", candidate: search }, 25, null, false, "", "offers", "candidate");
      assert.deepEqual(aliasOffers.items.map(row => row.candidate_id).sort(), ["CAN-00001","CAN-0001","CAN-1"], `offer candidate filter ${search} includes raw/display aliases`);
      const aliasOfferSearch = await page(db, { doc_id: "REQ-ID-SORT-1" }, 25, null, false, search, "offers", "candidate");
      assert.equal(aliasOfferSearch.total_count, 3, `offer global search ${search} includes raw/display aliases`);
    }
    for (const groupSearch of ["GRP-0001","GRP-00001"]) {
      const groupsByFilter = await page(db, { scope: "all", group_id: groupSearch }, 50, null, false, "", "position_groups", "name");
      assert.deepEqual(groupsByFilter.items.map(row => row.group_id).sort(), ["GRP-00001","GRP-000010","GRP-0001"], `group ID filter ${groupSearch} returns all raw/display matches`);
      const groupsBySearch = await page(db, { scope: "all" }, 50, null, false, groupSearch, "position_groups", "name");
      assert.deepEqual(groupsBySearch.items.map(row => row.group_id).sort(), ["GRP-00001","GRP-000010","GRP-0001"], `group global search ${groupSearch} returns all raw/display matches`);
    }
    for (const groupSearch of ["GRP-0001","GRP-00001"]) {
      const sourcingAliases = await page(db, { surface: "history", from: "2026-10-31", to: "2026-10-31", group: groupSearch }, 50, null, false, "", "sourcing", "group");
      assert.deepEqual(sourcingAliases.items.map(row => row.group.group_id).sort(), ["GRP-00001","GRP-000010","GRP-0001"], `sourcing group filter ${groupSearch} returns all raw/display matches`);
      const sourcingSearch = await page(db, { surface: "history", from: "2026-10-31", to: "2026-10-31" }, 50, null, false, groupSearch, "sourcing", "group");
      assert.deepEqual(sourcingSearch.items.map(row => row.group.group_id).sort(), ["GRP-00001","GRP-000010","GRP-0001"], `sourcing global search ${groupSearch} returns all raw/display matches`);
    }
    for (const groupSearch of ["GRP-0001","GRP-00001"]) {
      const requisitionAlias = await page(db, { doc_id: "REQ-ID-SORT-1" }, 25, null, false, groupSearch, "requisitions", "doc_id");
      assert.equal(requisitionAlias.total_count, 1, `requisition global search resolves linked group alias ${groupSearch}`);
    }
    for (const idSearch of ["CAN-0001","CAN-00001"]) {
      const auditAlias = await page(db, { entity: "candidates", entityId: idSearch }, 25, null, false, "", "audit_log", "changed_at");
      assert.deepEqual(auditAlias.items.map(row => row.entity_id).sort(), ["CAN-00001","CAN-0001","CAN-1"], `audit entity ID filter ${idSearch} retains all raw/display matches`);
      const auditSearch = await page(db, { entity: "candidates" }, 25, null, false, idSearch, "audit_log", "changed_at");
      assert.deepEqual(auditSearch.items.map(row => row.entity_id).sort(), ["CAN-00001","CAN-0001","CAN-1"], `audit global search ${idSearch} retains all raw/display matches`);
    }

    await db.exec(`insert into public.candidates(candidate_id,name,first_contact_date,created_at,updated_at) values
        ('CAN-HOME-PAST-ENTRY','HOME-DATE past entry future outcome','2026-09-01',now(),now()),
        ('CAN-HOME-ALL-FUTURE','HOME-DATE all events future','2026-11-15',now(),now());
      insert into public.candidate_applications(application_id,candidate_id,group_id,state,created_at) values
        (md5('home-past-entry')::uuid,'CAN-HOME-PAST-ENTRY','GRP-00001','active',now()),
        (md5('home-all-future')::uuid,'CAN-HOME-ALL-FUTURE','GRP-00001','active',now());
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,outcome_date,round,log_id,candidate_id,remark)
        values(md5('home-past-entry')::uuid,'Phone Screen',null,'2026-10-15','2026-11-10',1,9000,'CAN-HOME-PAST-ENTRY','future outcome paired with past entry'),
          (md5('home-all-future')::uuid,'Phone Screen',null,'2026-11-15',null,1,9001,'CAN-HOME-ALL-FUTURE','future pending event');`);
    const futureOutcome = await page(db, { homeTab: "active_pipeline", asOf: "2026-10-31" }, 25, null, false, "HOME-DATE past entry", "candidate_applications", "home_oldest_touch", "asc");
    assert.equal(futureOutcome.total_count, 1, "Home count includes an authorized past entry even when its paired outcome is after the as-of date");
    assert.equal(futureOutcome.items[0].home_last_touch_date, "2026-10-15", "Home touch selection evaluates log and outcome dates independently before taking the latest eligible date");
    const allFutureDates = await page(db, { homeTab: "active_pipeline", asOf: "2026-10-31" }, 25, null, false, "HOME-DATE all events future", "candidate_applications", "home_oldest_touch", "asc");
    assert.equal(allFutureDates.total_count, 1);
    assert.equal(allFutureDates.items[0].home_last_touch_date, null, "future logs and future First Contact do not become a fabricated Home touch date");
    const homeDateOrder = await page(db, { homeTab: "active_pipeline", asOf: "2026-10-31" }, 25, null, false, "HOME-DATE", "candidate_applications", "home_oldest_touch", "asc");
    assert.deepEqual(homeDateOrder.items.map(row => row.candidate_id), ["CAN-HOME-PAST-ENTRY","CAN-HOME-ALL-FUTURE"], "Home date sorting places the past touch before a null future-only row");

    await db.exec(`insert into public.candidates(candidate_id,name,home_site,created_by,created_at,updated_at)
        select 'CAN-BOARD-PHONE-'||lpad(n::text,3,'0'),'BOARD-BULK Phone stage '||n,'Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-20T00:00:00Z' from generate_series(1,60) n;
      insert into public.candidates(candidate_id,name,home_site,created_by,created_at,updated_at) values
        ('CAN-BOARD-OTHER','BOARD-OTHER stage beyond old page','Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-20T00:00:00Z'),
        ('CAN-BOARD-FAILED','BOARD-FILTER failed phone','Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-20T00:00:00Z'),
        ('CAN-BOARD-OFFER-PASS','BOARD-FILTER passed offer','Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-20T00:00:00Z'),
        ('CAN-BOARD-NO-ACTIVITY','BOARD NO ACTIVITY special','Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-20T00:00:00Z'),
        ('CAN-BOARD-NO-ACTIVITY-LATE','BOARD NO ACTIVITY later update','Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-29T00:00:00Z'),
        ('CAN-BOARD-OFFER-ACCEPTED','BOARD accepted pending offer','Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-20T00:00:00Z'),
        ('CAN-BOARD-OFFER-PENDING','BOARD pending offer','Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-20T00:00:00Z');
      insert into public.candidate_applications(application_id,candidate_id,group_id,state,created_at)
        select md5('board-phone-'||n)::uuid,'CAN-BOARD-PHONE-'||lpad(n::text,3,'0'),'GRP-00001',case when n%2=0 then 'closed' else 'active' end,'2026-10-01T00:00:00Z' from generate_series(1,60) n;
      insert into public.candidate_applications(application_id,candidate_id,group_id,state,created_at) values
        (md5('board-other')::uuid,'CAN-BOARD-OTHER','GRP-00001','closed','2026-10-01T00:00:00Z'),
        (md5('board-failed')::uuid,'CAN-BOARD-FAILED','GRP-00001','active','2026-10-01T00:00:00Z'),
        (md5('board-offer-pass')::uuid,'CAN-BOARD-OFFER-PASS','GRP-00001','active','2026-10-01T00:00:00Z'),
        (md5('board-no-activity')::uuid,'CAN-BOARD-NO-ACTIVITY','GRP-00001','closed','2026-10-01T00:00:00Z'),
        (md5('board-no-activity-late')::uuid,'CAN-BOARD-NO-ACTIVITY-LATE','GRP-00001','active','2026-10-01T00:00:00Z'),
        (md5('board-offer-accepted')::uuid,'CAN-BOARD-OFFER-ACCEPTED','GRP-00001','active','2026-10-01T00:00:00Z'),
        (md5('board-offer-pending')::uuid,'CAN-BOARD-OFFER-PENDING','GRP-00001','closed','2026-10-01T00:00:00Z'),
        (md5('board-legacy-id')::uuid,'CAN-0001','GRP-00001','active','2026-10-01T00:00:00Z'),
        (md5('board-padded-id')::uuid,'CAN-00001','GRP-00001','active','2026-10-01T00:00:00Z');
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,outcome_date,round,log_id,candidate_id,remark)
        select md5('board-phone-'||n)::uuid,'Phone Screen',null,'2026-10-20',null,1,12000+n,'CAN-BOARD-PHONE-'||lpad(n::text,3,'0'),'BOARD-BULK pending' from generate_series(1,60) n;
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,outcome_date,round,log_id,candidate_id,remark) values
        (md5('board-other')::uuid,'HR Interview',null,'2026-10-20',null,1,12100,'CAN-BOARD-OTHER','BOARD-OTHER stage beyond old page'),
        (md5('board-failed')::uuid,'Phone Screen',0,'2026-10-20','2026-10-21',1,12101,'CAN-BOARD-FAILED','BOARD-FILTER failed phone'),
        (md5('board-offer-pass')::uuid,'Offer',1,'2026-10-20','2026-10-21',1,12102,'CAN-BOARD-OFFER-PASS','BOARD-FILTER passed offer'),
        (md5('board-offer-accepted')::uuid,'Offer',null,'2026-10-20',null,1,12103,'CAN-BOARD-OFFER-ACCEPTED','BOARD accepted pending offer'),
        (md5('board-offer-pending')::uuid,'Offer',null,'2026-10-20',null,1,12104,'CAN-BOARD-OFFER-PENDING','BOARD pending offer'),
        (md5('board-legacy-id')::uuid,'Phone Screen',null,'2026-10-20',null,1,12105,'CAN-0001','BOARD legacy ID alias'),
        (md5('board-padded-id')::uuid,'Phone Screen',null,'2026-10-20',null,1,12106,'CAN-00001','BOARD padded ID alias');
      insert into public.requisitions(doc_id,site,person_in_charge,is_priority,position,department,head_count,request_type,status)
        values('REQ-BOARD-OFFER','Site A','PIC',false,'Offer board test','Ops',5,'New','ongoing');
      insert into public.document_groups(doc_group_id,doc_id,group_id,group_position)
        values('DG-BOARD-OFFER','REQ-BOARD-OFFER','GRP-00001','Engineer');
      insert into public.offers(application_id,candidate_id,doc_id,accepted_date) values
        (md5('board-offer-accepted')::uuid,'CAN-BOARD-OFFER-ACCEPTED','REQ-BOARD-OFFER','2026-10-22');`);
    const phoneFilters = { stage: "Phone Screen", groupId: "GRP-00001", headerSite: "Site A", priorityOnly: true };
    const phoneBoard = await page(db, phoneFilters, 25, null, false, "BOARD-BULK", "pipeline_stage", "board_last_update", "asc");
    assert.equal(phoneBoard.total_count, 60, "stage membership, header/group/priority filters and search run before exact count and page limit");
    assert.equal(phoneBoard.items.length, 25);
    assert.ok(phoneBoard.items.some(row => row.application_state === "closed"), "legacy stage board includes eligible closed applications without adding state=active");
    assert.ok(phoneBoard.items.every(row => row.latest_process === "Phone Screen" && row.latest_result !== 0), "stage board page contains only the exact requested stage and excludes failures");
    const phoneBoardNext = await page(db, phoneFilters, 25, phoneBoard.next_cursor, false, "BOARD-BULK", "pipeline_stage", "board_last_update", "asc");
    const phoneBoardLast = await page(db, phoneFilters, 25, phoneBoardNext.next_cursor, false, "BOARD-BULK", "pipeline_stage", "board_last_update", "asc");
    assert.equal(phoneBoardLast.items.length, 10);
    assert.equal(new Set([...phoneBoard.items,...phoneBoardNext.items,...phoneBoardLast.items].map(row => row.application_id)).size, 60, "equal board update dates use distinct application ID keyset ties with no gaps across pages");
    const phoneBoardPrev = await page(db, phoneFilters, 25, phoneBoardNext.previous_cursor, true, "BOARD-BULK", "pipeline_stage", "board_last_update", "asc");
    assert.deepEqual(phoneBoardPrev.items.map(row => row.application_id), phoneBoard.items.map(row => row.application_id), "stage board Previous returns the same tied-date page");
    const phoneBoardDesc = await page(db, phoneFilters, 25, null, false, "BOARD-BULK", "pipeline_stage", "board_last_update", "desc");
    const phoneBoardDescNext = await page(db, phoneFilters, 25, phoneBoardDesc.next_cursor, false, "BOARD-BULK", "pipeline_stage", "board_last_update", "desc");
    assert.equal(new Set([...phoneBoardDesc.items,...phoneBoardDescNext.items].map(row => row.application_id)).size, 50, "descending board sort advances through tied dates without duplicates");
    assert.equal((await page(db, { stage: "Phone Screen" }, 25, null, false, "BOARD-OTHER", "pipeline_stage")).total_count, 0, "another stage cannot leak into the concentrated stage page");
    assert.equal((await page(db, { stage: "HR Interview" }, 25, null, false, "BOARD-OTHER", "pipeline_stage")).total_count, 1, "the distinct stage remains searchable beyond the former unfiltered first page");
    const boardIdAliases = await page(db, { stage: "Phone Screen" }, 25, null, false, "CAN-00001", "pipeline_stage");
    assert.deepEqual([...new Set(boardIdAliases.items.map(row => row.candidate_id))].sort(), ["CAN-00001","CAN-0001","CAN-1"], "padded ID search returns every distinct raw candidate alias on the stage board");
    assert.ok(boardIdAliases.total_count >= 3, "stage search retains separate application journeys for colliding display IDs");
    const noActivity = await page(db, { stage: "No activity", groupId: "GRP-00001" }, 25, null, false, "BOARD NO ACTIVITY", "pipeline_stage");
    assert.equal(noActivity.total_count, 2);
    assert.equal(noActivity.items[0].latest_process, "No activity", "No activity is a valid independent board column");
    assert.deepEqual(noActivity.items.map(row => row.candidate_id), ["CAN-BOARD-NO-ACTIVITY","CAN-BOARD-NO-ACTIVITY-LATE"], "default board_last_update sort uses each no-log candidate's updated_at as the fallback date");
    assert.equal((await page(db, { stage: "Phone Screen", boardFilter: "failed" }, 25, null, false, "BOARD-FILTER failed phone", "pipeline_stage")).total_count, 0, "active board membership excludes latest Fail even when a local board filter asks for it");
    assert.equal((await page(db, { stage: "Offer", boardFilter: "all" }, 25, null, false, "BOARD-FILTER passed offer", "pipeline_stage")).total_count, 0, "active board membership excludes passed Offer rows");
    assert.equal((await page(db, { stage: "Offer", boardFilter: "offer_pending" }, 25, null, false, "BOARD accepted pending offer", "pipeline_stage")).total_count, 0, "Offer-pending board filter excludes rows with an accepted offer date");
    assert.equal((await page(db, { stage: "Offer", boardFilter: "offer_pending" }, 25, null, false, "BOARD pending offer", "pipeline_stage")).total_count, 1);
    await assert.rejects(() => page(db, { stage: "Not a stage" }, 25, null, false, "BOARD-BULK", "pipeline_stage"), /RECRUITMENT_LIST_FILTER_INVALID/, "pipeline_stage requires one of the exact visible stage names");
    await assert.rejects(() => page(db, {}, 25, null, false, "BOARD-BULK", "pipeline_stage"), /RECRUITMENT_LIST_FILTER_INVALID/, "pipeline_stage rejects a missing stage");
    await assert.rejects(() => db.query("select public.app_recruitment_list_count_v1('pipeline_stage','BOARD-BULK','{}'::jsonb)"), /RECRUITMENT_LIST_FILTER_INVALID/, "count endpoint rejects a missing stage using the same qualification predicate");
    assert.equal((await page(db, { boardFilter: "failed", recentSince: "2026-10-01", asOf: "2026-10-31" }, 25, null, false, "BOARD-FILTER failed phone", "candidate_applications")).total_count, 1, "candidate_applications failed drilldown population remains unchanged");

    const listAcl = await db.query(`select has_function_privilege('anon','public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean,boolean)','execute') as anon_exec,
        has_function_privilege('authenticated','public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean,boolean)','execute') as auth_exec,
        has_function_privilege('anon','public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean)','execute') as helper_anon_exec,
        has_function_privilege('authenticated','public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean)','execute') as helper_auth_exec`);
    assert.deepEqual(listAcl.rows[0], { anon_exec: false, auth_exec: true, helper_anon_exec: false, helper_auth_exec: true }, "CREATE OR REPLACE stage migration preserves the pre-90 authenticated-only function ACLs");

    const detail = (await db.query("select public.app_candidate_profile_detail_v1('CAN-00001') as value")).rows[0].value;
    assert.equal(detail.candidate.candidate_id, "CAN-00001");
    assert.equal(detail.capabilities.can_edit, true);
    assert.equal(detail.capabilities.can_read_note, true);
    assert.equal(detail.capabilities.note_editor_label, "Test Recruiter");
    assert.equal(detail.capabilities.is_unmatched, false);
    assert.equal(Object.hasOwn(detail.capabilities, "application_count"), false);
    const maskedDetail = (await db.query("select public.app_candidate_profile_detail_v1('CAN-MASKED') as value")).rows[0].value;
    assert.equal(maskedDetail.candidate, null);
    assert.equal(maskedDetail.masked.candidate_id, "CAN-MASKED");
    assert.equal(maskedDetail.capabilities, null);
    const hiddenDetail = (await db.query("select public.app_candidate_profile_detail_v1('CAN-HIDDEN') as value")).rows[0].value;
    assert.deepEqual(hiddenDetail, { candidate: null, masked: null, capabilities: null }, "hidden application-backed profile does not expose existence metadata");
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(() => db.query("select public.app_candidate_profile_detail_v1('CAN-00001')"), /RECRUITMENT_READ_NOT_AUTHORIZED/);
    await db.exec(`insert into public.candidates(candidate_id,name,home_site,created_by,created_at,updated_at)
        values('CAN-00072','Offer Option 72','Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),
              ('CAN-00073','Offer Option 73','Site A','11111111-1111-1111-1111-111111111111','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z');
      insert into public.candidate_applications(application_id,candidate_id,group_id,state,created_at)
        values(md5('offer-option-72')::uuid,'CAN-00072','GRP-00001','active','2026-10-01T00:00:00Z'),
              (md5('offer-option-73')::uuid,'CAN-00073','GRP-00001','active','2026-10-01T00:00:00Z');
      insert into public.recruitment_logs(application_id,recruitment_process,result,log_date,round,log_id,candidate_id,created_at)
        values(md5('offer-option-72')::uuid,'Offer',1,'2026-10-30',1,300,'CAN-00072','2026-10-30T00:00:00Z'),
              (md5('offer-option-73')::uuid,'Offer',1,'2026-10-30',1,301,'CAN-00073','2026-10-30T00:00:00Z');`);
    await db.query("select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)");
    const offerCandidates = await db.query("select public.app_offer_candidates_page_v1('',null,null,1) as page");
    assert.equal(offerCandidates.rows[0].page.items.length, 1, "offer form receives bounded Offer-pass candidate options");
    assert.equal(offerCandidates.rows[0].page.items[0].candidate_id, "CAN-00072");
    assert.equal(offerCandidates.rows[0].page.has_more, true, "offer candidate option pages expose continuation when eligible rows remain");
    const offerCandidateNext = await db.query("select public.app_offer_candidates_page_v1('', $1, $2, 1) as page", [offerCandidates.rows[0].page.next_cursor.candidate_id, offerCandidates.rows[0].page.next_cursor.application_id]);
    assert.equal(offerCandidateNext.rows[0].page.items[0].candidate_id, "CAN-00073", "offer candidate keyset advances without duplicating journeys");
    assert.ok(offerCandidates.rows[0].page.items[0].doc_ids.length > 0, "offer candidate options expose only linked open requisitions");
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.app_offer_candidates_page_v1('',null,null,25)"), /permission denied/);
    await db.exec("reset role");
    console.log("recruitment application list PGlite assertions passed");
  } finally {
    await db.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
