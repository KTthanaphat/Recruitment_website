import { createClient } from "npm:@supabase/supabase-js@2";

type Candidate = { candidate_id: string; name: string; nickname?: string | null };
type Responsibility = { site: string; person_in_charge: string; responsible_vacancy: number; open_requisition_count: number; candidate_states: Record<string, number> };
type MovementRow = { doc_id: string; site: string; position: string; person_in_charge: string; new_candidates?: Candidate[] };
type NewCandidateRow = MovementRow & Candidate;
type Summary = {
  report_date: string;
  open_responsibilities: Responsibility[];
  yesterday: { new_requisitions: MovementRow[]; filled_requisitions: MovementRow[]; new_candidates: NewCandidateRow[]; accepted_offers: MovementRow[] };
};

const BRAND_BLUE = "#0A3CDC";
const NAVY = "#0B132B";
const BORDER = "#D7DEE8";
const MUTED = "#5F6B7A";
const siteColours: Record<string, string> = { HQ: "#0AA0C3", KT1: "#146EFA", KT2: "#411EDC" };

function bangkokDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "-").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function siteColour(site: string) { return siteColours[site.trim().toUpperCase()] ?? BRAND_BLUE; }
function candidateLabel(candidate: Candidate) { return candidate.nickname?.trim() ? `${candidate.name} (${candidate.nickname.trim()})` : candidate.name; }

const stageColumns = [
  { label: "Screening", match: "Phone Screen" },
  { label: "HR Intvw.", match: "HR Interview" },
  { label: "Line Intvw.", match: "Line Interview" },
  { label: "Test", match: "Test" },
  { label: "Ref. Check", match: "Reference Check" },
  { label: "Offer", match: "Offer" }
] as const;

function stageCount(states: Record<string, number>, stage: string) {
  return Object.entries(states ?? {}).reduce((total, [state, count]) => state === stage || state.startsWith(`${stage} `) ? total + Number(count) : total, 0);
}

function vacancySummary(rows: Responsibility[]) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.site, (totals.get(row.site) ?? 0) + Number(row.responsible_vacancy));
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const sites = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([site, value]) => `${escapeHtml(site)}: ${escapeHtml(value)}`).join(", ");
  return `Total: <strong style="color:${BRAND_BLUE}">${escapeHtml(total)}</strong>${sites ? ` <span style="color:${MUTED}">(${sites})</span>` : ""}`;
}

function responsibilityTable(rows: Responsibility[]) {
  const content = rows.length
    ? rows.map((row) => `<tr>
        <td style="padding:12px 10px;border-top:1px solid ${BORDER};background:${siteColour(row.site)};font-weight:700;color:#ffffff">${escapeHtml(row.site)}</td>
        <td style="padding:12px 10px;border-top:1px solid ${BORDER};color:${NAVY}">${escapeHtml(row.person_in_charge)}</td>
        <td align="right" style="padding:12px 10px;border-top:1px solid ${BORDER};font-weight:700;color:${NAVY}">${escapeHtml(row.responsible_vacancy)}</td>
        ${stageColumns.map((column) => `<td align="right" style="padding:12px 8px;border-top:1px solid ${BORDER};font-weight:700;color:${NAVY}">${escapeHtml(stageCount(row.candidate_states, column.match))}</td>`).join("")}
      </tr>`).join("")
    : `<tr><td colspan="9" style="padding:14px;color:${MUTED}">No open requisitions.</td></tr>`;
  return `<div style="display:block;overflow-x:auto"><table width="100%" cellpadding="0" cellspacing="0" style="min-width:900px;border:1px solid ${BORDER};border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;font-size:12px"><thead><tr style="background:${BRAND_BLUE};color:#ffffff"><th align="center" style="padding:11px 10px;border-radius:9px 0 0 0">Site</th><th align="center" style="padding:11px 10px">PiC</th><th align="center" style="padding:11px 10px">Vac.</th>${stageColumns.map((column, index) => `<th align="center" style="padding:11px 8px;white-space:nowrap${index === stageColumns.length - 1 ? ";border-radius:0 9px 0 0" : ""}">${column.label}</th>`).join("")}</tr></thead><tbody>${content}</tbody></table></div>`;
}

