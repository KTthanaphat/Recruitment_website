import fs from "node:fs";
import {expect,test} from "@playwright/test";
import {installMockSupabase,expectWorkspaceReady} from "./support/mock-supabase";
type Mock=Awaited<ReturnType<typeof installMockSupabase>>;
function seed(mock:Mock,entity:string,size:number){
 if(entity==="candidate_registry"){
  const base=mock.data.candidates[0];mock.data.candidate_applications=[];mock.data.candidates=Array.from({length:size},(_,i)=>({...base,candidate_id:"CAP-"+String(i).padStart(5,"0"),name:"Capture candidate "+i,updated_at:"2026-07-01T00:00:00Z",home_site:"HQ"}));
 }else{const base=mock.data.requisitions[0];mock.data.requisitions=Array.from({length:size},(_,i)=>({...base,doc_id:"CAP-"+String(i).padStart(5,"0"),position:"ตำแหน่ง Position "+i,head_count:100,updated_at:"2026-07-01T00:00:00Z"}));}
}
for(const [entity,route,label]of [["candidate_registry","/candidates","candidates"],["requisitions","/requisitions","requisitions"]])for(const size of [23,1005])test(label+" captures "+size+" matches without rendering them all",async({page})=>{
 test.setTimeout(90000);const mock=await installMockSupabase(page,{role:"system_admin"});seed(mock,entity,size);await page.setViewportSize({width:1366,height:768});await page.goto(route);await expectWorkspaceReady(page);
 const header=page.getByRole("checkbox",{name:"Select all matching "+label,exact:true});await expect(header).toBeEnabled();await header.click();await expect(header).toBeChecked({timeout:45000});await expect(page.locator("tbody tr")).toHaveCount(7);await expect(page.locator(".sticky").filter({has:page.getByRole("button",{name:"Export selected",exact:true})})).toContainText(size.toLocaleString("en"));
 const capture=mock.rpcCalls.filter(c=>c.endpoint==="app_recruitment_list_v1"&&c.payload.p_entity===entity&&c.payload.p_limit===100);expect(capture).toHaveLength(Math.ceil(size/100));expect(capture.every(c=>c.payload.p_sort===(entity==="requisitions"?"doc_id":"candidate_id"))).toBeTruthy();
 const pager=page.locator("[data-record-pagination]");expect((await pager.boundingBox())!.y+(await pager.boundingBox())!.height).toBeLessThanOrEqual(768);
 await pager.getByRole("button",{name:"Next page",exact:true}).click();for(const checkbox of await page.locator("tbody").getByRole("checkbox").all())await expect(checkbox).toBeChecked();
 if(size===23){
  const removed="CAP-00000";if(entity==="requisitions")mock.data.requisitions=mock.data.requisitions.filter(row=>row.doc_id!==removed);else mock.data.candidates=mock.data.candidates.filter(row=>row.candidate_id!==removed);
  const event=page.waitForEvent("download");await page.getByRole("button",{name:"Export selected",exact:true}).click();const csv=fs.readFileSync((await(await event).path())!,"utf8");expect(csv).not.toContain(removed);expect(csv).toContain("CAP-00022");await expect(page.getByRole("status")).toContainText("Exported 22 of 23");
 }
 await page.locator("tbody").getByRole("checkbox").first().uncheck();await expect(header).toHaveJSProperty("indeterminate",true);
 await page.getByRole("button",{name:"Clear",exact:true}).click();await expect(header).not.toBeChecked();await expect(page.getByRole("button",{name:"Export selected",exact:true})).toHaveCount(0);
});
test("capture progress cancels atomically, query changes abort and later matches stay unselected",async({page})=>{
 const mock=await installMockSupabase(page);seed(mock,"candidate_registry",205);
 let hold=false,release:()=>void=()=>{},gate=Promise.resolve();await page.route("**/rest/v1/rpc/app_recruitment_list_v1",async route=>{const body=route.request().postDataJSON();if(hold&&body.p_entity==="candidate_registry"&&body.p_limit===100&&body.p_cursor_id)await gate;await route.fallback();});
 await page.goto("/candidates");await expectWorkspaceReady(page);await page.locator("tbody").getByRole("checkbox").first().check();
 const header=page.getByRole("checkbox",{name:"Select all matching candidates",exact:true});
 gate=new Promise<void>(resolve=>{release=resolve;});hold=true;await header.click();await expect(page.getByRole("status")).toContainText("Selecting 100 / 205");await expect(page.locator("tbody").getByRole("checkbox").first()).toBeDisabled();await expect(page.locator("[data-record-pagination]").getByRole("button",{name:"Next page",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"Cancel",exact:true}).click();hold=false;release();await expect(page.locator("tbody").getByRole("checkbox").first()).toBeChecked();await expect(header).toHaveJSProperty("indeterminate",true);
 gate=new Promise<void>(resolve=>{release=resolve;});hold=true;await header.click();await expect(page.getByRole("status")).toContainText("Selecting 100 / 205");await page.getByRole("searchbox").fill("Capture candidate 20");hold=false;release();await expect(page.getByRole("button",{name:"Export selected",exact:true})).toHaveCount(0);await page.getByRole("searchbox").fill("");await expect(header).toBeEnabled();await header.click();await expect(header).toBeChecked();const original=mock.data.candidates[0];mock.data.candidates.push({...original,candidate_id:"CAP-00007A",name:"New match after capture"});
 await page.locator("[data-record-pagination]").getByRole("button",{name:"Next page",exact:true}).click();const added=page.locator("tbody tr").filter({hasText:"New match after capture"});await expect(added).toBeVisible();await expect(added.getByRole("checkbox")).not.toBeChecked();await expect(header).toHaveJSProperty("indeterminate",true);
 await page.getByRole("searchbox").fill("Capture candidate 20");await expect(page.getByRole("button",{name:"Export selected",exact:true})).toHaveCount(0);
});
test("capture request failure preserves earlier manual selection",async({page})=>{
 const mock=await installMockSupabase(page);seed(mock,"candidate_registry",205);await page.goto("/candidates");await expectWorkspaceReady(page);await page.locator("tbody").getByRole("checkbox").first().check();
 let fail=true;await page.route("**/rest/v1/rpc/app_recruitment_list_v1",async route=>{const body=route.request().postDataJSON();if(fail&&body.p_limit===100){await route.fulfill({status:500,contentType:"application/json",body:'{"message":"Capture failure"}'});return;}await route.fallback();});
 const header=page.getByRole("checkbox",{name:"Select all matching candidates",exact:true});await header.click();await expect(page.locator(".records-surface [role=alert]")).toContainText("Could not select matching");await expect(page.locator("tbody").getByRole("checkbox").first()).toBeChecked();fail=false;await header.click();await expect(header).toBeChecked();
});
test("Requisition identity, order and separate filters keep centered consistent headings",async({page})=>{
 await installMockSupabase(page);await page.setViewportSize({width:1366,height:768});await page.goto("/requisitions");await expectWorkspaceReady(page);
 const titles=await page.locator("thead tr").first().locator("th").allTextContents();expect(titles.map(t=>t.trim()).slice(2,5)).toEqual(["Position","Status","Linked"]);expect(titles.map(t=>t.trim()).indexOf("Open HC")+1).toBe(titles.map(t=>t.trim()).indexOf("Headcount"));
 const identity=page.locator("tbody .records-requisition-identity").first();await expect(identity.locator(".records-position-primary")).toHaveCSS("font-size","13px");await expect(identity.locator(".records-position-id")).toHaveCSS("font-weight","400");
 await page.getByRole("button",{name:"Advanced Filters",exact:true}).click();await expect(page.locator("thead .records-filter-row")).toHaveCount(1);await expect(page.getByRole("button",{name:"Sort Doc ID",exact:true})).toBeVisible();await expect(page.getByLabel("Filter Doc ID",{exact:true})).toBeVisible();
 const styles=await page.locator("thead tr").first().locator("th").evaluateAll(nodes=>nodes.map(node=>{const s=getComputedStyle(node);return [s.verticalAlign,s.fontSize,s.fontWeight,node.getBoundingClientRect().height];}));for(const value of styles){expect(value.slice(0,3)).toEqual(["middle","12px","600"]);expect(value[3]).toBe(48);}
 await page.screenshot({path:"outputs/records-capture-requisition-filters.png",fullPage:true});
});

test("capture retries a changing population and refreshes the visible exact count",async({page})=>{
 const mock=await installMockSupabase(page);seed(mock,"candidate_registry",205);await page.goto("/candidates");await expectWorkspaceReady(page);
 let added=false;await page.route("**/rest/v1/rpc/app_recruitment_list_v1",async route=>{const body=route.request().postDataJSON();if(!added&&body.p_limit===100&&body.p_cursor_id){added=true;mock.data.candidates.push({...mock.data.candidates[0],candidate_id:"CAP-99999",name:"Added during capture"});}await route.fallback();});
 const header=page.getByRole("checkbox",{name:"Select all matching candidates",exact:true});await header.click();await expect(header).toBeChecked();await expect(page.locator(".sticky").filter({has:page.getByRole("button",{name:"Export selected",exact:true})})).toContainText("206");await expect(page.locator("[data-record-pagination]")).toContainText("1/30");
 expect(mock.rpcCalls.filter(c=>c.endpoint==="app_recruitment_list_v1"&&c.payload.p_limit===100&&!c.payload.p_cursor_id)).toHaveLength(2);
});
test("header capture stays disabled for unresolved or failed counts, unsettled search and empty results",async({page})=>{
 const mock=await installMockSupabase(page,{countDelayMs:900,countFailureOnceEntity:"candidate_registry"});seed(mock,"candidate_registry",23);await page.goto("/candidates");await expectWorkspaceReady(page);
 const header=page.getByRole("checkbox",{name:"Select all matching candidates",exact:true});await expect(header).toBeDisabled();await expect(page.locator("[data-record-pagination]")).toContainText("1/—");await page.getByRole("button",{name:"Retry record count",exact:true}).click();await expect(header).toBeDisabled();await expect(header).toBeEnabled();await page.getByRole("searchbox").fill("NO-MATCH-ANYWHERE");await expect(header).toBeDisabled();await expect(page.locator("[data-record-pagination]")).toContainText("0/0");await expect(header).toBeDisabled();
});
