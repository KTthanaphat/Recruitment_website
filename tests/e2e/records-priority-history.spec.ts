import {expect,test} from "@playwright/test";
import {installMockSupabase,expectWorkspaceReady} from "./support/mock-supabase";

test("Updated sorts all pages through RPC and restores candDir without private timestamps",async({page})=>{
 const mock=await installMockSupabase(page),template=mock.data.candidates[0];mock.data.candidates=[];
 for(let i=0;i<23;i++)mock.data.candidates.push({...template,candidate_id:"SORT-"+String(i).padStart(2,"0"),name:"Sorted "+i,updated_at:"2026-07-"+String(i+1).padStart(2,"0")+"T00:00:00Z"});
 await page.goto("/candidates?candDir=asc&preserve=yes");await expectWorkspaceReady(page);
 const cells=page.locator("tbody tr td:nth-child(3)");await expect(cells.first()).toContainText("SORT-00");
 await page.locator("[data-record-pagination]").getByRole("button",{name:"Next page",exact:true}).click();await expect(cells.first()).toContainText("SORT-07");
 await page.getByRole("button",{name:"Sort Updated",exact:true}).click();await expect(page).toHaveURL(/candDir=desc/);await expect(page).toHaveURL(/preserve=yes/);
 await expect(page.locator("th[aria-sort=descending]")).toContainText("Updated");await expect(cells.first()).toContainText("SORT-22");
 await expect(page.locator("[data-record-pagination]")).toContainText("1/4");await page.reload();await expectWorkspaceReady(page);await expect(cells.first()).toContainText("SORT-22");
 expect(mock.rpcCalls.filter(c=>c.endpoint==="app_recruitment_list_v1"&&c.payload.p_entity==="candidate_registry").some(c=>c.payload.p_direction==="asc"&&c.payload.p_cursor_id)).toBeTruthy();
 await page.setViewportSize({width:390,height:780});await expect(page.getByRole("button",{name:"Sort Updated",exact:true})).toBeVisible();
});

test("priority indicators are read-only and use active application requisition links",async({page})=>{
 const mock=await installMockSupabase(page);const candidate=mock.data.candidates.find(c=>c.candidate_id==="C-HR")!;
 const app=mock.data.candidate_applications!.find(a=>a.candidate_id===candidate.candidate_id)!;
 for(const req of mock.data.requisitions)req.is_priority=false;
 const link=mock.data.document_groups.find(g=>g.group_id===app.group_id)!;
 mock.data.requisitions.find(r=>r.doc_id===link.doc_id)!.is_priority=true;app.state="active";
 await page.goto("/candidates");await expectWorkspaceReady(page);await page.getByRole("searchbox").fill("C-HR");
 const row=page.locator("tbody tr").filter({hasText:"C-HR"});await expect(row.locator("[data-record-priority]")).toHaveAttribute("data-priority","true");await expect(row.locator("[data-record-priority]")).toHaveCSS("color","rgb(10, 60, 220)");await expect(row.locator("[data-record-priority] button")).toHaveCount(0);
 app.state="closed";await page.reload();await expectWorkspaceReady(page);await page.getByRole("searchbox").fill("C-HR");await expect(row.locator("[data-record-priority]")).toHaveAttribute("data-priority","false");await expect(row.locator("[data-record-priority]")).toHaveCSS("color","rgb(124, 148, 173)");
 await page.goto("/requisitions");await expectWorkspaceReady(page);await expect(page.locator("tbody tr").first().locator("[data-record-priority]")).toHaveCount(1);
});

