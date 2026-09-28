import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("requisition identity is consistent across records, Home, offers, and Pipeline boundaries", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });

  await page.goto("/requisitions");
  await expectWorkspaceReady(page);
  await expect(page.locator("table").getByText("Engineer (L4)", { exact: true }).first()).toBeVisible();
  await expect(page.locator("table").getByText("REQ-HQ-1", { exact: true })).toBeVisible();

  await page.goto("/home");
  await expectWorkspaceReady(page);
  await expect(page.getByText("Engineer (L4)", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Requisition ID: REQ-HQ-1", { exact: true }).first()).toBeVisible();

  await page.goto("/offers");
  await expectWorkspaceReady(page);
  await expect(page.locator("table").getByText("Analyst (L4)", { exact: true })).toBeVisible();
  await expect(page.locator("table").getByText("REQ-KT2-1", { exact: true })).toBeVisible();

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  const candidateCard = page.locator("#pipeline-candidate-C-PHONE");
  await expect(candidateCard).toContainText("Pat Phone");
  await expect(candidateCard).toContainText("HQ · Engineer (Alice)");
  await expect(candidateCard).not.toContainText("REQ-HQ-1");
});

test("requisition detail localizes its ID label while keeping the formatted heading", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions?lang=th&detailType=requisition&detailId=REQ-HQ-1");

  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("รหัสคำขอ");
  await expect(drawer).toContainText("REQ-HQ-1");
  await expect(drawer.getByRole("heading", { name: "ข้อมูลคำขอ" })).toBeVisible();
  await expect(drawer.locator('[data-tag-appearance="soft"]')).toHaveCount(2);
});

test("Requisition Detail uses the candidate workspace hierarchy and retains role-gated actions", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await expect(drawer).toContainText("Engineer (L4) / REQ-HQ-1");
  await expect(drawer.getByRole("heading", { name: "Requisition overview" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "Requisition profile" })).toBeVisible();
  await expect(drawer.getByText("Open HC", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText("REQ-HQ-1", { exact: true }).last()).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Change record" })).toBeVisible();
  const close = drawer.getByRole("button", { name: "Close" });
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);

  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const viewerDrawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await expect(viewerDrawer.getByRole("heading", { name: "Requisition profile" })).toBeVisible();
  await expect(viewerDrawer.getByRole("button", { name: "Change record" })).toHaveCount(0);
});

test("long requisition titles wrap at 390px without page-level overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace");
  await expectWorkspaceReady(page);

  await page.getByLabel("Search workspaces").fill("REQ-UNMATCHED-1");
  await expect(page.getByRole("button", { name: /Senior Procurement Operations and Supplier Development Specialist — REQ-UNMATCHED-1/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto("/requisitions?detailType=requisition&detailId=REQ-UNMATCHED-1");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("dialog", { name: "Senior Procurement Operations and Supplier Development Specialist" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("complete requisition profile, related links and sorted history fit desktop and phone drawers", async ({ page }, testInfo) => {
  const { data } = await installMockSupabase(page, { role: "admin_recruiter" });
  data.requisition_logs.push(
    { log_id: 8001, doc_id: "REQ-HQ-1", log_date: "2026-06-02", status: "ongoing", remark: "Earlier update", created_at: "2026-06-02T00:00:00Z" },
    { log_id: 8002, doc_id: "REQ-HQ-1", log_date: "2026-06-03", status: "ongoing", remark: "Latest update", created_at: "2026-06-03T00:00:00Z" }
  );
  await page.goto("/requisitions?site=HQ&detailType=requisition&detailId=REQ-HQ-1");
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await expect(drawer.getByText("Actual Age", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Current SLA", { exact: true })).toBeVisible();
  for (const label of ["Section", "Request Type", "Replacement names", "Line manager", "Created At", "Updated At"]) {
    await expect(drawer.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(drawer.locator('svg.lucide-hash')).toHaveCount(1);
  const related = drawer.locator('details').filter({ has: page.getByRole('heading', { name: 'Related records', exact: true }) });
  await related.locator('summary').click();
  const links = related.locator('a');
  expect(await links.count()).toBeGreaterThan(0);
  for (const link of await links.all()) {
    const url = new URL((await link.getAttribute('href'))!, 'http://localhost');
    expect(url.searchParams.get('site')).toBe('HQ');
    expect(url.pathname).toMatch(/^\/(candidates|offers)$/);
  }
  const history = drawer.locator('details').filter({ has: page.getByRole('heading', { name: 'History', exact: true }) });
  await history.locator('summary').click();
  await expect(history.locator('p').filter({ hasText: /Latest update|Earlier update/ })).toHaveText(['Latest update', 'Earlier update']);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await drawer.evaluate(element => { element.scrollTop = 0; });
    await drawer.screenshot({ path: testInfo.outputPath(`requisition-${width}.png`) });
  }
  await page.goto('/requisitions?lang=th&detailType=requisition&detailId=REQ-UNMATCHED-1');
  const empty = page.getByRole('dialog', { name: 'Senior Procurement Operations and Supplier Development Specialist' });
  await expect(empty).toBeVisible();
  await expect(empty.locator('[data-requisition-detail] > section').first()).toContainText('ยังไม่มีผู้สมัครที่เชื่อมโยงกับคำขอนี้');
  const emptyRelated = empty.locator('details').filter({ has: page.getByRole('heading', { name: 'รายการที่เกี่ยวข้อง', exact: true }) });
  if (await emptyRelated.getAttribute('open') === null) await emptyRelated.locator('summary').click();
  await expect(empty).toContainText('ไม่มีผู้สมัครที่เกี่ยวข้อง');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await empty.evaluate(element => { element.scrollTop = 0; });
  await empty.screenshot({ path: testInfo.outputPath('requisition-thai-long.png') });
});
