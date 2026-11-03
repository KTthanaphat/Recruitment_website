
require("./register-typescript.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fetchCompleteRecruitmentList, clearRecruitmentListCache } = require("../../src/lib/recruitment-list.ts");
function fixture(size, counts = [size]) {
  const source = Array.from({length:size},(_,index)=>({application_id:String(index+1),sort_value:"tied"}));
  const calls = []; let countsRead = 0;
  const client = { rpc(name,args) {
    calls.push({name,args});
    if(name === "app_recruitment_list_count_v1") return Promise.resolve({data:counts[Math.min(countsRead++,counts.length-1)],error:null});
    const start = args.p_cursor_id ? Number(args.p_cursor_id) : 0;
    const items = source.slice(start,start+args.p_limit), end=start+items.length;
    return Promise.resolve({data:{items,has_more:end<size,has_more_before:start>0,total_count:null,next_cursor:end<size?{value:"tied",id:String(end)}:null,previous_cursor:start?{value:"tied",id:String(start+1)}:null},error:null});
  }};
  return {client,calls};
}
const request = {accessScope:"dev:user:role:site",entity:"pipeline_stage",sort:"board_last_update",filters:{stage:"Phone Screen"}};
test("complete traversal retrieves 1,005 tied records through bounded cursor pages",async()=>{
  clearRecruitmentListCache();const {client,calls}=fixture(1005);
  const result=await fetchCompleteRecruitmentList(client,request,row=>row.application_id);
  assert.equal(result.items.length,1005);assert.equal(result.items.at(-1).application_id,"1005");
  const pages=calls.filter(call=>call.name==="app_recruitment_list_v1");
  assert.equal(pages.length,11);assert.ok(pages.every(call=>call.args.p_limit===100));
  assert.equal(result.total_count,1005);
});
test("count mismatch retries one clean complete traversal",async()=>{
  clearRecruitmentListCache();const {client,calls}=fixture(23,[24,23]);
  assert.equal((await fetchCompleteRecruitmentList(client,request,row=>row.application_id)).items.length,23);
  assert.equal(calls.filter(call=>call.name==="app_recruitment_list_v1").length,2);
});
test("persistent concurrent change rejects rather than returning partial data",async()=>{
  clearRecruitmentListCache();const {client}=fixture(23,[24]);
  await assert.rejects(fetchCompleteRecruitmentList(client,request,row=>row.application_id),/changed during retrieval/);
});
test("duplicate identities fail closed",async()=>{
  clearRecruitmentListCache();const {client}=fixture(101);
  await assert.rejects(fetchCompleteRecruitmentList(client,request,()=>"same"),/duplicate identity/);
});
test("empty complete scope is a successful confirmed zero",async()=>{
  clearRecruitmentListCache();const {client}=fixture(0);
  assert.deepEqual((await fetchCompleteRecruitmentList(client,request,row=>row.application_id)).items,[]);
});
