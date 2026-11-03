require('./register-typescript.cjs');const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadPipelineSummary,clearPipelineSummaryCache}=require('../../src/lib/pipeline-summary-loader.ts');
const summary={as_of:'2026-11-03',recent_since:'2026-10-27',active:0,aging:0,failed:0,passed_offer:0,no_activity:0,by_stage:[]};
const request={scope:{headerSite:'KT1',headerPic:'R',priorityOnly:false,groupId:'invalid-scope'},groupId:'GRP-1',asOf:'2026-11-03'};
test('summary caches normalize typed scope and remain isolated between client instances',async()=>{
 clearPipelineSummaryCache();const calls=[];const make=()=>({rpc:async(name,payload)=>{calls.push({name,payload});return {data:summary,error:null};}});const a=make(),b=make();
 await Promise.all([loadPipelineSummary(a,'scope',request),loadPipelineSummary(a,'scope',request)]);await loadPipelineSummary(b,'scope',request);assert.equal(calls.length,2);
 assert.deepEqual(calls[0].payload.p_scope,{headerSite:'KT1',headerPic:'R',priorityOnly:false});assert.equal(calls[0].payload.p_group_id,'GRP-1');
});
test('canceling an obsolete summary lease preserves its other active reader',async()=>{
 clearPipelineSummaryCache();let finish,calls=0;const controller=new AbortController(),client={rpc:()=>{calls++;return new Promise(resolve=>finish=resolve);}};
 const a=loadPipelineSummary(client,'scope',request,controller.signal);const b=loadPipelineSummary(client,'scope',request);await new Promise(resolve=>setImmediate(resolve));
 const rejected=assert.rejects(a,error=>error.name==='AbortError');controller.abort();await rejected;finish({data:summary,error:null});assert.deepEqual(await b,summary);assert.equal(calls,1);
});
