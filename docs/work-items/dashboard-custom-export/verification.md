# Dashboard custom period and requisition exports

Verified locally on 15 November 2026. Reporting week used: 7–13 November, the app's completed Saturday–Friday week. The user subsequently authorized deployment; completed rollout is recorded below.

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

Prepared migration: `supabase/migrations/20261115122106_dashboard_custom_range_history.sql`, generated with Supabase CLI and populated from the declarative function and existing ACL block. Applied first to staging, then production after the hosted staging checks passed. It preserves the current RPC signature and is compatible with the deployed frontend. Frontend corrections are also backward compatible.

The disposable rehearsal generates `outputs/dashboard-custom-history-rollback.sql`, restores the prior function to reproduce the omission, then reapplies the migration. Rollback replaces only this function and its existing grants; no data or table structure changes. A frontend rollback can use the prior build independently. Production deployment was authorized by the user and completed as recorded below.

## Completed rollout — 15 November 2026

- Staging migration applied and its complete function body verified against the reviewed migration. Existing stable/definer mode, empty search path, denied anonymous execution and authenticated execution were preserved.
- Staging commit `9837dcf8b09257b9c6c6efcb23bbeda60cb6cf54`, Render deploy `dep-dbsqf9p5efls73f203ag`, live at 19:41:56 Bangkok. All six hosted export browser checks passed with synthetic API fixtures; Dashboard and 11 initial JavaScript assets returned HTTP 200.
- Production compatible migration applied before frontend promotion; complete function-body equality and security settings verified again.
- Production commit `d006add64d2ca9052cfc30761df6c18a1d1ca45c`, Render deploy `dep-dbsqhvajnfac73ciitjg`, live at 19:47:30 Bangkok. All six production-hosted export browser checks passed. Dashboard and 11 initial JavaScript assets returned HTTP 200; the served bundle contains the Excel preparation label. No error-level runtime logs appeared in the initial checked post-deploy window.
- Hosted checks use synthetic API responses. They verify the deployed client, actual workbook/PNG downloads, pagination, retry, sort cycling, reversed dates and stale-scope cancellation; they do not establish production-data parity or latency. No HR records were exported or changed by these checks. Both Render services remain on Free.
- Security/performance advisor categories and counts were unchanged in both environments. Existing notices remain: [RLS enabled without policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [authenticated definer execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), and [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). No unrelated advisor remediation was applied during release.
