import { expect, test } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { previousSourcingReportingRange } from "../../src/lib/dates";
import { formatSourcingWeekRange } from "../../src/lib/format";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("custom default follows the completed sourcing week in Bangkok", () => {
  for (const [now, startDate, endDate] of [
    ["2026-09-28T05:00:00Z", "2026-09-19", "2026-09-25"],
    ["2026-07-24T05:00:00Z", "2026-07-11", "2026-07-17"],
    ["2026-07-24T17:00:00Z", "2026-07-18", "2026-07-24"],
    ["2026-07-26T05:00:00Z", "2026-07-18", "2026-07-24"],
    ["2026-01-01T05:00:00Z", "2025-12-20", "2025-12-26"]
  ]) expect(previousSourcingReportingRange(new Date(now))).toEqual({ startDate, endDate });
});

test("sourcing update date displays its preceding Saturday–Friday range", () => {
  expect(formatSourcingWeekRange("2026-09-26", "en")).toBe("19/09/2026–25/09/2026");
  expect(formatSourcingWeekRange("2026-09-26", "th")).toBe("19/09/2026–25/09/2026");
  expect(formatSourcingWeekRange("2026-01-03", "en")).toBe("27/12/2025–02/01/2026");
});

test("custom range defaults to sourcing dates and preserves shared selections", async ({ page }) => {
  await installMockSupabase(page);
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-06");
  await expectWorkspaceReady(page);
  const metric = page.getByRole("button", { name: "Metric view", exact: true });
  await metric.click();
  await page.getByRole("option", { name: "Custom range", exact: true }).click();
  await expect(page).toHaveURL(/start=2026-07-11/);
  await expect(page).toHaveURL(/end=2026-07-17/);

  await page.goto("/dashboard?reportView=custom&start=2026-07-14&end=2026-07-20");
  await expectWorkspaceReady(page);
  await metric.click();
  await page.getByRole("option", { name: "Month to Date", exact: true }).click();
  await metric.click();
  await page.getByRole("option", { name: "Custom range", exact: true }).click();
  await expect(page).toHaveURL(/start=2026-07-14/);
  await expect(page).toHaveURL(/end=2026-07-20/);

  await page.goto("/dashboard?reportView=custom");
  await expectWorkspaceReady(page);
  await expect(page).toHaveURL(/start=2026-07-11/);
  await expect(page).toHaveURL(/end=2026-07-17/);
});

test("waterfall keeps only populated columns in the chart and PNG surface", async ({ page }, testInfo) => {
  const { data } = await installMockSupabase(page);
  const requisition = data.requisitions[0];
  const offer = data.offers[0];
  data.requisitions.splice(0, data.requisitions.length,
    { ...requisition, doc_id: "WF-HQ", site: "HQ", status: "ongoing", head_count: 5, pr_approved_date: "2026-07-01" },
    { ...requisition, doc_id: "WF-KT1", site: "KT1", status: "ongoing", head_count: 2, pr_approved_date: "2026-07-15" },
    { ...requisition, doc_id: "WF-KT2", site: "KT2", status: "ongoing", head_count: 3, pr_approved_date: "2026-08-01" }
  );
  data.offers.splice(0, data.offers.length, { ...offer, offer_id: 9990, doc_id: "WF-HQ", accepted_date: "2026-07-16", start_confirmation: null });
  data.requisition_logs.splice(0, data.requisition_logs.length);
  await page.goto("/dashboard?reportView=custom&start=2026-07-14&end=2026-07-20");
  await expectWorkspaceReady(page);
  for (const svg of await page.locator(".vacancy-waterfall-svg").all()) {
    const bars = svg.locator("[data-waterfall-category]");
    await expect(bars).toHaveCount(4);
    expect(await bars.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-waterfall-category"))))
      .toEqual(["Week Start", "KT1 Open", "HQ Filled", "Total"]);
    await expect(bars.locator(":scope > text")).toHaveText(["5", "2", "(1)", "6"]);
  }
  await page.screenshot({ path: testInfo.outputPath("waterfall-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("waterfall-phone.png"), fullPage: true });
});

test("dashboard report uses calendar views, persists its month, and keeps expandable sections", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07&details=open&funnel=open");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Vacancy Waterfall" })).toBeVisible();
  const combinedReport = page.getByRole("button", { name: /Vacancy Waterfall & Requisitions Active in Selected Period/ });
  await expect(combinedReport).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Requisitions Active in Selected Period", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recruitment Pipeline Health in Selected Range/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Metric view" })).toContainText("Performance in Month");
  await expect(page.getByRole("button", { name: "Report month" })).toContainText("Jul 2026");
  await expect(page.getByRole("heading", { name: "Recruitment Pipeline Health" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Vacancy Waterfall PNG" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export PNG" })).toHaveCount(1);
  await expect(page.getByLabel("Recruitment channel colors").first()).toContainText("Facebook");
  await combinedReport.click();
  await expect(combinedReport).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: "Requisitions Active in Selected Period", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Vacancy Waterfall PNG" })).toBeEnabled();
  await combinedReport.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(combinedReport).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Export PDF" })).toHaveCount(0);
  await page.getByRole("button", { name: "Requisitions Active in Selected Period · Export" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Export detail XLSX", exact: true })).toBeVisible();
});

