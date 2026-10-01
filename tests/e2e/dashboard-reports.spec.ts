import { expect, test } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { Workbook } from "exceljs";
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
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07&details=open&funnel=open&funnelMonth=2026-07");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Vacancy Waterfall" })).toBeVisible();
  const combinedReport = page.getByRole("button", { name: /Vacancy Waterfall & Requisitions Active in Selected Period/ });
  await expect(combinedReport).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Requisitions Active in Selected Period", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recruitment Pipeline Health in Selected Range/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Metric view", exact: true })).toContainText("Performance in Month");
  await expect(page.getByRole("button", { name: "Report month", exact: true })).toContainText("Jul 2026");
  await expect(page.getByRole("heading", { name: "Recruitment Pipeline Health" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export Vacancy Waterfall PNG" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export Recruitment Pipeline Health PNG" })).toHaveCount(1);
  await expect(page.getByLabel("Recruitment channel colors").first()).toContainText("Facebook");
  await combinedReport.click();
  await expect(combinedReport).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: "Requisitions Active in Selected Period", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Export Vacancy Waterfall PNG" })).toBeEnabled();
  await combinedReport.click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(combinedReport).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("button", { name: "Export PDF" })).toHaveCount(0);
  await page.getByRole("button", { name: "Export Requisitions Active in Selected Period", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Export Requisitions Active in Selected Period XLSX" })).toBeVisible();
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
  await page.goto("/dashboard?funnel=open&funnelMonth=2026-07");
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

test("Pipeline report controls, legend toggle and Source effectiveness share one eligible period", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "admin_recruiter" });
  data.candidates.find((row) => row.candidate_id === "C-PHONE-PASS")!.channel = "Unexpected channel";
  data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06")!.applicants_referral = 1;
  data.offers[1].start_confirmation = "did_not_start";
  data.offers.push({ ...data.offers[1], offer_id: 999, accepted_date: "2026-07-18" });
  await page.setViewportSize({ width: 1080, height: 900 });
  await page.goto("/dashboard?funnel=open&funnelView=pim&funnelMonth=2026-07");
  await expectWorkspaceReady(page);
  const funnel = page.locator(".pipeline-funnel").first();
  const source = page.getByTestId("source-effectiveness").first();
  await expect(funnel.getByTestId("pipeline-total-summary")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Recruitment Pipeline Health Metric view" })).toContainText("Performance in Month");
  await expect(source.getByRole("heading", { name: "Source effectiveness" })).toBeVisible();
  const referral = source.locator('.source-detail-wide tr[data-channel="channel_referral"]');
  await expect(referral.locator("td").nth(2)).toContainText("(33%)");
  await expect(referral.locator("td").nth(1)).toContainText("(300%)");
  const referralPhoneBar = referral.locator('[data-mini-measure="phone"]');
  await expect(referralPhoneBar).toHaveAttribute("aria-label", /of this channel's Applicants: 300%; bar capped at 100%/);
  await expect(referralPhoneBar.locator("span.h-full")).toHaveCSS("width", /\d+px/);
  await expect(referralPhoneBar.locator("[data-mini-baseline]")).toHaveCSS("background-color", "rgb(236, 221, 244)");
  await expect(referralPhoneBar).toContainText(">100%");
  await expect(source.locator('.source-detail-wide tr[data-channel="Unexpected channel"]')).toHaveCount(0);
  const unknown = source.locator('.source-detail-wide tr[data-channel="unknown"]');
  await expect(unknown.locator("td").nth(1)).toContainText("(—)");
  await expect(unknown.locator('[data-mini-measure="phone"]')).toContainText("+");
  await expect(unknown.locator('[data-mini-measure="phone"] [data-mini-track]')).toHaveAttribute("data-channel-tint", "#e4e8ed");
  await expect(source.locator('[data-measure="phone"]')).toContainText("Phone Screening");
  await source.getByRole("button", { name: "Source effectiveness help" }).click();
  await expect(page.getByRole("tooltip")).toContainText("passed Phone Screen");
  const headers = await funnel.locator(".grid").first().locator(":scope > div").allTextContents();
  expect(headers.slice(0, 5).map((value) => value.trim())).toEqual(["Funnel", "Stage", "Count", "Con%", "Yield"]);
  await expect(funnel.locator("[tabindex='0']").first()).toHaveCSS("justify-content", "flex-end");
  await expect(funnel.locator("[tabindex='0']").first()).toHaveCSS("border-radius", "0px");
  const legendSwitch = page.getByRole("switch", { name: "Channel legend" });
  await expect(legendSwitch).toHaveCSS("width", "64px");
  await expect(legendSwitch).toHaveCSS("height", "32px");
  await expect(legendSwitch).toHaveCSS("background-color", "rgb(50, 153, 214)");
  await expect(legendSwitch.locator(".ats-square-switch-label")).toHaveText("ON");
  expect(await legendSwitch.evaluate((element) => element.querySelector(".ats-square-switch-thumb")!.getBoundingClientRect().x > element.querySelector(".ats-square-switch-label")!.getBoundingClientRect().x)).toBe(true);
  expect(await legendSwitch.evaluate((element) => getComputedStyle(element, "::before").content)).toBe("none");
  await legendSwitch.click();
  await expect(legendSwitch.locator(".ats-square-switch-label")).toHaveText("OFF");
  expect(await legendSwitch.evaluate((element) => element.querySelector(".ats-square-switch-thumb")!.getBoundingClientRect().x < element.querySelector(".ats-square-switch-label")!.getBoundingClientRect().x)).toBe(true);
  await expect(funnel.getByLabel("Recruitment channel colors")).toHaveCount(0);
  await expect(source.locator('[data-measure="applicants"] [data-channel]')).not.toHaveCount(0);
  await expect(page).toHaveURL(/funnelLegend=off/);
  await page.reload();
  await expectWorkspaceReady(page);
  await expect(page.getByRole("switch", { name: "Channel legend" })).not.toBeChecked();
  await page.getByRole("switch", { name: "Channel legend" }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("switch", { name: "Channel legend" })).toBeChecked();
  await page.getByRole("button", { name: "Recruitment Pipeline Health Metric view" }).click();
  await page.getByRole("option", { name: "Year to Date" }).click();
  await expect(page).toHaveURL(/funnelView=ytd/);
  await expect(page.getByRole("button", { name: "Metric view", exact: true })).toContainText("Month to Date");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Pipeline MTD eligibility differs from PIM and legacy dates restore Custom", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "admin_recruiter" });
  const oldRequisition = data.requisitions.find((row) => row.doc_id === "REQ-KT1-PEER")!;
  oldRequisition.pr_approved_date = "2026-01-01";
  oldRequisition.level = "3";
  await page.goto("/dashboard?funnel=open&funnelView=mtd&funnelMonth=2026-07");
  await expectWorkspaceReady(page);
  const applicants = page.locator(".pipeline-funnel").first().locator("div.contents").first().locator(":scope > div").nth(2);
  const mtd = Number((await applicants.innerText()).replaceAll(",", ""));
  await page.getByRole("button", { name: "Recruitment Pipeline Health Metric view" }).click();
  await page.getByRole("option", { name: "Performance in Month" }).click();
  const pim = Number((await applicants.innerText()).replaceAll(",", ""));
  expect(pim - mtd).toBe(3);
  await page.goto("/dashboard?funnel=open&funnelStart=2026-07-01&funnelEnd=2026-07-31");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("button", { name: "Recruitment Pipeline Health Metric view" })).toContainText("Custom range");
  await expect(page).toHaveURL(/funnelView=custom/);
});

