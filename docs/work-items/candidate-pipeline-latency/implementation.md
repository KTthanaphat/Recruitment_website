# Candidate Pipeline loading and committed saves

Direct implementation from KT develop checkout baseline 99b38a6. No connected database was changed and no branch was pushed or deployed. Existing attendance controls, newer profile fixes and unrelated working changes are preserved.

## Implementation

- Visible board buckets publish independent 25-record blocks, five cards per page before grouping. Exact counts run independently. Keyboard focus and phone disclosure open lazy stages. Prior blocks are reused and one following block is prefetched.
- Per-client scheduling permits two reads and one background read. Visible pages/details outrank counts and prefetch. A queued prefetch is promoted when the user requests it. Shared list/detail leases cancel obsolete consumers without aborting another active reader. Writes bypass scheduling. Welcome bypasses the interactive queue.
- Allowlisted invoker `app_candidate_action_v1` delegates existing validation, authorization, concurrency/audit and handoff rules. It projects exact authorized IDs and supplies removal markers on access loss. Selected candidate operations apply committed profile/card/history/assignment/note/context data before reconciliation. No speculative final stage or automatic retry of an uncertain write. Readable contact-duplicate warnings use the existing authorized RPC as an optional background read; the essential detail load does not traverse the candidate population.
- Monotonic read generations protect committed state even when wall-clock timestamps tie. Per-candidate locks leave other candidates usable. Detail errors retain committed data with retry controls.
- Candidate invalidation batches for 100 ms and targets candidate/application/group/source/destination-stage criteria. Detail, board, Home/calendar and report revisions are separate. Other writes retain conservative dependencies. Exact totals remain visible while updating. Inactive affected caches are invalidated for their next open.
- Location uses identical authorized stage membership, canonical ordering and search aliases, returning a block cursor, offset and five-card page. Destination reads bypass older cached pages; other stage pages are retained. Filter exclusion keeps filters and reports a saved-result message.
- The application query materializes authorized eligible applications before latest-stage processing and materializes bounded keys before exact-ID display enrichment. Date/filter/canonical-stage semantics are retained. No new indexes were added.

## Verification and evidence

Focused unit, browser and full-schema disposable PostgreSQL checks cover bounded navigation, blocked counts, lazy focus, stage actions, duplicate/uncertain writes, committed destination reveal, candidate/reference detail, attendance regressions, strict validation and RLS. Population checks cover 0, 5, 6, 25, 26 and 101; complete export traversal remains covered at 1,005 records. Final focused result: 37 unit tests and 64 browser tests pass; full-schema SQL/RLS rehearsal, TypeScript, measurement tooling and production build pass. The build retains existing lint/optional sharp warnings.

- `node --test tests/unit/candidate-action-receipt.test.cjs tests/unit/recruitment-read-scheduler.test.cjs tests/unit/recruitment-list.test.cjs tests/unit/recruitment-complete-list.test.cjs tests/unit/scoped-detail-cache.test.cjs tests/unit/pipeline-summary-loader.test.cjs`
- `node scripts/rehearse-profile-contract.cjs --candidate-latency` selects disposable in-memory PGlite, replays full schema/RLS migrations and compares legacy/new page DTOs and cursor locations. It also verifies real permission-loss transfers and anonymous/viewer denial.
- Focused Playwright suites: pipeline-latency, pipeline-actions, pipeline-stage-pages, home-candidate-pipeline, scoped-detail-loaders, candidate-reference-detail and candidate-profile-redesign. Synthetic services only.
- TypeScript and production Next build.
- `node scripts/measure-recruitment-loading.cjs --population=1000` captures payload-free queue/request and simulated action phases. Application observers separately expose write, response-to-display and reconciliation durations. No candidate payloads are logged by instrumentation.

The local SQL artifact `outputs/candidate-latency/sql-rehearsal.json` records identical role/filter/dataset cold/warm timings, inner EXPLAIN ANALYZE plans and projection overhead. An initial synthetic filtered Home sample measured old/new warm RPC medians of about 591/6 ms and approximately 3 ms added median note-receipt projection. Literal inner-plan execution was 1.56/4.00 ms: these differ from parameterized RPC timings and are not production p95 evidence. Retained indexes: none. Browser targets and representative production SQL targets remain release gates.

## Release artifacts and gates

Canonical files: 60_recruitment_list.sql, 61_candidate_actions.sql and 90_grants.sql, registered in supabase/config.toml. Additive migration: `20261103080120_candidate_pipeline_latency.sql`. Legacy list and mutation RPCs remain available.

When deployment is separately requested: deploy additive SQL to develop first, then frontend; verify authenticated admin/site/viewer behavior, access-loss handling, cold/warm first-card p95 (<1.5 s target), pending and committed response-to-display (<100 ms), receipt projection (<100 ms added median), query errors and request counts. Compare identical datasets/roles/filters. Promote the same changes to main only after develop passes. Roll back the frontend if permissions, metrics or errors regress; retain additive compatible interfaces. Remaining Welcome SQL timeouts are outside this change.
