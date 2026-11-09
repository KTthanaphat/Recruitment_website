import {expect,test} from "@playwright/test";
import {installMockSupabase,expectWorkspaceReady} from "./support/mock-supabase";

test("advanced category lists share the standard filter design",async({page})=>{
 const mock=await installMockSupabase(page,{role:"system_admin"});
 for(const route of ["/requisitions","/offers","/sourcing"]){
  await page.setViewportSize({width:1366,height:768});await page.goto(route);await expectWorkspaceReady(page);if(route==="/sourcing")await page.getByRole("button",{name:"Lifecycle history",exact:true}).click();
  const toggle=page.getByRole("button",{name:"Advanced Filters",exact:true});await toggle.click();const panel=page.locator("#"+await toggle.getAttribute("aria-controls"));const trigger=panel.locator("summary.ats-dropdown-trigger").first();await expect(trigger).toBeVisible();
  const box=await trigger.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);await expect(trigger).toHaveCSS("border-top-color","rgb(147, 185, 255)");await expect(trigger).toHaveCSS("border-top-left-radius","12px");await expect(trigger).toHaveCSS("font-size","14px");await expect(trigger.locator("svg")).toHaveCount(1);
  await trigger.click();const menu=page.locator("[data-category-menu]");await expect(menu).toBeVisible();await expect(menu).toHaveCSS("background-color","rgb(255, 255, 255)");await expect(menu).toHaveCSS("font-size","14px");await expect(menu.locator("label").first()).toHaveCSS("border-radius","8px");
  const choice=menu.locator('input[type="checkbox"]').nth(1);await expect(choice).toBeVisible();await choice.check();await expect(choice).toBeChecked();await expect(choice).toHaveCSS("background-color","rgb(10, 60, 220)");await expect(menu.locator("label").nth(1)).toHaveCSS("background-color","rgb(233, 242, 255)");
  await trigger.click();await panel.getByRole("button",{name:"Apply filter",exact:true}).click();await expect(toggle).toHaveAttribute("data-filters-active","true");await panel.getByRole("button",{name:"Clear filters",exact:true}).click();
 }
 expect(mock.rpcCalls.length).toBeGreaterThan(0);
});

test("Thai phone list remains in viewport and returns focus on Escape",async({page})=>{
 await installMockSupabase(page,{language:"th"});await page.setViewportSize({width:390,height:700});await page.goto("/requisitions");await expectWorkspaceReady(page);await page.locator('[aria-controls="records-requisition-filters"]').click();const trigger=page.locator("#records-requisition-filters summary.ats-dropdown-trigger").first();await trigger.click();const menu=page.locator("[data-category-menu]");await expect(menu).toBeVisible();const box=await menu.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(390);expect(box!.y+box!.height).toBeLessThanOrEqual(700);await trigger.press("Escape");await expect(menu).toHaveCount(0);await expect(trigger).toBeFocused();
});
