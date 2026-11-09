import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("notification center sits before the bookmark, shows reminders, and retains read history", async ({ page }) => {
  const context = await installMockSupabase(page);
  const candidate = context.data.candidates[0];
  const application = context.data.candidate_applications?.find(row => row.candidate_id === candidate.candidate_id);
  context.notifications.push({
    notification_id: "notif-1",
    notification_type: "probation",
    candidate_id: candidate.candidate_id,
    application_id: application?.application_id ?? null,
    candidate_name: candidate.name,
    doc_id: "REQ-HQ-1",
    position: "Recruiter",
    site: "HQ",
    first_working_date: "2026-01-01",
    milestone_days: 45,
    reminder_days_before: 7,
    due_date: "2026-02-08",
    read_at: null,
    resolved_at: null,
    created_at: "2026-02-08T02:00:00.000Z"
  });

  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  const header = page.locator("[data-app-header-actions]");
  const notifications = header.getByRole("button", { name: "Notifications" });
  await expect(notifications).toBeVisible();
  const beforeBookmark = await notifications.evaluate(button => {
    const bookmark = document.querySelector("[data-app-header-bookmark]");
    return Boolean(bookmark && (button.compareDocumentPosition(bookmark) & Node.DOCUMENT_POSITION_FOLLOWING));
  });
  expect(beforeBookmark).toBe(true);
  await expect(header.locator("[aria-label='1 unread notifications']")).toBeVisible();

  await notifications.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByText("Probation day 45")).toBeVisible();
  await expect(panel.getByText(`${candidate.name} - Probation day 45`, { exact: true })).toBeVisible();
  const item = panel.locator("li").first();
  await item.getByRole("button", { name: "Mark as read" }).click();
  await expect(header.locator("[aria-label='1 unread notifications']")).toHaveCount(0);
  await expect(item.getByRole("button", { name: "Mark as read" })).toHaveCount(0);

  await item.getByRole("button").first().click();
  await expect(page.getByText(candidate.name, { exact: true }).last()).toBeVisible();
  expect(context.notifications[0].read_at).toBeTruthy();
});

test("notification center is localized and stays within a phone viewport", async ({ page }) => {
  const context = await installMockSupabase(page, { language: "th" });
  const candidate = context.data.candidates[0];
  context.notifications.push({
    notification_id: "notif-th-1",
    notification_type: "new_hire_confirmation",
    candidate_id: candidate.candidate_id,
    application_id: context.data.candidate_applications?.find(row => row.candidate_id === candidate.candidate_id)?.application_id ?? null,
    candidate_name: candidate.name,
    doc_id: "REQ-HQ-1",
    position: "Recruiter",
    site: "HQ",
    first_working_date: "2026-07-24",
    milestone_days: null,
    reminder_days_before: null,
    due_date: "2026-07-24",
    read_at: null,
    resolved_at: null,
    created_at: "2026-07-24T02:00:00.000Z"
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcomePrompt = page.getByRole("dialog", { name: "ยินดีต้อนรับกลับ" });
  if (await welcomePrompt.isVisible().catch(() => false)) {
    await welcomePrompt.getByRole("button", { name: "ปิด" }).click();
  }
  const button = page.getByRole("button", { name: "การแจ้งเตือน" });
  await expect(button).toBeVisible();
  await button.click();
  const panel = page.getByRole("dialog", { name: "การแจ้งเตือน" });
  await expect(panel.getByText("ยืนยันการเริ่มงานของพนักงานใหม่")).toBeVisible();
  await expect(panel.getByText("ถึงกำหนดวันนี้", { exact: true })).toBeVisible();
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});

test("Records sorting shows both triangles and highlights the chosen direction", async ({ page }) => {
  await installMockSupabase(page);
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  const sort = page.getByRole("button", { name: "Sort Updated" }).first();
  const triangles = sort.locator("[data-record-sort-triangles] path");
  await expect(triangles).toHaveCount(2);
  await expect(triangles.nth(1)).toHaveAttribute("fill", "#0A3CDC");
  await sort.click();
  await expect(triangles.nth(0)).toHaveAttribute("fill", "#0A3CDC");
  await expect(triangles.nth(1)).toHaveAttribute("fill", "#A9B6C9");
});
test("New Hire Confirmation displays candidate-first title and Bangkok overdue days", async ({ page }) => {
  const context = await installMockSupabase(page);
  const candidate = context.data.candidates[0];
  context.notifications.push({
    notification_id: "overdue-start", notification_type: "new_hire_confirmation",
    candidate_id: candidate.candidate_id, application_id: null, candidate_name: candidate.name,
    doc_id: "REQ-HQ-1", position: "Recruiter", site: "HQ",
    first_working_date: "2026-07-20", milestone_days: null, reminder_days_before: null,
    due_date: "2026-07-20", read_at: null, resolved_at: null, created_at: "2026-07-20T02:00:00Z"
  });
  await page.goto("/candidates"); await expectWorkspaceReady(page);
  const bell=page.getByRole("button",{name:"Notifications"});
  await expect(bell).toHaveCSS("border-top-color","rgb(196, 216, 255)");
  await bell.click();
  const panel=page.getByRole("dialog",{name:"Notifications"});
  await expect(panel.getByText(`${candidate.name} - New Hire Confirmation`,{exact:true})).toBeVisible();
  await expect(panel.getByText("4 days overdue",{exact:true})).toBeVisible();
  await expect(panel.getByText("First working date · 20/07/2026")).toBeVisible();
  await expect(panel.getByRole("button",{name:"Close"}).locator("svg")).toBeVisible();
});