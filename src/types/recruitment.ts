export type Language = "en" | "th";

export type Role = "system_admin" | "admin_recruiter" | "site_recruiter" | "viewer";

export type RequisitionStatus = "ongoing" | "filled" | "cancel";

export type RequisitionRequestType = "New" | "Replacement";

export type ProcessStage =
  | "First Contact"
  | "Phone Screen"
  | "HR Interview"
  | "Line Interview"
  | "Test"
  | "Reference Check"
  | "Offer"
  | "Rejected"
  | "Withdrawn";

export type ResultValue = 0 | 1 | null;

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  nickname: string | null;
  site: string | null;
  role: Role;
  created_at: string;
  updated_at: string;
};

export type Requisition = {
  doc_id: string;
  pr_approved_date: string | null;
  site: string;
  position: string;
  department: string;
  section: string | null;
  level: string | null;
  head_count: number;
  person_in_charge: string | null;
  line_manager: string | null;
  request_type: RequisitionRequestType;
  replacement_names: string | null;
  status: RequisitionStatus;
  created_at: string;
  updated_at: string;
};

export type RequisitionLog = {
  log_id: number;
  doc_id: string;
  log_date: string;
  status: RequisitionStatus;
  remark: string | null;
  created_at: string;
};

export type PositionGroup = {
  group_id: string;
  group_position: string;
  channel_fb: boolean;
  channel_jobthai: boolean;
  channel_jobtopgun: boolean;
  channel_jobdb: boolean;
  channel_linkedin: boolean;
  channel_walkin: boolean;
  channel_referral: boolean;
  channel_others: boolean;
  created_at: string;
  updated_at: string;
};

export type DocumentGroup = {
  doc_group_id: string;
  doc_id: string;
  group_id: string | null;
  group_position: string;
  channel_fb: boolean;
  channel_jobthai: boolean;
  channel_jobtopgun: boolean;
  channel_jobdb: boolean;
  channel_linkedin: boolean;
  channel_walkin: boolean;
  channel_referral: boolean;
  channel_others: boolean;
  created_at: string;
  updated_at: string;
};

export type Candidate = {
  candidate_id: string;
  name: string;
  phone_no: string | null;
  doc_group_id: string;
  channel: string | null;
  ref_name: string | null;
  first_contact_date: string | null;
  candidate_folder_url: string | null;
  created_at: string;
  updated_at: string;
};

export type RecruitmentLog = {
  log_id: number;
  candidate_id: string;
  log_date: string;
  recruitment_process: ProcessStage;
  round: number;
  interviewer: string | null;
  result: ResultValue;
  remark: string | null;
  created_at: string;
};

export type Offer = {
  offer_id: number;
  candidate_id: string;
  doc_id: string;
  accepted_date: string | null;
  first_working_date: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
};

export type SourcingWeeklyUpdate = {
  group_id: string;
  week_start: string;
  channel_fb: boolean;
  channel_jobthai: boolean;
  channel_jobtopgun: boolean;
  channel_jobdb: boolean;
  channel_linkedin: boolean;
  channel_walkin: boolean;
  channel_referral: boolean;
  channel_others: boolean;
  applicants_fb: number;
  applicants_jobthai: number;
  applicants_jobtopgun: number;
  applicants_jobdb: number;
  applicants_linkedin: number;
  applicants_walkin: number;
  applicants_referral: number;
  applicants_others: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VacancyWaterfallCategory = "Week Start" | "Open" | "Filled" | "Total";

export type VacancyRequestType = RequisitionRequestType;

export type VacancyWeeklySnapshot = {
  snapshot_id: number;
  week_start: string;
  waterfall_category: VacancyWaterfallCategory;
  site: string;
  request_type: VacancyRequestType;
  vacancy_count: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ChangeLog = {
  log_id: number;
  entity: string;
  entity_id: string;
  action: string;
  changed_at: string;
  changed_by: string | null;
  changed_by_email: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
};

export type DashboardData = {
  profile: Profile | null;
  profiles: Profile[];
  requisitions: Requisition[];
  requisition_logs: RequisitionLog[];
  position_groups: PositionGroup[];
  document_groups: DocumentGroup[];
  candidates: Candidate[];
  recruitment_logs: RecruitmentLog[];
  offers: Offer[];
  sourcing_weekly_updates: SourcingWeeklyUpdate[];
  vacancy_weekly_snapshots: VacancyWeeklySnapshot[];
  change_logs: ChangeLog[];
};

export type EnrichedRequisition = Requisition & {
  candidate_count: number;
  accepted_count: number;
  open_headcount: number;
};

export type EnrichedCandidate = Candidate & {
  doc_id: string | null;
  doc_ids: string[];
  group_id: string | null;
  group_position: string | null;
  sites: string[];
  person_in_charges: string[];
  site: string | null;
  person_in_charge: string | null;
  latest_process: ProcessStage | "No activity";
  latest_result: ResultValue;
  latest_log_date: string | null;
  accepted_date: string | null;
};

export type EnrichedOffer = Offer & {
  candidate_name: string | null;
  position: string | null;
  site: string | null;
  person_in_charge: string | null;
  request_type: RequisitionRequestType | null;
};

export type EnrichedSourcingGroup = {
  group_id: string;
  group_position: string;
  sites: string[];
  owners: string[];
  doc_ids: string[];
  open_headcount: number;
  candidate_count: number;
  channel_fb: boolean;
  channel_jobthai: boolean;
  channel_jobtopgun: boolean;
  channel_jobdb: boolean;
  channel_linkedin: boolean;
  channel_walkin: boolean;
  channel_referral: boolean;
  channel_others: boolean;
  latest_update: SourcingWeeklyUpdate | null;
};

export type ViewId =
  | "home"
  | "dashboard"
  | "requisitions"
  | "candidates"
  | "pipeline"
  | "offers"
  | "sourcing"
  | "admin"
  | "audit";

export type RpcResult = {
  ok: boolean;
  id?: string;
  error?: string;
};
