import { formatDate, formatNumber } from "@/lib/format";
import { Building2, Factory, ChartColumnIncreasing } from "lucide-react";
import { ReportHelp } from "./ReportHelp";
import { useId } from "react";
import { PERFORMANCE_BANDS, type PerformanceBand, type PerformanceCell, type PerformanceReport as Report } from "@/lib/recruitment-performance";
import type { Language } from "@/types/recruitment";
import styles from "./performance.module.css";

export const performanceCopy = {
  en: { title: "Recruitment Performance", period: "Period", year: "Year", month: "Month", site: "Site", department: "Department", all: "All", vacancies: "Total Vacancies", filled: "Total Filled", filledPct: "Filled PCT", slaPct: "Filled in SLA PCT", time: "AVG Time-to-Fill", day: "d", noData: "No eligible vacancies in this period", noFills: "No fills in this period", noComparison: "No prior-period value", prior: "vs prior period", vacancyType: "New vs Replacement Vacancy by Job Level", matrix: "Filled vs Open Vacancy by Job Level & Site", sla: "Filled in SLA by Job Level and Site", new: "New", replacement: "Replacement", open: "Open", onTime: "In SLA", late: "Out of SLA", unknown: "SLA unknown", cumulative: "Cumulative vacancy share", total: "Total", export: "Export overview PNG", exportFailed: "Could not export overview PNG", loading: "Preparing PNG…", unknownLevel: "Unknown", level: "Job level", count: "Vacancies", unknownHelp: "Unknown SLA excluded from percentage", increased: "Increased", decreased: "Decreased", unchanged: "Unchanged", pp: "pp", pim: "Performance in Month" },
  th: { title: "ผลการสรรหา", period: "ช่วงเวลา", year: "ปี", month: "เดือน", site: "สถานที่", department: "ฝ่าย", all: "ทั้งหมด", vacancies: "อัตราว่างทั้งหมด", filled: "บรรจุแล้ว", filledPct: "สัดส่วนบรรจุ", slaPct: "บรรจุภายใน SLA", time: "เวลาบรรจุเฉลี่ย", day: "วัน", noData: "ไม่มีอัตราว่างที่เข้าเกณฑ์ในช่วงเวลานี้", noFills: "ไม่มีการบรรจุในช่วงเวลานี้", noComparison: "ไม่มีค่าช่วงก่อนหน้า", prior: "เทียบช่วงก่อนหน้า", vacancyType: "อัตราว่างใหม่และทดแทนตามระดับงาน", matrix: "อัตราบรรจุและคงค้างตามระดับงานและสถานที่", sla: "การบรรจุภายใน SLA ตามระดับงานและสถานที่", new: "ใหม่", replacement: "ทดแทน", open: "คงค้าง", onTime: "ใน SLA", late: "เกิน SLA", unknown: "ไม่ทราบ SLA", cumulative: "สัดส่วนอัตราว่างสะสม", total: "รวม", export: "ส่งออกภาพรวม PNG", exportFailed: "ส่งออกภาพรวม PNG ไม่สำเร็จ", loading: "กำลังเตรียม PNG…", unknownLevel: "ไม่ทราบระดับ", level: "ระดับงาน", count: "อัตราว่าง", unknownHelp: "ไม่รวมรายการที่ไม่ทราบ SLA ในเปอร์เซ็นต์", increased: "เพิ่มขึ้น", decreased: "ลดลง", unchanged: "ไม่เปลี่ยนแปลง", pp: "จุดเปอร์เซ็นต์", pim: "ผลการดำเนินงานรายเดือน" }
} as const;

