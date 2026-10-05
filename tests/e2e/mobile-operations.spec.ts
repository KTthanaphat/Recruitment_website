import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

for (const width of [390, 768, 1023]) test(`three destinations and Records sheet work at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await installMockSupabase(page, { role: "system_admin" });
  await page.goto("/pipeline?lang=en&site=KT1&pic=Bob&priority=only&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  const navigation = page.locator('nav[aria-label="Main navigation"]:visible');
  await expect(navigation.getByRole("link")).toHaveCount(2);
  await expect(navigation.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Workspace", exact: true })).toBeVisible();
  const records = navigation.getByRole("button", { name: "Records", exact: true });
  await expect(records).toHaveAttribute("aria-current", "page");
  expect((await records.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await records.click();
  const sheet = page.getByRole("dialog", { name: "Records", exact: true });
  await expect(sheet.getByRole("link")).toHaveCount(5);
  await expect(sheet.getByRole("link")).toHaveText(["Requisitions", "Sourcing", "Candidates", "Pipeline", "Offers"]);
  await expect(sheet.getByRole("link", { name: "Pipeline", exact: true })).toHaveAttribute("aria-current", "page");
  for (const link of await sheet.getByRole("link").all()) {
    const url = new URL((await link.getAttribute("href"))!, "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ lang: "en", site: "KT1", pic: "Bob", priority: "only", sourcingWeek: "2026-07-04" });
  }
  await sheet.getByRole("link", { name: "Offers", exact: true }).focus();
  await page.keyboard.press("Tab"); await expect(sheet.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(sheet.getByRole("link", { name: "Offers", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(records).toBeFocused();
  await records.click(); await sheet.getByRole("link", { name: "Candidates", exact: true }).click();
  await expectWorkspaceReady(page); await expect(sheet).toHaveCount(0); await expect(page).toHaveURL(/candidates/);
  await records.click(); await page.setViewportSize({ width: 1024, height: 900 });
  await expect(sheet).toHaveCount(0); await expect(page.locator("aside")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const role of ["system_admin", "admin_recruiter", "site_recruiter", "viewer"] as const) test(`${role} mobile desktop-only routes load profile only and retain URL`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await installMockSupabase(page, { role });
  const requests: string[] = []; page.on("request", request => { if (request.url().includes("/rest/v1/")) requests.push(new URL(request.url()).pathname); });
  for (const route of ["dashboard", "configuration", "audit", "admin"]) {
    requests.length = 0;
    const target = `/${route}?lang=en&site=KT1&pic=Bob&priority=only&keep=unchanged`;
    await page.goto(target); await expect(page.locator("[data-desktop-required]")).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(target);
    expect(requests.length).toBeGreaterThan(0); expect([...new Set(requests)]).toEqual(["/rest/v1/profiles"]);
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toHaveCount(0);
    await expect(page.locator("[data-app-header-filters]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "TH", exact: true })).toBeVisible();
    await expect(page.locator("[data-risk-report], .configuration-browser")).toHaveCount(0);
    await page.reload(); await expect(page.locator("[data-desktop-required]")).toBeVisible();
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(target);
  }
});

for (const language of ["en", "th"] as const) test(`mobile operational routes and localized notices fit ${language}`, async ({ page }, info) => {
  test.setTimeout(120_000);
  const mock = await installMockSupabase(page, { language });
  for (const width of [360, 390, 768, 1023]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["home", "workspace", "requisitions", "sourcing", "candidates", "pipeline", "offers"]) {
      await page.goto(`/${route}?lang=${language}`); await expectWorkspaceReady(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(mock.rpcCalls.some(call => call.endpoint === "app_dashboard_company_report")).toBe(false);
    await page.goto(`/dashboard?lang=${language}`); await expect(page.locator("[data-desktop-required]")).toBeVisible();
    await expect(page.locator("[data-desktop-required]")).toContainText("1024");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 360) await page.screenshot({ path: info.outputPath(`mobile-notice-${language}-360.png`), fullPage: true });
  }
});

test("signed-out mobile restricted route follows existing login flow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/); await expect(page.locator("[data-desktop-required]")).toHaveCount(0);
});

test("desktop route resumes across breakpoint without URL or preference loss", async ({ page }) => {
  await page.setViewportSize({ width: 1023, height: 900 }); await installMockSupabase(page);
  await page.goto("/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks&dashboardPeriod=pim&dashboardMonth=2026-07&queueStatus=all&keep=yes");
  await expect(page.locator("[data-desktop-required]")).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 900 }); await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Stage Bottlenecks", exact: true })).toBeVisible();
  const url = page.url();
  await page.setViewportSize({ width: 390, height: 900 }); await expect(page.locator("[data-desktop-required]")).toBeVisible(); expect(page.url()).toBe(url);
  await page.setViewportSize({ width: 1280, height: 900 }); await expect(page.getByRole("heading", { name: "Stage Bottlenecks", exact: true })).toBeVisible(); expect(page.url()).toBe(url);
  await expect(page.getByRole("button", { name: /^All / })).toHaveAttribute("aria-pressed", "true");
});

test("Configuration draft survives resize until editor closes", async ({ page }) => {
  await installMockSupabase(page); await page.goto("/configuration?configurationFolder=reasons/candidate"); await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Add main reason", exact: true }).click();
  await page.getByLabel("English label").fill("Preserved synthetic draft");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("English label")).toHaveValue("Preserved synthetic draft"); await expect(page.locator("[data-desktop-required]")).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 }); await expect(page.getByLabel("English label")).toHaveValue("Preserved synthetic draft");
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator("[data-desktop-required]")).toBeVisible();
});

test("Configuration save remains mounted until its catalog refresh completes", async ({ page }) => {
  await installMockSupabase(page); await page.goto("/configuration?configurationFolder=reasons/candidate"); await expectWorkspaceReady(page);
  let release: (() => Promise<void>) | undefined;
  await page.route("**/rest/v1/rejection_reasons*", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await new Promise<void>(resolve => { release = async () => { await route.fallback(); resolve(); }; });
  });
  await page.getByRole("button", { name: "Add main reason", exact: true }).click();
  await page.getByLabel("Thai label").fill("เหตุผลทดสอบ"); await page.getByLabel("English label").fill("Synthetic saved reason");
  await page.getByRole("button", { name: "Save", exact: true }).click(); await expect.poll(() => Boolean(release)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.getByLabel("English label")).toHaveValue("Synthetic saved reason");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled(); await expect(page.locator("[data-desktop-required]")).toHaveCount(0);
  await release!(); await expect(page.locator("[data-desktop-required]")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator("[data-configuration-contents]")).toContainText("Synthetic saved reason");
});

test("blocked mobile account menu retains sign-out", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await installMockSupabase(page);
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204 }));
  await page.goto("/dashboard"); await expect(page.locator("[data-desktop-required]")).toBeVisible();
  await page.getByLabel("Open account menu").click(); await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("phone Pipeline and Sourcing retain internal, not page-level, wide-data scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("button", { name: "Candidate Pipeline", exact: true })).toBeVisible();
  const pipelineOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(pipelineOverflow).toBe(false);

  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Weekly work", exact: true })).toBeVisible();
  await expect(page.getByRole("article").first()).toBeVisible();
  const sourcingOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sourcingOverflow).toBe(false);
});

test("Workspace Pipeline uses collapsed stage rows instead of a phone board", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&section=pipeline");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Active candidates", { exact: true })).toBeHidden();
  const stages = page.locator("[data-workspace-pipeline-stages] details");
  await expect(stages).toHaveCount(7);
  const phoneStage = page.getByText("Phone Screening", { exact: true }).locator("xpath=ancestor::details[1]");
  await expect(phoneStage).not.toHaveAttribute("open", "");
  await phoneStage.locator("summary").click();
  await expect(phoneStage).toHaveAttribute("open", "");
  await expect(phoneStage.getByText("Pat Phone", { exact: true })).toBeVisible();
  await phoneStage.getByRole("button", { name: "Candidate actions for Pat Phone" }).click();
  const actions = page.getByRole("menu", { name: "Candidate actions for Pat Phone" });
  await expect(actions).toBeVisible();
  await expect.poll(() => actions.getByRole("menuitem").count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
