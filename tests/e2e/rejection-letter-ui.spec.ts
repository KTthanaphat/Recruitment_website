import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("admin recruiters can configure brace-format rejection letters", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/configuration");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Configuration", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Send rejection letter format" })).toBeVisible();
  await page.getByRole("button", { name: "New format" }).click();
  await expect(page.getByText("Variables: {candidate_name}", { exact: false })).toBeVisible();
});

test("failed pipeline candidates use the send rejection letter composer without variable insertion", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  const failedCandidate = page.locator("#pipeline-candidate-C-FAILED");
  await failedCandidate.getByRole("button", { name: "Send rejection letter" }).click();
  const dialog = page.getByRole("dialog", { name: "Send rejection letter" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Insert variable")).toHaveCount(0);
  await expect(dialog.getByText("This email will be sent immediately from the shared HR mailbox.")).toBeVisible();
});

test("sent rejection letters disable a second send from the pipeline", async ({ page }) => {
  const context = await installMockSupabase(page, { role: "admin_recruiter" });
  const failedLog = context.data.recruitment_logs.find((log) => log.candidate_id === "C-FAILED" && log.result === 0);
  if (!failedLog?.stage_instance_id) throw new Error("Missing failed fixture stage.");
  context.data.rejection_letter_drafts.push({ draft_id: "draft-sent", candidate_id: "C-FAILED", failed_stage_instance_id: failedLog.stage_instance_id, template_id: null, template_version: null, language: "en", recipient_email: "finn@example.com", subject: "Outcome", body: "Thank you", status: "sent", shared_mailbox: "hr@example.com", outlook_draft_id: "delivery-sent", flow_run_id: "run-sent", response_metadata: { ok: true }, failure_summary: null, retry_of_draft_id: null, created_by: "qa-admin", created_at: "2026-07-24T05:00:00.000Z", finalized_at: "2026-07-24T05:00:01.000Z" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await expect(page.locator("#pipeline-candidate-C-FAILED").getByRole("button", { name: "Send rejection letter" })).toBeDisabled();
});
