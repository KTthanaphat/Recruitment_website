import { test, expect, type Page, type Locator } from "@playwright/test";
import { installMockSupabase, expectWorkspaceReady } from "./support/mock-supabase";

async function start(page: Page, tab = "vacancy", language: "en" | "th" = "en") {
  const mock = await installMockSupabase(page, { language });
  await page.goto(`/dashboard?dashboardTab=${tab}&${tab === "vacancy" ? "vacancySubview=risk" : "pipelineSubview=bottlenecks"}&dashboardPeriod=pim&dashboardMonth=2026-07`);
  await expectWorkspaceReady(page);
  await expect(page.locator("[data-risk-report]:visible")).toBeVisible();
  return mock;
}
async function height(control: Locator, value: number) {
  await expect(control).toBeVisible();
  expect((await control.boundingBox())!.height, await control.getAttribute("aria-label") ?? await control.innerText()).toBe(value);
}

test("Dashboard controls are 32px while restored sidebar and operational details keep their geometry", async ({ page }) => {
  await start(page);
  const aside = page.locator("main > aside");
  await expect(aside).toHaveCSS("background-image", "linear-gradient(rgb(7, 27, 97) 0%, rgb(10, 60, 220) 100%)");
  await expect(aside.getByRole("link", { name: "Dashboard", exact: true })).toHaveCSS("background-color", "rgb(255, 255, 255)");
  for (const control of [page.getByRole("button", { name: "Export Vacancy Risk & Aging", exact: true }), page.getByRole("button", { name: "Refresh", exact: true }), page.locator("[data-app-header-filters]").getByRole("button", { name: "Site", exact: true }), page.getByRole("tab", { name: "Recruitment Performance", exact: true }), page.getByRole("tab", { name: "Risk & Aging", exact: true }), page.getByRole("button", { name: "Period", exact: true }), page.getByRole("button", { name: "View by", exact: true }), page.getByRole("button", { name: "Clear detail filters", exact: true })]) await height(control, 32);
  await expect(page.locator("[data-risk-open]:visible")).toHaveCSS("font-size", "32px");
  const before = await page.locator("[data-risk-open]:visible").innerText();
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click(); expect((await aside.boundingBox())!.width).toBe(72);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click(); expect((await aside.boundingBox())!.width).toBe(248);
  await expect(page.locator("[data-risk-open]:visible")).toHaveText(before);
   await height(page.locator("[data-app-header-filters]").getByRole("button", { name: "Site", exact: true }), 32);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Export Vacancy Risk & Aging", exact: true }).click();
  for (const label of ["Close", "Vacancy Risk & Aging PNG", "Export Vacancy Risk & Aging XLSX"]) await height(page.getByRole("dialog").getByRole("button", { name: label, exact: true }), 32);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Pipeline & Sources", exact: true }).click(); await page.getByRole("tab", { name: "Stage Bottlenecks", exact: true }).click();
  await page.getByRole("button", { name: "Clear detail filters", exact: true }).click();
  for (const control of [page.getByRole("button", { name: "Channel", exact: true }), page.getByRole("button", { name: "Stage", exact: true }), page.getByRole("button", { name: "Follow up", exact: true }).first()]) await height(control, 32);
  await page.getByRole("button", { name: "Follow up", exact: true }).first().click(); await expect(page.getByRole("dialog")).toBeVisible();
  expect((await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).boundingBox())!.height).toBe(36);
  await page.keyboard.press("Escape");
  await page.goto("/home"); await expectWorkspaceReady(page); await height(page.getByRole("button", { name: "Refresh", exact: true }), 36);
  await expect(aside).toHaveCSS("background-image", "linear-gradient(rgb(7, 27, 97) 0%, rgb(10, 60, 220) 100%)");
});

