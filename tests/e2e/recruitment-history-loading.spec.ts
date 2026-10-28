import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("candidate details retain older failed history after more than 1000 newer stages without any writes", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "viewer" });
  const old = mock.data.recruitment_logs.find(row => row.candidate_id === "C-PHONE")!;
  old.result = 0;
  old.outcome_date = "2026-07-10";
  old.created_at = "2026-07-09T00:00:00.000Z";
  old.remark = "Older failed phone screening is still recorded";
  for (let i = 0; i < 1100; i++) {
    mock.data.recruitment_logs.push({
      ...old, candidate_id: "C-TEST", log_id: 10000 + i,
      stage_instance_id: "00000000-0000-4000-8000-" + String(10000 + i).padStart(12, "0"),
      created_at: "2026-10-26T02:19:11.000Z", round: i + 1
    });
  }
  const offsets: number[] = [];
  const writes: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (!url.pathname.includes("/rest/v1/") || url.pathname.includes("/rpc/")) return;
    if (request.method() !== "GET") writes.push(request.method() + " " + url.pathname);
    if (url.pathname.endsWith("/recruitment_logs")) {
      expect(url.searchParams.get("order")).toBe("log_id.asc");
      offsets.push(Number(url.searchParams.get("offset") ?? 0));
    }
  });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "View candidate detail for Pat Phone" }).click();
  const drawer = page.getByRole("dialog", { name: /C-PHONE \/ Pat Phone/ });
  await expect(drawer.getByText("Completed stage history")).toBeVisible();
  await expect(drawer.getByText("Remark: Older failed phone screening is still recorded")).toBeVisible();
  expect(offsets).toEqual([0, 500, 1000]);
  expect(writes).toEqual([]);
  expect(mock.rpcCalls.filter(call => /upsert|create_candidate|complete_pipeline/.test(call.endpoint))).toEqual([]);
});
