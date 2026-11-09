import {expect,test} from "@playwright/test";
import {installMockSupabase,expectWorkspaceReady} from "./support/mock-supabase";

test("Records filters use a left sidebar and discard drafts",async({page})=>{
 await installMockSupabase(page,{role:"system_admin"});
 for(const route of ["/requisitions","/candidates","/offers","/pipeline?pipelineView=table","/sourcing","/audit"]){
  await page.setViewportSize({width:1366,height:768});await page.goto(route);await expectWorkspaceReady(page);if(route==="/sourcing")await page.getByRole("button",{name:"Lifecycle history",exact:true}).click();
  const toggle=page.getByRole("button",{name:"Advanced Filters",exact:true});await toggle.click();const panel=page.locator("#"+await toggle.getAttribute("aria-controls"));await expect(panel).toBeVisible();await expect(panel).toHaveClass(/records-filter-sidebar/);
  const geometry=await panel.evaluate(node=>{const panel=node.getBoundingClientRect(),table=node.parentElement!.querySelector(".table-scroll, [data-testid=audit-table-viewport]")!.getBoundingClientRect();return {right:panel.right,left:table.left};});expect(geometry.right).toBeLessThanOrEqual(geometry.left);
  const field=panel.locator("input:not([type=checkbox])").first();if(await field.count()){await field.fill("test");await panel.getByRole("button",{name:"Close",exact:true}).click();await expect(toggle).toBeFocused();await toggle.click();await expect(field).toHaveValue("");}
  await page.keyboard.press("Escape");await expect(panel).toBeHidden();
 }
});

test("phone filter drawer supports close and focus return",async({page})=>{await installMockSupabase(page,{language:"th"});await page.setViewportSize({width:390,height:780});await page.goto("/candidates");await expectWorkspaceReady(page);const toggle=page.locator('[aria-controls="records-candidate-filters"]');await toggle.click();const panel=page.locator("#records-candidate-filters");await expect(panel).toBeVisible();await expect(panel).toHaveCSS("position","fixed");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.keyboard.press("Escape");await expect(panel).toBeHidden();await expect(toggle).toBeFocused();});

test("weekly work restores develop cards",async({page})=>{await installMockSupabase(page,{role:"system_admin"});await page.goto("/sourcing");await expectWorkspaceReady(page);await expect(page.getByText("Weekly work",{exact:true}).first()).toBeVisible();await expect(page.locator("article").first()).toBeVisible();await expect(page.getByRole("button",{name:"Lifecycle history",exact:true})).toBeVisible();});
