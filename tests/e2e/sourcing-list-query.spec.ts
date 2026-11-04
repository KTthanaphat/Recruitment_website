import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";
import { sourcingApplicants } from "@/lib/operations";

test("Sourcing history uses the scoped database list, count, and cursor controls", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "Lifecycle history" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Page 1 · \d+ records/ })).toBeVisible();
  expect(mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "sourcing_records")).toBe(true);
  expect(mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_count_v1" && call.payload.p_entity === "sourcing_records")).toBe(true);
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
});

test("workspace sourcing summary uses the scoped aggregate RPC", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/workspace?type=group&id=GRP-TECH&section=sourcing&sourcingWeek=2026-07-18");
  await expectWorkspaceReady(page);
  await page.getByRole("tab", { name: "Sourcing", exact: true }).click();
  await expect(page.getByTestId("workspace-sourcing-summary")).toBeVisible();
  await expect.poll(() => mock.rpcCalls.some(call => call.endpoint === "app_recruitment_sourcing_summary_v1" && call.payload.p_group_id === "GRP-TECH" && call.payload.p_selected_week === "2026-07-18")).toBe(true);
  const aggregate = mock.rpcCalls.findLast(call => call.endpoint === "app_recruitment_sourcing_summary_v1" && call.payload.p_group_id === "GRP-TECH" && call.payload.p_selected_week === "2026-07-18");
  expect(aggregate?.payload).toMatchObject({ p_group_id: "GRP-TECH", p_selected_week: "2026-07-18" });
  await expect(page.getByTestId("workspace-sourcing-summary-row")).toBeVisible();
  const expectedApplicants = mock.data.sourcing_weekly_updates.filter(row => row.group_id === "GRP-TECH" && row.week_start <= "2026-07-18").reduce((sum, row) => sum + (sourcingApplicants(row) ?? 0), 0);
  await expect(page.getByTestId("workspace-sourcing-summary-row")).toContainText(String(expectedApplicants));
  await expect(page.getByRole("alert").filter({ hasText: "Could not load the sourcing summary" })).toHaveCount(0);
});


test("standalone sourcing does not fetch charts and stops board reads on History", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing");
  await expectWorkspaceReady(page);
  await expect.poll(() => mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "sourcing_records")).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: /Page 1/ })).toBeVisible();
  await page.getByRole("button", { name: "Lifecycle history", exact: true }).click();
  const before = mock.rpcCalls.length;
  await expect(page.getByRole("status").filter({ hasText: /Page 1/ })).toBeVisible();
  expect(mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_sourcing_summary_v1")).toHaveLength(0);
  expect(mock.rpcCalls.slice(before).filter(call => call.payload.p_entity === "sourcing_records" && (call.payload.p_filters as Record<string, unknown>)?.surface === "board")).toHaveLength(0);
});

test("selected sourcing week is editable before history and charts, with bounded Load more", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  for (const req of mock.data.requisitions) req.pr_approved_date = "2024-01-01";
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>(resolve => { releaseHistory = resolve; });
  let releaseSummary!: () => void;
  const summaryGate = new Promise<void>(resolve => { releaseSummary = resolve; });
  await page.route("**/rest/v1/rpc/**", async route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const filters = body.p_filters as Record<string, unknown> | undefined;
    if (route.request().url().endsWith("/app_recruitment_sourcing_summary_v1")) await summaryGate;
    if (body.p_entity === "sourcing_records" && !filters?.from) await historyGate;
    await route.fallback();
  });
  await page.goto("/workspace?type=group&id=GRP-TECH&section=sourcing&sourcingWeek=2026-07-18");
  await expectWorkspaceReady(page);
  const channel = page.getByTestId("workspace-sourcing-channel-rows").locator("input").first();
  await expect(channel).toBeEditable();
  await channel.fill("17");
  expect(mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_count_v1" && call.payload.p_entity === "sourcing_records")).toHaveLength(0);
  const selected = mock.rpcCalls.find(call => call.payload.p_entity === "sourcing_records" && (call.payload.p_filters as Record<string, unknown>)?.from);
  expect(selected?.payload.p_filters).toMatchObject({ groupId: "GRP-TECH", from: "2026-07-11", to: "2026-07-18" });
  releaseHistory();
  const dates = page.getByTestId("workspace-sourcing-dates").getByRole("button");
  await expect(dates).toHaveCount(25);
  await expect(channel).toHaveValue("17");
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(dates).toHaveCount(50);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(dates).toHaveCount(75);
  await expect(channel).toHaveValue("17");
  releaseSummary();
  await expect(page.getByTestId("workspace-sourcing-summary-row")).toBeVisible();
  await expect(channel).toHaveValue("17");
  const historyCalls = mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "sourcing_records" && !(call.payload.p_filters as Record<string, unknown>)?.from);
  expect(historyCalls).toHaveLength(3);
  expect(historyCalls.every(call => call.payload.p_limit === 25)).toBe(true);
});


