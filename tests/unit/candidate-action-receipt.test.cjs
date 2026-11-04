require('./register-typescript.cjs');
const {test}=require('node:test'); const assert=require('node:assert/strict');
const {performCandidateAction,publishCandidateReceipt,patchCandidateRows,applyCandidateReceipt,acknowledgeCandidateReconciliation}=require('../../src/lib/candidate-action-receipt.ts');
const {subscribeRecruitmentQuery,recruitmentQueryRevision,invalidateCandidateRecruitmentLists}=require('../../src/lib/recruitment-list.ts');
const receipt=(extra={})=>({version:1,request_id:'test',operation:'app_complete_pipeline_stage_v2',candidate_id:'CAN-1',application_ids:['app-1'],profile:{candidate:{candidate_id:'CAN-1',name:'Saved name'},masked:null,capabilities:null},cards:[{candidate_id:'CAN-1',application_id:'app-1',group_id:'GRP-2',doc_ids:[],sites:['KT2'],person_in_charges:[],latest_process:'HR Interview',latest_result:null}],applications:[],history:[],assignments:[],notes:[],references:[],removed_applications:[],source_stages:['Phone Screen'],source_groups:['GRP-1'],groups:['GRP-2'],effects:['records'],...extra});
test('committed receipts remove source/filter membership and remain isolated by scope/client',()=>{
 const client={}, row={candidate_id:'CAN-1',application_id:'app-1',latest_process:'Phone Screen'}; publishCandidateReceipt(client,'user-a',receipt());
 assert.deepEqual(patchCandidateRows(client,'user-a',[row],{entity:'pipeline_stage',filters:{stage:'Phone Screen'}}),[]);
 assert.equal(patchCandidateRows(client,'user-a',[row],{entity:'candidate_applications'})[0].latest_process,'HR Interview');
 assert.deepEqual(patchCandidateRows(client,'user-b',[row],{entity:'pipeline_stage'}),[row]);
 assert.deepEqual(patchCandidateRows({},'user-a',[row],{entity:'pipeline_stage'}),[row]);
 assert.deepEqual(patchCandidateRows(client,'user-a',[row],{entity:'candidate_applications',search:'NO-MATCH'}),[]);
 assert.deepEqual(patchCandidateRows(client,'user-a',[row],{entity:'candidate_applications'},Date.now()+1),[row]);
});
test('permission loss removes application rows without disclosing destination fields',()=>{
 const client={},row={candidate_id:'CAN-1',application_id:'app-1'};publishCandidateReceipt(client,'scope',receipt({cards:[],removed_applications:['app-1']}));
 assert.deepEqual(patchCandidateRows(client,'scope',[row],{entity:'candidate_applications'}),[]);
});
test('one candidate action revalidates only source/destination stage and affected group/detail criteria',()=>{
 const client={},scope='scope',changes=[];
 const request=(stage,groupId)=>({accessScope:scope,entity:'pipeline_stage',filters:{stage,groupId}});
 const requests=[request('Phone Screen','GRP-1'),request('HR Interview','GRP-2'),request('Test','GRP-1'),request('Phone Screen','GRP-3')];
 const unsub=requests.map((value,index)=>subscribeRecruitmentQuery(client,value,()=>changes.push(index)));
 invalidateCandidateRecruitmentLists(client,scope,[receipt()]);assert.deepEqual(changes,[0,1]);unsub.forEach(fn=>fn());
});
test('duplicate saves are blocked per candidate while unrelated candidates can save',async()=>{
 let finish; const gate=new Promise(resolve=>finish=resolve);const client={rpc:async(name,args)=>{await gate;return {data:{ok:true,action_result:receipt({request_id:args.p_request_id})},error:null};}};
 const first=performCandidateAction(client,'app_upsert_candidate_note_v2',{candidate_id:'CAN-1'});
 await assert.rejects(performCandidateAction(client,'app_upsert_candidate_note_v2',{candidate_id:'CAN-1'}),/already saving/);
 const other=performCandidateAction(client,'app_upsert_candidate_note_v2',{candidate_id:'CAN-2'});finish(); await Promise.all([first,other]);
});
test('uncertain outcome requires successful detail reconciliation before another write',async()=>{
 let calls=0; const client={rpc:async()=>{calls++;return {data:null,error:{message:'Failed to fetch',code:''}};}};
 await assert.rejects(performCandidateAction(client,'app_upsert_candidate_note_v2',{candidate_id:'CAN-1'}),/Failed to fetch/);
 await assert.rejects(performCandidateAction(client,'app_upsert_candidate_note_v2',{candidate_id:'CAN-1'}),/outcome is uncertain/);assert.equal(calls,1);
 acknowledgeCandidateReconciliation(client,'CAN-1'); await assert.rejects(performCandidateAction(client,'app_upsert_candidate_note_v2',{candidate_id:'CAN-1'}),/Failed to fetch/);assert.equal(calls,2);
});

test('sequential saves for separate applications of one candidate cannot revive an older stage',()=>{
 const client={};publishCandidateReceipt(client,'scope',receipt());
 publishCandidateReceipt(client,'scope',receipt({application_ids:['app-2'],cards:[{candidate_id:'CAN-1',application_id:'app-2',group_id:'GRP-3',doc_ids:[],sites:[],person_in_charges:[],latest_process:'Test',latest_result:null}]}));
 const rows=patchCandidateRows(client,'scope',[{candidate_id:'CAN-1',application_id:'app-1'},{candidate_id:'CAN-1',application_id:'app-2'}],{entity:'candidate_applications'});
 assert.deepEqual(rows.map(row=>row.latest_process),['HR Interview','Test']);
});


test('failed-stage invalidation and committed patches stay inside source/destination stages',()=>{
 const client={},scope='failed-stage-scope',changes=[];
 const requests=['Phone Screen','HR Interview','Test'].map(stage=>({accessScope:scope,entity:'candidate_applications',filters:{boardFilter:'failed',stage}}));
 const unsubscribe=requests.map((request,index)=>subscribeRecruitmentQuery(client,request,()=>changes.push(index)));
 const committed=receipt({cards:[{candidate_id:'CAN-1',application_id:'app-1',latest_process:'HR Interview',latest_result:0,group_id:'GRP-2',sites:[],person_in_charges:[],doc_ids:[]}],effects:['records','counts']});
 invalidateCandidateRecruitmentLists(client,scope,[committed]);assert.deepEqual(changes,[0,1]);
 publishCandidateReceipt(client,scope,committed);
 assert.deepEqual(patchCandidateRows(client,scope,[{candidate_id:'CAN-1',application_id:'app-1',latest_process:'Phone Screen',latest_result:0}],requests[0]),[]);
 unsubscribe.forEach(stop=>stop());
});
