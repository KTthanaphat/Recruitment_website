import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test.setTimeout(60_000);
function gate() { let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }); return { pending, release }; }

test("initial candidate skeleton preserves headers and has five inert rows", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  const hold = gate();
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1", async route => { if (route.request().postDataJSON().p_entity === "candidate_registry") await hold.pending; await route.fallback(); });
  await page.goto("/candidates?lang=en"); await expectWorkspaceReady(page);
  const skeleton = page.locator("table [data-loading-skeleton=table]");
  await expect(skeleton).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Candidate", exact: true })).toBeVisible();
  await expect(skeleton.locator(".ats-skeleton-row")).toHaveCount(5);
  await expect(skeleton.locator("button,input,a")).toHaveCount(0);
  await expect(page.getByText("No matching candidates.", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "outputs/loading-feedback/skeleton-desktop-en.png", fullPage: true });
  hold.release();
  await expect(skeleton).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Pat Phone/ }).first()).toBeVisible();
});

test("same-query refresh keeps candidates but changed search removes the old snapshot", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  let hold: ReturnType<typeof gate> | null = null;
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1", async route => { if (route.request().postDataJSON().p_entity === "candidate_registry" && hold) await hold.pending; await route.fallback(); });
  await page.goto("/candidates?lang=en"); await expectWorkspaceReady(page);
  const candidate = page.getByRole("button", { name: /Pat Phone/ }).first(); await expect(candidate).toBeVisible();
  hold = gate(); await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator("[data-refreshing=true]").first()).toBeVisible();
  await expect(candidate).toBeVisible(); await expect(page.locator("[data-loading-skeleton]")).toHaveCount(0);
  hold.release(); await expect(page.locator("[data-refreshing=true]")).toHaveCount(0);
  hold = gate(); await page.getByRole("searchbox").fill("NO-MATCH-SKELETON");
  await expect(page.locator("table [data-loading-skeleton=table]")).toBeVisible(); await expect(candidate).toHaveCount(0);
  hold.release(); await expect(page.getByText("No matching candidates.", { exact: true })).toBeVisible();
  hold = gate(); await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator("[data-refreshing=true]").first()).toBeVisible();
  await expect(page.getByText("No matching candidates.", { exact: true })).toBeVisible();
  await expect(page.locator("[data-loading-skeleton]")).toHaveCount(0); hold.release();
});

test("retry icon is keyboard accessible, has a focus tooltip and only retries once", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  let calls = 0; const hold = gate();
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1", async route => {
    if (route.request().postDataJSON().p_entity !== "candidate_registry") return route.fallback();
    calls++; if (calls === 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Read unavailable" }) });
    await hold.pending; return route.fallback();
  });
  await page.goto("/candidates?lang=en"); await expectWorkspaceReady(page);
  const retry = page.getByRole("button", { name: "Retry", exact: true }); await expect(retry).toBeVisible();
  await expect(retry.locator("svg")).toHaveCount(1); await expect(retry).not.toHaveText("Retry");
  await retry.focus(); await expect(page.getByRole("tooltip")).toBeVisible(); await page.keyboard.press("Enter");
  await expect(page.locator("table [data-loading-skeleton]")).toBeVisible(); expect(calls).toBe(2);
  hold.release(); await expect(page.getByRole("button", { name: /Pat Phone/ }).first()).toBeVisible();
});

test("count retries do not replace loaded candidate rows", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter", countFailureOnceEntity: "candidate_registry" });
  await page.goto("/candidates?lang=en"); await expectWorkspaceReady(page);
  const candidate = page.getByRole("button", { name: /Pat Phone/ }).first(); await expect(candidate).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry count", exact: true }); await expect(retry).toBeVisible();
  await retry.click(); await expect(candidate).toBeVisible(); await expect(retry).toHaveCount(0);
  await expect(page.locator("[data-loading-skeleton]")).toHaveCount(0);
});

test("phone Thai skeleton respects reduced motion and retry hit targets", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" }); const hold = gate(); let fail = true;
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1", async route => { if (route.request().postDataJSON().p_entity !== "candidate_registry") return route.fallback(); await hold.pending; if (fail) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Unavailable" }) }); return route.fallback(); });
  await page.goto("/candidates?lang=th"); await expectWorkspaceReady(page);
  const skeleton = page.locator("[data-loading-skeleton=table]").filter({ visible: true }); await expect(skeleton).toBeVisible();
  expect(await skeleton.locator(".ats-skeleton").first().evaluate(node => getComputedStyle(node).animationName)).toBe("none");
  await page.screenshot({ path: "outputs/loading-feedback/skeleton-phone-th.png", fullPage: true });
  hold.release(); const retry = page.getByRole("button", { name: "ลองอีกครั้ง", exact: true }); await expect(retry).toBeVisible();
  const box = await retry.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: "outputs/loading-feedback/retry-phone-th.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); fail = false;
});


test("pipeline shows three placeholder cards per stage while candidates load", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" }); const hold = gate();
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1", async route => { if (route.request().postDataJSON().p_entity === "pipeline_stage") await hold.pending; await route.fallback(); });
  await page.goto("/workspace?lang=en&type=group&id=GRP-ENG&section=pipeline"); await expectWorkspaceReady(page);
  const skeleton = page.locator("[data-loading-skeleton=cards]").filter({ visible: true }).first();
  await expect(skeleton).toBeVisible(); await expect(skeleton.locator(".ats-skeleton-row")).toHaveCount(3);
  hold.release(); await expect(page.getByRole("button", { name: /^Pat Phone C-PHONE/ })).toBeVisible();
});

test("candidate identity change uses detail skeleton rather than previous profile", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" }); let hold: ReturnType<typeof gate> | null = null;
  await page.route("**/rest/v1/candidate_reference_checks?**", async route => { if (hold) await hold.pending; await route.fallback(); });
  await page.goto("/workspace?lang=en&type=group&id=GRP-ENG&section=pipeline"); await expectWorkspaceReady(page);
  await page.getByRole("button", { name: /^Pat Phone C-PHONE/ }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Application details", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  hold = gate(); await page.getByRole("button", { name: /^Penny Phone Pass C-PHONE-PASS/ }).click();
  const detail = page.getByRole("dialog"); await expect(detail.locator("[data-loading-skeleton=detail]")).toBeVisible();
  await expect(detail).not.toContainText("Pat Phone"); hold.release();
  await expect(detail).toContainText("Penny Phone Pass"); await expect(detail.getByRole("heading", { name: "Application details", exact: true })).toBeVisible();
});

test("report summary uses chart skeleton until its aggregate arrives", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" }); const hold = gate();
  await page.route("**/rest/v1/rpc/app_dashboard_performance_summary_v1", async route => { await hold.pending; await route.fallback(); });
  await page.goto("/dashboard?lang=en&dashboardTab=performance&performanceSubview=overview&dashboardPeriod=ytd&dashboardMonth=2026-07");
  await expectWorkspaceReady(page); await expect(page.locator("[data-loading-skeleton=chart]")).toBeVisible();
  hold.release(); await expect(page.getByRole("heading", { name: "Total Vacancies", exact: true })).toBeVisible();
});


test("Home quality snapshot shows loaded rows after its initial skeleton", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home?lang=en"); await expectWorkspaceReady(page);
  const welcome = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcome.isVisible()) await welcome.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("tab", { name: /Data quality/i }).click();
  await expect(page.locator("[data-home-quality-row]").first()).toBeVisible();
  await expect(page.locator("[data-home-record-list] [data-loading-skeleton]")).toHaveCount(0);
});
