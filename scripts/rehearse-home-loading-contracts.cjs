// Synthetic contract checks only; no server/database connection or HR payload output.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),ts=require(path.join(root,'node_modules/typescript'));
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,'src',request.slice(2)):request,parent,...args)};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpile(fs.readFileSync(f,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),f);
const {loadPipelineSummary,clearPipelineSummaryCache}=require('../src/lib/pipeline-summary-loader.ts');
const {loadCandidateDetail}=require('../src/lib/candidate-detail-loader.ts');
const {emptyDashboardData}=require('../src/lib/data.ts');
const page=items=>({items,has_more:false,has_more_before:false,next_cursor:null,previous_cursor:null,total_count:null});
async function main(){
  const calls=[];
  const summary={as_of:'2026-11-03',recent_since:'2026-10-27',active:0,aging:0,failed:0,passed_offer:0,no_activity:0,by_stage:[]};
  const client={rpc:async(name,args)=>{calls.push({name,args});assert.deepEqual(Object.keys(args.p_scope).sort(),['headerPic','headerSite','priorityOnly']);return {data:summary,error:null}}};
  for(const scope of [{headerSite:'',headerPic:'',priorityOnly:false},{headerSite:'KT1',headerPic:'Rina',priorityOnly:true}]){
    clearPipelineSummaryCache();
    await loadPipelineSummary(client,'synthetic',{scope:{...scope,groupId:'must-not-leak',boardFilter:'aging'},groupId:'GROUP-1',asOf:'2026-11-03'});
    await loadPipelineSummary(client,'synthetic',{scope:{...scope,groupId:'different-extra'},groupId:'GROUP-1',asOf:'2026-11-03'});
    assert.equal(calls.at(-1).args.p_group_id,'GROUP-1');assert.deepEqual(calls.at(-1).args.p_scope,scope);
  }
  assert.equal(calls.length,2,'normalized scope shares the cache, extra list keys are never sent');
  for(const scenario of [{n:0},{n:1},{n:201},{n:201,duplicate:true},{n:201,incomplete:true}]){
    const app={application_id:'app-1',candidate_id:'candidate-1',group_id:'group-1',state:'active'};
    const checkRows=Array.from({length:scenario.n},(_,i)=>({check_id:'check-'+i,application_id:app.application_id}));
    if(scenario.duplicate)checkRows[200].check_id=checkRows[0].check_id;
    const tables={candidate_applications:[app],position_groups:[{group_id:'group-1'}],candidate_reference_checks:checkRows};
    const orders=[];
    const client={auth:{getSession:async()=>({data:{session:{user:{id:'profile-1'}}},error:null})},rpc:async(name,args)=>{
      if(name==='app_candidate_profile_detail_v1')return {data:{candidate:{candidate_id:'candidate-1'},capabilities:{can_read_note:false}},error:null};
      if(name==='app_recruitment_list_count_v1')return {data:args.p_entity==='candidate_applications'?1:0,error:null};
      return {data:page(args.p_entity==='candidate_applications'?[app]:[]),error:null};
    },from(table){let first=0,last=199,single=false;const q={select(){return q},eq(){return q},in(){return q},order(column){orders.push({table,column});if(table==='candidate_reference_checks')assert.equal(column,'check_id');return q},range(a,b){first=a;last=b;return q},maybeSingle(){single=true;return q},then(ok,bad){let rows=tables[table]??[];const total=rows.length;rows=rows.slice(first,last+1);if(scenario.incomplete&&table==='candidate_reference_checks'&&first===200)rows=[];return Promise.resolve({data:single?rows[0]:rows,error:null,count:total}).then(ok,bad)}};return q}};
    const request=loadCandidateDetail(client,{profileId:'profile-1',key:'synthetic'},'candidate-1','app-1',emptyDashboardData);
    if(scenario.duplicate)await assert.rejects(request,/Duplicate or invalid reference checks/);
    else if(scenario.incomplete)await assert.rejects(request,/Incomplete reference checks/);
    else assert.equal((await request).candidate_reference_checks.length,scenario.n);
    assert.ok(orders.some(row=>row.table==='candidate_reference_checks'));
  }
  console.log('Pipeline scope normalization/cache and candidate reference checks (0, 1, 201 rows, duplicate and incomplete pages) passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1});
