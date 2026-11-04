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
  await expect(page.locator("[data-home-requisition-row]").filter({ hasText: "REQ-HQ-1" }).first()).toBeVisible();

  await page.goto("/offers");
  await expectWorkspaceReady(page);
  await expect(page.locator("table").getByText("Analyst (L4)", { exact: true })).toBeVisible();
  await expect(page.locator("table").getByText("REQ-KT2-1", { exact: true })).toBeVisible();

  await page.goto("/pipeline");
  await expectWorkspaceReady(page);
  const candidateCard = page.locator('[data-candidate-id="C-PHONE"]');
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

test("requisition Change mode lets users replace a temporary Doc ID", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  const profileHeading = drawer.getByRole("heading", { name: "Requisition profile" });
  await profileHeading.locator("..").getByRole("button", { name: "Edit requisition", exact: true }).click();

  const formDialog = page.getByRole("dialog", { name: "Edit Requisition" });
  const docId = formDialog.locator('input[name="doc_id"]');
  await expect(docId).toHaveValue("REQ-HQ-1");
  await expect(formDialog.locator('input[name="previous_doc_id"]')).toHaveValue("REQ-HQ-1");
  await formDialog.getByText("Use a temporary ID while approval is pending.").waitFor({ state: "visible" });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await docId.fill("APPROVAL-PENDING-1");
  await formDialog.getByRole("button", { name: "Review changes" }).click();
  const confirmation = page.getByRole("dialog", { name: "Confirm Save" });
  await expect(confirmation).toContainText("APPROVAL-PENDING-1");
});

test("requisition Doc ID edit guidance fits and localizes in Thai", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  await page.goto("/requisitions?lang=th&detailType=requisition&detailId=REQ-HQ-1");
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await expect(drawer).toBeVisible();
  const profileHeading = drawer.getByRole("heading", { name: "ข้อมูลคำขอ" });
  await profileHeading.locator("..").getByRole("button", { name: "แก้ไขคำขอ", exact: true }).click();

  const formDialog = page.getByRole("dialog").filter({ has: page.locator('input[name="doc_id"]') });
  await expect(formDialog.locator('input[name="doc_id"]')).toHaveValue("REQ-HQ-1");
  await expect(formDialog.getByText("ใช้รหัสชั่วคราวระหว่างรออนุมัติ")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("requisition profile Edit pencil is at the heading and role-gated", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  const profileHeading = drawer.getByRole("heading", { name: "Requisition profile" });
  const editRequisition = profileHeading.locator("..").getByRole("button", { name: "Edit requisition", exact: true });
  await expect(editRequisition).toBeVisible();
  const headingBox = await profileHeading.boundingBox();
  const actionBox = await editRequisition.boundingBox();
  expect(actionBox!.x).toBeGreaterThan(headingBox!.x);
  await expect(editRequisition.locator("svg.lucide-pencil")).toHaveCount(1);
  const jobLevel = drawer.locator("dl > div").filter({ has: drawer.getByText("Job Level", { exact: true }) });
  await expect(jobLevel.getByRole("button", { name: "Edit Job Level", exact: true })).toHaveCount(0);

  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const viewerDrawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  const viewerHeading = viewerDrawer.getByRole("heading", { name: "Requisition profile" });
  await expect(viewerHeading.locator("..").getByRole("button", { name: "Edit requisition", exact: true })).toHaveCount(0);
});
test("long requisition titles wrap at 390px without page-level overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter" });
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
  await expect(empty.locator('[data-requisition-detail] > section').first()).toContainText('คำขอนี้ยังไม่ได้เชื่อมกับกลุ่มสรรหา');
  const emptyRelated = empty.locator('details').filter({ has: page.getByRole('heading', { name: 'รายการที่เกี่ยวข้อง', exact: true }) });
  if (await emptyRelated.getAttribute('open') === null) await emptyRelated.locator('summary').click();
  await expect(empty).toContainText('ไม่มีผู้สมัครที่เกี่ยวข้อง');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await empty.evaluate(element => { element.scrollTop = 0; });
  await empty.screenshot({ path: testInfo.outputPath('requisition-thai-long.png') });
});

