import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("grouped sidebar gates admin and preserves global navigation context", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/pipeline?lang=en&site=KT1&pic=Bob&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Workspace" })).toBeVisible();
  const recordsButton = navigation.getByRole("button", { name: "Records" });
  await expect(recordsButton).toBeVisible();
  await expect(recordsButton).toHaveAttribute("aria-expanded", "true");
  await expect(recordsButton).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Audit Log" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Pipeline" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Sourcing" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Administration" })).toHaveCount(0);
  await expect(navigation.locator("[data-records-subnav]")).toBeVisible();

  const homeBox = await navigation.getByRole("link", { name: "Home" }).boundingBox();
  const recordsBox = await recordsButton.boundingBox();
  expect(homeBox).not.toBeNull();
  expect(recordsBox).not.toBeNull();
  expect(Math.abs(homeBox!.width - recordsBox!.width)).toBeLessThanOrEqual(1);

  const expandedSubnavStyles = await navigation.locator("[data-records-subnav]").evaluate((element) => {
    const styles = getComputedStyle(element);
    return { display: styles.display };
  });
  expect(expandedSubnavStyles.display).not.toBe("none");

  const workspaceLink = navigation.getByRole("link", { name: "Workspace" });
  await expect(workspaceLink).toHaveAttribute("href", /lang=en/);
  await expect(workspaceLink).toHaveAttribute("href", /site=KT1/);
  await expect(workspaceLink).toHaveAttribute("href", /pic=Bob/);
  await expect(workspaceLink).toHaveAttribute("href", /sourcingWeek=2026-07-06/);

  const sourcingLink = navigation.getByRole("link", { name: "Sourcing" });
  await expect(sourcingLink).toHaveAttribute("href", /lang=en/);
  await expect(sourcingLink).toHaveAttribute("href", /site=KT1/);
  await expect(sourcingLink).toHaveAttribute("href", /pic=Bob/);
  await expect(sourcingLink).toHaveAttribute("href", /sourcingWeek=2026-07-06/);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(navigation.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(recordsButton).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Pipeline" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Pipeline" }).locator('[data-nav-label="pipeline"]')).toHaveClass(/lg:sr-only/);
  await expect(navigation.getByRole("link", { name: "Sourcing" }).locator('[data-nav-label="sourcing"]')).toHaveClass(/lg:sr-only/);
  await expect(navigation.locator("[data-records-subnav]")).toBeVisible();

  const collapsedRecordsBox = await recordsButton.boundingBox();
  const collapsedSourcingBox = await navigation.getByRole("link", { name: "Sourcing" }).boundingBox();
  expect(collapsedRecordsBox).not.toBeNull();
  expect(collapsedSourcingBox).not.toBeNull();
  expect(Math.abs(
    (collapsedRecordsBox!.x + collapsedRecordsBox!.width / 2)
      - (collapsedSourcingBox!.x + collapsedSourcingBox!.width / 2)
  )).toBeLessThanOrEqual(1);
});

test("workspace section tabs persist in URL history and render one section", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&section=overview&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const tabs = page.getByRole("tablist", { name: "Hiring workspace sections" });
  await expect(tabs.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("Hiring journey");

  await tabs.getByRole("tab", { name: "Pipeline" }).click();
  await expect(page).toHaveURL(/section=pipeline/);
  await expect(page.getByRole("tabpanel")).toContainText("Active candidates");
  await expect(page.getByRole("tabpanel")).not.toContainText("Pipeline Bottleneck");
  await expect(page.getByRole("tabpanel")).not.toContainText("Hiring journey");

  await tabs.getByRole("tab", { name: "Sourcing" }).click();
  await expect(page).toHaveURL(/section=sourcing/);
  await expect(page.getByRole("tabpanel")).toContainText("Sourcing coverage");
  await page.goBack();
  await expect(page).toHaveURL(/section=pipeline/);
  await expect(tabs.getByRole("tab", { name: "Pipeline" })).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(page).toHaveURL(/section=sourcing/);
  await expect(tabs.getByRole("tab", { name: "Sourcing" })).toHaveAttribute("aria-selected", "true");
});

