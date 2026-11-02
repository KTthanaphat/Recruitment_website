import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

for (const hasCheck of [false, true]) {
  test(`candidate detail loads reference checks with the real primary key (${hasCheck ? "saved" : "empty"})`, async ({ page }) => {
    const mock = await installMockSupabase(page, { role: "admin_recruiter" });
    const application = mock.data.candidate_applications!.find(row => row.candidate_id === "C-REF")!;
    const reference = mock.data.candidate_references.find(row => row.candidate_id === "C-REF")!;
    if (hasCheck) mock.data.candidate_reference_checks.push({
      check_id: "20000000-0000-4000-8000-000000000001", reference_id: reference.reference_id, application_id: application.application_id,
      checked_date: "2026-07-20", duration_minutes: 15, conversation_summary: "Verified reference conversation", checked_by: null,
      created_at: "2026-07-20T00:00:00Z", updated_at: "2026-07-20T00:00:00Z"
    });
    const reads: Array<{ order: string | null; application: string | null }> = [];
    await page.route("**/rest/v1/candidate_reference_checks?**", async route => {
      const url = new URL(route.request().url());
      reads.push({ order: url.searchParams.get("order"), application: url.searchParams.get("application_id") });
      if (url.searchParams.get("order") !== "check_id.asc") return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "column candidate_reference_checks.reference_check_id does not exist" }) });
      return route.fallback();
    });
    await page.goto(`/candidates?lang=en&detailType=candidate&detailId=C-REF&applicationId=${application.application_id}`);
    await expectWorkspaceReady(page);
    const detail = page.getByRole("dialog");
    await expect(detail).toContainText("Rae Reference");
    await expect(detail.getByRole("heading", { name: "Contact references", exact: true })).toBeVisible();
    await expect(detail).toContainText("Mina Manager");
    if (hasCheck) await expect(detail).toContainText("Verified reference conversation");
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every(read => read.order === "check_id.asc" && read.application === `eq.${application.application_id}`)).toBe(true);
    await expect(detail).not.toContainText("does not exist");
  });
}
