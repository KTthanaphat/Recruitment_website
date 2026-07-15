import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("candidate creation form enforces required fields before review", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Candidate" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("QA Candidate");
  await dialog.getByLabel("Group ID").selectOption("DG-HQ-ENG");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toBeVisible();
});
