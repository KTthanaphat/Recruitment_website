import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("pipeline board renders active, failed, passed, aging, and filtered candidates", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Phone Screening", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No activity", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "HR Interview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Line Interview", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reference Check", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Offer", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resume Screening", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Phone Screening", exact: true })).toHaveCSS("color", "rgb(255, 59, 48)");
  await expect(page.getByRole("heading", { name: "No activity", exact: true })).toHaveCSS("color", "rgb(11, 19, 43)");
  await expect(page.getByText("SLA 2 - Oldest 24d - Average 17d")).toHaveCount(0);
  const phoneStage = page.getByRole("heading", { name: "Phone Screening", exact: true }).locator("xpath=ancestor::section[1]");
  await expect(phoneStage.locator("article strong")).toContainText(["Avery Aging", "Pat Phone", "Penny Phone Pass"]);
  await expect.poll(async () => phoneStage.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgb(255, 255, 255)");

  await expect(page.getByText("Pat Phone")).toBeVisible();
  await expect(page.locator('[data-candidate-id="C-PHONE"]').getByText("Estimated: 25/07/2026")).toBeVisible();
  await expect(page.locator('[data-candidate-id="C-AGING"]').getByText(/Estimated: 20\/07\/2026.*Overdue/)).toBeVisible();
  await expect(page.getByText("Nora No Activity")).toBeVisible();
  await expect(page.getByText("Active candidates")).toBeVisible();
  await expect(page.getByText("Aging", { exact: true })).toBeVisible();
  await expect(page.getByText("Avery Aging")).toBeVisible();
  await expect(page.getByText("Tina Test")).toBeVisible();
  await expect(page.getByText("Failed Candidates - Last 7 Days")).toBeVisible();
  await expect(page.getByText("Finn Failed")).toBeVisible();
  await expect(page.getByText("Passed Offer - Last 7 Days")).toBeVisible();
  await expect(page.getByText("Olivia Offer Pass")).toBeVisible();
  await expect(page.getByText("Oscar Offer Needed")).toBeVisible();
  await expect(page.locator('[data-candidate-id="C-OFFER-NO-OFFER"]').getByRole("button", { name: "Create offer" })).toBeVisible();
  await expect(page.locator('[data-candidate-id="C-OFFER-PASS"]').getByRole("button", { name: "Create offer" })).toHaveCount(0);
  await expect(page.locator('[data-candidate-id="C-AGING"]').getByRole("button", { name: "Candidate actions for Avery Aging" })).toHaveCSS("color", "rgb(255, 59, 48)");
  await expect(page.locator('[data-candidate-id="C-PHONE"]').getByRole("button", { name: "Candidate actions for Pat Phone" })).toHaveCSS("color", "rgb(255, 59, 48)");

  const filterButton = page.getByRole("button", { name: "Pipeline filters" });
  const siteGroupButton = page.locator('button[aria-pressed]').filter({ hasText: /^Site$/ });
  const ownerGroupButton = page.locator('button[aria-pressed]').filter({ hasText: /^Owner$/ });
  const filterBox = await filterButton.boundingBox();
  const siteBox = await siteGroupButton.boundingBox();
  const ownerBox = await ownerGroupButton.boundingBox();
  expect(filterBox?.x ?? 0).toBeGreaterThan((siteBox?.x ?? 0) + (siteBox?.width ?? 0));
  expect(filterBox?.x ?? 0).toBeGreaterThan((ownerBox?.x ?? 0) + (ownerBox?.width ?? 0));
  await filterButton.click();
  const filterDialog = page.getByRole("dialog", { name: "Pipeline filters" });
  await expect(filterDialog).toBeVisible();
  await filterDialog.getByLabel("Search pipeline").fill("Tina");
  await page.keyboard.press("Escape");
  await expect(filterDialog).toHaveCount(0);
  await expect(filterButton).toBeFocused();
  await expect(filterButton).toHaveAccessibleName("Pipeline filters, 1 active");
  await expect(page.getByText("Tina Test")).toBeVisible();
  await expect(page.getByText("Pat Phone")).toHaveCount(0);

  const siteFilter = page.locator("[data-app-header-actions]").getByLabel("Site", { exact: true });
  await siteFilter.click();
  await page.getByRole("listbox", { name: "Site" }).getByRole("option", { name: "KT1", exact: true }).click();
  await expect(page.getByText("Tina Test")).toBeVisible();
  await expect(page.getByText("Pat Phone")).toHaveCount(0);
});

