import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("legacy requisition link resolves to group with underline tabs and overview priorities", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const requisitionHeading = page.getByRole("heading", { name: "Engineer", exact: true, level: 1 });
  await expect(requisitionHeading).toBeVisible();
  await expect(page).toHaveURL(/type=group.*id=GRP-ENG/);
  await expect(page).not.toHaveURL(/doc=/);
  await expect(requisitionHeading.locator("..").getByText("GRP-ENG", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace breadcrumbs" })).not.toContainText("REQ-HQ-1");
  await expect(page.getByRole("tabpanel")).toContainText("Hiring journey");
  const tabsPanel = page.getByTestId("workspace-tabs-panel");
  await expect(tabsPanel.getByRole("tablist")).toBeVisible();
  await expect(tabsPanel.getByRole("tabpanel")).toBeVisible();
  await expect(tabsPanel.getByRole("tablist")).toHaveClass(/border-b/);
  await expect(page.getByTestId("workspace-journey-list").locator("li")).toHaveCount(7);
  await expect(page.getByTestId("workspace-journey-list").getByRole("button", { name: /Next action:/ })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: /Data quality/ })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Hiring workspace sections" }).getByRole("tab")).toHaveText([
    "Overview",
    "Sourcing",
    "Pipeline",
    "Offer",
    "Activity"
  ]);
  await expect(page.getByText("Open HC")).toBeVisible();
  await expect(page.getByText("Active / total")).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Sourcing" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Sourcing" })).toHaveAttribute("aria-selected", "true");
});

test("workspace opens sourcing group context and survives refresh URL", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-TECH&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Technician", exact: true })).toBeVisible();
  await expect(page.getByTestId("workspace-journey-list").getByRole("button", { name: /Next action: Sourcing/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Requisition: Completed/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Group setup: Completed/ })).toBeVisible();
  await page.getByRole("tab", { name: "Sourcing" }).click();
  await expect(page.getByRole("heading", { name: /Sourcing update/ })).toBeVisible();
  await page.getByRole("tab", { name: "Pipeline" }).click();
  await expect(page.locator("strong:visible").filter({ hasText: "Tina Test" }).first()).toBeVisible();

  await page.reload();
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Technician", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Pipeline" })).toHaveAttribute("aria-selected", "true");
});

test("group workspace keeps aggregate pipeline and opens linked requisitions in detail", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=pipeline&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  await expect(page.getByTestId("workspace-linked-requisitions")).toHaveCount(0);
  await expect(page.getByText("LL4", { exact: false })).toHaveCount(0);
  await expect(page.locator("strong:visible").filter({ hasText: "Pat Phone" }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  const linked = page.getByTestId("workspace-linked-requisitions");
  await expect(linked.getByRole("button")).toHaveCount(2);
  await linked.getByRole("button", { name: /REQ-HQ-2/ }).click();
  await expect(page.getByRole("dialog")).toContainText("REQ-HQ-2");
  await expect(page).not.toHaveURL(/doc=/);
});

test("legacy requisition link keeps group-only breadcrumbs", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-KT1-1&section=overview");
  await expectWorkspaceReady(page);

  const breadcrumbs = page.getByRole("navigation", { name: "Workspace breadcrumbs" });
  await expect(page).toHaveURL(/type=group.*id=GRP-TECH/);
  await expect(breadcrumbs).toHaveText(/Workspace.*GRP-TECH/);
  await expect(breadcrumbs).not.toContainText("REQ-KT1-1");
});

