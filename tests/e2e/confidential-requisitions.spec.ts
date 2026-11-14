import {expect,test} from "@playwright/test";
import {expectWorkspaceReady,installMockSupabase} from "./support/mock-supabase";
for(const role of ["system_admin","admin_recruiter","site_recruiter"] as const)test(`secret creation control follows ${role} role`,async({page})=>{
 await installMockSupabase(page,{role});await page.goto("/requisitions");await expectWorkspaceReady(page);await page.getByRole("button",{name:"New Requisition",exact:true}).click();const form=page.getByRole("dialog",{name:"Create Requisition",exact:true});
 const toggle=form.getByRole("switch",{name:"Secret requisition",exact:true});if(role==="site_recruiter"){await expect(toggle).toHaveCount(0);return;}
 await expect(toggle).toHaveAttribute("aria-checked","false");await toggle.click();await expect(toggle).toHaveAttribute("aria-checked","true");await expect(form.locator('input[name="is_secret"]')).toHaveValue("true");
});
test("secret details require an explicit permanent reveal confirmation and recover from errors",async({page})=>{
 const mock=await installMockSupabase(page,{role:"admin_recruiter"});const row=mock.data.requisitions.find(row=>row.doc_id==="REQ-HQ-1")!;row.is_secret=true;let requests=0;
 await page.route("**/rest/v1/rpc/app_reveal_secret_requisition_v1",async route=>{requests++;expect(route.request().postDataJSON().payload).toMatchObject({doc_id:row.doc_id,confirmed:true,expected_updated_at:row.updated_at});await route.fulfill({status:400,contentType:"application/json",body:JSON.stringify({message:"SECRET_MIXED_GROUPS: GRP-ENG"})});});
 await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");await expectWorkspaceReady(page);const drawer=page.getByRole("dialog",{name:"Engineer (L4)"});await expect(drawer).toContainText("Secret");await drawer.getByRole("button",{name:"Make ordinary",exact:true}).click();const review=page.getByRole("dialog",{name:"Make this record ordinary?"});await expect(review).toContainText("cannot be made secret again");expect(requests).toBe(0);await review.getByRole("button",{name:"Confirm make ordinary"}).click();await expect(review.getByRole("alert")).toContainText("Unlink conflicting requisitions first");await expect(review).toContainText("GRP-ENG");await review.getByRole("button",{name:"Keep secret"}).click();await expect(review).toBeHidden();
});
test("ordinary requisition edit has no control to become secret",async({page})=>{
 await installMockSupabase(page,{role:"admin_recruiter"});await page.goto("/requisitions?detailType=requisition&detailId=REQ-HQ-1");const drawer=page.getByRole("dialog",{name:"Engineer (L4)"});await drawer.getByRole("heading",{name:"Requisition profile"}).locator("..").getByRole("button",{name:"Edit requisition",exact:true}).click();const form=page.getByRole("dialog",{name:"Edit Requisition",exact:true});await expect(form.getByRole("switch",{name:"Secret requisition"})).toHaveCount(0);await expect(form.locator('input[name="is_secret"]')).toHaveValue("false");
});


test("confidential linking requires acknowledgement before the existing save path",async({page})=>{
 const mock=await installMockSupabase(page,{role:"admin_recruiter"});
 await page.route("**/rest/v1/rpc/app_secret_link_review_v1",route=>route.fulfill({contentType:"application/json",body:'{"requires_confirmation":true}'}));
 await page.goto("/sourcing?sourcingWeek=2026-07-06");await expectWorkspaceReady(page);
 await page.getByRole("article").filter({hasText:"GRP-ENG"}).getByRole("button",{name:"Open GRP-ENG details",exact:true}).click();
 const group=page.getByRole("dialog",{name:"Group details · GRP-ENG"});await group.getByLabel("Select requisition to add").click();await page.getByRole("option",{name:/REQ-UNMATCHED-1/}).click();await group.getByRole("button",{name:"Add Match",exact:true}).click();
 const review=page.getByRole("dialog",{name:"Confirm Save",exact:true});const save=review.getByRole("button",{name:"Save changes",exact:true});await expect(review.getByRole("checkbox")).toBeVisible();await expect(save).toBeDisabled();await review.getByRole("checkbox").check();await save.click();await expect.poll(()=>mock.rpcCalls.find(call=>call.endpoint==="app_create_group_match")?.payload.secret_link_confirmed).toBe(true);
});

test("unlinked secret groups remain reachable and reveal successfully",async({page})=>{
 await installMockSupabase(page,{role:"admin_recruiter"});let revealed=false;
 await page.route("**/rest/v1/rpc/app_unlinked_groups_page_v1",route=>route.fulfill({contentType:"application/json",body:JSON.stringify({items:revealed?[]:[{group_id:"SECRET-UNLINKED",group_position:"Confidential sourcing",is_secret:true,updated_at:"2026-07-24T00:00:00Z"}],next_cursor:null})}));
 await page.route("**/rest/v1/rpc/app_reveal_secret_group_v1",async route=>{expect(route.request().postDataJSON().payload).toMatchObject({group_id:"SECRET-UNLINKED",confirmed:true});revealed=true;await route.fulfill({contentType:"application/json",body:'{"ok":true,"id":"SECRET-UNLINKED"}'});});
 await page.goto("/sourcing");await expectWorkspaceReady(page);await page.getByRole("button",{name:"Unlinked groups",exact:true}).click();const groups=page.getByRole("dialog",{name:"Unlinked groups",exact:true});await expect(groups).toContainText("Confidential sourcing");await groups.getByRole("button",{name:"Make ordinary",exact:true}).click();await page.getByRole("dialog",{name:"Make this record ordinary?"}).getByRole("button",{name:"Confirm make ordinary"}).click();await expect(groups).toContainText("No unlinked groups");
});


test("admin creates a secret requisition through the normal review and committed save",async({page})=>{
 const mock=await installMockSupabase(page,{role:"admin_recruiter"});await page.goto("/requisitions");await expectWorkspaceReady(page);await page.getByRole("button",{name:"New Requisition",exact:true}).click();const form=page.getByRole("dialog",{name:"Create Requisition",exact:true});
 await form.locator('input[name="doc_id"]').fill("REQ-SECRET-UI");await form.getByRole("switch",{name:"Secret requisition",exact:true}).click();await form.getByRole("button",{name:"Site",exact:true}).click();await page.getByRole("option",{name:"HQ",exact:true}).click();await form.locator('input[name="position"]').fill("Confidential hire");
 await form.getByRole("button",{name:"Department",exact:true}).click();await page.getByRole("option").filter({hasNotText:"Select department"}).first().click();await form.getByRole("button",{name:"Review changes",exact:true}).click();const review=page.getByRole("dialog",{name:"Confirm Save",exact:true});await expect(review).toContainText("Secret requisition");await review.getByRole("button",{name:"Save changes",exact:true}).click();await expect.poll(()=>mock.rpcCalls.find(call=>call.endpoint==="app_upsert_requisition"&&call.payload.doc_id==="REQ-SECRET-UI")?.payload.is_secret).toBe(true);
});
