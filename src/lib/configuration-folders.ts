import type { DashboardData, Language, RejectionReason, RejectionLetterTemplate, InterviewInvitationTemplate } from "@/types/recruitment";
import { failureActorLabel, rejectionReasonLabel, type FailureActor } from "./rejection-reasons";

export type ConfigurationCategory = "reasons" | "letters" | "invitations";
export type ConfigurationEntry = {
  id: string; parent: string | null; name: string; search: string; folder: boolean; category?: ConfigurationCategory;
  actor?: FailureActor; language?: Language; active?: boolean; reason?: RejectionReason;
  template?: RejectionLetterTemplate | InterviewInvitationTemplate;
};
export const configurationCopy = {
  en: { title: "Configuration", reasons: "Candidate failure reasons", letters: "Rejection letter formats", invitations: "Teams invitation formats", browse: "Browse folders", folders: "Configuration folders", root: "All settings", search: "Search this folder and its contents", status: "Status", all: "All", active: "Active", archived: "Archived", edit: "Edit", empty: "This folder has no matching items.", items: "items", addMain: "Add main reason", addDetail: "Add detail", newFormat: "New format", add: "Add", save: "Save", saving: "Saving...", retry: "Retry refresh", cancel: "Cancel", close: "Close", dirty: "Unsaved changes", dirtyHelp: "Save your changes before leaving, or discard the draft.", discard: "Discard", keep: "Continue editing", name: "Format name", thai: "Thai", english: "English", language: "Language", subject: "Subject", body: "Body", thaiLabel: "Thai label", englishLabel: "English label", order: "Order", parent: "Parent folder", variables: "Variables", denied: "Only recruitment administrators can edit configuration.", archivedParent: "Activate the main reason before adding a detail.", history: "Archived reasons remain visible in candidate history.", main: "Main reason", detail: "Detailed reason", noName: "A name is required.", labelsRequired: "Thai and English labels and a parent for details are required.", saveFailed: "Could not save changes.", refreshFailed: "Changes were saved. Refresh failed; retry refresh without saving again.", confirmActive: "Active", missing: "This item is no longer available. Close the editor and choose another item." },
  th: { title: "การตั้งค่า", reasons: "เหตุผลการไม่พิจารณาผู้สมัคร", letters: "รูปแบบอีเมลปฏิเสธผู้สมัคร", invitations: "รูปแบบคำเชิญสัมภาษณ์ Teams", browse: "เลือกโฟลเดอร์", folders: "โฟลเดอร์การตั้งค่า", root: "การตั้งค่าทั้งหมด", search: "ค้นหาในโฟลเดอร์และรายการภายใน", status: "สถานะ", all: "ทั้งหมด", active: "เปิดใช้งาน", archived: "ปิดใช้งาน", edit: "แก้ไข", empty: "ไม่มีรายการที่ตรงกับเงื่อนไขในโฟลเดอร์นี้", items: "รายการ", addMain: "เพิ่มเหตุผลหลัก", addDetail: "เพิ่มเหตุผลย่อย", newFormat: "เพิ่มรูปแบบ", add: "เพิ่ม", save: "บันทึก", saving: "กำลังบันทึก...", retry: "ลองโหลดอีกครั้ง", cancel: "ยกเลิก", close: "ปิด", dirty: "มีการเปลี่ยนแปลงที่ยังไม่บันทึก", dirtyHelp: "บันทึกการเปลี่ยนแปลงก่อนออก หรือยกเลิกฉบับร่าง", discard: "ทิ้งฉบับร่าง", keep: "แก้ไขต่อ", name: "ชื่อรูปแบบ", thai: "ไทย", english: "อังกฤษ", language: "ภาษา", subject: "หัวเรื่อง", body: "เนื้อหา", thaiLabel: "ชื่อภาษาไทย", englishLabel: "ชื่อภาษาอังกฤษ", order: "ลำดับ", parent: "โฟลเดอร์หลัก", variables: "ตัวแปร", denied: "เฉพาะผู้ดูแลการสรรหาเท่านั้นที่แก้ไขการตั้งค่าได้", archivedParent: "เปิดใช้งานเหตุผลหลักก่อนเพิ่มเหตุผลย่อย", history: "เหตุผลที่ปิดใช้งานยังคงแสดงในประวัติผู้สมัคร", main: "เหตุผลหลัก", detail: "เหตุผลโดยละเอียด", noName: "กรุณากรอกชื่อ", labelsRequired: "กรอกชื่อภาษาไทย อังกฤษ และเหตุผลหลักสำหรับเหตุผลย่อย", saveFailed: "ไม่สามารถบันทึกการเปลี่ยนแปลงได้", refreshFailed: "บันทึกแล้ว แต่โหลดข้อมูลไม่สำเร็จ ให้ลองโหลดอีกครั้งโดยไม่บันทึกซ้ำ", confirmActive: "เปิดใช้งาน", missing: "ไม่มีรายการนี้แล้ว กรุณาปิดและเลือกรายการใหม่" }
};
export function configurationEntries(data: DashboardData, language: Language): ConfigurationEntry[] {
  const t = configurationCopy[language];
  const entries: ConfigurationEntry[] = [{ id: "root", parent: null, name: t.root, search: t.root, folder: true }];
  for (const category of ["reasons", "letters", "invitations"] as const) entries.push({ id: category, parent: "root", name: t[category], search: t[category], folder: true, category });
  for (const actor of ["candidate", "company"] as const) {
    const name = failureActorLabel(actor, language);
    entries.push({ id: `reasons/${actor}`, parent: "reasons", name, search: name, folder: true, category: "reasons", actor });
    const reasons = data.rejection_reasons.filter(row => row.actor === actor).sort((a, b) => a.sort_order - b.sort_order || a.reason_id.localeCompare(b.reason_id));
    for (const reason of reasons.filter(row => row.reason_kind === "main")) entries.push({ id: `reasons/${actor}/${reason.reason_id}`, parent: `reasons/${actor}`, name: rejectionReasonLabel(reason, language), search: `${reason.label_th} ${reason.label_en}`, folder: true, active: reason.active, reason, actor, category: "reasons" });
    for (const reason of reasons.filter(row => row.reason_kind === "detail")) entries.push({ id: `reason:${reason.reason_id}`, parent: `reasons/${actor}/${reason.parent_id}`, name: rejectionReasonLabel(reason, language), search: `${reason.label_th} ${reason.label_en}`, folder: false, active: reason.active, reason, actor, category: "reasons" });
  }
  for (const category of ["letters", "invitations"] as const) {
    for (const templateLanguage of ["th", "en"] as const) {
      const name = templateLanguage === "th" ? t.thai : t.english;
      entries.push({ id: `${category}/${templateLanguage}`, parent: category, name, search: name, folder: true, category, language: templateLanguage });
      const templates = category === "letters" ? data.rejection_letter_templates : data.interview_invitation_templates;
      for (const template of templates.filter(row => row.language === templateLanguage).sort((a, b) => a.name.localeCompare(b.name) || a.template_id.localeCompare(b.template_id))) entries.push({ id: `${category}:${template.template_id}`, parent: `${category}/${templateLanguage}`, name: template.name, search: template.name, folder: false, category, language: templateLanguage, active: template.active, template });
    }
  }
  return entries;
}
export function configurationAncestors(entries: ConfigurationEntry[], id: string): ConfigurationEntry[] {
  const result: ConfigurationEntry[] = [], visited = new Set<string>();
  let entry = entries.find(row => row.id === id);
  while (entry && !visited.has(entry.id)) { result.unshift(entry); visited.add(entry.id); entry = entries.find(row => row.id === entry!.parent); }
  return result;
}
export function resolveConfigurationFolder(entries: ConfigurationEntry[], id: string) {
  let path = id || "root";
  while (!entries.some(row => row.id === path && row.folder)) { const index = path.lastIndexOf("/"); if (index < 0) return "root"; path = path.slice(0, index); }
  return path;
}
export function configurationContents(entries: ConfigurationEntry[], folder: string, query: string, status: "all" | "active" | "archived") {
  const search = query.trim().toLocaleLowerCase();
  const descendants = entries.filter(row => row.id !== folder && configurationAncestors(entries, row.id).some(parent => parent.id === folder));
  const matchesStatus = (row: ConfigurationEntry) => status === "all" || row.active === (status === "active");
  return (search ? descendants : entries.filter(row => row.parent === folder)).filter(row => {
    if (search && !row.search.toLocaleLowerCase().includes(search)) return false;
    if (row.active !== undefined) return matchesStatus(row);
    return status === "all" || descendants.some(child => configurationAncestors(entries, child.id).some(parent => parent.id === row.id) && matchesStatus(child));
  });
}
