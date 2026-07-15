# Recruitment Website Structure

Last updated: 2026-07-14

## Overview

The recruitment tracking website is a Next.js app backed by Supabase:

```text
Browser UI
  -> Next.js App Router pages and React workspace state
  -> Supabase Auth and protected admin API routes
  -> Supabase Postgres with RLS, RPC write functions, and audit logs
```

The Home page is the first screen after opening or signing in. Dashboard is now a dedicated Vacancy Waterfall reporting page.
Sidebar navigation preserves the current `lang`, `site`, `pic`, and `sourcingWeek` query parameters when moving between routes.

The core product surface is the five-section Hiring Workspace:

1. Home
2. Requisitions
3. Sourcing
4. Candidates
5. Pipeline

The workspace is not read-only. It embeds transactional surfaces for requisition creation and change, sourcing-group creation and matching, candidate creation and update, pipeline movement, and offer recording. These actions use the command dispatcher pattern so the UI opens the right modal, drawer, or follow-on flow from the current context.

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

Hiring Workspace behavior:

- The workspace is organized around a group-scoped hiring journey rather than static tabs.
- The same candidate, requisition, and offer records are reused across the journey, with each surface opening the correct transactional action for the current stage.
- Group-aware navigation keeps `group_id` context available when moving between Sourcing, Candidates, Pipeline, and Offer-related actions.
- Workspace actions should preserve the current `lang`, `site`, `pic`, and `sourcingWeek` query parameters where applicable.
- Workspace selection is group-first. Treat `/workspace?type=group&id=...` as the primary hiring-case entry point when a group exists, and treat requisition workspace URLs as a compatible focused slice of the same journey.
- Workspace URL context is breadcrumb state, not disposable filter state. `type`, `id`, optional `doc`, and `section` identify the current hiring case, while `lang`, `site`, `pic`, and `sourcingWeek` remain preserved navigation context across links and actions.
- Group-level workspace tabs show aggregate group information by default. Selecting a `doc` narrows Sourcing, Pipeline, Offer, and Activity to that requisition, and changing `doc` preserves the active `section`.
- When no workspace is selected, `/workspace` renders the searchable workspace picker directly instead of a redundant empty workspace header.
- `section=offer` is the canonical workspace URL for offer creation and follow-up. Legacy `section=outcome` links are replaced with `section=offer` without adding browser history.
- Workspace targets are active open work only: requisitions must be ongoing with remaining open headcount, and groups must include at least one such requisition. Filtered-out direct URLs show the invalid-target picker state.

Sidebar order:

1. Home
2. Workspace
3. Records
4. Dashboard
5. Audit Log

Records is an expandable sidebar parent, not a route. It uses the pencil icon and contains Requisitions, Sourcing, Candidates, Pipeline, and Offers while preserving the existing page URLs. Administration remains visible only to `system_admin` near the control/audit area.

Desktop sidebar still supports the persisted icon-only collapsed rail. If Records is expanded while collapsed, the child page icons render vertically under the Records icon. On mobile, the grouped sidebar remains a horizontal scrollable navigation row so the main destinations stay reachable without expanding the page vertically.

## Home Page

Home is the operational landing page.

Current order:

1. Four responsive summary cards:
   - Open requisition: `x requisitions`
   - Filled vacancy: `x/y vacancies`
   - Ongoing candidate: `x candidates`
   - Weekly sourcing update: `x Group ID`
2. Today's Work / Workspace Watchlist.
3. Data Quality.
4. Candidate Pipeline preview.
5. Weekly Sourcing Updates for open groups not updated for more than 6 days, including never-updated groups.
6. Open Headcount.
7. Recent Activity, shown only to `system_admin` and `admin_recruiter`.

Home-only recruiter bottleneck:

- The recruiter work queue and bottleneck triage live on Home, not inside the workspace sections.
- Home owns the compact work queue, aging counts, sourcing-gap counts, and factual issue labels.
- Home list sections render all available items. Today's Work, Data Quality, Sourcing Updates, Open Headcount, and Recent Activity become contained horizontal scroll rows when they exceed three items; Candidate Pipeline becomes a contained horizontal scroll row when it exceeds four items. Do not reintroduce kebab/reveal controls for these Home lists.
- Workspace sections may show diagnostics and commands for the selected hiring case, but Home remains the only page that aggregates recruiter bottlenecks across all assigned work.
- Recommendation and next-action language is removed. Use factual risk labels and explicit commands such as Open, Edit, Save, or Create Offer.

