# Recruitment Website Structure

Last updated: 2026-08-01

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
- `/dashboard`: Vacancy Waterfall report, opened requisition detail (PNG/XLSX), and Pipeline Funnel (PNG).
- `/requisitions`: requisition list, new/replacement request type, replacement names, headcount progress, create/change, status log, and detail drawer.
- `/sourcing`: weekly applicant/channel updates per active `group_id`, position groups, and requisition matches.
- `/candidates`: candidate list, create/change, latest process/result, candidate folder link, and candidate detail drawer.
- `/pipeline`: group-based candidate board from Phone Screen through Offer, with keyboard-accessible next-step updates and drag/drop shortcut.
- `/offers`: offer records for Offer-pass candidates, available Doc ID filtering by candidate group, and automatic requisition fill logic.
- `/admin`: system-admin user administration.
- `/setup`: compatibility redirect to `/sourcing`.
- `/audit`: newest-first audit trigger history with event summaries, scoped filters, record links, and expandable old/new field values.

Hiring Workspace behavior:

The [Workspace design contract](design/workspace.md) specifies the picker, header, tabs, and section presentation. The route, record, permission, and hiring rules remain in this section.

- The workspace is organized around a group-scoped hiring journey rather than static tabs.
- The same candidate, requisition, and offer records are reused across the journey, with each surface opening the correct transactional action for the current stage.
- Group-aware navigation keeps `group_id` context available when moving between Sourcing, Candidates, Pipeline, and Offer-related actions.
- Workspace actions should preserve the current `lang`, `site`, `pic`, and `sourcingWeek` query parameters where applicable.
- Workspace selection is group-only. `/workspace` opens the Groups picker; `/workspace?type=group&id=...` is the canonical hiring-case entry. The picker defaults to ongoing groups; All groups also includes authorized linked groups after filling or cancellation, while excluding unlinked groups. Rows show readiness status without a fraction, filled/total demand and active/total candidate ratios, a linked-requisition preview, latest sourcing save, and attention/name/age sorts. Attention ranks active work before terminal groups, then least-ready state, open demand, localized name, and Group ID. The preview and search include authorized filled and closed links; selecting a preview row opens its existing requisition detail window.
- Workspace URL context is breadcrumb state, not disposable filter state. Group `type`, `id`, and `section` identify the hiring case; `lang`, `site`, `pic`, and `sourcingWeek` remain preserved across links and actions. Legacy group `doc` is removed without narrowing the group. A legacy requisition Workspace link resolves to its sole eligible linked group, a filtered Groups picker if several are eligible, or the existing requisition detail window over the picker if none is eligible.
- Every Workspace tab shows aggregate authorized group information. Linked requisitions appear in the Hiring journey's Requisition step; each opens its existing detail window for record-specific actions.
- When no workspace is selected, `/workspace` renders the searchable workspace picker directly instead of a redundant empty workspace header.
- The Workspace Groups picker has a role-gated New menu for the existing Requisition and Group creation flows. Group creation still links one or more requisitions atomically and opens aggregate group Workspace Sourcing.
- `section=offer` is the canonical workspace URL for offer creation and follow-up. Legacy `section=outcome` links are replaced with `section=offer` without adding browser history.
- Ongoing Workspace targets require at least one linked requisition with open headcount. Authorized historical group URLs remain selectable and show their existing tabs in read-only context; filtered-out or unauthorized direct URLs show the invalid-target picker state.
- The selected group context shows a back arrow to the scoped Groups picker, breadcrumbs, title, meta, readiness/SLA, and four summary metrics. It has no Open Sourcing or More header actions. It remains sticky at desktop widths and collapses to title and ID after page scroll. Phones show the four metrics in two rows beneath the title.
- Workspace section navigation uses underline tabs for Overview, Sourcing, Pipeline, Offer, and Activity in the same bordered box as the selected panel, with keyboard arrow/Home/End navigation. URL `section` state remains unchanged. Overview highlights the next actionable group journey row alongside all scoped data-quality issues in severity order under the Data quality heading; selecting that row opens its existing tab. Its Requisition step opens linked record detail windows. The issues list scrolls within its equal-height desktop card and follows page scroll below desktop width; Workspace alone displays specific English/Thai issue copy without changing issue detection or destinations.
- Workspace Sourcing sums applicants and channel counts from complete saved updates through the selected week. From 1080px its three equal-height cards show an independently centered cumulative applicant number with bottom-aligned selected-week addition, then a compact eight-week trend spanning the completeness-bar width, with its label below the graph, an upper y-axis tick rounded up to the next ten from 110% of the highest displayed weekly count, with enough top padding to show its label, point tooltips, and a divided Weekly update completeness line with recorded/expected weeks and percent above its bar; a **Channel distribution** card with a larger solid-color donut and every nonzero channel in its right-side legend, with a subtitle directly under the title naming up to three leading channels and their combined saved-applicant count and share; and six hiring-stage horizontal bars of distinct group candidates split by recorded channel, including Unknown. Each card heading has bilingual metric help available by hover, focus, or tap. Stage rows have compact spacing, light separators, stronger totals, single-line names with full-name tooltips, segment tooltips, and an accessible channel breakdown without a separate visible legend. The cards stack in the same order on smaller screens. The candidate bars use canonical stage entries, including pending and failed entries but excluding superseded records, through the earlier of the selected week's Friday and Bangkok today. Candidate records and aggregate weekly applicant counts are distinct measures. The cumulative selected-week addition is plain bottom-aligned `(+N)` text. The donut, channel legend, stage bars, and editor dots share fixed cheerful channel colors. Weekly update completeness is updated-week records divided by all expected weeks through the selected week; a saved but incomplete update counts as a record. Select week and Sourcing update heading areas have matching desktop height. Flat, divided editor rows align each channel name, right-aligned numeric input, and parenthesized preceding-slot difference; comparison appears only when both counts are known. The draft total is an unboxed divided row and displays its preceding-week change while the summary remains saved data until Save succeeds. The status tag sits immediately left of the save icon at the editor's upper right. Incomplete channel data remains unknown. Workspace Activity shows an actor only from a stored sourcing updater or an unambiguous matching audit entry; otherwise it shows Unknown.
- Workspace Pipeline exposes New Candidate whenever the selected context has an eligible document-group link. One eligible Group ID is locked; multiple eligible links remain selectable only within that workspace context.

