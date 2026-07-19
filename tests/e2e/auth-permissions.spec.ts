import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("viewer can read pipeline but cannot update candidates", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Pipeline", exact: true })).toBeVisible();
  await expect(page.getByText("Pat Phone")).toBeVisible();
  await expect(page.getByRole("button", { name: "New Candidate" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Update" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Update stage for/ })).toHaveCount(0);
});

test("system admin can access user administration", async ({ page }) => {
  await installMockSupabase(page, { role: "system_admin" });
  await page.goto("/admin");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Administration", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Manage User|New User|Create User/i })).toBeVisible();
});

test("admin recruiters can assign a recruiter while site recruiters stay locked to their own assignment", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "New Requisition" }).click();
  const adminDialog = page.getByRole("dialog", { name: "Create Requisition" });
  const adminSite = adminDialog.locator('select[name="site"]');
  const adminDepartment = adminDialog.locator('select[name="department"]');
  const adminSection = adminDialog.locator('select[name="section"]');
  await expect(adminDepartment).toBeDisabled();
  await adminSite.selectOption("HQ");
  await expect(adminDepartment.locator("option", { hasText: "Finance Department" })).toHaveCount(1);
  await expect(adminSection).toBeDisabled();
  await adminDepartment.selectOption("Finance Department");
  await expect(adminSection).toBeEnabled();
  await adminSection.selectOption("Financial Document Division");
  await expect(adminSection).toHaveValue("Financial Document Division");
  const adminOwner = adminDialog.getByLabel("Person in Charge");
  await expect(adminOwner).toBeEnabled();
  await adminOwner.selectOption("Bob");
  await expect(adminOwner).toHaveValue("Bob");

  await page.getByRole("button", { name: "Cancel" }).click();
  await installMockSupabase(page, { role: "site_recruiter" });
  await page.goto("/requisitions");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "New Requisition" }).click();
  const siteDialog = page.getByRole("dialog", { name: "Create Requisition" });
  await expect(siteDialog.getByLabel("Person in Charge")).toBeDisabled();
  await expect(siteDialog.getByLabel("Person in Charge")).toHaveValue("Bob");
  await expect(siteDialog.getByLabel("Site")).toBeDisabled();
  await expect(siteDialog.getByLabel("Site")).toHaveValue("KT1");
});
