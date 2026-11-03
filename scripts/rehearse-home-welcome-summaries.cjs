// Disposable PGlite checks for complete Home banner aggregates and parity with
// the actual legacy WelcomeSummary builder. No connected database is used.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { PGlite } = require(path.join(process.env.TEMP, 'recruitment-db-tools/node_modules/@electric-sql/pglite'));
const root = path.resolve(__dirname, '..');
const db = new PGlite();
const schema = fs.readFileSync(path.join(root, 'supabase/schemas/64_home_welcome_summaries.sql'), 'utf8').replaceAll('\r\n','\n');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261102122000_home_welcome_summaries.sql'), 'utf8');
const ts = require(path.join(root, 'node_modules/typescript'));
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request,parent,isMain,options) {
  if(request.startsWith('@/')) return path.join(root,'src',request.slice(2))+'.ts';
  return originalResolveFilename.call(this,request,parent,isMain,options);
};
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpile(fs.readFileSync(filename,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}),filename);
const { buildLegacyWelcomeSummary } = require(path.join(root,'tests/e2e/support/legacy-welcome-summary.ts'));

function bangkokToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function main() {
  const today = bangkokToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const prevMonth = new Date(`${monthStart}T00:00:00Z`); prevMonth.setUTCMonth(prevMonth.getUTCMonth() - 1);
  const previousMonthStart = prevMonth.toISOString().slice(0, 10);
  const farFuture = `${today.slice(0, 7)}-28`;
  const app1 = '10000000-0000-0000-0000-000000000001';
  const app2 = '10000000-0000-0000-0000-000000000002';
  const app3 = '10000000-0000-0000-0000-000000000003';
  const app4 = '10000000-0000-0000-0000-000000000004';
  const app5 = '10000000-0000-0000-0000-000000000005';
  const app6 = '10000000-0000-0000-0000-000000000006';
  const app7 = '10000000-0000-0000-0000-000000000007';
  const app8 = '10000000-0000-0000-0000-000000000008';
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema app_private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.profiles(id uuid primary key,full_name text,nickname text,role text not null,site text);
    create table public.requisitions(doc_id text primary key,site text,person_in_charge text,status text,head_count integer,pr_approved_date date,is_priority boolean default false);
    create table public.requisition_logs(log_id bigint primary key,doc_id text,log_date date,status text);
    create table public.document_groups(doc_group_id text primary key,doc_id text,group_id text);
    create table public.candidates(candidate_id text primary key,name text,nickname text,group_id text,created_by uuid);
    create table public.candidate_applications(application_id uuid primary key,candidate_id text,group_id text,state text);
    create table public.recruitment_logs(log_id bigint primary key,candidate_id text,application_id uuid,recruitment_process text,round integer,result smallint,superseded_at timestamptz,superseded_by_stage_instance_id uuid);
    create table public.offers(offer_id bigint primary key,candidate_id text,doc_id text,application_id uuid,accepted_date date,start_confirmation text);
    insert into public.profiles values
      ('00000000-0000-0000-0000-000000000001','Admin','Admin','system_admin',null),
      ('00000000-0000-0000-0000-000000000002','Rina Recruiter','Rina','site_recruiter','KT1'),
      ('00000000-0000-0000-0000-000000000003','Read Only','Viewer','viewer','KT1');
    insert into public.requisitions values
      ('REQ-1','KT1','Rina Recruiter','ongoing',4,'${previousMonthStart}',true),
      ('REQ-2','KT2','Other Recruiter','ongoing',3,'${previousMonthStart}',false),
      ('REQ-3','KT1','Other Recruiter','filled',2,'${previousMonthStart}',true),
      ('REQ-4','KT1','Other Recruiter','cancel',9,'${previousMonthStart}',true);
    insert into public.document_groups values ('DG-1','REQ-1','GRP-1'),('DG-3','REQ-3','GRP-1'),('DG-2','REQ-2','GRP-2'),('DG-4','REQ-4','GRP-1');
    insert into public.requisition_logs values (1,'REQ-3','${monthStart}','filled');
    insert into public.candidates values
      ('CAN-1','Phone Screen Candidate',null,'GRP-1','00000000-0000-0000-0000-000000000002'),
      ('CAN-2','Offer Candidate',null,'GRP-1','00000000-0000-0000-0000-000000000002'),
      ('CAN-3','Failed Candidate',null,'GRP-1','00000000-0000-0000-0000-000000000002'),
      ('CAN-4','Superseded Candidate',null,'GRP-1','00000000-0000-0000-0000-000000000002'),
      ('CAN-5','Foreign Site Candidate',null,'GRP-2','00000000-0000-0000-0000-000000000003'),
      ('CAN-6','Closed Offer Candidate',null,'GRP-1','00000000-0000-0000-0000-000000000002'),
      ('CAN-7','No Activity Candidate',null,'GRP-1','00000000-0000-0000-0000-000000000002'),
      ('CAN-8','Filled Requisition Candidate',null,'GRP-1','00000000-0000-0000-0000-000000000002');
    insert into public.candidate_applications values
      ('${app1}','CAN-1','GRP-1','active'),('${app2}','CAN-2','GRP-1','active'),('${app3}','CAN-3','GRP-1','active'),
      ('${app4}','CAN-4','GRP-1','active'),('${app5}','CAN-5','GRP-2','active'),('${app6}','CAN-6','GRP-1','closed'),
      ('${app7}','CAN-7','GRP-1','active'),('${app8}','CAN-8','GRP-1','active');
    insert into public.recruitment_logs values
      (1,'CAN-1','${app1}','Phone Screen',1,null,null,null),
      (2,'CAN-2','${app2}','Offer',1,1,null,null),
      (3,'CAN-3','${app3}','Test',1,0,null,null),
      (4,'CAN-4','${app4}','Phone Screen',1,1,null,null),
      (5,'CAN-4','${app4}','Offer',2,1,now(),gen_random_uuid()),
      (6,'CAN-5','${app5}','HR Interview',1,null,null,null),
      (7,'CAN-6','${app6}','Offer',1,1,null,null),
      (8,'CAN-8','${app8}','Phone Screen',1,null,null,null);
    insert into public.offers values
      (1,'CAN-1','REQ-1','${app1}','${monthStart}',null),
      (2,'CAN-8','REQ-3','${app8}','${monthStart}','did_not_start'),
      (3,'CAN-5','REQ-2','${app5}','${farFuture}',null),
      (4,'CAN-4','REQ-4','${app4}','${monthStart}',null),
      (5,'CAN-2','REQ-MISSING','${app2}','${monthStart}',null);
  `);
  await db.exec(`
    create function app_private.is_recruitment_reader() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and exists(select 1 from public.profiles p where p.id=auth.uid()) $$;
    create function app_private.can_read_requisition(p_doc text) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.requisitions r join public.profiles p on p.id=auth.uid() where r.doc_id=p_doc and (p.role in ('system_admin','admin_recruiter','viewer') or r.site=p.site or lower(btrim(coalesce(r.person_in_charge,''))) in (lower(btrim(p.nickname)),lower(btrim(p.full_name)))))
    $$;
    create function app_private.can_read_application(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.candidate_applications a join public.profiles p on p.id=auth.uid() where a.application_id=p_id and (p.role in ('system_admin','admin_recruiter','viewer') or exists(select 1 from public.document_groups d where d.group_id=a.group_id and app_private.can_read_requisition(d.doc_id))))
    $$;
    create function app_private.can_read_candidate(p_id text) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.candidates c join public.profiles p on p.id=auth.uid() where c.candidate_id=p_id and (p.role in ('system_admin','admin_recruiter','viewer') or c.created_by=p.id or exists(select 1 from public.candidate_applications a where a.candidate_id=c.candidate_id and app_private.can_read_application(a.application_id))))
    $$;
    grant usage on schema app_private to authenticated;
    grant usage on schema auth to authenticated;
    grant execute on all functions in schema app_private to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant select on public.profiles,public.requisitions,public.requisition_logs,public.document_groups,public.candidates,public.candidate_applications,public.recruitment_logs,public.offers to authenticated;
    alter table public.profiles enable row level security;
    alter table public.requisitions enable row level security;
    alter table public.requisition_logs enable row level security;
    alter table public.document_groups enable row level security;
    alter table public.candidates enable row level security;
    alter table public.candidate_applications enable row level security;
    alter table public.recruitment_logs enable row level security;
    alter table public.offers enable row level security;
    create policy profile_self on public.profiles for select to authenticated using(id=auth.uid());
    create policy req_read on public.requisitions for select to authenticated using(app_private.can_read_requisition(doc_id));
    create policy reqlog_read on public.requisition_logs for select to authenticated using(app_private.can_read_requisition(doc_id));
    create policy dgroup_read on public.document_groups for select to authenticated using(app_private.can_read_requisition(doc_id));
    create policy candidate_read on public.candidates for select to authenticated using(app_private.can_read_candidate(candidate_id));
    create policy application_read on public.candidate_applications for select to authenticated using(app_private.can_read_application(application_id));
    create policy recruitment_log_read on public.recruitment_logs for select to authenticated using(app_private.can_read_application(application_id));
    create policy offer_read on public.offers for select to authenticated using(app_private.can_read_requisition(doc_id) and app_private.can_read_application(application_id));
  `);
  await db.exec(migration);
  await db.exec('alter function public.app_home_welcome_summary_v1() rename to test_legacy_welcome_summary');
  await db.exec(schema);
  const update = fs.readFileSync(path.join(root, 'supabase/migrations/20261103023353_home_loading_sections.sql'), 'utf8');
  assert.ok(update.includes(schema.slice(schema.indexOf('create or replace function public.app_home_welcome_summary_v1'), schema.indexOf('create or replace function public.app_home_banner_summary_v1')).trim()), 'new migration contains the canonical optimized Welcome function');
  await db.exec(update);
  const query = async (sql, params = []) => (await db.query(sql, params)).rows;
  const maybe = (await query(`select has_function_privilege('anon','public.app_home_welcome_summary_v1()','EXECUTE') as anon_welcome, has_function_privilege('anon','public.app_home_banner_summary_v1(jsonb)','EXECUTE') as anon_banner`))[0];
  assert.equal(maybe.anon_welcome, false); assert.equal(maybe.anon_banner, false);

  async function runFor(profileId, expectedRole) {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [profileId]);
    await db.exec('set role authenticated');
    const result = (await query('select public.app_home_welcome_summary_v1() as welcome'))[0].welcome;
    assert.deepEqual(result,(await query('select public.test_legacy_welcome_summary() as welcome'))[0].welcome,'optimized Welcome matches pre-change SQL');
    const rows = async (sql, params = []) => query(sql, params);
    const [reqs, offers, logs, reqLogs, apps, candidates, links] = await Promise.all([
      rows('select * from public.requisitions'), rows('select * from public.offers'), rows('select * from public.recruitment_logs'),
      rows('select * from public.requisition_logs'), rows('select * from public.candidate_applications'), rows('select * from public.candidates'), rows('select * from public.document_groups')
    ]);
    const asDate = value => value instanceof Date ? value.toISOString().slice(0,10) : value;
    const normalizedOffers=offers.map(o=>({...o,accepted_date:asDate(o.accepted_date)}));
    const normalizedReqLogs=reqLogs.map(l=>({...l,log_date:asDate(l.log_date)}));
    const normalizedReqs=reqs.map(r=>({...r,pr_approved_date:asDate(r.pr_approved_date)}));
    const requisitions = normalizedReqs.map(r => ({ ...r, open_headcount: Math.max(r.head_count-normalizedOffers.filter(o=>o.doc_id===r.doc_id&&o.accepted_date&&o.start_confirmation!=='did_not_start').length,0) }));
    const candidatesEnriched = apps.flatMap(a => {
      const c=candidates.find(x=>x.candidate_id===a.candidate_id); if(!c) return [];
      const reqIds=new Set(links.filter(x=>x.group_id===a.group_id).map(x=>x.doc_id));
      const contextReqs=reqs.filter(r=>reqIds.has(r.doc_id));
      const rank={'Phone Screen':1,'HR Interview':2,'Line Interview':3,'Test':4,'Reference Check':5,'Offer':6};
      const latest=logs.filter(l=>l.application_id===a.application_id&&l.superseded_at==null&&l.superseded_by_stage_instance_id==null)
        .sort((x,y)=>(rank[y.recruitment_process]??0)-(rank[x.recruitment_process]??0)||y.round-x.round||y.log_id-x.log_id)[0];
      const accepted=normalizedOffers.find(o=>o.application_id===a.application_id&&o.accepted_date&&o.start_confirmation!=='did_not_start');
      const unique=key=>[...new Set(contextReqs.map(r=>r[key]).filter(Boolean))];
      return [{...c,application_id:a.application_id,application_state:a.state,group_id:a.group_id,doc_group_id:null,
        site:unique('site').join(', ')||null,person_in_charge:unique('person_in_charge').join(', ')||null,
        latest_process:latest?.recruitment_process??'No activity',latest_result:latest?.result??null,accepted_date:accepted?.accepted_date??null}];
    });
    const profile=(await rows('select * from public.profiles where id=auth.uid()'))[0];
    const expected=buildLegacyWelcomeSummary(requisitions,candidatesEnriched,normalizedOffers,normalizedReqLogs,profile,today);
    assert.deepEqual(result,expected,`${expectedRole} SQL matches the actual buildWelcomeSummary TypeScript helper`);
    assert.equal((await query('select app_private.is_recruitment_reader() as allowed'))[0].allowed,true);
    await db.exec('reset role');
    return {result,expected,requisitions,offers:normalizedOffers};
  }

  const admin = await runFor('00000000-0000-0000-0000-000000000001','system_admin');
  const site = await runFor('00000000-0000-0000-0000-000000000002','site_recruiter');
  const viewer = await runFor('00000000-0000-0000-0000-000000000003','viewer');
  assert.equal(admin.result.responsibleVacancyTotal,9);
  assert.equal(admin.result.filledThisMonth,2);
  assert.equal(admin.result.filledResponsibleVacancyRatio,22);
  assert.equal(admin.result.filledResponsibleVacancyBucket,0);
  assert.equal(admin.result.openRequisitions,2);
  assert.equal(admin.result.offerFinalizationNeeded,2,'closed Offer-pass application remains in the legacy helper population');
  assert.equal(admin.result.activeCandidates,2,'application with accepted offer is removed by the legacy application key');
  assert.equal(admin.result.openVacancy,5);
  assert.equal(admin.offers.some(offer=>offer.offer_id===5),false,'offer without an authorized requisition is absent from the RLS-visible offer dataset');
  assert.equal(site.result.openRequisitions,1,'site recruiter sees only responsible site requisitions');
  assert.equal(site.result.activeCandidates,2,'site recruiter summary excludes foreign-site application and accepted offers');
  assert.equal(site.offers.some(offer=>offer.offer_id===3),false,'offer for an unreadable requisition is omitted from the HomeView-equivalent offers array');
  assert.equal(viewer.result.openRequisitions,1,'viewer responsibleRows still applies the profile site filter after RLS');

  const scope={headerSite:'KT2',headerPic:'',priorityOnly:false};
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,['00000000-0000-0000-0000-000000000001']); await db.exec('set role authenticated');
  const banner=(await query('select public.app_home_banner_summary_v1($1::jsonb) as result',[JSON.stringify(scope)]))[0].result;
  const scopedReqs=admin.requisitions.filter(r=>r.site==='KT2');
  const scopedDocIds=new Set(scopedReqs.map(r=>r.doc_id));
  const expectedBanner={monthlyFillCapacity:scopedReqs.filter(r=>r.status!=='cancel').reduce((s,r)=>s+r.head_count,0),monthlyFilledCount:admin.offers.filter(o=>scopedDocIds.has(o.doc_id)&&o.accepted_date?.startsWith(today.slice(0,7))).length};
  assert.deepEqual(banner,expectedBanner,'HomeView header banner aggregate matches its legacy month-start predicate, including later-in-month dates');
  const partialScope={headerSite:'kt',headerPic:'other',priorityOnly:false};
  const partialBanner=(await query('select public.app_home_banner_summary_v1($1::jsonb) as result',[JSON.stringify(partialScope)]))[0].result;
  const partialReqs=admin.requisitions.filter(r=>r.site.toLowerCase().includes('kt')&&r.person_in_charge.toLowerCase().includes('other'));
  const partialDocIds=new Set(partialReqs.map(r=>r.doc_id));
  assert.deepEqual(partialBanner,{monthlyFillCapacity:partialReqs.filter(r=>r.status!=='cancel').reduce((s,r)=>s+r.head_count,0),monthlyFilledCount:admin.offers.filter(o=>partialDocIds.has(o.doc_id)&&o.accepted_date?.startsWith(today.slice(0,7))).length},'HomeView filters site/owner with case-insensitive substring matching and counts matching offers on cancelled requisitions');
  const priorityScope={headerSite:'',headerPic:'',priorityOnly:true};
  const priorityBanner=(await query('select public.app_home_banner_summary_v1($1::jsonb) as result',[JSON.stringify(priorityScope)]))[0].result;
  assert.deepEqual(priorityBanner,{monthlyFillCapacity:6,monthlyFilledCount:3},'priority scope limits both data sets, but cancelled requisitions add accepted offers without adding capacity');
  await assert.rejects(query(`select public.app_home_banner_summary_v1('{"unknown":true}'::jsonb)`),/HOME_SCOPE_INVALID/);
  await db.exec('reset role');

  await db.query(`select set_config('request.jwt.claim.sub','',false)`);
  await assert.rejects(query('select public.app_home_welcome_summary_v1()'),/RECRUITMENT_READ_NOT_AUTHORIZED/);
  await assert.rejects(query(`select public.app_home_banner_summary_v1('{}'::jsonb)`),/RECRUITMENT_READ_NOT_AUTHORIZED/);
  await db.exec('set role anon');
  await assert.rejects(query('select public.app_home_welcome_summary_v1()'),/permission denied/);
  await db.exec('reset role');
  console.log(JSON.stringify({ ok:true,today,admin:admin.result,siteRecruiter:site.result,viewer:viewer.result,banner:expectedBanner }));
}

main().catch(error => { console.error(error); process.exitCode=1; }).finally(() => db.close());
