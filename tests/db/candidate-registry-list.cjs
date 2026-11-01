const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pglitePath = process.env.RECRUITMENT_PGLITE_PATH || path.join(process.env.LOCALAPPDATA || "C:/Users/thanaphat-krea/AppData/Local", "Temp/recruitment-db-tools/node_modules/@electric-sql/pglite");
const { PGlite } = require(pglitePath);

const migrationParams = (search = "", filters = {}, limit = 25, cursor = null, before = false) => [
  "candidate_registry", search, JSON.stringify(filters), "updated_at", "desc", limit,
  cursor ? JSON.stringify(cursor.value) : null, cursor?.id ?? null, before,
];

async function list(db, search = "", filters = {}, limit = 25, cursor = null, before = false) {
  const result = await db.query(`select public.app_recruitment_list_v1($1,$2,$3::jsonb,$4,$5,$6,$7::jsonb,$8,$9) as page`, migrationParams(search, filters, limit, cursor, before));
  return result.rows[0].page;
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const db = new PGlite();
  try {
    await db.exec(`create schema auth;
      create schema app_private;
      create role anon;
      create role authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function app_private.is_recruitment_reader() returns boolean language sql stable as $$select auth.uid() is not null$$;
      create function app_private.can_read_candidate(p_id text) returns boolean language sql stable as $$select p_id not in ('CAN-00126','CAN-HIDDEN')$$;
      create table public.candidates(candidate_id text primary key,name text,nickname text,phone_no text,email text,home_site text,channel text,position_interests text,created_at timestamptz not null,updated_at timestamptz not null);
      create table public.candidate_applications(application_id uuid primary key,candidate_id text,state text);
      create function app_private.can_read_application(p_id uuid) returns boolean language sql stable security definer set search_path=public,app_private as $$select exists(select 1 from public.candidate_applications where application_id=p_id and candidate_id not in ('CAN-HIDDEN'))$$;
      create function public.app_masked_candidate_pool_v1() returns jsonb language sql stable security definer as $$select '[{"candidate_id":"CAN-00126","position_interests":"Design","created_by":"11111111-1111-1111-1111-111111111111","creator_label":"Creator","created_at":"2026-10-31T00:00:00Z"}]'::jsonb$$;
      create function public.app_candidate_profile_capabilities_v1() returns jsonb language sql stable security definer as $$
        select coalesce(jsonb_agg(jsonb_build_object('candidate_id',candidate_id,'creator_label','Creator','is_unmatched',candidate_id not in ('CAN-00001','CAN-00002'))),'[]'::jsonb) from public.candidates where candidate_id not in ('CAN-00126','CAN-HIDDEN')
      $$;
      insert into public.candidates(candidate_id,name,phone_no,email,home_site,channel,position_interests,created_at,updated_at)
      select 'CAN-'||lpad(n::text,5,'0'),'Candidate '||n,'081'||lpad(n::text,7,'0'),'candidate'||n||'@example.test','Site A','Referral','Engineer', '2026-10-31T00:00:00Z','2026-10-31T00:00:00Z'
      from generate_series(1,125) n;
      insert into public.candidates values
        ('CAN-0001','Legacy Candidate',null,'0810000000','legacy@example.test','Site B','Walk in','Legacy', '2026-10-30T00:00:00Z','2026-10-30T00:00:00Z'),
        ('CAN-1200','Older ID',null,'0810000001','older@example.test','Site B','Referral','Engineer','2026-10-29T00:00:00Z','2026-10-29T00:00:00Z'),
        ('CAN-9999','Ambiguous A',null,null,null,'Site A',null,null,'2026-10-28T00:00:00Z','2026-10-28T00:00:00Z'),
        ('CAN-09999','Ambiguous B',null,null,null,'Site A',null,null,'2026-10-27T00:00:00Z','2026-10-27T00:00:00Z'),
        ('CAN-00126','Sensitive Name',null,'0891234567','hidden@example.test','Site C','Social','Sensitive', '2026-10-31T00:00:00Z','2026-10-31T00:00:00Z'),
        ('CAN-HIDDEN','Out of scope',null,null,null,'Site C',null,null,'2026-10-31T00:00:00Z','2026-10-31T00:00:00Z');
      insert into public.candidate_applications values
        ('22222222-2222-2222-2222-222222222222','CAN-00001','active'),
        ('33333333-3333-3333-3333-333333333333','CAN-00002','closed'),
        ('44444444-4444-4444-4444-444444444444','CAN-HIDDEN','active');`);
    await db.exec(`alter table public.candidates enable row level security;
      create policy candidate_scope on public.candidates for select to authenticated using(app_private.can_read_candidate(candidate_id));
      alter table public.candidate_applications enable row level security;
      create policy application_scope on public.candidate_applications for select to authenticated using(app_private.can_read_application(application_id));
      grant usage on schema public,app_private,auth to authenticated;
      grant select on public.candidates,public.candidate_applications to authenticated;
      grant execute on function auth.uid(),app_private.is_recruitment_reader(),app_private.can_read_candidate(text),app_private.can_read_application(uuid),public.app_masked_candidate_pool_v1(),public.app_candidate_profile_capabilities_v1() to authenticated;`);
    const migration = fs.readdirSync(path.join(root, "supabase/migrations")).find(name => name.endsWith("_candidate_registry_list.sql"));
    assert.ok(migration, "CLI-generated candidate registry migration exists");
    await db.exec(fs.readFileSync(path.join(root, "supabase/migrations", migration), "utf8"));
    await db.exec("select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false); set role authenticated;");

    const first = await list(db);
    assert.equal(first.total_count, 130, "total includes readable candidates and one authorized masked pool row");
    assert.equal(first.items.length, 25);
    assert.equal(first.has_more, true);
    assert.equal(first.has_more_before, false);
    assert.ok(first.next_cursor);
    const second = await list(db, "", {}, 25, first.next_cursor);
    assert.equal(second.has_more, true);
    assert.equal(second.has_more_before, true);
    const previous = await list(db, "", {}, 25, second.previous_cursor, true);
    assert.deepEqual(previous.items.map(row => row.candidate_id), first.items.map(row => row.candidate_id));
    assert.equal(previous.has_more, true, "has_more always describes forward canonical rows, including after Previous");
    const nextAgain = await list(db, "", {}, 25, previous.next_cursor);
    assert.deepEqual(nextAgain.items.map(row => row.candidate_id), second.items.map(row => row.candidate_id));

    const pageIds = [...first.items, ...second.items].map(row => row.candidate_id);
    assert.equal(new Set(pageIds).size, pageIds.length, "equal timestamps use a stable ID tiebreaker");
    const active = await list(db, "", { scope: "active" });
    assert.deepEqual(active.items.map(row => row.candidate_id), ["CAN-00001"]);
    const history = await list(db, "", { scope: "history" });
    assert.deepEqual(history.items.map(row => row.candidate_id), ["CAN-00002"]);
    const pool = await list(db, "", { scope: "pool" });
    assert.equal(pool.total_count, 128);

    const masked = await list(db, "CAN-00126", { scope: "pool" });
    assert.deepEqual({ ...masked.items[0], created_at: undefined }, {
      candidate_id: "CAN-00126", name: null, nickname: null, phone_no: null, email: null,
      home_site: null, creator_label: "Creator", channel: null, position_interests: "Design",
      active_application_count: null, updated_at: null, created_at: undefined, masked: true, is_unmatched: true,
    });
    assert.ok(masked.items[0].created_at.startsWith("2026-10-31"));
    assert.equal((await list(db, "Sensitive Name")).total_count, 0, "masked profile search cannot match hidden name/contact");
    assert.equal((await list(db, "CAN-HIDDEN")).total_count, 0, "unreadable application-backed candidate is omitted");
    const paddedAlias = await list(db, "can-01200");
    assert.equal(paddedAlias.total_count, 1);
    assert.equal(paddedAlias.items[0].candidate_id, "CAN-1200", "case-insensitive display alias search resolves the legacy stored value");
    const collision = await list(db, "can-00001");
    assert.deepEqual(collision.items.map(row => row.candidate_id).sort(), ["CAN-00001", "CAN-0001"], "list search retains all raw IDs that share a display alias");
    const aliasCollision = await list(db, "CAN-09999");
    assert.equal(aliasCollision.total_count, 2, "display aliases can match multiple raw IDs without rewriting either");
    await db.exec("select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(list(db), /RECRUITMENT_READ_NOT_AUTHORIZED/, "unauthenticated callers are rejected by the invoker RPC");
    console.log("Candidate registry search, filtering, privacy and cursor assertions passed.");
  } finally {
    await db.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
