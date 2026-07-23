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
Authenticated route headers show only the route title plus the compact top-right command row. Site and Person in Charge filters live in that row before language, refresh, and account controls, using the same blue command-control treatment; their visible stacked labels and Clear button are intentionally removed while accessible labels remain. There is no separate page subtitle or sticky filter card.

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
- The selected workspace context is a sticky command header. It shows breadcrumbs, group/requisition title, meta, readiness/SLA, actions, and summary metrics; after page scroll, the summary collapses into compact metric chips while the selected case stays visible.
- Workspace section navigation uses connected browser-style tabs attached to the selected content panel. The selected tab visually merges with the content underneath; URL `section` state remains unchanged.

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

1. Today's Work / Workspace Watchlist with one compact four-metric strip for open requisitions, urgent items, aging candidates, and sourcing gaps.
2. Recruitment Records tabs in this fixed order:
   - Open Headcount
   - Candidate Pipeline
   - Sourcing Updates
   - Data Quality
   - Recent Activity, shown only to `system_admin` and `admin_recruiter`

The selected Home tab contains all applicable records in a vertically scrollable card grid. Desktop uses two columns from the `md` breakpoint; smartphones use one column. Home record tabs use the same connected browser-tab treatment as Workspace: muted rail, selected tab attached to the white content panel, compact count badges, horizontal scrolling on narrow screens, and Arrow/Home/End keyboard support. Home does not use URL state for the selected tab.

Home-only recruiter bottleneck:

- The recruiter work queue and bottleneck triage live on Home, not inside the workspace sections.
- Home owns the compact work queue, aging counts, sourcing-gap counts, and factual issue labels.
- Today's Work remains a compact work queue. The tabbed Recruitment Records surface replaces the former standalone Home Data Quality, Candidate Pipeline, Sourcing Updates, Open Headcount, Recent Activity, and recruiter bottleneck panels.
- Workspace sections may show diagnostics and commands for the selected hiring case, but Home remains the only page that aggregates recruiter bottlenecks across all assigned work.
- Recommendation and next-action language is removed. Use factual risk labels and explicit commands such as Open, Edit, Save, or Create Offer.

The Welcome Back popup appears once per browser session/login. It summarizes actionable responsible records, links users toward Pipeline work, and uses a warm professional message selected by the user’s last-7-days filled responsible vacancy ratio.

Welcome Back message logic:

- Ratio is accepted offers in the last 7 calendar days for responsible requisitions divided by total responsible non-cancelled vacancy headcount.
- Message text comes from `recruitment_daily_messages_th_en.csv`, mirrored at runtime in `src/lib/daily-messages.ts` to avoid runtime CSV parsing.
- Select the current local weekday row with the highest `Filled%_min` less than or equal to the filled vacancy ratio.
- Use `Current_Thai_Version` in Thai and `English_Version` in English; replace `{name}` with nickname, full name, email, or system fallback.
- If no CSV row matches, fall back to the legacy dictionary ratio message.
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
- Requisition Fill Readiness is tone-colored text in records and detail drawers, not a boxed tag.
- Replacement requisitions require at least one replacement name.
- Multiple replacement names are stored as newline-delimited text in `replacement_names`.
- New Position requisitions submit `replacement_names` as null.
- After a new requisition is saved, the guided sourcing flow starts automatically.
- Department and Section are dropdowns sourced from `dep_sec_data.csv` through `/api/department-sections`. Department options are filtered by selected Site, Section is disabled until Department is selected, and existing legacy saved values remain selectable when editing.

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
- Records > Sourcing shows unmatched sourcing groups in a separate warning section above weekly update cards. Users must match these groups to a requisition before weekly sourcing updates are available.
- Weekly sourcing updates only show channels marked on the group or match snapshot.
- Weekly sourcing saves applicant counts only. It does not clear or change channel booleans; channel marking is changed through sourcing setup. Unsaved weeks prefill applicant inputs from the latest saved group update.
- The Sourcing Conversion Quality panel is collapsible in Records > Sourcing and collapsed by default there.
- Add Match shows only requisitions that do not already have any `document_groups` match.
- Doc ID options include position context, for example `DOC-001 - Accountant`.
- Unmatch removes one `document_groups` link between a requisition and a sourcing group. It is blocked when candidates reference that match.