test("legacy outcome section resolves to canonical offer section", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-KT2-1&section=outcome");
  await expectWorkspaceReady(page);

  await expect(page).toHaveURL(/section=offer/);
  await expect(page.getByRole("tab", { name: "Offer" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Offers" })).toBeVisible();
});

test("workspace picker lists groups only and searches linked IDs", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Choose a requisition or sourcing group to focus the workspace.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Select a hiring workspace", level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Requisitions", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("matching workspaces");
  await page.getByLabel("Search workspaces").fill("REQ-HQ-1");
  await expect(page.getByRole("button", { name: /GRP-ENG/ })).toBeVisible();
  await page.getByLabel("Search workspaces").fill("REQ-UNMATCHED-1");
  await expect(page.getByText("No matching workspaces.")).toBeVisible();
  await page.getByLabel("Search workspaces").fill("");
  await expect(page.getByRole("button", { name: /GRP-ENG/ })).toBeVisible();
});

test("overview panels reflow and the highlighted journey row opens its section", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  for (const width of [360, 390, 768, 1024, 1080, 1279, 1280, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/workspace?type=group&id=GRP-TECH&section=overview&sourcingWeek=2026-07-06");
    const journey = page.getByTestId("workspace-journey-panel");
    const quality = page.getByTestId("workspace-quality-panel");
    await expect(journey.getByRole("heading", { name: "Hiring journey" })).toBeVisible();
    await expect(quality.getByRole("heading", { name: /Data quality/ })).toBeVisible();
    const identityBox = await page.getByRole("heading", { name: "Technician", level: 1 }).locator("xpath=..").boundingBox();
    const metricsBox = await page.getByTestId("group-header-metrics").boundingBox();
    expect(identityBox && metricsBox).toBeTruthy();
    if (width >= 1080) expect(metricsBox!.x).toBeGreaterThanOrEqual(identityBox!.x + identityBox!.width - 1);
    else expect(metricsBox!.y).toBeGreaterThanOrEqual(identityBox!.y + identityBox!.height - 1);
    const journeyBox = await journey.boundingBox();
    const qualityBox = await quality.boundingBox();
    expect(journeyBox && qualityBox).toBeTruthy();
    expect(width < 1024 ? qualityBox!.y >= journeyBox!.y + journeyBox!.height - 1 : qualityBox!.x >= journeyBox!.x + journeyBox!.width - 1).toBe(true);
    if (width >= 1024) expect(Math.abs(journeyBox!.height - qualityBox!.height)).toBeLessThanOrEqual(1);
    const list = page.getByTestId("workspace-journey-list");
    await expect(list.locator("li")).toHaveCount(7);
    expect(await list.evaluate((node, viewportWidth) => viewportWidth < 1024 ? node.scrollHeight <= node.clientHeight + 1 : node.scrollHeight > node.clientHeight, width)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  }
  await page.getByTestId("workspace-journey-list").getByRole("button", { name: /Next action: Sourcing/ }).click();
  await expect(page).toHaveURL(/section=sourcing/);
  await page.goBack();
  await expect(page.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
});

test("overview scrolls all issues and retains destinations and setup permissions", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=overview");
  await expectWorkspaceReady(page);
  const quality = page.getByTestId("workspace-quality-panel");
  const list = quality.getByTestId("workspace-quality-list");
  await expect.poll(() => list.getByRole("link").count()).toBeGreaterThan(3);
  await expect(quality.getByRole("button", { name: /Show all|Show fewer/ })).toHaveCount(0);
  expect(await list.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await list.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  expect(await list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(list.getByRole("link").first()).toHaveAttribute("href", /candidates|workspace|offers|home/);
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await list.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  await expect.poll(() => list.getByRole("link").count()).toBeGreaterThan(3);

  await page.goto("/workspace?type=requisition&id=REQ-UNMATCHED-1&section=overview");
  await expect(page.getByRole("dialog")).toContainText("REQ-UNMATCHED-1");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("workspace-journey-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Group" }).click();
  await expect(page.getByRole("dialog", { name: "Create Group" })).toBeVisible();

  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/workspace?type=requisition&id=REQ-UNMATCHED-1&section=overview");
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);
});

test("overview keeps the data-quality empty state when a selected group has no issues", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  mock.data.candidates = mock.data.candidates.filter((row) => row.doc_group_id !== "DG-KT1-TECH" || row.candidate_id === "C-LINE");
  const candidate = mock.data.candidates.find((row) => row.candidate_id === "C-LINE");
  if (!candidate) throw new Error("Missing C-LINE fixture");
  candidate.phone_no = "0899999999";
  mock.data.offers = mock.data.offers.filter((row) => row.doc_id !== "REQ-KT1-1");
  const update = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-TECH");
  if (!update) throw new Error("Missing GRP-TECH update fixture");
  update.week_start = "2026-07-24";
  update.updated_at = "2026-07-24T05:00:00.000Z";
  await page.goto("/workspace?type=group&id=GRP-TECH&section=overview");
  const quality = page.getByTestId("workspace-quality-panel");
  await expect(quality.getByRole("heading", { name: "Data quality (0)" })).toBeVisible();
  await expect(quality.getByText("No data quality issues detected for this view.")).toBeVisible();
  await expect(quality.getByRole("button", { name: /Show all/ })).toHaveCount(0);
});

test("workspace issues and group metadata use specific English and Thai copy", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  for (const [language, title, field, action] of [
    ["en", "Possible duplicate candidate: C-PHONE", "phone number", "Review candidate"],
    ["th", "ผู้สมัคร C-PHONE อาจเป็นข้อมูลซ้ำ", "หมายเลขโทรศัพท์", "ตรวจสอบผู้สมัคร"]
  ] as const) {
    for (const width of [360, 1080]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace?type=group&id=GRP-ENG&lang=${language}`);
      const metadata = page.getByTestId("workspace-site-owner");
      await expect(metadata).toContainText(/GRP-ENG\s*\|\s*HQ\s*\|\s*Alice/);
      const issue = page.getByTestId("workspace-quality-list").locator("div", { has: page.getByText(title, { exact: true }) }).first();
      await expect(issue).toContainText(field);
      await expect(issue.getByRole("link", { name: action })).toHaveAttribute("href", /detailId=C-PHONE/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    }
  }
});

test("group header leads with position and keeps values-only metadata at aggregate scope", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-ENG&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const heading = page.getByRole("heading", { name: "Engineer", exact: true, level: 1 });
  const identity = heading.locator("..");
  const header = heading.locator("xpath=ancestor::section[1]");
  await expect(identity.getByText("GRP-ENG", { exact: true })).toHaveCount(1);
  await expect(header.getByTestId("workspace-site-owner")).toContainText(/GRP-ENG\s*\|\s*HQ\s*\|\s*Alice/);
  await expect(header.getByTestId("group-focused-tags")).toContainText(/\/2/);
  const metrics = header.getByTestId("group-header-metrics");
  await expect(metrics.locator(":scope > div > div")).toHaveCount(4);
  await expect(metrics.locator(":scope > div > div").first()).not.toHaveClass(/rounded|bg-white|border-/);
  await expect(header.getByText("Open HC")).toBeVisible();
  await expect(header.getByText("Active / total")).toBeVisible();
  await expect(header.getByText("Aging candidates")).toBeVisible();
  await expect(header.getByText("Offers")).toBeVisible();
  await expect(metrics.getByText("Open HC").locator("xpath=../..").locator("svg")).toHaveClass(/text-orange/);
  await expect(metrics.getByText("Aging candidates").locator("xpath=../..").locator("svg")).toHaveClass(/text-scarlet/);
  await expect(metrics).toContainText("Remaining demand");
  await expect(metrics).toContainText("Last touch > 7 days");
  const back = header.getByRole("button", { name: "Back to Workspace groups" });
  const breadcrumbs = header.getByRole("navigation", { name: "Workspace breadcrumbs" });
  await expect(back).toBeVisible();
  const [backBox, breadcrumbBox] = await Promise.all([back.boundingBox(), breadcrumbs.boundingBox()]);
  expect(Math.abs((backBox!.y + backBox!.height / 2) - (breadcrumbBox!.y + breadcrumbBox!.height / 2))).toBeLessThanOrEqual(1);
  await expect(breadcrumbs).toHaveCSS("margin-bottom", "0px");
  await expect(header.getByRole("button", { name: /More actions for Workspace/ })).toHaveCount(0);

  await page.goto("/workspace?type=group&id=GRP-ENG&doc=REQ-HQ-2&section=overview&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  await expect(heading).toBeVisible();
  await expect(identity.getByText("GRP-ENG", { exact: true })).toHaveCount(1);
  await expect(page).not.toHaveURL(/doc=/);
  await expect(header.getByRole("button", { name: /Open / })).toHaveCount(0);
  await expect(header.getByTestId("group-focused-tags")).toBeVisible();
});

test("group tags use aggregate readiness and oldest open requisition SLA", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-ENG");
  await expectWorkspaceReady(page);
  const tags = page.getByTestId("group-focused-tags");
  await expect(tags).toContainText(/\/2/);
  await expect(tags).toContainText("53d / 30d");
  const metric = page.getByTestId("group-header-metrics").locator(":scope > div > div").first();
  const lines = metric.locator("p");
  await expect(lines.nth(0)).toHaveText("Open HC");
  await expect(lines.nth(1)).toHaveText("Remaining demand");
  await expect(lines.nth(1)).toHaveClass(/font-light/);
  await expect(lines.nth(2)).toHaveText("6");
});

test("unmatched requisition opens detail over the group picker", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-UNMATCHED-1&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("dialog")).toContainText("REQ-UNMATCHED-1");
  await expect(page.getByTestId("group-header-metrics")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Select a hiring workspace" })).toBeVisible();
});

test("legacy requisition link with several groups asks for a group", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const match = mock.data.document_groups.find((row) => row.group_id === "GRP-TECH");
  if (!match) throw new Error("Missing group match fixture");
  mock.data.document_groups.push({ ...match, doc_group_id: "DG-ENG-SECOND", doc_id: "REQ-HQ-1" });
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&section=sourcing");
  await expectWorkspaceReady(page);
  await expect(page).toHaveURL(/groupChoices=/);
  await expect(page.getByRole("button", { name: /GRP-ENG/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /GRP-TECH/ })).toBeVisible();
  await page.getByRole("button", { name: /GRP-TECH/ }).click();
  await expect(page).toHaveURL(/type=group.*id=GRP-TECH/);
  await expect(page).not.toHaveURL(/groupChoices=|doc=/);
});

test("Workspace Sourcing lists all weeks beside one editor and guards unsaved changes", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  mock.data.sourcing_weekly_updates.filter((row) => row.group_id === "GRP-ENG").forEach((row) => { row.week_start = row.week_start === "2026-07-06" ? "2026-07-04" : "2026-06-27"; });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-18");
  await expectWorkspaceReady(page);
  const layout = page.getByTestId("workspace-sourcing-layout");
  const dates = layout.getByTestId("workspace-sourcing-dates");
  const weekHeader = await layout.getByTestId("workspace-sourcing-week-header").boundingBox();
  const updateHeader = await layout.getByTestId("workspace-sourcing-update-header").boundingBox();
  expect(Math.abs(weekHeader!.height - updateHeader!.height)).toBeLessThan(2);
  expect(Math.abs(weekHeader!.y - updateHeader!.y)).toBeLessThan(2);
  await expect(dates.getByRole("button")).toHaveCount(8);
  await expect(dates.getByRole("button", { name: /Recorded/ })).toHaveCount(2);
  await expect(dates.getByRole("button", { name: /Update needed/ }).first()).toBeVisible();
  const summary = page.getByTestId("workspace-sourcing-summary");
  await expect(summary).toContainText("Cumulative applicants");
  await expect(summary).toContainText("Channel distribution");
  await expect(summary.getByRole("progressbar", { name: "Weekly update completeness" })).toBeVisible();
  const boxes = await Promise.all([dates.boundingBox(), layout.locator("form").boundingBox()]);
  expect(boxes[0] && boxes[1] && boxes[1].x > boxes[0].x + boxes[0].width).toBe(true);
  const input = layout.locator('form input[name="applicants_fb"]');
  await input.fill("19");
  page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("Discard unsaved"); await dialog.dismiss(); });
  await dates.getByRole("button").nth(1).click();
  await expect(input).toHaveValue("19");
  await expect(page).toHaveURL(/sourcingWeek=2026-07-18/);
  page.once("dialog", async (dialog) => { await dialog.accept(); });
  await dates.getByRole("button").nth(1).click();
  await expect(page).toHaveURL(/sourcingWeek=2026-07-11/);
  await expect(input).toHaveValue("");
  await dates.getByRole("button", { name: /Recorded/ }).last().click();
  await expect(input).toHaveValue(/8|12/);
  await layout.getByRole("button", { name: "Week Starting" }).click();
  await layout.getByRole("dialog", { name: "Week Starting" }).getByRole("button", { name: "Next month" }).click();
  await layout.getByRole("dialog", { name: "Week Starting" }).getByRole("button", { name: "04/07/2026" }).click();
  await expect(page).toHaveURL(/sourcingWeek=2026-07-04/);
  await expect(dates.getByRole("button", { name: /Recorded/ }).first()).toHaveAttribute("aria-current", "date");
  await page.setViewportSize({ width: 390, height: 800 });
  const stacked = await Promise.all([dates.boundingBox(), layout.locator("form").boundingBox()]);
  expect(stacked[0] && stacked[1] && stacked[1].y > stacked[0].y).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
});

test("Workspace Sourcing bounds a long date history without hiding the editor", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const request = mock.data.requisitions.find((row) => row.doc_id === "REQ-HQ-1");
  if (!request) throw new Error("Missing requisition fixture");
  request.pr_approved_date = "2025-12-01";
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-18");
  await expectWorkspaceReady(page);
  const dates = page.getByTestId("workspace-sourcing-dates");
  await expect.poll(() => dates.getByRole("button").count()).toBeGreaterThan(20);
  expect(await dates.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await dates.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  expect(await dates.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByTestId("workspace-sourcing-layout").locator("form")).toBeVisible();
});

test("group channel controls follow the selected effective week and its saved channel state", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const update = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06");
  if (!update) throw new Error("Missing sourcing update fixture");
  update.week_start = "2026-07-04";
  update.channel_others = false;
  mock.data.sourcing_weekly_updates.push({ ...update, week_start: "2026-07-11", channel_others: true });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);

  const details = page.getByTestId("workspace-sourcing-update-header").getByRole("button", { name: "Details" });
  await details.click();
  const dialog = page.getByRole("dialog", { name: "Group details · GRP-ENG" });
  const effectiveDate = dialog.locator("label").filter({ hasText: "Effective week" }).getByRole("button");
  await expect(effectiveDate).toContainText("04/07/2026");
  await expect(dialog.getByRole("switch", { name: "Toggle Others" })).toHaveAttribute("aria-checked", "false");
  await dialog.getByRole("switch", { name: "Toggle Others" }).click();
  const confirmation = page.getByRole("dialog", { name: "Confirm Save" });
  await expect(confirmation).toContainText("enable Others - GRP-ENG from 2026-07-04");
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("workspace-sourcing-dates").getByRole("button", { name: /11\/07\/2026/ }).click();
  await details.click();
  await expect(effectiveDate).toContainText("11/07/2026");
  await expect(dialog.getByRole("switch", { name: "Toggle Others" })).toHaveAttribute("aria-checked", "true");
});

test("overview truncates long requisition positions and shows one localized overdue tag", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const requisition = mock.data.requisitions.find((row) => row.doc_id === "REQ-HQ-1");
  if (!requisition) throw new Error("Missing requisition fixture");
  await page.setViewportSize({ width: 360, height: 800 });
  for (const [language, overdue] of [["en", "overdue"], ["th", "เกินกำหนด"]] as const) {
    requisition.position = language === "en" ? "Senior International Recruitment Operations and Workforce Planning Specialist" : "ผู้เชี่ยวชาญอาวุโสด้านการสรรหาและวางแผนกำลังคนระหว่างประเทศ";
    await page.goto(`/workspace?type=group&id=GRP-ENG&section=overview&lang=${language}`);
    await expect(page.getByRole("button", { name: language === "en" ? "Refresh" : "รีเฟรช" })).toBeVisible();
    const linked = page.getByTestId("workspace-linked-requisitions").getByRole("button", { name: /REQ-HQ-1/ });
    await expect(linked).toHaveAttribute("title", language === "en" ? /Senior International Recruitment Operations/ : /ผู้เชี่ยวชาญอาวุโสด้านการสรรหา/);
    await expect(linked.locator("span").nth(1)).toHaveCSS("text-overflow", "ellipsis");
    await expect(linked.locator("span").first()).toContainText(/…\s*\(L4\)/);
    const quality = page.getByTestId("workspace-quality-panel");
    await expect(quality.locator('[data-tag-appearance="soft"]', { hasText: overdue })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  }
});

test("picker previews every scoped linked requisition and shows group ratios", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const closed = mock.data.document_groups.find((row) => row.doc_id === "REQ-CLOSED-1");
  if (!closed) throw new Error("Missing closed requisition fixture");
  closed.group_id = "GRP-ENG";
  const offer = mock.data.offers[1];
  mock.data.offers.push(
    { ...offer, offer_id: 90, candidate_id: "C-HR", doc_id: "REQ-HQ-1", accepted_date: "2026-07-18", start_confirmation: null },
    { ...offer, offer_id: 91, candidate_id: "C-PHONE", doc_id: "REQ-HQ-1", accepted_date: "2026-07-18", start_confirmation: "did_not_start" }
  );
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  const group = page.getByRole("button", { name: /Engineer, GRP-ENG/ }).locator("xpath=../..");
  await expect(group).toContainText("3 requisitions");
  await expect(group).toContainText("1/7");
  const identityBounds = await group.locator(":scope > div").first().boundingBox();
  const readinessBounds = await group.locator(":scope > div").nth(1).boundingBox();
  expect(Math.abs((identityBounds!.y + identityBounds!.height / 2) - (readinessBounds!.y + readinessBounds!.height / 2))).toBeLessThanOrEqual(2);
  const trigger = group.getByRole("button", { name: /Linked requisitions: 3 requisition/ });
  await trigger.focus();
  const preview = page.getByTestId("workspace-requisition-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("REQ-HQ-1");
  await expect(preview).toContainText("REQ-HQ-2");
  await expect(preview).toContainText("REQ-CLOSED-1");
  await expect(preview).toContainText("Filled");
  await expect(preview.getByRole("button")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await trigger.hover();
  await expect(preview).toBeVisible();
  const triggerBounds = await trigger.boundingBox();
  const previewBounds = await preview.boundingBox();
  if (!triggerBounds || !previewBounds) throw new Error("Missing preview bounds");
  await page.mouse.move(triggerBounds.x + triggerBounds.width / 2, triggerBounds.y + triggerBounds.height / 2);
  await page.mouse.move(previewBounds.x + 20, previewBounds.y + 20, { steps: 6 });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: /REQ-CLOSED-1/ }).click();
  await expect(page.getByRole("dialog")).toContainText("REQ-CLOSED-1");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await trigger.hover();
  await expect(preview).toBeVisible();
  await page.getByLabel("Search workspaces").fill("REQ-CLOSED-1");
  await expect(page.getByRole("button", { name: /Engineer, GRP-ENG/ })).toBeVisible();
  await page.setViewportSize({ width: 360, height: 640 });
  await trigger.focus();
  await expect(preview).toBeVisible();
  const bounds = await preview.boundingBox();
  expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  await page.getByLabel("Search workspaces").click();
  await expect(preview).toHaveCount(0);
  await trigger.click();
  await expect(preview).toBeVisible();
});

test("picker ratios and preview exclude requisitions outside the user's scope", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "site_recruiter" });
  const closed = mock.data.document_groups.find((row) => row.doc_id === "REQ-CLOSED-1");
  if (!closed) throw new Error("Missing closed requisition fixture");
  closed.group_id = "GRP-TECH";
  await page.goto("/workspace");
  await expectWorkspaceReady(page);
  const group = page.getByRole("button", { name: /Technician, GRP-TECH/ }).locator("xpath=../..");
  await expect(group).toContainText("1 requisition");
  await expect(group).toContainText("1/3");
  await group.getByRole("button", { name: /Linked requisitions/ }).focus();
  await expect(page.getByTestId("workspace-requisition-preview")).not.toContainText("REQ-CLOSED-1");
  await page.getByLabel("Search workspaces").fill("REQ-CLOSED-1");
  await expect(page.getByText("No matching workspaces.")).toBeVisible();
});

test("All groups opens a historical group and keeps the scope on return", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("button", { name: /Closed Role, GRP-CLOSED/ })).toHaveCount(0);
  await page.getByRole("button", { name: "All groups" }).click();
  const historical = page.getByRole("button", { name: /Closed Role, GRP-CLOSED/ });
  await expect(historical).toBeVisible();
  await expect(historical.locator("xpath=../..")).toContainText("Filled");
  await historical.click();
  await expect(page).toHaveURL(/type=group.*id=GRP-CLOSED/);
  await expect(page.getByTestId("group-focused-tags")).toContainText("Filled");
  await page.getByRole("tab", { name: "Sourcing" }).click();
  await expect(page.getByTestId("workspace-sourcing-dates")).toBeVisible();
  await expect(page.getByTestId("workspace-sourcing-layout").getByRole("button", { name: "Save" })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to Workspace groups" }).click();
  await expect(page.getByRole("button", { name: "All groups" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Ongoing" }).click();
  await expect(historical).toHaveCount(0);
});

test("historical group URL selects All and labels mixed terminal links", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const filled = mock.data.requisitions.find((row) => row.doc_id === "REQ-CLOSED-1");
  const match = mock.data.document_groups.find((row) => row.doc_id === "REQ-CLOSED-1");
  if (!filled || !match) throw new Error("Missing historical group fixture");
  mock.data.requisitions.push({ ...filled, doc_id: "REQ-CANCELLED-2", status: "cancel" });
  mock.data.document_groups.push({ ...match, doc_group_id: "DG-CANCELLED-2", doc_id: "REQ-CANCELLED-2" });
  await page.goto("/workspace?type=group&id=GRP-CLOSED&section=overview");
  await expectWorkspaceReady(page);
  await expect(page.getByTestId("group-focused-tags")).toContainText("Closed");
  await page.getByRole("button", { name: "Back to Workspace groups" }).click();
  await expect(page.getByRole("button", { name: "All groups" })).toHaveAttribute("aria-pressed", "true");
  const historical = page.getByRole("button", { name: /Closed Role, GRP-CLOSED/ }).locator("xpath=../..");
  await expect(historical).toContainText("Closed");
  await expect(historical).toContainText("2 requisitions");
});

test("Workspace New menu routes to both creation dialogs", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);
  const create = page.getByRole("button", { name: "New", exact: true });
  await create.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "New Requisition" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(create).toBeFocused();
  await create.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  await create.click();
  await page.getByRole("menuitem", { name: "New Requisition" }).click();
  await expect(page.getByRole("dialog", { name: "Create Requisition" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await create.click();
  await page.getByRole("menuitem", { name: "New Group" }).click();
  await expect(page.getByRole("dialog", { name: "Create Group" })).toBeVisible();
});

test("Workspace Sourcing summary distinguishes recorded and missing weeks", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  mock.data.sourcing_weekly_updates.filter((row) => row.group_id === "GRP-ENG").forEach((row) => { row.week_start = row.week_start === "2026-07-06" ? "2026-07-04" : "2026-06-27"; });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);
  const summary = page.getByTestId("workspace-sourcing-summary");
  await expect(summary).toContainText("Cumulative applicants20");
  await expect(summary).toContainText("Channel distribution");
  await expect(summary).not.toContainText("Weeks with update records");
  const trend = summary.getByTestId("workspace-sourcing-trend");
  await expect(trend).toBeVisible();
  await expect(trend.locator("linearGradient stop").first()).toHaveAttribute("stop-color", "#DCEBFF");
  await expect(trend.locator("linearGradient stop").first()).toHaveAttribute("stop-opacity", "1");
  await expect(trend.locator("linearGradient stop").last()).toHaveAttribute("stop-opacity", "0");
  await expect(trend.locator('path[fill^="url("]')).toHaveCount(1);
  await expect(trend.locator("text")).toHaveText(["0", "10", "20"]);
  const topTick = await trend.locator("text").last().boundingBox();
  const chartBox = await trend.boundingBox();
  expect(topTick!.y).toBeGreaterThanOrEqual(chartBox!.y);
  await expect(trend.locator("line")).toHaveCount(3);
  const trendPoint = trend.locator("circle[tabindex]").last();
  await expect(trendPoint).toHaveAttribute("aria-label", /04\/07\/2026: 12 applicants/i);
  await trendPoint.focus();
  await expect(trendPoint).toBeFocused();
  await expect(trendPoint.locator("title")).toContainText(/04\/07\/2026: 12 applicants/i);
  await expect(summary.getByTestId("workspace-sourcing-pie")).toBeVisible();
  await expect(summary.getByTestId("workspace-sourcing-top-summary")).toHaveText("Top 1 channel: Facebook in total 20 of 20 applicants (100%).");
  await expect(summary.getByRole("button", { name: /^About / })).toHaveCount(3);
  await expect(summary.getByTestId("workspace-sourcing-top-callout")).toHaveCount(0);
  const metric = summary.getByTestId("workspace-sourcing-summary-row").locator(":scope > div").first();
  const [primarySize, secondarySize, dividerWidth] = await metric.evaluate((element) => {
    const primary = element.querySelector("p span:nth-child(2)");
    const description = element.querySelector('[data-testid="workspace-sourcing-completeness"] h3');
    const secondary = element.querySelector('[data-testid="workspace-sourcing-completeness"]');
    return [parseFloat(getComputedStyle(primary!).fontSize), parseFloat(getComputedStyle(description!).fontSize), parseFloat(getComputedStyle(secondary!).borderTopWidth)];
  });
  expect(primarySize).toBeGreaterThan(secondarySize);
  expect(dividerWidth).toBe(1);
  const trendBounds = await trend.boundingBox();
  const trendLabelBounds = await metric.getByRole("heading", { name: "Applicant trend · 8 weeks" }).boundingBox();
  const completenessBounds = await metric.getByTestId("workspace-sourcing-completeness").boundingBox();
  expect(trendBounds!.y + trendBounds!.height <= trendLabelBounds!.y && trendLabelBounds!.y + trendLabelBounds!.height < completenessBounds!.y).toBe(true);
  const plotBounds = await trend.locator("line").first().boundingBox();
  const progressBounds = await metric.getByRole("progressbar", { name: "Weekly update completeness" }).boundingBox();
  expect(plotBounds!.width).toBeGreaterThan(progressBounds!.width - 20);
  expect(Math.abs(trendBounds!.width - completenessBounds!.width)).toBeLessThan(2);
  await expect(metric.getByTestId("workspace-sourcing-completeness")).toContainText(/Weekly update completeness\s*2\/\d+ \(\d+%\)/);
  await expect(metric).toContainText(/20\s*\(\+12\)/);
  const selectedWeekChange = metric.getByText("(+12)", { exact: true });
  await expect(selectedWeekChange).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const numberBox = await metric.locator("p span").nth(1).boundingBox();
  const changeBox = await selectedWeekChange.boundingBox();
  const metricBounds = await metric.boundingBox();
  expect(Math.abs(numberBox!.x + numberBox!.width / 2 - (metricBounds!.x + metricBounds!.width / 2))).toBeLessThan(2);
  expect(Math.abs((numberBox!.y + numberBox!.height) - (changeBox!.y + changeBox!.height))).toBeLessThan(7);
  const help = metric.getByRole("button", { name: "About Cumulative applicants" });
  await help.focus();
  await expect(metric.getByRole("tooltip")).toContainText("selected week's saved applicants");
  await help.press("Escape");
  await expect(metric.getByRole("tooltip")).toHaveCount(0);
  await page.mouse.click(0, 0);
  await help.hover();
  await expect(metric.getByRole("tooltip")).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(metric.getByRole("tooltip")).toHaveCount(0);
  await help.click();
  await expect(metric.getByRole("tooltip")).toBeVisible();
  await metric.getByRole("heading", { name: "Applicant trend · 8 weeks" }).click();
  await expect(metric.getByRole("tooltip")).toHaveCount(0);
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-11");
  await expect(summary).toContainText("Cumulative applicants20");
  await expect(summary.getByTestId("workspace-sourcing-pie")).toBeVisible();
});

test("Sourcing accumulates completed channels only through the selected week", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const current = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06");
  const previous = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-06-29");
  if (!current || !previous) throw new Error("Missing sourcing fixtures");
  current.week_start = "2026-07-04";
  previous.week_start = "2026-06-27";
  previous.applicants_fb = 0;
  previous.channel_jobthai = true;
  previous.applicants_jobthai = 8;
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);
  const summary = page.getByTestId("workspace-sourcing-summary");
  await expect(summary).toContainText("Cumulative applicants20");
  await expect(summary).toContainText("Facebook: 12 (60%)");
  await expect(summary).toContainText("JobThai: 8 (40%)");
  await page.getByTestId("workspace-sourcing-dates").getByRole("button", { name: /27\/06\/2026/ }).click();
  await expect(summary).toContainText("Cumulative applicants8");
  await expect(summary.getByTestId("workspace-sourcing-summary-row").locator(":scope > div").first()).toContainText(/8\s*\(\+8\)/);
  await expect(summary).toContainText("JobThai: 8 (100%)");
  await expect(summary.getByTestId("workspace-sourcing-top-callout")).toHaveCount(0);
  await expect(summary).not.toContainText("Facebook: 12");
});

test("Sourcing trend rounds 110% of the highest week up to the next ten", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const update = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06");
  if (!update) throw new Error("Missing sourcing update fixture");
  update.week_start = "2026-07-04";
  update.applicants_fb = 21;
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);
  const ticks = page.getByTestId("workspace-sourcing-trend").locator("text");
  await expect(ticks).toHaveText(["0", "15", "30"]);
  update.applicants_fb = 15;
  await page.reload();
  await expectWorkspaceReady(page);
  await expect(ticks).toHaveText(["0", "10", "20"]);
});

test("Sourcing draft totals and channel comparisons do not change saved summary", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  mock.data.sourcing_weekly_updates.filter((row) => row.group_id === "GRP-ENG").forEach((row) => { row.week_start = row.week_start === "2026-07-06" ? "2026-07-04" : "2026-06-27"; });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);
  const summary = page.getByTestId("workspace-sourcing-summary");
  const total = page.getByTestId("workspace-sourcing-draft-total");
  const facebook = page.getByTestId("workspace-sourcing-layout").locator('input[name="applicants_fb"]');
  await expect(summary).toContainText("Cumulative applicants20");
  await expect(facebook.locator("xpath=../..")).toContainText("Previous week: 8");
  await expect(facebook.locator("xpath=..")).toContainText("(+4)");
  await facebook.fill("19");
  await expect(total).toContainText("19");
  await expect(total).toContainText(/19\s*\(\+11\)/);
  await expect(summary).toContainText("Cumulative applicants20");
  await page.getByTestId("workspace-sourcing-layout").locator('input[name="applicants_jobthai"]').fill("");
  await expect(total).toContainText("Complete every enabled channel");
  await expect(summary).toContainText("Cumulative applicants20");
  await page.getByTestId("workspace-sourcing-layout").locator('input[name="applicants_jobthai"]').fill("0");
  const save = page.getByTestId("workspace-sourcing-layout").getByRole("button", { name: "Save record" });
  await expect(save.locator("svg")).toBeVisible();
  await expect(total).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await save.click();
  await page.getByRole("dialog", { name: "Confirm Save" }).getByRole("button", { name: /Save changes/i }).click();
  await expect(summary).toContainText("Cumulative applicants27");
  await page.reload();
  await expectWorkspaceReady(page);
  await expect(page.getByTestId("workspace-sourcing-layout").locator('input[name="applicants_fb"]')).toHaveValue("19");
});

test("Sourcing keeps incomplete weeks out of charts while comparing known channel counts", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const current = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06");
  const previous = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-06-29");
  if (!current || !previous) throw new Error("Missing sourcing fixtures");
  current.week_start = "2026-07-04";
  previous.week_start = "2026-06-27";
  current.applicants_jobthai = null;
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);
  const summary = page.getByTestId("workspace-sourcing-summary");
  await expect(summary).toContainText("Cumulative applicants8");
  await expect(summary.getByTestId("workspace-sourcing-pie")).toBeVisible();
  await expect(summary.getByTestId("workspace-sourcing-completeness")).toContainText(/2\/\d+ \(\d+%\)/);
  await expect(summary.locator("ul.sr-only")).toContainText("04/07/2026: Comparison unavailable");
  await expect(summary.getByTestId("workspace-sourcing-trend").locator('path[fill^="url("]')).toHaveCount(0);
  await expect(page.getByTestId("workspace-sourcing-dates").getByRole("button", { name: /04\/07\/2026/ })).toContainText("Incomplete");
  await expect(page.getByTestId("workspace-sourcing-draft-total")).toContainText("Complete every enabled channel");
  await expect(page.getByTestId("workspace-sourcing-layout").locator('input[name="applicants_fb"]').locator("xpath=..")).toContainText("(+4)");
});

test("Sourcing reference layout reflows with accurate periods and Thai copy", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const update = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06");
  if (!update) throw new Error("Missing sourcing update fixture");
  update.week_start = "2026-07-04";
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);
  const summary = page.getByTestId("workspace-sourcing-summary");
  await expect(summary.getByTestId("workspace-sourcing-pie")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 850 });
  const donut = await summary.getByTestId("workspace-sourcing-pie").boundingBox();
  expect(donut!.width).toBeGreaterThan(144);
  expect(donut!.height).toBe(donut!.width);
  const coverage = (await summary.getByTestId("workspace-sourcing-completeness").innerText()).match(/(\d+)\/(\d+) \((\d+)%\)/);
  expect(coverage).not.toBeNull();
  await expect(summary.getByRole("progressbar", { name: "Weekly update completeness" })).toHaveAttribute("aria-valuenow", String(Math.round(Number(coverage![1]) / Number(coverage![2]) * 100)));
  await expect(summary.getByRole("progressbar", { name: "Weekly update completeness" })).toHaveAttribute("aria-valuetext", `${coverage![1]}/${coverage![2]} (${coverage![3]}%)`);
  const pieBounds = await summary.getByTestId("workspace-sourcing-pie").boundingBox();
  const legendBounds = await summary.getByTestId("workspace-sourcing-legend").boundingBox();
  expect(pieBounds!.x + pieBounds!.width <= legendBounds!.x).toBe(true);
  await expect(page.getByTestId("workspace-sourcing-dates")).toContainText("Saturday–Friday");
  await expect(page.getByTestId("workspace-sourcing-layout")).toContainText("04/07/2026–10/07/2026");
  const facebookInput = page.getByTestId("workspace-sourcing-layout").getByRole("spinbutton", { name: "Facebook" });
  await expect(facebookInput).toHaveCSS("text-align", "right");
  const editorHeader = page.getByTestId("workspace-sourcing-layout").locator("form > div").first();
  const saveButton = editorHeader.getByRole("button", { name: "Save record" });
  const statusTag = editorHeader.getByText("Recorded", { exact: true });
  const [tagBox, saveBox] = await Promise.all([statusTag.boundingBox(), saveButton.boundingBox()]);
  expect(tagBox!.x + tagBox!.width <= saveBox!.x).toBe(true);
  await expect(saveButton.locator("svg")).toBeVisible();
  for (const width of [360, 390, 768, 1024, 1079, 1080, 1280, 1600]) {
    await page.setViewportSize({ width, height: 850 });
    const row = summary.getByTestId("workspace-sourcing-summary-row");
    const actualColumns = await row.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
    expect(actualColumns, `${width}px summary columns`).toBe(width >= 1080 ? 3 : 1);
    const horizontalScroll = await summary.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(horizontalScroll, `${width}px internal summary scroll`).toBe(false);
    const sections = await row.locator(":scope > div").all();
    const bounds = await Promise.all(sections.map((section) => section.boundingBox()));
    const donutWidth = (await summary.getByTestId("workspace-sourcing-pie").boundingBox())!.width;
    const expectedDonutWidth = Math.min((bounds[1]!.width - 26) * 0.52, 240);
    expect(Math.abs(donutWidth - expectedDonutWidth), `${width}px responsive donut size`).toBeLessThan(3);
    const plot = await summary.getByTestId("workspace-sourcing-trend").locator("line").first().boundingBox();
    const progress = await summary.getByRole("progressbar", { name: "Weekly update completeness" }).boundingBox();
    expect(plot!.width, `${width}px trend plot width`).toBeGreaterThan(progress!.width - 20);
    if (width >= 1080) {
      expect(bounds[0]!.x < bounds[1]!.x && bounds[1]!.x < bounds[2]!.x).toBe(true);
      const widths = bounds.map((box) => box!.width);
      expect(Math.max(...widths) / Math.min(...widths), `${width}px balanced summary widths`).toBeLessThan(1.3);
      expect(Math.max(...bounds.map((box) => box!.height)) - Math.min(...bounds.map((box) => box!.height)), `${width}px equal card heights`).toBeLessThan(2);
      const labels = await summary.getByTestId("workspace-sourcing-stage-bars").locator("[data-stage] > span:first-child").evaluateAll((elements) => elements.map((element) => ({ height: element.getBoundingClientRect().height, fits: element.scrollWidth <= element.clientWidth + 1 })));
      expect(labels.every((label) => label.height < 20 && label.fits), `${width}px single-line stage labels`).toBe(true);
      const barHeight = await summary.getByTestId("workspace-sourcing-stage-bars").locator("[data-stage] > div").first().evaluate((element) => element.getBoundingClientRect().height);
      expect(barHeight, `${width}px bar height`).toBe(16);
    }
    else expect(bounds[0]!.y < bounds[1]!.y && bounds[1]!.y < bounds[2]!.y).toBe(true);
    const channelLabel = page.getByTestId("workspace-sourcing-layout").locator('label[for="workspace-applicants_fb"]');
    const channelRow = channelLabel.locator("xpath=..");
    await expect(channelRow).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(channelRow).toHaveCSS("border-top-width", "0px");
    const labelBounds = await channelLabel.boundingBox();
    const inputBounds = await facebookInput.boundingBox();
    expect(Math.abs((labelBounds!.y + labelBounds!.height / 2) - (inputBounds!.y + inputBounds!.height / 2)), `${width}px editor row alignment`).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${width}px overflow`).toBe(true);
  }
  await page.goto("/workspace?lang=th&type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expect(page.getByRole("button", { name: "รีเฟรช" })).toBeVisible();
  await expect(page.getByTestId("workspace-sourcing-dates")).toContainText("วันเสาร์–วันศุกร์");
  await expect(summary.getByTestId("workspace-sourcing-top-summary")).toContainText("ช่องทางสูงสุด 1 อันดับ");
  await expect(page.getByTestId("workspace-sourcing-draft-total")).toContainText("ผู้สมัครรวมในรายการที่กำลังแก้ไข");
  const thaiHelp = summary.getByRole("button", { name: /ข้อมูลเกี่ยวกับ/ }).first();
  await thaiHelp.click();
  await expect(summary.getByRole("tooltip")).toContainText("ยอดผู้สมัครจากบันทึกที่ครบถ้วน");
  await thaiHelp.press("Escape");
  await page.setViewportSize({ width: 360, height: 850 });
  const thaiHelpButtons = summary.getByRole("button", { name: /ข้อมูลเกี่ยวกับ/ });
  for (let index = 0; index < 3; index += 1) {
    const helpButton = thaiHelpButtons.nth(index);
    await helpButton.click();
    const helpBounds = await summary.getByRole("tooltip").boundingBox();
    expect(helpBounds!.x >= 0 && helpBounds!.x + helpBounds!.width <= 360).toBe(true);
    await helpButton.press("Escape");
  }
  const save = page.getByTestId("workspace-sourcing-layout").getByRole("button", { name: "บันทึกรายการ" });
  expect((await save.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("Sourcing distribution shows every contributing channel with shared editor colors", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const update = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06");
  if (!update) throw new Error("Missing sourcing update fixture");
  update.week_start = "2026-07-04";
  Object.assign(update, { channel_fb: true, applicants_fb: 5, channel_jobthai: true, applicants_jobthai: 4, channel_linkedin: true, applicants_linkedin: 3, channel_walkin: true, applicants_walkin: 3, channel_referral: true, applicants_referral: 1, channel_others: true, applicants_others: 2 });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);
  const summary = page.getByTestId("workspace-sourcing-summary");
  await expect(summary.getByTestId("workspace-sourcing-pie")).toBeVisible();
  const legend = summary.getByTestId("workspace-sourcing-legend");
  await expect(legend).toContainText("LinkedIn: 3");
  await expect(legend).toContainText("Walk-in: 3");
  await expect(legend).toContainText("Referral: 1");
  await expect(legend).toContainText("Others: 2");
  await expect(legend.locator("li")).toHaveCount(6);
  await expect(summary.getByTestId("workspace-sourcing-top-callout")).toHaveCount(0);
  await expect(summary.getByTestId("workspace-sourcing-top-summary")).toHaveText("Top 3 channels: Facebook, JobThai and LinkedIn in total 12 of 18 applicants (67%).");
  const subtitle = await summary.getByTestId("workspace-sourcing-top-summary").boundingBox();
  const heading = await summary.getByRole("heading", { name: "Channel distribution" }).boundingBox();
  const chart = await summary.getByTestId("workspace-sourcing-pie").boundingBox();
  expect(heading!.y + heading!.height <= subtitle!.y && subtitle!.y + subtitle!.height <= chart!.y).toBe(true);
  await expect(legend.getByText(/Facebook: 5/).locator("xpath=..").locator("span").first()).toHaveCSS("background-color", "rgb(59, 111, 232)");
  await expect(legend.getByText(/JobThai: 4/).locator("xpath=..").locator("span").first()).toHaveCSS("background-color", "rgb(242, 140, 69)");
  await expect(legend.getByText(/LinkedIn: 3/).locator("xpath=..").locator("span").first()).toHaveCSS("background-color", "rgb(38, 166, 198)");
  const editorDot = page.getByTestId("workspace-sourcing-layout").locator('label[for="workspace-applicants_fb"] > span > span').first();
  await expect(editorDot).toHaveCSS("background-color", "rgb(59, 111, 232)");
  const arcs = summary.getByTestId("workspace-sourcing-pie").locator('[data-channel="channel_fb"]');
  await expect(arcs).toHaveCount(1);
  await expect(arcs).toHaveAttribute("stroke", "#3B6FE8");
  await expect(arcs).not.toHaveAttribute("stroke-opacity", /.+/);
});

test("stage channel bars use distinct group candidates through the selected week", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  mock.data.sourcing_weekly_updates.filter((row) => row.group_id === "GRP-ENG").forEach((row) => { row.week_start = row.week_start === "2026-07-06" ? "2026-07-04" : "2026-06-27"; });
  const legacyLogs = mock.data.recruitment_logs.filter((row) => row.candidate_id === "C-HR");
  legacyLogs.forEach((row) => { row.stage_instance_id = null; });
  const source = mock.data.candidates.find((row) => row.candidate_id === "C-HR");
  const phone = mock.data.recruitment_logs.find((row) => row.candidate_id === "C-PHONE-PASS");
  if (!source || !phone) throw new Error("Missing stage fixtures");
  mock.data.candidates.push({ ...source, candidate_id: "C-UNKNOWN", channel: null });
  mock.data.recruitment_logs.push({ ...phone, log_id: 901, candidate_id: "C-UNKNOWN", log_date: "2026-07-08", stage_instance_id: "stage-unknown" });
  mock.data.recruitment_logs.push({ ...phone, log_id: 902, candidate_id: "C-PHONE-PASS", stage_instance_id: "stage-superseded", superseded_at: "2026-07-09T00:00:00Z" });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);
  const summary = page.getByTestId("workspace-sourcing-summary");
  const bars = summary.getByTestId("workspace-sourcing-stage-bars");
  await expect(bars.locator("[data-stage]")).toHaveCount(6);
  await expect(bars.locator("[data-stage]").nth(1)).toHaveCSS("border-top-style", "dashed");
  const phoneBar = bars.locator('[data-stage="Phone Screen"]');
  await expect(phoneBar).toContainText("6");
  await expect(phoneBar.locator('[data-channel="unknown"]')).toHaveAttribute("title", "Unknown: 1");
  await expect(phoneBar.locator('[data-channel="channel_fb"]')).toHaveAttribute("title", "Facebook: 3");
  await expect(bars.locator('[data-stage="HR Interview"]')).toContainText("1");
  await expect(summary.getByTestId("workspace-sourcing-stage-legend")).toHaveCount(0);
  await expect(phoneBar).toHaveAttribute("aria-label", /Unknown: 1/);
  await expect(summary.getByTestId("workspace-sourcing-legend")).not.toContainText("Unknown");
  await expect(summary).toContainText("through 10/07/2026");
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-18");
  await expect(bars.locator('[data-stage="HR Interview"]')).toContainText("3");
});

test("Sourcing donut keeps JobsDB, JobBKK, and JobTopGun channel colors", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const update = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06");
  if (!update) throw new Error("Missing sourcing update fixture");
  Object.assign(update, {
    week_start: "2026-07-04",
    applicants_fb: 0,
    channel_jobdb: true, applicants_jobdb: 9,
    channel_jobbkk: true, applicants_jobbkk: 8,
    channel_jobtopgun: true, applicants_jobtopgun: 7
  });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expectWorkspaceReady(page);
  const legend = page.getByTestId("workspace-sourcing-legend");
  await expect(legend.getByText(/JobsDB: 9/).locator("xpath=..").locator("span").first()).toHaveCSS("background-color", "rgb(118, 102, 228)");
  await expect(legend.getByText(/JobBKK: 8/).locator("xpath=..").locator("span").first()).toHaveCSS("background-color", "rgb(231, 102, 131)");
  await expect(legend.getByText(/JobTopGun: 7/).locator("xpath=..").locator("span").first()).toHaveCSS("background-color", "rgb(49, 185, 120)");
});

