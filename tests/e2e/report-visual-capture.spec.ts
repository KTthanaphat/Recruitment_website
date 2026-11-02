import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

const output = path.resolve(process.cwd(), "outputs/recruitment-data-performance");

test("capture report desktop/tablet and restricted phone layouts", async ({ page }) => {
  fs.mkdirSync(output, { recursive: true });
  await installMockSupabase(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks&dashboardPeriod=pim&dashboardMonth=2026-07&queueStatus=all");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("region", { name: "Action queue", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(output, "bottlenecks-desktop-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 1024, height: 850 });
  await page.screenshot({ path: path.join(output, "bottlenecks-tablet-1024.png"), fullPage: true });

  await installMockSupabase(page, { role: "viewer" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard?dashboardTab=vacancy&vacancySubview=risk&dashboardPeriod=pim&dashboardMonth=2026-07&riskFilter=all");
  await expect(page.getByRole("heading", { name: "Dashboard — desktop layout required" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "risk-phone-restricted-390.png"), fullPage: true });
});