Candidates:

- Candidates remain linked by `doc_group_id`; the UI resolves that to group-level context.
- Candidate channel is a dropdown filtered by the selected group’s marked sourcing channels.
- Candidate required fields are Name, Phone, Group ID, Channel, and First Contact Date. Candidate ID remains optional in New mode because it is generated.
- Reference Name is visible and required only when Channel is `Referral`; changing to another channel omits `ref_name` from the submitted candidate payload.
- First Contact Date cannot be before the oldest non-null PR Approved Date among requisitions linked to the selected group. If no linked requisition has a PR Approved Date, only the required-date check applies.
- Candidate folder URL is stored in `candidate_folder_url` and shown as an external link in candidate detail.
- Candidate detail shows a pipeline journey above the timeline.
- Candidate Pipeline Journey includes a derived first `Resume Screening` dot. It is shown as passed for recorded candidates, but it is not stored in `recruitment_logs` and is not an active Pipeline board column.
- Candidate detail keeps stage/result in tags instead of duplicate summary boxes. The Update process action only appears when the candidate is updateable; secondary navigation remains in the detail drawer action menu. Record tables/cards expose only the magnifying-glass View detail action.

Group doc URL context:

- Group-level document URLs are part of the shared workspace context, not isolated record links.
- Candidate detail, offer filtering, and requisition matching should resolve through `document_groups` so the UI can show the correct group, site, PIC, and position context for the current document URL.
- Group document context is the bridge between requisitions and candidate records when the user moves across the Hiring Workspace.

Process update validation:

- Users cannot update to a stage before the current stage.
- Update is unavailable if the candidate failed at any historical stage.
- Update is unavailable if the candidate completed all active stages.
- Manual Process Update cannot open a future stage while the latest stage is still pending. No-activity candidates can create Phone Screen as Pending; active candidates must complete the current pending stage with a result before the next pending stage is opened.

Pipeline:

- Pipeline is group-based and resolves grouped doc IDs, sites, persons in charge, and group position.
- Active stage panels use the current assigned-site accent as a tinted panel background; candidate cards remain neutral for scan speed.
- Active cards show candidate name, `{site}-{position} ({PIC})`, next-step icon, and last updated date.
- Active cards are sorted by latest update ascending in each stage so the oldest update appears first.
- Stage headers show only the stage label and count. If any candidate in the stage has not been updated for more than 7 days, the stage label turns red.
- Aging candidate cards keep neutral card styling except the candidate action arrow turns red when that candidate has exceeded 7 days in the stage.
- Board filter and pipeline search live in a filter-icon popover at the right side of the board controls row, with the visible Group cards controls kept on the left. The popover supports Escape, outside-click dismissal, and active filter count.
- Do not show SLA/pass/fail/latest metric text under Pipeline stage names.
- Empty active Pipeline stage columns and empty Failed Candidates stage columns keep their body blank; only the all-empty Failed Candidates panel shows an empty message.
- Forward jumps from drag/drop or card actions are allowed only through the passed-stage confirmation flow. The flow must confirm every crossed stage in order; the database writes Pending then Pass for each crossed stage that does not already have a matching pending row, then creates the target stage as Pending.
- Test is a multi-round stage. A Test card can be maintained in Test to create the next pending Test round, or moved to Reference Check through the passed-stage confirmation flow.
- Maintaining Test saves the current pending Test round as Pass and creates the next Test round as Pending in one database transaction.
- When leaving Test, the latest Test round is used as the passed round. The confirmation modal can add extra pending Test rounds first, while the pass round remains locked to the original latest round, then creates Reference Check as pending.
- Pending active-stage cards expose Fail current stage through the candidate action menu, opening Process Update prefilled to the current stage with result Fail. Offer-stage cards expose Update Offer through the same menu, opening Process Update for Offer.
- Failed Candidates use the same stage-column layout as the active pipeline for the current last-7-days window.
- Failed candidates remain workflow state. They should stay visible in Pipeline failed-candidate sections, but a failed candidate in an active stage is not a Data Quality issue.
- Passed Offer uses the same compact card arrangement in responsive multi-column layouts. Write roles see `Create offer` on passed-Offer cards only when no offer record exists for that candidate.