test("Sourcing chart preserves a recorded zero and Thai labels", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const update = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06");
  if (!update) throw new Error("Missing sourcing update fixture");
  update.week_start = "2026-07-04";
  update.applicants_fb = 0;
  await page.goto("/workspace?lang=th&type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-04");
  await expect(page.getByRole("button", { name: "รีเฟรช" })).toBeVisible();
  const summary = page.getByTestId("workspace-sourcing-summary");
  await expect(summary.getByTestId("workspace-sourcing-trend")).toBeVisible();
  await expect(summary.getByTestId("workspace-sourcing-trend").locator("text")).toHaveText(["0"]);
  await expect(summary.getByTestId("workspace-sourcing-pie")).toHaveCount(0);
  await expect(summary.getByTestId("workspace-sourcing-top-summary")).toHaveCount(0);
  await expect(summary).toContainText("ไม่มีผู้สมัครในบันทึกที่ครบถ้วนจนถึงสัปดาห์นี้");
  await expect(summary.locator("ul.sr-only")).toContainText("0");
});

test("Activity shows recorded sourcing actor and an honest fallback", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=activity");
  await expectWorkspaceReady(page);
  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("Actor");
  await expect(panel).toContainText("qa-admin");
  await expect(panel).toContainText("Unknown");
  await expect(panel.locator('[data-tag-appearance="soft"]')).not.toHaveCount(0);
});

