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
2. Run `supabase/migrations/202606270001_recruitment_tracking_v1.sql` in SQL Editor.
3. Create the first Auth user manually.
4. Promote that user to admin:

```sql
update public.profiles
set role = 'admin'
where email = 'your-admin-email@example.com';
```

5. Add the Supabase URL, anon key, and service role key to `.env.local` or Vercel.

Do not upload real `.db`, `.xlsx`, candidate, employee, or offer files to GitHub or Vercel.
