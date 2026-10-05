import { expect, test, type Page } from "@playwright/test";
import { dashboardDefaults, dashboardLevelMatches, dashboardRange, restoreDashboardPreferences } from "../../src/lib/dashboard-filters";
import { previousPerformanceRange } from "../../src/lib/recruitment-performance";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";
import { installPerformanceFixture } from "./support/performance-fixture";

const filters = (page: Page) => page.locator("[data-dashboard-filters]");
const report = (page: Page) => page.locator("[data-performance-overview] [data-performance-report]").first();
async function select(page: Page, name: string, option: string) {
  await filters(page).getByRole("button", { name, exact: true }).click();
  await filters(page).getByRole("listbox", { name, exact: true }).getByRole("option", { name: option, exact: true }).click();
  await page.keyboard.press("Escape");
}

test("common date resolver validates calendar dates, current cutoff and comparison boundaries", () => {
  const state = dashboardDefaults("2026-07-24");
  expect(dashboardRange(state, "2026-07-24")).toEqual({ start: "2026-07-01", end: "2026-07-24", valid: true });
  expect(dashboardRange({ ...state, period: "pim" }, "2026-07-24").end).toBe("2026-07-31");
  expect(dashboardRange({ ...state, period: "ytd", month: "2024-02" }, "2026-07-24")).toEqual({ start: "2024-01-01", end: "2024-02-29", valid: true });
  expect(dashboardRange({ ...state, period: "custom", customStart: "2026-02-30", customEnd: "2026-03-01" }, "2026-07-24").valid).toBe(false);
  expect(dashboardRange({ ...state, period: "custom", customStart: "2026-07-25", customEnd: "2026-07-24" }, "2026-07-24").valid).toBe(false);
  expect(previousPerformanceRange("custom", { start: "2026-07-24", end: "2026-07-24" })).toEqual({ start: "2026-07-23", end: "2026-07-23" });
  expect(previousPerformanceRange("ytd", { start: "2024-01-01", end: "2024-02-29" }).end).toBe("2023-02-28");
  expect(dashboardLevelMatches(null, [])).toBe(true);
  expect(dashboardLevelMatches("L13", ["10-14"])).toBe(true);
  expect(dashboardLevelMatches("L3junk", ["0-3"])).toBe(false);
});

test("canonical and conflicting legacy links restore deterministic common scope", () => {
  const defaults = dashboardDefaults("2026-07-24");
  const legacy = restoreDashboardPreferences(new URLSearchParams('overviewPeriod=pim&overviewYear=2026&overviewMonth=6&reportView=ytd&reportMonth=2026-07&overviewDepartment=Operations%2C%20Planning&funnelLevel=0-3'), defaults);
  expect(legacy.tab).toBe("performance"); expect(legacy.period).toBe("pim"); expect(legacy.month).toBe("2026-06");
  expect(legacy.departments).toEqual(["Operations, Planning"]); expect(legacy.levels).toEqual(["0-3"]);
  const canonical = restoreDashboardPreferences(new URLSearchParams('dashboardTab=pipeline&dashboardPeriod=custom&dashboardSites=[]&overviewSite=HQ&funnelStart=2026-07-01&funnelEnd=2026-07-31'), defaults);
  expect(canonical.sites).toEqual([]); expect(canonical.tab).toBe("pipeline"); expect(canonical.customEnd).toBe("2026-07-31");
});