const BLUE = "#0A3CDC", AMBER = "#FFC107", GREEN = "#65C91A", RED = "#F23852", GRAY = "#94A3B8";
const sitePalette: Record<string, [string, string]> = { HQ: ["#0AA0C3", "#CDEEF3"], KT1: ["#146EFA", "#CDE0FF"], KT2: ["#411EDC", "#DAD2FA"], Total: [BLUE, "#D0DAFA"] };
export const reportSiteColors = (site: string): [string, string] => sitePalette[site] ?? ["#536B9B", "#DCE3EF"];
export const orderedReportSites = (sites: string[]) => [...new Set(sites)].sort((a, b) => {
  const order = ["HQ", "KT1", "KT2"];
  return (order.includes(a) ? order.indexOf(a) : 3) - (order.includes(b) ? order.indexOf(b) : 3) || a.localeCompare(b);
});
const ranges: Record<PerformanceBand, string> = { NML: "L0–L3", FML: "L4–L6", MML: "L7–L9", SML: "L10–L12", Executive: "L13–L14", Unknown: "" };
const bandLabel = (band: PerformanceBand, language: Language) => band === "Unknown" ? performanceCopy[language].unknownLevel : band === "Executive" ? "EXEC" : band;
const bandsFor = (cells: PerformanceCell[]) => PERFORMANCE_BANDS.filter(band => band !== "Unknown" || cells.some(cell => cell.band === "Unknown"));
const descendingBands = (cells: PerformanceCell[]) => [...bandsFor(cells).filter(band => band !== "Unknown").reverse(), ...bandsFor(cells).filter(band => band === "Unknown")];
const empty: PerformanceCell = { site: "", band: "Unknown", vacancies: 0, filled: 0, open: 0, onTime: 0, late: 0, unknownSla: 0, newVacancies: 0, replacementVacancies: 0 };
function sumCells(cells: PerformanceCell[], site?: string, band?: PerformanceBand) {
  return cells.filter(cell => (!site || cell.site === site) && (!band || cell.band === band)).reduce((sum, cell) => ({ ...sum, vacancies: sum.vacancies + cell.vacancies, filled: sum.filled + cell.filled, open: sum.open + cell.open, onTime: sum.onTime + cell.onTime, late: sum.late + cell.late, unknownSla: sum.unknownSla + cell.unknownSla, newVacancies: sum.newVacancies + cell.newVacancies, replacementVacancies: sum.replacementVacancies + cell.replacementVacancies }), { ...empty });
}
const rounded = (value: number, decimals = 0) => Number(value.toFixed(decimals));

