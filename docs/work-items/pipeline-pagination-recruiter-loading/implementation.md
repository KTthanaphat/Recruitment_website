# Compact Pipeline pagination and recruiter reads

## Changes

Pipeline controls now display `< current/total >` with compact desktop chevrons and phone touch targets. Failed stages use independent bounded readers, pages, counts, errors/retries and lazy activation. Five cards are sliced from 25-record cursor blocks. Stage-scoped receipt invalidation and empty-page recovery preserve unrelated stage positions. Legacy Pipeline RPC signatures and history-table controls remain compatible.

The forward migration reconciles four existing private authorization helpers with the canonical guarded procedural definitions. Existing helper privilege boundaries, public invoker RPCs and all RLS policies remain unchanged. Pipeline summary history and accepted offers are restricted to one materialized authorized application population. Prepared sourcing work is retained, not reimplemented. No indexes were added.

## Evidence and remaining limits

The deployed November 4 metadata showed missing fast-path migrations on both databases. Live shared-list logs previously showed 66 site-recruiter failures near eight seconds. The local rehearsal formerly applied the missing migrations and used a narrower position-group policy than production. The new upgrade rehearsal explicitly restores actual deployed helpers and policy expressions before checking the forward migration.

`node scripts/rehearse-profile-contract.cjs --recruiter-read-upgrade` verifies seven profiles, 27 read requests and 22 protected tables before/after. It compares full fixture rows, counts, helper decisions and projected/redacted details, rejects unsupported fields and anonymous execution, and checks unchanged policies and authenticated-only private grants. It saves an analyzed plan, 30 post-upgrade SQL observations per role/request (2,430 total), and paired baseline fixture samples. These are disposable PGlite results, not a production or cold-database benchmark.

Focused browser tests cover failed-stage populations 0/1/5/6/25/26/101, independent navigation, delayed reads/counts, retry, scope reset, empty-page recovery, Thai/English phones, keyboard operation and existing committed-stage reveal. Existing `pipeline-board.spec.ts` has six failures reproduced against untouched HEAD: stale estimate/bootstrap assumptions and offscreen terminal expectations. They are recorded separately from the new focused regression suite.

## Completed local checks

- 17 focused Pipeline browser tests passed; the final desktop/phone header refinement passed its three affected visual/interaction checks.
- 31 shared-client, scheduler, summary and committed-receipt unit tests passed.
- The deployed-helper/policy upgrade rehearsal passed for seven profiles, 27 requests and 22 protected tables; 2,430 post-upgrade and 240 baseline fixture SQL samples were recorded.
- Typecheck, the final production build, documentation validation and diff whitespace checks passed. Existing lint and optional sharp warnings remain.
- The six existing board failures reproduced on untouched HEAD; no live latency or administrator-performance-parity claim is made.

## Measurement and release

`node scripts/measure-recruiter-views.cjs --base-url=ORIGIN --storage-state=LOCAL_AUTH_FILE --manifest=LOCAL_CASES_JSON --role=ROLE_LABEL --samples=30`

Each manifest entry supplies `label`, same-origin `path`, `readySelector`, `warmSetupSelector`, and `warmActionSelector`. Use view/tab navigation only and fixtures with readable records. The tool enables opt-in numeric scheduler diagnostics and saves queue/request phases, browser RPC status/duration, interaction-to-display, and an approximate last-completed-read-to-display delay. It does not save authentication, URLs, query bodies, response payloads or record identifiers. Cold means application cache, not database cache. SQL execution must be measured separately with matched roles, filters and datasets.

Production SQL p95 below 1.5 seconds, display p95 below three seconds, zero sample timeouts, and the site-recruiter/admin median comparison remain release gates to verify. Current fixture timings do not prove those targets. Deploy reviewed database changes before the frontend only when authorized; verify develop before main. Include the already-prepared sourcing migration before this forward reconciliation. Do not wholesale-push missing historical migrations. No connected database was changed and no branch was pushed during implementation.
