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
  await expect(dialog.locator('input[name="estimated_action_date"]')).toHaveValue("2026-07-25");
  await expect(dialog.locator('input[name="interviewer"]')).toHaveValue("QA Interviewer");
  await expect(dialog.locator('textarea[name="remark"]')).toHaveValue("QA Phone Screen");
  await dialog.getByRole("button", { name: "Estimated action date" }).click();
  await dialog.getByRole("button", { name: "Clear" }).click();
  await dialog.locator('textarea[name="remark"]').fill("Recruiter corrected pending note");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_update_pipeline_pending_v2");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    stage_instance_id: "00000000-0000-4000-8000-000000000001",
    pending: { opened_date: "2026-07-09", estimated_action_date: null, interviewer: "QA Interviewer", remark: "Recruiter corrected pending note" }
  });
  expect(mock.data.recruitment_logs.find((row) => row.log_id === 1)?.estimated_action_date).toBeNull();
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
  await expect(dialog.locator('input[name="outcome_interviewer"]')).toHaveValue("QA Interviewer");
  await expect(dialog.locator('input[name="next_opened_date"]')).toHaveCount(0);
  await expect(dialog.getByText(/Next pending date: 2026-07-24/)).toBeVisible();
  await dialog.getByRole("button", { name: "Outcome date" }).click();
  await dialog.getByRole("button", { name: "23/07/2026" }).click();
  await expect(dialog.getByText(/Next pending date: 2026-07-23/)).toBeVisible();
  await dialog.getByRole("button", { name: "Estimated action date" }).click();
  await dialog.getByRole("button", { name: "26/07/2026" }).click();
  await dialog.locator('textarea[name="outcome_remark"]').fill("Strong phone screen");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.some((call) => call.endpoint === "app_complete_pipeline_stage_v2" && Object.keys(call.payload).length > 0)).toBe(true);
  await expect(page.getByRole("dialog", { name: "Offer stage passed" })).toHaveCount(0);
  const completion = mock.rpcCalls.findLast((call) => call.endpoint === "app_complete_pipeline_stage_v2" && Object.keys(call.payload).length > 0);
  expect(completion?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    stage_instance_id: "00000000-0000-4000-8000-000000000001",
    pending: { opened_date: "2026-07-09", estimated_action_date: "2026-07-25", interviewer: "QA Interviewer", remark: "QA Phone Screen" },
    outcome: { result: "pass", date: "2026-07-23", interviewer: "QA Interviewer", remark: "Strong phone screen" },
    next_pending: { stage: "HR Interview", round: 1, estimated_action_date: "2026-07-26" }
  });
  expect(completion?.payload.next_pending).not.toHaveProperty("opened_date");
  const stages = mock.data.recruitment_logs.filter((row) => row.candidate_id === "C-PHONE" && row.superseded_at === null);
  expect(stages.find((row) => row.log_id === 1)?.result).toBe(1);
  expect(stages.filter((row) => row.result === null)).toHaveLength(1);
  expect(stages.find((row) => row.result === null)?.log_date).toBe("2026-07-23");
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
  await expect(dialog.getByText("Pending details", { exact: true })).toHaveCount(0);
  await expect(dialog.locator('input[name="pending_opened_date"]')).toHaveAttribute("type", "hidden");
  await expect(dialog.locator('input[name="pending_estimated_action_date"]')).toHaveValue("2026-07-25");
  await expect(dialog.locator('input[name="pending_interviewer"]')).toHaveAttribute("type", "hidden");
  await expect(dialog.locator('textarea[name="pending_remark"]')).toHaveCount(0);
  await expect(dialog.locator('input[name="next_opened_date"]')).toHaveCount(0);
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_complete_pipeline_stage_v2");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    pending: { opened_date: "2026-07-09", estimated_action_date: "2026-07-25", interviewer: "QA Interviewer", remark: "QA Phone Screen" },
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

test("passing Line Interview starts Test at round 1", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const lineInterview = mock.data.recruitment_logs.find((row) => row.candidate_id === "C-PHONE" && row.recruitment_process === "Phone Screen");
  if (!lineInterview) throw new Error("Pipeline fixture is missing the current stage.");
  lineInterview.recruitment_process = "Line Interview";
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const menu = await openPatMenu(page);
  await menu.getByRole("menuitem").filter({ hasText: "Pass stage" }).click();
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_complete_pipeline_stage_v2");
  expect(mock.rpcCalls.at(-1)?.payload.next_pending).toMatchObject({ stage: "Test", round: 1 });
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
  expect(mock.rpcCalls.filter((call) => call.endpoint === "app_pass_pipeline_jump_v2")).toHaveLength(0);
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
  await expect(dialog.getByText("Estimated: 25/07/2026")).toBeVisible();
  await expect(dialog.getByText("Awaiting outcome")).toBeVisible();
  await expect(dialog.getByText("Resume Screening")).toBeVisible();
  await expect(page.getByRole("button", { name: "Candidate actions for Pat Phone" })).toHaveCount(0);
});

test("candidate detail shows a completed stage's outcome remark, including legacy remark values", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "viewer" });
  const phoneScreen = mock.data.recruitment_logs.find((log) => log.log_id === 1);
  if (!phoneScreen) throw new Error("Expected the Phone Screen fixture.");
  phoneScreen.result = 0;
  phoneScreen.outcome_date = "2026-07-24";
  phoneScreen.outcome_remark = null;
  phoneScreen.remark = "Legacy phone-screen outcome detail";

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: /^Pat Phone/ }).click();
  const dialog = page.getByRole("dialog", { name: /C-PHONE/ });
  await expect(dialog.getByText("Completed stage history")).toBeVisible();
  await expect(dialog.getByText("Remark: Legacy phone-screen outcome detail")).toBeVisible();
});

test("candidate detail opens the same Edit Pending Details workflow for an authorized recruiter", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: /^Pat Phone/ }).click();
  const detail = page.getByRole("dialog", { name: /C-PHONE/ });
  await detail.getByRole("button", { name: "Edit", exact: true }).click();
  const pendingDialog = page.getByRole("dialog", { name: "Edit Pending Details" });
  await expect(pendingDialog).toBeVisible();
  await expect(pendingDialog.locator('input[name="estimated_action_date"]')).toHaveValue("2026-07-25");
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
  await expect(detail.getByText("Contact references", { exact: true })).toBeVisible();
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
