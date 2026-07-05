# Recruitment Website Structure

Last updated: 2026-07-05

## Overview

The recruitment tracking website is a Next.js app backed by Supabase:

```text
Browser UI
  -> Next.js App Router pages and React workspace state
  -> Supabase Auth and protected admin API routes
  -> Supabase Postgres with RLS, RPC write functions, and audit logs
```

The Home page is the first screen after opening or signing in. Dashboard is now a dedicated Vacancy Waterfall reporting page.

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
      page.tsx
      login/
      home/
      dashboard/
      requisitions/
      sourcing/
      candidates/
      pipeline/
      offers/
      admin/
      audit/
      api/admin/users/
    components/
      requisitions/
      sourcing/
      candidates/
      pipeline/
      offers/
      audit/
      ui/
    lib/
      constants.ts
      dictionary.ts
      supabaseClient.ts
  supabase/
    migrations/
    seed/
  tests/
    e2e/
    db/
  docs/
```

## Routes And Navigation

- `/login`: Supabase email/password app account login.
- `/`: redirects to `/home`.
- `/home`: action center with responsible summary, candidate pipeline preview, stale weekly sourcing updates, needs action, and admin recent activity.
- `/dashboard`: Vacancy Waterfall report, opened requisition detail, PDF export, and XLSX export.
- `/requisitions`: requisition list, new/replacement request type, replacement names, headcount progress, create/change, status log, and detail drawer.
- `/sourcing`: weekly applicant/channel updates per active `group_id`, position groups, and requisition matches.
- `/candidates`: candidate list, create/change, latest process/result, candidate folder link, and candidate detail drawer.
- `/pipeline`: group-based candidate board from Phone Screen through Offer, with keyboard-accessible next-step updates and drag/drop shortcut.
- `/offers`: offer records for Offer-pass candidates, available Doc ID filtering by candidate group, and automatic requisition fill logic.
- `/admin`: system-admin user administration.
- `/setup`: compatibility redirect to `/sourcing`.
- `/audit`: audit trigger history with old/new JSON values.

Sidebar order:

1. Home
2. Dashboard
3. Requisitions
4. Sourcing
5. Candidates
6. Pipeline
7. Offers
8. Administration
9. Audit Log

## Home Page

Home is the operational landing page.

Current order:

1. Four responsive summary cards:
   - Open requisition: `x requisitions`
   - Filled vacancy: `x/y vacancies`
   - Ongoing candidate: `x candidates`
   - Weekly sourcing update: `x Group ID`
2. Candidate Pipeline preview.
3. Weekly Sourcing Updates for open groups not updated for more than 6 days, including never-updated groups.
4. Needs Action.
5. Recent Activity, shown only to `system_admin` and `admin_recruiter`.

The Welcome Back popup appears once per browser session/login. It summarizes actionable responsible records and links users toward Pipeline work.

## Dashboard Page

Dashboard contains the Vacancy Waterfall report only.

The waterfall shows weekly recruitment performance by date range:

- Week Start: open headcount before the selected start date.
- Open: requisitions approved inside the selected date range.
- Filled: accepted offers inside the selected date range.
- Total: remaining vacancy grouped by site and requisition type.

The report keeps running-total connector logic between bars and uses right-side curly brace callouts for final stack segments.

Dashboard export actions:

- `Export PDF` for the chart report.
- `Export PDF` for opened requisition details.
- `Export XLSX` for opened requisition details.

PDF export uses browser print with A4 landscape print CSS and shows a loading overlay while preparing. Opened requisition detail stays horizontally scrollable on screen and uses print-specific table sizing so the SLA dot/age and dense columns remain readable in PDF.

Opened requisition detail includes requisitions opened in the selected date range and is collapsed by default. It includes requisition ownership, requisition date, applicant totals, historical pipeline stage counts, SLA status, fill status, and fill date. Applicant totals include Facebook, JobThai, JobTopGun, JobDB, LinkedIn, Walk-in, Referral, and Others.

## Recruitment Workflows

Requisitions:

- `Position` appears after `Section`.
- `Level (L)` is a dropdown from `0` to `14`.
- SLA age starts from `pr_approved_date` and uses calendar days.
- SLA thresholds are L0-L3: 30 days, L4-L9: 45 days, and L10-L14: 60 days.
- Operational overdue styling applies only to open requisitions with open headcount, valid PR approved date, valid level threshold, and age greater than SLA.
- Requisition list and Home Needs Action show age/SLA context; overdue open Doc IDs render red.
- Replacement requisitions require at least one replacement name.
- Multiple replacement names are stored as newline-delimited text in `replacement_names`.
- New Position requisitions submit `replacement_names` as null.
- After a new requisition is saved, the guided sourcing flow starts automatically.

Guided flow:

```text
Open requisition
  -> Create sourcing group
  -> Add match
  -> Ask whether candidate already exists
  -> Create candidate
  -> Candidate pipeline