test("workspace picker searches requisitions and groups", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  const search = page.getByLabel("Search workspaces");
  await search.fill("REQ-KT1-1");
  await expect(page.getByRole("button", { name: /REQ-KT1-1/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /REQ-HQ-1/ })).toHaveCount(0);
  await search.fill("REQ-CLOSED-1");
  await expect(page.getByText("No matching workspaces.")).toBeVisible();

  await page.getByRole("button", { name: "Groups" }).click();
  await search.fill("GRP-TECH");
  await expect(page.getByRole("button", { name: /GRP-TECH/ })).toBeVisible();
  await search.fill("GRP-CLOSED");
  await expect(page.getByText("No matching workspaces.")).toBeVisible();
});

test("workspace direct URL to closed work shows invalid target picker", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-CLOSED-1");
  await expectWorkspaceReady(page);

  await expect(page.getByText("The workspace in the URL was not found. Choose an available record.")).toBeVisible();
  await expect(page.getByRole("button", { name: /REQ-CLOSED-1/ })).toHaveCount(0);
});

test("candidate document search filters linked records", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/candidates?candSearch=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const table = page.locator("table");
  await expect(table.getByText("Pat Phone", { exact: true })).toBeVisible();
  await expect(table.getByText("Avery Aging", { exact: true })).toBeVisible();
  await expect(table.getByText("Liam Line", { exact: true })).toHaveCount(0);
});

test("record tables expose only magnifying-glass detail controls and drawer change actions", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });

  await page.goto("/requisitions");
  await expectWorkspaceReady(page);
  await expect(page.locator("table").getByRole("button", { name: /More actions/ })).toHaveCount(0);
  await expect(page.locator("table").getByRole("button", { name: "Edit REQ-HQ-1" })).toHaveCount(0);
  await expect(page.locator("table").getByRole("link", { name: "Workspace" })).toHaveCount(0);
  await page.getByRole("button", { name: "View requisition detail for REQ-HQ-1" }).click();
  const requisitionDrawer = page.getByRole("dialog", { name: /REQ-HQ-1/ });
  await expect(requisitionDrawer).toBeVisible();
  await requisitionDrawer.getByRole("button", { name: "More actions for REQ-HQ-1" }).click();
  await requisitionDrawer.getByRole("menuitem", { name: "Change record" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Requisition" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  await expect(page.locator("table").getByRole("button", { name: /More actions/ })).toHaveCount(0);
  await expect(page.locator("table").getByRole("button", { name: "Edit Pat Phone" })).toHaveCount(0);
  await expect(page.locator("table").getByRole("link", { name: "Workspace" })).toHaveCount(0);
  await page.getByRole("button", { name: "View candidate detail for Pat Phone" }).click();
  const candidateDrawer = page.getByRole("dialog", { name: /C-PHONE \/ Pat Phone/ });
  await expect(candidateDrawer).toBeVisible();
  await candidateDrawer.getByRole("button", { name: "More actions for Pat Phone" }).click();
  await candidateDrawer.getByRole("menuitem", { name: "Change record" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Candidate" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await page.goto("/offers");
  await expectWorkspaceReady(page);
  await expect(page.locator("table").getByRole("button", { name: /More actions/ })).toHaveCount(0);
  await expect(page.locator("table").getByRole("button", { name: "Edit Owen Offer" })).toHaveCount(0);
  await expect(page.locator("table").getByRole("link", { name: "Workspace" })).toHaveCount(0);
  await page.getByRole("button", { name: "View offer candidate detail for Owen Offer" }).click();
  await expect(page.getByRole("dialog", { name: /C-OFFER \/ Owen Offer/ })).toBeVisible();
});

test("sourcing contextual filters focus the matching group", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing?sourceSearch=GRP-TECH&reqSearch=REQ-KT1-1&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  const group = page.locator("#sourcing-group-GRP-TECH");
  await expect(group).toBeVisible();
  await expect(group).toHaveClass(/border-primary/);
  await expect(page.locator("#sourcing-group-GRP-ENG")).toHaveCount(0);
});

test("sourcing shows unmatched groups with match action and no weekly save fields", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Unmatched sourcing groups" })).toBeVisible();
  const unmatchedGroup = page.getByText("GRP-BUY").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await expect(unmatchedGroup).toBeVisible();
  await expect(page.locator("#sourcing-group-GRP-BUY")).toHaveCount(0);
  await expect(unmatchedGroup.getByRole("button", { name: "Delete record" })).toHaveCount(0);

  await unmatchedGroup.getByRole("button", { name: "Match requisition" }).click();
  const matchDialog = page.getByRole("dialog", { name: "Match Requisition and Group" });
  await expect(matchDialog).toBeVisible();
  await expect(matchDialog.getByLabel("Group ID")).toHaveValue("GRP-BUY");
  await expect(matchDialog.getByLabel("Doc ID")).toContainText("REQ-UNMATCHED-1");
});