The Welcome Back popup appears once per browser session/login. It summarizes actionable responsible records, links users toward Pipeline work, and uses a warm professional message selected by the user’s last-7-days filled responsible vacancy ratio.

Welcome Back message logic:

- Ratio is accepted offers in the last 7 calendar days for responsible requisitions divided by total responsible non-cancelled vacancy headcount.
- Buckets are floor-based: `0`, `25`, `50`, `75`, and `100`.
- The popup shows the selected message, ratio percentage, and `{filled}/{total}` vacancy helper without backend connector changes.

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

Recruitment Pipeline Health is a separate collapsible funnel report with its own date range, level filter, channel filter, and PDF export. Funnel rows are `Applicants`, derived `Resume Screening`, then active pipeline stages. `Resume Screening` is display/reporting-only and is counted from candidates who have reached Phone Screen. Real stage funnel counts are passed-only and de-duplicated per candidate per stage.

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
- Workspace > Sourcing reuses the embedded weekly sourcing editor, so recruiters can update applicant counts for the related group or requisition without leaving `/workspace`.
- Weekly sourcing updates only show channels marked on the group or match snapshot.
- Weekly sourcing saves applicant counts only. It does not clear or change channel booleans; channel marking is changed through sourcing setup. Unsaved weeks prefill applicant inputs from the latest saved group update.
- The Sourcing Conversion Quality panel is collapsible in Records > Sourcing and collapsed by default there.
- Add Match shows only requisitions that do not already have any `document_groups` match.
- Doc ID options include position context, for example `DOC-001 - Accountant`.

Candidates:

- Candidates remain linked by `doc_group_id`; the UI resolves that to group-level context.
- Candidate channel is a dropdown filtered by the selected group’s marked sourcing channels.
- Candidate folder URL is stored in `candidate_folder_url` and shown as an external link in candidate detail.
- Candidate detail shows a pipeline journey above the timeline.
- Candidate Pipeline Journey includes a derived first `Resume Screening` dot. It is shown as passed for recorded candidates, but it is not stored in `recruitment_logs` and is not an active Pipeline board column.
- Candidate detail keeps stage/result in tags instead of duplicate summary boxes. The Update process action only appears when the candidate is updateable; secondary navigation actions live under the kebab menu.

Group doc URL context:

- Group-level document URLs are part of the shared workspace context, not isolated record links.
- Candidate detail, offer filtering, and requisition matching should resolve through `document_groups` so the UI can show the correct group, site, PIC, and position context for the current document URL.
- Group document context is the bridge between requisitions and candidate records when the user moves across the Hiring Workspace.

Process update validation:

- Users cannot update to a stage before the current stage.
- Update is unavailable if the candidate failed at any historical stage.
- Update is unavailable if the candidate completed all active stages.

Pipeline:

- Pipeline is group-based and resolves grouped doc IDs, sites, persons in charge, and group position.
- Active cards show candidate name, `{site}-{position} ({PIC})`, next-step icon, and last updated date.
- Active cards are sorted by latest update ascending in each stage so the oldest update appears first.
- Stage headers show a red warning icon before the stage name when any candidate in the stage has not been updated for more than 7 days; the stage name also turns red only while that warning icon is present.
- Aging candidate cards keep neutral card styling except the candidate action arrow turns red when that candidate has exceeded 7 days in the stage.
- Board filter and pipeline search live in a filter-icon popover at the right side of the board controls row, with the visible Group cards controls kept on the left. The popover supports Escape, outside-click dismissal, and active filter count.
- Stage metric text is compact and light; do not reintroduce bulky stage detail rows.
- Empty active Pipeline stage columns and empty Failed Candidates stage columns keep their body blank; only the all-empty Failed Candidates panel shows an empty message.
- Test is a multi-round stage. A Test card can be maintained in Test to create the next pending Test round, or moved to Reference Check through the passed-stage confirmation flow.
- Maintaining Test saves the current pending Test round as Pass and creates the next Test round as Pending in one database transaction.
- When leaving Test, the latest Test round is used as the passed round. The confirmation modal can add extra pending Test rounds first, while the pass round remains locked to the original latest round, then creates Reference Check as pending.
- Offer-stage cards expose Update Offer through the candidate action menu, opening the Process Update modal for Offer.
- Failed Candidates use the same stage-column layout as the active pipeline for the current last-7-days window.
- Failed candidates remain workflow state. They should stay visible in Pipeline failed-candidate sections, but a failed candidate in an active stage is not a Data Quality issue.
- Passed Offer uses the same compact card arrangement, without the update arrow, in responsive multi-column layouts.

