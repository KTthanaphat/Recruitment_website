import type { Language, RecruitmentLog, RejectionReason } from "@/types/recruitment";

export type FailureActor = "candidate" | "company";

export function failureActorLabel(actor: FailureActor, language: Language) {
  if (actor === "candidate") return language === "th" ? "ผู้สมัครปฏิเสธ / ถอนตัว" : "Candidate declined / withdrew";
  return language === "th" ? "บริษัทไม่พิจารณาต่อ" : "Company declined to proceed";
}

export function rejectionReasonLabel(reason: RejectionReason, language: Language) {
  return language === "th" ? reason.label_th : reason.label_en;
}

export function failureReasonText(log: RecruitmentLog | undefined, language: Language) {
  const snapshot = log?.failure_reason_snapshot;
  if (!snapshot || !log?.failure_actor) return language === "th" ? "ไม่ได้ระบุเหตุผล" : "Unclassified legacy failure";
  return `${failureActorLabel(log.failure_actor, language)} · ${language === "th" ? snapshot.main_th : snapshot.main_en} · ${language === "th" ? snapshot.detail_th : snapshot.detail_en}`;
}
