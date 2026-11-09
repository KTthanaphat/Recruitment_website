import { expect, test } from "@playwright/test";
import { installMockSupabase, expectWorkspaceReady } from "./support/mock-supabase";

test("Records page size follows available table height and resets the cursor", async ({ page }) => {
  const mock = await installMockSupabase(page);
  const template = mock.data.candidates[0];
  for (let i = 0; i < 45; i++) mock.data.candidates.push({ ...template, candidate_id: "FIT-" + String(i).padStart(3, "0"), name: "Fit Candidate " + i });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  const limits = () => mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "candidate_registry" && Number(call.payload.p_limit) > 0).map(call => Number(call.payload.p_limit));
  const pager = page.locator("[data-record-pagination]");
  await page.waitForTimeout(500);
  await expect(pager).toHaveAttribute("data-record-page-size", "7");
  await pager.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(pager).toContainText("2/");
  await page.setViewportSize({ width: 1366, height: 1050 });
  await expect.poll(async () => Number(await pager.getAttribute("data-record-page-size"))).toBeGreaterThan(7);
  await expect(pager).toContainText("1/");
  const larger = Number(await pager.getAttribute("data-record-page-size"));
  await page.setViewportSize({ width: 1366, height: 650 });
  await expect.poll(async () => Number(await pager.getAttribute("data-record-page-size"))).toBeLessThan(larger);
  await page.setViewportSize({ width: 390, height: 780 });
  await expect(pager).toHaveAttribute("data-record-page-size", "7");
});
