import ExcelJS from "exceljs";
import { expect, test } from "@playwright/test";

const enabled = process.env.RECRUITMENT_PERIOD_END_PREVIEW === "1";
const overview = "/dashboard?dashboardTab=performance&performanceSubview=overview&dashboardPeriod=pim&dashboardMonth=2026-10";
const vacancy = overview.replace("performanceSubview=overview", "performanceSubview=vacancy");
const phone = { width: 390, height: 844 };

test.use({ channel: "chrome" });
test.skip(!enabled, "Requires the synthetic period-end preview stack");

test("period-end reporting, exports and lookup work with the synthetic SQL fixture", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem("recruitment_lang", "en"));
  await page.goto("/login");
  await page.locator('input[type="email"]').fill("recruitment-preview@example.test");
  await page.locator('input[type="password"]').fill("local-preview-only");
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/home/);

  await page.goto(vacancy);
  const summary = page.getByRole("region", { name: "Executive vacancy summary by site" });
  const rows = page.locator("tr[data-open-headcount]:visible");
  await expect(page.getByRole("columnheader", { name: "Start Status at Period End" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Opened in Period" })).toBeVisible();
  const carry = rows.filter({ hasText: "Operations analyst" });
  await expect(carry).toContainText("Nok");
  await expect(carry).toContainText("2 started · 1 did not start");
  await expect(carry).toContainText("4 approved · 2 open");
  const open = await rows.evaluateAll(items => items.reduce((total, row) => total + Number(row.getAttribute("data-open-headcount")), 0));
  await expect(summary.getByRole("row", { name: /^Total/ }).locator("td").last()).toHaveText(String(open));
  const requisitionFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Requisitions Active in Selected Period", exact: true }).click();
  await page.getByRole("button", { name: "Export Requisitions Active in Selected Period XLSX" }).click();
  const requisitions = new ExcelJS.Workbook();
  await requisitions.xlsx.readFile(await (await requisitionFile).path());
  const requisitionSheet = requisitions.worksheets[0];
  const columns = requisitionSheet.getRow(2).values as ExcelJS.CellValue[];
  expect(columns).toContain("Opened in Period");
  const dataRow = requisitionSheet.getRows(3, requisitionSheet.rowCount - 2)!
    .map(row => row.values as ExcelJS.CellValue[]).find(values => values.includes("Operations analyst"))!;
  expect(dataRow[columns.indexOf("Vacancy")]).toBe(4);
  expect(dataRow[columns.indexOf("Open Headcount at Period End")]).toBe(2);
  expect(dataRow[columns.indexOf("Start Status at Period End")]).toBe("2 started · 1 did not start");
  await page.keyboard.press("Escape");

  const before = await summary.innerText();
  await page.getByRole("searchbox", { name: "Search requisitions" }).fill("Quality technician");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Quality technician");
  expect(await summary.innerText()).toBe(before);

  await page.goto(overview);
  const note = page.locator("[data-start-attendance]:not([data-performance-export] *)");
  await expect(note.locator(":scope > strong")).toHaveText("Start confirmation");
  await expect(note.locator('[data-attendance-site="Total"]')).toContainText("7/10 (70%)");
  await expect(note.locator('[data-attendance-site="HQ"]')).toContainText("1 no-show");
  const overviewExport = page.locator("[data-performance-export] [data-start-attendance]");
  await expect(overviewExport.locator('[data-attendance-site="Total"]')).toContainText("7/10 (70%)");

  const workbook = page.waitForEvent("download");
  await page.getByRole("button", { name: /Export Recruitment Performance/i }).click();
  await page.getByRole("button", { name: /XLSX/i }).click();
  const download = await workbook;
  expect(download.suggestedFilename()).toBe("recruitment-performance-2026-10-01-to-2026-10-31.xlsx");
  const excel = new ExcelJS.Workbook();
  await excel.xlsx.readFile(await download.path());
  const sheet = excel.getWorksheet("Summary Data")!;
  const confirmation = sheet.getTable("Dashboard_performance_attendance");
  expect(confirmation).toBeTruthy();
  const total = sheet.getRows(1, sheet.rowCount)!.map(row => row.values).find(values =>
    Array.isArray(values) && values[2] === "Total" && values[3] === 10 && values[4] === 7 && values[5] === 1);
  expect((total as ExcelJS.CellValue[])[6]).toBe(0.7);

  for (const viewport of [{ width: 1440, height: 900 }, phone]) {
    const context = await browser.newContext({ storageState: await page.context().storageState(), viewport });
    try {
      const observed = await context.newPage();
      observed.setDefaultTimeout(7_000);
      const client = await context.newCDPSession(observed);
      await client.send("Network.enable");
      await client.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 1_250_000, uploadThroughput: 1_250_000 });
      const assets: string[] = [];
      observed.on("request", request => { if (/candidate-lookup-detective-v5-.*\.webp/i.test(request.url())) assets.push(request.url()); });
      await observed.addInitScript(() => {
        const state = { mountedAt: 0, paintedAt: 0 };
        Object.assign(window, { lookupArtworkTiming: state });
        const observer = new MutationObserver(() => {
          const image = document.querySelector<HTMLImageElement>("[data-lookup-illustration] img");
          if (!image || state.mountedAt) return;
          state.mountedAt = performance.now();
          void image.decode().then(() => requestAnimationFrame(() => { state.paintedAt = performance.now(); }));
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      await observed.goto(new URL("/home", page.url()).href);
      const lookup = observed.getByRole("dialog", { name: "Candidate lookup", exact: true });
      const image = lookup.locator("[data-lookup-illustration] img");
      await expect(image).toBeVisible();
      await expect.poll(() => observed.evaluate(() => Boolean((window as Window & { lookupArtworkTiming?: { paintedAt: number } }).lookupArtworkTiming?.paintedAt))).toBe(true);
      const timing = await observed.evaluate(() => {
        const { mountedAt, paintedAt } = (window as unknown as { lookupArtworkTiming: { mountedAt: number; paintedAt: number } }).lookupArtworkTiming;
        return Math.round(paintedAt - mountedAt);
      });
      testInfo.annotations.push({ type: "lookup image", description: `${viewport.width}px cold: ${timing} ms` });
      console.log(`Lookup artwork at ${viewport.width}px · ${timing} ms after mount`);
      expect(timing).toBeLessThanOrEqual(250);
      await test.step(`Search and reopen the lookup at ${viewport.width}px`, async () => {
        const welcome = observed.getByRole("dialog", { name: "Welcome back" });
        await welcome.locator('button[aria-label="Close"]').click();
        await lookup.getByRole("textbox", { name: "Find by phone prefix or full email" }).fill("080123");
        await expect(lookup).toContainText("Sample candidate");
        await lookup.getByRole("button", { name: "Close lookup" }).click();
        await observed.getByRole("button", { name: "Candidate lookup", exact: true }).click();
        await expect(image).toBeVisible();
        await image.evaluate(image => (image as HTMLImageElement).decode());
      });
      expect(new Set(assets).size).toBe(1);
      expect(await observed.evaluate(() => performance.getEntriesByType("resource")
        .filter(entry => /candidate-lookup-detective-v5-.*\.webp/i.test(entry.name) && (entry as PerformanceResourceTiming).transferSize > 0).length)).toBe(1);
      await expect(image).toHaveAttribute("alt", "");
      if (viewport.width === phone.width) {
        await observed.goto(new URL(overview + "&lang=th", page.url()).href);
        await expect(observed.locator("[data-desktop-required]")).toBeVisible();
        await observed.setViewportSize({ width: 1024, height: 844 });
        const thaiRemark = observed.locator('[data-start-attendance]:not([data-performance-export] *) [data-attendance-site="รวม"]');
        await expect(thaiRemark).toContainText("7/10");
        expect(await observed.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }

    } finally { await context.close(); }
  }
});
