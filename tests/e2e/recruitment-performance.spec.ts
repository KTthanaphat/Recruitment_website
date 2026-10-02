import { expect, test } from "@playwright/test";
import { enrichOffers, enrichRequisitions } from "../../src/lib/data";
import { buildPerformanceReport, performanceRange, previousPerformanceRange } from "../../src/lib/recruitment-performance";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";
import { installPerformanceFixture } from "./support/performance-fixture";

test("shared dropdown tokens keep white blue triggers and compact, touch-safe choices", async ({ page }, testInfo) => {
  const { data } = await installMockSupabase(page);
  installPerformanceFixture(data);
  data.requisitions.forEach((row, index) => { row.department = index === 0 ? "Operations and very long department name for wrapping" : `Department ${index}`; });
  await page.goto("/dashboard?overviewPeriod=pim&overviewYear=2026&overviewMonth=6");
  await expectWorkspaceReady(page);
  const overview = page.locator("[data-performance-overview]");
  const site = overview.getByRole("button", { name: "Site", exact: true });
  await expect(site).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(site).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await expect(site).toHaveCSS("box-shadow", /rgba\(20, 110, 250, 0\.1\) 0px 2px 6px/);
  const department = overview.getByRole("button", { name: "Department", exact: true });
  await department.click();
  const departmentList = overview.getByRole("listbox", { name: "Department" });
  await expect(departmentList).toBeVisible();
  expect(await departmentList.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.keyboard.press("Escape");
  await site.focus();
  await expect(site).toHaveCSS("outline-color", "rgb(10, 60, 220)");
  await site.press("Enter");
  const siteList = overview.getByRole("listbox", { name: "Site" });
  const desktopRow = await siteList.getByRole("option", { name: "HQ" }).boundingBox();
  expect(desktopRow!.height).toBeGreaterThanOrEqual(36);
  expect(desktopRow!.height).toBeLessThan(44);
  await site.press("Escape");
  await expect(site).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await site.click();
  const phoneRow = await siteList.getByRole("option", { name: "HQ" }).boundingBox();
  expect(phoneRow!.height).toBeGreaterThanOrEqual(44);
  await siteList.getByRole("option", { name: "HQ" }).click();
  await expect(site).toContainText("HQ");
  await expect(siteList.getByRole("option", { name: "HQ" }).locator("span").first()).toHaveCSS("background-color", "rgb(10, 60, 220)");
  await expect(siteList.getByRole("option", { name: "HQ" }).locator("span").first()).toHaveCSS("color", "rgb(255, 255, 255)");
  await siteList.screenshot({ path: testInfo.outputPath("selected-dropdown-phone.png") });
  await page.keyboard.press("Escape");
  await expect(department).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(department).toHaveCSS("border-top-color", "rgb(147, 185, 255)");
  await department.click();
  const longChoice = overview.getByRole("listbox", { name: "Department" }).getByRole("option", { name: /very long department name/ });
  await expect(longChoice).toBeVisible();
  const choiceBox = await longChoice.boundingBox();
  expect(choiceBox!.x).toBeGreaterThanOrEqual(0);
  expect(choiceBox!.x + choiceBox!.width).toBeLessThanOrEqual(390);
});

test("reference presentation reconciles and responds at desktop, tablet and phone sizes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { data } = await installMockSupabase(page);
  installPerformanceFixture(data);
  await page.goto("/dashboard?overviewPeriod=pim&overviewYear=2026&overviewMonth=6");
  await expectWorkspaceReady(page);
  const overview = page.locator("[data-performance-overview]");
  const report = overview.locator("[data-performance-report]").first();
  await expect(report.locator('[data-metric="vacancies"] [data-metric-value]')).toHaveText("40");
  await expect(report.locator('[data-metric="filled"] [data-metric-value]')).toHaveText("16");
  await expect(report.locator('[data-metric="filledPct"] [data-metric-value]')).toHaveText("40%");
  await expect(report.locator('[data-metric="slaPct"] [data-metric-value]')).toHaveText("94%");
  await expect(report.locator('[data-metric="avgTimeToFill"] [data-metric-value]')).toHaveText("7d");
  await expect(report.locator("[data-site-header]")).toHaveText(["HQ", "KT1", "KT2", "Total"]);
  expect(await report.locator("[data-band]").evaluateAll(rows => rows.map(row => row.getAttribute("data-band")))).toEqual(["Executive", "SML", "MML", "FML", "NML"]);
  expect(await report.locator("[data-category]").evaluateAll(rows => rows.map(row => row.getAttribute("data-category")))).toEqual(["NML", "FML", "MML", "SML", "Executive"]);
  await expect(report.locator("[data-site-icon]")).toHaveCount(4);
  await expect(report.locator("[data-site-separator]")).toHaveCount(2);
  await expect(report.locator("[data-sla-chart]")).toHaveAttribute("data-axis-max", "10");
  await expect(report.locator("[data-sla-site=HQ] [data-sla-band]")).toHaveCount(5);
  await expect(report.locator("thead")).toHaveCSS("background-color", "rgb(233, 242, 255)");
  await expect(report.locator('[data-metric="vacancies"]')).not.toContainText("Increased");
  await expect(report.locator('[data-metric] button')).toHaveCount(0);
  for (const group of await report.locator('[data-sla-band]:has([data-sla-label])').all()) {
    const end = await group.locator('[data-unknown]').evaluate(rect => Number(rect.getAttribute("x")) + Number(rect.getAttribute("width")));
    expect(Number(await group.locator('[data-sla-label]').getAttribute("x"))).toBeGreaterThan(end);
    await expect(group.locator('[data-sla-label]')).toHaveAttribute("text-anchor", "start");
  }
  await expect(report.locator("[data-cumulative]").last()).toHaveAttribute("data-cumulative", "100");
  expect(await report.locator("[data-count-scale]").evaluateAll(nodes => [...new Set(nodes.map(node => node.getAttribute("data-count-scale")))])).toEqual(["30"]);
  expect(await report.locator("[data-new], [data-replacement]").evaluateAll(nodes => nodes.reduce((sum, node) => sum + Number(node.getAttribute("data-new") ?? node.getAttribute("data-replacement")), 0))).toBe(40);
  await expect(report.locator('[data-band="NML"] [data-filled]').first()).toHaveAttribute("fill", "#0AA0C3");
  await expect(report.locator('[data-band="NML"] [data-filled]').nth(1)).toHaveAttribute("fill", "#146EFA");
  await expect(report.locator('[data-band="NML"] [data-filled]').nth(2)).toHaveAttribute("fill", "#411EDC");
  await expect(report.locator('[data-on-time="8"]')).toHaveAttribute("fill", "#65C91A");
  await expect(report.locator('[data-late="1"]')).toHaveAttribute("fill", "#F23852");
  for (const width of [1280, 1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width >= 1280) {
      const kpi = await report.locator('[data-metric="vacancies"]').boundingBox();
      const chart = await report.locator("[data-vacancy-chart]").boundingBox();
      expect(chart!.x).toBeGreaterThan(kpi!.x + kpi!.width);
      expect(kpi!.height).toBeLessThanOrEqual(110);
    }
    await overview.screenshot({ path: testInfo.outputPath(`overview-${width}.png`) });
  }
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export overview PNG" }).click();
  const download = await downloadPromise;
  await download.saveAs(testInfo.outputPath("overview-export.png"));
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(2612);
  expect(png.readUInt32BE(20)).toBeGreaterThan(1000);
});

