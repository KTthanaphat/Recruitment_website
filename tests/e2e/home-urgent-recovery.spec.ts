import { expect, test, type Page } from "@playwright/test";
import { installMockSupabase } from "./support/mock-supabase";

async function setup(page: Page, initial: "ok" | "error" = "ok") {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.addInitScript((id) => sessionStorage.setItem(`recruitment_welcome_dismissed:${id}`, "dismissed"), mock.data.profile!.id);
  let mode: "ok" | "error" | "denied" = initial;
  await page.route("**/rest/v1/rpc/app_home_work_queue_v1", async route => {
    if (mode === "ok") await route.fulfill({ status: 200, json: { items: [], totalCount: 7 } });
    else if (mode === "denied") await route.fulfill({ status: 403, json: { code: "42501", message: "permission denied" } });
    else await route.fulfill({ status: 500, json: { code: "57014", message: "statement timeout" } });
  });
  await page.goto("/home?lang=en");
  const urgent = page.getByRole("button", { name: "Open List: Urgent items" }).first();
  return { urgent, setMode: (value: typeof mode) => { mode = value; } };
}

test("urgent initial error stays unknown and manual retry succeeds", async ({page}) => {
  const {urgent,setMode} = await setup(page,"error");
  const alert=page.getByRole("alert").filter({hasText:"Urgent items"});
  await expect(alert).toContainText("Could not load this list.");
  await expect(urgent).toContainText("—");
  await expect(page.locator('[data-home-core-ready="true"]')).toBeVisible();
  setMode("ok"); await alert.getByRole("button",{name:"Retry"}).click();
  await expect(urgent).toContainText("7"); await expect(alert).toHaveCount(0);
});

test("failed refresh identifies retained count as stale and retry clears it", async ({page}) => {
  const {urgent,setMode} = await setup(page);
  await expect(urgent).toContainText("7"); setMode("error");
  await page.locator('[data-app-header-actions]').getByRole("button",{name:"Refresh"}).click();
  const alert=page.getByRole("alert").filter({hasText:"Urgent items"});
  await expect(alert).toContainText("Showing the previous count"); await expect(urgent).toContainText("7");
  setMode("ok"); await alert.getByRole("button",{name:"Retry"}).click();
  await expect(alert).toHaveCount(0); await expect(urgent).toContainText("7");
});

test("authorization failure clears the previous urgent count", async ({page}) => {
  const {urgent,setMode} = await setup(page);
  await expect(urgent).toContainText("7"); setMode("denied");
  await page.locator('[data-app-header-actions]').getByRole("button",{name:"Refresh"}).click();
  const alert=page.getByRole("alert").filter({hasText:"Urgent items"});
  await expect(alert).toContainText("Could not load this list."); await expect(urgent).toContainText("—");
});

test("changing site cannot carry a stale urgent count", async ({page}) => {
  const {urgent,setMode} = await setup(page);
  await expect(urgent).toContainText("7"); setMode("error");
  const header=page.locator('[data-app-header-actions]');
  await header.getByRole("button",{name:"Site",exact:true}).click();
  await header.getByRole("listbox",{name:"Site"}).getByRole("option",{name:"KT1",exact:true}).click();
  const alert=page.getByRole("alert").filter({hasText:"Urgent items"});
  await expect(alert).toContainText("Could not load this list."); await expect(urgent).toContainText("—");
});


test("late urgent result cannot overwrite a new site", async ({page}) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.addInitScript((id) => sessionStorage.setItem(`recruitment_welcome_dismissed:${id}`, "dismissed"), mock.data.profile!.id);
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  let started = false;
  await page.route("**/rest/v1/rpc/app_home_work_queue_v1", async route => {
    const body = route.request().postDataJSON();
    if (!body.p_scope.headerSite) { started = true; await hold; await route.fulfill({status:200,json:{items:[],totalCount:7}}).catch(()=>{}); }
    else await route.fulfill({status:200,json:{items:[],totalCount:2}});
  });
  await page.goto("/home?lang=en");
  await expect.poll(() => started).toBe(true);
  const header=page.locator('[data-app-header-actions]');
  await header.getByRole("button",{name:"Site",exact:true}).click();
  await header.getByRole("listbox",{name:"Site"}).getByRole("option",{name:"KT1",exact:true}).click();
  const urgent=page.getByRole("button",{name:"Open List: Urgent items"}).first();
  await expect(urgent).toContainText("2"); release();
  await expect(urgent).toContainText("2"); await expect(urgent).not.toContainText("7");
});


test("recent same-scope Home counts render during reload revalidation", async ({page}) => {
 const {urgent}=await setup(page);
 await expect(urgent).toContainText("7");
 let release!:()=>void; const hold=new Promise<void>(resolve=>{release=resolve});
 await page.route("**/rest/v1/rpc/app_home_core_summary_v1",async route=>{await hold;await route.fallback().catch(()=>{});});
 await page.reload();
 await expect(page.locator('[data-home-core-ready="true"]')).toBeVisible();
 await expect(page.getByRole("button",{name:"Open List: Urgent items"}).first()).toContainText("7");
 release();
});


test("core access denial clears previously authorized snapshots", async ({page}) => {
 const {urgent}=await setup(page); await expect(urgent).toContainText("7");
 await page.route("**/rest/v1/rpc/app_home_core_summary_v1",route=>route.fulfill({status:403,json:{code:"42501",message:"permission denied"}}));
 await page.locator('[data-app-header-actions]').getByRole("button",{name:"Refresh"}).click();
 await expect(page.locator('[data-home-core-ready="false"]')).toBeVisible();
 expect(await page.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('recruitment:home-summary:v1:["core"')))).toBe(false);
});
