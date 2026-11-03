# Recruitment design adjustments — local implementation

Direct delivery, no agents. KT main worktree .local/worktrees/push-sourcing-main, based on 680276d. Preserve unrelated local changes. No push, Render change or production database mutation.

## Read only the relevant contract

- [Skeletons/numeric placeholders](../../design/controls.md#data-loading-and-retry-controls).
- [Workspace cards, ratios and scoped sourcing](../../design/workspace.md#group-cards-ratios-and-scoped-sourcing).
- [Complete board and five-card navigation](../../design/pipeline.md).
- [Home footers](../../design/home.md#record-footer-placement-and-loading).
- [Offer presentation and attendance](../../design/candidate-detail.md#compact-offers-and-working-confirm).

## Implementation boundaries

Complete reads traverse 100-row cursor pages, reject duplicate identities and cursor loops, and validate an independent count with one clean retry. Board sections publish atomically; details remain on demand.

Workspace Sourcing receives hydrated selected-group data rather than bootstrap operational arrays. Exact-group history loads independently through the existing sourcing RPC. Read-only inspection confirmed development SQL already guards incomplete summary weeks and retains security invoker. No migration is needed; authorization helpers, RLS and grants remain unchanged.

Mocks now normalize legacy Monday dates to Saturday, honor exact group filters, and preserve incomplete totals as null. The all-zero chart fixture zeroes all relevant historical channel counts instead of leaving positive history while expecting an all-zero chart. Tooltip tests follow the body portal.

## Verification

Final results and measurements are recorded below after integrated checks. Automated mutations use fixtures; real backend checks are read-only against development mppnlkldlctvketcsald. Production sawiklexaafczfmzqhnr is untouched.

## Local preview

Runtime mirror: %TEMP%/recruitment-main-release-validation-20261102/source, outside OneDrive, with development environment, public/root assets and department/section CSV data. Separate development/build directories avoid tracing conflicts. Final production-build preview: http://127.0.0.1:3016. Use a normal authorized development account. Automated authenticated regressions use mocked sessions. No push or deployment without a later request.

## Final verification results

- 48 focused browser checks passed, including scoped details/reference checks, sourcing history/summary/editor/save behavior, unsaved-change guards, standalone history paging, skeleton/retry states, phone Thai/reduced motion, complete Pipeline retrieval and local five-card navigation.
- 24 loader/scheduler unit tests passed, including 1,005 tied records, count-mismatch retry, persistent mismatch rejection, duplicate identity rejection, empty scopes and cache/authorization isolation.
- Five design smoke tests passed again against the exact production build served on port 3016.
- Type checking, documentation graph validation, diff whitespace checks and production build passed. Build generates 22 pages with about 382 kB application first-load JS; lint/optional-image warnings remain in the captured build log.
- Login, Workspace, a compiled JavaScript asset and department/section lookup endpoint return HTTP 200. Compiled assets reference development mppnlkldlctvketcsald.
- Source HEAD remains 680276d. No push, deployment, migration, production change or authorization-helper replacement.

Evidence is under the worktree outputs/design-adjustments directory: verification-receipt.json, browser/unit/build logs, production-preview-verification.log, baseline-activity.log, performance JSON and desktop/phone screenshots. Real user sign-in uses an authorized development account; authenticated browser regressions use fixtures, and live backend inspection was read-only.

## Before/after synthetic measurements

Both measurements use local production builds and intercepted RPC fixtures, not real database latency. Before is the first usable **partial** board; after waits for the **complete** board. Request/byte figures cover observed list responses at that milestone, not all application traffic. These are illustrative single runs, not a statistically controlled speed benchmark.

| Matching population | Before cards in stage | After visible cards | List requests before / after | List bytes before / after | Milestone ms before / after |
| --- | --- | --- | --- | --- | --- |
| 23 | 23 | 5 | 3 / 9 | 17927 / 18611 | 387 / 651 |
| 1005 | 50 | 5 | 3 / 19 | 38612 / 772483 | 336 / 509 |

The larger initial payload is the explicitly chosen full-preload tradeoff. The new 1,005-record board traverses every match; the old first display contains only 50. Navigation between five-card pages makes no additional list requests. Full detail/history payloads remain on demand.

## Known issue outside this change

The pre-existing test “Activity shows recorded sourcing actor and an honest fallback” still reports missing actor/history rows in Workspace Activity. It was reproduced on the prior production-build reference as well as the current code and excluded from the 48 focused passing checks. The baseline failure log is preserved; this release does not claim to repair that separate Activity-history behavior.

## Local review

Open http://127.0.0.1:3016 and sign in with a development account. Review Workspace Cards and Filled / Total; Sourcing week selection/editor; Pipeline chevrons and page fractions; the three Home table footers; and Candidate Detail offer pencil/Working Confirm. The server uses the final next-production-design-final output. No Git push or external release has occurred.

## November 3 refinement

Local-only follow-up, direct/no agents. Continue the same KT worktree and preserve unrelated changes. No push/deployment or database changes.

Canonical reading routes: [Workspace cards](../../design/workspace.md#group-cards-ratios-and-scoped-sourcing), [attendance/loading controls](../../design/controls.md#attendance-decisions-and-structural-loading-refinements), [candidate offers](../../design/candidate-detail.md#compact-offers-and-working-confirm), [Home](../../design/home.md#recruitment-records). Maps link to these owners rather than duplicating the specification.

Implementation:
- Cards retain name, top-right formatted ID and three wrapping tags only. The Table view retains metadata and previews. One/two/three columns use the agreed 768/1280px breakpoints and cap at three.
- GroupCardSkeleton has three matching identity/tag cards. New hire table placeholders contain two action shapes per row. Remaining native report skeletons match their 7/8/9/configurable columns; Performance loading reuses its four metric cards and three chart frames.
- AttendanceDecisionActions shares the green/red icon pair across Candidate Detail and Home. Home callbacks carry the chosen attendance outcome into existing review/save fields. Eligibility, correction rules, RPC names and payload fields are preserved.
- Tests exposed a rapid double-save race in the existing review handler; a synchronous pendingSaveLock now prevents duplicate writes and review close/cancel stay disabled while saving. Tooltip Escape is consumed before drawer dismissal. Failed attendance saves retain the existing reason through Review and edit.
- Earlier Pipeline/sourcing/headcount/footer work is preserved. The separately documented pre-existing Activity-history failure remains outside this refinement.

Final refinement verification (November 3):
- 69 selected browser checks passed: 47 core design/loading/Home checks, 11 picker compatibility checks, and 11 report/risk/sourcing compatibility checks. The 24 refinement cases passed again against the final production build on port 3016.
- 24 loader/list/scheduler unit tests passed. Type checking, documentation validation and diff checks passed.
- English/Thai coverage includes 360, 390, 768, 1024, 1280 and 1920px widths, coarse pointers, reduced motion, error/retry, attendance review/no-write-before-save, required rejection reasons, permission eligibility and unchanged offer acceptance fields.
- The final production build generated 22 pages with approximately 384 kB application first-load JavaScript. Existing lint and optional sharp warnings are recorded in production-build-verified.log.
- Login, Workspace, all JavaScript assets referenced by Login, and /api/department-sections returned HTTP 200 from the final preview. Development Auth health returned 200. The configured backend is mppnlkldlctvketcsald; no SQL, production update, Git push or Render deployment occurred.
- The final runtime uses next-production-design-refinement-verified at http://127.0.0.1:3016, replacing the earlier preview. Sign in with an authorized development account. Authenticated workflow tests use fixtures; real authenticated production behavior was not exercised.
- Evidence: outputs/design-refinement/verification-receipt.json, browser logs, production-build-verified.log, production-preview-verification.log, development-health.json and desktop/phone screenshots. The earlier Activity-history limitation remains unchanged.

Local review: Workspace Cards should show only identity and three tags, with three columns at Full HD. Candidate Working Confirm and Home New Hire Confirmation share green/red icon controls; both open review before saving. Inspect delayed summaries and tables for matching skeletons and numeric placeholders.


### Attendance color follow-up
User requested green Check/red X icons on light green/red boxes. Shared controls now use #E8F5EC/#FCECEF surfaces and #167A3D/#C52B40 icons, retaining Working Confirm and review-before-save. Applies consistently in Candidate Detail and Home.


### Authorized Git release
The user subsequently authorized plain Git pushes to develop and main. Both Render services auto-deploy on branch commits; branch pushes may therefore deploy the release. Local-only delivery statements above describe the earlier handoff. The light-color production build and four attendance review/save checks passed on port 3016. No SQL or environment changes are part of this release. Unrelated local documentation/configuration edits remain excluded.