test("active requisitions expose ordered Activity, Status, and Accum stage metrics", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07&details=open");
  await expectWorkspaceReady(page);

  const modeGroup = page.getByRole("group", { name: "Stage count mode" });
  await expect(modeGroup.getByRole("button")).toHaveText(["Pipeline Activity", "Pipeline Status", "Pipeline Accum"]);
  await expect(modeGroup.getByRole("button", { name: "Pipeline Status" })).toHaveAttribute("aria-pressed", "true");
  await modeGroup.getByRole("button", { name: "Pipeline Accum" }).click();
  await expect(page.getByText(/Unique candidates who entered each stage/)).toBeVisible();
});

test("Pipeline Health channel segments match row totals and Workspace Sourcing colors", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?funnel=open");
  await expectWorkspaceReady(page);
  const funnel = page.locator(".pipeline-funnel").first();
  const legend = funnel.getByLabel("Recruitment channel colors");
  await expect(legend).toContainText("Facebook");
  const facebook = funnel.locator('[title^="Facebook:"]').first();
  await expect(facebook).toHaveCSS("background-color", "rgb(59, 111, 232)");
  const totals = await funnel.locator("div.contents").evaluateAll((rows) => rows.map((row) => {
    const count = Number(row.children[2]?.textContent?.trim().replaceAll(",", "") ?? 0);
    const segmentTotal = Array.from(row.querySelectorAll('div[title][aria-label]:not([tabindex])')).reduce((sum, segment) => sum + Number(segment.getAttribute("title")?.split(": ").at(-1)?.replaceAll(",", "") ?? 0), 0);
    return { count, segmentTotal };
  }));
  expect(totals.length).toBeGreaterThan(1);
  expect(totals.every((row) => row.count === row.segmentTotal)).toBe(true);
});

