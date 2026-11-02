import type { Candidate, CandidateApplication, DashboardData, EnrichedCandidate, RecruitmentLog, Profile } from "@/types/recruitment";
import { countsTowardHeadcount } from "@/lib/offer-headcount";
import { bangkokDay } from "@/lib/dashboard-history";

/** A person's identity is never a substitute for a selected hiring journey. */
export function belongsToApplication(record: { candidate_id: string; application_id?: string }, candidate: Candidate) {
  return record.candidate_id === candidate.candidate_id && (!candidate.application_id ? !record.application_id : record.application_id === candidate.application_id);
}

export function applicationLogs(data: DashboardData, candidate: Candidate): RecruitmentLog[] {
  return data.recruitment_logs.filter(log => belongsToApplication(log, candidate));
}

export function applicationKey(candidate: Candidate) { return candidate.application_id ?? candidate.candidate_id; }

/** Historical group totals count people, including transferred and closed journeys. */
export function groupCandidateCount(data: DashboardData, groupId: string) {
  if (data.candidate_application_assignments) {
    const people = new Map((data.candidate_applications ?? []).map(row => [row.application_id, row.candidate_id]));
    return new Set(data.candidate_application_assignments.filter(row => row.group_id === groupId).map(row => people.get(row.application_id)).filter(Boolean)).size;
  }
  return new Set(data.candidates.filter(row => row.group_id === groupId || (!row.group_id && data.document_groups.some(link => link.doc_group_id === row.doc_group_id && link.group_id === groupId))).map(row => row.candidate_id)).size;
}

export function personProfiles(data: DashboardData): Candidate[] {
  return data.candidates.map(candidate => ({ ...candidate, group_id: null, doc_group_id: null }));
}

export function applicationCandidates(data: DashboardData): Candidate[] {
  if (!data.candidate_applications) return data.candidates;
  return data.candidate_applications.flatMap(application => {
    const profile = data.candidates.find(candidate => candidate.candidate_id === application.candidate_id);
    return profile ? [{ ...profile, application_id: application.application_id, application_state: application.state, group_id: application.group_id, doc_group_id: null, created_at: application.created_at }] : [];
  });
}

export function selectedApplication(data: DashboardData, candidateId: string, applicationId?: string | null): CandidateApplication | null {
  const applications = (data.candidate_applications ?? []).filter(row => row.candidate_id === candidateId);
  if (applicationId) return applications.find(row => row.application_id === applicationId) ?? null;
  return applications.length === 1 ? applications[0] : null;
}

export function currentApplicationRows(rows: EnrichedCandidate[]) { return rows.filter(row => row.application_state !== "closed"); }

export function canManageApplicationGroup(data: DashboardData, groupId: string) {
  const profile=data.profile;
  return Boolean(profile && profile.role !== "viewer" && (profile.role !== "site_recruiter" || data.document_groups.some(link=>link.group_id===groupId&&data.requisitions.some(req=>req.doc_id===link.doc_id&&[profile.nickname,profile.full_name].some(name=>name?.trim().toLowerCase()===req.person_in_charge?.trim().toLowerCase())))));
}

export function canManageCandidateJourney(candidate: EnrichedCandidate, profile: Profile|null) {
  if(!profile||profile.role==="viewer") return false;
  if(profile.role!=="site_recruiter") return true;
  return [profile.nickname,profile.full_name].some(name=>name&&(candidate.person_in_charges??[candidate.person_in_charge]).some(pic=>pic?.trim().toLowerCase()===name.trim().toLowerCase()));
}

export function profileCapabilities(data: DashboardData, candidateId: string) {
  const known=data.candidate_profile_capabilities?.find(row=>row.candidate_id===candidateId);
  if(known) return known;
  const candidate=data.candidates.find(row=>row.candidate_id===candidateId), profile=data.profile;
  const creator=Boolean(profile && candidate && candidate.created_by===profile.id);
  const admin=Boolean(profile && ["system_admin","admin_recruiter"].includes(profile.role));
  const writer=Boolean(profile && profile.role!=="viewer");
  const pic=(data.candidate_applications??[]).some(row=>row.candidate_id===candidateId&&canManageApplicationGroup(data,row.group_id));
  return {is_unmatched:!(data.candidate_applications??[]).some(row=>row.candidate_id===candidateId),note_editor_label:null as string|null,candidate_id:candidateId,creator_label:data.profiles.find(row=>row.id===candidate?.created_by)?.nickname??"—",can_edit:writer&&(admin||creator||pic),can_read_note:admin||creator||pic,can_edit_note:writer&&(admin||creator),can_add_application:writer&&(admin||creator||pic)};
}

export function eligibleApplicationGroups(data: DashboardData) {
  const profile=data.profile;
  if(!profile||profile.role==="viewer") return [];
  if(data.application_destinations) return data.application_destinations;
  return data.position_groups.filter(group=>data.document_groups.some(link=>{
    const req=data.requisitions.find(row=>row.doc_id===link.doc_id);
    if(!req||link.group_id!==group.group_id||req.status!=="ongoing") return false;
    const filled=data.offers.filter(offer=>offer.doc_id===req.doc_id&&countsTowardHeadcount(offer)).length;
    return req.head_count>filled && (profile.role!=="site_recruiter"||req.site===profile.site||req.person_in_charge===profile.nickname);
  }));
}

export function assignmentGroup(data: DashboardData, assignmentId: string | undefined | null) {
  return data.candidate_application_assignments?.find(row => row.assignment_id === assignmentId)?.group_id ?? null;
}

export function reassignmentCounts(data: DashboardData, groupIds: readonly string[], start?: string, end?: string) {
  const groups=new Set(groupIds);
  const events=(data.candidate_application_assignments??[]).filter(row=>{const day=bangkokDay(row.started_at);return row.from_group_id&&day&&(!start||day>=start)&&(!end||day<=end);});
  return { in:events.filter(row=>groups.has(row.group_id)).length, out:events.filter(row=>groups.has(row.from_group_id!)).length };
}

// Only authorized journeys are present here; server claims remain authoritative.
export function candidateCanUseGroup(data: DashboardData, candidateId: string, groupId: string, applicationId?: string) {
  return !(data.candidate_applications??[]).some(application => application.candidate_id===candidateId && application.application_id!==applicationId && (
    application.group_id===groupId || (data.candidate_application_assignments??[]).some(assignment=>assignment.application_id===application.application_id&&assignment.group_id===groupId)
  ));
}