test("shared filters reconcile all reports and Channel stays local", async ({ page }) => {
  const { data } = await installMockSupabase(page); installPerformanceFixture(data);
  await page.goto("/dashboard?overviewPeriod=pim&overviewYear=2026&overviewMonth=6"); await expectWorkspaceReady(page);
  await expect(report(page).locator('[data-metric="vacancies"] [data-metric-value]')).toHaveText("40");
  await expect(report(page).locator('[data-metric="filled"] [data-metric-value]')).toHaveText("16");
  await expect(filters(page).getByRole("button", { name: "Period", exact: true })).toHaveCSS("font-weight", "400");
  expect((await filters(page).boundingBox())!.height).toBeLessThan(80);
  await expect(filters(page).getByRole("button", { name: "Period", exact: true })).toHaveCSS("height", "32px");
  await filters(page).getByRole("button", { name: "Applied scope", exact: true }).focus();
  await expect(page.getByRole("tooltip")).toContainText("01/06/2026");
  await filters(page).getByRole("button", { name: "Applied scope", exact: true }).press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await select(page, "Site", "KT1");
  await expect(report(page).locator('[data-metric="vacancies"] [data-metric-value]')).toHaveText("21");
  await select(page, "Job Level", "L0–L3");
  await expect(report(page).locator('[data-metric="vacancies"] [data-metric-value]')).toHaveText("18");
  await page.goBack();
  await expect(filters(page).getByRole("button", { name: "Job Level" })).toContainText("All");
  await expect(report(page).locator('[data-metric="vacancies"] [data-metric-value]')).toHaveText("21");
  await page.goForward();
  await expect(report(page).locator('[data-metric="vacancies"] [data-metric-value]')).toHaveText("18");
  await page.getByRole("tab", { name: "Recruitment Performance", exact: true }).click(); await page.getByRole("tab", { name: "Vacancy & Requisitions" }).click();
  const vacancy = page.getByRole("tabpanel", { name: "Vacancy & Requisitions" });
  await expect(vacancy.getByRole("heading", { name: "Requisitions Active in Selected Period", exact: true })).toBeVisible();
  await expect(vacancy.locator("[data-requisition-detail-table] tbody tr")).toHaveCount(2);
  await page.getByRole("tab", { name: "Pipeline & Sources" }).click();
  await expect(page.getByRole("tabpanel", { name: "Pipeline & Sources" }).getByTestId("pipeline-source-layout")).toBeVisible();
  await expect(page.locator("[data-testid=pipeline-filters]")).not.toContainText("Metric view");
  const channel = page.getByRole("tabpanel", { name: "Pipeline & Sources" }).getByRole("button", { name: "Channel", exact: true });
  await channel.click(); await page.getByRole("listbox", { name: "Channel", exact: true }).getByRole("option", { name: "Facebook", exact: true }).click();
  await page.getByRole("tab", { name: "Recruitment Performance" }).click();
  await page.getByRole("tab", { name: "Performance", exact: true }).click();
  await expect(report(page).locator('[data-metric="vacancies"] [data-metric-value]')).toHaveText("18");
  await page.getByRole("tab", { name: "Pipeline & Sources" }).click(); await expect(channel).toContainText("Facebook");
});