test("collapsible report bars retain filters and chart tooltips work with keyboard and touch", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  installPerformanceFixture(data);
  await page.goto("/dashboard?overviewPeriod=ytd&overviewYear=2026&overviewMonth=6&reportView=pim&reportMonth=2026-06&funnel=open");
  await expectWorkspaceReady(page);
  const report = page.locator("[data-performance-report]").first();
  await expect(report.locator('[data-metric="vacancies"]')).toContainText("vs prior YTD");
  for (const name of ["Filled vs Open Vacancy by Job Level & Site help", "New vs Replacement Vacancy by Job Level help", "Filled in SLA by Job Level and Site help", "Vacancy Waterfall help", "Recruitment Pipeline Health help"]) {
    await page.getByRole("button", { name, exact: true }).focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
  const performance = page.getByRole("button", { name: "Recruitment Performance", exact: true });
  await performance.click();
  await expect(performance).toHaveAttribute("aria-expanded", "false");
  await expect(report).toBeHidden();
  await performance.click();
  await expect(page.getByRole("button", { name: "Period", exact: true })).toContainText("YTD");
  const waterfall = page.getByRole("button", { name: /^Vacancy Waterfall &/ });
  await waterfall.click();
  await expect(waterfall).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Metric view", exact: true })).toBeHidden();
  await waterfall.click();
  await expect(page.getByRole("button", { name: "Metric view", exact: true })).toContainText("Performance in Month");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("button", { name: "Filled vs Open Vacancy by Job Level & Site help", exact: true }).click();
  await expect(page.getByRole("tooltip")).toContainText("Colored bars");
  const box = await page.getByRole("tooltip").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});

