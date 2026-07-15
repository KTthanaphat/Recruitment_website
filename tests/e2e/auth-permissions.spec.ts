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
