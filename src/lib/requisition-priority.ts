import type { DashboardData, Profile, Requisition } from "@/types/recruitment";

export function canManageRequisitionPriority(profile: Profile | null, requisition: Requisition) {
  return profile?.role === "system_admin" || profile?.role === "admin_recruiter"
    || (profile?.role === "site_recruiter" && (profile.site === requisition.site || Boolean(profile.nickname && profile.nickname === requisition.person_in_charge)));
}

// Priority narrows the visible records; the original dataset remains available for writes/detail.
export function priorityRequisitionScope(data: DashboardData, priorityOnly: boolean): DashboardData {
  if (!priorityOnly) return data;
  const requisitions = data.requisitions.filter(row => row.is_priority === true);
  const docIds = new Set(requisitions.map(row => row.doc_id));
  const documentGroups = data.document_groups.filter(row => docIds.has(row.doc_id));
  const docGroupIds = new Set(documentGroups.map(row => row.doc_group_id));
  const groupIds = new Set(documentGroups.map(row => row.group_id).filter(Boolean));
  const applications = data.candidate_applications?.filter(row => groupIds.has(row.group_id));
  const applicationIds = new Set(applications?.map(row => row.application_id));
  const candidates = data.candidates.filter(row => applications ? applications.some(application => application.candidate_id === row.candidate_id) : row.group_id ? groupIds.has(row.group_id) : Boolean(row.doc_group_id && docGroupIds.has(row.doc_group_id)));
  const candidateIds = new Set(candidates.map(row => row.candidate_id));
  const referenceIds = new Set(data.candidate_references.filter(row => candidateIds.has(row.candidate_id)).map(row => row.reference_id));
  return {
    ...data, requisitions, document_groups: documentGroups, candidates, candidate_applications: applications,
    candidate_application_assignments: data.candidate_application_assignments?.filter(row => applicationIds.has(row.application_id)),
    requisition_logs: data.requisition_logs.filter(row => docIds.has(row.doc_id)),
    offers: data.offers.filter(row => docIds.has(row.doc_id)),
    position_groups: data.position_groups.filter(row => groupIds.has(row.group_id)),
    sourcing_weekly_updates: data.sourcing_weekly_updates.filter(row => groupIds.has(row.group_id)),
    recruitment_logs: data.recruitment_logs.filter(row => applications ? applicationIds.has(row.application_id ?? "") : candidateIds.has(row.candidate_id)),
    recruitment_log_history: (data.recruitment_log_history ?? []).filter(row => applications ? applicationIds.has(row.application_id ?? "") : candidateIds.has(row.candidate_id)),
    candidate_references: data.candidate_references.filter(row => candidateIds.has(row.candidate_id)),
    candidate_reference_checks: data.candidate_reference_checks.filter(row => referenceIds.has(row.reference_id)),
    rejection_letter_drafts: data.rejection_letter_drafts.filter(row => candidateIds.has(row.candidate_id)),
    interview_meetings: data.interview_meetings.filter(row => candidateIds.has(row.candidate_id))
  };
}
