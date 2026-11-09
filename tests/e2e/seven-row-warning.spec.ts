import {expect,test} from "@playwright/test";
import {translate} from "../../src/lib/i18n/dictionary";
import {installMockSupabase,expectWorkspaceReady} from "./support/mock-supabase";

for(const language of ["en","th"] as const)for(const matches of [1,31])test("Compact contact review "+language+" "+matches+" matches preserves drafts and save review",async({page})=>{
 const mock=await installMockSupabase(page,{language});
 for(const row of mock.data.candidates){row.phone_no=null;row.email=null;}
 const base=mock.data.candidates[0];base.phone_no="0899112233";base.email="contact-match@example.com";
 for(let i=1;i<matches;i++)mock.data.candidates.push({...base,candidate_id:"LONG-MATCH-ID-"+String(i).padStart(5,"0"),email:i%2?null:base.email});
 await page.goto("/candidates?lang="+language);await expectWorkspaceReady(page);
 await page.getByRole("button",{name:translate(language,"newCandidate"),exact:true}).click();
 const form=page.getByRole("dialog").filter({has:page.locator('input[name="name"]')});
 await form.locator('[name="name"]').fill("Preserved separate candidate");
 await form.locator('[name="phone_no"]').fill(base.phone_no);await form.locator('[name="email"]').fill(base.email);
 await form.getByRole("button",{name:translate(language,"channel"),exact:true}).click();
 await page.getByRole("option",{name:"LinkedIn",exact:true}).click();
 await form.getByRole("button",{name:translate(language,"firstContactDate"),exact:true}).click();
 await page.getByRole("button",{name:"24/07/2026",exact:true}).click();
 const review=form.getByRole("button",{name:translate(language,"reviewChanges"),exact:true});
 await review.click();
 const warning=page.locator(".contact-match-modal"),create=warning.getByRole("button",{name:language==="th"?"สร้างผู้สมัครแยก":"Create Separate Cand.",exact:true});
 await expect(warning).toBeVisible();await expect(warning.locator(".contact-match-row")).toHaveCount(matches);
 await expect(warning.getByRole("link").first()).toHaveAttribute("target","_blank");
 await expect(warning.getByRole("button")).toHaveCount(2);
 await expect(warning.locator(".contact-match-header")).toHaveCSS("border-bottom-width","0px");
 for(const width of [1366,390,360]){
  await page.setViewportSize({width,height:768});
  const box=await warning.boundingBox();expect(box!.width).toBeLessThanOrEqual(560);expect(box!.x).toBeGreaterThanOrEqual(12);expect(box!.x+box!.width).toBeLessThanOrEqual(width-12);expect(box!.y).toBeGreaterThanOrEqual(12);expect(box!.y+box!.height).toBeLessThanOrEqual(756);
  const footer=await warning.locator(".contact-match-footer").boundingBox();expect(footer!.y+footer!.height).toBeLessThanOrEqual(756);
  if(matches>1)expect(await warning.locator(".contact-match-list").evaluate(el=>el.scrollHeight>el.clientHeight)).toBeTruthy();
  await page.screenshot({path:"outputs/seven-warning-"+language+"-"+matches+"-"+width+".png",fullPage:true});
 }
 await warning.getByRole("button",{name:translate(language,"close"),exact:true}).click();
 await expect(form.locator('[name="name"]')).toHaveValue("Preserved separate candidate");
 await review.click();await warning.focus();await page.keyboard.press("Escape");await expect(warning).toBeHidden();await expect(form.locator('[name="phone_no"]')).toHaveValue(base.phone_no);
 await review.click();await create.focus();await page.keyboard.press("Enter");
 await expect(warning).toBeHidden();await expect(page.getByRole("button",{name:translate(language,"saveChanges"),exact:true})).toBeVisible();
 expect(mock.rpcCalls.some(call=>call.endpoint==="app_upsert_candidate_profile_v2")).toBe(false);
});
