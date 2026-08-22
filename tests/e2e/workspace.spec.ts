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

  await expect(page.getByRole("button", { name: "Engineer (L4) — REQ-HQ-1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Engineer (L4) — REQ-HQ-2" })).toBeVisible();
  await expect(page.getByText("LL4", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Pat Phone")).toBeVisible();
  await page.getByRole("button", { name: "Engineer (L4) — REQ-HQ-2" }).click();
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
  await expect(page.getByRole("button", { name: "Engineer (L4) — REQ-HQ-1" })).toBeVisible();
  await page.getByLabel("Search workspaces").fill("REQ-UNMATCHED-1");
  await expect(page.getByRole("button", { name: /Senior Procurement Operations and Supplier Development Specialist — REQ-UNMATCHED-1/ })).toBeVisible();
  await expect(page.getByText("Senior Procurement Operations and Supplier Development Specialist (", { exact: false })).toHaveCount(0);
  await page.getByLabel("Search workspaces").fill("Engineer");
  await expect(page.getByRole("button", { name: "Engineer (L4) — REQ-HQ-1" })).toBeVisible();
  await page.getByLabel("Search workspaces").fill("");
  await page.getByRole("button", { name: "Groups" }).click();
  await expect(page.getByRole("button", { name: /GRP-ENG/ })).toBeVisible();
});

test("workspace group cards truncate long titles and retain the full native tooltip", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const longTitle = "Senior Procurement Operations and Supplier Development Specialist with Regional Strategic Sourcing Responsibilities";
  const group = mock.data.position_groups.find((row) => row.group_id === "GRP-ENG");
  if (!group) throw new Error("Missing GRP-ENG test fixture");
  group.group_position = longTitle;

  await page.goto("/workspace");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Groups" }).click();

  const title = page.locator(`strong[title="${longTitle}"]`);
  await expect(title).toBeVisible();
  await expect(title).toHaveClass(/truncate/);
  await expect(title).toHaveAttribute("title", longTitle);
  await expect(page.getByText("Group ID: GRP-ENG")).toBeVisible();
});

test("site recruiter sees workspace records assigned to them or in their assigned site", async ({ page }) => {
  await installMockSupabase(page, { role: "site_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("button", { name: "Technician (L4) — REQ-KT1-1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Line Technician (L4) — REQ-KT1-PEER" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Recruitment Coordinator (L4) — REQ-HQ-BOB" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Engineer (L4) — REQ-HQ-1" })).toHaveCount(0);

  await page.getByRole("button", { name: "Groups" }).click();
  await expect(page.getByRole("button", { name: /GRP-TECH/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /GRP-KT1-PEER/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /GRP-HQ-BOB/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /GRP-ENG/ })).toHaveCount(0);
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

test("workspace picker exposes contextual group setup actions only to setup managers", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Groups" }).click();
  await expect(page.getByRole("button", { name: "New Requisition" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Group" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Link Group" })).toHaveCount(0);
  await page.getByRole("button", { name: "New Group" }).click();
  await expect(page.getByRole("dialog", { name: "Create Group" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Groups" }).click();
  await expect(page.getByRole("button", { name: "New Group" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Link Group" })).toHaveCount(0);
});
