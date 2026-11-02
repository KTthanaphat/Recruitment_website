import type { RecruitmentLog } from "@/types/recruitment";

const stages = ["Phone Screen", "HR Interview", "Line Interview", "Test", "Reference Check", "Offer"];

/** Corrections append replacement records; their IDs are not journey chronology. */
export function compareApplicationLogs(a: RecruitmentLog, b: RecruitmentLog) {
  return stages.indexOf(a.recruitment_process) - stages.indexOf(b.recruitment_process) || a.round - b.round || a.log_id - b.log_id;
}
