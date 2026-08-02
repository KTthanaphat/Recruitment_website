import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

async function openPatMenu(page: Parameters<typeof installMockSupabase>[0]) {
  await page.getByRole("button", { name: "Candidate actions for Pat Phone" }).click();
  return page.getByRole("menu", { name: "Candidate actions for Pat Phone" });
}

test("pending-stage menu is keyboard reachable and keeps paired-status actions before forward moves", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const actions = page.getByRole("button", { name: "Candidate actions for Pat Phone" });
  await actions.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Candidate actions for Pat Phone" });
  await expect(menu).toBeVisible();
  const firstActions = await menu.getByRole("menuitem").evaluateAll((items) => items.slice(0, 4).map((item) => item.textContent?.trim()));
  expect(firstActions).toEqual(["Pass stage", "Fail stage", "Line Interview", "Test"]);
  await expect(menu.getByRole("menuitem", { name: "Edit pending details" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
});

test("edit pending details preloads its exact values and calls the v2 pending RPC", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const menu = await openPatMenu(page);
  await menu.getByRole("menuitem", { name: "Edit pending details" }).click();
  const dialog = page.getByRole("dialog", { name: /Edit pending/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[name="opened_date"]')).toHaveValue("2026-07-09");
  await expect(dialog.locator('input[name="interviewer"]')).toHaveValue("QA Interviewer");
  await expect(dialog.locator('textarea[name="remark"]')).toHaveValue("QA Phone Screen");
  await dialog.locator('textarea[name="remark"]').fill("Recruiter corrected pending note");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_update_pipeline_pending_v2");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    stage_instance_id: "00000000-0000-4000-8000-000000000001",
    pending: { opened_date: "2026-07-09", interviewer: "QA Interviewer", remark: "Recruiter corrected pending note" }
  });
  expect(mock.data.recruitment_logs.find((row) => row.log_id === 1)?.result).toBeNull();
});

test("Pass stage preserves Pending details and sends only editable Outcome plus next Pending data", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const menu = await openPatMenu(page);
  await menu.getByRole("menuitem").filter({ hasText: "Pass stage" }).click();
  const dialog = page.getByRole("dialog", { name: /Pass .*stage|Complete Stage/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[type="date"][name="pending_opened_date"]')).toHaveCount(0);
  await expect(dialog.locator('input[name="pending_interviewer"]:not([type="hidden"])')).toHaveCount(0);
  await expect(dialog.locator('textarea[name="pending_remark"]')).toHaveCount(0);
  await expect(dialog.locator('input[name="outcome_date"]')).toHaveValue("2026-07-24");
  await expect(dialog.locator('input[name="next_opened_date"]')).toHaveValue("2026-07-24");
  await dialog.locator('textarea[name="outcome_remark"]').fill("Strong phone screen");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_complete_pipeline_stage_v2");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    stage_instance_id: "00000000-0000-4000-8000-000000000001",
    pending: { opened_date: "2026-07-09", interviewer: "QA Interviewer", remark: "QA Phone Screen" },
    outcome: { result: "pass", date: "2026-07-24", interviewer: "QA Interviewer", remark: "Strong phone screen" },
    next_pending: { stage: "HR Interview", round: 1, opened_date: "2026-07-24" }
  });
  const stages = mock.data.recruitment_logs.filter((row) => row.candidate_id === "C-PHONE" && row.superseded_at === null);
  expect(stages.find((row) => row.log_id === 1)?.result).toBe(1);
  expect(stages.filter((row) => row.result === null)).toHaveLength(1);
});

test("system admin can edit Pending details outside Site and PIC scope", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "system_admin" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const menu = await openPatMenu(page);
  await menu.getByRole("menuitem", { name: "Edit pending details" }).click();
  const dialog = page.getByRole("dialog", { name: /Edit pending/i });
  await dialog.locator('textarea[name="remark"]').fill("System Admin correction");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_update_pipeline_pending_v2");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    pending: { remark: "System Admin correction" }
  });
});

