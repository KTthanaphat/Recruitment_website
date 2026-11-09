
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { enrichCandidates } from "../../src/lib/data";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test.setTimeout(60_000);
for (const size of [23,1005]) test("Pipeline keeps five-card pages for "+size+" candidates in bounded cursor blocks",async({page})=>{
  const mock=await installMockSupabase(page,{role:"admin_recruiter"});
  const base=enrichCandidates(mock.data).find(row=>row.latest_process==="Phone Screen")!;
  const rows=Array.from({length:size},(_,i)=>({...base,application_id:"board-"+String(i+1).padStart(5,"0"),candidate_id:"CAN-"+String(i+1).padStart(5,"0"),name:"Board Candidate "+(i+1),nickname:null}));
  const requests: unknown[]=[]; let bytes=0;
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1",async route=>{
    const body=route.request().postDataJSON(), filters=body.p_filters??{};
    if(!["pipeline_stage","candidate_applications"].includes(body.p_entity))return route.fallback();
    requests.push(body);
    const source=filters.stage==="Phone Screen"?rows:[];
    const start=body.p_cursor_id?source.findIndex(row=>row.application_id===body.p_cursor_id)+1:0;
    const items=source.slice(start,start+body.p_limit),end=start+items.length;
    const response=JSON.stringify({items,total_count:null,has_more:end<source.length,has_more_before:start>0,next_cursor:end<source.length?{value:"tied",id:items.at(-1)!.application_id}:null,previous_cursor:start?{value:"tied",id:items[0].application_id}:null});
    bytes+=Buffer.byteLength(response);await route.fulfill({json:JSON.parse(response)});
  });
  await page.route("**/rest/v1/rpc/app_recruitment_list_count_v1",async route=>{
    const body=route.request().postDataJSON();
    if(!["pipeline_stage","candidate_applications"].includes(body.p_entity))return route.fallback();
    await route.fulfill({json:body.p_filters?.stage==="Phone Screen"?size:0});
  });
  const started=Date.now();await page.goto("/pipeline?lang=en");await expectWorkspaceReady(page);
  const lane=page.locator("[data-pipeline-stage]").filter({has:page.getByRole("heading",{name:/Phone Screen/})}).first();
  await expect(lane.getByText("Board Candidate 1",{exact:true})).toBeVisible();
  if(process.env.DESIGN_BASELINE === "1") {
    fs.mkdirSync("outputs/design-adjustments",{recursive:true});
    fs.writeFileSync("outputs/design-adjustments/baseline-pipeline-"+size+".json",JSON.stringify({population:size,listRequests:requests.length,transferredListBytes:bytes,firstUsablePartialBoardMs:Date.now()-started,displayedStageCards:await lane.getByText(/^Board Candidate [0-9]+$/).count()},null,2));
    return;
  }
  const navigation=lane.locator("[data-board-pagination]");
  await expect(navigation).toContainText("1/"+Math.ceil(size/5));
  await expect(lane.getByText(/^Board Candidate \d+$/)).toHaveCount(5);
  const firstCompleteBoardMs=Date.now()-started;
  const readCount=requests.length;
  if(size===23){
    for(let i=0;i<4;i++)await navigation.getByRole("button",{name:"Next",exact:true}).click();
    await expect(navigation).toContainText("5/5");
    await expect(lane.getByText(/^Board Candidate \d+$/)).toHaveCount(3);
    await expect(navigation.getByRole("button",{name:"Next",exact:true})).toBeDisabled();
    await navigation.getByRole("button",{name:"Previous",exact:true}).click();
    await expect(navigation).toContainText("4/5");
    expect(requests.length).toBe(readCount);
  }
  expect((requests as Array<{p_limit:number}>).every(row=>row.p_limit===25)).toBe(true);
  fs.mkdirSync("outputs/design-adjustments",{recursive:true});
  fs.writeFileSync("outputs/design-adjustments/pipeline-"+size+".json",JSON.stringify({population:size,listRequests:requests.length,transferredListBytes:bytes,firstCompleteBoardMs},null,2));
  await page.screenshot({path:"outputs/design-adjustments/pipeline-"+size+".png",fullPage:true});
});
test("Home pagination is outside each record scroll region",async({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter"});await page.goto("/home?lang=en");await expectWorkspaceReady(page);
  const welcome=page.getByRole("dialog",{name:"Welcome back"}); await expect(welcome).toBeVisible(); await welcome.getByRole("button",{name:"Close",exact:true}).last().click();
  for(const key of ["sourcing_updates","data_quality","start_confirmation"]){
    await page.locator("#home-record-tab-"+key).click();
    await expect(page.locator("[data-home-record-pagination]")).toBeVisible();
    await expect(page.locator("[data-home-record-list] [data-home-record-pagination]")).toHaveCount(0);
  }
});
test("Group cards put ID at top right and show separate unlabelled tags",async({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter"});await page.goto("/workspace?lang=en");await expectWorkspaceReady(page);
  await page.getByRole("button",{name:"Cards",exact:true}).click();
  const card=page.locator("[data-workspace-picker-results] article").filter({hasText:"GRP-ENG"}).first();
  await expect(card).toBeVisible();await expect(card.locator('[data-tag-appearance="soft"]')).toHaveCount(3);
  const identity=await card.getByText("GRP-ENG",{exact:true}).boundingBox();
  const title=await card.getByRole("button").first().boundingBox();
  expect(identity!.x).toBeGreaterThan(title!.x);expect(Math.abs(identity!.y-title!.y)).toBeLessThan(22);
  await page.screenshot({path:"outputs/design-adjustments/workspace-cards.png",fullPage:true});
});

test("Candidate Working Confirm preselects attendance and reviews before saving",async({page})=>{
  const mock=await installMockSupabase(page,{role:"admin_recruiter"});
  const offer=mock.data.offers.find(row=>row.candidate_id==="C-OFFER-PASS")!;
  offer.start_confirmation=null;offer.first_working_date="2026-07-20";
  const app=mock.data.candidate_applications!.find(row=>row.candidate_id===offer.candidate_id)!;
  await page.goto("/candidates?lang=en&detailType=candidate&detailId="+offer.candidate_id+"&applicationId="+app.application_id);
  await expectWorkspaceReady(page);
  const drawer=page.getByRole("dialog").first();
  await expect(drawer.getByRole("heading",{name:"Working Confirm",exact:true})).toBeVisible();
  await expect(drawer.getByText("Offer record",{exact:true})).toHaveCount(0);
  const pencil=drawer.getByRole("button",{name:"Edit offer",exact:true});await expect(pencil.locator("svg")).toHaveCount(1);
  for(const outcome of ["started","did_not_start"]){
    await drawer.getByRole("button",{name:outcome==="started"?"Accept: Started work":"Reject: Did not start",exact:true}).click();
    const form=page.getByRole("dialog").filter({has:page.locator('[name="start_confirmation"]')});
    await expect(form.locator('[name="start_confirmation"]')).toHaveValue(outcome);
    if(outcome==="did_not_start"){await expect(form.locator('[name="reason"]')).toHaveAttribute("required","");await form.locator('[name="reason"]').fill("Candidate did not attend");}
    await form.getByRole("button",{name:"Review changes",exact:true}).click();
    const review=page.getByRole("dialog",{name:"Confirm Save",exact:true});await expect(review).toBeVisible();
    expect(mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1")).toHaveLength(0);
    await review.getByRole("button",{name:/Cancel|Back|Close/,exact:true}).first().click();
    const opened=page.getByRole("dialog").filter({has:page.locator('[name="start_confirmation"]')});
    if(await opened.isVisible())await opened.getByRole("button",{name:"Close",exact:true}).first().click();
  }
  await page.setViewportSize({width:390,height:844});
  await expect(drawer.getByRole("button",{name:"Accept: Started work",exact:true})).toBeVisible();
  await drawer.getByRole("heading",{name:"Working Confirm",exact:true}).scrollIntoViewIfNeeded();
  const acceptBox=await drawer.getByRole("button",{name:"Accept: Started work",exact:true}).boundingBox(); expect(acceptBox!.height).toBeGreaterThanOrEqual(44);expect(acceptBox!.x+acceptBox!.width).toBeLessThanOrEqual(390);
  await page.screenshot({path:"outputs/design-adjustments/offer-phone.png",fullPage:false});
});
