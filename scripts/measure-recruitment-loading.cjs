const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { performance } = require("node:perf_hooks");

const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith("@/")) request = path.join(root, "src", request.slice(2));
  return originalResolve.call(this, request, parent, isMain, options);
};
require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  module._compile(output, filename);
};

const { loadDashboardData, loadRecruitmentBootstrap } = require("../src/lib/data.ts");
const { fetchRecruitmentList, fetchRecruitmentListCount } = require("../src/lib/recruitment-list.ts");

const populationArg = process.argv.find(arg => arg.startsWith("--population="));
const populations = populationArg ? [Number(populationArg.split("=")[1])] : [1_000, 10_000, 100_000];
if (populations.some(value => !Number.isSafeInteger(value) || value < 1 || value > 100_000)) throw new Error("Use --population=1..100000");
const REST_CAP = 1_000;
const HISTORY_PAGE = 500;
const LIST_PAGE = 50;
const profileId = "perf-user-0001";
const outputDirectory = path.join(root, "outputs", "recruitment-data-performance");

function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex"); }
function fixed(value, size) { return String(value).padEnd(size, "x").slice(0, size); }
const sizes = {
  profiles: 420, requisitions: 220, requisition_logs: 150, position_groups: 140, document_groups: 140,
  candidates: 330, candidate_references: 150, candidate_reference_checks: 200, rejection_reasons: 80,
  offers: 250, sourcing_weekly_updates: 180, vacancy_weekly_snapshots: 160, change_logs: 220,
  rejection_letter_templates: 120, rejection_letter_drafts: 160, interview_invitation_templates: 120,
  interview_meetings: 170, candidate_applications: 220, candidate_application_assignments: 160, candidate_notes: 240,
  recruitment_logs: 1_255
};
const counts = { profiles: 1, requisition_logs: 100, rejection_reasons: 20, rejection_letter_templates: 12, interview_invitation_templates: 8 };

function rowFor(table, n) {
  const id = String(n).padStart(7, "0");
  const common = { id: `${table}-${id}`, created_at: "2026-10-31T12:00:00.000Z", updated_at: "2026-10-31T12:00:00.000Z", ...(table === "recruitment_logs" ? {} : { payload: fixed(`${table}-${id}-`, sizes[table] ?? 300) }) };
  if (table === "profiles") return { ...common, id: profileId, role: "admin_recruiter", site: "TEST", nickname: "Perf User", full_name: "Performance User" };
  if (table === "candidates") return { ...common, candidate_id: `CAN-${id}`, name: fixed(`Candidate ${id}`, 60), nickname: fixed(`N${id}`, 18), home_site: "TEST", created_by: profileId };
  if (table === "candidate_applications") return { ...common, application_id: `00000000-0000-4000-8000-${id.padStart(12,"0")}`, candidate_id: `CAN-${id}`, group_id: `GRP-${id}`, state: "active" };
  if (table === "recruitment_logs") return { ...common, log_id: n, candidate_id: `CAN-${String(((n - 1) % 100_000) + 1).padStart(7,"0")}`, application_id: `00000000-0000-4000-8000-${String(((n - 1) % 100_000) + 1).padStart(12,"0")}`, recruitment_process: "Phone Screen", result: null, log_date: "2026-10-31", remark: fixed(`history-remark-${id}-`, sizes.recruitment_logs) };
  if (table === "requisitions") return { ...common, doc_id: `REQ-${id}`, position: fixed(`Position ${id}`, 80), site: "TEST", head_count: 3, status: "ongoing" };
  return { ...common, [table.endsWith("_id") ? table : "row_id"]: id };
}

function makeDataset(population) {
  return (table, from, to) => {
    const count = counts[table] ?? population;
    const start = Math.max(0, from);
    const end = Math.min(count, to);
    return Array.from({ length: Math.max(0, end - start) }, (_, index) => rowFor(table, start + index + 1));
  };
}