```

Sourcing:

- Supported channels: Facebook, JobThai, JobTopGun, JobDB, LinkedIn, Walk-in, Referral, Others.
- Weekly sourcing updates only show channels marked on the group or match snapshot.
- Hidden/unmarked channels save as false with applicant count `0`.
- Add Match shows only requisitions that do not already have any `document_groups` match.
- Doc ID options include position context, for example `DOC-001 - Accountant`.

Candidates:

- Candidates remain linked by `doc_group_id`; the UI resolves that to group-level context.
- Candidate channel is a dropdown filtered by the selected group’s marked sourcing channels.
- Candidate folder URL is stored in `candidate_folder_url` and shown as an external link in candidate detail.
- Candidate detail shows a pipeline journey above the timeline.
- The timeline has an Update action that opens the existing Process Update modal above the candidate detail drawer.

Process update validation:

- Users cannot update to a stage before the current stage.
- Update is unavailable if the candidate failed at any historical stage.
- Update is unavailable if the candidate completed all active stages.

Pipeline:

- Pipeline is group-based and resolves grouped doc IDs, sites, persons in charge, and group position.
- Active cards show candidate name, `{site}-{position} ({PIC})`, next-step icon, and last updated date.
- Active cards are sorted by latest update ascending in each stage so the oldest update appears first.
- Stage headers show a red warning icon before the stage name when any candidate in the stage has not been updated for more than 7 days; the stage name and aging candidate next-step action use red emphasis.
- Aging candidate cards show the last updated date in red.
- Empty active Pipeline stage columns and empty Failed Candidates stage columns keep their body blank; only the all-empty Failed Candidates panel shows an empty message.
- Test is a multi-round stage. A Test card can be maintained in Test to create the next pending Test round, or moved to Reference Check through the passed-stage confirmation flow.
- Maintaining Test saves the current pending Test round as Pass and creates the next Test round as Pending in one database transaction.
- When leaving Test, the latest Test round is used as the passed round. The confirmation modal can add extra pending Test rounds first, while the pass round remains locked to the original latest round, then creates Reference Check as pending.
- Pending Offer cards can be updated from the card next-step button, opening the Process Update modal for Offer.
- Failed Candidates use the same stage-column layout as the active pipeline for the current last-7-days window.
- Passed Offer uses the same compact card arrangement, without the update arrow, in responsive multi-column layouts.

Offers:

- New Offer only shows candidates who passed Offer and have no offer record.
- After selecting a candidate, Doc ID options are limited to available requisitions in the candidate’s group.
- Available means not filled, not cancelled, open headcount greater than `0`, and no existing offer for that candidate/doc pair.
- Offer Type and Replaced fields were removed.
- Change Offer locks candidate and Doc ID and allows editing accepted date, first working date, and remark.

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

Important newer fields:

- `requisitions.replacement_names`
- `candidates.candidate_folder_url`
- sourcing channel flags and applicant counts for LinkedIn, Walk-in, Referral, and Others.

Candidates store `doc_group_id`, not a direct `group_id`. Group-level behavior is resolved through `document_groups`.

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
- `system_admin`: full recruitment-data access and user administration.
- `admin_recruiter`: full recruitment-data editor, setup/group/match editor, but not user administrator.
- `site_recruiter`: recruitment writer for assigned scope, including group and match creation.
- `viewer`: see all sites, read only.
- System admins can create app accounts and update nickname/site/role mappings through `/api/admin/users`.
- Audit triggers write `change_logs` for every important table mutation.
- Recruitment-data RPCs should use recruitment-writer permission checks. User administration remains system-admin only.

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

Shared UI behavior:

- Prompt font usage.
- Calm dense internal-operations direction. Optimize for scan speed, clear ownership, compact action cards, readable tables, and restrained visual emphasis.
- Plain blue/navy Home and Welcome summary cards.
- Magnifying-glass icon buttons for record View actions.
- Compact pagination footer: `< Page X of Y >`.
- Data tables use shared sortable/filterable headers with sort cycling, filled filter inputs, and filtered rows applied before pagination.
- Desktop sidebar can collapse to an icon-only `72px` rail with persisted `localStorage` preference; expanded width remains about `248px`.
- Accessible StageRail semantics.
- Keyboard-accessible pipeline stage update actions.
- URL query params for shareable site, person in charge, language, and Dashboard date/detail state.
- Use the local `internal-ops-ui` skill for future internal-tool UX/UI polish. Keep `gpt-taste` for marketing or Awwwards-style pages, not recruitment operations screens.

## Verification Commands

Use these before pushing product changes:

```powershell
pnpm typecheck
pnpm build
```

If browser behavior changed, also run or manually verify the impacted flow at `http://localhost:3000`.

## Documentation Rule

Update this file when routes, workflows, database tables, RPCs, roles, or visual structure change.