test("dashboard PNG exports download visible non-blank reports", async ({ page }) => {
  test.setTimeout(90_000);
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07&details=open&funnel=open");
  await expectWorkspaceReady(page);

  const directExportButtons = page.getByRole("button", { name: /Vacancy Waterfall PNG|^Export PNG$/ });
  await expect(directExportButtons).toHaveCount(2);
  const waterfallExportSurface = page.locator(".export-report-surface").filter({ has: page.locator(".vacancy-waterfall-svg") });
  await expect(waterfallExportSurface.locator("h3")).toContainText("Recruitment Performance in Selected Period");
  await expect(waterfallExportSurface).toContainText("During the selected period, total vacancies");
  await expect(waterfallExportSurface.locator(".waterfall-executive-table")).toHaveCSS("overflow-x", "visible");

  for (const [index, filename] of [
    "vacancy-waterfall-2026-07-01-to-2026-07-31.png",
    /^pipeline-funnel-2026-01-01-to-\d{4}-\d{2}-\d{2}\.png$/
  ].entries()) {
    await expect(directExportButtons.nth(index)).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await directExportButtons.nth(index).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(filename);
    const png = await inspectPng(await download.createReadStream());
    expect(png.visible).toBe(true);
    if (index === 0) expect(png.height / png.width).toBeGreaterThan(0.62);
  }

  await page.getByRole("button", { name: "Requisitions Active in Selected Period · Export" }).click();
  const modal = page.getByRole("dialog");
  const modalPngExport = modal.getByRole("button", { name: "Export PNG" });
  await expect(modalPngExport).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await modalPngExport.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("active-requisitions-2026-07-01-to-2026-07-31.png");
  expect((await inspectPng(await download.createReadStream())).visible).toBe(true);
});

async function inspectPng(stream: NodeJS.ReadableStream | null) {
  if (!stream) return { width: 0, height: 0, visible: false };
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  if (png.length < 32 || png.subarray(1, 4).toString() !== "PNG") return { width: 0, height: 0, visible: false };

  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString();
    const value = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = value.readUInt32BE(0); height = value.readUInt32BE(4); }
    if (type === "IDAT") idat.push(value);
    offset += length + 12;
  }
  if (width < 2 || height < 2 || idat.length === 0) return { width, height, visible: false };

  const scanlines = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const row = Buffer.alloc(stride);
  const previousRow = Buffer.alloc(stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = scanlines[cursor++];
    const source = scanlines.subarray(cursor, cursor + stride);
    cursor += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = y > 0 ? previousRow[x] : 0;
      const upLeft = x >= 4 && y > 0 ? previousRow[x - 4] : 0;
      row[x] = filter === 0 ? source[x] : filter === 1 ? source[x] + left : filter === 2 ? source[x] + up : filter === 3 ? source[x] + Math.floor((left + up) / 2) : source[x] + paeth(left, up, upLeft);
    }
    for (let x = 0; x < stride; x += Math.max(4, Math.floor(stride / 256))) {
      if (row[x + 3] > 0 && (row[x] < 245 || row[x + 1] < 245 || row[x + 2] < 245)) return { width, height, visible: true };
    }
    row.copy(previousRow);
  }
  return { width, height, visible: false };
}

function paeth(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  return leftDistance <= upDistance && leftDistance <= upLeftDistance ? left : upDistance <= upLeftDistance ? up : upLeft;
}