test("application switches retain the mounted profile, hide old actions and ignore late responses",async({page})=>{
 const mock=await installMockSupabase(page);const first=mock.data.candidate_applications!.find(a=>a.candidate_id==="C-HR")!;
 const second={...first,application_id:"loading-second",group_id:"GRP-TECH"};mock.data.candidate_applications!.push(second);
 mock.data.recruitment_logs.push({...mock.data.recruitment_logs.find(l=>l.application_id===first.application_id)!,log_id:9901,stage_instance_id:"loading-stage",application_id:second.application_id,remark:"SECOND APPLICATION ONLY"});
 let release:()=>void=()=>{};let hold=false;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route("**/rest/v1/candidate_reference_checks?**",async route=>{if(hold&&route.request().url().includes("loading-second"))await gate;await route.fallback();});
 await page.goto("/candidates?detailType=candidate&detailId=C-HR&applicationId="+first.application_id);await expectWorkspaceReady(page);
 const profile=page.getByRole("region",{name:"Candidate profile",exact:true});await expect(page.getByRole("heading",{name:"Stage history",exact:true})).toBeVisible();await profile.evaluate(el=>el.setAttribute("data-retained-test","same-node"));
 hold=true;const tabs=page.getByRole("tablist",{name:"Candidate applications"});await tabs.getByRole("tab").filter({hasText:"GRP-TECH"}).click();
 await expect(page.locator("[data-application-skeleton]")).toBeVisible();await expect(profile).toHaveAttribute("data-retained-test","same-node");await page.setViewportSize({width:360,height:780});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:"outputs/application-skeleton-phone.png",fullPage:true});await page.setViewportSize({width:1366,height:768});await expect(page.getByRole("tabpanel")).not.toContainText("SECOND APPLICATION ONLY");await expect(page.getByRole("tabpanel").getByRole("button",{name:"Reassign application"})).toHaveCount(0);
 await tabs.getByRole("tab").filter({hasText:first.group_id}).click();release();await expect(page.locator("[data-application-skeleton]")).toHaveCount(0);await expect(page.getByRole("tabpanel")).not.toContainText("SECOND APPLICATION ONLY");
 await tabs.getByRole("tab").filter({hasText:"GRP-TECH"}).click();await expect(page.getByRole("tabpanel")).toContainText("SECOND APPLICATION ONLY");await expect(profile).toHaveAttribute("data-retained-test","same-node");
 await expect(page.getByRole("heading",{name:"Current stage",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Completed stage history",exact:true})).toHaveCount(0);await expect(page.locator(".stage-history-entry .rounded-md")).toHaveCount(0);await page.locator(".stage-history-rail").scrollIntoViewIfNeeded();await page.screenshot({path:"outputs/candidate-stage-history.png",fullPage:true});
});

test("application errors retain profile and retry inside the selected panel",async({page})=>{
 const mock=await installMockSupabase(page);const first=mock.data.candidate_applications!.find(a=>a.candidate_id==="C-HR")!;
 mock.data.candidate_applications!.push({...first,application_id:"retry-second",group_id:"GRP-TECH"});
 let fail=true;await page.route("**/rest/v1/candidate_reference_checks?**",async route=>{if(fail&&route.request().url().includes("retry-second")){await route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({message:"Application fixture temporarily unavailable"})});return;}await route.fallback();});
 await page.goto("/candidates?detailType=candidate&detailId=C-HR&applicationId="+first.application_id);await expectWorkspaceReady(page);const profile=page.getByRole("region",{name:"Candidate profile",exact:true});
 await expect(page.getByRole("heading",{name:"Stage history",exact:true})).toBeVisible();await page.getByRole("tab").filter({hasText:"GRP-TECH"}).click();
 const panel=page.getByRole("tabpanel");await expect(panel.getByRole("alert")).toContainText("temporarily unavailable");await expect(profile).toBeVisible();await expect(panel.getByRole("button",{name:"Reassign application",exact:true})).toHaveCount(0);
 fail=false;await panel.getByRole("button",{name:"Retry",exact:true}).click();await expect(panel.getByRole("heading",{name:"Stage history",exact:true})).toBeVisible();await expect(profile).toBeVisible();
});

test("application access loss refreshes authorized tabs without discarding the profile",async({page})=>{
 const mock=await installMockSupabase(page);const first=mock.data.candidate_applications!.find(a=>a.candidate_id==="C-HR")!;
 mock.data.candidate_applications!.push({...first,application_id:"access-lost-second",group_id:"GRP-TECH"});
 await page.goto("/candidates?detailType=candidate&detailId=C-HR&applicationId="+first.application_id);await expectWorkspaceReady(page);
 const profile=page.getByRole("region",{name:"Candidate profile",exact:true});await expect(page.getByRole("heading",{name:"Stage history",exact:true})).toBeVisible();
 mock.data.candidate_applications=mock.data.candidate_applications!.filter(a=>a.application_id!=="access-lost-second");
 await page.getByRole("tab").filter({hasText:"GRP-TECH"}).click();await expect(page.getByRole("tab").filter({hasText:"GRP-TECH"})).toHaveCount(0);await expect(profile).toBeVisible();await expect(page.getByRole("tabpanel")).toHaveCount(0);
});
