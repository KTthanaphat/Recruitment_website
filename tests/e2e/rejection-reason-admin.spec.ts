import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

const candidateFolder = "/configuration?configurationFolder=reasons/candidate";
const mainFolder = `${candidateFolder}/10000000-0000-4000-8000-000000000001`;

test("folder navigation nests reasons, remembers breadcrumbs and searches both languages", async ({ page }) => {
  await installMockSupabase(page);
  await page.goto("/configuration"); await expectWorkspaceReady(page);
  const tree = page.getByRole("tree", { name: "Configuration folders" });
  await tree.getByRole("treeitem", { name: "Candidate failure reasons", exact: true }).click();
  await tree.getByRole("treeitem", { name: "Candidate declined / withdrew", exact: true }).click();
  await page.locator("[data-configuration-contents]").getByRole("button", { name: "Compensation and benefits", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Compensation and benefits", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Folder breadcrumb" })).toContainText("Candidate declined / withdrew");
  await expect(page.locator("[data-configuration-contents]")).toContainText("Salary below expectations");
  await page.reload(); await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Compensation and benefits", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Folder breadcrumb" }).getByRole("button", { name: "All settings", exact: true }).click();
  await page.getByRole("textbox", { name: "Search this folder and its contents" }).fill("เงินเดือน");
  await expect(page.locator("[data-configuration-contents]")).toContainText("Salary below expectations");
  await expect(page.locator("[data-configuration-contents]")).toContainText("Compensation and benefits");
  await expect(page.locator("[data-configuration-count]")).toHaveText("1 items");
});

test("recruitment admin creates a main and parent-prefilled detail and edits it", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  await page.goto(candidateFolder); await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Add main reason", exact: true }).click();
  const editorActive = page.getByRole("dialog").getByRole("switch", { name: "Active", exact: true });
  await expect(editorActive).toHaveText("ON"); await editorActive.press("Space");
  await expect(editorActive).toHaveText("OFF"); await expect(editorActive).toHaveAttribute("aria-checked", "false");
  await page.getByLabel("Thai label").fill("เหตุผลเพิ่มเติม"); await page.getByLabel("English label").fill("Additional reason");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const main = data.rejection_reasons.find(row => row.label_en === "Additional reason")!;
  expect(main.active).toBe(false);
  await page.getByRole("switch", { name: "Active: Additional reason", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Active: Additional reason", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(main.actor).toBe("candidate"); expect(main.parent_id).toBeNull();
  await page.getByRole("button", { name: "Add detail Additional reason", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Additional reason");
  await page.getByLabel("Thai label").fill("รายละเอียดเพิ่มเติม"); await page.getByLabel("English label").fill("Additional detail");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(data.rejection_reasons.find(row => row.label_en === "Additional detail")?.parent_id).toBe(main.reason_id);
  await page.locator("[data-configuration-contents]").getByRole("button", { name: "Additional reason", exact: true }).click();
  await page.getByRole("button", { name: "Edit Additional detail", exact: true }).click();
  await page.getByLabel("English label").fill("Edited detail"); await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-configuration-contents]")).toContainText("Edited detail");
});

test("archive controls preserve location and confirmed state on failed updates", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  await page.goto(candidateFolder); await expectWorkspaceReady(page);
  const active = page.getByRole("switch", { name: "Active: Compensation and benefits", exact: true });
  let fail = true;
  await page.route("**/rest/v1/rejection_reasons*", async route => {
    if (route.request().method() === "PATCH" && fail) await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Update rejected" }) }); else await route.fallback();
  });
  await active.click(); await expect(page.getByRole("alert").filter({ hasText: "Update rejected" })).toBeVisible();
  await expect(active).toHaveAttribute("aria-checked", "true");
  fail = false; const before = await page.evaluate(() => window.scrollY); await active.click();
  await expect(active).toHaveAttribute("aria-checked", "false"); expect(data.rejection_reasons[0].active).toBe(false);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - before)).toBeLessThan(3);
  await expect(page.getByRole("heading", { name: "Candidate declined / withdrew" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add detail Compensation and benefits" })).toBeDisabled();
});

test("archived parent is named in detail editor and failed saves retain draft", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "system_admin" }); data.rejection_reasons[0].active = false;
  await page.goto(mainFolder); await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Edit Salary below expectations" }).click();
  await expect(page.getByRole("dialog")).toContainText("Compensation and benefits · Archived");
  await page.getByLabel("English label").fill("Updated salary reason");
  let fail = true;
  await page.route("**/rest/v1/rejection_reasons*", async route => {
    if (route.request().method() === "PATCH" && fail) await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Save rejected" }) }); else await route.fallback();
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Save rejected");
  await expect(page.getByLabel("English label")).toHaveValue("Updated salary reason");
  fail = false; await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-configuration-contents]")).toContainText("Updated salary reason");
});

