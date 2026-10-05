# Acceptance review

Date: 2026-10-03. Direct implementation in the active `recruitment_website` checkout. See the [plan](plan.md) for accepted scope and canonical behavior/design links.

## Delivered

- Dashboard portal, typed report registry and shared controlled report context; normal-weight selectors; common calendar/Custom dates and Site/Department/Level scope.
- Canonical/legacy URL restoration, filter/tab history, session preferences per user/environment and sign-out cleanup. Local Channel, legend, expansion, stage mode and export-column preferences remain report-owned.
- Configuration folder model, desktop tree, mobile sheet, breadcrumbs, subtree search, status/counts and contextual editor. The single editor replaces the three former admin components and preserves existing writes, template validation, draft protection and refresh-only retry.
- Shared Drawer layering corrected so phone navigation cannot cover its actions.
- Canonical Website Structure, focused Dashboard/Configuration design contracts, Performance/Controls contracts, task router, design index, Reporting/Platform/Pipeline/Integrations maps and README updated. Maps route to owners/contracts instead of repeating behavior.

## Automated verification

| Command | Result |
| --- | --- |
| `pnpm typecheck` | Passed |
| `pnpm build` | Passed: optimized build, type/lint checks and all 22 static pages |
| `pnpm exec playwright test tests/e2e/dashboard-portal.spec.ts tests/e2e/rejection-reason-admin.spec.ts tests/e2e/recruitment-performance.spec.ts tests/e2e/dashboard-reports.spec.ts --workers=2 --reporter=line` | 49 passed, final run 58.9 seconds |
| `python scripts/check_agent_docs.py` | Passed |
| `git diff --check` | Passed; Git reports normal Windows line-ending conversion notices |

The affected suites use synthetic Supabase data and mocked writes/template endpoints. Coverage includes shared scope and Channel isolation, Department pruning/comma names, OR/AND selections, date validation/current-day and leap-year boundaries, Custom comparison/PIM-equivalent eligibility, historical no-show/accepted-offer/requisition/stage behavior, legacy conflict resolution, route/refresh/session/history/reset/sign-out state, PNG completeness/nonblank geometry, selected XLSX columns, folder hierarchy/search/archived parents, contextual creation/editing, failed writes, read-only refresh retry, Save/Discard/Continue editing, roles and keyboard behavior. Responsive checks span desktop/tablet and 360/390px phones in Thai and English.

Build/lint retain six pre-existing warnings: Home image optimization, the workspace loader's unnecessary router dependency, two shared selector ARIA declarations, Embedded Sourcing ARIA description, and Hiring Workspace's effect dependency. No new warnings remain in the portal or Configuration components.

## Working local preview

The final development server was restarted on port 3000 after the production build and left running. Links:

