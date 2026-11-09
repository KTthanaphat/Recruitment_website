require("./register-typescript.cjs");
const {test}=require("node:test"),assert=require("node:assert/strict");
const {fetchMatchingRecordIds,fetchSelectedRequisitions}=require("../../src/lib/records-selection.ts");
const {clearRecruitmentListCache,fetchRecruitmentListCount}=require("../../src/lib/recruitment-list.ts");
function fixture(size,counts=[size],options={}){
 const calls=[],ids=Array.from({length:size},(_,i)=>"ID-"+String(i).padStart(5,"0"));let count=0,pageNumber=0;
 const client={rpc:async(name,args)=>{calls.push({name,args});if(name.includes("count"))return{data:counts[Math.min(count++,counts.length-1)],error:null};
 const at=args.p_cursor_id?ids.indexOf(args.p_cursor_id)+1:0,items=ids.slice(at,at+args.p_limit).map(id=>({candidate_id:options.duplicate?"DUP":id,doc_id:id}));pageNumber++;
 const has_more=at+items.length<ids.length;return{data:{items,has_more,has_more_before:at>0,next_cursor:has_more?{value:items.at(-1).candidate_id,id:items.at(-1).candidate_id}:null,previous_cursor:at>0?{value:items[0].candidate_id,id:items[0].candidate_id}:null},error:null};}};
 return{client,calls,ids};
}
const request={accessScope:"capture",entity:"candidate_registry",filters:{scope:"active",candidateSite:"HQ"},search:"Engineer"};
for(const size of [0,7,23,100,1005])test("captures exactly "+size+" matching IDs in bounded reads",async()=>{
 clearRecruitmentListCache();const f=fixture(size),progress=[];const ids=await fetchMatchingRecordIds(f.client,request,p=>progress.push(p));assert.deepEqual(ids,f.ids);
 const pages=f.calls.filter(c=>c.name==="app_recruitment_list_v1");assert(pages.every(c=>c.args.p_limit===100&&c.args.p_sort==="candidate_id"&&c.args.p_direction==="asc"));assert(pages.every(c=>c.args.p_search==="Engineer"&&c.args.p_filters.scope==="active"));assert.equal(f.calls.filter(c=>c.name.includes("count")).length,2);assert.equal(progress.at(-1).loaded,size);
});
test("changing counts trigger one clean retry; persistent changes reject",async()=>{
 clearRecruitmentListCache();const stable=fixture(23,[23,24,23,23]);assert.equal((await fetchMatchingRecordIds(stable.client,request)).length,23);
 clearRecruitmentListCache();await assert.rejects(fetchMatchingRecordIds(fixture(23,[24]).client,request),/changed during selection/);
});
test("duplicate identities and missing cursors fail instead of committing partial selection",async()=>{
 clearRecruitmentListCache();await assert.rejects(fetchMatchingRecordIds(fixture(101,[101],{duplicate:true}).client,request),/duplicate/);
 clearRecruitmentListCache();let number=0;const client={rpc:async(name)=>({data:name.includes("count")?300:{items:[{candidate_id:"unique-"+(number++)}],has_more:true,has_more_before:false,next_cursor:{value:"stuck",id:"stuck"},previous_cursor:null},error:null})};
 await assert.rejects(fetchMatchingRecordIds(client,request),/cursor/);
});
test("cancellation stops traversal and leaves no successful partial result",async()=>{
 clearRecruitmentListCache();const f=fixture(1005),controller=new AbortController();
 await assert.rejects(fetchMatchingRecordIds(f.client,{...request,signal:controller.signal},p=>{if(p.loaded>=100)controller.abort();}),/cancelled/);
 assert.equal(f.calls.filter(c=>c.name==="app_recruitment_list_v1").length,1);
});
test("fresh counts bypass only their own cached criteria",async()=>{
 clearRecruitmentListCache();const f=fixture(7,[7,8]);assert.equal(await fetchRecruitmentListCount(f.client,request),7);assert.equal(await fetchRecruitmentListCount(f.client,request),7);assert.equal(await fetchRecruitmentListCount(f.client,request,{fresh:true}),8);
});
test("fresh requisition export batches captured IDs with current header authorization",async()=>{
 clearRecruitmentListCache();const calls=[],ids=Array.from({length:205},(_,i)=>"R"+i);
 const client={rpc:async(name,args)=>{calls.push(args);return{data:{items:args.p_filters.docIds.filter(id=>id!=="R0").map(doc_id=>({doc_id,status:"fresh"})),has_more:false,has_more_before:false,next_cursor:null,previous_cursor:null},error:null};}};
 const rows=await fetchSelectedRequisitions(client,"scope",ids,{headerSite:"HQ",headerPic:"Alice"});
 assert.equal(rows.length,204);assert.deepEqual(calls.map(c=>c.p_filters.docIds.length),[100,100,5]);assert(calls.every(c=>c.p_filters.headerSite==="HQ"&&c.p_filters.headerPic==="Alice"&&c.p_limit===100));
});
