import { expect, test, type Response } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { installMockSupabase } from "./support/mock-supabase";

type ApiEvent = { url: string; path: string; bytes: number; type: string };
type RpcEvent = { endpoint: string; body: Record<string, unknown> };

function performanceSummary(body: Record<string, unknown>) {
  const range = { start: String(body.p_start ?? "2026-10-01"), end: String(body.p_end ?? "2026-10-31") };
  const priorRange = { start: String(body.p_prior_start ?? "2026-09-01"), end: String(body.p_prior_end ?? "2026-09-30") };
  const summaryRange = (value: typeof range) => ({ range: value, metrics: { vacancies: 0, filled: 0, open: 0, filledPct: null, slaPct: null, avgTimeToFill: null, onTime: 0, late: 0, unknownSla: 0 }, cells: [], sites: [] });
  return { current: summaryRange(range), prior: summaryRange(priorRange), priorRange };
}

function candidatePageItem(candidate: Record<string, unknown>, applicationId: string, index: number) {
  return {
    application_id: applicationId,
    candidate_id: String(candidate.candidate_id ?? `CAN-PERF-${index}`),
    name: String(candidate.name ?? `Performance Candidate ${index}`),
    nickname: candidate.nickname ?? null,
    phone_no: candidate.phone_no ?? null,
    email: candidate.email ?? null,
    application_state: "active",
    state: "active",
    group_id: String(candidate.group_id ?? "GRP-ENG"),
    group_position: "Production Operator",
    doc_ids: ["REQ-HQ-1"],
    sites: ["HQ"],
    site: "HQ",
    person_in_charges: ["Nina"],
    person_in_charge: "Nina",
    latest_process: "Phone Screen",
    latest_result: null,
    latest_log_date: "2026-10-31",
    updated_at: "2026-10-31T12:00:00.000Z",
    home_last_touch_date: "2026-10-31",
    home_pending_remark: null
  };
}

async function respondJson(response: Response): Promise<ApiEvent | null> {
  const url = response.url();
  const parsed = new URL(url);
  const isApi = parsed.pathname.startsWith("/rest/v1/") || parsed.pathname.startsWith("/auth/v1/");
  const isAsset = ["document", "script", "stylesheet", "image", "font"].includes(response.request().resourceType());
  if (!isApi && !isAsset) return null;
  try {
    const body = await response.body();
    return { url, path: parsed.pathname, bytes: body.byteLength, type: isApi ? "api" : "asset" };
  } catch { return null; }
}

