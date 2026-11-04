import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase, type MockSupabaseContext } from "./support/mock-supabase";
function addFailed(mock: MockSupabaseContext, stage: "Phone Screen" | "HR Interview", count: number) {
 const candidate=mock.data.candidates.find(row=>row.candidate_id==="C-FAILED")??mock.data.candidates[0];
 const application=mock.data.candidate_applications![0],assignment=mock.data.candidate_application_assignments![0];
 const log=mock.data.recruitment_logs.find(row=>row.result===0)!;
 for(let n=0;n<count;n++){
  const suffix=String((stage==="Phone Screen"?710000000000:720000000000)+n),id=`FAIL-${stage}-${n}`,app=`00000000-0000-4000-8000-${suffix}`;
  mock.data.candidates.push({...candidate,candidate_id:id,name:`${stage} Failure ${n}`,nickname:null});
  mock.data.candidate_applications!.push({...application,application_id:app,candidate_id:id,group_id:"GRP-ENG",state:"closed"});
  mock.data.candidate_application_assignments!.push({...assignment,assignment_id:`10000000-0000-4000-8000-${suffix}`,application_id:app,group_id:"GRP-ENG"});
  mock.data.recruitment_logs.push({...log,log_id:Number(suffix),candidate_id:id,application_id:app,recruitment_process:stage,result:0,log_date:"2026-07-20",outcome_date:"2026-07-20",stage_instance_id:`20000000-0000-4000-8000-${suffix}`,superseded_at:null,superseded_by_stage_instance_id:null});
 }
}
for(const population of [0,1,5,6,25,26,101])test(`failed stage owns five-card pages for ${population} candidates`,async({page})=>{
 const mock=await installMockSupabase(page,{role:"admin_recruiter"});addFailed(mock,"Phone Screen",population);
 await page.goto("/pipeline");await expectWorkspaceReady(page);
 const stage=page.locator('[data-failed-stage="Phone Screen"]');await stage.scrollIntoViewIfNeeded();
 await expect(stage.locator('[data-failed-stage-count]')).toHaveText(String(population));
 await expect(stage.locator('[data-candidate-id]')).toHaveCount(Math.min(5,population));
 if(!population){await expect(stage.locator('[data-board-pagination]')).toHaveCount(0);return;}
 const pager=stage.locator('[data-board-pagination]');
 await expect(pager.getByLabel('Current page / total pages')).toHaveText(`1/${Math.ceil(population/5)}`);
 expect(await pager.evaluate(element=>[...element.children].map(child=>child.tagName))).toEqual(["BUTTON","SPAN","BUTTON"]);
 await expect(pager.getByRole('button',{name:'Previous',exact:true})).toHaveCSS('width','28px');
 if(population>5){await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(pager.getByLabel('Current page / total pages')).toHaveText(`2/${Math.ceil(population/5)}`);}
 if(population>25){for(let n=2;n<6;n++)await pager.getByRole('button',{name:'Next',exact:true}).click();await expect(pager.getByLabel('Current page / total pages')).toHaveText(`6/${Math.ceil(population/5)}`);await expect(stage.locator('[data-candidate-id]')).toHaveCount(Math.min(5,population-25));await pager.getByRole('button',{name:'Previous',exact:true}).click();await expect(pager.getByLabel('Current page / total pages')).toHaveText(`5/${Math.ceil(population/5)}`);}
 expect(mock.rpcCalls.filter(call=>call.endpoint==='app_recruitment_list_v1'&&(call.payload.p_filters as Record<string,unknown>)?.boardFilter==='failed').every(call=>Boolean((call.payload.p_filters as Record<string,unknown>).stage)&&call.payload.p_limit===25)).toBe(true);
});

