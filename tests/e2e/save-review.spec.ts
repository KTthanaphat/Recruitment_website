import { expect, test, type Page } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

async function selectOption(page: Page, name: string, option: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByRole("option").filter({ hasText: option }).click();
}

async function candidateDraft(page: Page) {
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "New Candidate", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Create Candidate" });
  await form.getByRole("textbox", { name: "Name", exact: true }).fill("Review Candidate");
  await selectOption(page, "Channel", "Facebook");
  await form.getByRole("button", { name: "Add reference" }).click();
  await form.locator('input[name="candidate_reference_name"]').fill("Reference Person");
  await form.locator('input[name="candidate_reference_relationship"]').fill("Manager");
  await form.locator('input[name="candidate_reference_channel_value"]').fill("0812345678");
  await form.getByRole("button", { name: "First Contact Date", exact: true }).click();
  await page.getByRole("button", { name: "24/07/2026", exact: true }).click();
  await form.getByRole("button", { name: "Review changes" }).click();
  return form;
}

test("candidate review groups entered values, preserves draft and saves once", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const form = await candidateDraft(page);
  const review = page.getByRole("dialog", { name: "Confirm Save", exact: true });
  await expect(review).toBeVisible();
  await expect.poll(async () => (await review.boundingBox())?.width).toBe(448);
  await expect(review).toContainText("Review Candidate");
  await expect(review).toContainText("Contact details");
  await expect(review).toContainText("Reference Person");
  await expect(review).toContainText("24/07/2026");
  await expect(review).not.toContainText("expected_");
  await expect(review).not.toContainText("duplicate_review");
  await expect(review).not.toContainText("Nickname");
  await expect(review.locator("pre")).toHaveCount(0);
  if (process.env.SAVE_REVIEW_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SAVE_REVIEW_SCREENSHOT_DIR}/desktop.png` });
  await review.getByRole("button", { name: "Back to edit" }).click();
  await expect(form.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Review Candidate");
  await expect(form.locator('input[name="candidate_reference_name"]')).toHaveValue("Reference Person");
  await form.getByRole("button", { name: "Review changes" }).click();
  await review.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect.poll(() => mock.rpcCalls.filter(call => call.endpoint === "app_upsert_candidate_profile_v2").length).toBe(1);
});

test("phone requisition review wraps and Escape returns to the editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await drawer.getByRole("heading", { name: "Requisition profile" }).locator("..").getByRole("button", { name: "Edit requisition", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Edit Requisition" });
  await form.locator('input[name="doc_id"]').fill("APPROVAL-PENDING-VERY-LONG-IDENTIFIER-123456789");
  const trigger = form.getByRole("button", { name: "Review changes" });
  await trigger.click();
  const review = page.getByRole("dialog", { name: "Confirm Save" });
  await expect(review).toContainText("APPROVAL-PENDING-VERY-LONG-IDENTIFIER-123456789");
  await expect(review.getByRole("button", { name: "Back to edit" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.SAVE_REVIEW_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SAVE_REVIEW_SCREENSHOT_DIR}/phone.png` });
  await review.getByRole("button", { name: "Save changes" }).focus();
  await page.keyboard.press("Tab");
  await expect(review.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(review).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("failure review resolves actor and reasons in the shared layout", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Candidate actions for Pat Phone" }).click();
  await page.getByRole("menu", { name: "Candidate actions for Pat Phone" }).getByRole("menuitem").filter({ hasText: "Fail stage" }).click();
  const form = page.getByRole("dialog", { name: /Fail .*stage|Complete Stage/i });
  await form.getByRole("button", { name: /Who ended the process/ }).click();
  await form.getByRole("option", { name: "Company declined to proceed", exact: true }).click();
  await form.getByRole("button", { name: /^Main reason/ }).click();
  await form.getByRole("option", { name: "Skills and assessment results", exact: true }).click();
  await form.getByRole("button", { name: /^Detailed reason/ }).click();
  await form.getByRole("option", { name: "Interview result did not meet criteria", exact: true }).click();
  await form.getByRole("button", { name: "Review changes" }).click();
  const review = page.getByRole("dialog", { name: "Confirm Save" });
  await expect(review).toContainText("Skills and assessment results");
  await expect(review).toContainText("Interview result did not meet criteria");
  await expect(review).not.toContainText("failure_main_reason_id");
  await expect(review).not.toContainText("expected_updated_at");
});

test("Thai review labels and back action fit on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  await page.goto("/requisitions?lang=th&detailType=requisition&detailId=REQ-HQ-1");
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await drawer.getByRole("heading", { name: "ข้อมูลคำขอ" }).locator("..").getByRole("button", { name: "แก้ไขคำขอ", exact: true }).click();
  const form = page.getByRole("dialog").filter({ has: page.locator('input[name="doc_id"]') });
  await form.getByRole("button", { name: /ตรวจสอบ/ }).click();
  const review = page.getByRole("dialog", { name: "ตรวจสอบข้อมูลก่อนบันทึก" });
  await expect(review).toContainText("ข้อมูลหลัก");
  await expect(review).toContainText("เลขที่ใบขออัตรา");
  await expect(review.getByRole("button", { name: "กลับไปแก้ไข" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("save stays locked while pending and an error returns to the draft", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  const form = await candidateDraft(page);
  let release!: () => void;
  const waitForRelease = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/rpc/app_candidate_action_v1", async route => {
    await waitForRelease;
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "TEST_ERROR", message: "Test save failure" }) });
  });
  const review = page.getByRole("dialog", { name: "Confirm Save" });
  await review.getByRole("button", { name: "Save changes" }).click();
  await expect(review.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(review.getByRole("button", { name: "Back to edit" })).toBeDisabled();
  await expect(review.getByRole("button", { name: "Close" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(review).toBeVisible();
  release();
  await expect(page.getByRole("dialog", { name: "Update not saved" })).toContainText("Test save failure");
  await expect(form.locator('input[name="candidate_reference_name"]')).toHaveValue("Reference Person");
});
