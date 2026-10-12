import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

for (const language of ["en", "th"] as const) {
  test(`sourcing descriptions show the selected reporting period in ${language}`, async ({ page }) => {
    await installMockSupabase(page, { role: "admin_recruiter", language, now: new Date("2026-10-12T05:00:00.000Z") });
    for (const [date, period] of [["2026-10-03", "26/09/2026–02/10/2026"], ["2026-10-10", "03/10/2026–09/10/2026"]]) {
      await page.goto(`/sourcing?sourcingWeek=${date}`);
      await expectWorkspaceReady(page);
      await expect(page.getByText(language === "en" ? /^Selected reporting date:/ : /^วันที่รายงานที่เลือก:/)).toContainText(period);
      const group = page.getByRole("article").filter({ hasText: "GRP-ENG" });
      await group.getByRole("button", { name: language === "en" ? "Record applicants" : "บันทึกผู้สมัคร", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText(period);
      await expect(page.getByRole("dialog")).not.toContainText("Week of");
    }
  });
}

for (const existing of [false, true]) {
  test(`sourcing ${existing ? "correction" : "creation"} sends the selected Saturday reporting date`, async ({ page }) => {
    const mock = await installMockSupabase(page, { role: "admin_recruiter", now: new Date("2026-10-12T05:00:00.000Z") });
    if (existing) {
      const update = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG");
      if (!update) throw new Error("Missing sourcing fixture");
      update.week_start = "2026-10-10";
    }
    const savedTimestamp = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-10-10")?.updated_at;
    await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-10-10");
    await expectWorkspaceReady(page);
    const editor = page.getByTestId("workspace-sourcing-layout");
    await editor.locator('input[name="applicants_fb"]').fill("9");
    await editor.getByRole("button", { name: "Save record" }).click();
    const confirmation = page.getByRole("dialog", { name: "Confirm Save" });
    await expect(confirmation.locator("pre")).toContainText('"week_start": "2026-10-10"');
    await confirmation.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_upsert_sourcing_weekly_update");
    const payload = mock.rpcCalls.at(-1)?.payload;
    expect(payload).toMatchObject({ group_id: "GRP-ENG", week_start: "2026-10-10", applicants_fb: "9" });
    expect(payload?.expected_updated_at).toBe(savedTimestamp);
    expect(mock.data.sourcing_weekly_updates.filter((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-10-10")).toHaveLength(1);
    expect(mock.data.sourcing_weekly_updates.some((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-10-12")).toBe(false);
  });
}

test("sourcing channel changes send the selected Saturday effective date", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter", now: new Date("2026-10-12T05:00:00.000Z") });
  await page.goto("/workspace?type=group&id=GRP-ENG&section=sourcing&sourcingWeek=2026-10-10");
  await expectWorkspaceReady(page);
  await page.getByTestId("workspace-sourcing-update-header").getByRole("button", { name: "Details" }).click();
  await page.getByRole("dialog", { name: "Group details · GRP-ENG" }).getByRole("switch", { name: "Toggle Facebook" }).click();
  const confirmation = page.getByRole("dialog", { name: "Confirm Save" });
  await expect(confirmation.locator("pre")).toContainText('"effective_week": "2026-10-10"');
  await confirmation.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => mock.rpcCalls.at(-1)?.endpoint).toBe("app_set_sourcing_group_channel_v1");
  expect(mock.rpcCalls.at(-1)?.payload).toMatchObject({ group_id: "GRP-ENG", effective_week: "2026-10-10" });
});
