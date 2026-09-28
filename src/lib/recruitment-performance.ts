import { filledSlaAtAcceptance } from "@/lib/vacancy-executive";
import { getSlaDays } from "@/lib/sla";
import type { DashboardData, EnrichedOffer, EnrichedRequisition, RequisitionRequestType } from "@/types/recruitment";

export type PerformancePeriod = "mtd" | "ytd" | "pim";
export type PerformanceBand = "NML" | "FML" | "MML" | "SML" | "Executive" | "Unknown";
export const PERFORMANCE_BANDS: PerformanceBand[] = ["NML", "FML", "MML", "SML", "Executive", "Unknown"];
export type PerformanceRange = { start: string; end: string };
export type PerformanceCell = { site: string; band: PerformanceBand; vacancies: number; filled: number; open: number; onTime: number; late: number; unknownSla: number; newVacancies: number; replacementVacancies: number };
export type PerformanceMetrics = { vacancies: number; filled: number; open: number; filledPct: number | null; slaPct: number | null; avgTimeToFill: number | null; onTime: number; late: number; unknownSla: number };
export type PerformanceReport = { range: PerformanceRange; metrics: PerformanceMetrics; cells: PerformanceCell[]; sites: string[] };

const DAY = 86_400_000;
const validDate = (value: string | null | undefined) => {
  const day = value?.slice(0, 10);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? day : null;
};
const shiftDays = (day: string, amount: number) => new Date(Date.parse(`${day}T00:00:00Z`) + amount * DAY).toISOString().slice(0, 10);
const daysBetween = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY);
const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

export function performanceRange(period: PerformancePeriod, year: number, month: number, today: string): PerformanceRange {
  const safeYear = Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : Number(today.slice(0, 4));
  const safeMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : Number(today.slice(5, 7));
  const selectedMonth = `${safeYear}-${String(safeMonth).padStart(2, "0")}`;
  const end = period === "pim" ? monthEnd(safeYear, safeMonth) : selectedMonth === today.slice(0, 7) ? today : monthEnd(safeYear, safeMonth);
  return { start: period === "ytd" ? `${safeYear}-01-01` : `${selectedMonth}-01`, end };
}

