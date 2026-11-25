import {expect,test,type Page} from "@playwright/test";
import {expectWorkspaceReady,installMockSupabase} from "./support/mock-supabase";
const contact="0817654321";
async function setup(page:Page,language:"en"|"th"="en"){
 const mock=await installMockSupabase(page,{role:"admin_recruiter",language});
 const candidate=mock.data.candidates.find(row=>row.candidate_id==="C-PHONE")!;
 const application=mock.data.candidate_applications!.find(row=>row.candidate_id===candidate.candidate_id)!;
 const result={items:[{candidate_id:candidate.candidate_id,name:candidate.name,nickname:null,email:"lookup@example.test",phone_no:contact,applications:{items:[{application_id:application.application_id,group_id:application.group_id,group_position:"Engineer",stage:"Phone Screen",state:"active",result:null}],next_cursor:null}}],next_cursor:null};
 let calls=0,lastContact="";
 await page.route("**/rest/v1/rpc/app_candidate_contact_lookup_v2",async route=>{calls++;lastContact=route.request().postDataJSON().p_contact;await route.fulfill({contentType:"application/json",body:JSON.stringify(result)});});
 await page.goto(`/candidates?lang=${language}`);await expectWorkspaceReady(page);
 return {mock,result,calls:()=>calls,lastContact:()=>lastContact};
}

test("compact three-row header searches automatically without a Search button or initial autofocus",async({page},testInfo)=>{
 const lookup=await setup(page),panel=page.getByRole("dialog",{name:"Candidate lookup",exact:true}),input=panel.getByLabel("Find by phone digits or full email");
 await expect(input).toBeVisible();await expect(input).not.toBeFocused();await expect(panel.getByRole("button",{name:"Search",exact:true})).toHaveCount(0);
 await panel.getByRole("button",{name:"About candidate lookup"}).focus();await expect(page.getByRole("tooltip")).toContainText("4 or more consecutive phone digits");await page.keyboard.press("Escape");await expect(page.getByRole("tooltip")).toHaveCount(0);await expect(panel).toBeVisible();
 expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(362);expect((await input.boundingBox())!.height).toBe(40);
 await panel.locator("[data-lookup-illustration] img").evaluate(image=>(image as HTMLImageElement).decode());await page.screenshot({path:testInfo.outputPath("lookup-idle-desktop.png")});
 await input.fill(contact);await page.waitForTimeout(100);expect(lookup.calls()).toBe(0);await expect(panel).toContainText("Pat Phone");expect(lookup.calls()).toBe(1);
});

test("automatic phone lookup waits for valid input, normalizes Thai phones and opens the selected application",async({page},testInfo)=>{
 const lookup=await setup(page),panel=page.getByRole("dialog",{name:"Candidate lookup",exact:true}),input=panel.getByLabel("Find by phone digits or full email");
 await input.fill("081");await page.waitForTimeout(400);expect(lookup.calls()).toBe(0);await input.press("Enter");await expect(panel.getByRole("alert")).toContainText("at least 4 consecutive phone digits");
 await input.fill("7654");await expect(panel).toContainText("Pat Phone");expect(lookup.lastContact()).toBe("7654");
 await input.fill("08176");await expect(panel).toContainText("Pat Phone");expect(lookup.lastContact()).toBe("08176");
 await input.fill("+66 (81) 765-4321");await expect(panel).toContainText("Pat Phone");expect(lookup.lastContact()).toBe(contact);await expect(panel).toContainText("Phone Screen");
 await page.screenshot({path:testInfo.outputPath("lookup-desktop.png")});await panel.getByRole("button",{name:"View application",exact:true}).click();await expect(panel).toBeHidden();await expect(page.getByRole("dialog").filter({hasText:"Pat Phone"}).first()).toBeVisible();
});

