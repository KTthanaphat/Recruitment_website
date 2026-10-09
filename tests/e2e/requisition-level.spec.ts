import { expect, test } from "@playwright/test";
import { installMockSupabase } from "./support/mock-supabase";

for (const width of [1280, 390]) {
  test(`Job Level opens the requisition editor and submits L3 at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { data, rpcCalls } = await installMockSupabase(page, { role: "admin_recruiter" });
    data.requisitions.find(row => row.doc_id === "REQ-HQ-1")!.level = "4";
    await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
    const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
    const edit = drawer.getByRole("button", { name: "Edit Job Level", exact: true });
    await expect(edit).toBeVisible();
    await edit.focus();
    await page.keyboard.press("Enter");
    const editor = page.getByRole("dialog", { name: "Edit Requisition", exact: true });
    await expect(editor.locator('select[name="level"]')).toHaveValue("4");
    await editor.getByRole("button", { name: "Level (L)", exact: true }).click();
    await page.getByRole("option", { name: "L3", exact: true }).click();
    await expect(editor.locator('select[name="level"]')).toHaveValue("3");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await editor.screenshot({ path: testInfo.outputPath(`level-editor-${width}.png`) });
    await editor.getByRole("button", { name: "Review changes", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Confirm Save", exact: true });
    await confirmation.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(() => rpcCalls.find(call => call.endpoint === "app_upsert_requisition")?.payload.level).toBe("3");
    const payload = rpcCalls.find(call => call.endpoint === "app_upsert_requisition")!.payload;
    expect(payload).toMatchObject({ mode: "change", doc_id: "REQ-HQ-1", previous_doc_id: "REQ-HQ-1", position: "Engineer", head_count: 5 });
  });
}

test("Job Level edit localizes in Thai and preserves a prefixed stored level", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  data.requisitions.find(row => row.doc_id === "REQ-HQ-1")!.level = "L4";
  await page.goto("/requisitions?lang=th&detailType=requisition&detailId=REQ-HQ-1");
  await page.getByRole("button", { name: "แก้ไขระดับงาน", exact: true }).click();
  await expect(page.getByRole("dialog").filter({ has: page.locator('input[name="doc_id"]') }).locator('select[name="level"]')).toHaveValue("L4");
});

for (const role of ["viewer", "site_recruiter"] as const) {
  test(`Job Level is read-only for ${role} without requisition ownership`, async ({ page }) => {
    await installMockSupabase(page, { role });
    await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
    const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Edit Job Level", exact: true })).toHaveCount(0);
  });
}