- [Dashboard](http://localhost:3000/dashboard)
- [Configuration](http://localhost:3000/configuration)
- [Login](http://localhost:3000/login)

All three routes return HTTP 200. Their 16 unique linked local CSS/JavaScript/preload assets returned HTTP 200 with zero failures. Dashboard and Configuration also rendered through the existing authenticated administrator session after restart; this evidence goes beyond an HTTP response or reachable Login page. Final browser warning/error logs were empty.

Desktop and 390px phone screenshots were inspected. At 390px, both pages' document width was 375px including the browser's scrollbar allowance, with no page-level horizontal overflow. Thai Configuration labels and phone drawer dismissal were inspected in the live session. Current-month MTD displayed 01/10/2026–03/10/2026; its empty report is a valid current-period population, while the 40-vacancy/16-fill distribution is verified by synthetic fixtures.

Saved evidence: [Dashboard desktop](evidence/dashboard-desktop.png), [Dashboard phone](evidence/dashboard-phone.png), [Configuration desktop](evidence/configuration-desktop.png), [Thai Configuration phone](evidence/configuration-phone-th.png).

## Environment and scope

The local public Supabase URL resolves to `mppnlkldlctvketcsald.supabase.co`. No SQL/schema/database change was needed for the redesign. The pre-existing RPC schema edit and two pending migration files remain untouched; none was applied. No Git push or deployment was performed.

Browser save/failure tests were synthetic. The existing authenticated local browser session was used to inspect live read paths, desktop/phone layouts, Thai labels and drawer dismissal. No live Configuration write or external invitation/letter send was needed for those checks.

## Follow-up: compact filters and editor ON/OFF

The requested follow-up replaces the Configuration drawer's Active checkbox with the existing localized ON/OFF track-and-thumb switch. It applies to reason and template editors, preserves the draft/save model and disables during writes or refresh retry. The desktop track measures 64×32px; its phone target measures 44px high.

The common dashboard toolbar now uses 32px desktop controls, 8px padding and tight label/grid spacing. Scope info and Reset share its action cell; full scope remains in the report headers and accessible info tooltip. The rendered desktop panel measured approximately 67px high, compared with approximately 156px previously. At 390px it measured 215px high, retained 44px controls and stayed within the page width. Phone month and multi-select popovers remain within the viewport.

The same four affected browser suites passed all 49 checks in 59.0 seconds. Updated assertions verify compact desktop geometry, phone touch targets/month bounds, keyboard scope-info dismissal and toggling/saving OFF followed by reactivation. Typecheck, documentation validation and whitespace checks passed.

The follow-up production build passed with the same six existing lint warnings. The development server was restarted on port 3000 and both authenticated previews rendered again; the compact Dashboard's final browser warning/error log was empty.

Follow-up screenshots: [compact Dashboard desktop](evidence/dashboard-compact-desktop.png), [compact Dashboard phone](evidence/dashboard-compact-phone.png), [Configuration detail editor switch](evidence/configuration-editor-switch.png). No SQL change or push was needed.


## Follow-up: shared ON/OFF and compact Configuration contents

Implemented [OnOffSwitch](../../../src/components/ui/OnOffSwitch.tsx) for Pipeline Channel legend, reason/template editor drafts, every reason list Active control and the selected-main-folder header. Existing CSS hooks remain. Fixed light-blue OFF/system-blue ON tokens, hover, disabled opacity, focus, localized state labels, native Enter/Space activation and reduced-motion behavior follow the [Controls contract](../../design/controls.md#shared-onoff-switch). Site accents do not change switch colors.

Configuration now uses 12px layout gaps, 16px contents padding and 8px header spacing. At pane widths of at least 600px, icons, names, metadata and actions share one centered grid row. Below that width, metadata sits beneath the name and actions wrap separately. Desktop item rows measured 44px and all four block centers matched; the 260px navigator retains 36px minimum desktop rows. Search/status/actions use 32px desktop geometry and 44px phone targets. Pipeline Channel and legend controls both measured 32px with identical vertical centers. Blanket descendant button sizing was removed in favor of owner-scoped geometry.

Verification:

- Four affected Playwright suites: **51 passed** in approximately one minute. Existing calculation/export, navigation, bilingual layout, failure/retry, permission and draft coverage remains green.
- Added assertions verify exact ON/OFF/hover colors and OFF border/text, 64×32 geometry, thumb placement, Enter/Space, system focus, reduced motion, disabled confirmed state during refresh retry, fixed colors under KT1/KT2 accents, aligned controls/rows and long-name wrapping at 1440/900/390/360px without page overflow.
- A final focused template check also passed: switching OFF changes the draft without a write; Save persists the inactive template.
- `pnpm typecheck`, `python scripts/check_agent_docs.py`, and `git diff --check` passed. `pnpm build` passed with the same six existing lint warnings; no new build warning was introduced.
- After restart, Login, Dashboard and Configuration returned HTTP 200; all 16 referenced local assets returned HTTP 200. Existing authenticated administrator previews rendered the Pipeline report, Configuration detail folder and reason editor. Final browser warning/error logs were empty. Live inspection used read paths only; write/failure tests used synthetic fixtures.

Evidence: [Configuration desktop](evidence/shared-switch-desktop.png), [Configuration phone](evidence/shared-switch-phone.png), [Pipeline controls](evidence/pipeline-shared-switch.png).

Contracts and relevant Platform/Pipeline/Reporting owner maps now link to the shared primitive and focused visual rules. The development server remains running on [localhost:3000](http://localhost:3000/dashboard). No SQL change, migration application, push or deployment was performed; existing unrelated edits remain preserved.


## Follow-up: live reconciliation and future-report compatibility — 2026-10-04

Read-only reconciliation on `mppnlkldlctvketcsald` found and repaired two discrepancies: anonymized company-report offers caused Source Hired to be zero, and excluding no-show acceptance while retaining reopening overstated Waterfall closing vacancies. The user approved retaining both movements. August PIM now balances **6 + 8 − 5 = 9**; Performance retains four effective fills and Source retains five historical hires.

[Reconciliation evidence](reconciliation.md) records **12 live scenarios and 440 comparisons with zero differences** across KPI values, matrix/composition/SLA counts, Waterfall totals, requisition counts, Pipeline stages and per-channel Source measures. The audit retained aggregate data only; no live write was performed. Snapshot and role boundaries are documented there.

Future compatibility uses a single validated report metadata catalog shared by URL/session restoration. Each report context applies only declared capabilities within header scope, retains saved unsupported selections, and exposes effective dates/summary. Reports without Period support render despite invalid saved Custom dates. Stable future IDs and removed-ID fallback work without parser edits. Navigation uses tabs through five groups and a localized selector above five; panel labels remain available in either mode.

Verification: **47 affected dashboard checks passed**, including a realistic anonymized RPC fixture, no-show acceptance/reopening across three date windows, future-ID restoration, capability isolation, registry validation and actual five/six-report navigation rendering in Thai/English. `pnpm typecheck`, documentation checker and `git diff --check` passed. `pnpm build` passed with the six existing lint warnings. Restart initially hit OneDrive EINVAL/readlink on generated output; the server recovered using the ignored `NEXT_DIST_DIR=next-local-cache-reconciliation` cache and runs at localhost:3000. Login, Dashboard and Configuration returned HTTP 200; all 20 referenced CSS/JavaScript asset responses returned HTTP 200. Existing authenticated administrator sessions rendered the reconciled August Waterfall and Configuration root after restart. The server remains running at localhost:3000.

Updated canonical Dashboard behavior, portal contract, Reporting owner map and this work item's plan/review; focused reconciliation artifacts link to those owners instead of duplicating their rules. Existing unrelated SQL/migration edits remain preserved. Changes remain local and unpushed.
