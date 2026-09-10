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
  await expect(page.locator("#pipeline-candidate-C-FAILED")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Passed Offer - Last 7 Days" })).toBeVisible();
  await expect(page.locator("#pipeline-candidate-C-OFFER-PASS")).toHaveCount(0);
  await expect(page.locator("#pipeline-candidate-C-OFFER-NO-OFFER")).toBeVisible();
  await page.goto("/workspace?type=requisition&id=REQ-HQ-1&section=pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Failed Candidates - All Time" })).toBeVisible();
  await expect(page.locator("#pipeline-candidate-C-FAILED")).toBeVisible();
  await page.goto("/workspace?type=requisition&id=REQ-KT1-1&section=pipeline");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Passed Offer - All Time" })).toBeVisible();
  await expect(page.locator("#pipeline-candidate-C-OFFER-PASS")).toBeVisible();
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
