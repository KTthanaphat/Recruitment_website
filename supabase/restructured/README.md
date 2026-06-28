# Restructured Supabase SQL

This folder contains a clean fresh-install SQL design for the recruitment website.

Use `00_fresh_schema.sql` for a new Supabase project or a reset prototype database. It is not intended to be run on top of a database that already has the existing migration history applied.

Use `01_existing_db_optimization.sql` only for an existing project that already has the current migrations applied. It keeps data in place and adds the safer ID counter design plus supporting indexes.

The existing files in `supabase/migrations/` are kept because Supabase migration history should not be rewritten after it has been applied. This folder is the optimized source of truth for rebuilding a new project from scratch.

## Design Goals

- Keep the current app contract: table names, column names, and RPC names remain compatible with the Next.js app.
- Put final v1 behavior into one readable SQL file instead of spread across multiple override migrations.
- Keep writes behind `security definer` RPC functions.
- Keep RLS deny-by-default with role and responsibility based reads.
- Use concurrency-safe prefixed ID counters instead of scanning tables for the next ID.
- Preserve audit logging, automatic requisition fill status, candidate pipeline automation, sourcing updates, and account role mapping.

## Install Order

1. Create a new Supabase project.
2. Open Supabase SQL Editor.
3. Run `00_fresh_schema.sql`.
4. Create the first app user in Supabase Auth.
5. Promote that user:

```sql
update public.profiles
set role = 'system_admin'
where email = 'your-admin-email@example.com';
```

6. Configure `.env.local`, Vercel, or Render with the Supabase URL, anon key, and server-only service role key.

## Existing Database Optimization

For a current Supabase project that already has data:

1. Back up the database first.
2. Run all existing migrations through `supabase/migrations/202606280004_requisition_request_type_live_waterfall.sql`.
3. Run `01_existing_db_optimization.sql`.

Do not run `00_fresh_schema.sql` on an existing database unless you intentionally reset the project first.
