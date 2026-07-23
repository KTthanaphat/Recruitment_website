# AI Handover Overview

Last updated: 2026-07-14

## Purpose

Use this document to onboard a new AI chat quickly. It summarizes what the user is building, the current product state, the key business rules, and the working settings that make future changes efficient.

The user is building an internal recruitment tracking web application for requisitions, sourcing, candidates, pipeline movement, offers, reporting, and audit history.

The current product model is a five-section Hiring Workspace, not a four-tab read-only shell. The workspace spans Home, Requisitions, Sourcing, Candidates, and Pipeline, and it embeds transactional surfaces for creating and updating records in place.

## Repository And Runtime

Workspace root:

```text
C:\Users\thanaphat-krea\OneDrive - GFPT Public Company Limited\HR_database
```

App root:

```text
C:\Users\thanaphat-krea\OneDrive - GFPT Public Company Limited\HR_database\recruitment_website
```

Primary branch:

```text
develop
```

Local app URL:

```text
http://localhost:3000
```

Stack:

- Next.js 14 App Router.
- React and TypeScript.
- Tailwind CSS.
- Supabase Auth and Postgres.
- Supabase RPC functions for writes.
- Browser print-to-PDF and `xlsx` for spreadsheet export.

Canonical docs:

- `docs/WEBSITE_STRUCTURE.md`
- `docs/DEPLOYMENT.md`
- `docs/AI_HANDOVER.md`

Legacy reference files may still exist (`app.py`, `schema.sql`, `web/`), but the active app is the Next.js/Supabase app.

## Product Mental Model

The core workflow is:

```text
Open requisition
  -> Create sourcing group
  -> Match requisition to group
  -> Source candidates
  -> Candidate pipeline
  -> Offer
  -> Filled vacancy
```

The most important domain relationship is:

```text
requisitions.doc_id
  -> document_groups.doc_id
  -> document_groups.group_id
  -> position_groups.group_id
```

Candidates store `doc_group_id`, not direct `doc_id` or direct `group_id`. When a feature needs site, position, person in charge, or available requisitions, resolve through `document_groups` to the shared `group_id`.

The active journey is group-scoped end to end. Candidate detail, offer filtering, and requisition matching should inherit the relevant `document_groups` context rather than assuming a standalone record view.

Workspace behavior:

- The Hiring Workspace is adaptive: users move through the same group-scoped journey from requisition intake to sourcing, candidate management, pipeline movement, and offers.
- Group document URL context matters across the journey. It is the shared context used to keep requisitions, candidate detail, and offer actions aligned.
- Embedded transactional surfaces should open the right drawer, modal, or update flow from the current record instead of forcing separate pages.
- A command dispatcher coordinates these actions so the current workspace state, group context, and next-step intent stay aligned.
- Group-first workspace navigation is the current mental model. Prefer opening a hiring case from `/workspace?type=group&id=...` when a group exists; requisition workspace links remain valid focused entry points for the same shared journey.
- Treat workspace URL state as breadcrumbs: `type`, `id`, optional `doc`, and `section` identify the current hiring case, while `lang`, `site`, `pic`, and `sourcingWeek` must keep flowing through contextual links.
- `section=offer` is the canonical URL state for the Offer surface. Treat `section=outcome` only as a legacy alias and replace it with `section=offer` without adding browser history.
- Group workspaces show aggregate Sourcing, Pipeline, Offer, and Activity data when no `doc` is selected. Selecting `doc` narrows those sections to one requisition and must not reset the active `section`.
- `/workspace` with no target shows the workspace picker directly; do not restore a redundant empty sticky workspace header.
- Workspace picker and target resolution are active-open only: ongoing requisitions with `open_headcount > 0`, and groups containing at least one such requisition. Filled, cancelled, or zero-open direct URLs should fall into the invalid-target picker state.
- When a workspace target is selected, the sticky context header shows breadcrumbs, selected case title/meta, readiness/SLA, actions, and summary metrics. After page scroll, summary metrics collapse into compact chips. Section tabs use connected browser-style tabs attached to the selected content panel.

## Current Routes

- `/`: redirects to `/home`.
- `/login`: Supabase email/password login.
- `/home`: operational landing page.
- `/dashboard`: Vacancy Waterfall reporting.
- `/requisitions`: requisition data.
- `/sourcing`: position groups, matches, weekly sourcing updates.
- `/candidates`: candidate data.
- `/pipeline`: candidate pipeline board.
- `/offers`: offer records.
- `/admin`: user administration.
- `/audit`: audit logs.

