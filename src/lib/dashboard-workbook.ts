import type { DashboardReportContext } from "@/components/dashboard/DashboardPortal";
import type { PerformanceReport, PerformanceCell } from "@/lib/recruitment-performance";
import { PERFORMANCE_BANDS } from "@/lib/recruitment-performance";
import type { PipelineReport } from "@/lib/pipeline-report";
import { validDateOnly } from "@/lib/dashboard-report-eligibility";
import type { EnrichedRequisition, Language } from "@/types/recruitment";
import { processStageLabel, requestTypeLabel, translate } from "@/lib/i18n/dictionary";
export type WorkbookCell = string | number | Date | null;
export type WorkbookColumn = {
    key: string;
    label: string;
    format?: string;
    width: number;
};
export type DashboardTableSpec = {
    id: string;
    title: string;
    columns: WorkbookColumn[];
    rows: WorkbookCell[][];
    description: string;
};
export type DashboardSheetSpec = {
    id: "summary" | "source";
    title: string;
    tables: DashboardTableSpec[];
};
export type ReportExportSnapshot = {
    reportId: "performance" | "pipeline" | "risk" | "bottlenecks";
    language: Language;
    generatedAt: string;
    filename: string;
    scope: string;
    sheets: DashboardSheetSpec[];
};
const labels: Record<string, [
    string,
    string
]> = {
    period: ["Period", "ช่วงข้อมูล"], rowType: ["Row Type", "ประเภทแถว"], site: ["Site", "สถานที่"], band: ["Job Band", "กลุ่มระดับงาน"], vacancies: ["Vacancies", "อัตราอนุมัติ"], filled: ["Filled", "บรรจุ"], open: ["Open", "คงค้าง"], filledPct: ["Filled %", "สัดส่วนบรรจุ"], onTime: ["On-time", "ภายใน SLA"], late: ["Late", "เกิน SLA"], unknownSla: ["Unknown SLA", "ไม่ทราบ SLA"], slaPct: ["SLA %", "สัดส่วนภายใน SLA"], assessed: ["Assessed Fills", "บรรจุที่ทราบ SLA"], new: ["New", "อัตราใหม่"], replacement: ["Replacement", "อัตราทดแทน"], cumulative: ["Cumulative Share", "สัดส่วนสะสม"],
    metric: ["Metric", "ตัวชี้วัด"], current: ["Current Value", "ค่าช่วงปัจจุบัน"], prior: ["Prior Value", "ค่าช่วงเปรียบเทียบ"], change: ["Absolute Change", "ผลต่าง"], unit: ["Unit", "หน่วย"], currentStart: ["Current Start", "เริ่มช่วงปัจจุบัน"], currentEnd: ["Current End", "สิ้นสุดช่วงปัจจุบัน"], priorStart: ["Prior Start", "เริ่มช่วงเปรียบเทียบ"], priorEnd: ["Prior End", "สิ้นสุดช่วงเปรียบเทียบ"],
    docId: ["Requisition ID", "รหัสใบขออัตรา"], department: ["Department", "ฝ่าย"], section: ["Section", "แผนก"], position: ["Position", "ตำแหน่ง"], level: ["Job Level", "ระดับงาน"], requestType: ["Request Type", "ประเภทคำขอ"], owner: ["PIC", "ผู้รับผิดชอบ"], priority: ["Priority", "คำขอสำคัญ"], pr: ["PR Approval Date", "วันที่อนุมัติอัตรา"], status: ["Period-end Status", "สถานะสิ้นช่วง"], headcount: ["Approved Headcount", "จำนวนอัตราอนุมัติ"], timeTotal: ["Time-to-fill Day Total", "รวมวันใช้บรรจุ"], timeCount: ["Time-to-fill Contribution", "จำนวนที่ใช้คำนวณวันบรรจุ"],
    offerId: ["Offer ID", "รหัสข้อเสนอ"], candidateId: ["Candidate ID", "รหัสผู้สมัคร"], name: ["Candidate Name", "ชื่อผู้สมัคร"], identity: ["Identity Available", "มีข้อมูลระบุตัวผู้สมัคร"], accepted: ["Acceptance Date", "วันที่ตอบรับ"], working: ["First Working Date", "วันเริ่มงาน"], confirmation: ["Start Confirmation", "ยืนยันเริ่มงาน"], confirmedAt: ["Confirmed At (Bangkok)", "เวลายืนยัน (กรุงเทพฯ)"], within: ["Acceptance Within Range", "ตอบรับในช่วง"], effective: ["Effective At Period End", "มีผลสิ้นช่วง"], counted: ["Fill Contribution", "จำนวนที่นับบรรจุ"], sla: ["SLA Classification", "ผล SLA"], days: ["Time-to-fill Days", "วันใช้บรรจุ"], reason: ["Counting Explanation", "เหตุผลการนับ"],
    stage: ["Stage", "ขั้นตอน"], count: ["Count", "จำนวน"], conversion: ["Preceding-stage Conversion", "สัดส่วนจากขั้นก่อนหน้า"], yield: ["Yield Against Applicants", "สัดส่วนจากยอดผู้สมัคร"], channel: ["Channel", "ช่องทาง"], share: ["Stage Share", "สัดส่วนของขั้น"], applicants: ["Applicants", "ยอดผู้สมัคร"], phone: ["Phone Screening", "ผ่านคัดกรองโทรศัพท์"], hired: ["Hired", "ผู้ตอบรับไม่ซ้ำ"], applicantShare: ["Applicants Share", "สัดส่วนยอดผู้สมัคร"], phoneShare: ["Phone Share", "สัดส่วนผ่านโทรศัพท์"], hiredShare: ["Hired Share", "สัดส่วนผู้ตอบรับ"], phoneApplicants: ["Phone / Applicants", "ผ่านโทรศัพท์ต่อยอดผู้สมัคร"], hiredPhone: ["Hired / Phone", "ตอบรับต่อผ่านโทรศัพท์"], hiredApplicants: ["Hired / Applicants", "ตอบรับต่อยอดผู้สมัคร"],
    groupIds: ["Sourcing Group IDs", "รหัสกลุ่มสรรหา"], groupId: ["Sourcing Group ID", "รหัสกลุ่มสรรหา"], groupName: ["Sourcing Group Name", "ชื่อกลุ่มสรรหา"], docIds: ["Related Eligible Requisition IDs", "รหัสใบขออัตราในขอบเขต"], rawChannel: ["Recorded Candidate Channel", "ช่องทางผู้สมัครที่บันทึก"], logId: ["Activity ID", "รหัสกิจกรรม"], round: ["Round", "รอบ"], entry: ["Entry Date", "วันที่เข้าสู่ขั้น"], outcome: ["Outcome Date", "วันที่ผล"], activity: ["Effective Activity Date", "วันที่ใช้รายงาน"], result: ["Result", "ผล"], resume: ["Resume Contribution", "จำนวนที่นับเข้าสู่โทรศัพท์"], passed: ["Passed-stage Contribution", "จำนวนที่นับผ่านขั้น"], sourcePhone: ["Source Phone Contribution", "จำนวนที่นับผ่านโทรศัพท์"], hireContribution: ["Hired Contribution", "จำนวนที่นับผู้ตอบรับ"], week: ["Stored Week Date", "วันที่สัปดาห์ที่บันทึก"], weekStart: ["Reporting Week Start", "เริ่มช่วงสรรหา"], weekEnd: ["Reporting Week End", "สิ้นสุดช่วงสรรหา"], recorded: ["Recorded Applicants", "ยอดผู้สมัครที่บันทึก"], countedApplicants: ["Applicants Contribution", "ยอดผู้สมัครที่นับ"], field: ["Field", "หัวข้อ"], value: ["Value", "รายละเอียด"]
};
const titles: Record<string, [
    string,
    string
]> = { readme: ["Read Me", "คำแนะนำ"], kpi: ["KPI Summary", "สรุปตัวชี้วัด"], matrix: ["Site & Level", "สถานที่และระดับงาน"], mix: ["Vacancy Mix", "อัตราใหม่และทดแทน"], sla: ["SLA", "SLA"], requisitions: ["Requisitions", "ใบขออัตรา"], acceptances: ["Acceptances", "การตอบรับ"], pipeline: ["Pipeline Summary", "สรุปขั้นตอนสรรหา"], channels: ["Pipeline Channels", "ขั้นตอนตามช่องทาง"], sources: ["Source Summary", "สรุปช่องทางสรรหา"], stages: ["Stage Records", "กิจกรรมผู้สมัคร"], hires: ["Hire Records", "รายการตอบรับ"], sourcing: ["Sourcing Rows", "ยอดสรรหารายสัปดาห์"] };
const percentKeys = new Set(["filledPct", "slaPct", "cumulative", "conversion", "yield", "share", "applicantShare", "phoneShare", "hiredShare", "phoneApplicants", "hiredPhone", "hiredApplicants"]);
const dateKeys = new Set(["currentStart", "currentEnd", "priorStart", "priorEnd", "pr", "accepted", "working", "entry", "outcome", "activity", "week", "weekStart", "weekEnd"]);
const numeric = new Set(["vacancies", "filled", "open", "onTime", "late", "unknownSla", "assessed", "new", "replacement", "current", "prior", "change", "headcount", "timeTotal", "timeCount", "priority", "identity", "within", "effective", "counted", "days", "count", "applicants", "phone", "hired", "round", "resume", "passed", "sourcePhone", "hireContribution", "recorded", "countedApplicants"]);
const ratio = (n: number, d: number) => d ? n / d : null;
const day = (value: unknown): Date | null => { const valid = validDateOnly(typeof value === "string" ? value : null); return valid ? new Date(`${valid}T00:00:00Z`) : null; };
const bangkok = (value: string | null) => { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) ? new Date(time + 7 * 3600000) : null; };
function sheet(id: string, keys: string[], records: Record<string, unknown>[], language: Language, description: string): DashboardTableSpec {
    const index = language === "th" ? 1 : 0;
    return { id, title: titles[id][index], description, columns: keys.map(key => ({ key, label: labels[key][index], format: percentKeys.has(key) ? "0.0%" : dateKeys.has(key) ? "dd/mm/yyyy" : key === "confirmedAt" ? "dd/mm/yyyy hh:mm:ss" : numeric.has(key) ? "0" : undefined, width: numeric.has(key) || percentKeys.has(key) ? 20 : key === "value" ? 90 : key === "name" || key === "position" || key === "docIds" ? 32 : 24 })), rows: records.map(row => keys.map(key => dateKeys.has(key) ? day(row[key]) : key === "confirmedAt" ? bangkok(row[key] as string | null) : (row[key] ?? null) as WorkbookCell)) };
}
function req(row: EnrichedRequisition) { return { docId: row.doc_id, site: row.site, department: row.department, section: row.section, position: row.position, level: row.level, owner: row.person_in_charge, priority: Number(Boolean(row.is_priority)), pr: row.pr_approved_date, headcount: row.head_count }; }
const reqKeys = ["docId", "site", "department", "section", "position", "level", "owner", "priority", "pr", "headcount"];
function readme(context: DashboardReportContext, generatedAt: string, sheets: DashboardTableSpec[], extra: Record<string, unknown>[]): DashboardTableSpec {
    const th = context.language === "th", text = (en: string, thai: string) => th ? thai : en;
    const p = context.preferences;
    const records = [{ field: text("Report", "รายงาน"), value: context.summary }, { field: text("Generated At (Bangkok)", "เวลาส่งออก (กรุงเทพฯ)"), value: new Intl.DateTimeFormat(th ? "th-TH" : "en-GB", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(generatedAt)) },
        { field: text("Period Mode", "โหมดรายงาน"), value: p.period.toUpperCase() }, { field: text("Start / End", "เริ่ม / สิ้นสุด"), value: `${context.range.start} / ${context.range.end}` },
        { field: text("Header Site / PIC / Priority", "สถานที่ / ผู้รับผิดชอบ / คำขอสำคัญส่วนหัว"), value: `${context.headerScope.site || text("All", "ทั้งหมด")} / ${context.headerScope.owner || text("All", "ทั้งหมด")} / ${context.headerScope.priorityOnly ? text("Priority only", "เฉพาะคำขอสำคัญ") : text("All", "ทั้งหมด")}` },
        ...[["Site", "สถานที่", p.sites], ["Department", "ฝ่าย", p.departments], ["Job Level", "ระดับงาน", p.levels]].map(([en, thai, values]) => ({ field: text(en as string, thai as string), value: (values as string[]).join(", ") || text("All within header scope", "ทั้งหมดในขอบเขตส่วนหัว") })),
        { field: text("Identity availability", "ข้อมูลระบุตัวผู้สมัคร"), value: text("Names and IDs appear only from authorized operational records. Missing identity does not remove an aggregate contribution. Contact details and free-text notes are excluded.", "ชื่อและรหัสมาจากข้อมูลปฏิบัติงานที่มีสิทธิ์เท่านั้น การไม่มีข้อมูลระบุตัวไม่ลดผลรวม ไม่ส่งออกข้อมูลติดต่อหรือหมายเหตุอิสระ") },
        { field: text("Values and totals", "ค่าและผลรวม"), value: text("Blank numeric values mean unavailable. Ratios retain exact values, including above 100%. Filter Row Type to Detail before summing; Total rows are explicit. No Excel formulas are required.", "ค่าว่างหมายถึงไม่มีค่าที่ใช้คำนวณ เก็บสัดส่วนจริงรวมที่เกิน 100% กรองประเภทแถวเป็นรายละเอียดก่อนรวม มีแถวรวมระบุชัดเจน ไม่ต้องใช้สูตร Excel") },
        ...extra, ...sheets.map(s => ({ field: s.title, value: s.description }))];
    return sheet("readme", ["field", "value"], records, context.language, text("Workbook guide and effective scope.", "คำแนะนำและขอบเขตข้อมูล"));
}
/** Keep all calculation tables, organized into exactly two editable worksheets. */
function compactSheets(tables: DashboardTableSpec[], guide: DashboardTableSpec, language: Language): DashboardSheetSpec[] {
    const sourceIds = new Set(["requisitions", "acceptances", "stages", "hires", "sourcing"]);
    return [
        { id: "summary", title: language === "th" ? "ข้อมูลสรุป" : "Summary Data", tables: [...tables.filter(table => !sourceIds.has(table.id)), guide] },
        { id: "source", title: language === "th" ? "ข้อมูลต้นทาง" : "Source Data", tables: tables.filter(table => sourceIds.has(table.id)) }
    ];
}
export function buildPerformanceExportSnapshot(context: DashboardReportContext, current: PerformanceReport, prior: PerformanceReport, sites: string[], generatedAt = new Date().toISOString()): ReportExportSnapshot {
    const language = context.language, th = language === "th", text = (en: string, thai: string) => th ? thai : en;
    const detail = text("Detail", "รายละเอียด"), total = text("Total", "รวม");
    const periodReports = [{ period: text("Current", "ปัจจุบัน"), report: current }, { period: text("Comparison", "เปรียบเทียบ"), report: prior }];
    const kpiKeys = ["vacancies", "filled", "filledPct", "slaPct", "avgTimeToFill", "open", "onTime", "late", "unknownSla"] as const;
    const kpi = kpiKeys.map(key => { const percentage = key === "filledPct" || key === "slaPct", a = current.metrics[key], b = prior.metrics[key]; return { metric: key === "avgTimeToFill" ? text("AVG Time-to-Fill", "เวลาบรรจุเฉลี่ย") : labels[key][th ? 1 : 0], current: a === null ? null : percentage ? a / 100 : a, prior: b === null ? null : percentage ? b / 100 : b, change: a === null || b === null ? null : a - b, unit: percentage ? text("ratio; change in pp", "สัดส่วน; ผลต่างเป็นจุดเปอร์เซ็นต์") : key === "avgTimeToFill" ? text("days", "วัน") : text("count", "จำนวน"), currentStart: current.range.start, currentEnd: current.range.end, priorStart: prior.range.start, priorEnd: prior.range.end }; });
    const matrix: Record<string, unknown>[] = [], slaRows: Record<string, unknown>[] = [], mix: Record<string, unknown>[] = [], requisitions: Record<string, unknown>[] = [], acceptances: Record<string, unknown>[] = [];
    const authorized = new Map(context.candidateOffers.map(offer => [`${offer.doc_id}:${offer.offer_id}`, offer]));
    const candidates = new Map(context.data.candidates.map(candidate => [candidate.candidate_id, candidate]));
    for (const { period, report } of periodReports) {
        const bands = PERFORMANCE_BANDS.filter(band => band !== "Unknown" || report.cells.some(cell => cell.band === band));
        const sum = (cells: PerformanceCell[], key: keyof PerformanceCell) => cells.reduce((n, c) => n + Number(c[key]), 0);
        for (const axis of [...sites.map(site => ({ site, isTotal: false })), { site: total, isTotal: true }])
            for (const band of [...bands.filter(band => band !== "Unknown").reverse(), ...bands.filter(band => band === "Unknown")]) {
                const site = axis.site;
                const cells = report.cells.filter(cell => (axis.isTotal || cell.site === site) && cell.band === band), vacancies = sum(cells, "vacancies"), filled = sum(cells, "filled"), onTime = sum(cells, "onTime"), late = sum(cells, "late");
                const base = { period, rowType: axis.isTotal ? total : detail, site, band };
                matrix.push({ ...base, vacancies, filled, open: sum(cells, "open"), filledPct: ratio(filled, vacancies) });
                slaRows.push({ ...base, onTime, late, unknownSla: sum(cells, "unknownSla"), assessed: onTime + late, slaPct: ratio(onTime, onTime + late) });
            }
        let cumulative = 0;
        for (const band of bands) {
            const cells = report.cells.filter(cell => cell.band === band), vacancies = sum(cells, "vacancies");
            cumulative += vacancies;
            mix.push({ period, rowType: detail, band, new: sum(cells, "newVacancies"), replacement: sum(cells, "replacementVacancies"), vacancies, cumulative: ratio(cumulative, report.metrics.vacancies) });
        }
        mix.push({ period, rowType: total, band: total, new: sum(report.cells, "newVacancies"), replacement: sum(report.cells, "replacementVacancies"), vacancies: report.metrics.vacancies, cumulative: report.metrics.vacancies ? 1 : null });
        for (const c of report.requisitionContributions)
            requisitions.push({ period, ...req(c.requisition), band: c.band, requestType: requestTypeLabel(language, c.requisition.request_type), status: translate(language, c.status as "ongoing"), vacancies: c.vacancies, filled: c.filled, open: c.open, onTime: c.onTime, late: c.late, unknownSla: c.unknownSla, timeTotal: c.timeTotal, timeCount: c.timeCount });
        for (const c of report.acceptanceContributions) {
            const safe = authorized.get(`${c.offer.doc_id}:${c.offer.offer_id}`), candidate = safe ? candidates.get(safe.candidate_id) : undefined;
            acceptances.push({ period, ...req(c.requisition), offerId: String(c.offer.offer_id), candidateId: candidate?.candidate_id ?? null, name: candidate?.name ?? null, identity: Number(Boolean(candidate)), accepted: c.offer.accepted_date, working: c.offer.first_working_date, confirmation: startState(c.offer.start_confirmation, language), confirmedAt: c.offer.start_confirmed_at, within: Number(c.withinRange), effective: Number(c.effective), counted: c.counted, sla: slaState(c.sla, language), days: c.days, timeCount: c.timeCount, reason: ({ counted: text("Counted", "นับ"), outside: text("Outside selected range", "นอกช่วงที่เลือก"), "no-show": text("No-show at period end", "ไม่เริ่มงาน ณ สิ้นช่วง"), cap: text("Headcount cap", "เกินจำนวนอัตราอนุมัติ") })[c.reason] });
        }
    }
    const sheets = [sheet("kpi", ["metric", "current", "prior", "change", "unit", "currentStart", "currentEnd", "priorStart", "priorEnd"], kpi, language, text("One row per KPI; rates use ratio cells and changes use percentage points.", "หนึ่งแถวต่อ KPI สัดส่วนเก็บเป็นตัวเลข ผลต่างเป็นจุดเปอร์เซ็นต์")), sheet("matrix", ["period", "rowType", "site", "band", "vacancies", "filled", "open", "filledPct"], matrix, language, text("One site/job-band row per period plus marked totals.", "หนึ่งแถวต่อสถานที่และกลุ่มระดับต่อช่วง พร้อมแถวรวม")), sheet("mix", ["period", "rowType", "band", "new", "replacement", "vacancies", "cumulative"], mix, language, text("Job-band approved headcount and cumulative share.", "อัตราอนุมัติตามกลุ่มระดับและสัดส่วนสะสม")), sheet("sla", ["period", "rowType", "site", "band", "onTime", "late", "unknownSla", "assessed", "slaPct"], slaRows, language, text("SLA results; unknown outcomes excluded from the ratio.", "ผล SLA ไม่รวมรายการไม่ทราบในสัดส่วน")), sheet("requisitions", ["period", ...reqKeys, "band", "requestType", "status", "vacancies", "filled", "open", "onTime", "late", "unknownSla", "timeTotal", "timeCount"], requisitions, language, text("One eligible requisition per period; contribution columns reproduce the summaries.", "หนึ่งใบขออัตราที่เข้าเกณฑ์ต่อช่วง คอลัมน์จำนวนใช้ตรวจสอบผลรวม")), sheet("acceptances", ["period", "offerId", ...reqKeys, "candidateId", "name", "identity", "accepted", "working", "confirmation", "confirmedAt", "within", "effective", "counted", "sla", "days", "timeCount", "reason"], acceptances, language, text("Related accepted offers per eligible requisition/period, including historical/outside-range context; sum contributions, not rows.", "ข้อเสนอที่ตอบรับของใบขออัตราในแต่ละช่วง รวมข้อมูลประวัติและนอกช่วง ให้รวมคอลัมน์จำนวนที่นับแทนจำนวนแถว"))];
    const extra = [{ field: text("Comparison range", "ช่วงเปรียบเทียบ"), value: `${prior.range.start} / ${prior.range.end}` }, { field: text("Performance definitions", "นิยามผลการสรรหา"), value: text("Approved eligible headcount; effective accepted fills capped by requisition headcount. No-shows are excluded at period end. Average time = contributing PR-to-acceptance day total / contributing offer count. YTD compares prior year; other modes compare the preceding equal-length range.", "อัตราอนุมัติที่เข้าเกณฑ์ นับตอบรับที่มีผลไม่เกินอัตราอนุมัติ ไม่รวมไม่เริ่มงาน ณ สิ้นช่วง วันบรรจุเฉลี่ย = รวมวันอนุมัติถึงตอบรับ / จำนวนที่ใช้คำนวณ YTD เทียบปีก่อน โหมดอื่นเทียบช่วงก่อนหน้าที่ยาวเท่ากัน") }];
    return { reportId: "performance", language, generatedAt, filename: `recruitment-performance-${current.range.start}-to-${current.range.end}.xlsx`, scope: context.summary, sheets: compactSheets(sheets, readme(context, generatedAt, sheets, extra), language) };
}
const startState = (value: string | null, language: Language) => value === "started" ? (language === "th" ? "เริ่มงานแล้ว" : "Started") : value === "did_not_start" ? (language === "th" ? "ไม่เริ่มงาน" : "Did not start") : (language === "th" ? "ยังไม่ยืนยัน" : "Unconfirmed");
const slaState = (value: boolean | null, language: Language) => value === true ? (language === "th" ? "ภายใน SLA" : "On-time") : value === false ? (language === "th" ? "เกิน SLA" : "Late") : (language === "th" ? "ไม่ทราบ" : "Unknown");
export function buildPipelineExportSnapshot(context: DashboardReportContext, report: PipelineReport, generatedAt = new Date().toISOString()): ReportExportSnapshot {
    const language = context.language, th = language === "th", text = (en: string, thai: string) => th ? thai : en;
    const totals = report.sourceRows.reduce((s, r) => ({ applicants: s.applicants + r.applicants, phone: s.phone + r.phone, hired: s.hired + r.hired }), { applicants: 0, phone: 0, hired: 0 });
    const pipeline = report.funnelRows.map(row => ({ stage: row.label, count: row.count, conversion: row.conversionRate, yield: row.yieldRate }));
    const channels = report.funnelRows.flatMap(row => (row.segments ?? []).map(segment => ({ stage: row.label, channel: segment.label, count: segment.count, share: ratio(segment.count, row.count) })));
    const sources = report.sourceRows.map(row => ({ rowType: text("Detail", "รายละเอียด"), channel: row.label, applicants: row.applicants, phone: row.phone, hired: row.hired, applicantShare: ratio(row.applicants, totals.applicants), phoneShare: ratio(row.phone, totals.phone), hiredShare: ratio(row.hired, totals.hired), phoneApplicants: ratio(row.phone, row.applicants), hiredPhone: ratio(row.hired, row.phone), hiredApplicants: ratio(row.hired, row.applicants) }));
    const requisitions = report.requisitions.map(row => ({ ...req(row), requestType: requestTypeLabel(language, row.request_type), groupIds: Object.keys(report.groupDocs).filter(id => report.groupDocs[id].includes(row.doc_id)).sort().join(", ") }));
    const stages = report.stageRecords.map(row => ({ ...row, logId: String(row.logId), stage: processStageLabel(language, row.stage), result: row.result === 1 ? text("Passed", "ผ่าน") : row.result === 0 ? text("Failed", "ไม่ผ่าน") : text("Pending", "รอผล"), sourcePhone: row.phone }));
    const hires = report.hireRecords.map(row => ({ ...req(row.requisition), offerId: String(row.offer.offer_id), candidateId: row.candidateId, name: row.name, groupIds: row.groupIds, rawChannel: row.rawChannel, channel: row.channel, accepted: row.offer.accepted_date, working: row.offer.first_working_date, confirmation: startState(row.offer.start_confirmation, language), hireContribution: row.hired }));
    const sourcing = report.sourcingRecords.map(row => { const end = new Date(`${row.week}T00:00:00Z`); end.setUTCDate(end.getUTCDate() - 1); const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6); return { ...row, site: row.sites, department: row.departments, countedApplicants: row.applicants, weekStart: start.toISOString().slice(0, 10), weekEnd: end.toISOString().slice(0, 10) }; });
    const sheets = [sheet("pipeline", ["stage", "count", "conversion", "yield"], pipeline, language, text("Complete stage list; distinct candidates per stage.", "ทุกขั้นตอน นับผู้สมัครไม่ซ้ำต่อขั้น")), sheet("channels", ["stage", "channel", "count", "share"], channels, language, text("Full stage/channel breakdown independent of legend visibility.", "จำนวนขั้นตามช่องทางไม่ขึ้นกับการแสดงคำอธิบายสี")), sheet("sources", ["rowType", "channel", "applicants", "phone", "hired", "applicantShare", "phoneShare", "hiredShare", "phoneApplicants", "hiredPhone", "hiredApplicants"], sources, language, text("Visible Source channels, exact ratios and shares.", "ช่องทางที่แสดงในรายงาน พร้อมสัดส่วนจริง")), sheet("requisitions", [...reqKeys, "requestType", "groupIds"], requisitions, language, text("Eligible requisitions and scoped sourcing-group links.", "ใบขออัตราที่เข้าเกณฑ์และกลุ่มสรรหาในขอบเขต")), sheet("stages", ["logId", "candidateId", "name", "rawChannel", "channel", "groupId", "docIds", "stage", "round", "entry", "outcome", "activity", "result", "resume", "passed", "sourcePhone"], stages, language, text("Canonical in-range activity; first effective date then activity ID determines distinct contributions. Resume means entered Phone Screen, regardless of result.", "กิจกรรมในช่วงที่ไม่ถูกแทนที่ เลือกวันที่ใช้รายงานแรกแล้วรหัสกิจกรรมเพื่อกำหนดจำนวนไม่ซ้ำ Resume คือเข้าสู่ Phone Screen โดยไม่ขึ้นกับผล")), sheet("hires", ["offerId", "candidateId", "name", ...reqKeys, "groupIds", "rawChannel", "channel", "accepted", "working", "confirmation", "hireContribution"], hires, language, text("Accepted offers; earliest acceptance then offer ID contributes once per candidate. No-shows remain historical hires.", "ข้อเสนอตอบรับ เลือกวันที่ตอบรับแรกแล้วรหัสข้อเสนอเพื่อไม่ซ้ำต่อผู้สมัคร ไม่เริ่มงานยังคงเป็นการตอบรับในประวัติ")), sheet("sourcing", ["groupId", "groupName", "docIds", "site", "department", "week", "weekStart", "weekEnd", "channel", "recorded", "countedApplicants"], sourcing, language, text("One saved group/week/channel row. Shared groups appear once; blank counts contribute zero. Filtering follows stored week date.", "หนึ่งแถวต่อกลุ่ม สัปดาห์ และช่องทาง กลุ่มร่วมปรากฏครั้งเดียว ค่าว่างนับศูนย์ กรองตามวันที่สัปดาห์ที่บันทึก"))];
    const extra = [{ field: text("Channel", "ช่องทาง"), value: context.preferences.funnelChannel === "all" ? text("All channels", "ทุกช่องทาง") : context.preferences.funnelChannel }, { field: text("Channel legend", "คำอธิบายสีช่องทาง"), value: context.preferences.funnelLegend ? "ON" : "OFF" }, { field: text("Counting grain", "หน่วยการนับ"), value: text("Applicants are saved group/week counts. Stages are dated distinct-candidate activity. Hired is distinct historical accepted candidates. Same-period ratios can exceed 100% because these are different populations.", "ยอดผู้สมัครมาจากกลุ่มรายสัปดาห์ ขั้นตอนมาจากกิจกรรมตามวันที่ของผู้สมัครไม่ซ้ำ การตอบรับนับผู้สมัครตอบรับไม่ซ้ำ สัดส่วนในช่วงเดียวกันอาจเกิน 100% เพราะประชากรต่างกัน") }];
    return { reportId: "pipeline", language, generatedAt, filename: `pipeline-sources-${context.range.start}-to-${context.range.end}.xlsx`, scope: context.summary, sheets: compactSheets(sheets, readme(context, generatedAt, sheets, extra), language) };
}
export async function createDashboardWorkbook(snapshot: ReportExportSnapshot) {
    const excel = await import("exceljs");
    const Workbook = excel.Workbook ?? excel.default.Workbook;
    const workbook = new Workbook();
    workbook.creator = "Recruitment";
    workbook.created = new Date(snapshot.generatedAt);
    for (const spec of snapshot.sheets) {
        const ws = workbook.addWorksheet(spec.title, { properties: { tabColor: { argb: spec.id === "summary" ? "FF0A3CDC" : "FFC4D8FF" }, outlineProperties: { summaryBelow: false, summaryRight: false } } });
        ws.views = [{ showGridLines: false, state: "frozen", ySplit: 5, zoomScale: 85 }];
        ws.getColumn(1).width = 2;
        const maxColumns = Math.max(...spec.tables.map(table => table.columns.length));
        // Shared widths keep stacked tables aligned without changing per-cell formats.
        for (let index = 0; index < maxColumns; index++) {
            ws.getColumn(index + 2).width = Math.max(...spec.tables.map(table => {
                const column = table.columns[index];
                return !column ? 0 : column.key === "value" ? 22 : column.key === "name" || column.key === "position" || column.key === "docIds" ? 26 : 18;
            }));
        }
        const titleEnd = Math.min(maxColumns + 1, 10);
        ws.mergeCells(1, 2, 1, titleEnd);
        ws.getCell(1, 2).value = spec.title;
        ws.getRow(1).height = 26;
        ws.mergeCells(2, 2, 2, titleEnd);
        ws.getCell(2, 2).value = snapshot.scope;
        ws.getRow(2).height = 32;
        ws.mergeCells(3, 2, 3, titleEnd);
        ws.getCell(3, 2).value = snapshot.language === "th" ? "เลือกหัวข้อลัดด้านล่าง • แต่ละตารางกรองและแก้ไขได้ • คำแนะนำอยู่ท้ายข้อมูลสรุป" : "Jump to a section below • Each table can be filtered and edited • Guide at the end of Summary Data";
        ws.getRow(3).height = 22;
        ws.getRow(4).height = 32;
        let cursor = 6;
        for (const [index, table] of spec.tables.entries()) {
            const titleRow = cursor, headerRow = cursor + 1;
            const nav = ws.getCell(4, index + 2);
            nav.value = { text: table.title, hyperlink: `#'${spec.title}'!B${titleRow}` };
            ws.mergeCells(titleRow, 2, titleRow, Math.min(table.columns.length + 1, 10));
            ws.getCell(titleRow, 2).value = table.title;
            ws.getRow(titleRow).height = 24;
            ws.addTable({ name: `Dashboard_${snapshot.reportId}_${table.id}`, ref: `B${headerRow}`, headerRow: true, totalsRow: false, style: { theme: "TableStyleMedium2", showRowStripes: true }, columns: table.columns.map(column => ({ name: column.label, filterButton: true })), rows: table.rows });
            ws.getRow(headerRow).height = 34;
            for (const [rowIndex, values] of table.rows.entries()) {
                const row = ws.getRow(headerRow + rowIndex + 1);
                const lines = Math.max(1, ...values.map((value, index) => {
                    if (typeof value !== "string") return 1;
                    const width = ws.getColumn(index + 2).width ?? 18;
                    const charsPerLine = /[^\u0000-\u00ff]/.test(value) ? width : width * 1.2;
                    return value.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
                }));
                row.height = Math.max(22, lines * 13 + 6);
                values.forEach((_, columnIndex) => {
                    const column = table.columns[columnIndex];
                    if (column.format) row.getCell(columnIndex + 2).numFmt = column.format;
                });
                if (table.id === "kpi") {
                    const rate = String(values[4]).includes("pp") || String(values[4]).includes("จุดเปอร์เซ็นต์");
                    const days = values[4] === "days" || values[4] === "วัน";
                    for (const column of [3, 4]) row.getCell(column).numFmt = rate ? "0%" : days ? "0.0" : "0";
                    row.getCell(5).numFmt = rate || days ? "+0.0;-0.0;0.0" : "+0;-0;0";
                }
                if (table.id === "metrics" && snapshot.reportId === "risk" && /Risk exposure|สัดส่วนความเสี่ยง/.test(String(values[0]))) {
                    for (const column of [3, 4]) row.getCell(column).numFmt = "0.0%";
                    row.getCell(5).numFmt = "+0.0;-0.0;0.0";
                }
                if (table.id === "metrics" && snapshot.reportId === "bottlenecks" && /Median|Longest|มัธยฐาน|ระยะรอ/.test(String(values[0]))) {
                    for (const column of [3, 4]) row.getCell(column).numFmt = "0.0";
                    row.getCell(5).numFmt = "+0.0;-0.0;0.0";
                }
                // The guide stays available without lengthening the initial summary view.
                if (table.id === "readme") { row.outlineLevel = 1; row.hidden = true; }
            }
            if (table.id === "readme") { ws.getRow(headerRow).outlineLevel = 1; ws.getRow(headerRow).hidden = true; }
            cursor = headerRow + table.rows.length + 3;
        }
        ws.eachRow(row => row.eachCell(cell => {
            cell.font = { name: "Sarabun", size: 10 };
            cell.alignment = { vertical: "middle", wrapText: true };
        }));
        ws.getCell(1, 2).font = { name: "Sarabun", size: 16, bold: true, color: { argb: "FF0A3CDC" } };
        cursor = 6;
        for (const [index, table] of spec.tables.entries()) {
            ws.getCell(4, index + 2).font = { name: "Sarabun", size: 10, underline: true, color: { argb: "FF0A3CDC" } };
            ws.getCell(cursor, 2).font = { name: "Sarabun", size: 12, bold: true, color: { argb: "FF0A3CDC" } };
            ws.getRow(cursor + 1).eachCell(cell => { cell.font = { name: "Sarabun", size: 10, bold: true }; });
            cursor += table.rows.length + 4;
        }
    }
    return workbook;
}
export async function downloadDashboardWorkbook(snapshot: ReportExportSnapshot) {
    const workbook = await createDashboardWorkbook(snapshot);
    const bytes = await workbook.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = snapshot.filename;
        anchor.click();
    }
    finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
