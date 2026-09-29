import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

for (const language of ["en", "th"] as const) {
  for (const width of [1440, 390]) {
    test(`sourcing link readiness reflects group links without candidates (${language}, ${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const mock = await installMockSupabase(page, { language, role: "admin_recruiter" });
      mock.data.candidates = [];
      const linked = language === "en" ? "Linked" : "เชื่อมแล้ว";
      const notLinked = language === "en" ? "Not linked" : "ยังไม่เชื่อม";
      const label = language === "en" ? "Sourcing link readiness" : "ความพร้อมการเชื่อมกลุ่มสรรหา";

      await page.goto(`/requisitions?lang=${language}`);
      await expect(page.getByRole("button", { name: language === "en" ? "Refresh" : "รีเฟรช", exact: true })).toBeVisible();
      const records = width < 768 ? page.locator("article") : page.locator("tbody tr");
      await expect(records.filter({ hasText: "REQ-HQ-1" }).getByText(linked, { exact: true })).toBeVisible();
      await expect(records.filter({ hasText: "REQ-UNMATCHED-1" }).getByText(notLinked, { exact: true })).toBeVisible();
      await expect((width < 768 ? records.filter({ hasText: "REQ-HQ-1" }) : page.locator("thead")).getByText(label, { exact: true })).toBeVisible();

      await page.goto(`/home?lang=${language}`);
      await expect(page.getByRole("button", { name: language === "en" ? "Refresh" : "รีเฟรช", exact: true })).toBeVisible();
      await expect(page.locator("[data-home-requisition-row]").filter({ hasText: "REQ-HQ-1" }).getByText(linked, { exact: true })).toBeVisible();
      await expect(page.locator("[data-home-requisition-row]").filter({ hasText: "REQ-UNMATCHED-1" }).getByText(notLinked, { exact: true })).toBeVisible();

      await page.goto(`/requisitions?lang=${language}&detailType=requisition&detailId=REQ-HQ-1`);
      const drawer = page.getByRole("dialog");
      await expect(drawer.getByText(linked, { exact: true })).toBeVisible();
      await expect(drawer).toContainText("GRP-ENG");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Closing/filling a requisition must not manufacture a sourcing link.
      mock.data.requisitions.find((row) => row.doc_id === "REQ-UNMATCHED-1")!.status = "filled";
      await page.goto(`/requisitions?lang=${language}&detailType=requisition&detailId=REQ-UNMATCHED-1`);
      await expect(page.getByRole("dialog").getByText(notLinked, { exact: true })).toBeVisible();
    });
  }
}

test("matching and unmatching refresh sourcing link readiness", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  await page.getByRole("article").filter({ hasText: "GRP-ENG" }).getByRole("button", { name: "Details" }).click();
  let dialog = page.getByRole("dialog", { name: "Group details · GRP-ENG" });
  await dialog.getByLabel("Select requisition to add").selectOption("REQ-UNMATCHED-1");
  await dialog.getByRole("button", { name: "Add Match", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm Save" }).getByRole("button", { name: "Save Changes" }).click();
  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_create_group_match");

  await page.goto("/requisitions?detailType=requisition&detailId=REQ-UNMATCHED-1");
  await expect(page.getByRole("dialog").getByText("Linked", { exact: true })).toBeVisible();

  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  await page.getByRole("article").filter({ hasText: "GRP-ENG" }).getByRole("button", { name: "Details" }).click();
  dialog = page.getByRole("dialog", { name: "Group details · GRP-ENG" });
  await dialog.getByRole("button", { name: "Unmatch REQ-UNMATCHED-1", exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm destructive action" }).getByRole("button", { name: "Delete / Unmatch" }).click();
  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_unmatch_group_requisition");

  await page.goto("/requisitions?detailType=requisition&detailId=REQ-UNMATCHED-1");
  await expect(page.getByRole("dialog").getByText("Not linked", { exact: true })).toBeVisible();
});