test("sourcing unmatch uses destructive confirmation and RPC", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const group = page.locator("#sourcing-group-GRP-ENG");
  await group.getByRole("button", { name: "More actions for sourcing group GRP-ENG" }).click();
  await group.getByRole("menuitem", { name: "Unmatch REQ-HQ-1" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Confirm destructive action" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByText("Unmatch sourcing group GRP-ENG from requisition REQ-HQ-1")).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Delete / Unmatch" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_unmatch_group_requisition");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    doc_group_id: "DG-HQ-ENG",
    doc_id: "REQ-HQ-1",
    group_id: "GRP-ENG"
  });
});

test("system admin sees unmatched group delete action and confirmation", async ({ page }) => {
  await installMockSupabase(page, { role: "system_admin" });
  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const unmatchedGroup = page.getByText("GRP-BUY").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await unmatchedGroup.getByRole("button", { name: "Delete record" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Confirm destructive action" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByText("Delete sourcing group GRP-BUY")).toBeVisible();
});

test("pipeline URL search focuses a candidate and Actions is keyboard dismissible", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline?pipelineSearch=C-PHONE");
  await expectWorkspaceReady(page);

  await expect(page.getByLabel("Search pipeline")).toHaveValue("C-PHONE");
  const card = page.locator("#pipeline-candidate-C-PHONE");
  const actions = card.getByRole("button", { name: "Candidate actions for Pat Phone" });
  await actions.focus();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("menu", { name: "Actions for Pat Phone" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card.getByRole("menu", { name: "Actions for Pat Phone" })).toHaveCount(0);
  await expect(actions).toBeFocused();
});

test("candidate drawer has one action hierarchy and modal becomes topmost", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "View candidate detail for Pat Phone" }).click();
  const drawer = page.getByRole("dialog", { name: /C-PHONE \/ Pat Phone/ });
  await expect(drawer.getByText("Current stage")).toHaveCount(0);
  await expect(drawer.getByText("Result", { exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Update process" })).toHaveCount(1);

  await drawer.getByRole("button", { name: "More actions for Pat Phone" }).click();
  const menu = drawer.getByRole("menu", { name: "Actions for Pat Phone" });
  await expect(drawer.getByRole("link", { name: "Open workspace" })).toHaveCount(1);
  const changeRecord = menu.getByRole("menuitem", { name: "Change record" });
  await expect(changeRecord).toBeVisible();
  await expect(changeRecord).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(menu.getByRole("menuitem", { name: "View requisition" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Same group" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Open in pipeline" })).toBeVisible();
  await page.keyboard.press("Escape");

  await drawer.getByRole("button", { name: "Update process" }).click();
  const modal = page.getByRole("dialog", { name: "Process Update" });
  await expect(modal).toBeVisible();
  await expect(page.locator('aside[role="dialog"][aria-hidden="true"]')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
});

test("key views have no page-level overflow at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter" });

  for (const path of ["/home", "/workspace?type=requisition&id=REQ-HQ-1", "/pipeline", "/candidates", "/sourcing?sourcingWeek=2026-07-06"]) {
    await page.goto(path);
    await expectWorkspaceReady(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} has horizontal overflow`).toBeLessThanOrEqual(1);
  }
});