Sidebar order:

1. Home
2. Workspace
3. Records
4. Dashboard
5. Audit Log

Records is an expandable parent using a pencil icon. In collapsed desktop mode, expanded Records children render as vertical icons under the parent instead of a flyout.

## User Preferences And Design Direction

The user prefers direct implementation after a plan is accepted.

Design preferences:

- Keep the app as a professional internal tool, not a marketing page.
- Use the existing navy identity with the signed-in user's assigned-site accent.
- Keep UI dense enough for operational work.
- Target a calm dense operations UI with a playful modern Swiss tone: crisp grid, restrained surfaces, compact action cards, clear owner/status/date hierarchy, and low visual noise.
- Use Prompt font where the app has been tuned for it.
- Prefer neutral-first summary cards, tables, and panels. Use navy for primary record names and metric values.
- Active navigation, primary actions, selected filters/tabs, focus, and allowed visualization fills inherit the assigned-site accent from `profile.site`: `HQ` `#0AA0C3`, `KT1` `#146EFA`, `KT2` `#411EDC`, fallback `#0A3CDC`.
- Authenticated route headers show only the route title plus compact controls. Site and Person in Charge filters sit in the top-right header command row before language, refresh, and account; use the same blue command-control treatment as language/refresh, keep accessible labels, and do not show stacked visible labels or a Clear filter button. Do not restore the separate sticky filter card or page subtitles.
- Reserve orange/amber and scarlet for warning/risk. Do not use legacy success hues, teal, purple, or electric blue as general decoration.
- Tags use bright semantic fills with white text; primary/success tags inherit a contrast-safe assigned-site accent mix.
- For UI polish, use typography, weight, spacing, borders, and surface contrast before adding color.
- Preserve Vacancy Waterfall chart colors and design exactly, including `snapshotColor`, legend swatches, connectors, callouts, and print behavior.
- Candidate pipeline movement is the signature visual language.
- Avoid clutter in Pipeline cards.
- Use icon buttons where appropriate, especially magnifying glass for record View actions and next-step arrow for pipeline updates.
- Data tables use shared sort/filter headers; rows are filtered and sorted before pagination. Requisitions, Candidates, and Offers desktop tables share a vertical/horizontal table viewport with a sticky `thead`; Sourcing is card-based and Pipeline keeps stage headers.
- Desktop sidebar has a persisted icon-only collapsed state in `localStorage`.
- Login is outside authenticated `AppShell`; it must use fallback site-theme variables and should be checked after any Tailwind config, global CSS, theme helper, Button, Field, or Tag change. Restart the local dev server before judging `/login` if CSS appears broken. If the page shows browser-default styles, verify `/_next/static/css/app/layout.css`; a `404` means `.next` was likely rewritten by `pnpm build` or another Next process while dev was running, so stop dev, clear generated `.next`, restart dev, and reload `/login`.
- Thai and English language support must be preserved when changing user-facing labels.
- `src/lib/i18n/dictionary.ts` is the source of truth for UI copy. Route/shared components should call `translate(language, key, params)` or domain helpers such as `roleLabel`, `processStageLabel`, `resultLabel`, `requisitionStatusLabel`, and `requestTypeLabel`; do not add new hardcoded English text in JSX, placeholders, aria labels, empty states, modal titles, table headers, or detail drawers.
- Thai text should be short HR business Thai. Do not translate stored HR data, free-text remarks, names, emails, IDs, URLs, or site codes (`HQ`, `KT1`, `KT2`).
- Use `.agents/skills/internal-ops-ui/SKILL.md` for future internal-tool UX/UI design and review work. Leave `gpt-taste` for marketing-style pages.
- Viewer access is limited, but the workspace itself is not read-only.
- Admin Recruiters can assign any eligible recruiter as Person in Charge on a requisition. Site Recruiters are locked to their own site and nickname by both the form and the requisition RPC.
- For future UI changes, prefer typography, spacing, border weight, and neutral contrast before adding color.

Frontend quality preferences:

- Responsive layouts must avoid overflow.
- Cards should stay inside their stage/panel containers.
- Tables should paginate and remain readable at scale.
- Export data shape should not change unless explicitly requested.
- Print/PDF views should be scoped and print-friendly.

## Home Page Rules

Home is first after opening/signing in.

Current section order:

1. Today's Work / Workspace Watchlist with one compact metric strip: open requisitions, urgent items, aging candidates, and sourcing gaps.
2. Recruitment Records tabs: Open Headcount, Candidate Pipeline, Sourcing Updates, Data Quality, then Recent Activity for `system_admin` and `admin_recruiter` only.

The selected tab has all records in a bounded vertical card list: one column below `md`, two columns at `md` and wider. Home and Workspace tabs use connected browser-style tabs attached to the selected content panel. The tab row is horizontally scrollable on narrow screens and supports Arrow, Home, and End keyboard navigation where implemented. Selected Home tabs are local UI state, not URL state.

Welcome Back popup:

- Shows once per session/login.
- Uses responsible actionable counts.
- Ratio is accepted offers in the last 7 calendar days for responsible requisitions divided by total responsible non-cancelled vacancy headcount.
- Message text comes from `recruitment_daily_messages_th_en.csv`, mirrored in `src/lib/daily-messages.ts`.
- Select the current local weekday row with the highest `Filled%_min` less than or equal to the ratio.
- Use the Thai or English CSV message by current language and replace `{name}` with nickname/full name/email fallback.
- If no CSV row matches, fall back to the legacy dictionary ratio message. No backend connector changes are required.
- Primary action goes to Pipeline.

Weekly Sourcing Updates on Home:

- Show open requisition groups not updated for more than 6 days.
- Include groups that have never been updated.
- Open group means matched to at least one ongoing requisition with open headcount.

This home surface is part of the Hiring Workspace and can route into transactional work through the command dispatcher.

Home-only recruiter bottleneck:

- Home owns the recruiter-wide bottleneck view and compact work queue.
- Today's Work remains the compact cross-case queue. The tabbed Recruitment Records surface replaces the former standalone Home lists and recruiter bottleneck panel.
- Keep cross-case prioritization on Home; do not recreate a global recommendation panel inside the selected workspace sections.
- Recommendation and next-action terminology is removed. Use factual issue labels and explicit commands.

## Dashboard Rules

Dashboard is dedicated to Vacancy Waterfall.

Waterfall logic:

- Week Start: open headcount before selected start date.
- Open: requisitions approved inside selected range.
- Filled: accepted offers inside selected range.
- Total: remaining vacancy grouped by site and requisition type.

Keep connector/running-total logic stable unless user explicitly changes it.

Current report behavior:

- Curly brace callouts on final Total stack.
- Chart PDF export.
- Opened requisition detail PDF export.
- Opened requisition detail XLSX export.
- PDF exports use A4 landscape print CSS and loading overlay.
- Opened requisition detail must remain horizontally scrollable inside its panel on screen; it must not widen the whole page.
- Opened requisition detail PDF uses print-specific sizing and print-safe SLA dots.
- Recruitment Pipeline Health is a separate collapsible funnel with its own date range, level filter, channel filter, and PDF export.
- Funnel rows are `Applicants`, derived `Resume Screening`, then active pipeline stages.
- `Resume Screening` is display/reporting-only and is counted from candidates who reached Phone Screen; real stage funnel counts are passed-only and de-duplicated per candidate per stage.

Opened requisition detail:

- Rows are requisitions opened in selected date range.
- Requisition Date means `requisitions.pr_approved_date`.
- SLA shows blue/red dot with age in days; unknown SLA displays neutral `-`.
- Open rows calculate age to today; filled rows calculate age to the filled date.
- Applicant counts use related `group_id`.
- Stage counts mean candidates who are in or have ever been in the stage.
- Stage counts use related `group_id`, not only the selected `doc_id`.
- Applicant totals include Facebook, JobThai, JobTopGun, JobDB, LinkedIn, Walk-in, Referral, Others.

## Requisition Rules

Requisition form:

- Position appears after Section.
- Level label is `Level (L)`.
- Level is a dropdown from `0` to `14`.
- SLA age starts from PR approved date using calendar days.
- SLA thresholds are L0-L3: 30 days, L4-L9: 45 days, and L10-L14: 60 days.
- Unknown/missing PR approved date or unknown/out-of-range level displays SLA as neutral `-`.
- Open overdue status applies only when status is not filled/cancel, open headcount is greater than `0`, and age is greater than SLA.
- Requisition cards/tables show age/SLA context; overdue open Doc IDs render red.
- Home Needs Action sorts by requisition age descending, with rows missing PR approved date after valid ages.
- Replacement requisitions require replacement names.
- Replacement names support more than one name.
- Replacement names are stored newline-delimited in `requisitions.replacement_names`.
- New Position requisitions submit `replacement_names` as null.
- Department and Section are cascading dropdowns sourced from `dep_sec_data.csv` through `/api/department-sections`; Department is scoped by selected Site, Section stays disabled until Department is selected, and legacy saved values remain selectable.