test("pipeline actions hydrate and complete the selected application absent from bootstrap", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const source = mock.data.candidates.find(row => row.candidate_id === "C-PHONE")!;
  const candidateId = "CAN-LAZY-BOARD";
  const applicationId = "00000000-0000-4000-8000-999999999996";
  mock.data.candidates.push({ ...source, candidate_id: candidateId, name: "Lazy Board Action", nickname: "Lazy", phone_no: "0812222222", email: "lazy-board@example.com" });
  mock.data.candidate_applications?.push({ application_id: applicationId, candidate_id: candidateId, group_id: "GRP-ENG", state: "active", closure_reason: null, closed_at: null, created_by: mock.data.profile?.id ?? null, version: 2, created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-24T00:00:00.000Z" });
  mock.data.candidate_application_assignments?.push({ assignment_id: "10000000-0000-4000-8000-999999999996", application_id: applicationId, group_id: "GRP-ENG", from_group_id: null, started_at: "2026-07-20T00:00:00.000Z", ended_at: null, actor_id: mock.data.profile?.id ?? null, reason: null, attribution_inferred: false });
  const pending = { application_id: applicationId, log_id: 70002, candidate_id: candidateId, log_date: "2026-07-20", recruitment_process: "Phone Screen" as const, round: 1, interviewer: "Lazy interviewer", result: null, remark: "Lazy pending", estimated_action_date: "2026-07-25", created_at: "2026-07-20T00:00:00.000Z", updated_at: "2026-07-24T00:00:00.000Z", stage_instance_id: "lazy-board-stage", superseded_at: null };
  mock.data.recruitment_logs.push(pending);
  mock.excludeBootstrapCandidate(candidateId);

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  const bootstrapCandidateRead = mock.restReads.find(read => read.table === "candidates" && !read.scopedCandidate);
  expect(bootstrapCandidateRead?.candidateIds).not.toContain(candidateId);
  const card = page.locator(`[data-candidate-id="${candidateId}"]`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /Candidate actions for Lazy Board Action/ }).click();
  await expect.poll(() => mock.rpcCalls.some(call => call.endpoint === "app_candidate_profile_detail_v1" && call.payload.p_candidate_id === candidateId)).toBe(true);
  await expect.poll(() => mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "pipeline_history" && (call.payload.p_filters as Record<string, unknown>)?.applicationId === applicationId)).toBe(true);
  const actions = page.getByRole("menu", { name: /Candidate actions for Lazy Board Action/ });
  await actions.getByRole("menuitem", { name: /Pass Phone Screening for Lazy Board Action/ }).click();
  const outcome = page.getByRole("dialog", { name: "Complete Stage" });
  await expect(outcome).toBeVisible();
  await outcome.getByRole("button", { name: "Review changes" }).click();
  const confirm = page.getByRole("dialog", { name: "Confirm Save" });
  await expect(confirm).toBeVisible();
  expect(mock.data.recruitment_logs.find(row => row.log_id === pending.log_id)?.application_id).toBe(applicationId);
  await confirm.getByRole("button", { name: "Save changes" }).click();
  const completed = mock.rpcCalls.find(call => call.endpoint === "app_complete_pipeline_stage_v2");
  expect(completed?.payload.candidate_id).toBe(candidateId);
  expect(completed?.payload.stage_instance_id).toBe(pending.stage_instance_id);
  await expect.poll(() => mock.data.recruitment_logs.find(row => row.log_id === pending.log_id)?.result).toBe(1);
});

