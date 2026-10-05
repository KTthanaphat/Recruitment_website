"use client";

import { OnOffSwitch } from "@/components/ui/OnOffSwitch";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { configurationCopy, type ConfigurationEntry } from "@/lib/configuration-folders";
import { failureActorLabel } from "@/lib/rejection-reasons";
import { normalizeRejectionLetterVariables, REJECTION_LETTER_VARIABLES, validateLetterTemplate } from "@/lib/rejection-letter";
import { INTERVIEW_INVITATION_VARIABLES, normalizeInterviewInvitationVariables, validateInterviewInvitationTemplate } from "@/lib/interview-invitation";
import { supabase } from "@/lib/supabase/client";
import type { DashboardData, Language } from "@/types/recruitment";

export type ConfigurationEditorTarget = { parent: ConfigurationEntry; entry?: ConfigurationEntry };
export function ConfigurationItemEditor({ target, parentPath, language, data, onClose, onReasonsChanged, onTemplatesChanged, onBusyChange, onNavigationGuard }: {
  target: ConfigurationEditorTarget; parentPath: string; language: Language; data: DashboardData;
  onClose: () => void; onReasonsChanged: () => Promise<void>; onTemplatesChanged: () => Promise<unknown>;
  onBusyChange: (busy: boolean) => void; onNavigationGuard: (guard: ((action: () => void) => void) | null) => void;
}) {
  const t = configurationCopy[language], reason = target.entry?.reason, template = target.entry?.template;
  const isReason = target.parent.category === "reasons";
  const isInvitation = target.parent.category === "invitations";
  const actor = reason?.actor ?? target.parent.actor ?? "candidate";
  const kind = reason?.reason_kind ?? (target.parent.reason ? "detail" : "main");
  const parentId = reason?.parent_id ?? target.parent.reason?.reason_id ?? null;
  const normalize = isInvitation ? normalizeInterviewInvitationVariables : normalizeRejectionLetterVariables;
  const [initial] = useState(() => ({ label_th: reason?.label_th ?? "", label_en: reason?.label_en ?? "",
    sort_order: reason?.sort_order ?? data.rejection_reasons.filter(row => row.actor === actor && row.reason_kind === kind && row.parent_id === parentId).length + 1,
    name: template?.name ?? "", language: template?.language ?? target.parent.language ?? "th",
    subject_template: normalize(template?.subject_template ?? ""), body_template: normalize(template?.body_template ?? ""),
    active: reason?.active ?? template?.active ?? true }));
  const [draft, setDraft] = useState(initial), [busy, setBusy] = useState(false), [written, setWritten] = useState(false), [error, setError] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const state = useRef({ busy, dirty, written }); state.current = { busy, dirty, written };
  function requestNavigation(action: () => void) {
    if (state.current.busy) return;
    if (state.current.dirty || state.current.written) { pendingAction.current = action; setConfirmLeave(true); }
    else action();
  }
  useEffect(() => { onNavigationGuard(requestNavigation); return () => onNavigationGuard(null); }, [onNavigationGuard]);
  useEffect(() => { onBusyChange(busy || written); return () => onBusyChange(false); }, [busy, written, onBusyChange]);
  useEffect(() => {
    if (!dirty && !written) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, written]);
  async function refresh() { if (isReason) await onReasonsChanged(); else { const result = await onTemplatesChanged(); if (result === null) throw new Error(t.refreshFailed); } }
  async function save(leave = false) {
    if (busy) return;
    if (!supabase) { setError(language === "th" ? "กรุณาเข้าสู่ระบบก่อนบันทึก" : "Sign in before saving."); return; }
    if (!written) {
      if (isReason && (!draft.label_th.trim() || !draft.label_en.trim() || (kind === "detail" && !parentId))) { setError(t.labelsRequired); setConfirmLeave(false); return; }
      if (isReason && (!Number.isInteger(draft.sort_order) || draft.sort_order < 0)) { setError(language === "th" ? "ลำดับต้องเป็นจำนวนเต็มตั้งแต่ 0" : "Order must be a nonnegative integer."); setConfirmLeave(false); return; }
      if (!isReason && !draft.name.trim()) { setError(t.noName); setConfirmLeave(false); return; }
      if (!isReason) {
        const validate = isInvitation ? validateInterviewInvitationTemplate : validateLetterTemplate;
        const invalid = [...validate(normalize(draft.subject_template)), ...validate(normalize(draft.body_template))];
        if (invalid.length) { setError(`${language === "th" ? "ตัวแปรไม่ถูกต้องหรือไม่ครบ" : "Unknown or incomplete variable"}: ${[...new Set(invalid)].join(", ")}`); setConfirmLeave(false); return; }
      }
    }
    setBusy(true); state.current.busy = true; setError("");
    let saved = written;
    try {
      if (!written) {
        if (isReason) {
          const values = { label_th: draft.label_th.trim(), label_en: draft.label_en.trim(), sort_order: draft.sort_order, active: draft.active };
          const result = reason ? await supabase.from("rejection_reasons").update(values).eq("reason_id", reason.reason_id)
            : await supabase.from("rejection_reasons").insert({ ...values, actor, reason_kind: kind, parent_id: kind === "detail" ? parentId : null });
          if (result.error) throw result.error;
        } else {
          const { data: session } = await supabase.auth.getSession();
          const response = await fetch(isInvitation ? "/api/interview-invitations/templates" : "/api/rejection-letters/templates", {
            method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${session.session?.access_token ?? ""}` },
            body: JSON.stringify({ name: draft.name.trim(), language: draft.language, active: draft.active,
              subject_template: normalize(draft.subject_template), body_template: normalize(draft.body_template), template_id: template?.template_id }) });
          const result = await response.json() as { ok?: boolean; error?: string };
          if (!response.ok || !result.ok) throw new Error(result.error ?? t.saveFailed);
        }
        saved = true; setWritten(true);
      }
      await refresh();
      setConfirmLeave(false);
      const action = leave ? pendingAction.current : null;
      onClose(); action?.();
    } catch (failure) {
      setError(saved ? t.refreshFailed : failure instanceof Error ? failure.message : failure && typeof failure === "object" && "message" in failure ? String(failure.message) : t.saveFailed);
      setConfirmLeave(false);
    } finally { setBusy(false); state.current.busy = false; }
  }
  const title = target.entry ? `${t.edit}: ${target.entry.name}` : isReason ? kind === "main" ? t.addMain : t.addDetail : t.newFormat;
  return <>
    <Drawer open eyebrow={parentPath} title={title} closeLabel={t.close} inactive={confirmLeave} onClose={() => requestNavigation(onClose)}>
      <p className="mb-4 text-sm text-slate">{t.parent}: {parentPath}{target.parent.active === false ? ` · ${t.archived}` : ""}</p>
      <fieldset disabled={busy || written} className="grid min-w-0 gap-4">
        {isReason ? <>
          <p className="text-sm text-slate">{failureActorLabel(actor, language)} · {kind === "main" ? t.main : t.detail}</p>
          <Field label={t.thaiLabel}><TextInput value={draft.label_th} onChange={event => setDraft({ ...draft, label_th: event.target.value })} required /></Field>
          <Field label={t.englishLabel}><TextInput value={draft.label_en} onChange={event => setDraft({ ...draft, label_en: event.target.value })} required /></Field>
          <Field label={t.order}><TextInput type="number" min={0} step={1} value={Number.isFinite(draft.sort_order) ? draft.sort_order : ""} onChange={event => setDraft({ ...draft, sort_order: event.target.value === "" ? NaN : Number(event.target.value) })} required /></Field>
        </> : <>
          <Field label={t.name}><TextInput value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required /></Field>
          <Field label={t.language}><SelectInput value={draft.language} onChange={event => setDraft({ ...draft, language: event.target.value as Language })}><option value="th">{t.thai}</option><option value="en">{t.english}</option></SelectInput></Field>
          <Field label={t.subject}><TextInput value={draft.subject_template} onChange={event => setDraft({ ...draft, subject_template: event.target.value })} /></Field>
          <Field label={t.body}><TextArea rows={8} value={draft.body_template} onChange={event => setDraft({ ...draft, body_template: event.target.value })} /></Field>
          <p className="break-words text-xs text-slate">{t.variables}: {(isInvitation ? INTERVIEW_INVITATION_VARIABLES : REJECTION_LETTER_VARIABLES).join(", ")}</p>
        </>}
        <div className="flex min-h-11 items-center gap-3 text-sm font-medium text-navy">
          <span>{t.active}</span>
          <OnOffSwitch checked={draft.active} onCheckedChange={active => setDraft({ ...draft, active })} label={t.active} language={language} disabled={busy || written} />
        </div>
      </fieldset>
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      {busy ? <p role="status" className="mt-3 text-sm text-slate">{t.saving}</p> : null}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => requestNavigation(onClose)}>{t.cancel}</Button><Button type="button" disabled={busy} onClick={() => save()}>{written ? t.retry : t.save}</Button></div>
    </Drawer>
    <Modal open={confirmLeave} title={t.dirty} closeLabel={t.close} width="max-w-lg" onClose={() => setConfirmLeave(false)}>
      <p className="text-sm text-slate">{t.dirtyHelp}</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setConfirmLeave(false)}>{t.keep}</Button><Button type="button" variant="secondary" onClick={() => { const action = pendingAction.current; onClose(); action?.(); }}>{t.discard}</Button><Button type="button" onClick={() => save(true)}>{written ? t.retry : t.save}</Button></div>
    </Modal>
  </>;
}
