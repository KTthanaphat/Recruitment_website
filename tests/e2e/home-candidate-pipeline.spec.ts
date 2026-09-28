import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("Home sourcing and quality use the requested Thai copy", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const recorded = mock.data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06");
  if (!recorded) throw new Error("Missing recorded sourcing fixture");
  recorded.week_start = "2026-07-04";
  await page.goto("/home?lang=th&sourcingWeek=2026-07-06");
  await expect(page.getByRole("tab").first()).toBeVisible();
  const welcome = page.getByRole("dialog", { name: "ยินดีต้อนรับกลับ" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "ปิด" }).click();
  await page.getByRole("tab").nth(2).click();
  await expect(page.getByRole("tabpanel")).toContainText("ต้องอัปเดตข้อมูล");
  await expect(page.getByRole("tabpanel")).toContainText("บันทึกข้อมูลแล้ว");
  await page.getByRole("tab").nth(3).click();
  const quality = page.getByRole("tabpanel").locator("[data-home-quality-row]").first();
  await expect(quality).toBeVisible();
  await expect(quality.locator("div").nth(1)).toContainText(/[\u0E00-\u0E7F]/);
  await expect(quality.locator("div").nth(3)).toContainText(/[\u0E00-\u0E7F]/);
});

test("New Hire Confirmation keeps a compact labeled phone action", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcome = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcome.isVisible()) await welcome.getByRole("button", { name: "Close" }).last().click();
  await page.getByRole("tab", { name: "New Hire Confirmation" }).click();
  const confirm = page.getByRole("tabpanel").getByRole("button", { name: "Confirm start" });
  await expect(confirm).toBeVisible();
  expect((await confirm.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await confirm.click();
  await expect(page.getByRole("dialog", { name: "New Hire Confirmation" })).toBeVisible();
});

