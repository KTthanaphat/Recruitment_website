import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("pipeline stages page locally after bounded reads with server search, closed pending membership, and padded ID aliases", async ({ page }) => {
  const mock = await installMockSupabase(page);
  const candidateTemplate = mock.data.candidates[0], applicationTemplate = mock.data.candidate_applications?.[0], assignmentTemplate = mock.data.candidate_application_assignments?.[0], logTemplate = mock.data.recruitment_logs[0];
  if (!candidateTemplate || !applicationTemplate || !assignmentTemplate || !logTemplate) throw new Error("Pipeline fixture templates are required.");
  let sequence = 0;
  const addCandidate = (id: string, name: string, stage: string | null, state: "active" | "closed" = "active") => {
    sequence++;
    const suffix = String(900000000000 + sequence).padStart(12, "0"), applicationId = `00000000-0000-4000-8000-${suffix}`;
    mock.data.candidates.push({ ...candidateTemplate, candidate_id: id, name, nickname: null, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" });
    mock.data.candidate_applications?.push({ ...applicationTemplate, application_id: applicationId, candidate_id: id, group_id: "GRP-ENG", state, version: 1, created_at: "2026-07-01T00:00:00.000Z", updated_at: "2026-07-01T00:00:00.000Z" });
    mock.data.candidate_application_assignments?.push({ ...assignmentTemplate, assignment_id: `20000000-0000-4000-8000-${suffix}`, application_id: applicationId, group_id: "GRP-ENG", started_at: "2026-07-01T00:00:00.000Z", ended_at: null });
    if (stage) mock.data.recruitment_logs.push({ ...logTemplate, log_id: 80000 + sequence, candidate_id: id, application_id: applicationId, recruitment_process: stage as typeof logTemplate.recruitment_process, result: null, log_date: "2026-07-02", outcome_date: null, stage_instance_id: `30000000-0000-4000-8000-${suffix}`, superseded_at: null, superseded_by_stage_instance_id: null });
  };
  addCandidate("CAN-BOARD-CLOSED", "Board Phone Closed", "Phone Screen", "closed");
  for (let index = 1; index <= 61; index++) addCandidate(`CAN-BOARD-${String(index).padStart(3, "0")}`, `Board Phone ${String(index).padStart(3, "0")}`, "Phone Screen");
  addCandidate("CAN-0001", "Board Alias Candidate", "Phone Screen");
  addCandidate("CAN-BOARD-HR-1", "Board HR One", "HR Interview");
  addCandidate("CAN-BOARD-HR-2", "Board HR Two", "HR Interview");
  addCandidate("CAN-BOARD-NO-ACTIVITY", "Board No Activity", null);

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Pipeline filters" }).click();
  await page.getByPlaceholder("Candidate, ID, role, site, or owner").fill("BOARD-");
  const phone = page.locator('[data-pipeline-stage="Phone Screen"]'), hr = page.locator('[data-pipeline-stage="HR Interview"]'), noActivity = page.locator('[data-pipeline-stage="No activity"]');
  await expect(phone.locator("h3")).toContainText("62");
  await expect(hr.locator("h3")).toContainText("2");
  await expect(noActivity.locator("h3")).toContainText("1");
  const phoneCount = mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_count_v1" && (call.payload.p_filters as { stage?: string }).stage === "Phone Screen" && call.payload.p_search === "BOARD-").at(-1);
  expect(phoneCount?.response).toBe(62);
  await expect(phone.getByText("Board Phone Closed", { exact: true })).toBeVisible();
  await expect(hr.getByText("Board HR One", { exact: true })).toBeVisible();
  const phoneNext = phone.getByRole("button", { name: "Next", exact: true });
  await expect(phoneNext).toBeEnabled();
  await expect(hr.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
  await phoneNext.click();
  await expect(phone.getByLabel("Current page / total pages")).toHaveText("2/13");
  await expect(hr.getByLabel("Current page / total pages")).toHaveText("1/1");
  const stageCalls = mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "pipeline_stage");
  expect(stageCalls.some(call => (call.payload.p_filters as { stage?: string }).stage === "Phone Screen")).toBe(true);
  expect(stageCalls.some(call => (call.payload.p_filters as { stage?: string }).stage === "HR Interview")).toBe(true);
  const phoneRequests = stageCalls.filter(call => (call.payload.p_filters as { stage?: string }).stage === "Phone Screen");
  expect(phoneRequests.every(call => call.payload.p_sort === "board_last_update" && call.payload.p_direction === "asc")).toBe(true);
  expect(phoneRequests.every(call => Number(call.payload.p_limit) <= 100)).toBe(true);

  await page.getByRole("button", { name: "Pipeline filters" }).click();
  await page.getByPlaceholder("Candidate, ID, role, site, or owner").fill("CAN-00001");
  await expect(phone.getByLabel("Current page / total pages")).toBeVisible();
  await expect(phone.getByText("Board Alias Candidate", { exact: true })).toBeVisible();
  await expect(phone.locator("article").filter({ hasText: "Board Alias Candidate" })).toContainText("CAN-00001");
  const aliasCall = mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "pipeline_stage").at(-1)!;
  expect(aliasCall.payload.p_search).toBe("CAN-00001");
  expect((aliasCall.payload.p_filters as { stage?: string }).stage).toBeDefined();
});