function movementRows(rows: MovementRow[], includeCandidates = false) {
  if (!rows.length) return `<tr><td colspan="${includeCandidates ? 5 : 4}" style="padding:13px 10px;color:${MUTED}">None</td></tr>`;
  return rows.map((row) => {
    const candidates = row.new_candidates?.length
      ? row.new_candidates.map((candidate) => `<div style="margin:0 0 3px"><strong>${escapeHtml(candidateLabel(candidate))}</strong> <span style="color:${MUTED}">(${escapeHtml(candidate.candidate_id)})</span></div>`).join("")
      : `<span style="color:${MUTED}">No new candidates</span>`;
    return `<tr><td style="padding:11px 10px;border-top:1px solid ${BORDER};font-weight:700;color:${NAVY}">${escapeHtml(row.doc_id)}</td><td style="padding:11px 10px;border-top:1px solid ${BORDER};border-left:3px solid ${siteColour(row.site)};color:${NAVY}">${escapeHtml(row.site)}</td><td style="padding:11px 10px;border-top:1px solid ${BORDER};color:${NAVY}">${escapeHtml(row.position)}</td><td style="padding:11px 10px;border-top:1px solid ${BORDER};color:${NAVY}">${escapeHtml(row.person_in_charge)}</td>${includeCandidates ? `<td style="padding:11px 10px;border-top:1px solid ${BORDER};color:${NAVY}">${candidates}</td>` : ""}</tr>`;
  }).join("");
}

function movementTable(title: string, rows: MovementRow[], includeCandidates = false) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid ${BORDER};border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;font-size:13px"><tr><td style="padding:12px 14px;border-radius:9px 9px 0 0;background:${BRAND_BLUE};color:#ffffff;font-size:15px;font-weight:700">${escapeHtml(title)}</td></tr><tr><td><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;color:${NAVY}"><thead><tr style="background:#F8FAFD"><th align="left" style="padding:10px">Doc ID</th><th align="left" style="padding:10px">Site</th><th align="left" style="padding:10px">Position</th><th align="left" style="padding:10px">PIC</th>${includeCandidates ? `<th align="left" style="padding:10px">New candidates</th>` : ""}</tr></thead><tbody>${movementRows(rows, includeCandidates)}</tbody></table></td></tr></table>`;
}

function newCandidateTable(rows: NewCandidateRow[]) {
  const content = rows.length ? rows.map((row) => `<tr><td style="padding:11px 10px;border-top:1px solid ${BORDER};font-weight:700;color:${NAVY}">${escapeHtml(candidateLabel(row))}</td><td style="padding:11px 10px;border-top:1px solid ${BORDER};color:${MUTED}">${escapeHtml(row.candidate_id)}</td><td style="padding:11px 10px;border-top:1px solid ${BORDER};background:${siteColour(row.site)};font-weight:700;color:#ffffff">${escapeHtml(row.site)}</td><td style="padding:11px 10px;border-top:1px solid ${BORDER};color:${NAVY}">${escapeHtml(row.position)}</td><td style="padding:11px 10px;border-top:1px solid ${BORDER};color:${NAVY}">${escapeHtml(row.person_in_charge)}</td></tr>`).join("") : `<tr><td colspan="5" style="padding:13px 10px;color:${MUTED}">None</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border:1px solid ${BORDER};border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;font-size:13px"><tr><td style="padding:12px 14px;border-radius:9px 9px 0 0;background:${BRAND_BLUE};color:#ffffff;font-size:15px;font-weight:700">Newly added candidates</td></tr><tr><td><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;color:${NAVY}"><thead><tr style="background:#F8FAFD"><th align="left" style="padding:10px">Candidate</th><th align="left" style="padding:10px">Candidate ID</th><th align="left" style="padding:10px">Site</th><th align="left" style="padding:10px">Position</th><th align="left" style="padding:10px">PiC</th></tr></thead><tbody>${content}</tbody></table></td></tr></table>`;
}