Command dispatcher:

- Workspace actions use a command dispatcher to route intent to the correct surface.
- Dispatcher targets include open detail, create record, update record, advance stage, add match, and start offer actions.
- The dispatcher should preserve current workspace context and open the corresponding embedded modal or drawer rather than sending users to a blank page.
- Offer-pass handoff is confirmed through the dispatcher. When a candidate passes Offer, the handoff into offer creation/update must preserve the candidate identity and requisition context until the user finishes or cancels the offer flow.
- Confirmation invariant: the pass confirmation and the resulting offer action must refer to the same candidate and resolved requisition context. Users should not confirm Offer pass for one candidate and land in another candidate or unrelated requisition Offer flow.
- Candidate Pipeline Journey connector segments color from the previous/current stage only. A future segment must not become colored because the next stage is pending or failed.

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
- `app_unmatch_group_requisition`
- `app_delete_recruitment_record`
- `app_upsert_sourcing_weekly_update`
- `app_upsert_candidate`
- `app_insert_recruitment_log`
- `app_insert_pipeline_passes`
- `app_upsert_offer`

## Security

- Anonymous users cannot read or write recruitment data.
- Authenticated users receive access by `profiles.role`.
- System admins can delete recruitment records through explicit destructive confirmation. User profiles are excluded from this delete policy.
- Delete/unmatch actions are guarded by RPC authorization and dependency checks; candidate-linked requisitions and matches are blocked instead of orphaning candidate history.
- Roles: `system_admin`, `admin_recruiter`, `site_recruiter`, `viewer`.
- `system_admin`: full recruitment-data access and user administration.
- `admin_recruiter`: full recruitment-data editor, setup/group/match editor, but not user administrator.
- `admin_recruiter` can select and assign any eligible recruiter as `person_in_charge` when creating or changing a requisition. `site_recruiter` submissions are forced to the signed-in recruiter's assigned site and nickname.
- `site_recruiter`: recruitment writer for assigned scope, including group and match creation.
- `viewer`: limited read access to the workspace and related records.
- System admins can create app accounts and update nickname/site/role mappings through `/api/admin/users`.
- Audit triggers write `change_logs` for every important table mutation.
- Recruitment-data RPCs should use recruitment-writer permission checks. User administration remains system-admin only.

## Visual System

The UI uses `docs/design.md` as the visual source of truth, adapted to the GFPT recruitment workspace as a restrained operational Swiss hierarchy:

- Deep Navy `#0B132B`: page titles, section titles, record names, Doc IDs, candidate names, and primary metric values.
- Slate/Cool neutrals: labels, metadata, helper copy, timestamps, inactive controls, borders, grids, and empty states.
- Assigned-site accent: active navigation, primary actions, selected filter/tab states, focus treatment, and allowed visualization fills use the signed-in user's `profile.site` color. `HQ` uses waterfall replacement teal `#0AA0C3`, `KT1` uses waterfall replacement blue `#146EFA`, `KT2` uses waterfall replacement purple `#411EDC`, and users with no/unknown site fall back to current blue `#0A3CDC`.
- Orange/amber and scarlet: warning/risk only. Pair color with text or icon cues.
- Electric blue, teal, and purple should not be used as general UI accents. Use only when a specific visualization requires extra series separation.

Shared UI behavior:

