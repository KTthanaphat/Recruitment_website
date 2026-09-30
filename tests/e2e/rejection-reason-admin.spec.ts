import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("recruitment admin can edit and archive reason labels in Configuration", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await page.getByText("Candidate failure reasons").click();
  const manager = page.getByText("Archived reasons remain visible in candidate history.").locator("..");
  await expect(manager).toBeVisible();
  await page.getByRole("button", { name: "Add main reason" }).click();
  await page.getByLabel("Thai label").fill("เหตุผลเพิ่มเติม");
  await page.getByLabel("English label").fill("Additional reason");
  await page.getByRole("button", { name: "Save reason" }).click();
  await page.getByText("Candidate failure reasons").click();
  await expect(page.getByText("Additional reason")).toBeVisible();
  expect(mock.data.rejection_reasons.some((reason) => reason.label_en === "Additional reason")).toBe(true);
  await page.getByText("Additional reason").locator("..").getByRole("button", { name: "Archive" }).click();
  await page.getByText("Candidate failure reasons").click();
  await expect(page.getByText("Additional reason · Archived")).toBeVisible();
  expect(mock.data.rejection_reasons.find((reason) => reason.label_en === "Additional reason")?.active).toBe(false);
});

test("viewer cannot manage rejection reasons", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("button", { name: "Add main reason" })).toHaveCount(0);
});