test("Candidate Pipeline count, sorting, and six-column layout work across widths and languages", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const lineOutcome = mock.data.recruitment_logs.find((log) => log.candidate_id === "C-LINE" && log.result === 1);
  if (!lineOutcome) throw new Error("Expected line interview history fixture.");
  lineOutcome.outcome_date = "2026-07-23";
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcome = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcome.isVisible()) await welcome.getByRole("button", { name: "Close" }).last().click();
  await page.getByRole("tab", { name: "Candidate Pipeline" }).click();
  const panel = page.getByRole("tabpanel");
  const rows = panel.locator("[data-home-candidate-row]");
  const count = await rows.count();
  await expect(panel.locator("[data-home-candidate-count]")).toHaveText(`${count} active candidates`);
  const header = panel.locator("[data-home-record-header]");
  for (const label of ["Candidate", "Stage", "Site / owner", "Last Touch", "Pending remark", "Progress"]) await expect(header).toContainText(label);
  const sort = panel.getByLabel("Sort candidate pipeline");
  await expect(sort).toHaveValue("oldest_touch");
  await expect(rows.first()).toContainText("Avery Aging");
  const idsInOrder = () => rows.evaluateAll((items) => items.map((item) => item.getAttribute("data-candidate-id")));
  let orderedIds = await idsInOrder();
  expect(orderedIds.indexOf("C-HR")).toBeLessThan(orderedIds.indexOf("C-PHONE"));
  await sort.selectOption("newest_touch");
  await expect(rows.first()).toContainText("Liam Line");
  orderedIds = await idsInOrder();
  expect(orderedIds.indexOf("C-HR")).toBeLessThan(orderedIds.indexOf("C-PHONE"));
  await sort.selectOption("name");
  await expect(rows.first()).toContainText("Avery Aging");
  await expect(rows.first()).not.toContainText("current");
  await sort.selectOption("progression");
  await expect(sort).toHaveValue("progression");
  const progressIcons = rows.first().locator("[data-stage-icon]");
  await expect(progressIcons.first()).toBeVisible();
  await expect(progressIcons.first()).not.toHaveClass(/rounded-full|bg-primary|ring-2/);
  await expect(rows.first().locator("[data-stage-connector]")).toHaveCount(0);
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const viewport = panel.locator("[data-home-candidate-scroll]");
    const rowList = panel.locator("[data-home-record-list]");
    if (width >= 768) {
      await expect(header).toBeVisible();
      await expect(header).toHaveCSS("position", "sticky");
      expect(await viewport.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
      expect(await rowList.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
      if (width <= 1024) expect(await viewport.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      if (width === 768) {
        await viewport.evaluate((element) => { element.scrollLeft = 120; });
        expect(await viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        await expect(header).toBeVisible();
      }
    } else {
      await expect(header).toBeHidden();
      expect(await viewport.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
      expect((await rows.first().getByRole("button", { name: /Open candidate:/ }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  }
  await page.goto("/home?lang=th");
  await expect(page.getByRole("button", { name: "รีเฟรช" })).toBeVisible();
  const thaiWelcome = page.getByRole("dialog", { name: /Welcome back|ยินดีต้อนรับ/ });
  if (await thaiWelcome.isVisible()) await thaiWelcome.getByRole("button", { name: /Close|ปิด/ }).last().click();
  await page.getByRole("tab", { name: /Pipeline ผู้สมัคร/ }).click();
  await expect(page.getByRole("tabpanel").locator("[data-home-candidate-count]")).toContainText("ผู้สมัครที่กำลังดำเนินการ");
  await expect(page.getByRole("tabpanel").locator("[data-home-record-header]")).toContainText("หมายเหตุที่รอดำเนินการ");
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("Candidate Pipeline scrolls a crowded desktop table on one viewport", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const seed = mock.data.candidates.find((candidate) => candidate.candidate_id === "C-LINE");
  const seedLogs = mock.data.recruitment_logs.filter((log) => log.candidate_id === "C-LINE");
  if (!seed || seedLogs.length === 0) throw new Error("Missing Candidate Pipeline fixtures");
  for (let index = 0; index < 20; index += 1) {
    const candidateId = `C-MORE-${index}`;
    mock.data.candidates.push({ ...seed, candidate_id: candidateId, name: `More Candidate ${index}`, phone_no: `089${String(index).padStart(7, "0")}` });
    seedLogs.forEach((log, logIndex) => mock.data.recruitment_logs.push({ ...log, candidate_id: candidateId, log_id: 1000 + index * 10 + logIndex, stage_instance_id: `00000000-0000-4000-8000-${String(1000 + index * 10 + logIndex).padStart(12, "0")}` }));
  }
  await page.setViewportSize({ width: 768, height: 800 });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcome = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcome.isVisible()) await welcome.getByRole("button", { name: "Close" }).last().click();
  await page.getByRole("tab", { name: "Candidate Pipeline" }).click();
  const panel = page.getByRole("tabpanel");
  const viewport = panel.locator("[data-home-candidate-scroll]");
  const rows = panel.locator("[data-home-record-list]");
  expect(await viewport.evaluate((element) => element.scrollHeight > element.clientHeight && element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await rows.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
  await viewport.evaluate((element) => { element.scrollTop = 160; element.scrollLeft = 120; });
  expect(await viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(panel.locator("[data-home-record-header]")).toBeVisible();
});

test("Candidate Pipeline shows recorded touch, fallback, and current pending remark", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const phone = mock.data.recruitment_logs.find((log) => log.candidate_id === "C-PHONE" && log.result === null);
  const lineOutcome = mock.data.recruitment_logs.find((log) => log.candidate_id === "C-LINE" && log.result === 1);
  const testCandidate = mock.data.candidates.find((candidate) => candidate.candidate_id === "C-TEST");
  const testPending = mock.data.recruitment_logs.find((log) => log.candidate_id === "C-TEST" && log.result === null);
  const hrCandidate = mock.data.candidates.find((candidate) => candidate.candidate_id === "C-HR");
  if (!phone || !lineOutcome || !testCandidate || !testPending || !hrCandidate) throw new Error("Expected pipeline fixtures.");
  phone.remark = "A long pending note about contacting the candidate after the next interview appointment";
  phone.estimated_action_date = "2026-08-20";
  lineOutcome.outcome_date = "2026-07-23";
  mock.data.recruitment_logs = mock.data.recruitment_logs.filter((log) => log.candidate_id !== "C-TEST" || log.result === null);
  testPending.log_date = "2026-08-01";
  testCandidate.first_contact_date = "2026-06-23";
  mock.data.recruitment_logs = mock.data.recruitment_logs.filter((log) => log.candidate_id !== "C-HR" || log.result === null);
  const hrPending = mock.data.recruitment_logs.find((log) => log.candidate_id === "C-HR");
  if (!hrPending) throw new Error("Expected HR pending fixture.");
  hrPending.log_date = "2026-08-01";
  hrCandidate.first_contact_date = null;
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcome = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcome.isVisible()) await welcome.getByRole("button", { name: "Close" }).last().click();
  await page.getByRole("tab", { name: "Candidate Pipeline" }).click();
  const panel = page.getByRole("tabpanel");
  const row = (id: string) => panel.locator(`[data-home-candidate-row][data-candidate-id="${id}"]`);
  await expect(row("C-PHONE")).toContainText("09/07/2026");
  await expect(row("C-LINE")).toContainText("23/07/2026");
  await expect(row("C-LINE")).toContainText("1d ago");
  await expect(row("C-TEST")).toContainText("23/06/2026");
  await expect(row("C-HR")).toContainText("—");
  await panel.getByLabel("Sort candidate pipeline").selectOption("newest_touch");
  await expect(panel.locator("[data-home-candidate-row]").last()).toHaveAttribute("data-candidate-id", "C-HR");
  await panel.getByLabel("Sort candidate pipeline").selectOption("oldest_touch");
  await expect(panel.locator("[data-home-candidate-row]").last()).toHaveAttribute("data-candidate-id", "C-HR");
  const remark = row("C-PHONE").getByText(phone.remark, { exact: true });
  await expect(remark).toHaveAttribute("title", phone.remark);
  await expect(remark).toHaveCSS("text-overflow", "ellipsis");
  await remark.focus();
  await expect(remark).toBeFocused();
  await expect(remark).toHaveAttribute("aria-label", phone.remark);
  await expect(row("C-PHONE-PASS")).toContainText("—");
  await expect(row("C-PHONE-PASS")).not.toContainText("QA Phone Screen");
});

test("Candidate Pipeline keeps its count, sort, and empty state when no candidate is active", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  mock.data.recruitment_logs = [];
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcome = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcome.isVisible()) await welcome.getByRole("button", { name: "Close" }).last().click();
  await page.getByRole("tab", { name: "Candidate Pipeline" }).click();
  const panel = page.getByRole("tabpanel");
  await expect(panel.locator("[data-home-candidate-count]")).toHaveText("0 active candidates");
  await expect(panel.getByText("No active candidates in pipeline.")).toBeVisible();
  await panel.getByLabel("Sort candidate pipeline").selectOption("name");
  await expect(panel.locator("[data-home-candidate-row]")).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
