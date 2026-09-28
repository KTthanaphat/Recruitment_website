import { expect, test, type Page } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

async function expectNoDocumentOverflow(page: Page, label: string) {
  const geometry = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  expect(geometry.documentWidth, `${label}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.viewportWidth);
}

test("requisition priority columns fit the initial 1440px viewport and preserve detail, sort, and filter behavior", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const cancelled = mock.data.requisitions.find((row) => row.doc_id === "REQ-KT1-1");
  if (!cancelled) throw new Error("Expected requisition fixture.");
  cancelled.status = "cancel";

  await page.goto("/requisitions");
  await expectWorkspaceReady(page);

  const viewport = page.locator(".table-scroll:visible");
  await expect(viewport).toHaveJSProperty("scrollLeft", 0);
  const labels = ["Doc ID", "Position", "Status", "Open HC", "Fill Readiness", "SLA", "Age", "Owner"];
  const geometry = await viewport.evaluate((element, expectedLabels) => {
    const bounds = element.getBoundingClientRect();
    const headers = Array.from(element.querySelectorAll("th")).map((header) => ({
      text: header.textContent?.trim() ?? "",
      left: header.getBoundingClientRect().left,
      right: header.getBoundingClientRect().right
    }));
    return {
      viewport: { left: bounds.left, right: bounds.right, width: bounds.width },
      priority: expectedLabels.map((label) => headers.find((header) => header.text.startsWith(label)))
    };
  }, labels);
  for (const [index, header] of geometry.priority.entries()) {
    expect(header, `missing ${labels[index]}: ${JSON.stringify(geometry)}`).toBeTruthy();
    if (index <= 5) {
      expect(header!.left, `${labels[index]} left: ${JSON.stringify(geometry)}`).toBeGreaterThanOrEqual(geometry.viewport.left - 1);
      expect(header!.right, `${labels[index]} right: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(geometry.viewport.right + 1);
    }
    if (index > 0) expect(header!.left).toBeGreaterThanOrEqual(geometry.priority[index - 1]!.left);
  }
  await expectNoDocumentOverflow(page, "requisitions desktop");

  const statusTags = viewport.locator('[data-tag-appearance="soft"]');
  await expect(statusTags.filter({ hasText: "Ongoing" }).first()).toBeVisible();
  await expect(statusTags.filter({ hasText: "Filled" }).first()).toBeVisible();
  await expect(statusTags.filter({ hasText: "Cancelled" }).first()).toBeVisible();
  const statusColors = await Promise.all(["Ongoing", "Filled", "Cancelled"].map((status) => statusTags.filter({ hasText: status }).first().evaluate((element) => getComputedStyle(element).color)));
  expect(new Set(statusColors).size).toBe(3);

  await page.getByRole("button", { name: "Sort Status", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("reqSort")).toBe("status");
  expect(new URL(page.url()).searchParams.get("reqDir")).toBe("asc");
  await page.getByRole("button", { name: "Advanced Filters", exact: true }).click();
  const statusFilter = page.getByLabel("Filter Status", { exact: true });
  await statusFilter.click();
  await statusFilter.locator("xpath=ancestor::details[1]").getByText("Ongoing", { exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("reqFilters") ?? "").toContain("status");

  await page.getByRole("button", { name: "View requisition detail for REQ-HQ-1", exact: true }).click();
  await expect(page.getByRole("dialog").filter({ hasText: "REQ-HQ-1" })).toBeVisible();
});

test("admin table toolbars expose localized creation actions while viewers retain read-only tables", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  for (const [route, label] of [["/candidates", "New Candidate"], ["/requisitions", "New Requisition"], ["/offers", "New Offer"]] as const) {
    await page.goto(route);
    await expectWorkspaceReady(page);
    await expect(page.locator("[data-table-toolbar]").getByRole("button", { name: label, exact: true })).toBeVisible();
    if (route === "/requisitions") await expect(page.locator("[data-table-toolbar]").getByRole("button", { name: "Status", exact: true })).toBeVisible();
    await expectNoDocumentOverflow(page, route);
  }
  await expect(page.getByRole("heading", { name: "Offers", exact: true })).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/offers");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("button", { name: "New Offer", exact: true })).toBeVisible();
  await expectNoDocumentOverflow(page, "offers mobile");
});