test("session memory, URL precedence, tab history and reset preserve header scope", async ({ page }) => {
  const { data } = await installMockSupabase(page); installPerformanceFixture(data);
  data.requisitions.forEach(row => { row.department = row.site === "KT1" ? "Production" : "Operations"; });
  await page.goto("/dashboard?overviewPeriod=pim&overviewYear=2026&overviewMonth=6&site=KT1&priority=all"); await expectWorkspaceReady(page);
  await select(page, "Department", "Production");
  await page.getByRole("tab", { name: "Pipeline & Sources" }).click();
  await page.getByRole("switch", { name: "Channel legend" }).click();
  await page.getByRole("link", { name: "Configuration", exact: true }).click(); await expectWorkspaceReady(page);
  await page.getByRole("link", { name: "Dashboard", exact: true }).click(); await expectWorkspaceReady(page);
  await expect(page.getByRole("tab", { name: "Pipeline & Sources" })).toHaveAttribute("aria-selected", "true");
  await expect(filters(page).getByRole("button", { name: "Department" })).toContainText("Production");
  await expect(page.getByRole("switch", { name: "Channel legend" })).toHaveAttribute("aria-checked", "false");
  await page.reload(); await expectWorkspaceReady(page);
  await expect(page.getByRole("tab", { name: "Pipeline & Sources" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Recruitment Performance", exact: true }).click(); await page.getByRole("tab", { name: "Vacancy & Requisitions" }).click(); await page.goBack(); await page.goBack();
  await expect(page.getByRole("tab", { name: "Pipeline & Sources" })).toHaveAttribute("aria-selected", "true");
  await page.goto('/dashboard?site=KT1&dashboardTab=performance&dashboardPeriod=pim&dashboardMonth=2026-06&dashboardDepartments=[]'); await expectWorkspaceReady(page);
  await expect(filters(page).getByRole("button", { name: "Department" })).toContainText("All");
  await filters(page).getByRole("button", { name: "Reset dashboard filters" }).click();
  await expect(filters(page).getByRole("button", { name: "Period", exact: true })).toContainText("MTD");
  await expect(page.locator("[data-dashboard-summary]")).toContainText("Site: KT1");
  await filters(page).getByRole("button", { name: "Site", exact: true }).click();
  await expect(filters(page).getByRole("listbox", { name: "Site" }).getByRole("option")).toHaveText(["All", "KT1"]);
});

test("site changes prune unavailable departments without narrowing options by period or level", async ({ page }) => {
  const { data } = await installMockSupabase(page); installPerformanceFixture(data);
  data.requisitions.forEach(row => { row.department = row.site === "KT1" ? "Production" : "Operations, Planning"; });
  await page.goto('/dashboard?dashboardPeriod=pim&dashboardMonth=2026-06&dashboardDepartments=%5B%22Operations%2C%20Planning%22%5D'); await expectWorkspaceReady(page);
  await expect(filters(page).getByRole("button", { name: "Department" })).toContainText("Operations, Planning");
  await select(page, "Site", "KT1");
  await expect(filters(page).getByRole("button", { name: "Department" })).toContainText("All");
  await expect(filters(page).getByRole("status")).toContainText("Unavailable selections");
  await select(page, "Job Level", "L10–L14");
  await filters(page).getByRole("button", { name: "Department" }).click();
  await expect(filters(page).getByRole("listbox", { name: "Department" }).getByRole("option")).toHaveText(["All", "Production"]);
});

test("sign-out clears session dashboard preferences", async ({ page }) => {
  await installMockSupabase(page);
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204 }));
  await page.goto("/dashboard?dashboardTab=pipeline"); await expectWorkspaceReady(page);
  await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("recruitment.dashboard.v1:")).length)).toBe(1);
  await page.getByLabel("Open account menu", { exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith("recruitment.dashboard.v1:")))).toEqual([]);
});

test("invalid Custom range hides results and exports, valid single day renders Performance", async ({ page }) => {
  await installMockSupabase(page);
  await page.goto("/dashboard?dashboardPeriod=custom&dashboardStart=2026-07-25&dashboardEnd=2026-07-24"); await expectWorkspaceReady(page);
  await expect(filters(page).getByRole("alert")).toContainText("Start must be on or before end");
  await expect(page.getByRole("button", { name: /Export/ })).toHaveCount(0);
  await page.goto("/dashboard?dashboardPeriod=custom&dashboardStart=2026-07-24&dashboardEnd=2026-07-24"); await expectWorkspaceReady(page);
  await expect(report(page)).toBeVisible(); await expect(report(page)).toContainText("vs prior CUSTOM");
  await expect(page.locator("[data-dashboard-summary]")).toContainText("24/07/2026 – 24/07/2026");
});

test("portal and folder browser fit Thai and English desktop layouts", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await installMockSupabase(page);
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/dashboard?dashboardPeriod=pim&dashboardMonth=2026-07", "/configuration"]) {
      await page.goto(path); await expectWorkspaceReady(page);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  }
  await page.goto("/dashboard?lang=th&dashboardPeriod=pim&dashboardMonth=2026-07"); await expectWorkspaceReady(page);
  await expect(filters(page).getByRole("button", { name: "ช่วงรายงาน" })).toBeVisible();
  await expect(filters(page).getByRole("button", { name: "ช่วงรายงาน" })).toHaveCSS("height", "32px");
  await filters(page).getByRole("button", { name: "เดือนรายงาน", exact: true }).click();
  const monthBounds = (await page.getByRole("dialog", { name: "เดือนรายงาน", exact: true }).boundingBox())!;
  expect(monthBounds.x).toBeGreaterThanOrEqual(0); expect(monthBounds.x + monthBounds.width).toBeLessThanOrEqual(1024);
  await filters(page).getByRole("button", { name: "เดือนรายงาน", exact: true }).press("Escape");
  const selected = page.getByRole("tab", { name: "ผลการสรรหา", exact: true }); await selected.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "กระบวนการและช่องทางสรรหา", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("dashboard-phone-th.png"), fullPage: true });
});
