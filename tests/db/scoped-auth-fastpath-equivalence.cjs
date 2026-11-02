const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pglitePath = process.env.RECRUITMENT_PGLITE_PATH || path.join(process.env.LOCALAPPDATA || "C:/Users/thanaphat-krea/AppData/Local", "Temp/recruitment-db-tools/node_modules/@electric-sql/pglite");
const { PGlite } = require(pglitePath);

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create schema app_private;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.profiles(id uuid primary key,role text not null,site text,nickname text,full_name text);
      create table public.candidates(candidate_id text primary key,created_by uuid,home_site text);
      create table public.candidate_applications(application_id uuid primary key,candidate_id text not null,group_id text);
      create table public.requisitions(doc_id text primary key,site text not null,person_in_charge text);
      create table public.document_groups(doc_group_id text primary key,doc_id text not null,group_id text not null,unique(doc_id,group_id));
      insert into public.profiles values
        ('11111111-1111-1111-1111-111111111111','system_admin','TEST','Admin','Admin User'),
        ('22222222-2222-2222-2222-222222222222','admin_recruiter','TEST','Admin Recruiter','Admin Recruiter'),
        ('33333333-3333-3333-3333-333333333333','site_recruiter','OTHER','Site User','Site User Full'),
        ('44444444-4444-4444-4444-444444444444','viewer','OTHER','Viewer','Viewer User'),
        ('55555555-5555-5555-5555-555555555555','unrecognized_role','OTHER','Unknown','Unknown User'),
        ('66666666-6666-6666-6666-666666666666','site_recruiter','OTHER','',''),
        ('77777777-7777-7777-7777-777777777777','site_recruiter',null,null,null),
        ('88888888-8888-8888-8888-888888888888','site_recruiter','TEST','Test Site PIC','Test Site PIC');
      insert into public.requisitions values
        ('R-SITE','TEST','Other PIC'),('R-DIRECT','TEST','  sItE UsEr  '),
        ('R-FULL','TEST',' Site User Full '),('R-SHARED','TEST','Other PIC'),('R-OWNER','TEST',' site user '),
        ('R-BLANKPIC','REMOTE','   '),('R-NULLPIC','REMOTE',null),('R-NONE','REMOTE','   ');
      insert into public.document_groups values
        ('D-SITE','R-SITE','G-SITE'),('D-DIRECT','R-DIRECT','G-DIRECT'),('D-FULL','R-FULL','G-FULL-PIC'),
        ('D-SHARED-TARGET','R-SHARED','G-SHARED-TARGET'),('D-SHARED-OWNER','R-SHARED','G-SHARED-OWNER'),
        ('D-OWNER','R-OWNER','G-SHARED-OWNER'),('D-BLANKPIC','R-BLANKPIC','G-BLANKPIC'),('D-NULLPIC','R-NULLPIC','G-NULLPIC'),('D-NONE','R-NONE','G-NONE');
      insert into public.candidates values
        ('CAN-HOME-APP',null,'OTHER'),('CAN-HOME-NO-APP',null,'OTHER'),('CAN-GROUP-APP',null,'REMOTE'),
        ('CAN-CREATED-NO-APP','33333333-3333-3333-3333-333333333333','REMOTE'),
        ('CAN-VIEWER-APP',null,'REMOTE'),('CAN-VIEWER-NO-APP',null,'REMOTE'),
        ('CAN-TEST-HOME-APP',null,'TEST'),('CAN-TEST-HOME-NO-APP',null,'TEST'),
        ('CAN-PARALLEL-VISIBLE',null,'REMOTE'),('CAN-PARALLEL-HIDDEN',null,'REMOTE');
      insert into public.candidate_applications values
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1','CAN-HOME-APP','G-NONE'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2','CAN-GROUP-APP','G-DIRECT'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3','CAN-VIEWER-APP','G-UNLINKED'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4','CAN-TEST-HOME-APP','G-NONE'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5','CAN-PARALLEL-VISIBLE','G-DIRECT'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6','CAN-PARALLEL-VISIBLE','G-NONE'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7','CAN-PARALLEL-HIDDEN','G-NONE');
      create function app_private.current_app_role() returns text language sql stable security definer set search_path=public as $$select coalesce((select role from public.profiles where id=auth.uid()),'anon')$$;
      create function app_private.current_profile_site() returns text language sql stable security definer set search_path=public as $$select nullif((select site from public.profiles where id=auth.uid()),'')$$;
      create function app_private.current_profile_nickname() returns text language sql stable security definer set search_path=public as $$select nullif((select nickname from public.profiles where id=auth.uid()),'')$$;
      create function app_private.is_global_recruitment_reader() returns boolean language sql stable security definer set search_path=public as $$select app_private.current_app_role() in ('system_admin','admin_recruiter','viewer')$$;
      create function app_private.is_recruitment_writer() returns boolean language sql stable security definer set search_path=public as $$select app_private.current_app_role() in ('system_admin','admin_recruiter','site_recruiter')$$;
      create function app_private.is_group_pic(p_group_id text) returns boolean language sql stable security definer set search_path=public as $$
        select app_private.is_recruitment_writer() and exists(select 1 from public.document_groups d join public.requisitions r using(doc_id) join public.profiles p on p.id=auth.uid()
          where d.group_id=p_group_id and nullif(btrim(r.person_in_charge),'') is not null and lower(btrim(r.person_in_charge)) in (lower(btrim(p.nickname)),lower(btrim(p.full_name))))
      $$;
      create function app_private.can_read_requisition(p_doc_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
        select app_private.is_global_recruitment_reader() or exists(select 1 from public.requisitions r where r.doc_id=p_doc_id and app_private.current_app_role()='site_recruiter'
          and (r.site=app_private.current_profile_site()
            or lower(btrim(r.person_in_charge)) in (select lower(btrim(p.nickname)) from public.profiles p where p.id=auth.uid())
            or lower(btrim(r.person_in_charge)) in (select lower(btrim(p.full_name)) from public.profiles p where p.id=auth.uid())
            or exists(select 1 from public.document_groups d where d.doc_id=r.doc_id and app_private.is_group_pic(d.group_id))))
      $$;
      create function app_private.can_read_position_group_reference(p_group_id text) returns boolean language sql stable security definer set search_path=public,app_private as $$
        select app_private.current_app_role() in ('system_admin','admin_recruiter') or exists(select 1 from public.document_groups dg where dg.group_id=p_group_id and app_private.can_read_requisition(dg.doc_id))
      $$;
      create function app_private.can_read_candidate_reference(p_candidate_id text) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
      declare v_role text; v_created_by uuid; v_home_site text; v_group text; v_profile_site text;
      begin
       if auth.uid() is null then return false; end if;
       v_role:=app_private.current_app_role();
       if v_role not in ('system_admin','admin_recruiter','site_recruiter','viewer') then return false; end if;
       select c.created_by,c.home_site into v_created_by,v_home_site from public.candidates c where c.candidate_id=p_candidate_id;
       if not found then return false; end if;
       if v_role in ('system_admin','admin_recruiter') or v_created_by=auth.uid() then return true; end if;
       if v_role='viewer' then return exists(select 1 from public.candidate_applications a where a.candidate_id=p_candidate_id); end if;
       v_profile_site:=app_private.current_profile_site();
       for v_group in select a.group_id from public.candidate_applications a where a.candidate_id=p_candidate_id loop
         if v_home_site is not null and v_home_site=v_profile_site then return true; end if;
         if app_private.can_read_position_group(v_group) then return true; end if;
       end loop;
       return false;
      end $$;
      `);
    await db.exec(`create function app_private.can_read_application_reference(p_id uuid) returns boolean language plpgsql stable security definer set search_path=public,app_private as $$
      declare v_role text; v_group text;
      begin
       if auth.uid() is null then return false; end if;
       v_role:=app_private.current_app_role();
       if v_role not in ('system_admin','admin_recruiter','site_recruiter','viewer') then return false; end if;
       select a.group_id into v_group from public.candidate_applications a where a.application_id=p_id;
       if not found then return false; end if;
       if v_role in ('system_admin','admin_recruiter','viewer') then return true; end if;
       return app_private.can_read_position_group_reference(v_group);
      end $$;`);
    const experimentSql = fs.readFileSync(path.join(__dirname,"scoped-auth-inline-experiment.sql"),"utf8")
      .replace("app_private.can_read_application(p_id uuid)","app_private.can_read_application_inline_experiment(p_id uuid)")
      .replace("app_private.can_read_candidate(p_candidate_id text)","app_private.can_read_candidate_inline_experiment(p_candidate_id text)");
    await db.exec(experimentSql);
    const root = path.resolve(__dirname, "../..");
    const schema30 = fs.readFileSync(path.join(root,"supabase/schemas/30_triggers_audit.sql"),"utf8");
    const normalizeSql = text => text.replace(/\r\n/g,"\n");
    const fastDefinition = normalizeSql(schema30.match(/create or replace function app_private\.can_read_position_group\([\s\S]*?^\$\$;/m)?.[0] ?? "");
    assert.ok(fastDefinition, "declarative schema contains the optimized group authorization helper");
    const migration = fs.readFileSync(path.join(root,"supabase/migrations/20261101180543_scoped_application_read_fastpath.sql"),"utf8");
    const migratedDefinition = normalizeSql(migration.match(/create or replace function app_private\.can_read_position_group\([\s\S]*?^\$\$;/m)?.[0] ?? "");
    assert.equal(migratedDefinition, fastDefinition, "the ordered migration installs the exact differential-tested helper");
    await db.exec(fastDefinition);
    const schema32 = fs.readFileSync(path.join(root,"supabase/schemas/32_application_context.sql"),"utf8");
    const candidateDefinition = normalizeSql(schema32.match(/create or replace function app_private\.can_read_candidate\([\s\S]*?^\$\$;/m)?.[0] ?? "");
    assert.ok(candidateDefinition, "declarative schema contains the candidate-read helper");
    const candidateMigration = fs.readFileSync(path.join(root,"supabase/migrations/20261101183410_candidate_home_site_auth_fastpath.sql"),"utf8");
    const migrationCandidateDefinition = normalizeSql(candidateMigration.match(/create or replace function app_private\.can_read_candidate\([\s\S]*?^\$\$;/m)?.[0] ?? "");
    assert.equal(migrationCandidateDefinition, candidateDefinition, "the ordered migration installs the exact candidate helper under test");
    await db.exec(candidateDefinition);

    const cases = [
      ["system_admin", "11111111-1111-1111-1111-111111111111", ["G-SITE", "G-DIRECT", "G-FULL-PIC", "G-SHARED-TARGET", "G-SHARED-OWNER", "G-BLANKPIC", "G-NULLPIC", "G-NONE", "G-UNLINKED", "G-MISSING"], [true, true, true, true, true, true, true, true, true, true]],
      ["admin_recruiter", "22222222-2222-2222-2222-222222222222", ["G-SITE", "G-DIRECT", "G-FULL-PIC", "G-SHARED-TARGET", "G-SHARED-OWNER", "G-BLANKPIC", "G-NULLPIC", "G-NONE", "G-UNLINKED", "G-MISSING"], [true, true, true, true, true, true, true, true, true, true]],
      ["site_recruiter", "33333333-3333-3333-3333-333333333333", ["G-SITE", "G-DIRECT", "G-FULL-PIC", "G-SHARED-TARGET", "G-SHARED-OWNER", "G-BLANKPIC", "G-NULLPIC", "G-NONE", "G-UNLINKED", "G-MISSING"], [false, true, true, true, true, false, false, false, false, false]],
      ["viewer", "44444444-4444-4444-4444-444444444444", ["G-SITE", "G-DIRECT", "G-FULL-PIC", "G-SHARED-TARGET", "G-SHARED-OWNER", "G-BLANKPIC", "G-NULLPIC", "G-NONE", "G-UNLINKED", "G-MISSING"], [true, true, true, true, true, true, true, true, false, false]],
      ["site_recruiter_blank_names", "66666666-6666-6666-6666-666666666666", ["G-SITE", "G-DIRECT", "G-FULL-PIC", "G-SHARED-TARGET", "G-SHARED-OWNER", "G-BLANKPIC", "G-NULLPIC", "G-NONE", "G-UNLINKED", "G-MISSING"], [false, false, false, false, false, true, false, true, false, false]],
      ["site_recruiter_null_profile_fields", "77777777-7777-7777-7777-777777777777", ["G-SITE", "G-DIRECT", "G-FULL-PIC", "G-SHARED-TARGET", "G-SHARED-OWNER", "G-BLANKPIC", "G-NULLPIC", "G-NONE", "G-UNLINKED", "G-MISSING"], [false, false, false, false, false, false, false, false, false, false]],
      ["site_recruiter_site_match", "88888888-8888-8888-8888-888888888888", ["G-SITE", "G-DIRECT", "G-FULL-PIC", "G-SHARED-TARGET", "G-SHARED-OWNER", "G-BLANKPIC", "G-NULLPIC", "G-NONE", "G-UNLINKED", "G-MISSING"], [true, true, true, true, true, false, false, false, false, false]],
      ["unknown_role", "55555555-5555-5555-5555-555555555555", ["G-SITE", "G-DIRECT", "G-FULL-PIC", "G-SHARED-TARGET", "G-SHARED-OWNER", "G-BLANKPIC", "G-NULLPIC", "G-NONE", "G-UNLINKED", "G-MISSING"], [false, false, false, false, false, false, false, false, false, false]],
      ["missing_profile", "99999999-9999-9999-9999-999999999999", ["G-SITE", "G-DIRECT", "G-FULL-PIC", "G-SHARED-TARGET", "G-SHARED-OWNER", "G-BLANKPIC", "G-NULLPIC", "G-NONE", "G-UNLINKED", "G-MISSING"], [false, false, false, false, false, false, false, false, false, false]]
    ];
    for (const [label, uid, groupIds, expected] of cases) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
      const result = await db.query("select g.group_id, app_private.can_read_position_group_reference(g.group_id) as reference, app_private.can_read_position_group(g.group_id) as fast from unnest($1::text[]) g(group_id) order by g.group_id", [groupIds]);
      assert.deepEqual(result.rows.map(row => row.fast), result.rows.map(row => row.reference), `${label} visibility matches the existing helper`);
      const byGroup = Object.fromEntries(result.rows.map(row => [row.group_id, row.fast]));
      assert.deepEqual(groupIds.map(id => byGroup[id]), expected, `${label} expected visibility including shared requisition PIC claim semantics`);
    }
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    const nullAuth = await db.query("select app_private.can_read_position_group_reference('G-SITE') as reference, app_private.can_read_position_group('G-SITE') as fast");
    assert.deepEqual(nullAuth.rows[0], { reference: false, fast: false }, "a missing auth.uid() denies group access");
    await db.query("select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false)");
    const nullGroup = await db.query("select app_private.can_read_position_group_reference(null) as reference, app_private.can_read_position_group(null) as fast");
    assert.deepEqual(nullGroup.rows[0], { reference: false, fast: false }, "a NULL group id denies non-global group access");
    const candidateCases = [
      ["site-home-match", "33333333-3333-3333-3333-333333333333", ["CAN-HOME-APP","CAN-HOME-NO-APP","CAN-GROUP-APP","CAN-CREATED-NO-APP","CAN-PARALLEL-VISIBLE","CAN-PARALLEL-HIDDEN"], [true,false,true,true,true,false]],
      ["viewer-app-existence", "44444444-4444-4444-4444-444444444444", ["CAN-VIEWER-APP","CAN-VIEWER-NO-APP"], [true,false]],
      ["site-home-match-group-denial", "88888888-8888-8888-8888-888888888888", ["CAN-TEST-HOME-APP","CAN-TEST-HOME-NO-APP"], [true,false]],
      ["admin-global", "11111111-1111-1111-1111-111111111111", ["CAN-HOME-NO-APP","CAN-VIEWER-NO-APP"], [true,true]],
      ["creator-unmatched", "33333333-3333-3333-3333-333333333333", ["CAN-CREATED-NO-APP"], [true]]
    ];
    for (const [label, uid, candidateIds, expected] of candidateCases) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
      const result = await db.query("select c.candidate_id,app_private.can_read_candidate_reference(c.candidate_id) as reference,app_private.can_read_candidate(c.candidate_id) as fast from unnest($1::text[]) c(candidate_id) order by c.candidate_id", [candidateIds]);
      assert.deepEqual(result.rows.map(row => row.fast), result.rows.map(row => row.reference), `${label} matches the existing candidate helper`);
      const byCandidate = Object.fromEntries(result.rows.map(row => [row.candidate_id,row.fast]));
      assert.deepEqual(candidateIds.map(id => byCandidate[id]), expected, `${label} preserves application-existence semantics`);
      const experiment = await db.query("select c.candidate_id,app_private.can_read_candidate_reference(c.candidate_id) as reference,app_private.can_read_candidate_inline_experiment(c.candidate_id) as experimental from unnest($1::text[]) c(candidate_id) order by c.candidate_id", [candidateIds]);
      assert.deepEqual(experiment.rows.map(row => row.experimental), experiment.rows.map(row => row.reference), `${label} flattened candidate predicate matches the saved original helper graph`);
    }
    const applicationCases = [
      ["site_recruiter", "33333333-3333-3333-3333-333333333333"],
      ["viewer", "44444444-4444-4444-4444-444444444444"],
      ["system_admin", "11111111-1111-1111-1111-111111111111"],
      ["admin_recruiter", "22222222-2222-2222-2222-222222222222"],
      ["unknown_role", "55555555-5555-5555-5555-555555555555"],
      ["blank_names", "66666666-6666-6666-6666-666666666666"],
      ["null_profile_fields", "77777777-7777-7777-7777-777777777777"],
      ["missing_profile", "99999999-9999-9999-9999-999999999999"]
    ];
    const applicationIds = ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6","aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7","bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"];
    for (const [label,uid] of applicationCases) {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
      const applications=await db.query("select a.application_id,app_private.can_read_application_reference(a.application_id) reference,app_private.can_read_application_inline_experiment(a.application_id) experimental from unnest($1::uuid[]) ids(application_id) left join public.candidate_applications a using(application_id)", [applicationIds]);
      assert.deepEqual(applications.rows.map(row=>row.experimental),applications.rows.map(row=>row.reference),`${label} flattened application predicate matches the saved original helper graph`);
    }
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    const nullUser=await db.query("select app_private.can_read_application_reference('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2') reference,app_private.can_read_application_inline_experiment('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2') experimental");
    assert.deepEqual(nullUser.rows[0],{reference:false,experimental:false},"flattened application auth denies NULL auth.uid()");
    console.log("scoped group authorization fast-path matches the existing helper across all role/claim fixtures");
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
