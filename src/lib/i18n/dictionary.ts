import type { Language, ViewId } from "@/types/recruitment";

type Dictionary = Record<string, string>;

const en: Dictionary = {
  dashboard: "Dashboard",
  requisitions: "Requisitions",
  candidates: "Candidates",
  pipeline: "Pipeline",
  offers: "Offers",
  setup: "Setup",
  audit: "Audit Log",
  logout: "Sign out",
  refresh: "Refresh",
  language: "TH",
  newRequisition: "New Requisition",
  newCandidate: "New Candidate",
  processUpdate: "Process Update",
  activeRequisitions: "Active Requisitions",
  candidateCount: "Candidates",
  acceptedOffers: "Accepted Offers",
  openHeadcount: "Open Headcount",
  needsAction: "Needs Action",
  recentActivity: "Recent Activity",
  candidatePipeline: "Candidate Pipeline",
  fullPipeline: "Full Pipeline",
  openList: "Open List",
  noData: "No records match the current filters.",
  owner: "Owner",
  status: "Status",
  accepted: "Accepted",
  headcount: "Headcount",
  result: "Result",
  latestProcess: "Latest Process",
  save: "Save",
  cancel: "Cancel",
  confirm: "Confirm",
  view: "View",
  detail: "Detail",
  close: "Close",
  addUpdate: "Add Update",
  readonly: "Read-only",
  adminOnly: "Admin only",
  signedInAs: "Signed in as",
  filters: "Filters"
};

const th: Dictionary = {
  dashboard: "แดชบอร์ด",
  requisitions: "คำขออัตรากำลัง",
  candidates: "ผู้สมัคร",
  pipeline: "ขั้นตอนผู้สมัคร",
  offers: "ข้อเสนอจ้าง",
  setup: "ตั้งค่า",
  audit: "ประวัติการแก้ไข",
  logout: "ออกจากระบบ",
  refresh: "รีเฟรช",
  language: "EN",
  newRequisition: "สร้างคำขอ",
  newCandidate: "เพิ่มผู้สมัคร",
  processUpdate: "อัปเดตขั้นตอน",
  activeRequisitions: "คำขอที่เปิดอยู่",
  candidateCount: "ผู้สมัคร",
  acceptedOffers: "ตอบรับข้อเสนอ",
  openHeadcount: "อัตราคงเหลือ",
  needsAction: "งานที่ต้องติดตาม",
  recentActivity: "กิจกรรมล่าสุด",
  candidatePipeline: "ขั้นตอนผู้สมัคร",
  fullPipeline: "ดูทั้งหมด",
  openList: "เปิดรายการ",
  noData: "ไม่พบข้อมูลตามตัวกรอง",
  owner: "ผู้รับผิดชอบ",
  status: "สถานะ",
  accepted: "ตอบรับ",
  headcount: "อัตรา",
  result: "ผล",
  latestProcess: "ขั้นตอนล่าสุด",
  save: "บันทึก",
  cancel: "ยกเลิก",
  confirm: "ยืนยัน",
  view: "ดู",
  detail: "รายละเอียด",
  close: "ปิด",
  addUpdate: "เพิ่มอัปเดต",
  readonly: "อ่านอย่างเดียว",
  adminOnly: "เฉพาะผู้ดูแล",
  signedInAs: "เข้าสู่ระบบเป็น",
  filters: "ตัวกรอง"
};

export const dictionaries = { en, th };

export function translate(language: Language, key: string) {
  return dictionaries[language][key] ?? dictionaries.en[key] ?? key;
}

export function viewLabel(language: Language, view: ViewId) {
  return translate(language, view);
}
