"use client";

import { useState } from "react";
import { Field, SelectInput } from "@/components/ui/Field";
import { failureActorLabel, rejectionReasonLabel, type FailureActor } from "@/lib/rejection-reasons";
import type { Language, RejectionReason } from "@/types/recruitment";

export function FailureReasonFields({ reasons, language, defaults }: {
  reasons: RejectionReason[];
  language: Language;
  defaults?: { actor?: FailureActor | null; main?: string | null; detail?: string | null };
}) {
  const [actor, setActor] = useState<FailureActor | "">(defaults?.actor ?? "");
  const [main, setMain] = useState(defaults?.main ?? "");
  const [detail, setDetail] = useState(defaults?.detail ?? "");
  const activeMains = reasons.filter((reason) => reason.reason_kind === "main" && reason.active && reason.actor === actor).sort((a, b) => a.sort_order - b.sort_order || a.label_th.localeCompare(b.label_th));
  const activeDetails = reasons.filter((reason) => reason.reason_kind === "detail" && reason.active && reason.parent_id === main).sort((a, b) => a.sort_order - b.sort_order || a.label_th.localeCompare(b.label_th));
  return <>
    <Field label={language === "th" ? "ผู้สิ้นสุดกระบวนการ *" : "Who ended the process *"} className="md:col-span-2"><SelectInput name="failure_actor" value={actor} required onChange={(event) => { setActor(event.target.value as FailureActor | ""); setMain(""); setDetail(""); }}><option value="">{language === "th" ? "เลือกผู้สิ้นสุดกระบวนการ" : "Select who ended the process"}</option>{(["candidate", "company"] as FailureActor[]).map((value) => <option key={value} value={value}>{failureActorLabel(value, language)}</option>)}</SelectInput></Field>
    <Field label={language === "th" ? "เหตุผลหลัก *" : "Main reason *"}><SelectInput name="failure_main_reason_id" value={main} required disabled={!actor} onChange={(event) => { setMain(event.target.value); setDetail(""); }}><option value="">{language === "th" ? "เลือกเหตุผลหลัก" : "Select main reason"}</option>{activeMains.map((reason) => <option key={reason.reason_id} value={reason.reason_id}>{rejectionReasonLabel(reason, language)}</option>)}</SelectInput></Field>
    <Field label={language === "th" ? "เหตุผลโดยละเอียด *" : "Detailed reason *"}><SelectInput name="failure_detail_reason_id" value={detail} required disabled={!main} onChange={(event) => setDetail(event.target.value)}><option value="">{language === "th" ? "เลือกเหตุผลโดยละเอียด" : "Select detailed reason"}</option>{activeDetails.map((reason) => <option key={reason.reason_id} value={reason.reason_id}>{rejectionReasonLabel(reason, language)}</option>)}</SelectInput></Field>
  </>;
}
