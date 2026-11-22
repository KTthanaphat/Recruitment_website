const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(path.join(process.env.RECRUITMENT_DB_TOOLS || path.join(process.env.TEMP, "recruitment-db-tools"), "node_modules/@electric-sql/pglite"));

const root = path.resolve(__dirname, "..");
const admin = "11111111-1111-1111-1111-111111111111";
const recruiter = "22222222-2222-2222-2222-222222222222";
const range = { start: "2026-10-01", end: "2026-10-31" };
const migration = "20261122151557_dashboard_period_end_start_confirmation.sql";

async function createPeriodEndFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema cron;
    create table cron.job(jobname text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$ select 1::bigint $$;
    create function cron.unschedule(text) returns boolean language sql as $$ select true $$;
    create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    grant usage on schema auth to authenticated;
  `);
  const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const schemas = [...config.matchAll(/"\.\/schemas\/([^"]+)"/g)].map(match => match[1]);
  for (const file of schemas) {
    const sql = fs.readFileSync(path.join(root, "supabase/schemas", file), "utf8").replace(/^create extension.*;\s*$/gm, "");
    try { await db.exec("begin;\n" + sql + "\ncommit;"); }
    catch (error) { throw new Error(file + ": " + error.message, { cause: error }); }
  }
  await db.exec(fs.readFileSync(path.join(root, "supabase/migrations", migration), "utf8"));
  await db.exec(`
    insert into auth.users(id,email) values ('${admin}','recruitment-preview@example.test'),('${recruiter}','recruiter@example.test');
    update public.profiles set role='system_admin',site='HQ',nickname='Ari',full_name='Ari (Demo)' where id='${admin}';
    update public.profiles set role='site_recruiter',site='HQ',nickname='Nok',full_name='Nok (Demo)' where id='${recruiter}';
    set session_replication_role=replica;
    insert into public.requisitions(doc_id,pr_approved_date,site,position,department,level,head_count,person_in_charge,request_type,status,is_secret,created_at,updated_at)
    select id,pr::date,site,title,'Operations','4',capacity,pic,kind,status,secret,pr::timestamptz,
      case when id='PER-HQ-CARRY' then '2026-11-02'::timestamptz else pr::timestamptz end
    from (values
      ('PER-HQ-CARRY','2026-09-25','HQ','Operations analyst',4,'Ari','New','ongoing',false),
      ('PER-HQ-CLOSED','2026-09-25','HQ','Warehouse coordinator',1,'Nok','New','filled',false),
      ('PER-HQ-FIRST','2026-10-01','HQ','Engineering trainee',1,'Nok','New','filled',false),
      ('PER-HQ-LEGACY','2026-10-04','HQ','Legacy records assistant',1,'Nok','New','filled',false),
      ('PER-KT1-LAST','2026-10-31','KT1','Quality technician',3,'Ari','Replacement','ongoing',false),
      ('PER-KT1-REHIRE','2026-10-10','KT1','Production planner',2,'Ari','Replacement','filled',false),
      ('PER-KT1-CANCEL','2026-10-07','KT1','Cancelled fixture',4,'Ari','New','cancel',false),
      ('PER-SECRET','2026-10-07','HQ','Confidential fixture',5,'Nok','New','ongoing',true)
    ) f(id,pr,site,title,capacity,pic,kind,status,secret);

    insert into public.position_groups(group_id,group_position,is_secret)
    select 'GRP-'||doc_id,position,is_secret from public.requisitions;
    insert into public.document_groups(doc_group_id,doc_id,group_id,group_position)
    select 'LINK-'||doc_id,doc_id,'GRP-'||doc_id,position from public.requisitions;

    insert into public.candidates(candidate_id,name,phone_no,email,home_site,created_at,updated_at,created_by)
    select 'CAN-'||i,'Sample candidate '||i,'080123' || lpad(i::text,4,'0'),'candidate'||i||'@example.test',
      case when i>=7 and i<>12 then 'KT1' else 'HQ' end,'2026-09-01','2026-09-01','${admin}'::uuid
    from generate_series(1,12) i;

    create temporary table period_offers(i int, person int, req text, accepted date, scheduled date, outcome text, confirmed timestamptz);
    insert into period_offers values
      (1,1,'PER-HQ-CARRY','2026-09-26','2026-10-01','started','2026-10-01T05:00Z'),
      (2,2,'PER-HQ-CARRY','2026-09-27','2026-10-01','did_not_start','2026-10-08T17:01Z'),
      (3,3,'PER-HQ-CARRY','2026-10-10','2026-10-15','started','2026-10-15T02:00Z'),
      (4,4,'PER-HQ-CLOSED','2026-09-26','2026-10-20','started','2026-10-20T05:00Z'),
      (5,5,'PER-HQ-FIRST','2026-10-05','2026-10-10','started','2026-10-10T05:00Z'),
      (6,6,'PER-HQ-FIRST','2026-10-06','2026-10-09','started','2026-10-09T05:00Z'),
      (7,2,'PER-KT1-REHIRE','2026-10-10','2026-10-15','started','2026-10-15T05:00Z'),
      (8,8,'PER-KT1-REHIRE','2026-10-12','2026-10-31','started','2026-10-31T16:59Z'),
      (9,9,'PER-KT1-LAST','2026-10-31','2026-10-31','started','2026-10-31T17:01Z'),
      (10,10,'PER-KT1-LAST','2026-10-31','2026-10-31',null,null),
      (11,11,'PER-KT1-LAST','2026-10-31','2026-11-05',null,null),
      (12,12,'PER-SECRET','2026-10-19','2026-10-21','started','2026-10-21T05:00Z');

    insert into public.candidate_applications(application_id,candidate_id,group_id,created_at,updated_at)
    select md5('application-'||i)::uuid,'CAN-'||person,'GRP-'||req,'2026-09-01','2026-09-01' from period_offers;
    insert into public.offers(offer_id,candidate_id,doc_id,application_id,accepted_date,first_working_date,start_confirmation,start_confirmed_at,start_confirmed_by,start_confirmation_reason,created_at,updated_at)
    select i,'CAN-'||person,req,md5('application-'||i)::uuid,accepted,case when i=3 then '2026-11-05'::date else scheduled end,outcome,confirmed,
      case when confirmed is not null then '${admin}'::uuid end,case when outcome='did_not_start' then 'Synthetic no-show' end,
      accepted::timestamptz,case when i=3 then '2026-11-02'::timestamptz else coalesce(confirmed,accepted::timestamptz) end
    from period_offers;

    insert into public.change_logs(entity,entity_id,action,changed_at,old_data,new_data)
    select 'requisitions',doc_id,'update','2026-11-02',to_jsonb(r)||jsonb_build_object('person_in_charge','Nok','updated_at','2026-09-25T00:00Z'),to_jsonb(r)
    from public.requisitions r where doc_id='PER-HQ-CARRY';
    insert into public.change_logs(entity,entity_id,action,changed_at,old_data,new_data)
    select 'offers',doc_id,'update','2026-11-02',to_jsonb(o)||jsonb_build_object('first_working_date','2026-10-15','updated_at','2026-10-15T02:00Z'),to_jsonb(o)
    from public.offers o where offer_id=3;
    insert into public.change_logs(entity,entity_id,action,changed_at,old_data,new_data)
    select 'offers',doc_id,'offer:start-confirmed',start_confirmed_at,
      to_jsonb(o)||jsonb_build_object('start_confirmation',null,'start_confirmed_at',null,'start_confirmed_by',null,'updated_at',created_at),to_jsonb(o)
    from public.offers o where start_confirmed_at is not null and offer_id<>12;
    insert into public.requisition_logs(doc_id,log_date,status,created_at)
    values ('PER-HQ-LEGACY','2026-10-22','filled','2026-10-22'),('PER-KT1-CANCEL','2026-10-18','cancel','2026-10-18');

    set session_replication_role=origin;
  `);
  await setUser(db, admin);
  return db;
}

async function setUser(db, id) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}

async function vacancyPage(db, { scope = {}, from = range.start, to = range.end, filters = {}, cursor, asOf, search = "" } = {}) {
  const result = await db.query(`
    select public.app_dashboard_active_requisitions_page_v2(
      $1::date,$2::date,'custom','status',$3::jsonb,$4,$5,25,$6,$7::jsonb,null,null,$8::timestamptz
    ) report`, [from, to, JSON.stringify(scope), cursor?.value ?? null, cursor?.id ?? null, search, JSON.stringify(filters), asOf ?? null]);
  return result.rows[0].report;
}

async function performance(db, scope = {}) {
  return (await db.query(
    "select public.app_dashboard_performance_summary_v1($1,$2,'2026-09-01','2026-09-30','pim',$3::jsonb) report",
    [range.start, range.end, JSON.stringify(scope)])).rows[0].report;
}

function reconcile(rows, waterfall) {
  const groups = new Map();
  const group = (site, kind) => {
    const key = site + ":" + kind;
    if (!groups.has(key)) groups.set(key, { open: 0, closing: 0, movement: 0 });
    return groups.get(key);
  };
  for (const row of rows) group(row.site, row.request_type).open += row.open_headcount ?? 0;
  for (const row of waterfall) {
    const totals = group(row.site, row.request_type);
    totals[row.waterfall_category === "Total" ? "closing" : "movement"] += row.vacancy_count;
  }
  for (const [key, totals] of groups) {
    assert.equal(totals.closing, totals.open, key + " closing and table");
    assert.equal(totals.movement, totals.closing, key + " movement and closing");
  }
}

async function main() {
  const db = await createPeriodEndFixture();
  try {
    const page = await vacancyPage(db);
    const row = id => page.rows.find(item => item.doc_id === id);
    assert.equal(row("PER-HQ-CARRY").person_in_charge, "Nok");
    assert.equal(row("PER-HQ-CARRY").open_headcount, 2);
    assert.deepEqual(row("PER-HQ-CARRY").start_statuses, { awaiting: 0, didNotStart: 1, scheduled: 0, started: 2, unavailable: 0 });
    assert.equal(row("PER-HQ-CARRY").sla_state.startDate, "2026-10-09");
    assert.equal(row("PER-HQ-FIRST").opened_in_period, true);
    assert.equal(row("PER-HQ-FIRST").open_headcount, 0);
    assert.equal(row("PER-HQ-FIRST").filled_date, "2026-10-05");
    assert.equal(row("PER-KT1-LAST").opened_in_period, true);
    assert.deepEqual(row("PER-KT1-LAST").start_statuses, { awaiting: 2, didNotStart: 0, scheduled: 1, started: 0, unavailable: 0 });
    assert.equal(row("PER-HQ-LEGACY").filled_date, "2026-10-22");
    for (const excluded of ["PER-HQ-CLOSED", "PER-KT1-CANCEL", "PER-SECRET"]) assert.equal(row(excluded), undefined);
    reconcile(page.rows, page.waterfallRows);
    const filtered = await vacancyPage(db, { filters: { opened_in_period: "ใช่" }, asOf: page.asOf });
    assert(filtered.rows.length < page.rows.length && filtered.rows.every(item => item.opened_in_period));
    assert.deepEqual(filtered.waterfallRows, page.waterfallRows);
    assert((await vacancyPage(db, { scope: { headerPic: "Ari" } })).rows.every(item => item.person_in_charge === "Ari"));
    const preNoShow = await vacancyPage(db, { to: "2026-10-08", search: "Operations analyst" });
    assert.equal(preNoShow.rows[0].start_statuses.didNotStart, 0);
    assert.equal(preNoShow.rows[0].open_headcount, 2);

    const attendance = (await performance(db)).current.attendance;
    assert.deepEqual(attendance.map(({ site, due, started, didNotStart }) => [site, due, started, didNotStart]), [["HQ",6,5,1],["KT1",4,2,0]]);
    assert.equal(attendance.reduce((total, item) => total + item.started, 0) / attendance.reduce((total, item) => total + item.due, 0), 0.7);

    await setUser(db, recruiter);
    const site = await vacancyPage(db);
    assert(site.rows.length > 0 && site.rows.every(item => item.site === "HQ"));
    reconcile(site.rows, site.waterfallRows);
    const privilege = await db.query("select has_function_privilege('anon','public.app_dashboard_active_requisitions_page_v2(date,date,text,text,jsonb,text,text,integer,text,jsonb,text,text,timestamptz)','execute') as allowed, has_function_privilege('authenticated','app_private.dashboard_period_offers(timestamptz,text[],boolean)','execute') as raw");
    assert.deepEqual(privilege.rows[0], { allowed: false, raw: false });

    await db.exec("reset role; set session_replication_role=replica");
    await db.exec(`insert into public.requisitions(doc_id,pr_approved_date,site,position,department,level,created_at,updated_at)
      select 'PAGE-'||i,'2026-10-09','HQ','Cursor case '||i,'Operations','4','2026-10-09','2026-10-09' from generate_series(1,26) i;
      insert into public.change_logs(entity,entity_id,action,changed_at,old_data,new_data)
      select 'offers',doc_id,'offer:start-confirmation-corrected','2026-10-17T05:00Z',
        to_jsonb(o),to_jsonb(o)||jsonb_build_object('start_confirmation','started','start_confirmed_at','2026-10-17T05:00Z')
      from public.offers o where offer_id=2;
      delete from public.offers where offer_id=7;
      update public.offers set start_confirmation='started',start_confirmed_at='2026-10-17T05:00Z',start_confirmation_reason=null,updated_at='2026-10-17T05:00Z' where offer_id=2;
      update public.offers set updated_at='2026-11-03' where offer_id=10;
      update public.requisitions set updated_at='2026-11-03' where doc_id='PAGE-1';
      set session_replication_role=origin;`);
    await setUser(db, admin);
    const first = await vacancyPage(db);
    assert(first.hasMore && first.historyIncomplete);
    const second = await vacancyPage(db, { cursor: first.nextCursor, asOf: first.asOf });
    assert.equal(second.waterfallRows, null);
    const all = [...first.rows, ...second.rows];
    assert.equal(new Set(all.map(item => item.doc_id)).size, first.total);
    assert.equal(all.find(item => item.doc_id === "PER-HQ-CARRY").open_headcount, 1);
    assert.equal(all.find(item => item.doc_id === "PER-KT1-LAST").open_headcount, null);
    assert.equal(all.find(item => item.doc_id === "PAGE-1").period_status, "unavailable");
    reconcile(all, first.waterfallRows);
    console.log("Period-end migration: cutoff, audit edits, attendance, coverage cap, reconciliation, pagination, confidentiality and role checks passed.");
  } finally {
    await db.close();
  }
}

if (require.main === module) main().catch(error => {
  console.error(error.message, error.cause?.message ?? error.detail ?? error.where ?? '');
  process.exitCode = 1;
});
module.exports = { createPeriodEndFixture, admin, range };
