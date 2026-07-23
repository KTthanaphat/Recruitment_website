import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("stage menu is keyboard reachable and closes with Escape", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const updateButton = page.getByRole("button", { name: "Candidate actions for Pat Phone" });
  await updateButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /HR Interview/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("no-activity candidate can start process from pipeline menu", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Candidate actions for Nora No Activity" }).click();
  await expect(page.getByRole("menuitem", { name: "Start phone screen for Nora No Activity" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Start phone screen for Nora No Activity" }).click();
  const dialog = page.getByRole("dialog", { name: "Process Update" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Candidate")).toHaveValue("C-NO-ACTIVITY");
  await expect(dialog.getByLabel("Process")).toHaveValue("Phone Screen");
});

test("moving a candidate forward uses pipeline pass RPC payload", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Candidate actions for Pat Phone" }).click();
  await page.getByRole("menuitem", { name: "HR Interview" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Passed Stages" })).toBeVisible();
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toBeVisible();
  await expect(page.getByText('"target_stage": "HR Interview"')).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_insert_pipeline_passes");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    target_stage: "HR Interview",
    audit_mode: "pending_then_pass"
  });
});

test("multi-stage jump records pending then pass for crossed stages and final pending", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Candidate actions for Pat Phone" }).click();
  await page.getByRole("menuitem", { name: "Line Interview" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm Passed Stages" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Phone Screening", { exact: true }).first()).toBeVisible();
  await expect(dialog.getByText("HR Interview", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_insert_pipeline_passes");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    target_stage: "Line Interview",
    audit_mode: "pending_then_pass"
  });
  expect(mock.rpcCalls.at(-1)?.payload.stages).toMatchObject([
    { stage: "Phone Screen", round: 1 },
    { stage: "HR Interview", round: 1 }
  ]);
  const savedLogs = mock.data.recruitment_logs
    .filter((log) => log.candidate_id === "C-PHONE")
    .slice(-4)
    .map((log) => [log.recruitment_process, log.result]);
  expect(savedLogs).toEqual([
    ["Phone Screen", 1],
    ["HR Interview", null],
    ["HR Interview", 1],
    ["Line Interview", null]
  ]);
});

test("pipeline menu can fail the current pending stage", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Candidate actions for Pat Phone" }).click();
  await page.getByRole("menuitem", { name: "Fail current stage" }).click();
  const dialog = page.getByRole("dialog", { name: "Process Update" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Candidate")).toHaveValue("C-PHONE");
  await expect(dialog.getByLabel("Process")).toHaveValue("Phone Screen");
  await expect(dialog.getByLabel("Result")).toHaveValue("0");

  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_insert_recruitment_log");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    candidate_id: "C-PHONE",
    recruitment_process: "Phone Screen",
    result: "0"
  });
});

test("test-stage maintenance and test exit use special workflows", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Candidate actions for Tina Test" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Candidate actions for Tina Test" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Maintain in Test" }).click();
  await expect(page.getByRole("dialog", { name: "Maintain Test Round" })).toBeVisible();
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_insert_test_maintenance");

  await page.getByRole("button", { name: "Candidate actions for Tina Test" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Reference Check" }).click();
  await page.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_insert_pipeline_test_exit");
});

test("failed and completed candidates cannot be updated", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.locator("#pipeline-candidate-C-FAILED").getByRole("button", { name: /Finn Failed/ }).click();
  const failedDialog = page.getByRole("dialog", { name: /C-FAILED/ });
  await expect(failedDialog).toBeVisible();
  await expect(failedDialog.getByRole("button", { name: /Update process/ })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.locator("#pipeline-candidate-C-OFFER-PASS").getByRole("button", { name: /Olivia Offer Pass/ }).click();
  const completedDialog = page.getByRole("dialog", { name: /C-OFFER-PASS/ });
  await expect(completedDialog.getByRole("button", { name: /Update process/ })).toHaveCount(0);
});
