import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("dashboard report controls persist date range and expandable sections in URL", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?start=2026-06-01&end=2026-07-11&details=open&funnel=open");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Vacancy Waterfall" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Opened Requisitions in Selected Range/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recruitment Pipeline Health in Selected Range/ })).toBeVisible();
  await expect(page.getByText("Bottleneck", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Weekly" })).toBeVisible();
  await expect(page.getByRole("row", { name: /HQ Operations Engineer L4 5 New 06\/01\/2026 Alice/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recruitment Pipeline Health" })).toBeVisible();

  await page.getByLabel("End Date").first().fill("2026-07-10");
  await expect(page).toHaveURL(/end=2026-07-10/);
});

test("home list sections use contained horizontal scroll over thresholds", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  await page.getByRole("dialog", { name: "Welcome Back" }).getByRole("button", { name: "Close", exact: true }).last().click();
  const pipelineScroller = page.locator('[data-home-scroll-section="Candidate Pipeline"]');
  await expect(pipelineScroller).toBeVisible();
  await expect(pipelineScroller).toHaveCSS("overflow-x", "auto");
  await expect(page.getByText("Pat Phone")).toBeVisible();
  await expect(page.getByText("Tina Test")).toBeVisible();
  await expect(page.getByRole("button", { name: /Show all .* pipeline items/ })).toHaveCount(0);

  const workScroller = page.locator('[data-home-scroll-section="Today\'s Work"]');
  await expect(workScroller).toBeVisible();
  await expect(workScroller).toHaveCSS("overflow-x", "auto");
  await expect(page.getByRole("button", { name: /Show all .* data quality issues/ })).toHaveCount(0);
});
