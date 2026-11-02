import { test, expect, type Page } from "@playwright/test";
import { Workbook } from "exceljs";
import fs from "node:fs";
import { emptyDashboardData, enrichRequisitions } from "../../src/lib/data";
import { layoutReasonTreemap } from "../../src/lib/rejection-treemap";
import { buildRejectionReport, EMPTY_REJECTION_FILTERS } from "../../src/lib/rejection-report";
import { buildRejectionExport } from "../../src/lib/rejection-export";
import { createDashboardWorkbook } from "../../src/lib/dashboard-workbook";
import { dashboardDefaults, dashboardUrlValues, restoreDashboardPreferences } from "../../src/lib/dashboard-filters";
import type { DashboardData, RecruitmentLog, Candidate, Requisition, ApplicationAssignment } from "../../src/types/recruitment";
import type { DashboardReportContext } from "../../src/components/dashboard/DashboardPortal";
import { installMockSupabase, expectWorkspaceReady } from "./support/mock-supabase";

const range = { start: "2026-07-01", end: "2026-07-31" };
function fixture(): DashboardData {
  const base = { ...emptyDashboardData };
  const req = { doc_id: "R1", site: "HQ", department: "HR", position: "Recruiter", person_in_charge: "Alice", level: "4", head_count: 2, status: "ongoing", pr_approved_date: "2026-06-01", request_type: "New", created_at: "2026-06-01", updated_at: "2026-07-01" } as Requisition;
  return { ...base, requisitions: [req, { ...req, doc_id: "R2" }, { ...req, doc_id: "R3", site: "KT1" }], candidates: [{ candidate_id: "C1", name: "Applicant One", group_id: "NEW" } as Candidate],
    document_groups: ["R1", "R2", "R3"].map((id, i) => ({ doc_group_id: `D${i}`, doc_id: id, group_id: i === 2 ? "NEW" : "OLD", group_position: "Recruiter", created_at: "2026-06-01", updated_at: "2026-07-01" })),
    candidate_applications: [{ application_id: "A1", candidate_id: "C1", group_id: "NEW", state: "active" } as NonNullable<DashboardData["candidate_applications"]>[number]],
    candidate_application_assignments: [{ assignment_id: "OLD1", application_id: "A1", group_id: "OLD" }, { assignment_id: "NEW1", application_id: "A1", group_id: "NEW" }] as ApplicationAssignment[] };
}
function failure(id: number, patch: Partial<RecruitmentLog> = {}): RecruitmentLog {
  return { log_id: id, candidate_id: "C1", application_id: "A1", outcome_assignment_id: "OLD1", stage_instance_id: `S${id}`, recruitment_process: "HR Interview", round: 1, result: 0, log_date: "2026-06-25", outcome_date: "2026-07-05", interviewer: null, remark: null, created_at: "2026-07-05", failure_actor: "company", failure_main_reason_id: "M1", failure_detail_reason_id: "D1", failure_reason_snapshot: { actor: "company", main_en: "Skills", main_th: "ทักษะ", detail_en: "Experience", detail_th: "ประสบการณ์" }, ...patch };
}
function reportContext(data: DashboardData): DashboardReportContext {
  return { data, language: "en", requisitions: enrichRequisitions(data), offers: [], candidateOffers: [], preferences: dashboardDefaults(range.end), onPreferencesChange: () => {}, headerScope: { site: "", owner: "", priorityOnly: false }, range: { ...range, valid: true }, summary: "July 2026 · authorized scope", supportedFilters: ["period", "site", "department", "level"] };
}