Deno.serve(async (request) => {
  if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });
  const token = Deno.env.get("POWER_AUTOMATE_SUMMARY_TOKEN");
  if (!token || request.headers.get("x-summary-token") !== token) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await supabase.rpc("app_daily_recruitment_summary", { p_report_date: bangkokDate() });
  if (error) { console.error("Daily recruitment summary query failed", error.message); return new Response("Summary query failed", { status: 500 }); }

  const summary = data as Summary;
  const yesterday = summary.yesterday;
  const reportDate = displayDate(summary.report_date);
  const yesterdayDate = displayDate(previousDate(summary.report_date));
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${NAVY}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:860px;margin:0 auto;background:#ffffff"><tr><td style="border:1px solid ${BORDER};border-radius:14px;overflow:hidden"><div style="padding:24px 28px;background:${BRAND_BLUE};color:#ffffff"><div style="font-size:12px;font-weight:700;letter-spacing:.08em">RECRUITMENT OPERATIONS</div><h1 style="margin:6px 0 0;font-size:24px">Daily Summary</h1><div style="margin-top:6px;font-size:14px">${escapeHtml(reportDate)} - Bangkok time</div></div><div style="padding:24px 28px;background:#ffffff"><h2 style="margin:0;font-size:18px;color:${NAVY}">Open requisitions by responsibility</h2><p style="margin:5px 0 6px;font-size:14px;color:${MUTED}">Open vacancies and the current candidate pipeline by Site and PiC.</p><p style="margin:0 0 14px;font-size:14px;color:${NAVY}">${vacancySummary(summary.open_responsibilities)}</p>${responsibilityTable(summary.open_responsibilities)}<div style="margin-top:25px;padding-top:22px;border-top:1px solid ${BORDER}"><h2 style="margin:0;font-size:18px;color:${NAVY}">Yesterday's movement</h2><p style="margin:5px 0 0;font-size:14px;color:${MUTED}">Activity recorded on ${escapeHtml(yesterdayDate)}.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;border:1px solid ${BORDER};border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden"><tr><td style="width:25%;padding:12px 14px;border-right:1px solid ${BORDER}"><div style="font-size:12px;color:${MUTED}">New req.</div><div style="margin-top:3px;font-size:22px;font-weight:700;color:${BRAND_BLUE}">${yesterday.new_requisitions.length}</div></td><td style="width:25%;padding:12px 14px;border-right:1px solid ${BORDER}"><div style="font-size:12px;color:${MUTED}">Filled req.</div><div style="margin-top:3px;font-size:22px;font-weight:700;color:${BRAND_BLUE}">${yesterday.filled_requisitions.length}</div></td><td style="width:25%;padding:12px 14px;border-right:1px solid ${BORDER}"><div style="font-size:12px;color:${MUTED}">New candidates</div><div style="margin-top:3px;font-size:22px;font-weight:700;color:${BRAND_BLUE}">${yesterday.new_candidates.length}</div></td><td style="width:25%;padding:12px 14px"><div style="font-size:12px;color:${MUTED}">Accepted offers</div><div style="margin-top:3px;font-size:22px;font-weight:700;color:${BRAND_BLUE}">${yesterday.accepted_offers.length}</div></td></tr></table>${movementTable("New requisitions", yesterday.new_requisitions)}${movementTable("Filled requisitions", yesterday.filled_requisitions)}${newCandidateTable(yesterday.new_candidates)}${movementTable("Accepted offers", yesterday.accepted_offers)}</div></div><div style="padding:14px 28px;border-top:1px solid ${BORDER};background:#ffffff;color:${MUTED};font-size:12px">Generated automatically from Recruitment ATS. Please do not reply to this message.</div></td></tr></table></body></html>`;
  return Response.json({ report_date: summary.report_date, subject: `Recruitment daily summary - ${reportDate}`, html });
});