function makeClient(population) {
  const rowsFor = makeDataset(population);
  const requests = [];
  const rpcRows = Array.from({ length: LIST_PAGE }, (_, index) => ({
    application_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12,"0")}`,
    candidate_id: `CAN-${String(index + 1).padStart(7,"0")}`,
    name: fixed(`Candidate ${index + 1}`, 28),
    group_id: `GRP-${String(index + 1).padStart(7,"0")}`,
    application_state: "active",
    latest_process: "Phone Screen",
    latest_result: null,
    latest_log_date: "2026-10-31",
    created_at: "2026-10-31T12:00:00.000Z",
    updated_at: "2026-10-31T12:00:00.000Z",
    payload: ""
  }));
  function record(kind, name, body) {
    const bytes = Buffer.byteLength(JSON.stringify(body));
    requests.push({ kind, name, bytes });
    return bytes;
  }
  function query(table) {
    const q = { table, from: 0, to: REST_CAP - 1, limit: null, filters: [], countExact: false, single: false };
    const result = () => {
      const total = counts[table] ?? population;
      const max = q.countExact ? Math.min(q.to + 1, total) : Math.min(q.limit ?? REST_CAP, REST_CAP, total);
      let rows = rowsFor(table, q.countExact ? q.from : 0, q.countExact ? max : max);
      for (const [column, value] of q.filters) rows = rows.filter(row => String(row[column] ?? "") === String(value));
      const data = q.single ? rows[0] ?? null : rows;
      const response = { data, error: null, ...(q.countExact ? { count: total } : {}) };
      record("rest", `${table}${q.countExact ? ` range=${q.from}-${q.to}` : ""}`, data);
      return response;
    };
    const builder = {
      select(_columns, options) { q.countExact = options?.count === "exact"; return builder; },
      order() { return builder; },
      limit(value) { q.limit = value; return builder; },
      range(from, to) { q.from = from; q.to = to; return builder; },
      eq(column, value) { q.filters.push([column, value]); return builder; },
      in(column, values) { q.filters.push([column, values[0]]); return builder; },
      maybeSingle() { q.single = true; return builder; },
      then(resolve, reject) { return Promise.resolve().then(result).then(resolve, reject); }
    };
    return builder;
  }
  return {
    requests,
    from: query,
    auth: { async getUser() { const data = { user: { id: profileId } }; record("auth", "user", data); return { data, error: null }; } },
    async rpc(name, args = {}) {
      if (name === "app_masked_candidate_pool_v1" || name === "app_candidate_profile_capabilities_v1" || name === "app_application_destinations_v1") {
        const data = [];
        record("rpc", name, data);
        return { data, error: null };
      }
      if (name === "app_recruitment_list_v1") {
        const search = String(args.p_search ?? "").trim();
        const match = search.match(/^CAN-(\d+)$/i);
        const searchId = match ? `CAN-${match[1].padStart(5,"0")}` : null;
        const items = searchId ? [{ ...rpcRows[0], candidate_id: searchId }] : rpcRows;
        const data = { items, has_more: !searchId && population > LIST_PAGE, has_more_before: false,
          next_cursor: !searchId && population > LIST_PAGE ? { value: "2026-10-31", id: rpcRows.at(-1).application_id } : null, previous_cursor: null };
        record("rpc", `${name}:${args.p_entity}:${search || "first-page"}`, data);
        return { data, error: null };
      }
      if (name === "app_recruitment_list_count_v1") {
        const search = String(args.p_search ?? "").trim();
        const data = /^CAN-\d+$/i.test(search) ? 1 : population;
        record("rpc", `${name}:${args.p_entity}:${search || "all"}`, data);
        return { data, error: null };
      }
      const data = [];
      record("rpc", name, data);
      return { data, error: null };
    }
  };
}

function summarize(requests) {
  const kinds = {};
  for (const request of requests) kinds[request.kind] = (kinds[request.kind] ?? 0) + 1;
  const bySource = {};
  for (const request of requests) bySource[request.name.split(/ range=|:/u)[0]] = (bySource[request.name.split(/ range=|:/u)[0]] ?? 0) + request.bytes;
  const bytes = requests.reduce((sum, item) => sum + item.bytes, 0);
  return { requests: requests.length, requests_by_kind: kinds, response_body_bytes: bytes, response_body_mib: Number((bytes / 1024 / 1024).toFixed(3)), response_body_bytes_by_source: bySource };
}

async function measurePopulation(population) {
  const timings = [];
  const { subscribeRecruitmentReadTimings } = require(path.join(root,'src/lib/recruitment-read-scheduler.ts'));
  const unsubscribe = subscribeRecruitmentReadTimings(timing => timings.push(timing));
  const legacy = makeClient(population);
  const legacyStart = performance.now();
  const legacyData = await loadDashboardData(legacy);
  const legacyMs = performance.now() - legacyStart;

  const modern = makeClient(population);
  const modernStart = performance.now();
  const bootstrap = await loadRecruitmentBootstrap(modern);
  const request = { accessScope: `synthetic:${profileId}`, entity: "candidate_applications", sort: "latest_log_date", direction: "desc", limit: LIST_PAGE };
  const page = await fetchRecruitmentList(modern, request);
  const count = await fetchRecruitmentListCount(modern, request);
  const firstListMs = performance.now() - modernStart;
  const coldRequestCount = modern.requests.length;
  await fetchRecruitmentList(modern, request);
  await fetchRecruitmentListCount(modern, request);
  const warmRequestDelta = modern.requests.length - coldRequestCount;
  const deepSearch = await fetchRecruitmentList(modern, { ...request, search: `CAN-${String(population).padStart(5,"0")}` });
  const deepSearchCount = await fetchRecruitmentListCount(modern, { ...request, search: `CAN-${String(population).padStart(5,"0")}` });
  const searchRequests = modern.requests.slice(coldRequestCount + warmRequestDelta);
  unsubscribe();
  return {
    scheduled_reads: timings.map(({ priority, queueMs, requestMs, status }) => ({ priority, queue_ms: Number(queueMs.toFixed(2)), request_ms: Number(requestMs.toFixed(2)), status })),
    population,
    legacy: { ...summarize(legacy.requests), elapsed_ms: Number(legacyMs.toFixed(2)), history_rows: legacyData.recruitment_log_history.length, first_rest_cap: REST_CAP, history_page_size: HISTORY_PAGE, uncapped_projection_rpc_calls: 3, uncapped_projection_rpc_return_rows: 0, note: "The three legacy projection RPCs return empty arrays in this adapter; growing body bytes come from the fully paged history table." },
    paged: { ...summarize(modern.requests.slice(0,coldRequestCount)), elapsed_ms: Number(firstListMs.toFixed(2)), bootstrap_profile_loaded: bootstrap.profile?.id === profileId, page_size: page.items.length, count, warm_navigation_requests: warmRequestDelta,
      deep_search: { input: `CAN-${String(population).padStart(5,"0")}`, rows: deepSearch.items.length, count: deepSearchCount, requests: searchRequests.length, beyond_rest_cap: population > REST_CAP, mocked_full_database_search: true } }
  };
}

async function main() {
  const loaderFiles = ["src/lib/data.ts", "src/lib/recruitment-history-loader.ts", "src/lib/recruitment-list.ts", "src/lib/candidate-action-receipt.ts", "src/lib/recruitment-read-scheduler.ts"];
  const {performCandidateAction,subscribeCandidateActionTimings,markCandidateReceiptDisplayed,markCandidateReconciliation}=require('../src/lib/candidate-action-receipt.ts');
  const actionTimings=[];const unsubscribeActions=subscribeCandidateActionTimings(value=>actionTimings.push(value));
  const syntheticActionClient={rpc:async(_name,args)=>({data:{ok:true,action_result:{version:1,request_id:args.p_request_id}},error:null})};
  const committed=await performCandidateAction(syntheticActionClient,'app_upsert_candidate_note_v2',{candidate_id:'SYNTHETIC'});
  await new Promise(resolve=>setImmediate(resolve));markCandidateReceiptDisplayed(committed.action_result.request_id);
  const reconciliationStarted=performance.now();await new Promise(resolve=>setImmediate(resolve));markCandidateReconciliation(reconciliationStarted);unsubscribeActions();
  const results = [];
  for (const population of populations) results.push(await measurePopulation(population));
  fs.mkdirSync(outputDirectory, { recursive: true });
  const output = { generated_at: new Date().toISOString(), method: { adapter: "synthetic thenable PostgREST/RPC; fixed-width generated records", ordinary_rest_cap: REST_CAP, exact_history_page_size: HISTORY_PAGE, recruitment_list_page_size: LIST_PAGE, body_bytes: "JSON response body bytes only; synthetic, not production payload sizes", search: "The mock list RPC searches all generated IDs even above REST cap; SQL endpoint behavior is covered separately." }, candidate_action_timings: { method: "Synthetic adapter/scheduling only; display callback is simulated, not browser paint. Production observers emit timing phases without candidate payloads.", samples: actionTimings }, source_sha256: Object.fromEntries(loaderFiles.map(file => [file, hash(file)])), results };
  const file = path.join(outputDirectory, `loader-payload-${Date.now()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: file, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
