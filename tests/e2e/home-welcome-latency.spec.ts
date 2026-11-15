import { expect, test } from "@playwright/test";
import { installMockSupabase } from "./support/mock-supabase";

for (const role of ["system_admin", "admin_recruiter", "site_recruiter", "viewer"] as const) {
  test(`Welcome does not wait for calendar completion for ${role}`, async ({ page }) => {
    const mock = await installMockSupabase(page, { role });
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/rest/v1/rpc/app_recruitment_calendar_v1", async route => { await hold; await route.fallback().catch(() => {}); });
    await page.goto("/home?lang=en");
    const welcome = page.getByRole("dialog", { name: "Welcome back" });
    await expect(welcome.getByRole("button", { name: "View pipeline" })).toBeVisible();
    expect(mock.rpcCalls.some(call => call.endpoint === "app_home_welcome_summary_v1")).toBe(true);
    release();
  });

  test(`Welcome reuses a recent authorized summary during refresh for ${role}`, async ({ page }) => {
    await installMockSupabase(page, { role });
    await page.goto("/home?lang=en");
    const welcome = page.getByRole("dialog", { name: "Welcome back" });
    await expect(welcome.getByRole("button", { name: "View pipeline" })).toBeVisible();
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/rest/v1/rpc/app_home_welcome_summary_v1", async route => { await hold; await route.fallback().catch(() => {}); });
    await page.reload();
    await expect(welcome.getByRole("button", { name: "View pipeline" })).toBeVisible();
    release();
  });
}

