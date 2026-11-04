// Read-only authenticated browser measurement. Supply an existing Playwright storage-state file.
// Never writes auth state, URLs, identifiers, RPC bodies, or response data into results.
const { chromium } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const args = Object.fromEntries(process.argv.slice(2).map(arg => {const i=arg.indexOf('=');return [arg.slice(0,i),arg.slice(i+1)];}));
if (!args['--base-url'] || !args['--storage-state'] || !args['--group-id'] || !args['--role']) throw Error('Required: --base-url=URL --storage-state=PATH --group-id=ID --role=ROLE [--samples=30]');
const samples=Number(args['--samples']??30);
if(!Number.isSafeInteger(samples)||samples<30) throw Error('Use at least 30 observations per view/cache condition');
const base=new URL(args['--base-url']);
if(!['http:','https:'].includes(base.protocol)||base.username||base.password) throw Error('Use an HTTP(S) application origin without credentials');
const output=path.resolve(__dirname,'../outputs/sourcing-records/browser-phases.json');
const quantile=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
async function waitTiming(page,view,after) {
  await page.waitForFunction(({view,after})=>window.__sourcingPhases?.slice(after).some(row=>row.view===view),{view,after},{timeout:20000});
  return page.evaluate(({view,after})=>window.__sourcingPhases.slice(after).filter(row=>row.view===view).at(-1),{view,after});
}
(async()=>{
 const browser=await chromium.launch();const rows=[];
 try {
  for(const view of ['board','history','selected-week']) for(let n=0;n<samples;n++) {
   const context=await browser.newContext({storageState:args['--storage-state']});
   await context.addInitScript(()=>{window.__sourcingPhases=[];window.addEventListener('recruitment:sourcing-display',event=>window.__sourcingPhases.push(event.detail));});
   const page=await context.newPage();const target=new URL(view==='selected-week'?'/workspace':'/sourcing',base);
   target.searchParams.set('lang','en');
   if(view==='selected-week'){target.searchParams.set('type','group');target.searchParams.set('id',args['--group-id']);target.searchParams.set('section','sourcing');}
   let start=performance.now();await page.goto(target.href);
   if(view==='history'){await waitTiming(page,'board',0);start=performance.now();await page.getByRole('button',{name:'Lifecycle history',exact:true}).click();}
   let timing=await waitTiming(page,view,0);
   rows.push({view,cache:'cold-application',interactionToDisplayMs:performance.now()-start,...timing});
   if(view==='selected-week') await page.getByRole('tab',{name:'Overview',exact:true}).click();
   else await page.getByRole('button',{name:view==='board'?'Lifecycle history':'Work board',exact:true}).click();
   const after=await page.evaluate(()=>window.__sourcingPhases.length);start=performance.now();
   if(view==='selected-week') await page.getByRole('tab',{name:'Sourcing',exact:true}).click();
   else await page.getByRole('button',{name:view==='board'?'Work board':'Lifecycle history',exact:true}).click();
   timing=await waitTiming(page,view,after);
   rows.push({view,cache:'warm-application',interactionToDisplayMs:performance.now()-start,...timing});
   await context.close();
  }
  const summaries=[];
  for(const view of ['board','history','selected-week']) for(const cache of ['cold-application','warm-application']) {
   const group=rows.filter(row=>row.view===view&&row.cache===cache);const stats={view,cache,observations:group.length};
   for(const field of ['queueMs','requestMs','responseToDisplayMs','interactionToDisplayMs']) stats[field]={median:quantile(group.map(row=>row[field]),.5),p95:quantile(group.map(row=>row[field]),.95)};
   summaries.push(stats);
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({roleLabel:args['--role'],measuredAt:new Date().toISOString(),note:'Display is approximated by two animation frames after the React commit. Cold refers to application cache, not database cache. Browser RPC duration is not SQL execution time.',summaries,rows},null,2));
  console.log(JSON.stringify({output,summaries}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
