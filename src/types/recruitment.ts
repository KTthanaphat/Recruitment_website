export type Language = "en" | "th";

export type Role = "system_admin" | "admin_recruiter" | "site_recruiter" | "viewer";

export type RequisitionStatus = "ongoing" | "filled" | "cancel";

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
  offered_type: string | null;
  replaced: string | null;
  remark: string | null;
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
  change_logs: ChangeLog[];
};

export type EnrichedRequisition = Requisition & {
  candidate_count: number;
  accepted_count: number;
  open_headcount: number;
};

export type EnrichedCandidate = Candidate & {
  doc_id: string | null;
  group_position: string | null;
  site: string | null;
  person_in_charge: string | null;
  latest_process: ProcessStage | "No activity";
  latest_result: ResultValue;
  accepted_date: string | null;
};

export type EnrichedOffer = Offer & {
  candidate_name: string | null;
  position: string | null;
  site: string | null;
  person_in_charge: string | null;
};

export type ViewId =
  | "dashboard"
  | "requisitions"
  | "candidates"
  | "pipeline"
  | "offers"
  | "setup"
  | "audit";

export type RpcResult = {
  ok: boolean;
  id?: string;
  error?: string;
};
