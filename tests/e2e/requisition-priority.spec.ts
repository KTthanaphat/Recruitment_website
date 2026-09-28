import { expect, test } from "@playwright/test";
import { canManageRequisitionPriority, priorityRequisitionScope } from "../../src/lib/requisition-priority";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("priority bookmark persists, filters records and survives navigation", async ({ page }, testInfo) => {
  const mock = await installMockSupabase(page);
  const requisition = mock.data.requisitions.find(row => row.doc_id === "REQ-HQ-1")!;
  const originalTimestamp = requisition.updated_at;
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  const utilities = drawer.locator("[data-detail-utility]");
  await expect(utilities).toHaveCount(4);
  const geometry = await utilities.evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    const icon = node.querySelector("svg")!.getBoundingClientRect();
    return { top: box.top, width: box.width, height: box.height, center: box.y + box.height / 2, iconWidth: icon.width, iconHeight: icon.height };
  }));
  expect(geometry.every(box => box.width === 36 && box.height === 36 && box.iconWidth === 18 && box.iconHeight === 18)).toBe(true);
  expect(Math.max(...geometry.map(box => box.center)) - Math.min(...geometry.map(box => box.center))).toBeLessThan(1);
  expect(geometry.every(box => Math.abs(box.top - 16) < 1)).toBe(true);
  await expect(drawer.getByRole("button", { name: "Mark as priority", exact: true }).locator("svg")).toHaveAttribute("fill", "none");
  await drawer.getByRole("button", { name: "Mark as priority", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Remove priority", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(0, 0);
  await expect(drawer.getByRole("button", { name: "Remove priority", exact: true }).locator("svg")).toHaveCSS("color", "rgb(10, 60, 220)");
  await expect(drawer.getByRole("button", { name: "Remove priority", exact: true }).locator("svg")).toHaveAttribute("fill", "currentColor");
  await page.screenshot({ path: testInfo.outputPath("priority-detail-desktop.png"), fullPage: true });
  expect(mock.rpcCalls.find(call => call.endpoint === "app_set_requisition_priority_v1")?.payload)
    .toEqual({ doc_id: "REQ-HQ-1", is_priority: true, expected_updated_at: originalTimestamp });
  await expect(drawer.getByRole("button", { name: "Change record", exact: true })).toHaveCount(0);
  await drawer.getByRole("button", { name: /More actions/ }).click();
  await expect(drawer.getByRole("menuitem", { name: "Change record", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await drawer.getByRole("button", { name: "Close", exact: true }).click();

  const filter = page.getByRole("button", { name: "Priority requisition filter", exact: true });
  await filter.focus();
  await page.keyboard.press("Enter");
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/priority=only/);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("REQ-HQ-1");
  const docId = page.locator("tbody").getByRole("button", { name: "View requisition detail for REQ-HQ-1", exact: true });
  const bookmarkIcon = docId.locator("svg");
  await expect(bookmarkIcon).toHaveCSS("color", "rgb(10, 60, 220)");
  expect(await docId.evaluate(node => {
    const value = Array.from(node.childNodes).find(child => child.nodeType === Node.TEXT_NODE && child.textContent?.includes("REQ-HQ-1"));
    const icon = node.querySelector("svg");
    return Boolean(value && icon && (value.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  await expect(filter.locator("svg")).toHaveCSS("color", "rgb(10, 60, 220)");
  await page.reload();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("priority-desktop.png"), fullPage: true });
  await page.getByRole("link", { name: "Dashboard", exact: true }).first().click();
  await expect(page).toHaveURL(/priority=only/);
  await expect(page.getByRole("heading", { name: "Vacancy Waterfall", exact: true })).toBeVisible();
  await expect(page.locator("[data-performance-report]").first().locator("[data-site-header]")).toHaveText(["HQ", "Total"]);

  await page.goto("/requisitions?priority=only&detailType=requisition&detailId=REQ-HQ-1");
  await expect(drawer.getByRole("link", { name: "Open workspace", exact: true })).toHaveAttribute("href", /priority=only/);
  await drawer.getByRole("button", { name: "Remove priority", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Mark as priority", exact: true })).toHaveAttribute("aria-pressed", "false");
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("tbody tr")).toHaveCount(mock.data.requisitions.length);
});

test("failed priority save retains the original bookmark and shows a useful error", async ({ page }) => {
  await installMockSupabase(page);
  await page.route("**/rest/v1/rpc/app_set_requisition_priority_v1", route => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "PRIORITY_STALE_WRITE" }) }));
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await drawer.getByRole("button", { name: "Mark as priority", exact: true }).click();
  await expect(drawer.getByRole("alert")).toContainText("Could not save priority");
  await expect(drawer.getByRole("button", { name: "Mark as priority", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("priority respects viewer, assigned-site and PIC permissions", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "site_recruiter" });
  const ownSite = data.requisitions.find(row => row.doc_id === "REQ-KT1-PEER")!;
  const ownPic = data.requisitions.find(row => row.doc_id === "REQ-HQ-BOB")!;
  const other = data.requisitions.find(row => row.doc_id === "REQ-HQ-1")!;
  expect(canManageRequisitionPriority(data.profile, ownSite)).toBe(true);
  expect(canManageRequisitionPriority(data.profile, ownPic)).toBe(true);
  expect(canManageRequisitionPriority(data.profile, other)).toBe(false);
  expect(canManageRequisitionPriority({ ...data.profile!, nickname: null }, { ...other, person_in_charge: null })).toBe(false);
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Mark as priority", exact: true })).toBeDisabled();
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Mark as priority", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Priority requisition filter", exact: true })).toBeEnabled();
});

test("priority scope reconciles requisitions, group pools and related records", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  data.requisitions.find(row => row.doc_id === "REQ-HQ-1")!.is_priority = true;
  data.candidates[0].group_id = "GRP-ENG";
  data.candidates[0].doc_group_id = "DG-HQ2-ENG";
  const scoped = priorityRequisitionScope(data, true);
  expect(priorityRequisitionScope(data, false)).toBe(data);
  expect(scoped.requisitions.map(row => row.doc_id)).toEqual(["REQ-HQ-1"]);
  expect(scoped.candidates.some(row => row.candidate_id === data.candidates[0].candidate_id)).toBe(true);
  expect(scoped.offers.every(row => row.doc_id === "REQ-HQ-1")).toBe(true);
  expect(scoped.position_groups.map(row => row.group_id)).toEqual(["GRP-ENG"]);
  expect(scoped.document_groups.map(row => row.doc_group_id)).toEqual(["DG-HQ-ENG"]);
  expect(data.requisitions.length).toBeGreaterThan(1);
});

