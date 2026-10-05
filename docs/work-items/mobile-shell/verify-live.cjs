// Inspect explicitly downloaded authorized exports; persist aggregate evidence only.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { Workbook } = require("exceljs");
const directory = process.argv[2];
if (!directory) throw new Error("Pass the download directory");
function latest(prefix, extension) {
 const names = fs.readdirSync(directory).filter(name => name.startsWith(prefix) && name.endsWith(extension)).map(name => path.join(directory, name)).sort((a,b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
 assert(names.length, `Missing ${prefix}${extension}`); return names[0];
}
function rows(book, id) {
 for (const sheet of book.worksheets) {
  const table = sheet.getTable(`Dashboard_bottlenecks_${id}`); if (!table) continue;
  const [, start, end] = table.model.tableRef.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/);
  const headers = sheet.getRow(Number(start)).values;
  return Array.from({length:Number(end)-Number(start)},(_,i) => Object.fromEntries(headers.map((key,column) => key ? [key,sheet.getCell(Number(start)+1+i,column).value] : null).filter(Boolean)));
 }
 throw new Error(`Missing ${id}`);
}
(async () => {
 const observations = [];
 for (const scenario of [{prefix:"stage-bottlenecks-2026-10-01-to-2026-10-05",waiting:3,overdue:1,longest:47,median:null,unavailable:0},{prefix:"stage-bottlenecks-2026-08-01-to-2026-08-31",waiting:2,overdue:0,longest:12,median:0,unavailable:2}]) {
  const book = new Workbook(); await book.xlsx.readFile(latest(scenario.prefix,".xlsx"));
  assert.deepEqual(book.worksheets.map(sheet=>sheet.name),["Summary Data","Source Data"]);
  const metrics = rows(book,"metrics"), metric = name => metrics.find(row=>row.Metric===name).Current;
  const waiting = rows(book,"waiting").filter(row=>row.Period==="Current");
  assert.equal(waiting.length,scenario.waiting); assert.equal(new Set(waiting.map(row=>row["Candidate ID"])).size,scenario.waiting);
  for(const [name,value] of [["Candidates waiting",scenario.waiting],["Overdue",scenario.overdue],["Longest current wait",scenario.longest],["Median stage time",scenario.median],["Historical date unavailable",scenario.unavailable]]) assert.equal(metric(name),value);
  assert.equal(waiting.filter(row=>row.Status==="Overdue").length,scenario.overdue);
  assert.equal(waiting.filter(row=>row.Status==="Historical date unavailable").length,scenario.unavailable);
  assert.equal(rows(book,"stats").reduce((total,row)=>total+Number(row["Candidates waiting"]??0),0),scenario.waiting);
  observations.push({...scenario,sheets:2,reconciled:true});
 }
 const bytes=fs.readFileSync(latest("stage-bottlenecks-2026-10-01-to-2026-10-05",".png"));
 assert.equal(bytes.subarray(1,4).toString(),"PNG"); assert(bytes.length>10000);
 const image={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length,generationNonblankValidation:true}; assert(image.width>=2000&&image.height>500);
 const evidence={verifiedAt:new Date().toISOString(),project:"mppnlkldlctvketcsald",role:"Authenticated system administrator Phat",scope:"All common/header filters; Channel all; October MTD 1–5 and August PIM",observations,image,screenCards:0,pngCards:4,screenBanner:{background:"#FFFFFF",border:"#FF8A00"},limitations:"August has two unrecoverable historical deadlines; current October has no valid completed-stage duration."};
 fs.mkdirSync(path.join(__dirname,"evidence"),{recursive:true}); fs.writeFileSync(path.join(__dirname,"evidence/live-reconciliation.json"),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({scenarios:observations.length,reconciled:true,sheets:2,png:image}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