test('one delayed failed stage does not block another stage or share its page',async({page})=>{
 const mock=await installMockSupabase(page,{role:'admin_recruiter'});addFailed(mock,'Phone Screen',26);addFailed(mock,'HR Interview',6);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/rest/v1/rpc/app_recruitment_list_v1',async route=>{const body=route.request().postDataJSON();if(body.p_filters?.boardFilter==='failed'&&body.p_filters?.stage==='HR Interview')await gate;await route.fallback();});
 try{
  await page.goto('/pipeline');await expectWorkspaceReady(page);const phone=page.locator('[data-failed-stage="Phone Screen"]'),hr=page.locator('[data-failed-stage="HR Interview"]');await phone.scrollIntoViewIfNeeded();
  await expect(phone.locator('[data-candidate-id]')).toHaveCount(5);await phone.getByRole('button',{name:'Next',exact:true}).click();await expect(phone.getByLabel('Current page / total pages')).toHaveText('2/6');
  release();await hr.scrollIntoViewIfNeeded();await expect(hr.locator('[data-candidate-id]')).toHaveCount(5);await expect(hr.getByLabel('Current page / total pages')).toHaveText('1/2');
  await hr.getByRole('button',{name:'Next',exact:true}).click();await expect(hr.getByLabel('Current page / total pages')).toHaveText('2/2');await expect(phone.getByLabel('Current page / total pages')).toHaveText('2/6');
  await page.screenshot({path:'outputs/recruiter-read-upgrade/pagination-desktop.png',fullPage:true});
 }finally{release();}
});
for(const language of ['en','th'] as const)test(`compact failed pager preserves phone touch and keyboard targets: ${language}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});const mock=await installMockSupabase(page,{role:'admin_recruiter',language});addFailed(mock,'Phone Screen',6);
 await page.goto('/pipeline?lang='+language);await expectWorkspaceReady(page);const stage=page.locator('[data-failed-stage="Phone Screen"]');await stage.scrollIntoViewIfNeeded();
 await expect(stage.locator('[data-candidate-id]')).toHaveCount(5);const buttons=stage.locator('[data-board-pagination] button');await expect(buttons.first()).toHaveCSS('width','44px');await buttons.last().focus();await page.keyboard.press('Enter');
 await expect(stage.locator('[data-board-pagination] span')).toHaveText('2/2');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`outputs/recruiter-read-upgrade/pagination-phone-${language}.png`,fullPage:true});
});


test('failed stage cards publish before their exact counts and retain independent retry',async({page})=>{
 const mock=await installMockSupabase(page,{role:'admin_recruiter'});addFailed(mock,'Phone Screen',6);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let failed=false;
 await page.route('**/rest/v1/rpc/app_recruitment_list_count_v1',async route=>{const body=route.request().postDataJSON();if(body.p_filters?.boardFilter==='failed')await gate;await route.fallback();});
 await page.route('**/rest/v1/rpc/app_recruitment_list_v1',async route=>{const body=route.request().postDataJSON();if(body.p_filters?.boardFilter==='failed'&&body.p_filters?.stage==='HR Interview'&&!failed){failed=true;await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Stage fixture failure'})});return;}await route.fallback();});
 try{
  await page.goto('/pipeline');await expectWorkspaceReady(page);const phone=page.locator('[data-failed-stage="Phone Screen"]'),hr=page.locator('[data-failed-stage="HR Interview"]');await phone.scrollIntoViewIfNeeded();
  await expect(phone.locator('[data-candidate-id]')).toHaveCount(5);await expect(phone.getByLabel('Current page / total pages')).toHaveText('1/…');
  await phone.getByRole('button',{name:'Next',exact:true}).click();await expect(phone.getByLabel('Current page / total pages')).toHaveText('2/…');
  await hr.scrollIntoViewIfNeeded();await expect(hr.getByRole('alert')).toBeVisible();await hr.getByRole('button',{name:/Retry/}).click();await expect(hr.getByRole('alert')).toHaveCount(0);
  release();await expect(phone.getByLabel('Current page / total pages')).toHaveText('2/2');
 }finally{release();}
});

test('refresh clamps an emptied failed page and filtering resets its page',async({page})=>{
 const mock=await installMockSupabase(page,{role:'admin_recruiter'});addFailed(mock,'Phone Screen',26);
 await page.goto('/pipeline');await expectWorkspaceReady(page);const phone=page.locator('[data-failed-stage="Phone Screen"]');await phone.scrollIntoViewIfNeeded();
 await expect(phone.getByLabel('Current page / total pages')).toHaveText('1/6');for(let n=0;n<5;n++)await phone.getByRole('button',{name:'Next',exact:true}).click();await expect(phone.getByLabel('Current page / total pages')).toHaveText('6/6');
 const removed=mock.data.candidates.find(row=>row.name==='Phone Screen Failure 25')!.candidate_id;
 mock.data.candidates=mock.data.candidates.filter(row=>row.candidate_id!==removed);
 mock.data.candidate_applications=mock.data.candidate_applications!.filter(row=>row.candidate_id!==removed);
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await expect(phone.getByLabel('Current page / total pages')).toHaveText('1/5');
 await page.getByRole('button',{name:'Pipeline filters'}).click();await page.getByPlaceholder('Candidate, ID, role, site, or owner').fill('Phone Screen Failure 0');
 await phone.scrollIntoViewIfNeeded();await expect(phone.getByLabel('Current page / total pages')).toHaveText('1/1');await expect(phone.locator('[data-candidate-id]')).toHaveCount(1);
});
