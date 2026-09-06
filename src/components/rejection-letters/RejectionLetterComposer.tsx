"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { escapeLetterHtml, letterLanguageForUi, resolveLetterTemplate, validateLetterTemplate, type RejectionLetterVariables } from "@/lib/rejection-letter";
import { formatDate } from "@/lib/format";
import type { EnrichedCandidate, Language, RejectionLetterDraft, RejectionLetterLanguage, RejectionLetterTemplate, RecruitmentLog } from "@/types/recruitment";

type Props = {
  open: boolean; candidate: EnrichedCandidate | null; failedLog: RecruitmentLog | null; language: Language; templates: RejectionLetterTemplate[]; drafts: RejectionLetterDraft[]; retryOf?: RejectionLetterDraft | null; recruiterName: string; busy?: boolean;
  onClose: () => void; onCreate: (payload: { candidate_id: string; failed_stage_instance_id: string; template_id: string; language: RejectionLetterLanguage; recipient_email: string; subject: string; body: string; retry_of_draft_id?: string }) => Promise<void>;
};

export function RejectionLetterComposer({ open, candidate, failedLog, language, templates, retryOf, recruiterName, busy = false, onClose, onCreate }: Props) {
  const [letterLanguage, setLetterLanguage] = useState<RejectionLetterLanguage>(letterLanguageForUi(language));
  const available = useMemo(() => templates.filter((template) => template.active && template.language === letterLanguage), [letterLanguage, templates]);
  const [templateId, setTemplateId] = useState("");
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const selected = available.find((template) => template.template_id === templateId) ?? null;
  const variables: RejectionLetterVariables = {
    "{candidate_name}": candidate?.name ?? "", "{candidate_email}": candidate?.email ?? "", "{failed_stage}": failedLog?.recruitment_process ?? "", "{failed_outcome_date}": failedLog?.outcome_date ? formatDate(failedLog.outcome_date, letterLanguage) : "", "{position_group}": candidate?.group_position ?? "", "{site}": candidate?.site ?? "", "{recruiter_name}": recruiterName, "{current_date}": formatDate(new Date().toISOString().slice(0, 10), letterLanguage)
  };

  useEffect(() => { if (!open) return; setLetterLanguage(retryOf?.language ?? letterLanguageForUi(language)); setTemplateId(retryOf?.template_id ?? ""); setRecipient(retryOf?.recipient_email ?? candidate?.email ?? ""); setSubject(retryOf?.subject ?? ""); setBody(retryOf?.body ?? ""); setError(null); }, [open, candidate?.candidate_id, candidate?.email, language, retryOf]);
  function chooseTemplate(id: string) { const template = available.find((item) => item.template_id === id); setTemplateId(id); if (template) { setSubject(resolveLetterTemplate(template.subject_template, variables)); setBody(resolveLetterTemplate(template.body_template, variables)); } }
  async function submit() {
    if (!candidate || !failedLog || !selected) return setError("Choose a letter template.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return setError("Enter a valid recipient email.");
    const tokens = [...validateLetterTemplate(subject), ...validateLetterTemplate(body)];
    if (tokens.length) return setError(`Unknown or incomplete variable: ${tokens.join(", ")}`);
    setError(null); await onCreate({ candidate_id: candidate.candidate_id, failed_stage_instance_id: failedLog.stage_instance_id ?? "", template_id: selected.template_id, language: letterLanguage, recipient_email: recipient.trim(), subject, body, retry_of_draft_id: retryOf?.draft_id });
  }
  return <Modal open={open} title="Send rejection letter" onClose={onClose} width="max-w-4xl">
    <div className="grid gap-4">
      <div className="rounded-md border border-[#F4B4AE] bg-[#FFF8F7] p-3 text-sm text-navy"><strong>{candidate?.name}</strong><span className="mx-1 text-slate">·</span>{failedLog?.recruitment_process} · {failedLog?.outcome_date ? formatDate(failedLog.outcome_date, language) : "-"}<p className="mt-1 text-xs text-slate">This email will be sent immediately from the shared HR mailbox. Check the recipient, subject, and body before sending.</p></div>
      <div className="grid gap-3 md:grid-cols-2"><Field label="Letter language"><SelectInput value={letterLanguage} onChange={(event) => { setLetterLanguage(event.target.value as RejectionLetterLanguage); setTemplateId(""); setSubject(""); setBody(""); }}><option value="th">Thai</option><option value="en">English</option></SelectInput></Field><Field label="Template"><SelectInput value={templateId} onChange={(event) => chooseTemplate(event.target.value)}><option value="">Select template</option>{available.map((template) => <option key={template.template_id} value={template.template_id}>{template.name} · v{template.version}</option>)}</SelectInput></Field></div>
      {available.length === 0 ? <p className="rounded-md bg-lightgray p-3 text-sm text-slate">No active {letterLanguage === "th" ? "Thai" : "English"} template is available. Ask a System Admin to add one.</p> : null}
      <Field label="Recipient email"><TextInput type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} /></Field>
      <Field label="Email subject"><TextInput value={subject} onChange={(event) => setSubject(event.target.value)} /></Field>
      <Field label="Email body"><TextArea rows={8} value={body} onChange={(event) => setBody(event.target.value)} /></Field>
      <div className="rounded-md border border-[#D7DEE8] bg-white p-3"><p className="mb-2 text-xs font-semibold text-slate">Preview</p><p className="font-semibold text-navy">{subject || "Subject"}</p><p className="mt-2 whitespace-pre-wrap text-sm text-slate">{body || "Letter body"}</p></div>
      {error ? <p role="alert" className="text-sm font-semibold text-scarlet">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="button" disabled={busy || !selected} onClick={submit}>{busy ? "Sending email..." : "Send rejection letter"}</Button></div>
    </div>
  </Modal>;
}

export { escapeLetterHtml };
