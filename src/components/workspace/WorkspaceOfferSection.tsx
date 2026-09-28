"use client";

import { AlertTriangle, ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordActionGroup, type RecordAction } from "@/components/ui/Operations";
import { SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { formatDate, formatRequisitionOptionLabel, formatRequisitionTitle } from "@/lib/format";
import { offerStatusLabel, translate } from "@/lib/i18n/dictionary";
import { offerStatus } from "@/lib/operations";
import { countsTowardHeadcount } from "@/lib/offer-headcount";
import type { EnrichedCandidate, EnrichedOffer, EnrichedRequisition, Language, Offer, Profile, WorkspaceActionRequest } from "@/types/recruitment";

export type WorkspaceOfferSectionProps = {
  offers: EnrichedOffer[];
  candidates: EnrichedCandidate[];
  requisitions: EnrichedRequisition[];
  allOffers: Offer[];
  canWrite: boolean;
  profile?: Profile | null;
  language?: Language;
  onAction: (request: WorkspaceActionRequest) => void;
  onOpenCandidate: (candidateId: string) => void;
  onOpenRequisition: (docId: string) => void;
};

/** Scoped offer records, their follow-up actions, and requisition reconciliation. */
export function WorkspaceOfferSection({
  offers,
  candidates,
  requisitions,
  allOffers,
  canWrite,
  language = "en",
  profile,
  onAction,
  onOpenCandidate,
  onOpenRequisition
}: WorkspaceOfferSectionProps) {
  const offeredCandidateIds = new Set(allOffers.map((offer) => offer.candidate_id));
  const eligibleCandidate = candidates.find((candidate) => (
    candidate.latest_process === "Offer"
    && candidate.latest_result === 1
    && !offeredCandidateIds.has(candidate.candidate_id)
  ));
  const reconciliationRows = requisitions.filter((row) => (
    row.status === "ongoing" && acceptedFor(row.doc_id, allOffers) >= row.head_count
  ));
  const writeDisabledReason = profile?.role === "viewer"
    ? "Viewer access: offer updates are disabled."
    : "You do not have permission to update offer records.";
  const newOfferDisabledReason = !canWrite
    ? writeDisabledReason
    : !eligibleCandidate
      ? "No eligible Offer-pass candidate is available in this workspace."
      : undefined;

  return (
    <section className="min-w-0">
      <SectionTitle
        title="Offers"
        eyebrow="Headcount impact and start dates"
        action={(
          <div className="grid justify-items-end gap-1">
            <span title={newOfferDisabledReason}>
              <Button
                type="button"
                size="icon-sm"
                icon={<Plus size={17} />}
                disabled={Boolean(newOfferDisabledReason)}
                aria-label={translate(language, "newOffer")}
                title={translate(language, "newOffer")}
                aria-describedby={newOfferDisabledReason ? "workspace-new-offer-reason" : undefined}
                onClick={() => {
                  if (eligibleCandidate) onAction({ kind: "offer.upsert", candidateId: eligibleCandidate.candidate_id });
                }}
              />
            </span>
            {newOfferDisabledReason ? <p id="workspace-new-offer-reason" className="max-w-56 text-right text-xs font-medium text-slate">{newOfferDisabledReason}</p> : null}
          </div>
        )}
      />
      {reconciliationRows.length > 0 ? (
        <div className="mb-3 grid gap-2 rounded-md border border-[#F0C36A] bg-[#FFF8E1] p-3">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-[#8A5A00]" size={17} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-navy">Requisition status needs reconciliation</p>
              <p className="mt-0.5 text-xs font-medium text-slate">Accepted offers meet requested headcount while the requisition is still ongoing.</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {reconciliationRows.map((row) => (
              <div key={row.doc_id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border border-[#E8D7A4] bg-white/70 p-2">
                <button type="button" aria-label={formatRequisitionOptionLabel(row)} className="grid min-w-0 gap-0.5 break-words text-left focus:outline-none focus:ring-2 focus:ring-primary/25" onClick={() => onOpenRequisition(row.doc_id)}>
                  <span className="text-sm font-semibold text-navy">{formatRequisitionTitle(row)} <span className="font-medium text-slate">({acceptedFor(row.doc_id, allOffers)}/{row.head_count})</span></span>
                  <span className="text-[10px] font-medium text-cool">{translate(language, "requisitionId")}: {row.doc_id}</span>
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md bg-primary px-3 text-sm font-semibold text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:bg-cool"
                  disabled={!canWrite}
                  title={!canWrite ? writeDisabledReason : "Mark the requisition as filled"}
                  onClick={() => onAction({ kind: "requisition.status", docId: row.doc_id })}
                >
                  Reconcile status
                </button>
              </div>
            ))}
          </div>
          {!canWrite ? <p className="text-xs font-medium text-[#8A5A00]">{writeDisabledReason}</p> : null}
        </div>
      ) : null}

      {offers.length === 0 ? <EmptyState message={translate(language, "noOffersWorkspace")} /> : (
        <div className="min-w-0 divide-y divide-[#E4E9F2] border-y border-[#E4E9F2]">
          <div className="hidden gap-3 py-2 text-left text-xs font-semibold text-slate md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto]"><span>{translate(language, "candidate")}</span><span>{translate(language, "requisition")}</span><span>{translate(language, "workspaceImpact")}</span><span>{translate(language, "actions")}</span></div>
          {offers.map((offer) => {
            const status = offerStatus(offer);
            const requisition = requisitions.find((row) => row.doc_id === offer.doc_id);
            const accepted = acceptedFor(offer.doc_id, allOffers);
            const impact = requisition ? `${accepted}/${requisition.head_count} accepted - ${Math.max(requisition.head_count - accepted, 0)} open` : "Requisition not found";
            const primary: RecordAction = {
              id: `offer-update-${offer.offer_id}`,
              label: status.label === "Missing start date" ? "Add start date" : "Update offer",
              icon: <ExternalLink aria-hidden="true" size={15} />,
              tone: "primary",
              onSelect: () => onAction({ kind: "offer.upsert", candidateId: offer.candidate_id, offerId: offer.offer_id }),
              disabledReason: !canWrite ? { blocked: true, code: "readonly_role", label: "Read only", detail: writeDisabledReason } : undefined
            };
            const details: RecordAction[] = [
              { id: `offer-workspace-${offer.offer_id}`, label: "Open requisition workspace", href: `/workspace?type=requisition&id=${encodeURIComponent(offer.doc_id)}` }
            ];

            return (
              <article key={offer.offer_id} className="grid min-w-0 gap-3 py-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                    <button type="button" className="min-w-0 break-words text-left font-bold text-navy focus:outline-none focus:ring-2 focus:ring-primary/25" onClick={() => onOpenCandidate(offer.candidate_id)}>
                      {offer.candidate_name ?? offer.candidate_id}
                    </button>
                    <Tag tone={status.tone}>{offerStatusLabel(language, status.label)}</Tag>
                  </div>
                  <p className="text-[10px] font-medium text-cool">{offer.candidate_id}</p>
                </div>
                <div className="min-w-0"><span className="text-xs text-slate md:sr-only">{translate(language, "requisitionId")}: </span><button type="button" className="block max-w-full truncate text-left text-sm font-semibold text-navy hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" title={formatRequisitionTitle(offer)} onClick={() => onOpenRequisition(offer.doc_id)}>{formatRequisitionTitle(offer)}</button><p className="text-xs text-cool">{offer.doc_id}</p></div>
                <div className="grid min-w-0 gap-1 text-xs text-slate"><span><span className="md:sr-only">{translate(language, "workspaceImpact")}: </span>{impact}</span><span>{translate(language, "accepted")}: {formatDate(offer.accepted_date, language)}</span><span>{translate(language, "firstWorkingDate")}: {formatDate(offer.first_working_date, language)}</span></div>
                <RecordActionGroup label={offer.candidate_name ?? offer.candidate_id} primary={primary} items={details} />
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function acceptedFor(docId: string, offers: Offer[]) {
  return offers.filter((offer) => offer.doc_id === docId && countsTowardHeadcount(offer)).length;
}
