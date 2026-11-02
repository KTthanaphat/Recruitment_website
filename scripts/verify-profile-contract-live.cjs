// Opt-in verification against a separately provisioned, unmistakable synthetic fixture.
// Credentials/session outputs are local-only and removed after fixture cleanup.
const fs=require('fs');
const assert=require('assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {chromium}=require('@playwright/test');
const output='outputs/profile-redesign-live';
async function main(){
 const env=fs.readFileSync('.env.local','utf8');
 const value=name=>env.match(new RegExp('^'+name+'=(.+)$','m'))?.[1]?.trim().replace(/^["']|["']$/g,'');
 const url=value('NEXT_PUBLIC_SUPABASE_URL'),key=value('NEXT_PUBLIC_SUPABASE_ANON_KEY');
 assert.equal(new URL(url).hostname,'mppnlkldlctvketcsald.supabase.co');
 const credentials=JSON.parse(fs.readFileSync(output+'/credentials.json','utf8'));
 const users={};
 for(const role of ['creator','pic','next']){
  const client=createClient(url,key,{auth:{persistSession:false}});
  const result=await client.auth.signInWithPassword({email:credentials[role],password:credentials.password});if(result.error)throw result.error;
  users[role]={client,session:result.data.session};
 }
 const rpc=async(role,name,payload)=>users[role].client.rpc(name,{payload});
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let id,appId,parallel;
 if(process.argv.includes("--browser")){
  id=JSON.parse(fs.readFileSync(output+"/fixture.json","utf8")).candidate_id;
  const own=await users.pic.client.from("candidate_applications").select("application_id").eq("candidate_id",id).single();
  const moved=await users.next.client.from("candidate_applications").select("application_id").eq("candidate_id",id).single();
  if(own.error||moved.error)throw Error("Live fixture not ready");parallel={data:own.data};appId=moved.data.application_id;
 }else{
 const created=await rpc('creator','app_upsert_candidate_profile_v2',{name:'LIVE PROFILE QA PRIVATE PERSON',phone_no:'0897712345',email:'live-profile-private@example.invalid',position_interests:'LIVE PROFILE QA interests',channel:'LinkedIn',first_contact_date:today,note:'LIVE PROFILE QA private note'});if(created.error)throw created.error;
 id=created.data.candidate_id;
 fs.writeFileSync(output+'/fixture.json',JSON.stringify({candidate_id:id}));
 const protectedProfile=await users.pic.client.from('candidates').select('*').eq('candidate_id',id);assert.equal(protectedProfile.data.length,0);
 const pool=await users.pic.client.rpc('app_masked_candidate_pool_v1');const masked=pool.data.find(row=>row.candidate_id===id);assert(masked);assert(!JSON.stringify(masked).includes('PRIVATE PERSON'));assert(!JSON.stringify(masked).includes('0897712345'));
 console.log('Real unmatched full-profile read denied; safe discovery projection verified.');
 const firstNote=(await users.creator.client.from('candidate_notes').select('*').eq('candidate_id',id).single()).data;
 const concurrent=await Promise.all(['A','B'].map(suffix=>rpc('creator','app_upsert_candidate_note_v2',{candidate_id:id,body:'LIVE PROFILE QA revision '+suffix,expected_note_id:firstNote.note_id,expected_version:firstNote.version})));
 assert.equal(concurrent.filter(row=>!row.error).length,1);assert(concurrent.find(row=>row.error).error.message.includes('PROFILE_NOTE_STALE_WRITE'));
 console.log('Concurrent real note edits: one succeeds, one receives stale-write error.');
 const app=await rpc('creator','app_create_candidate_application_v1',{candidate_id:id,group_id:'LIVE-PROFILE-G1'});if(app.error)throw app.error;
 appId=app.data.application_id;
 assert.equal((await users.creator.client.from('candidate_applications').select('*').eq('application_id',appId)).data.length,0);
 const denied=await rpc('pic','app_upsert_candidate_note_v2',{candidate_id:id,body:'Illegal PIC note edit'});assert(denied.error.message.includes('PROFILE_NOTE_NOT_AUTHORIZED'));
 const stage=(await users.pic.client.from('recruitment_logs').select('*').eq('application_id',appId).single()).data;
 const completion=await rpc('pic','app_complete_pipeline_stage_v2',{candidate_id:id,application_id:appId,stage_instance_id:stage.stage_instance_id,expected_updated_at:stage.updated_at,pending:{opened_date:stage.log_date},outcome:{result:'pass',date:today},next_pending:{stage:'HR Interview',round:1}});if(completion.error)throw completion.error;
 const transfer=await rpc('pic','app_transfer_candidate_application_v1',{candidate_id:id,application_id:appId,group_id:'LIVE-PROFILE-G2',expected_version:1,reason:'LIVE PROFILE QA cross-site transfer'});if(transfer.error)throw transfer.error;
 assert.equal((await users.pic.client.from('candidate_applications').select('*').eq('application_id',appId)).data.length,0);
 const transferred=await users.next.client.from('recruitment_logs').select('*').eq('application_id',appId);assert.equal(transferred.data.length,2);assert(transferred.data.some(row=>row.recruitment_process==='HR Interview'&&row.result===null));
 parallel=await rpc('next','app_create_candidate_application_v1',{candidate_id:id,group_id:'LIVE-PROFILE-G1'});if(parallel.error)throw parallel.error;
 assert.equal((await users.pic.client.from('candidate_applications').select('*').eq('candidate_id',id)).data.length,1);
 assert.equal((await users.next.client.from('candidate_applications').select('*').eq('candidate_id',id)).data.length,1);
 console.log('Cross-site creator matching, PIC stage update/transfer, retained history, and independent journey access verified.');
 }
 const browser=await chromium.launch();
 try{
  async function pageFor(role){const context=await browser.newContext();await context.addInitScript(({session})=>{localStorage.setItem('recruitment_lang','en');localStorage.setItem('sb-mppnlkldlctvketcsald-auth-token',JSON.stringify(session));},{session:users[role].session});return context.newPage();}
  const noteBody='LIVE PROFILE QA browser revision '+Date.now();
 const creator=await pageFor('creator');await creator.goto('http://localhost:3000/candidates?detailType=candidate&detailId='+id);
  await creator.getByRole('heading',{name:'Candidate profile',exact:true}).waitFor();const edit=creator.getByLabel('Edit profile note',{exact:true});await edit.waitFor();await edit.fill(noteBody);await creator.getByRole('button',{name:'Review note',exact:true}).click();await creator.getByRole('dialog',{name:'Confirm Save',exact:true}).getByRole('button',{name:'Save changes',exact:true}).click();
  await creator.getByText(noteBody,{exact:true}).first().waitFor();
  await creator.screenshot({path:output+'/creator-profile.png'});
  const pic=await pageFor('pic');await pic.goto('http://localhost:3000/candidates?detailType=candidate&detailId='+id+'&applicationId='+parallel.data.application_id);
  const tabs=pic.getByRole('tablist',{name:'Candidate applications'});await tabs.waitFor();assert.equal(await tabs.getByRole('tab').count(),1);assert.equal(await pic.getByLabel('Edit profile note',{exact:true}).count(),0);
  await tabs.scrollIntoViewIfNeeded();await pic.screenshot({path:output+'/pic-application.png'});
  await pic.getByRole('button',{name:'Edit profile',exact:true}).click();const profileForm=pic.getByRole('dialog',{name:'Edit Candidate'});await profileForm.waitFor();assert.equal(await profileForm.locator('[name="note"],[name="home_site"],[name="responsible_recruiter_id"]').count(),0);
  await pic.goto('http://localhost:3000/workspace');await pic.getByRole('button',{name:'Cards',exact:true}).waitFor();await pic.getByRole('button',{name:'Cards',exact:true}).click();await pic.getByRole('button',{name:'Table',exact:true}).click();
  console.log('Real authenticated browser: creator note save, isolated application tab, PIC read-only note/profile form, Workspace views passed.');
 }finally{await browser.close();for(const role of Object.keys(users))await users[role].client.auth.signOut();}
 fs.writeFileSync(output+'/verification.json',JSON.stringify({verified:true,candidate_id:id,application_id:appId,parallel_application_id:parallel.data.application_id}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
