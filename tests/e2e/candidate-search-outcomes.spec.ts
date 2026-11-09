import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("workspace keeps all outcomes while records pipeline keeps only seven days", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  for (const log of data.recruitment_logs) {
    if (["C-FAILED", "C-OFFER-PASS"].includes(log.candidate_id)) {
      log.log_date = "2026-06-01";
      if (log.outcome_date) log.outcome_date = "2026-06-02";
    }
  }
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Failed Candidates - Last 7 Days" })).toBeVisible();
  await expect(page.locator('[data-candidate-id="C-FAILED"]')).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Passed Offer - Last 7 Days" })).toBeVisible();
  await expect(page.locator('[data-candidate-id="C-OFFER-PASS"]')).toHaveCount(0);
  await expect(page.locator('[data-candidate-id="C-OFFER-NO-OFFER"]')).toBeVisible();
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&section=pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Failed Candidates - All Time" })).toBeVisible();
  await expect(page.locator('[data-candidate-id="C-FAILED"]')).toBeVisible();
  await page.goto("/workspace?type=requisition&id=REQ-KT1-1&section=pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Passed Offer - All Time" })).toBeVisible();
  await expect(page.locator('[data-candidate-id="C-OFFER-PASS"]')).toBeVisible();
});

test("candidate search matches phone numbers and case-insensitive email", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  const candidate = data.candidates.find((row) => row.candidate_id === "C-PHONE")!;
  candidate.phone_no = "081-234-5678";
  candidate.email = "pat.phone@example.com";
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  const search = page.getByPlaceholder("Search records", { exact: true });
  for (const query of ["081-234-5678", "0812345678", "2345678", "PAT.PHONE@EXAMPLE.COM", "pat.phone@", "Pat Phone"]) {
    await search.fill(query);
    await expect(page.getByRole("row").filter({ hasText: "C-PHONE" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "C-AGING" })).toHaveCount(0);
  }
  await search.fill("missing@example.com");
  await expect(page.getByRole("row").filter({ hasText: "C-PHONE" })).toHaveCount(0);
});

