import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("pipeline board renders active, failed, passed, aging, and filtered candidates", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Phone Screening", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No activity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "HR Interview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Line Interview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference Check", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Offer", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resume Screening", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Phone Screening", exact: true })).toHaveCSS("color", "rgb(255, 59, 48)");
  await expect(page.getByRole("heading", { name: "No activity", exact: true })).toHaveCSS("color", "rgb(11, 19, 43)");
  await expect(page.getByText("SLA 2 - Oldest 24d - Average 17d")).toHaveCount(0);
  const phoneStage = page.getByRole("heading", { name: "Phone Screening", exact: true }).locator("xpath=ancestor::section[1]");
  await expect(phoneStage.locator("article strong")).toContainText(["Avery Aging", "Pat Phone", "Penny Phone Pass"]);
  await expect.poll(async () => phoneStage.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgb(255, 255, 255)");

  await expect(page.getByText("Pat Phone")).toBeVisible();
  await expect(page.getByText("Nora No Activity")).toBeVisible();
  await expect(page.getByText("Active candidates")).toBeVisible();
  await expect(page.getByText("Aging", { exact: true })).toBeVisible();
  await expect(page.getByText("Avery Aging")).toBeVisible();
  await expect(page.getByText("Tina Test")).toBeVisible();
  await expect(page.getByText("Failed Candidates - Last 7 Days")).toBeVisible();
  await expect(page.getByText("Finn Failed")).toBeVisible();
  await expect(page.getByText("Passed Offer - Last 7 Days")).toBeVisible();
  await expect(page.getByText("Olivia Offer Pass")).toBeVisible();
  await expect(page.getByText("Oscar Offer Needed")).toBeVisible();
  await expect(page.locator("#pipeline-candidate-C-OFFER-NO-OFFER").getByRole("button", { name: "Create offer" })).toBeVisible();
  await expect(page.locator("#pipeline-candidate-C-OFFER-PASS").getByRole("button", { name: "Create offer" })).toHaveCount(0);
  await expect(page.locator("#pipeline-candidate-C-AGING").getByRole("button", { name: "Candidate actions for Avery Aging" })).toHaveCSS("color", "rgb(255, 59, 48)");
  await expect(page.locator("#pipeline-candidate-C-PHONE").getByRole("button", { name: "Candidate actions for Pat Phone" })).toHaveCSS("color", "rgb(255, 59, 48)");

  const filterButton = page.getByRole("button", { name: "Pipeline filters" });
  const siteGroupButton = page.getByRole("button", { name: "Site" });
  const ownerGroupButton = page.getByRole("button", { name: "Owner" });
  const filterBox = await filterButton.boundingBox();
  const siteBox = await siteGroupButton.boundingBox();
  const ownerBox = await ownerGroupButton.boundingBox();
  expect(filterBox?.x ?? 0).toBeGreaterThan((siteBox?.x ?? 0) + (siteBox?.width ?? 0));
  expect(filterBox?.x ?? 0).toBeGreaterThan((ownerBox?.x ?? 0) + (ownerBox?.width ?? 0));
  await filterButton.click();
  const filterDialog = page.getByRole("dialog", { name: "Pipeline filters" });
  await expect(filterDialog).toBeVisible();
  await filterDialog.getByLabel("Search pipeline").fill("Tina");
  await page.keyboard.press("Escape");
  await expect(filterDialog).toHaveCount(0);
  await expect(filterButton).toBeFocused();
  await expect(filterButton).toHaveAccessibleName("Pipeline filters, 1 active");
  await expect(page.getByText("Tina Test")).toBeVisible();
  await expect(page.getByText("Pat Phone")).toHaveCount(0);

  await page.locator("[data-app-header-actions]").getByLabel("Site", { exact: true }).selectOption("KT1");
  await expect(page.getByText("Tina Test")).toBeVisible();
  await expect(page.getByText("Pat Phone")).toHaveCount(0);
});

