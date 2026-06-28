# Recruitment Website Deployment Guide

Last updated: 2026-06-27

## Target Deployment

Free cloud prototype:

```text
GitHub repository
  -> Vercel Hobby deployment
  -> Supabase Free Auth/Postgres/RLS
```

Before production or real candidate data, confirm company approval for cloud storage of HR/recruitment records.

## Local Run

```powershell
cd "C:\Users\thanaphat-krea\OneDrive - GFPT Public Company Limited\HR_database\recruitment_website"
copy .env.example .env.local
pnpm install
pnpm dev
```

Open:

```text
http://localhost:3000
```

## Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor.
3. Run the SQL files in `supabase/migrations/` in filename order.
4. Disable public signup unless the company explicitly wants self-registration.
5. Create the first Auth user manually.
6. Promote the first user:

```sql
update public.profiles
set role = 'system_admin'
where email = 'your-admin-email@example.com';
```

7. Sign in to the app and create or update accounts from Setup > Users and Roles > Manage User. Each account should have a nickname; site recruiter accounts also need an assigned site.

## Environment Variables

Local `.env.local` and Vercel project variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL
```

`SUPABASE_SERVICE_ROLE_KEY` must remain server-only. It is used by `/api/admin/users` for admin user creation.

## Vercel Setup

1. Connect GitHub repository `KTthanaphat/Recruitment_website`.
2. Framework preset: Next.js.
3. Build command: `pnpm build`.
4. Install command: `pnpm install`.
5. Output directory: default.
6. Add environment variables.
7. Deploy `main` as production.
8. Use `develop` branches/PRs for preview deployments.

## Data Safety

Do not commit or upload:

- `*.db`
- `*.sqlite`
- `*.xlsx`
- live candidate records
- live employee records
- resumes or personal documents

The repository ignores SQLite database files and local environment files.

## Verification Checklist

- Login redirects to dashboard.
- Anonymous browser cannot read Supabase tables.
- Viewer can read all sites but cannot save.
- Admin recruiter can read all sites and create/edit recruitment records.
- Site recruiter can read assigned-site records and create/edit records only when their nickname is the requisition person in charge.
- System admin can create app accounts, manage setup, and create/edit records.
- Accepted offers auto-fill requisitions when accepted count reaches headcount.
- Pipeline drag/drop rejects backward moves.
- Audit log records changes with actor, action, old data, and new data.
