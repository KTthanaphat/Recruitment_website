# Dashboard requisition timeout correction

15 November 2026. Follow-up to the deployed custom-period/export repair. The user reported that Dashboard → Vacancy & Requisitions still failed to load.

## Confirmed cause

Production PostgreSQL logs contain SQLSTATE 57014 (`canceling statement due to statement timeout`) in `app_dashboard_active_requisitions_page_v1`, with stack frames in `can_read_application`, `secret_application_access` and `secret_admin`. Five matching failures were observed between 19:56 and 20:09 Bangkok. Only timestamps, error category and function-stack names were inspected; no HR rows, filter values or request bodies were copied.

The preceding hosted browser checks intercepted the RPC with synthetic responses and could not detect this database failure. The small custom-date SQL fixture verified results but did not expose the expensive plan.

## Repair

The stage-count join now uses a lateral history lookup with application and candidate predicates inside an `OFFSET 0` planner boundary. It keeps unrelated history rows from reaching repeated RLS/helper evaluation for each requisition on the page. All current report views, authorization checks, stage/date predicates, response fields, exact totals and cursor semantics remain unchanged. No timeout increase, automatic retries, privilege change, frontend change or new index is included.

Native PostgreSQL 17.9 `EXPLAIN (ANALYZE, BUFFERS)` on a disposable synthetic dataset (1,133 requisitions/applications) showed the original history scan producing 1,133 rows per loop over 26 loops. The bounded scan produces one row per loop over 26 loops. The small fixture still uses sequential scans; the measured gain comes from filtering before expensive access checks, not an added index. The single analyzed query fell from 2,525 ms to 241 ms.

## Verification

- `node scripts/rehearse-dashboard-active-page.cjs`: 96 full-result before/after comparisons passed across all four roles, Status/Activity/Accum, shared groups, confidential journeys, header scope, table filters, search, metric and text sorting, and all cursor pages. Anonymous and missing-auth denial and rollback/reapply also passed. Completed-stage fixtures retain required outcome timestamps and database constraints.
- `node scripts/rehearse-vacancy-custom-range.cjs`: passed again with the corrected query.
- Native full-schema synthetic default-page results matched the original response exactly for every role and each of 20 optimized reads per role. Original single observations were 3.18 seconds for admin recruiter, 9.94 seconds for site recruiter, 4.73 seconds for system admin and 5.00 seconds for viewer. All 80 optimized reads completed below 0.8 seconds. Local concurrent fixture activity affected the timings; these observations are diagnostic SQL measurements, not production end-to-end p95.
- Exact installed pre-fix function hash matched the tested baseline in staging and production (`0e988eb98ead4781423d8756f4635914`). Staging migration body equality and invoker/stable/empty-search-path settings were verified; anonymous execute remains denied and authenticated execute retained.
- The frontend is unchanged, so the earlier type/build/browser checks are unaffected; synthetic browser responses are not counted as verification of this SQL repair.

Declarative owner: `supabase/schemas/61_dashboard_summaries.sql`. CLI-generated forward migration: `20261115131614_dashboard_active_page_history_lookup.sql`. The rehearsal generates `outputs/dashboard-active-page-rollback.sql` and verifies restoring/reapplying the previous function. No table or data mutation is part of the migration.

## Rollout

Staging and production migrations applied and verified on 15 November, with production complete by 20:22 Bangkok. Both installed function bodies exactly match the reviewed migration, retain stable invoker execution with the empty search path, deny anonymous execution and allow authenticated execution. Staging source is `d9caaec`; production source is `41abb2c`. This SQL-only release uses `[skip render]` commits to avoid restarting the unchanged frontend. Existing security/performance advisor categories and counts were unchanged; remediation links remain in the parent [verification record](verification.md). No authenticated production user session was available, so real-user list recovery remains to be confirmed after refresh/manual retry; synthetic SQL observations are not presented as production latency.
