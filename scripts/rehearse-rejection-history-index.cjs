// Disposable PGlite planner regression for the historical-assignment application_id index.
// Uses no production database, forced planner settings, or live data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require(path.join(process.env.TEMP,'recruitment-db-tools/node_modules/@electric-sql/pglite'));

async function main(){
  const root=path.resolve(__dirname,'..');
  const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261102123400_candidate_assignment_application_history_index.sql'),'utf8');
  assert.match(migration,/create index if not exists idx_candidate_application_assignments_application_id\s+on public\.candidate_application_assignments\(application_id\);/i);
  assert.doesNotMatch(migration,/where\s+ended_at\s+is\s+null/i,'history index must cover ended assignments as well as the current assignment');
  const db=new PGlite();
  await db.exec(`
    create role authenticated;
    create schema app_private;
    grant usage on schema app_private to authenticated;
    create function app_private.can_read_application(uuid) returns boolean language sql stable as $$ select true $$;
    create table public.candidate_application_assignments(
      assignment_id bigint primary key,application_id uuid not null,ended_at timestamptz
    );
    create unique index candidate_application_current_assignment on public.candidate_application_assignments(application_id) where ended_at is null;
    alter table public.candidate_application_assignments enable row level security;
    create policy readable_assignments on public.candidate_application_assignments for select to authenticated using (app_private.can_read_application(application_id));
    grant select on public.candidate_application_assignments to authenticated;
    insert into public.candidate_application_assignments(assignment_id,application_id,ended_at)
    select n,('10000000-0000-0000-0000-'||lpad(((n-1)/10+1)::text,12,'0'))::uuid,
      case when n%10=0 then null else '2026-01-01T00:00:00Z'::timestamptz end
    from generate_series(1,20000) n;
    analyze public.candidate_application_assignments;
  `);
  const query=`select exists(select 1 from public.candidate_application_assignments a where a.application_id='10000000-0000-0000-0000-000000000001'::uuid and app_private.can_read_application(a.application_id))`;
  const explain=async()=>{
    const plan=(await db.query(`explain (format json,costs true) ${query}`)).rows[0]['QUERY PLAN'][0].Plan;
    const nodes=[];const visit=n=>{nodes.push({type:n['Node Type'],index:n['Index Name']??null,relation:n['Relation Name']??null,cost:n['Total Cost'],rows:n['Plan Rows'],filter:n.Filter??null});for(const child of n.Plans??[])visit(child)};visit(plan);
    return nodes;
  };
  await db.exec('set role authenticated');
  const before=await explain();
  assert(before.some(n=>n.type==='Seq Scan'&&n.relation==='candidate_application_assignments'),'historical lookup scans before the full-history index');
  await db.exec('reset role');
  await db.exec(migration);
  await db.exec('analyze public.candidate_application_assignments; set role authenticated');
  const after=await explain();
  assert(after.some(n=>n.index==='idx_candidate_application_assignments_application_id'),'planner uses the new application_id index for historical assignment existence');
  assert(!after.some(n=>n.index==='candidate_application_current_assignment'),'partial current-assignment index alone cannot cover the historical lookup');
  const output={status:'pass',rows:20000,distinct_applications:2000,query:'EXISTS by application_id with RLS helper',planner_settings:'default',before,after,limitations:'PGlite structural plan fixture; not production latency or native PostgreSQL RLS cost evidence.'};
  process.stdout.write(JSON.stringify(output,null,2)+'\n');
  await db.close();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
