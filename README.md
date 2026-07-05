# Recruitment Tracking System

Cloud prototype for end-to-end recruitment tracking.

Current canonical documentation:

- [Website structure](docs/WEBSITE_STRUCTURE.md)
- [Deployment and develop-branch push workflow](docs/DEPLOYMENT.md)
- [AI handover overview](docs/AI_HANDOVER.md)

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

## Product Areas

- Home: responsible summary, candidate pipeline preview, stale weekly sourcing updates, needs action, and admin recent activity.
- Dashboard: Vacancy Waterfall report with chart PDF, requisition detail PDF, and requisition detail XLSX export.
- Requisitions: new/replacement requests, replacement names, headcount tracking, and guided sourcing flow after new requisition creation.
- Sourcing: position groups, requisition matches, and weekly updates for marked channels.
- Candidates and Pipeline: group-based candidate context, candidate folder links, pipeline journey, and validated stage updates.
- Offers: Offer-pass candidates only, available Doc ID filtering by candidate group, and accepted-offer fill logic.

## Develop Branch Push Workflow

The full safe workflow is documented in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Short version:

```powershell
git switch develop
git fetch origin
git pull --ff-only origin develop
pnpm typecheck
pnpm build
git status --short
git add <changed-files>
git commit -m "Describe the product change"
git push origin develop
```

Do not use `git push --force` for normal product work.

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
- `admin_recruiter`: create/edit recruitment records and setup records, but not user administration.
- `site_recruiter`: assigned-scope recruitment writer, including group and match creation.
- `viewer`: see all sites, read only.

System admins can create users or update existing account nickname/site/role mappings from Administration.

Do not upload real `.db`, `.xlsx`, candidate, employee, offer, or candidate document files to GitHub or Vercel.
