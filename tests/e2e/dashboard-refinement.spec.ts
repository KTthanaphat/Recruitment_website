import { expect, test } from "@playwright/test";
import { Workbook } from "exceljs";
import { dashboardDefaults, dashboardUrlValues, restoreDashboardPreferences, type DashboardPreferences } from "../../src/lib/dashboard-filters";
import { formatCompactDateRange } from "../../src/lib/format";
import { enrichRequisitions } from "../../src/lib/data";
import { vacancyRiskAt } from "../../src/lib/vacancy-risk-report";
import { installMockSupabase, expectWorkspaceReady } from "./support/mock-supabase";
import type { Requisition } from "../../src/types/recruitment";

const defaults = () => dashboardDefaults("2026-07-24");
const req = (doc_id: string, pr_approved_date: string, head_count: number, is_priority = true, level = "0"): Requisition => ({
  doc_id, pr_approved_date, head_count, is_priority, level, site: "HQ", department: "HR", position: doc_id,
  section: null, person_in_charge: "Alice", line_manager: null, request_type: "New", replacement_names: null,
  status: "ongoing", created_at: "2026-06-01T00:00:00Z", updated_at: "2026-07-24T00:00:00Z"
});

test("old navigation/session migrates without losing period or filters; canonical children win", () => {
  const old = restoreDashboardPreferences(new URLSearchParams("dashboardTab=vacancy&vacancySubview=risk&reportView=pim&reportMonth=2026-06&details=closed&riskFilter=unknown"), defaults());
  expect(old).toMatchObject({ tab: "performance", performanceSubview: "risk", period: "pim", month: "2026-06", riskFilter: "unknown" });
  const values = dashboardUrlValues(old);
  expect(values).toMatchObject({ dashboardTab: "performance", performanceSubview: "risk", vacancySubview: null, performanceOpen: null, details: null, funnel: null });
  expect(restoreDashboardPreferences(new URLSearchParams("dashboardTab=vacancy&vacancySubview=risk&performanceSubview=vacancy"), defaults()).performanceSubview).toBe("vacancy");
  expect(restoreDashboardPreferences(new URLSearchParams("reportView=ytd&reportMonth=2026-05"), defaults())).toMatchObject({ tab: "performance", performanceSubview: "vacancy", period: "ytd", month: "2026-05" });
  expect(restoreDashboardPreferences(new URLSearchParams("dashboardTab=performance"), { ...defaults(), performanceSubview: "risk" }).performanceSubview).toBe("overview");
  expect(restoreDashboardPreferences(new URLSearchParams("performanceSubview=invalid"), defaults()).performanceSubview).toBe("overview");
  const saved = { ...defaults(), tab: "vacancy", vacancySubview: "risk", riskGroup: "HQ, HR", performanceSubview: undefined } as unknown as DashboardPreferences;
  expect(dashboardUrlValues(saved)).toMatchObject({ dashboardTab: "performance", performanceSubview: "risk", riskGroup: "HQ, HR" });
});

test("comparison ranges display Gregorian same-year, cross-year, single-day and leap dates", () => {
  expect(formatCompactDateRange({ start: "2026-09-27", end: "2026-09-30" })).toBe("27/09 – 30/09/2026");
  expect(formatCompactDateRange({ start: "2025-12-27", end: "2026-01-03" })).toBe("27/12/2025 – 03/01/2026");
  expect(formatCompactDateRange({ start: "2026-09-30", end: "2026-09-30" })).toBe("30/09/2026");
  expect(formatCompactDateRange({ start: "2024-02-29", end: "2024-03-01" })).toBe("29/02 – 01/03/2024");
});