- Prompt font usage.
- Calm dense internal-operations direction with a playful modern Swiss tone: crisp grids, compact surfaces, strong typography, and low color noise.
- Shared tokens in `src/app/globals.css` define the ATS blue scale, neutral scale, 12-16px radius system, focus rings, shadows, `ats-card`, `ats-card-subtle`, `ats-input`, and the sticky table viewport.
- `Button`, `Panel`, `StatCard`, `EmptyState`, `StatusBanner`, `TableControls`, `Operations`, and route card surfaces should carry the visual system before adding route-specific classes.
- App shell uses a blue rail with white active-route surfaces; the selected icon/action color remains assigned-site accent through `--app-primary`.
- Home keeps Today’s Work as the dominant panel, with Recruitment Records as a single tabbed work surface. Tab selection, counts, and record card hover/focus states use the ATS shared primitives.
- Dashboard keeps Vacancy Waterfall as the dominant report surface; opened requisitions and Pipeline Funnel are secondary reveal panels around the unchanged report logic.
- Workspace selected-case context is a sticky command header; section tabs use compact selected surfaces and route to the existing embedded work surfaces.
- Prefer neutral-first cards, tables, panels, and menus. Use typography, weight, spacing, and borders before adding color.
- Summary cards and operational metrics use navy values by default; tone may affect a small border/accent or risk text only.
- Tags use bright semantic fills with white text; primary/success tags inherit a contrast-safe assigned-site accent mix.
- Vacancy Waterfall chart colors are frozen by `snapshotColor`; preserve the chart, legend, connectors, callouts, and print CSS unless the user explicitly changes the chart.
- Pipeline Funnel uses one dominant assigned-site data fill with subdued neutral grid/table structure.
- Magnifying-glass icon buttons for record View actions.
- Requisitions, Candidates, and Offers tables/cards expose only the magnifying-glass View detail action. Workspace, related-record navigation, and write actions do not appear in table/card rows.
- Detail drawers keep the 3-dot action menu for secondary actions. Write roles see `Change record` in that menu, which opens the existing change modal for the current requisition or candidate; viewers do not see it. Menu options remain neutral text rows, not blue highlighted options.
- Workspace uses the `LampDesk` icon in the sidebar.
- Record detail drawer headers may keep a compact action menu for secondary drawer navigation. The primary `Open workspace` action remains an icon-only `LampDesk` button with tooltip and `aria-label`; related links and process updates live in the drawer body.
- Compact pagination footer: `< Page X of Y >`.
- Data tables use shared sortable/filterable headers with sort cycling, filled filter inputs, and filtered rows applied before pagination.
- Requisitions, Candidates, and Offers desktop tables use the shared `table-scroll` viewport with horizontal and vertical overflow plus a sticky table header. Sourcing is card-based; Pipeline keeps its own stage headers. Mobile record cards remain non-sticky.
- Desktop sidebar can collapse to an icon-only `72px` rail with persisted `localStorage` preference; expanded width remains about `248px`.
- Accessible StageRail semantics.
- Keyboard-accessible pipeline stage update actions.
- URL query params for shareable site, person in charge, language, and Dashboard date/detail state.
- Use the local `internal-ops-ui` skill for future internal-tool UX/UI polish. Keep `gpt-taste` for marketing or Awwwards-style pages, not recruitment operations screens.

## Language System

- English and Thai UI text is controlled by `src/lib/i18n/dictionary.ts`; keep this as the single source for app labels, aria text, placeholders, empty states, table controls, modal labels, and shared domain labels.
- Language is `Language = "en" | "th"` and persists through `localStorage["recruitment_lang"]` plus the `lang` URL parameter in authenticated navigation.
- Login is outside `AppShell` but still reads and writes `recruitment_lang`; check `/login` after language, theme, Tailwind, Button, Field, or Tag changes.
- Translate UI/application text only. Do not translate stored HR data, names, emails, URLs, IDs, site codes (`HQ`, `KT1`, `KT2`), Doc IDs, Group IDs, or database free text.
- Use helper labels for roles, request types, requisition statuses, process stages, results, and repeated timeline phrases. Keep Thai short, recruiter-friendly, and compact for tables/cards.

Login/theme check:

- `/login` is outside authenticated `AppShell`, so it must define the fallback site accent itself and must not depend on `profile.site`.
- After changes to `tailwind.config.ts`, `src/app/globals.css`, `src/lib/site-theme.ts`, `Button`, `Field`, or `Tag`, restart the local Next dev server and verify `/login`; Tailwind/theme config changes can leave the dev server serving stale page HTML with missing or outdated CSS.
- If `/login` renders in browser-default styles, check `/_next/static/css/app/layout.css`. A `404` usually means `pnpm build` or another Next process rewrote `.next` while `pnpm dev` was still serving. Stop the dev server, clear the generated `.next` output, restart `pnpm dev`, then reload `/login`.

## Verification Commands

Use these before pushing product changes:

```powershell
pnpm typecheck
pnpm build
```

If browser behavior changed, also run or manually verify the impacted flow at `http://localhost:3000`.

## Documentation Rule

Update this file when routes, workflows, database tables, RPCs, roles, or visual structure change.