test("lookup stays in memory across navigation and never writes the contact to browser storage",async({page})=>{
 const lookup=await setup(page),panel=page.getByRole("dialog",{name:"Candidate lookup",exact:true}),input=panel.getByLabel("Find by phone digits or full email");await input.fill(contact);await expect(panel).toContainText("Pat Phone");
 await page.getByRole("link",{name:"Workspace",exact:true}).first().click();await expect(page).toHaveURL(/workspace/);await expect(panel).toContainText("Pat Phone");expect(lookup.calls()).toBe(1);
 expect(await page.evaluate(value=>[...Object.values(localStorage),...Object.values(sessionStorage)].some(row=>row.includes(value)),contact)).toBe(false);
 await panel.getByRole("button",{name:"Close lookup"}).click();await expect(page.getByRole("button",{name:"Candidate lookup",exact:true})).toBeFocused();
 const candidates=page.getByRole("link",{name:"Candidates",exact:true}).first();if(!await candidates.isVisible())await page.getByRole("button",{name:"Records",exact:true}).first().click();await candidates.click();await expect(page).toHaveURL(/candidates/);await expect(panel).toBeHidden();
 await page.getByRole("button",{name:"Candidate lookup",exact:true}).click();await expect(panel).toContainText("Pat Phone");await expect(input).toBeFocused();expect(lookup.calls()).toBe(1);
});

test("lookup displays duplicate pages and no matches, stops after an error, and ignores superseded input",async({page})=>{
 const lookup=await setup(page);let release!:()=>void;const delayed=new Promise<void>(resolve=>{release=resolve;});let request=0;
 await page.route("**/rest/v1/rpc/app_candidate_contact_lookup_v2",async route=>{request++;const body=route.request().postDataJSON();if(body.p_contact==="slow@example.test"){await delayed;await route.fulfill({contentType:"application/json",body:JSON.stringify(lookup.result)});return;}if(request===1){await route.fulfill({status:500,contentType:"application/json",body:'{"message":"Fixture failure"}'});return;}await route.fulfill({contentType:"application/json",body:JSON.stringify(body.p_after_id?{items:[{...lookup.result.items[0],candidate_id:"C-DUP",name:"Duplicate candidate"}],next_cursor:null}:body.p_contact==="none@example.test"?{items:[],next_cursor:null}:{...lookup.result,next_cursor:"C-PHONE"})});});
 const panel=page.getByRole("dialog",{name:"Candidate lookup",exact:true}),input=panel.getByLabel("Find by phone digits or full email");
 await input.fill(" Lookup@Example.TEST ");await expect(panel.getByRole("alert")).toContainText("Press Enter");await page.waitForTimeout(400);expect(request).toBe(1);
 await panel.getByRole("button",{name:"Retry",exact:true}).click();await expect(panel).toContainText("Pat Phone");await panel.getByRole("button",{name:"Show more candidates"}).click();await expect(panel).toContainText("Duplicate candidate");
 const pending=page.waitForRequest(request=>request.url().includes("/app_candidate_contact_lookup_v2")&&request.postDataJSON().p_contact==="slow@example.test");
 const oldResponse=page.waitForResponse(response=>response.url().includes("/app_candidate_contact_lookup_v2")&&response.request().postDataJSON().p_contact==="slow@example.test");
 await input.fill("slow@example.test");await pending;await input.fill("none@example.test");await expect(panel).toContainText("No matching candidate found");release();await oldResponse;await expect(panel).not.toContainText("Pat Phone");
});

