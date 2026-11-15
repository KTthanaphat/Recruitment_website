import {expect,test,type Page} from '@playwright/test';
import {Workbook} from 'exceljs';
import {installMockSupabase} from './support/mock-supabase';
const url='/dashboard?lang=en&dashboardTab=performance&performanceSubview=vacancy&dashboardPeriod=custom&dashboardStart=2026-11-07&dashboardEnd=2026-11-13';
async function setup(page:Page,size=55){
 await installMockSupabase(page,{role:'admin_recruiter'});
 const calls:Record<string,any>[]=[];let exporting=false,mode:'ok'|'cycle'='ok',hold:Promise<void>|null=null,release=()=>{};
 const rows=Array.from({length:size},(_,i)=>({doc_id:`EXPORT-${String(i+1).padStart(3,'0')}`,site:'HQ',department:'Ops',section:null,position:`Position ${String(i+1).padStart(3,'0')}`,level:'3',vacancy:1,applicant_count:0,applicant_channels:{},request_type:'New',requisition_date:'2026-11-07',actual_age_days:6,person_in_charge:'Alice',stage_counts:{},sla_state:{ageDays:6,endDate:'2026-11-13',inSla:true,isOverdue:false,label:'In SLA',slaDays:30,startDate:'2026-11-07'},filled_date:null,period_status:'ongoing',period_detail:null}));
 await page.route('**/rest/v1/rpc/app_dashboard_pipeline_summary_v1',r=>r.fulfill({json:{range:{start:'2026-11-07',end:'2026-11-13'},reassignments:{},funnelRows:[],sourceRows:[],channelOptions:[],waterfallRows:[{waterfall_category:'Open',site:'HQ',request_type:'New',vacancy_count:size},{waterfall_category:'Total',site:'HQ',request_type:'New',vacancy_count:size}]}}));
 await page.route('**/rest/v1/rpc/app_dashboard_active_requisitions_page_v1',async route=>{
  const body=route.request().postDataJSON();calls.push(body);
  const ordered=[...rows].sort((a,b)=>a.position.localeCompare(b.position));if(body.p_direction==='desc')ordered.reverse();
  const start=body.p_after_id?ordered.findIndex(r=>r.doc_id===body.p_after_id)+1:0;
  if(exporting&&hold&&(body.p_after_id||size===1))await hold;
  const items=ordered.slice(start,start+25),more=start+items.length<ordered.length,last=items.at(-1);
  await route.fulfill({json:{rows:items,total:ordered.length,hasMore:more,nextCursor:more?(mode==='cycle'&&body.p_after_id?{value:body.p_after_value,id:body.p_after_id}:{value:last!.position,id:last!.doc_id}):null}}).catch(()=>{});
 });
 await page.goto(url);await expect(page.locator('[data-requisition-detail-table]').first().locator('tbody tr')).toHaveCount(Math.min(size,25));
 const closeLookup=page.getByRole('button',{name:'Close lookup',exact:true});if(await closeLookup.isVisible())await closeLookup.click();
 return {calls,begin(){exporting=true;hold=new Promise<void>(resolve=>{release=resolve});},release(){hold=null;release();},mode(value:'ok'|'cycle'){mode=value}};
}
async function openExport(page:Page){await page.getByRole('button',{name:'Export Requisitions Active in Selected Period',exact:true}).click();return page.getByRole('dialog');}
async function workbook(download:import('@playwright/test').Download){const chunks:Buffer[]=[];for await(const chunk of(await download.createReadStream())!)chunks.push(Buffer.from(chunk));const book=new Workbook();await book.xlsx.load(Buffer.concat(chunks));return book;}

