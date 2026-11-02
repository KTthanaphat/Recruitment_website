import {expect,test,type Page} from "@playwright/test";
import {expectWorkspaceReady,installMockSupabase} from "./support/mock-supabase";

async function openNew(page:Page) {
 await page.getByRole("button",{name:"New Candidate",exact:true}).click();
 return page.getByRole("dialog",{name:"Create Candidate"});
}
async function confirm(page:Page){const dialog=page.getByRole("dialog",{name:"Confirm Save",exact:true});await expect(dialog).toBeVisible();await dialog.getByRole("button",{name:"Save changes",exact:true}).click();await expect(dialog).toBeHidden();}

test("new profile has adjacent identity fields, no ownership fields, and contact review precedes save",async({page})=>{
 const mock=await installMockSupabase(page);await page.goto("/candidates");await expectWorkspaceReady(page);
 const form=await openNew(page);
 await expect(form.locator('[name="home_site"],[name="responsible_recruiter_id"],[name="duplicate_acknowledged"]')).toHaveCount(0);
 const name=form.locator('[name="name"]'),nickname=form.locator('[name="nickname"]');
 const a=await name.boundingBox(),b=await nickname.boundingBox();expect(Math.abs(a!.y-b!.y)).toBeLessThan(4);expect(b!.x).toBeGreaterThan(a!.x);
 await name.fill("New separate candidate");await nickname.fill("Newbie");
 const existing=mock.data.candidates[0];await form.locator('[name="phone_no"]').fill(existing.phone_no!);
 await form.getByRole("button",{name:"Channel",exact:true}).click();await page.getByRole("option",{name:"LinkedIn",exact:true}).click();
 await form.getByRole("button",{name:"First Contact Date",exact:true}).click(); await page.getByRole("button",{name:"24/07/2026",exact:true}).click();
 await form.getByRole("button",{name:"Review changes",exact:true}).click();
 const duplicate=page.getByRole("dialog",{name:"Matching candidate contacts"});await expect(duplicate).toBeVisible();await expect(duplicate).toContainText(existing.candidate_id);
 await expect(page.getByRole("dialog",{name:"Confirm Save",exact:true})).toBeHidden();
 await expect(duplicate.getByRole("link",{name:"Open existing profile"}).first()).toHaveAttribute("target","_blank");
 await duplicate.getByRole("button",{name:"Back to form"}).click();await expect(name).toHaveValue("New separate candidate");
 await form.getByRole("button",{name:"Review changes",exact:true}).click();await duplicate.getByRole("button",{name:"Continue as a separate candidate"}).click();
 const count=mock.data.candidates.length;expect(count).toBeGreaterThan(0);await confirm(page);
 expect(mock.data.candidates.length).toBe(count+1);
 const write=mock.rpcCalls.findLast(row=>row.endpoint==="app_upsert_candidate_profile_v2")!;
 expect(write.payload).toMatchObject({name:"New separate candidate",duplicate_review:{matches:expect.arrayContaining([expect.objectContaining({candidate_id:existing.candidate_id})])}});
 expect(write.payload).not.toHaveProperty("home_site");expect(write.payload).not.toHaveProperty("responsible_recruiter_id");
});