test("two main groups and three Performance children stay open with old collapse flags", async ({ page }) => {
  await installMockSupabase(page);
  await page.goto("/dashboard?dashboardTab=performance&performanceOpen=closed&details=closed&funnel=closed&dashboardPeriod=pim&dashboardMonth=2026-07");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("tablist", { name: "Report", exact: true }).getByRole("tab")).toHaveText(["Recruitment Performance", "Pipeline & Sources"]);
  const children = page.getByRole("tablist", { name: "Recruitment Performance", exact: true });
  await expect(children.getByRole("tab")).toHaveText(["Performance", "Vacancy & Requisitions", "Risk & Aging"]);
  const screen = page.locator("[data-performance-overview] [data-performance-report]").first();
  await expect(screen.locator("[data-metric]")).toHaveCount(4);
  await expect(screen.locator('[data-metric="avgTimeToFill"]')).toHaveCount(0);
  await expect(page.locator("[data-performance-export] [data-metric]")).toHaveCount(4);
  await expect(page.locator(".dashboard-more-filters")).toHaveCount(0);
  await children.getByRole("tab", { name: "Performance", exact: true }).press("ArrowRight");
  await expect(children.getByRole("tab", { name: "Vacancy & Requisitions", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Requisitions Active in Selected Period", exact: true })).toBeVisible();
  await children.getByRole("tab", { name: "Vacancy & Requisitions", exact: true }).press("End");
  await expect(page.locator("[data-risk-report]:visible")).toBeVisible();
  await expect(page.locator("[data-risk-report]:visible > header button[aria-expanded]")).toHaveCount(0);
  await page.goBack();
  await expect(children.getByRole("tab", { name: "Vacancy & Requisitions", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(children.getByRole("tab", { name: "Risk & Aging", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("Risk fractions and workbook denominators include on-track and unknown priority HC", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  data.requisitions = [req("OVERDUE", "2026-06-01", 3), req("TRACK", "2026-07-20", 2), req("UNKNOWN", "2026-06-01", 4, true, "bad"), req("NON-PRIORITY", "2026-06-01", 1, false)];
  data.offers = []; data.requisition_logs = [];
  const model = vacancyRiskAt(data, enrichRequisitions(data), "2026-07-24");
  expect(model.totals).toMatchObject({ open: 10, priority: 3, priorityOpen: 9, unknown: 4, known: 6 });
  expect(model.totals.exposure).toBe(4 / 6);
  await page.goto("/dashboard?dashboardTab=performance&performanceSubview=risk&dashboardPeriod=pim&dashboardMonth=2026-07&riskFilter=all");
  await expectWorkspaceReady(page);
  await expect(page.locator('[data-risk-metric="overdue"]:visible')).toHaveText("4/10");
  await expect(page.locator('[data-risk-metric="priority"]:visible')).toHaveText("3/9");
  await expect(page.locator('[data-risk-metric="priority"]:visible').locator("..")).toContainText("(33.3%) of priority headcount");
  await expect(page.getByRole("columnheader", { name: "Approaching", exact: true })).toBeVisible();
  await expect(page.locator("[data-risk-open]:visible")).toHaveCSS("font-size", "32px");
  expect(await page.locator("[data-risk-report]:visible svg rect").evaluateAll(nodes => nodes.every(n => Number(n.getAttribute("rx") ?? 0) === 0))).toBe(true);
  expect(await page.locator("[data-risk-report]:visible [role=img]:not(svg)").evaluateAll(nodes => nodes.every(n => getComputedStyle(n).borderRadius === "0px"))).toBe(true);
  await page.getByRole("button", { name: "Export Vacancy Risk & Aging", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("dialog").getByRole("button", { name: "Export Vacancy Risk & Aging XLSX", exact: true }).click();
  const file = await pending, chunks: Buffer[] = [];
  for await (const chunk of (await file.createReadStream())!) chunks.push(Buffer.from(chunk));
  const book = new Workbook(); await book.xlsx.load(Buffer.concat(chunks));
  expect(book.worksheets.map(ws => ws.name)).toEqual(["Summary Data", "Source Data"]);
  const table = book.worksheets[0].getTable("Dashboard_risk_metrics");
  const start = Number(table.model.tableRef.match(/^[A-Z]+(\d+)/)![1]);
  const rows = Array.from({ length: 8 }, (_, i) => book.worksheets[0].getRow(start + i + 1).values as any[]);
  const priority = rows.find(row => row[2] === "Priority at risk")!;
  expect(priority).toBeDefined();
  // Workbook section starts in B; numeric contributions remain numeric.
  expect(priority[3]).toBe(3); expect(priority[7]).toBe(9); expect(priority[8]).toBe(1 / 3);
  expect(rows.find(row => row[2] === "Open priority headcount")![3]).toBe(9);
});

test("zero priority denominator is unavailable and no-show SLA has one conditional remark", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  data.requisitions = [req("RESTART", "2026-06-01", 1, false)]; data.requisition_logs = [];
  data.offers = [{ offer_id: 918, candidate_id: "C-LINE", doc_id: "RESTART", accepted_date: "2026-06-10", first_working_date: "2026-06-20", start_confirmation: "did_not_start", start_confirmed_at: "2026-07-03T00:00:00+07:00", start_confirmed_by: null, start_confirmation_reason: null, remark: null, created_at: "2026-06-10", updated_at: "2026-07-03" }];
  await page.goto("/dashboard?dashboardTab=performance&performanceSubview=risk&dashboardPeriod=pim&dashboardMonth=2026-07&riskFilter=all");
  await expectWorkspaceReady(page);
  await expect(page.locator('[data-risk-metric="priority"]:visible')).toHaveText("0/0");
  await expect(page.locator('[data-risk-metric="priority"]:visible').locator("..")).toContainText("(—) of priority headcount");
  const table = page.getByRole("region", { name: "Requisitions requiring action", exact: true });
  const row = table.getByRole("row").filter({ hasText: "RESTART" });
  await expect(row.getByRole("cell").nth(3)).toHaveText("21 days");
  await expect(row.getByRole("cell").nth(4)).toHaveText("9 days*");
  await expect(row.locator('[aria-describedby="risk-restart-remark"]')).toHaveAttribute("title", /2026-07-03/);
  await expect(table.locator("[data-sla-restart-remark]")).toHaveCount(1);
  await page.getByRole("button", { name: /^Overdue 0\/1/ }).click();
  await expect(table.locator("[data-sla-restart-remark]")).toHaveCount(0);
});

for (const language of ["en", "th"] as const) test(`Risk health and fractions wrap without overflow in ${language}`, async ({ page }) => {
  const { data } = await installMockSupabase(page, { language });
  data.requisitions.push(req("LONG-UNKNOWN", "2026-06-01", 123, true, "invalid"));
  data.requisitions.forEach(row => { row.department = "Long department ฝ่ายที่มีชื่อยาว ".repeat(3); });
  await page.goto("/dashboard?dashboardTab=performance&performanceSubview=risk&dashboardPeriod=pim&dashboardMonth=2026-07&riskFilter=all");
  await expectWorkspaceReady(page);
  await expect(page.locator("[data-risk-open]:visible")).toBeVisible();
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const health = await page.locator("[data-risk-open]:visible").evaluate(n => {
      const label = n.previousElementSibling!;
      const number = n.getBoundingClientRect(), text = label.getBoundingClientRect();
      return { numberX: number.x, labelRight: text.right, numberHeight: number.height, labelHeight: text.height };
    });
    expect(health.numberX).toBeGreaterThan(health.labelRight);
    expect(health.numberHeight).toBe(32); expect(health.labelHeight).toBe(32);
    if (width < 640) await page.screenshot({ path: test.info().outputPath(`risk-summary-${language}-${width}.png`), fullPage: true });
  }
});

test("all overview chart bars and export bars retain square ends", async ({ page }) => {
  await installMockSupabase(page);
  await page.goto("/dashboard?dashboardTab=performance&dashboardPeriod=pim&dashboardMonth=2026-07");
  await expectWorkspaceReady(page);
  expect(await page.locator("[data-performance-overview] svg rect, .vacancy-waterfall-svg rect").evaluateAll(nodes => nodes.every(n => Number(n.getAttribute("rx") ?? 0) === 0))).toBe(true);
  expect(await page.locator('[data-performance-overview] [class*="miniBar"]').evaluateAll(nodes => nodes.length > 0 && nodes.every(n => getComputedStyle(n).borderRadius === "0px"))).toBe(true);
  await page.getByRole("tab", { name: "Pipeline & Sources", exact: true }).click();
  await expect(page.getByTestId("pipeline-source-layout").locator(".pipeline-funnel")).toBeVisible();
  expect(await page.locator(".pipeline-funnel div[tabindex], .source-effectiveness [role=img], .source-effectiveness [data-mini-track], .source-effectiveness [data-mini-baseline]").evaluateAll(nodes => nodes.length > 0 && nodes.every(n => getComputedStyle(n).borderRadius === "0px"))).toBe(true);
});
