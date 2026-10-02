import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("form selectors and table category filter share the dropdown surface", async ({ page }, testInfo) => {
  await installMockSupabase(page, { role: "admin_recruiter", language: "en" });
  await page.goto("/requisitions");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Advanced Filters", exact: true }).click();
  const statusFilter = page.getByLabel("Filter Status", { exact: true });
  await expect(statusFilter).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(statusFilter).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await statusFilter.click();
  const statusMenu = statusFilter.locator("xpath=ancestor::details[1]").locator(".ats-dropdown-menu");
  await expect(statusMenu).toHaveCSS("background-color", "rgb(255, 255, 255)");
  const statusRow = await statusMenu.locator("label").nth(1).boundingBox();
  expect(statusRow!.height).toBeGreaterThanOrEqual(36);
  expect(statusRow!.height).toBeLessThan(44);
  await expect(statusMenu.locator("label").nth(1)).toHaveCSS("border-radius", "8px");
  const statusCheckbox = statusMenu.locator('input[type="checkbox"]').nth(1);
  await expect(statusCheckbox).toHaveCSS("appearance", "none");
  await statusCheckbox.check();
  await expect(statusCheckbox).toBeChecked();
  await expect(statusCheckbox).toHaveCSS("background-color", "rgb(10, 60, 220)");
  await expect(statusMenu.locator("label").nth(1)).toHaveCSS("background-color", "rgb(233, 242, 255)");
  await statusFilter.locator("xpath=ancestor::details[1]").screenshot({ path: testInfo.outputPath("table-filter-desktop.png") });

  await page.getByRole("button", { name: "New Requisition", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create Requisition" });
  const requestType = dialog.getByRole("button", { name: /request type/i });
  await expect(requestType).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(requestType).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  const status = dialog.getByRole("button", { name: "Status", exact: true });
  await expect(status).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(status).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await expect(dialog.getByRole("button", { name: "Section", exact: true })).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await requestType.click();
  await expect(dialog.getByRole("listbox", { name: "request_type" }).getByRole("option")).toHaveCount(2);
  await dialog.screenshot({ path: testInfo.outputPath("form-dropdown-desktop.png") });
  await dialog.getByRole("listbox", { name: "request_type" }).getByRole("option", { name: "Replacement" }).click();
  await expect(requestType).toContainText("Replacement");

  await page.setViewportSize({ width: 390, height: 844 });
  await requestType.click();
  const phoneChoice = await dialog.getByRole("listbox", { name: "request_type" }).getByRole("option", { name: "New" }).boundingBox();
  expect(phoneChoice!.height).toBeGreaterThanOrEqual(44);
  expect(phoneChoice!.x).toBeGreaterThanOrEqual(0);
  expect(phoneChoice!.x + phoneChoice!.width).toBeLessThanOrEqual(390);
  await dialog.screenshot({ path: testInfo.outputPath("form-dropdown-phone.png") });
});

test("Thai dashboard selectors retain fixed blue styling and readable choices", async ({ page }) => {
  await installMockSupabase(page, { language: "th" });
  await page.goto("/dashboard");
  const overview = page.locator("[data-performance-overview]");
  await expect(overview).toBeVisible();
  const site = overview.getByRole("button", { name: "สถานที่", exact: true });
  await expect(site).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await expect(site).toHaveCSS("border-radius", "12px");
  await site.click();
  const list = overview.getByRole("listbox", { name: "สถานที่" });
  await expect(list.getByRole("option").first()).toBeVisible();
  const siteChoice = list.getByRole("option").nth(1);
  const siteChoiceBox = await siteChoice.boundingBox();
  expect(siteChoiceBox!.height).toBeGreaterThanOrEqual(36);
  expect(siteChoiceBox!.height).toBeLessThan(44);
  await expect(siteChoice).toHaveCSS("border-radius", "8px");
  await overview.evaluate((element) => element.style.setProperty("--app-primary", "#0AA0C3"));
  await expect(list.getByRole("option", { selected: true }).first().locator("span").first()).toHaveCSS("background-color", "rgb(10, 60, 220)");
  await page.keyboard.press("Escape");
  await expect(site).toBeFocused();
});

test("single and multi-select choices share selected and active states without changing selection behavior", async ({ page }) => {
  await installMockSupabase(page, { language: "en" });
  await page.goto("/dashboard");
  const overview = page.locator("[data-performance-overview]");
  await expect(overview).toBeVisible();

  const period = overview.getByRole("button", { name: "Period", exact: true });
  await period.click();
  const periodMenu = overview.getByRole("listbox", { name: "Period" });
  const mtd = periodMenu.getByRole("option", { name: "MTD" });
  await expect(mtd).toHaveAttribute("aria-selected", "true");
  await expect(mtd).toHaveCSS("background-color", "rgb(233, 242, 255)");
  await expect(mtd.locator(".ats-dropdown-checkbox")).toHaveCSS("background-color", "rgb(10, 60, 220)");
  await mtd.hover();
  await expect(mtd).toHaveCSS("background-color", "rgb(233, 242, 255)");
  await period.click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const ytd = periodMenu.getByRole("option", { name: "YTD" });
  await expect(ytd).toHaveCSS("background-color", "rgb(233, 242, 255)");
  await page.keyboard.press("Enter");
  await expect(periodMenu).toBeHidden();
  await expect(period).toContainText("YTD");

  const site = overview.getByRole("button", { name: "Site", exact: true });
  await site.click();
  const siteMenu = overview.getByRole("listbox", { name: "Site" });
  const siteChoice = siteMenu.getByRole("option").nth(1);
  await siteChoice.click();
  await expect(siteMenu).toBeVisible();
  await expect(siteChoice).toHaveAttribute("aria-selected", "true");
  await expect(siteChoice).toHaveCSS("background-color", "rgb(233, 242, 255)");
  await expect(siteChoice.locator(".ats-dropdown-checkbox")).toHaveCSS("background-color", "rgb(10, 60, 220)");

  await page.setViewportSize({ width: 390, height: 844 });
  const phoneChoice = await siteChoice.boundingBox();
  expect(phoneChoice!.height).toBeGreaterThanOrEqual(44);
  await site.click();
  await expect(siteMenu).toBeHidden();
});

test("dashboard sort dropdown shares the common trigger treatment", async ({ page }) => {
  await installMockSupabase(page, { language: "en" });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const sort = page.getByRole("button", { name: "Sort open headcount" });
  await expect(sort).toBeVisible();
  await expect(sort).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(sort).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await expect(sort).toHaveCSS("border-radius", "12px");
  await expect(sort).toHaveCSS("box-shadow", /rgba\(20, 110, 250, 0\.1\) 0px 2px 6px/);
});

test("account and workspace action menus use the shared dropdown treatment", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter", language: "en" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  const account = page.getByLabel("Open account menu");
  await expect(account).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(account).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await account.click();
  const accountMenu = account.locator("xpath=ancestor::details[1]").locator(".ats-dropdown-menu");
  await expect(accountMenu).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(accountMenu).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await account.click();

  const create = page.getByRole("button", { name: "New", exact: true });
  await expect(create).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(create).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await create.click();
  const menu = page.getByRole("menu", { name: "New" });
  await expect(menu).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(menu.getByRole("menuitem")).toHaveCount(2);
  const createChoice = menu.getByRole("menuitem").first();
  await createChoice.hover();
  await expect(createChoice).toHaveCSS("background-color", "rgb(233, 242, 255)");
  const desktopChoice = await createChoice.boundingBox();
  expect(desktopChoice!.height).toBeGreaterThanOrEqual(36);

  await page.setViewportSize({ width: 390, height: 844 });
  const item = await createChoice.boundingBox();
  expect(item!.height).toBeGreaterThanOrEqual(44);
  expect(item!.x + item!.width).toBeLessThanOrEqual(390);
});

test("pipeline filter and candidate action popovers use the shared blue surface", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter", language: "en" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const filters = page.getByRole("button", { name: "Pipeline filters", exact: true });
  await expect(filters).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(filters).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await filters.click();
  const filterPanel = page.getByRole("dialog", { name: "Pipeline filters" });
  await expect(filterPanel).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await page.keyboard.press("Escape");

  const actions = page.getByRole("button", { name: "Candidate actions for Pat Phone" });
  await expect(actions).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await actions.click();
  const menu = page.getByRole("menu", { name: "Candidate actions for Pat Phone" });
  await expect(menu).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(menu).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await expect(menu).toHaveCSS("overflow-y", "auto");
});