test("failure grain, superseded corrections, assignment attribution and shared requisitions reconcile", () => {
  const data = fixture(); data.recruitment_logs = [failure(1), failure(2, { failure_actor: "candidate" }), failure(3, { superseded_at: "2026-07-06" }), failure(4, { result: 1 }), failure(5, { result: null }), failure(6, { stage_instance_id: "S1" }), failure(7, { outcome_assignment_id: "MISSING" })];
  const report = buildRejectionReport(data, enrichRequisitions(data), range);
  expect(report.total).toBe(2); expect(report.people).toBe(1); expect(report.applications).toBe(1); expect(report.actors).toEqual({ company: 1, candidate: 1, unclassified: 0 });
  expect(report.events.every(row => row.groupId === "OLD" && row.requisitions.length === 2)).toBe(true);
  expect(report.diagnostics.unresolvedContext).toBe(1);
  expect(buildRejectionReport(data, enrichRequisitions(data).filter(row => row.site === "KT1"), range).total).toBe(0);
  expect(report.trends.reduce((n, row) => n + row.count, 0)).toBe(report.total);
});
test("parallel applications, repeated attempts and subsequently successful applications retain historical failures", () => {
  const data = fixture(); data.candidate_applications!.push({ ...data.candidate_applications![0], application_id: "A2", state: "closed" });
  data.candidate_application_assignments!.push({ ...data.candidate_application_assignments![0], assignment_id: "OLD2", application_id: "A2" });
  data.recruitment_logs = [failure(1), failure(2, { round: 2 }), failure(3, { application_id: "A2", outcome_assignment_id: "OLD2" }), failure(4, { result: 1, recruitment_process: "Offer" })];
  const report = buildRejectionReport(data, enrichRequisitions(data), range);
  expect([report.total, report.people, report.applications]).toEqual([3, 1, 2]);
  data.candidate_applications = data.candidate_applications!.filter(row => row.application_id !== "A2");
  expect(buildRejectionReport(data, enrichRequisitions(data), range).total).toBe(2);
});
test("legacy outcomes, Bangkok boundaries, missing dates and independent unclassified reasons", () => {
  const data = fixture(); data.candidate_applications = undefined; data.candidate_application_assignments = undefined; data.candidates[0].group_id = "OLD";
  data.recruitment_logs = [failure(1, { application_id: undefined, outcome_assignment_id: undefined, stage_instance_id: null, outcome_date: null, log_date: "2026-07-01", failure_actor: null, failure_reason_snapshot: null }),
    failure(2, { application_id: undefined, outcome_assignment_id: undefined, outcome_date: null }),
    failure(3, { application_id: undefined, outcome_assignment_id: undefined, outcome_date: "2026-06-30T18:00:00Z", failure_reason_snapshot: null }),
    failure(4, { application_id: undefined, outcome_assignment_id: undefined, outcome_date: "2026-07-31T18:00:00Z" })];
  const report = buildRejectionReport(data, enrichRequisitions(data), range);
  expect(report.total).toBe(2); expect(report.actors.company).toBe(1); expect(report.actors.unclassified).toBe(1); expect(report.diagnostics.undated).toBe(1);
  expect(report.events.every(row => row.date === "2026-07-01")).toBe(true);
  expect(report.events.find(row => row.actor === "company")!.main.en).toBe("Unclassified reason");
});
test("saved reason labels, ID grouping, local filters and zero-filled clipped time buckets", () => {
  const data = fixture(); data.recruitment_logs = [failure(1), failure(2, { outcome_date: "2026-07-31" })];
  const context = reportContext(data), report = buildRejectionReport(data, context.requisitions, range);
  expect(report.mainReasons[0].label.en).toBe("Skills"); expect(report.mainReasons[0].share).toBe(1);
  expect(buildRejectionReport(data, context.requisitions, range, { ...EMPTY_REJECTION_FILTERS, main: report.mainReasons[0].key, search: "R2" }).total).toBe(2);
  expect(report.trends).toHaveLength(31); expect(report.trends[1].count).toBe(0);
  const weekly = buildRejectionReport(data, context.requisitions, { start: "2026-07-01", end: "2026-09-01" });
  expect(weekly.granularity).toBe("weekly"); expect(weekly.trends[0]).toMatchObject({ start: "2026-07-01", end: "2026-07-03" });
  expect(weekly.trends.at(-1)!.end).toBe("2026-09-01");
  expect(buildRejectionReport(data, context.requisitions, { start: "2026-01-15", end: "2026-12-05" }).trends.at(-1)!.end).toBe("2026-12-05");
  data.recruitment_logs.push(failure(3, { failure_reason_snapshot: null }));
  const incomplete = buildRejectionReport(data, context.requisitions, range);
  expect(incomplete.mainReasons.find(row => row.label.en === "Unclassified reason")!.count).toBe(1);
  expect(incomplete.mainReasons.find(row => row.label.en === "Skills")!.count).toBe(2);
});
test("Rejections URL/session preferences round trip and invalid values recover", () => {
  const preferences = { ...dashboardDefaults(range.end), tab: "pipeline", pipelineSubview: "rejections" as const, rejectionActor: "candidate", rejectionMain: '["saved"]', rejectionPage: 2, rejectionSearch: "ชื่อ ผู้สมัคร", rejectionSort: "candidate-asc" as const };
  const values = dashboardUrlValues(preferences);
  const restored = restoreDashboardPreferences(new URLSearchParams(Object.entries(values).filter(([, value]) => value !== null) as [string, string][]), dashboardDefaults(range.end));
  expect(restored).toEqual(preferences);
  expect(restoreDashboardPreferences(new URLSearchParams("pipelineSubview=bad&rejectionActor=bad&rejectionPage=-3"), dashboardDefaults(range.end))).toMatchObject({ pipelineSubview: "overview", rejectionActor: "", rejectionPage: 0 });
});
test("Excel reopens with exactly two sheets, dates, shares, literal identities and empty-report headers", async () => {
  const data = fixture(); data.candidates[0].name = "=PRIVATE()"; data.recruitment_logs = [failure(1)]; const context = reportContext(data);
  const snapshot = buildRejectionExport(context, buildRejectionReport(data, context.requisitions, range), "All local filters");
  const workbook = await createDashboardWorkbook(snapshot), reopened = new Workbook(); await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  expect(reopened.worksheets.map(row => row.name)).toEqual(["Summary Data", "Source Data"]);
  const table = snapshot.sheets[1].tables[0]; expect(table.rows).toHaveLength(1); expect(table.rows[0][1]).toBeInstanceOf(Date);
  expect(JSON.stringify(reopened.getWorksheet("Source Data")!.model)).toContain("=PRIVATE()");
  expect(JSON.stringify(reopened.model)).not.toContain('"formula":');
  expect(snapshot.sheets[0].tables[0].rows[0]).toEqual(["Total failure events", 1, 1]);
  const empty = buildRejectionExport(context, buildRejectionReport(data, [], range), "Empty"); expect(empty.sheets[1].tables[0].rows).toHaveLength(0);
  await createDashboardWorkbook(empty);
});

