# Home and Welcome loading follow-up

2026-11-15. Supported application roles: system_admin, admin_recruiter, site_recruiter, viewer.

## Changes and release

The production frontend was still on 1044fb9 at investigation start. The previously tested direct candidate projection and 30-second scoped Home snapshots were promoted to production as 458a3a5; Render deploy dep-dbsogbu7bikc73f9ul5g became live at 10:27:17 UTC. The reviewed home_candidate_projection migration was applied first. Post-migration verification confirmed invoker mode, authenticated SELECT, anonymous denial, and direct projection. No production candidate rows were copied or changed.

Welcome had an additional scheduling delay: it waited for banner and calendar completion. It now starts after core metrics and default records settle, uses the existing two-request scheduler, and skips queued work after dismissal. Same-tab Welcome snapshots contain aggregates only, expire after 30 seconds, and include access identity and Bangkok date. Access denial clears cached aggregates. Header filters retain their existing independent Welcome semantics.

Welcome frontend source dc0dfd3 became live on staging in dep-dbsogb5bedkc73cdk6v0 at 10:27:36 UTC. HTTP and JavaScript verification confirmed the new Welcome snapshot bundle. Production promotion is the next release step.

## Verification

- Type checking and production build passed; existing unrelated lint warnings remain.
- All four roles passed calendar-independent Welcome and cached-refresh browser tests (eight cases). Expired-cache and access-denial cases also passed.
- Four aggregate-summary tests passed, including complete-model parity, loading, manual retry and banner filtering. Seven urgent-recovery tests passed. Five Home loading tests passed after updating the dismissal assertion and closing the unrelated contact-lookup overlay before paging.
- Three snapshot unit tests passed. The full-schema Home metric rehearsal passed before/after/rollback candidate-row, core and urgent parity across all four roles, confidential journeys, paging, filters and unauthorized access. Loading contracts passed after updating their fake PostgREST builder to support abortSignal; no production code was changed for that fixture repair.
- The previously reported historical migration assertions in the separate Welcome/dashboard rehearsals remain unresolved. They are not passing checks.

## Synthetic browser observations

Local production build with warm assets, mocked auth and records, five-second-old authorized snapshots seeded each navigation, core/Welcome refresh delayed 2,500 ms. Each observation waits for core counts, a visible default record and Welcome content together. One hundred observations per role:

| Role | Median ms | p95 ms | Maximum ms |
| --- | ---: | ---: | ---: |
| system_admin | 195 | 278 | 369 |
| admin_recruiter | 200 | 342 | 401 |
| site_recruiter | 240 | 279 | 330 |
| viewer | 265 | 349 | 393 |

These are presentation measurements with valid snapshots. They exclude real auth/RPC latency, cold browser assets and Render wake-ups. A final Bangkok-date memo-key refinement was checked by all-role behavior tests; the source deployed to staging includes that refinement. Production-hosted synthetic measurements are pending the final Welcome promotion. Local timing files and harness are under outputs/home-welcome-*-p95.json and outputs/home-cache-p95.spec.ts.

## Rejected SQL experiments and remaining target gap

Disposable PostgreSQL 17 experiments refreshed synthetic statistics and matched production's JIT-off setting. None was applied outside the disposable database. A set-based permission-helper rewrite improved some roles but substantially regressed site-recruiter queries, so it was rejected. Combining urgent latest-activity reads improved administrator/site samples but did not improve viewer samples consistently. Reusing Welcome responsibility rows and avoiding duplicate checks already enforced by authenticated RLS also failed to bring fresh core reads below two seconds for every role. These variants remain local diagnostics only; authorization helpers, RLS policies, RPC signatures and timeouts are unchanged in this release.

Fresh site-recruiter core observations remained above three seconds in the larger synthetic fixture. Consequently **p95 below two seconds for all fresh production visits is not established or achieved by the evidence here**. The user selected synthetic testing rather than a signed-in production session. Render remains Free; after-idle wake-ups are a separate limitation. No shared aggregates or longer cache lifetime were introduced.

## Advisors and rollback

Production advisors before migration reported the same categories as development: [45 executable definer warnings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [two no-policy tables](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [35 unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) and [nine unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). No table, index or definer function was added.

Frontend rollback may use 458a3a5 to remove only the Welcome follow-up, or 1044fb9 to remove snapshot reuse as well. Both remain compatible with the projection migration. If required, the previously rehearsed rollback-candidate-projection.sql restores the prior view without changing grants or migration history.
