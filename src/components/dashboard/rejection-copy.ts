import type { Language, ProcessStage } from "@/types/recruitment";
import { processStageLabel } from "@/lib/i18n/dictionary";
export const rejectionCopy = {
  treemap: ["Treemap", "แผนภูมิต้นไม้"], bars: ["Bars", "แผนภูมิแท่ง"], reasonView: ["Reason chart view", "รูปแบบแผนภูมิเหตุผล"],
  allMain: ["All main reasons", "เหตุผลหลักทั้งหมด"], comparison: ["comparison events", "เหตุการณ์ในขอบเขตเปรียบเทียบ"],
  comparisonMain: ["Main-reason comparison", "เปรียบเทียบเหตุผลหลัก"], comparisonDetail: ["Detailed reasons within", "เหตุผลย่อยภายใน"],
  comparisonShare: ["Share of comparison events", "สัดส่วนเหตุการณ์ในขอบเขตเปรียบเทียบ"], comparisonRecords: ["Reason comparison events", "เหตุการณ์เปรียบเทียบเหตุผล"],
  selected: ["Selected", "เลือกแล้ว"], selectedContribution: ["Selected-report contribution", "จำนวนที่นับในรายงานที่เลือก"], reasonKey: ["Reason key", "รหัสกลุ่มเหตุผล"],
  smallReasons: ["All reasons and values", "เหตุผลและค่าทั้งหมด"], weekConvention: ["Weeks start Saturday and end Friday; boundary buckets are clipped to the selected dates.", "สัปดาห์เริ่มเสาร์และสิ้นสุดศุกร์ ช่วงแรกและสุดท้ายแสดงเฉพาะวันที่ที่เลือก"],
  comparisonGuide: ["The treemap compares sibling reasons within the current period, recruitment scope, actor, stage and search. Main-reason selection chooses the detailed comparison; detailed-reason selection filters the report while siblings remain visible. Comparison shares use the comparison total, not the selected report total.", "แผนภูมิต้นไม้เปรียบเทียบเหตุผลในช่วงเวลา ขอบเขตการสรรหา ผู้ยุติกระบวนการ ขั้นตอน และคำค้นเดียวกัน การเลือกเหตุผลหลักเปิดการเปรียบเทียบเหตุผลย่อย การเลือกเหตุผลย่อยกรองรายงานโดยยังแสดงเหตุผลอื่นในกลุ่ม สัดส่วนใช้ยอดเปรียบเทียบ ไม่ใช่ยอดรายงานที่เลือก"],
  title: ["Rejections", "การปฏิเสธและถอนตัว"], definition: ["Failure events recorded during the selected period.", "เหตุการณ์ไม่ผ่านหรือถอนตัวที่บันทึกผลในช่วงที่เลือก"],
  total: ["Total failure events", "เหตุการณ์ทั้งหมด"], company: ["Company declined", "บริษัทไม่พิจารณาต่อ"], candidate: ["Candidate declined / withdrew", "ผู้สมัครปฏิเสธ / ถอนตัว"], unclassified: ["Unclassified actor", "ไม่ระบุผู้ยุติกระบวนการ"],
  people: ["distinct applicants", "ผู้สมัครไม่ซ้ำ"], applications: ["distinct applications", "ใบสมัครไม่ซ้ำ"], share: ["Share of selected failures", "สัดส่วนเหตุการณ์ที่เลือก"],
  actor: ["Who ended the process", "ผู้ยุติกระบวนการ"], stage: ["Stage", "ขั้นตอน"], main: ["Main reason", "เหตุผลหลัก"], detail: ["Detailed reason", "เหตุผลย่อย"], search: ["Search name or record ID", "ค้นหาชื่อหรือรหัสรายการ"], all: ["All", "ทั้งหมด"],
  clear: ["Clear report filters", "ล้างตัวกรองรายงาน"], active: ["Active report filters", "ตัวกรองรายงานที่ใช้"], remove: ["Remove filter", "นำตัวกรองออก"],
  mainTitle: ["Why processes ended", "เหตุผลที่ยุติกระบวนการ"], detailTitle: ["Detailed reasons", "รายละเอียดเหตุผล"], selectMain: ["Select a main reason to explore its detailed reasons.", "เลือกเหตุผลหลักเพื่อดูเหตุผลย่อย"],
  showAll: ["Show all reasons", "แสดงเหตุผลทั้งหมด"], showLess: ["Show top 10", "แสดง 10 อันดับแรก"],
  stageTitle: ["Where processes ended", "ขั้นตอนที่ยุติกระบวนการ"], trend: ["Failures over time", "เหตุการณ์ตามช่วงเวลา"], daily: ["Daily", "รายวัน"], weekly: ["Weekly · Saturday–Friday", "รายสัปดาห์ · เสาร์–ศุกร์"], monthly: ["Monthly", "รายเดือน"],
  records: ["Matching failure records", "รายการเหตุการณ์ที่ตรงเงื่อนไข"], outcome: ["Outcome date", "วันที่ผล"], person: ["Candidate", "ผู้สมัคร"], application: ["Application ID", "รหัสใบสมัคร"], position: ["Position / group", "ตำแหน่ง / กลุ่ม"], round: ["Round", "รอบ"], context: ["Requisition context", "บริบทใบขออัตรา"],
  sort: ["Sort records", "เรียงรายการ"], "date-desc": ["Newest outcome first", "วันที่ผลล่าสุดก่อน"], "date-asc": ["Oldest outcome first", "วันที่ผลเก่าสุดก่อน"], "candidate-asc": ["Candidate A–Z", "ชื่อผู้สมัคร ก–ฮ"], "stage-asc": ["Stage A–Z", "ชื่อขั้นตอน ก–ฮ"],
  previous: ["Previous", "ก่อนหน้า"], next: ["Next", "ถัดไป"], page: ["Page", "หน้า"],
  empty: ["No failure events in this period and recruitment scope.", "ไม่มีเหตุการณ์ไม่ผ่านหรือถอนตัวในช่วงเวลาและขอบเขตนี้"], noMatches: ["No events match these report filters. Clear filters to see this period.", "ไม่มีเหตุการณ์ตรงกับตัวกรอง ล้างตัวกรองเพื่อดูข้อมูลในช่วงนี้"],
  quality: ["Historical data coverage", "ความครบถ้วนของข้อมูลย้อนหลัง"], undated: ["Failures without a usable outcome date (outside period totals; cannot be assigned to a period)", "เหตุการณ์ไม่มีวันที่ผลที่ใช้ได้ (ไม่นับในยอดช่วงเวลา และไม่สามารถระบุช่วงเวลาได้)"],
  unresolved: ["Failures with unresolved recruitment context (excluded from scope totals)", "เหตุการณ์ไม่สามารถระบุบริบทการสรรหา (ไม่นับในยอดขอบเขต)"],
  historical: ["Historical stage", "ขั้นตอนย้อนหลัง"], guide: ["Counting guide", "คำแนะนำการนับ"], count: ["Count", "จำนวน"], event: ["Event ID", "รหัสเหตุการณ์"], candidateId: ["Candidate ID", "รหัสผู้สมัคร"],
  start: ["Bucket start", "เริ่มช่วง"], end: ["Bucket end", "สิ้นสุดช่วง"], field: ["Field", "หัวข้อ"], value: ["Value", "รายละเอียด"],
  site: ["Site", "สถานที่"], department: ["Department", "ฝ่าย"], pic: ["PIC", "ผู้รับผิดชอบ"], docs: ["Requisition IDs", "รหัสใบขออัตรา"],
  guideText: ["One event per valid failed stage attempt. Reopened attempts and separate applications count separately; superseded corrections are excluded. Selected-report shares divide by selected failure events, not processed candidates; treemap shares use its labeled comparison total. Historical saved reason labels are preserved. Only authorized journeys and identities are included. No contact details or free-text notes are exported.", "นับหนึ่งเหตุการณ์ต่อขั้นตอนที่ไม่ผ่านแต่ละครั้ง การเปิดใหม่และต่างใบสมัครนับแยกกัน ไม่นับรายการที่ถูกแทนที่จากการแก้ไข สัดส่วนรายงานหารด้วยเหตุการณ์ที่เลือก ไม่ใช่ผู้สมัครทั้งหมด ส่วนแผนภูมิต้นไม้ใช้ยอดเปรียบเทียบที่ระบุ ใช้เหตุผลที่บันทึกไว้ ณ วันที่เกิดเหตุ แสดงเฉพาะเส้นทางและตัวตนที่มีสิทธิ์ ไม่ส่งออกข้อมูลติดต่อหรือหมายเหตุอิสระ"]
} as const;
export type RejectionCopyKey = keyof typeof rejectionCopy;
export const rejectionText = (language: Language) => (key: RejectionCopyKey) => rejectionCopy[key][language === "th" ? 1 : 0];
export const rejectionStageLabel = (language: Language, stage: string) => processStageLabel(language, stage as ProcessStage);
