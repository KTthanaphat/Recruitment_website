const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pglitePath = process.env.RECRUITMENT_PGLITE_PATH || path.join(process.env.LOCALAPPDATA || "C:/Users/thanaphat-krea/AppData/Local", "Temp/recruitment-db-tools/node_modules/@electric-sql/pglite");
const { PGlite } = require(pglitePath);

async function main() {
  const root = path.resolve(__dirname, "../..");
  const migration = fs.readdirSync(path.join(root, "supabase/migrations")).find(name => name.endsWith("_async_application_destinations_lookup.sql"));
  assert.ok(migration, "CLI-generated lookup migration exists");
  const declarative = fs.readFileSync(path.join(root,"supabase/schemas/63_operational_lookups.sql"),"utf8");
  const offerMarker = "-- Searchable, bounded offer-candidate options";
  const offerStart = declarative.indexOf(offerMarker);
  assert.ok(offerStart > 0, "the declarative file has the separate offer lookup section");
  assert.equal(fs.readFileSync(path.join(root,"supabase/migrations",migration),"utf8").trimEnd(),declarative.slice(0,offerStart).trimEnd(),"destination migration matches its declarative source section");
  assert.equal(fs.readFileSync(path.join(root,"supabase/migrations/20261101174258_offer_candidates_lookup.sql"),"utf8").trimEnd(),declarative.slice(offerStart).trimEnd(),"offer-candidate migration matches its declarative source section");
  const schemaPaths = fs.readFileSync(path.join(root,"supabase/config.toml"),"utf8");
  assert.ok(schemaPaths.indexOf("./schemas/63_operational_lookups.sql") < schemaPaths.indexOf("./schemas/90_grants.sql"),"operational lookups load after the base profile RPC and before final grants");
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema app_private;
      create function public.app_application_destinations_v1() returns jsonb language sql stable security definer as $$
        select '[
          {"group_id":"GRP-0001","group_position":"Accounting","sites":["Bangkok"],"owners":["A"],"doc_ids":["DOC-1"]},
          {"group_id":"GRP-00010","group_position":"Analyst","sites":["Rayong"],"owners":["B"],"doc_ids":["DOC-10"]},
          {"group_id":"GRP-0002","group_position":"Finance","sites":["Bangkok"],"owners":["C"],"doc_ids":["DOC-2"]}
        ]'::jsonb
      $$;`);
    const sql = fs.readFileSync(path.join(root, "supabase/migrations", migration), "utf8");
    await db.exec(sql);
    const first = await db.query("select public.app_application_destinations_page_v1('',null,2) as page");
    assert.equal(first.rows[0].page.items.length, 2);
    assert.equal(first.rows[0].page.items[0].group_id, "GRP-0001");
    assert.equal(first.rows[0].page.has_more, true);
    assert.equal(first.rows[0].page.next_cursor.group_id, "GRP-00010");
    const last = await db.query("select public.app_application_destinations_page_v1('', $1, 2) as page", [first.rows[0].page.next_cursor.group_id]);
    assert.deepEqual(last.rows[0].page.items.map(row => row.group_id), ["GRP-0002"]);
    assert.equal(last.rows[0].page.has_more, false);
    assert.equal(last.rows[0].page.next_cursor, null);
    const alias = await db.query("select public.app_application_destinations_page_v1('GRP-00001',null,10) as page");
    assert.deepEqual(alias.rows[0].page.items.map(row => row.group_id), ["GRP-0001"]);
    const scoped = await db.query("select public.app_application_destinations_page_v1('DOC-10',null,10) as page");
    assert.deepEqual(scoped.rows[0].page.items.map(row => row.group_id), ["GRP-00010"]);
    await assert.rejects(db.query("select public.app_application_destinations_page_v1('',null,101)"), /DESTINATION_PAGE_LIMIT_INVALID/);
    const grants = await db.query(`select has_function_privilege('anon','public.app_application_destinations_page_v1(text,text,integer)','execute') anon_exec,
      has_function_privilege('authenticated','public.app_application_destinations_page_v1(text,text,integer)','execute') authenticated_exec`);
    assert.deepEqual(grants.rows[0], { anon_exec: false, authenticated_exec: true });
    console.log("Operational destination lookup migration PGlite assertions passed.");
  } finally { await db.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
