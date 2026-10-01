import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("recruitment admin can edit and archive reason labels in Configuration", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await page.getByText("Candidate failure reasons").click();
  const section = page.locator("details").filter({ has: page.getByText("Candidate failure reasons") });
  await expect(section).toHaveAttribute("open", "");
  const manager = page.getByText("Archived reasons remain visible in candidate history.").locator("..");
  await expect(manager).toBeVisible();
  await page.getByRole("button", { name: "Add main reason" }).click();
  await page.getByLabel("Thai label").fill("เหตุผลเพิ่มเติม");
  await page.getByLabel("English label").fill("Additional reason");
  await page.getByRole("button", { name: "Save reason" }).click();
  await expect(section).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Save reason" })).toHaveCount(0);
  await expect(page.getByText("Loading recruitment records...")).toHaveCount(0);
  await expect(page.getByText("Additional reason")).toBeVisible();
  expect(mock.data.rejection_reasons.some((reason) => reason.label_en === "Additional reason")).toBe(true);
  const active = page.getByRole("switch", { name: "Active: Additional reason" });
  await expect(active).toHaveAttribute("aria-checked", "true");
  await active.scrollIntoViewIfNeeded();
  const scrollBeforeToggle = await page.evaluate(() => window.scrollY);
  await active.click();
  await expect(section).toHaveAttribute("open", "");
  await expect(page.getByText("Additional reason · Archived")).toBeVisible();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBeforeToggle)).toBeLessThan(3);
  expect(mock.data.rejection_reasons.find((reason) => reason.label_en === "Additional reason")?.active).toBe(false);
  await page.getByRole("switch", { name: "Active: Additional reason" }).click();
  await expect(page.getByRole("switch", { name: "Active: Additional reason" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Add detail to Additional reason" }).click();
  await expect(section.locator("fieldset select").last()).toHaveValue(mock.data.rejection_reasons.find((reason) => reason.label_en === "Additional reason")!.reason_id);
  await page.getByLabel("Thai label").fill("รายละเอียดเพิ่มเติม");
  await page.getByLabel("English label").fill("Additional detail");
  await page.getByRole("button", { name: "Save reason" }).click();
  await page.getByRole("button", { name: "Edit Additional detail" }).click();
  await expect(page.getByLabel("English label")).toHaveValue("Additional detail");
  await page.getByLabel("English label").fill("Edited detail");
  await page.getByRole("button", { name: "Save reason" }).click();
  await expect(page.getByText("Edited detail")).toBeVisible();
});

test("viewer cannot manage rejection reasons", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("button", { name: "Add main reason" })).toHaveCount(0);
});

test("Thai reason controls open by keyboard and keep the catalog in place", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "TH" }).click();
  const summary = page.locator("details summary").filter({ hasText: "เหตุผลการไม่พิจารณาผู้สมัคร" });
  await summary.focus();
  await summary.press("Enter");
  await expect(summary.locator("..")).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "เพิ่มเหตุผลหลัก" }).click();
  await expect(page.getByLabel("ชื่อภาษาไทย")).toBeVisible();
  await expect(page.getByRole("button", { name: "บันทึก" })).toBeVisible();
});

test("reason Active switch retains its state and reports update errors", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await page.route("**/rest/v1/rejection_reasons*", async (route) => {
    if (route.request().method() === "PATCH") await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Update rejected" }) });
    else await route.fallback();
  });
  await page.getByText("Candidate failure reasons").click();
  const active = page.getByRole("switch", { name: "Active: Compensation and benefits" });
  await expect(active).toHaveAttribute("aria-checked", "true");
  await active.click();
  await expect(page.getByText("Update rejected")).toBeVisible();
  await expect(active).toHaveAttribute("aria-checked", "true");
});

test("archived parent remains visible while editing a detail and failed save keeps the editor", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "system_admin" });
  data.rejection_reasons[0].active = false;
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await page.getByText("Candidate failure reasons").click();
  const section = page.locator("details").filter({ has: page.getByText("Candidate failure reasons") });
  await page.getByRole("button", { name: "Edit Salary below expectations" }).click();
  await expect(section.locator("fieldset select").last()).toHaveValue(data.rejection_reasons[0].reason_id);
  await expect(section.locator("fieldset select option:checked")).toContainText("Compensation and benefits · Archived");
  await expect(page.getByLabel("English label")).toHaveValue("Salary below expectations");
  await page.getByLabel("English label").fill("Updated salary reason");
  await page.route("**/rest/v1/rejection_reasons?**", async (route) => {
    if (route.request().method() === "PATCH") await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Save rejected" }) });
    else await route.fallback();
  });
  await page.getByRole("button", { name: "Save reason" }).click();
  await expect(section.getByRole("alert")).toContainText("Save rejected");
  await expect(section).toHaveAttribute("open", "");
  await expect(page.getByLabel("English label")).toHaveValue("Updated salary reason");
  await page.unroute("**/rest/v1/rejection_reasons?**");
  await page.getByRole("button", { name: "Save reason" }).click();
  await expect(page.getByText("Updated salary reason")).toBeVisible();
  await expect(section).toHaveAttribute("open", "");
});

test("failed catalog refresh retries without inserting a second reason", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await page.getByText("Candidate failure reasons").click();
  let writes = 0;
  let failRefresh = true;
  await page.route("**/rest/v1/rejection_reasons*", async (route) => {
    if (route.request().method() === "POST") { writes += 1; await route.fallback(); }
    else if (route.request().method() === "GET" && failRefresh) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Catalog refresh failed" }) });
    else await route.fallback();
  });
  await page.getByRole("button", { name: "Add main reason" }).click();
  await page.getByLabel("Thai label").fill("เหตุผลทดสอบ");
  await page.getByLabel("English label").fill("Refresh retry reason");
  await page.getByRole("button", { name: "Save reason" }).click();
  await expect(page.getByText("Catalog refresh failed")).toBeVisible();
  await expect(page.getByLabel("English label")).toHaveValue("Refresh retry reason");
  expect(writes).toBe(1);
  failRefresh = false;
  await page.getByRole("button", { name: "Retry reason refresh" }).click();
  await expect(page.getByText("Refresh retry reason")).toBeVisible();
  expect(writes).toBe(1);
  expect(data.rejection_reasons.filter((reason) => reason.label_en === "Refresh retry reason")).toHaveLength(1);
});