test("SLA axis adds ten percent headroom rounded up to an even count", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  installPerformanceFixture(data);
  const existing = data.offers.find(offer => offer.doc_id === "REF-2")!;
  data.offers.push({ ...existing, offer_id: 9981, candidate_id: "HEADROOM-1" });
  await page.goto("/dashboard?overviewPeriod=pim&overviewYear=2026&overviewMonth=6");
  // KT1 has ten fills: ceil(10 × 1.1 / 2) × 2 = 12, with ticks 0/6/12.
  const chart = page.locator("[data-performance-report]").first().locator("[data-sla-chart]");
  await expect(chart).toHaveAttribute("data-axis-max", "12");
  await expect(chart.locator('[data-sla-site="KT1"]')).toContainText("12");
});

test("empty periods keep complete overview axes and omit empty Waterfall columns", async ({ page }, testInfo) => {
  const { data } = await installMockSupabase(page);
  installPerformanceFixture(data);
  await page.goto("/dashboard?overviewPeriod=pim&overviewYear=2020&overviewMonth=1&reportView=pim&reportMonth=2020-01");
  await expectWorkspaceReady(page);
  const report = page.locator("[data-performance-report]").first();
  await expect(report.locator("[data-band]")).toHaveCount(5);
  await expect(report.locator("[data-category]")).toHaveCount(5);
  await expect(report.locator("[data-site-header]")).toHaveText(["HQ", "KT1", "KT2", "Total"]);
  await expect(report.locator("[data-sla-site]")).toHaveCount(3);
  await expect(report.locator("[data-sla-site=KT2] [data-sla-band]")).toHaveCount(5);
  await expect(report.locator("[data-sla-chart]")).toHaveAttribute("data-axis-max", "2");
  await expect(page.locator(".vacancy-waterfall-svg").first().locator("[data-waterfall-category]")).toHaveCount(0);
  await expect(page.getByText("No requisition or accepted offer data for the selected date range.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Recruitment Performance", exact: true }).click();
  await page.getByRole("button", { name: /^Vacancy Waterfall &/ }).click();
  await page.screenshot({ path: testInfo.outputPath("collapsed-report-bars.png"), fullPage: true });
});

test("Thai, long departments, unknown levels and additional sites retain complete chart rows", async ({ page }, testInfo) => {
  const { data } = await installMockSupabase(page, { language: "th" });
  installPerformanceFixture(data);
  const department = "ฝ่ายพัฒนากระบวนการผลิตและบริหารทรัพยากรบุคคลระหว่างประเทศ";
  data.requisitions.forEach(row => { row.department = department; });
  data.requisitions.push({ ...data.requisitions[0], doc_id: "REF-UNKNOWN", site: "ZZ", level: null, head_count: 2 });
  data.offers.push({ ...data.offers[0], offer_id: 9999, doc_id: "REF-UNKNOWN" });
  await page.goto(`/dashboard?lang=th&overviewPeriod=pim&overviewYear=2026&overviewMonth=6&overviewDepartment=${encodeURIComponent(department)}`);
  const report = page.locator("[data-performance-report]").first();
  await expect(report.locator("[data-site-header]")).toHaveText(["HQ", "KT1", "KT2", "ZZ", "รวม"]);
  await expect(report.locator("[data-band]").last()).toHaveAttribute("data-band", "Unknown");
  await expect(report.locator("[data-category]").last()).toHaveAttribute("data-category", "Unknown");
  await expect(report.locator("[data-cumulative]").last()).toHaveAttribute("data-cumulative", "100");
  await expect(report.locator('[data-unknown="1"]')).toHaveAttribute("fill", "#94A3B8");
  await expect(report.locator('[data-sla-site="ZZ"]')).toContainText("—");
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("[data-performance-overview]").screenshot({ path: testInfo.outputPath("overview-thai.png") });
  await page.getByRole("button", { name: "ช่วงเวลา", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "ช่วงเวลา" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "ช่วงเวลา", exact: true })).toBeFocused();
});

