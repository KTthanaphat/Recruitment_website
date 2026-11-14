import { expect, test, type Page } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

async function setup(page: Page, role: "admin_recruiter" | "viewer" = "admin_recruiter") {
  const mock = await installMockSupabase(page, { role });
  const req = mock.data.requisitions[0], app = mock.data.candidate_applications![0];
  const candidate = mock.data.candidates.find(row => row.candidate_id === app.candidate_id)!;
  const records: Record<string, Array<Record<string, unknown>>> = {
    open: Array.from({length: 27}, (_, i) => ({id: `req:${i}`, type: "requisition", recordId: i ? `METRIC-REQ-${i}` : req.doc_id, applicationId: null, title: i ? `Synthetic position ${i}` : req.position, meta: "KT1 · Alice", reason: "openHeadcount", actionDate: null, quantity: 2})),
    urgent: [{id: "urgent-candidate", type: "candidate", recordId: candidate.candidate_id, applicationId: app.application_id, title: candidate.name, meta: "Follow up", reason: "agingCandidate", actionDate: null, quantity: null}],
    aging: [{id: "overdue-candidate", type: "candidate", recordId: candidate.candidate_id, applicationId: app.application_id, title: candidate.name, meta: app.group_id, reason: "overdueAction", actionDate: "2026-07-22", quantity: null}],
    sourcing: [{id: "stale-group", type: "sourcing", recordId: app.group_id, applicationId: null, title: "Synthetic sourcing group", meta: app.group_id, reason: "sourcingGap", actionDate: null, quantity: null}]
  };
  const calls: Array<Record<string, unknown>> = [];
  let failNext = false;
  await page.route("**/rest/v1/rpc/app_home_metric_page_v1", async route => {
    const body = route.request().postDataJSON(); calls.push(body);
    if (failNext) { failNext = false; await route.fulfill({status: 500, contentType:"application/json",body:JSON.stringify({message:"Synthetic metric failure"})}); return; }
    const rows = records[body.p_metric] ?? [], start = body.p_after_id ? Number(String(body.p_after_id).split(":")[1]) + 1 : 0;
    const items = rows.slice(start, start + body.p_limit);
    await route.fulfill({contentType:"application/json",body:JSON.stringify({items,totalCount:rows.length,hasMore:start+items.length<rows.length,nextCursor:items.length?{priority:0,id:items.at(-1)!.id}:null})});
  });
  await page.goto("/home?lang=en");
  await expectWorkspaceReady(page);
  const welcome=page.getByRole("dialog",{name:"Welcome back",exact:true});
  if(await welcome.isVisible()) await welcome.getByRole("button",{name:"Close",exact:true}).last().click();
  await expect(page.getByRole("button",{name:"Open List: Urgent items",exact:true})).toBeEnabled();
  return {mock,records,calls,fail:()=>{failNext=true;}};
}

