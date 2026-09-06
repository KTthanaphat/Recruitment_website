import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("admin recruiters can configure brace-format rejection letters", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Configuration", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Send rejection letter format" })).toBeVisible();
  await page.getByRole("button", { name: "New format" }).click();
  await expect(page.getByText("Variables: {candidate_name}", { exact: false })).toBeVisible();
});

test("failed pipeline candidates use the send rejection letter composer without variable insertion", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  const failedCandidate = page.locator("#pipeline-candidate-C-FAILED");
  await failedCandidate.getByRole("button", { name: "Send rejection letter" }).click();
  const dialog = page.getByRole("dialog", { name: "Send rejection letter" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Insert variable")).toHaveCount(0);
  await expect(dialog.getByText("This email will be sent immediately from the shared HR mailbox.")).toBeVisible();
});
