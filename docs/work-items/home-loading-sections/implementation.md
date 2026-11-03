# Home loading sections and request repairs

Implemented in the active KT checkout on 2026-11-03. Checkout base: 8fc4b3a, branch codex/dropdown-tokens-agent-choice; the existing working tree already contained unrelated changes. No commit, push, deployment, or connected-database mutation was performed.

## Delivered behavior

- Candidate reference-check reads order and identify rows by check_id, including multi-page completeness checks.
- Pipeline summary payloads/cache keys normalize header Site/PIC/priority; groupId travels separately. Database validation remains strict.
- Home core metrics use an additive invoker RPC without work queue, quality or recent activity. The old combined RPC remains unchanged.
- Calendar and selected records load independently. Urgent count and eligible Welcome wait for essential requests to settle, including errors.
- Quality count/rows load only on selecting that tab; identity/scope/refresh changes reset cursor and totals. Unloaded counts are dashes.
- Core, urgent count, quality and Welcome have independent loading/error/retry handling. Dismissed Welcome work is skipped before its queued RPC starts; header filters do not refetch Welcome.
- Welcome reuses authorized populations and offer/close-date aggregates while preserving responsibility, PIM and Bangkok-date calculations.
- Opt-in scheduler diagnostics expose priority, queue duration, request duration and outcome only. Scheduler concurrency is unchanged.

## Verification

- pnpm typecheck: passed on final application source.
- node scripts/rehearse-home-loading-contracts.cjs: passed (normalized payload/cache, 0/1/201 reference checks, duplicate and incomplete-page rejection).
- node scripts/rehearse-home-welcome-summaries.cjs: passed (old SQL and legacy calculation parity for admin/site recruiter/viewer, date/ratio cases and grants).
- node scripts/rehearse-dashboard-summaries.cjs: passed, including new Home core/legacy essential-field parity across scopes and empty populations.
- node scripts/rehearse-profile-contract.cjs: passed on final migration; actual application RLS gives matching core/Welcome results for administrator, restricted site recruiter and viewer, and rejects anonymous core execution. Unsupported Pipeline summary scope still fails; the separate group parameter succeeds.
- Local mocked Playwright suite covering data-loading-performance, home-aggregate-summaries, home-candidate-pipeline and home-loading-sections: 17 passed. After the final loading-state review, the affected home-aggregate-summaries and home-loading-sections files were rerun: 9 passed.
- Desktop 1440px and phone 390px screenshots inspected; Thai/English record behavior covered by the Home candidate suite. Screenshots are under outputs/home-loading-implementation/.
- Documentation checker: passed using the bundled Python executable. The generic python command resolves to a noninstalled Windows Store alias.
- Task-scoped git diff --check: passed. A whole-tree check additionally reports a pre-existing blank EOF line in unrelated SourcingView.tsx; left unchanged.

The local Next server used a fresh ignored cache because OneDrive's old generated cache raised EINVAL/readlink. The server was stopped and its temporary tsconfig include removed.

## Performance evidence and limits

Disposable PGlite with 229 synthetic requisitions, 1132 applications and 3396 stage rows plus the standard fixture, eight alternating warmed samples:

| Query | Median | Sample p95 |
| --- | --- | --- |
| Legacy combined Home | 3169.01 ms | 3252.30 ms |
| New essential Home core | 27.75 ms | 35.16 ms |

Essential-field parity passed. This is a 99.1% median reduction for the initial core request because expensive optional sections are excluded; it is not a 99.1% reduction of all Home work. Benchmark permission helpers are simplified. Detailed query plans and samples are saved in outputs/home-loading-implementation/sql-performance.json. No new indexes were added.

Browser measurement now records API durations and response-to-observed-display gaps, while the synthetic loader tool separately records scheduler queue/request duration. Browser observation includes Playwright overhead and is not isolated React render time. Mocked population totals do not simulate production database load.

Production p95 below two seconds, production timeout elimination and the real browser end-to-end gap remain unverified until an authorized release. RLS parity is separately covered by the full-schema disposable replay.

## Release preparation

Apply the reviewed additive migration 20261103023353_home_loading_sections.sql before deploying the frontend. It explicitly revokes public/anon execution and grants authenticated execution for the new core and updated Welcome functions. The legacy combined Home RPC remains available for frontend rollback. Keep deployment and connected-database mutation as a separate authorized action. Monitor main's core/optional RPC timings, errors and browser time to usable records after release.

## Release integration verification

Integrated onto current develop (604f4f5), preserving newer five-card Pipeline paging, refresh/stale-data safeguards and attendance controls. The candidate check_id correction was already present in that release. Direct Next production build and TypeScript checks passed; all 28 scoped Home/loading/Pipeline browser scenarios passed after aligning one obsolete pagination assertion. Disposable request, Welcome, full-schema RLS and dashboard/YTD SQL rehearsals passed. Develop database migration and live essential-field parity checks passed before the frontend push. Only task files are committed; unrelated workspace documentation remains unstaged.
