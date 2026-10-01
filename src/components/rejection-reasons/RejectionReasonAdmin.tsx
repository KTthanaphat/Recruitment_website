"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, SelectInput, TextInput } from "@/components/ui/Field";
import { failureActorLabel, rejectionReasonLabel, type FailureActor } from "@/lib/rejection-reasons";
import { supabase } from "@/lib/supabase/client";
import type { Language, RejectionReason } from "@/types/recruitment";

type Draft = { reason_kind: "main" | "detail"; actor: FailureActor; parent_id: string; label_th: string; label_en: string; sort_order: number; active: boolean };
const blank: Draft = { reason_kind: "main", actor: "candidate", parent_id: "", label_th: "", label_en: "", sort_order: 1, active: true };
function errorMessage(value: unknown, fallback: string) {
  return value && typeof value === "object" && "message" in value && typeof value.message === "string" ? value.message : fallback;
}

export function RejectionReasonAdmin({ reasons, language, onChanged }: { reasons: RejectionReason[]; language: Language; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<RejectionReason | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingRefresh, setPendingRefresh] = useState<"save" | "toggle" | null>(null);
  const [error, setError] = useState("");
  const mains = reasons.filter((reason) => reason.reason_kind === "main").sort((a, b) => a.actor.localeCompare(b.actor) || a.sort_order - b.sort_order);
  function open(reason?: RejectionReason, kind: "main" | "detail" = "main", actor: FailureActor = "candidate", parent = "") {
    if (busy || pendingRefresh) return;
    setEditing(reason ?? null);
    setDraft(reason ? { reason_kind: reason.reason_kind, actor: reason.actor, parent_id: reason.parent_id ?? "", label_th: reason.label_th, label_en: reason.label_en, sort_order: reason.sort_order, active: reason.active } : { ...blank, reason_kind: kind, actor, parent_id: parent, sort_order: reasons.filter((row) => row.parent_id === (parent || null) && row.actor === actor && row.reason_kind === kind).length + 1 });
    setError("");
  }
  async function save() {
    if (!draft || !supabase || busy) return;
    if (pendingRefresh === "save") { await retryRefresh(); return; }
    if (pendingRefresh === "toggle") return;
    if (!draft.label_th.trim() || !draft.label_en.trim() || (draft.reason_kind === "detail" && !draft.parent_id)) { setError(language === "th" ? "กรอกชื่อภาษาไทย อังกฤษ และเหตุผลหลัก" : "Thai and English labels and a parent are required."); return; }
    setBusy(true); setError("");
    try {
      const values = { label_th: draft.label_th.trim(), label_en: draft.label_en.trim(), sort_order: draft.sort_order, active: draft.active };
      const result = editing
        ? await supabase.from("rejection_reasons").update(values).eq("reason_id", editing.reason_id)
        : await supabase.from("rejection_reasons").insert({ ...values, reason_kind: draft.reason_kind, actor: draft.actor, parent_id: draft.reason_kind === "detail" ? draft.parent_id : null });
      if (result.error) throw result.error;
      setPendingRefresh("save");
      await onChanged(); setPendingRefresh(null); setDraft(null); setEditing(null);
    } catch (saveError) { setError(errorMessage(saveError, "Could not save reason.")); }
    finally { setBusy(false); }
  }
  async function toggle(reason: RejectionReason) {
    if (!supabase || busy || pendingRefresh) return;
    setBusy(true); setError("");
    try { const result = await supabase.from("rejection_reasons").update({ active: !reason.active }).eq("reason_id", reason.reason_id); if (result.error) throw result.error; setPendingRefresh("toggle"); await onChanged(); setPendingRefresh(null); }
    catch (saveError) { setError(errorMessage(saveError, "Could not update reason.")); }
    finally { setBusy(false); }
  }
  async function retryRefresh() {
    if (!pendingRefresh || busy) return;
    setBusy(true); setError("");
    try {
      await onChanged();
      if (pendingRefresh === "save") { setDraft(null); setEditing(null); }
      setPendingRefresh(null);
    } catch (refreshError) { setError(errorMessage(refreshError, "Could not refresh reasons.")); }
    finally { setBusy(false); }
  }
  function controls(reason: RejectionReason, withDetail: boolean) {
    const label = rejectionReasonLabel(reason, language);
    const editLabel = language === "th" ? `แก้ไข ${label}` : `Edit ${label}`;
    const activeLabel = language === "th" ? `เปิดใช้งาน ${label}` : `Active: ${label}`;
    const addLabel = language === "th" ? `เพิ่มเหตุผลย่อยใน ${label}` : `Add detail to ${label}`;
    return <div className="flex items-center gap-2">
      <Button type="button" size="icon-sm" variant="ghost" icon={<Pencil size={16} aria-hidden="true" />} aria-label={editLabel} title={editLabel} disabled={busy || Boolean(pendingRefresh)} onClick={() => open(reason)} />
      <button type="button" role="switch" aria-checked={reason.active} aria-label={activeLabel} title={activeLabel} disabled={busy || Boolean(pendingRefresh)} onClick={() => toggle(reason)} className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50 ${reason.active ? "bg-primary" : "bg-[#AAB5C4]"}`}><span className={`size-5 rounded-full bg-white shadow-sm transition-transform ${reason.active ? "translate-x-6" : "translate-x-1"}`} /></button>
      {withDetail ? <Button type="button" size="icon-sm" variant="secondary" icon={<Plus size={17} aria-hidden="true" />} aria-label={addLabel} title={reason.active ? addLabel : (language === "th" ? "เปิดใช้งานเหตุผลหลักก่อนเพิ่มเหตุผลย่อย" : "Activate the main reason before adding a detail")} disabled={busy || Boolean(pendingRefresh) || !reason.active} onClick={() => open(undefined, "detail", reason.actor, reason.reason_id)} /> : null}
    </div>;
  }
  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate">{language === "th" ? "เหตุผลที่ปิดใช้งานยังคงแสดงในประวัติผู้สมัคร" : "Archived reasons remain visible in candidate history."}</p><Button type="button" size="icon-sm" icon={<Plus size={17} aria-hidden="true" />} aria-label={language === "th" ? "เพิ่มเหตุผลหลัก" : "Add main reason"} title={language === "th" ? "เพิ่มเหตุผลหลัก" : "Add main reason"} disabled={busy || Boolean(pendingRefresh)} onClick={() => open()} /></div>
    {busy ? <p role="status" aria-live="polite" className="text-sm font-medium text-slate">{language === "th" ? "กำลังบันทึกเหตุผล..." : "Saving reason..."}</p> : null}
    {error ? <p role="alert" className="text-sm font-semibold text-danger">{error}</p> : null}
    {pendingRefresh === "toggle" ? <Button type="button" variant="secondary" disabled={busy} onClick={retryRefresh}>{language === "th" ? "ลองโหลดเหตุผลอีกครั้ง" : "Retry reason refresh"}</Button> : null}
    {draft ? <fieldset disabled={busy} className="grid min-w-0 gap-3 rounded-xl border border-[#D7DEE8] bg-[#F8FAFD] p-4 sm:grid-cols-2">
      {!editing ? <><Field label={language === "th" ? "ประเภท" : "Type"}><SelectInput value={draft.reason_kind} onChange={(event) => setDraft({ ...draft, reason_kind: event.target.value as Draft["reason_kind"], parent_id: "" })}><option value="main">{language === "th" ? "เหตุผลหลัก" : "Main reason"}</option><option value="detail">{language === "th" ? "เหตุผลโดยละเอียด" : "Detailed reason"}</option></SelectInput></Field><Field label={language === "th" ? "ผู้สิ้นสุดกระบวนการ" : "Who ended the process"}><SelectInput value={draft.actor} onChange={(event) => setDraft({ ...draft, actor: event.target.value as FailureActor, parent_id: "" })}>{(["candidate", "company"] as FailureActor[]).map((actor) => <option key={actor} value={actor}>{failureActorLabel(actor, language)}</option>)}</SelectInput></Field></> : <p className="text-sm text-slate sm:col-span-2">{failureActorLabel(draft.actor, language)} · {draft.reason_kind === "main" ? (language === "th" ? "เหตุผลหลัก" : "Main reason") : (language === "th" ? "เหตุผลโดยละเอียด" : "Detailed reason")}</p>}
      {draft.reason_kind === "detail" ? <Field label={language === "th" ? "เหตุผลหลัก" : "Main reason"}><SelectInput value={draft.parent_id} disabled={Boolean(editing) || busy} onChange={(event) => setDraft({ ...draft, parent_id: event.target.value })}><option value="">{language === "th" ? "เลือกเหตุผลหลัก" : "Select main reason"}</option>{mains.filter((row) => row.actor === draft.actor && (row.active || editing && row.reason_id === draft.parent_id)).map((row) => <option key={row.reason_id} value={row.reason_id}>{rejectionReasonLabel(row, language)}{row.active ? "" : ` · ${language === "th" ? "ปิดใช้งาน" : "Archived"}`}</option>)}</SelectInput></Field> : null}
      <Field label={language === "th" ? "ชื่อภาษาไทย" : "Thai label"}><TextInput value={draft.label_th} onChange={(event) => setDraft({ ...draft, label_th: event.target.value })} required /></Field>
      <Field label={language === "th" ? "ชื่อภาษาอังกฤษ" : "English label"}><TextInput value={draft.label_en} onChange={(event) => setDraft({ ...draft, label_en: event.target.value })} required /></Field>
      <Field label={language === "th" ? "ลำดับ" : "Order"}><TextInput type="number" min={0} value={draft.sort_order} onChange={(event) => setDraft({ ...draft, sort_order: Number(event.target.value) })} /></Field>
      <label className="flex items-center gap-2 text-sm font-semibold text-navy"><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />{language === "th" ? "เปิดใช้งาน" : "Active"}</label>
      <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="secondary" disabled={Boolean(pendingRefresh)} onClick={() => setDraft(null)}>{language === "th" ? "ยกเลิก" : "Cancel"}</Button><Button type="button" disabled={busy || pendingRefresh === "toggle"} onClick={save}>{pendingRefresh === "save" ? (language === "th" ? "ลองโหลดเหตุผลอีกครั้ง" : "Retry reason refresh") : (language === "th" ? "บันทึก" : "Save reason")}</Button></div>
    </fieldset> : null}
    {(["candidate", "company"] as FailureActor[]).map((actor) => <section key={actor} className="grid gap-2"><h4 className="font-semibold text-navy">{failureActorLabel(actor, language)}</h4>{mains.filter((row) => row.actor === actor).map((main) => <div key={main.reason_id} className="rounded-lg border border-[#D7DEE8] bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-navy">{rejectionReasonLabel(main, language)} {main.active ? "" : `· ${language === "th" ? "ปิดใช้งาน" : "Archived"}`}</strong>{controls(main, true)}</div><div className="mt-2 grid gap-1 border-t border-[#E4E9F2] pt-2">{reasons.filter((row) => row.parent_id === main.reason_id).sort((a, b) => a.sort_order - b.sort_order).map((detail) => <div key={detail.reason_id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm text-slate"><span>{rejectionReasonLabel(detail, language)} {detail.active ? "" : `· ${language === "th" ? "ปิดใช้งาน" : "Archived"}`}</span>{controls(detail, false)}</div>)}</div></div>)}</section>)}
  </div>;
}
