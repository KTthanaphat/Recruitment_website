require('./register-typescript.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const r=require('../../src/lib/requisition-action-receipt.ts');
const lists=require('../../src/lib/recruitment-list.ts');
const row={doc_id:'R1',site:'KT1',person_in_charge:'Alice',status:'ongoing',head_count:2,updated_at:'2026-11-04T01:00:00Z',is_priority:false};
const receipt=(extra={})=>({version:1,request_id:'req',operation:'app_insert_requisition_log',previous_doc_id:'R1',doc_id:'R1',requisition:{...row,status:'cancel',updated_at:'2026-11-04T02:00:00Z'},updated_at:'2026-11-04T02:00:00Z',removed:false,source_scope:row,source_groups:['G1'],groups:['G1'],status_log:{log_id:2,doc_id:'R1',status:'cancel'},changed_fields:['status'],effects:['records','counts','summary'],...extra});
test('receipt updates visible base fields while preserving enrichment and auth isolation',()=>{
 const c={},s='a';r.publishRequisitionReceipt(c,s,receipt());
 assert.equal(r.patchRequisitionRows(c,s,[{...row,candidate_count:8}],{entity:'requisitions'})[0].status,'cancel');
 assert.equal(r.patchRequisitionRows(c,s,[{...row,candidate_count:8}],{entity:'requisitions'})[0].candidate_count,8);
 assert.equal(r.patchRequisitionRows(c,'b',[row],{entity:'requisitions'})[0].status,'ongoing');
 assert.equal(r.patchRequisitionRows({},s,[row],{entity:'requisitions'})[0].status,'ongoing');
});
test('server-final status wins over submitted status and known filter removal is immediate',()=>{
 const c={};r.publishRequisitionReceipt(c,'a',receipt({requisition:{...row,status:'filled',updated_at:'2026-11-04T02:00:00Z'}}));
 assert.equal(r.patchRequisitionRows(c,'a',[row],{entity:'requisitions'})[0].status,'filled');
 assert.deepEqual(r.patchRequisitionRows(c,'a',[row],{entity:'requisitions',filters:{status:'ongoing'}}),[]);
});
test('renames update linked records and removal markers disclose no saved fields',()=>{
 const data={requisitions:[row],requisition_logs:[{log_id:1,doc_id:'R1'}],document_groups:[{doc_id:'R1'}],offers:[{doc_id:'R1'}]};
 const renamed=r.applyRequisitionReceipt(data,receipt({doc_id:'R2',requisition:{...row,doc_id:'R2'}}));
 assert.equal(renamed.document_groups[0].doc_id,'R2');assert.equal(renamed.offers[0].doc_id,'R2');
 assert.deepEqual(r.applyRequisitionReceipt(data,receipt({removed:true,requisition:null})).requisitions,[]);
});
test('old reads and old receipts cannot overwrite a newer commit',()=>{
 const c={};r.publishRequisitionReceipt(c,'a',receipt());
 assert.equal(r.publishRequisitionReceipt(c,'a',receipt({updated_at:row.updated_at,requisition:row})),false);
 assert.equal(r.patchRequisitionRows(c,'a',[row],{entity:'requisitions'},0)[0].status,'cancel');
 const newer={...row,status:'filled',updated_at:'2026-11-04T03:00:00Z'};
 assert.equal(r.patchRequisitionRows(c,'a',[newer],{entity:'requisitions'},0)[0].status,'filled');
});
test('detail is patched without erasing history and successful reconciliation clears updating',()=>{
 const c={};r.publishRequisitionReceipt(c,'a',receipt());
 const detail={status:'ready',requisition:row,history:[{log_id:1,doc_id:'R1'}]};
 const patched=r.patchRequisitionDetail(c,'a',detail);assert.equal(patched.requisition.status,'cancel');assert.equal(patched.history.length,2);
 assert.equal(patched.updating,true);
 const fresh={...detail,requisition:receipt().requisition,history:[receipt().status_log]};assert.equal(r.patchRequisitionDetail(c,'a',fresh).updating,undefined);
});
test('affected query matching respects old/new headers, exact ids and priority dependencies',()=>{
 const change=receipt({requisition:{...receipt().requisition,site:'KT2'}});
 assert(r.requisitionQueryAffected({entity:'requisitions',filters:{headerSite:'KT1'}},change));
 assert(r.requisitionQueryAffected({entity:'requisitions',filters:{headerSite:'KT2'}},change));
 assert(!r.requisitionQueryAffected({entity:'requisitions',filters:{headerSite:'KT3'}},change));
 assert(!r.requisitionQueryAffected({entity:'pipeline_stage',filters:{groupId:'G2'}},change));
 const priority=receipt({operation:'app_set_requisition_priority_v1'});
 assert(!r.requisitionQueryAffected({entity:'pipeline_stage'},priority));
 assert(r.requisitionQueryAffected({entity:'pipeline_stage',filters:{priorityOnly:true}},priority));
});
test('batched invalidation notifies each affected records/count subscriber once without unrelated scope',()=>{
 const c={},events=[],q={accessScope:'a',entity:'requisitions',filters:{docId:'R1'}};
 const off=[lists.subscribeRecruitmentQuery(c,q,()=>events.push('records')),lists.subscribeRecruitmentQuery(c,q,()=>events.push('count'),'count'),lists.subscribeRecruitmentQuery(c,{...q,filters:{docId:'R2'}},()=>events.push('other')),lists.subscribeRecruitmentQuery(c,{...q,accessScope:'b'},()=>events.push('scope'))];
 lists.invalidateRequisitionRecruitmentLists(c,'a',[receipt(),receipt()]);assert.deepEqual(events,['records','count']);off.forEach(fn=>fn());
});
test('duplicate requisition saves are blocked and unrelated records remain writable',async()=>{
 let finish;const gate=new Promise(resolve=>finish=resolve);
 const c={rpc:async(_,args)=>{await gate;const p=args.payload;return {data:{ok:true,action_result:receipt({request_id:p.request_id,operation:p.operation,doc_id:p.payload.doc_id,requisition:{...row,doc_id:p.payload.doc_id}})},error:null};}};
 const first=r.performRequisitionAction(c,'a','app_insert_requisition_log',{doc_id:'R1'});
 await assert.rejects(r.performRequisitionAction(c,'a','app_insert_requisition_log',{doc_id:'R1'}),/already saving/);
 const other=r.performRequisitionAction(c,'a','app_insert_requisition_log',{doc_id:'R2'});finish();await Promise.all([first,other]);
});
test('network uncertainty reconciles before permitting another write and never retries automatically',async()=>{
 let calls=0;const c={rpc:async()=>{calls++;throw new Error('connection dropped');},from:()=>({select:()=>({in:async()=>({data:[row],error:null})})})};
 await assert.rejects(r.performRequisitionAction(c,'a','app_insert_requisition_log',{doc_id:'R1'}),/connection dropped/);
 await assert.rejects(r.performRequisitionAction(c,'a','app_insert_requisition_log',{doc_id:'R1'}),/reload and review/);assert.equal(calls,1);
 r.acknowledgeRequisitionReconciliation(c,'a','R1');
 await assert.rejects(r.performRequisitionAction(c,'a','app_insert_requisition_log',{doc_id:'R1'}),/connection dropped/);assert.equal(calls,2);
});
test('unsupported operations and unverified save responses fail closed',async()=>{
 const c={rpc:async()=>({data:{ok:true},error:null})};
 await assert.rejects(r.performRequisitionAction(c,'a','app_delete_recruitment_record',{doc_id:'R1'}),/Unsupported/);
 await assert.rejects(r.performRequisitionAction(c,'a','app_insert_requisition_log',{doc_id:'R1'}),/could not be verified/);
});

test('two renames cannot resurrect an original identity from a pre-save read',()=>{
 const c={};r.publishRequisitionReceipt(c,'a',receipt({doc_id:'R2',previous_doc_id:'R1',requisition:{...row,doc_id:'R2',updated_at:'2026-11-04T02:00:00Z'}}));
 r.publishRequisitionReceipt(c,'a',receipt({doc_id:'R3',previous_doc_id:'R2',updated_at:'2026-11-04T03:00:00Z',requisition:{...row,doc_id:'R3',updated_at:'2026-11-04T03:00:00Z'}}));
 assert.equal(r.patchRequisitionRows(c,'a',[row],{entity:'requisitions'},0)[0].doc_id,'R3');
});
test('creation is shown in a loaded matching page before reconciliation without changing exact counts',()=>{
 const c={};r.publishRequisitionReceipt(c,'a',receipt({operation:'app_upsert_requisition',source_scope:null,status_log:null}));
 assert.equal(r.patchRequisitionRows(c,'a',[],{entity:'requisitions'},0)[0].doc_id,'R1');
 assert.deepEqual(r.patchRequisitionRows(c,'a',[],{entity:'requisitions',filters:{headerSite:'KT2'}},0),[]);
});

test('unknown writes require a fresh exact detail read rather than the warm cache',async()=>{
 const Module=require('node:module'),path=require('node:path'),original=Module._resolveFilename;
 Module._resolveFilename=function(name,...args){return original.call(this,name.startsWith('@/')?path.join(__dirname,'../../src',name.slice(2)):name,...args);};
 let load;try{load=require('../../src/lib/requisition-detail-loader.ts').loadScopedRequisitionDetail;}finally{Module._resolveFilename=original;}
 let current={...row},reads=0;
 const client={auth:{getSession:async()=>({data:{session:{user:{id:'user'}}},error:null})},rpc:async()=>{throw new Error('network lost');},from:(table)=>{
  let query;query=new Proxy({}, {get:(_,key)=>key==='then'?(resolve,reject)=>{if(table==='requisitions')reads++;return Promise.resolve({data:table==='requisitions'?[current]:[],count:table==='requisitions'?1:0,error:null}).then(resolve,reject);}:()=>query});return query;
 }};
 const input={docId:'R1',accessScope:{profileId:'user',key:'scope'}};
 assert.equal((await load(client,input)).status,'ready');assert.equal(reads,1);
 await assert.rejects(r.performRequisitionAction(client,'scope','app_insert_requisition_log',{doc_id:'R1'}),/network lost/);
 current={...row,status:'cancel',updated_at:'2026-11-04T03:00:00Z'};
 const fresh=await load(client,input);assert.equal(reads,2);assert.equal(fresh.requisition.status,'cancel');assert.equal(r.requisitionNeedsReconciliation(client,'scope','R1'),false);
});
