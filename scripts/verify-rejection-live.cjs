// Opt-in development verification. Uses a temporary auth/profile account, never writes recruitment records.
// The account is deleted in finally; its ID-only recovery marker is in ignored outputs/ if interrupted.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('@playwright/test');
const { Workbook } = require('exceljs');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'outputs/rejection-dashboard');
const preview = process.env.REJECTION_PREVIEW_URL ?? 'http://localhost:3000';
assert(['localhost', '127.0.0.1'].includes(new URL(preview).hostname), 'Live verification requires a loopback preview');
const marker = path.join(output, 'live-verification-user.json');
fs.mkdirSync(output, { recursive: true });
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const value = name => env.match(new RegExp('^' + name + '=(.+)$', 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '');
const url = value('NEXT_PUBLIC_SUPABASE_URL');
assert.equal(new URL(url).hostname, 'mppnlkldlctvketcsald.supabase.co');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, value('SUPABASE_SERVICE_ROLE_KEY'), options);
const client = createClient(url, value('NEXT_PUBLIC_SUPABASE_ANON_KEY'), options);
const anon = createClient(url, value('NEXT_PUBLIC_SUPABASE_ANON_KEY'), options);
// Load the actual TypeScript model, without adding a runtime dependency or emitting source files.
const ts = require('typescript');
const Module = require('module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, ...args); };
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file);
const { loadDashboardData, enrichRequisitions } = require('../src/lib/data.ts');
const { loadExtendedDashboardReport } = require('../src/lib/dashboard-report-loader.ts');
const { buildRejectionReport } = require('../src/lib/rejection-report.ts');
let userId, browser;
const evidence = { project: 'mppnlkldlctvketcsald', verifiedAt: new Date().toISOString(), recruitmentWrites: 0, schemaChanges: 0 };
async function cleanup(id) {
  const result = await admin.auth.admin.deleteUser(id);
  if (result.error) throw new Error('Temporary verification account cleanup failed: ' + result.error.message);
  fs.rmSync(marker, { force: true });
}
async function main() {
  if (!process.argv.includes('--run')) throw new Error('Explicit --run is required for temporary account provisioning.');
  if (fs.existsSync(marker)) { await cleanup(JSON.parse(fs.readFileSync(marker, 'utf8')).id); console.log('Recovered and removed an interrupted verification account.'); }
  const settings = await fetch(url + '/auth/v1/settings', { headers: { apikey: value('NEXT_PUBLIC_SUPABASE_ANON_KEY') }, signal: AbortSignal.timeout(15000) });
  assert(settings.ok, 'Development auth is not ready: HTTP ' + settings.status);
  const email = 'rejection-verification-' + Date.now() + '@example.invalid', password = crypto.randomBytes(24).toString('base64url');
  try {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    fs.writeFileSync(marker, JSON.stringify({ id: userId, project: evidence.project }));
    const profile = await admin.from('profiles').upsert({ id: userId, email, full_name: 'Temporary rejection report verification', nickname: 'Rejection verification', site: null, role: 'admin_recruiter' });
    if (profile.error) throw profile.error;
    const signedIn = await client.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    const probe = await client.from('recruitment_logs').select('log_id,application_id,outcome_assignment_id,stage_instance_id,outcome_date,failure_actor,failure_main_reason_id,failure_detail_reason_id,failure_reason_snapshot').limit(1);
    if (probe.error) throw probe.error;
    evidence.authenticatedColumnsReadable = true;
    const anonymous = await anon.from('recruitment_logs').select('log_id').limit(1);
    assert(!anonymous.data?.length, 'Anonymous client unexpectedly read candidate history');
    evidence.anonymousHistoryDenied = true;
    const base = await loadDashboardData(client), complete = await loadExtendedDashboardReport(client, base);
    const dated = complete.recruitment_logs.filter(row => row.result === 0).map(row => (row.outcome_date ?? (!row.stage_instance_id ? row.log_date : '') ?? '').slice(0, 10)).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const range = { start: dated[0] ?? today, end: dated.at(-1) && dated.at(-1) > today ? dated.at(-1) : today };
    const report = buildRejectionReport(complete, enrichRequisitions(complete), range);
    assert.equal(report.total, Object.values(report.actors).reduce((a, b) => a + b, 0));
    assert.equal(report.total, report.trends.reduce((total, bucket) => total + bucket.count, 0));
    evidence.range = range; evidence.total = report.total; evidence.actors = report.actors; evidence.people = report.people; evidence.applications = report.applications; evidence.diagnostics = report.diagnostics;
    evidence.completeStageRows = complete.recruitment_log_history.length;
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
    await context.addInitScript(({ key, session }) => { localStorage.setItem(key, JSON.stringify(session)); localStorage.setItem('recruitment_lang', 'en'); }, { key: 'sb-mppnlkldlctvketcsald-auth-token', session: signedIn.data.session });
    const page = await context.newPage(), failedReads = [];
    page.on('response', response => { if (response.url().includes('/rest/v1/') && response.status() >= 400) failedReads.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    const query = new URLSearchParams({ dashboardTab: 'pipeline', pipelineSubview: 'rejections', dashboardPeriod: 'custom', dashboardStart: range.start, dashboardEnd: range.end, lang: 'en' });
    await page.goto(new URL('/dashboard?' + query, preview).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const screen = page.locator('[data-rejection-report]:visible');
    await screen.waitFor({ state: 'visible', timeout: 60000 });
    const total = Number(await screen.locator('[data-rejection-metric="total"]').innerText()); assert.equal(total, report.total);
    for (const actor of ['company', 'candidate', 'unclassified']) assert.equal(Number(await screen.locator(`[data-rejection-metric="${actor}"]`).innerText()), report.actors[actor]);
    evidence.browserTotalsReconcile = true;
    await page.screenshot({ path: path.join(output, 'live-desktop.png'), fullPage: true });
    await page.getByRole('button', { name: 'Export Rejections', exact: true }).click();
    const download = page.waitForEvent('download', { timeout: 60000 });
    await page.getByRole('button', { name: 'Export Rejections XLSX', exact: true }).click();
    const file = await download, workbook = new Workbook(); await workbook.xlsx.readFile(await file.path());
    assert.equal(workbook.worksheets.length, 2);
    const expectedIds = new Map(report.events.map(event => [event.id, event.candidateId])), exportedIds = [];
    workbook.getWorksheet('Source Data').eachRow(row => { const id = row.getCell(2).value; if (typeof id === 'string' && expectedIds.get(id) === row.getCell(4).value) exportedIds.push(id); });
    assert.equal(exportedIds.length, report.total);
    assert.equal(new Set(exportedIds).size, report.total);
    evidence.excelRowsReconcile = true;
    if (report.total) {
      await screen.locator('tbody tr').first().getByRole('button').click();
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 30000 });
      assert(new URL(page.url()).searchParams.get('applicationId'), 'Candidate drilldown lost application context');
      evidence.applicationDrilldown = true;
    }
    assert.deepEqual(failedReads, [], 'Live browser encountered failed REST reads');
    evidence.failedRestReads = 0;
    console.log(JSON.stringify(evidence));
  } finally {
    if (browser) await browser.close();
    await client.auth.signOut();
    if (userId) { await cleanup(userId); evidence.temporaryAccountRemoved = true; }
    fs.writeFileSync(path.join(output, 'live-verification.json'), JSON.stringify(evidence, null, 2));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
