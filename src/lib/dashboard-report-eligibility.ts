import { getSlaDays } from "@/lib/sla";
import { countsTowardHeadcountAt } from "@/lib/offer-headcount";
import type { DashboardData, EnrichedRequisition, RequisitionStatus } from "@/types/recruitment";
import type { PerformancePeriod as ReportView } from "@/lib/recruitment-performance";
export function isReportEligible(requisition: EnrichedRequisition, data: DashboardData, startDate: string, endDate: string, reportView: ReportView) {
    const prDate = validDateOnly(requisition.pr_approved_date);
    const snapshot = requisitionSnapshotAt(data, requisition, endDate);
    const closeDate = snapshot.filledDate;
    if (!prDate || snapshot.status === "cancel" || prDate > endDate || Boolean(closeDate && closeDate < startDate))
        return false;
    if (reportView === "pim" || reportView === "custom")
        return true;
    const slaDays = getSlaDays(requisition.level);
    const slaDeadline = slaDays === null ? null : addCalendarDays(prDate, slaDays);
    return Boolean(slaDeadline && slaDeadline >= startDate);
}
export function validDateOnly(value: string | null | undefined) {
    const date = dateOnly(value);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        return null;
    const [year, month, day] = date.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day ? date : null;
}
export function requisitionSnapshotAt(data: DashboardData, requisition: EnrichedRequisition, endDate: string) {
    const logs = data.requisition_logs.filter((log) => log.doc_id === requisition.doc_id);
    const latest = logs.filter((log) => log.log_date <= endDate).sort((a, b) => a.log_date.localeCompare(b.log_date) || a.log_id - b.log_id).at(-1);
    // Cancellation is a deliberate terminal action. Offer coverage, rather
    // than a requisition log, is the source of truth for Filled: automatic
    // offer updates do not create requisition_log rows.
    if (latest?.status === "cancel" || (logs.length === 0 && requisition.status === "cancel")) {
        return { status: "cancel" as RequisitionStatus, remark: latest?.remark ?? null, filledDate: null };
    }
    const offerFilledDate = offerFilledDateAtPeriodEnd(data, requisition, endDate);
    if (offerFilledDate)
        return { status: "filled" as RequisitionStatus, remark: latest?.remark ?? null, filledDate: offerFilledDate };
    if (latest?.status === "filled") {
        return { status: "filled" as RequisitionStatus, remark: latest.remark ?? null, filledDate: validDateOnly(latest.log_date) };
    }
    return { status: "ongoing" as RequisitionStatus, remark: latest?.remark ?? null, filledDate: null };
}
export function offerFilledDateAtPeriodEnd(data: DashboardData, requisition: EnrichedRequisition, endDate: string) {
    const acceptanceDates = Array.from(new Set(data.offers
        .filter((offer) => offer.doc_id === requisition.doc_id)
        .map((offer) => validDateOnly(offer.accepted_date))
        .filter((date): date is string => Boolean(date && date <= endDate)))).sort();
    let filledDate: string | null = null;
    for (const date of acceptanceDates) {
        const coverageDate = addCalendarDays(date, 1);
        const coveredHeadcount = data.offers.filter((offer) => offer.doc_id === requisition.doc_id && countsTowardHeadcountAt(offer, coverageDate)).length;
        if (coveredHeadcount >= requisition.head_count)
            filledDate = date;
    }
    const coveredAtPeriodEnd = data.offers.filter((offer) => offer.doc_id === requisition.doc_id && countsTowardHeadcountAt(offer, addCalendarDays(endDate, 1))).length;
    return coveredAtPeriodEnd >= requisition.head_count ? filledDate : null;
}
export function addCalendarDays(value: string, days: number) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
export function dateOnly(value: string | null | undefined) {
    if (!value)
        return null;
    return value.slice(0, 10);
}