test("candidate registry hydrates a searched record on demand by raw id", async ({ page }) => {
  const mock = await installMockSupabase(page);
  const original = mock.data.candidates.find(row => row.candidate_id === "C-PHONE")!;
  const candidateId = "CAN-BEYOND-1000";
  mock.data.candidates.push({ ...original, candidate_id: candidateId, name: "Beyond the first 1,000", nickname: "Beyond", phone_no: "0899999999", email: "beyond@example.com", created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-24T00:00:00.000Z" });
  const applicationId = "00000000-0000-4000-8000-999999999999";
  mock.data.candidate_applications?.push({ application_id: applicationId, candidate_id: candidateId, group_id: "GRP-ENG", state: "active", closure_reason: null, closed_at: null, created_by: mock.data.profile?.id ?? null, version: 1, created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-24T00:00:00.000Z" });
  mock.data.candidate_application_assignments?.push({ assignment_id: "10000000-0000-4000-8000-999999999999", application_id: applicationId, group_id: "GRP-ENG", from_group_id: null, started_at: "2026-07-20T00:00:00.000Z", ended_at: null, actor_id: mock.data.profile?.id ?? null, reason: null, attribution_inferred: false });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  await page.getByRole("searchbox").fill(candidateId);
  const row = page.getByRole("row").filter({ hasText: candidateId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Beyond the first 1,000/ }).click();
  await expect(page.getByRole("region", { name: "Candidate profile" })).toBeVisible();
  await expect(page.getByText("Beyond the first 1,000", { exact: true })).toBeVisible();
  expect(mock.rpcCalls.some(call => call.endpoint === "app_candidate_profile_detail_v1" && call.payload.p_candidate_id === candidateId)).toBeTruthy();
  expect(mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "candidate_applications" && (call.payload.p_filters as Record<string, unknown>)?.candidateId === candidateId)).toBeTruthy();
});

test("candidate detail retains every row in a history larger than the API row cap", async ({ page }) => {
  const mock = await installMockSupabase(page);
  const original = mock.data.candidates.find(row => row.candidate_id === "C-PHONE")!;
  const candidateId = "CAN-HISTORY-1001";
  mock.data.candidates.push({ ...original, candidate_id: candidateId, name: "History Beyond Page Cap", nickname: "History", phone_no: "0800000000", email: "history@example.com" });
  const applicationId = "00000000-0000-4000-8000-999999999998";
  mock.data.candidate_applications?.push({ application_id: applicationId, candidate_id: candidateId, group_id: "GRP-ENG", state: "active", closure_reason: null, closed_at: null, created_by: mock.data.profile?.id ?? null, version: 1, created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-24T00:00:00.000Z" });
  const oldest = Array.from({ length: 1001 }, (_, index) => ({
    application_id: applicationId, log_id: 50000 + index, candidate_id: candidateId, log_date: "2023-01-" + String(index % 28 + 1).padStart(2, "0"),
    recruitment_process: "Phone Screen" as const, round: index + 1, interviewer: "Legacy interviewer", result: 0 as const,
    remark: index === 0 ? "Retained old failure sentinel" : "Legacy failure " + index, created_at: "2023-01-01T00:00:00.000Z",
    stage_instance_id: "legacy-stage-" + index, outcome_date: "2023-01-02", outcome_interviewer: "Legacy interviewer", outcome_remark: null,
    superseded_at: null
  }));
  const originalHistory = [...mock.data.recruitment_log_history];
  mock.data.recruitment_logs = [...mock.data.recruitment_logs, ...oldest];
  mock.data.recruitment_log_history = [...originalHistory, ...oldest];
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  await page.getByRole("searchbox").fill(candidateId);
  const row = page.getByRole("row").filter({ hasText: candidateId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /History Beyond Page Cap/ }).click();
  await expect(page.getByRole("region", { name: "Candidate profile" })).toBeVisible();
  await expect(page.getByText(/Show remaining history/)).toHaveCount(0);
  await expect(page.locator(".stage-history-entry")).toHaveCount(1001);
  await expect(page.getByText("Retained old failure sentinel",{exact:true})).toBeVisible();
  expect(mock.rpcCalls.filter(call=>call.endpoint==="app_recruitment_list_v1"&&call.payload.p_entity==="pipeline_history"&&(call.payload.p_filters as Record<string,unknown>)?.applicationId===applicationId).length).toBeGreaterThan(10);
  const boundedLookups=mock.restReads.filter(read=>Object.keys(read.inFilterSizes).length>0);
  expect(boundedLookups.length).toBeGreaterThan(0);
  expect(Math.max(...boundedLookups.flatMap(read=>Object.values(read.inFilterSizes)))).toBeLessThanOrEqual(200);
});

test("a candidate absent from bootstrap can edit and save its selected application's pending stage", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const original = mock.data.candidates.find(row => row.candidate_id === "C-PHONE")!;
  const candidateId = "CAN-DETAIL-WRITE";
  const applicationId = "00000000-0000-4000-8000-999999999997";
  mock.data.candidates.push({ ...original, candidate_id: candidateId, name: "Lazy Detail Write", nickname: "Lazy", phone_no: "0811111111", email: "lazy@example.com" });
  mock.data.candidate_applications?.push({ application_id: applicationId, candidate_id: candidateId, group_id: "GRP-ENG", state: "active", closure_reason: null, closed_at: null, created_by: mock.data.profile?.id ?? null, version: 4, created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-24T00:00:00.000Z" });
  const groupTemplate = mock.data.position_groups[0], linkTemplate = mock.data.document_groups[0], requisitionTemplate = mock.data.requisitions[0];
  mock.data.position_groups.push({ ...groupTemplate, group_id: "GRP-TECH", group_position: "Technician" });
  mock.data.document_groups.push({ ...linkTemplate, doc_group_id: "DG-TECH", group_id: "GRP-TECH", doc_id: "REQ-TECH" });
  mock.data.requisitions.push({ ...requisitionTemplate, doc_id: "REQ-TECH", status: "ongoing", head_count: 1, person_in_charge: "Alice" });
  mock.data.candidate_application_assignments?.push({ assignment_id: "10000000-0000-4000-8000-999999999997", application_id: applicationId, group_id: "GRP-ENG", from_group_id: null, started_at: "2026-07-20T00:00:00.000Z", ended_at: null, actor_id: mock.data.profile?.id ?? null, reason: null, attribution_inferred: false });
  const pending = { application_id: applicationId, log_id: 70001, candidate_id: candidateId, log_date: "2026-07-20", recruitment_process: "Phone Screen" as const, round: 1, interviewer: "Original interviewer", result: null, remark: "Original pending remark", estimated_action_date: "2026-07-25", created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-24T00:00:00.000Z", stage_instance_id: "lazy-pending-instance", superseded_at: null };
  mock.data.recruitment_logs = [...mock.data.recruitment_logs, pending];
  mock.data.recruitment_log_history = [...mock.data.recruitment_log_history, pending];
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  await page.getByRole("searchbox").fill(candidateId);
  const row = page.getByRole("row").filter({ hasText: candidateId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Lazy Detail Write/ }).click();
  const detail = page.getByRole("dialog", { name: /CAN-DETAIL-WRITE/ });
  await detail.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit current stage" });
  await expect(editor).toBeVisible();
  await editor.locator('button[aria-haspopup="dialog"]').click();
  await editor.getByRole("button", { name: /26\/07\/2026/ }).click();
  await editor.locator("textarea").fill("Updated from the lazy detail context");
  await editor.getByRole("button", { name: "Save estimated date" }).click();
  await expect(editor).toHaveCount(0);
  const saved = mock.rpcCalls.find(call => call.endpoint === "app_update_pipeline_pending_v2");
  expect(saved?.payload.candidate_id).toBe(candidateId);
  expect(saved?.payload.application_id).toBe(applicationId);
  await expect(detail.getByText(/Estimated: 26\/07\/2026/)).toBeVisible();
  await expect(detail.getByText("Updated from the lazy detail context")).toBeVisible();
  await detail.getByRole("button", { name: "Close" }).click();
  await row.getByRole("button", { name: /Lazy Detail Write/ }).click();
  const reopened = page.getByRole("dialog", { name: /CAN-DETAIL-WRITE/ });
  await expect(reopened.getByText(/Estimated: 26\/07\/2026/)).toBeVisible();
  await expect(reopened.getByText("Updated from the lazy detail context")).toBeVisible();
  await reopened.getByRole("button", { name: "Reassign application" }).click();
  await expect(page.getByRole("heading", { name: "Review reassignment" })).toBeVisible();
  await expect.poll(() => mock.rpcCalls.filter(call => call.endpoint === "app_application_destinations_page_v1").length).toBeGreaterThan(0);
  await expect.poll(() => (mock.rpcCalls.filter(call => call.endpoint === "app_application_destinations_page_v1").at(-1)?.response as { items?: Array<{ group_id: string }> } | undefined)?.items?.some(row => row.group_id === "GRP-TECH")).toBe(true);
  const transferForm = page.locator("form").filter({ has: page.getByRole("heading", { name: "Review reassignment" }) });
  const destination = transferForm.getByRole("combobox", { name: "Destination group", exact: true });
  await expect.poll(() => destination.locator("option").count()).toBeGreaterThan(1);
  await destination.selectOption({ index: 1 });
  await transferForm.locator("textarea").fill("Verify selected application version");
  await transferForm.getByRole("button", { name: "Review application" }).click();
  const transferConfirm = page.getByRole("dialog", { name: "Confirm Save" });
  await expect(transferConfirm).toBeVisible();
  await transferConfirm.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(()=>mock.rpcCalls.some(call=>call.endpoint==="app_transfer_candidate_application_v1")).toBe(true);
  const transfer = mock.rpcCalls.find(call => call.endpoint === "app_transfer_candidate_application_v1");
  expect(transfer?.payload.candidate_id).toBe(candidateId);
  expect(transfer?.payload.application_id).toBe(applicationId);
  expect(transfer?.payload.expected_version).toBe(4);
});
