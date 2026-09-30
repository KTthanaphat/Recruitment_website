"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectInput, TextInput } from "@/components/ui/Field";
import { failureActorLabel, rejectionReasonLabel, type FailureActor } from "@/lib/rejection-reasons";
import { supabase } from "@/lib/supabase/client";
import type { Language, RejectionReason } from "@/types/recruitment";

type Draft = { reason_kind: "main" | "detail"; actor: FailureActor; parent_id: string; label_th: string; label_en: string; sort_order: number; active: boolean };
const blank: Draft = { reason_kind: "main", actor: "candidate", parent_id: "", label_th: "", label_en: "", sort_order: 1, active: true };

export function RejectionReasonAdmin({ reasons, language, onChanged }: { reasons: RejectionReason[]; language: Language; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState<RejectionReason | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mains = reasons.filter((reason) => reason.reason_kind === "main").sort((a, b) => a.actor.localeCompare(b.actor) || a.sort_order - b.sort_order);
  function open(reason?: RejectionReason, kind: "main" | "detail" = "main", actor: FailureActor = "candidate", parent = "") {
    setEditing(reason ?? null);
    setDraft(reason ? { reason_kind: reason.reason_kind, actor: reason.actor, parent_id: reason.parent_id ?? "", label_th: reason.label_th, label_en: reason.label_en, sort_order: reason.sort_order, active: reason.active } : { ...blank, reason_kind: kind, actor, parent_id: parent, sort_order: reasons.filter((row) => row.parent_id === (parent || null) && row.actor === actor && row.reason_kind === kind).length + 1 });
    setError("");
  }
  async function save() {
    if (!draft || !supabase) return;
    if (!draft.label_th.trim() || !draft.label_en.trim() || (draft.reason_kind === "detail" && !draft.parent_id)) { setError(language === "th" ? "กรอกชื่อภาษาไทย อังกฤษ และเหตุผลหลัก" : "Thai and English labels and a parent are required."); return; }
    setBusy(true); setError("");
    try {
      const values = { label_th: draft.label_th.trim(), label_en: draft.label_en.trim(), sort_order: draft.sort_order, active: draft.active };
      const result = editing
        ? await supabase.from("rejection_reasons").update(values).eq("reason_id", editing.reason_id)
        : await supabase.from("rejection_reasons").insert({ ...values, reason_kind: draft.reason_kind, actor: draft.actor, parent_id: draft.reason_kind === "detail" ? draft.parent_id : null });
      if (result.error) throw result.error;
      await onChanged(); setDraft(null); setEditing(null);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save reason."); }
    finally { setBusy(false); }
  }
  async function toggle(reason: RejectionReason) {
    if (!supabase) return;
    setBusy(true); setError("");
    try { const result = await supabase.from("rejection_reasons").update({ active: !reason.active }).eq("reason_id", reason.reason_id); if (result.error) throw result.error; await onChanged(); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not update reason."); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate">{language === "th" ? "เหตุผลที่ปิดใช้งานยังคงแสดงในประวัติผู้สมัคร" : "Archived reasons remain visible in candidate history."}</p><Button type="button" size="sm" onClick={() => open()}>{language === "th" ? "เพิ่มเหตุผลหลัก" : "Add main reason"}</Button></div>
    {error ? <p role="alert" className="text-sm font-semibold text-danger">{error}</p> : null}
    {draft ? <div className="grid gap-3 rounded-xl border border-[#D7DEE8] bg-[#F8FAFD] p-4 sm:grid-cols-2">
      {!editing ? <><Field label={language === "th" ? "ประเภท" : "Type"}><SelectInput value={draft.reason_kind} onChange={(event) => setDraft({ ...draft, reason_kind: event.target.value as Draft["reason_kind"], parent_id: "" })}><option value="main">{language === "th" ? "เหตุผลหลัก" : "Main reason"}</option><option value="detail">{language === "th" ? "เหตุผลโดยละเอียด" : "Detailed reason"}</option></SelectInput></Field><Field label={language === "th" ? "ผู้สิ้นสุดกระบวนการ" : "Who ended the process"}><SelectInput value={draft.actor} onChange={(event) => setDraft({ ...draft, actor: event.target.value as FailureActor, parent_id: "" })}>{(["candidate", "company"] as FailureActor[]).map((actor) => <option key={actor} value={actor}>{failureActorLabel(actor, language)}</option>)}</SelectInput></Field></> : <p className="text-sm text-slate sm:col-span-2">{failureActorLabel(draft.actor, language)} · {draft.reason_kind === "main" ? (language === "th" ? "เหตุผลหลัก" : "Main reason") : (language === "th" ? "เหตุผลโดยละเอียด" : "Detailed reason")}</p>}
      {draft.reason_kind === "detail" ? <Field label={language === "th" ? "เหตุผลหลัก" : "Main reason"}><SelectInput value={draft.parent_id} disabled={Boolean(editing)} onChange={(event) => setDraft({ ...draft, parent_id: event.target.value })}><option value="">{language === "th" ? "เลือกเหตุผลหลัก" : "Select main reason"}</option>{mains.filter((row) => row.actor === draft.actor && row.active).map((row) => <option key={row.reason_id} value={row.reason_id}>{rejectionReasonLabel(row, language)}</option>)}</SelectInput></Field> : null}
      <Field label={language === "th" ? "ชื่อภาษาไทย" : "Thai label"}><TextInput value={draft.label_th} onChange={(event) => setDraft({ ...draft, label_th: event.target.value })} required /></Field>
      <Field label={language === "th" ? "ชื่อภาษาอังกฤษ" : "English label"}><TextInput value={draft.label_en} onChange={(event) => setDraft({ ...draft, label_en: event.target.value })} required /></Field>
      <Field label={language === "th" ? "ลำดับ" : "Order"}><TextInput type="number" min={0} value={draft.sort_order} onChange={(event) => setDraft({ ...draft, sort_order: Number(event.target.value) })} /></Field>
      <label className="flex items-center gap-2 text-sm font-semibold text-navy"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />{language === "th" ? "เปิดใช้งาน" : "Active"}</label>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setDraft(null)}>{language === "th" ? "ยกเลิก" : "Cancel"}</Button><Button type="button" disabled={busy} onClick={save}>{language === "th" ? "บันทึก" : "Save reason"}</Button></div>
    </div> : null}
    {(["candidate", "company"] as FailureActor[]).map((actor) => <section key={actor} className="grid gap-2"><h4 className="font-semibold text-navy">{failureActorLabel(actor, language)}</h4>{mains.filter((row) => row.actor === actor).map((main) => <div key={main.reason_id} className="rounded-lg border border-[#D7DEE8] bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-navy">{rejectionReasonLabel(main, language)} {main.active ? "" : `· ${language === "th" ? "ปิดใช้งาน" : "Archived"}`}</strong><div className="flex gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => open(main)}>{language === "th" ? "แก้ไข" : "Edit"}</Button><Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => toggle(main)}>{main.active ? (language === "th" ? "ปิดใช้งาน" : "Archive") : (language === "th" ? "เปิดใช้งาน" : "Activate")}</Button><Button type="button" size="sm" variant="secondary" onClick={() => open(undefined, "detail", actor, main.reason_id)}>{language === "th" ? "เพิ่มเหตุผลย่อย" : "Add detail"}</Button></div></div><div className="mt-2 grid gap-1 border-t border-[#E4E9F2] pt-2">{reasons.filter((row) => row.parent_id === main.reason_id).sort((a, b) => a.sort_order - b.sort_order).map((detail) => <div key={detail.reason_id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm text-slate"><span>{rejectionReasonLabel(detail, language)} {detail.active ? "" : `· ${language === "th" ? "ปิดใช้งาน" : "Archived"}`}</span><div className="flex gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => open(detail)}>{language === "th" ? "แก้ไข" : "Edit"}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => toggle(detail)}>{detail.active ? (language === "th" ? "ปิดใช้งาน" : "Archive") : (language === "th" ? "เปิดใช้งาน" : "Activate")}</Button></div></div>)}</div></div>)}</section>)}
  </div>;
}
