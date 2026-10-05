import { test, expect, type Page } from "@playwright/test";
import { Workbook } from "exceljs";
import { installMockSupabase, expectWorkspaceReady } from "./support/mock-supabase";
import { emptyDashboardData, enrichRequisitions, enrichOffers } from "../../src/lib/data";
import { bangkokDay, calendarDays } from "../../src/lib/dashboard-history";
import { vacancyRiskAt, riskGroups, buildVacancyRiskReport } from "../../src/lib/vacancy-risk-report";
import { normalizeStageInstances, percentile, buildStageBottleneckReport } from "../../src/lib/stage-bottleneck-report";
import { readReportPages } from "../../src/lib/dashboard-report-loader";
import { buildBottleneckExport, buildRiskExport } from "../../src/lib/risk-bottleneck-export";
import { createDashboardWorkbook } from "../../src/lib/dashboard-workbook";
import { dashboardDefaults, restoreDashboardPreferences, dashboardUrlValues } from "../../src/lib/dashboard-filters";
import type { Candidate, DashboardData, RecruitmentLog, Requisition } from "../../src/types/recruitment";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardReportContext } from "../../src/components/dashboard/DashboardPortal";
const prior = { start: "2026-06-01", end: "2026-06-30" }, range = { start: "2026-07-01", end: "2026-07-24" };
function req(id: string, pr = "2026-06-24", level: string | null = "4", hc = 1): Requisition { return { doc_id: id, pr_approved_date: pr, level, head_count: hc, site: "HQ", department: "HR", position: `Role ${id}`, section: null, person_in_charge: "Alice", line_manager: null, request_type: "New", replacement_names: null, status: "ongoing", is_priority: true, created_at: "2026-06-01T00:00:00Z", updated_at: "2026-07-24T00:00:00Z" }; }
function candidate(id: string): Candidate { return { candidate_id: id, name: `Candidate ${id}`, nickname: null, channel: "Facebook", group_id: "G", doc_group_id: null, first_contact_date: "2026-06-01", phone_no: null, email: null, ref_name: null, candidate_folder_url: null, created_at: "2026-06-01T00:00:00Z", updated_at: "2026-07-24T00:00:00Z" }; }
function log(id: number, candidateId: string, stage: RecruitmentLog["recruitment_process"] = "Phone Screen", entry = "2026-07-01", outcome: string | null = null, result: number | null = null): RecruitmentLog { return { log_id: id, stage_instance_id: `S${id}`, candidate_id: candidateId, recruitment_process: stage, round: 1, log_date: entry, outcome_date: outcome, result: result as RecruitmentLog["result"], estimated_action_date: "2026-07-20", interviewer: null, remark: null, record_origin: "user", created_at: `${entry}T00:00:00Z` }; }
function dataset(): DashboardData { return { ...emptyDashboardData, requisitions: [req("R1", "2026-06-01", "4", 4), req("R2", "2026-06-01", "4", 4)], candidates: [candidate("C1"), candidate("C2"), candidate("C3")], document_groups: ["R1", "R2"].map((id, i) => ({ doc_group_id: `DG${i}`, doc_id: id, group_id: "G", group_position: "Roles", created_at: "2026-06-01", updated_at: "2026-06-01" } as DashboardData["document_groups"][number])) }; }
function context(data: DashboardData): DashboardReportContext { return { language: "en", data, requisitions: enrichRequisitions(data), offers: enrichOffers(data), candidateOffers: data.offers, preferences: dashboardDefaults("2026-07-24"), headerScope: { site: "", owner: "", priorityOnly: false }, range: { ...range, valid: true }, summary: "HQ · HR · All levels · All PIC", supportedFilters: ["period", "site", "department", "level"], onPreferencesChange: () => {} }; }