test("desktop group header compacts to identity without covering tabs", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  for (const language of ["en", "th"] as const) {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.goto(`/workspace?type=group&id=GRP-ENG&doc=REQ-HQ-2&lang=${language}`);
    await expect(page.getByRole("tablist")).toBeVisible();
    const heading = page.getByRole("heading", { name: "Engineer", exact: true, level: 1 });
    const header = heading.locator("xpath=ancestor::section[1]");
    await expect(header.getByTestId("workspace-site-owner")).toBeVisible();
    await expect(header.getByTestId("group-header-metrics")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 100));
    await expect(heading).toHaveClass(/lg:text-lg/);
    await expect(header.getByTestId("workspace-site-owner")).toBeHidden();
    await expect(header.getByTestId("group-header-metrics")).toBeHidden();
    await expect(header.getByTestId("group-focused-tags")).toBeHidden();
    await expect(header.getByRole("navigation", { name: /Workspace breadcrumbs/ })).toBeHidden();
    await expect(header.getByRole("button")).toHaveCount(0);
    await expect.poll(async () => {
      const position = await header.boundingBox();
      const tabs = await page.getByRole("tablist").boundingBox();
      return Boolean(position && tabs && position.y + position.height <= tabs.y + 1);
    }).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 400));
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(250);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollY)).toBeLessThanOrEqual(2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(header.getByTestId("group-header-metrics")).toBeVisible();
    await expect(header.getByTestId("workspace-site-owner")).toBeVisible();
  }
});

