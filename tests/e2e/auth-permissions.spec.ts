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
  await expect(page.getByText("site@example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("viewer@example.com", { exact: true })).toBeVisible();
});

test("admin recruiters can assign a recruiter while site recruiters stay locked to their own assignment", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "New Requisition" }).click();
  const adminDialog = page.getByRole("dialog", { name: "Create Requisition" });
  const adminSite = adminDialog.getByRole("button", { name: "Site" });
  const adminDepartment = adminDialog.getByRole("button", { name: "Department" });
  const adminSection = adminDialog.getByRole("button", { name: "Section" });
  await expect(adminDepartment).toBeDisabled();
  await adminSite.click();
  await page.getByRole("option", { name: "HQ", exact: true }).click();
  await expect(adminSection).toBeDisabled();
  await adminDepartment.click();
  await page.getByRole("option", { name: "Finance Department", exact: true }).click();
  await expect(adminSection).toBeEnabled();
  await adminSection.click();
  await page.getByRole("option", { name: "Financial Document Division", exact: true }).click();
  await expect(adminSection).toContainText("Financial Document Division");
  const adminOwner = adminDialog.getByRole("button", { name: "Person in Charge" });
  await expect(adminOwner).toBeEnabled();
  await adminOwner.click();
  await expect(page.getByRole("option", { name: "Bob", exact: true })).toBeVisible();
  await page.getByRole("option", { name: "Bob", exact: true }).click();
  await expect(adminOwner).toContainText("Bob");

  await page.getByRole("button", { name: "Cancel" }).click();
  await installMockSupabase(page, { role: "site_recruiter" });
  await page.goto("/requisitions");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "New Requisition" }).click();
  const siteDialog = page.getByRole("dialog", { name: "Create Requisition" });
  await expect(siteDialog.getByRole("button", { name: "Person in Charge" })).toBeDisabled();
  await expect(siteDialog.getByRole("button", { name: "Person in Charge" })).toContainText("Bob");
  await expect(siteDialog.getByRole("button", { name: "Site" })).toBeDisabled();
  await expect(siteDialog.getByRole("button", { name: "Site" })).toContainText("KT1");
});
