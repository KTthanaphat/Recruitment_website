"use client";

import { AttendanceDecisionActions, type AttendanceOutcome } from "@/components/ui/AttendanceDecisionActions";
import { Tag } from "@/components/ui/Tag";
import { formatDate, formatRecruitmentId, formatRequisitionTitle } from "@/lib/format";
import { formatLocalDateInput } from "@/lib/dates";
import { translate } from "@/lib/i18n/dictionary";
import type { EnrichedOffer, EnrichedRequisition, Language } from "@/types/recruitment";

export const NEW_HIRE_CONFIRMATION_COLUMNS = "md:grid-cols-[minmax(10rem,1.25fr)_minmax(11rem,1.35fr)_minmax(9rem,1fr)_minmax(8rem,.85fr)_minmax(8rem,.8fr)_minmax(9rem,1fr)]";

export function NewHireConfirmationRow({ language, offer, onConfirm, onOpenCandidate, requisition, layout = "table", canConfirm = true }: {
  language: Language; offer: EnrichedOffer; onConfirm?: (outcome: AttendanceOutcome) => void | Promise<void>;
  onOpenCandidate: (candidateId: string, applicationId?: string) => void;
  requisition?: Pick<EnrichedRequisition, "site" | "person_in_charge">;
  layout?: "table" | "card"; canConfirm?: boolean;
}) {
  const card = layout === "card";
  const due = Boolean(offer.accepted_date && offer.first_working_date && offer.first_working_date <= formatLocalDateInput());
  const eligible = due && !offer.start_confirmation;
  const field = (key: Parameters<typeof translate>[1]) => <span className={card ? "mb-1 block text-xs font-medium text-slate" : "text-[11px] font-medium text-slate md:hidden"}>{translate(language, key)}</span>;
  const status = offer.start_confirmation === "started" ? translate(language, "startedWorkConfirmed")
    : offer.start_confirmation === "did_not_start" ? language === "th" ? "ไม่ได้เริ่มงาน" : "Did not start"
    : due ? translate(language, "pending") : language === "th" ? "นัดเริ่มงาน" : "Scheduled";
  return <article data-new-hire-confirmation className={card ? "grid min-w-0 gap-4 text-sm sm:grid-cols-2" : `grid min-w-0 gap-2 px-2 py-2.5 text-[13px] md:items-center md:gap-3 md:text-xs xl:text-[13px] ${NEW_HIRE_CONFIRMATION_COLUMNS}`}>
    <div className="min-w-0">{field("candidate")}<button type="button" className="block min-h-11 max-w-full rounded-sm text-left font-semibold text-navy underline-offset-2 hover:text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30 md:min-h-0" title={offer.candidate_name ?? formatRecruitmentId(offer.candidate_id)} aria-label={`${translate(language, "openCandidate")}: ${offer.candidate_name ?? formatRecruitmentId(offer.candidate_id)}`} onClick={() => onOpenCandidate(offer.candidate_id, offer.application_id)}><span className={card ? "block break-words" : "block truncate"}>{offer.candidate_name ?? formatRecruitmentId(offer.candidate_id)}</span></button><span className="block truncate text-[11px] font-medium text-slate">{formatRecruitmentId(offer.candidate_id)}</span></div>
    <div className="min-w-0">{field("requisition")}<span className={card ? "block break-words font-medium text-navy" : "block truncate font-medium text-navy"} title={`${formatRequisitionTitle(offer)} · ${offer.doc_id}`}>{formatRequisitionTitle(offer)} · {offer.doc_id}</span></div>
    <div className="min-w-0">{field("siteOwner")}<span className="block break-words text-slate">{requisition?.site || offer.site || "—"} · {requisition?.person_in_charge || offer.person_in_charge || translate(language, "unassigned")}</span></div>
    <div className="min-w-0">{field("firstWorkingDate")}<span className="block font-medium tabular-nums text-slate">{formatDate(offer.first_working_date, language)}</span></div>
    <div className="min-w-0">{field("confirmationState")}<Tag appearance="soft" tone={offer.start_confirmation === "started" ? "success" : offer.start_confirmation === "did_not_start" ? "danger" : due ? "warning" : "muted"}>{status}</Tag></div>
    <div className="min-w-0">{field("confirmationAction")}{canConfirm && onConfirm && eligible ? <AttendanceDecisionActions language={language} onDecision={onConfirm}/> : card ? <p className="text-xs text-slate">{!canConfirm ? language === "th" ? "ดูข้อมูลเท่านั้น" : "Read only" : !due ? language === "th" ? "ยืนยันได้ในวันเริ่มงาน" : "Available on the first working date" : language === "th" ? "บันทึกผลแล้ว" : "Already recorded"}</p> : null}</div>
  </article>;
}
