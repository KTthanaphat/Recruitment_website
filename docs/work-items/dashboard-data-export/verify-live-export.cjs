// Reads only explicitly supplied downloads; persists aggregate verification, never identities.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), { Workbook } = require("exceljs");
const directory = __dirname, expected = JSON.parse(fs.readFileSync(path.join(directory,"evidence/live-expected.json"),"utf8"));
const sectionIds = { "Requisitions":"requisitions", "Acceptances":"acceptances", "KPI Summary":"kpi", "Pipeline Summary":"pipeline", "Source Summary":"sources", "Sourcing Rows":"sourcing", "Stage Records":"stages", "Hire Records":"hires" };
function rows(book, title) {
 for(const ws of book.worksheets) for(const report of ["performance","pipeline"]) {
  const table=ws.getTable(`Dashboard_${report}_${sectionIds[title]}`);if(!table)continue;
  const match=table.model.tableRef.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/),start=Number(match[1]),end=Number(match[2]);
  const headers=ws.getRow(start).values;
  return Array.from({length:end-start},(_,i)=>Object.fromEntries(headers.map((name,col)=>name?[name,ws.getCell(start+i+1,col).value]:null).filter(Boolean)));
 }
 throw new Error(`Missing table: ${title}`);
}
(async()=>{const [performanceFile,pipelineFile,scenario="aug-pim"] = process.argv.slice(2);const current=expected.scenarios.find(row=>row.scenario===scenario);assert(current,"Known scenario required");
 const performance = new Workbook(),pipeline = new Workbook();await performance.xlsx.readFile(performanceFile);await pipeline.xlsx.readFile(pipelineFile);
 assert.deepEqual(performance.worksheets.map(ws=>ws.name),["Summary Data","Source Data"]);assert.deepEqual(pipeline.worksheets.map(ws=>ws.name),["Summary Data","Source Data"]);
 const results=[],eq=(field,a,b)=>{assert.deepEqual(a,b,field);results.push({field,actual:a,expected:b});};
 const req=rows(performance,"Requisitions").filter(row=>row.Period==="Current"),accepted=rows(performance,"Acceptances").filter(row=>row.Period==="Current");const sum=(rs,key)=>rs.reduce((n,row)=>n+Number(row[key]??0),0);
 eq("Performance vacancies",sum(req,"Vacancies"),current.performance.vacancies);eq("Performance fills",sum(req,"Filled"),current.performance.filled);eq("Acceptance contributions",sum(accepted,"Fill Contribution"),current.performance.filled);
 eq("Performance on-time",sum(req,"On-time"),current.performance.on_time);eq("Performance late",sum(req,"Late"),current.performance.late);
 const timeCount=sum(req,"Time-to-fill Contribution"),timeTotal=sum(req,"Time-to-fill Day Total");eq("Average time-to-fill",timeCount?timeTotal/timeCount:null,current.performance.avg_ttf);
 const kpi=rows(performance,"KPI Summary");eq("KPI vacancies",kpi.find(row=>row.Metric==="Vacancies")["Current Value"],current.performance.vacancies);eq("KPI fills",kpi.find(row=>row.Metric==="Filled")["Current Value"],current.performance.filled);
 const funnel=rows(pipeline,"Pipeline Summary");for(const row of funnel){const expectedCount=row.Stage==="Applicants"?current.source.reduce((n,s)=>n+s.applicants,0):row.Stage==="Resume Screening"?current.resume_screening:current.pipeline[row.Stage==="Phone Screening"?"Phone Screen":row.Stage]??0;eq(`Pipeline ${row.Stage}`,row.Count,expectedCount);}
 const source=rows(pipeline,"Source Summary");eq("Source per channel",source.map(row=>({label:row.Channel,applicants:row.Applicants,phone:row["Phone Screening"],hired:row.Hired})).sort((a,b)=>a.label.localeCompare(b.label)),current.source.map(row=>({label:row.label,applicants:row.applicants,phone:row.phone,hired:row.hired})).sort((a,b)=>a.label.localeCompare(b.label)));
 eq("Sourcing contributions",sum(rows(pipeline,"Sourcing Rows"),"Applicants Contribution"),current.source.reduce((n,row)=>n+row.applicants,0));eq("Phone contributions",sum(rows(pipeline,"Stage Records"),"Source Phone Contribution"),current.source.reduce((n,row)=>n+row.phone,0));eq("Hire contributions",sum(rows(pipeline,"Hire Records"),"Hired Contribution"),current.source.reduce((n,row)=>n+row.hired,0));
 const report={project:expected.project,date:expected.date,scenario,role:"authenticated system administrator",scope:"August 2026 PIM; header All Site/PIC/Priority; common All Site/Department/Level; Channel All",checks:results.length,results,performanceSheets:performance.worksheets.map(s=>s.name),pipelineSheets:pipeline.worksheets.map(s=>s.name)};
 fs.writeFileSync(path.join(directory,`evidence/live-${scenario}.json`),JSON.stringify(report,null,2));console.log(JSON.stringify({scenario,checks:results.length,passed:true,performanceSheets:performance.worksheets.length,pipelineSheets:pipeline.worksheets.length}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
