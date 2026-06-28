# Recruitment Tracking System

Cloud prototype for end-to-end recruitment tracking.

## Stack

- Frontend: Next.js, TypeScript, Tailwind CSS
- Auth/data: Supabase Auth, Postgres, Row Level Security, RPC functions
- Deployment target: Vercel Hobby + Supabase Free
- Legacy reference: `app.py`, `schema.sql`, and `web/`

## Local Development

```powershell
copy .env.example .env.local
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Verification

```powershell
pnpm typecheck
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

The Playwright browser install is needed only once per machine.

## Render Deployment

This repository includes `render.yaml` for a Render web service deployment.

Render build settings:

```text
Build Command: npm install && npm run build
Start Command: npm run start -- -H 0.0.0.0 -p $PORT
```

Render environment variables:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL
```

After the first Render deploy, set `NEXT_PUBLIC_APP_URL` to the Render service URL, for example:

```text
https://recruitment-tracking.onrender.com
```

## Required Supabase Setup

1. Create a Supabase project.
2. Run the SQL files in `supabase/migrations/` in filename order.
3. Create the first Auth user manually.
4. Promote that user to system admin:

```sql
update public.profiles
set role = 'system_admin'
where email = 'your-admin-email@example.com';
```

5. Add the Supabase URL, anon key, and service role key to `.env.local` or Vercel.

Roles:

- `system_admin`: manage users, sourcing setup, and all recruitment records.
- `admin_recruiter`: see all sites and create/edit all recruitment records.
- `site_recruiter`: see assigned-site records and create/edit only records where their nickname is `person_in_charge`.
- `viewer`: see all sites, read only.

Do not upload real `.db`, `.xlsx`, candidate, employee, or offer files to GitHub or Vercel.

System admins can create users or update existing account nickname/site/role mappings from Sourcing > Administration > Manage User.

The Sourcing page stores weekly applicant counts per `group_id`. The dashboard waterfall reads `vacancy_weekly_snapshots`, defaults to January 1 through today, and can be filtered by start/end date.