test("active switch refreshes automatically, filters results, pages applications and retains its setting",async({page})=>{
 const lookup=await setup(page);const requests:Array<{p_active_only:boolean;p_after_id:string|null}>=[];let appFilter:boolean|null=null;
 const paged={...lookup.result.items[0],applications:{...lookup.result.items[0].applications,next_cursor:"APP-NEXT"}},closed={...lookup.result.items[0],candidate_id:"C-CLOSED",name:"Closed fixture",applications:{items:[{...lookup.result.items[0].applications.items[0],state:"closed"}],next_cursor:null}};
 await page.route("**/rest/v1/rpc/app_candidate_contact_lookup_v2",async route=>{const body=route.request().postDataJSON();requests.push(body);await route.fulfill({contentType:"application/json",body:JSON.stringify(body.p_after_id?{items:[{...lookup.result.items[0],candidate_id:"C-ACTIVE-2",name:"Second active fixture"}],next_cursor:null}:body.p_active_only?{items:[paged],next_cursor:"C-PHONE"}:{items:[lookup.result.items[0],closed],next_cursor:null})});});
 await page.route("**/rest/v1/rpc/app_candidate_lookup_applications_v2",async route=>{appFilter=route.request().postDataJSON().p_active_only;await route.fulfill({contentType:"application/json",body:JSON.stringify({items:[{...lookup.result.items[0].applications.items[0],application_id:"APP-NEXT",group_position:"Another active role"}],next_cursor:null})});});
 const panel=page.getByRole("dialog",{name:"Candidate lookup",exact:true}),input=panel.getByLabel("Find by phone digits or full email"),filter=panel.getByRole("switch",{name:"Active candidates only"});
 await expect(filter).toHaveAttribute("aria-checked","false");await input.fill("+66 81 76");await expect(panel).toContainText("Closed fixture");expect(requests[0].p_active_only).toBe(false);
 await filter.click();await expect(filter).toHaveAttribute("aria-checked","true");await expect(panel).not.toContainText("Closed fixture");await expect(panel).toContainText("Pat Phone");expect(requests.at(-1)!.p_active_only).toBe(true);
 await panel.getByRole("button",{name:"Show more candidates"}).click();await expect(panel).toContainText("Second active fixture");expect(requests.at(-1)!.p_active_only).toBe(true);
 await panel.getByRole("button",{name:"Show more applications"}).click();await expect(panel).toContainText("Another active role");expect(appFilter).toBe(true);
 await page.getByRole("link",{name:"Workspace",exact:true}).first().click();await expect(panel).toContainText("Pat Phone");await expect(filter).toHaveAttribute("aria-checked","true");
 await panel.getByRole("button",{name:"Clear search"}).click();await expect(input).toHaveValue("");await expect(filter).toHaveAttribute("aria-checked","true");await page.waitForTimeout(400);expect(requests).toHaveLength(3);
});

test("changing active scope disregards an earlier response and repeat Enter while loading",async({page})=>{
 const lookup=await setup(page);let release!:()=>void;const delayed=new Promise<void>(resolve=>{release=resolve;});let requests=0;
 await page.route("**/rest/v1/rpc/app_candidate_contact_lookup_v2",async route=>{requests++;const active=route.request().postDataJSON().p_active_only;if(!active)await delayed;await route.fulfill({contentType:"application/json",body:JSON.stringify(active?lookup.result:{items:[{...lookup.result.items[0],name:"Stale inactive result"}],next_cursor:null})});});
 const panel=page.getByRole("dialog",{name:"Candidate lookup",exact:true}),input=panel.getByLabel("Find by phone digits or full email");
 const pending=page.waitForRequest(request=>request.url().includes("/app_candidate_contact_lookup_v2")),oldResponse=page.waitForResponse(response=>response.url().includes("/app_candidate_contact_lookup_v2")&&!response.request().postDataJSON().p_active_only);
 await input.fill("08176");await pending;await expect(input).toHaveAttribute("aria-busy","true");await input.press("Enter");expect(requests).toBe(1);await panel.getByRole("switch",{name:"Active candidates only"}).click();
 await expect(panel).toContainText("Pat Phone");release();await oldResponse;await expect(panel).not.toContainText("Stale inactive result");expect(requests).toBe(2);
});

test("rapid edits debounce to one request and incomplete email or IME composition never queries",async({page})=>{
 const lookup=await setup(page),panel=page.getByRole("dialog",{name:"Candidate lookup",exact:true}),input=panel.getByLabel("Find by phone digits or full email");
 await input.fill("08176");await input.fill("081765");await input.fill("0817654");expect(lookup.calls()).toBe(0);await expect(panel).toContainText("Pat Phone");expect(lookup.calls()).toBe(1);expect(lookup.lastContact()).toBe("0817654");
 await input.fill("partial@");await page.waitForTimeout(400);expect(lookup.calls()).toBe(1);
 await input.dispatchEvent("compositionstart");await input.fill("Lookup@Example.TEST");await page.waitForTimeout(400);expect(lookup.calls()).toBe(1);await input.dispatchEvent("compositionend");await expect(panel).toContainText("Pat Phone");expect(lookup.calls()).toBe(2);expect(lookup.lastContact()).toBe("lookup@example.test");
});

