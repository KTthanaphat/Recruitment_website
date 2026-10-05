# Accepted implementation plan

2026-10-04 · Direct delivery · local changes only; no push.

Implement the supplied Vacancy Risk & Aging and Stage Bottlenecks references as subviews under the existing three dashboard report groups. The user's accepted detailed plan is preserved in this chat; maintained specifications are linked below to avoid duplicating rules across maps/work items.

## Accepted decisions

| Area | Decision |
| --- | --- |
| Navigation | Vacancy Overview/Risk; Pipeline Overview/Bottlenecks; existing reports remain |
| Styling | Dashboard-only light shell; More filters for outer Site/PIC/Priority |
| Snapshot | Selected end capped at Bangkok today; old open/waiting records included |
| Risk | Last seven days inclusive; unknown SLA separate, known-only exposure |
| Stage duration | Real passed/failed attempts, median/P90 with interpolated percentile |
| Primary | Highest stage median; queue/oldest/stage-order tie-break |
| History | Current authoritative event records and classifications; unrecoverable earlier deadlines unavailable |
| Actions | Existing details through authenticated hydration; limited read-only company details; no bulk selection |
| Trends | Real snapshots/buckets, up to eight points and explicit comparisons |
| Exports | Independent PNG and two-sheet Excel; all matching action rows in PNG |
| Database | No schema expected; necessary feature SQL reviewed/applied to mppnlkldlctvketcsald first; unrelated migrations excluded |

## Delivery sequence

1. Historical calendar/headcount/SLA and normalized stage contribution models.
2. Authenticated paginated inputs, atomic publication, retry, access-scoped cache and hydration.
3. URL/session subviews and local detail filters; Dashboard-only shell.
4. Responsive UI/drill-down, shared Export chooser, immutable PNG/XLSX snapshots.
5. [Canonical behavior](../../WEBSITE_STRUCTURE.md#risk-and-bottleneck-subviews), [design](../../design/dashboard-risk-bottlenecks.md), [export contract](../../design/dashboard-data-export.md#risk-and-bottleneck-workbooks), [owner map](../../maps/system/reporting.md#risk-and-bottleneck-subviews), task routing.
6. Calculation/workbook/browser regression, typecheck/build/docs/diff checks, current/historical read-only live reconciliation, authenticated localhost handoff.

## Acceptance

[Focused suite](../../../tests/e2e/dashboard-risk-bottlenecks.spec.ts) covers SLA/date/history, normalization/percentile/queue/deadlines, pagination and failures, two-sheet typed/literal ledgers, URL/history, collapsed export, localization/layout and keyboard interactions. Existing dashboard/export/detail/Configuration suites guard regressions. Final observed results belong in [review](review.md); live data checks and availability limits belong there rather than copied into contracts.

## Accepted compact-design refinement · 2026-10-04

Continue direct implementation locally: restore the system dark sidebar/canvas/profile accent; use 32px desktop controls across Dashboard with at least 44px phone/coarse-pointer targets. Compact both new views to system typography/panels while keeping every metric, trend and record context visible. Retain calculations, permissions, state and two-sheet workbooks. Exact geometry/responsive rules live in the updated [design](../../design/dashboard-risk-bottlenecks.md), [portal](../../design/dashboard-portal.md#compact-system-presentation) and [control contract](../../design/controls.md#fields-buttons-and-overlays). Add compact/theme/layout regression coverage, rerun affected suites/typecheck/build/docs/diff checks, compare authenticated screen/export totals with the prior evidence and restart the verified localhost preview. No SQL or push is expected.

## Accepted navigation/summary refinement — 2026-10-04

Direct delivery continues. The accepted refinement is recorded in [refinement](navigation-summary-refinement.md); current behavior/layout live in its linked canonical contracts. Earlier plans and acceptance evidence remain historical.

2026-10-05 Stage screen/export refinement and mobile shell: [accepted plan](../mobile-shell/plan.md). Current canonical contracts replace earlier screen-card descriptions; prior verification remains historical.
