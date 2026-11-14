# Candidate lookup and confidential recruitment

Active checkout: KT `recruitment_website`. Delivery mode: direct. No push or app deployment.

## Database rollout

Applied to `mppnlkldlctvketcsald` after disposable PostgreSQL verification:

- `20261113144528_candidate_contact_lookup.sql`
- `20261113151831_confidential_requisitions.sql`
- `20261113152535_confidential_report_summaries.sql`
- `20261113153425_admin_unlinked_groups.sql`
- `20261113154506_candidate_lookup_application_groups.sql`
- `20261113155227_contact_lookup_index_branches.sql`

The CLI-generated local files are aligned to the connected migration versions. Existing requisitions/groups default to ordinary. No real HR records were classified as secret by this delivery. The follow-up summaries migration filters sourcing aggregates and retains existing ordinary profile anchors without inventing an application owner.

## Evidence

- `node scripts/rehearse-profile-contract.cjs --contact-lookup --confidentiality`: passed. Actual RLS in disposable PostgreSQL; contact normalization/paging, role visibility, secret tables/lists/destinations, mixed links, transfer rejection, persistent unlinked groups and reveal. Ordinary-only outputs match the pre-upgrade baseline across Home, calendar, performance, pipeline, risk, bottlenecks, active requisitions, rejection, filter options and sourcing. Adding secret stages/hires does not change report totals.
- `node scripts/rehearse-confidentiality-fresh.cjs`: passed. Canonical install and secret creation; extension installation/cron delivery are stubbed in the WASM fixture. Corrected the pre-existing fresh-schema duplicate offers constraint name, optional legacy grants, and missing requisition-receipt schema ordering.
- Seventeen focused browser scenarios passed in the consolidated final run (25.6 seconds). TypeScript and documentation validation passed. Desktop and 360px Thai phone screenshots were visually inspected. Synthetic browser mocks establish UI behavior, not RLS.
- Connected metadata verifies non-null ordinary defaults, security-invoker report views, invoker lookup/link-review RPCs and no anonymous execution on new endpoints. Phone EXPLAIN uses `candidates_lookup_phone_idx`; a generic-plan probe retains separate one-time phone/email branches. Application stage reads reuse the existing application/stage index. These plan observations are not end-to-end latency measurements.
- Security advisor comparison: two new authenticated SECURITY DEFINER notices correspond to the admin-only reveal RPCs. Explicit actor checks, confirmations, stale-write guards and trigger invariants are tested; direct table update grants are not broadened. [Supabase advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Existing private-ledger/counter no-policy notices remain unchanged.

## Limits and measurement

Real end-to-end p95 is **unverified** without representative authenticated benchmark accounts/contact samples. `node scripts/measure-candidate-lookup.cjs` writes this status to `outputs/candidate-lookup/performance.json` when unconfigured. With `LOOKUP_BENCHMARK_CONFIG`, supply a private JSON file containing local `baseURL`, `networkDescription`, and `accounts` entries with `role`, Playwright `storageState` path and `contacts`. The script performs six warm-up requests then 100 uncached requests per role and writes only aggregate timings/errors. Do not commit its input files.

The classification/link transaction lock and trigger invariants are exercised in disposable PostgreSQL. Real concurrent-write stress against HR records was not performed; the connected SQL tool did not establish independent overlapping sessions for a read-only lock probe. No production latency or concurrency guarantee is inferred from synthetic checks.

Local preview: `http://localhost:3100`; the responding process is the KT checkout on port 3100. It uses the configured `mppnlkldlctvketcsald` database; preview saves affect that project. No push/deployment was performed.
