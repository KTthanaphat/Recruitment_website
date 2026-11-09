import { expect, test, type Page } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

async function confirm(page: Page) {
  const confirmation=page.getByRole("dialog",{name:"Confirm Save"});
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button",{name:"Save changes"}).click();
  await expect(confirmation).toBeHidden();
}

test("candidate registry searches and scopes through the bounded database list",async({page})=>{
 const mock=await installMockSupabase(page);
 await page.goto("/candidates");await expectWorkspaceReady(page);
 await expect.poll(()=>mock.rpcCalls.some(row=>row.endpoint==="app_recruitment_list_v1")).toBe(true);
 await page.getByRole("searchbox",{name:/Search name, ID/}).fill("Hana");
 await expect(page.getByRole("button",{name:/Hana HR/})).toBeVisible();
 await expect.poll(()=>mock.rpcCalls.filter(row=>row.endpoint==="app_recruitment_list_v1").at(-1)?.payload.p_search).toBe("Hana");
 await page.getByRole("button",{name:"Advanced Filters",exact:true}).click();
 await page.getByRole("button",{name:"Talent pool",exact:true}).click();
 await expect.poll(()=>{const last=mock.rpcCalls.filter(row=>row.endpoint==="app_recruitment_list_v1").at(-1);return last?.payload.p_search==="Hana"&&(last.payload.p_filters as {scope?:string}).scope==="pool";}).toBe(true);
 const request=mock.rpcCalls.filter(row=>row.endpoint==="app_recruitment_list_v1").at(-1)!;
 expect(request.payload).toMatchObject({p_entity:"candidate_registry",p_search:"Hana",p_sort:"updated_at",p_direction:"desc",p_limit:7});
});

test("header owner choices come from the authorized database option RPC",async({page})=>{
 const mock=await installMockSupabase(page);
 const owner=mock.data.requisitions.map(row=>row.person_in_charge?.trim()).find(Boolean)!;
 await page.goto("/candidates");await expectWorkspaceReady(page);
 await expect.poll(()=>mock.rpcCalls.some(call=>call.endpoint==="app_dashboard_filter_options_v1")).toBe(true);
 const header=page.locator("[data-app-header-actions]");
 await header.getByRole("button",{name:"Person in Charge"}).click();
 await expect(page.getByRole("option",{name:owner,exact:true})).toBeVisible();
});

test("sourcing list count failure keeps the page and offers a separate retry",async({page})=>{
 const mock=await installMockSupabase(page,{countFailureOnceEntity:"sourcing_records"});
 await page.goto("/sourcing");await expectWorkspaceReady(page);
 await expect.poll(()=>mock.rpcCalls.some(call=>call.endpoint==="app_recruitment_list_v1"&&call.payload.p_entity==="sourcing_records")).toBe(true);
 await expect.poll(()=>mock.rpcCalls.some(call=>call.endpoint==="app_recruitment_list_count_v1"&&call.payload.p_entity==="sourcing_records")).toBe(true);
 await expect(page.getByRole("button",{name:"Retry record count",exact:true})).toBeVisible();
 await expect(page.locator("[data-record-pagination]")).toContainText("1/—");
 await page.getByRole("button",{name:"Retry record count",exact:true}).click();
 await expect.poll(()=>mock.rpcCalls.filter(call=>call.endpoint==="app_recruitment_list_count_v1"&&call.payload.p_entity==="sourcing_records").length).toBeGreaterThan(1);
 await expect(page.locator("[data-record-pagination]")).toContainText(/1\/\d+/);
});

test("empty continuation after concurrent deletion can recover to the first page",async({page})=>{
 const mock=await installMockSupabase(page,{emptyContinuationOnceEntity:"candidate_registry"}),template=mock.data.candidates[0];
 for(let i=0;i<60;i++)mock.data.candidates.push({...template,candidate_id:`CAN-EMPTY-${String(i).padStart(3,"0")}`,name:`Empty Continuation ${String(i).padStart(3,"0")}`,nickname:null,created_at:"2026-10-31T00:00:00.000Z",updated_at:"2026-10-31T00:00:00.000Z"});
 await page.goto("/candidates");await expectWorkspaceReady(page);
 await expect(page.getByRole("button",{name:"Next page"})).toBeEnabled();
 await page.getByRole("button",{name:"Next page"}).click();
 await expect(page.locator("[data-record-pagination]")).toContainText(/1\/\d+/);
 await expect(page.getByRole("button",{name:/Empty Continuation 000/})).toBeVisible();
});

