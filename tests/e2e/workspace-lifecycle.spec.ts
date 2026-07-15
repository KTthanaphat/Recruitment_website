import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("workspace journey follows the five-tab order without global recommendations", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-KT1-1&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const tabs = page.getByRole("tablist", { name: "Hiring workspace sections" }).getByRole("tab");
  await expect(tabs).toHaveText(["Overview", "Sourcing", "Pipeline", "Offer", "Activity"]);
  await expect(page.getByRole("heading", { name: "Hiring journey" })).toBeVisible();
  await expect(page.locator("section.sticky").getByRole("button", { name: "Review candidate", exact: true })).toHaveCount(0);
});

test("embedded sourcing saves through the intercepted RPC and embedded pipeline opens a stage menu", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  await page.getByRole("tab", { name: "Sourcing" }).click();
  const sourcingForm = page.locator("#sourcing-group-GRP-ENG");
  await expect(sourcingForm).toBeVisible();
  await sourcingForm.locator('input[name="applicants_fb"]').fill("13");
  await sourcingForm.getByRole("button", { name: "Save sourcing week for GRP-ENG" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toBeVisible();
  await page.getByRole("dialog", { name: "Confirm Save" }).getByRole("button", { name: /Save changes/i }).click();
  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_upsert_sourcing_weekly_update");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({
    group_id: "GRP-ENG",
    week_start: "2026-07-06",
    applicants_fb: 13
  });
  expect(mock.rpcCalls.at(-1)?.payload).not.toHaveProperty("channel_fb");

  await page.getByRole("tab", { name: "Pipeline" }).click();
  const noActivityLane = page
    .getByRole("tabpanel")
    .getByRole("heading", { name: "No activity", exact: true })
    .locator("xpath=ancestor::section[1]");
  await expect(noActivityLane).toHaveCSS("background-color", "rgb(246, 248, 252)");
  await expect(noActivityLane).toHaveCSS("border-top-color", "rgb(215, 222, 232)");
  const card = page.locator("#pipeline-candidate-C-PHONE");
  await card.getByRole("button", { name: "Candidate actions for Pat Phone" }).click();
  await expect(card.getByRole("menu", { name: "Actions for Pat Phone" })).toBeVisible();
  await expect(card.getByRole("menuitem", { name: /HR Interview/ })).toBeVisible();
});

test("workspace group sourcing tab exposes editable applicant fields", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const sourcingForm = page.locator("#sourcing-group-GRP-ENG");
  await expect(sourcingForm).toBeVisible();
  await expect(sourcingForm.getByRole("button", { name: "Save sourcing week for GRP-ENG" })).toBeVisible();
  await expect(sourcingForm.getByRole("button", { name: "Sourcing Conversion Quality" })).toHaveAttribute("aria-expanded", "false");
  await expect(sourcingForm.locator('input[name="applicants_fb"]')).toBeEditable();
});

test("unsaved sourcing week defaults applicant counts from latest saved update", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-07-13");
  await expectWorkspaceReady(page);

  const sourcingForm = page.locator("#sourcing-group-GRP-ENG");
  await expect(sourcingForm).toBeVisible();
  await expect(sourcingForm.locator('input[name="applicants_fb"]')).toHaveValue("12");
});

test("workspace picker selection keeps sourcing editor scoped to selected group", async ({ page }) => {
  await installMockSupabase(page, { role: "system_admin" });
  await page.goto("/workspace?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "Groups" }).click();
  await page.getByRole("button", { name: /GRP-ENG/ }).click();
  await page.getByRole("tab", { name: "Sourcing" }).click();

  const sourcingForm = page.locator("#sourcing-group-GRP-ENG");
  await expect(sourcingForm).toBeVisible();
  await expect(sourcingForm.getByRole("button", { name: "Save sourcing week for GRP-ENG" })).toBeVisible();
  await expect(sourcingForm.locator('input[name="applicants_fb"]')).toBeEditable();
});

test("Offer action opens the update path without asserting backend persistence", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-KT2-1");
  await expectWorkspaceReady(page);
  await page.getByRole("tab", { name: "Offer" }).click();

  await expect(page.getByText("Owen Offer")).toBeVisible();
  await page.getByRole("button", { name: "Update offer" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Offer" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Edit Offer" }).getByLabel("Existing Offer")).toHaveValue("1");
});