test("refresh failure retries without inserting a second reason", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  await page.goto(candidateFolder); await expectWorkspaceReady(page);
  let writes = 0, failRefresh = true;
  await page.route("**/rest/v1/rejection_reasons*", async route => {
    if (route.request().method() === "POST") { writes += 1; await route.fallback(); }
    else if (route.request().method() === "GET" && failRefresh) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Catalog refresh failed" }) });
    else await route.fallback();
  });
  await page.getByRole("button", { name: "Add main reason", exact: true }).click();
  await page.getByLabel("Thai label").fill("เหตุผลทดสอบ"); await page.getByLabel("English label").fill("Refresh retry reason");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Changes were saved. Refresh failed");
  await expect(page.getByLabel("English label")).toHaveValue("Refresh retry reason"); expect(writes).toBe(1);
  failRefresh = false; await page.getByRole("dialog").getByRole("button", { name: "Retry refresh", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); expect(writes).toBe(1);
  expect(data.rejection_reasons.filter(row => row.label_en === "Refresh retry reason")).toHaveLength(1);
});

test("unsaved drawer offers Continue, Discard and Save", async ({ page }) => {
  await installMockSupabase(page); await page.goto(candidateFolder); await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Add main reason", exact: true }).click();
  await page.getByLabel("English label").fill("Unsaved reason"); await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
  await expect(confirmation).toBeVisible(); await confirmation.getByRole("button", { name: "Continue editing", exact: true }).click();
  await expect(page.getByLabel("English label")).toHaveValue("Unsaved reason");
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await confirmation.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add main reason", exact: true }).click();
  await page.getByLabel("Thai label").fill("บันทึกก่อนออก"); await page.getByLabel("English label").fill("Saved before leaving");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await confirmation.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-configuration-contents]")).toContainText("Saved before leaving");
});

test("viewer cannot manage Configuration and unknown folder falls back to parent", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" }); await page.goto("/configuration"); await expectWorkspaceReady(page);
  await expect(page.getByText("Only recruitment administrators can edit configuration.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add main reason" })).toHaveCount(0);
});

test("Thai desktop folder navigator supports keyboard and language-prefilled templates", async ({ page }, testInfo) => {
  await installMockSupabase(page, { language: "th" }); await page.setViewportSize({ width: 1024, height: 844 });
  await page.goto("/configuration?configurationFolder=invitations/th/missing"); await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "ไทย", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "เพิ่มรูปแบบ", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "ภาษา", exact: true })).toContainText("ไทย"); await expect(page.getByLabel("ชื่อรูปแบบ")).toBeVisible();
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  const tree = page.getByRole("tree", { name: "โฟลเดอร์การตั้งค่า", exact: true });
  await tree.getByRole("treeitem", { name: "การตั้งค่าทั้งหมด", exact: true }).press("End");
  await expect(tree.getByRole("treeitem", { name: "อังกฤษ", exact: true })).toBeFocused();
  await tree.getByRole("treeitem", { name: "การตั้งค่าทั้งหมด", exact: true }).click();
  await expect(page.getByRole("heading", { name: "การตั้งค่าทั้งหมด", exact: true })).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("configuration-phone-th.png"), fullPage: true });
});

