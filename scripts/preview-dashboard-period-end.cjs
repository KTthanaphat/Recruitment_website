// Loopback-only, read-only preview backed by the same PostgreSQL fixture as the rehearsal.
const { createServer } = require("node:http");
const { createHmac } = require("node:crypto");
const { createPeriodEndFixture, admin } = require("./rehearse-dashboard-period-end.cjs");

const email = "recruitment-preview@example.test";
const password = "local-preview-only";
const user = { id: admin, email, role: "authenticated", aud: "authenticated", user_metadata: {}, app_metadata: {} };
const tables = {
  profiles: "select * from public.profiles where id=$1",
  rejection_reasons: "select * from public.rejection_reasons order by sort_order",
  department_section_directory: "select * from public.department_section_directory order by dep_sec_id"
};
const readableRpcs = new Set([
  "app_dashboard_performance_summary_v1", "app_dashboard_active_requisitions_page_v2",
  "app_dashboard_active_requisition_candidates_v1", "app_dashboard_company_report", "app_dashboard_filter_options_v1",
  "app_candidate_contact_lookup_v2", "app_candidate_lookup_applications_v2",
  "app_home_summary_v1", "app_home_core_summary_v1", "app_home_welcome_summary_v1", "app_home_banner_summary_v1",
  "app_recruitment_calendar_v1", "app_recruitment_notifications_list_v1", "app_recruitment_notification_center_v1"
]);

function token() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + 86400;
  const body = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ sub: admin, aud: user.aud, role: user.role, exp: expiresAt });
  const accessToken = body + "." + createHmac("sha256", password).update(body).digest("base64url");
  return { access_token: accessToken, token_type: "bearer", expires_in: 86400, expires_at: expiresAt, refresh_token: "fixture-refresh", user };
}

async function rpc(db, name, input) {
  if (!readableRpcs.has(name)) return [];
  const keys = Object.keys(input);
  const data = await db.query(`
    select p.proargnames names, p.proretset multiple
    from pg_proc p join pg_namespace n on p.pronamespace=n.oid
    where n.nspname='public' and p.proname=$1
      and $2::text[] <@ coalesce(p.proargnames,'{}'::text[])
      and p.pronargs-p.pronargdefaults<=cardinality($2::text[])
    order by p.pronargs limit 1`, [name, keys]);
  const signature = data.rows[0];
  if (!signature || keys.some(key => !/^[a-z_]+$/.test(key))) throw new Error("Unknown preview RPC arguments");
  const named = keys.map((key, i) => key + "=>$" + (i + 1)).join(",");
  const result = await db.query("select public." + name + "(" + named + ") value", keys.map(key => input[key]));
  return signature.multiple ? result.rows.map(row => row.value) : result.rows[0]?.value ?? null;
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32768) throw new Error("Preview request too large");
  }
  return body ? JSON.parse(body) : {};
}

async function main() {
  const db = await createPeriodEndFixture();
  const session = token();
  const port = Number(process.env.RECRUITMENT_PREVIEW_API_PORT ?? 54329);
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin ?? "";
    if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Content-Type", "application/json");
    const send = (code, value) => { response.statusCode = code; response.end(value === undefined ? undefined : JSON.stringify(value)); };
    const url = new URL(request.url, "http://127.0.0.1:" + port);
    try {
      if (request.method === "OPTIONS") return send(204);
      if (url.pathname === "/health" && request.method === "GET") return send(200, { synthetic: true });
      if (url.pathname === "/auth/v1/token" && request.method === "POST") {
        const input = await readBody(request);
        if (input.email !== email || input.password !== password) return send(400, { message: "Use the synthetic preview account." });
        return send(200, session);
      }
      if (request.headers.authorization !== "Bearer " + session.access_token) return send(401, { message: "Preview sign-in required." });
      if (url.pathname === "/auth/v1/user" && request.method === "GET") return send(200, user);
      if (url.pathname === "/auth/v1/logout" && request.method === "POST") return send(204);
      const name = url.pathname.split("/").at(-1);
      if (url.pathname.startsWith("/rest/v1/rpc/") && request.method === "POST") return send(200, await rpc(db, name, await readBody(request)));
      if (url.pathname.startsWith("/rest/v1/") && request.method === "GET") {
        const sql = Object.hasOwn(tables, name) ? tables[name] : null;
        return send(200, sql ? (await db.query(sql, name === "profiles" ? [admin] : [])).rows : []);
      }
      return send(404, { message: "Preview route unavailable." });
    } catch (error) {
      console.error(url.pathname, error.message);
      send(400, { message: error.message, code: error.code });
    }
  });
  server.listen(port, "127.0.0.1", () => console.log("Synthetic recruitment API listening on port " + port));
  process.on("SIGINT", () => server.close(() => { void db.close(); }));
}
main().catch(error => { console.error(error.message, error.cause?.message ?? error.detail ?? ""); process.exitCode = 1; });