test("Bangkok boundaries and all SLA boundary buckets reconcile including unknown", () => {
  expect(bangkokDay("2026-07-23T18:00:00Z")).toBe("2026-07-24"); expect(bangkokDay("2026-02-30")).toBeNull(); expect(calendarDays("2024-02-28", "2024-03-01")).toBe(2);
  const data = dataset(); data.requisitions = [req("8", "2026-07-02"), req("7", "2026-07-01"), req("1", "2026-06-25"), req("0", "2026-06-24"), req("-1", "2026-06-23"), req("unknown", "2026-06-24", "L4bad"), req("L9", "2026-06-09", "9"), req("L14", "2026-05-25", "14")];
  const report = vacancyRiskAt(data, enrichRequisitions(data), "2026-07-24");
  expect(report.rows.find(row => row.requisition.doc_id === "8")!.kind).toBe("track");
  expect(report.totals).toMatchObject({ track: 1, near: 5, overdue: 1, unknown: 1, open: 8, known: 7 }); expect(report.totals.exposure).toBe(6 / 7);
  expect(riskGroups(report.rows, "department")[0].open).toBe(8);
  data.requisitions = [req("missing", "bad", null)]; expect(vacancyRiskAt(data, enrichRequisitions(data), "2026-07-24").totals.exposure).toBeNull();
});
test("historical partial fills, caps, cancellation and no-show reopening ignore later restarts", () => {
  const data = dataset(); data.requisitions = [req("R1", "2026-06-01", "4", 1)];
  data.offers = [{ offer_id: 1, candidate_id: "C1", doc_id: "R1", accepted_date: "2026-06-10", first_working_date: "2026-06-20", start_confirmation: "did_not_start", start_confirmed_at: "2026-07-02T18:00:00Z", start_confirmed_by: null, start_confirmation_reason: null, remark: null, created_at: "2026-06-10", updated_at: "2026-07-03" }];
  expect(vacancyRiskAt(data, enrichRequisitions(data), "2026-07-02").totals.open).toBe(0);
  const reopened = vacancyRiskAt(data, enrichRequisitions(data), "2026-07-03"); expect(reopened.totals.open).toBe(1); expect(reopened.rows[0].start).toBe("2026-07-03"); expect(reopened.rows[0].age).toBe(0);
  data.requisition_logs = [{ log_id: 1, doc_id: "R1", log_date: "2026-07-04", status: "cancel", remark: null, created_at: "2026-07-04" }];
  expect(vacancyRiskAt(data, enrichRequisitions(data), "2026-07-03").totals.open).toBe(1); expect(vacancyRiskAt(data, enrichRequisitions(data), "2026-07-04").totals.open).toBe(0);
  data.requisitions[0].head_count = 3; data.requisition_logs = []; expect(vacancyRiskAt(data, enrichRequisitions(data), "2026-07-02").totals.open).toBe(2);
});
test("mixed canonical/legacy rounds exclude corrected, outcome-only and invalid durations", () => {
  const logs = [log(1, "C1", "Phone Screen", "2026-07-01", "2026-07-01", 1), log(2, "C1", "Test", "2026-07-02", "2026-07-06", 0), { ...log(3, "C1", "HR Interview", "2026-07-01"), stage_instance_id: null }, { ...log(4, "C1", "HR Interview", "2026-07-04", null, 1), stage_instance_id: null }, { ...log(5, "C1", "Offer", "2026-07-04", null, 1), stage_instance_id: null }, { ...log(6, "C1"), superseded_by_stage_instance_id: "S7" }, log(7, "C1", "Line Interview", "2026-07-10", "2026-07-02", 1), { ...log(8, "C1", "Test", "2026-07-06", "2026-07-08", 1), round: 2 }];
  const rows = normalizeStageInstances(logs); expect(rows).toHaveLength(6); expect(rows.filter(row => row.duration !== null).map(row => row.duration)).toEqual([0, 4, 3, 2]); expect(rows.filter(row => row.exclusion)).toHaveLength(2);
  expect(percentile([0, 2, 3, 4], .5)).toBe(2.5); expect(percentile([0, 2, 3, 4], .9)).toBeCloseTo(3.7); expect(percentile([], .9)).toBeNull();
});
test("snapshot queue is distinct across shared requisitions and detects unavailable deadlines", () => {
  const data = dataset(); data.recruitment_logs = [log(1, "C1", "Phone Screen", "2026-06-25", "2026-07-30", 1), { ...log(2, "C2", "HR Interview"), estimated_action_date: "2026-07-24" }, { ...log(3, "C3", "Line Interview"), pending_edited_at: "2026-08-01T00:00:00Z" }, log(4, "C3", "Test", "2026-06-20")];
  const report = buildStageBottleneckReport(data, enrichRequisitions(data), range, "2026-08-02", prior);
  expect(report.metrics).toMatchObject({ waiting: 3, overdue: 1, unavailable: 1, longest: 29 }); expect(report.waiting.find(row => row.candidate.candidate_id === "C1")!.requisitions).toHaveLength(2); expect(report.conflicts).toBe(1);
  expect(report.waiting.find(row => row.candidate.candidate_id === "C2")!.status).toBe("today"); expect(report.trends.at(-1)!.overdue).toBeNull();
  data.recruitment_logs.push(log(5, "C1", "Withdrawn", "2026-07-22")); expect(buildStageBottleneckReport(data, enrichRequisitions(data), range, "2026-08-02", prior).metrics.waiting).toBe(2);
});
test("completed passed and failed attempts pool medians; future range has no completions", () => {
  const data = dataset(); data.recruitment_logs = [log(1, "C1", "Phone Screen", "2026-07-01", "2026-07-03", 1), log(2, "C2", "Line Interview", "2026-07-01", "2026-07-08", 0), log(3, "C3", "Line Interview", "2026-07-01", "2026-07-10", 1)];
  const report = buildStageBottleneckReport(data, enrichRequisitions(data), range, "2026-07-24", prior); expect(report.metrics.median).toBe(7); expect(report.primary!.stage).toBe("Line Interview"); expect(report.primary!.median).toBe(8); expect(report.stages).toHaveLength(6);
  expect(buildStageBottleneckReport(data, enrichRequisitions(data), { start: "2026-09-01", end: "2026-09-30" }, "2026-07-24", prior)).toMatchObject({ future: true, completions: [], prior: null });
});
test("completed later attempts prevent obsolete pending rows from reappearing; invalid due stays unavailable", () => {
  const data = dataset(); data.recruitment_logs = [log(1, "C1"), log(2, "C1", "HR Interview", "2026-07-04", "2026-07-05", 1), { ...log(3, "C2"), estimated_action_date: "2026-02-30" }, { ...log(4, "C3", "Test", "2026-07-01", "2026-07-05", 1), migration_note: "Pass inferred from later stage" }];
  const report = buildStageBottleneckReport(data, enrichRequisitions(data), range, "2026-07-24", prior); expect(report.waiting.map(row => row.candidate.candidate_id)).toEqual(["C2"]); expect(report.metrics.unavailable).toBe(1); expect(report.excluded).toBe(1);
});
test("new view state roundtrips, invalid subviews fall back and detail filters stay separate", () => {
  const base = { ...dashboardDefaults("2026-07-24"), performanceSubview: "risk" as const, pipelineSubview: "bottlenecks" as const, riskGroup: "HQ, HR", queueSearch: "คน ไทย", queuePic: "Alice" };
  const restored = restoreDashboardPreferences(new URLSearchParams(Object.entries(dashboardUrlValues(base)).filter(([, v]) => v !== null) as [string, string][]), dashboardDefaults("2026-07-24")); expect(restored).toMatchObject(base);
  expect(restoreDashboardPreferences(new URLSearchParams("performanceSubview=bad&pipelineSubview=bad"), base)).toMatchObject({ performanceSubview: "overview", pipelineSubview: "overview" });
});
test("pagination retrieves >1000 rows and rejects truncated, duplicate or failed pages", async () => {
  const rows = Array.from({ length: 1101 }, (_, id) => ({ log_id: id }));
  function client(failure = "") { return { from: () => ({ select: () => ({ order: () => ({ range: async (start: number, end: number) => failure === "error" && start ? { error: { message: "Read failed" }, count: 1101 } : { data: failure === "cap" ? rows.slice(0, 200) : failure === "duplicate" ? rows.slice(0, 500) : rows.slice(start, end + 1), count: rows.length, error: null } }) }) }) } as unknown as SupabaseClient; }
  expect(await readReportPages(client(), "recruitment_logs", "log_id", "log_id")).toHaveLength(1101);
  await expect(readReportPages(client("cap"), "recruitment_logs", "log_id", "log_id")).rejects.toThrow("Incomplete"); await expect(readReportPages(client("duplicate"), "recruitment_logs", "log_id", "log_id")).rejects.toThrow("Duplicate"); await expect(readReportPages(client("error"), "recruitment_logs", "log_id", "log_id")).rejects.toThrow("Read failed");
});
test("both models export two typed worksheets with literal text and reconcilable ledgers", async () => {
  const data = dataset(); data.candidates[0].name = "=1+1"; data.candidates[0].candidate_id = "0001"; data.recruitment_logs = [log(1, "0001", "Phone Screen", "2026-07-01", "2026-07-03", 1), log(2, "C2")]; const c = context(data);
  const risk = buildVacancyRiskReport(data, c.requisitions, range, "2026-07-24", prior), stage = buildStageBottleneckReport(data, c.requisitions, range, "2026-07-24", prior);
  for (const snapshot of [buildRiskExport(c, risk, riskGroups(risk.rows, "department"), risk.rows, "All"), buildBottleneckExport(c, stage, stage.waiting, "All")]) {
    const workbook = await createDashboardWorkbook(snapshot), reopened = new Workbook(); await reopened.xlsx.load(await workbook.xlsx.writeBuffer()); expect(reopened.worksheets.map(ws => ws.name)).toEqual(["Summary Data", "Source Data"]); const values = reopened.worksheets.flatMap(ws => ws.getSheetValues().flat(2)); expect(values.some(value => value instanceof Date)).toBe(true); expect(values.some(value => typeof value === "object" && value !== null && "formula" in value)).toBe(false);
    if (snapshot.reportId === "bottlenecks") { expect(values).toContain("=1+1"); expect(values).toContain("0001"); }
  }
});
async function open(page: Page, tab: "vacancy" | "pipeline", language = "en") { const mock = await installMockSupabase(page, { language: language as "en" }); await page.goto(`/dashboard?dashboardTab=${tab}&${tab === "vacancy" ? "vacancySubview=risk" : "pipelineSubview=bottlenecks"}&dashboardPeriod=pim&dashboardMonth=2026-07`); await expectWorkspaceReady(page); await expect(page.locator("[data-risk-report]").filter({ visible: true })).toBeVisible(); return mock; }
test("risk subview filters detail rows, exports from an always-open report and restores browser history", async ({ page }) => {
  await open(page, "vacancy"); const report = page.getByRole("region", { name: "Vacancy Risk & Aging", exact: true }); await expect(report.locator("[data-risk-open]")).toHaveText(/\d+/); await report.getByRole("button", { name: "Clear detail filters", exact: true }).click();
  await page.getByRole("tab", { name: "Performance", exact: true }).click(); await expect(page.locator("[data-risk-report]:visible")).toHaveCount(0); await page.goBack(); await expect(report).toBeVisible();
  await expect(report.getByRole("heading", { name: "Vacancy Risk & Aging", exact: true })).toBeVisible(); await report.getByRole("button", { name: "Export Vacancy Risk & Aging", exact: true }).click(); const pending = page.waitForEvent("download"); await page.getByRole("dialog").getByRole("button", { name: "Export Vacancy Risk & Aging XLSX", exact: true }).click(); const file = await pending; expect(file.suggestedFilename()).toBe("vacancy-risk-2026-07-24.xlsx"); const chunks: Buffer[] = []; for await (const chunk of (await file.createReadStream())!) chunks.push(Buffer.from(chunk)); const book = new Workbook(); await book.xlsx.load(Buffer.concat(chunks)); expect(book.worksheets).toHaveLength(2);
});
test("stage subview controls, compact layouts and PNG retain all filtered action rows", async ({ page }) => {
  await open(page, "pipeline"); await expect(page.getByRole('button', { name: /^All \d+$/ }).locator('b')).toHaveText(/\d+/); await page.getByRole("button", { name: "Clear detail filters", exact: true }).click(); await expect(page.getByRole("button", { name: "Follow up", exact: true }).first()).toBeVisible();
  for (const width of [1280, 1024]) { await page.setViewportSize({ width, height: 900 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
  await page.setViewportSize({ width: 1280, height: 900 }); await page.getByRole("button", { name: "Export Stage Bottlenecks", exact: true }).click(); const pending = page.waitForEvent("download"); await page.getByRole("dialog").getByRole("button", { name: "Stage Bottlenecks PNG", exact: true }).click(); const file = await pending; expect(file.suggestedFilename()).toMatch(/^stage-bottlenecks-.*\.png$/); const stream = (await file.createReadStream())!; let bytes = 0; for await (const chunk of stream) bytes += chunk.length; expect(bytes).toBeGreaterThan(10000);
});
test("Thai report labels and keyboard subview operation", async ({ page }) => { await open(page, "vacancy", "th"); await expect(page.getByRole("region", { name: "ความเสี่ยงและอายุอัตราว่าง", exact: true })).toBeVisible(); await page.getByRole("tab", { name: "ความเสี่ยงและอายุ", exact: true }).focus(); await page.keyboard.press("Home"); await expect(page.getByRole("tab", { name: "ภาพรวมผลการสรรหา", exact: true })).toHaveAttribute("aria-selected", "true"); });
test("complete history failure is retryable without publishing a partial report", async ({ page }) => {
  await installMockSupabase(page); let failed = true;
  await page.route("**/rest/v1/recruitment_logs?**", async route => { if (failed && route.request().headers().prefer?.includes("count=exact")) await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Synthetic read failure" }) }); else await route.fallback(); });
  await page.goto("/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks&dashboardPeriod=pim&dashboardMonth=2026-07"); await expectWorkspaceReady(page); await expect(page.getByRole("alert").filter({ hasText: "Could not load complete report history" })).toBeVisible(); await expect(page.locator("[data-risk-report]:visible")).toHaveCount(0); failed = false; await page.getByRole("button", { name: "Retry", exact: true }).click(); await expect(page.locator("[data-risk-report]:visible")).toBeVisible();
});
test("header scope narrows both new reports; Channel stays local and details hydrate", async ({ page }) => {
  await open(page, "pipeline"); await page.getByRole("button", { name: "Clear detail filters", exact: true }).click(); const total = Number(await page.getByRole('button', { name: /^All \d+$/ }).locator('b').innerText());
  await page.getByRole("button", { name: "Channel", exact: true }).click(); await page.getByRole("option", { name: "Facebook", exact: true }).click(); expect(Number(await page.getByRole('button', { name: /^All \d+$/ }).locator('b').innerText())).toBeLessThan(total);
  await page.getByRole("button", { name: "Follow up", exact: true }).first().click(); const detail = page.getByRole("dialog", { name: /C-/ }); await expect(detail).toBeVisible(); await detail.press("Escape"); await expect(detail).toHaveCount(0);
   await page.locator("[data-app-header-filters]").getByRole("button", { name: "Site", exact: true }).click(); await page.getByRole("option", { name: "KT1", exact: true }).click();  await expect(page.getByRole('button', { name: /^All \d+$/ }).locator('b')).toHaveText("0");
  await page.getByRole("tab", { name: "Recruitment Performance", exact: true }).click(); await page.getByRole("tab", { name: "Vacancy & Requisitions", exact: true }).click(); await page.getByRole("tab", { name: "Risk & Aging", exact: true }).click(); await page.getByRole("button", { name: "Clear detail filters", exact: true }).click(); await expect(page.getByRole("region", { name: "Requisitions requiring action", exact: true })).toContainText("KT1"); await expect(page.getByRole("region", { name: "Requisitions requiring action", exact: true })).not.toContainText("REQ-HQ-1");
});
test("company-only risk rows open limited read-only details without operational identity", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "viewer" });
  await page.route("**/rest/v1/rpc/app_dashboard_company_report", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ requisitions: [...data.requisitions, req("COMPANY-ONLY", "2026-06-01", "4", 1)], requisition_logs: [], offers: [] }) }));
  await page.goto("/dashboard?dashboardTab=vacancy&vacancySubview=risk&dashboardPeriod=pim&dashboardMonth=2026-07&riskFilter=all"); await expectWorkspaceReady(page); const row = page.getByRole("region", { name: "Requisitions requiring action", exact: true }).getByRole("row").filter({ hasText: "COMPANY-ONLY" }); await row.getByRole("button", { name: "Review", exact: true }).click(); await expect(page.getByRole("dialog")).toContainText("Company report · Read-only details"); await expect(page.getByRole("dialog")).toContainText("No candidate identity"); await expect(page.getByRole("dialog").getByRole("button", { name: /Edit|Save/ })).toHaveCount(0);
});
test("browser retrieves every stage page above 1000 and action PNG includes beyond-screen rows", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  const original = data.candidates.find(row => row.candidate_id === "C-PHONE")!;
  for (let i = 0; i < 26; i++) { const id = `LONG-${i}`; data.candidates.push({ ...original, candidate_id: id, name: `Synthetic candidate ${i}` }); data.recruitment_logs.push(log(10000 + i, id, "Test", "2026-07-01")); }
  for (let i = 0; i < 1050; i++) data.recruitment_logs.push({ ...log(11000 + i, original.candidate_id, "Phone Screen", "2026-07-01", "2026-07-03", 1), round: i + 1 });
  await page.goto("/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks&dashboardPeriod=pim&dashboardMonth=2026-07&queueStatus=all"); await expectWorkspaceReady(page); const queue = page.getByRole("region", { name: "Action queue", exact: true }); await expect(queue.locator("tbody tr")).toHaveCount(20); await expect(queue.getByText("Page 1 / 2", { exact: true })).toBeVisible();
  const expectedPhone = buildStageBottleneckReport(data, enrichRequisitions(data), { start: "2026-07-01", end: "2026-07-31" }, "2026-07-24", prior).stages[0].sample;
  expect(expectedPhone).toBeGreaterThan(1000);
  const stages = page.getByRole("heading", { name: "Stage completion time", exact: true }).locator("..").locator("..").locator(".."); await expect(stages.getByRole("row").filter({ has: page.getByRole("button", { name: "Phone Screening", exact: true }) })).toContainText(String(expectedPhone));
  const total = Number(await page.getByRole('button', { name: /^All \d+$/ }).locator('b').innerText()); await page.getByRole("button", { name: "Export Stage Bottlenecks", exact: true }).click(); const download = page.waitForEvent("download"); await page.getByRole("dialog").getByRole("button", { name: "Stage Bottlenecks PNG", exact: true }).click(); await expect(page.locator('[data-risk-export] section[aria-label="Action queue"] tbody tr')).toHaveCount(total); await download;
});
for (const role of ["site_recruiter", "viewer"] as const) test(`${role} stage source rows stay within authorized operational records`, async ({ page }) => {
  const { data } = await installMockSupabase(page, { role });
  data.candidates = data.candidates.filter(row => row.candidate_id === "C-LINE"); data.recruitment_logs = data.recruitment_logs.filter(row => row.candidate_id === "C-LINE"); data.offers = [];
  await page.goto("/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks&dashboardPeriod=pim&dashboardMonth=2026-07&queueStatus=all"); await expectWorkspaceReady(page); await expect(page.getByRole('button', { name: /^All \d+$/ }).locator('b')).toHaveText("1");
  await page.getByRole("button", { name: "Export Stage Bottlenecks", exact: true }).click(); const pending = page.waitForEvent("download"); await page.getByRole("dialog").getByRole("button", { name: "Export Stage Bottlenecks XLSX", exact: true }).click(); const file = await pending; const chunks: Buffer[] = []; for await (const chunk of (await file.createReadStream())!) chunks.push(Buffer.from(chunk)); const book = new Workbook(); await book.xlsx.load(Buffer.concat(chunks));
  const values = book.worksheets[1].getSheetValues().flat(2); expect(values).toContain("C-LINE"); expect(values).not.toContain("C-PHONE"); expect(values).not.toContain("Pat Phone"); expect(values).not.toContain("phone_no"); expect(values).not.toContain("email");
  await page.goto("/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks&dashboardPeriod=pim&dashboardMonth=2026-07&site=HQ"); await expectWorkspaceReady(page); await expect(page.getByRole('button', { name: /^All \d+$/ }).locator('b')).toHaveText("0");
});
