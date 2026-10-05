import { expect, test, type Page } from "@playwright/test";
import { Workbook, type Worksheet } from "exceljs";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";
import { enrichOffers, enrichRequisitions } from "../../src/lib/data";
import { buildPerformanceReport, previousPerformanceRange } from "../../src/lib/recruitment-performance";
import { buildPipelineReport } from "../../src/lib/pipeline-report";
import { buildPerformanceExportSnapshot, buildPipelineExportSnapshot, createDashboardWorkbook } from "../../src/lib/dashboard-workbook";
import { dashboardDefaults } from "../../src/lib/dashboard-filters";
import type { DashboardReportContext } from "../../src/components/dashboard/DashboardPortal";
function context(data: Awaited<ReturnType<typeof installMockSupabase>>["data"]): DashboardReportContext {
    return { language: "en", data, requisitions: enrichRequisitions(data), offers: enrichOffers(data), candidateOffers: data.offers, preferences: { ...dashboardDefaults("2026-07-24"), period: "pim", month: "2026-07" }, range: { start: "2026-07-01", end: "2026-07-31", valid: true }, summary: "01/07/2026 – 31/07/2026 · PIM · Site: All · Department: All · Job Level: All · PIC: All", headerScope: { site: "", owner: "", priorityOnly: false }, supportedFilters: ["period", "site", "department", "level"], onPreferencesChange: () => { } };
}
type SectionView = Pick<Worksheet, "rowCount" | "getRow" | "getCell" | "getSheetValues">;
const sectionIds: Record<string, string> = { "Read Me": "readme", "KPI Summary": "kpi", "Site & Level": "matrix", "Vacancy Mix": "mix", "SLA": "sla", "Requisitions": "requisitions", "Acceptances": "acceptances", "Pipeline Summary": "pipeline", "Pipeline Channels": "channels", "Source Summary": "sources", "Stage Records": "stages", "Hire Records": "hires", "Sourcing Rows": "sourcing", "สรุปขั้นตอนสรรหา": "pipeline", "กิจกรรมผู้สมัคร": "stages" };
/** Read real table ranges in the downloaded two-sheet workbook; preserve cell types. */
function section(book: Workbook, title: string): SectionView {
    for (const ws of book.worksheets) for (const report of ["performance", "pipeline"]) {
        const table = ws.getTable(`Dashboard_${report}_${sectionIds[title]}`);
        if (!table) continue;
        const ref = (table as unknown as { model: { tableRef: string } }).model.tableRef;
        const match = ref.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/)!;
        const start = Number(match[1]), end = Number(match[2]);
        return { rowCount: end - start + 2,
            getRow: (row: number) => ws.getRow(start + row - 2),
            getCell: (row: number, col: number) => ws.getCell(start + row - 2, col),
            getSheetValues: () => Array.from({ length: end - start + 1 }, (_, i) => ws.getRow(start + i).values) } as SectionView;
    }
    throw new Error(`Missing table section: ${title}`);
}
function column(sheet: SectionView, name: string) { const values = sheet.getRow(2).values as string[]; return values.indexOf(name); }
function sum(sheet: SectionView, name: string) { const col = column(sheet, name); return Array.from({ length: sheet.rowCount - 2 }, (_, i) => Number(sheet.getCell(i + 3, col).value ?? 0)).reduce((a, b) => a + b, 0); }
async function download(page: Page, report: "performance" | "pipeline") {
    const title = report === "performance" ? "Recruitment Performance" : "Pipeline & Sources";
    await page.getByRole("button", { name: `Export ${title}`, exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("dialog").getByRole("button", { name: `Export ${title} XLSX`, exact: true }).click();
    const file = await pending;
    const chunks: Buffer[] = [];
    for await (const chunk of (await file.createReadStream())!)
        chunks.push(Buffer.from(chunk));
    const book = new Workbook();
    await book.xlsx.load(Buffer.concat(chunks));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return { book, file };
}
test("Performance calculation and source contributions reconcile before workbook serialization", async ({ page }) => {
    const { data } = await installMockSupabase(page), c = context(data), current = buildPerformanceReport(data, c.requisitions, c.offers, c.range, "pim"), previous = buildPerformanceReport(data, c.requisitions, c.offers, previousPerformanceRange("pim", c.range), "pim");
    expect(current.requisitionContributions.reduce((n, r) => n + r.vacancies, 0)).toBe(current.metrics.vacancies);
    expect(current.acceptanceContributions.reduce((n, r) => n + r.counted, 0)).toBe(current.metrics.filled);
    const days = current.requisitionContributions.reduce((n, r) => n + r.timeTotal, 0), count = current.requisitionContributions.reduce((n, r) => n + r.timeCount, 0);
    expect(count ? days / count : null).toBe(current.metrics.avgTimeToFill);
    const snapshot = buildPerformanceExportSnapshot(c, current, previous, ["HQ", "KT1", "KT2"]);
    // Mutating source data after snapshot creation must not change workbook rows.
    const original = snapshot.sheets.flatMap(s => s.tables).find(s => s.id === "requisitions")!.rows[0].slice();
    data.requisitions[0].position = "changed";
    const book = await createDashboardWorkbook(snapshot);
    expect(snapshot.sheets.flatMap(s => s.tables).find(s => s.id === "requisitions")!.rows[0]).toEqual(original);
    expect(book.worksheets.map(s => s.name)).toEqual(["Summary Data", "Source Data"]);
    expect(book.worksheets.flatMap(ws => ws.getTables()).length).toBe(snapshot.sheets.flatMap(s => s.tables).length);
    for (const ws of book.worksheets) {
        const ranges = ws.getTables().map(table => (table as unknown as { model: { tableRef: string } }).model.tableRef.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/)!).map(match => [Number(match[1]), Number(match[2])]).sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < ranges.length; i++) expect(ranges[i][0]).toBeGreaterThan(ranges[i - 1][1] + 1);
        expect(ws.getColumn(2).width).toBeLessThanOrEqual(26);
    }
    const guide = section(book, "Read Me");
    expect(guide.getRow(2).hidden).toBe(true);
    expect(guide.getRow(3).outlineLevel).toBe(1);
    const kpi = section(book, "KPI Summary");
    expect(kpi.getCell(5, 3).numFmt).toBe("0%");
    expect(kpi.getCell(7, 3).numFmt).toBe("0.0");
});
test("Pipeline ledgers deduplicate stages, offers and shared groups with exact uncapped ratios", async ({ page }) => {
    const { data } = await installMockSupabase(page), c = context(data);
    data.recruitment_logs.push({ ...data.recruitment_logs.find(r => r.result === 1 && r.recruitment_process === "Phone Screen")!, log_id: 9001 });
    data.offers.push({ ...data.offers.find(r => r.accepted_date)!, offer_id: 9002 });
    data.sourcing_weekly_updates.find(r => r.group_id === "GRP-ENG" && r.week_start === "2026-07-06")!.applicants_referral = 1;
    const report = buildPipelineReport(data, data.offers, c.requisitions, c.range, "pim", [], "all", "en");
    expect(report.stageRecords.reduce((n, r) => n + r.phone, 0)).toBe(report.sourceRows.reduce((n, r) => n + r.phone, 0));
    expect(report.stageRecords.reduce((n, r) => n + r.resume, 0)).toBe(report.funnelRows.find(r => r.key === "Resume Screening")!.count);
    expect(report.hireRecords.reduce((n, r) => n + r.hired, 0)).toBe(new Set(report.hireRecords.map(r => r.candidateId)).size);
    expect(new Set(report.sourcingRecords.map(r => `${r.groupId}/${r.week}/${r.channel}`)).size).toBe(report.sourcingRecords.length);
    expect(report.sourcingRecords.reduce((n, r) => n + r.applicants, 0)).toBe(report.funnelRows[0].count);
    const book = await createDashboardWorkbook(buildPipelineExportSnapshot(c, report));
    expect(book.worksheets.map(s => s.name)).toEqual(["Summary Data", "Source Data"]);
    expect(sum(section(book, "Hire Records"), "Hired Contribution")).toBe(report.sourceRows.reduce((n, r) => n + r.hired, 0));
    const source = section(book, "Source Summary");
    expect(Array.from({ length: source.rowCount - 2 }, (_, i) => Number(source.getCell(i + 3, column(source, "Phone / Applicants")).value)).some(value => value > 1)).toBe(true);
});
test("Performance downloads readable summary and detail sheets with authorized identities", async ({ page }) => {
    const { data } = await installMockSupabase(page);
    data.candidates[0].name = "=FORMULA-LIKE";
    data.candidates[0].candidate_id = "0007";
    data.offers[0].candidate_id = "0007";
    data.offers[0].accepted_date = "2026-07-10";
    const seedReq = data.requisitions.find(r => r.doc_id === data.offers[0].doc_id)!;
    seedReq.pr_approved_date = "2026-07-01";
    seedReq.status = "ongoing";
    seedReq.head_count = 3;
    await page.goto("/dashboard?dashboardTab=performance&dashboardPeriod=pim&dashboardMonth=2026-07");
    await expectWorkspaceReady(page);
    const screenVacancies = Number(await page.locator('[data-performance-overview] [data-performance-report]').first().locator('[data-metric="vacancies"] [data-metric-value]').textContent());
    const { book, file } = await download(page, "performance");
    expect(file.suggestedFilename()).toBe("recruitment-performance-2026-07-01-to-2026-07-31.xlsx");
    const req = section(book, "Requisitions"), period = column(req, "Period"), vac = column(req, "Vacancies");
    const total = Array.from({ length: req.rowCount - 2 }, (_, i) => req.getRow(i + 3)).filter(r => r.getCell(period).value === "Current").reduce((n, r) => n + Number(r.getCell(vac).value), 0);
    expect(total).toBe(screenVacancies);
    const accepted = section(book, "Acceptances"), name = column(accepted, "Candidate Name"), id = column(accepted, "Candidate ID");
    const candidateRow = Array.from({ length: accepted.rowCount - 2 }, (_, i) => accepted.getRow(i + 3)).find(r => r.getCell(id).value === "0007")!;
    expect(candidateRow.getCell(name).value).toBe("=FORMULA-LIKE");
    expect(candidateRow.getCell(name).type).toBe(3);
    expect(candidateRow.getCell(column(accepted, "Acceptance Date")).value).toBeInstanceOf(Date);
    for (const sheet of book.worksheets) {
        expect(sheet.views[0].state).toBe("frozen");
        expect(JSON.stringify(sheet.model)).not.toContain("phone_no");
        expect(sheet.getRow(7).getCell(2).font.name).toBe("Sarabun");
        expect(sheet.getCell(4, 2).type).toBe(5);
        expect(sheet.views[0].ySplit).toBe(5);
    }
});
test("Pipeline Excel respects Channel, legend OFF, historical hires and header scope", async ({ page }) => {
    const { data } = await installMockSupabase(page);
    data.offers[1].start_confirmation = "did_not_start";
    await page.goto("/dashboard?dashboardTab=pipeline&dashboardPeriod=pim&dashboardMonth=2026-07&funnelChannel=Referral&funnelLegend=off&site=KT1");
    await expectWorkspaceReady(page);
    const { book, file } = await download(page, "pipeline");
    expect(file.suggestedFilename()).toBe("pipeline-sources-2026-07-01-to-2026-07-31.xlsx");
    const source = section(book, "Source Summary"), channel = column(source, "Channel");
    for (let i = 3; i <= source.rowCount; i++)
        expect(source.getCell(i, channel).value).toBe("Referral");
    expect(section(book, "Read Me").getSheetValues().flat().toString()).toContain("OFF");
    expect(sum(section(book, "Sourcing Rows"), "Applicants Contribution")).toBe(Number(section(book, "Pipeline Summary").getCell(3, 3).value));
    const req = section(book, "Requisitions");
    for (let i = 3; i <= req.rowCount; i++)
        expect(req.getCell(i, column(req, "Site")).value).toBe("KT1");
});
test("missing Performance candidate identity stays blank and does not remove fills", async ({ page }) => {
    const { data } = await installMockSupabase(page, { role: "viewer" });
    data.offers.forEach(r => r.candidate_id = "NO-AUTHORIZED-CANDIDATE");
    await page.goto("/dashboard?dashboardTab=performance&dashboardPeriod=pim&dashboardMonth=2026-07");
    await expectWorkspaceReady(page);
    const filled = Number(await page.locator('[data-performance-overview] [data-performance-report]').first().locator('[data-metric="filled"] [data-metric-value]').textContent());
    const { book } = await download(page, "performance"), sheet = section(book, "Acceptances");
    expect(sum(sheet, "Identity Available")).toBe(0);
    expect(sum(sheet, "Fill Contribution")).toBeGreaterThanOrEqual(filled);
    for (let i = 3; i <= sheet.rowCount; i++) {
        expect(sheet.getCell(i, column(sheet, "Candidate Name")).value).toBeNull();
        expect(sheet.getCell(i, column(sheet, "Candidate ID")).value).toBeNull();
    }
});
test("empty periods and Thai desktop chooser export valid workbooks with legacy collapse flags", async ({ page }) => {
    await installMockSupabase(page, { language: "th" });
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/dashboard?dashboardTab=pipeline&dashboardPeriod=pim&dashboardMonth=2000-01&funnel=closed&lang=th");
    await expectWorkspaceReady(page);
    await page.getByRole("button", { name: "ส่งออก กระบวนการและช่องทางสรรหา", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ส่งออก กระบวนการและช่องทางสรรหา", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "ส่งออก กระบวนการและช่องทางสรรหา", exact: true }).click();
    const pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "ส่งออก กระบวนการและช่องทางสรรหา XLSX", exact: true }).click();
    const file = await pending, chunks: Buffer[] = [];
    for await (const chunk of (await file.createReadStream())!)
        chunks.push(Buffer.from(chunk));
    const book = new Workbook();
    await book.xlsx.load(Buffer.concat(chunks));
    expect(book.worksheets.map(s => s.name)).toEqual(["ข้อมูลสรุป", "ข้อมูลต้นทาง"]);
    expect(section(book, "สรุปขั้นตอนสรรหา")).toBeDefined();
    expect(section(book, "กิจกรรมผู้สมัคร").rowCount).toBe(2);
});
test("chooser locks preparation and retries a failed download without losing filters", async ({ page }) => {
    await installMockSupabase(page);
    await page.goto("/dashboard?dashboardTab=performance&dashboardPeriod=pim&dashboardMonth=2026-07&performanceOpen=closed");
    await expectWorkspaceReady(page);
    await page.getByRole("button", { name: "Export Recruitment Performance", exact: true }).click();
    await page.evaluate(() => { const native = URL.createObjectURL; URL.createObjectURL = () => { URL.createObjectURL = native; throw new Error("Synthetic download failure"); }; });
    await page.getByRole("dialog").getByRole("button", { name: "Export Recruitment Performance XLSX" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Please try again");
    const pending = page.waitForEvent("download");
    await page.getByRole("dialog").getByRole("button", { name: "Export Recruitment Performance XLSX" }).click();
    await pending;
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/dashboardMonth=2026-07/);
});
test("preparing PNG keeps the chooser locked until download completes", async ({ page }) => {
    await installMockSupabase(page);
    await page.goto("/dashboard?dashboardTab=performance&dashboardPeriod=pim&dashboardMonth=2026-07");
    await expectWorkspaceReady(page);
    await page.evaluate(() => { let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; }); Object.defineProperty(document.fonts, "ready", { configurable: true, value: ready }); (window as unknown as {
        releaseExport: () => void;
    }).releaseExport = release; });
    await page.getByRole("button", { name: "Export Recruitment Performance", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Export overview PNG" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("status")).toHaveText("Preparing PNG…");
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Export Recruitment Performance XLSX" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    const pending = page.waitForEvent("download");
    await page.evaluate(() => (window as unknown as {
        releaseExport: () => void;
    }).releaseExport());
    await pending;
    await expect(dialog).toHaveCount(0);
});


test("both export choosers fit English and Thai desktop widths",async({page},testInfo)=>{
 await installMockSupabase(page);
 for(const language of ["en","th"])for(const width of [1440,1024])for(const tab of ["performance","pipeline"]){
  await page.setViewportSize({width,height:900});await page.goto(`/dashboard?dashboardTab=${tab}&dashboardPeriod=pim&dashboardMonth=2026-07&lang=${language}`);await expectWorkspaceReady(page);
  const title=tab==="performance"?(language==="th"?"ผลการสรรหา":"Recruitment Performance"):(language==="th"?"กระบวนการและช่องทางสรรหา":"Pipeline & Sources");
  await page.getByRole("button",{name:`${language==="th"?"ส่งออก":"Export"} ${title}`,exact:true}).click();
  const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=window.innerWidth+1&&element.scrollWidth<=element.clientWidth+1;})).toBe(true);
  expect(await dialog.getByRole("button").last().evaluate(element=>element.getBoundingClientRect().height)).toBe(width<640?44:32);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  if(tab==="pipeline"&&(width===1440||width===360))await page.screenshot({path:testInfo.outputPath(`export-${language}-${width}.png`),fullPage:true});
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);
 }
});