Guided flow starts only after creating a new requisition, not after editing.

Guided flow:

```text
New requisition saved
  -> guidance popup
  -> Create New Group modal
  -> Add Match modal
  -> Ask candidate availability
  -> New Candidate modal
```

Each step should prefill values from the previous step.

The requisition flow is now treated as a group-scope journey. New group creation, group matching, and downstream candidate setup all share the same document-group context.

## Sourcing Rules

Channels:

- Facebook
- JobThai
- JobTopGun
- JobDB
- LinkedIn
- Walk-in
- Referral
- Others

Weekly sourcing update:

- Only render update cards for marked channels.
- Records > Sourcing shows unmatched `position_groups` separately with a warning and Match requisition action; unmatched groups do not render weekly applicant inputs.
- Weekly update saves applicant counts only; it must not clear or change channel booleans.
- Channel marking is controlled by sourcing setup/group matching. The RPC preserves omitted channel booleans and initializes new weekly rows from `position_groups`.
- Unsaved selected weeks prefill applicant inputs from the latest saved group update.
- Applicant totals include all channels.

Add Match:

- Only show requisitions with no existing `document_groups` match at all.
- Show doc option labels with position context, for example `DOC-001 - Accountant`.
- Unmatch uses `app_unmatch_group_requisition` and is blocked when candidates reference the `doc_group_id`.

## Candidate Rules

Candidate link model:

- Candidate stores `doc_group_id`.
- Resolve group context from `document_groups.doc_group_id -> group_id`.

Candidate form:

- Channel is a dropdown.
- Options are based on the selected group/match marked channels.
- If no channels are marked, show a disabled no-channel option.
- Required fields are Name, Phone, Group ID, Channel, and First Contact Date. Candidate ID stays optional in New mode.
- Reference Name is visible and required only when Channel is `Referral`; non-referral submissions clear/omit `ref_name`.
- First Contact Date must be on or after the oldest non-null PR Approved Date among requisitions linked through the selected group. Skip only this PR-date comparison when no linked requisition has a PR Approved Date.

Candidate detail:

- Shows candidate folder URL if present.
- Shows Candidate Pipeline Journey above the timeline.
- Candidate Pipeline Journey includes a derived first `Resume Screening` dot shown as passed for recorded candidates. It is not a stored `recruitment_logs.recruitment_process` value.
- Timeline has an Update button only when the candidate is updateable.
- Secondary detail navigation lives under the kebab action menu.
- Process update modal must open above the candidate detail drawer.

Group doc URL context:

- Use the group-level document URL as the shared anchor for related candidate and requisition records.
- Group context should continue to resolve through `document_groups` so detail panes, available actions, and downstream offer work all point at the same group.
- The UI should surface group-aware links and actions without flattening them into disconnected record pages.

Pipeline journey color rules:

- Light blue/gray: stage not reached.
- Amber: current pending stage.
- Blue: passed stage.
- Red: failed stage.

Process update validation:

- Do not allow updating to a stage before the current stage.
- Do not allow update if candidate failed at any historical stage.
- Do not allow update if candidate completed all active stages.

## Pipeline Rules

Pipeline is group-based.

The real active Pipeline board starts at Phone Screen. Do not add a Resume Screening board column unless the database/RPC model is intentionally changed.

Cards use grouped values from all requisitions matched to the candidate's `group_id`.

Active stage cards show only:

- candidate name,
- `{site}-{position} ({PIC})`,
- next-step icon button,
- `Updated {date}`.

Active stage cards should not show extra tags, candidate ID/group ID metadata, or compact StageRail unless user requests it again.

Stage panels use the active assigned-site accent as a tinted panel background. Candidate cards stay neutral so the board remains scannable.

Sorting:

- Sort active cards in each stage by last update ascending, oldest update first.
- Use `latest_log_date ?? updated_at`.

Aging:

- Aging threshold is older than 7 days.
- If any candidate in a stage is aging, show a red warning icon before the stage name.
- If any candidate in a stage is aging, turn the stage name red.
- Candidate card updated dates stay neutral; candidate card arrows turn red only for the aging candidate itself.
- Board filter and pipeline search belong in the right-aligned filter-icon popover on the board controls row. Keep Group cards visible on the left.
- Do not show a separate aging count row under the stage.
- Empty active stage columns stay blank; do not render per-stage empty-state text.
- Stage headers show only stage label and count. Do not show SLA/pass/fail/latest metric text under stage names.

