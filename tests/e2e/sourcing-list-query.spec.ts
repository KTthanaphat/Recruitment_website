import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";
import { sourcingApplicants } from "@/lib/operations";

test("Sourcing history uses the scoped database list, count, and cursor controls", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Lifecycle history" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Page 1 · \d+ records/ })).toBeVisible();
  expect(mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "sourcing")).toBe(true);
  expect(mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_count_v1" && call.payload.p_entity === "sourcing")).toBe(true);
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
});

test("workspace sourcing summary uses the scoped aggregate RPC", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-TECH&section=sourcing&sourcingWeek=2026-07-18");
  await expectWorkspaceReady(page);
  await page.getByRole("tab", { name: "Sourcing", exact: true }).click();
  await expect(page.getByTestId("workspace-sourcing-summary")).toBeVisible();
  await expect.poll(() => mock.rpcCalls.some(call => call.endpoint === "app_recruitment_sourcing_summary_v1" && call.payload.p_group_id === "GRP-TECH" && call.payload.p_selected_week === "2026-07-18")).toBe(true);
  const aggregate = mock.rpcCalls.findLast(call => call.endpoint === "app_recruitment_sourcing_summary_v1" && call.payload.p_group_id === "GRP-TECH" && call.payload.p_selected_week === "2026-07-18");
  expect(aggregate?.payload).toMatchObject({ p_group_id: "GRP-TECH", p_selected_week: "2026-07-18" });
  await expect(page.getByTestId("workspace-sourcing-summary-row")).toBeVisible();
  const expectedApplicants = mock.data.sourcing_weekly_updates.filter(row => row.group_id === "GRP-TECH" && row.week_start <= "2026-07-18").reduce((sum, row) => sum + (sourcingApplicants(row) ?? 0), 0);
  await expect(page.getByTestId("workspace-sourcing-summary-row")).toContainText(String(expectedApplicants));
  await expect(page.getByRole("alert").filter({ hasText: "Could not load the sourcing summary" })).toHaveCount(0);
});
