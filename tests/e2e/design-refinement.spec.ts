
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test.setTimeout(60_000);
const widths = [360,390,768,1024,1280,1920];
const labels = {
  en: {cards:"Cards",table:"Table",accept:"Accept: Started work",reject:"Reject: Did not start"},
  th: {cards:"การ์ด",table:"ตาราง",accept:"ยอมรับ: เริ่มงานแล้ว",reject:"ปฏิเสธ: ไม่ได้เริ่มงาน"}
};
function hold() { let release!:()=>void; const pending=new Promise<void>(resolve=>{release=resolve;});return {pending,release}; }
async function home(page:Page, language="en") {
  await page.goto("/home?lang="+language);await expectWorkspaceReady(page);
  const welcome=page.getByRole("dialog",{name:/Welcome back|ยินดีต้อนรับกลับ/});
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button",{name:/^(Close|ปิด)$/}).last().click();
  await page.locator("#home-record-tab-start_confirmation").click();
}
async function candidate(page:Page, mock:Awaited<ReturnType<typeof installMockSupabase>>, language="en") {
  const app=mock.data.candidate_applications!.find(row=>row.candidate_id==="C-OFFER-PASS")!;
  await page.goto("/candidates?lang="+language+"&detailType=candidate&detailId=C-OFFER-PASS&applicationId="+app.application_id);
  await expectWorkspaceReady(page);
  return page.getByRole("dialog").first();
}
const attendanceForm=(page:Page)=>page.getByRole("dialog").filter({has:page.locator('[name="start_confirmation"]')});