test("requisition profile edit selector searches and includes all accessible records without page controls", async ({ page }) => {
  const { data, rpcCalls } = await installMockSupabase(page, { role: "admin_recruiter" });
  const seed = data.requisitions[0];
  data.requisitions.push(...Array.from({ length: 105 }, (_, index) => ({ ...seed, doc_id: `REQ-LOAD-${String(index).padStart(3, "0")}`, position: `Load Test ${index}` })), { ...seed, doc_id: "REQ-ZZZ-LATER", position: "Later searchable role" });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await drawer.getByRole("heading", { name: "Requisition profile" }).locator("..").getByRole("button", { name: "Edit requisition", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Edit Requisition" });
  const trigger = form.getByRole("button", { name: "Select requisition", exact: true });
  await expect(trigger).toContainText("REQ-HQ-1");
  await expect.poll(() => rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "requisitions" && call.payload.p_cursor_id).length, { timeout: 15000 }).toBeGreaterThan(0);
  await trigger.click();
  await expect(form.getByRole("combobox", { name: "Search requisitions", exact: true })).toBeVisible();
  await expect(form.getByRole("button", { name: /Next|Previous/ })).toHaveCount(0);
  const search = form.getByRole("combobox", { name: "Search requisitions", exact: true });
  await search.fill("REQ-ZZZ-LATER");
  await expect(page.getByRole("option", { name: "REQ-ZZZ-LATER", exact: true })).toBeVisible();
  expect(rpcCalls.some(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "requisitions" && call.payload.p_search === "REQ-ZZZ-LATER")).toBe(true);
});

test("requisition edit pre-fills all editable fields and preserves legacy department/section values", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "admin_recruiter" });
  const requisition = data.requisitions.find(row => row.doc_id === "REQ-HQ-1")!;
  Object.assign(requisition, { request_type: "Replacement", replacement_names: "Alex Doe\nJamie Lee", department: "Legacy Department", section: "Legacy Section", head_count: 2 });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  await drawer.getByRole("heading", { name: "Requisition profile" }).locator("..").getByRole("button", { name: "Edit requisition", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Edit Requisition" });
  await expect(form.locator('[name="doc_id"]')).toHaveValue("REQ-HQ-1");
  await expect(form.locator('[name="pr_approved_date"]')).toHaveValue("2026-06-01");
  await expect(form.locator('[name="request_type"]')).toHaveValue("Replacement");
  await expect(form.locator('[name="site"]')).toHaveValue("HQ");
  await expect(form.locator('[name="department"]')).toHaveValue("Legacy Department");
  await expect(form.locator('[name="section"]')).toHaveValue("Legacy Section");
  await expect(form.locator('[name="position"]')).toHaveValue("Engineer");
  await expect(form.locator('[name="level"]')).toHaveValue("L4");
  await expect(form.locator('[name="head_count"]')).toHaveValue("2");
  await expect(form.locator('[name="person_in_charge"]')).toHaveValue("Alice");
  await expect(form.locator('[name="line_manager"]')).toHaveValue("QA Manager");
  await expect(form.locator('[name="status"]')).toHaveValue("ongoing");
  await expect(form.locator('[name="replacement_names"]').nth(0)).toHaveValue("Alex Doe");
  await expect(form.locator('[name="replacement_names"]').nth(1)).toHaveValue("Jamie Lee");
  const picker = form.getByRole("button", { name: "Select requisition", exact: true });
  await picker.click();
  const search = form.getByRole("combobox", { name: "Search requisitions", exact: true });
  await search.fill("REQ-HQ-2");
  await page.getByRole("option", { name: "REQ-HQ-2", exact: true }).click();
  await expect(form.locator('[name="doc_id"]')).toHaveValue("REQ-HQ-2");
  await expect(form.locator('[name="pr_approved_date"]')).toHaveValue("2026-06-10");
  await expect(form.locator('[name="head_count"]')).toHaveValue("1");
  await expect(form.locator('[name="replacement_names"]')).toHaveCount(0);
});

test("all non-empty requisition profile values have copy actions for their displayed text", async ({ page }) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");
  await expectWorkspaceReady(page);
  const drawer = page.getByRole("dialog", { name: "Engineer (L4)" });
  const profile = drawer.locator("section").filter({ has: page.getByRole("heading", { name: "Requisition profile" }) });
  const rows = profile.locator("dl > div");
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const displayed = (await row.locator("dd").innerText()).trim();
    const copy = row.getByRole("button", { name: /^Copy / });
    if (!displayed || displayed === "—") { await expect(copy).toHaveCount(0); continue; }
    await expect(copy).toHaveCount(1);
    await copy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(displayed);
  }
});
