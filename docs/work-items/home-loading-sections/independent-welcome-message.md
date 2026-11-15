# Independent daily Welcome message

2026-11-15. Fix for the daily Welcome message remaining in its loading state after Today's Work was ready.

## Cause and behavior

The message was rendered only when the complete Welcome DTO arrived. That DTO scans candidate applications and stage history as well as calculating the monthly fill ratio. Earlier request scheduling and 30-second snapshots did not remove that dependency on a fresh visit.

An additive invoker RPC, app_home_welcome_message_v1(), now computes only filledThisMonth, responsibleVacancyTotal, filledResponsibleVacancyRatio and filledResponsibleVacancyBucket. It uses the same responsibility, PIM eligibility, offer visibility, confidential exclusions and Bangkok month/day rules as the full RPC. It adds no table, privilege escalation, definer function, shared aggregate, timeout increase or automatic retry. The legacy/full RPC remains unchanged.

The visible popup requests this small message projection with foreground priority as soon as the authorized profile is ready. The daily CSV message and monthly ratio can render while the four count cards remain loading. Message and counts have separate errors and manual retry. Close and View Pipeline stay available. Both responses remain isolated by access identity and the existing 30-second snapshot/date rules. A denial invalidates summary caches and prevents older in-flight Welcome responses from restoring data.

## Verification

- Type checking and production build passed (existing unrelated lint warnings remain).
- 31 focused Home/Welcome/urgent browser cases passed, plus the added late-full-response denial case. Tests hold the full summary unresolved and verify the correct ratio/message appears for all four roles; initial loading, retry, expiry, denial, calendar independence and scoped Home behavior are covered.
- The full-schema Home rehearsal passed empty/populated datasets, four roles, confidential shared journeys, current-month and future acceptance dates, prior-month resolved closure, accepted confidential offers, anonymous/missing authentication, and replay of the new forward migration. The four message fields exactly match the full summary in every case. A fixture was repaired to respect offers_one_current_acceptance rather than bypassing that constraint.
- Desktop and 390px mobile screenshots were inspected with the message ready and count cards still pending. Existing modal styles, message bands, progress ratio and loading primitives are preserved. Mobile retains the existing scrollable modal when content exceeds viewport height.

## Disposable SQL observations

Current-schema synthetic PostgreSQL 17 data (1,132 applications), production-matching JIT-off setting. Each new message result was compared to the full Welcome result under the same role. One full-summary diagnostic observation and 100 fresh message observations per role:

| Role | Full single observation ms | Message median ms | Message p95 ms |
| --- | ---: | ---: | ---: |
| system_admin | 988 | 129 | 139 |
| admin_recruiter | 1201 | 131 | 145 |
| site_recruiter | 2416 | 196 | 208 |
| viewer | 1472 | 146 | 159 |

These are synthetic SQL observations, not production end-to-end p95. Local artifacts: outputs/welcome-message-native-performance.json and outputs/measure-welcome-message.cjs. Browser fixtures demonstrate removal of the dependency, not real Supabase network latency.

## Rollout and rollback

Declarative owner: supabase/schemas/64_home_welcome_summaries.sql. Reviewed additive migration: 20261115110952_home_welcome_message.sql, created with the installed Supabase CLI and verified through full-schema migration replay. Development migration applied; metadata confirmed stable, security invoker, empty search_path, authenticated EXECUTE and denied anonymous EXECUTE. Staging frontend 52359ef became live in dep-dbspgch5efls73f10q50 at 11:35:55 UTC. Production RPC migration applied before frontend d95f09e; deploy dep-dbspk1ff3r2c73elmqog became live at 11:43:34 UTC (18:43 Bangkok). Production function source matches the reviewed migration exactly, with invoker mode and authenticated-only execution verified. Final HTTP/asset checks returned 200 and found the new message RPC and independent message region.

Apply the compatible RPC migration before the frontend in each environment. For rollback, restore the prior frontend; leaving the additive invoker RPC in place is compatible and safest. If removed later, drop only app_home_welcome_message_v1() after all clients have rolled back. Existing full Welcome summary and all reporting data remain unchanged.

Final verification: all 32 focused cases also passed against the local compiled production build. Four production-hosted browser cases (one per role, synthetic API fixtures) passed while deliberately holding the full Welcome response unresolved. The user confirmed the popup as the affected surface; this release stays focused on that popup. Production-hosted tests verify the dependency fix, not real database-backed end-to-end p95.

Post-migration Supabase security/performance advisor categories and counts were unchanged; existing findings and remediation links remain recorded in [the preceding performance record](all-role-welcome-performance.md#advisors-and-rollback). No production HR records or request bodies were copied into artifacts.
