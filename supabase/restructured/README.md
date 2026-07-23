# Legacy Restructured Supabase SQL

This folder is retained for historical reference. The active database source of
truth is now `supabase/schemas/`.

Use the declarative schema files for new database work:

```powershell
supabase db diff -f describe_change
supabase db reset
supabase db push --dry-run
```

The existing files in `supabase/migrations/` are kept because Supabase migration
history should not be rewritten after it has been applied. The one-time
transition migration adds the declarative-schema structure and hardens function
grants for the current project.

## Current Design Goals

- Keep the current app contract: table names, column names, and RPC names remain compatible with the Next.js app.
- Put final behavior into modular declarative SQL files instead of spread across multiple override migrations.
- Keep writes behind `security definer` RPC functions.
- Keep RLS deny-by-default with role and responsibility based reads.
- Use concurrency-safe prefixed ID counters instead of scanning tables for the next ID.
- Preserve audit logging, automatic requisition fill status, candidate pipeline automation, sourcing updates, and account role mapping.

## Fresh Install Order

1. Create a new Supabase project.
2. Open Supabase SQL Editor.
3. Apply migrations, or use the Supabase CLI against the declarative schema workflow.
4. Create the first app user in Supabase Auth.
5. Promote that user:

```sql
update public.profiles
set role = 'system_admin'
where email = 'your-admin-email@example.com';
```

6. Configure `.env.local`, Vercel, or Render with the Supabase URL, anon key, and server-only service role key.

## Existing Database Optimization

For a current Supabase project that already has data, use the transition
migration in `supabase/migrations/`.

1. Back up the database first.
2. Review `20260720170548_declarative_schema_transition.sql`.
3. Apply it through the Supabase CLI or deployment pipeline.

Do not run `00_fresh_schema.sql` on an existing database unless you intentionally reset the project first.
