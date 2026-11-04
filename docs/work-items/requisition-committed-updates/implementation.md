# Immediate requisition updates

Delivery mode: direct, explicitly selected by the user. Checkout: KT `push-sourcing-develop`, based on release `3a1bab7`. Connected databases, branches and deployments are unchanged by this implementation.

## Behavior and ownership

- `65_requisition_actions.sql` owns allowlisted invoker `app_requisition_action_v1(payload jsonb)`. The envelope is `{operation,payload,request_id}`; original mutation APIs remain available. Only the status function adds compatible `id/log_id` return fields.
- Receipts contain the final authorized requisition, exact-ID display metrics, status log, old/new identities, readable linked groups, changed fields and refresh categories. Status is projected after automatic accepted-offer/headcount calculation. An inaccessible result contains a removal marker and no restricted row/log/display fields.
- `requisition-action-receipt.ts` owns scoped receipt overlays, duplicate protection, uncertain-outcome reconciliation, timing events and rename aliases. Known filters remove mismatched rows immediately; unknown search membership is retained until the server revalidates it.
- Home/Records, open detail, selected Workspace and linked requisition previews apply receipts. Reconciliation retains the committed detail on transport failures and rejects reads started before a later commit. Denied/not-found results still remove access.
- Requisition list notifications combine for 100 ms and target registered record/count criteria plus matching inactive cache entries. Requisition-specific Home, report and Workspace revisions replace global report revision changes. Welcome is not invalidated. Other entity save paths retain their existing behavior.
- Preserve exact totals during refresh with updating feedback. Exact-ID receipt display metrics use the same accepted-offer, no-show and distinct-candidate rules as the list; no fabricated counts or full-list projection is used.
- Existing detail header metadata/actions are preserved when wrapping the requisition body, keeping the priority control available.

## Verification

Run local checks with `node --test tests/unit/requisition-action-receipt.test.cjs tests/unit/candidate-action-receipt.test.cjs`, `pnpm exec tsc --noEmit`, and `pnpm build`.

Use `node scripts/rehearse-profile-contract.cjs --requisition-actions` for disposable PGlite only. It replays the forward migration and tests create/edit/rename/status/priority, accepted offers, did-not-start, automatic final status, exact status-log identity, stale priority, invalid operations, administrator/admin recruiter/site recruiter/viewer/anonymous permissions and redaction after loss of read access. Fixture action timings are not production latency measurements.

Browser checks: `tests/e2e/requisition-committed-updates.spec.ts` and `tests/e2e/requisition-priority.spec.ts`, on a verified local loopback server with synthetic intercepted data. Delayed/failing reads must not hide committed values; English desktop and Thai phone response-to-display checks target 100 ms. Numeric timing events are opt-in through `window.__recruitmentMeasureReads`, without payloads or record identifiers.

Broader identity-suite coverage also runs. Its pre-existing related-record links expectation is outside this change: the bounded requisition detail loader does not fetch candidate rows used by that legacy rendering. Do not claim the whole broad suite passes without addressing or separately documenting that gap.

## Release

Prepare migration `20261104063648_requisition_committed_results.sql` before frontend release. It contains canonical status return fields and the additive wrapper; no indexes, policies, tables or wider grants are added.

No push, connected migration or deployment is included. For an authorized release: apply the reviewed migration to develop, deploy frontend, verify authenticated saves/timings/permissions, then promote the same changes to main. Legacy endpoints support frontend rollback.

Production write duration, projection overhead and end-to-end browser latency remain release measurements; mocked browser and disposable SQL checks do not establish them.

## Final verification results — 2026-11-04

- Production build and its type validation: passed.
- Focused unit checks: **51 passed** across requisition/candidate receipts, shared lists, complete traversal, read scheduling and scoped detail caches. The uncertain-outcome test primes a warm cache and confirms reconciliation performs a fresh exact server read before releasing the write guard.
- Production-build mocked browser checks at `http://127.0.0.1:3114`: **21 passed**. Command: `pnpm exec playwright test tests/e2e/requisition-committed-updates.spec.ts tests/e2e/requisition-priority.spec.ts tests/e2e/requisition-identity.spec.ts --grep-invert "complete requisition profile" --workers=1`. This includes pending feedback before success, response-to-display below 100 ms for sampled English desktop/Thai phone saves, delayed and failed reconciliation, status action, rename, linked Workspace display and priority navigation.
- Disposable full-schema rehearsal: passed; 30 synthetic status actions, exact metrics/log identity, accepted offers and no-shows, role permissions, redaction and migration replay. Last fixture total-action median approximately 1.60 ms and p95 4.23 ms; these are PGlite observations, not production RPC timings.
- Documentation validator and `git diff --check`: passed.
- Baseline failure isolated: the broad identity test `complete requisition profile, related links and sorted history fit desktop and phone drawers` expects related links, receives zero. Reproduced unchanged on main `c500b7d` at `http://127.0.0.1:3115`; excluded only from the final focused run. The full suite is not claimed green.
- Native Supabase local-stack migration inventory was unavailable because `127.0.0.1:54322` has no running database. The generated migration was instead replayed and verified in disposable PGlite. No connected database fallback was used.
- Existing unrelated checkout edits were preserved. No commit, push, deployment or connected database mutation was performed. All task-started local servers were stopped after verification.

## Authorized release follow-up — 2026-11-04

Release requested after implementation. The first live main benchmark found approximately 193–196 ms median receipt overhead for a selected site-recruiter record, exceeding the 100 ms target. EXPLAIN ANALYZE isolated a sequential application scan: 1,132 applications examined, 109 authorized before the group filter, 34 matching applications.

Forward migration `20261104073701_requisition_receipt_projection.sql` bounds application reads per linked group with an optimizer barrier, materializes distinct candidate keys, and checks candidate visibility by exact key. It retains invoker execution, RLS, existing counts and existing indexes. The originally applied migration is unchanged.

Main's subsequent selected-record warm SQL sample: site-recruiter status median 12.783 ms / p95 14.635 ms; edit median 14.492 ms / p95 15.521 ms; priority median 16.684 ms / p95 18.290 ms. Thirty samples per operation and variant; all three writer roles tested. Paired median receipt overhead was approximately 9–15 ms across those roles.

The new analyzed projection used the existing `candidate_applications_group` index, read the 34 matching applications, and executed in 8.57 ms versus 202.846 ms for the prior projection. Exact display parity passed under system administrator, administrator recruiter and site recruiter scopes (85 / 85 / 34 distinct candidates in selected managed populations). Existing 25 RLS policies and RPC execution boundaries remained unchanged.

Measurement transactions roll back all requisition/audit changes; sequence values can advance normally. SQL timing excludes authentication transport, network, client scheduling and rendering. Per user preference, live browser timing is excluded from this release measurement. Do not describe these selected-record warm SQL p95 values as browser or whole-workload p95.
