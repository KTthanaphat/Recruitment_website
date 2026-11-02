// Opt-in test-project verification. Provision and remove synthetic fixtures separately.
const fs=require('fs');
const assert=require('assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {chromium}=require('@playwright/test');
async function main(){
 const env=fs.readFileSync('.env.local','utf8');
 const value=name=>env.match(new RegExp('^'+name+'=(.+)$','m'))?.[1]?.trim().replace(/^["']|["']$/g,'');
 const url=value('NEXT_PUBLIC_SUPABASE_URL'),key=value('NEXT_PUBLIC_SUPABASE_ANON_KEY');
 assert.equal(new URL(url).hostname,'mppnlkldlctvketcsald.supabase.co');
 const credentials=JSON.parse(fs.readFileSync('test-results/live-application-credentials.json','utf8'));
 const client=createClient(url,key,{auth:{persistSession:false}});
 const login=await client.auth.signInWithPassword(credentials);if(login.error)throw login.error;
 const rpc=(name,payload)=>client.rpc(name,{payload});
 if(process.argv.includes('--acceptance')){
  const fixture=JSON.parse(fs.readFileSync('test-results/live-application-fixture.json','utf8'));
  const person=await client.from('candidates').select('name,home_site,responsible_recruiter_id').eq('candidate_id',fixture.candidate_id).single();
  assert.equal(person.data?.name,'LIVE QA independent candidate');
  assert.equal(person.data?.home_site,'LIVE-QA');
  assert.equal(person.data?.responsible_recruiter_id,'44444444-4444-4444-4444-444444444444');
  const results=await Promise.all(fixture.applications.map((application_id,index)=>rpc('app_upsert_offer',{mode:'new',candidate_id:fixture.candidate_id,application_id,doc_id:'LIVE-QA-R'+(index+1),accepted_date:'2026-10-11',first_working_date:'2026-10-11'})));
  assert.equal(results.filter(row=>!row.error).length,1,'Only one concurrent acceptance succeeds');
  const offers=await client.from('offers').select('offer_id,accepted_date').eq('candidate_id',fixture.candidate_id);
  assert.equal(offers.data.filter(row=>row.accepted_date).length,1);
  console.log('Live concurrent offer acceptance: exactly one succeeded.');return;
 }
 if(!process.argv.includes("--browser")){
 const profile=await rpc('app_upsert_candidate_profile_v1',{name:'LIVE QA independent candidate',home_site:'LIVE-QA',phone_no:'0898765012',channel:'LinkedIn',position_interests:'QA concurrency',duplicate_acknowledged:true});if(profile.error)throw profile.error;
 const candidate_id=profile.data.candidate_id;
 const attempts=await Promise.all([1,2].map(()=>rpc('app_create_candidate_application_v1',{candidate_id,group_id:'LIVE-QA-G1'})));
 assert.equal(attempts.filter(row=>!row.error).length,1,'Only one concurrent active journey succeeds');
 assert.match(attempts.find(row=>row.error).error.message,/APPLICATION_ALREADY_ACTIVE/);
 const second=await rpc('app_create_candidate_application_v1',{candidate_id,group_id:'LIVE-QA-G2'});if(second.error)throw second.error;
 const applications=[attempts.find(row=>!row.error).data.application_id,second.data.application_id];
 fs.writeFileSync('test-results/live-application-fixture.json',JSON.stringify({candidate_id,applications}));
 console.log('Live concurrent application creation: exactly one succeeded; parallel group journey created.');
 }
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext();
  await context.addInitScript(({session})=>{localStorage.setItem('recruitment_lang','en');localStorage.setItem('sb-mppnlkldlctvketcsald-auth-token',JSON.stringify(session));},{session:login.data.session});
  const page=await context.newPage();
  await page.goto('http://localhost:3000/candidates');
  await page.getByRole('searchbox',{name:/Search name, ID/}).fill('LIVE QA independent candidate');
  await page.locator('button:visible').filter({hasText:'LIVE QA independent candidate'}).first().click();
  await page.getByText('QA position one',{exact:false}).first().waitFor();
  await page.getByText('QA position two',{exact:false}).first().waitFor();
  await page.goto('http://localhost:3000/workspace');
  await page.getByRole('button',{name:'Cards',exact:true}).waitFor();
  await page.getByRole('button',{name:'Cards',exact:true}).click();
  await page.getByRole('button',{name:'Table',exact:true}).click();
  await page.screenshot({path:'test-results/live-workspace.png'});
  console.log('Real authenticated local Candidates and Workspace render; parallel journeys and both views are available.');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
