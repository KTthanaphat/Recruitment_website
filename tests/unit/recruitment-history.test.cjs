const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadRecruitmentHistory } = require("../../src/lib/recruitment-history-loader.ts");

function client(rows, failure) {
  const calls = [];
  return { calls, from(table) {
    assert.equal(table, "recruitment_logs");
    return { select(columns, options) {
      assert.equal(columns, "*");
      assert.equal(options.count, "exact");
      return { order(key, options) {
        assert.equal(key, "log_id");
        assert.equal(options.ascending, true);
        return { async range(start, end) {
          calls.push([start, end]);
          const page = rows.slice(start, end + 1);
          const response = { data: page, count: rows.length, error: null };
          return failure ? failure(response, start, rows) : response;
        } };
      } };
    } };
  } };
}
const rows = Array.from({ length: 1804 }, (_, i) => ({
  log_id: i + 1, candidate_id: i === 545 ? "PRE-IMPORT-CANDIDATE" : "OTHER",
  recruitment_process: "Phone Screen", result: i === 545 ? 0 : 1,
  created_at: i >= 998 ? "2026-10-26T02:19:11Z" : "2026-09-17T00:00:00Z"
}));

test("complete pages retain pre-import history beyond the former 1000-row window", async () => {
  const db = client(rows);
  const result = await loadRecruitmentHistory(db);
  assert.equal(result.length, 1804);
  assert.deepEqual(db.calls, [[0, 499], [500, 999], [1000, 1499], [1500, 1999]]);
  assert.equal(result.find(row => row.candidate_id === "PRE-IMPORT-CANDIDATE").result, 0);
  assert.equal(new Set(result.map(row => row.log_id)).size, 1804);
});

test("empty and exactly full final pages complete without an extra request", async () => {
  assert.deepEqual(await loadRecruitmentHistory(client([])), []);
  const db = client(rows.slice(0, 1000));
  assert.equal((await loadRecruitmentHistory(db)).length, 1000);
  assert.equal(db.calls.length, 2);
});

test("later-page failure rejects rather than presenting partial history", async () => {
  await assert.rejects(loadRecruitmentHistory(client(rows, (r, start) => start ? { ...r, error: { message: "History read failed" } } : r)), /History read failed/);
});

test("truncated, overlapping and changing pages cannot look like complete history", async () => {
  await assert.rejects(loadRecruitmentHistory(client(rows, r => ({ ...r, data: r.data.slice(0, 200) }))), /Incomplete/);
  await assert.rejects(loadRecruitmentHistory(client(rows, (r, start, all) => start ? { ...r, data: all.slice(0, 500) } : r)), /Duplicate/);
  await assert.rejects(loadRecruitmentHistory(client(rows, (r, start) => start ? { ...r, count: r.count + 1 } : r)), /changed while loading/);
  await assert.rejects(loadRecruitmentHistory(client(rows, r => ({ ...r, count: null }))), /Unable to verify/);
});
