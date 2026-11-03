require("./register-typescript.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fetchRecruitmentList, fetchRecruitmentListCount, invalidateRecruitmentLists, invalidateRecruitmentListsForMutation, recruitmentListDependenciesForMutation, clearRecruitmentListCache, subscribeRecruitmentLists } = require("../../src/lib/recruitment-list.ts");

function client(response) {
  const calls = [];
  return { calls, rpc(name, args) { calls.push({ name, args }); return Promise.resolve(response); } };
}
const page = (id = "CAN-00001") => ({ data: { items: [{ candidate_id: id }], total_count: 1, has_more: false, has_more_before: false, next_cursor: null, previous_cursor: null }, error: null });
const request = (accessScope, entity = "candidate_registry") => ({ accessScope, entity, search: "a", sort: "candidate_id", direction: "asc", limit: 50 });

test("deduplicates the same query for one authorization scope and sends keyset arguments", async () => {
  clearRecruitmentListCache();
  const db = client(page());
  const [a, b] = await Promise.all([fetchRecruitmentList(db, request("project:user:role:site:v1")), fetchRecruitmentList(db, request("project:user:role:site:v1"))]);
  assert.equal(db.calls.length, 1);
  assert.deepEqual(a, b);
  assert.equal(db.calls[0].name, "app_recruitment_list_v1");
  assert.equal(db.calls[0].args.p_limit, 50);
  assert.equal(db.calls[0].args.p_cursor_value, null);
});

test("isolates identical query criteria across users and projects", async () => {
  clearRecruitmentListCache();
  const first = client(page("CAN-00001"));
  const second = client(page("CAN-00002"));
  await fetchRecruitmentList(first, request("project-a:user-a:role:site:v1"));
  const result = await fetchRecruitmentList(second, request("project-b:user-b:role:site:v1"));
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 1);
  assert.equal(result.items[0].candidate_id, "CAN-00002");
});

test("never shares a page between distinct client instances with the same access scope", async () => {
  clearRecruitmentListCache();
  const first = client(page("CAN-FIRST"));
  const second = client(page("CAN-SECOND"));
  await fetchRecruitmentList(first, request("same-profile-scope"));
  const result = await fetchRecruitmentList(second, request("same-profile-scope"));
  assert.equal(first.calls.length, 1);
  assert.equal(second.calls.length, 1);
  assert.equal(result.items[0].candidate_id, "CAN-SECOND");
});

test("expires cached pages after thirty seconds", async () => {
  clearRecruitmentListCache();
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;
  try {
    const db = client(page());
    await fetchRecruitmentList(db, request("ttl"));
    await fetchRecruitmentList(db, request("ttl"));
    assert.equal(db.calls.length, 1);
    now += 30_001;
    await fetchRecruitmentList(db, request("ttl"));
    assert.equal(db.calls.length, 2);
  } finally {
    Date.now = originalNow;
    clearRecruitmentListCache();
  }
});

test("purges expired entries while navigating and bounds retained page responses", async () => {
  clearRecruitmentListCache();
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    const db = client(page());
    const first = { ...request("bounded-cache"), search: "original" };
    await fetchRecruitmentList(db, first);
    for (let index = 0; index < 251; index++) await fetchRecruitmentList(db, { ...first, search: `query-${index}` });
    const before = db.calls.length;
    await fetchRecruitmentList(db, first);
    assert.equal(db.calls.length, before + 1);
    now += 30_001;
    const afterExpiry = db.calls.length;
    await fetchRecruitmentList(db, { ...first, search: "after-expiry" });
    assert.equal(db.calls.length, afterExpiry + 1);
  } finally {
    Date.now = originalNow;
    clearRecruitmentListCache();
  }
});

test("counts criteria separately from sort and cursor, and expires the count cache", async () => {
  clearRecruitmentListCache();
  const originalNow = Date.now;
  let now = 2_000;
  Date.now = () => now;
  try {
    const db = { calls: [], rpc(name, args) { this.calls.push({ name, args }); return Promise.resolve({ data: 17, error: null }); } };
    const base = request("count-scope");
    await fetchRecruitmentListCount(db, base);
    await fetchRecruitmentListCount(db, { ...base, sort: "name", limit: 100, cursor: { value: "x", id: "cursor" }, before: true });
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].name, "app_recruitment_list_count_v1");
    assert.equal(db.calls[0].args.p_entity, "candidate_registry");
    now += 30_001;
    await fetchRecruitmentListCount(db, base);
    assert.equal(db.calls.length, 2);
  } finally {
    Date.now = originalNow;
    clearRecruitmentListCache();
  }
});

test("rejects malformed criteria counts", async () => {
  clearRecruitmentListCache();
  const db = { rpc() { return Promise.resolve({ data: -1, error: null }); } };
  await assert.rejects(fetchRecruitmentListCount(db, request("bad-count")), /invalid response/);
});

test("invalidates only the requested entity family", async () => {
  clearRecruitmentListCache();
  const db = client(page());
  await fetchRecruitmentList(db, request("scope"));
  await fetchRecruitmentList(db, request("scope", "offers"));
  invalidateRecruitmentLists("offers");
  await fetchRecruitmentList(db, request("scope"));
  await fetchRecruitmentList(db, request("scope", "offers"));
  assert.equal(db.calls.length, 3);
});