Sidebar order:

1. Home
2. Workspace
3. Records
4. Dashboard
5. Audit Log

Records is an expandable sidebar parent, not a route. It uses the pencil icon and contains Requisitions, Sourcing, Candidates, Pipeline, and Offers while preserving the existing page URLs. Administration remains visible only to `system_admin` near the control/audit area.

Desktop sidebar still supports the persisted icon-only collapsed rail. If Records is expanded while collapsed, the child page icons render vertically under the Records icon. On phones (360–430px), it is replaced by a fixed safe-area bottom bar: Home, Workspace, Pipeline, Candidates, and More. More is a focus-managed bottom sheet containing Requisitions, Sourcing, Offers, Dashboard, Audit Log, and Administration only for `system_admin`; links retain the current contextual query parameters. The desktop sidebar, URLs, and role visibility do not change.

### Phone-first recruiter operations

- Phones prioritize the next update: compact headers, one-column forms, full-width detail drawers, and a sticky Cancel/Review or Save footer. Desktop grids and sticky table headers start at `md`.
- Records use cards on phones; filters and secondary actions use bottom sheets. Wide report tables and the Pipeline board may scroll **inside their own surfaces only**, never at page level.
- Pipeline keeps its horizontal stage board and adds a stage-jump selector. Stage headers remain visible while a column is read; candidate actions remain behind one touch-safe action control.
- Sourcing weekly forms stay one column. The Selected-week Group Summary is mobile cards (identity, site/PIC, requisition/open-headcount/candidate/applicant metrics and save state) and remains the sortable table on desktop.
- Shared date selectors become viewport-safe phone sheets/popovers while preserving `DD/MM/YYYY` display, Bangkok defaults, and submitted ISO values.

## Home Page

Home is the operational landing page.

Current order:

1. Today's Work / Workspace Watchlist with two phone or four tablet/desktop summary metrics and navy metric values. Urgent Items still counts the derived work queue, but the panel has no critical-work list beneath the metrics and ends at its content height.
2. Recruitment Calendar for unresolved canonical Pending stage events with an optional `estimated_action_date`, plus offered-candidate start-working events from `offers.first_working_date`, inside the current authorized Site/PIC filter scope. Future starts remain neutral; due unconfirmed starts are red, confirmed starts are green, and confirmed no-shows are omitted. Calendar cards open Candidate Detail, where a due-start warning provides Confirm start. Desktop chips show a semantic icon and one ellipsized candidate-name line while retaining full accessible context. A separate sibling panel directly below the Calendar shows a bounded Today's Events list for Bangkok today, independent of the viewed month. Its date sits beside the title and the event count remains at the right. Left-aligned columns are Candidate, Event context, Status, Site / owner, and Remark; the candidate name opens Candidate Detail and its ID remains secondary. Pending stage events read Awaiting in this table only. Remark comes from the event's current pending log, or shows a dash when absent, including start-work events. An unconfirmed start due on today’s date reads Due today; a confirmed start reads Started work confirmed. The panel refreshes when visible and across Bangkok midnight without changing the viewed month. Phones retain the selected-day agenda without a duplicate list.
3. Recruitment Records rows in this fixed order:
   - Open Headcount
   - Candidate Pipeline
   - Sourcing Updates
   - Data Quality
   - New Hire Confirmation, shown only when the user's role has start-confirmation write permission

The selected Home tab contains all applicable records in a bounded vertically scrollable aligned row list on desktop and stacked, labeled rows following page scroll on phones, with horizontal hairline dividers and no row cards or vertical column borders. Phone action targets are at least 44px high. Every tablet/desktop list has left-aligned column headers suited to its records. Open Headcount shows a live requisition count at left and a compact Sort by selector at right; it retains the established oldest-first restartable SLA age order (age descending, then open demand descending) and offers Oldest first, Most open demand, and Position A–Z. Its columns are Open Requisition, Remaining Vac., Fill Readiness, Age/SLA, and Owner. The requisition title opens detail; ID is secondary. Age/SLA uses `48d/30d` style, with a smaller red `18d overdue` line only when the existing SLA rule marks it overdue. Candidate Pipeline shows a live count of its displayed active candidates and a compact Sort by selector: Oldest touch first by default, Newest touch first, Candidate A–Z, or Progression (furthest stage first); missing touch dates sort last for date orders, and ties use name then ID. Its columns are Candidate, Stage, Site / owner, Last Touch, Pending Remark, and Progress. Last Touch is the latest non-future canonical recorded stage `log_date` or `outcome_date`, falling back to First Contact Date, with Bangkok day age secondary; scheduled estimates never count as touches. Pending Remark is the newest unresolved canonical pending log remark or a dash, without historical fallback. Progress shows bare blue completed, yellow pending, and grey upcoming stage icons without a secondary stage summary; failed stages remain explicitly labeled. Tablet lists scroll horizontally within this tab; phones retain labeled rows without page overflow. Sourcing Updates uses Group, Linked requisitions, Open vacancies, Site / owner, Week status, and Last saved; Data Quality uses Record, Issue, Severity, Explanation, Context, and Action; New Hire Confirmation uses Candidate, Requisition, Site / owner, First working date, Confirmation state, and Action. Record names open their record or sourcing workspace; distinct quality actions and Confirm Start remain. Start confirmations remain role-gated. Home record tabs use an underline selected state, horizontal scrolling on narrow screens, and Arrow/Home/End keyboard support. Switching tabs resets the list scroll. Home does not use URL state for the selected tab.