test("candidate registry renders page rows before its separate exact count resolves",async({page})=>{
 const mock=await installMockSupabase(page),template=mock.data.candidates[0];
 let releaseCount!:()=>void; let countRequested=false;
 const countGate=new Promise<void>(resolve=>{releaseCount=resolve;});
 await page.route("**/rest/v1/rpc/app_recruitment_list_count_v1",async route=>{
  if(route.request().postDataJSON()?.p_entity==="candidate_registry") { countRequested=true; await countGate; }
  await route.fallback();
 });
 for(let i=0;i<60;i++)mock.data.candidates.push({...template,candidate_id:`CAN-DELAY-${String(i).padStart(3,"0")}`,name:`Delayed ${String(i).padStart(3,"0")}`,nickname:null,created_at:"2026-10-31T00:00:00.000Z",updated_at:"2026-10-31T00:00:00.000Z"});
 await page.goto("/candidates");await expectWorkspaceReady(page);
 await expect.poll(()=>mock.rpcCalls.some(row=>row.endpoint==="app_recruitment_list_v1"&&row.payload.p_entity==="candidate_registry")).toBe(true);
 await expect.poll(()=>countRequested).toBe(true);
 await expect(page.getByRole("button",{name:/Delayed 000.*CAN-DELAY-000/})).toBeVisible();
 await expect(page.getByRole("button",{name:"Next page"})).toBeEnabled();
 await expect(page.locator("[data-record-pagination]")).toContainText("1/…");
 releaseCount();
 await expect(page.locator("[data-record-pagination]")).toContainText(/1\/\d+/);
});

test("candidate registry keyset paging is stable, resets on filters and supports quick navigation",async({page})=>{
 const mock=await installMockSupabase(page),template=mock.data.candidates[0];
 for(let i=0;i<260;i++)mock.data.candidates.push({...template,candidate_id:`CAN-PAGE-${String(i).padStart(3,"0")}`,name:`Page ${String(i).padStart(3,"0")}`,nickname:null,created_at:"2026-10-31T00:00:00.000Z",updated_at:"2026-10-31T00:00:00.000Z"});
 await page.goto("/candidates");await expectWorkspaceReady(page);
 await expect(page.getByLabel("Rows per page")).toHaveCount(0);
 await expect(page.locator("[data-record-pagination]")).toContainText(/1\/\d+/);
 await expect(page.locator("[data-record-pagination]")).toContainText("1/"+Math.ceil(mock.data.candidates.length/7));
 const next=page.getByRole("button",{name:"Next page"}),previous=page.getByRole("button",{name:"Previous page"});
 await next.evaluate(button=>{button.dispatchEvent(new MouseEvent("click",{bubbles:true}));button.dispatchEvent(new MouseEvent("click",{bubbles:true}));});await expect(page.locator("[data-record-pagination]")).toContainText(/2\/\d+/);
 await next.click();await expect(page.locator("[data-record-pagination]")).toContainText(/3\/\d+/);
 await previous.click();await expect(page.locator("[data-record-pagination]")).toContainText(/2\/\d+/);
 await next.click();await expect(page.locator("[data-record-pagination]")).toContainText(/3\/\d+/);
 await page.getByRole("searchbox",{name:/Search name, ID/}).fill("Page 001");
 await expect(page.locator("[data-record-pagination]")).toContainText(/1\/\d+/);
 await page.getByRole("button",{name:"Advanced Filters",exact:true}).click();
 await page.getByRole("button",{name:"Talent pool",exact:true}).click();
 await expect(page.locator("[data-record-pagination]")).toContainText(/1\/\d+/);
});

