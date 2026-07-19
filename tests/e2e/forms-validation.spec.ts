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
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toHaveCount(0);

  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("QA Candidate");
  await dialog.getByLabel("Phone No.").fill("0812345678");
  await dialog.getByLabel("Group ID").selectOption("DG-HQ-ENG");
  await dialog.getByLabel("Channel").selectOption("Facebook");
  await dialog.getByLabel("First Contact Date").fill("2026-05-31");

  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByText("First Contact Date cannot be before the oldest PR Approved Date for this group")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toHaveCount(0);

  await dialog.getByLabel("First Contact Date").fill("2026-06-01");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toBeVisible();
});

test("candidate reference name is required only for Referral channel", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Candidate" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Reference Name")).toHaveCount(0);

  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Referral Candidate");
  await dialog.getByLabel("Phone No.").fill("0899999999");
  await dialog.getByLabel("Group ID").selectOption("DG-HQ-ENG");
  await dialog.getByLabel("First Contact Date").fill("2026-06-02");
  await dialog.getByLabel("Channel").selectOption("Referral");
  await expect(dialog.getByLabel("Reference Name")).toBeVisible();

  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toHaveCount(0);

  await dialog.getByLabel("Reference Name").fill("Khun Ref");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toBeVisible();
});
