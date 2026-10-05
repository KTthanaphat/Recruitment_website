# Acceptance review

The original delivery evidence below predates the compact refinement. Current presentation acceptance is recorded under [Compact-design refinement](#compact-design-refinement).

2026-10-04 · Direct implementation · local and unpushed.

## Delivered

Both mockups are implemented as functional subviews: Vacancy & Requisitions → Risk & Aging, and Pipeline & Sources → Stage Bottlenecks. Existing Overview reports remain available. Dashboard uses its own light shell, compact common filters, More filters for outer scope, accessible secondary navigation, and responsive analytic panels.

Shared calculation modules own historical headcount/SLA contributions, normalized stage attempts, unique waiting records, interpolated median/P90, historical deadline availability, trends and comparisons. The screen, PNG and Excel consume those results. Complete authorized report inputs load lazily through counted, ordered pagination; partial reads fail with Retry. Scoped hydration opens existing details, while company-only requisitions have limited read-only details. Session/URL preferences retain subviews and local filters.

Each new report exports independent PNG and Excel. Excel contains exactly **Summary Data** and **Source Data**, with typed values, contribution flags, local-list inclusion flags, scope/history metadata and authorized identities. PNG renders the full matching action list, including rows beyond the on-screen page.

Specifications and owners: [accepted plan](plan.md), [canonical behavior](../../WEBSITE_STRUCTURE.md#risk-and-bottleneck-subviews), [design contract](../../design/dashboard-risk-bottlenecks.md), [export contract](../../design/dashboard-data-export.md#risk-and-bottleneck-workbooks), [Reporting map](../../maps/system/reporting.md#risk-and-bottleneck-subviews). Shared portal/Controls, Platform/Pipeline maps, design index and task router now link to the relevant owners instead of repeating behavior.

## Automated verification

| Check | Result |
| --- | --- |
| Affected browser/calculation/workbook suites | **100 passed**, Chromium, one worker |
| New report suite | 18 tests included in the 100 |
| Typecheck | `pnpm typecheck` passed |
| Production build | `NEXT_DIST_DIR=next-local-risk-build-1004 pnpm build` passed; 22 pages generated |
| Documentation | `python scripts/check_agent_docs.py` passed |
| Diff whitespace | `git diff --check` passed |

The affected run included `dashboard-risk-bottlenecks`, `dashboard-portal`, `dashboard-registry`, `dashboard-data-export`, `dashboard-reports`, `recruitment-performance`, `pipeline-actions` and `rejection-reason-admin`. Existing Pipeline interaction checks were adjusted to use the visible selector controls; the Dashboard scope check now opens More filters.

Focused fixtures cover SLA boundaries/unknown values, timestamp conversion, caps/no-shows/restarts, passed/failed and repeated attempts, mixed canonical/legacy history, inferred/outcome-only exclusions, interpolated statistics, unique/conflicting queues, terminal events and unavailable historical deadlines. Loader checks include more than 1,000 records, server truncation, failures and retry. Browser coverage includes authenticated hydration, company-only details, restricted-role source populations, Channel/header scope, state/history, collapsed exports, Thai/English, keyboard operation, desktop/tablet/360/390px and contained table scrolling. Workbook checks reopen generated files and inspect two-sheet order, dates, numbers, literal formula-like text and contribution totals; PNG checks cover nonblank output and all filtered rows beyond pagination.

The build retains six existing lint warnings in HomeView, RecruitmentWorkspace, EmbeddedSourcingPanel, CommandSelector, CommandMultiSelector and HiringWorkspaceView, plus the optional `sharp` recommendation. No build/type errors remain. Restricted-role and exceptional-history checks use synthetic fixtures; they are not live observations of those roles.

## Authenticated live reconciliation

Read-only checks used **mppnlkldlctvketcsald**, signed in as system administrator **Phat**. Header Site/PIC/Priority and common Site/Department/Level were All; Channel was All. Visible totals were compared with independently queried aggregate SQL and downloaded workbook contribution totals. Private downloaded workbooks remain in the user's Downloads folder; only aggregate [evidence](evidence/live-reconciliation.json) is stored here. [Verifier](verify-live.cjs) reopens the four workbooks with ExcelJS.

| Report / period | Observed and reconciled |
| --- | --- |
| Risk, August PIM, snapshot 31 August | Open HC 9 = on track 5 + approaching 1 + overdue 3; unknown 0; priority at risk 0; exposure 44.4% |
| Risk, October MTD, snapshot 4 October | Open HC 9 = overdue 9; unknown 0; priority at risk 1; exposure 100% |
| Bottlenecks, 1–31 August | Waiting 2; pooled median 0 days across 44 valid completions; known overdue 0; oldest wait 12 days; unavailable historical deadlines 2 |
| Bottlenecks, 1–4 October | Waiting 3; known overdue 1; oldest wait 46 days; no valid completions, so duration and primary bottleneck are unavailable |

August's primary bottleneck is Phone Screening: N=8, median 12 days, P90 21.9 days. Stage samples reconcile to 44, and unique waiting/source contributions match the screen. The two August historical deadlines cannot be recovered reliably; those candidates remain in the waiting queue, their due dates are blank/unavailable in Excel, and affected comparisons/trend points are suppressed. October's empty completed population is shown explicitly. Synthetic tests supply edge-case evidence absent from this live dataset.

All four live PNG/XLSX scenarios downloaded successfully. After the production build, both October report formats were downloaded again from the restarted authenticated preview; the four-workbook verifier returned `scenarios: 4, reconciled: true`.

## Local handoff

The development server was stopped before the production build and restarted on **port 3000**, using ignored cache `next-local-risk-preview-1004`. Both new views were checked in the authenticated browser, including rendered desktop layouts and final PNG/Excel actions. Login and both report URLs returned HTTP 200; their referenced CSS/JavaScript assets also returned 200 (six Login assets, seven assets per Dashboard response).

- [Vacancy Risk & Aging](http://localhost:3000/dashboard?dashboardTab=vacancy&vacancySubview=risk)
- [Stage Bottlenecks](http://localhost:3000/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks)

The server is left running. No schema/migration change, database write, commit or push was performed for this feature. Existing Dashboard/Configuration/export work and unrelated RPC/migration edits were preserved.

## Compact-design refinement

2026-10-04 · Direct implementation · local and unpushed. Original results above remain historical evidence.

### Changes and preserved contracts

Restored the original dark blue sidebar, white selected navigation item, expanded/collapsed geometry and off-white canvas on Dashboard. Assigned-profile site accent now matches the other pages; changing the report Site filter does not change branding. More filters and the scope summary remain.

Added opt-in `Button` toolbar/icon-toolbar sizes and `.dashboard-compact-controls`. Dashboard header, report actions, selectors/date triggers, tabs, local chips/status/search and owned export dialogs use 32px desktop controls. Targets remain at least 44px below 640px or with coarse pointers. `Modal compactControls` supplies the compact export-dialog Close button without changing operational detail drawers. Shared switch track/selected color and dropdown option/focus exceptions remain unchanged.

Both new reports use system typography, surfaces/borders/small shadows, 12px panels and 8px gaps. Large icon circles and tinted KPI cards were replaced by compact icons, navy values and quiet summary-strip separators. Real trends/comparison dates remain visible. Risk blocks retain hover/focus/pressed drill-down feedback. Needs attention uses divided rows; actions stay centered and names/context wrap naturally. Container widths at 640/960px control composition independently of sidebar width. The action column has enough width to keep normal Follow up labels on one desktop line; longer labels can grow naturally. PNG follows the revised design and includes every matching action row. Calculations, data loading/access, URL/session state and two-sheet Excel contents were not changed.

### Verification

| Check | Result |
| --- | --- |
| Affected Dashboard/export/detail/control/Configuration suites | **106 passed**, Chromium, one worker |
| Final compact presentation checks | **6 passed** after checking the 650px boundary |
| Typecheck | `pnpm typecheck` passed |
| Production build | Passed with ignored cache `next-local-dashboard-compact-build-1004`; 22 pages generated |
| Documentation and diff checks | Passed |

Six new checks cover exact desktop button/selector/tab/export-dialog dimensions, original sidebar appearance and 248/72px modes, unchanged operational-detail/Home controls, HQ/KT1/KT2 profile accents, fixed switch colors and dropdown option geometry, actual container panel placement, long names/context, English/Thai, 1600/1280/1024/768/650/390/360px and coarse-pointer desktop targets. Existing export-modal geometry expectations now assert 32px desktop and 44px phone to match the accepted refinement. Interaction, state, authorization, workbook reconciliation, complete PNG and Configuration regressions passed in the affected run.

Synthetic visual evidence: [English 390px](evidence/compact-en-390.png), [Thai 360px](evidence/compact-th-360.png). Full labels/context remain available through wrapped cells and contained table scrolling; the page does not overflow.

### Authenticated comparison and delivery

Signed in as system administrator Phat on `mppnlkldlctvketcsald`, using the same All scope and August PIM/October MTD as the original reconciliation. Compact screen observations and newly downloaded PNG/XLSX matched the original values:

- Risk: August open HC 9, on track 5, approaching 1, overdue 3, exposure 44.4%; October open HC 9, overdue 9, priority at risk 1, exposure 100%.
- Stages: August waiting 2, 44 valid completions, pooled median 0 days, primary Phone Screening median 12/P90 21.9 days, unavailable historical deadlines 2; October waiting 3, overdue 1, longest wait 46 days and no completions.

The workbook verifier reopened all four newly downloaded workbooks and reconciled summaries with source contributions. New aggregate [compact evidence](evidence/compact-live-reconciliation.json) is separate from the original evidence. The verifier accepts an optional evidence filename to preserve prior observations. The two unrecoverable historical deadlines remain explicitly unavailable. No new SQL query or database write was needed for this presentation refinement.

Stopped the development server before building, then restarted port **3000** with ignored cache `next-local-dashboard-compact-preview-1004`. After restart, both authenticated October report views and PNG/Excel downloads were verified again, and the four-workbook verifier passed. Login and both handoff URLs returned HTTP 200; all referenced CSS/JavaScript assets returned 200 (six Login assets, seven per Dashboard response). The server is left running.

- [Vacancy Risk & Aging](http://localhost:3000/dashboard?dashboardTab=vacancy&vacancySubview=risk)
- [Stage Bottlenecks](http://localhost:3000/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks)

Six existing lint warnings and the optional sharp recommendation remain; no new build/type errors. No schema changes, database writes, commit or push; unrelated local edits were preserved.

## Navigation and summary refinement — 2026-10-04

Accepted [refinement](navigation-summary-refinement.md) implemented directly. Two main groups now contain the requested children; old Vacancy URLs/session state migrate without losing common/local filters. Report headings are static; legacy collapse flags are removed and cannot hide content. Internal Waterfall breakdown remains optional. Outer Site/PIC/Priority are inline with compact sizing. Performance has four screen/PNG KPIs while Excel retains AVG.

Risk health uses the two-line label, adjacent 32px total and square bar above its wrapping legend. Metric fractions use all open HC or all open priority HC, including On track/Unknown; exposure still uses known SLA. Stage uses matching hierarchy with existing counts/days. Comparison dates use Gregorian compact ranges. Distribution says Approaching. Restarted SLA gets a star, accessible exact date and one conditional table remark; numeric Excel cells stay clean. Risk workbook denominators/shares and open priority metric reconcile with source rows.

### Final checks

- **114/114 affected checks passed** across Dashboard refinement/portal/registry/compact/risk/overview/export plus operational Pipeline details and Configuration. The intermediate hydration-test race was repaired by awaiting the named candidate drawer rather than the transient loading dialog; three repeated passes and the complete final run passed.
- Typecheck, production build (22 pages), documentation checker and diff checks passed. Build retains the existing lint/optional-image warnings; no new type/build error. Build ran with development stopped and an isolated ignored cache; generated TypeScript include changes were removed while preserving previous settings.
- Detailed aggregate [acceptance](evidence/navigation-summary-acceptance.json). Synthetic visual checks: [Risk EN 390px](evidence/navigation-risk-en-390.png), [Risk TH 360px](evidence/navigation-risk-th-360.png), [Stage EN 390px](evidence/navigation-stage-en-390.png), [Stage TH 360px](evidence/navigation-stage-th-360.png). Inspected Thai Risk phone output; all labels/values remain available with contained table scrolling and no page overflow.

The additional broad UX suite passed 35/41 checks. Six **Home** assertions remain outside this refinement: expecting pale triggers instead of current shared white triggers, querying old native selects rather than current command selectors (record sort and calendar controls), and three welcome-ratio expectations using older fixture capacity (13 vs current 16; recruiter 3 vs current 6). Home implementation and those tests were not changed. Dashboard, Configuration and detail acceptance is separately passing; the broad-suite limitation is not represented as a full pass.

### Authenticated live reconciliation and preview

Read-only administrator Phat checks against `mppnlkldlctvketcsald`, all header/common filters, Priority all and Channel all:

- October MTD: Risk open HC **10**, overdue **9/10**, approaching **0/10**, priority **1/1**; Stage waiting **3**, known overdue **1**, longest **46 days**, no completed duration.
- August PIM: Risk open HC **9**, overdue **3/9**, approaching **1/9**, priority **0/1**; Stage waiting **2**, pooled median **0 days**, longest **12 days**, historical deadlines unavailable **2**.

The current open population grew from the earlier acceptance's 9 to 10. Fresh screen/export observations are reconciled independently rather than forcing the previous number. [Live evidence](evidence/navigation-summary-live-reconciliation.json) and [verifier](verify-navigation-live.cjs) contain aggregate results only; downloaded identity-bearing workbooks remain outside the repository. Four current/historical workbooks have exactly two sheets and reconcile; live Performance Excel still contains AVG. Both report PNG downloads passed generation nonblank validation and reopen as full-size 2880px-wide images.

Restarted port **3000**, ignored cache `next-local-dashboard-summary-preview-1004`; authenticated views and export downloads work after restart. Login and all four canonical Dashboard links returned 200; CSS and JavaScript responses returned 200. Server remains running.

- [Performance](http://localhost:3000/dashboard?dashboardTab=performance&performanceSubview=overview)
- [Vacancy & Requisitions](http://localhost:3000/dashboard?dashboardTab=performance&performanceSubview=vacancy)
- [Risk & Aging](http://localhost:3000/dashboard?dashboardTab=performance&performanceSubview=risk)
- [Stage Bottlenecks](http://localhost:3000/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks)

No schema migration, SQL write, commit or push. Existing local Configuration/dashboard work and unrelated RPC/migration changes were preserved.

## Stage screen and mobile-shell refinement — 2026-10-05

Stage's four summary cards now appear only in PNG; Excel summary metrics remain. Screen/PNG primary-bottleneck banners use white with an amber border. Mobile navigation and route availability are owned by the linked [mobile-shell acceptance](../mobile-shell/review.md), which records the accepted plan, loading/resize protections, 133 passing affected checks, build/doc/type verification, aggregate current/historical live reconciliation and running localhost links. Earlier observations above remain historical evidence.
