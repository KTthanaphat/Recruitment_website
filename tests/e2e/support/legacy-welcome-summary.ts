import { ACTIVE_PIPELINE_STAGES } from "../../../src/lib/constants";
import { applicationKey } from "../../../src/lib/applications";
import { formatLocalDateInput } from "../../../src/lib/dates";
import type { DashboardData, EnrichedCandidate, EnrichedRequisition } from "../../../src/types/recruitment";

/** Test-only parity reference for the pre-summary Welcome metrics. Never use for live UI data. */
export type LegacyWelcomeSummary = {
  openRequisitions: number;
  openVacancy: number;
  activeCandidates: number;
  offerFinalizationNeeded: number;
  filledThisMonth: number;
  responsibleVacancyTotal: number;
  filledResponsibleVacancyRatio: number;
  filledResponsibleVacancyBucket: 0 | 25 | 50 | 75 | 100;
};

export function buildLegacyWelcomeSummary(
  requisitions: EnrichedRequisition[],
  candidates: EnrichedCandidate[],
  offers: DashboardData["offers"],
  requisitionLogs: DashboardData["requisition_logs"],
  profile: DashboardData["profile"],
  today = todayDate()
): LegacyWelcomeSummary {
  const responsibleRequisitions = responsibleRows(requisitions, profile);
  const responsibleCandidates = responsibleRows(candidates, profile);
  const offerCandidateIds = new Set(offers.map((offer) => offer.application_id ?? offer.candidate_id));
  const actionableRequisitions = responsibleRequisitions.filter((row) => row.status !== "filled" && row.status !== "cancel" && row.open_headcount > 0);
  const responsibleVacancyRequisitions = responsibleRequisitions.filter((row) => isPimEligible(row, offers, requisitionLogs, today));
  const responsibleDocIds = new Set(responsibleVacancyRequisitions.map((row) => row.doc_id));
  const responsibleVacancyTotal = responsibleVacancyRequisitions.reduce((sum, row) => sum + row.head_count, 0);
  const filledThisMonth = offers.filter((offer) =>
    responsibleDocIds.has(offer.doc_id) && isAcceptedThisCalendarMonth(offer.accepted_date, today)
  ).length;
  const filledResponsibleVacancyRatio = responsibleVacancyTotal > 0
    ? Math.floor((filledThisMonth / responsibleVacancyTotal) * 100)
    : 0;
  const activeCandidates = responsibleCandidates.filter(
    (row) => row.latest_process !== "No activity"
      && ACTIVE_PIPELINE_STAGES.includes(row.latest_process)
      && row.latest_result !== 0
      && !offerCandidateIds.has(applicationKey(row))
  );
  const offerFinalizationNeeded = activeCandidates.filter((row) => row.latest_process === "Offer" && row.latest_result === 1).length;

  return {
    openRequisitions: actionableRequisitions.length,
    openVacancy: actionableRequisitions.reduce((sum, row) => sum + row.open_headcount, 0),
    activeCandidates: activeCandidates.length,
    offerFinalizationNeeded,
    filledThisMonth,
    responsibleVacancyTotal,
    filledResponsibleVacancyRatio,
    filledResponsibleVacancyBucket: welcomeRatioBucket(filledResponsibleVacancyRatio)
  };
}

function isAcceptedThisCalendarMonth(value: string | null | undefined, today: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value)) return false;
  const acceptedDate = dateOnly(value);
  if (!acceptedDate || !isValidCalendarDate(acceptedDate)) return false;
  const monthStart = `${today.slice(0, 7)}-01`;
  return acceptedDate >= monthStart && acceptedDate <= today;
}

function isPimEligible(requisition: EnrichedRequisition, offers: DashboardData["offers"], logs: DashboardData["requisition_logs"], today: string) {
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = `${today.slice(0, 7)}-${new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate()}`;
  const prDate = dateOnly(requisition.pr_approved_date);
  if (!prDate || requisition.status === "cancel" || prDate > monthEnd) return false;
  const filledLogDate = logs.filter((log) => log.doc_id === requisition.doc_id && log.status === "filled").map((log) => dateOnly(log.log_date)).filter(Boolean).sort().at(-1);
  const closeDate = filledLogDate ?? offers.filter((offer) => offer.doc_id === requisition.doc_id).map((offer) => dateOnly(offer.accepted_date)).filter(Boolean).sort().at(-1) ?? null;
  return !closeDate || closeDate >= monthStart;
}

function isValidCalendarDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function welcomeRatioBucket(ratio: number): LegacyWelcomeSummary["filledResponsibleVacancyBucket"] {
  if (ratio >= 100) return 100;
  if (ratio >= 75) return 75;
  if (ratio >= 50) return 50;
  if (ratio >= 25) return 25;
  return 0;
}

function todayDate() { return formatLocalDateInput(); }
function dateOnly(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return formatLocalDateInput(date);
}

function responsibleRows<T extends { site?: string | null; person_in_charge?: string | null }>(rows: T[], profile: DashboardData["profile"]) {
  if (!profile || profile.role === "system_admin" || profile.role === "admin_recruiter") return rows;
  const ownerNames = [profile.nickname, profile.full_name].filter(Boolean).map((value) => value!.toLowerCase());
  const site = profile.site?.toLowerCase();
  return rows.filter((row) => {
    const rowOwner = (row.person_in_charge ?? "").toLowerCase();
    const rowSite = (row.site ?? "").toLowerCase();
    return ownerNames.some((owner) => rowOwner.includes(owner)) || Boolean(site && rowSite.includes(site));
  });
}
