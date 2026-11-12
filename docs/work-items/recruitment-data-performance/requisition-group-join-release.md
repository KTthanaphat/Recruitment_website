# Requisition Records candidate-count performance

Production migration `20261112165351_requisition_group_join` replaces two correlated array comparisons with a lateral indexed group join. The authorized document-group array is distinct; candidate counts still use `count(distinct ...)`, existing explicit access predicates, invoker security, RLS, ordering, filters and cursor logic. No data, policy, index, timeout or frontend behavior was changed. The migration rejects unexpected prior function source; the adjacent rollback SQL contains the original function definition and must be reconciled with any subsequent function changes before use.

## Production backend measurements

Single sequential 25-row, default-sort, unfiltered list reads using the same representative authenticated identities; 30 successful samples per role and version, p50/p95 use nearest rank. Database function execution timing only; not browser navigation or API network time.

| Role | Before p50 / p95 | After p50 / p95 | Output parity |
| --- | --- | --- | --- |
| KT1 site recruiter | 3487.7 / 4146.2 ms | 169.3 / 180.9 ms | All measured response digests matched |
| System administrator | 676.7 / 943.5 ms | 46.4 / 54.4 ms | All measured response digests matched |

The after series paused once after an unexpected tool response at administrator sample 8; the detailed response was not retained. A follow-up read returned the baseline digest, the project health advisor had no findings, and the resumed series completed 30 successful samples. This event is not proof of an application HTTP error; it is a measurement limitation.

## Validation and limits

- Native PostgreSQL 17 synthetic production-upgrade fixture: 1,132 profiles and shared-site cases. The exact deployed function source and production role helpers were installed transaction-locally; the one differing position-group read policy was aligned inside the rolled-back test transaction. All 58 generated page/count/sort/filter/cursor cases returned identical complete JSON for administrator, site recruiter, and viewer. Anonymous execution was denied for original and variant.
- With matched production helpers and policies, 30 paired native synthetic reads per role preserved complete results and improved site-recruiter p95 from 1301.1 to 84.3 ms; administrator from 226.8 to 39.6 ms; viewer from 218.2 to 32.6 ms. Synthetic data and execution conditions differ from production.
- Production function remains `SECURITY INVOKER`; anonymous execution is denied and authenticated execution allowed. The health advisor reported no findings immediately after deployment. No authenticated browser was available, so the first-visible-row p95 and two-second page target remain unverified.
- The existing `tests/db/recruitment-application-list.cjs` fails an unrelated pre-existing assertion comparing historical migrations with the newer declarative schema; it was not weakened. The native parity checks above do not establish every possible sort/filter or future policy behavior.
