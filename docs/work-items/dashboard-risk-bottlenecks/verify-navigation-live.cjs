// Read explicitly downloaded workbooks; persist aggregates only, never candidate identity.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { Workbook } = require('exceljs');
const directory = process.argv[2];
if (!directory) throw new Error('Pass the directory containing the verified downloads');
function latest(prefix, extension = '.xlsx') {
  const files = fs.readdirSync(directory).filter(name => name.startsWith(prefix) && name.endsWith(extension)).map(name => path.join(directory, name)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  assert(files.length, `Missing ${prefix}${extension}`); return files[0];
}
function rows(book, report, id) {
  for (const ws of book.worksheets) {
    const table = ws.getTable(`Dashboard_${report}_${id}`); if (!table) continue;
    const [, start, end] = table.model.tableRef.match(/^[A-Z]+(\d+):[A-Z]+(\d+)$/);
    const headers = ws.getRow(Number(start)).values;
    return Array.from({ length: Number(end) - Number(start) }, (_, i) => Object.fromEntries(headers.map((key, col) => key ? [key, ws.getCell(Number(start) + 1 + i, col).value] : null).filter(Boolean)));
  }
  throw new Error(`Missing ${report}/${id}`);
}
const sum = (records, key) => records.reduce((n, row) => n + Number(row[key] ?? 0), 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const scenarios = [
  { report: 'risk', prefix: 'vacancy-risk-2026-10-04', open: 10, overdue: 9, near: 0, priority: 1, priorityOpen: 1 },
  { report: 'risk', prefix: 'vacancy-risk-2026-08-31', open: 9, overdue: 3, near: 1, priority: 0, priorityOpen: 1 },
  { report: 'bottlenecks', prefix: 'stage-bottlenecks-2026-10-01-to-2026-10-04', waiting: 3, median: null, overdue: 1, longest: 46, unavailable: 0 },
  { report: 'bottlenecks', prefix: 'stage-bottlenecks-2026-08-01-to-2026-08-31', waiting: 2, median: 0, overdue: 0, longest: 12, unavailable: 2 }
];
(async () => {
  const observations = [];
  for (const scenario of scenarios) {
    const book = new Workbook(); await book.xlsx.readFile(latest(scenario.prefix));
    assert.deepEqual(book.worksheets.map(ws => ws.name), ['Summary Data', 'Source Data']);
    const metrics = rows(book, scenario.report, 'metrics');
    const metric = name => metrics.find(row => row.Metric === name);
    if (scenario.report === 'risk') {
      const source = rows(book, 'risk', 'requisitions').filter(row => row.Period === 'Current');
      assert.equal(sum(source, 'Open headcount'), scenario.open);
      assert.equal(metric('Open headcount').Current, scenario.open);
      assert.equal(metric('Open priority headcount').Current, scenario.priorityOpen);
      assert.equal(sum(source.filter(row => row.Priority === 1), 'Open headcount'), scenario.priorityOpen);
      for (const [name, count, denominator] of [['Overdue', scenario.overdue, scenario.open], ['Approaching SLA', scenario.near, scenario.open], ['Priority at risk', scenario.priority, scenario.priorityOpen]]) {
        const row = metric(name); assert.equal(row.Current, count); assert.equal(row['Current denominator'], denominator); close(row['Current share'], count / denominator);
      }
      assert.equal(sum(source.filter(row => row.Priority === 1 && ['Overdue', 'Approaching SLA'].includes(row.Status)), 'Open headcount'), scenario.priority);
      assert.equal(sum(rows(book, 'risk', 'groups'), 'Total'), scenario.open);
    } else {
      for (const [name, value] of [['Candidates waiting', scenario.waiting], ['Median stage time', scenario.median], ['Overdue', scenario.overdue], ['Longest current wait', scenario.longest], ['Historical date unavailable', scenario.unavailable]]) assert.equal(metric(name).Current, value);
      const waiting = rows(book, 'bottlenecks', 'waiting').filter(row => row.Period === 'Current');
      assert.equal(waiting.length, scenario.waiting); assert.equal(new Set(waiting.map(row => row['Candidate ID'])).size, scenario.waiting);
      assert.equal(waiting.filter(row => row.Status === 'Overdue').length, scenario.overdue);
      assert.equal(waiting.filter(row => row.Status === 'Historical date unavailable').length, scenario.unavailable);
      assert.equal(sum(rows(book, 'bottlenecks', 'stats'), 'Candidates waiting'), scenario.waiting);
    }
    observations.push({ ...scenario, reconciled: true, sheets: 2 });
  }
  const performance = new Workbook(); await performance.xlsx.readFile(latest('recruitment-performance-2026-10-01-to-2026-10-04'));
  assert.equal(rows(performance, 'performance', 'kpi').some(row => row.Metric === 'AVG Time-to-Fill'), true);
  const images = ['vacancy-risk-2026-10-04', 'stage-bottlenecks-2026-10-01-to-2026-10-04'].map(prefix => {
    const bytes = fs.readFileSync(latest(prefix, '.png')); assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert.ok(bytes.length > 10000);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20); assert.ok(width >= 2000 && height > 500);
    return { report: prefix, width, height, bytes: bytes.length, generationNonblankValidation: true };
  });
  const evidence = { project: 'mppnlkldlctvketcsald', verifiedAt: new Date().toISOString(), role: 'Authenticated system administrator (Phat)', scope: 'All header/common filters, Priority all, Channel all; October MTD and August PIM', observations, performanceAvgRetained: true, images, limitation: 'Two August deadlines are historically unavailable; October has no completed-stage duration. Fresh current open headcount is 10; earlier acceptance evidence used 9 before the live population changed.' };
  fs.writeFileSync(path.join(__dirname, 'evidence', 'navigation-summary-live-reconciliation.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ scenarios: observations.length, reconciled: true, performanceAvgRetained: true, pngDownloads: images.length }));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