test("Thai phone controls fit and place the bookmark between PIC and language", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { language: "th" });
  await page.goto("/requisitions?lang=th&detailType=requisition&detailId=REQ-HQ-1");
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("button", { name: "ทำเครื่องหมายคำขอเร่งด่วน", exact: true })).toBeVisible();
  const utilitySizes = await drawer.locator("[data-detail-utility]").evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { top: box.top, width: box.width, height: box.height };
  }));
  expect(utilitySizes).toHaveLength(4);
  expect(utilitySizes.every(box => box.width === 44 && box.height === 44 && Math.abs(box.top - 16) < 1)).toBe(true);
  await drawer.getByRole("button", { name: "ทำเครื่องหมายคำขอเร่งด่วน", exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(drawer.locator('[aria-pressed="true"] svg')).toHaveCSS("color", "rgb(10, 60, 220)");
  await page.screenshot({ path: testInfo.outputPath("priority-phone.png"), fullPage: true });
  await drawer.getByRole("button", { name: "Close", exact: true }).click();
  const header = page.locator("[data-app-header-actions]");
  const bookmark = header.getByRole("button", { name: "ตัวกรองคำขอเร่งด่วน", exact: true });
  await expect(bookmark).toBeVisible();
  expect((await bookmark.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await header.locator("button").evaluateAll(nodes => {
    const bookmarkIndex = nodes.findIndex(node => node.getAttribute("aria-label") === "ตัวกรองคำขอเร่งด่วน");
    return nodes[bookmarkIndex + 1]?.textContent?.trim();
  })).toBe("EN");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