test("registry search keeps padded ID collisions distinct and opens raw IDs; masked rows stay private",async({page})=>{
 const mock=await installMockSupabase(page),template=mock.data.candidates[0];
 mock.data.candidates.push({...template,candidate_id:"CAN-1",name:"Short alias",nickname:null},{...template,candidate_id:"CAN-00001",name:"Long alias",nickname:null});
 mock.data.masked_candidate_pool=[{candidate_id:"MASKED-1",position_interests:"Private interest",created_by:"qa-site",creator_label:"Site Recruiter",created_at:"2026-10-31T00:00:00.000Z"}];
 await page.goto("/candidates");await expectWorkspaceReady(page);
 const search=page.getByRole("searchbox",{name:/Search name, ID/});await search.fill("CAN-00001");
 await expect(page.getByRole("button",{name:/Short alias.*CAN-00001/})).toBeVisible();
 await expect(page.getByRole("button",{name:/Long alias.*CAN-00001/})).toBeVisible();
 await page.getByRole("button",{name:/Short alias.*CAN-00001/}).click();
 await expect(page.getByRole("dialog").getByText("Short alias",{exact:true})).toBeVisible();
 await expect(page.getByRole("dialog").getByText("CAN-00001",{exact:true})).toBeVisible();
 await page.getByRole("dialog").getByRole("button",{name:"Close"}).click();await search.fill("MASKED-1");
 await expect.poll(()=>mock.rpcCalls.filter(row=>row.endpoint==="app_recruitment_list_v1").at(-1)?.payload.p_search).toBe("MASKED-1");
 const masked=page.getByRole("button",{name:/Private MASKED-1/});await expect(masked).toBeVisible();
 await expect(page.getByText("Private interest",{exact:true})).toHaveCount(2);
 await expect(page.getByText("Short alias",{exact:true})).toHaveCount(0);
});

test("save an independent pool profile without creating activity", async ({page})=>{
  const mock=await installMockSupabase(page);
  await page.goto("/candidates");await expectWorkspaceReady(page);
  await page.getByRole("button",{name:"New Candidate",exact:true}).click();
  const form=page.getByRole("dialog",{name:"Create Candidate"});
  await form.getByRole("textbox",{name:"Name",exact:true}).fill("Future engineer");
  await form.getByRole("button",{name:"Channel",exact:true}).click();
  await page.getByRole("option",{name:"LinkedIn",exact:true}).click();
  await form.locator('input[name="phone_no"]').fill("0899999999");
  await form.getByRole("textbox",{name:"Position interests"}).fill("Future engineer");
  await form.getByRole("button",{name:"First Contact Date",exact:true}).click();await page.getByRole("button",{name:"24/07/2026",exact:true}).click();
  const before=mock.data.recruitment_logs.length;
  await form.getByRole("button",{name:"Review changes"}).click();await confirm(page);
  expect(mock.rpcCalls.findLast(row=>row.endpoint==="app_upsert_candidate_profile_v2")).toMatchObject({endpoint:"app_upsert_candidate_profile_v2",payload:{group_id:null}});
  expect(mock.data.recruitment_logs.length).toBe(before);
  await page.getByRole("button",{name:"Advanced Filters",exact:true}).click();
 await page.getByRole("button",{name:"Talent pool",exact:true}).click();
  await expect(page.getByRole("button",{name:/Future engineer/})).toBeVisible();
});

test("unmatched profile details retain creator-authorized notes without loading journeys",async({page})=>{
 const mock=await installMockSupabase(page);
 const seed=mock.data.candidates[0];
 const candidateId="CAN-UNMATCHED-NOTE";
 mock.data.candidates.push({...seed,candidate_id:candidateId,name:"Unmatched Note Profile",nickname:"Note Profile",group_id:null,doc_group_id:null});
 mock.data.candidate_notes.push({note_id:"note-unmatched",candidate_id:candidateId,body:"Creator-only pool note",created_by:mock.data.profile?.id??null,updated_by:mock.data.profile?.id??null,version:1,created_at:"2026-07-20T00:00:00.000Z",updated_at:"2026-07-20T00:00:00.000Z"});
 await page.goto("/candidates");await expectWorkspaceReady(page);
 await page.getByRole("button",{name:"Advanced Filters",exact:true}).click();
 await page.getByRole("button",{name:"Talent pool",exact:true}).click();
 await page.getByRole("searchbox").fill(candidateId);
 const row=page.getByRole("row").filter({hasText:candidateId});await expect(row).toBeVisible();
 await row.getByRole("button",{name:/Unmatched Note Profile/}).click();
 const detail=page.getByRole("dialog",{name:new RegExp(candidateId)});
 await expect(detail.getByText("Creator-only pool note",{exact:true})).toBeVisible();
 expect(mock.restReads.some(read=>read.table==="candidate_notes"&&read.scopedCandidate===candidateId)).toBe(true);
 expect(mock.restReads.some(read=>read.table==="recruitment_logs"&&read.scopedCandidate===candidateId)).toBe(false);
});

