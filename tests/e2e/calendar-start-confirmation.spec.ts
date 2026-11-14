import { expect, test, type Page } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

async function setup(page: Page, options: { role?: "admin_recruiter" | "viewer"; language?: "en" | "th"; state?: "future" | "started" | "today" } = {}) {
  const mock = await installMockSupabase(page, { role: options.role ?? "admin_recruiter", language: options.language ?? "en" });
  const offer = mock.data.offers.find(row => row.candidate_id === "C-OFFER-PASS")!;
  if (options.state === "future") offer.first_working_date = "2026-07-25";
  if (options.state === "today") offer.first_working_date = "2026-07-24";
  if (options.state === "started") offer.start_confirmation = "started";
  await page.goto("/home?lang=" + (options.language ?? "en"));
  await expectWorkspaceReady(page);
  const welcome = page.getByRole("dialog", { name: /Welcome back|ยินดีต้อนรับกลับ/ });
  if (await welcome.isVisible()) await welcome.getByRole("button", { name: /^(Close|ปิด)$/ }).last().click();
  const calendar = page.getByRole("heading", { name: /^(Recruitment Calendar|ปฏิทินการสรรหา)$/ }).locator("xpath=ancestor::section[1]");
  const start = calendar.getByRole("button", { name: /Olivia Offer Pass/ }).filter({has:page.locator("svg.lucide-briefcase-business")});
  return { mock, offer, calendar, start };
}
const popup = (page: Page) => page.getByRole("dialog").filter({has:page.locator("[data-calendar-start-confirmation]")});
const form = (page: Page) => page.getByRole("dialog").filter({has:page.locator('[name="start_confirmation"]')});

for (const outcome of ["started", "did_not_start"] as const) test("calendar start opens Records confirmation and reviews " + outcome + " before saving", async ({ page }, info) => {
  const { mock, offer, start } = await setup(page);
  const accepted = offer.accepted_date, working = offer.first_working_date;
  await expect(start).toBeVisible(); await start.click();
  const dialog = popup(page);
  await expect(dialog.getByRole("heading", { name: "New Hire Confirmation", exact: true })).toBeVisible();
  await expect(dialog.locator("[data-new-hire-confirmation]")).toBeVisible();
  await expect(dialog).toContainText(offer.doc_id);
  const accept = dialog.getByRole("button", { name: "Accept: Started work", exact: true });
  const reject = dialog.getByRole("button", { name: "Reject: Did not start", exact: true });
  await expect(accept).toHaveCSS("color", "rgb(22, 122, 61)");
  await expect(reject).toHaveCSS("color", "rgb(197, 43, 64)");
  await page.screenshot({path:info.outputPath("calendar-new-hire-desktop.png")});
  await (outcome === "started" ? accept : reject).click();
  await expect(dialog).toHaveCount(0);
  await expect(form(page).locator('[name="start_confirmation"]')).toHaveValue(outcome);
  expect(mock.rpcCalls.filter(call => call.endpoint === "app_confirm_offer_start_v1")).toHaveLength(0);
  if (outcome === "did_not_start") {
    await expect(form(page).locator('[name="reason"]')).toHaveAttribute("required", "");
    await form(page).locator('[name="reason"]').fill("Did not attend the agreed first working day");
  }
  await form(page).getByRole("button", { name: "Review changes", exact: true }).click();
  const review = page.getByRole("dialog", {name:"Confirm Save",exact:true});
  await expect(review).toBeVisible();
  expect(mock.rpcCalls.filter(call => call.endpoint === "app_confirm_offer_start_v1")).toHaveLength(0);
  await review.getByRole("button", {name:"Save changes",exact:true}).click();
  await expect.poll(() => mock.data.offers.find(row=>row.offer_id===offer.offer_id)?.start_confirmation).toBe(outcome);
  expect(offer.accepted_date).toBe(accepted); expect(offer.first_working_date).toBe(working);
  const writes=mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1");
  expect(writes).toHaveLength(1); expect(writes[0].payload).toMatchObject({offer_id:offer.offer_id,start_confirmation:outcome,expected_updated_at:expect.any(String)});
});

test("calendar future starts keep confirmation actions unavailable", async ({ page }) => {
  const first=await setup(page,{state:"future"});await first.start.click();
  await expect(popup(page)).toContainText("Available on the first working date");
  await expect(popup(page).locator("[data-attendance-actions]")).toHaveCount(0);
});