export function previousPerformanceRange(period: PerformancePeriod, range: PerformanceRange): PerformanceRange {
  if (period !== "ytd") {
    const length = daysBetween(range.start, range.end) + 1;
    const end = shiftDays(range.start, -1);
    return { start: shiftDays(end, 1 - length), end };
  }
  const priorYear = Number(range.end.slice(0, 4)) - 1;
  const month = Number(range.end.slice(5, 7));
  const day = Math.min(Number(range.end.slice(8, 10)), Number(monthEnd(priorYear, month).slice(8, 10)));
  return { start: `${priorYear}-01-01`, end: `${priorYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

export function performanceBand(level: string | null): PerformanceBand {
  const match = level?.trim().match(/^L?(0|[1-9]|1[0-4])$/i);
  if (!match) return "Unknown";
  const value = Number(match[1]);
  return value <= 3 ? "NML" : value <= 6 ? "FML" : value <= 9 ? "MML" : value <= 12 ? "SML" : "Executive";
}

function statusAt(data: DashboardData, requisition: EnrichedRequisition, end: string) {
  const logs = data.requisition_logs.filter((row) => row.doc_id === requisition.doc_id && validDate(row.log_date) && row.log_date.slice(0, 10) <= end)
    .sort((a, b) => a.log_date.localeCompare(b.log_date) || a.log_id - b.log_id);
  return logs.at(-1)?.status ?? (validDate(requisition.created_at) && requisition.created_at.slice(0, 10) > end ? "ongoing" : requisition.status);
}

function offerEffectiveAt(offer: EnrichedOffer, end: string) {
  const accepted = validDate(offer.accepted_date);
  if (!accepted || accepted > end) return false;
  const noShow = validDate(offer.start_confirmed_at);
  return offer.start_confirmation !== "did_not_start" || Boolean(noShow && noShow > end);
}

function eligible(data: DashboardData, requisition: EnrichedRequisition, offers: EnrichedOffer[], range: PerformanceRange, period: PerformancePeriod) {
  const pr = validDate(requisition.pr_approved_date);
  if (!pr || pr > range.end || statusAt(data, requisition, range.end) === "cancel") return false;
  const related = offers.filter((offer) => offer.doc_id === requisition.doc_id);
  const acceptedByStart = related.filter((offer) => offerEffectiveAt(offer, shiftDays(range.start, -1))).length;
  const filledLogs = data.requisition_logs.filter((row) => row.doc_id === requisition.doc_id && row.status === "filled" && validDate(row.log_date) && row.log_date.slice(0, 10) < range.start);
  const reopenedInRange = related.some((offer) => offer.start_confirmation === "did_not_start" && validDate(offer.start_confirmed_at) && offer.start_confirmed_at!.slice(0, 10) >= range.start && offer.start_confirmed_at!.slice(0, 10) <= range.end);
  if ((acceptedByStart >= requisition.head_count || (related.length === 0 && filledLogs.length > 0)) && !reopenedInRange) return false;
  if (period === "pim") return true;
  const slaDays = getSlaDays(requisition.level);
  return slaDays !== null && shiftDays(pr, slaDays) >= range.start;
}

export function buildPerformanceReport(data: DashboardData, requisitions: EnrichedRequisition[], offers: EnrichedOffer[], range: PerformanceRange, period: PerformancePeriod, site = "", department = ""): PerformanceReport {
  const cells = new Map<string, PerformanceCell>();
  let timeTotal = 0;
  let timeCount = 0;
  const scoped = requisitions.filter((row) => (!site || row.site === site) && (!department || row.department === department));
  for (const requisition of scoped) {
    if (!eligible(data, requisition, offers, range, period)) continue;
    const band = performanceBand(requisition.level);
    const key = `${requisition.site}\u0000${band}`;
    const cell = cells.get(key) ?? { site: requisition.site, band, vacancies: 0, filled: 0, open: 0, onTime: 0, late: 0, unknownSla: 0, newVacancies: 0, replacementVacancies: 0 };
    const capacity = Math.max(0, requisition.head_count);
    cell.vacancies += capacity;
    const requestType: RequisitionRequestType = requisition.request_type === "Replacement" ? "Replacement" : "New";
    if (requestType === "New") cell.newVacancies += capacity;
    else cell.replacementVacancies += capacity;
    const related = offers.filter((offer) => offer.doc_id === requisition.doc_id);
    const counted = related.filter((offer) => {
      const accepted = validDate(offer.accepted_date);
      return accepted && accepted >= range.start && accepted <= range.end && offerEffectiveAt(offer, range.end);
    }).sort((a, b) => (a.accepted_date ?? "").localeCompare(b.accepted_date ?? "") || a.offer_id - b.offer_id).slice(0, capacity);
    for (const offer of counted) {
      cell.filled += 1;
      const accepted = validDate(offer.accepted_date)!;
      const sla = filledSlaAtAcceptance(requisition, accepted, related.filter((row) => row.start_confirmation === "did_not_start").map((row) => row.start_confirmed_at));
      if (sla === true) cell.onTime += 1;
      else if (sla === false) cell.late += 1;
      else cell.unknownSla += 1;
      const pr = validDate(requisition.pr_approved_date);
      if (pr && accepted >= pr) { timeTotal += daysBetween(pr, accepted); timeCount += 1; }
    }
    cell.open = Math.max(0, cell.vacancies - cell.filled);
    cells.set(key, cell);
  }
  const values = [...cells.values()].sort((a, b) => a.site.localeCompare(b.site) || PERFORMANCE_BANDS.indexOf(a.band) - PERFORMANCE_BANDS.indexOf(b.band));
  const vacancies = values.reduce((sum, row) => sum + row.vacancies, 0);
  const filled = values.reduce((sum, row) => sum + row.filled, 0);
  const onTime = values.reduce((sum, row) => sum + row.onTime, 0);
  const late = values.reduce((sum, row) => sum + row.late, 0);
  const unknownSla = values.reduce((sum, row) => sum + row.unknownSla, 0);
  return { range, cells: values, sites: [...new Set(values.map((row) => row.site))], metrics: { vacancies, filled, open: Math.max(0, vacancies - filled), filledPct: vacancies ? filled / vacancies * 100 : null, slaPct: onTime + late ? onTime / (onTime + late) * 100 : null, avgTimeToFill: timeCount ? timeTotal / timeCount : null, onTime, late, unknownSla } };
}
