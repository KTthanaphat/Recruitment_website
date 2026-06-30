import type { ProcessStage, Profile, RequisitionStatus, Role, ViewId } from "@/types/recruitment";

export const VIEWS: ViewId[] = [
  "home",
  "dashboard",
  "requisitions",
  "candidates",
  "pipeline",
  "offers",
  "sourcing",
  "admin",
  "audit"
];

export const SITE_OPTIONS = ["HQ", "KT1", "KT2"] as const;

export const SOURCING_CHANNELS = [
  { enabled: "channel_fb", count: "applicants_fb", label: "Facebook" },
  { enabled: "channel_jobthai", count: "applicants_jobthai", label: "JobThai" },
  { enabled: "channel_jobtopgun", count: "applicants_jobtopgun", label: "JobTopGun" },
  { enabled: "channel_jobdb", count: "applicants_jobdb", label: "JobDB" },
  { enabled: "channel_linkedin", count: "applicants_linkedin", label: "LinkedIn" },
  { enabled: "channel_walkin", count: "applicants_walkin", label: "Walk-in" },
  { enabled: "channel_referral", count: "applicants_referral", label: "Referral" },
  { enabled: "channel_others", count: "applicants_others", label: "Others" }
] as const;

export const PERSON_IN_CHARGE_ROLES: Role[] = ["admin_recruiter", "site_recruiter"];

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

export function recruiterNicknameOptions(profiles: Profile[]) {
  return Array.from(
    new Set(
      profiles
        .filter((profile) => PERSON_IN_CHARGE_ROLES.includes(profile.role))
        .map((profile) => profile.nickname?.trim())
        .filter(Boolean) as string[]
    )
  ).sort((a, b) => a.localeCompare(b));
}

export const RESULT_LABELS = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail"
};

export function canWrite(role?: Role | null) {
  return role === "system_admin" || role === "admin_recruiter" || role === "site_recruiter";
}

export function canManageSetup(role?: Role | null) {
  return canWrite(role);
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