test("pipeline no-activity menu opens the start-process modal", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-KT2-1");
  await expectWorkspaceReady(page);
  await page.getByRole("tab", { name: "Pipeline" }).click();

  const card = page.locator("#pipeline-candidate-C-NO-ACTIVITY");
  await card.getByRole("button", { name: "Candidate actions for Nora No Activity" }).click();
  await card.getByRole("menuitem", { name: "Start phone screen for Nora No Activity" }).click();
  await expect(page.getByRole("dialog", { name: "Process Update" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Process Update" }).getByLabel("Candidate")).toHaveValue("C-NO-ACTIVITY");
});

test("viewer sees disabled explanations for workspace updates", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/workspace?type=requisition&id=REQ-KT2-1");
  await expectWorkspaceReady(page);

  const editAction = page.getByRole("button", { name: "Edit", exact: true });
  await expect(editAction).toBeDisabled();
  await expect(editAction).toHaveAttribute("title", /cannot update it/);

  await page.getByRole("tab", { name: "Offer" }).click();
  const outcomeAction = page.getByRole("button", { name: "Update offer" });
  await expect(outcomeAction).toBeDisabled();
  await expect(outcomeAction).toHaveAttribute("title", /Viewer access/);
});

test("viewer can inspect workspace sourcing but cannot save applicant counts", async ({ page }) => {
  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&section=sourcing&sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const sourcingForm = page.locator("#sourcing-group-GRP-ENG");
  await expect(sourcingForm).toBeVisible();
  await expect(sourcingForm.getByText("Read-only", { exact: true })).toBeVisible();
  await expect(sourcingForm.getByRole("button", { name: "Save sourcing week for GRP-ENG" })).toHaveCount(0);
  await expect(sourcingForm.locator('input[name="applicants_fb"]')).not.toBeEditable();
});

test("passing Offer hands off to workspace offer creation with proposed accepted date", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/pipeline");
  await expectWorkspaceReady(page);

  const card = page.locator("#pipeline-candidate-C-OFFER-READY");
  await card.getByRole("button", { name: "Candidate actions for Nina Offer Ready" }).click();
  await page.getByRole("menuitem", { name: "Update Offer for Nina Offer Ready" }).click();
  const processDialog = page.getByRole("dialog", { name: "Process Update" });
  await processDialog.getByLabel("Result").selectOption("1");
  const proposedAcceptedDate = await processDialog.getByRole("textbox", { name: "Date", exact: true }).inputValue();
  await processDialog.getByRole("button", { name: "Review changes" }).click();
  await page.getByRole("dialog", { name: "Confirm Save" }).getByRole("button", { name: "Save changes" }).click();

  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_insert_recruitment_log");
  await expect(page.getByRole("dialog", { name: "Offer stage passed" })).toBeVisible();
  await expect(page.getByText(/passed Offer on/)).toBeVisible();
  expect(mock.rpcCalls.some((call) => call.endpoint === "app_upsert_offer")).toBe(false);
  await page.getByRole("dialog", { name: "Offer stage passed" }).getByRole("button", { name: "Create offer" }).click();

  await expect(page).toHaveURL(/\/workspace\?.*section=offer/);
  const offerDialog = page.getByRole("dialog", { name: "Create Offer" });
  await expect(offerDialog).toBeVisible();
  await expect(offerDialog.getByLabel("Candidate")).toHaveValue("C-OFFER-READY");
  await expect(offerDialog.getByLabel("Accepted Date")).toHaveValue(proposedAcceptedDate);
  expect(mock.rpcCalls.some((call) => call.endpoint === "app_upsert_offer")).toBe(false);
  await offerDialog.getByRole("button", { name: "Review changes" }).click();
  expect(mock.rpcCalls.some((call) => call.endpoint === "app_upsert_offer")).toBe(false);
  await page.getByRole("dialog", { name: "Confirm Save" }).getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_upsert_offer");
});

test("workspace has no horizontal overflow at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1");
  await expectWorkspaceReady(page);
  await page.getByRole("tab", { name: "Sourcing" }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