for(const language of ["en","th"] as const) test("Compact group cards match responsive structure in "+language,async({page})=>{
  const mock=await installMockSupabase(page,{role:"admin_recruiter",language});
  mock.data.position_groups.find(row=>row.group_id==="GRP-ENG")!.group_position="Engineering and International Production Operations Management";
  const linked=mock.data.requisitions.find(row=>row.doc_id==="REQ-HQ-2")!;
  linked.site="KT2";linked.person_in_charge="Nina International Recruitment Coordination";
  await page.goto("/workspace?lang="+language);await expectWorkspaceReady(page);
  const search=page.getByRole("searchbox");
  await page.getByRole("button",{name:labels[language].cards,exact:true}).click();
  const cards=page.locator("[data-workspace-group-card]");
  await expect(cards).toHaveCount(5);
  const engineer=cards.filter({hasText:"GRP-ENG"});
  await expect(engineer.locator("[data-tag-appearance=soft]")).toHaveCount(3);
  await expect(engineer).toContainText("HQ, KT2");
  await expect(engineer).toContainText("Nina International Recruitment Coordination");
  await expect(cards.locator("dl,dt")).toHaveCount(0);
  await expect(cards.getByTestId("linked-requisition-preview")).toHaveCount(0);
  const order=await cards.getByRole("button").allTextContents();
  for(const width of widths) {
    await page.setViewportSize({width,height:width===1920?1080:900});
    await expect.poll(()=>cards.first().evaluate(node=>getComputedStyle(node.parentElement!).gridTemplateColumns.split(" ").length)).toBe(width>=1280?3:width>=768?2:1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    for(const card of await cards.all()) {
      const box=await card.boundingBox();
      expect(box!.width).toBeGreaterThan(150);
      expect(await card.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    }
    if(width===1920||width===390) {
      fs.mkdirSync("outputs/design-refinement",{recursive:true});
      await page.screenshot({path:"outputs/design-refinement/cards-"+language+"-"+width+".png",fullPage:true});
    }
  }
  await page.getByRole("button",{name:labels[language].table,exact:true}).click();
  await expect(page.getByRole("columnheader",{name:/Linked requisitions|คำขอที่เชื่อมโยง/})).toBeVisible();
  await page.getByRole("button",{name:labels[language].cards,exact:true}).click();
  expect(await cards.getByRole("button").allTextContents()).toEqual(order);
  await search.fill("GRP-ENG");await expect(cards).toHaveCount(1);
  await page.reload();await expectWorkspaceReady(page);
  await expect(page.getByRole("button",{name:labels[language].cards,exact:true})).toHaveAttribute("aria-pressed","true");
});

test("Group card skeleton has three identity-and-tags placeholders and reduced motion",async({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter"});
  await page.setViewportSize({width:1920,height:1080});
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.addInitScript(()=>localStorage.setItem("recruitment:workspace:view:qa-admin","cards"));
  const gate=hold();
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1",async route=>{
    if(route.request().postDataJSON().p_entity==="position_groups")await gate.pending;await route.fallback();
  });
  await page.goto("/workspace?lang=en");await expectWorkspaceReady(page);
  const region=page.locator("[data-loading-skeleton=group-cards]");
  await expect(region).toBeVisible();await expect(region.locator(".ats-skeleton-row")).toHaveCount(3);
  for(const card of await region.locator(".ats-skeleton-row").all()){
    await expect(card.locator(".ats-skeleton")).toHaveCount(5);
    await expect(card.locator("button,a,dl")).toHaveCount(0);
  }
  expect(await region.locator(".ats-skeleton").first().evaluate(node=>getComputedStyle(node).animationName)).toBe("none");
  await page.screenshot({path:"outputs/design-refinement/group-skeleton.png",fullPage:true});
  gate.release();await expect(region).toHaveCount(0);await expect(page.locator("[data-workspace-group-card]")).toHaveCount(5);
});

test("Four metric loading cards retain labels and numeric shapes",async({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter"});
  const gate=hold();
  await page.route("**/rest/v1/rpc/app_home_welcome_summary_v1",async route=>{await gate.pending;await route.fallback();});
  await page.goto("/home?lang=en");await expectWorkspaceReady(page);
  const skeleton=page.getByRole("dialog",{name:"Welcome back"}).locator("[data-loading-skeleton=metrics]");
  await expect(skeleton).toBeVisible();await expect(skeleton.locator(".ats-skeleton-row")).toHaveCount(4);
  for(const card of await skeleton.locator(".ats-skeleton-row").all()) {
    expect((await card.innerText()).trim().length).toBeGreaterThan(0);
    expect(await card.innerText()).not.toMatch(/\b0\b/);
    await expect(card.locator(".ats-skeleton")).toHaveCount(2);
  }
  gate.release();await expect(skeleton).toHaveCount(0);
});

test("New hire loading keeps six columns and two action placeholders in every row",async({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter"});
  const gate=hold();
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1",async route=>{
    const body=route.request().postDataJSON();
    if(body.p_entity==="offers"&&body.p_filters?.homeTab==="start_confirmation")await gate.pending;
    await route.fallback();
  });
  await home(page);
  const skeleton=page.locator("[data-home-record-list] [data-loading-skeleton=table]");
  await expect(skeleton).toBeVisible();await expect(skeleton.locator(".ats-skeleton-row")).toHaveCount(3);
  await expect(skeleton.locator("[data-skeleton-actions]")).toHaveCount(3);
  await expect(skeleton.locator(".ats-attendance-placeholder")).toHaveCount(6);
  for(const row of await skeleton.locator(".ats-skeleton-row").all())await expect(row.locator(":scope > div")).toHaveCount(6);
  gate.release();await expect(page.getByRole("button",{name:labels.en.accept,exact:true})).toBeVisible();
});

for(const surface of ["candidate","home"] as const) for(const outcome of ["started","did_not_start"] as const) test(surface+" icon reviews and saves "+outcome+" without changing offer acceptance",async({page})=>{
  const mock=await installMockSupabase(page,{role:"admin_recruiter"});
  const offer=mock.data.offers.find(row=>row.candidate_id==="C-OFFER-PASS")!;
  const accepted=offer.accepted_date,start=offer.first_working_date;
  if(surface==="home")await home(page);else await candidate(page,mock);
  const label=outcome==="started"?labels.en.accept:labels.en.reject;
  const action=page.getByRole("button",{name:label,exact:true});
  await expect(action).toBeVisible();await expect(action).not.toHaveText(/Accept|Reject/);
  expect(await action.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe(outcome==="started"?"rgb(232, 245, 236)":"rgb(252, 236, 239)");
  expect(await action.evaluate(node=>getComputedStyle(node).color)).toBe(outcome==="started"?"rgb(22, 122, 61)":"rgb(197, 43, 64)");
  await action.focus();await expect(page.getByRole("tooltip")).toContainText(/review before saving/);
  await action.press("Escape");await expect(page.getByRole("tooltip")).toHaveCount(0);
  await action.press("Enter");
  const form=attendanceForm(page);await expect(form).toBeVisible();
  await expect(form.locator('[name="start_confirmation"]')).toHaveValue(outcome);
  expect(mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1")).toHaveLength(0);
  if(outcome==="did_not_start"){
    await expect(form.locator('[name="reason"]')).toHaveAttribute("required","");
    await form.getByRole("button",{name:"Review changes",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"Confirm Save",exact:true})).toHaveCount(0);
    await form.locator('[name="reason"]').fill("Did not attend the agreed first working day");
  }
  await form.getByRole("button",{name:"Review changes",exact:true}).click();
  const review=page.getByRole("dialog",{name:"Confirm Save",exact:true});await expect(review).toBeVisible();
  expect(mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1")).toHaveLength(0);
  await review.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(review).toBeHidden();
  await expect.poll(()=>mock.data.offers.find(row=>row.offer_id===offer.offer_id)!.start_confirmation).toBe(outcome);
  expect(offer.accepted_date).toBe(accepted);expect(offer.first_working_date).toBe(start);
  const write=mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1");expect(write).toHaveLength(1);
  expect(write[0].payload).toMatchObject({offer_id:offer.offer_id,start_confirmation:outcome,expected_updated_at:expect.any(String)});
  if(surface==="home")await expect(page.getByRole("button",{name:labels.en.accept,exact:true})).toHaveCount(0);
});

test("Home attendance failure preserves reason and blocks duplicate saves",async({page})=>{
  const mock=await installMockSupabase(page,{role:"admin_recruiter"});
  let attempts=0;const gate=hold();
  await page.route("**/rest/v1/rpc/app_confirm_offer_start_v1",async route=>{
    attempts++;if(attempts===1){await gate.pending;await route.fulfill({status:500,json:{message:"Attendance write unavailable"}});return;}await route.fallback();
  });
  await home(page);
  await page.getByRole("button",{name:labels.en.reject,exact:true}).evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click();});
  const form=attendanceForm(page);await expect(form).toHaveCount(1);
  await form.locator('[name="reason"]').fill("Keep this reason after failure");
  await form.getByRole("button",{name:"Review changes",exact:true}).click();
  const review=page.getByRole("dialog",{name:"Confirm Save",exact:true});
  await review.getByRole("button",{name:"Save changes",exact:true}).evaluate(node=>{(node as HTMLButtonElement).click();(node as HTMLButtonElement).click();});
  await expect.poll(()=>attempts).toBe(1);gate.release();
  await expect(page.getByText("Attendance write unavailable",{exact:false})).toBeVisible();
  await page.getByRole("button",{name:/review and edit/i}).click();
  await expect(form.locator('[name="reason"]')).toHaveValue("Keep this reason after failure");
  expect(mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1")).toHaveLength(0);
  await form.getByRole("button",{name:"Review changes",exact:true}).click();
  await review.getByRole("button",{name:"Save changes",exact:true}).click();
  await expect(review).toBeHidden();
  expect(attempts).toBe(2);
  expect(mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1")).toHaveLength(1);
  expect(mock.data.offers.find(row=>row.candidate_id==="C-OFFER-PASS")!.start_confirmation_reason).toBe("Keep this reason after failure");
});

for(const language of ["en","th"] as const) test("Attendance icons fit phone and desktop and localize in "+language,async({page})=>{
  const mock=await installMockSupabase(page,{role:"admin_recruiter",language});
  const drawer=await candidate(page,mock,language);
  for(const width of widths){
    await page.setViewportSize({width,height:width===1920?1080:844});
    const action=drawer.getByRole("button",{name:labels[language].accept,exact:true});
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    const a=await action.boundingBox(),b=await drawer.getByRole("button",{name:labels[language].reject,exact:true}).boundingBox();
    expect(a!.height).toBeGreaterThanOrEqual(width<640?44:36);
    expect(Math.abs(a!.y-b!.y)).toBeLessThan(1);
    expect(b!.x+b!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    await action.evaluate(node=>(node as HTMLButtonElement).blur());await action.focus();await expect(page.getByRole("tooltip")).toBeVisible();
    const tip=await page.getByRole("tooltip").boundingBox();expect(tip!.x).toBeGreaterThanOrEqual(0);expect(tip!.x+tip!.width).toBeLessThanOrEqual(width);
    await action.press("Escape");
    if(width===390||width===1920)await page.screenshot({path:"outputs/design-refinement/attendance-"+language+"-"+width+".png"});
  }
});

test("Attendance eligibility preserves future-start and admin correction rules",async({page})=>{
  const mock=await installMockSupabase(page,{role:"admin_recruiter"});
  const offer=mock.data.offers.find(row=>row.candidate_id==="C-OFFER-PASS")!;
  offer.first_working_date="2099-12-31";
  await candidate(page,mock);await expect(page.locator("[data-attendance-actions]")).toHaveCount(0);
  offer.first_working_date="2026-07-20";offer.start_confirmation="started";
  await page.reload();await expectWorkspaceReady(page);
  await expect(page.getByRole("button",{name:labels.en.reject,exact:true})).toBeVisible();
});

test("Performance aggregate skeleton uses the actual four metric cards and chart frames",async({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter"});
  const gate=hold();
  await page.route("**/rest/v1/rpc/app_dashboard_performance_summary_v1",async route=>{await gate.pending;await route.fallback();});
  await page.goto("/dashboard?lang=en&dashboardTab=performance&performanceSubview=overview&dashboardPeriod=ytd&dashboardMonth=2026-07");
  await expectWorkspaceReady(page);
  const region=page.locator("[data-performance-skeleton]");
  await expect(region).toBeVisible();await expect(region.locator("[data-metric-placeholder]")).toHaveCount(4);
  await expect(region.locator("[data-loading-skeleton=chart]")).toHaveCount(3);
  await expect(region.getByRole("heading",{name:"Total Vacancies",exact:true})).toBeVisible();
  await expect(region.locator("button,input,a")).toHaveCount(0);
  await page.screenshot({path:"outputs/design-refinement/performance-skeleton.png",fullPage:true});
  gate.release();await expect(region).toHaveCount(0);
});
for(const entry of [
  {rpc:"app_dashboard_rejection_page_v1",columns:9,url:"/dashboard?lang=en&dashboardTab=pipeline&pipelineSubview=rejections&dashboardPeriod=pim&dashboardMonth=2026-07"},
  {rpc:"app_dashboard_bottleneck_queue_v1",columns:8,url:"/dashboard?lang=en&dashboardTab=pipeline&pipelineSubview=bottlenecks&dashboardPeriod=pim&dashboardMonth=2026-07"},
  {rpc:"app_dashboard_risk_page_v1",columns:7,url:"/dashboard?lang=en&dashboardTab=vacancy&vacancySubview=risk&dashboardPeriod=pim&dashboardMonth=2026-07&riskFilter=all"},
  {rpc:"app_dashboard_active_requisitions_page_v1",columns:21,url:"/dashboard?lang=en&dashboardTab=vacancy&vacancySubview=waterfall&dashboardPeriod=pim&dashboardMonth=2026-07"}
]) test("Report loading aligns native headers and three rows for "+entry.rpc,async({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter"});
  const gate=hold();
  await page.route("**/rest/v1/rpc/"+entry.rpc,async route=>{await gate.pending;await route.fallback();});
  await page.goto(entry.url);await expectWorkspaceReady(page);
  const row=page.locator("table tr[data-loading-skeleton=table]").first();
  await expect(row).toBeVisible();
  const table=row.locator("xpath=ancestor::table");
  const headers=table.locator("thead th");
  if(entry.rpc==="app_dashboard_active_requisitions_page_v1"){
    expect(await headers.count()).toBeGreaterThan(15);
    await expect(row.locator("td")).toHaveCount(await headers.count());
  }else {
    await expect(headers).toHaveCount(entry.columns);
    await expect(row.locator("td")).toHaveCount(entry.columns);
  }
  await expect(table.locator("tbody tr.ats-skeleton-row")).toHaveCount(3);
  await expect(table.locator("tbody button,tbody input,tbody a")).toHaveCount(0);
  gate.release();await expect(row).toHaveCount(0);
});

test("Read-only users receive no attendance write controls",async({page})=>{
  const mock=await installMockSupabase(page,{role:"viewer"});
  await page.goto("/home?lang=en");await expectWorkspaceReady(page);
  await expect(page.locator("#home-record-tab-start_confirmation")).toHaveCount(0);
  await candidate(page,mock);await expect(page.locator("[data-attendance-actions]")).toHaveCount(0);
});
test("Empty group searches have a confirmed empty state rather than loading cards",async({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter"});
  await page.goto("/workspace?lang=en");await expectWorkspaceReady(page);
  await page.getByRole("button",{name:"Cards",exact:true}).click();
  await expect(page.locator("[data-workspace-group-card]")).toHaveCount(5);
  await page.getByRole("searchbox").fill("NONEXISTENT-GROUP-REFINEMENT");
  await expect(page.locator("[data-workspace-group-card]")).toHaveCount(0);
  await expect(page.locator("[data-loading-skeleton=group-cards]")).toHaveCount(0);
  await expect(page.getByText("No matching workspaces.",{exact:true})).toBeVisible();
});
test.describe("Coarse pointer attendance targets",()=>{
  test.use({hasTouch:true});
  test("desktop-width touch controls remain at least 44 pixels",async({page})=>{
    const mock=await installMockSupabase(page,{role:"admin_recruiter"});
    await page.setViewportSize({width:1280,height:900});await candidate(page,mock);
    expect(await page.evaluate(()=>matchMedia("(pointer: coarse)").matches)).toBe(true);
    const action=page.getByRole("button",{name:labels.en.accept,exact:true});await action.scrollIntoViewIfNeeded();
    const box=await action.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44);
  });
});

for(const language of ["en","th"] as const) test("Home attendance icons preserve their action column across widths in "+language,async({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter",language});
  await home(page,language);
  const actions=page.locator("[data-home-record-list] [data-attendance-actions]");
  await expect(actions).toHaveCount(1);
  for(const width of widths){
    await page.setViewportSize({width,height:width===1920?1080:844});await actions.scrollIntoViewIfNeeded();
    const a=actions.getByRole("button",{name:labels[language].accept,exact:true});
    const b=actions.getByRole("button",{name:labels[language].reject,exact:true});
    await expect(a).toBeVisible();await expect(b).toBeVisible();
    const ab=await a.boundingBox(),bb=await b.boundingBox();
    expect(Math.abs(ab!.y-bb!.y)).toBeLessThan(1);expect(bb!.x+bb!.width).toBeLessThanOrEqual(width);
    expect(ab!.height).toBeGreaterThanOrEqual(width<640?44:36);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    if(width===390||width===1920)await page.screenshot({path:"outputs/design-refinement/home-attendance-"+language+"-"+width+".png"});
  }
});
test("Group cards retain localized missing site and owner values",async({page})=>{
  const mock=await installMockSupabase(page,{role:"admin_recruiter"});
  for(const req of mock.data.requisitions.filter(row=>["REQ-HQ-1","REQ-HQ-2"].includes(row.doc_id))){req.site="";req.person_in_charge="";}
  await page.goto("/workspace?lang=en");await expectWorkspaceReady(page);
  await page.getByRole("button",{name:"Cards",exact:true}).click();
  const card=page.locator("[data-workspace-group-card]").filter({hasText:"GRP-ENG"});
  await expect(card).toBeVisible();await expect(card.locator("[data-tag-appearance=soft]")).toHaveCount(3);
  await expect(card.getByText("—",{exact:true})).toBeVisible();await expect(card.getByText("Unassigned",{exact:true})).toBeVisible();
});
