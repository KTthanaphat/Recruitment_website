require('./register-typescript.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {loadCachedScopedDetail,patchScopedCandidateDetail,invalidateScopedCandidateDetail}=require('../../src/lib/scoped-detail-cache.ts');
const client=()=>({auth:{getSession:async()=>({data:{session:{user:{id:'user-a'}}},error:null})}});
const identity={profileId:'user-a',key:'scope'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('canceling one detail lease preserves a shared active reader',async()=>{
 const db=client(),first=new AbortController();let finish,signal,calls=0;
 const load=inner=>{calls++;signal=inner;return new Promise(resolve=>finish=resolve);};
 const a=loadCachedScopedDetail(db,identity,'record',load,first.signal);const b=loadCachedScopedDetail(db,identity,'record',load);await tick();
 const rejected=assert.rejects(a,error=>error.name==='AbortError');first.abort();await rejected;assert.equal(signal.aborted,false);
 finish({saved:true});assert.deepEqual(await b,{saved:true});assert.equal(calls,1);
});
test('the final obsolete detail lease aborts its underlying queued reads',async()=>{
 const db=client(),controller=new AbortController();let signal;
 const result=loadCachedScopedDetail(db,identity,'obsolete',inner=>{signal=inner;return new Promise((resolve,reject)=>inner.addEventListener('abort',()=>reject(new Error('underlying canceled'))));},controller.signal);
 await tick();const rejected=assert.rejects(result,error=>error.name==='AbortError');controller.abort();await rejected;assert.equal(signal.aborted,true);
});
test('warm candidate patching and invalidation preserve unrelated detail caches',async()=>{
 const db=client(),key=JSON.stringify(['candidate','CAN-1','app-1']),other=JSON.stringify(['candidate','CAN-2','app-2']);let reads=0;
 const load=async()=>{reads++;return {value:1};};await loadCachedScopedDetail(db,identity,key,load);await loadCachedScopedDetail(db,identity,other,load);
 patchScopedCandidateDetail(db,'scope','CAN-1',value=>({...value,value:2}));assert.deepEqual(await loadCachedScopedDetail(db,identity,key,load),{value:2});
 invalidateScopedCandidateDetail(db,'scope',new Set(['CAN-1']));await loadCachedScopedDetail(db,identity,key,load);await loadCachedScopedDetail(db,identity,other,load);assert.equal(reads,3);
});
