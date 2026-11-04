// Executes only inside the disposable full-schema RLS rehearsal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
module.exports = async function(db, root) {
  await db.exec(`reset role;
    insert into auth.users(id,email,raw_user_meta_data) values
      ('99999999-9999-4999-8999-999999999998','sourcing-admin@example.test','{"nickname":"Sourcing Admin"}'),
      ('99999999-9999-4999-8999-999999999997','sourcing-site@example.test','{"nickname":"Sourcing Site"}');
    update public.profiles set role='admin_recruiter',site='TEST' where id='99999999-9999-4999-8999-999999999998';
    update public.profiles set role='site_recruiter',site='TEST',nickname='Sourcing Site' where id='99999999-9999-4999-8999-999999999997';
    update public.requisitions set person_in_charge='Sourcing Site',is_priority=true where doc_id='TEST-R1';
    update public.requisitions set pr_approved_date=current_date-800 where doc_id in ('TEST-R1','TEST-R2');
    insert into public.document_groups(doc_group_id,doc_id,group_id,group_position) values('SOURCING-SHARED','TEST-R2','TEST-G1','Shared Engineer');
    update public.requisitions set status='cancel' where doc_id='TEST-R2';
    insert into public.requisition_logs(doc_id,log_date,status) values('TEST-R2',current_date-1,'cancel');
    update public.position_groups set channel_fb=true where group_id in ('TEST-G1','TEST-G2');
    insert into public.sourcing_weekly_updates(group_id,week_start,channel_fb,applicants_fb)
      select 'TEST-G1',current_date-((extract(dow from current_date)::integer+1)%7),true,0 on conflict do nothing;
    insert into public.sourcing_weekly_updates(group_id,week_start,channel_fb,applicants_fb)
      select 'TEST-G1',current_date-((extract(dow from current_date)::integer+1)%7)+2,true,99 on conflict do nothing;
    insert into public.sourcing_weekly_updates(group_id,week_start,channel_fb,applicants_fb)
      select 'TEST-G1',current_date-((extract(dow from current_date)::integer+1)%7)-7,true,null on conflict do nothing;`);
  const profiles = (await db.query("select id,role from public.profiles where role in ('system_admin','admin_recruiter','site_recruiter','viewer') order by role,id")).rows;
  const today = (await db.query("select (current_date-((extract(dow from current_date)::integer+1)%7))::text as selected_week")).rows[0].selected_week;
  const groupKeys = ['group_id','group_position','sites','owners','doc_ids','open_headcount',...['fb','jobthai','jobtopgun','jobdb','jobbkk','linkedin','walkin','referral','others'].map(c=>'channel_'+c),'latest_update'];
  function project(page) { return {...page,items:page.items.map(row=>({...row,group:Object.fromEntries(groupKeys.map(key=>[key,row.group[key]]))}))}; }
  async function call(name,args) { return (await db.query(`select public.${name}($1,$2,$3,$4,$5,$6,$7,$8,$9) page`,args)).rows[0].page; }
  let cases=0;
  for (const profile of profiles) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[profile.id]); await db.exec('set role authenticated');
    for (const surface of ['board','history']) for (const sort of ['group','position','week','status','applicants','saved']) for (const direction of ['asc','desc']) {
      const filters={surface,weekStart:today,groupId:'TEST-G1',from:new Date(Date.parse(today)-200*86400000).toISOString().slice(0,10)};
      const args=['',JSON.stringify(filters),sort,direction,25,null,null,false,false];
      const legacy=await call('app_recruitment_sourcing_page_v1',args);
      const current=await call('app_recruitment_sourcing_records_page_v1',args);
      assert.deepEqual(current,project(legacy),profile.role+' '+surface+' '+sort+' '+direction);
      const count=(await db.query("select public.app_recruitment_list_count_v1('sourcing_records','',$1) n",[JSON.stringify(filters)])).rows[0].n;
      const legacyCount=await call('app_recruitment_sourcing_page_v1',['',JSON.stringify(filters),sort,direction,0,null,null,false,true]);
      assert.equal(count,legacyCount.total_count);
      if (current.next_cursor) {
        const nextArgs=[...args];nextArgs[5]=JSON.stringify(current.next_cursor.value);nextArgs[6]=current.next_cursor.id;
        const next=await call('app_recruitment_sourcing_records_page_v1',nextArgs);
        assert.deepEqual(next,project(await call('app_recruitment_sourcing_page_v1',nextArgs)));
        const back=[...nextArgs];back[5]=JSON.stringify(next.previous_cursor.value);back[6]=next.previous_cursor.id;back[7]=true;
        assert.deepEqual(await call('app_recruitment_sourcing_records_page_v1',back),current);
      }
      cases++;
    }
    for (const limit of [25,50,100]) {
      const filters=JSON.stringify({surface:'history',groupId:'TEST-G1'});
      const page=await call('app_recruitment_sourcing_records_page_v1',['',filters,'week','desc',limit,null,null,false,false]);
      assert(page.items.length<=limit);
    }
    await assert.rejects(call('app_recruitment_sourcing_records_page_v1',['','{"unsupported":true}','week','desc',25,null,null,false,false]),/FILTER_INVALID/);
    await db.exec('reset role');
  }
  // Profile-specific scope, search aliases, bounded editor windows and empty lifecycles.
  for (const profile of profiles) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[profile.id]); await db.exec('set role authenticated');
    for (const filters of [
      {surface:'history',groupId:'TEST-G1',from:today,to:today},
      {surface:'history',groupId:'TEST-G1',headerSite:'TEST',headerPic:'Sourcing Site',priorityOnly:true,from:today,to:today},
      {surface:'history',groupId:'TEST-G1',headerSite:'NO-SITE'},
      {surface:'history',groupId:'UNKNOWN'},
      {surface:'board',weekStart:new Date(Date.parse(today)-86400000).toISOString().slice(0,10)},
      {surface:'board',weekStart:'2099-01-03'}
    ]) {
      const args=['',JSON.stringify(filters),'week','desc',25,null,null,false,false];
      assert.deepEqual(await call('app_recruitment_sourcing_records_page_v1',args),project(await call('app_recruitment_sourcing_page_v1',args)));
    }
    await db.exec('reset role');
  }
  await db.query("select set_config('request.jwt.claim.sub','',false)");await db.exec('set role authenticated');
  await assert.rejects(call('app_recruitment_sourcing_records_page_v1',['','{}','week','desc',25,null,null,false,false]),/READ_NOT_AUTHORIZED/);
  await db.exec('reset role');
  const source=fs.readFileSync(path.join(root,'supabase/schemas/60_recruitment_list.sql'),'utf8');
  const functionText=source.split('create or replace function public.app_recruitment_sourcing_records_page_v1(')[1].split('create or replace function ')[0];
  assert.doesNotMatch(functionText,/app_recruitment_groups_page_v1|recruitment_logs|candidate_application_assignments|security definer/i);
  const migration=fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_sourcing_records_loading.sql'));
  const migrationText=fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8');
  assert(migrationText.includes('create or replace function public.app_recruitment_sourcing_records_page_v1('+functionText.trimEnd()),'migration matches canonical sourcing function and ACL');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[profiles.find(row=>row.role==='system_admin').id]);
  await db.exec('set role authenticated');
  let inner='with '+functionText.slice(functionText.indexOf('  with ')+7,functionText.indexOf('  return v_result;')).replace(/\s+into v_result(\s+from edges)/i,'$1');
  const values={p_search:"''",p_filters:`'{"surface":"board","weekStart":"${today}"}'::jsonb`,p_sort:"'status'",p_direction:"'asc'",p_limit:'50',p_cursor_value:'null::jsonb',p_cursor_id:'null::text',p_before:'false',p_count_only:'false',v_sort:"'status'",v_dir:"'asc'",v_surface:"'board'",v_week_start:`'${today}'::date`,v_cursor:'null::text',v_search:"''"};
  for (const [key,value] of Object.entries(values)) inner=inner.replace(new RegExp('\\b'+key+'\\b','g'),value);
  const plan=(await db.query('explain (analyze,buffers,format json) '+inner)).rows;
  fs.mkdirSync(path.join(root,'outputs/sourcing-records'),{recursive:true});
  fs.writeFileSync(path.join(root,'outputs/sourcing-records/fixture-plan.json'),JSON.stringify(plan,null,2));
  await db.exec('reset role');
  const measurements=[];
  for (const role of ['system_admin','admin_recruiter','site_recruiter']) {
    const actor=profiles.find(row=>row.role===role && (role!=='site_recruiter'||row.id==='99999999-9999-4999-8999-999999999997'));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor.id]); await db.exec('set role authenticated');
    for (const view of ['board','selected-week']) {
      const filters=view==='board'?{surface:'board',weekStart:today}:{surface:'history',groupId:'TEST-G1',from:today,to:today};
      const times=[];
      for(let n=0;n<30;n++) {
        const started=performance.now();
        await call('app_recruitment_sourcing_records_page_v1',['',JSON.stringify(filters),'week','desc',view==='board'?50:25,null,null,false,false]);
        times.push(performance.now()-started);
      }
      times.sort((a,b)=>a-b);measurements.push({role,view,observations:times.length,median_ms:times[14],p95_ms:times[28]});
    }
    await db.exec('reset role');
  }
  fs.writeFileSync(path.join(root,'outputs/sourcing-records/fixture-measurements.json'),JSON.stringify({environment:'disposable PGlite fixture; not production or a cold-cache benchmark',measurements},null,2));
  await db.exec('set role anon');
  await assert.rejects(db.query("select public.app_recruitment_sourcing_records_page_v1('','{}','week','desc',25,null,null,false,false)"),/permission denied/);
  await db.exec('reset role');
  console.log(JSON.stringify({kind:'sourcing-records-full-schema-rls',profiles:profiles.map(row=>row.role),parity_cases:cases,legacy_interfaces_retained:true}));
};
