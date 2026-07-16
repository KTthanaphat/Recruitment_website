"use client";

import { AlertTriangle, ExternalLink, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecordActionGroup, type RecordAction } from "@/components/ui/Operations";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { formatDate } from "@/lib/format";
import { offerStatusLabel, translate } from "@/lib/i18n/dictionary";
import { offerStatus } from "@/lib/operations";
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
    <Panel>
      <SectionTitle
        title="Offers"
        eyebrow="Headcount impact and start dates"
        action={(
          <div className="grid justify-items-end gap-1">
            <span title={newOfferDisabledReason}>
              <Button
                type="button"
                size="sm"
                icon={<Plus size={16} />}
                disabled={Boolean(newOfferDisabledReason)}
                aria-describedby={newOfferDisabledReason ? "workspace-new-offer-reason" : undefined}
                onClick={() => {
                  if (eligibleCandidate) onAction({ kind: "offer.upsert", candidateId: eligibleCandidate.candidate_id });
                }}
              >
                New Offer
              </Button>
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
                <button type="button" className="min-w-0 break-words text-left text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/25" onClick={() => onOpenRequisition(row.doc_id)}>
                  {row.doc_id} <span className="font-medium text-slate">({acceptedFor(row.doc_id, allOffers)}/{row.head_count})</span>
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
        <div className="grid min-w-0 gap-2">
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
              { id: `candidate-${offer.offer_id}`, label: "Open candidate", icon: <UserRound aria-hidden="true" size={15} />, onSelect: () => onOpenCandidate(offer.candidate_id) },
              { id: `requisition-${offer.offer_id}`, label: "Open requisition", onSelect: () => onOpenRequisition(offer.doc_id) },
              { id: `offer-workspace-${offer.offer_id}`, label: "Open requisition workspace", href: `/workspace?type=requisition&id=${encodeURIComponent(offer.doc_id)}` }
            ];

            return (
              <article key={offer.offer_id} className="grid min-w-0 gap-2 rounded-md border border-[#D7DEE8] bg-white p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="grid min-w-0 gap-1">
                  <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
                    <button type="button" className="min-w-0 break-words text-left font-bold text-navy focus:outline-none focus:ring-2 focus:ring-primary/25" onClick={() => onOpenCandidate(offer.candidate_id)}>
                      {offer.candidate_name ?? offer.candidate_id}
                    </button>
                    <Tag tone={status.tone}>{offerStatusLabel(language, status.label)}</Tag>
                  </div>
                  <p className="break-words text-sm font-semibold text-navy">{offer.doc_id}{offer.position ? ` - ${offer.position}` : ""}</p>
                  <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-slate">
                    <span>HC impact: {impact}</span>
                    <span>Accepted: {formatDate(offer.accepted_date)}</span>
                    <span>Start: {formatDate(offer.first_working_date)}</span>
                  </div>
                </div>
                <RecordActionGroup label={offer.candidate_name ?? offer.candidate_id} primary={primary} items={details} />
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function acceptedFor(docId: string, offers: Offer[]) {
  return offers.filter((offer) => offer.doc_id === docId && Boolean(offer.accepted_date)).length;
}