async function seed(page: Page, language: "en" | "th" = "en") {
  const { data } = await installMockSupabase(page, { language });
  const original = data.recruitment_logs.find(row => row.application_id)!;
  data.recruitment_logs = Array.from({ length: 61 }, (_, index) => ({ ...original, ...failure(9000 + index, {
    candidate_id: original.candidate_id, application_id: original.application_id, entry_assignment_id: original.entry_assignment_id, outcome_assignment_id: original.entry_assignment_id,
    failure_actor: index % 3 === 0 ? "company" : index % 3 === 1 ? "candidate" : null,
    failure_main_reason_id: `MAIN-${index % 12}`, failure_detail_reason_id: `DETAIL-${index % 24}`, outcome_date: `2026-07-${String(1 + index % 24).padStart(2, "0")}`,
    failure_reason_snapshot: { actor: index % 3 === 1 ? "candidate" : "company", main_en: `Saved reason ${index % 12}`, main_th: `เหตุผลที่บันทึกไว้ ${index % 12}`, detail_en: `Saved detail ${index % 24}`, detail_th: `รายละเอียดเหตุผล ${index % 24}` }
  }) }));
  return data;
}
const href = "/dashboard?dashboardTab=pipeline&pipelineSubview=rejections&dashboardPeriod=pim&dashboardMonth=2026-07";
test("desktop report, chart filters, pagination/history, application drilldown and complete downloads", async ({ page }) => {
  test.setTimeout(120_000); const data = await seed(page); await page.setViewportSize({ width: 1440, height: 1100 }); await page.goto(href); await expectWorkspaceReady(page);
  const report = page.locator("[data-rejection-report]:visible"); await expect(report.locator('[data-rejection-metric="total"]')).toHaveText("61");
  await expect(report.locator("tbody tr")).toHaveCount(25);
  fs.mkdirSync("outputs/rejection-dashboard", { recursive: true }); await page.screenshot({ path: "outputs/rejection-dashboard/desktop-en.png", fullPage: true });
  await report.getByRole("button", { name: "Next", exact: true }).click(); await expect(page).toHaveURL(/rejectionPage=1/);
  await page.reload(); await expect(report).toBeVisible(); await expect(report.getByText("Page 2 / 3", { exact: true })).toBeVisible();
  await report.getByRole("button", { name: "Bars", exact: true }).click();
  await report.getByRole("region", { name: "Why processes ended", exact: true }).getByRole("button", { name: /^Saved reason/ }).first().click();
  await expect(report.locator('[data-rejection-metric="total"]')).not.toHaveText("61"); await expect(report.getByRole("button", { name: "Remove filter: Main reason" })).toBeVisible();
  await report.getByRole("button", { name: "Clear report filters", exact: true }).click(); await expect(report.locator('[data-rejection-metric="total"]')).toHaveText("61");
  await report.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Export Rejections", exact: true }).click();
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "Export Rejections XLSX", exact: true }).click(); const excel = await download;
  const workbook = new Workbook(); await workbook.xlsx.readFile((await excel.path())!); expect(workbook.worksheets).toHaveLength(2);
  await excel.saveAs("outputs/rejection-dashboard/rejection-analysis-synthetic.xlsx");
  const model = JSON.stringify(workbook.getWorksheet("Source Data")!.model); expect(model).toContain("S9060"); expect(model).toContain("S9000");
  await page.evaluate(() => { const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download.endsWith(".png")) document.documentElement.dataset.rejectionExportRows = String(document.querySelectorAll("[data-risk-export] [data-rejection-event]").length); click.call(this); }; });
  await page.getByRole("button", { name: "Export Rejections", exact: true }).click(); const pngDownload = page.waitForEvent("download"); await page.getByRole("button", { name: "Rejections PNG", exact: true }).click();
  const png = await pngDownload; expect(png.suggestedFilename()).toBe("rejection-analysis-2026-07-01-to-2026-07-31.png"); const buffer = fs.readFileSync((await png.path())!); expect(buffer.readUInt32BE(20)).toBeGreaterThan(3000);
  expect(await page.locator("html").getAttribute("data-rejection-export-rows")).toBe("61");
  await png.saveAs("outputs/rejection-dashboard/rejection-analysis-synthetic.png");
  await report.locator("tbody tr").first().getByRole("button").click(); await expect(page.getByRole("dialog")).toBeVisible(); await expect(page).toHaveURL(new RegExp(`applicationId=${data.recruitment_logs[0].application_id}`));
});
test("Thai report at 1024px, keyboard navigation and existing phone restriction", async ({ page }) => {
  await seed(page, "th"); await page.setViewportSize({ width: 1024, height: 1000 }); await page.goto(href); await expectWorkspaceReady(page);
  await expect(page.locator('[data-rejection-report]:visible [data-rejection-metric="total"]')).toHaveText("61");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const cellSizes = await page.locator('[data-rejection-report]:visible tbody tr').first().locator('td').evaluateAll(cells => cells.map(cell => ({ width: cell.getBoundingClientRect().width, height: cell.getBoundingClientRect().height })));
  expect(cellSizes.every(cell => cell.width >= 90 && cell.height < 200)).toBe(true);
  await page.screenshot({ path: "outputs/rejection-dashboard/desktop-1024-th.png", fullPage: true });
  const tab = page.getByRole("tab", { name: "การปฏิเสธและถอนตัว", exact: true }); await tab.focus(); await page.keyboard.press("Home"); await expect(page.getByRole("tab", { name: "ภาพรวม", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End"); await expect(tab).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await expect(page.getByText(/กรุณาใช้หน้าต่างที่มีความกว้างอย่างน้อย 1024/)).toBeVisible();
});
test("complete-load errors retry without partial results and search has a recoverable empty state", async ({ page }) => {
  await seed(page); let fail = true;
  await page.route("**/rest/v1/rpc/app_dashboard_rejection_summary_v1", async route => { if (fail) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Synthetic summary failure" }) }); else await route.fallback(); });
  await page.route("**/rest/v1/recruitment_logs?**", async route => { if (route.request().headers().prefer?.includes("count=exact")) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Synthetic export source failure" }) }); else await route.fallback(); });
  await page.goto(href); await expect(page.getByRole("alert").filter({ hasText: "Could not load the rejection summary" })).toBeVisible(); await expect(page.locator("[data-rejection-report]:visible")).toHaveCount(0);
  fail = false; await page.getByRole("button", { name: "Retry", exact: true }).click(); const report = page.locator("[data-rejection-report]:visible"); await expect(report.locator('[data-rejection-metric="total"]')).toHaveText("61");
  await page.getByRole("button", { name: "Export Rejections", exact: true }).click(); await page.getByRole("dialog").getByRole("button", { name: "Export Rejections XLSX", exact: true }).click(); await expect(page.getByRole("dialog").getByRole("alert").filter({ hasText: "Could not export this report" })).toBeVisible();
  await report.getByRole("searchbox", { name: "Search name or record ID" }).fill("NO-SUCH-APPLICANT"); await expect(report.locator('p[role="status"]').filter({ hasText: "No events match" })).toBeVisible();
  await report.getByRole("button", { name: "Clear report filters", exact: true }).click(); await expect(report.locator('[data-rejection-metric="total"]')).toHaveText("61");
});

test("Saturday–Friday buckets clip boundaries and preserve daily/monthly thresholds", () => {
  const data = fixture(); data.recruitment_logs = [failure(1, { outcome_date: "2026-07-03T16:59:59Z" }), failure(2, { outcome_date: "2026-07-03T17:00:00Z" }), failure(3, { outcome_date: "2026-08-01" })];
  const reqs = enrichRequisitions(data), report = buildRejectionReport(data, reqs, { start: "2026-07-01", end: "2026-08-01" });
  expect(report.trends[0]).toMatchObject({ start: "2026-07-01", end: "2026-07-03", count: 1 });
  expect(report.trends[1]).toMatchObject({ start: "2026-07-04", end: "2026-07-10", count: 1 });
  expect(report.trends.at(-1)).toMatchObject({ start: "2026-08-01", end: "2026-08-01", count: 1 });
  const exact = buildRejectionReport(data, reqs, { start: "2026-07-04", end: "2026-08-07" }); expect(exact.trends[0]).toMatchObject({ start: "2026-07-04", end: "2026-07-10" });
  const crossing = buildRejectionReport(data, reqs, { start: "2026-12-30", end: "2027-02-01" }); expect(crossing.trends[0].end).toBe("2027-01-01"); expect(crossing.trends[1].start).toBe("2027-01-02");
  for (const [end, expected] of [["2026-01-31", "daily"], ["2026-02-01", "weekly"], ["2026-04-30", "weekly"], ["2026-05-01", "monthly"]]) expect(buildRejectionReport(data, reqs, { start: "2026-01-01", end }).granularity).toBe(expected);
  expect(report.trends.reduce((n, row) => n + row.count, 0)).toBe(report.total);
});
test("treemap geometry preserves exact area, bounds and stable order without overlaps", () => {
  const input = [{ key: "a", count: 90 }, { key: "b", count: 8 }, { key: "c", count: 1 }, { key: "d", count: 0.001 }, { key: "zero", count: 0 }];
  for (const [width, height] of [[1000, 280], [600, 320], [12, 12]]) {
    const rects = layoutReasonTreemap(input, width, height), total = 99.001;
    expect(rects).toEqual(layoutReasonTreemap(input.slice().reverse(), width, height)); expect(rects).toHaveLength(4);
    for (const rect of rects) {
      expect(rect.width * rect.height / (width * height)).toBeCloseTo(rect.count / total, 9);
      expect(rect.x).toBeGreaterThanOrEqual(-1e-7); expect(rect.y).toBeGreaterThanOrEqual(-1e-7);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1e-7); expect(rect.y + rect.height).toBeLessThanOrEqual(height + 1e-7);
      for (const other of rects.filter(row => row.key !== rect.key)) expect(Math.min(rect.x + rect.width, other.x + other.width) - Math.max(rect.x, other.x) <= 1e-7 || Math.min(rect.y + rect.height, other.y + other.height) - Math.max(rect.y, other.y) <= 1e-7).toBe(true);
    }
  }
  expect(layoutReasonTreemap([{ key: "one", count: 6 }], 300, 280)[0]).toMatchObject({ x: 0, y: 0, width: 300, height: 280, share: 1 });
  expect(layoutReasonTreemap([], 300, 280)).toEqual([]); expect(layoutReasonTreemap(input, 0, 280)).toEqual([]);
});
test("selected details keep sibling comparison and Excel populations independently reconcilable", async () => {
  const data = fixture(); data.recruitment_logs = [failure(1), failure(2, { failure_detail_reason_id: "D2", failure_reason_snapshot: { actor: "company", main_en: "Skills", main_th: "ทักษะ", detail_en: "Language", detail_th: "ภาษา" } }), failure(3)];
  const ctx = reportContext(data), initial = buildRejectionReport(data, ctx.requisitions, range), selected = initial.events[0];
  const report = buildRejectionReport(data, ctx.requisitions, range, { ...EMPTY_REJECTION_FILTERS, main: selected.mainKey, detail: selected.detailKey });
  expect(report.total).toBe(2); expect(report.comparison.total).toBe(3); expect(report.comparison.reasons).toHaveLength(2); expect(report.comparison.reasons.reduce((n, row) => n + row.share, 0)).toBeCloseTo(1);
  const snapshot = buildRejectionExport(ctx, report, "Selected detail"); expect(snapshot.sheets).toHaveLength(2); expect(snapshot.sheets[1].tables[0].rows).toHaveLength(2);
  const comparison = snapshot.sheets[1].tables.find(row => row.id === "comparison_events")!; expect(comparison.rows).toHaveLength(3); expect(comparison.rows.reduce((n, row) => n + Number(row.at(-1)), 0)).toBe(2);
  const reopened = new Workbook(); await reopened.xlsx.load(await (await createDashboardWorkbook(snapshot)).xlsx.writeBuffer()); expect(reopened.worksheets).toHaveLength(2);
  const prefs = dashboardDefaults(range.end); expect(prefs.rejectionReasonView).toBe("treemap"); expect(restoreDashboardPreferences(new URLSearchParams("rejectionReasonView=wrong"), prefs).rejectionReasonView).toBe("treemap"); expect(restoreDashboardPreferences(new URLSearchParams("rejectionReasonView=bars"), prefs).rejectionReasonView).toBe("bars");
});
test("treemap default, sibling selection, breadcrumbs, view persistence and compact controls", async ({ page }) => {
  await seed(page); await page.setViewportSize({ width: 1440, height: 1050 }); await page.goto(href); await expectWorkspaceReady(page);
  const report = page.locator("[data-rejection-report]:visible"); const treemap = report.locator("[data-reason-treemap]"); await expect(treemap.locator('[data-treemap-ready="true"]')).toBeVisible();
  await expect(report.getByRole("button", { name: "Treemap", exact: true })).toHaveAttribute("aria-pressed", "true");
  await treemap.locator("[data-reason-cell]").first().focus(); await page.keyboard.press("Enter"); await expect(report.locator("[data-reason-comparison-total]")).toContainText("Detailed reasons within");
  const comparison = await report.locator("[data-reason-comparison-total]").innerText(); await treemap.locator("[data-reason-cell]").first().click(); await expect(treemap.locator('[data-reason-cell][aria-pressed="true"]')).toHaveCount(1); await expect(report.locator("[data-reason-comparison-total]")).toHaveText(comparison);
  const filteredTotal = Number(await report.locator('[data-rejection-metric="total"]').innerText()); expect(filteredTotal).toBeLessThan(Number(await report.locator('[data-reason-comparison-total] strong').innerText()));
  await page.evaluate(() => { const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download.endsWith(".png")) document.documentElement.dataset.treemapExportReady = String(document.querySelector('[data-risk-export] [data-treemap-ready="true"]') !== null); click.call(this); }; });
  await page.getByRole("button", { name: "Export Rejections", exact: true }).click(); const pngPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "Rejections PNG", exact: true }).click(); const png = await pngPromise; await png.saveAs("outputs/rejection-dashboard/compact-treemap-synthetic.png"); expect(await page.locator("html").getAttribute("data-treemap-export-ready")).toBe("true");
  await page.screenshot({ path: "outputs/rejection-dashboard/compact-selected-en.png", fullPage: true });
  await report.getByRole("button", { name: "Bars", exact: true }).click(); await expect(treemap).toHaveCount(0); await page.reload(); await expect(report.getByRole("button", { name: "Bars", exact: true })).toHaveAttribute("aria-pressed", "true");
  await report.getByRole("button", { name: "Treemap", exact: true }).click(); await report.getByRole("button", { name: "All main reasons", exact: true }).click(); await expect(report.locator('[data-rejection-metric="total"]')).toHaveText("61");
  await page.screenshot({ path: "outputs/rejection-dashboard/compact-main-en.png", fullPage: true });
  const search = report.getByRole("searchbox"); expect(await search.evaluate(node => node.getBoundingClientRect().height)).toBe(32);
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.setViewportSize({ width: 1024, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