test("pipeline search, grouping, and board filters narrow by pipeline context", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });

  for (const [query, expected] of [
    ["C-REF", "Rae Reference"],
    ["REQ-KT2-1", "Rae Reference"],
    ["Analyst", "Rae Reference"],
    ["Alice", "Pat Phone"]
  ] as const) {
    await page.goto(`/pipeline?pipelineSearch=${encodeURIComponent(query)}`);
    await expectWorkspaceReady(page);
    await expect(page.getByText(expected)).toBeVisible();
  }

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Owner" }).click();
  await expect(page.locator("xpath=//p[contains(@class, 'text-[11px]') and normalize-space(.)='Alice']").first()).toBeVisible();
  await expect(page.locator("xpath=//p[contains(@class, 'text-[11px]') and normalize-space(.)='Bob']").first()).toBeVisible();

  await page.getByRole("button", { name: "Pipeline filters" }).click();
  await page.getByRole("button", { name: "No activity", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Nora No Activity")).toBeVisible();
  await expect(page.getByText("Pat Phone")).toHaveCount(0);

  await page.getByRole("button", { name: /Pipeline filters/ }).click();
  await page.getByRole("button", { name: "Offer pending", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Nina Offer Ready")).toBeVisible();
  await expect(page.getByText("Nora No Activity")).toHaveCount(0);
});

test("passed Offer card without an offer opens offer creation flow", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.locator("#pipeline-candidate-C-OFFER-NO-OFFER").getByRole("button", { name: "Create offer" }).click();
  const dialog = page.getByRole("dialog", { name: /Offer/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Candidate")).toHaveValue("C-OFFER-NO-OFFER");
  await expect(dialog.getByLabel("Accepted Date")).toHaveValue("2026-07-18");
});

test("viewer can inspect pipeline but cannot update stages or create offers", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Pat Phone")).toBeVisible();
  await expect(page.getByRole("button", { name: "Candidate actions for Pat Phone" })).toHaveCount(0);
  await expect(page.locator("#pipeline-candidate-C-OFFER-NO-OFFER").getByRole("button", { name: "Create offer" })).toHaveCount(0);
  await page.locator("#pipeline-candidate-C-OFFER-NO-OFFER").getByRole("button", { name: /Oscar Offer Needed/ }).click();
  await expect(page.getByRole("dialog", { name: /C-OFFER-NO-OFFER/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /C-OFFER-NO-OFFER/ }).getByRole("button", { name: /Update process/ })).toHaveCount(0);
});

test("failed candidates remain pipeline workflow state, not data quality issues", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  await page.getByRole("dialog", { name: "Welcome Back" }).getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(page.getByText("Failed candidate in active stage")).toHaveCount(0);

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByText("Failed Candidates - Last 7 Days")).toBeVisible();
  await expect(page.getByText("Finn Failed")).toBeVisible();
});

test("candidate card opens detail drawer and can be closed by Escape", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: /^Pat Phone/ }).click();
  await expect(page.getByRole("dialog", { name: /C-PHONE/ })).toBeVisible();
  await expect(page.getByText("Current stage")).toBeVisible();
  await expect(page.getByText("Pending details")).toBeVisible();
  await expect(page.getByText("Awaiting outcome")).toBeVisible();
  await expect(page.getByText("Resume Screening")).toBeVisible();
  await expect(page.locator('[data-stage-connector="Resume Screening->Phone Screen"]').first()).toHaveAttribute("data-stage-connector-state", "pending");
  await expect(page.locator('[data-stage-connector="Phone Screen->HR Interview"]').first()).toHaveAttribute("data-stage-connector-state", "unreached");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /C-PHONE/ })).toHaveCount(0);
});

test("pipeline layout avoids page overflow on mobile while board scrolls internally", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const board = page.getByLabel("Candidate Pipeline").first();
  await expect.poll(async () => board.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});