test("group header remains expanded and metrics reflow on phones and tablets", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  for (const language of ["en", "th"] as const) {
    for (const width of [360, 768]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto(`/workspace?type=group&id=GRP-ENG&lang=${language}`);
      await expect(page.getByRole("tablist")).toBeVisible();
      const heading = page.getByRole("heading", { name: "Engineer", exact: true, level: 1 });
      const header = heading.locator("xpath=ancestor::section[1]");
      const items = header.getByTestId("group-header-metrics").locator(":scope > div > div");
      const boxes = await Promise.all([0, 1, 2, 3].map(async (index) => items.nth(index).boundingBox()));
      expect(boxes.every(Boolean)).toBe(true);
      expect(boxes[0]!.y).toBe(boxes[1]!.y);
      expect(width === 360 ? boxes[2]!.y > boxes[0]!.y : boxes[2]!.y === boxes[0]!.y).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 300));
      await expect(header.getByTestId("workspace-site-owner")).toBeVisible();
      await expect(header.getByTestId("group-header-metrics")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    }
  }
});

test("group header handles long ID, missing owner, and back navigation", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const group = mock.data.position_groups.find((row) => row.group_id === "GRP-ENG");
  if (!group) throw new Error("Missing GRP-ENG fixture");
  const longId = "GRP-ENGINEERING-OPERATIONS-REGIONAL-STRATEGIC-SOURCING-2026";
  group.group_id = longId;
  mock.data.document_groups.filter((row) => row.group_id === "GRP-ENG").forEach((row) => { row.group_id = longId; });
  mock.data.requisitions.filter((row) => ["REQ-HQ-1", "REQ-HQ-2"].includes(row.doc_id)).forEach((row) => { row.person_in_charge = ""; });
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`/workspace?type=group&id=${longId}`);
  await expectWorkspaceReady(page);
  const heading = page.getByRole("heading", { name: "Engineer", exact: true, level: 1 });
  const header = heading.locator("xpath=ancestor::section[1]");
  await expect(header.getByTestId("workspace-site-owner")).toContainText(longId);
  await expect(header.getByTestId("workspace-site-owner")).toContainText("Unassigned");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  const back = header.getByRole("button", { name: "Back to Workspace groups" });
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page).not.toHaveURL(/type=group|id=/);
  await expect(page.getByRole("heading", { name: "Select a hiring workspace" })).toBeVisible();
});