test("calendar viewer sees the same record fields without attendance controls",async({page})=>{
  const fixture=await setup(page,{role:"viewer"});await fixture.start.click();
  await expect(popup(page)).toContainText("Read only");
  await expect(popup(page).locator("[data-attendance-actions]")).toHaveCount(0);
  expect(fixture.mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1")).toHaveLength(0);
});

test("calendar confirmation retries an exact offer read and refuses stale calendar dates",async({page})=>{
  const fixture=await setup(page);
  let reads=0;
  await page.route("**/rest/v1/offers?**",async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get("offer_id")===`eq.${fixture.offer.offer_id}` && ++reads===1) {await route.fulfill({status:500,json:{message:"Synthetic offer read failure"}});return;}
    await route.fallback();
  });
  await fixture.start.click();
  await expect(popup(page).getByRole("alert")).toBeVisible();
  await popup(page).getByRole("button",{name:"Retry",exact:true}).click();
  await expect(popup(page).getByRole("button",{name:"Accept: Started work",exact:true})).toBeVisible();
  await popup(page).getByRole("button",{name:"Close",exact:true}).click();
  fixture.offer.first_working_date="2026-08-01";
  await fixture.start.click();
  await expect(popup(page).getByRole("alert")).toContainText("This start event changed");
  await expect(popup(page).locator("[data-attendance-actions]")).toHaveCount(0);
});

test("Thai calendar confirmation fits a phone and returns focus to the event",async({page},info)=>{
  const fixture=await setup(page,{language:"th"});
  await page.setViewportSize({width:360,height:800});
  await fixture.calendar.getByRole("button",{name:/20\/07\/2026/}).click();
  const start=fixture.calendar.getByRole("button",{name:/Olivia Offer Pass/});
  await start.click();
  const dialog=popup(page);
  const action=dialog.getByRole("button",{name:"ยอมรับ: เริ่มงานแล้ว",exact:true});
  await expect(action).toBeVisible();
  const bounds=(await dialog.boundingBox())!,target=(await action.boundingBox())!;
  expect(bounds.width).toBeLessThanOrEqual(360);expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:info.outputPath("calendar-new-hire-phone.png")});
  const close=dialog.getByRole("button",{name:"ปิด",exact:true});
  await close.focus();await page.keyboard.press("Shift+Tab");await expect(dialog.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("Escape");await expect(dialog).toBeVisible();await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(start).toBeFocused();
});



test("confirmed calendar starts are read-only and candidate identity still opens detail",async({page})=>{
  const fixture=await setup(page,{state:"started"});await fixture.start.click();
  const dialog=popup(page);
  await expect(dialog).toContainText("Started work confirmed");
  await expect(dialog.locator("[data-attendance-actions]")).toHaveCount(0);
  await dialog.getByRole("button",{name:"Open candidate: Olivia Offer Pass",exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("dialog").filter({hasText:"C-OFFER-PASS"}).first()).toBeVisible();
});

test("Today's Events opens the same New Hire Confirmation for a start due today",async({page})=>{
  const fixture=await setup(page,{state:"today"});
  await page.locator("[data-todays-events]").getByRole("button",{name:"New Hire Confirmation: Olivia Offer Pass",exact:true}).click();
  await expect(popup(page).getByRole("button",{name:"Accept: Started work",exact:true})).toBeVisible();
  expect(fixture.mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1")).toHaveLength(0);
});


test("calendar confirmation fails closed when the exact offer becomes inaccessible",async({page})=>{
  const fixture=await setup(page);
  await page.route("**/rest/v1/offers?**",async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get("offer_id")==="eq."+fixture.offer.offer_id) {await route.fulfill({json:[]});return;}
    await route.fallback();
  });
  await fixture.start.click();
  await expect(popup(page).getByRole("alert")).toContainText("no longer available");
  await expect(popup(page).locator("[data-attendance-actions]")).toHaveCount(0);
  expect(fixture.mock.rpcCalls.filter(call=>call.endpoint==="app_confirm_offer_start_v1")).toHaveLength(0);
});

test("calendar confirmation refuses a requisition that has become secret",async({page})=>{
  const fixture=await setup(page);
  const req=fixture.mock.data.requisitions.find(row=>row.doc_id===fixture.offer.doc_id)!;
  await page.route("**/rest/v1/requisitions?**",async route=>{
    const url=new URL(route.request().url());
    if(url.searchParams.get("doc_id")==="eq."+fixture.offer.doc_id) {await route.fulfill({json:[{...req,is_secret:true}]});return;}
    await route.fallback();
  });
  await fixture.start.click();
  await expect(popup(page).getByRole("alert")).toContainText("no longer available");
  await expect(popup(page).locator("[data-attendance-actions]")).toHaveCount(0);
});
