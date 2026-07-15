import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("pipeline board renders active, failed, passed, aging, and filtered candidates", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Phone Screen", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No activity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "HR Interview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Line Interview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference Check", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Offer", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Phone Screen", exact: true })).toHaveCSS("color", "rgb(255, 59, 48)");
  await expect(page.getByRole("heading", { name: "No activity", exact: true })).toHaveCSS("color", "rgb(11, 19, 43)");
  const agingWarning = page.getByRole("button", { name: "1 aging candidate in Phone Screen" });
  await agingWarning.focus();
  await expect(page.getByRole("tooltip", { name: "1 candidates have exceeded 7 days in this stage" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip", { name: "1 candidates have exceeded 7 days in this stage" })).toHaveCount(0);

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
  await expect(page.locator("#pipeline-candidate-C-AGING").getByRole("button", { name: "Candidate actions for Avery Aging" })).toHaveCSS("color", "rgb(255, 59, 48)");
  await expect(page.locator("#pipeline-candidate-C-PHONE").getByRole("button", { name: "Candidate actions for Pat Phone" })).not.toHaveCSS("color", "rgb(255, 59, 48)");

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

  await page.getByLabel("Site").selectOption("KT1");
  await expect(page.getByText("Tina Test")).toBeVisible();
  await expect(page.getByText("Pat Phone")).toHaveCount(0);
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
  await expect(page.getByText("Current stage")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /C-PHONE/ })).toHaveCount(0);
});