test("Pipeline panels and compact filters fit from 1080px, while Source bars retain readable labels", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const { data } = await installMockSupabase(page, { role: "admin_recruiter" });
  const update = data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06")!;
  for (const column of ["applicants_fb", "applicants_jobthai", "applicants_jobtopgun", "applicants_jobdb", "applicants_jobbkk", "applicants_linkedin", "applicants_walkin", "applicants_referral", "applicants_others"]) (update as unknown as Record<string, number>)[column] = 1;
  await page.setViewportSize({ width: 1080, height: 900 });
  await page.goto("/dashboard?funnel=open&funnelView=custom&funnelStart=2026-07-01&funnelEnd=2026-07-31");
  await expectWorkspaceReady(page);
  const layout = page.getByTestId("pipeline-source-layout");
  const funnel = layout.locator(".pipeline-funnel");
  const source = layout.getByTestId("source-effectiveness");
  const positions = await layout.locator(":scope > *").evaluateAll((elements) => elements.map((element) => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y })));
  expect(positions[1].x).toBeGreaterThan(positions[0].x);
  expect(positions[1].y).toBe(positions[0].y);
  const widths = await layout.locator(":scope > *").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
  expect(Math.abs(widths[0] / widths[1] - 1.5)).toBeLessThan(0.03);
  await expect(source.locator(".source-detail-wide")).toBeVisible();
  await expect(source.locator(".source-detail-compact")).toBeHidden();
  await expect(source.locator(".source-detail-wide thead th")).toHaveText(["Channel", "Applicants", "Phone Screening", "Hired"]);
  expect(await source.locator(".source-detail-wide thead th").evaluateAll((headers) => headers.every((header) => getComputedStyle(header).textAlign === "left"))).toBe(true);
  expect(await source.locator(".source-detail-wide thead th").evaluateAll((headers) => {
    const widths = headers.slice(1).map((header) => header.getBoundingClientRect().width);
    return Math.max(...widths) - Math.min(...widths) <= 1;
  })).toBe(true);
  expect(await source.locator(".source-detail-wide table").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await source.screenshot({ path: testInfo.outputPath("source-1080.png") });
  await page.getByTestId("pipeline-filters").screenshot({ path: testInfo.outputPath("pipeline-filters.png") });
  const filterBottoms = await page.getByTestId("pipeline-filters").locator(":scope > *").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().bottom));
  expect(new Set(filterBottoms).size).toBe(1);
  expect(await funnel.locator(".grid").first().evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await funnel.locator(".grid div.contents span[title]").evaluateAll((elements) => elements.every((element) => getComputedStyle(element).textOverflow !== "ellipsis" && element.scrollWidth <= element.clientWidth + 1))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await funnel.getByRole("button", { name: "Recruitment Pipeline Health help" }).click();
  await expect(page.getByRole("tooltip")).toContainText("passed result dated in the selected range");
  await source.getByRole("button", { name: "Source effectiveness help" }).click();
  await expect(page.getByRole("tooltip")).toContainText("Same-period activity");
  const applicants = source.locator('[data-measure="applicants"]');
  await expect(applicants.locator(":scope > div").first()).toContainText(/^Applicants: \d/);
  await expect(source.locator('[data-measure="phone"] > div').first()).toContainText(/^Phone Screening: \d/);
  await expect(source.locator('[data-measure="hired"] > div').first()).toContainText(/^Hired: \d/);
  await expect(applicants.locator('[data-channel]')).toHaveCount(9);
  await expect(applicants.locator('[role="img"]')).toHaveCSS("height", "20px");
  expect((await applicants.locator('[data-channel]').allTextContents()).every((label) => /^\d[\d,]* \(\d+%\)$/.test(label))).toBe(true);
  expect(await applicants.locator('[data-channel]').first().evaluate((element) => getComputedStyle(element).color)).toBe("rgb(248, 250, 252)");
  expect(await applicants.locator('[data-channel]').first().evaluate((element) => getComputedStyle(element).fontWeight)).toBe("300");
  expect(await applicants.locator('[data-channel]').first().evaluate((element) => getComputedStyle(element).textShadow)).toBe("none");
  expect(await applicants.locator('[role="img"]').evaluate((bar) => bar.scrollWidth <= bar.clientWidth + 1)).toBe(true);
  expect(await applicants.locator('[data-channel]').evaluateAll((segments) => {
    const barWidth = segments[0].parentElement!.getBoundingClientRect().width;
    const counts = segments.map((segment) => Number(segment.getAttribute("title")?.match(/: ([\d,]+) \(/)?.[1].replaceAll(",", "") ?? 0));
    const total = counts.reduce((sum, count) => sum + count, 0);
    return segments.every((segment, index) => Math.abs(segment.getBoundingClientRect().width / barWidth - counts[index] / total) < 0.005);
  })).toBe(true);
  await expect(applicants.locator('[data-channel][data-label-visible="false"]').first()).toBeAttached();
  const exportSource = page.locator(".export-report-surface").getByTestId("source-effectiveness");
  await expect(exportSource.locator('[data-measure="applicants"] [role="img"]')).toHaveCSS("height", "24px");
  expect(await exportSource.locator('[data-measure="applicants"] [role="img"]').evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(exportSource.locator(".source-detail-wide")).toBeVisible();
  await expect(exportSource.locator(".source-detail-compact")).toBeHidden();
  expect(await exportSource.locator(".source-detail-wide [data-metric-value]").first().evaluate((element) => {
    const value = element.firstElementChild!.getBoundingClientRect();
    const track = element.querySelector("[data-mini-track]")!.getBoundingClientRect();
    const cell = element.closest("td")!.getBoundingClientRect();
    return getComputedStyle(element).gridTemplateColumns.split(" ").length === 1 && getComputedStyle(element.firstElementChild!).textAlign === "right" && value.bottom <= track.top && cell.right - track.right >= 4;
  })).toBe(true);
  const exportSurface = page.locator('.export-report-surface:has([data-testid="source-effectiveness"])');
  await expect(exportSurface.locator("h1")).toContainText("Recruitment Pipeline Health in Selected Range");
  await expect(exportSurface).toContainText("Date range:");
  await expect(exportSurface.locator("h4 + svg")).toHaveCount(2);
  await expect(exportSource.locator('[data-measure="applicants"] [data-channel] > span').first()).toHaveCSS("white-space", "nowrap");
  expect(await exportSurface.locator(":scope > div:last-child > section").evaluateAll((cards) => Math.abs(cards[0].getBoundingClientRect().width / cards[1].getBoundingClientRect().width - 1.5) < 0.03)).toBe(true);
  expect(await exportSurface.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const exportGeometry = await exportSurface.evaluate((surface) => {
    const cardChecks = Array.from(surface.querySelectorAll<HTMLElement>(".pipeline-funnel, .source-effectiveness")).map((card) => ({
      overflow: getComputedStyle(card).overflow,
      fitsWidth: card.scrollWidth <= card.clientWidth + 1,
      fitsHeight: card.scrollHeight <= card.clientHeight + 1,
      insideSlide: card.getBoundingClientRect().bottom <= surface.getBoundingClientRect().bottom + 1
    }));
    const funnelWrapper = surface.querySelector<HTMLElement>(".pipeline-funnel > div:last-child")!;
    const sourceTable = surface.querySelector<HTMLElement>(".source-detail-wide")!;
    return { cardChecks, funnelOverflowX: getComputedStyle(funnelWrapper).overflowX, funnelOverflowY: getComputedStyle(funnelWrapper).overflowY, funnelFits: funnelWrapper.scrollWidth <= funnelWrapper.clientWidth + 1 && funnelWrapper.scrollHeight <= funnelWrapper.clientHeight + 1, sourceFits: sourceTable.scrollWidth <= sourceTable.clientWidth + 1 && sourceTable.scrollHeight <= sourceTable.clientHeight + 1 };
  });
  expect(exportGeometry.cardChecks.every((card) => card.fitsWidth && card.fitsHeight && card.insideSlide), JSON.stringify(exportGeometry)).toBe(true);
  expect(exportGeometry.funnelOverflowX).not.toMatch(/auto|scroll/);
  expect(exportGeometry.funnelOverflowY).not.toMatch(/auto|scroll/);
  expect(exportGeometry.funnelFits, JSON.stringify(exportGeometry)).toBe(true);
  expect(exportGeometry.sourceFits, JSON.stringify(exportGeometry)).toBe(true);
  const exportFunnelGrid = exportSurface.locator(".pipeline-funnel .grid").first();
  expect(await exportFunnelGrid.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(950);
  expect(await exportFunnelGrid.evaluate((element) => element.firstElementChild!.getBoundingClientRect().width / element.getBoundingClientRect().width)).toBeGreaterThan(0.47);
  expect(await exportSurface.locator(".pipeline-funnel div.contents").first().locator("[tabindex='0']").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(100);
  expect(await exportSurface.locator(".pipeline-funnel div.contents").first().locator("[title^='Facebook:']").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(0);
  expect(await exportSurface.evaluate((element) => element.querySelector(".pipeline-funnel")!.getBoundingClientRect().bottom >= element.getBoundingClientRect().bottom - 36)).toBe(true);
  const sourceTable = source.locator(".source-detail-wide table");
  expect(await sourceTable.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await sourceTable.evaluate((element) => element.getBoundingClientRect().right <= element.closest('section')!.getBoundingClientRect().right + 1)).toBe(true);
  const firstMetric = source.locator(".source-detail-wide [data-metric-value]").first();
  expect(await firstMetric.evaluate((element) => element.firstElementChild?.tagName)).toBe("SPAN");
  await expect(firstMetric).toHaveCSS("display", "grid");
  await expect(firstMetric.locator("span").first()).toHaveCSS("text-align", "right");
  await expect(firstMetric).toHaveCSS("padding-right", "4px");
  expect(await firstMetric.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(1);
  expect(await firstMetric.evaluate((element) => {
    const value = element.firstElementChild!.getBoundingClientRect();
    const track = element.querySelector("[data-mini-track]")!.getBoundingClientRect();
    const cell = element.closest("td")!.getBoundingClientRect();
    return value.bottom <= track.top && cell.right - track.right >= 4;
  })).toBe(true);
  const compactBarWidth = await firstMetric.locator("[data-mini-track]").evaluate((element) => element.getBoundingClientRect().width);
  expect(compactBarWidth).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  const wide = await layout.locator(":scope > *").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
  expect(wide[1]).toBe(wide[0]);
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect(source.locator(".source-detail-wide")).toBeVisible();
  expect(await source.locator(".source-detail-wide table").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await firstMetric.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
  expect(await firstMetric.evaluate((element) => element.firstElementChild!.getBoundingClientRect().right < element.querySelector("[data-mini-track]")!.getBoundingClientRect().left)).toBe(true);
  expect(await firstMetric.locator("[data-mini-track]").evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(compactBarWidth);
  await page.getByRole("switch", { name: "Channel legend" }).click();
  await expect(exportSurface.getByLabel("Recruitment channel colors")).toHaveCount(0);
  const desktopPngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Recruitment Pipeline Health PNG" }).click();
  const desktopDownload = await desktopPngPromise;
  await desktopDownload.saveAs(testInfo.outputPath("pipeline-presentation.png"));
  const desktopPng = await inspectPng(await desktopDownload.createReadStream());
  expect([desktopPng.width, desktopPng.height, desktopPng.visible]).toEqual([3840, 2160, true]);
  await page.setViewportSize({ width: 1079, height: 900 });
  const stacked = await layout.locator(":scope > *").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().y));
  expect(stacked[1]).toBeGreaterThan(stacked[0]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("switch", { name: "Channel legend" })).toHaveCSS("width", "64px");
  await expect(page.getByRole("switch", { name: "Channel legend" })).toHaveCSS("height", "44px");
  await expect(source.locator(".source-detail-compact")).toBeVisible();
  await expect(exportSource.locator(".source-detail-wide")).toBeVisible();
  await expect(exportSource.locator(".source-detail-compact")).toBeHidden();
  expect(await exportSurface.evaluate((surface) => {
    const funnelWrapper = surface.querySelector<HTMLElement>(".pipeline-funnel > div:last-child")!;
    const sourceTable = surface.querySelector<HTMLElement>(".source-detail-wide")!;
    return surface.scrollWidth <= surface.clientWidth + 1 && surface.scrollHeight <= surface.clientHeight + 1 && funnelWrapper.scrollWidth <= funnelWrapper.clientWidth + 1 && funnelWrapper.scrollHeight <= funnelWrapper.clientHeight + 1 && sourceTable.scrollWidth <= sourceTable.clientWidth + 1 && sourceTable.scrollHeight <= sourceTable.clientHeight + 1;
  })).toBe(true);
  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Recruitment Pipeline Health PNG" }).click();
  const phoneDownload = await pngPromise;
  await phoneDownload.saveAs(testInfo.outputPath("pipeline-presentation-phone.png"));
  const png = await inspectPng(await phoneDownload.createReadStream());
  expect(png.visible).toBe(true);
  expect(png.width).toBe(3840);
  expect(png.height).toBe(2160);
  await page.setViewportSize({ width: 1080, height: 900 });
  await page.getByRole("button", { name: "TH", exact: true }).focus();
  await page.keyboard.press("Enter");
  const thaiFilterBottoms = await page.getByTestId("pipeline-filters").locator(":scope > *").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().bottom));
  expect(new Set(thaiFilterBottoms).size).toBe(1);
  await expect(source.locator('[data-measure="phone"]')).toContainText("คัดกรองโทรศัพท์");
  expect(await funnel.locator(".grid div.contents span[title]").evaluateAll((elements) => elements.every((element) => getComputedStyle(element).textOverflow !== "ellipsis" && element.scrollWidth <= element.clientWidth + 1))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Pipeline export keeps crowded labels and a single-channel table within the slide", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "admin_recruiter" });
  const update = data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06")!;
  for (const column of ["applicants_fb", "applicants_jobthai", "applicants_jobtopgun", "applicants_jobdb", "applicants_jobbkk", "applicants_linkedin", "applicants_walkin", "applicants_referral", "applicants_others"]) (update as unknown as Record<string, number>)[column] = column === "applicants_fb" ? 8999 : 1;
  await page.goto("/dashboard?funnel=open&funnelView=custom&funnelStart=2026-07-01&funnelEnd=2026-07-31");
  await expectWorkspaceReady(page);
  const exportSurface = page.locator('.export-report-surface:has([data-testid="source-effectiveness"])');
  const applicantsSegment = exportSurface.locator('[data-measure="applicants"] [data-channel]').first();
  await expect(applicantsSegment).toHaveAttribute("data-label-visible", "true");
  await expect(exportSurface.locator('[data-measure="applicants"] [data-channel="channel_jobthai"]')).toHaveAttribute("data-label-visible", "false");
  expect(await exportSurface.locator('[data-measure="applicants"] [data-channel]').evaluateAll((segments) => {
    const barWidth = segments[0].parentElement!.getBoundingClientRect().width;
    const dominant = segments[0].getBoundingClientRect().width / barWidth;
    const others = segments.slice(1).map((segment) => segment.getBoundingClientRect().width / barWidth);
    return Math.abs(dominant - 8999 / 9007) < 0.005 && others.every((share) => Math.abs(share - 1 / 9007) < 0.005);
  })).toBe(true);
  expect(await exportSurface.evaluate((surface) => surface.scrollWidth <= surface.clientWidth + 1 && surface.scrollHeight <= surface.clientHeight + 1)).toBe(true);
  await page.goto("/dashboard?funnel=open&funnelView=custom&funnelStart=2026-07-01&funnelEnd=2026-07-31&funnelChannel=Facebook");
  await expectWorkspaceReady(page);
  const sourceTable = exportSurface.locator(".source-detail-wide table");
  await expect(sourceTable.locator("tbody tr")).toHaveCount(1);
  expect(await sourceTable.evaluate((table) => table.getBoundingClientRect().height)).toBeLessThan(150);
  expect(await exportSurface.evaluate((surface) => surface.scrollWidth <= surface.clientWidth + 1 && surface.scrollHeight <= surface.clientHeight + 1)).toBe(true);
});

test("Requisitions export offers all channel counts and preserves shared-group numbers in XLSX and PNG", async ({ page }) => {
  const { data } = await installMockSupabase(page, { role: "admin_recruiter" });
  const update = data.sourcing_weekly_updates.find((row) => row.group_id === "GRP-ENG" && row.week_start === "2026-07-06")!;
  for (const [index, count] of ["applicants_fb", "applicants_jobthai", "applicants_jobtopgun", "applicants_jobdb", "applicants_jobbkk", "applicants_linkedin", "applicants_walkin", "applicants_referral", "applicants_others"].entries()) (update as unknown as Record<string, number>)[count] = index + 1;
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Export Requisitions Active in Selected Period", exact: true }).click();
  const modal = page.getByRole("dialog");
  const labels = ["Facebook", "JobThai", "JobTopGun", "JobsDB", "JobBKK", "LinkedIn", "Walk-in", "Referral", "Others"];
  for (const label of labels) {
    const option = modal.getByRole("checkbox", { name: `${label} Applicants` });
    await expect(option).not.toBeChecked();
    await option.check();
  }
  await expect(modal.getByRole("columnheader", { name: "JobsDB Applicants" })).toBeVisible();
  const exportTable = page.locator(".export-report-surface").filter({ has: page.locator(".print-detail-table") }).first().locator("table");
  await expect(exportTable.locator("th", { hasText: "JobsDB Applicants" })).toHaveCount(1);
  const downloadPromise = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Export Requisitions Active in Selected Period XLSX" }).click();
  const download = await downloadPromise;
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk));
  const workbook = new Workbook();
  await workbook.xlsx.load(Buffer.concat(chunks));
  const sheet = workbook.worksheets[0];
  const header = sheet.getRow(2).values as Array<string | undefined>;
  expect(labels.every((label) => header.includes(`${label} Applicants`))).toBe(true);
  const jobsDbColumn = header.indexOf("JobsDB Applicants");
  const vacancyColumn = header.indexOf("Vacancy");
  const engineerRows = Array.from({ length: sheet.rowCount - 2 }, (_, index) => sheet.getRow(index + 3)).filter((row) => [1, 5].includes(Number(row.getCell(vacancyColumn).value)) && row.values?.toString().includes("Engineer"));
  expect(engineerRows).toHaveLength(2);
  expect(engineerRows.map((row) => row.getCell(jobsDbColumn).value)).toEqual([4, 4]);
  await expect(exportTable.locator("tbody tr").filter({ hasText: "Engineer" })).toHaveCount(2);
  const pngPromise = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Export Requisitions Active in Selected Period PNG" }).click();
  const png = await pngPromise;
  expect(png.suggestedFilename()).toBe("active-requisitions-2026-07-01-to-2026-07-31.png");
  expect((await inspectPng(await png.createReadStream())).visible).toBe(true);
});

test("dashboard PNG exports download visible non-blank reports", async ({ page }) => {
  test.setTimeout(90_000);
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07&details=open&funnel=open&funnelMonth=2026-07");
  await expectWorkspaceReady(page);

  const directExportButtons = page.getByRole("button", { name: /Export Vacancy Waterfall PNG|Export Recruitment Pipeline Health PNG/ });
  await expect(directExportButtons).toHaveCount(2);
  const waterfallExportSurface = page.locator(".export-report-surface").filter({ has: page.locator(".vacancy-waterfall-svg") });
  await expect(waterfallExportSurface.locator("h3")).toContainText("Recruitment Performance in Selected Period");
  await expect(waterfallExportSurface).toContainText("During the selected period, total vacancies");
  await expect(waterfallExportSurface.locator(".waterfall-executive-table")).toHaveCSS("overflow-x", "visible");

  for (const [index, filename] of [
    "vacancy-waterfall-2026-07-01-to-2026-07-31.png",
    "pipeline-funnel-2026-07-01-to-2026-07-31.png"
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

  await page.getByRole("button", { name: "Export Requisitions Active in Selected Period", exact: true }).click();
  const modal = page.getByRole("dialog");
  const modalPngExport = modal.getByRole("button", { name: "Export Requisitions Active in Selected Period PNG" });
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
