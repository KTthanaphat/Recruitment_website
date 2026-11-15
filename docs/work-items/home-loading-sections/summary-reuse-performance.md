# Home 30-second summary reuse and candidate projection

2026-11-15. Implementation: `458a3a5` (main-based), staging equivalent `4d73cd0`.

Home now reuses same-tab aggregate summaries for at most 30 seconds while requesting fresh values. Keys include the Supabase project, user, role, site, profile update version, and all header filters. Invalidation blocks older in-flight requests from repopulating snapshots. Access denial clears snapshots. Urgent snapshots store a count and an empty item list, not candidate rows. Records still use their existing request/cache behavior. Render remains Free.

The invoker candidate report view now projects columns directly instead of rebuilding the entire candidate record through JSON for each field. The confidential group/document masking and ordinary-journey membership predicates are unchanged. The migration preserves the existing column order, invoker option, and ACLs. No RPC signature, RLS policy, timeout, or privilege changes.

## Evidence

- Final source production build and type checking passed. Existing repository lint warnings remain; the new snapshot timer also has an exhaustive-deps warning because its scope identity is a serialized dependency.
- 16 focused Home browser tests passed on the final local production build, including failed refresh/retry, access denial, filter changes, late responses, scheduling, calendar recovery, and cached reload. Three snapshot unit tests passed.
- 100 synthetic warm browser visits: median **209 ms**, p95 **282 ms**, maximum **329 ms** for core metrics and a visible default record together. Chromium, local production build, warm assets, mocked auth and records, five-second-old authorized snapshots seeded per visit, fresh core response delayed 2,500 ms. This tests presentation behavior only. It is not a real network, SQL, production, or first-visit p95. Local artifact: `outputs/home-snapshot-synthetic-p95.json`; harness: `outputs/home-cache-p95.spec.ts`.
- A disposable native PostgreSQL 17 database used all current declarative schemas, four synthetic roles, 1,132 applications, and confidential journey fixtures. One diagnostic sample per role measured the following (milliseconds; not p95):

| Role | Core before | Core after | Urgent before | Urgent after |
| --- | ---: | ---: | ---: | ---: |
| System administrator | 2233 | 1631 | 3728 | 2122 |
| Administrator recruiter | 2281 | 1626 | 3720 | 2374 |
| Site recruiter | 3803 | 2530 | 6249 | 4081 |
| Viewer | 2430 | 1682 | 3765 | 2287 |

- Site-recruiter `EXPLAIN (ANALYZE, BUFFERS)` after projection measured 2,231 ms execution. Remaining permission-aware joins are material. Plan contains synthetic identifiers only and is local: `outputs/core-projection-plan.json`.
- `node scripts/rehearse-home-metrics.cjs` passed full candidate-row, core-response, and urgent-response equality before/after/rollback for all four roles. Its normal fresh/upgrade metric, confidential journey, filter, paging and unauthorized-access checks also passed.
- Additional shared rehearsals did **not** pass: Welcome aborts at its pre-existing migration/canonical-function containment assertion (`rehearse-home-welcome-summaries.cjs:130`); dashboard aborts at its quality-precompute migration equality assertion (older public-table references versus current private report views). They do not reach behavioral execution and are not reported as passing.

## Advisors and rollout

Development migration `home_candidate_projection` applied successfully. Invoker mode, authenticated SELECT, denied anonymous SELECT, and historical column order were verified. Staging frontend deploy `dep-dbsl50dbedkc73cajtrg` is in progress as of this record; production has not received this change.

Development advisors still report [45 executable definer-function warnings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [two tables without RLS policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [35 unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), and [13 unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). This change adds no definer function, table, or index. These findings were not remediated by this performance change.

Rollback is backward compatible: deploy the preceding frontend, restore the preceding candidate-view definition using the reviewed SQL alongside this report, then verify role/response parity. The rehearsal performs and verifies that database rollback. Do not delete migration history or change access grants.

## Acceptance limits

The real production p95 below two seconds is **not established**. The user chose synthetic testing rather than a signed-in production session. The fresh site-recruiter core and urgent SQL observations still exceed two seconds. Summary reuse benefits visits with a valid snapshot; empty/expired snapshots and Render Free wake-ups remain outside that result. No production HR records or credentials were copied into artifacts.
