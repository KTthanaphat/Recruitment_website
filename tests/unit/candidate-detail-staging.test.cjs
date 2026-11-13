const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),Module=require("node:module");
const root=path.resolve(__dirname,"../.."),ts=require(path.join(root,"node_modules/typescript"));
const resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...args){return resolve.call(this,request.startsWith("@/")?path.join(root,"src",request.slice(2)):request,parent,...args)};
require.extensions[".ts"]=(m,f)=>m._compile(ts.transpile(fs.readFileSync(f,"utf8"),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}),f);
const {loadCandidateDetail,loadCandidateDetailShell}=require("../../src/lib/candidate-detail-loader.ts");
const {emptyDashboardData}=require("../../src/lib/data.ts");
const page=items=>({items,has_more:false,has_more_before:false,next_cursor:null,previous_cursor:null,total_count:null});
function fixture({masked=false,incomplete=false}={}){
 let releaseMetadata;const metadata=new Promise(resolve=>{releaseMetadata=resolve});const calls=[];
 const app={application_id:"application-1",candidate_id:"candidate-1",group_id:"group-1",state:"active",version:4,created_at:"2026-01-01",updated_at:"2026-01-01"};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:"profile-1"}}},error:null})},
 rpc(name,args){calls.push({name,entity:args?.p_entity});const result=(async()=>{
   if(name==="app_candidate_profile_detail_v1")return {data:masked?{candidate:null,masked:{candidate_id:"candidate-1"},capabilities:null}:{candidate:{candidate_id:"candidate-1",name:"synthetic"},capabilities:{can_read_note:false}},error:null};
   if(name==="app_recruitment_list_count_v1")return {data:args.p_entity==="candidate_applications"?(incomplete?2:1):0,error:null};
   return {data:page(args.p_entity==="candidate_applications"?[app]:[]),error:null};
 })();return Object.assign(result,{abortSignal(){return result}})},
 from(table){let single=false,first=0,last=199;const q={select(){return q},eq(){return q},in(){return q},abortSignal(){return q},order(){return q},range(a,b){first=a;last=b;return q},maybeSingle(){single=true;return q},then(ok,bad){
   const rows=table==="candidate_applications"?[app]:table==="position_groups"?[{group_id:"group-1"}]:[];
   const result=()=>({data:single?rows[0]:rows.slice(first,last+1),error:null,count:rows.length});
   return (single?metadata.then(result):Promise.resolve(result())).then(ok,bad);
 }};return q}};
 return {client,calls,releaseMetadata};
}
test("verified profile and complete choices render while selected metadata waits",async()=>{
 const {client,calls,releaseMetadata}=fixture(),identity={profileId:"profile-1",key:"test"};
 const shell=loadCandidateDetailShell(client,identity,"candidate-1",emptyDashboardData);
 let complete=false;const full=loadCandidateDetail(client,identity,"candidate-1","application-1",emptyDashboardData).then(x=>{complete=true;return x});
 const partial=await shell;assert.equal(partial.candidates[0].name,"synthetic");assert.equal(partial.candidate_applications.length,1);
 assert.deepEqual(partial.candidate_notes,[]);assert.equal(complete,false);
 assert.equal(calls.filter(x=>x.name==="app_candidate_profile_detail_v1").length,1);
 assert.equal(calls.filter(x=>x.name==="app_recruitment_list_count_v1"&&x.entity==="candidate_applications").length,1);
 releaseMetadata();const data=await full;assert.equal(data.candidate_applications[0].version,4);
});
test("masked profiles do not load application choices",async()=>{
 const {client,calls}=fixture({masked:true});const result=await loadCandidateDetailShell(client,{profileId:"profile-1",key:"masked"},"candidate-1",emptyDashboardData);
 assert.equal(result.candidates.length,0);assert.equal(result.masked_candidate_pool.length,1);
 assert.equal(calls.filter(x=>x.entity==="candidate_applications").length,0);
});
test("incomplete application choices do not produce a shell",async()=>{
 const {client}=fixture({incomplete:true});await assert.rejects(loadCandidateDetailShell(client,{profileId:"profile-1",key:"incomplete"},"candidate-1",emptyDashboardData),/Incomplete candidate applications/);
});