test('last-week XLSX export uses Excel progress and downloads every descending page with correct dates',async({page})=>{
 const app=await setup(page);const sort=page.getByRole('button',{name:'Sort Position',exact:true});
 await sort.click();await expect.poll(()=>app.calls.at(-1)?.p_direction).toBe('asc');await expect(page.getByRole('button',{name:'Export Requisitions Active in Selected Period',exact:true})).toBeEnabled();await sort.click();await expect.poll(()=>app.calls.at(-1)?.p_direction).toBe('desc');
 const modal=await openExport(page);app.begin();const done=page.waitForEvent('download');await modal.getByRole('button',{name:'Export Requisitions Active in Selected Period XLSX',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Preparing Excel…'})).toBeVisible();await expect(page.getByText('Preparing PNG…',{exact:true})).toHaveCount(0);
 await expect(modal.getByRole('button',{name:'Export Requisitions Active in Selected Period XLSX',exact:true})).toBeDisabled();app.release();
 const download=await done;expect(download.suggestedFilename()).toBe('active-requisitions-2026-11-07-to-2026-11-13.xlsx');const book=await workbook(download);
 const sheet=book.worksheets[0],headers=sheet.getRow(2).values as string[],column=headers.indexOf('Position');const positions=Array.from({length:sheet.rowCount-2},(_,i)=>sheet.getRow(i+3).getCell(column).value);
 expect(positions).toHaveLength(55);expect(positions[0]).toBe('Position 055');expect(positions[54]).toBe('Position 001');expect(new Set(positions).size).toBe(55);
 expect(JSON.stringify(book.worksheets[1].getSheetValues())).toContain('07/11/2026 - 13/11/2026');expect(app.calls.every(c=>c.p_start==='2026-11-07'&&c.p_end==='2026-11-13'&&c.p_period==='custom')).toBe(true);
});

test('incomplete XLSX pagination shows an Excel error and retry reads fresh pages',async({page})=>{
 const app=await setup(page);app.mode('cycle');const modal=await openExport(page);const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));
 const xlsx=modal.getByRole('button',{name:'Export Requisitions Active in Selected Period XLSX',exact:true});await xlsx.click();
 await expect(modal.getByRole('alert')).toContainText('Could not export the Excel workbook');expect(downloads).toEqual([]);
 const before=app.calls.length;app.mode('ok');const done=page.waitForEvent('download');await xlsx.click();const book=await workbook(await done);expect(book.worksheets[0].rowCount-2).toBe(55);expect(app.calls.length).toBeGreaterThan(before);
});

test('PNG export keeps its own progress label and file format',async({page})=>{
 const app=await setup(page,1);const modal=await openExport(page);app.begin();const done=page.waitForEvent('download');await modal.getByRole('button',{name:'Export Requisitions Active in Selected Period PNG',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Preparing PNG…'})).toBeVisible();await expect(page.getByText('Preparing Excel…',{exact:true})).toHaveCount(0);app.release();
 const download=await done;expect(download.suggestedFilename()).toBe('active-requisitions-2026-11-07-to-2026-11-13.png');
});

test('reversed custom dates do not expose report export actions',async({page})=>{
 await installMockSupabase(page,{role:'admin_recruiter'});await page.goto(url.replace('dashboardEnd=2026-11-13','dashboardEnd=2026-11-06'));
 await expect(page.getByRole('alert').filter({hasText:'Choose valid start and end dates.'})).toBeVisible();await expect(page.getByRole('button',{name:'Export Vacancy Waterfall PNG',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Export Requisitions Active in Selected Period',exact:true})).toHaveCount(0);
});


test('changing custom dates during export prevents an obsolete workbook download',async({page})=>{
 const app=await setup(page);const modal=await openExport(page);app.begin();const downloads:string[]=[];page.on('download',d=>downloads.push(d.suggestedFilename()));
 await modal.getByRole('button',{name:'Export Requisitions Active in Selected Period XLSX',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Preparing Excel…'})).toBeVisible();
 await page.evaluate(()=>{history.pushState(null,'',location.href.replace('dashboardEnd=2026-11-13','dashboardEnd=2026-11-12'));dispatchEvent(new PopStateEvent('popstate'));});
 await expect(page.getByRole('button',{name:'End date',exact:true})).toContainText('12/11/2026');app.release();
 await expect(modal.getByRole('alert')).toContainText('Could not export the Excel workbook');expect(downloads).toEqual([]);
});

test('table sort cycles through ascending, descending and unsorted',async({page})=>{
 const app=await setup(page);const sort=page.getByRole('button',{name:'Sort Position',exact:true});const launcher=page.getByRole('button',{name:'Export Requisitions Active in Selected Period',exact:true});
 for(const direction of ['asc','desc']){await sort.click();await expect.poll(()=>app.calls.at(-1)?.p_direction).toBe(direction);await expect(launcher).toBeEnabled();}
 await sort.click();await expect(page.locator('[data-requisition-detail-table]').first().locator('tbody tr').first()).toContainText('Position 001');
 const modal=await openExport(page);const done=page.waitForEvent('download');await modal.getByRole('button',{name:'Export Requisitions Active in Selected Period XLSX',exact:true}).click();await done;expect(app.calls.at(-1)?.p_direction).toBeNull();
});
