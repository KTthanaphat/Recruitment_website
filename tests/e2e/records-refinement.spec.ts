import fs from "node:fs";
import {expect,test} from "@playwright/test";
import {installMockSupabase,expectWorkspaceReady} from "./support/mock-supabase";

test("Records show fitted complete rows and compact pager at the agreed desktop viewport",async({page},testInfo)=>{
 test.setTimeout(90000);
 const measurements:unknown[]=[];
 const mock=await installMockSupabase(page,{role:"system_admin"});
 const d=mock.data;
 for(let i=0;i<25;i++){
  const id="DENSE-"+String(i).padStart(3,"0"),app="90000000-0000-4000-8000-"+String(i).padStart(12,"0");
  d.requisitions.push({...d.requisitions[0],doc_id:id,position:"วิศวกร Engineer with a deliberately long position name",head_count:100});
  d.position_groups.push({...d.position_groups[0],group_id:id,group_position:"วิศวกร Engineer with a deliberately long position name"});
  d.document_groups.push({...d.document_groups[0],doc_group_id:id,doc_id:id,group_id:id});
  d.candidates.push({...d.candidates[0],candidate_id:id,name:"ผู้สมัคร Candidate with a deliberately long name",group_id:id,doc_group_id:id});
  d.candidate_applications!.push({...d.candidate_applications![0],application_id:app,candidate_id:id,group_id:id,state:"active"});
  d.recruitment_logs.push({...d.recruitment_logs[0],log_id:9000+i,candidate_id:id,application_id:app});
  d.offers.push({...d.offers[0],offer_id:9000+i,candidate_id:id,application_id:app,doc_id:id});
  d.change_logs.push({...d.change_logs[0],log_id:9000+i,entity_id:id,changed_by_email:"recruiter.with.a.long.name@example.com"});
 }
 await page.setViewportSize({width:1366,height:768});
 for(const route of ["/requisitions?reqSize=100&reqPage=4","/candidates","/offers","/pipeline?pipelineView=table","/audit","/sourcing","/sourcing?qaHistory=1"]){
  await page.goto(route);await expectWorkspaceReady(page);
  if(route.startsWith("/pipeline")&&!await page.locator("[data-record-pagination]").count()) await page.getByRole("button",{name:"Table",exact:true}).click();
  if(route.includes("qaHistory"))await page.getByRole("button",{name:"Lifecycle history",exact:true}).click();
  const pager=page.locator("[data-record-pagination]");await expect(pager).toBeVisible();
  await expect(pager).toContainText(/1\/\d/);
  const records=page.locator(".records-surface tbody tr").filter({has:page.locator("td")});
  const audit=page.locator(".records-audit-row");
  const rows=route==="/audit"?audit:records;
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(350);
  const fittedSize=Number(await pager.getAttribute("data-record-page-size"));
  await expect(rows).toHaveCount(fittedSize);
  const bounds=await page.evaluate(()=>({pager:document.querySelector("[data-record-pagination]")!.getBoundingClientRect().bottom,height:window.innerHeight,scroll:document.documentElement.scrollHeight}));
  expect(bounds.pager,route).toBeLessThanOrEqual(bounds.height);
  const heights=await rows.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));
  for(const height of heights)expect(height,route+" row height").toBeCloseTo(48,0);
  const gaps=await rows.evaluateAll(nodes=>nodes.slice(1).map((node,i)=>node.getBoundingClientRect().top-nodes[i].getBoundingClientRect().bottom)); for(const gap of gaps)expect(gap,route+" row gap").toBeCloseTo(0,0); measurements.push({route,...bounds,rowHeights:heights,gaps});
  await expect(page.getByLabel("Rows per page",{exact:true})).toHaveCount(0);
  await pager.getByRole("button",{name:"Next page",exact:true}).click();
  await expect(pager).toContainText(/2\/\d/);
  await pager.getByRole("button",{name:"Previous page",exact:true}).click();
  await expect(pager).toContainText(/1\/\d/);
  for(const width of [360,390]) {await page.setViewportSize({width,height:780});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+" phone").toBeTruthy();}
  await page.setViewportSize({width:1366,height:768});
  await page.screenshot({path:testInfo.outputPath("records-"+(route.includes("qaHistory")?"sourcing-history":route.split("?")[0].slice(1))+".png"),fullPage:true});
 }
 fs.writeFileSync(testInfo.outputPath("records-refinement-metrics.json"),JSON.stringify(measurements,null,2));
 expect(mock.rpcCalls.filter(c=>c.endpoint==="app_recruitment_list_v1"&&["requisitions","candidate_registry","offers","pipeline_history","audit_log","sourcing_records"].includes(String(c.payload.p_entity))).every(c=>Number(c.payload.p_limit)>=1&&Number(c.payload.p_limit)<=100)).toBeTruthy();
});
test("Candidates empty search, count retry and phone controls",async({page})=>{
 await installMockSupabase(page,{countFailureOnceEntity:"candidate_registry"});
 await page.goto("/candidates");await expectWorkspaceReady(page);
 const pager=page.locator("[data-record-pagination]");
 await expect(pager).toContainText("1/—");await pager.getByRole("button",{name:"Retry record count"}).click();
 await expect(pager).toContainText(/1\/\d/);
 await page.getByRole("searchbox").fill("no-such-candidate-ever");
 await expect(pager).toContainText("0/0");
 await expect(pager.getByRole("button",{name:"Next page",exact:true})).toBeDisabled();
 await page.getByRole("searchbox").fill("");
 for(const width of [360,390]){await page.setViewportSize({width,height:780});await expect(pager).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();}
});
test("Details retain selected application outline with flat sections and timeline",async({page})=>{
 await installMockSupabase(page,{role:"system_admin"});await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);
 await expect(page.getByRole("tabpanel")).toHaveCSS("border-top-width","1px");
 const profile=page.getByRole("region",{name:"Candidate profile",exact:true});await expect(profile).toHaveCSS("border-top-width","1px");
 await expect(page.locator(".activity-timeline").first()).toBeVisible();
 for(const entry of await page.locator(".activity-entry").all())await expect(entry).toHaveCSS("border-top-width","0px");
 await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");await expectWorkspaceReady(page);await expect(page.locator(".requisition-overview-metrics>div")).toHaveCount(4);
});

