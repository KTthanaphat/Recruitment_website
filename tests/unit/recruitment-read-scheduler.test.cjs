require("./register-typescript.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { scheduleRecruitmentRead, clearRecruitmentReadQueue } = require("../../src/lib/recruitment-read-scheduler.ts");
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; }

test("two reads per client; interactive pages run alongside one background read", async () => {
  const db = {}, gate = deferred(), order = [];
  const active = scheduleRecruitmentRead(db, async () => { order.push("active"); await gate.promise; });
  await tick();
  const count = scheduleRecruitmentRead(db, async () => order.push("count"), 10);
  const summary = scheduleRecruitmentRead(db, async () => order.push("summary"), 1);
  const page = scheduleRecruitmentRead(db, async () => order.push("page"), 0);
  await tick();
  assert.deepEqual(order, ["active", "page"]);
  gate.resolve(); await Promise.all([active, count, summary, page]);
  assert.deepEqual(order, ["active", "page", "summary", "count"]);
});

test("a busy client cannot block another authenticated client", async () => {
  const gate = deferred();
  const busy = scheduleRecruitmentRead({}, () => gate.promise);
  await tick();
  assert.equal(await scheduleRecruitmentRead({}, async () => "other user"), "other user");
  gate.resolve(); await busy;
});

test("clearing access context rejects queued reads before they can start", async () => {
  const db = {}, gate = deferred(); let started = false;
  const active = scheduleRecruitmentRead(db, () => gate.promise); await tick();
  const queued = scheduleRecruitmentRead(db, async () => { started = true; });
  const rejected = assert.rejects(queued, error => error.name === "AbortError");
  clearRecruitmentReadQueue(db); await rejected;
  gate.resolve(); await active; await tick();
  assert.equal(started, false);
  assert.equal(await scheduleRecruitmentRead(db, async () => "new context"), "new context");
});

test("failed reads release the lane and same-priority reads remain FIFO", async () => {
  const db = {}, order = [];
  const failed = scheduleRecruitmentRead(db, async () => { throw new Error("database timeout"); });
  const rejected = assert.rejects(failed, /database timeout/);
  const a = scheduleRecruitmentRead(db, async () => order.push("a"));
  const b = scheduleRecruitmentRead(db, async () => order.push("b"));
  await Promise.all([rejected, a, b]); assert.deepEqual(order, ["a", "b"]);
});

test("a queued prefetch is promoted when it becomes the user's visible block",async()=>{
 const {promoteRecruitmentRead}=require('../../src/lib/recruitment-read-scheduler.ts');const client={},gate=deferred(),signal=new AbortController();let started=false;
 const background=scheduleRecruitmentRead(client,()=>gate.promise,10);await tick();
 const prefetch=scheduleRecruitmentRead(client,async()=>{started=true;},20,{signal:signal.signal});await tick();assert.equal(started,false);
 promoteRecruitmentRead(client,signal.signal);await prefetch;assert.equal(started,true);gate.resolve();await background;
});