Each six-column Home tab uses one bounded tablet/desktop table viewport for horizontal and vertical scrolling, with its aligned header visible during vertical scroll. The phone layout follows page scroll.
The Thai Recorded sourcing tag reads **บันทึกข้อมูลแล้ว** wherever that shared tag appears. New Hire Confirmation keeps its existing action and role gate in a compact labeled secondary button that opens the same confirmation flow.
Home Candidate Pipeline's compact progress icons have no connector segments; other journey rails keep theirs. Missing Home Sourcing Updates and embedded Workspace Sourcing records read **Update needed / ต้องอัปเดตข้อมูล**, distinct from Incomplete and Recorded; Records > Sourcing keeps its work-board wording. Home Data Quality keeps its existing English issue copy and translates titles, explanations, and available actions in Thai using the same issue codes as Workspace, with existing text as fallback.

The Recruitment Calendar opens on the current Bangkok month and keeps Previous, Next, and Today navigation in local Home state. Today’s Work and Calendar share a 1:3 desktop row, but Today's Work ends after its metrics; narrower screens stack them. Desktop uses 96px Sunday-first day cells with the date top-left and the `(N)` count top-right, aligned on one header row. Desktop event chips show an icon and ellipsized candidate/context text while preserving full accessible names and titles. Event eligibility and accessible detail-drawer behavior remain unchanged.

Home-only recruiter bottleneck:

- Home metrics retain urgent-work, aging-candidate and sourcing-gap counts; Recruitment Records exposes the actionable records.
- The tabbed Recruitment Records surface replaces the former standalone Home Data Quality, Candidate Pipeline, Sourcing Updates, Open Headcount, Recent Activity, and recruiter bottleneck panels.
- Workspace sections may show diagnostics and commands for the selected hiring case, but Home remains the only page that aggregates recruiter bottlenecks across all assigned work.
- Recommendation and next-action language is removed. Use factual risk labels and explicit commands such as Open, Edit, Save, or Create Offer.

The Welcome Back popup appears once per browser session/login. It summarizes actionable responsible records, links users toward Pipeline work, and uses a warm professional message selected by the user’s current-calendar-month filled responsible vacancy ratio in `Asia/Bangkok`.

Welcome Back message logic:

- Ratio is `floor(accepted offers from the first Bangkok day of the current month through today / responsible PIM-eligible requisition headcount × 100)`. PIM eligibility is PR date on/before month end, not cancelled, and no resolved close date before month start. Accepted offers require a valid, non-future `accepted_date`; a zero denominator yields `0%`; only the visual progress bar caps at `100%`.
- Message text comes from `recruitment_daily_messages_th_en.csv`, mirrored at runtime in `src/lib/daily-messages.ts` to avoid runtime CSV parsing.
- Select the current local weekday row with the highest `Filled%_min` less than or equal to the filled vacancy ratio.
- Use `Current_Thai_Version` in Thai and `English_Version` in English; replace `{name}` with nickname, full name, email, or system fallback.
- If no CSV row matches, fall back to the legacy dictionary ratio message.
- The popup shows the selected message, monthly ratio percentage, and monthly `{filled}/{total}` helper without backend connector changes. Candidate Pipeline cards, permissions, exports, and the CSV message bands remain unchanged.

## Dashboard Page

Dashboard begins with a Recruitment Performance overview, followed by the existing Vacancy Waterfall, active-requisition detail, and Pipeline Funnel reports. The overview has its own MTD, YTD, or Performance in Month period, Year, Month, Site, and Department filters. It inherits and can only narrow the global Site and person-in-charge scope. Its state uses `overviewPeriod`, `overviewYear`, `overviewMonth`, `overviewSite`, and `overviewDepartment` URL parameters; existing report controls and export state remain independent.

Overview Site and Department allow multiple selections, OR within each selection and AND between them. Empty selections mean All within global scope. Department choices follow selected sites; scope changes remove unavailable choices. The same URL parameter names retain legacy single values and encode multiple values as JSON arrays, preserving department names containing commas. Report context and PNG list the applied selections. KPI cards are compact and omit corner help buttons; definitions remain accessible and prior-period deltas name their period and exact comparison dates.

