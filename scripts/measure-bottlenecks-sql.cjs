const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = async function measureBottlenecks(db, root) {
  const readMigration = name => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
  await db.exec(readMigration('20261104015609_reconcile_recruiter_read_authorization.sql'));
  const admin = '11111111-1111-1111-1111-111111111111';
  const recruiter = '22222222-2222-2222-2222-222222222222';
  await db.exec("update public.profiles set site='TEST',full_name='Benchmark Owner',nickname='Benchmark Owner' where id='"+recruiter+"'");
  await db.exec(
    "create temp table bottleneck_fixture_groups as select n,'PERF-G-'||n gid,'PERF-R-'||n doc,case when n%3=0 then 'TEST' else 'OTHER' end site from generate_series(1,228) n;"+
    "insert into public.position_groups(group_id,group_position) select gid,'Benchmark position' from bottleneck_fixture_groups;"+
    "insert into public.requisitions(doc_id,site,position,department,head_count,status,created_at,pr_approved_date,person_in_charge) "+
    "select doc,site,'Benchmark position','Ops',2,case when n%11=0 then 'cancel' when n%7=0 then 'filled' else 'ongoing' end,'2026-01-01','2026-01-01',case when n%2=0 then 'Benchmark Owner' else 'Other Owner' end from bottleneck_fixture_groups;"+
    "insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) select 'PERF-D-'||n,doc,gid,'Benchmark position' from bottleneck_fixture_groups;"+
    "create temp table bottleneck_fixture_apps as select a.n,'PERF-C-'||a.n cid,md5('perf-app-'||a.n)::uuid aid,md5('perf-assignment-'||a.n)::uuid assignment,g.gid,g.site from generate_series(1,1144) a(n) join bottleneck_fixture_groups g on g.n=1+(a.n-1)%228;"+
    "insert into public.candidates(candidate_id,name,home_site,channel,created_at,updated_at) select cid,'Benchmark candidate',site,case when n%3=0 then 'Referral' else 'LinkedIn' end,'2026-01-01','2026-01-01' from bottleneck_fixture_apps;"+
    "insert into public.candidate_applications(application_id,candidate_id,group_id,created_at) select aid,cid,gid,'2026-01-01' from bottleneck_fixture_apps;"+
    "insert into public.candidate_application_assignments(assignment_id,application_id,group_id,started_at) select assignment,aid,gid,'2026-01-01' from bottleneck_fixture_apps;"+
    "alter table public.recruitment_logs disable trigger user;"+
    "insert into public.recruitment_logs(candidate_id,application_id,entry_assignment_id,outcome_assignment_id,recruitment_process,round,log_date,result,outcome_date,outcome_recorded_at,estimated_action_date) "+
    "select cid,aid,assignment,case when done then assignment end,case r when 1 then 'Phone Screen' when 2 then 'HR Interview' else 'Line Interview' end,1,d,case when done then case when (n+r)%13=0 then 0 else 1 end end,case when done then d+2 end,case when done then (d+2)::timestamp end,d+7 "+
    "from bottleneck_fixture_apps cross join generate_series(1,3) r cross join lateral(select date '2026-08-15'+(n%40)+r*4 d, r<=2 or n%4=0 done) x where r<3 or n%5<3;"+
    "set constraints all immediate; alter table public.recruitment_logs enable trigger user; analyze;"
  );
  const cases = [
    { name: 'october', start: '2026-10-01', priorStart: '2026-09-01', priorEnd: '2026-09-30', dates: ['2026-10-07','2026-10-14','2026-10-21','2026-10-28','2026-10-31'], scope: {} },
    { name: 'ytd', start: '2026-01-01', priorStart: '2025-01-01', priorEnd: '2025-10-31', dates: ['2026-02-28','2026-04-30','2026-06-30','2026-08-31','2026-10-31'], scope: {} },
    { name: 'site-pic', start: '2026-10-01', priorStart: '2026-09-01', priorEnd: '2026-09-30', dates: ['2026-10-07','2026-10-14','2026-10-21','2026-10-28','2026-10-31'], scope: { headerSite: 'TEST', headerPic: 'Benchmark Owner' } }
  ];
  const samples = process.argv.includes("--bottlenecks-parity-only") ? 0 : 30;
  const end = '2026-10-31';
  const summary = 'public.app_dashboard_bottleneck_summary_v1';
  const queue = 'public.app_dashboard_bottleneck_queue_v1';
  const summaryCall = (item, trends) => ({
    sql: summary+'($1,$2,$3,$4,$5,$6,$7)',
    params: [item.start,end,trends?item.priorStart:null,trends?item.priorEnd:null,item.scope,'all',trends?item.dates:[]]
  });
  const queueCall = (item, status, cursor) => ({
    sql: queue+'($1,$2,$3,null,$4,null,\'\',$5,$6)',
    params: [end,item.scope,'all',status,cursor?.value??null,cursor?.id??null]
  });
  const query = async (call, explain = false) => (await db.query((explain?'explain (analyze, format json) ':'')+'select '+call.sql+' as value',call.params)).rows[0];
  const baseline = new Map();
  let failed = false;
  const selectedVersion = process.env.BOTTLENECK_BENCH_VERSION;
  assert.ok(!selectedVersion || ['legacy', 'candidate'].includes(selectedVersion), 'Invalid benchmark version');
  for (const version of selectedVersion ? [selectedVersion] : ['legacy', 'candidate']) {
    if (version==='candidate') await db.exec(readMigration('20261106032530_dashboard_report_loading.sql'));
    for (const [role, id] of [['system_admin', admin], ['site_recruiter', recruiter]]) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
      await db.exec(samples ? "set role authenticated; set statement_timeout='8s'" : "set role authenticated; set statement_timeout='30s'");
      for (const item of cases) {
        const current = await query(summaryCall(item,false)).catch(error=>{ if(error.code!=='57014')throw error; return null; });
        const status = current?.value.metrics.overdue ? 'overdue' : null;
        for (const [label,call] of [['current',summaryCall(item,false)],['full',summaryCall(item,true)],['queue',queueCall(item,version==='legacy'?status:'auto')]]) {
          const key = [role,item.name,label].join('/');
          const data = await query(call).catch(error=>{ if(error.code!=='57014')throw error; return null; });
          if(label==='queue' && data) {
            const value=data.value;
            if(version==='candidate') {
              assert.equal(value.resolvedStatus,status??'all');
              delete value.resolvedStatus;
            }
            if(value.hasMore && value.nextCursor) {
              const next=(await query(queueCall(item,version==='legacy'?status:'auto',value.nextCursor))).value;
              delete next.resolvedStatus;
              data.next=next;
            }
          }
          if(version==='legacy')baseline.set(key,data);
          const parity=version==='candidate'&&baseline.get(key)&&data ? JSON.stringify(data)===JSON.stringify(baseline.get(key)) : null;
          if(parity===false) failed=true;
          const times=[];
          let timeouts=0;
          for(let i=0;i<samples;i++){
            try{
              const result=await query(call,true);
              times.push(result['QUERY PLAN'][0]['Execution Time']);
            }catch(error){
              if(error.code!=='57014')throw error;
              timeouts++;
            }
          }
          times.sort((a,b)=>a-b);
          const quantile=p=>times.length?times[Math.ceil(times.length*p)-1]:null;
          console.log(JSON.stringify({version,role,scope:item.name,endpoint:label,samples,timeouts,medianMs:quantile(.5),p95Ms:quantile(.95),parity,digest:data?createHash('sha256').update(JSON.stringify(data)).digest('hex'):null}));
        }
      }
      await db.exec('reset role; reset statement_timeout');
    }
  }
  assert.equal(failed,false,'Matched report output and cursor parity');
};