Record details:

- Detail drawer headers show one 3-dot action menu plus the compact Close button.
- `Open workspace` is the primary icon-only `LampDesk` action with tooltip and `aria-label`; secondary links and write changes live in the 3-dot menu.
- Related record links and candidate process update controls belong in the drawer body.
- Requisition, Candidate, and Offer tables/cards expose only the magnifying-glass View detail action; titles are text, not detail buttons. Secondary navigation and write actions belong in the detail drawer 3-dot menu, where write roles see `Change record` and viewers do not.

Command dispatcher behavior:

- Pipeline next-step actions should dispatch to the relevant modal or update flow for the current stage.
- `Fail current stage` opens Process Update prefilled to the candidate's current pending active stage with result Fail, and saves through `app_insert_recruitment_log`.
- Full forward jumps are allowed from the Pipeline board, but the confirmation modal and `app_insert_pipeline_passes` must keep a complete audit sequence: current/crossed stages are saved as Pending then Pass in order, then the target stage is created as Pending.
- Manual Process Update is stricter than Pipeline movement: it cannot create a future pending stage while the current stage is still pending without a result.
- The dispatcher should preserve the current group scope and avoid resetting the surrounding workspace when advancing records.
- Offer-pass handoff is confirmed through this dispatcher path. After a candidate passes Offer, the downstream offer flow must stay bound to the same candidate and resolved requisition context.
- Confirmation invariant: the pass confirmation surface and the offer upsert surface must agree on candidate identity and requisition context. No silent re-targeting is acceptable.

Test stage:

- Test supports multiple rounds.
- From a Test card, `Maintain in Test` saves the current Test round as Pass and creates the next Test round as Pending.
- Dragging a Test card onto the Test column also opens the Maintain in Test flow.
- Moving a Test card to Reference Check uses the latest Test round as the pass round.
- The Test exit confirmation can add extra pending Test rounds first, but the pass round stays locked to the original latest Test round.
- Test maintenance uses `app_insert_test_maintenance`.
- Test exit uses `app_insert_pipeline_test_exit`.
- Non-Test pipeline movement still uses `app_insert_pipeline_passes`.
- Pending Offer cards can use the next-step button to open Process Update prefilled for Offer.

Failed Candidates and Passed Offer:

- Failed Candidates use the same stage-column layout as the active pipeline for the current last-7-days window.
- Empty Failed Candidates stage columns stay blank; only the whole panel empty state is shown when no failed candidates exist in any stage.
- Failed candidates remain workflow state. They should stay visible in Pipeline failed-candidate sections, but a failed candidate in an active stage is not a Data Quality issue.
- Passed Offer uses the same compact card arrangement.
- Write roles see `Create offer` on passed-Offer cards only when no offer record exists for that candidate.
- No next-step update arrow for process movement.
- Responsive multi-column layout.

Candidate Pipeline Journey:

- StageRail connector segments color completed passed-to-passed history, and pending/failed current stages color only the incoming connector from the previous stage. The outgoing future segment remains neutral.

## Offer Rules

New Offer:

- Only show Offer-pass candidates with no offer record.
- After selecting a candidate, Doc ID options are limited to available requisitions in the candidate's group.

Available Doc ID means:

- requisition is not filled,
- requisition is not cancelled,
- open headcount is greater than `0`,
- no existing offer for that candidate/doc pair.

Offer Type and Replaced fields were removed.

Change Offer:

- Candidate and Doc ID remain locked.
- Accepted date, first working date, and remark remain editable.

Offer work is embedded in the workspace and should inherit the current group document context.
- The workspace Offer surface stays compact. Keep offer actions, reconciliation prompts, and linked record actions concise rather than rebuilding recommendation or summary blocks there.

## Permissions

Roles:

- `system_admin`: recruitment data and user administration.
- `admin_recruiter`: full recruitment-data editor and setup/group/match editor, but no user administration.
- `site_recruiter`: recruitment writer for assigned scope, including group/match creation.
- `viewer`: limited read access to the workspace and related records.

Important rule:

- Do not give `admin_recruiter` user-management rights.
- Recruitment-data RPCs should use recruitment-writer permission where appropriate.
- User administration remains system-admin only.
- System-admin delete uses a destructive confirmation plus `app_delete_recruitment_record`; it excludes user profiles and blocks candidate-linked requisitions/matches.