test("Unresolved counts, partial last pages and filter reset retain cursor navigation",async({page})=>{
 const mock=await installMockSupabase(page,{countDelayMs:1200});
 const template=mock.data.candidates[0];mock.data.candidates=[];
 for(let i=0;i<23;i++)mock.data.candidates.push({...template,candidate_id:"PAGE-"+String(i).padStart(3,"0"),name:"Paging Candidate "+i});
 await page.goto("/candidates");await expectWorkspaceReady(page);
 const pager=page.locator("[data-record-pagination]");
 await expect(pager).toContainText("1/…"); await page.waitForTimeout(500);
 const size=Number(await pager.getAttribute("data-record-page-size")), pages=Math.ceil(23/size);
 await expect(pager).toContainText(`1/${pages}`);
 for(let current=2;current<=pages;current++){await pager.getByRole("button",{name:"Next page",exact:true}).click();await expect(pager).toContainText(`${current}/${pages}`);}


 await expect(page.locator("tbody tr")).toHaveCount(23-(pages-1)*size);await expect(pager.getByRole("button",{name:"Next page",exact:true})).toBeDisabled();
 await page.getByRole("searchbox").fill("PAGE-000");await expect(pager).toContainText("1/1");
});
test("An empty continuation after concurrent deletion automatically recovers",async({page})=>{
 const mock=await installMockSupabase(page,{emptyContinuationOnceEntity:"candidate_registry"}),template=mock.data.candidates[0];
 for(let i=0;i<23;i++)mock.data.candidates.push({...template,candidate_id:"RECOVER-"+i,name:"Recovery "+i});
 await page.goto("/candidates");await expectWorkspaceReady(page);
 const pager=page.locator("[data-record-pagination]");await expect(pager).toContainText(/1\/\d/);
 await pager.getByRole("button",{name:"Next page",exact:true}).click();
 await expect.poll(()=>mock.rpcCalls.filter(c=>c.endpoint==="app_recruitment_list_v1"&&c.payload.p_entity==="candidate_registry").length).toBeGreaterThanOrEqual(2);
 await expect(pager).toContainText(/1\/\d/);await expect(page.locator("tbody tr")).toHaveCount(Number(await pager.getAttribute("data-record-page-size")));
});

