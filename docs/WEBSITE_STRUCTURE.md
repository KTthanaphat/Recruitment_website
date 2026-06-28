# Recruitment Website Structure

Last updated: 2026-06-28

## Overview

The v1 cloud prototype is a Next.js app backed by Supabase:

```text
Browser UI
  -> Next.js client components and protected API routes
  -> Supabase Auth
  -> Supabase Postgres with RLS and RPC write functions
```

The previous Python/SQLite app remains in the repository as a legacy reference:

```text
app.py
schema.sql
web/
```

Do not deploy the legacy SQLite database files to public cloud.

## Folder Structure

```text
recruitment_website/
  src/
    app/
      login/
      dashboard/
      requisitions/
      candidates/
      pipeline/
      offers/
      sourcing/
      setup/
      audit/
      api/admin/users/
    components/
      layout/
      dashboard/
      requisitions/
      candidates/
      pipeline/
      offers/
      sourcing/
      setup/
      audit/
      ui/
    lib/
      supabase/
      i18n/
      validation/
    types/
  supabase/
    migrations/
    seed/
  tests/
    e2e/
    db/
  docs/
```

## Main Experience

- `/login`: Supabase email/password app account login.
- `/dashboard`: first screen after login, with KPI metrics, responsible-work metrics, start/end date vacancy waterfall derived from requisitions/offers, needs-action queue, recent activity, and pipeline preview.
- `/requisitions`: requisition list, new/replacement request type, headcount progress, create/change, status log, and detail drawer.
- `/candidates`: candidate list, create/change, latest process/result, and candidate detail drawer.
- `/pipeline`: horizontal candidate board from Phone Screening onward. New candidates receive a pending Phone Screening log, pass updates append the next pending stage, and drag/drop asks recruiters to confirm every passed stage before creating the new pending stage.
- `/offers`: accepted/start dates, offer type, replacement, and automatic requisition fill logic.
- `/sourcing`: weekly applicant/channel updates per active `group_id`, plus admin tools for groups, requisition matches, and users.
- `/setup`: compatibility redirect to `/sourcing`.
- `/audit`: audit trigger history with old/new JSON values.

## Data Model

Supabase tables:

- `profiles`
- `requisitions`
- `requisition_logs`
- `position_groups`
- `document_groups`
- `candidates`
- `recruitment_logs`
- `offers`
- `sourcing_weekly_updates`
- `vacancy_weekly_snapshots`
- `change_logs`

The dashboard waterfall currently uses live requisitions and accepted offers. `vacancy_weekly_snapshots` remains available for future imported snapshot workflows, but it is no longer required for the dashboard chart.

Protected RPC functions handle all recruitment writes:

- `app_upsert_requisition`
- `app_insert_requisition_log`
- `app_upsert_position_group`
- `app_create_group_match`
- `app_upsert_sourcing_weekly_update`
- `app_upsert_candidate`
- `app_insert_recruitment_log`
- `app_insert_pipeline_passes`
- `app_upsert_offer`

## Security

- Anonymous users cannot read or write recruitment data.
- Authenticated users receive access by `profiles.role`.
- Roles: `system_admin`, `admin_recruiter`, `site_recruiter`, `viewer`.
- `system_admin`: manage users, setup, and all recruitment records.
- `admin_recruiter`: see all sites and create/edit all recruitment records.
- `site_recruiter`: see assigned-site records and create/edit only records where their nickname is `person_in_charge`; new requisitions are automatically assigned to their site and nickname.
- `viewer`: see all sites, read only.
- System admins can create app accounts and update nickname/site/role mappings through `/api/admin/users`.
- Audit triggers write `change_logs` for every important table mutation.

## Visual System

The UI follows the local palette asset:

- Deep Navy `#0B132B`
- Primary Blue `#0A3CDC`
- Electric Blue `#146EFA`
- Off White `#FAFAFC`
- Light Gray `#F1F5F9`
- Emerald `#00B894`
- Energy Orange `#FF8A00`
- Scarlet `#FF3B30`
- Amber `#FFC107`
- Teal/Purple as secondary accents

## Documentation Rule

Update this file when routes, workflows, database tables, RPCs, roles, or visual structure change.
