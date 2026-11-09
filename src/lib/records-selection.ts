import type {SupabaseClient} from "@supabase/supabase-js";
import {fetchRecruitmentList,fetchRecruitmentListCount,type RecruitmentListRequest,type RecruitmentListCursor,type RecruitmentListPage} from "./recruitment-list";
import type {EnrichedRequisition} from "@/types/recruitment";
type Client=Pick<SupabaseClient,"rpc">;
export type SelectionProgress={loaded:number;total:number|null};
export async function fetchMatchingRecordIds(client:Client,request:RecruitmentListRequest,onProgress?:(progress:SelectionProgress)=>void):Promise<string[]> {
 const key=request.entity==="requisitions"?"doc_id":"candidate_id";
 if(!["requisitions","candidate_registry"].includes(request.entity))throw new Error("Unsupported selection entity.");
 const normalized={...request,sort:key,direction:"asc" as const,cursor:null,before:false};
 for(let attempt=0;attempt<2;attempt++){
  const ids=new Set<string>(),cursors=new Set<string>();let cursor:RecruitmentListCursor|null=null;
  const total=await fetchRecruitmentListCount(client,normalized,{fresh:true});
  onProgress?.({loaded:0,total});
  do {
   if(request.signal?.aborted)throw new DOMException("Selection cancelled","AbortError");
   const page:RecruitmentListPage<Record<string,unknown>>=await fetchRecruitmentList<Record<string,unknown>>(client,{...normalized,cursor,limit:100,freshAfter:Number.POSITIVE_INFINITY});
   for(const row of page.items){const id=row[key];if(typeof id!=="string"||!id||ids.has(id))throw new Error("Selection contains a missing or duplicate identity.");ids.add(id);}
   onProgress?.({loaded:ids.size,total});
   if(!page.has_more)break;
   if(!page.next_cursor||!page.items.length)throw new Error("Selection cursor did not advance.");
   const next=JSON.stringify(page.next_cursor);if(cursors.has(next))throw new Error("Selection cursor did not advance.");cursors.add(next);cursor=page.next_cursor;
  }while(cursor);
  const endCount=await fetchRecruitmentListCount(client,normalized,{fresh:true});
  if(request.signal?.aborted)throw new DOMException("Selection cancelled","AbortError");
  if(total===endCount&&ids.size===endCount)return [...ids];
 }
 throw new Error("Matching records changed during selection. Please retry.");
}
export async function fetchSelectedRequisitions(client:Client,accessScope:string,ids:string[],header:Record<string,unknown>,signal?:AbortSignal){
 const rows:EnrichedRequisition[]=[];
 for(let i=0;i<ids.length;i+=100){
  if(signal?.aborted)throw new DOMException("Export cancelled","AbortError");
  const page=await fetchRecruitmentList<EnrichedRequisition>(client,{accessScope,entity:"requisitions",filters:{...header,docIds:ids.slice(i,i+100)},sort:"doc_id",direction:"asc",limit:100,freshAfter:Number.POSITIVE_INFINITY,signal});
  if(page.has_more)throw new Error("Selected requisition response exceeded its bounded scope.");
  rows.push(...page.items);
 }
 return rows;
}