export function PerformanceReport({ report, previous, language, sites, period = "mtd", exportMode = false }: { report: Report; previous: Report; language: Language; sites: string[]; period?: string; exportMode?: boolean }) {
  const t = performanceCopy[language];
  const descriptionId = useId();
  const comparisonLabel = language === "th" ? `เทียบ ${period.toUpperCase()} ก่อนหน้า` : `vs prior ${period.toUpperCase()}`;
  return <div className={`${styles.body} ${exportMode ? styles.exportBody : ""}`} data-performance-report>
    <div className={styles.kpis}>
      {(["vacancies", "filled", "filledPct", "slaPct"] as const).map(key => {
        const label = t[key];
        const value = report.metrics[key], prior = previous.metrics[key];
        const delta = value !== null && prior !== null ? value - prior : null;
        const percentage = key === "filledPct" || key === "slaPct";
        const good = delta !== null && (key === "vacancies" ? delta < 0 : delta > 0);
        const direction = delta === null ? "" : delta > 0 ? t.increased : delta < 0 ? t.decreased : t.unchanged;
        const suffix = percentage ? "%" : "";
        const compared = `${comparisonLabel}: ${formatDate(previous.range.start, language)} – ${formatDate(previous.range.end, language)}`;
        const relative = delta !== null && prior !== null && prior !== 0 ? ` (${Math.abs(rounded(delta / prior * 100))}%)` : "";
        return <article key={key} className={styles.kpi} data-metric={key} aria-label={label} aria-describedby={`${descriptionId}-${key}`}>
          <span id={`${descriptionId}-${key}`} className="sr-only">{metricHelp(key, language)}</span>
          <h3>{label}</h3><p className={styles.kpiHelper}>{comparisonLabel}</p>
          <p className={styles.value} data-metric-value>{value === null ? "—" : `${formatNumber(rounded(value), language)}${suffix}`}</p>
          <span className={styles.delta} tabIndex={0} title={compared} aria-label={`${direction} ${delta === null ? t.noComparison : Math.abs(rounded(delta, 1))} ${percentage ? t.pp : suffix}. ${compared}`} style={{ color: delta === null || delta === 0 ? "#64748B" : good ? "#358C0B" : RED }}>
            {delta === null ? language === "th" ? "ไม่มีค่าก่อนหน้า" : "No prior value" : <>{delta > 0 ? "+" : ""}{formatNumber(rounded(delta, 1), language)}{percentage ? ` ${t.pp}` : suffix}{relative}<span aria-hidden="true"> {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"}</span></>}
          </span>
          {key === "vacancies" || key === "filled" ? <div className={styles.miniBar} aria-label={sites.map(site => `${site}: ${sumCells(report.cells, site)[key]}`).join(", ")} role="img">{sites.map(site => <span key={site} style={{ width: `${value ? sumCells(report.cells, site)[key] / value * 100 : 0}%`, background: reportSiteColors(site)[0] }} />)}</div> : percentage ? <div className={styles.miniBar} aria-hidden="true"><span style={{ width: `${value ?? 0}%`, background: key === "slaPct" ? GREEN : BLUE }} /></div> : null}
        </article>;
      })}
    </div>
    <section className={`${styles.panel} ${styles.matrix}`} aria-label={t.matrix}>
      <ChartHeading title={t.matrix} help={language === "th" ? "แท่งสีคือจำนวนบรรจุ สีอ่อนคือคงค้าง ทุกสถานที่ใช้มาตราส่วนจำนวนเดียวกัน ตัวเลขท้ายแท่งคืออัตราอนุมัติทั้งหมด แถวล่างแสดงบรรจุ/อนุมัติและเปอร์เซ็นต์" : "Colored bars count fills; pale bars count open positions. Every site uses the same count scale. The label after each bar is approved headcount. Footers show filled/approved and fill percentage."} /><Legend entries={[[BLUE, t.filled], ["#D0DAFA", t.open]]} />
      <Matrix cells={report.cells} sites={sites} language={language} />
      {report.metrics.vacancies === 0 ? <p className={styles.empty}>{t.noData}</p> : null}
    </section>
    <section className={`${styles.panel} ${styles.vacancy}`} aria-label={t.vacancyType}>
      <ChartHeading title={t.vacancyType} help={language === "th" ? "แท่งแสดงอัตราอนุมัติใหม่และทดแทนตามระดับงาน อ่านจำนวนจากแกนซ้าย เส้นแสดงสัดส่วนสะสมจากแกนขวา" : "Stacks show approved New and Replacement headcount by job level, using the left count axis. The line shows cumulative share of all vacancies using the right percentage axis."} /><Legend entries={[[BLUE, t.new], [AMBER, t.replacement], [BLUE, t.cumulative, "line"]]} />
      <VacancyChart cells={report.cells} language={language} />
    </section>
    <section className={`${styles.panel} ${styles.sla}`} aria-label={t.sla}>
      <ChartHeading title={t.sla} help={language === "th" ? "แต่ละสถานที่ใช้มาตราส่วนจำนวนเดียวกัน สีเขียวคือใน SLA สีแดงคือเกิน SLA สีเทาคือไม่ทราบ เปอร์เซ็นต์คำนวณจากรายการที่ทราบ SLA เท่านั้น" : "Site panels share a count scale. Green is on time, red is late, and gray is unknown. Percentages divide on-time fills by fills with a known SLA result; unknown results are excluded."} /><Legend entries={[[GREEN, t.onTime], [RED, t.late], [GRAY, t.unknown]]} />
      <SlaChart cells={report.cells} sites={sites} language={language} />
      <p className={styles.note}>{t.unknownHelp}: {report.metrics.unknownSla}</p>
    </section>
  </div>;
}

function metricHelp(key: string, language: Language) {
  const help: Record<string, [string, string]> = {
    vacancies: ["Eligible approved headcount in the selected period.", "จำนวนอัตราอนุมัติที่เข้าเกณฑ์ในช่วงเวลาที่เลือก"],
    filled: ["Accepted positions in the selected period, capped at each requisition’s approved headcount.", "จำนวนบรรจุในช่วงเวลาที่เลือก ไม่เกินอัตราอนุมัติแต่ละใบขอ"],
    filledPct: ["Filled ÷ approved headcount. Changes are percentage points.", "บรรจุ ÷ อัตราอนุมัติ การเปลี่ยนแปลงแสดงเป็นจุดเปอร์เซ็นต์"],
    slaPct: ["On-time fills ÷ fills with a known SLA result. Unknown results are excluded.", "บรรจุใน SLA ÷ รายการที่ทราบ SLA ไม่รวมรายการที่ไม่ทราบ"],
    avgTimeToFill: ["Average calendar days from PR approval to offer acceptance.", "วันปฏิทินเฉลี่ยจากอนุมัติ PR ถึงตอบรับข้อเสนอ"]
  };
  return help[key][language === "th" ? 1 : 0];
}
function ChartHeading({ title, help }: { title: string; help: string }) { return <div className={styles.chartHeading}><h3>{title}</h3><ReportHelp label={`${title} ${/[\u0e00-\u0e7f]/.test(title) ? "คำอธิบาย" : "help"}`} text={help} /></div>; }
function SiteIcon({ site }: { site: string }) { const Icon = site === "HQ" ? Building2 : site === "Total" ? ChartColumnIncreasing : Factory; return <Icon size={15} aria-hidden="true" data-site-icon={site} />; }

function Legend({ entries }: { entries: string[][] }) { return <div className={styles.legend}>{entries.map(([color, label, kind]) => <span key={label}><i style={{ background: color, borderRadius: kind === "line" ? 0 : "50%", height: kind === "line" ? 2 : 8, width: kind === "line" ? 14 : 8 }} aria-hidden="true" />{label}</span>)}</div>; }

function Matrix({ cells, sites, language }: { cells: PerformanceCell[]; sites: string[]; language: Language }) {
  const t = performanceCopy[language], bands = descendingBands(cells);
  const columns = [...sites, "Total"];
  const maximum = Math.max(1, ...bands.flatMap(band => columns.map(site => sumCells(cells, site === "Total" ? undefined : site, band).vacancies)));
  return <div className={styles.chartScroll} role="region" aria-label={t.matrix} tabIndex={0}><table className={styles.matrixTable} style={{ minWidth: 88 + columns.length * 100 }}>
    <caption className="sr-only">{t.matrix}</caption>
    <thead><tr><th scope="col">{t.level}</th>{columns.map(site => <th key={site} scope="col" style={{ color: reportSiteColors(site)[0] }} data-site-header><span className={styles.siteHeader}><SiteIcon site={site} />{site === "Total" ? t.total : site}</span></th>)}</tr></thead>
    <tbody>{bands.map(band => <tr key={band} data-band={band}><th scope="row">{bandLabel(band, language)}<small>{ranges[band]}</small></th>{columns.map(site => {
      const cell = sumCells(cells, site === "Total" ? undefined : site, band), colors = reportSiteColors(site), filledWidth = cell.filled / maximum * 80, openWidth = cell.open / maximum * 80;
      const description = `${site} ${bandLabel(band, language)}: ${cell.filled} ${t.filled}, ${cell.open} ${t.open}, ${cell.vacancies} ${t.total}`;
      return <td key={site} aria-label={description} title={cell.vacancies ? description : undefined} tabIndex={cell.vacancies ? 0 : undefined}><svg viewBox="0 0 112 54" className={styles.matrixBar} aria-hidden="true" data-count-scale={maximum}>
        <rect x="2" y="9" height="36" width={filledWidth} fill={colors[0]} data-filled={cell.filled} />
        <rect x={2 + filledWidth} y="9" height="36" width={openWidth} fill={colors[1]} data-open={cell.open} />
        {cell.filled > 0 && filledWidth >= 20 ? <text x={2 + filledWidth / 2} y="30" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="600">{cell.filled}</text> : null}
        {cell.vacancies > 0 ? <text x={Math.min(99, 7 + filledWidth + openWidth)} y="30" fill={colors[0]} fontSize="10">{cell.vacancies}</text> : null}
      </svg></td>;
    })}</tr>)}</tbody>
    <tfoot><tr><th scope="row">{t.total}</th>{columns.map(site => { const cell = sumCells(cells, site === "Total" ? undefined : site); return <td key={site} style={{ color: reportSiteColors(site)[0] }}>{cell.vacancies ? <><strong>{cell.filled}/{cell.vacancies}</strong><small>({Math.round(cell.filled / cell.vacancies * 100)}%)</small></> : "—"}</td>; })}</tr></tfoot>
  </table></div>;
}

function VacancyChart({ cells, language }: { cells: PerformanceCell[]; language: Language }) {
  const t = performanceCopy[language], bands = bandsFor(cells), rows = bands.map(band => sumCells(cells, undefined, band));
  const total = rows.reduce((sum, row) => sum + row.vacancies, 0), maximum = Math.max(5, Math.ceil(Math.max(...rows.map(row => row.vacancies), 0) / 5) * 5);
  const left = 42, right = 434, top = 22, bottom = 158, slot = (right - left) / Math.max(1, bands.length), bar = Math.min(48, slot * 0.65);
  let accumulated = 0;
  const points = rows.map((row, index) => { accumulated += row.vacancies; return { x: left + slot * (index + 0.5), y: bottom - (total ? accumulated / total : 0) * (bottom - top), percent: total ? accumulated / total * 100 : 0 }; });
  return <svg viewBox="0 0 480 206" className={styles.vacancySvg} role="img" aria-label={t.vacancyType} data-vacancy-chart>
    <title>{t.vacancyType}</title><desc>{rows.map((row, index) => `${bandLabel(bands[index], language)}: ${row.newVacancies} ${t.new}, ${row.replacementVacancies} ${t.replacement}, ${Math.round(points[index].percent)}% ${t.cumulative}`).join("; ")}</desc>
    {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1={left} x2={right} y1={bottom - fraction * (bottom - top)} y2={bottom - fraction * (bottom - top)} stroke="#CBD5E1" strokeDasharray="2 4" /><text x={left - 8} y={bottom - fraction * (bottom - top) + 4} textAnchor="end" fontSize="10" fill="#64748B">{rounded(maximum * fraction, 1)}</text><text x={right + 9} y={bottom - fraction * (bottom - top) + 4} fontSize="10" fill="#64748B">{fraction * 100}%</text></g>)}
    {rows.map((row, index) => { const x = left + slot * (index + 0.5) - bar / 2, newHeight = row.newVacancies / maximum * (bottom - top), replacementHeight = row.replacementVacancies / maximum * (bottom - top); const description = `${bandLabel(bands[index], language)}: ${row.newVacancies} ${t.new}, ${row.replacementVacancies} ${t.replacement}; ${rounded(points[index].percent, 1)}% ${t.cumulative}`; return <g key={bands[index]} data-category={bands[index]} tabIndex={0} aria-label={description}>
      <title>{description}</title>
      <rect x={x} y={bottom - newHeight} width={bar} height={newHeight} fill={BLUE} data-new={row.newVacancies} /><rect x={x} y={bottom - newHeight - replacementHeight} width={bar} height={replacementHeight} fill={AMBER} data-replacement={row.replacementVacancies} />
      {row.vacancies > 0 ? <text x={x + bar / 2} y={bottom - newHeight - replacementHeight - 6} textAnchor="middle" fontSize="11" fill={BLUE}>{row.vacancies}</text> : null}
      <text x={x + bar / 2} y={bottom + 17} textAnchor="middle" fontSize="10" fill="#475569">{bandLabel(bands[index], language)}</text>
    </g>; })}
    <polyline points={points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#507DFF" strokeWidth="1.7" />
    {points.map((point, index) => <path key={index} d={`M${point.x} ${point.y - 3} l3 3 l-3 3 l-3 -3 Z`} fill="#507DFF" data-cumulative={rounded(point.percent, 1)}><title>{`${bandLabel(bands[index], language)}: ${rounded(point.percent, 1)}% ${t.cumulative}`}</title></path>)}
    <text x="12" y="92" transform="rotate(-90 12 92)" textAnchor="middle" fontSize="10" fill="#475569">{t.count}</text><text x="238" y="199" textAnchor="middle" fontSize="10" fill="#475569">{t.level}</text>
    {total === 0 ? <text x="238" y="90" textAnchor="middle" fontSize="11" fill="#64748B">{t.noData}</text> : null}
  </svg>;
}

function SlaChart({ cells, sites, language }: { cells: PerformanceCell[]; sites: string[]; language: Language }) {
  const t = performanceCopy[language], bands = descendingBands(cells);
  const maximum = Math.max(2, Math.ceil(Math.max(...cells.map(cell => cell.filled), 0) * 1.1 / 2) * 2);
  const labelWidth = 67, columnWidth = 112, plotWidth = 68, top = 46, rowHeight = 43, bottom = top + bands.length * rowHeight, width = labelWidth + Math.max(1, sites.length) * columnWidth;
  return <div className={styles.chartScroll} tabIndex={0} role="region" aria-label={t.sla}><svg viewBox={`0 0 ${width} ${Math.max(140, bottom + 27)}`} style={{ minWidth: width }} className={styles.slaSvg} role="img" aria-label={t.sla} data-sla-chart data-axis-max={maximum}>
    <title>{t.sla}</title><desc>{cells.map(cell => `${cell.site} ${bandLabel(cell.band, language)}: ${cell.onTime} ${t.onTime}, ${cell.late} ${t.late}, ${cell.unknownSla} ${t.unknown}; ${cell.filled === 0 ? t.noFills : cell.onTime + cell.late ? `${Math.round(cell.onTime / (cell.onTime + cell.late) * 100)}% ${t.onTime}` : t.unknown}`).join("; ")}</desc>
    {bands.map((band, index) => <text key={band} x="2" y={top + index * rowHeight + 21} fontSize="10" fill="#64748B">{bandLabel(band, language)}</text>)}
    {sites.map((site, siteIndex) => { const x = labelWidth + siteIndex * columnWidth; return <g key={site} data-sla-site={site}>
      {siteIndex > 0 ? <line x1={x - 14} x2={x - 14} y1="4" y2={bottom + 19} stroke="#8FA2BE" strokeWidth="1.2" data-site-separator /> : null}
      <text x={x + 44} y="20" textAnchor="middle" fill="#1F2937" fontSize="13" fontWeight="500">{site}</text>
      {[0, 0.5, 1].map(fraction => <g key={fraction}><line x1={x + fraction * plotWidth} x2={x + fraction * plotWidth} y1={top - 9} y2={bottom - 4} stroke="#CBD5E1" strokeDasharray="2 4" /><text x={x + fraction * plotWidth} y={bottom + 14} fontSize="9" textAnchor="middle" fill="#64748B">{rounded(maximum * fraction, 1)}</text></g>)}
      {bands.map((band, index) => { const cell = sumCells(cells, site, band), y = top + index * rowHeight + 5, on = cell.onTime / maximum * plotWidth, late = cell.late / maximum * plotWidth, unknown = cell.unknownSla / maximum * plotWidth, known = cell.onTime + cell.late, percent = known ? `${Math.round(cell.onTime / known * 100)}%` : "—"; const description = `${site} ${bandLabel(band, language)}: ${cell.onTime} ${t.onTime}, ${cell.late} ${t.late}, ${cell.unknownSla} ${t.unknown}; ${percent} ${t.onTime}`; return <g key={band} data-sla-band={band} tabIndex={cell.filled ? 0 : undefined} aria-label={description}>
        {cell.filled ? <title>{description}</title> : null}
        <rect x={x} y={y} width={on} height="25" fill={GREEN} data-on-time={cell.onTime} /><rect x={x + on} y={y} width={late} height="25" fill={RED} data-late={cell.late} /><rect x={x + on + late} y={y} width={unknown} height="25" fill={GRAY} data-unknown={cell.unknownSla} />
        {cell.filled > 0 ? <text x={x + on + late + unknown + 4} y={y + 17} textAnchor="start" fontSize="9" fontWeight="600" fill="#475569" data-sla-label>{percent}</text> : null}
      </g>; })}
    </g>; })}
    {cells.every(cell => cell.filled === 0) ? <text x={width / 2} y={bottom / 2} textAnchor="middle" fill="#64748B" fontSize="11">{t.noFills}</text> : null}
  </svg></div>;
}
