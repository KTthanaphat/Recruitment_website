import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("candidate details retain older failed history after more than 1000 newer stages without any writes", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "viewer" });
  const historySource = mock.data.recruitment_log_history ?? mock.data.recruitment_logs;
  const old = historySource.find(row => row.candidate_id === "C-PHONE")!;
  const applicationId = mock.data.candidate_applications?.find(row => row.candidate_id === "C-PHONE")?.application_id;
  const unrelatedApplicationId = mock.data.candidate_applications?.find(row => row.candidate_id === "C-TEST")?.application_id;
  if (!applicationId || !unrelatedApplicationId) throw new Error("Expected selected and unrelated application fixtures.");
  old.application_id = applicationId;
  old.result = 0;
  old.outcome_date = "2026-07-10";
  old.created_at = "2026-07-09T00:00:00.000Z";
  old.remark = "Older failed phone screening is still recorded";
  for (let i = 0; i < 1100; i++) {
    historySource.push({
      ...old, candidate_id: "C-TEST", application_id: unrelatedApplicationId, log_id: 10000 + i,
      stage_instance_id: "00000000-0000-4000-8000-" + String(10000 + i).padStart(12, "0"),
      superseded_at: null, superseded_by_stage_instance_id: null,
      created_at: "2026-10-26T02:19:11.000Z", round: i + 1
    });
  }
  const writes: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (!url.pathname.includes("/rest/v1/") || url.pathname.includes("/rpc/")) return;
    if (request.method() !== "GET") writes.push(request.method() + " " + url.pathname);
  });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: /Pat Phone C-PHONE/ }).click();
  const drawer = page.getByRole("dialog", { name: /C-PHONE \/ Pat Phone/ });
  await expect(drawer.getByText("Completed stage history")).toBeVisible();
  await expect(drawer.getByText("Remark: Older failed phone screening is still recorded")).toBeVisible();
  const countCall = mock.rpcCalls.find(call => call.endpoint === "app_recruitment_list_count_v1" && call.payload.p_entity === "pipeline_history");
  expect(countCall?.payload.p_filters).toMatchObject({ candidateId: "C-PHONE", applicationId, showAudit: true });
  const pageCalls = mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "pipeline_history");
  expect(pageCalls.length).toBeGreaterThan(0);
  expect(pageCalls.every(call => call.payload.p_limit === 100 && call.payload.p_sort === "log_id" && call.payload.p_direction === "asc" && (call.payload.p_filters as Record<string, unknown>).candidateId === "C-PHONE" && (call.payload.p_filters as Record<string, unknown>).applicationId === applicationId)).toBe(true);
  expect(historySource.filter(log => log.candidate_id === "C-TEST" && log.application_id === unrelatedApplicationId && log.log_id >= 10000)).toHaveLength(1100);
  expect(writes).toEqual([]);
  expect(mock.rpcCalls.filter(call => /upsert|create_candidate|complete_pipeline/.test(call.endpoint))).toEqual([]);
});
