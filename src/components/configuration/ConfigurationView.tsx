"use client";

import { CalendarPlus, ChevronDown, Mail } from "lucide-react";
import { InterviewInvitationTemplateAdmin } from "@/components/interviews/InterviewInvitationTemplateAdmin";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { RejectionLetterTemplateAdmin } from "@/components/rejection-letters/RejectionLetterTemplateAdmin";
import type { DashboardData, Language } from "@/types/recruitment";

export function ConfigurationView({ language, data, canManageRejectionTemplates, onTemplatesChanged }: { language: Language; data: DashboardData; canManageRejectionTemplates: boolean; onTemplatesChanged: () => Promise<unknown> }) {
  if (!canManageRejectionTemplates) return <Panel><EmptyState variant="quiet" message={language === "th" ? "เฉพาะผู้ดูแลการสรรหาเท่านั้นที่แก้ไขการตั้งค่าได้" : "Only recruitment administrators can edit configuration."} /></Panel>;
  return <Panel>
    <SectionTitle title={language === "th" ? "การตั้งค่า" : "Configuration"} eyebrow={language === "th" ? "การตั้งค่าระบบสรรหา" : "Recruitment settings"} />
    <details open className="group rounded-xl border border-[#D7DEE8] bg-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2"><Mail size={18} className="text-scarlet" aria-hidden="true" />{language === "th" ? "รูปแบบอีเมลปฏิเสธผู้สมัคร" : "Send rejection letter format"}</span>
        <ChevronDown size={18} className="text-slate transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-[#E4E9F2] p-4"><RejectionLetterTemplateAdmin templates={data.rejection_letter_templates} onChanged={onTemplatesChanged} /></div>
    </details>
    <details className="group mt-3 rounded-xl border border-[#D7DEE8] bg-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/30 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2"><CalendarPlus size={18} className="text-primary" aria-hidden="true" />{language === "th" ? "รูปแบบคำเชิญสัมภาษณ์ Teams" : "Teams invitation formats"}</span>
        <ChevronDown size={18} className="text-slate transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-[#E4E9F2] p-4"><InterviewInvitationTemplateAdmin templates={data.interview_invitation_templates} onChanged={onTemplatesChanged} /></div>
    </details>
  </Panel>;
}