The overview uses eligible approved headcount as Total Vacancies, accepted positions in the selected range as Filled (capped at each requisition's headcount), and their difference as Open. It uses the existing report eligibility and no-show/SLA rules. Filled PCT is Filled divided by Total Vacancies; Filled in SLA PCT excludes unknown SLA outcomes and shows their count separately; average time to fill is PR approval to accepted offer in calendar days. A zero denominator displays an unavailable value. KPI deltas compare MTD and Performance in Month with the immediately preceding equal-length range, and YTD with the corresponding prior-year range; percentage deltas use percentage points.

Its charts use one filtered population: New/Replacement approved headcount by job level with cumulative vacancy share, Filled/Open by site and level, and on-time/late/unknown-SLA fills by site and level. Bands are NML L0–L3, FML L4–L6, MML L7–L9, SML L10–L12, Executive L13–L14, plus Unknown for invalid or missing levels. The matrix and SLA rows descend from Executive; the composition chart ascends from NML; Unknown is appended. Keep all standard chart categories and scoped site axes even with zero records, while leaving empty matrix value cells blank and retaining empty-state messages and KPI zero/unavailable values. Waterfall retains Opening, scoped site Open/Filled and Closing axes in empty ranges. Matrix and SLA count scales are shared across their site columns. The SLA axis rounds highest fills × 1.1 up to the next even count (minimum 2), and percentages always follow the end of the entire stacked bar. Recruitment Performance and Vacancy Waterfall start expanded and use the same collapsible title/date/action structure as Active Requisitions and Pipeline Health; collapse preserves filters, export surfaces and available export actions. Chart help is localized and available on hover, focus and tap. An overview PNG captures a complete desktop report with title, dates, applied filters, metrics and charts regardless of viewport size. Presentation is specified in the [Recruitment Performance visual contract](design/recruitment-performance.md).

The Waterfall has no Y-axis. Readable stacked segments show centered white absolute vacancy counts; short segments defer to grouped site-count braces beside both Week Start and Total. Preserve established colors, legend, connectors, print, and PNG capture.

Active Requisitions stage controls are ordered Activity, Status, Accum, with Status as default. Accum counts unique candidates who entered a stage from that requisition's PR-approved date through the selected end date, including pending/passed/failed canonical records and excluding superseded or pre-PR records; its drill-down shows the first qualifying stage record.

The waterfall uses a localized dropdown with MTD, YTD, PIM, and Custom range. Its header is title, resolved date range, then report controls; it has no weekly subtitle, Weekly preset, or Site Review preset.

- MTD: selected month start through end; PR date ≤ end, derived SLA deadline ≥ start, and no resolved close before start.
- YTD: 1 January through selected month end; PR date ≤ end, derived SLA deadline ≥ 1 January, and no resolved close before 1 January.
- PIM: selected month start through end; PR date ≤ end and no resolved close before start.
- Custom range: required inclusive Start/End dates, with PIM eligibility; invalid or reversed ranges show no report data and disable exports. Calendar views use `reportView` + `reportMonth`; custom uses `reportView=custom` + `start` + `end`.
- Cancelled requisitions are excluded. Close date is latest `filled` requisition log, falling back to latest accepted offer for legacy rows. Filled vacancy counts are accepted offers in range whose requisition is also eligible for the selected report; denominator is eligible original headcount; Open Requisitions are eligible rows with `ongoing` status. The waterfall and Active in Selected Period share this eligibility population.
- Dashboard calls the authenticated, read-only company report RPC. It exposes no candidate information and does not alter raw record or write permissions.

- Week Start: open headcount before the selected start date.
- Open: eligible requisitions approved inside the selected reporting view.
- Filled: accepted offers inside the selected date range.
- Total: remaining vacancy grouped by site and requisition type.

The report keeps running-total connector logic between bars and uses right-side curly brace callouts for final stack segments.

Dashboard export actions:

- `Export PNG` for the Vacancy Waterfall chart report, active requisitions, and Pipeline Funnel. A shared in-viewport capture surface waits for fonts/layout, captures the complete localized report at 2× resolution, validates non-blank pixels, then downloads its title, `DD/MM/YYYY` date range, metadata, and all report rows/segments.
- `Export XLSX` for requisitions active in the selected period.

Dashboard has no PDF export. PNG download uses deterministic names: `vacancy-waterfall-<start>-to-<end>.png`, `active-requisitions-<start>-to-<end>.png`, and `pipeline-funnel-<start>-to-<end>.png`; the existing preparation overlay applies to every PNG export.

The active-requisition XLSX begins at `B2` (row 1 and column A blank; A width 2). It is a native Excel `TableStyleMedium2` table with Sarabun font, worksheet gridlines hidden, all value columns width 20, centered/middle non-wrapping headers, and wrapped middle-aligned values; Department and Position values are left/middle aligned.

Active-requisition detail is collapsed by default. It includes each requisition with a valid PR date on or before the selected end date, no filled date before the selected start date, and a non-cancelled period-end state; every eligible row contributes original headcount. **Status at Period End** is Filled when accepted offers still cover the approved headcount at the selected end date; a recorded Cancelled status overrides that calculation. **Filled Date** is the most recent date that offer coverage reached the approved headcount, and is blank unless Status at Period End is Filled. A recorded Filled status is used only as a legacy fallback when no offer coverage exists. The Waterfall chart remains a separate movement report. Detail includes ownership, requisition date, applicant totals, historical pipeline stage counts, SLA status, the unified historical status, and fill date.

Recruitment Pipeline Health is a separate collapsible funnel report with its own date range, level filter, channel filter, and PNG export. Funnel rows are `Applicants`, derived `Resume Screening`, then active pipeline stages. `Resume Screening` is display/reporting-only and is counted from candidates who have reached Phone Screen. Real stage funnel counts are passed-only and de-duplicated per candidate per stage.

## Recruitment Workflows

Requisitions:

- `Position` appears after `Section`.
- `Level (L)` is a dropdown from `0` to `14`.
- Interactive UI surfaces that present a requisition as a named record use `Position (L#)` as the primary identity. The shared formatter accepts stored numeric levels `0`-`14` with or without one case-insensitive `L` prefix, so `4`, `L4`, and `l4` all display as `L4`; missing, blank, malformed, or out-of-range levels omit the suffix and preserve the stored position text.
- Mobile requisition cards shorten a position longer than 30 characters to `trimmed position... (L#)`; tables, details, exports, and payloads retain the full position.
- The Select a hiring workspace picker applies that same 30-character requisition title rule at every breakpoint; its group cards use display position as title and immutable Group ID as secondary metadata.
- Requisition ID is compact secondary metadata. Native selection options use `Position (L#) — Requisition ID` so duplicate titles remain distinguishable. Raw IDs remain unchanged in breadcrumbs, dedicated Doc ID fields and columns, candidate Doc IDs, audit/destructive/data-quality records, URLs, search values, and payloads.
- Candidate Pipeline cards remain candidate-first and unchanged because a group can inherit multiple requisitions. Exports, Vacancy Waterfall reporting, PDFs, XLSX, and CSV schemas continue to use their existing raw requisition fields.
- SLA age starts from `pr_approved_date` and uses calendar days, except after a confirmed `did_not_start`, when it restarts from the latest Bangkok confirmation date without overwriting the PR date.
- Dashboard Waterfall excludes a no-show from Filled and adds Open on its Bangkok confirmation date. Its active-requisition table/export shows immutable Actual Age (PR-to-today) beside resettable Current SLA (latest no-show-to-today and threshold).
- SLA thresholds are L0-L6: 30 days, L7-L9: 45 days, and L10-L14: 60 days.
- Operational overdue styling applies only to open requisitions with open headcount, valid PR approved date, valid level threshold, and age greater than SLA.
- Requisition list and Home Needs Action show age/SLA context; overdue open Doc IDs render red.
- Requisition Fill Readiness is tone-colored text in records and detail drawers, not a boxed tag.
- Replacement requisitions require exactly one replacement name for every Headcount vacancy. The modal automatically adds fields when Headcount rises and confirms before trailing names are removed when it falls.
- Replacement names are stored as newline-delimited text in `replacement_names`; the RPC enforces the same non-empty-name/Headcount count.
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

- Supported channels: Facebook, JobThai, JobTopGun, JobsDB, JobBKK, LinkedIn, Walk-in, Referral, Others.
- Workspace > Sourcing shows every expected group update week in a bounded date list beside one selected-week applicant editor from 1024px; smaller widths stack them. Selecting a date synchronizes the week picker and `sourcingWeek` context. An unsaved applicant draft requires confirmation before switching weeks. Existing save, validation, and role rules remain.
- A `group_id` is single-site: it may link only to requisitions from one site. Cross-site matches are rejected.
- Records > Sourcing shows unmatched Group IDs in a red warning section immediately above Weekly Work for System Admins and Admin Recruiters only; each item offers Details plus Link Group with that value prefilled. Site Recruiters and Viewers do not see this exception list.
- Records > Sourcing header order is `New Group`, Work Board/History toggle, then Week Starting. New Group uses `app_create_and_match_sourcing_group_v2` to create the group and one or more selected eligible requisition links in one transaction, then opens aggregate group Workspace Sourcing. System Admin and Admin Recruiter may select eligible open requisitions from one site; Site Recruiters may select only their assigned-site, matching-nickname/PIC requisitions; Viewer sees no setup action. The red unmatched exception panel retains its System Admin/Admin Recruiter-only Link Group action for historical cleanup.
- Site Recruiters can inspect every linked open group at their assigned site. Peer-owned cards remain read-only; only a PIC of an active, open linked requisition can save sourcing data or alter that group's matches.
- Weekly sourcing updates only show channels marked on the group or match snapshot.
- Group Details uses compact channel checkboxes, Save for display-name changes, and a confirmed icon-only Unmatch command.
- Weekly sourcing saves applicant counts only. It does not clear or change channel booleans; channel marking is changed through sourcing setup. Unsaved weeks prefill applicant inputs from the latest saved group update.
- The Sourcing Conversion Quality panel is collapsible in Records > Sourcing and collapsed by default there.
- AppShell's compact top-right Site and Person in Charge selectors are the only Site/PIC controls. Shared `site` and `pic` URL parameters filter Records > Sourcing and Workspace > Sourcing; legacy `sourcingSite` and `sourcingOwner` links are read only when shared values are absent, then replaced without browser history. The filters constrain weekly cards, bulk scope, and the read-only Sourcing Groups table; Workspace also intersects them with its selected hiring case. Site Recruiters cannot widen their authorized scope.
  - The Sourcing Groups table is a selected-week operational summary: Group ID (linked to Workspace), position, Site, PIC, requisitions, open headcount, candidate count, weekly applicants, and last saved time. It is not an editing or history surface.
  - Sourcing Groups has a table-local Advanced Filters panel for text search, position, weekly-save status, and applicant-total state. It narrows only the summary table after the existing header Site/PIC and responsibility scope are applied; Clear restores the scoped table.
- Add Match shows only requisitions that do not already have any `document_groups` match.
- Workspace’s Groups picker remains in the Groups toggle after creating an unlinked group; after a link succeeds, it opens that matched group’s workspace rather than the requisitions toggle.
- Doc ID options include position context, for example `DOC-001 - Accountant`.
- Unmatch removes one `document_groups` link. Candidates remain in the group pool; their requisition-match reference moves to another group match when available, otherwise clears.

Candidates:

- Candidates belong to `group_id`; optional `doc_group_id` preserves requisition-match context and may be reassigned or cleared by Unmatch.
- Candidate channel is a dropdown filtered by the selected group’s marked sourcing channels.
- New Candidate lists only Group IDs linked to ongoing requisitions with remaining headcount. Site Recruiters additionally require their assigned Site and PIC; Admin Recruiter and System Admin retain all eligible groups. `app_upsert_candidate` enforces the same new-record rule.
- New Candidate required fields are Name, Group ID, Channel, and First Contact Date. Phone and Email are optional in New mode; supplied phone must be a valid Thai 10-digit number and supplied email must be valid. Email remains optional in Change mode, while Phone is required. Candidate ID remains optional in New mode because it is generated.
- New Requisition shows a Doc ID example (`RMP-0000-00-00-0000`) and a localized Line Manager name example. Pipeline Pending and Outcome remarks show localized, stage-aware guidance only; placeholder text is never saved.
- PR Approved Date, First Contact Date, and Pipeline Outcome date use the shared day-date selector. It displays Gregorian `DD/MM/YYYY`, submits the unchanged `YYYY-MM-DD` value, and uses Asia/Bangkok for today defaults; chronology and validation rules are unchanged.
- Name remains the official required identity; Nickname is optional, stored as nullable text, and every candidate label uses `Full name (nickname)` when a nickname exists (otherwise the full name alone).
- New and Change Candidate use localized identity placeholders. Thai Name is `โปรดใส่ชื่อจริง นามสกุล (เช่น จริงใจ กล้าหาญ)` and Thai Phone is `โปรดหมายเลขโทรศัพท์ 10 หลัก (เช่น 0941231234)`; the Name example is guidance only.
- Phone No. is optional for New Candidate and is stored as `NULL` when omitted. Any supplied value, and every Change write, must be exactly ten digits matching `^0[0-9]{9}$`; valid values display as `000-000-0000`. Existing invalid legacy values remain readable unchanged but must be corrected before a Change save.
- Reference Name is visible and required only when Channel is `Referral`; changing to another channel omits `ref_name` from the submitted candidate payload.
- Candidate contact and Pipeline stage dates may precede PR Approved Date, so recruiters can record pre-approval outreach. They still follow the existing Pipeline chronology and Bangkok-business-date rules.
- Candidate folder URL is stored in `candidate_folder_url` and shown as an external link in candidate detail.
- Candidate detail shows a pipeline journey above the timeline and displays optional candidate email when present.
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

- The paired-status implementation record and compact cross-layer map live in `docs/CANDIDATE_PIPELINE_ADJUSTMENT_PLAN.md`; this section owns current product behavior.
- The six active stored stages, in order, are `Phone Screen`, `HR Interview`, `Line Interview`, `Test`, `Reference Check`, and `Offer`. `Resume Screening` is derived display/reporting state. `First Contact`, `Rejected`, and `Withdrawn` are not active board stages.
- One canonical `recruitment_logs` row owns one candidate/stage/round. `log_date` is system-derived and read-only: Phone Screen uses the required First Contact Date; every later Pending uses the preceding passed Outcome date. `interviewer`, `remark`, and nullable `estimated_action_date` remain Pending details. `result` plus `outcome_date`, `outcome_interviewer`, `outcome_remark`, and `outcome_recorded_at` are the optional Outcome.
- Superseded rows remain audit history but are excluded from current state, board lanes, primary Candidate Detail history, terminal guards, and funnel/report counts.
- Pipeline is group-based and resolves grouped doc IDs, sites, persons in charge, and group position.
- Candidate sourcing `Reference Name` remains the Referral-channel attribution field. Contactable employment references are a separate optional list: name, relationship, channel type/value, and Other label. Available references require one final Bangkok-dated conversation record with positive duration (minutes) and summary; unavailable or archived references require a reason and remain audit history.
- Every pipeline write requires a recruitment-writer role and candidate-management scope. System Admin and Admin Recruiter can manage all candidates. Site Recruiter writes require a linked requisition matching both the recruiter's assigned site and nickname/PIC. Viewer is read-only.
- Active stage panels use the current assigned-site accent as a tinted panel background; candidate cards remain neutral for scan speed.
- Active cards show candidate name, `{site}-{position} ({PIC})`, next-step icon, last updated date, and the optional estimated action date. Past unresolved estimates include an Overdue text label.
- Active cards are sorted by latest update ascending in each stage so the oldest update appears first.
- Stage headers show only the stage label and count. If any candidate in the stage has not been updated for more than 7 days, the stage label turns red.
- Aging candidate cards keep neutral card styling except the candidate action arrow turns red when that candidate has exceeded 7 days in the stage.
- Board filter and pipeline search live in a filter-icon popover at the right side of the board controls row, with the visible Group cards controls kept on the left. The popover supports Escape, outside-click dismissal, and active filter count.
- Do not show SLA/pass/fail/latest metric text under Pipeline stage names.
- Empty active Pipeline stage columns and empty Failed Candidates stage columns keep their body blank; only the all-empty Failed Candidates panel shows an empty message.
- A current Pending card menu orders `Pass stage`, `Fail stage`, repeatable-stage `Add another … round`, forward-jump targets beyond the immediate next stage, then `Edit pending details`. Line Interview and Test are repeatable: the action and same-column drag/drop Pass round N and atomically open round N+1; ordinary Pass exits to the immediate next stage. Pending date, estimate, interviewer, and remark are editable only on the current unresolved canonical record, guarded by `expected_updated_at`, and audited as `pipeline:pending-edit`. The optional estimate may be cleared and may be past, today, or future, but cannot precede the Pending opened date. System Admin and Admin Recruiter can use this edit for every manageable candidate; Site Recruiter remains limited to matching Site and PIC.
- Pass shows locked stage/round context, editable Pass Outcome, and the required derived Next Pending (except Offer); it submits the stored Current Pending values unchanged and permits an optional estimate for the next Pending stage. The Next Pending opened date is read-only, equals the selected Outcome date, and is derived server-side (legacy client date input is ignored). Fail shows stage context followed directly by the locked-result Fail Outcome; saved Current Pending values are carried invisibly and preserved. Outcome date defaults to Bangkok today, interviewer defaults from Pending, and Outcome remark starts blank. A non-Offer Pass requires the immediate next Pending in the same transaction; Fail creates none and is terminal. Offer Pass creates no next stage and returns candidate/group/eligible-requisition handoff context; only that RPC response opens the offer-creation prompt.
- Reference Check Pass requires every currently Available candidate reference to have a saved final check; zero references, unavailable references, and archived references do not block. Reference Check Fail stays available. The same database trigger prevents a forward jump from bypassing this requirement.
- Forward jumps from drag/drop and card actions open the same confirmation without writing immediately. Every crossed stage has Pending plus Pass details, the target has required Pending details, crossed stages must be consecutive and Pass-only, and the entire jump commits or rolls back atomically.
- Date order is `previous Outcome <= current Pending <= current Outcome <= next Pending <= Asia/Bangkok business date`; same-day transitions are valid.
- `estimated_action_date` is not part of Outcome chronology: it must be null or on/after its own Pending opened date, and completion preserves it as historical/audit metadata even when the actual Outcome happens earlier or later.
- A System Admin may correct Outcome and Pending dates for every canonical stage, even when downstream stages are completed; completed downstream history is never shifted. A corrected Pending date must remain between the preceding Outcome and its own Outcome, and its estimate cannot precede the corrected Pending date. For an unresolved immediate next Pending stage, an Outcome correction re-derives that Pending date.
- Candidate Detail presents the current Pending details and, for an authorized recruiter, an Edit Pending Details action that opens the same Pipeline edit workflow; viewers and out-of-scope recruiters do not receive this control.
- Line Interview and Test are multi-round. `Pass stage` exits Line Interview to Test round 1 and Test to Reference Check. `Add another … round` passes round N and opens round N+1; rounds and dates must be sequential.
- Candidate Detail keeps Resume Screening in the derived journey, then shows an expanded Current Stage panel and Completed Stage History with Pending and Outcome/Awaiting details. Edited and Migrated indicators include text, migration notes remain visible, and each canonical stage links to its filtered Audit Log. Board cards remain compact.
- Outcome result is immutable. System Admin may correct only completed Outcome date/interviewer/remark; correction supersedes the old canonical row, inserts a replacement, and leaves downstream state unchanged.
- Database row locks, optimistic timestamps, superseded-aware guards, role/PIC checks, and canonical delete protection enforce the same rules when the UI is bypassed.
- Failed Candidates use the same stage-column layout as the active pipeline for the current last-7-days window.
- Failed candidates remain workflow state. They should stay visible in Pipeline failed-candidate sections, but a failed candidate in an active stage is not a Data Quality issue.
- Failed candidates may review/edit Thai or English rejection-letter content from Pipeline or Candidate Detail. Delivery effects, approval flow and shared-mailbox behavior are owned by the [rejection-letter contract](REJECTION_LETTER_POWER_AUTOMATE_CONTRACT.md); the current contract sends approved content. System Admin manages active templates.
- Passed Offer uses the same compact card arrangement in responsive multi-column layouts. Write roles see `Create offer` on passed-Offer cards only when no offer record exists for that candidate.

Command dispatcher:

- Workspace actions use a command dispatcher to route intent to the correct surface.
- Dispatcher targets include open detail, create record, update record, advance stage, add match, and start offer actions.
- The dispatcher should preserve current workspace context and open the corresponding embedded modal or drawer rather than sending users to a blank page.
- Offer-pass handoff is confirmed through the dispatcher. When a candidate passes Offer, the handoff into offer creation/update must preserve the candidate identity and requisition context until the user finishes or cancels the offer flow.
- Confirmation invariant: the pass confirmation and the resulting offer action must refer to the same candidate and resolved requisition context. Users should not confirm Offer pass for one candidate and land in another candidate or unrelated requisition Offer flow.
- Candidate Pipeline Journey connector segments color completed passed-to-passed history, and pending/failed current stages color only the incoming connector from the previous stage. The outgoing future segment remains neutral.

Offers:

- New Offer only shows candidates who passed Offer and have no offer record.
- After selecting a candidate, Doc ID options are limited to available requisitions in the candidate’s group.
- Available means not filled, not cancelled, open headcount greater than `0`, and no existing offer for that candidate/doc pair.
- Offer Type and Replaced fields were removed.
- Change Offer locks candidate and Doc ID and allows editing accepted date, first working date, and remark.
- New Hire Confirmation is due on the first working date for accepted offers. Recruiters confirm `started` or `did_not_start`; the latter requires a reason, preserves offer history, removes its operational headcount coverage, and may reopen the requisition. Only System Admin and Admin Recruiter may correct a saved confirmation. Database triggers refresh the affected requisition status after every offer insert, delete, accepted-date/start-confirmation change, or Doc ID reassignment; a reassignment refreshes both the old and new requisitions.
- Candidate Detail stacks Offer record above Come to work; only Come to work owns Confirm start or admin-only Correct start. Sourcing is a two-surface workflow: the default Weekly Work Board lists open groups needing the selected weekly applicant record; embedded Workspace Sourcing shows the selected group's Saturday–Friday slots and one inline editor, with Details opening the group drawer. Group cards use the display position as title and immutable `group_id` as the subtitle. Lifecycle History shows saved and expected-unrecorded group/week slots with the shared Requisitions per-column search, sorting, and filter controls. A group detail drawer owns display-name and channel configuration, never the ID. Responsible recruiters may change an open managed group; channel changes preserve `NULL`/unrecorded values rather than silently using zero.
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
- `recruitment_logs.stage_instance_id`, Outcome detail fields, Pending edit metadata, record origin/migration note, and supersession metadata.
- sourcing channel flags and applicant counts for LinkedIn, Walk-in, Referral, and Others.

Candidates store direct `group_id`; `doc_group_id` is optional requisition-match context. Group-level behavior remains available after a requisition is unmatched.

New group-scope migration:

- The current schema changes standardize Hiring Workspace behavior around group scope.
- Group-scoped lookups now drive the workspace journey, document URL context, candidate matching, and offer availability rules.
- Any future migration in this area should keep `document_groups`, `position_groups`, `candidates.group_id`, and optional `doc_group_id` aligned.

Protected RPC functions handle all recruitment writes:

- `app_upsert_requisition`
- `app_insert_requisition_log`
- `app_upsert_position_group`
- `app_create_group_match`
- `app_create_and_match_sourcing_group_v2`
- `app_unmatch_group_requisition`
- `app_delete_recruitment_record`
- `app_upsert_sourcing_weekly_update`
- `app_upsert_candidate`
- `app_start_pipeline_stage_v2`
- `app_update_pipeline_pending_v2`
- `app_complete_pipeline_stage_v2`
- `app_pass_pipeline_jump_v2`
- `app_correct_pipeline_outcome_v2`
- `app_upsert_offer`

## Security

- Anonymous users cannot read or write recruitment data.
- Authenticated users receive access by `profiles.role`.
- System admins can delete recruitment records through explicit destructive confirmation. User profiles are excluded from this delete policy.
- Delete/unmatch actions are RPC-authorized; unmatching preserves the group candidate pool and does not orphan candidate history.
- Roles: `system_admin`, `admin_recruiter`, `site_recruiter`, `viewer`.
- `system_admin`: full recruitment-data access and user administration.
- `admin_recruiter`: full recruitment-data editor, setup/group/match editor, but not user administrator.
- `admin_recruiter` can select and assign any eligible recruiter as `person_in_charge` when creating or changing a requisition. `site_recruiter` submissions are forced to the signed-in recruiter's assigned site and nickname.
- `site_recruiter`: recruitment writer for assigned scope, including group and match creation.
- `viewer`: limited read access to the workspace and related records.
- System admins can create app accounts and update nickname/site/role mappings through `/api/admin/users`.
- Audit triggers write `change_logs` for every important table mutation. Audit Log presents date/time, entity, record ID, action, actor, and a field-change disclosure in one bounded desktop table; its existing filters and mobile sheet remain.
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
- Generic tags use bright semantic fills with white text; primary/success tags inherit a contrast-safe assigned-site accent mix. Candidate Detail soft tags and Home calendar event colors retain their component-specific treatments in [Candidate Detail design](design/candidate-detail.md) and [Home design](design/home.md), including green success/confirmed-start states.
- Vacancy Waterfall restores HQ (`#0AA0C3` replacement / `#90F5EC` new), KT1 (`#146EFA` / `#80BDFF`), and KT2 (`#411EDC` / `#C7BCF5`) colors in chart and legend; other sites use deterministic fallback colors. Preserve connectors, callouts, and print CSS.
- Pipeline Funnel uses one dominant assigned-site data fill with subdued neutral grid/table structure.
- Magnifying-glass icon buttons for record View actions.
- Requisitions, Candidates, and Offers tables/cards expose only the magnifying-glass View detail action. Workspace, related-record navigation, and write actions do not appear in table/card rows.
- Detail drawers keep neutral 3-dot secondary actions; write roles see `Change record`, viewers do not. Candidate Detail orders flat LampDesk, Pencil, and More actions; its four-node trend Journey Update opens the same eligible process commands in place. The outer Journey card owns spacing; StageRail owns state/a11y. Collapsible References and Activity use their policy callout/current card/timeline surfaces; Profile copies populated raw values. Requisition Detail uses the same identity header, soft status/readiness tags, flat utilities, and responsive profile grid. It retains its existing metrics, issues, fields, funnel, related records, actions, permissions, and disclosure behavior; only the presentation changes.
- Compact pagination footer: `< Page X of Y >`.
- Data tables use shared sortable/filterable headers with sort cycling, filled filter inputs, and filtered rows applied before pagination.
- Requisitions, Candidates, and Offers desktop tables use the shared `table-scroll` viewport with horizontal and vertical overflow plus a sticky table header. Sourcing is card-based; Pipeline keeps its own stage headers. Mobile record cards remain non-sticky.
- Desktop sidebar can collapse to an icon-only `72px` rail with persisted `localStorage` preference; expanded width remains about `248px`.
- Accessible StageRail semantics.
- Keyboard-accessible pipeline stage update actions.
- Pipeline defaults to Board and its Table is a sortable record register with one row per canonical candidate stage/round. It persists view/search/filter/sort/page state in the URL and can reveal superseded correction history separately. System Admins and Admin Recruiters use an audited modal to correct pending/outcome detail and dates; stage/round stay fixed, chronology violations are rejected, and Site Recruiters/Viewers remain read-only.
- URL query params for shareable site, person in charge, language, and Dashboard date/detail state.
- Use the local `internal-ops-ui` skill for recruitment UI design and polish. Retired marketing design skills are not part of this workflow.

## Language System

- English and Thai UI text is controlled by `src/lib/i18n/dictionary.ts`; keep this as the single source for app labels, aria text, placeholders, empty states, table controls, modal labels, and shared domain labels. Every visible date entry/filter uses the shared calendar and displays Gregorian `DD/MM/YYYY`; its stored, URL, sort, and RPC value remains ISO `YYYY-MM-DD`.
- Language is `Language = "en" | "th"` and persists through `localStorage["recruitment_lang"]` plus the `lang` URL parameter in authenticated navigation.
- Login is outside `AppShell` but still reads and writes `recruitment_lang`; check `/login` after language, theme, Tailwind, Button, Field, or Tag changes.
- Translate UI/application text only. Do not translate stored HR data, names, emails, URLs, IDs, site codes (`HQ`, `KT1`, `KT2`), Doc IDs, Group IDs, or database free text.
- Thai mode covers every app-controlled UI string, including responsive controls and dynamically opened modals. Keep approved external brands and HR acronyms unchanged (for example `Pipeline`, `SLA`, `Group ID`, JobThai, JobsDB, JobBKK, LinkedIn, `HQ`, `KT1`, `KT2`). Dictionary parity is required: every English key must have a Thai value.
- Use helper labels for roles, request types, requisition statuses, process stages, results, and repeated timeline phrases. Keep Thai short, recruiter-friendly, and compact for tables/cards.
- `CommandSelector` is the shared selector system for AppShell filters, Vacancy Waterfall Metric view, Report Month, and create-form choices. Its triggers share icon, selected label, chevron, rounded border, hover/disabled/focus states, and selected-row checkmark. Compact density is header-only; Dashboard and create forms use regular density. Option-list selectors use listbox semantics; Report Month has the same shell and lifecycle with a year-navigable month grid. Enter, Space, or Arrow keys open; arrows move the active choice; Home/End jump; Enter/Space select; Escape closes and restores trigger focus; outside click dismisses. Create selectors preserve current form/RPC contracts through a hidden named input; a contextual Workspace Group ID can be locked read-only.

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