test("template language folder saves with validation and refreshes only catalogs", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  await page.goto("/configuration?configurationFolder=letters/en"); await expectWorkspaceReady(page);
  let writes = 0;
  await page.route("**/api/rejection-letters/templates", async route => {
    const payload = route.request().postDataJSON(); writes++;
    data.rejection_letter_templates.push({ ...data.rejection_letter_templates[0], ...payload, template_id: "test-folder-template", version: 1 });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.getByRole("button", { name: "New format", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("button", { name: "Language", exact: true })).toContainText("English");
  await page.getByLabel("Format name").fill("Folder test format"); await page.getByLabel("Subject").fill("{not_a_variable}");
  await page.getByRole("button", { name: "Save", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Unknown or incomplete variable"); expect(writes).toBe(0);
  await page.getByLabel("Subject").fill("Hello {candidate_name}"); await page.getByLabel("Body").fill("Thank you.");
  const templateActive = page.getByRole("dialog").getByRole("switch", { name: "Active", exact: true });
  await templateActive.press("Enter"); await expect(templateActive).not.toBeChecked(); expect(writes).toBe(0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(page.locator("[data-configuration-contents]")).toContainText("Folder test format");
  await expect(page.getByRole("heading", { name: "English", exact: true })).toBeVisible(); expect(writes).toBe(1); expect(data.rejection_letter_templates.find(row => row.name === "Folder test format")?.active).toBe(false);
});


test("shared switch colors, disabled retry and compact folder geometry", async ({ page }) => {
  await installMockSupabase(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(candidateFolder); await expectWorkspaceReady(page);
  const active = page.getByRole("switch", { name: "Active: Compensation and benefits", exact: true });
  await page.mouse.move(0, 0);
  await expect(active).toHaveCSS("background-color", "rgb(10, 60, 220)");
  await expect(active).toHaveCSS("height", "32px");
  await expect(active).toHaveCSS("width", "64px");
  const row = page.locator('[data-configuration-entry="reasons/candidate/10000000-0000-4000-8000-000000000001"]');
  const centers = await row.evaluate(element => Array.from(element.children).map(child => { const rect = child.getBoundingClientRect(); return rect.y + rect.height / 2; }));
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1);
  await expect(row).toHaveCSS("min-height", "44px");
  await expect(page.locator(".configuration-pane")).toHaveCSS("padding", "16px");
  await expect(page.getByRole("textbox", { name: "Search this folder and its contents" })).toHaveCSS("height", "32px");
  let failRefresh = true, writes = 0;
  await page.route("**/rest/v1/rejection_reasons*", async route => {
    if (route.request().method() === "PATCH") { writes++; await route.fallback(); }
    else if (route.request().method() === "GET" && failRefresh) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Refresh unavailable" }) });
    else await route.fallback();
  });
  await active.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "refresh" })).toBeVisible();
  await expect(active).toBeDisabled(); await expect(active).toBeChecked();
  await expect(active).toHaveCSS("opacity", "0.5");
  await expect(active).toHaveCSS("background-color", "rgb(10, 60, 220)");
  failRefresh = false; await page.getByRole("button", { name: "Retry refresh", exact: true }).click();
  await expect(active).not.toBeChecked(); await expect(active).toBeEnabled(); expect(writes).toBe(1);
  await page.mouse.move(0, 0);
  await expect(active).toHaveCSS("background-color", "rgb(232, 240, 255)");
  await expect(active).toHaveCSS("border-top-color", "rgb(196, 216, 255)");
  await expect(active).toHaveCSS("color", "rgb(10, 60, 220)");
  await active.hover(); await expect(active).toHaveCSS("background-color", "rgb(221, 234, 255)");
  await active.press("Space"); await expect(active).toBeChecked();
  await expect(active).toHaveCSS("background-color", "rgb(8, 42, 158)");
  await page.getByRole("button", { name: "Edit Compensation and benefits", exact: true }).click();
  const draft = page.getByRole("dialog").getByRole("switch", { name: "Active", exact: true });
  await draft.press("Enter"); await expect(draft).not.toBeChecked(); expect(writes).toBe(2);
  await page.mouse.move(0, 0); await expect(draft).toHaveCSS("background-color", "rgb(232, 240, 255)");
  await expect(draft).toHaveCSS("outline-color", "rgb(10, 60, 220)");
  await page.emulateMedia({ reducedMotion: "reduce" }); expect(await draft.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThanOrEqual(0.001);
});

test("Configuration rows wrap full long labels at desktop pane widths", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  data.rejection_reasons[1].label_en = "Long detailed reason with benefits and workplace conditions that must remain fully readable across narrow folder panes";
  await page.goto(mainFolder); await expectWorkspaceReady(page);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const row = page.locator("[data-configuration-entry]").first();
    await expect(row).toContainText("Long detailed reason");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const layout = await row.evaluate(element => {
      const icon = element.querySelector(".configuration-item-icon")!.getBoundingClientRect();
      const name = element.querySelector(".configuration-item-name")!.getBoundingClientRect();
      const metadata = element.querySelector(".configuration-item-metadata")!.getBoundingClientRect();
      const pane = element.closest(".configuration-pane")!;
      return { iconCenter: icon.y + icon.height / 2, nameCenter: name.y + name.height / 2, blockCenter: (name.y + metadata.bottom) / 2, wide: pane.clientWidth - 32 >= 600 };
    });
    expect(Math.abs(layout.iconCenter - (layout.wide ? layout.nameCenter : layout.blockCenter))).toBeLessThan(1);
    if (width < 640) await expect(row.getByRole("switch")).toHaveCSS("height", "44px");
  }
});