for (const site of ["HQ", "KT1", "KT2"]) test(`Dashboard restores ${site} profile accent and fixed switch/dropdown exceptions`, async ({ page }) => {
  const { data } = await installMockSupabase(page);
  data.profile!.site = site;
  const accent = { HQ: "10 160 195", KT1: "20 110 250", KT2: "65 30 220" }[site]!;
  await page.goto("/dashboard?dashboardTab=pipeline&pipelineSubview=overview&dashboardPeriod=pim&dashboardMonth=2026-07&funnelLegend=off"); await expectWorkspaceReady(page);
  expect(await page.locator("main").evaluate(el => getComputedStyle(el).getPropertyValue("--app-primary-rgb").trim())).toBe(accent);
  const toggle = page.getByRole("switch", { name: "Channel legend", exact: true }); await expect(toggle).toHaveCSS("height", "32px");
  await expect(toggle).toHaveCSS("background-color", "rgb(232, 240, 255)"); await toggle.click(); await page.mouse.move(0,0); await expect(toggle).toHaveCSS("background-color", "rgb(10, 60, 220)");
  await page.getByRole("button", { name: "Period", exact: true }).click(); await expect(page.getByRole("option", { name: "MTD", exact: true })).toHaveCSS("min-height", "36px"); await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Recruitment Performance", exact: true }).click(); await page.getByRole("tab", { name: "Vacancy & Requisitions", exact: true }).click(); await page.getByRole("tab", { name: "Risk & Aging", exact: true }).click();
   await page.locator("[data-app-header-filters]").getByRole("button", { name: "Site", exact: true }).click(); await page.getByRole("option", { name: "KT1", exact: true }).click();
  expect(await page.locator("main").evaluate(el => getComputedStyle(el).getPropertyValue("--app-primary-rgb").trim())).toBe(accent);
});

test("container layout, Thai/English phone targets and long names remain readable", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  data.candidates.find(row => row.candidate_id === "C-LINE")!.name = "Long synthetic candidate name for alignment ".repeat(4);
  data.requisitions[0].position = "Long synthetic position and department context ".repeat(4);
  await page.goto("/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks&dashboardPeriod=pim&dashboardMonth=2026-07"); await expectWorkspaceReady(page);
  await expect(page.locator("[data-risk-report]:visible")).toBeVisible(); await page.getByRole("button", { name: "Clear detail filters", exact: true }).click();
  for (const width of [1600, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const layout = await page.locator("[data-risk-report]:visible").evaluate(root => {
      const content = root; const panels = [...content.querySelectorAll("section")].filter(el => el.textContent?.startsWith("Stage completion time") || el.textContent?.startsWith("Current waiting queue"));
      return { width: root.clientWidth, panels: panels.slice(0,2).map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })) };
    });
    expect(layout.panels).toHaveLength(2);
    if (layout.panels.length === 2) { if (layout.width >= 960) expect(layout.panels[0].y).toBe(layout.panels[1].y); else expect(layout.panels[1].y).toBeGreaterThan(layout.panels[0].y); }
    await height(page.getByRole("tab", { name: "Stage Bottlenecks", exact: true }), width < 640 ? 44 : 32);
    if (width < 640) {
      for (const control of [page.getByRole("button", { name: "Export Stage Bottlenecks", exact: true }), page.getByRole("button", { name: "Channel", exact: true }), page.getByRole("button", { name: "Follow up", exact: true }).first(), page.getByRole("button", { name: "Period", exact: true })]) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: test.info().outputPath(`compact-en-${width}.png`), fullPage: true });
    }
  }
  await page.getByRole("button", { name: "TH", exact: true }).click(); await expect(page.getByRole("region", { name: "คอขวดในกระบวนการสรรหา", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await page.screenshot({ path: test.info().outputPath("compact-th-360.png"), fullPage: true });
});

test.describe("touch toolbar", () => {
test.use({ hasTouch: true });
test("coarse-pointer desktop retains 44px toolbar targets", async ({ page }) => {
  await page.setViewportSize({ width:1280, height:900 }); await start(page);
  for (const control of [page.getByRole("button", { name: "Export Vacancy Risk & Aging", exact: true }), page.getByRole("button", { name: "Refresh", exact: true }), page.getByRole("button", { name: "Period", exact: true })]) expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

});
