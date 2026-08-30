import { expect, test } from "@playwright/test";
import { inflateSync } from "node:zlib";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("dashboard report uses calendar views, persists its month, and keeps expandable sections", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07&details=open&funnel=open");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Vacancy Waterfall" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Requisitions Active in Selected Period/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recruitment Pipeline Health in Selected Range/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Metric view" })).toContainText("Performance in Month");
  await expect(page.getByRole("button", { name: "Report month" })).toContainText("Jul 2026");
  await expect(page.getByRole("heading", { name: "Recruitment Pipeline Health" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PNG" })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Export PNG" }).first()).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export PDF" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export XLSX" })).toBeVisible();
});

test("dashboard PNG exports download visible non-blank reports", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07&details=open&funnel=open");
  await expectWorkspaceReady(page);

  const filenames = [
    "vacancy-waterfall-2026-07-01-to-2026-07-31.png",
    "active-requisitions-2026-07-01-to-2026-07-31.png",
    /^pipeline-funnel-2026-01-01-to-\d{4}-\d{2}-\d{2}\.png$/
  ];
  const exportButtons = page.getByRole("button", { name: "Export PNG" });
  await expect(exportButtons).toHaveCount(3);

  for (const [index, filename] of filenames.entries()) {
    await expect(exportButtons.nth(index)).toBeEnabled();
    const downloadPromise = page.waitForEvent("download");
    await exportButtons.nth(index).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(filename);
    expect(await isVisiblePng(await download.createReadStream())).toBe(true);
  }
});

async function isVisiblePng(stream: NodeJS.ReadableStream | null) {
  if (!stream) return false;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const png = Buffer.concat(chunks);
  if (png.length < 32 || png.subarray(1, 4).toString() !== "PNG") return false;

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
  if (width < 2 || height < 2 || idat.length === 0) return false;

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
      if (row[x + 3] > 0 && (row[x] < 245 || row[x + 1] < 245 || row[x + 2] < 245)) return true;
    }
    row.copy(previousRow);
  }
  return false;
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

  await expect(page.getByText("Eligible vacancies", { exact: true })).toBeVisible();
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

  await expect(page.getByText("August HQ role", { exact: true })).toBeVisible();
  await expect(page.getByText("Expired HQ role", { exact: true })).toHaveCount(0);
  await expect(page.locator(".vacancy-waterfall-svg")).not.toContainText("-1");
});

test("dashboard active-period labels localize and fit at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  await page.goto("/dashboard?reportView=mtd&reportMonth=2026-06");
  await expect(page.locator("[data-app-header-actions]")).toBeVisible();
  await expect(page.getByText("อัตราที่เข้าเกณฑ์", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("home records use tabbed vertical panels while work queue keeps contained overflow", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  await page.getByRole("dialog", { name: "Welcome Back" }).getByRole("button", { name: "Close", exact: true }).last().click();
  const pipelineTab = page.getByRole("tab", { name: /Candidate Pipeline/ });
  await pipelineTab.click();
  await expect(pipelineTab).toHaveAttribute("aria-selected", "true");
  const tabPanel = page.getByRole("tabpanel");
  await expect(tabPanel).toBeVisible();
  await expect(tabPanel).toHaveCSS("overflow-y", "auto");
  await expect(tabPanel.getByText("Pat Phone")).toBeVisible();
  await expect(tabPanel.getByText("Tina Test")).toBeVisible();
  await expect(page.getByRole("button", { name: /Show all .* pipeline items/ })).toHaveCount(0);

  const workScroller = page.locator('[data-home-scroll-section="Today\'s Work"]');
  await expect(workScroller).toBeVisible();
  await expect(workScroller).toHaveCSS("overflow-y", "auto");
  await expect(page.getByRole("button", { name: /Show all .* data quality issues/ })).toHaveCount(0);
});
