import { validDashboardDate } from "./dashboard-filters";
import { addCalendarDays } from "./dashboard-report-eligibility";
import type { DashboardData, EnrichedRequisition, Offer } from "@/types/recruitment";

/** Date fields stay dates; timestamps are interpreted on the Bangkok calendar. */
export function bangkokDay(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!validDashboardDate(value.slice(0, 10))) return null;
  if (value.length === 10) return validDashboardDate(value) ? value : null;
  const time = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+07:00`);
  return Number.isFinite(time) ? new Date(time + 7 * 3600000).toISOString().slice(0, 10) : null;
}
export function calendarDays(start: string, end: string) {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}
export function historicalOffer(offer: Offer, date: string) {
  const accepted = bangkokDay(offer.accepted_date), reopened = offer.start_confirmation === "did_not_start" ? bangkokDay(offer.start_confirmed_at) : null;
  return { accepted, reopened, covered: Boolean(accepted && accepted <= date && (!reopened || reopened > date)) };
}
export function historicalVacancy(data: DashboardData, requisition: EnrichedRequisition, date: string) {
  const approval = bangkokDay(requisition.pr_approved_date), created = bangkokDay(requisition.created_at);
  const logs = data.requisition_logs.filter(row => row.doc_id === requisition.doc_id);
  const latest = logs.filter(row => { const day = bangkokDay(row.log_date); return day && day <= date; })
    .sort((a, b) => String(bangkokDay(a.log_date)).localeCompare(String(bangkokDay(b.log_date))) || a.log_id - b.log_id).at(-1);
  const existed = Boolean((approval ?? created) && (approval ?? created)! <= date);
  const cancelled = latest?.status === "cancel" || (!logs.length && requisition.status === "cancel");
  const offers = data.offers.filter(row => row.doc_id === requisition.doc_id).map(offer => ({ offer, ...historicalOffer(offer, date) }));
  const covered = Math.min(Math.max(0, requisition.head_count), offers.filter(row => row.covered).length);
  const restart = offers.map(row => row.reopened).filter((day): day is string => Boolean(day && day <= date)).sort().at(-1) ?? null;
  const loggedFilled = latest?.status === "filled" && !(restart && restart >= (bangkokDay(latest.log_date) ?? ""));
  const remaining = existed && !cancelled && !loggedFilled ? Math.max(0, requisition.head_count - covered) : 0;
  return { remaining, covered, existed, cancelled, start: restart ?? approval, restart, offers };
}
export function observationDates(start: string, end: string) {
  if (start > end) return [];
  const days = calendarDays(start, end), count = Math.min(8, days + 1);
  return Array.from({ length: count }, (_, i) => addCalendarDays(start, count === 1 ? 0 : Math.round(i * days / (count - 1))));
}
