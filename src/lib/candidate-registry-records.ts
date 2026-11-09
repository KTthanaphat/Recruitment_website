import type {SupabaseClient} from "@supabase/supabase-js";
import {fetchRecruitmentList} from "./recruitment-list";
export type CandidateRegistryItem={candidate_id:string;name:string|null;nickname:string|null;phone_no:string|null;email:string|null;home_site:string|null;creator_label:string|null;channel:string|null;position_interests:string|null;active_application_count:number|null;updated_at:string|null;created_at:string|null;masked:boolean;is_unmatched:boolean;has_priority_requisition:boolean};
export const emptyCandidateColumnFilters={candidateText:"",contactText:"",candidateSite:"",creatorText:"",sourceText:"",interestsText:"",activeMin:"",activeMax:"",updatedFrom:"",updatedTo:""};
export type CandidateColumnFilters=typeof emptyCandidateColumnFilters;
export function candidateColumnFilterError(filters:CandidateColumnFilters):"count"|"date"|null {
 const min=filters.activeMin.trim(),max=filters.activeMax.trim();
 if([min,max].some(value=>value!==""&&(!/^\d+$/.test(value)||Number(value)>2147483647))||min!==""&&max!==""&&Number(min)>Number(max))return "count";
 for(const key of ["updatedFrom","updatedTo"] as const){const value=filters[key];if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+"T00:00:00Z"))||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value||value.slice(0,4)==="0000"))return "date";}
 if(filters.updatedFrom&&filters.updatedTo&&filters.updatedFrom>filters.updatedTo)return "date";
 return null;
}
export async function fetchSelectedCandidateRecords(client:Pick<SupabaseClient,"rpc">,accessScope:string,ids:string[],header:{site:string;owner:string},signal?:AbortSignal) {
 const result:CandidateRegistryItem[]=[];
 for(let start=0;start<ids.length;start+=100){
  if(signal?.aborted)throw new DOMException("Export cancelled","AbortError");
  const page=await fetchRecruitmentList<CandidateRegistryItem>(client,{accessScope,entity:"candidate_registry",filters:{scope:"all",...header,candidateIds:ids.slice(start,start+100)},sort:"candidate_id",direction:"asc",limit:100,freshAfter:Number.POSITIVE_INFINITY,signal});
  if(page.has_more)throw new Error("Selected candidate response exceeded its bounded scope.");
  result.push(...page.items);
 }
 return result;
}