## Database And RPC Notes

Primary tables:

- `profiles`
- `requisitions`
- `requisition_logs`
- `position_groups`
- `document_groups`
- `sourcing_weekly_updates`
- `candidates`
- `recruitment_logs`
- `offers`
- `change_logs`
- `vacancy_weekly_snapshots`

Important fields:

- `requisitions.replacement_names`
- `candidates.candidate_folder_url`
- new sourcing channel flags/applicant counts for LinkedIn, Walk-in, Referral, Others.

Important RPCs:

- `app_upsert_requisition`
- `app_upsert_position_group`
- `app_create_group_match`
- `app_unmatch_group_requisition`
- `app_delete_recruitment_record`
- `app_upsert_sourcing_weekly_update`
- `app_upsert_candidate`
- `app_insert_recruitment_log`
- `app_insert_pipeline_passes`
- `app_upsert_offer`

Schema/RPC changes require:

- migration in `supabase/migrations/`,
- fresh schema update under `supabase/restructured/`,
- TypeScript type/payload updates,
- UI/load/enrichment updates,
- docs update.

The new group-scope migration belongs in that path whenever workspace behavior, group document context, or offer availability rules change.

## Verification Commands

Minimum before pushing product code:

```powershell
pnpm typecheck
pnpm build
```

For local browser verification:

```powershell
pnpm dev
```

Then open:

```text
http://localhost:3000
```

For browser automation:

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

## Safe Develop Branch Workflow

Use this plain Git sequence. Do not use GitHub CLI (`gh`) for this workflow.

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

Rules:

- Do not force-push for normal product work.
- Do not commit secrets, `.env.local`, database dumps, candidate documents, or exported HR files.
- Keep migrations and dependent UI/RPC changes in the same commit.
- If Git reports `.git/index.lock`, confirm no Git/editor/Codex task is running before deleting the stale lock.

## Current Working State Notes

As of this document update:

- The active branch is `develop`.
- The latest known product changes were pushed before the documentation update.
- Documentation files may be modified locally if this handover was just created.
- A stale `.git/index.lock` was observed during documentation work; check before committing.

## How A New AI Should Work Efficiently

Start with this order:

1. Read `docs/AI_HANDOVER.md`.
2. Read `docs/WEBSITE_STRUCTURE.md` for canonical product structure.
3. Read `docs/FEATURE_FILE_MAP.md` for component/helper/URL/role/RPC/test ownership.
4. Read `docs/DEPLOYMENT.md` before push/deploy work.
5. Run `git status --short --branch`.
6. Inspect relevant source files with `rg` before editing.
7. Make narrowly scoped changes aligned with existing patterns.
8. Update docs in the same session when behavior changes.
9. Run `pnpm typecheck`; run `pnpm build` before push.

When implementing UI:

- Use the `internal-ops-ui` skill for operations-tool design direction when UI quality matters.
- Preserve Thai dictionary support.
- Prefer existing shared components and constants.
- Avoid redesigning unrelated screens.
- Verify responsive behavior if layout changes.
- Keep export data and business calculations stable unless explicitly requested.

When implementing data changes:

- Update migrations and fresh schema together.
- Update RPC payloads and TypeScript types together.
- Confirm role permissions at both UI and RPC/database level.

## High-Risk Areas

Be careful with:

- Vacancy Waterfall calculation and connector logic.
- Group-based candidate enrichment.
- Offer available Doc ID filtering.
- Candidate process update validation.
- Guided flow modal state and prefill values.
- Role permission boundaries, especially `admin_recruiter` vs user administration.
- Thai/English text keys.
- Print/PDF CSS and XLSX export column shape.

## Good Handover Prompt For A New Chat

Paste this into a new AI chat:

```text
We are working in:
C:\Users\thanaphat-krea\OneDrive - GFPT Public Company Limited\HR_database\recruitment_website

Please read docs/AI_HANDOVER.md, docs/WEBSITE_STRUCTURE.md, and docs/DEPLOYMENT.md first.

The app is a Next.js/Supabase recruitment tracking system. Keep Home as the first page, Dashboard as Vacancy Waterfall reporting, and Pipeline group-based. Preserve Thai/English labels, current permissions, and export behavior. Before editing, run git status --short --branch and inspect relevant files with rg. After code changes, run pnpm typecheck and pnpm build before pushing to develop.
```