test("synthetic growing populations keep browser reads page-bounded and warm detail cached", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  let population = 1_000;
  const rpcEvents: RpcEvent[] = [];
  const apiEvents: ApiEvent[] = [];
  const pendingBodies: Promise<void>[] = [];
  page.on("response", response => {
    const pending = respondJson(response).then(event => { if (event) apiEvents.push(event); });
    pendingBodies.push(pending);
  });

  const candidate = mock.data.candidates[0] as unknown as Record<string, unknown>;
  const application = mock.data.candidate_applications?.find(row => row.candidate_id === candidate.candidate_id);
  const applicationId = application?.application_id ?? "00000000-0000-4000-8000-000000000001";
  const baseItem = candidatePageItem(candidate, applicationId, 0);

  await page.route("**/rest/v1/rpc/app_recruitment_list_v1", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    rpcEvents.push({ endpoint: "app_recruitment_list_v1", body });
    const entity = String(body.p_entity ?? "");
    const filters = (body.p_filters ?? {}) as Record<string, unknown>;
    if (entity !== "candidate_applications" && entity !== "pipeline_history") { await route.fallback(); return; }
    if (entity === "pipeline_history") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], total_count: null, has_more: false, has_more_before: false, next_cursor: null, previous_cursor: null }) });
      return;
    }
    const candidateOnly = typeof filters.candidateId === "string";
    const items = candidateOnly ? [baseItem] : [baseItem, ...Array.from({ length: 49 }, (_, index) => candidatePageItem({ candidate_id: `CAN-SYNTH-${index + 1}`, name: `Synthetic Candidate ${index + 1}`, group_id: "GRP-ENG" }, `00000000-0000-4000-8000-${String(index + 2).padStart(12, "0")}`, index + 1))];
    const hasMore = !candidateOnly && population > items.length;
    const last = items.at(-1);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, total_count: null, has_more: hasMore, has_more_before: false, next_cursor: hasMore && last ? { value: last.latest_log_date, id: last.application_id } : null, previous_cursor: null }) });
  });
  await page.route("**/rest/v1/rpc/app_recruitment_list_count_v1", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    rpcEvents.push({ endpoint: "app_recruitment_list_count_v1", body });
    const filters = (body.p_filters ?? {}) as Record<string, unknown>;
    if (!(["candidate_applications", "pipeline_history"].includes(String(body.p_entity)))) { await route.fallback(); return; }
    const count = String(body.p_entity) === "pipeline_history" ? 0 : filters.candidateId ? 1 : population;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(count) });
  });
  await page.route("**/rest/v1/rpc/app_dashboard_performance_summary_v1", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    rpcEvents.push({ endpoint: "app_dashboard_performance_summary_v1", body });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(performanceSummary(body)) });
  });

  const measurements: Record<string, unknown>[] = [];
  for (population of [1_000, 10_000, 100_000]) {
    const startEvents = apiEvents.length;
    const startRpc = rpcEvents.length;
    const bootStart = performance.now();
    await page.goto("/home");
    await expect(page.locator("[data-app-header-actions]")).toBeVisible();
    await expect(page.getByText("Loading recruitment records...")).toHaveCount(0);
    const welcome = page.getByRole("dialog", { name: /Welcome back/i });
    if (await welcome.isVisible().catch(() => false)) await welcome.getByRole("button", { name: "Close" }).last().click();
    const listStart = performance.now();
    await page.getByRole("tab", { name: "Candidate Pipeline" }).click();
    await expect(page.locator("[data-home-candidate-row]").first()).toBeVisible();
    const listReadyMs = performance.now() - listStart;
    const bootAndListMs = performance.now() - bootStart;
    await page.waitForLoadState("networkidle");
    await Promise.allSettled(pendingBodies);
    const coldRpcEnd = rpcEvents.length;
    const coldApiEnd = apiEvents.length;
    const coldHomeApi = apiEvents.slice(startEvents);
    const warmListStart = performance.now();
    await page.getByRole("tab", { name: "Open Headcount" }).click();
    await page.getByRole("tab", { name: "Candidate Pipeline" }).click();
    await expect(page.locator("[data-home-candidate-row]").first()).toBeVisible();
    const warmListReadyMs = performance.now() - warmListStart;
    await page.waitForLoadState("networkidle");
    await Promise.allSettled(pendingBodies);
    const warmListNewRpc = rpcEvents.slice(coldRpcEnd).filter(event => ["app_recruitment_list_v1", "app_recruitment_list_count_v1"].includes(event.endpoint) && (event.body.p_entity === "candidate_applications"));

    const detailStart = performance.now();
    await page.locator("[data-home-candidate-row]").first().getByRole("button").first().click();
    const detailDialog = page.getByRole("dialog");
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText("Candidate Pipeline Journey")).toBeVisible();
    const detailReadyMs = performance.now() - detailStart;
    await page.waitForLoadState("networkidle");
    await Promise.allSettled(pendingBodies);
    const detailRpcEnd = rpcEvents.length;
    const detailApiEnd = apiEvents.length;
    const warmDetailStart = performance.now();
    await detailDialog.getByRole("button", { name: "Close" }).click();
    await page.locator("[data-home-candidate-row]").first().getByRole("button").first().click();
    await expect(page.getByRole("dialog").getByText("Candidate Pipeline Journey")).toBeVisible();
    const warmDetailReadyMs = performance.now() - warmDetailStart;
    await page.waitForLoadState("networkidle");
    await Promise.allSettled(pendingBodies);
    const warmDetailRpc = rpcEvents.slice(detailRpcEnd).filter(event => event.endpoint === "app_candidate_profile_detail_v1" || event.endpoint === "app_recruitment_list_v1" || event.endpoint === "app_recruitment_list_count_v1");
    const warmDetailApi = apiEvents.slice(detailApiEnd);

    const reportStart = performance.now();
    const reportRpcStart = rpcEvents.length;
    const reportApiStart = apiEvents.length;
    await page.goto("/dashboard?dashboardTab=performance");
    await expect(page.locator("[data-performance-overview] [data-performance-report]").first()).toBeVisible();
    const reportReadyMs = performance.now() - reportStart;
    const reportRpc = rpcEvents.slice(reportRpcStart).filter(event => event.endpoint === "app_dashboard_performance_summary_v1");
    const byteTotals = (events: ApiEvent[]) => ({ requests: events.length, body_bytes: events.reduce((sum, event) => sum + event.bytes, 0), api_requests: events.filter(event => event.type === "api").length, api_body_bytes: events.filter(event => event.type === "api").reduce((sum, event) => sum + event.bytes, 0), asset_requests: events.filter(event => event.type === "asset").length, asset_body_bytes: events.filter(event => event.type === "asset").reduce((sum, event) => sum + event.bytes, 0) });
    await page.waitForLoadState("networkidle");
    await Promise.allSettled(pendingBodies);
    const reportApi = apiEvents.slice(reportApiStart);
    const warmReportStart = performance.now();
    const warmReportRpcStart = rpcEvents.length;
    const warmReportApiStart = apiEvents.length;
    await page.getByRole("tab", { name: "Pipeline & Sources" }).click();
    await page.getByRole("tab", { name: "Recruitment Performance" }).click();
    await page.getByRole("tab", { name: "Performance", exact: true }).click();
    await expect(page.locator("[data-performance-overview] [data-performance-report]").first()).toBeVisible();
    const reportWarmReadyMs = performance.now() - warmReportStart;
    await page.waitForLoadState("networkidle");
    await Promise.allSettled(pendingBodies);
    const reportWarmRpcCount = rpcEvents.slice(warmReportRpcStart).filter(event => event.endpoint === "app_dashboard_performance_summary_v1").length;
    const reportWarmNavigationApi = apiEvents.slice(warmReportApiStart);
    const reportWarmApi = byteTotals(reportWarmNavigationApi.filter(event => event.path.endsWith("/app_dashboard_performance_summary_v1")));
    measurements.push({ population, bootstrap_and_first_list_ms: Number(bootAndListMs.toFixed(2)), list_first_usable_ms: Number(listReadyMs.toFixed(2)), cold_home: byteTotals(coldHomeApi), cold_home_api_rpc_request_count: coldHomeApi.filter(event => event.path.includes("/rpc/")).length, measured_list_rpc_count: rpcEvents.slice(startRpc,coldRpcEnd).length, warm_list_rpc_count: warmListNewRpc.length, warm_list_first_usable_ms: Number(warmListReadyMs.toFixed(2)),
      detail_first_usable_ms: Number(detailReadyMs.toFixed(2)), detail_cold_api: byteTotals(apiEvents.slice(coldApiEnd,detailApiEnd)), detail_warm_rpc_count: warmDetailRpc.length, detail_warm_api: byteTotals(warmDetailApi), detail_warm_first_usable_ms: Number(warmDetailReadyMs.toFixed(2)),
      report_first_usable_ms: Number(reportReadyMs.toFixed(2)), report_rpc_count: reportRpc.length, report_api: byteTotals(reportApi), report_body_bytes: reportRpc.length ? Buffer.byteLength(JSON.stringify(performanceSummary(reportRpc[0].body))) : 0, report_warm_first_usable_ms: Number(reportWarmReadyMs.toFixed(2)), report_warm_rpc_count: reportWarmRpcCount, report_warm_api: reportWarmApi, report_warm_navigation_api: byteTotals(reportWarmNavigationApi),
      all_home_rpc_count: rpcEvents.slice(startRpc,coldRpcEnd).length, app_page_limit_observed: rpcEvents.slice(startRpc,coldRpcEnd).filter(event => event.endpoint === "app_recruitment_list_v1" && event.body.p_entity === "candidate_applications").map(event => event.body.p_limit) });
  }

  await Promise.allSettled(pendingBodies);
  const outputDir = path.resolve(process.cwd(), "outputs/recruitment-data-performance");
  fs.mkdirSync(outputDir, { recursive: true });
  const sourceFiles = ["src/lib/data.ts", "src/lib/recruitment-list.ts", "src/lib/candidate-detail-loader.ts", "src/lib/dashboard-summary-client.ts", "tests/e2e/data-loading-performance.spec.ts"];
  const sourceSha256 = Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.resolve(process.cwd(), file))).digest("hex")]));
  const output = { generated_at: new Date().toISOString(), method: "Playwright local browser with installMockSupabase; exact page/count and summary RPCs overridden with fixed-size DTOs while totalCount scales from 1k to 100k. API/auth body bytes are separated from document/script/style/image/font assets. Byte lengths are uncompressed JavaScript response-body lengths, not wire/compressed transfer bytes. These are mocked local browser timings/bytes, not production latency.", source_sha256: sourceSha256, measurements };
  const outputPath = path.join(outputDir, `browser-loading-${Date.now()}.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ output: outputPath, measurements }, null, 2));
  expect(measurements).toHaveLength(3);
  expect(measurements.every(row => row.warm_list_rpc_count === 0 && row.detail_warm_rpc_count === 0)).toBe(true);
  expect(measurements.every(row => (row.detail_warm_api as { api_requests: number }).api_requests === 0)).toBe(true);
  expect(measurements.every(row => row.report_warm_rpc_count === 0 && (row.report_warm_api as { api_requests: number }).api_requests === 0)).toBe(true);
  expect(measurements.every(row => row.app_page_limit_observed.includes(50))).toBe(true);
});
