import { getRequisitionSlaState } from "./sla";

type Movement = { site: string; waterfall_category: string; request_type: string; vacancy_count: number; filledInSla?: number; filledSlaUnknown?: number };

export function filledSlaAtAcceptance(
  requisition: { pr_approved_date: string | null; level: string | null; status: string; sla_restart_date?: string | null },
  acceptedDate: string,
  restartDates: Array<string | null>
): boolean | null {
  const validDate = (value: string | null | undefined) => {
    const date = value?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
  };
  const end = validDate(acceptedDate);
  if (!end) return null;
  const restart = [...restartDates, requisition.sla_restart_date]
    .map(validDate).filter((date): date is string => Boolean(date && date <= end)).sort().at(-1);
  const start = restart ?? validDate(requisition.pr_approved_date);
  if (!start || start > end) return null;
  return getRequisitionSlaState({ ...requisition, pr_approved_date: start, sla_restart_date: null }, { endDate: end }).inSla;
}

export function waterfallExecutiveRows(rows: Movement[]) {
  const sites = ["HQ", "KT1", "KT2", ...Array.from(new Set(rows.map(row => row.site))).filter(site => !["HQ", "KT1", "KT2"].includes(site)).sort()];
  const makeRow = (site: string | null) => {
    const selected = rows.filter(row => site === null || row.site === site);
    const sum = (category: string, type?: string) => selected.filter(row => row.waterfall_category === category && (!type || row.request_type === type)).reduce((total, row) => total + row.vacancy_count, 0);
    const filledRows = selected.filter(row => row.waterfall_category === "Filled");
    const filled = -sum("Filled");
    const inSla = filledRows.reduce((total, row) => total + (row.filledInSla ?? 0), 0);
    const unknown = filledRows.reduce((total, row) => total + (row.filledSlaUnknown ?? (row.filledInSla === undefined ? Math.abs(row.vacancy_count) : 0)), 0);
    const opening = sum("Week Start");
    const closing = sum("Total");
    return { site: site ?? "Total", grandTotal: site === null, opening, opened: sum("Open"), filled, closing, net: closing - opening,
      inSla, unknown, slaPercent: filled > 0 && unknown === 0 ? Math.round(inSla / filled * 100) : null,
      openNew: sum("Open", "New"), openReplacement: sum("Open", "Replacement"), filledNew: -sum("Filled", "New"), filledReplacement: -sum("Filled", "Replacement") };
  };
  return [...sites.map(makeRow), makeRow(null)];
}
