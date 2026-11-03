import {expect,test} from "@playwright/test";
import {installMockSupabase,expectWorkspaceReady} from "./support/mock-supabase";

test("cards and cursor navigation remain usable while exact counts are blocked; offscreen stages stay lazy",async({page})=>{
 test.setTimeout(60000);
 const mock=await installMockSupabase(page);
 const candidate=mock.data.candidates[0],application=mock.data.candidate_applications![0],assignment=mock.data.candidate_application_assignments![0],log=mock.data.recruitment_logs[0];
 for(let n=1;n<=101;n++){
  const suffix=String(970000000000+n),id='CAN-LAT-'+String(n).padStart(3,'0'),app='00000000-0000-4000-8000-'+suffix;
  mock.data.candidates.push({...candidate,candidate_id:id,name:'Latency '+String(n).padStart(3,'0'),nickname:null,updated_at:'2026-07-01T00:00:00Z'});
  mock.data.candidate_applications!.push({...application,application_id:app,candidate_id:id,group_id:'GRP-ENG',state:'active'});
  mock.data.candidate_application_assignments!.push({...assignment,assignment_id:'20000000-0000-4000-8000-'+suffix,application_id:app,group_id:'GRP-ENG'});
  mock.data.recruitment_logs.push({...log,log_id:97000+n,candidate_id:id,application_id:app,stage_instance_id:'30000000-0000-4000-8000-'+suffix,recruitment_process:'Phone Screen',result:null,log_date:'2026-07-01',outcome_date:null});
 }
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/rest/v1/rpc/app_recruitment_list_count_v1',async route=>{await gate;await route.fallback();});
 try {
  await page.goto('/pipeline');await expectWorkspaceReady(page);
  await page.getByRole('button',{name:'Pipeline filters'}).click();await page.getByPlaceholder('Candidate, ID, role, site, or owner').fill('Latency');
  const phone=page.locator('section[data-pipeline-stage="Phone Screen"]');
  await expect(phone.getByText('Latency 001',{exact:true})).toBeVisible();
  await expect(phone.getByLabel('Current page / total pages')).toHaveText('1/…');
  expect(mock.rpcCalls.some(call=>call.endpoint==='app_recruitment_list_v1'&&(call.payload.p_filters as {stage?:string}).stage==='Test')).toBe(false);
  for(let n=0;n<5;n++)await phone.getByRole('button',{name:'Next',exact:true}).click();
  await expect(phone.getByLabel('Current page / total pages')).toHaveText('6/…');
  await expect(phone.getByText('Latency 026',{exact:true})).toBeVisible();
  await phone.getByRole('button',{name:'Previous',exact:true}).click();
  await expect(phone.getByText('Latency 021',{exact:true})).toBeVisible();
  const calls=mock.rpcCalls.filter(call=>call.endpoint==='app_recruitment_list_v1'&&call.payload.p_entity==='pipeline_stage'&&(call.payload.p_filters as {stage?:string}).stage==='Phone Screen'&&call.payload.p_search==='Latency');
  expect(calls.every(call=>call.payload.p_limit===25)).toBe(true);expect(calls.length).toBeLessThanOrEqual(3);
  await page.locator('section[data-pipeline-stage="Test"]').focus();
  await expect.poll(()=>mock.rpcCalls.some(call=>call.endpoint==='app_recruitment_list_v1'&&(call.payload.p_filters as {stage?:string}).stage==='Test')).toBe(true);
 }finally{release();}
});

test("a committed stage move removes the source and reveals its destination while optional refreshes are delayed",async({page})=>{
 const mock=await installMockSupabase(page,{role:'admin_recruiter'});
 await page.goto('/pipeline');await expectWorkspaceReady(page);
 await page.getByRole('button',{name:'Candidate actions for Pat Phone'}).click();
 await page.getByRole('menu').getByRole('menuitem').filter({hasText:'Pass stage'}).click();
 const dialog=page.getByRole('dialog',{name:/Pass .*stage|Complete Stage/i});
 await dialog.getByRole('button',{name:'Review changes'}).click();
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/rest/v1/rpc/app_pipeline_summary_v1',async route=>{await gate;await route.fallback();});
 try{
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.locator('section[data-pipeline-stage="Phone Screen"] [data-candidate-id="C-PHONE"]')).toHaveCount(0);
  const destination=page.locator('section[data-pipeline-stage="HR Interview"] [data-candidate-id="C-PHONE"]');
  await expect(destination).toBeVisible();
  await expect.poll(()=>mock.rpcCalls.some(call=>call.endpoint==='app_candidate_action_v1')).toBe(true);
  await expect.poll(()=>mock.rpcCalls.some(call=>call.endpoint==='app_pipeline_card_location_v1')).toBe(true);
 }finally{release();}
});

for(const language of ['en','th'] as const)test('phone embedded Pipeline opens only the selected stage: '+language,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 const mock=await installMockSupabase(page,{language,role:'admin_recruiter'});
 await page.goto('/workspace?type=group&id=GRP-ENG&section=pipeline&lang='+language);await expectWorkspaceReady(page);
 const stages=page.locator('[data-workspace-pipeline-stages]');await expect(stages).toBeVisible();
 expect(mock.rpcCalls.some(call=>call.endpoint==='app_recruitment_list_v1'&&call.payload.p_entity==='pipeline_stage'&&(call.payload.p_filters as {stage?:string}).stage==='Phone Screen')).toBe(false);
 await stages.locator('details[data-pipeline-stage="Phone Screen"] summary').click();
 await expect(stages.getByText('Pat Phone',{exact:true})).toBeVisible();
});