test("long group identity keeps metrics below it on phones and compacts on scroll", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const longTitle = "Senior Procurement Operations and Supplier Development Specialist with Regional Strategic Sourcing Responsibilities";
  const group = mock.data.position_groups.find((row) => row.group_id === "GRP-ENG");
  if (!group) throw new Error("Missing GRP-ENG test fixture");
  group.group_position = longTitle;

  for (const language of ["en", "th"] as const) {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/workspace?type=group&id=GRP-ENG&lang=${language}`);
    const heading = page.getByRole("heading", { name: longTitle, level: 1 });
    await expect(heading).toBeVisible();
    const header = heading.locator("xpath=ancestor::section[1]");
    await expect(header.getByRole("button", { name: /Back to Workspace groups|กลับไปยังกลุ่ม/ })).toBeVisible();
    const headingBox = await heading.boundingBox();
    const metricsBox = await header.getByTestId("group-header-metrics").boundingBox();
    expect(headingBox && metricsBox && metricsBox.y > headingBox.y + headingBox.height).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    await expect(header.getByTestId("workspace-site-owner")).toContainText("GRP-ENG");
  }

  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto("/workspace?type=group&id=GRP-ENG&lang=en");
  await expectWorkspaceReady(page);
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(page.getByRole("heading", { name: longTitle, level: 1 })).toHaveClass(/text-lg/);
  await expect(page.getByRole("heading", { name: longTitle, level: 1 })).toBeVisible();
});

test("workspace group rows truncate long titles and retain the full native tooltip", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const longTitle = "Senior Procurement Operations and Supplier Development Specialist with Regional Strategic Sourcing Responsibilities";
  const group = mock.data.position_groups.find((row) => row.group_id === "GRP-ENG");
  if (!group) throw new Error("Missing GRP-ENG test fixture");
  group.group_position = longTitle;

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);
  const title = page.getByRole("button", { name: `${longTitle}, GRP-ENG` });
  await expect(title).toBeVisible();
  await expect(title).toHaveAttribute("title", longTitle);
  await expect(title.locator("span")).toHaveClass(/truncate/);
  await expect(page.getByText("GRP-ENG", { exact: true })).toBeVisible();
  const [cellBox, titleBox, idBox] = await Promise.all([title.locator("..").boundingBox(), title.boundingBox(), page.getByText("GRP-ENG", { exact: true }).boundingBox()]);
  expect(cellBox!.width).toBeLessThan(250);
  expect(titleBox!.height).toBeGreaterThanOrEqual(44);
  expect(idBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
});

test("picker scope toggle precedes New in one compact control row", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  for (const language of ["en", "th"] as const) {
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace?lang=${language}`);
      await expect(page.getByRole("heading", { name: language === "en" ? "Select a hiring workspace" : "เลือกพื้นที่งานสรรหา" })).toBeVisible();
      const scope = page.getByRole("group", { name: language === "en" ? "Group scope" : "ขอบเขตกลุ่ม" });
      const create = page.getByRole("button", { name: language === "en" ? "New" : "สร้างใหม่", exact: true });
      const [scopeBox, createBox] = await Promise.all([scope.boundingBox(), create.boundingBox()]);
      expect(scopeBox!.x + scopeBox!.width).toBeLessThanOrEqual(createBox!.x);
      expect(Math.abs((scopeBox!.y + scopeBox!.height / 2) - (createBox!.y + createBox!.height / 2))).toBeLessThanOrEqual(1);
      expect(createBox!.height).toBeGreaterThanOrEqual(width === 360 ? 44 : 36);
      expect((await scope.getByRole("button").first().boundingBox())!.height).toBeGreaterThanOrEqual(width === 360 ? 44 : 36);
      if (width === 360) {
        const title = page.getByRole("heading", { name: language === "en" ? "Select a hiring workspace" : "เลือกพื้นที่งานสรรหา" });
        const titleBox = await title.boundingBox();
        expect(scopeBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  }
});