test("parallel journeys require selection and transfer carries the same stage",async({page})=>{
 const mock=await installMockSupabase(page);
 const source=mock.data.candidate_applications!.find(row=>row.candidate_id==="C-HR")!;
 mock.data.candidate_applications!.push({...source,application_id:"parallel-application",group_id:"GRP-TECH"});
 mock.data.recruitment_logs.push({...mock.data.recruitment_logs[0],candidate_id:"C-HR",application_id:"parallel-application",log_id:900,stage_instance_id:"parallel-stage"});
 await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);
 await expect(page.getByText("Select an application tab to view its journey and actions.")).toBeVisible();
 await page.getByRole("tab",{name:/Engineer.*GRP-ENG/}).click();
 await expect(page).toHaveURL(new RegExp(`applicationId=${source.application_id}`));
 await page.getByRole("button",{name:"Reassign application",exact:true}).click();
 await page.getByRole("combobox",{name:"Destination group",exact:true}).selectOption("GRP-ANL");
 const review=page.getByRole("button",{name:"Review application"});
 await expect(review).toBeDisabled();
 await page.getByLabel("Reason",{exact:true}).fill("Better fit for analyst role");
 const before=mock.data.recruitment_logs.length;
 await review.click();await confirm(page);
 expect(mock.rpcCalls.findLast(row=>row.endpoint==="app_transfer_candidate_application_v1")).toMatchObject({endpoint:"app_transfer_candidate_application_v1",payload:{application_id:source.application_id,expected_version:1,reason:"Better fit for analyst role"}});
 expect(source.group_id).toBe("GRP-ANL");expect(mock.data.recruitment_logs.length).toBe(before);
});

test("Workspace can add an existing profile without creating another person",async({page})=>{
 const mock=await installMockSupabase(page);
 await page.goto("/workspace?type=group&id=GRP-TECH&section=pipeline");await expectWorkspaceReady(page);
 await page.getByRole("button",{name:"New Candidate",exact:true}).click();
 const dialog=page.getByRole("dialog",{name:"Create Candidate"});
 await dialog.getByRole("button",{name:"Use existing candidate"}).click();
 await page.getByRole("option",{name:/C-HR.*Hana HR/}).click();
 const before=mock.data.candidates.length;
 await dialog.getByRole("button",{name:"Review changes"}).click();await confirm(page);
 expect(mock.rpcCalls.findLast(row=>row.endpoint==="app_create_candidate_application_v1")).toMatchObject({endpoint:"app_create_candidate_application_v1",payload:{candidate_id:"C-HR",group_id:"GRP-TECH"}});
 expect(mock.data.candidates.length).toBe(before);
});

test("picker renderers preserve search/order/actions and per-user preference",async({page})=>{
 await installMockSupabase(page);
 await page.goto("/workspace");await expectWorkspaceReady(page);
 const table=page.getByRole("button",{name:"Table",exact:true}),cards=page.getByRole("button",{name:"Cards",exact:true});
 await expect(table).toHaveAttribute("aria-pressed","true");
 const results=page.locator('[data-workspace-picker-results]');
 const original=await results.getByRole("button",{name:/, GRP-/}).allTextContents();
 await cards.click();await expect(cards).toHaveAttribute("aria-pressed","true");
 expect(await results.getByRole("button",{name:/, GRP-/}).allTextContents()).toEqual(original);
 await page.getByLabel("Search workspaces").fill("GRP-ENG");await table.click();
 await expect(page.getByLabel("Search workspaces")).toHaveValue("GRP-ENG");
 await cards.click();await page.reload();await expectWorkspaceReady(page);await expect(cards).toHaveAttribute("aria-pressed","true");
 await page.evaluate(()=>{localStorage.setItem("recruitment:workspace:view:qa-admin","invalid");localStorage.setItem("recruitment:workspace:view:qa-site","cards");});
 await page.reload();await expectWorkspaceReady(page);await expect(table).toHaveAttribute("aria-pressed","true");
});

for(const language of ["en","th"] as const) for(const width of [360,390,768,1024,1440]) {
 test(`picker table/cards and registry ${language} at ${width}px`,async({page},testInfo)=>{
  await installMockSupabase(page,{language});await page.setViewportSize({width,height:900});
  await page.goto(`/workspace?lang=${language}`);await expectWorkspaceReady(page);
  for(const name of language==="th"?["ตาราง","การ์ด"]:["Table","Cards"]) {
   await page.getByRole("button",{name,exact:true}).click();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await expect(page.getByRole("button",{name:/Engineer, GRP-ENG/})).toBeVisible();
   if((language==="en"&&width===1440)||(language==="th"&&width===360))await page.screenshot({path:testInfo.outputPath(`workspace-${name}.png`),fullPage:true});
  }
  await page.goto(`/candidates?lang=${language}`);await expectWorkspaceReady(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });
}