test("pipeline search, grouping, and board filters narrow by pipeline context", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });

  for (const [query, expected] of [
    ["C-REF", "Rae Reference"],
    ["REQ-KT2-1", "Rae Reference"],
    ["Analyst", "Rae Reference"],
    ["Alice", "Pat Phone"]
  ] as const) {
    await page.goto(`/pipeline?pipelineSearch=${encodeURIComponent(query)}`);
    await expectWorkspaceReady(page);
    await expect(page.getByText(expected)).toBeVisible();
  }

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Owner" }).click();
  await expect(page.locator("xpath=//p[contains(@class, 'text-[11px]') and normalize-space(.)='Alice']").first()).toBeVisible();
  await expect(page.locator("xpath=//p[contains(@class, 'text-[11px]') and normalize-space(.)='Bob']").first()).toBeVisible();

  await page.getByRole("button", { name: "Pipeline filters" }).click();
  await page.getByRole("button", { name: "No activity", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Nora No Activity")).toBeVisible();
  await expect(page.getByText("Pat Phone")).toHaveCount(0);

  await page.getByRole("button", { name: /Pipeline filters/ }).click();
  await page.getByRole("button", { name: "Offer pending", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Nina Offer Ready")).toBeVisible();
  await expect(page.getByText("Nora No Activity")).toHaveCount(0);
});

test("pipeline table shows every stage record and opens the admin correction modal", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Finn Failed" }).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Olivia Offer Pass" }).first()).toBeVisible();
  await expect(page).toHaveURL(/pipelineView=table/);

  await page.getByRole("button", { name: "Advanced filters" }).click();
  await page.getByRole("checkbox", { name: "Show audit history" }).check();
  await expect(page).toHaveURL(/pipeAudit=1/);
  await page.getByRole("button", { name: "Clear" }).click();

  const patRow = page.getByRole("row").filter({ hasText: "Pat Phone" });
  await expect(patRow.getByRole("button", { name: "View candidate detail for Pat Phone" })).toBeVisible();
  await expect(patRow.getByRole("button", { name: "Edit pipeline record" })).toBeVisible();
  await expect(patRow.getByRole("button", { name: "Pass stage" })).toHaveCount(0);
  await patRow.getByRole("button", { name: "Edit pipeline record" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Pipeline Record" })).toBeVisible();
});

test("passed Offer card without an offer opens offer creation flow", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const targetApplication = mock.data.candidate_applications?.find(row => row.candidate_id === "C-OFFER-NO-OFFER");
  expect(targetApplication).toBeTruthy();
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.locator('[data-candidate-id="C-OFFER-NO-OFFER"]').getByRole("button", { name: "Create offer" }).click();
  const dialog = page.getByRole("dialog", { name: /Offer/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[name="candidate_id"]')).toHaveValue("C-OFFER-NO-OFFER");
  await expect(dialog.locator('input[name="application_id"]')).toHaveValue(targetApplication!.application_id);
  await expect(dialog.getByRole("button", { name: "Accepted Date" })).toContainText("18/07/2026");
  await expect(dialog.locator('input[name="accepted_date"]')).toHaveValue("2026-07-18");
});

test("viewer can inspect pipeline but cannot update stages or create offers", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Pat Phone")).toBeVisible();
  await expect(page.getByRole("button", { name: "Candidate actions for Pat Phone" })).toHaveCount(0);
  await expect(page.locator('[data-candidate-id="C-OFFER-NO-OFFER"]').getByRole("button", { name: "Create offer" })).toHaveCount(0);
  await page.locator('[data-candidate-id="C-OFFER-NO-OFFER"]').getByRole("button", { name: /Oscar Offer Needed/ }).click();
  await expect(page.getByRole("dialog", { name: /C-OFFER-NO-OFFER/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: /C-OFFER-NO-OFFER/ }).getByRole("button", { name: /Update process/ })).toHaveCount(0);
});

test("failed candidates remain pipeline workflow state, not data quality issues", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  await page.getByRole("dialog", { name: "Welcome Back" }).getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(page.getByText("Failed candidate in active stage")).toHaveCount(0);

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByText("Failed Candidates - Last 7 Days")).toBeVisible();
  await expect(page.getByText("Finn Failed")).toBeVisible();
});

test("candidate card opens detail drawer and can be closed by Escape", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: /^Pat Phone/ }).click();
  await expect(page.getByRole("dialog", { name: /C-PHONE/ })).toBeVisible();
  await expect(page.getByText("Current stage")).toBeVisible();
  await expect(page.getByText("Pending details")).toBeVisible();
  await expect(page.getByRole("dialog", { name: /C-PHONE/ }).getByText("Phone Screening / Round 1")).toBeVisible();
  await expect(page.getByRole("dialog", { name: /C-PHONE/ }).getByText(/Pending details: 09\/07\/2026.*QA Interviewer/)).toBeVisible();
  await expect(page.getByText("Resume Screening")).toBeVisible();
  await expect(page.locator('[data-stage-connector="Resume Screening->Phone Screen"]').first()).toHaveAttribute("data-stage-connector-state", "pending");
  await expect(page.locator('[data-stage-connector="Phone Screen->HR Interview"]').first()).toHaveAttribute("data-stage-connector-state", "unreached");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: /C-PHONE/ })).toHaveCount(0);
});

test("pipeline layout avoids page overflow on mobile while board scrolls internally", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  const board = page.locator('div[aria-label="Candidate Pipeline"]').last();
  await expect.poll(async () => board.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
});