test("history failure retries independently without changing the sourcing draft", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  let failed = false;
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1", async route => {
    const body = route.request().postDataJSON();
    if (body.p_entity === "sourcing_records" && !body.p_filters?.from && !failed) {
      failed = true;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({message:"History fixture failure"}) });
      return;
    }
    await route.fallback();
  });
  await page.goto("/workspace?type=group&id=GRP-TECH&section=sourcing&sourcingWeek=2026-07-18");
  await expectWorkspaceReady(page);
  const channel = page.getByTestId("workspace-sourcing-channel-rows").locator("input").first();
  await expect(channel).toBeEditable();
  await channel.fill("23");
  const history = page.getByTestId("workspace-sourcing-dates");
  await expect(history.getByRole("alert")).toBeVisible();
  await history.getByRole("button", {name:/Retry/}).click();
  await expect(history.getByRole("alert")).toHaveCount(0);
  await expect(channel).toHaveValue("23");
  expect(mock.rpcCalls.some(call=>call.payload.p_entity === "sourcing_records" && (call.payload.p_filters as Record<string,unknown>)?.from)).toBe(true);
});

for (const language of ["en", "th"] as const) {
  test(`phone ${language}: direct older week is pinned without traversing intervening history`, async ({ page }) => {
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:"reduce"});
    const mock=await installMockSupabase(page,{role:"admin_recruiter",language});
    for(const req of mock.data.requisitions) req.pr_approved_date="2024-01-01";
    await page.goto(`/workspace?type=group&id=GRP-TECH&section=sourcing&sourcingWeek=2024-01-06&lang=${language}`);
    await expectWorkspaceReady(page);
    await expect(page.getByTestId("workspace-sourcing-channel-rows").locator("input").first()).toBeEditable();
    const dates=page.getByTestId("workspace-sourcing-dates");
    await expect(dates.getByRole("button")).toHaveCount(26);
    await expect(dates.locator('[aria-current="date"]')).toHaveCount(1);
    expect(mock.rpcCalls.filter(call=>call.endpoint==="app_recruitment_list_v1" && call.payload.p_entity==="sourcing_records" && !(call.payload.p_filters as Record<string,unknown>)?.from)).toHaveLength(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:`outputs/sourcing-records/phone-${language}.png`,fullPage:true});
  });
}

test("sourcing timing events contain only aggregate phase values", async ({page})=>{
  await installMockSupabase(page,{role:"admin_recruiter"});
  await page.addInitScript(()=>{(window as unknown as {phases:unknown[]}).phases=[];window.addEventListener("recruitment:sourcing-display",event=>(window as unknown as {phases:unknown[]}).phases.push((event as CustomEvent).detail));});
  await page.goto("/sourcing");
  await expectWorkspaceReady(page);
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {phases:unknown[]}).phases.length)).toBeGreaterThan(0);
  const phases=await page.evaluate(()=>(window as unknown as {phases:Record<string,unknown>[]}).phases);
  expect(Object.keys(phases[0]).sort()).toEqual(["view","cacheHit","queueMs","requestMs","responseToDisplayMs"].sort());
  expect(phases[0].requestMs).toBeGreaterThanOrEqual(0);
  expect(phases[0].responseToDisplayMs).toBeGreaterThanOrEqual(0);
});


test("a superseded selected-week response never replaces the latest editor", async ({page})=>{
  const mock=await installMockSupabase(page,{role:"admin_recruiter"});
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let oldRequested=false;
  await page.route("**/rest/v1/rpc/app_recruitment_list_v1",async route=>{
    const body=route.request().postDataJSON();
    if(body.p_entity==="sourcing_records" && body.p_filters?.to==="2026-07-11") {oldRequested=true;await gate;}
    await route.fallback();
  });
  await page.goto("/workspace?type=group&id=GRP-TECH&section=sourcing&sourcingWeek=2026-07-18");
  await expectWorkspaceReady(page);
  await expect(page.getByTestId("workspace-sourcing-channel-rows").locator("input").first()).toBeEditable();
  const navigate=async(week:string)=>page.evaluate(week=>{const url=new URL(location.href);url.searchParams.set("sourcingWeek",week);history.pushState(null,"",url);window.dispatchEvent(new PopStateEvent("popstate"));},week);
  await navigate("2026-07-11");
  await expect.poll(()=>oldRequested).toBe(true);
  await navigate("2026-07-04");
  await expect(page.locator('input[name="workspace_sourcing_week"]')).toHaveValue("2026-07-04");
  await expect(page.getByTestId("workspace-sourcing-channel-rows").locator("input").first()).toBeEditable();
  release();
  await expect(page.locator('input[name="workspace_sourcing_week"]')).toHaveValue("2026-07-04");
  expect(mock.rpcCalls.filter(call=>call.endpoint==="app_recruitment_list_count_v1" && call.payload.p_entity==="sourcing_records")).toHaveLength(0);
  await page.screenshot({path:"outputs/sourcing-records/desktop.png",fullPage:true});
});
