const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pglitePath = process.env.RECRUITMENT_PGLITE_PATH || path.join(process.env.LOCALAPPDATA || "C:/Users/thanaphat-krea/AppData/Local", "Temp/recruitment-db-tools/node_modules/@electric-sql/pglite");
const { PGlite } = require(pglitePath);

async function main() {
  const root = path.resolve(__dirname, "../..");
  const migration = fs.readdirSync(path.join(root, "supabase/migrations")).find(name => name.endsWith("_five_digit_app_ids.sql"));
  assert.ok(migration, "CLI-generated five digit ID migration exists");
  const sourceText = fs.readFileSync(path.join(root,"supabase/schemas/30_triggers_audit.sql"),"utf8");
  const migrationText = fs.readFileSync(path.join(root,"supabase/migrations",migration),"utf8");
  const generator = text => text.match(/create or replace function app_private\.next_app_id\([\s\S]*?\$\$;/i)?.[0].replace(/\r\n/g,"\n");
  assert.equal(generator(migrationText),generator(sourceText),"the ID migration and declarative generator stay aligned");
  const db = new PGlite();
  try {
    await db.exec(`create schema app_private;
      create table public.app_id_counters(entity text primary key, next_value integer not null default 1 check(next_value > 0));
      create table public.candidates(candidate_id text primary key);
      create table public.position_groups(group_id text primary key);
      insert into public.candidates values ('CAN-0001'), ('CAN-01000'), ('CAN-100000');
      insert into public.position_groups values ('GRP-0001'), ('GRP-09999');
      insert into public.app_id_counters values ('candidates',2), ('position_groups',100000);`);
    await db.exec(fs.readFileSync(path.join(root, "supabase/migrations", migration), "utf8"));
    const counters = await db.query("select entity,next_value from public.app_id_counters order by entity");
    assert.deepEqual(counters.rows, [
      { entity: "candidates", next_value: 100001 },
      { entity: "position_groups", next_value: 100000 },
    ]);
    const ids = await db.query(`select app_private.next_app_id('candidates','CAN') as candidate,
      app_private.next_app_id('position_groups','GRP') as position_group`);
    assert.deepEqual(ids.rows, [{ candidate: "CAN-100001", position_group: "GRP-100000" }]);
    for (const [entity, prefix, value, expected] of [
      ["candidates", "CAN", 1, "CAN-00001"],
      ["position_groups", "GRP", 1, "GRP-00001"],
      ["document_groups", "DGRP", 1, "DGRP-0001"],
      ["document_groups", "DGRP", 10000, "DGRP-10000"],
      ["candidates", "CAN", 100000, "CAN-100000"],
    ]) {
      await db.query("insert into public.app_id_counters(entity,next_value) values($1,$2) on conflict(entity) do update set next_value=excluded.next_value", [entity,value]);
      const issued = await db.query("select app_private.next_app_id($1,$2) as id", [entity,prefix]);
      assert.equal(issued.rows[0].id, expected, `${prefix} preserves its minimum width and never truncates long suffixes`);
    }
    const existing = await db.query("select candidate_id from public.candidates order by candidate_id");
    assert.deepEqual(existing.rows.map(row => row.candidate_id), ["CAN-0001", "CAN-01000", "CAN-100000"]);
    for (const [value, expected] of [[1,"CAN-00001"],[9999,"CAN-09999"],[10000,"CAN-10000"],[99999,"CAN-99999"],[100000,"CAN-100000"]]) {
      await db.query("update public.app_id_counters set next_value=$1 where entity='candidates'", [value]);
      const boundary = await db.query("select app_private.next_app_id('candidates','CAN') as id");
      assert.equal(boundary.rows[0].id, expected);
    }
    await db.query("update public.app_id_counters set next_value=123456 where entity='candidates'");
    await db.exec(fs.readFileSync(path.join(root, "supabase/migrations", migration), "utf8"));
    const beyond = await db.query("select app_private.next_app_id('candidates','CAN') as id");
    assert.equal(beyond.rows[0].id, "CAN-123456", "replaying the migration preserves an ahead-of-data counter");
    const concurrentCalls = await Promise.all(Array.from({ length: 8 }, () => db.query("select app_private.next_app_id('candidates','CAN') as id")));
    const concurrentIds = concurrentCalls.map(result => result.rows[0].id);
    assert.equal(new Set(concurrentIds).size, concurrentIds.length, "overlapping client generation calls return distinct identifiers");
    assert.deepEqual(concurrentIds.sort(), Array.from({ length: 8 }, (_, index) => `CAN-${String(123457 + index).padStart(5, "0")}`), "overlapping calls advance the shared counter without gaps in the serialized PGlite session");

    const mixed = new PGlite();
    try {
      await mixed.exec(`create schema app_private;
        create table public.app_id_counters(entity text primary key, next_value integer not null default 1 check(next_value > 0));
        create table public.candidates(candidate_id text primary key);
        create table public.position_groups(group_id text primary key);
        insert into public.candidates values ('CAN-0001'), ('CAN-00001');`);
      await mixed.exec(fs.readFileSync(path.join(root, "supabase/migrations", migration), "utf8"));
      const afterCollision = await mixed.query("select app_private.next_app_id('candidates','CAN') as id");
      assert.equal(afterCollision.rows[0].id, "CAN-00002", "counter seeding skips an already-used numeric suffix even when raw IDs differ");
      const unchanged = await mixed.query("select candidate_id from public.candidates order by candidate_id");
      assert.deepEqual(unchanged.rows.map(row => row.candidate_id), ["CAN-00001", "CAN-0001"]);
    } finally {
      await mixed.close();
    }
    console.log("ID counter migration and minimum-width generation assertions passed.");
  } finally {
    await db.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
