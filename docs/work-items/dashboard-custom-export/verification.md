# Dashboard custom period and requisition exports

Verified locally on 15 November 2026. Reporting week used: 7–13 November, the app's completed Saturday–Friday week. No production frontend or database changes were deployed for this task.

## Findings and repairs

- XLSX used the PNG preparation/error messages. English and Thai now identify Excel; PNG retains its own messages. Busy dialog controls are disabled, with failures shown inside the dialog for manual retry.
- Complete requisition export assumed ascending cursor values. Descending orders and database collation can violate that assumption. Export now detects repeated cursors/IDs and mismatched totals without comparing strings lexically. Each attempt reads fresh pages; retries do not reuse an incomplete cached export.
- Shared table sorting changed state inside another state updater. React development checks could toggle it twice. The event handler now updates the two state values directly. Criteria callbacks remain connected while the report refreshes.
- Historical Waterfall membership incorrectly excluded currently cancelled requisitions whose first log occurred after the selected period. It now matches the Active Requisitions historical fallback: cancellation after the period does not erase the earlier opening; cancellation by period end still excludes the row. Existing security mode, access guard, grants and confidential-report views are unchanged.
- Date/filter/access/refresh changes and unmount block obsolete requisition downloads. Export is disabled while draft criteria settle.

Production aggregate-only diagnostic found zero potential future-cancellation omissions for 7–13 November. Thus the SQL defect is reproduced with synthetic fixtures but is not established as the cause of the user's reported production discrepancy. No candidate data was retrieved. No signed-in production browser comparison was performed.

## Verification

- TypeScript check: passed.
- Production build: passed, with existing hook-dependency and optional sharp warnings.
- Focused development browser suite: 6 passed.
- Production-build browser suite: 8 passed, including the two existing Bangkok/reporting-week date checks.
- Downloaded XLSX parsed with ExcelJS: 55 unique rows over three pages, descending order, selected dates and metadata verified.
- Real PNG download, format-specific progress, incomplete-export error/fresh retry, invalid dates, scope change during export and complete sort cycle: passed.
- `node scripts/rehearse-vacancy-custom-range.cjs`: passed against disposable full-schema PGlite. Covers all four allowed roles, anonymous denial, inclusive PR/offer/filled boundaries, one-day and reversed ranges, missing PR dates, historical cancellation, confidential exclusions, migration rollback/reapply. Fixtures and auth stubs are synthetic; this is not production-data parity.
- `node scripts/rehearse-dashboard-summaries.cjs`: failed before behavioral tests at its pre-existing `quality precompute migration matches the declarative function and ACL block` assertion. The old migration references public tables; current schema uses confidential-report views. This was not counted as a pass and the unrelated fixture was not weakened.

## Release and rollback

Prepared migration: `supabase/migrations/20261115122106_dashboard_custom_range_history.sql`, generated with Supabase CLI and populated from the declarative function and existing ACL block. Apply through the staging/review workflow before production approval. It preserves the current RPC signature and is compatible with the deployed frontend. Frontend corrections are also backward compatible.

The disposable rehearsal generates `outputs/dashboard-custom-history-rollback.sql`, restores the prior function to reproduce the omission, then reapplies the migration. Rollback replaces only this function and its existing grants; no data or table structure changes. A frontend rollback can use the prior build independently. Production deployment remains pending authorization.
