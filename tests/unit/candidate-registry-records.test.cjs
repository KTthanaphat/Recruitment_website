require("./register-typescript.cjs");
const {test}=require("node:test"),assert=require("node:assert/strict");
const {candidateColumnFilterError,emptyCandidateColumnFilters,fetchSelectedCandidateRecords}=require("../../src/lib/candidate-registry-records.ts");
const {clearRecruitmentListCache}=require("../../src/lib/recruitment-list.ts");
test("candidate ranges reject impossible dates and invalid count bounds without rejecting open ends",()=>{
 const check=fields=>candidateColumnFilterError({...emptyCandidateColumnFilters,...fields});
 assert.equal(check({activeMin:"0",activeMax:"2147483647"}),null);assert.equal(check({updatedFrom:"2024-02-29"}),null);
 for(const fields of [{activeMin:"-1"},{activeMin:"1.5"},{activeMin:"3",activeMax:"2"},{activeMax:"2147483648"}])assert.equal(check(fields),"count");
 for(const fields of [{updatedFrom:"2026-02-30"},{updatedTo:"0000-01-01"},{updatedFrom:"2026-07-02",updatedTo:"2026-07-01"}])assert.equal(check(fields),"date");
});
test("selected candidate refresh batches IDs at 100 without loading the whole registry",async()=>{
 clearRecruitmentListCache();const calls=[],ids=Array.from({length:205},(_,i)=>"SELECTED-"+i);
 const client={rpc:async(name,args)=>{calls.push(args);return{data:{items:args.p_filters.candidateIds.map(candidate_id=>({candidate_id,masked:false})),has_more:false,has_more_before:false,next_cursor:null,previous_cursor:null},error:null};}};
 const rows=await fetchSelectedCandidateRecords(client,"scope",ids,{site:"HQ",owner:"Alice"});
 assert.equal(rows.length,205);assert.deepEqual(calls.map(c=>c.p_filters.candidateIds.length),[100,100,5]);assert(calls.every(c=>c.p_limit===100&&c.p_filters.site==="HQ"&&c.p_filters.owner==="Alice"));
});
test("export bypasses a warm projection so newly masked rows cannot reuse stale private data",async()=>{
 clearRecruitmentListCache();let masked=false,calls=0;
 const client={rpc:async()=>{calls++;return{data:{items:[{candidate_id:"C1",masked,name:masked?null:"Private name"}],has_more:false,has_more_before:false,next_cursor:null,previous_cursor:null},error:null};}};
 assert.equal((await fetchSelectedCandidateRecords(client,"scope",["C1"],{site:"",owner:""}))[0].name,"Private name");
 masked=true;assert.equal((await fetchSelectedCandidateRecords(client,"scope",["C1"],{site:"",owner:""}))[0].name,null);assert.equal(calls,2);
});
test("aborted export never starts another batch",async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(fetchSelectedCandidateRecords({rpc:async()=>{calls++;}},"scope",["C1"],{site:"",owner:""},controller.signal),/cancelled/);assert.equal(calls,0);
});
