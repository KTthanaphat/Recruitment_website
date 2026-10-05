import type { DashboardData, EnrichedRequisition } from "@/types/recruitment";
import { addCalendarDays } from "./dashboard-report-eligibility";
import { historicalVacancy, calendarDays, observationDates } from "./dashboard-history";
import { getSlaDays } from "./sla";
export type RiskKind = "track" | "near" | "overdue" | "unknown";
export type RiskFilter = RiskKind | "all" | "attention" | "priority";
export type RiskGrouping = "department-site" | "department" | "site";
export type VacancyRiskRow = { requisition: EnrichedRequisition; open: number; covered: number; start: string | null; restart: string | null; deadline: string | null; age: number | null; remaining: number | null; kind: RiskKind };
export type RiskTotals = Record<RiskKind, number> & { open: number; priority: number; priorityOpen: number; known: number; exposure: number | null };
export function riskTotals(rows: VacancyRiskRow[]): RiskTotals {
  const totals = { track: 0, near: 0, overdue: 0, unknown: 0, open: 0, priority: 0, priorityOpen: 0, known: 0, exposure: null as number | null };
  for (const row of rows) { totals[row.kind] += row.open; totals.open += row.open; if (row.requisition.is_priority) totals.priorityOpen += row.open; if (row.requisition.is_priority && ["near", "overdue"].includes(row.kind)) totals.priority += row.open; }
  totals.known = totals.open - totals.unknown;
  totals.exposure = totals.known ? (totals.near + totals.overdue) / totals.known : null;
  return totals;
}
export function vacancyRiskAt(data: DashboardData, requisitions: EnrichedRequisition[], date: string) {
  const rows: VacancyRiskRow[] = [];
  for (const requisition of requisitions) {
    const state = historicalVacancy(data, requisition, date);
    if (!state.remaining) continue;
    const levelValid = /^L?(?:[0-9]|1[0-4])$/i.test(requisition.level?.trim() ?? "");
    const sla = levelValid ? getSlaDays(requisition.level?.trim()) : null;
    const deadline = state.start && sla !== null ? addCalendarDays(state.start, sla) : null;
    const age = state.start ? calendarDays(state.start, date) : null;
    const remaining = deadline ? calendarDays(date, deadline) : null;
    rows.push({ requisition, open: state.remaining, covered: state.covered, start: state.start, restart: state.restart, deadline, age, remaining, kind: remaining === null ? "unknown" : remaining < 0 ? "overdue" : remaining <= 7 ? "near" : "track" });
  }
  rows.sort((a, b) => (a.kind === "overdue" ? 0 : 1) - (b.kind === "overdue" ? 0 : 1) || (a.remaining ?? Infinity) - (b.remaining ?? Infinity) || b.open - a.open || a.requisition.doc_id.localeCompare(b.requisition.doc_id));
  return { rows, totals: riskTotals(rows) };
}
export function riskGroupKey(row: VacancyRiskRow, grouping: RiskGrouping) { return grouping === "department" ? row.requisition.department : grouping === "site" ? row.requisition.site : `${row.requisition.site} · ${row.requisition.department}`; }
export function riskGroups(rows: VacancyRiskRow[], grouping: RiskGrouping) {
  const groups = new Map<string, VacancyRiskRow[]>();
  for (const row of rows) { const key = riskGroupKey(row, grouping); groups.set(key, [...(groups.get(key) ?? []), row]); }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, records]) => ({ name, ...riskTotals(records) }));
}
export function riskRowMatches(row: VacancyRiskRow, filter: RiskFilter) { return filter === "all" || row.kind === filter || filter === "attention" && ["near", "overdue"].includes(row.kind) || filter === "priority" && Boolean(row.requisition.is_priority) && ["near", "overdue"].includes(row.kind); }
export function buildVacancyRiskReport(data: DashboardData, requisitions: EnrichedRequisition[], range: { start: string; end: string }, today: string, priorRange: { start: string; end: string }) {
  const asOf = range.end < today ? range.end : today, current = vacancyRiskAt(data, requisitions, asOf);
  const coverage = (date: string, period: string) => requisitions.flatMap(req => {
    const state = historicalVacancy(data, req, date);
    const selected = new Set(state.offers.filter(row => row.covered).sort((a, b) => a.accepted!.localeCompare(b.accepted!) || a.offer.offer_id - b.offer.offer_id).slice(0, Math.max(0, req.head_count)).map(row => row.offer.offer_id));
    return state.offers.map(row => ({ period, docId: req.doc_id, offerId: row.offer.offer_id, accepted: row.accepted, reopened: row.reopened, covered: Number(selected.has(row.offer.offer_id)), reason: selected.has(row.offer.offer_id) ? "Covered" : row.covered ? "Headcount cap" : row.reopened && row.reopened <= date ? "No-show reopening" : "Not effective at snapshot" }));
  });
  return { asOf, future: range.start > asOf, ...current, prior: range.start > asOf ? null : vacancyRiskAt(data, requisitions, priorRange.end), priorRange,
    trends: observationDates(range.start, asOf).map(date => ({ date, ...vacancyRiskAt(data, requisitions, date).totals })),
    coverage: [...coverage(asOf, "Current"), ...(range.start > asOf ? [] : coverage(priorRange.end, "Prior"))] };
}
export type VacancyRiskReport = ReturnType<typeof buildVacancyRiskReport>;
