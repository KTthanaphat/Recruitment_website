# Live dashboard reconciliation — 2026-10-04

Project: `mppnlkldlctvketcsald`. Read-only SQL aggregates were compared with the existing authenticated administrator's rendered localhost dashboard. No live writes or schema/migration changes were performed. No candidate identities or contact details are retained in these artifacts.

## Results

**12 scenarios, 440 comparisons, zero differences after repairs.** Checks cover Performance vacancies/fills, rounded average time to fill, SLA totals, site/level matrix cells, New/Replacement composition; Waterfall opening/opened/filled/closing and requisition counts; Pipeline stage counts and Source per-channel Applicants/Phone/Hired. These are snapshot comparisons, not continuous reconciliation.

| Scenario | Performance vacancies/fills | Waterfall opening + opened − accepted = closing | Source applicants/phone/hired |
| --- | --- | --- | --- |
| aug-department | 3/1 | 2 + 1 − 1 = 2 | 0/2/1 |
| aug-facebook | 13/4 | 6 + 8 − 5 = 9 | 20/2/2 |
| aug-hq | 9/1 | 4 + 6 − 2 = 8 | 30/3/2 |
| aug-level | 2/2 | 1 + 1 − 2 = 0 | 0/2/2 |
| aug-mtd | 10/4 | 3 + 8 − 5 = 6 | 30/8/5 |
| aug-pic | 4/2 | 2 + 3 − 3 = 2 | 30/3/3 |
| aug-pim | 13/4 | 6 + 8 − 5 = 9 | 30/8/5 |
| aug-priority | 1/0 | 0 + 1 − 0 = 1 | 0/0/0 |
| aug-ytd | 13/5 | 0 + 14 − 6 = 8 | 30/12/6 |
| jul-pim | 7/1 | 3 + 4 − 1 = 6 | 0/5/1 |
| oct-mtd | 0/0 | 0 + 0 − 0 = 0 | 0/0/0 |
| sep-pim | 9/0 | 9 + 0 − 0 = 9 | 117/2/0 |

## Repairs and definitions

1. Company-report offers deliberately anonymize candidate IDs. Source joins now consume the authorized operational offers already loaded for the signed-in user and apply the report's requisition scope. Company aggregate coverage stays unchanged. The synthetic RPC fixture now mirrors anonymization so future regressions cannot silently rely on candidate IDs in that feed.
2. The user approved both no-show movements: acceptance reduces vacancies and its later reopening increases vacancies. August's previous closing 10 becomes 9. Performance still reports four effective fills; Waterfall records five acceptances; Source retains five historical accepted candidates. These measures have different definitions.

Independent stage activity can exceed the preceding stage and sourcing totals: weekly Applicants are a different grain from dated candidate activity. Existing group-linked sourcing attribution is preserved.

## Reproducible evidence

- [Read-only reconciliation SQL](reconciliation.sql)
- [Expected database aggregates](evidence/live-reconciliation-expected.json)
- [Rendered browser observations](evidence/live-reconciliation-observed.json)
- [Comparison results](evidence/live-reconciliation-comparison.json)
- [Authenticated Waterfall preview](evidence/live-waterfall-reconciled.png)
- [Synthetic movement and report regression coverage](../../../tests/e2e/dashboard-reports.spec.ts)
- [Future registry/navigation checks](../../../tests/e2e/dashboard-registry.spec.ts)

## Boundaries

The live sample covers July/August/September PIM, August MTD/YTD, October current-month MTD, HQ, a department within HQ, L4–L6, PIC, Priority and Facebook. It uses one authenticated administrator; it does not prove every role's live permissions, arbitrary future datasets or every possible multi-headcount lifecycle. Existing synthetic coverage remains responsible for historical edge cases, date boundaries, exports and failures. Future navigation uses synthetic five/six-report render checks plus existing shared-selector interaction and portal keyboard tests; no new report was exposed in the production catalog.