test("profile, single note, and explicit application tabs stay separate and support keyboard/deep links",async({page})=>{
 const mock=await installMockSupabase(page);const original=mock.data.candidate_applications!.find(row=>row.candidate_id==="C-HR")!;
 mock.data.candidate_applications!.push({...original,application_id:"parallel-profile-application",group_id:"GRP-TECH",state:"closed",closed_at:"2026-07-23T00:00:00Z",closure_reason:"failed_stage"});
 mock.data.candidate_notes=[{note_id:"one-current-note",candidate_id:"C-HR",body:"One shared profile note",created_by:mock.data.profile!.id,created_at:"2026-07-23T00:00:00Z",version:1}];
 await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);
 const profile=page.getByRole("region",{name:"Candidate profile",exact:true}),note=page.getByRole("region",{name:"Profile note",exact:true}),tabs=page.getByRole("tablist",{name:"Candidate applications"});
 await expect(profile).toBeVisible();await expect(note).toContainText("One shared profile note");
 await expect(page.getByText("Select an application tab to view its journey and actions.")).toBeVisible();
 await expect(page.getByRole("tabpanel")).toHaveCount(0);
 expect((await profile.boundingBox())!.y).toBeLessThan((await note.boundingBox())!.y);expect((await note.boundingBox())!.y).toBeLessThan((await tabs.boundingBox())!.y);
 const tab=tabs.getByRole("tab").first();await tab.click();await expect(tab).toHaveAttribute("aria-selected","true");await expect(page).toHaveURL(new RegExp(`applicationId=${original.application_id}`));
 await expect(page.getByRole("heading",{name:"Application details",exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Candidate profile",exact:true})).toHaveCount(1);
 await tab.focus();await page.keyboard.press("End");await expect(tabs.getByRole("tab").last()).toHaveAttribute("aria-selected","true");
 await page.goBack();await expect(tabs.getByRole("tab").first()).toHaveAttribute("aria-selected","true");await page.goForward();
 await page.reload();await expectWorkspaceReady(page);await expect(tabs.getByRole("tab").last()).toHaveAttribute("aria-selected","true");
});

test("one note is updated rather than appended and PICs cannot edit it",async({page})=>{
 const mock=await installMockSupabase(page);Object.assign(mock.data.candidates.find(row=>row.candidate_id==="C-HR")!,{channel:"LinkedIn",phone_no:"0899911223"});mock.data.candidate_notes=[{note_id:"single-note",candidate_id:"C-HR",body:"Original note",created_by:mock.data.profile!.id,created_at:"2026-07-23T00:00:00Z",version:1}];
 await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);
 const note=page.getByRole("region",{name:"Profile note",exact:true});
 await expect(note.getByRole("textbox")).toHaveCount(0);
 await page.getByRole("button",{name:"Edit profile",exact:true}).click();
 const form=page.getByRole("dialog",{name:"Edit Candidate"});await form.locator('[name="note"]').fill("Updated note");
 await form.getByRole("button",{name:"Review changes",exact:true}).click();await confirm(page);
 expect(mock.data.candidate_notes).toHaveLength(1);expect(mock.data.candidate_notes[0].body).toBe("Updated note");expect(mock.data.candidate_notes[0].version).toBe(2);
});

test("a PIC can edit shared profile fields but the note input is absent",async({page})=>{
 const mock=await installMockSupabase(page,{role:"site_recruiter"});const candidate=mock.data.candidates.find(row=>row.candidate_id==="C-HR")!;candidate.created_by="someone-else";
 mock.data.candidate_profile_capabilities=[{candidate_id:"C-HR",creator_label:"Original creator",can_edit:true,can_read_note:true,can_edit_note:false,can_add_application:true,is_unmatched:false}];
 mock.data.candidate_notes=[{note_id:"private-note",candidate_id:"C-HR",body:"PIC reads only",created_by:"someone-else",created_at:"2026-07-23T00:00:00Z",version:1}];
 await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);
 const note=page.getByRole("region",{name:"Profile note",exact:true});await expect(note).toContainText("PIC reads only");await expect(note.getByRole("textbox")).toHaveCount(0);
 await page.getByRole("button",{name:"Edit profile",exact:true}).click();const form=page.getByRole("dialog",{name:"Edit Candidate"});await expect(form).toBeVisible();await expect(form.locator('[name="note"],[name="home_site"],[name="responsible_recruiter_id"]')).toHaveCount(0);
});

test("masked summaries show only permitted fields and no matching/profile actions",async({page})=>{
 const mock=await installMockSupabase(page,{role:"viewer"});mock.data.masked_candidate_pool=[{candidate_id:"MASKED-001",position_interests:"Future quality engineer",created_by:"other",creator_label:"Other creator",created_at:"2026-07-23T00:00:00Z"}];
 await page.goto("/candidates");await expectWorkspaceReady(page);await page.getByRole("searchbox").fill("MASKED-001");
 const row=page.locator("tr").filter({hasText:"MASKED-001"});await expect(row).toContainText("Future quality engineer");await expect(row).toContainText("Other creator");
 await row.getByRole("button").click();await expect(page.getByText("Private profile. Only its creator or an administrator can start its first application.")).toBeVisible();
 await expect(page.getByRole("button",{name:"Add application",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"Edit profile",exact:true})).toHaveCount(0);
});

test("a creator whose role is now viewer remains read-only without cached capabilities",async({page})=>{
 const mock=await installMockSupabase(page,{role:"viewer"});mock.data.candidate_profile_capabilities=[];
 await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);
 await expect(page.getByRole("heading",{name:"Candidate profile",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Edit profile",exact:true})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Add application",exact:true})).toHaveCount(0);
 await expect(page.getByRole("button",{name:"Reassign application",exact:true})).toHaveCount(0);
 await expect(page.getByLabel("Edit profile note",{exact:true})).toHaveCount(0);
});