test("closing or clearing cancels pending automatic search and reopening resumes the draft",async({page})=>{
 const lookup=await setup(page),panel=page.getByRole("dialog",{name:"Candidate lookup",exact:true}),input=panel.getByLabel("Find by phone digits or full email");
 await input.fill("08176");await panel.getByRole("button",{name:"Close lookup"}).click();await expect(panel).toBeHidden();await page.waitForTimeout(400);expect(lookup.calls()).toBe(0);
 await page.getByRole("button",{name:"Candidate lookup",exact:true}).click();await expect(input).toHaveValue("08176");await expect(panel).toContainText("Pat Phone");expect(lookup.calls()).toBe(1);
 await input.fill("081765");await panel.getByRole("button",{name:"Clear search"}).click();await page.waitForTimeout(400);expect(lookup.calls()).toBe(1);await expect(input).toHaveValue("");await expect(input).toBeFocused();
});

test("Enter searches immediately without a second automatic request",async({page})=>{
 const lookup=await setup(page),panel=page.getByRole("dialog",{name:"Candidate lookup",exact:true}),input=panel.getByLabel("Find by phone digits or full email");
 await input.fill("08176");await input.press("Enter");await expect(panel).toContainText("Pat Phone");await page.waitForTimeout(400);expect(lookup.calls()).toBe(1);
});

test.describe("phone lookup",()=>{
test.use({hasTouch:true});
test("Thai phone lookup fits idle and results, contains keyboard focus and restores the launcher",async({page},testInfo)=>{
 await page.setViewportSize({width:360,height:800});await setup(page,"th");const panel=page.getByRole("dialog",{name:"ค้นหาผู้สมัคร",exact:true}),input=panel.getByLabel("ค้นหาด้วยเบอร์โทรบางส่วนหรืออีเมลแบบเต็ม");
 await expect(panel).not.toHaveAttribute("aria-modal","true");await expect(input).not.toBeFocused();expect((await input.boundingBox())!.height).toBe(44);
 await panel.getByRole("button",{name:"เกี่ยวกับการค้นหาผู้สมัคร"}).tap();await expect(page.getByRole("tooltip")).toContainText("เบอร์โทรอย่างน้อย 4 หลักติดต่อกัน");await page.keyboard.press("Escape");await expect(panel).toBeVisible();
 await panel.getByRole("switch",{name:"เฉพาะผู้สมัครที่กำลังดำเนินการ"}).focus();await page.keyboard.press("Space");await expect(panel.getByRole("switch")).toHaveAttribute("aria-checked","true");
 await panel.locator("[data-lookup-illustration] img").evaluate(image=>(image as HTMLImageElement).decode());await page.screenshot({path:testInfo.outputPath("lookup-idle-phone.png")});
 await input.fill(contact);await expect(panel).toContainText("Pat Phone");await expect(panel).toContainText("คัดกรองโทรศัพท์");await expect(panel).toHaveAttribute("aria-modal","true");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.getByRole("button",{name:"ดูประวัติผู้สมัคร",exact:true}).focus();await page.keyboard.press("Tab");await expect(panel.getByRole("button",{name:"ปิดหน้าต่างค้นหา"})).toBeFocused();await page.keyboard.press("Shift+Tab");await expect(panel.getByRole("button",{name:"ดูประวัติผู้สมัคร",exact:true})).toBeFocused();
 await page.screenshot({path:testInfo.outputPath("lookup-phone.png")});await page.setViewportSize({width:390,height:800});const bounds=await panel.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);await expect(input).toBeInViewport();
 await page.keyboard.press("Escape");await expect(panel).toBeHidden();await expect(page.getByRole("button",{name:"ค้นหาผู้สมัคร",exact:true})).toBeFocused();
});
});
