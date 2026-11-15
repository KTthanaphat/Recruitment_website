# Home urgent recovery and query investigation

## Production diagnostics

Read-only production logs for 2026-11-14 UTC showed two urgent RPC responses with HTTP 500 at 17:36:32 and 18:33:58, with reported upstream durations of 8,515 ms and 12,882 ms. Postgres logged SQLSTATE 57014, statement timeout, in app_home_work_queue_v1 at 17:36:40 and 18:34:10 UTC respectively. Timing and function context are consistent with the observed failures; a shared trace identifier was not established. Logs were queried for aggregate status, duration and error classification only; no request bodies, filter values, identities or candidate records were saved.

## Disposable PostgreSQL investigation

A copied local PostgreSQL 17 fixture contained 1,227 synthetic requisitions and 1,132 synthetic applications. The current report-view and Home function definitions were installed, and synthetic stage rows were added, for 3,394 log rows. The fixture started from older authorization definitions and does not establish current production RLS or representative distribution. Data was not copied from production. Triggers were disabled only inside the disposable fixture insertion transaction and restored before profiling.

A bounded filtered test returned 83 ms core and 277 ms urgent, but later plan inspection showed that filter matched no requisitions; these numbers are not representative. Unfiltered administrator EXPLAIN ANALYZE measured 2,495 ms core and 4,923 ms urgent. Both unfiltered queries exceeded a five-second limit under the site-recruiter fixture. PostgreSQL plans are stored in the local-only benchmark output directory. These are diagnostic observations, not production latency or a p95.

A local, rolled-back candidate rewrite combined three repeated latest-activity scalar lookups into one lateral read. One administrator comparison measured 5,092 ms original and 3,765 ms candidate, with exact response equality; a later comparison measured 4,888 ms and 3,829 ms, also equal. Both original and candidate timed out after 15 seconds for the unfiltered site-recruiter case. The older fixture and incomplete role, confidentiality, filter and tie coverage prevent accepting the SQL rewrite or claiming a fix. No declarative SQL, migration, timeout, privilege, or deployed database was changed.

## Recovery change

Urgent failure keeps a previous count only for the current access and filter scope, labels it as stale, and offers manual retry. An initial failure or explicit access denial clears the value. Scope changes discard retained state; canceled requests cannot overwrite a later scope. The work queue loader recognizes access-denial status and codes; failures retain error handling independently from core metrics.

## Verification and limitations

- Five synthetic browser tests cover initial failure/retry, stale refresh/retry, 403 access denial, site change, and late previous-scope response. The combined focused Home recovery, candidate pipeline and work-metric suites passed all 17 tests. TypeScript checking and the isolated production build passed.
- `node scripts/rehearse-home-loading-contracts.cjs` passed its current scope/cache and reference fixture checks. `node scripts/rehearse-home-metrics.cjs` passed its fresh and forward migration checks for all four roles, confidential journey exclusion, exact counts, and pagination. These do not benchmark the two Home summary RPCs.
- The focused Home suites cover core/urgent behavior, scheduling and drilldowns. Browser mocks do not establish production RLS or SQL correctness.
- No 100-sample staging comparison, current-RLS database matrix, SQL migration/rollback rehearsal, or production release has been completed. A representative test dataset and current authorization fixture are needed before further SQL changes can be safely accepted.