test("Today's Work floral metrics open exact paginated lists and preserve keyboard focus", async ({page}, testInfo) => {
  const fixture=await setup(page);
  const card=page.locator("section").filter({has:page.getByRole("heading",{name:"Today's Work",exact:true})}).last();
  await expect(card.locator("[data-home-work-floral] img")).toHaveCount(2);
  await card.locator("[data-home-work-floral] img").evaluateAll(async images=>Promise.all(images.map(img=>(img as HTMLImageElement).decode())));
  const panelBounds = (await card.boundingBox())!;
  const upperFlowers = (await card.locator("[data-home-work-floral] img").first().boundingBox())!;
  const lowerFlowers = (await card.locator("[data-home-work-floral] img").last().boundingBox())!;
  expect(upperFlowers.y).toBeLessThan(panelBounds.y);
  expect(upperFlowers.x + upperFlowers.width).toBeGreaterThan(panelBounds.x + panelBounds.width);
  expect(lowerFlowers.x).toBeLessThan(panelBounds.x);
  expect(lowerFlowers.y + lowerFlowers.height).toBeGreaterThan(panelBounds.y + panelBounds.height);
  await expect(card.getByRole("button",{name:/Open List:/})).toHaveCount(4);
  await page.screenshot({path:testInfo.outputPath("today-work-desktop.png")});
  const open=card.getByRole("button",{name:"Open List: Open requisition",exact:true});
  await open.focus();await page.keyboard.press("Enter");
  const dialog=page.getByRole("dialog",{name:"Open requisition",exact:true});
  await expect(dialog).toBeVisible();await expect(dialog.getByRole("button",{name:"Show more",exact:true})).toBeVisible();
  await expect(dialog.getByRole("status")).toHaveText("Showing 25 / 27");
  await dialog.getByRole("button",{name:"Show more",exact:true}).click();
  await expect(dialog.getByRole("status")).toHaveText("Showing 27 / 27");
  expect(fixture.calls.map(row=>row.p_after_id)).toEqual([null,"req:24"]);
  const close=dialog.getByRole("button",{name:"Close",exact:true});
  await close.focus();await page.keyboard.press("Shift+Tab");await expect(dialog.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Tab");await expect(close).toBeFocused();
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(open).toBeFocused();
  await card.getByRole("button",{name:"Open List: Aging candidates",exact:true}).click();
  const aging=page.getByRole("dialog",{name:"Aging candidates",exact:true});
  await expect(aging.locator("li").getByText("Overdue scheduled action",{exact:false})).toBeVisible();
  await expect(aging.locator("li")).toHaveCount(1);
  await page.screenshot({path:testInfo.outputPath("today-work-popup.png")});
  await page.keyboard.press("Escape");
  await card.getByRole("button",{name:"Open List: Sourcing gaps",exact:true}).click();
  const sourcing=page.getByRole("dialog",{name:"Sourcing gaps",exact:true});
  await expect(sourcing.getByRole("link")).toHaveAttribute("href",new RegExp(`id=${fixture.records.sourcing[0].recordId}`));
  await page.keyboard.press("Escape");
  await card.getByRole("button",{name:"Open List: Urgent items",exact:true}).click();
  const urgent=page.getByRole("dialog",{name:"Urgent items",exact:true});
  await expect(urgent.locator("li")).toHaveCount(1);
  await urgent.locator("li button").click();
  await expect(urgent).toHaveCount(0);
  await expect(page.getByRole("dialog").filter({hasText:String(fixture.records.urgent[0].title)}).first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("applicationId")).toBe(fixture.records.urgent[0].applicationId);
});

test("Today's Work popup retries errors, handles empty data and mobile Thai controls", async ({page},testInfo) => {
  const fixture=await setup(page,"viewer");fixture.fail();
  await page.getByRole("button",{name:"Open List: Urgent items",exact:true}).click();
  const dialog=page.getByRole("dialog",{name:"Urgent items",exact:true});
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button",{name:"Retry",exact:true}).click();
  await expect(dialog.locator("li")).toHaveCount(1);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await page.keyboard.press("Escape");
  fixture.records.urgent.length=0;
  await page.setViewportSize({width:360,height:800});
  await page.getByRole("button",{name:"TH",exact:true}).click();
  const button=page.getByRole("button",{name:/เปิดรายการ:.*เร่งด่วน/});
  await button.scrollIntoViewIfNeeded();await button.click();
  const mobile=page.getByRole("dialog",{name:"รายการเร่งด่วน",exact:true});
  await expect(mobile.getByText("ไม่มีรายการที่ต้องแสดง",{exact:true})).toBeVisible();
  const bounds=await mobile.boundingBox();expect(bounds!.width).toBeLessThanOrEqual(360);
  await page.screenshot({path:testInfo.outputPath("today-work-phone-popup.png")});
  await page.keyboard.press("Escape");await expect(button).toBeFocused();
  await page.locator("[data-home-work-floral]").scrollIntoViewIfNeeded();
  await page.screenshot({path:testInfo.outputPath("today-work-phone.png")});
});


test("Today's Work clears its popup when the header scope changes and does not reopen old results", async ({page}) => {
  const fixture=await setup(page);
  await page.getByRole("button",{name:"Open List: Open requisition",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Open requisition",exact:true})).toBeVisible();
  await page.evaluate(() => { const url=new URL(location.href);url.searchParams.set("site","KT1");history.replaceState(null,"",url);dispatchEvent(new Event("workspace:urlchange")); });
  await expect(page.getByRole("dialog",{name:"Open requisition",exact:true})).toHaveCount(0);
  await page.evaluate(() => { const url=new URL(location.href);url.searchParams.delete("site");history.replaceState(null,"",url);dispatchEvent(new Event("workspace:urlchange")); });
  await expect(page.getByRole("dialog",{name:"Open requisition",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Open List: Open requisition",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Open requisition",exact:true}).getByText("Showing 25 / 27",{exact:true})).toBeVisible();
  expect(fixture.calls.at(-1)?.p_after_id).toBeNull();
});
