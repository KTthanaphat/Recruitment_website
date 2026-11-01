// Disposable PostgreSQL regression of installed legacy functions; never connects to a server.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { PGlite } = require(path.join(process.env.TEMP, 'recruitment-db-tools/node_modules/@electric-sql/pglite'));
const db = new PGlite();
const fixturePath = process.argv[2];
const migrationPath = process.argv[3];
async function main() {
  const definitions = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  await db.exec(`
    create schema app_private; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create function app_private.is_system_admin() returns boolean language sql as $$ select true $$;
    create function app_private.pipeline_business_date() returns date language sql as $$ select date '2026-10-26' $$;
    create function app_private.lock_pipeline_candidate(text) returns void language plpgsql as $$ begin null; end $$;
    create function app_private.assert_candidate_pipeline_open(text) returns void language plpgsql as $$ begin null; end $$;
    create table public.candidates(candidate_id text primary key, first_contact_date date, updated_at timestamptz, group_id text);
    create table public.recruitment_logs(
      log_id bigserial primary key,stage_instance_id uuid default gen_random_uuid(),candidate_id text,
      log_date date,recruitment_process text,round integer default 1,result smallint,
      interviewer text,remark text,estimated_action_date date,outcome_date date,outcome_interviewer text,
      outcome_remark text,outcome_recorded_at timestamptz,pending_edited_at timestamptz,pending_edited_by uuid,
      record_origin text default 'auto',superseded_at timestamptz,
      created_at timestamptz default now(),updated_at timestamptz default now(),
      failure_actor text,failure_main_reason_id uuid,failure_detail_reason_id uuid,failure_reason_snapshot jsonb);
    create function app_private.failure_reason_snapshot(text,uuid,uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
  `);
  for (const item of definitions) await db.exec(item.definition);
  await db.exec(`
    create trigger derive_date before insert or update on public.recruitment_logs
      for each row execute function app_private.derive_pipeline_pending_date();
    create trigger propagate_date after insert on public.recruitment_logs
      for each row execute function app_private.propagate_corrected_outcome_date();
    insert into public.candidates values('TEST-CAN',date '2026-10-10',now(),'TEST-GROUP');
    insert into public.recruitment_logs(candidate_id,log_date,recruitment_process,result,outcome_date)
      values('TEST-CAN','2026-10-10','Phone Screen',1,'2026-10-10');
    insert into public.recruitment_logs(candidate_id,log_date,recruitment_process,result,outcome_date)
      values('TEST-CAN','2026-10-10','HR Interview',1,'2026-10-10');
    insert into public.recruitment_logs(candidate_id,log_date,recruitment_process,result,outcome_date)
      values('TEST-CAN','2026-10-10','Line Interview',1,'2026-10-12');
    insert into public.recruitment_logs(candidate_id,log_date,recruitment_process,round,estimated_action_date)
      values('TEST-CAN','2026-10-12','Line Interview',2,'2026-10-16');
  `);
  const one = async sql => (await db.query(sql)).rows[0];
  const date = x => x instanceof Date ? x.toISOString().slice(0,10) : String(x).slice(0,10);
  assert.equal(date((await one("select log_date from recruitment_logs where round=2")).log_date),'2026-10-10');
  let pending = await one("select * from recruitment_logs where round=2");
  const complete = async (row, nextStage, nextRound, outcome) => {
    const payload={candidate_id:'TEST-CAN',stage_instance_id:row.stage_instance_id,expected_updated_at:row.updated_at,
      pending:{opened_date:date(row.log_date),estimated_action_date:row.estimated_action_date ? date(row.estimated_action_date) : null},
      outcome:{result:'pass',date:outcome},next_pending:{stage:nextStage,round:nextRound}};
    return db.query('select public.app_complete_pipeline_stage_v2($1::jsonb) result',[JSON.stringify(payload)]);
  };
  await assert.rejects(complete(pending,'Test',1,'2026-10-16'),/PIPELINE_DATE_ORDER/);
  console.log('Reproduced original bad date and blocked Pass.');
  const migration=fs.readFileSync(migrationPath,'utf8');
  await db.exec(migration);
  await db.exec(migration); // safe to replay; covers both installed and already-fixed definitions
  await db.exec("update recruitment_logs set log_date='2026-10-12' where recruitment_process='Line Interview' and round=2");
  pending=await one("select * from recruitment_logs where recruitment_process='Line Interview' and round=2");
  assert.equal(date(pending.log_date),'2026-10-12');
  await db.query('select public.app_update_pipeline_pending_v2($1::jsonb)',[JSON.stringify({
    candidate_id:'TEST-CAN',stage_instance_id:pending.stage_instance_id,expected_updated_at:pending.updated_at,
    pending:{opened_date:'2026-10-12',estimated_action_date:'2026-10-16',remark:'Updated successfully'}
  })]);
  await complete(pending,'Line Interview',3,'2026-10-16');
  let third=await one("select * from recruitment_logs where recruitment_process='Line Interview' and round=3");
  assert.equal(date(third.log_date),'2026-10-16');
  await complete(third,'Test',1,'2026-10-18');
  let test=await one("select * from recruitment_logs where recruitment_process='Test' and round=1");
  assert.equal(date(test.log_date),'2026-10-18');
  await complete(test,'Test',2,'2026-10-19');
  assert.equal(date((await one("select log_date from recruitment_logs where recruitment_process='Test' and round=2")).log_date),'2026-10-19');
  console.log('Pending edit, Line Interview rounds 2/3 Pass, next Test entry, and repeated Test all passed.');
  // Correction propagation must find later Line Interview rounds, too.
  await db.exec(`
    delete from recruitment_logs where recruitment_process='Test' or (recruitment_process='Line Interview' and round=3);
    update recruitment_logs set result=null,outcome_date=null where recruitment_process='Line Interview' and round=2;
    update recruitment_logs set superseded_at=now() where recruitment_process='Line Interview' and round=1;
    insert into recruitment_logs(candidate_id,log_date,recruitment_process,round,result,outcome_date,record_origin)
      values('TEST-CAN','2026-10-10','Line Interview',1,1,'2026-10-13','correction');
  `);
  assert.equal(date((await one("select log_date from recruitment_logs where recruitment_process='Line Interview' and round=2")).log_date),'2026-10-13');
  console.log('Outcome correction propagated to next Line Interview round. All assertions passed.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.close());