test("site recruiter sees workspace records assigned to them or in their assigned site", async ({ page }) => {
  await installMockSupabase(page, { role: "site_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("button", { name: /GRP-TECH/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /GRP-KT1-PEER/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /GRP-HQ-BOB/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /GRP-ENG/ })).toHaveCount(0);
});

test("empty workspace picker keeps New Group available", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);
  const picker = page.getByRole("heading", { name: "Select a hiring workspace", level: 2 }).locator(".." );
  await page.getByLabel("Search workspaces").fill("does-not-exist");
  await expect(page.getByText("No matching workspaces.")).toBeVisible();
  await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Group" }).click();
  await expect(page.getByRole("dialog", { name: "Create Group" })).toBeVisible();
  await expect(picker).toBeVisible();
});

test("workspace picker exposes contextual group setup actions only to setup managers", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("button", { name: "New", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Link Group" })).toHaveCount(0);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "New Requisition" })).toBeVisible();
  await page.getByRole("menuitem", { name: "New Group" }).click();
  await expect(page.getByRole("dialog", { name: "Create Group" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("button", { name: "New", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Link Group" })).toHaveCount(0);
});

test("workspace picker keeps all matches, supports sorting, and opens the selected case", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const base = mock.data.position_groups[0];
  const match = mock.data.document_groups.find((row) => row.group_id === base.group_id);
  if (!match) throw new Error("Missing group match fixture");
  for (let index = 0; index < 14; index += 1) {
    mock.data.position_groups.push({ ...base, group_id: `GRP-EXTRA-${index}`, group_position: `Extra role ${index}` });
    mock.data.document_groups.push({ ...match, doc_group_id: `DG-EXTRA-${index}`, group_id: `GRP-EXTRA-${index}` });
  }
  await page.goto("/workspace");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("status")).toContainText("matching workspaces");
  await expect(page.getByRole("button", { name: /GRP-EXTRA-13/ })).toBeVisible();
  await page.getByLabel("Sort by").selectOption("name");
  await expect(page.getByRole("button", { name: /GRP-ENG/ })).toBeVisible();
  await page.getByLabel("Search workspaces").fill("GRP-EXTRA-13");
  await expect(page.getByRole("status")).toContainText("1 matching workspaces");
  await page.getByRole("button", { name: /GRP-EXTRA-13/ }).click();
  await expect(page).toHaveURL(/type=group.*id=GRP-EXTRA-13/);
});

test("workspace picker and selected case avoid page overflow across languages and widths", async ({ page }) => {
  test.setTimeout(90000);
  await installMockSupabase(page, { role: "admin_recruiter" });
  for (const language of ["en", "th"] as const) {
    for (const width of [360, 390, 768, 1024, 1080, 1279, 1280, 1600]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/workspace?lang=${language}`);
      await expect(page.getByRole("heading", { name: language === "en" ? "Select a hiring workspace" : "เลือกพื้นที่งานสรรหา" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), `${language} picker at ${width}px`).toBe(false);
      await page.goto(`/workspace?type=group&id=GRP-ENG&lang=${language}`);
      await expect(page.getByRole("tablist")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow, `${language} at ${width}px`).toBe(false);
    }
  }
});
