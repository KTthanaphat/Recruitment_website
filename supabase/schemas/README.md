# Declarative Supabase Schemas

These files are the source of truth for the recruitment app database shape.
Edit these files first, then generate and review a migration with the Supabase CLI before deploying.

Recommended workflow:

```powershell
supabase db diff -f describe_change
supabase db reset
supabase db push --dry-run
```

Do not edit the remote database directly in Supabase Studio for schema or RPC changes. Direct remote edits bypass migration history and will not be reflected in future declarative diffs.
