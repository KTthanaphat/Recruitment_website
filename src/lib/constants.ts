import type { ProcessStage, RequisitionStatus, Role, ViewId } from "@/types/recruitment";

export const VIEWS: ViewId[] = [
  "dashboard",
  "requisitions",
  "candidates",
  "pipeline",
  "offers",
  "setup",
  "audit"
];

export const PROCESS_STAGES: ProcessStage[] = [
  "First Contact",
  "Phone Screen",
  "HR Interview",
  "Line Interview",
  "Test",
  "Reference Check",
  "Offer",
  "Rejected",
  "Withdrawn"
];

export const ACTIVE_PIPELINE_STAGES: ProcessStage[] = PROCESS_STAGES.filter(
  (stage) => !["Rejected", "Withdrawn"].includes(stage)
);

export const REQUISITION_STATUSES: RequisitionStatus[] = ["ongoing", "filled", "cancel"];

export const WRITABLE_REQUISITION_STATUSES: RequisitionStatus[] = ["ongoing", "cancel"];

export const ROLES: Role[] = ["admin", "recruiter", "viewer"];

export const RESULT_LABELS = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail"
};

export function canWrite(role?: Role | null) {
  return role === "admin" || role === "recruiter";
}

export function canAdmin(role?: Role | null) {
  return role === "admin";
}

export function processIndex(stage: ProcessStage | "No activity" | null | undefined) {
  const index = PROCESS_STAGES.indexOf(stage as ProcessStage);
  return index === -1 ? -1 : index;
}
