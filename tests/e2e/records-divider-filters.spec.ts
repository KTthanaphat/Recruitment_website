import ExcelJS from "exceljs";
import {expect,test} from "@playwright/test";
import {installMockSupabase,expectWorkspaceReady} from "./support/mock-supabase";
function fillCandidates(mock:Awaited<ReturnType<typeof installMockSupabase>>,count=23){
 const template=mock.data.candidates[0],app=mock.data.candidate_applications![0];mock.data.candidates=[];mock.data.candidate_applications=[];
 for(let i=0;i<count;i++){const id="FILTER-"+String(i).padStart(3,"0");
 mock.data.candidates.push({...template,candidate_id:id,name:"Candidate "+i,nickname:"Nick "+i,phone_no:"080"+String(i).padStart(7,"0"),email:"person"+i+"@example.com",channel:i%2?"Agency":"Referral",position_interests:"Engineer "+i,home_site:i%2?"KT1":"HQ",created_by:mock.data.profile!.id,updated_at:"2026-07-"+String(i+1).padStart(2,"0")+"T00:00:00Z"});
 for(let j=0;j<i%3;j++)mock.data.candidate_applications.push({...app,application_id:id+"-"+j,candidate_id:id,state:"active"});
 }
}
test("candidate selection fades, survives pages, has mixed select-all and clears on query changes",async({page})=>{
 const mock=await installMockSupabase(page);fillCandidates(mock);await page.setViewportSize({width:1366,height:768});await page.goto("/candidates");await expectWorkspaceReady(page);
 await expect(page.getByRole("group",{name:"Candidate registry filter"})).toBeVisible();await expect(page.locator("thead th")).toHaveCount(10);
 const row=page.locator("tbody tr").first(),checkbox=row.getByRole("checkbox");await checkbox.check();await expect(row).toHaveClass(/records-selection-flash/);
 const geometry=await checkbox.evaluate(input=>{const a=input.getBoundingClientRect(),b=input.closest("td")!.getBoundingClientRect();return {top:a.top-b.top,left:a.left-b.left};});expect(geometry.top).toBeCloseTo(16,0);expect(geometry.left).toBeCloseTo(16,0);
 await expect(page.getByRole("checkbox",{name:"Select all matching candidates",exact:true})).toHaveJSProperty("indeterminate",true);
 await expect(row).not.toHaveClass(/records-selection-flash/,{timeout:1800});await expect(checkbox).toBeChecked();await expect(checkbox).toBeFocused();
 const pager=page.locator("[data-record-pagination]");await pager.getByRole("button",{name:"Next page",exact:true}).click();await page.locator("tbody tr").first().getByRole("checkbox").check();
 await expect(page.getByRole("button",{name:"Export selected",exact:true})).toBeVisible();await pager.getByRole("button",{name:"Previous page",exact:true}).click();await expect(page.locator("tbody tr").first().getByRole("checkbox")).toBeChecked();
 expect(await page.getByRole("button",{name:"Export selected",exact:true}).evaluate(el=>el.closest(".sticky")!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(768);
 await page.getByRole("searchbox").fill("FILTER-000");await expect(page.getByRole("button",{name:"Export selected",exact:true})).toHaveCount(0);
 await expect(page.locator("tbody tr")).toHaveCount(1);await page.getByRole("checkbox",{name:"Select all matching candidates",exact:true}).click();await expect(page.locator("tbody tr").first().getByRole("checkbox")).toBeChecked();
 await page.getByRole("button",{name:"Talent pool",exact:true}).click();await expect(page.getByRole("button",{name:"Export selected",exact:true})).toHaveCount(0);
});
test("candidate filters apply to server pages and counts, preserve state and block invalid requests",async({page})=>{
 const mock=await installMockSupabase(page);fillCandidates(mock);await page.goto("/candidates");await expectWorkspaceReady(page);
 const toggle=page.getByRole("button",{name:"Advanced Filters",exact:true});await toggle.click();
 const cases=[["Filter Candidate","Candidate 21","candidateText"],["Filter Contact","person21@","contactText"],["Filter Site","KT1","candidateSite"],["Filter Created by","System","creatorText"],["Filter Source","Agency","sourceText"],["Filter Interests","Engineer 21","interestsText"],["Minimum active applications","1","activeMin"],["Maximum active applications","2","activeMax"],["Updated from","2026-07-01","updatedFrom"],["Updated to","2026-07-23","updatedTo"]];
 for(const[label,value,key]of cases){await page.getByLabel(label,{exact:true}).fill(value);await page.getByRole("button",{name:"Apply filter",exact:true}).click();await expect.poll(()=>mock.rpcCalls.filter(c=>c.endpoint==="app_recruitment_list_v1"&&c.payload.p_entity==="candidate_registry").at(-1)?.payload.p_filters).toMatchObject({[key]:value});await page.getByRole("button",{name:"Clear filters",exact:true}).click();}
 await page.getByLabel("Filter Source",{exact:true}).fill("Agency");await page.getByRole("button",{name:"Apply filter",exact:true}).click();await expect(page.locator("[data-record-pagination]")).toContainText("of 11");await toggle.click();await expect(toggle).toHaveAttribute("data-filters-active","true");await toggle.click();await expect(page.getByLabel("Filter Source",{exact:true})).toHaveValue("Agency");
 await page.getByLabel("Minimum active applications",{exact:true}).fill("3");await page.getByLabel("Maximum active applications",{exact:true}).fill("1");await expect(page.locator("#candidate-filter-error")).toContainText("minimum");const calls=mock.rpcCalls.length;await page.waitForTimeout(300);expect(mock.rpcCalls.slice(calls).filter(call=>call.endpoint==="app_recruitment_list_v1"&&call.payload.p_entity==="candidate_registry").some(call=>{const f=call.payload.p_filters as any;return f.activeMin==="3"&&f.activeMax==="1";})).toBeFalsy();
 await page.getByRole("button",{name:"Clear filters",exact:true}).click();await page.getByLabel("Filter Candidate",{exact:true}).fill("%");await page.getByRole("button",{name:"Apply filter",exact:true}).click();await expect(page.locator("[data-record-pagination]")).toContainText("0/0");
});
test("candidate export refreshes selected IDs and leaves newly masked private fields blank",async({page})=>{
 const mock=await installMockSupabase(page);await page.goto("/candidates");await expectWorkspaceReady(page);await page.getByRole("searchbox").fill("C-HR");const row=page.locator("tbody tr");await expect(row).toHaveCount(1);await row.getByRole("checkbox").check();
 const selected=mock.data.candidates.find(c=>c.candidate_id==="C-HR")!;mock.data.masked_candidate_pool=[...(mock.data.masked_candidate_pool??[]),{candidate_id:selected.candidate_id,position_interests:"Permitted interests",creator_label:"System",created_at:selected.created_at,created_by:mock.data.profile!.id}];mock.data.candidates=mock.data.candidates.filter(c=>c.candidate_id!=="C-HR");
 const downloadEvent=page.waitForEvent("download");await page.getByRole("button",{name:"Export selected",exact:true}).click();const download=await downloadEvent;const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile((await download.path())!);const text=JSON.stringify(workbook.model);
 expect(text).toContain("C-HR");expect(text).toContain("Permitted interests");expect(text).not.toContain(selected.name!);expect(text).not.toContain(selected.phone_no!);expect(text).not.toContain(selected.email??"NEVER");expect(workbook.getWorksheet("Process history")!.rowCount).toBe(1);
 expect(mock.rpcCalls.some(c=>c.endpoint==="app_recruitment_list_v1"&&Array.isArray((c.payload.p_filters as any).candidateIds)&&c.payload.p_limit===100)).toBeTruthy();await expect(page.getByRole("status")).toContainText("Exported 1 of 1");
});
test("candidate workbook includes complete stage history and rejection reasons",async({page})=>{
 const mock=await installMockSupabase(page);const log=mock.data.recruitment_logs.find(item=>item.candidate_id==="C-FAILED"&&item.result===0)!;log.failure_actor="company";log.failure_reason_snapshot={actor:"company",main_en:"Skills mismatch",main_th:"ทักษะไม่ตรง",detail_en:"Interview below standard",detail_th:"สัมภาษณ์ไม่ผ่าน"};
 await page.goto("/candidates");await expectWorkspaceReady(page);await page.getByRole("searchbox").fill("C-FAILED");const row=page.locator("tbody tr");await expect(row).toHaveCount(1);await row.getByRole("checkbox").check();
 const event=page.waitForEvent("download");await page.getByRole("button",{name:"Export selected",exact:true}).click();const download=await event;expect(download.suggestedFilename()).toMatch(/\.xlsx$/);const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile((await download.path())!);
 expect(workbook.worksheets.map(sheet=>sheet.name)).toEqual(["Candidates","Applications","Process history","Offers","Reference checks"]);const history=JSON.stringify(workbook.getWorksheet("Process history")!.model);expect(history).toContain("Phone Screen");expect(history).toContain("HR Interview");expect(history).toContain("Skills mismatch");expect(history).toContain("Interview below standard");expect(workbook.getWorksheet("Applications")!.rowCount).toBeGreaterThan(1);
});
test("requisition Linked dots and selection keep Export/Clear without Review",async({page})=>{
 await installMockSupabase(page);await page.setViewportSize({width:1366,height:768});await page.goto("/requisitions");await expectWorkspaceReady(page);
 await expect(page.getByRole("button",{name:"Sort Linked",exact:true})).toBeVisible();const dot=page.locator("tbody .records-linked-tag").first();await expect(dot).toContainText(/Linked|Not linked/);
 const row=page.locator("tbody tr").first();await row.getByRole("checkbox").check();await expect(row).toHaveClass(/records-selection-flash/);await expect(page.getByRole("button",{name:"Review action",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"Export selected",exact:true})).toBeVisible();
 const sort=page.getByRole("button",{name:"Sort Linked",exact:true});const gap=await sort.evaluate(button=>{const a=button.querySelector("span")!.getBoundingClientRect(),b=button.querySelector("svg")!.getBoundingClientRect();return b.left-a.right;});expect(gap).toBeCloseTo(6,0);
 await expect(row).not.toHaveClass(/records-selection-flash/,{timeout:1800});await expect(row.getByRole("checkbox")).toBeChecked();await page.getByRole("button",{name:"Clear",exact:true}).click();await expect(row.getByRole("checkbox")).not.toBeChecked();
});
for(const width of [360,390])test("phone filters and reduced-motion checkbox feedback at "+width,async({page})=>{
 await installMockSupabase(page,{language:"th"});await page.setViewportSize({width,height:780});await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/candidates");await expectWorkspaceReady(page);
 await expect(page.getByRole("group",{name:"ตัวกรองทะเบียนผู้สมัคร"})).toBeVisible();await page.locator("[data-table-toolbar] button[aria-expanded]").click();await expect(page.locator("#records-candidate-filters")).toBeVisible();await expect(page.locator("thead input:not([type=checkbox])")).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();const card=page.locator(".records-mobile-cards article").first();await card.getByRole("checkbox").check();await expect(card).toHaveCSS("animation-name","none");await expect(card).toHaveCSS("background-color","rgb(237, 244, 255)");await expect(card).not.toHaveClass(/records-selection-flash/,{timeout:1800});
});
test("stage history removes the standalone state and keeps title proximity and accessible markers",async({page})=>{
 await installMockSupabase(page,{role:"system_admin"});await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);const entry=page.locator(".stage-history-entry").first();await entry.scrollIntoViewIfNeeded();
 await expect(entry.locator(":scope > span[role=img]")).toHaveAttribute("aria-label",/Round 1.*Pass|Round 1.*Pending/);const texts=await entry.locator("p").allTextContents();expect(texts.every(t=>!["Pass","Fail","Pending"].includes(t.trim()))).toBeTruthy();const gap=await entry.evaluate(node=>{const p=node.querySelector("p")!,h=node.querySelector("strong")!;return p.getBoundingClientRect().top-h.getBoundingClientRect().bottom;});expect(gap).toBeCloseTo(2,0);
 await page.screenshot({path:"outputs/compact-stage-history.png",fullPage:true});
});