test("dashboard active-period vacancy follows PR date and resolved close date", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const base = mock.data.requisitions[0];
  const added = (docId: string, position: string, status: "ongoing" | "filled" | "cancel", prDate: string | null, headCount: number) => ({
    ...base,
    doc_id: docId,
    position,
    status,
    pr_approved_date: prDate,
    head_count: headCount,
    created_at: "2026-05-01T00:00:00",
    updated_at: "2026-05-01T00:00:00"
  });
  mock.data.requisitions.push(
    added("REQ-CLOSED-BEFORE", "Closed Before Period", "filled", "2026-05-01", 2),
    added("REQ-CLOSED-IN", "Closed In Period", "filled", "2026-05-01", 3),
    added("REQ-ACCEPTED-FALLBACK", "Accepted Fallback", "filled", "2026-05-01", 4),
    added("REQ-NO-CLOSE-DATE", "No Close Date", "filled", "2026-05-01", 1),
    added("REQ-FUTURE-PR", "Future PR", "ongoing", "2026-07-01", 1),
    added("REQ-CANCELLED", "Cancelled", "cancel", "2026-05-01", 1),
    added("REQ-MISSING-PR", "Missing PR", "ongoing", null, 1)
  );
  mock.data.requisition_logs.push(
    { log_id: 1, doc_id: "REQ-CLOSED-BEFORE", log_date: "2026-05-31", status: "filled", remark: null, created_at: "2026-05-31T00:00:00" },
    { log_id: 2, doc_id: "REQ-CLOSED-IN", log_date: "2026-06-15", status: "filled", remark: null, created_at: "2026-06-15T00:00:00" }
  );
  mock.data.offers.push({
    ...mock.data.offers[1],
    offer_id: 3,
    candidate_id: "C-ACCEPTED-FALLBACK",
    doc_id: "REQ-ACCEPTED-FALLBACK",
    accepted_date: "2026-06-20"
  });

  await page.goto("/dashboard?reportView=pim&reportMonth=2026-06&details=open");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Filled vacancies / eligible vacancies", { exact: true })).toBeVisible();
  await expect(page.getByText("Closed In Period", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Accepted Fallback", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No Close Date", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Closed Before Period", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Future PR", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Cancelled", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Missing PR", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Vacancy Waterfall" })).toBeVisible();
});

test("active requisitions use the latest status at the selected period end", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const base = mock.data.requisitions[0];
  const baseOffer = mock.data.offers[0];
  mock.data.requisitions.push(
    { ...base, doc_id: "REQ-FILLED-IN-PERIOD", position: "Filled in period", status: "filled", pr_approved_date: "2026-06-01", head_count: 1 },
    { ...base, doc_id: "REQ-FILLED-FROM-OFFER", position: "Filled from accepted offer", status: "ongoing", pr_approved_date: "2026-06-01", head_count: 1 },
    { ...base, doc_id: "REQ-CANCELLED-IN-PERIOD", position: "Cancelled in period", status: "cancel", pr_approved_date: "2026-06-01", head_count: 1 }
  );
  mock.data.requisition_logs.push(
    { log_id: 901, doc_id: "REQ-FILLED-IN-PERIOD", log_date: "2026-06-20", status: "filled", remark: "Offer accepted", created_at: "2026-06-20T00:00:00" },
    { log_id: 902, doc_id: "REQ-CANCELLED-IN-PERIOD", log_date: "2026-06-18", status: "cancel", remark: "Demand withdrawn", created_at: "2026-06-18T00:00:00" }
  );
  mock.data.offers.push({ ...baseOffer, offer_id: 903, candidate_id: "C-AUTO-FILLED", doc_id: "REQ-FILLED-FROM-OFFER", accepted_date: "2026-06-21", start_confirmation: null });

  await page.goto("/dashboard?reportView=pim&reportMonth=2026-06&details=open");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("columnheader", { name: "Status at Period End" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "SLA at Period End" })).toBeVisible();
  await expect(page.getByText("Filled in period", { exact: true }).first()).toBeVisible();
  const manuallyFilledRow = page.locator(".dashboard-detail-scroll tbody tr").filter({ hasText: "Filled in period" });
  await expect(manuallyFilledRow).toContainText("(19d)");
  const offerFilledRow = page.locator(".dashboard-detail-scroll tbody tr").filter({ hasText: "Filled from accepted offer" });
  await expect(offerFilledRow).toContainText("Filled");
  await expect(offerFilledRow).toContainText("(20d)");
  await expect(offerFilledRow).toContainText("21/06/2026");
  await expect(page.getByText("Cancelled in period", { exact: true })).toHaveCount(0);
});

