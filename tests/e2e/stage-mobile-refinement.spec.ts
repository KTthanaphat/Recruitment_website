import { expect, test } from "@playwright/test";
import { Workbook } from "exceljs";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

const stageUrl = "/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks&dashboardPeriod=pim&dashboardMonth=2026-07&queueStatus=all";

test("Stage screen omits KPIs while PNG/Excel retain them and white banner retains warning border", async ({ page }, info) => {
  await installMockSupabase(page); await page.goto(stageUrl); await expectWorkspaceReady(page);
  const screen = page.locator("[data-risk-report]:visible");
  await expect(screen.locator("[data-bottleneck-metric]")).toHaveCount(0);
  const banner = screen.locator('section').filter({ has: page.getByRole("heading", { name: /^Primary bottleneck:/ }) });
  await expect(banner).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(banner).toHaveCSS("border-top-color", "rgb(255, 138, 0)");
  await expect(page.getByRole("heading", { name: "Stage completion time", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current waiting queue", exact: true })).toBeVisible();
  await banner.getByRole("button", { name: "View candidates", exact: true }).click();
  await expect(screen.getByRole("button", { name: "Stage", exact: true })).not.toHaveText(/All/);
  await page.getByRole("button", { name: "Export Stage Bottlenecks", exact: true }).click();
  const png = page.waitForEvent("download");
  await page.getByRole("button", { name: "Stage Bottlenecks PNG", exact: true }).click();
  await expect(page.locator("[data-risk-export] [data-bottleneck-metric]")).toHaveCount(4);
  const image = await png; await image.saveAs(info.outputPath("stage-summary-retained.png"));
  const stream = (await image.createReadStream())!; let bytes = 0; for await (const chunk of stream) bytes += chunk.length; expect(bytes).toBeGreaterThan(10000);
  await page.getByRole("button", { name: "Export Stage Bottlenecks", exact: true }).click();
  const xlsx = page.waitForEvent("download"); await page.getByRole("button", { name: "Export Stage Bottlenecks XLSX", exact: true }).click();
  const chunks: Buffer[] = []; for await (const chunk of (await (await xlsx).createReadStream())!) chunks.push(Buffer.from(chunk));
  const workbook = new Workbook(); await workbook.xlsx.load(Buffer.concat(chunks));
  expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(["Summary Data", "Source Data"]);
  const text = JSON.stringify(workbook.worksheets[0].getSheetValues());
  for (const label of ["Candidates waiting", "Median stage time", "Longest current wait"]) expect(text).toContain(label);
});

test("an open export defers desktop-required notice until it closes", async ({ page }) => {
  await installMockSupabase(page); await page.goto(stageUrl); await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Export Stage Bottlenecks", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toBeVisible(); await expect(page.locator("[data-desktop-required]")).toHaveCount(0);
  await page.keyboard.press("Escape"); await expect(page.locator("[data-desktop-required]")).toBeVisible();
});

test("late desktop data never publishes into an initial mobile restricted page", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  let release: (() => Promise<void>) | undefined;
  await page.route("**/rest/v1/candidates?**", async route => {
    release = () => route.fulfill({ contentType: "application/json", body: JSON.stringify(data.candidates) });
    await new Promise<void>(resolve => { const publish = release!; release = async () => { await publish(); resolve(); }; });
  });
  await page.goto(stageUrl);
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("[data-desktop-required]")).toBeVisible();
  await release!();
  await expect(page.locator("[data-risk-report]")).toHaveCount(0);
  await expect(page.locator("[data-desktop-required]")).toBeVisible();
});