Command dispatcher:

- Workspace actions use a command dispatcher to route intent to the correct surface.
- Dispatcher targets include open detail, create record, update record, advance stage, add match, and start offer actions.
- The dispatcher should preserve current workspace context and open the corresponding embedded modal or drawer rather than sending users to a blank page.
- Offer-pass handoff is confirmed through the dispatcher. When a candidate passes Offer, the handoff into offer creation/update must preserve the candidate identity and requisition context until the user finishes or cancels the offer flow.
- Confirmation invariant: the pass confirmation and the resulting offer action must refer to the same candidate and resolved requisition context. Users should not confirm Offer pass for one candidate and land in another candidate or unrelated requisition Offer flow.

Offers:

- New Offer only shows candidates who passed Offer and have no offer record.
- After selecting a candidate, Doc ID options are limited to available requisitions in the candidate’s group.
- Available means not filled, not cancelled, open headcount greater than `0`, and no existing offer for that candidate/doc pair.
- Offer Type and Replaced fields were removed.
- Change Offer locks candidate and Doc ID and allows editing accepted date, first working date, and remark.
- The Offer surface is compact by design: offer actions, reconciliation prompts, and linked record actions should fit the shared workspace without reintroducing recommendation panels or redundant pipeline summaries.

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

New group-scope migration:

- The current schema changes standardize Hiring Workspace behavior around group scope.
- Group-scoped lookups now drive the workspace journey, document URL context, candidate matching, and offer availability rules.
- Any future migration in this area should keep `document_groups`, `position_groups`, and `doc_group_id` aligned so the five-section workspace continues to resolve context consistently.

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
- `viewer`: limited read access to the workspace and related records.
- System admins can create app accounts and update nickname/site/role mappings through `/api/admin/users`.
- Audit triggers write `change_logs` for every important table mutation.
- Recruitment-data RPCs should use recruitment-writer permission checks. User administration remains system-admin only.

## Visual System

The UI uses a restrained operational Swiss hierarchy:

- Deep Navy `#0B132B`: page titles, section titles, record names, Doc IDs, candidate names, and primary metric values.
- Slate/Cool neutrals: labels, metadata, helper copy, timestamps, inactive controls, borders, grids, and empty states.
- Primary Blue `#0A3CDC`: active navigation, primary actions, selected filter/tab states, focus treatment, one dominant visualization data fill, and all success/passed/in-SLA states.
- Orange/amber and scarlet: warning/risk only. Pair color with text or icon cues.
- Electric blue, teal, and purple should not be used as general UI accents. Use only when a specific visualization requires extra series separation.

Shared UI behavior:

- Prompt font usage.
- Calm dense internal-operations direction with a playful modern Swiss tone: crisp grids, compact surfaces, strong typography, and low color noise.
- Prefer neutral-first cards and panels. Use color only for selected state, primary action, or factual status/risk.
- Summary cards and operational metrics should use navy values by default; avoid coloring every metric.
- Vacancy Waterfall and Pipeline Funnel use one dominant blue data fill with subdued neutral grid/table structure.
- Magnifying-glass icon buttons for record View actions.
- Requisitions, Candidates, and Offers tables include explicit magnifying-glass detail buttons on desktop rows and mobile cards while keeping record names/IDs clickable for compatibility.
- Workspace uses the `LampDesk` icon in the sidebar.
- Record detail drawer headers show only a 3-dot actions menu and the compact Close button. The primary `Open workspace` action is an icon-only `LampDesk` button with tooltip and `aria-label`; related links and process updates live in the drawer body.
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