test("waterfall counts fills only from requisitions active in the selected period", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const requisitionTemplate = mock.data.requisitions[0];
  const offerTemplate = mock.data.offers[0];
  mock.data.requisitions.splice(0, mock.data.requisitions.length,
    {
      ...requisitionTemplate,
      doc_id: "REQ-EXPIRED-HQ",
      site: "HQ",
      position: "Expired HQ role",
      level: "3",
      status: "filled",
      head_count: 1,
      pr_approved_date: "2025-06-30"
    },
    {
      ...requisitionTemplate,
      doc_id: "REQ-AUGUST-HQ",
      site: "HQ",
      position: "August HQ role",
      level: "3",
      status: "filled",
      head_count: 1,
      pr_approved_date: "2026-08-17"
    }
  );
  mock.data.offers.splice(0, mock.data.offers.length,
    { ...offerTemplate, offer_id: 801, candidate_id: "C-EXPIRED", doc_id: "REQ-EXPIRED-HQ", accepted_date: "2026-08-03", start_confirmation: null },
    { ...offerTemplate, offer_id: 802, candidate_id: "C-AUGUST", doc_id: "REQ-AUGUST-HQ", accepted_date: "2026-08-20", start_confirmation: null }
  );
  mock.data.requisition_logs.splice(0, mock.data.requisition_logs.length);

  await page.goto("/dashboard?reportView=mtd&reportMonth=2026-08&details=open");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("cell", { name: "August HQ role", exact: true })).toBeVisible();
  await expect(page.getByText("Expired HQ role", { exact: true })).toHaveCount(0);
  await expect(page.locator(".vacancy-waterfall-svg").first()).not.toContainText("-1");
});

test("dashboard active-period labels localize and fit at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  await page.goto("/dashboard?reportView=mtd&reportMonth=2026-06");
  await expect(page.locator("[data-app-header-actions]")).toBeVisible();
  await expect(page.getByText("อัตราที่เติมแล้ว / อัตราที่เข้าเกณฑ์", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("home records keep scrolling inside the candidate list and Today’s Work ends at metrics", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  await page.getByRole("dialog", { name: "Welcome Back" }).getByRole("button", { name: "Close", exact: true }).last().click();
  const pipelineTab = page.getByRole("tab", { name: /Candidate Pipeline/ });
  await pipelineTab.click();
  await expect(pipelineTab).toHaveAttribute("aria-selected", "true");
  const tabPanel = page.getByRole("tabpanel");
  await expect(tabPanel).toBeVisible();
  await expect(tabPanel.locator("[data-home-candidate-scroll]")).toHaveCSS("overflow-y", "auto");
  await expect(tabPanel.getByText("Pat Phone")).toBeVisible();
  await expect(tabPanel.getByText("Tina Test")).toBeVisible();
  await expect(page.getByRole("button", { name: /Show all .* pipeline items/ })).toHaveCount(0);

  const workPanel = page.getByRole("heading", { name: "Today's Work", exact: true }).locator("xpath=ancestor::section[1]");
  await expect(workPanel).toBeVisible();
  await expect(workPanel.locator("[data-home-scroll-section]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Show all .* data quality issues/ })).toHaveCount(0);
});


test("executive table keeps site order, breakdown and mobile containment", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07");
  await expectWorkspaceReady(page);
  const region = page.locator(".waterfall-executive-table").first();
  await expect(region.locator("thead th")).toHaveText(["Site", "Opening vac.", "Opened", "Filled", "Filled in SLA", "Net change", "Closing vac."]);
  await expect(region.locator("tbody th")).toHaveText(["HQ", "KT1", "KT2", "Total"]);
  await expect(region.locator("tbody th").first().locator("span[aria-hidden='true']")).toHaveCSS("display", "block");
  const summary = page.locator("summary").filter({ hasText: "Opened and filled breakdown" }).first();
  await summary.click();
  await expect(summary.locator("..")).toHaveAttribute("open", "");
  await expect(page.locator(".export-report-surface details").first()).toHaveAttribute("open", "");
  await page.screenshot({ path: "test-results/executive-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(region).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/executive-mobile.png", fullPage: true });
});


test("executive table supports Thai and zero-activity periods", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  await page.goto("/dashboard?reportView=custom&start=2000-01-01&end=2000-01-31");
  const region = page.locator(".waterfall-executive-table").first();
  await expect(region.locator("thead th").nth(4)).toHaveText("บรรจุใน SLA");
  await expect(region.locator("tbody th")).toHaveText(["HQ", "KT1", "KT2", "รวม"]);
  await expect(region.locator("tbody tr").first().locator("td")).toHaveText(["0", "0", "0", "—", "0", "0"]);
});