test("overview calculations reconcile by site, level and offer capacity", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  const requisition = data.requisitions.find((row) => row.doc_id === "REQ-HQ-2")!;
  const offer = data.offers[0];
  data.offers.push({ ...offer, offer_id: 9001, doc_id: requisition.doc_id, candidate_id: "EXTRA-1", accepted_date: "2026-06-12", start_confirmation: null, start_confirmed_at: null });
  data.offers.push({ ...offer, offer_id: 9002, doc_id: requisition.doc_id, candidate_id: "EXTRA-2", accepted_date: "2026-06-13", start_confirmation: null, start_confirmed_at: null });
  const range = { start: "2026-06-01", end: "2026-06-30" };
  const report = buildPerformanceReport(data, enrichRequisitions(data), enrichOffers(data), range, "pim");
  expect(report.metrics.vacancies).toBe(report.cells.reduce((sum, cell) => sum + cell.vacancies, 0));
  expect(report.metrics.filled).toBe(report.cells.reduce((sum, cell) => sum + cell.filled, 0));
  expect(report.metrics.open).toBe(report.metrics.vacancies - report.metrics.filled);
  expect(report.metrics.filled).toBe(report.metrics.onTime + report.metrics.late + report.metrics.unknownSla);
  expect(report.cells.find((cell) => cell.site === "HQ" && cell.band === "FML")?.filled).toBeGreaterThanOrEqual(1);
  expect(report.metrics.filled).toBeLessThanOrEqual(report.metrics.vacancies);
  const scoped = buildPerformanceReport(data, enrichRequisitions(data), enrichOffers(data), range, "pim", "KT1", "Production");
  expect(scoped.cells.every((cell) => cell.site === "KT1")).toBe(true);
  expect(scoped.metrics.vacancies).toBeLessThan(report.metrics.vacancies);
  const empty = buildPerformanceReport(data, enrichRequisitions(data), enrichOffers(data), { start: "2020-01-01", end: "2020-01-31" }, "pim");
  expect(empty.metrics).toMatchObject({ vacancies: 0, filled: 0, filledPct: null, slaPct: null, avgTimeToFill: null });
  const july = buildPerformanceReport(data, enrichRequisitions(data), enrichOffers(data), { start: "2026-07-01", end: "2026-07-31" }, "pim");
  expect(july.cells.some((cell) => cell.band === "Unknown" && cell.vacancies > 0)).toBe(true);
});

test("overview period boundaries and historical no-show behavior", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  expect(performanceRange("mtd", 2026, 7, "2026-07-24")).toEqual({ start: "2026-07-01", end: "2026-07-24" });
  expect(performanceRange("mtd", 2026, 6, "2026-07-24")).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  expect(performanceRange("ytd", 2026, 7, "2026-07-24")).toEqual({ start: "2026-01-01", end: "2026-07-24" });
  expect(performanceRange("pim", 2026, 7, "2026-07-24")).toEqual({ start: "2026-07-01", end: "2026-07-31" });
  expect(previousPerformanceRange("mtd", { start: "2026-07-01", end: "2026-07-24" })).toEqual({ start: "2026-06-07", end: "2026-06-30" });
  expect(previousPerformanceRange("ytd", { start: "2026-01-01", end: "2026-07-24" })).toEqual({ start: "2025-01-01", end: "2025-07-24" });
  const base = data.offers[0];
  data.offers.push({ ...base, offer_id: 9101, doc_id: "REQ-HQ-2", candidate_id: "NO-SHOW-LATER", accepted_date: "2026-06-10", start_confirmation: "did_not_start", start_confirmed_at: "2026-07-10T04:00:00Z" });
  const rows = enrichRequisitions(data).filter((row) => row.doc_id === "REQ-HQ-2");
  const offers = enrichOffers(data).filter((row) => row.doc_id === "REQ-HQ-2");
  const june = buildPerformanceReport(data, rows, offers, { start: "2026-06-01", end: "2026-06-30" }, "pim", "HQ", "Operations");
  const july = buildPerformanceReport(data, rows, offers, { start: "2026-07-01", end: "2026-07-31" }, "pim", "HQ", "Operations");
  expect(june.metrics.filled).toBe(1);
  expect(july.metrics.filled).toBe(0);
});

