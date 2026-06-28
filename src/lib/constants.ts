import type { ProcessStage, RequisitionStatus, Role, ViewId } from "@/types/recruitment";

export const VIEWS: ViewId[] = [
  "dashboard",
  "requisitions",
  "candidates",
  "pipeline",
  "offers",
  "sourcing",
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
  (stage) => !["First Contact", "Rejected", "Withdrawn"].includes(stage)
);

export const PROCESS_UPDATE_STAGES: ProcessStage[] = PROCESS_STAGES.filter((stage) => stage !== "First Contact");

export const PROCESS_LABELS: Record<ProcessStage, string> = {
  "First Contact": "First Contact",
  "Phone Screen": "Phone Screening",
  "HR Interview": "HR Interview",
  "Line Interview": "Line Interview",
  Test: "Test",
  "Reference Check": "Reference Check",
  Offer: "Offer",
  Rejected: "Rejected",
  Withdrawn: "Withdrawn"
};

export const REQUISITION_STATUSES: RequisitionStatus[] = ["ongoing", "filled", "cancel"];

export const WRITABLE_REQUISITION_STATUSES: RequisitionStatus[] = ["ongoing", "cancel"];

export const ROLES: Role[] = ["system_admin", "admin_recruiter", "site_recruiter", "viewer"];

export const ROLE_LABELS: Record<Role, string> = {
  system_admin: "System Admin",
  admin_recruiter: "Admin Recruiter",
  site_recruiter: "Site Recruiter",
  viewer: "Viewer"
};

export const RESULT_LABELS = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail"
};

export function canWrite(role?: Role | null) {
  return role === "system_admin" || role === "admin_recruiter" || role === "site_recruiter";
}

export function canManageSetup(role?: Role | null) {
  return role === "system_admin";
}

export function canManageUsers(role?: Role | null) {
  return role === "system_admin";
}

export function canSeeAllSites(role?: Role | null) {
  return role === "system_admin" || role === "admin_recruiter" || role === "viewer";
}

export function processIndex(stage: ProcessStage | "No activity" | null | undefined) {
  const index = PROCESS_STAGES.indexOf(stage as ProcessStage);
  return index === -1 ? -1 : index;
}

export function processLabel(stage: ProcessStage | "No activity" | null | undefined) {
  if (!stage || stage === "No activity") return "No activity";
  return PROCESS_LABELS[stage] ?? stage;
}
