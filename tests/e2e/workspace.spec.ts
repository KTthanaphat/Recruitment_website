import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("workspace opens requisition context with connected panels", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: /GRP-ENG - Engineer/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace breadcrumbs" })).toContainText("REQ-HQ-1");
  await expect(page.getByRole("tabpanel")).toContainText("Hiring journey");
  await expect(page.getByRole("tablist", { name: "Hiring workspace sections" }).getByRole("tab")).toHaveText([
    "Overview",
    "Sourcing",
    "Pipeline",
    "Offer",
    "Activity"
  ]);
  await expect(page.getByText("Open HC")).toBeVisible();
  await expect(page.getByText("Active / total")).toBeVisible();
});

test("workspace opens sourcing group context and survives refresh URL", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-TECH&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: /GRP-TECH - Technician/ })).toBeVisible();
  await page.getByRole("tab", { name: "Sourcing" }).click();
  await expect(page.getByText("Sourcing Conversion Quality")).toBeVisible();
  await page.getByRole("tab", { name: "Pipeline" }).click();
  await expect(page.getByText("Tina Test")).toBeVisible();

  await page.reload();
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: /GRP-TECH - Technician/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Pipeline" })).toHaveAttribute("aria-selected", "true");
});

test("group workspace shows aggregate records and keeps section when selecting requisition context", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=pipeline&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("button", { name: /REQ-HQ-1 - Engineer/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /REQ-HQ-2 - Engineer/ })).toBeVisible();
  await expect(page.getByText("Pat Phone")).toBeVisible();
  await page.getByRole("button", { name: /REQ-HQ-2 - Engineer/ }).click();
  await expect(page).toHaveURL(/doc=REQ-HQ-2/);
  await expect(page).toHaveURL(/section=pipeline/);
  await expect(page.getByRole("tab", { name: "Pipeline" })).toHaveAttribute("aria-selected", "true");
});

test("workspace uses group-first breadcrumbs for requisition context", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-KT1-1&section=overview");
  await expectWorkspaceReady(page);

  const breadcrumbs = page.getByRole("navigation", { name: "Workspace breadcrumbs" });
  await expect(breadcrumbs).toHaveText(/Workspace.*GRP-TECH.*REQ-KT1-1/);
  await expect(breadcrumbs.getByRole("link", { name: "GRP-TECH" })).toHaveAttribute("href", /type=group.*id=GRP-TECH/);
});

test("legacy outcome section resolves to canonical offer section", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-KT2-1&section=outcome");
  await expectWorkspaceReady(page);

  await expect(page).toHaveURL(/section=offer/);
  await expect(page.getByRole("tab", { name: "Offer" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Offers" })).toBeVisible();
});

test("workspace picker lists open requisitions and groups when no target is selected", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Choose a requisition or sourcing group to focus the workspace.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Select a hiring workspace", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: /REQ-HQ-1/ })).toBeVisible();
  await page.getByRole("button", { name: "Groups" }).click();
  await expect(page.getByRole("button", { name: /GRP-ENG/ })).toBeVisible();
});

test("empty workspace picker keeps New Requisition available", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  const picker = page.getByRole("heading", { name: "Select a hiring workspace", level: 2 }).locator(".." );
  await page.getByLabel("Search workspaces").fill("does-not-exist");
  await expect(page.getByText("No matching workspaces.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New Requisition" })).toBeVisible();
  await page.getByRole("button", { name: "New Requisition" }).click();
  await expect(page.getByRole("dialog", { name: "Create Requisition" })).toBeVisible();
  await expect(picker).toBeVisible();
});