test("profile warnings precede the read-only profile and the selected tab encloses all journey sections",async({page})=>{
 const mock=await installMockSupabase(page);
 const candidate=mock.data.candidates.find(row=>row.candidate_id==="C-HR")!;
 candidate.position_interests="Engineering leadership";
 mock.data.candidate_notes=[{note_id:"layout-note",candidate_id:"C-HR",body:"Saved profile note",created_by:mock.data.profile!.id,created_at:"2026-07-23T00:00:00Z",version:1}];
 mock.data.candidates.find(row=>row.candidate_id!=="C-HR")!.phone_no=candidate.phone_no;
 await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);
 const profile=page.getByRole("region",{name:"Candidate profile",exact:true});
 const warning=page.locator('[aria-label="Profile warnings"]');await expect(warning).toBeVisible();
 expect((await warning.boundingBox())!.y).toBeLessThan((await profile.boundingBox())!.y);
 await expect(page.getByText("Possible duplicate candidate",{exact:true})).toHaveCount(1);
 const interests=profile.getByRole("heading",{name:"Position interests",exact:true});
 const note=profile.getByRole("region",{name:"Profile note",exact:true});
 expect((await interests.boundingBox())!.y).toBeLessThan((await note.boundingBox())!.y);
 await expect(note).toContainText("Saved profile note");await expect(note.getByRole("textbox")).toHaveCount(0);
 for (const label of ["Edit profile","Add application"]) {
   const button=page.getByRole("button",{name:label,exact:true});await expect(button).toHaveAttribute("title",label);
   expect((await button.innerText()).trim()).toBe("");const box=await button.boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
 }
 const tabs=page.getByRole("tablist");await expect(tabs).not.toContainText(/\d{2}\/\d{2}\/\d{4}/);
 const panel=page.getByRole("tabpanel");await expect(panel).toHaveCSS("border-top-width","1px");
 await expect(panel.getByRole("heading",{name:"Candidate Pipeline Journey",exact:true})).toBeVisible();
 await expect(panel.getByRole("heading",{name:"Application details",exact:true})).toBeVisible();
 await expect(panel.getByRole("button",{name:"Reassign application",exact:true})).toBeVisible();
 await expect(panel.getByText(mock.data.candidate_applications!.find(row=>row.candidate_id==="C-HR")!.application_id,{exact:true})).toHaveCount(0);
 await expect(panel.locator('[aria-label="Profile warnings"]')).toHaveCount(0);
});

test("destination choices exclude historical groups for new journeys but allow the original journey to return",async({page})=>{
 const mock=await installMockSupabase(page);const app=mock.data.candidate_applications!.find(row=>row.candidate_id==="C-HR")!;
 const originalGroup=app.group_id;app.group_id="GRP-TECH";
 await page.goto(`/candidates?detailType=candidate&detailId=C-HR&applicationId=${app.application_id}`);await expectWorkspaceReady(page);
 await page.getByRole("button",{name:"Add application",exact:true}).click();
 await expect(page.getByLabel("Destination group").locator(`option[value="${originalGroup}"]`)).toHaveCount(0);
 await page.getByRole("button",{name:"Cancel",exact:true}).click();
 await page.getByRole("button",{name:"Reassign application",exact:true}).click();
 await expect(page.getByLabel("Destination group").locator(`option[value="${originalGroup}"]`)).toHaveCount(1);
});

test("a server-side historical-group rejection explains the rule and preserves the application draft",async({page})=>{
 await installMockSupabase(page);
 await page.route("**/rest/v1/rpc/app_create_candidate_application_v1",route=>route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({code:"P0001",message:"APPLICATION_GROUP_ALREADY_USED"})}));
 await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);
 await page.getByRole("button",{name:"Add application",exact:true}).click();await page.getByLabel("Destination group").selectOption("GRP-TECH");
 await page.getByRole("button",{name:"Review application",exact:true}).click();await confirm(page);
 await expect(page.getByText("This candidate already has a journey for this group. Choose another group, or return the original journey.",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Review and edit",exact:true}).click();
 await expect(page.getByLabel("Destination group")).toHaveValue("GRP-TECH");
});

for(const language of ["en","th"] as const) for(const width of [360,390,768,1440]) test(`profile drawer ${language} ${width}px has no page overflow`,async({page})=>{
 await page.setViewportSize({width,height:900});await installMockSupabase(page,{language});await page.goto("/candidates?detailType=candidate&detailId=C-HR");await expectWorkspaceReady(page);
 await expect(page.getByRole("tablist")).toBeVisible();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);expect(overflow).toBe(false);
 const panel=page.getByRole("tabpanel");const bounds=await panel.boundingBox();
 for(const section of await panel.locator('.candidate-detail-workspace > section').all()) {
   const box=await section.boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(bounds!.x+bounds!.width+1);
 }
 if(width===360||width===1440) { await page.screenshot({path:test.info().outputPath(`profile-${language}-${width}.png`),fullPage:false});await page.getByRole("tablist").scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath(`application-${language}-${width}.png`),fullPage:false}); }
});
