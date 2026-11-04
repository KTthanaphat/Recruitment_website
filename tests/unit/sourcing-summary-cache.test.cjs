require("./register-typescript.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadSourcingSummary, clearDashboardSummaryCache } = require("../../src/lib/dashboard-summary-client.ts");
const input = { selectedWeek: "2026-07-18", groupId: null, scope: {headerSite:"",headerPic:"",priorityOnly:false}, profileKey: "test:user" };
const result = { weeks: [], channels: {}, expectedRows: 0, updatedWeeks: 0, completeness: 0, groupId: null, selectedWeek: input.selectedWeek };
const flush = () => new Promise(resolve => setImmediate(resolve));
function client() {
  const state = { calls: 0, signal: null, finish: null };
  return Object.assign(state, { auth: {getSession:async()=>({data:{session:{user:{id:"test-user"}}}})}, rpc() {
    state.calls++;
    const promise = new Promise(resolve => { state.finish = () => resolve({data:result,error:null}); });
    promise.abortSignal = signal => { state.signal=signal; signal.addEventListener("abort",()=>state.finish(),{once:true}); return promise; };
    return promise;
  }});
}
test("sourcing summaries share a scoped read and retain fresh results for reopening", async () => {
  clearDashboardSummaryCache(); const db=client(); const a=loadSourcingSummary(db,input),b=loadSourcingSummary(db,input);
  await flush(); assert.equal(db.calls,1); db.finish(); await Promise.all([a,b]); await loadSourcingSummary(db,input); assert.equal(db.calls,1);
});
test("hiding one chart does not abort another subscriber's summary", async () => {
  clearDashboardSummaryCache(); const db=client(),a=new AbortController(),b=new AbortController();
  const first=loadSourcingSummary(db,{...input,signal:a.signal}); const second=loadSourcingSummary(db,{...input,signal:b.signal});
  const rejected=assert.rejects(first,{name:"AbortError"}); await flush(); a.abort(); await rejected; assert.equal(db.signal.aborted,false); db.finish(); await second;
});
test("hiding the last chart cancels transport and a reopened chart gets a fresh lease", async () => {
  clearDashboardSummaryCache(); const db=client(),a=new AbortController(); const first=loadSourcingSummary(db,{...input,signal:a.signal});
  const rejected=assert.rejects(first,{name:"AbortError"}); await flush(); a.abort(); await rejected; assert.equal(db.signal.aborted,true);
  await flush(); const reopened=loadSourcingSummary(db,input); await flush(); assert.equal(db.calls,2); db.finish(); await reopened;
});
