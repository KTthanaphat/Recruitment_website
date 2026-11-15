import { expect, test } from "@playwright/test";
import { installMockSupabase } from "./support/mock-supabase";

for (const role of ["system_admin", "admin_recruiter", "site_recruiter", "viewer"] as const) {
  test(`Welcome does not wait for calendar completion for ${role}`, async ({ page }) => {
    const mock = await installMockSupabase(page, { role });
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/rest/v1/rpc/app_recruitment_calendar_v1", async route => { await hold; await route.fallback().catch(() => {}); });
    await page.goto("/home?lang=en");
    const welcome = page.getByRole("dialog", { name: "Welcome back" });
    await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toBeVisible();
    expect(mock.rpcCalls.some(call => call.endpoint === "app_home_welcome_summary_v1")).toBe(true);
    release();
  });

  test(`Welcome reuses a recent authorized summary during refresh for ${role}`, async ({ page }) => {
    await installMockSupabase(page, { role });
    await page.goto("/home?lang=en");
    const welcome = page.getByRole("dialog", { name: "Welcome back" });
    await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toBeVisible();
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/rest/v1/rpc/app_home_welcome_summary_v1", async route => { await hold; await route.fallback().catch(() => {}); });
    await page.reload();
    await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toBeVisible();
    release();
  });
}

test("expired Welcome snapshots wait for a fresh response", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home?lang=en");
  const welcome = page.getByRole("dialog", { name: "Welcome back" });
  await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toBeVisible();
  await page.evaluate(() => {
    for (const key of Object.keys(sessionStorage).filter(key => key.startsWith('recruitment:home-summary:v1:["welcome"'))) {
      const entry = JSON.parse(sessionStorage.getItem(key)!);
      entry.savedAt = Date.now() - 30_001;
      sessionStorage.setItem(key, JSON.stringify(entry));
    }
  });
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/rpc/app_home_welcome_summary_v1", async route => { await hold; await route.fallback().catch(() => {}); });
  await page.reload();
  await expect(welcome.locator('[data-welcome-counts-ready]').getByRole("status")).toBeVisible();
  await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toHaveCount(0);
  release();
  await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toBeVisible();
});

test("Welcome access denial clears cached aggregates", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home?lang=en");
  const welcome = page.getByRole("dialog", { name: "Welcome back" });
  await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toBeVisible();
  await page.route("**/rest/v1/rpc/app_home_welcome_summary_v1", route => route.fulfill({ status: 403, json: { code: "42501", message: "permission denied" } }));
  await page.reload();
  await expect(welcome.locator('[data-welcome-counts-ready]').getByRole("alert")).toBeVisible();
  await expect(welcome.locator('[data-welcome-message-ready="true"]')).toHaveCount(0);
  await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('recruitment:home-summary:v1:["welcome"')))).toBe(false);
});

for (const role of ["system_admin", "admin_recruiter", "site_recruiter", "viewer"] as const) {
 test(`daily message renders while the full Welcome summary remains pending for ${role}`, async ({ page }) => {
  const mock = await installMockSupabase(page, { role });
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/rpc/app_home_welcome_summary_v1", async route => { await hold; await route.fallback().catch(() => {}); });
  await page.goto("/home?lang=en");
  const welcome = page.getByRole("dialog", { name: "Welcome back" });
  await expect(welcome.locator('[data-welcome-message-ready="true"]')).toBeVisible();
  await expect(page.locator('[data-home-core-ready="true"]')).toBeVisible();
  await expect(welcome.locator('[data-welcome-counts-ready="false"]').getByRole('status')).toBeVisible();
  const response = mock.rpcCalls.find(call => call.endpoint === "app_home_welcome_message_v1")?.response as { filledResponsibleVacancyRatio: number };
  await expect(welcome.locator('[data-welcome-message-ready]')).toContainText(response.filledResponsibleVacancyRatio + "%");
  await expect(welcome.getByRole('button', {name:/View pipeline/i})).toBeEnabled();
  if (role === "admin_recruiter") {
   await page.setViewportSize({width:1440,height:900});await page.screenshot({path:'outputs/welcome-message-desktop.png'});
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:'outputs/welcome-message-mobile.png'});
  }
  release(); await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toBeVisible();
 });
}

test("daily message retries independently while counts remain pending", async ({page}) => {
 await installMockSupabase(page,{role:"admin_recruiter"});
 let release!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/rest/v1/rpc/app_home_welcome_summary_v1',async route=>{await hold;await route.fallback().catch(()=>{});});
 let failed=false;await page.route('**/rest/v1/rpc/app_home_welcome_message_v1',async route=>{if(!failed){failed=true;await route.fulfill({status:500,json:{message:'Synthetic message failure'}});}else await route.fallback();});
 await page.goto('/home?lang=en');const welcome=page.getByRole('dialog',{name:'Welcome back'});
 await expect(welcome.locator('[data-welcome-message-ready]').getByRole('alert')).toBeVisible();
 await welcome.locator('[data-welcome-message-ready]').getByRole('button',{name:'Retry'}).click();
 await expect(welcome.locator('[data-welcome-message-ready="true"]')).toBeVisible();
 await expect(welcome.locator('[data-welcome-counts-ready="false"]')).toBeVisible();release();
});

test("late full summary cannot restore Welcome content after message access denial", async ({page}) => {
 await installMockSupabase(page,{role:"admin_recruiter"});
 let started!:()=>void,release!:()=>void;
 const fullStarted=new Promise<void>(resolve=>{started=resolve}),hold=new Promise<void>(resolve=>{release=resolve});
 await page.route('**/rest/v1/rpc/app_home_welcome_summary_v1',async route=>{started();await hold;await route.fallback().catch(()=>{});});
 await page.route('**/rest/v1/rpc/app_home_welcome_message_v1',async route=>{await fullStarted;await route.fulfill({status:403,json:{code:'42501',message:'permission denied'}});});
 await page.goto('/home?lang=en');const welcome=page.getByRole('dialog',{name:'Welcome back'});
 await expect(welcome.locator('[data-welcome-message-ready]').getByRole('alert')).toBeVisible();
 const response=page.waitForResponse(r=>r.url().endsWith('/app_home_welcome_summary_v1'));release();await (await response).finished();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(welcome.locator('[data-welcome-counts-ready="true"]')).toHaveCount(0);
 await expect(welcome.locator('[data-welcome-message-ready="true"]')).toHaveCount(0);
});
