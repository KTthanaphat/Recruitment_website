# Recruitment Website Deployment Guide

Last updated: 2026-07-05

## Target Deployment

Free cloud prototype:

```text
GitHub repository
  -> Vercel Hobby deployment
  -> Supabase Free Auth/Postgres/RLS
```

Before production or real candidate data, confirm company approval for cloud storage of HR/recruitment records.

Current stack:

- Next.js 14 App Router.
- React, TypeScript, Tailwind CSS, lucide-react.
- Supabase Auth and Postgres.
- Browser print-to-PDF and client-side XLSX export.
- Primary development branch: `develop`.

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

`/` redirects to `/home`.

## Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor.
3. Run the SQL files in `supabase/migrations/` in filename order.
   - `supabase/schemas/` is the declarative source of truth for future schema/RPC changes.
   - Edit `supabase/schemas/` first, then generate and review one migration with `supabase db diff -f describe_change`.
   - Do not edit the remote database directly in Supabase Studio for schema/RPC changes.
4. Disable public signup unless the company explicitly wants self-registration.
5. Create the first Auth user manually.
6. Promote the first user:

```sql
update public.profiles
set role = 'system_admin'
where email = 'your-admin-email@example.com';
```

7. Sign in to the app and create or update accounts from Sourcing > Administration > Manage User. Each account should have a nickname; site recruiter accounts also need an assigned site.
8. Create requisitions with the correct request type (`New` or `Replacement`) and record accepted offers. The dashboard waterfall is calculated from those live records.

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

## How To Push Product Changes To `develop` Without Error

Use this workflow for product code, UI, database migration, and documentation changes.
Use plain `git` commands only. Do not use GitHub CLI (`gh`) for this workflow.

### 1. Confirm Branch And Clean Scope

```powershell
git switch develop
git status --short --branch
```

Expected branch:

```text
## develop...origin/develop
```

If unrelated files are modified, do not reset them unless they are yours and you intentionally want to discard them. Commit only the files that belong to the change.

### 2. Sync Before Editing Or Pushing

```powershell
git fetch origin
git status --short --branch
```

If local `develop` is behind origin:

```powershell
git pull --ff-only origin develop
```

If `--ff-only` fails, stop and inspect the branch divergence before pushing.

### 3. Run Verification

Minimum checks:

```powershell
pnpm typecheck
pnpm build
```

For browser-visible workflow changes, also verify the affected route locally:

```powershell
pnpm dev
```

Use:

```text
http://localhost:3000
```

For end-to-end coverage when needed:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

### 4. Review The Diff

```powershell
git diff --stat
git diff
```

Check especially:

- No `.env.local` or secrets.
- No generated build folders.
- No unrelated local files.
- Supabase migrations are included when schema/RPC behavior changes.
- Documentation is updated when product behavior changes.

### 5. Commit Intentionally

```powershell
git add <changed-files>
git status --short
git commit -m "Describe the product change"
```

Use a concrete commit message, for example:

```text
Refine home summary and pipeline card layout
```

### 6. Push To Develop

```powershell
git push origin develop
```

This pushes the current local `develop` commit to the remote `develop` branch directly through Git.
It does not create a pull request and does not require `gh`.

If push is rejected because remote has new commits:

```powershell
git pull --ff-only origin develop
pnpm typecheck
pnpm build
git push origin develop
```

If the pull is not fast-forward, stop and resolve the branch state deliberately instead of forcing a push.

### 7. Confirm Remote State

```powershell
git status --short --branch
git log --oneline -1
```

Expected after a clean push:

```text
## develop...origin/develop
```

with no ahead/behind marker.

## Common Push Error Prevention

- Always run `git switch develop` before committing.
- Always run `git fetch origin` before pushing.
- Prefer `git pull --ff-only origin develop`; it prevents accidental merge commits.
- Never use `git push --force` for normal product work.
- Never commit `.env.local`, Supabase service keys, database dumps, exported candidate files, or candidate documents.
- Keep migrations and app code in the same commit when the app depends on schema/RPC changes.
- Keep declarative schema files and generated migration files in the same commit.
- Re-run `pnpm typecheck` after resolving conflicts.
- If `pnpm build` hangs after the Next.js banner, capture where it hangs and report it separately; do not assume the build passed.
- If Git reports `.git/index.lock`, first make sure no Git command, editor Git operation, or Codex commit task is running. Only then delete the stale lock file and rerun `git status --short --branch`.

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

- `/` redirects to `/home`.
- Login redirects to Home.
- Anonymous browser cannot read Supabase tables.
- Viewer can read all sites but cannot save.
- Admin recruiter can read all sites and create/edit recruitment records and setup records, but cannot manage users.
- Site recruiter can read assigned-site records and create/edit records only when their nickname is the requisition person in charge.
- System admin can create app accounts, manage sourcing setup, and create/edit records.
- Sourcing weekly updates save by `group_id` and are restricted to responsible groups for site recruiters.
- Home shows four summary cards, Candidate Pipeline, Weekly Sourcing Updates, Needs Action, and admin-only Recent Activity.
- Welcome Back popup appears once per session and uses responsible actionable counts.
- Creating a candidate creates an initial pending Phone Screening log.
- Marking a pending active stage as Pass appends the next stage as Pending.
- Requisition Replacement requires at least one replacement name and supports multiple names.
- Guided flow starts only after creating a new requisition and pre-fills group, match, and candidate values.
- Sourcing weekly updates show only marked channels and save all channel fields safely.
- Candidate channel options follow the selected group's marked channels.
- Candidate detail shows folder link, pipeline journey, and Process Update above the drawer.
- Dashboard Vacancy Waterfall renders with date filters, legend, curly brace callouts, chart PDF export, requisition detail PDF export, and XLSX export.
- Accepted offers auto-fill requisitions when accepted count reaches headcount.
- Pipeline blocks invalid backward updates, completed candidates, and candidates with any historical fail.
- Pipeline cards sort by latest update descending and show stage aging warning when needed.
- New Offer only shows Offer-pass candidates with no offer record and limits Doc ID options to available requisitions in the candidate's group.
- Thai mode still renders changed labels.
- Audit log records changes with actor, action, old data, and new data.
