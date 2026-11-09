import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language, Offer, RecruitmentLog } from "@/types/recruitment";
import { formatCandidateName, formatRecruitmentId } from "@/lib/format";
import { failureReasonText } from "@/lib/rejection-reasons";
import { fetchRecruitmentList, fetchRecruitmentListCount, type RecruitmentListEntity, type RecruitmentListCursor, type RecruitmentListPage } from "@/lib/recruitment-list";
import type { CandidateRegistryItem } from "@/lib/candidate-registry-records";

type ApplicationRow = Record<string, unknown> & { application_id: string };
type HistoryRow = { candidate: Record<string, unknown>; log: RecruitmentLog; audit: boolean };
type ExportCell = string | number;
type ExportRow = Record<string, ExportCell>;

async function readCompleteList<T>(client: SupabaseClient, scope: string, entity: RecruitmentListEntity, filters: Record<string, unknown>, sort: string, id: (row: T) => string, signal: AbortSignal): Promise<T[]> {
  const request = { accessScope: scope, entity, filters, sort, direction: "asc" as const, limit: 100, signal, freshAfter: Number.POSITIVE_INFINITY };
  const expected = await fetchRecruitmentListCount(client, request, { fresh: true });
  const rows: T[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: RecruitmentListCursor | null = null;
  while (rows.length < expected) {
    const page: RecruitmentListPage<T> = await fetchRecruitmentList<T>(client, { ...request, cursor });
    for (const row of page.items) {
      const key = id(row);
      if (!key || ids.has(key)) throw new Error("Duplicate or invalid export history.");
      ids.add(key); rows.push(row);
    }
    if (rows.length > expected) throw new Error("Export data changed. Please retry.");
    if (rows.length === expected) break;
    if (!page.has_more || !page.next_cursor || !page.items.length) throw new Error("Incomplete export history.");
    const anchor = JSON.stringify(page.next_cursor);
    if (cursors.has(anchor)) throw new Error("Repeated export cursor.");
    cursors.add(anchor); cursor = page.next_cursor;
  }
  const verified = await fetchRecruitmentListCount(client, request, { fresh: true });
  if (verified !== expected) throw new Error("Export data changed. Please retry.");
  return rows;
}

async function readOffers(client: SupabaseClient, candidateId: string, signal: AbortSignal): Promise<Offer[]> {
  const rows: Offer[] = [], ids = new Set<number>();
  let expected: number | null = null;
  for (let offset = 0; ; offset += 100) {
    const result = await client.from("offers").select("*", { count: "exact" }).eq("candidate_id", candidateId).order("offer_id", { ascending: true }).range(offset, offset + 99).abortSignal(signal);
    if (result.error || typeof result.count !== "number" || (expected !== null && expected !== result.count)) throw new Error("Could not verify offer history.");
    expected = result.count;
    const page = (result.data ?? []) as Offer[];
    for (const row of page) {
      if (ids.has(row.offer_id)) throw new Error("Duplicate offer in export.");
      ids.add(row.offer_id); rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (rows.length > expected || page.length < 100) throw new Error("Incomplete offer history.");
  }
}

async function readApplicationDetails(client: SupabaseClient, candidateId: string, signal: AbortSignal): Promise<Map<string, ApplicationRow>> {
  const rows = new Map<string, ApplicationRow>();
  let expected: number | null = null;
  for (let offset = 0; ; offset += 100) {
    const result = await client.from("candidate_applications").select("*", { count: "exact" }).eq("candidate_id", candidateId).order("application_id", { ascending: true }).range(offset, offset + 99).abortSignal(signal);
    if (result.error || typeof result.count !== "number" || (expected !== null && expected !== result.count)) throw new Error("Could not verify application history.");
    expected = result.count;
    const page = (result.data ?? []) as ApplicationRow[];
    for (const row of page) { if (!row.application_id || rows.has(row.application_id)) throw new Error("Duplicate application in export."); rows.set(row.application_id, row); }
    if (rows.size === expected) return rows;
    if (rows.size > expected || page.length < 100) throw new Error("Incomplete application history.");
  }
}

async function readReferenceChecks(client: SupabaseClient, applicationIds: string[], signal: AbortSignal): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [], seen = new Set<string>();
  for (let start = 0; start < applicationIds.length; start += 100) {
    let expected: number | null = null;
    for (let offset = 0; ; offset += 100) {
      const result = await client.from("candidate_reference_checks").select("*", { count: "exact" }).in("application_id", applicationIds.slice(start, start + 100)).order("check_id", { ascending: true }).range(offset, offset + 99).abortSignal(signal);
      if (result.error || typeof result.count !== "number" || (expected !== null && expected !== result.count)) throw new Error("Could not verify reference check history.");
      expected = result.count; const page = (result.data ?? []) as Array<Record<string, unknown>>;
      for (const row of page) { const id = String(row.check_id ?? ""); if (!id || seen.has(id)) throw new Error("Duplicate reference check in export."); seen.add(id); rows.push(row); }
      if (offset + page.length === expected) break;
      if (offset + page.length > expected || page.length < 100) throw new Error("Incomplete reference check history.");
    }
  }
  return rows;
}

/** Uses the same authorized list and RLS reads as Candidate Detail; masked profiles never trigger history reads. */
export async function exportCandidateWorkbook(client: SupabaseClient, scope: string, selected: CandidateRegistryItem[], language: Language, signal: AbortSignal, onProgress?: (done: number, total: number) => void) {
  const t = (en: string, th: string) => language === "th" ? th : en;
  const candidates: ExportRow[] = [], applications: ExportRow[] = [], history: ExportRow[] = [], offers: ExportRow[] = [], references: ExportRow[] = [];
  for (const [index, row] of selected.entries()) {
    if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
    const id = formatRecruitmentId(row.candidate_id), name = row.masked ? "" : formatCandidateName({ name: row.name, nickname: row.nickname });
    candidates.push({
      [t("Candidate ID","รหัสผู้สมัคร")]: id, [t("Candidate","ผู้สมัคร")]: name,
      [t("Priority","ความสำคัญ")]: !row.masked && row.has_priority_requisition ? t("Prioritized","มีความสำคัญ") : t("Not prioritized","ไม่มีความสำคัญ"),
      [t("Privacy","ความเป็นส่วนตัว")]: row.masked ? t("Masked","ปกปิด") : "",
      [t("Phone","โทรศัพท์")]: row.masked ? "" : row.phone_no ?? "", [t("Email","อีเมล")]: row.masked ? "" : row.email ?? "",
      [t("Site","สถานที่")]: row.masked ? "" : row.home_site ?? "", [t("Created by","สร้างโดย")]: row.creator_label ?? "",
      [t("Source","ช่องทาง")]: row.masked ? "" : row.channel ?? "", [t("Interests","ตำแหน่งที่สนใจ")]: row.position_interests ?? "",
      [t("Active applications","ใบสมัครที่ดำเนินการ")]: row.masked ? "" : row.active_application_count ?? 0,
      [t("Updated","อัปเดต")]: row.masked ? row.created_at ?? "" : row.updated_at ?? ""
    });
    if (row.masked) { onProgress?.(index + 1, selected.length); continue; }
    const [apps, stages, offerRows, appDetails] = await Promise.all([
      readCompleteList<ApplicationRow>(client, scope, "candidate_applications", { candidateId: row.candidate_id }, "application_id", item => item.application_id, signal),
      readCompleteList<HistoryRow>(client, scope, "pipeline_history", { candidateId: row.candidate_id, showAudit: true }, "log_id", item => String(item.log?.log_id ?? ""), signal),
      readOffers(client, row.candidate_id, signal),
      readApplicationDetails(client, row.candidate_id, signal)
    ]);
    if (apps.length !== appDetails.size || apps.some(app => !appDetails.has(app.application_id))) throw new Error("Application history changed. Please retry.");
    const checks = await readReferenceChecks(client, apps.map(app => app.application_id), signal);
    for (const check of checks) references.push({
      [t("Candidate ID","รหัสผู้สมัคร")]: id, [t("Candidate","ผู้สมัคร")]: name,
      [t("Application ID","รหัสใบสมัคร")]: String(check.application_id ?? ""), [t("Reference ID","รหัสผู้ให้ข้อมูล")]: String(check.reference_id ?? ""),
      [t("Checked date","วันที่ตรวจสอบ")]: String(check.checked_date ?? ""), [t("Duration (minutes)","ระยะเวลา (นาที)")]: Number(check.duration_minutes ?? 0),
      [t("Conversation summary","สรุปการสนทนา")]: String(check.conversation_summary ?? ""), [t("Checked by","ผู้ตรวจสอบ")]: String(check.checked_by ?? ""),
      [t("Created","วันที่สร้าง")]: String(check.created_at ?? ""), [t("Updated","อัปเดต")]: String(check.updated_at ?? "")
    });
    for (const app of apps) {
      const details = appDetails.get(app.application_id)!;
      applications.push({
      [t("Candidate ID","รหัสผู้สมัคร")]: id, [t("Candidate","ผู้สมัคร")]: name,
      [t("Application ID","รหัสใบสมัคร")]: String(app.application_id ?? ""), [t("Group","กลุ่ม")]: String(app.group_position ?? app.group_id ?? ""),
      [t("Requisitions","ใบขออัตรา")]: Array.isArray(app.doc_ids) ? app.doc_ids.join(", ") : "",
      [t("Application status","สถานะใบสมัคร")]: String(app.application_state ?? app.state ?? ""),
      [t("Closure reason","เหตุผลปิดใบสมัคร")]: String(details.closure_reason ?? ""),
      [t("Created","วันที่สร้าง")]: String(details.created_at ?? ""), [t("Closed","วันที่ปิด")]: String(details.closed_at ?? ""), [t("Updated","อัปเดต")]: String(details.updated_at ?? "")
    }); }
    for (const item of stages) {
      const log = item.log;
      history.push({
        [t("Candidate ID","รหัสผู้สมัคร")]: id, [t("Candidate","ผู้สมัคร")]: name,
        [t("Application ID","รหัสใบสมัคร")]: log.application_id ?? "", [t("Group","กลุ่ม")]: String(item.candidate?.group_position ?? ""),
        [t("Stage","ขั้นตอน")]: log.recruitment_process, [t("Round","รอบ")]: log.round,
        [t("Entry date","วันที่เริ่มขั้นตอน")]: log.log_date, [t("Estimated date","วันที่คาดการณ์")]: log.estimated_action_date ?? "",
        [t("Interviewer","ผู้สัมภาษณ์")]: log.interviewer ?? "", [t("Pending remark","หมายเหตุระหว่างดำเนินการ")]: log.remark ?? "",
        [t("Result","ผล")]: log.result === 1 ? t("Pass","ผ่าน") : log.result === 0 ? t("Fail","ไม่ผ่าน") : t("Pending","รอผล"),
        [t("Outcome date","วันที่สรุปผล")]: log.outcome_date ?? "", [t("Outcome interviewer","ผู้สรุปผล")]: log.outcome_interviewer ?? "",
        [t("Outcome remark","หมายเหตุผล")]: log.outcome_remark ?? "",
        [t("Rejection reason","เหตุผลที่ไม่ผ่าน")]: log.result === 0 ? failureReasonText(log, language) : "",
        [t("Record status","สถานะรายการ")]: item.audit || log.superseded_at ? t("Corrected history","ประวัติที่แก้ไข") : t("Current","ปัจจุบัน"),
        [t("Correction reason","เหตุผลการแก้ไข")]: log.superseded_reason ?? ""
      });
    }
    onProgress?.(index + 1, selected.length);
    for (const offer of offerRows) offers.push({
      [t("Candidate ID","รหัสผู้สมัคร")]: id, [t("Candidate","ผู้สมัคร")]: name,
      [t("Application ID","รหัสใบสมัคร")]: offer.application_id ?? "", [t("Requisition","ใบขออัตรา")]: offer.doc_id,
      [t("Accepted date","วันที่ตอบรับ")]: offer.accepted_date ?? "", [t("First working date","วันเริ่มงาน")]: offer.first_working_date ?? "",
      [t("Start confirmation","ยืนยันการเริ่มงาน")]: offer.start_confirmation ?? "", [t("Confirmed at","วันที่ยืนยัน")]: offer.start_confirmed_at ?? "",
      [t("No-show reason","เหตุผลไม่เริ่มงาน")]: offer.start_confirmation_reason ?? "", [t("Offer remark","หมายเหตุข้อเสนอ")]: offer.remark ?? ""
    });
  }
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  const excel = await import("exceljs");
  const Workbook = excel.Workbook ?? excel.default.Workbook;
  const workbook = new Workbook(); workbook.creator = "Recruitment";
  for (const [title, rows] of [[t("Candidates","ผู้สมัคร"),candidates],[t("Applications","ใบสมัคร"),applications],[t("Process history","ประวัติกระบวนการ"),history],[t("Offers","ข้อเสนอ"),offers],[t("Reference checks","ตรวจสอบอ้างอิง"),references]] as Array<[string, ExportRow[]]>) {
    const sheet = workbook.addWorksheet(title); sheet.views = [{ state: "frozen", ySplit: 1 }];
    if (!rows.length) { sheet.addRow([t("No authorized records","ไม่มีรายการที่ได้รับอนุญาต")]); continue; }
    const keys = Object.keys(rows[0]); sheet.columns = keys.map(key => ({ header: key, key, width: Math.max(16, Math.min(36, key.length + 8)) }));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }; sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A3CDC" } };
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } };
    rows.forEach(item => sheet.addRow(item));
  }
  const bytes = await workbook.xlsx.writeBuffer();
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a"); link.href = url; link.download = "selected-candidates-full-history.xlsx"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
