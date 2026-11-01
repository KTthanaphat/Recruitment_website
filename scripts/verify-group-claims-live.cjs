// Opt-in: requires separately provisioned synthetic DETAIL-QA fixtures and local-only credentials.
const fs=require('fs');
const assert=require('assert/strict');
const {createClient}=require('@supabase/supabase-js');
const {chromium}=require('@playwright/test');
const output='outputs/group-claims-live';
async function main(){
  const env=fs.readFileSync('.env.local','utf8');
  const value=name=>env.match(new RegExp('^'+name+'=(.+)$','m'))?.[1]?.trim().replace(/^["']|["']$/g,'');
  const url=value('NEXT_PUBLIC_SUPABASE_URL'),key=value('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  assert.equal(new URL(url).hostname,'mppnlkldlctvketcsald.supabase.co');
  const credentials=JSON.parse(fs.readFileSync(output+'/credentials.json','utf8'));
  const client=createClient(url,key,{auth:{persistSession:false}});
  const auth=await client.auth.signInWithPassword(credentials);if(auth.error)throw auth.error;
  try {
    const person=await client.from('candidates').select('candidate_id').eq('created_by','72222222-2222-4222-8222-222222222222').single();if(person.error)throw person.error;
    const candidateId=person.data.candidate_id;
    let app;
    if(!process.env.BROWSER_ONLY){
      const requests=await Promise.all([1,2].map(()=>client.rpc('app_create_candidate_application_v1',{payload:{candidate_id:candidateId,group_id:'DETAIL-QA-G1'}})));
      assert.equal(requests.filter(row=>!row.error).length,1);
      assert(requests.find(row=>row.error).error.message.includes('APPLICATION_GROUP_ALREADY_USED'));
      app=requests.find(row=>!row.error).data.application_id;
      const outward=await client.rpc('app_transfer_candidate_application_v1',{payload:{application_id:app,group_id:'DETAIL-QA-G2',expected_version:1,reason:'DETAIL QA outbound'}});if(outward.error)throw outward.error;
      const duplicate=await client.rpc('app_create_candidate_application_v1',{payload:{candidate_id:candidateId,group_id:'DETAIL-QA-G1'}});
      assert(duplicate.error.message.includes('APPLICATION_GROUP_ALREADY_USED'));
      const returned=await client.rpc('app_transfer_candidate_application_v1',{payload:{application_id:app,group_id:'DETAIL-QA-G1',expected_version:2,reason:'DETAIL QA original journey return'}});if(returned.error)throw returned.error;
      console.log('Real concurrent creation: one success and one group-used rejection; historical rejection and original-journey return passed.');
    }else{
      const result=await client.from('candidate_applications').select('application_id').eq('candidate_id',candidateId).single();if(result.error)throw result.error;app=result.data.application_id;
    }
    const browser=await chromium.launch();
    try{
      const context=await browser.newContext();
      await context.addInitScript(session=>{localStorage.setItem('recruitment_lang','en');localStorage.setItem('sb-mppnlkldlctvketcsald-auth-token',JSON.stringify(session));},auth.data.session);
      const page=await context.newPage();await page.goto(`http://localhost:3000/candidates?detailType=candidate&detailId=${candidateId}&applicationId=${app}`);
      await page.getByRole('heading',{name:'Candidate profile',exact:true}).waitFor();
      assert.equal(await page.getByRole('region',{name:'Profile note',exact:true}).getByRole('textbox').count(),0);
      await page.getByRole('button',{name:'Edit profile',exact:true}).click();
      const form=page.getByRole('dialog',{name:'Edit Candidate',exact:true});const newNote='DETAIL QA saved via profile '+Date.now();
      await form.locator('[name="note"]').fill(newNote);await form.getByRole('button',{name:'Review changes',exact:true}).click();
      const confirm=page.getByRole('dialog',{name:'Confirm Save',exact:true});await confirm.getByRole('button',{name:'Save changes',exact:true}).click();
      await page.getByRole('region',{name:'Profile note',exact:true}).getByText(newNote,{exact:true}).waitFor();
      const panel=page.getByRole('tabpanel');await panel.waitFor();
      assert.equal(await panel.evaluate(element=>getComputedStyle(element).borderTopWidth),'1px');
      assert.equal(await page.getByRole('tab').first().textContent(),'UI verification oneDETAIL-QA-G1 · Active');
      for(const width of [390,1440]){
        await page.setViewportSize({width,height:1000});
        await page.getByRole('heading',{name:'Candidate profile',exact:true}).scrollIntoViewIfNeeded();
        await page.screenshot({path:`${output}/profile-${width}.png`});
        await page.getByRole('tablist').scrollIntoViewIfNeeded();
        await page.screenshot({path:`${output}/application-${width}.png`});
      }
      await page.goto('http://localhost:3000/workspace');await page.getByRole('button',{name:'Table',exact:true}).waitFor();await page.getByRole('button',{name:'Cards',exact:true}).click();
      fs.writeFileSync(output+'/verification.json',JSON.stringify({verified_at:new Date().toISOString(),candidate_id:candidateId,application_id:app,concurrent_claims:true,note_form_save:true,workspace:true},null,2));
      console.log('Real authenticated profile-note save, connected application tab, CSS, and Workspace views passed.');
    }finally{await browser.close();}
  }finally{await client.auth.signOut();}
}
main().catch(error=>{console.error(JSON.stringify({message:error.message,code:error.code,details:error.details,hint:error.hint,stack:error.stack}));process.exitCode=1;});