test("viewer table toolbars hide write actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockSupabase(page, { role: "viewer" });
  for (const [route, label] of [["/candidates", "New Candidate"], ["/requisitions", "New Requisition"], ["/offers", "New Offer"]] as const) {
    await page.goto(route);
    await expectWorkspaceReady(page);
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
  }
});

test("Thai candidate toolbar uses the full localized creation label", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  await page.goto("/candidates");
  await expect(page.locator("[data-table-toolbar]").getByRole("button", { name: "เพิ่มผู้สมัคร", exact: true })).toBeVisible();
  await expectNoDocumentOverflow(page, "Thai candidates mobile");
});

for (const [route, collection, label] of [
  ["/candidates", "candidates", "New Candidate"],
  ["/requisitions", "requisitions", "New Requisition"],
  ["/offers", "offers", "New Offer"]
] as const) {
  test(`${route} empty state retains its labeled creation action`, async ({ page }) => {
    const mock = await installMockSupabase(page, { role: "admin_recruiter" });
    mock.data[collection] = [];
    await page.goto(route);
    await expectWorkspaceReady(page);
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  });
}

test("mobile sourcing presents unmatched long Thai positions as the primary identity", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const group = mock.data.position_groups.find((row) => row.group_id === "GRP-BUY");
  if (!group) throw new Error("Expected sourcing group fixture.");
  const longPosition = "ผู้เชี่ยวชาญอาวุโสด้านการจัดซื้อเชิงกลยุทธ์และการพัฒนาคู่ค้าระหว่างประเทศ";
  group.group_position = longPosition;

  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Sourcing", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "New Group", exact: true })).toBeVisible();
  const unmatchedPanel = page.getByRole("heading", { name: "Unmatched sourcing groups" }).locator("xpath=ancestor::section[1]");
  const groupRow = unmatchedPanel.locator("div.rounded-lg", { hasText: "GRP-BUY" });
  const position = groupRow.locator("strong", { hasText: longPosition });
  await expect(position).toBeVisible();
  const groupId = groupRow.getByText("GRP-BUY", { exact: true });
  await expect(groupId).toBeVisible();
  expect(await groupId.evaluate((element) => getComputedStyle(element).color)).toBe("rgb(71, 85, 105)");
  await expect(groupRow).not.toContainText("HQ");
  await expect(groupRow).not.toContainText("Alice");
  await expect(groupRow.getByRole("button", { name: "Details", exact: true })).toBeVisible();
  const match = groupRow.getByRole("button", { name: "Match requisition", exact: true });
  await expect(match).toBeVisible();
  const mobileLayout = await groupRow.evaluate((element) => {
    const text = element.querySelector("strong")!.parentElement!.getBoundingClientRect();
    const actions = element.querySelector("button")!.parentElement!.getBoundingClientRect();
    const row = element.getBoundingClientRect();
    return { actionsTop: actions.top, rowWidth: row.width, textBottom: text.bottom, textWidth: text.width };
  });
  expect(mobileLayout.actionsTop).toBeGreaterThanOrEqual(mobileLayout.textBottom - 1);
  expect(mobileLayout.textWidth).toBeGreaterThan(mobileLayout.rowWidth * 0.8);
  const actionColors = await Promise.all([
    match.evaluate((element) => getComputedStyle(element).backgroundColor),
    page.getByRole("button", { name: "New Group", exact: true }).evaluate((element) => getComputedStyle(element).backgroundColor),
    groupRow.getByRole("button", { name: "Details", exact: true }).evaluate((element) => getComputedStyle(element).backgroundColor)
  ]);
  expect(actionColors[0]).toBe(actionColors[1]);
  expect(actionColors[0]).not.toBe(actionColors[2]);
  await expectNoDocumentOverflow(page, "sourcing mobile");
});

test("mobile standalone and embedded Pipeline expose labeled responsive New Candidate actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("button", { name: "New Candidate", exact: true })).toBeVisible();
  await expectNoDocumentOverflow(page, "pipeline mobile");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("button", { name: "New Candidate", exact: true })).toBeVisible();
  await expectNoDocumentOverflow(page, "pipeline table mobile");

  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&section=pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("button", { name: "New Candidate", exact: true })).toBeVisible();
  await expectNoDocumentOverflow(page, "embedded pipeline mobile");
});
