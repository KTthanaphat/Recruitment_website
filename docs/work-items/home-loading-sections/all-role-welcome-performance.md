# Home and Welcome loading follow-up

2026-11-15. Supported application roles: system_admin, admin_recruiter, site_recruiter, viewer.

## Changes and release

The production frontend was still on 1044fb9 at investigation start. The previously tested direct candidate projection and 30-second scoped Home snapshots were promoted to production as 458a3a5; Render deploy dep-dbsogbu7bikc73f9ul5g became live at 10:27:17 UTC. The reviewed home_candidate_projection migration was applied first. Post-migration verification confirmed invoker mode, authenticated SELECT, anonymous denial, and direct projection. No production candidate rows were copied or changed.

Welcome had an additional scheduling delay: it waited for banner and calendar completion. It now starts after core metrics and default records settle, uses the existing two-request scheduler, and skips queued work after dismissal. Same-tab Welcome snapshots contain aggregates only, expire after 30 seconds, and include access identity and Bangkok date. Access denial clears cached aggregates. Header filters retain their existing independent Welcome semantics.

Welcome frontend source dc0dfd3 became live on staging in dep-dbsogb5bedkc73cdk6v0 at 10:27:36 UTC. HTTP and JavaScript verification confirmed the new Welcome snapshot bundle. The equivalent production commit is 110e7c4; deploy dep-dbsoj295efls73f04ubg became live at 10:33:02 UTC (17:33 Bangkok). The final production HTML and all referenced JavaScript assets returned successfully, including the Welcome snapshot code. A transitional asset 404 observed before the rollout finished did not reproduce in final verification.

## Verification

- Type checking and production build passed; existing unrelated lint warnings remain.
- All four roles passed calendar-independent Welcome and cached-refresh browser tests (eight cases). Expired-cache and access-denial cases also passed.
- Four aggregate-summary tests passed, including complete-model parity, loading, manual retry and banner filtering. Seven urgent-recovery tests passed. Five Home loading tests passed after updating the dismissal assertion and closing the unrelated contact-lookup overlay before paging.
- Three snapshot unit tests passed. The full-schema Home metric rehearsal passed before/after/rollback candidate-row, core and urgent parity across all four roles, confidential journeys, paging, filters and unauthorized access. Loading contracts passed after updating their fake PostgREST builder to support abortSignal; no production code was changed for that fixture repair.
- The previously reported historical migration assertions in the separate Welcome/dashboard rehearsals remain unresolved. They are not passing checks.

## Synthetic browser observations

Local production build with repeated navigations (Playwright API routing disables HTTP cache), mocked auth and records, five-second-old authorized snapshots seeded each navigation, core/Welcome refresh delayed 2,500 ms. Each observation waits for core counts, a visible default record and Welcome content together. One hundred observations per role:

| Role | Median ms | p95 ms | Maximum ms |
| --- | ---: | ---: | ---: |
| system_admin | 195 | 278 | 369 |
| admin_recruiter | 200 | 342 | 401 |
| site_recruiter | 240 | 279 | 330 |
| viewer | 265 | 349 | 393 |

These are presentation measurements with valid snapshots. They exclude real auth/RPC latency, cold browser assets and Render wake-ups. A final Bangkok-date memo-key refinement was checked by all-role behavior tests; the source deployed to staging includes that refinement. The production-hosted results below measure the deployed Bangkok-date refinement. Local timing files and harness are under outputs/home-welcome-*-p95.json and outputs/home-cache-p95.spec.ts.

## Rejected SQL experiments and remaining target gap

Disposable PostgreSQL 17 experiments refreshed synthetic statistics and matched production's JIT-off setting. None was applied outside the disposable database. A set-based permission-helper rewrite improved some roles but substantially regressed site-recruiter queries, so it was rejected. Combining urgent latest-activity reads improved administrator/site samples but did not improve viewer samples consistently. Reusing Welcome responsibility rows and avoiding duplicate checks already enforced by authenticated RLS also failed to bring fresh core reads below two seconds for every role. These variants remain local diagnostics only; authorization helpers, RLS policies, RPC signatures and timeouts are unchanged in this release.

Fresh site-recruiter core observations remained above three seconds in the larger synthetic fixture. Consequently **p95 below two seconds for all fresh production visits is not established or achieved by the evidence here**. The user selected synthetic testing rather than a signed-in production session. Render remains Free; after-idle wake-ups are a separate limitation. No shared aggregates or longer cache lifetime were introduced.

## Advisors and rollback

Production advisors before migration reported the same categories as development: [45 executable definer warnings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [two no-policy tables](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [35 unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) and [nine unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). No table, index or definer function was added.

Frontend rollback may use 458a3a5 to remove only the Welcome follow-up, or 1044fb9 to remove snapshot reuse as well. Both remain compatible with the projection migration. If required, the previously rehearsed rollback-candidate-projection.sql restores the prior view without changing grants or migration history.

## Final production-hosted synthetic check

All four roles completed 100 observations each against the live production HTML and assets, with browser-side auth/records/API fixtures, five-second-old authorized snapshots seeded before each navigation, and 2,500 ms delayed core/Welcome refresh responses. Each observation waits for core counts, a visible default record, and Welcome content. Requests run sequentially in Chromium. Browser API routing disables HTTP cache, so repeated asset transfers are included. Diagnostic SQL work also ran locally during part of the measurement; this was not an isolated hardware benchmark.

| Role | Median ms | p95 ms | Maximum ms |
| --- | ---: | ---: | ---: |
| system_admin | 1450 | 1921 | 5691 |
| admin_recruiter | 1385 | 1676 | 2091 |
| site_recruiter | 1369 | 1884 | 2209 |
| viewer | 1377 | 1922 | 2039 |

The observed cached synthetic p95 is below two seconds for each supported role. This is not a real signed-in, fresh-query or whole-page/LCP p95. It does not include real Supabase auth/RPC latency, calendar completion, or Render wake-up after idle. There were no Home RPC observations returned by the post-release aggregate log query for 10:33:03–10:41:00 UTC, so no fresh production p95 or error-rate conclusion is drawn from that window. Final Supabase advisor categories/counts were unchanged after migration.

Reproducible local artifacts: outputs/home-production-cache-p95.spec.ts, outputs/home-prod-perf.config.ts and outputs/home-welcome-production-hosted-*-p95.json. The test passed all four 100-observation cases in 9.4 minutes. Percentiles use the nearest-rank 95th observation of 100.

A final disposable set-based RLS evaluation experiment preserved the fixture's visible application/log rows and three Home responses across four roles, but did not achieve the required fresh latency improvement. No RLS-policy change from that experiment was kept or deployed. All experiment transactions rolled back and the disposable PostgreSQL server was stopped.
