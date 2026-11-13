# Candidate Records and Detail loading review

Measurement date: 2026-11-13 UTC. Baseline application revision: `bcdeade` (develop); live production application before this change: `b725297` (main). Database: production PostgreSQL 17 in Singapore; a separate disposable PostgreSQL 17 synthetic fixture was used for repeated controlled comparisons. No candidate fields, search text, credentials, or user identifiers were recorded in this review.

## Production backend comparison

The measurement is the authenticated database execution time of the candidate registry RPC, not browser navigation time. Each cell contains 30 sequential samples. The request used a page size of seven, `updated_at desc`, and either the default `all` scope or the representative `active` scope. Each sample returned seven rows; before and after response fingerprints matched within each scenario. There were no measurement errors.

| Role | Scope | Before p50 | Before p95 | After p50 | After p95 | p95 improvement |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Site recruiter (KT1) | Default | 2,451.9 ms | 2,521.7 ms | 518.5 ms | 745.3 ms | 70.4% |
| System administrator | Default | 1,837.1 ms | 1,869.8 ms | 183.4 ms | 221.3 ms | 88.2% |
| Site recruiter (KT1) | Active | 2,331.2 ms | 2,425.5 ms | 375.9 ms | 454.6 ms | 81.3% |
| System administrator | Active | 1,804.2 ms | 2,107.1 ms | 136.9 ms | 176.1 ms | 91.6% |

These sequential measurements share the production environment but are not randomized paired samples. Normal workload and cache variation can affect the comparison. An authenticated browser session was unavailable, so cold navigation, warm return, queue time, profile readiness, and complete selected-application browser p95 are unverified. No claim is made that the page-level two-second target is met.

## Findings and change

The registry previously invoked the full candidate capabilities function before filtering and pagination, even though the list needs only candidate ID, creator label, and unmatched status. An individual site-recruiter call to the full capabilities function took approximately 2.34 seconds during diagnosis. The new internal projection returns only these three existing fields for candidates allowed by the existing `can_read_candidate` helper. The public list RPC remains `SECURITY INVOKER`; the helper is in the unexposed `app_private` schema, uses an empty search path, checks the signed-in identity, and denies anonymous execute. It retains the privileged lookups required to preserve the original creator-label and unmatched semantics. No RLS policy, authorization helper, list contract, count, sort, or filter was changed.

The candidate-detail loader now shares an access-scoped profile and complete application-choice read between the early shell and full hydration. It fetches each first page concurrently with its exact count, preserving completeness checks. The shell does not expose a note as empty while it is pending, and edits, application changes, and deletion remain disabled while the selected data is loading or failed. Selected-application sections still finish together; they have not been split into independent section-level requests or retry states.

## Verification

- Native synthetic fixture with more than 1,100 candidates and shared-site groups, deployed policies and relevant authorization helpers: 29 registry parity cases each for administrator, site recruiter and viewer, including supported sort directions, counts, filters, selected IDs, and cursor pages; the new projection also matched the existing capability fields. Null-identity results were empty and anonymous helper execution was denied.
- Thirty sequential alternating synthetic default-list pairs: administrator p95 1,585.7 to 178.3 ms; site recruiter p95 3,633.0 to 400.3 ms. This fixture is not a production guarantee.
- The exact forward and rollback SQL were rehearsed on the disposable database; role results matched after each and helper grants and restoration were checked. Security advisor findings were unchanged after production migration.
- TypeScript type checking, the Home loading contract rehearsal, three focused synthetic staged-detail tests, and 26 mocked Candidate Detail browser tests passed. Four focused browser tests passed again after strengthening refresh guards.
- Full production browser timing, full selected-application section independence, complete masked/shared-site and mutation-refresh matrices, and repeated filtered synthetic timing remain to be verified. The fixture checks do not exhaust every possible access arrangement.

## Migration and restoration

Production migration `20261113002924_candidate_registry_projection` was applied. Its guard rejects an unexpected prior list definition or an existing helper. If rollback is required, first confirm no later migration has changed `public.app_recruitment_list_v1`, then apply the reviewed restoration SQL in `candidate-registry-rollback.sql` as a new migration. It restores the previous function body before dropping the private projection. Verify the public function body hash is `a04d8302b96cabd19a36250b125878ad`, anonymous access remains denied, and the helper is absent. The older frontend remains compatible with either database definition.
