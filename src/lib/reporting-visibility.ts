import type { DashboardData } from "@/types/recruitment";
/** Mirrors report membership for local fallback/export data; SQL remains authoritative. */
export function reportingOnlyData(data:DashboardData):DashboardData{
 const secretReqs=new Set(data.requisitions.filter(row=>row.is_secret).map(row=>row.doc_id));
 const secretGroups=new Set(data.position_groups.filter(row=>row.is_secret).map(row=>row.group_id));
 const excludedApps=new Set((data.candidate_applications??[]).filter(row=>secretGroups.has(row.group_id)).map(row=>row.application_id));
 const secretPeople=new Set((data.candidate_applications??[]).filter(row=>excludedApps.has(row.application_id)).map(row=>row.candidate_id));
 const ordinaryPeople=new Set((data.candidate_applications??[]).filter(row=>!excludedApps.has(row.application_id)).map(row=>row.candidate_id));
 const allowed=(id:string|undefined)=>!id||!excludedApps.has(id);
 return {...data,requisitions:data.requisitions.filter(row=>!secretReqs.has(row.doc_id)),position_groups:data.position_groups.filter(row=>!secretGroups.has(row.group_id)),document_groups:data.document_groups.filter(row=>!secretReqs.has(row.doc_id)&&!secretGroups.has(row.group_id??"")),candidates:data.candidates.filter(row=>!secretPeople.has(row.candidate_id)||ordinaryPeople.has(row.candidate_id)),candidate_applications:(data.candidate_applications??[]).filter(row=>allowed(row.application_id)),candidate_application_assignments:(data.candidate_application_assignments??[]).filter(row=>allowed(row.application_id)&&!secretGroups.has(row.group_id)),recruitment_logs:data.recruitment_logs.filter(row=>allowed(row.application_id)),recruitment_log_history:data.recruitment_log_history.filter(row=>allowed(row.application_id)),offers:data.offers.filter(row=>!secretReqs.has(row.doc_id)&&allowed(row.application_id)),sourcing_weekly_updates:data.sourcing_weekly_updates.filter(row=>!secretGroups.has(row.group_id)),requisition_logs:data.requisition_logs.filter(row=>!secretReqs.has(row.doc_id)),change_logs:data.change_logs.filter(row=>!row.is_secret)};
}