test("Fail stage is atomic and never sends or creates next pending data", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const menu = await openPatMenu(page);
  await menu.getByRole("menuitem").filter({ hasText: "Fail stage" }).click();
  const dialog = page.getByRole("dialog", { name: /Fail .*stage|Complete Stage/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[name="next_opened_date"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_complete_pipeline_stage_v2");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    outcome: { result: "fail" }
  });
  expect(mock.rpcCalls.at(-1)?.payload.next_pending).toBeNull();
  expect(mock.data.recruitment_logs.filter((row) => row.candidate_id === "C-PHONE")).toHaveLength(1);
});

test("Test has a separate next-round action while Pass stage exits to Reference Check", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const actions = page.getByRole("button", { name: "Candidate actions for Tina Test" });
  await actions.click();
  const menu = page.getByRole("menu", { name: "Candidate actions for Tina Test" });
  await expect(menu.getByRole("menuitem").filter({ hasText: "Pass stage" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /Add another Test round/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /Add another Test round/ }).click();
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_complete_pipeline_stage_v2");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-TEST",
    outcome: { result: "pass" },
    next_pending: { stage: "Test", round: 2 }
  });
});

test("forward menu jump opens confirmation without a write and submits paired pass records plus target pending", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const menu = await openPatMenu(page);
  const lineInterviewAction = menu.getByRole("menuitem", { name: /Line Interview/ });
  await lineInterviewAction.focus();
  await lineInterviewAction.press("Enter");
  expect(pageErrors).toEqual([]);
  const dialog = page.getByRole("dialog", { name: /Confirm Passed Stages|Move to Line Interview/i });
  await expect(dialog).toBeVisible();
  expect(mock.rpcCalls).toHaveLength(0);
  await expect(dialog.getByText(/Phone Screening/).first()).toBeVisible();
  await expect(dialog.getByText(/HR Interview/).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_pass_pipeline_jump_v2");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    current_stage_instance_id: "00000000-0000-4000-8000-000000000001",
    passed_stages: [
      { stage: "Phone Screen", round: 1, outcome: { result: "pass" } },
      { stage: "HR Interview", round: 1, outcome: { result: "pass" } }
    ],
    target_pending: { stage: "Line Interview", round: 1 }
  });
});

test("candidate detail separates current pending details from outcome history and stays read-only for viewers", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: /^Pat Phone/ }).click();
  const dialog = page.getByRole("dialog", { name: /C-PHONE/ });
  await expect(dialog.getByText("Current stage")).toBeVisible();
  await expect(dialog.getByText("Pending details")).toBeVisible();
  await expect(dialog.getByText("Awaiting outcome")).toBeVisible();
  await expect(dialog.getByText("Resume Screening")).toBeVisible();
  await expect(page.getByRole("button", { name: "Candidate actions for Pat Phone" })).toHaveCount(0);
});

test("Reference Check requires available references to be checked before Pass", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Candidate actions for Rae Reference" }).click();
  const menu = page.getByRole("menu", { name: "Candidate actions for Rae Reference" });
  await expect(menu.getByRole("menuitem").filter({ hasText: "Pass stage" })).toBeDisabled();
  await menu.getByRole("menuitem", { name: "Manage reference checks" }).click();

  const detail = page.getByRole("dialog", { name: /C-REF/ });
  await expect(detail.getByText("References")).toBeVisible();
  await detail.getByRole("button", { name: "Record check" }).click();
  const checkDialog = page.getByRole("dialog", { name: /Reference check/i });
  await checkDialog.getByLabel("Conversation duration (minutes)").fill("18");
  await checkDialog.getByLabel("Conversation summary").fill("Confirmed role scope and collaboration.");
  await checkDialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_save_candidate_reference_check_v1");

  await page.getByRole("button", { name: "Candidate actions for Rae Reference" }).click();
  const readyMenu = page.getByRole("menu", { name: "Candidate actions for Rae Reference" });
  await expect(readyMenu.getByRole("menuitem").filter({ hasText: "Pass stage" })).toBeEnabled();
});
