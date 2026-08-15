import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("phone navigation keeps core destinations visible and moves secondary routes into More", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/pipeline?lang=en&site=KT1&pic=Bob&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Workspace" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Pipeline" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Candidates" })).toBeVisible();
  await navigation.getByRole("button", { name: "More" }).click();
  const more = page.getByRole("dialog", { name: "More" });
  await expect(more.getByRole("link", { name: "Requisitions" })).toHaveAttribute("href", /sourcingWeek=2026-07-06/);
  await expect(more.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(navigation.getByRole("button", { name: "More" })).toBeFocused();
});

test("phone Pipeline and Sourcing retain internal, not page-level, wide-data scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("combobox", { name: "Candidate Pipeline" })).toBeVisible();
  const pipelineOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(pipelineOverflow).toBe(false);

  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  await expect(page.getByText("Selected-week Group Summary")).toBeVisible();
  await expect(page.locator("table").filter({ hasText: "Group ID" })).toBeHidden();
  const sourcingOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(sourcingOverflow).toBe(false);
});

test("phone Audit uses a filter sheet and key recruiter routes have no page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  for (const route of ["/home", "/workspace", "/requisitions", "/candidates", "/offers", "/dashboard", "/audit"]) {
    await page.goto(route);
    await expectWorkspaceReady(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  }
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Filters" })).toBeFocused();
});

test("tablet keeps the adaptive bottom navigation without page-level overflow", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Workspace" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
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
