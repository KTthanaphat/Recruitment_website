import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("requisition identity is consistent across records, Home, offers, and Pipeline boundaries", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });

  await page.goto("/requisitions");
  await expectWorkspaceReady(page);
  await expect(page.locator("table").getByText("Engineer (L4)", { exact: true }).first()).toBeVisible();
  await expect(page.locator("table").getByText("REQ-HQ-1", { exact: true })).toBeVisible();

  await page.goto("/home");
  await expectWorkspaceReady(page);
  await expect(page.getByText("Engineer (L4)", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Requisition ID: REQ-HQ-1", { exact: true }).first()).toBeVisible();

  await page.goto("/offers");
  await expectWorkspaceReady(page);
  await expect(page.locator("table").getByText("Analyst (L4)", { exact: true })).toBeVisible();
  await expect(page.locator("table").getByText("REQ-KT2-1", { exact: true })).toBeVisible();

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  const candidateCard = page.locator("#pipeline-candidate-C-PHONE");
  await expect(candidateCard).toContainText("Pat Phone");
  await expect(candidateCard).toContainText("HQ-Engineer (Alice)");
  await expect(candidateCard).not.toContainText("REQ-HQ-1");
});

test("requisition detail localizes its ID label while keeping the formatted heading", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions?lang=th&detailType=requisition&detailId=REQ-HQ-1");

  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("รหัสคำขอ");
  await expect(drawer).toContainText("REQ-HQ-1");
});

test("long requisition titles wrap at 390px without page-level overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  await page.getByLabel("Search workspaces").fill("REQ-UNMATCHED-1");
  await expect(page.getByRole("button", { name: /Senior Procurement Operations and Supplier Development Specialist — REQ-UNMATCHED-1/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto("/requisitions?detailType=requisition&detailId=REQ-UNMATCHED-1");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("dialog", { name: "Senior Procurement Operations and Supplier Development Specialist" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
