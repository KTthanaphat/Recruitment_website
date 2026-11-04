// Authenticated read-view measurements. Never writes auth state or saves request/response bodies.
const {chromium}=require('@playwright/test');const fs=require('node:fs');const path=require('node:path');const {performance}=require('node:perf_hooks');
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const n=arg.indexOf('=');return [arg.slice(0,n),arg.slice(n+1)];}));
if(!args['--base-url']||!args['--storage-state']||!args['--manifest']||!args['--role'])throw Error('Required: --base-url=ORIGIN --storage-state=LOCAL_FILE --manifest=LOCAL_JSON --role=LABEL [--samples=30]');
const samples=Number(args['--samples']??30);if(!Number.isSafeInteger(samples)||samples<30)throw Error('At least 30 samples are required');
const cases=JSON.parse(fs.readFileSync(args['--manifest'],'utf8'));
for(const item of cases)if(!/^[a-z0-9:_-]+$/i.test(item.label)||!item.path?.startsWith('/')||!item.readySelector||!item.warmSetupSelector||!item.warmActionSelector)throw Error('Each case needs a safe label, same-origin path, ready selector, and view-only warm setup/action selectors');
const base=new URL(args['--base-url']);if(!['http:','https:'].includes(base.protocol)||base.username||base.password)throw Error('Use an application origin without credentials');
(async()=>{const browser=await chromium.launch();const results=[];try{
 for(const item of cases)for(let n=0;n<samples;n++){
  const context=await browser.newContext({storageState:args['--storage-state']});
  await context.addInitScript(()=>{window.__recruitmentMeasureReads=true;window.__readPhases=[];window.addEventListener('recruitment:read-timing',event=>window.__readPhases.push(event.detail));});
  const page=await context.newPage(),starts=new WeakMap(),reads=[];
  page.on('request',request=>{if(request.url().includes('/rest/v1/'))starts.set(request,performance.now());});
  page.on('response',response=>{const request=response.request(),started=starts.get(request);if(started===undefined)return;const parts=new URL(response.url()).pathname.split('/'),label=parts.at(-1);if(!/^[a-z0-9_]+$/i.test(label))return;reads.push({endpoint:label,status:response.status(),durationMs:performance.now()-started,finishedAt:performance.now()});});
  for(const cache of ['cold-application','warm-application']){
   let started=performance.now(),offset=reads.length;
   await page.evaluate(()=>{window.__readPhases=[];}).catch(()=>{});
   if(cache==='cold-application')await page.goto(new URL(item.path,base).href);
   else{await page.locator(item.warmSetupSelector).click();await page.waitForTimeout(100);offset=reads.length;await page.evaluate(()=>{window.__readPhases=[];});started=performance.now();await page.locator(item.warmActionSelector).click();}
   await page.locator(item.readySelector).first().waitFor({state:'visible',timeout:20000});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const displayed=performance.now(),completed=reads.slice(offset),phases=await page.evaluate(()=>window.__readPhases);
   results.push({view:item.label,cache,interactionToDisplayMs:displayed-started,lastCompletedReadToDisplayMs:completed.length?displayed-completed.at(-1).finishedAt:null,
    reads:completed.map(({endpoint,status,durationMs})=>({endpoint,status,durationMs})),scheduledReads:phases});
  }await context.close();
 }
 const summaries=[];for(const item of cases)for(const cache of ['cold-application','warm-application']){const rows=results.filter(row=>row.view===item.label&&row.cache===cache),values=rows.map(row=>row.interactionToDisplayMs).sort((a,b)=>a-b);summaries.push({view:item.label,cache,observations:rows.length,medianMs:values[Math.ceil(values.length*.5)-1],p95Ms:values[Math.ceil(values.length*.95)-1],httpFailures:rows.flatMap(row=>row.reads).filter(read=>read.status>=400).length});}
 const output=path.resolve(__dirname,'../outputs/recruiter-read-upgrade/browser-'+args['--role'].replace(/[^a-z0-9_-]/gi,'_')+'.json');fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({roleLabel:args['--role'],measuredAt:new Date().toISOString(),note:'Cold refers to application cache. Display uses two animation frames after a visible selector. Last-completed-read delay is a browser approximation, not SQL time. Manifests must use view/tab controls only.',summaries,results},null,2));console.log(JSON.stringify({output,summaries}));
 }finally{await browser.close();}})().catch(()=>{console.error('Recruiter view measurement failed. Check authentication, selectors, readable fixture data, and reachability.');process.exitCode=1;});
