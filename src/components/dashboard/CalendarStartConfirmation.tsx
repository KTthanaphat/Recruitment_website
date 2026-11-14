"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { type AttendanceOutcome } from "@/components/ui/AttendanceDecisionActions";
import { NewHireConfirmationRow } from "./NewHireConfirmationRow";
import { translate } from "@/lib/i18n/dictionary";
import { formatDate } from "@/lib/format";
import type { CalendarEvent } from "./RecruitmentCalendar";
import type { EnrichedOffer, EnrichedRequisition, Language, Offer, Profile } from "@/types/recruitment";

export function CalendarStartConfirmation({ event, language, client, offers, requisitions, profile, canConfirm, onClose, onConfirmStart, onOpenCandidate }: {
  event: CalendarEvent; language: Language; client: SupabaseClient | null; offers: EnrichedOffer[]; requisitions: EnrichedRequisition[];
  profile: Profile | null; canConfirm: boolean; onClose: () => void;
  onConfirmStart: (offer: EnrichedOffer, outcome?: AttendanceOutcome) => void;
  onOpenCandidate: (candidateId: string, applicationId?: string) => void;
}) {
  const [offer, setOffer] = useState<EnrichedOffer | null>(null);
  const [error, setError] = useState<"load" | "changed" | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const request = useRef<{ key: string; client: SupabaseClient | null; promise: Promise<EnrichedOffer> } | null>(null);
  const source = useRef({ event, offers, requisitions });
  source.current = { event, offers, requisitions };
  const key = JSON.stringify([profile?.id, event.id, event.applicationId, event.candidateId, event.date, retry]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setOffer(null);
    async function read(): Promise<EnrichedOffer> {
      const { event, offers, requisitions } = source.current;
      const match = /^offer:(\d+)$/.exec(event.id ?? "");
      const local = offers.filter(row => (!match || row.offer_id === Number(match[1])) && row.candidate_id === event.candidateId && (!event.applicationId || row.application_id === event.applicationId) && row.first_working_date === event.date);
      const id = match ? Number(match[1]) : local.length === 1 ? local[0].offer_id : null;
      if (id === null || !Number.isSafeInteger(id) || id <= 0) throw new Error("CALENDAR_START_CHANGED");
      let row: Offer | null = null;
      let req: Pick<EnrichedRequisition, "position" | "level" | "site" | "person_in_charge" | "request_type" | "is_secret"> | undefined;
      if (client) {
        const result = await client.from("offers").select("*").eq("offer_id", id).maybeSingle();
        if (result.error) throw result.error;
        row = result.data as Offer | null;
        if (row) {
          const context = await client.from("requisitions").select("position,level,site,person_in_charge,request_type,is_secret").eq("doc_id", row.doc_id).maybeSingle();
          if (context.error) throw context.error;
          if (!context.data) throw new Error("CALENDAR_START_CHANGED");
          req = context.data;
        }
      } else {
        row = local.find(item => item.offer_id === id) ?? null;
        req = requisitions.find(item => item.doc_id === row?.doc_id);
      }
      if (!row || !row.accepted_date || row.candidate_id !== event.candidateId || (event.applicationId && row.application_id !== event.applicationId)
        || row.first_working_date !== event.date || row.start_confirmation === "did_not_start" || req?.is_secret) throw new Error("CALENDAR_START_CHANGED");
      return { ...row, candidate_name: event.candidateName, position: req?.position ?? null, level: req?.level ?? null,
        site: req?.site ?? event.site, person_in_charge: req?.person_in_charge ?? event.owner, request_type: req?.request_type ?? null };
    }
    if (!request.current || request.current.key !== key || request.current.client !== client) request.current = { key, client, promise: read() };
    request.current.promise.then(row => { if (!cancelled) setOffer(row); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error && reason.message === "CALENDAR_START_CHANGED" ? "changed" : "load"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [key, client]); // Identity/reset is owned by Home; display arrays are fallback-only inputs.
  return <Modal open title={translate(language, "newHireConfirmation")} subtitle={`${translate(language, "firstWorkingDate")}: ${formatDate(event.date, language)}`}
    closeLabel={translate(language, "close")} width="max-w-2xl" onClose={onClose}>
    <div data-calendar-start-confirmation>
      {loading ? <LoadingSkeleton variant="text" label={<>{translate(language, "loading")}</>}/> : null}
      {error ? <div role="alert" className="grid gap-3 text-sm text-scarlet"><p>{error === "changed"
        ? language === "th" ? "ข้อมูลวันเริ่มงานเปลี่ยนแปลงหรือไม่สามารถเข้าถึงได้ กรุณาปิดและรีเฟรชปฏิทิน" : "This start event changed or is no longer available. Close and refresh the calendar."
        : translate(language, "loadFailed")}</p>{error === "load" ? <Button type="button" variant="secondary" onClick={() => setRetry(value => value + 1)}>{translate(language, "retry")}</Button> : null}</div> : null}
      {offer ? <NewHireConfirmationRow language={language} offer={offer} layout="card" canConfirm={canConfirm && profile?.role !== "viewer"}
        onOpenCandidate={(id, appId) => { onClose(); onOpenCandidate(id, appId); }}
        onConfirm={outcome => { onClose(); onConfirmStart(offer, outcome); }}/> : null}
    </div>
  </Modal>;
}
