# Rejection dashboard implementation

Date: 2026-10-25. Direct implementation in the active recruitment checkout; no delegation, push or deployment.

## Owners

[Reporting route](../../maps/system/reporting.md#rejection-analytics) → [canonical behavior](../../WEBSITE_STRUCTURE.md#rejection-analytics) → [visual contract](../../design/dashboard-rejections.md). These documents own the rules; this record retains verification evidence only.

## Delivered

Pipeline Rejections subtab; canonical/legacy failure normalization, outcome-assignment attribution, saved reason snapshots, local exploration and application-aware records. Shared complete loader includes existing failure classification fields. PNG and two-sheet Excel use the same report model and all matching events across pagination. No SQL change was required by the local implementation.

Preview: `http://localhost:3000/dashboard?dashboardTab=pipeline&pipelineSubview=rejections`. Development output is isolated in ignored `next-local-rejection-preview/`; build output uses `next-local-rejection-build/`. Existing uncommitted application/schema changes were preserved.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`: exit 0 after implementation.
- `node node_modules/@playwright/test/cli.js test tests/e2e/rejection-dashboard.spec.ts --workers=1`: 9 passed, including actual PNG/Excel downloads, reopened workbook, correct application drilldown, Thai/English layouts, keyboard tabs, saved pagination, and load-failure retry. Final expanded regression results are recorded below when complete.
- `NEXT_DIST_DIR=next-local-rejection-build node node_modules/next/dist/bin/next build`: initial build exit 0; final rebuild follows the table-width and dependency corrections. Existing unrelated lint warnings remain in shared/application components.
- Batched visual inspection: English at 1440px and Thai at 1024px. Fixed inherited table minimum-width conflict; regression asserts readable column widths and bounded row height. Screenshots and synthetic exports are under ignored `outputs/rejection-dashboard/`.
- Dependency runner: `pnpm` in the restricted shell attempted dependency registration and failed Windows symlink permissions. Direct installed Node entrypoints supplied the same checks without changing dependencies. Browser/server processes ran with approved process access.

## Initial live boundary (resolved after restoration)

Read-only Supabase inspection of `mppnlkldlctvketcsald` returned inaccessible database. `get_project` confirmed status **INACTIVE**; a public-client availability probe also failed. The configured local project host is correct. These checks do not establish live schema compatibility or real authenticated RLS behavior. No hosted data, schema, project state or production project was changed. Restoring the inactive development project was raised separately with the user.

Local browser tests intercept Supabase with synthetic authenticated fixtures; they verify UI/report behavior, not live authorization. The Next.js route and assets can run locally while live sign-in/data remain dependent on the development service.

## Final verification results

- Rejection report suite: **9/9 passed** on final calculation/UI source. Includes preserving Unclassified reason independently when old saved IDs exist without labels, PNG source-row count **61**, actual downloads, and reopened Excel reconciliation.
- Shared portal and registry suites: **14/14 passed** (23/23 with the Rejections suite in the combined run).
- Focused existing Stage Bottlenecks/loader checks: **4/4 passed**, including retrieval above 1000 rows, rejection of incomplete/duplicate pages, header scope, authorized hydration and export rows across pagination. The older large-data fixture created profiles without applications; it was updated to create journeys/assignments and attach stage logs, preserving its original assertions.
- Final production build: **exit 0**; no new report lint warnings. Existing unrelated lint warnings remain.
- Documentation checker: **exit 0** after adding this record.
- Exact localhost handoff route: **HTTP 200**; **7/7 JavaScript/CSS assets HTTP 200**. Preview server remains running.
- Final visual confirmation at 1440px English and 1024px Thai; phone route retains desktop notice. Synthetic screenshots and sample exports are in outputs/rejection-dashboard/ and are not live HR evidence.
- Removed only Next-generated preview/build include entries from tsconfig after verification; dependency manifests and lockfiles were not changed.

The initial live-data limitation was resolved after the user authorized restoring the development project; see the live results below.

## Live verification after authorized restoration

The user explicitly authorized restoring development project mppnlkldlctvketcsald. Supabase restore_project succeeded and get_project subsequently reported ACTIVE_HEALTHY. Production was not changed.

Read-only schema inspection confirmed every required rejection field and application/assignment key already exists remotely; **no migration is needed**. The live check used a temporary admin-recruiter auth/profile account, a genuine password-authenticated session, and the existing browser/REST paths with no network interception. It did not create or change recruitment records. The account/profile were deleted afterward.

Command: node scripts/verify-rejection-live.cjs --run — **exit 0**. [Verification script](../../../scripts/verify-rejection-live.cjs) requires explicit opt-in and asserts the development project host. Its ID-only recovery marker supports cleanup if interrupted; credentials stay in memory and service-role keys never enter the browser.

- Authenticated selection of the existing rejection fields succeeded; anonymous history access remained denied.
- Complete authorized history loaded **84 stage rows**.
- Selected live range: **17/07/2026–25/10/2026**.
- Report: **6 failure events, 6 distinct applicants, 6 distinct applications**.
- Actors: **0 company, 0 candidate, 6 unclassified**. These historic rows lack saved actor classifications; no values were inferred or backfilled.
- Diagnostics: **0 undated, 0 unresolved context**.
- Real browser summary, actor totals and exported Excel event IDs reconciled with the live model.
- Candidate drawer opened with the correct applicationId; **0 failed REST reads**.
- Temporary verification account/profile cleanup succeeded; **0 recruitment writes and 0 schema changes**.

Live screenshot and aggregate evidence are local-only in outputs/rejection-dashboard/live-desktop.png and live-verification.json. The repeatable script cleans up its test login in finally. The first verification attempt also removed its account after a script-only ExcelJS row-inspection error; the corrected rerun passed.

Verified live-data URL: http://localhost:3000/dashboard?dashboardTab=pipeline&pipelineSubview=rejections&dashboardPeriod=custom&dashboardStart=2026-07-17&dashboardEnd=2026-10-25

The development server remains running. Nothing was pushed or deployed.

## Compact treemap refinement — primary KT checkout

Implemented on 2026-10-25 in the KT OneDrive recruitment app, using the existing direct delivery choice. Existing unrelated changes and the production-mode KT server on port 3000 were preserved. The refined development preview runs separately on **http://localhost:3001**, with ignored next-local-rejection-compact-preview/ output. Build output is isolated in next-local-rejection-compact-build/.

Delivered compact spacing/controls/table rows, Saturday–Friday weekly buckets, saved Treemap/Bars preference, full-width main/detail treemap explorer, explicit sibling comparison totals, complete tooltips/directory, and comparison summary/source workbook tables. Canonical behavior, design, reporting node, router and portal/export cross-links were updated rather than duplicating policy in maps.

Owners: [ReasonTreemap](../../../src/components/dashboard/ReasonTreemap.tsx), [layout helper](../../../src/lib/rejection-treemap.ts), [report tests](../../../tests/e2e/rejection-dashboard.spec.ts). Counting rules remain in the [canonical population contract](../../WEBSITE_STRUCTURE.md#reason-treemap-and-comparison-population).

### Verification evidence

- Report suite: **13/13 passed** on final source, covering Saturday/Friday clipping, Bangkok timestamps, year crossings, granularity thresholds, deterministic area/bounds/no-overlap geometry, selected-versus-comparison reconciliation, active-view PNG measurement, view persistence, compact controls and existing report behavior.
- Shared portal/registry: **14/14 passed**; combined run **27/27 passed**.
- Focused Stage Bottlenecks/shared-loader regressions: **4/4 passed**, including >1000 rows, incomplete-page rejection, scope/hydration and complete export rows. **31 distinct focused tests passed in total.**
- Typecheck and final separate-output production build: **exit 0**. Existing unrelated lint warnings remain; the refinement introduced none.
- English 1440px and Thai 1024px visual review completed; selected-detail screenshot demonstrates 3 selected events alongside 6 comparison events and two 50% sibling rectangles. Smaller widths retain the desktop-required notice. Synthetic screenshots/exports remain in ignored outputs/rejection-dashboard/.
- Exact localhost:3001 deep link: **HTTP 200**, **7/7 JavaScript/CSS assets HTTP 200**.
- Live check on mppnlkldlctvketcsald: **ACTIVE_HEALTHY**, genuine authenticated reads, **84 history rows**, **6 events / 6 people / 6 applications**, all Unclassified, no undated/unresolved context. Real browser totals, reopened Excel selected-event rows and application drilldown reconcile; **0 failed REST reads**.
- Repeatable live check: REJECTION_PREVIEW_URL=http://127.0.0.1:3001 node scripts/verify-rejection-live.cjs --run. Temporary account cleanup verified both in its evidence file and by read-only SQL: **0 remaining auth accounts/profiles**.
- **No schema/migration changes, recruitment-record writes, dependency changes, push or deployment.**

Current live-data preview: http://localhost:3001/dashboard?dashboardTab=pipeline&pipelineSubview=rejections&rejectionReasonView=treemap&dashboardPeriod=custom&dashboardStart=2026-07-17&dashboardEnd=2026-10-25

The live sample contains only Unclassified reasons, so its treemap correctly has one rectangle; diverse and tiny categories were verified with synthetic fixtures. Current aggregate live evidence is outputs/rejection-dashboard/live-verification.json. The initial browser pass found a 35px search field and duplicate empty-state announcement; both were corrected and the final suite passed.
