# Mobile shell acceptance — 2026-10-05

Implemented directly from the [accepted plan](plan.md). Changes remain local and unpushed. No SQL or schema change was required; existing Dashboard, Configuration and unrelated migration work was preserved.

## Presentation and navigation

Stage screen omits its four KPI cards, while PNG retains their values, trends and comparisons. Excel retains exactly **Summary Data** and **Source Data**. The shared primary-bottleneck banner is white with a `#FF8A00` border; charts, notices, drill-downs and complete action rows remain.

Below 1024px, the shell contains Home, Workspace and Records. The Records sheet contains all five existing categories in order, preserves contextual links, traps focus, supports Escape/focus return and closes on navigation or entry into desktop mode. Existing sheet callers retain their 768px default; only Records opts into 1024px.

Initial mobile Dashboard, Configuration, Audit and Administration visits preserve the requested URL and show the localized desktop-required notice. They verify authentication and load only the signed-in profile. Allowed mobile routes retain workflow catalogs and operational loading while omitting the company Dashboard RPC. Restricted components load lazily. Unknown viewport mode renders a neutral loading state; stale results cannot publish after availability changes.

Existing drafts, saves, details and export dialogs survive desktop-to-mobile resizing until their interaction finishes. The grace period applies only to an already-open desktop interaction, preventing a new mobile query/detail from bypassing the notice.

Canonical ownership: [mobile navigation](../../design/mobile-navigation.md), [controls](../../design/controls.md), [Stage presentation](../../design/dashboard-risk-bottlenecks.md), [export contract](../../design/dashboard-data-export.md), [behavior](../../WEBSITE_STRUCTURE.md#routes-and-navigation). Reporting/Platform maps and the task router link to implementation and verification owners.

## Verification

**133/133 affected browser checks passed** in the final run (3.7 minutes): mobile operations, Stage refinement, Dashboard risk/compact/navigation/portal/registry, Performance/overview/export, operational Pipeline details and Configuration reasons/templates. Focused repeated checks also passed for Records navigation at 390/768/1023px, Configuration save/resize protection and square Dashboard bars. Typecheck, documentation checker, diff checks and production build (22 pages) passed. Build retains five existing lint warnings and the optional sharp recommendation.

The browser matrix covers English/Thai at 360/390/768/1023px, the 1024px desktop boundary, four role fixtures, all four restricted routes and all seven operational destinations. Assertions include profile-only reads, absence of the company RPC on mobile operational navigation, exact URL retention, contained focus, touch targets, overflow, auth/sign-out, late-response exclusion, drafts, saves and export locks. Synthetic screenshots: [English phone notice](evidence/mobile-notice-en-360.png), [Thai phone notice](evidence/mobile-notice-th-360.png), [complete Stage PNG](evidence/stage-summary-retained.png). Thai phone and Stage PNG were visually inspected: labels wrap, navigation remains visible, and the export contains the four cards, white bordered banner and complete filtered action rows.

## Authenticated read-only observations

Existing signed-in System Administrator **Phat**, project `mppnlkldlctvketcsald`, all header/common scope and Channel all:

| Range | Waiting | Known overdue | Longest wait | Completed median | Unavailable historical deadlines |
|---|---:|---:|---:|---:|---:|
| October MTD, 01–05/10/2026 | 3 | 1 | 47 days | — | 0 |
| August PIM, 01–31/08/2026 | 2 | 0 | 12 days | 0 days | 2 |

August contains 44 valid completed instances and identifies Phone Screening as the primary bottleneck. Current/historical workbooks reconcile waiting contributions and stage totals. Fresh current PNG/XLSX downloads were repeated after the server restart. PNG is complete at 2880×1974 and passed generation nonblank validation; screen has no summary cards and export retains four. [Aggregate evidence](evidence/live-reconciliation.json), [workbook verifier](verify-live.cjs). Identity-bearing downloads remain outside the repository.

Authenticated live desktop rendering and downloads were inspected. Live phone navigation could not be exercised through the available signed-in browser's viewport controls; mobile coverage above uses synthetic signed-in fixtures and does not claim a live phone observation. Unrecoverable August action dates remain explicitly unavailable.

## Local preview

Development was stopped for the production build, then restarted on **3000** using isolated ignored cache `next-local-mobile-stage-preview-1005`. Login, Home, Workspace, Requisitions and Stage URLs returned HTTP 200; all referenced CSS/JavaScript assets returned 200. [Route/asset evidence](evidence/localhost-assets.json). Reachability is separate from the authenticated Stage observations above.

- [Stage Bottlenecks — desktop](http://localhost:3000/dashboard?dashboardTab=pipeline&pipelineSubview=bottlenecks)
- [Home](http://localhost:3000/home)
- [Workspace](http://localhost:3000/workspace)
- [Records — Requisitions](http://localhost:3000/requisitions)

Server remains running. No live-data writes, commits or pushes.
