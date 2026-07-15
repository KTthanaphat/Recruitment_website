import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("home shows role-aware prioritized work queue", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Today's Work")).toBeVisible();
  await expect(page.getByText("Urgent items")).toBeVisible();
  await expect(page.getByText("Aging candidates")).toBeVisible();
  await expect(page.getByRole("button", { name: /Avery Aging/ }).first()).toBeVisible();
});

test("home shows bottleneck summary only to recruiter roles", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  await expect(page.getByText("Pipeline Bottleneck")).toBeVisible();

  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  await expect(page.getByText("Pipeline Bottleneck")).toHaveCount(0);
});

test("sourcing shows weekly health and can copy previous week", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const firstGroup = page.locator("form").filter({ hasText: "GRP-ENG" }).first();
  await expect(firstGroup.getByText("Previous week", { exact: true })).toBeVisible();
  await expect(firstGroup.getByText("Trend", { exact: true })).toBeVisible();
  await firstGroup.getByRole("button", { name: "Copy Previous Week" }).click();
  await expect(firstGroup.getByLabel("Applicants").first()).toHaveValue("8");
});

test("offers show status, requisition impact, and quick links", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/offers");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Offer Status")).toBeVisible();
  await expect(page.getByRole("cell", { name: "0/2 accepted - 2 open", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Owen Offer", exact: true }).click();
  await expect(page.getByRole("dialog", { name: /C-OFFER/ })).toBeVisible();
});

test("audit filters records and shows readable field diff", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/audit");
  await expectWorkspaceReady(page);

  await page.getByLabel("Entity", { exact: true }).fill("recruitment_logs");
  await expect(page.getByText("Recruitment Logs - 16")).toBeVisible();
  await page.getByText("Field changes").click();
  await expect(page.getByText("candidate_id")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open candidate" })).toBeVisible();
});