test("Advanced filters belong to headings and phone card fields stay unboxed",async({page})=>{
 test.setTimeout(90000);await installMockSupabase(page,{role:"system_admin"});
 for(const route of ["/requisitions","/offers","/pipeline?pipelineView=table","/candidates","/audit","/sourcing"]){
 await page.setViewportSize({width:1366,height:768});await page.goto(route);await expectWorkspaceReady(page);
 if(route==="/sourcing")await page.getByRole("button",{name:"Lifecycle history",exact:true}).click();
 const button=page.getByRole("button",{name:"Advanced Filters",exact:true});await button.click();await expect(button).toHaveAttribute("aria-expanded","true");
 const target=page.locator("#"+await button.getAttribute("aria-controls"));await expect(target).toBeVisible();
 await expect(target).toHaveClass(/records-filter-sidebar/);
 await page.screenshot({path:"outputs/header-filter-"+route.split("?")[0].slice(1)+".png",fullPage:true});
 if(route==="/audit"){await page.setViewportSize({width:390,height:780});await expect(page.locator("[data-desktop-required]")).toBeVisible();continue;}
 for(const width of [390,360]){await page.setViewportSize({width,height:780});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await expect(target).toBeVisible();}
 await button.click();await expect(button).toHaveAttribute("aria-expanded","false");
 }
});
test("Requisition applied filters stay selected when closed",async({page})=>{
 const mock=await installMockSupabase(page);await page.goto("/requisitions?reqSize=10&reqPage=3&reqSort=position&reqDir=asc&site=HQ");await expectWorkspaceReady(page);
 await expect(page).toHaveURL(/reqSize=7/);await expect(page).toHaveURL(/reqSort=position/);
 const toggle=page.getByRole("button",{name:"Advanced Filters",exact:true});await toggle.click();
 const panel=page.locator("#records-requisition-filters");await panel.getByLabel("Filter Owner",{exact:true}).fill("Alice");await panel.getByRole("button",{name:"Apply filter",exact:true}).click();
 await expect.poll(()=>mock.rpcCalls.filter(c=>c.endpoint==="app_recruitment_list_v1"&&c.payload.p_entity==="requisitions").at(-1)?.payload.p_filters).toMatchObject({owner:"Alice"});
 await toggle.click();await expect(toggle).toHaveAttribute("data-filters-active","true");await toggle.click();await expect(panel.getByLabel("Filter Owner",{exact:true})).toHaveValue("Alice");
});

test("Category filter opens within the phone viewport and retains selection",async({page})=>{
 await installMockSupabase(page);await page.setViewportSize({width:360,height:780});await page.goto("/requisitions");await expectWorkspaceReady(page);
 await page.getByRole("button",{name:"Advanced Filters",exact:true}).click();
 const panel=page.locator("[data-record-filter-panel]"),status=panel.getByLabel("Filter Status",{exact:true});
 await status.click();
 const menu=page.locator("[data-category-menu]");await expect(menu).toBeVisible();
 const box=await menu.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(360);expect(box!.y+box!.height).toBeLessThanOrEqual(780);
 await menu.getByRole("checkbox",{name:"Ongoing",exact:true}).check();await status.click();
 await expect(status).toContainText("1 selected");
 const request=panel.getByLabel(/Filter Request Type/i);await request.scrollIntoViewIfNeeded();await request.evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().bottom-(innerHeight-20)));await request.click();
 const bottomMenu=page.locator("[data-category-menu]");const bounds=await bottomMenu.boundingBox();expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(780);
 await request.press("Escape");await expect(panel.locator("details[open]")).toHaveCount(0);
});