test("overview restores its own URL filters, keeps reports, and exports PNG", async ({ page }) => {
  test.setTimeout(90_000);
  await installMockSupabase(page);
  await page.goto("/dashboard?overviewPeriod=pim&overviewYear=2026&overviewMonth=6&overviewSite=KT1&overviewDepartment=Production&reportView=pim&reportMonth=2026-07");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("heading", { name: "Recruitment Performance", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vacancy Waterfall" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Period", exact: true })).toContainText("PIM");
  await expect(page.getByRole("button", { name: "Department", exact: true })).toContainText("Production");
  await expect(page.getByRole("button", { name: "Metric view" })).toContainText("Performance in Month");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export overview PNG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("recruitment-performance-2026-06-01-to-2026-06-30.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Recruitment Performance", exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("overview uses Thai labels and the global site scope", async ({ page }) => {
  await installMockSupabase(page, { language: "th", role: "viewer" });
  await page.goto("/dashboard?lang=th&site=KT1&overviewPeriod=pim&overviewYear=2026&overviewMonth=7");
  await expect(page.getByRole("heading", { name: "ผลการสรรหา", exact: true })).toBeVisible();
  await expect(page.locator("[data-performance-export]")).toContainText("สถานที่: KT1");
  await page.getByRole("button", { name: "สถานที่", exact: true }).last().click();
  const options = page.getByRole("listbox", { name: "สถานที่" }).getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.last()).toContainText("KT1");
  await expect(page.getByRole("heading", { name: /Vacancy Waterfall|กราฟ/ }).first()).toBeVisible();
});

test("overview multi-select filters combine sites and departments, restore URLs and retain report state", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  installPerformanceFixture(data);
  data.requisitions.forEach(row => { row.department = row.site === "HQ" ? "Operations" : row.site === "KT1" ? "Production" : "Planning"; });
  await page.goto("/dashboard?overviewPeriod=pim&overviewYear=2026&overviewMonth=6&reportMonth=2026-07");
  await expectWorkspaceReady(page);
  const site = page.locator('[data-performance-overview]').getByRole("button", { name: "Site", exact: true });
  await site.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  const list = page.getByRole("listbox", { name: "Site", exact: true });
  await expect(list).toHaveAttribute("aria-multiselectable", "true");
  await expect(list.getByRole("option", { name: "HQ", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(list.getByRole("option", { name: "KT1", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(site).toBeFocused();
  const metric = page.locator('[data-performance-report]').first().locator('[data-metric="vacancies"] [data-metric-value]');
  await expect(metric).toHaveText("24");
  await page.getByRole("button", { name: "Department", exact: true }).click();
  const department = page.getByRole("listbox", { name: "Department", exact: true });
  await department.getByRole("option", { name: "Operations", exact: true }).click();
  await expect(metric).toHaveText("3");
  await department.getByRole("option", { name: "Production", exact: true }).click();
  await expect(metric).toHaveText("24");
  await page.keyboard.press("Escape");
  await expect.poll(() => JSON.parse(new URL(page.url()).searchParams.get("overviewSite")!)).toEqual(["HQ", "KT1"]);
  await expect.poll(() => JSON.parse(new URL(page.url()).searchParams.get("overviewDepartment")!)).toEqual(["Operations", "Production"]);
  expect(new URL(page.url()).searchParams.get("reportMonth")).toBe("2026-07");
  await page.reload();
  await expect(metric).toHaveText("24");
  await expect(site).toContainText("HQ, KT1");
  await expect(page.getByRole("button", { name: "Department", exact: true })).toContainText("Operations, Production");
  const url = new URL(page.url()); url.searchParams.set("site", "KT1");
  await page.goto(url.toString());
  await expect(metric).toHaveText("21");
  await expect(site).toContainText("KT1");
  await expect(page.getByRole("button", { name: "Department", exact: true })).toContainText("Production");
  await expect.poll(() => new URL(page.url()).searchParams.get("overviewSite")).toBe("KT1");
});
