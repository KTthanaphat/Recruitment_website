import { expect, test, type Request } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("Home heavy reads are serialized and pages complete before exact counts start", async ({ page }) => {
  test.setTimeout(90_000);
  await installMockSupabase(page);
  const active = new Set<Request>();
  let peak = 0, completedPage = false, countBeforePage = false;
  const heavy = (url: string) => /\/rpc\/(app_home_|app_recruitment_list|app_recruitment_calendar|app_pipeline_summary)/.test(url);
  page.on("request", request => {
    if (!heavy(request.url())) return;
    if (request.url().endsWith("app_recruitment_list_count_v1") && !completedPage) countBeforePage = true;
    active.add(request); peak = Math.max(peak, active.size);
  });
  page.on("requestfinished", request => {
    if (request.url().endsWith("app_recruitment_list_v1")) completedPage = true;
    active.delete(request);
  });
  page.on("requestfailed", request => active.delete(request));
  await page.route("**/rest/v1/rpc/**", async route => {
    if (heavy(route.request().url())) await new Promise(resolve => setTimeout(resolve, 200));
    await route.fallback();
  });
  await page.goto("/home?lang=en");
  await expectWorkspaceReady(page);
  await expect.poll(() => completedPage).toBe(true);
  await expect.poll(() => countBeforePage).toBe(false);
  await expect(page.getByRole("tab", { name: "Open Headcount" })).toBeVisible();
  await expect.poll(() => active.size).toBe(0);
  expect(peak).toBe(1);
});