test("scoped invalidation notifies mounted consumers of only that entity", () => {
  let candidateNotifications = 0, offerNotifications = 0;
  const stopCandidates = subscribeRecruitmentLists("candidate_registry", () => candidateNotifications++);
  const stopOffers = subscribeRecruitmentLists("offers", () => offerNotifications++);
  invalidateRecruitmentLists("candidate_registry");
  stopCandidates(); stopOffers();
  assert.equal(candidateNotifications, 1);
  assert.equal(offerNotifications, 0);
});

test("offer mutations refresh related applications, requisitions, groups, sourcing and audit consumers", () => {
  clearRecruitmentListCache();
  const changed = [];
  const entities = ["offers", "candidate_applications", "candidate_registry", "pipeline_stage", "pipeline_history", "requisitions", "position_groups", "sourcing", "audit_log"];
  const unsubscribers = entities.map(entity => subscribeRecruitmentLists(entity, () => changed.push(entity)));
  try {
    invalidateRecruitmentListsForMutation("app_upsert_offer");
    assert.deepEqual(changed.sort(), ["audit_log", "candidate_applications", "candidate_registry", "offers", "pipeline_history", "pipeline_stage", "position_groups", "requisitions", "sourcing"].sort());
    assert.deepEqual([...recruitmentListDependenciesForMutation("app_unknown_write")].sort(), [...entities].sort());
    changed.length = 0;
    invalidateRecruitmentListsForMutation("app_unknown_write");
    assert.deepEqual(changed.sort(), [...entities].sort());
  } finally { unsubscribers.forEach(unsubscribe => unsubscribe()); }
});

test("candidate mutations refresh journey consumers without unrelated offer/requisition/sourcing queries", () => {
  clearRecruitmentListCache();
  const changed = [];
  const entities = ["offers", "candidate_applications", "candidate_registry", "pipeline_stage", "pipeline_history", "requisitions", "position_groups", "sourcing", "audit_log"];
  const unsubscribers = entities.map(entity => subscribeRecruitmentLists(entity, () => changed.push(entity)));
  try {
    for (const endpoint of ["app_complete_pipeline_stage_v2", "app_transfer_candidate_application_v1"]) {
      changed.length = 0;
      invalidateRecruitmentListsForMutation(endpoint);
      assert.deepEqual(changed.sort(), ["audit_log", "candidate_applications", "candidate_registry", "pipeline_history", "pipeline_stage"].sort());
    }
  } finally { unsubscribers.forEach(unsubscribe => unsubscribe()); }
});

test("rejects malformed pages and evicts a failed response for retry", async () => {
  clearRecruitmentListCache();
  const bad = client({ data: { items: [{ id: 1 }], total_count: 2, has_more: true, next_cursor: null }, error: null });
  await assert.rejects(fetchRecruitmentList(bad, request("retry")), /invalid response/);
  bad.rpc = function (name, args) { this.calls.push({ name, args }); return Promise.resolve(page()); };
  await fetchRecruitmentList(bad, request("retry"));
  assert.equal(bad.calls.length, 2);
});

test("accepts a nonempty terminal page with no next cursor", async () => {
  clearRecruitmentListCache();
  const result = await fetchRecruitmentList(client(page()), request("terminal"));
  assert.equal(result.items.length, 1);
  assert.equal(result.has_more, false);
  assert.equal(result.next_cursor, null);
});

test("normalizes an omitted optional page count to null for the separate count contract", async () => {
  clearRecruitmentListCache();
  const db = client({ data: { items: [{ candidate_id: "CAN-00001" }], has_more: false, has_more_before: false, next_cursor: null, previous_cursor: null }, error: null });
  const result = await fetchRecruitmentList(db, request("missing-page-count"));
  assert.equal(result.items.length, 1);
  assert.equal(result.total_count, null);
});

test("accepts empty and exactly-50-row terminal pages", async () => {
  clearRecruitmentListCache();
  const empty = await fetchRecruitmentList(client({ data: { items: [], total_count: 0, has_more: false, has_more_before: false, next_cursor: null, previous_cursor: null }, error: null }), request("empty"));
  const rows = Array.from({ length: 50 }, (_, index) => ({ candidate_id: `CAN-${index}` }));
  const full = await fetchRecruitmentList(client({ data: { items: rows, total_count: 50, has_more: false, has_more_before: false, next_cursor: null, previous_cursor: null }, error: null }), request("full"));
  assert.deepEqual(empty.items, []);
  assert.equal(full.items.length, 50);
});

test('canceling an obsolete subscriber does not evict or abort a shared page request',async()=>{
 clearRecruitmentListCache();let finish,calls=0;const gate=new Promise(resolve=>finish=resolve),db={rpc:()=>{calls++;return gate;}};
 const controller=new AbortController();const a=fetchRecruitmentList(db,{...request('shared-abort'),signal:controller.signal});const b=fetchRecruitmentList(db,request('shared-abort'));
 const rejected=assert.rejects(a,error=>error.name==='AbortError');controller.abort();await rejected;
 const c=fetchRecruitmentList(db,request('shared-abort'));finish(page());await Promise.all([b,c]);assert.equal(calls,1);
});
