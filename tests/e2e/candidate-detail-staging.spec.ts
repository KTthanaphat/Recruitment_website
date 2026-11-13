import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("shows the verified profile and choices while application metadata is pending", async ({ page }) => {
  await installMockSupabase(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  await page.route("**/rest/v1/candidate_applications?**", async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("application_id")) {
      began();
      await gate;
    }
    await route.fallback();
  });
  try {
    await page.goto("/candidates?detailType=candidate&detailId=C-HR");
    await expectWorkspaceReady(page);
    await started;
    await expect(page.getByRole("region", { name: "Candidate profile", exact: true })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Candidate applications" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Profile note", exact: true })).toContainText("Loading profile note");
  } finally { release(); }
  await expect(page.getByRole("button", { name: "Edit profile", exact: true })).toBeVisible();
});
