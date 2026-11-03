import { expect, test } from "@playwright/test";
import { installMockSupabase, expectWorkspaceReady } from "./support/mock-supabase";

for (const width of [1440, 390]) {
  test(`Home core remains usable while optional sections wait at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const mock = await installMockSupabase(page, { role: "admin_recruiter" });
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/rest/v1/rpc/app_home_work_queue_v1", async route => { await blocked; await route.fallback(); });
    await page.goto("/home?lang=en");
    await expectWorkspaceReady(page);
    await expect(page.getByRole("tab", { name: /Open headcount/i })).toBeVisible();
    await expect.poll(() => mock.rpcCalls.filter(call => call.endpoint === "app_home_core_summary_v1").length).toBeGreaterThan(0);
    expect(mock.rpcCalls.filter(call => call.endpoint === "app_home_summary_v1")).toHaveLength(0);
    expect(mock.rpcCalls.filter(call => call.endpoint === "app_home_quality_page_v1")).toHaveLength(0);
    const welcome = page.getByRole("dialog", { name: /Welcome back/i });
    await expect(welcome).toBeVisible();
    await welcome.getByRole("button", { name: "Close" }).last().click();
    await expect(page.getByRole("tabpanel")).toContainText("REQ-HQ-1");
    await page.screenshot({ path: `outputs/home-loading-implementation/home-${width}.png`, fullPage: true });
    release();
    await page.getByRole("tab", { name: /Candidate Pipeline/ }).click();
    await expect(page.locator("[data-home-candidate-row]").first()).toBeVisible();
    await page.getByRole("tab", { name: /Data Quality/ }).click();
    await expect.poll(() => mock.rpcCalls.filter(call => call.endpoint === "app_home_quality_page_v1").length).toBeGreaterThan(0);
    await expect(page.locator('[role="tab"][aria-selected="true"]')).not.toContainText("—");
    await expect(welcome).toBeHidden();
    expect(mock.rpcCalls.filter(call => call.endpoint === "app_home_welcome_summary_v1")).toHaveLength(0);
  });
}

test("core failure settles independently and can be retried", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  let failed = false;
  await page.route("**/rest/v1/rpc/app_home_core_summary_v1", async route => {
    if (!failed) { failed = true; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Synthetic core failure" }) }); }
    else await route.fallback();
  });
  await page.goto("/home?lang=en");
  await expectWorkspaceReady(page);
  const welcome = page.getByRole("dialog", { name: /Welcome back/i });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Close" }).last().click();
  await expect.poll(() => mock.rpcCalls.filter(call => call.endpoint === "app_home_work_queue_v1").length).toBeGreaterThan(0);
  const alert = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Retry" }) }).first();
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(alert).toBeHidden();
});

test("dismissed Welcome is not fetched and header filters do not refetch Welcome", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home?lang=en");
  const welcome = page.getByRole("dialog", { name: /Welcome back/i });
  await expect(welcome).toBeVisible();
  await expect.poll(() => mock.rpcCalls.filter(call => call.endpoint === "app_home_welcome_summary_v1").length).toBe(1);
  await welcome.getByRole("button", { name: "Close" }).last().click();
  await page.reload();
  await expectWorkspaceReady(page);
  await expect.poll(() => mock.rpcCalls.filter(call => call.endpoint === "app_home_work_queue_v1").length).toBeGreaterThan(1);
  expect(mock.rpcCalls.filter(call => call.endpoint === "app_home_welcome_summary_v1")).toHaveLength(1);
});


test("quality scope changes reset its cursor and badge without showing the old scope", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  const requests: Array<Record<string, any>> = [];
  await page.route("**/rest/v1/rpc/app_home_quality_page_v1", async route => {
    const body = route.request().postDataJSON(); requests.push(body);
    const filtered = body.p_scope.headerSite === "KT1";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      items: filtered ? [] : [{ id: "quality-1", cursorId: "quality-1", severity: "warning", entity: "candidate", entityId: "CAN-TEST", title: "Synthetic issue", detail: "Synthetic quality detail" }],
      totalCount: filtered ? 0 : 26, hasMore: !filtered && !body.p_after_id,
      nextCursor: !filtered && !body.p_after_id ? { severity: 1, title: "Synthetic issue", id: "quality-1" } : null
    }) });
  });
  await page.goto("/home?lang=en");
  const welcome = page.getByRole("dialog", { name: /Welcome back/i });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Close" }).last().click();
  await page.getByRole("tab", { name: "Data Quality" }).click();
  await expect(page.getByRole("tab", { name: "Data Quality" })).toContainText("26");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => requests.some(body => body.p_after_id === "quality-1")).toBe(true);
  await page.getByLabel("Site", { exact: true }).click();
  await page.getByRole("listbox", { name: "Site" }).getByRole("option", { name: "KT1", exact: true }).click();
  await expect.poll(() => requests.some(body => body.p_scope.headerSite === "KT1")).toBe(true);
  const filtered = requests.filter(body => body.p_scope.headerSite === "KT1");
  expect(filtered.every(body => body.p_after_id === null)).toBe(true);
  await expect(page.getByRole("tab", { name: "Data Quality" })).toContainText("0");
  await expect(page.getByText("Synthetic quality detail", { exact: true })).toHaveCount(0);
});
