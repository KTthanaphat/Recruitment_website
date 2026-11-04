# Declarative Supabase Schemas

These files are the source of truth for the recruitment app database shape.
Edit these files first, then generate and review a migration with the Supabase CLI before deploying.

Recommended workflow:

```powershell
supabase db diff -f describe_change
supabase db reset
supabase db push --dry-run
```

Do not edit the remote database directly in Supabase Studio for schema or RPC changes. Direct remote edits bypass migration history and will not be reflected in future declarative diffs.

## Candidate applications

Additive person/journey schema: [12_candidate_applications.sql](12_candidate_applications.sql). Authorization, assignment stamping and lifecycle: [32_application_context.sql](32_application_context.sql). Versioned profile/create/transfer/note RPCs: [56_candidate_application_rpc.sql](56_candidate_application_rpc.sql); existing stage/offer/reference writes remain in [50_rpc_functions.sql](50_rpc_functions.sql).

Migration evidence and reconciliation live in [feature record](../../docs/work-items/independent-candidate-applications/implementation.md). Preserve legacy IDs/outcomes and original trigger modes during backfill. The legacy application migration stops on missing/ambiguous historical group site; new administrator-created profiles may have no home site. Legacy anchors must be null for several journeys; never select an arbitrary group. Isolated PostgreSQL rehearsal is provided by [rehearse-applications.cjs](../../scripts/rehearse-applications.cjs) and [SQL assertions](../../tests/db/candidate-applications.sql).

## Creator privacy and single profile note

[13](13_candidate_profile_ownership.sql) owns immutable creator backfill, nullable administrator home site, and one current note/version. [32](32_application_context.sql) owns separate profile/note/application/PIC permissions. [58](58_candidate_profile_contract.sql) is the final profile API contract: redacted pool, capabilities, minimal cross-site destinations, duplicate review, creator-enforced profile v2, and single-note v2. It intentionally supersedes compatibility definitions in 56; old entry points delegate to the final rules. Do not grant profile reads merely to construct a masked row. Rehearse with [profile harness](../../scripts/rehearse-profile-contract.cjs) and [SQL assertions](../../tests/db/candidate-profile-contract.sql). [Feature evidence](../../docs/work-items/candidate-profile-redesign/implementation.md).

## One journey per historical group

[59](59_candidate_group_claims.sql) owns the private candidate/group claim ledger, conflict reconciliation, backfill and mutation triggers. [56](56_candidate_application_rpc.sql) reports `APPLICATION_GROUP_ALREADY_USED` before conflicting creation/transfer. Claims remain when an assignment ends or a journey closes; only the same journey may return. The internal table is not exposed or granted to API users; trigger-only execution is revoked again in [90](90_grants.sql). Existing RPC signatures are unchanged. Rehearse with `node scripts/rehearse-profile-contract.cjs --group-claims`; [SQL cases](../../tests/db/candidate-group-claims.sql), [feature record](../../docs/work-items/candidate-detail-refinement/implementation.md).

## Repeated Line Interview dates

Both derived Pending entry and corrected Outcome propagation must include earlier/later rounds of Line Interview as well as Test. The October 2026 repair migration handles both legacy `log` and current `l` SQL aliases; the original September string replacement missed the legacy alias. Keep the application-scoped definitions in 50 unchanged when repairing an older candidate-scoped project.

Regression: `node scripts/rehearse-repeat-round-dates.cjs tests/db/fixtures/repeat-round-legacy-functions.json supabase/migrations/20261026040217_fix_line_interview_round_date_derivation.sql`. It runs only in disposable PGlite, reproduces the old rejection, then checks Pending edit, Line Interview rounds 2/3 Pass, repeated Test, correction propagation, and replay safety. Authorization helpers are stubbed; this checks date behavior, not RLS. Uses the same temporary `recruitment-db-tools` PGlite dependency as the other rehearsal scripts.

## Dashboard summaries

[61_dashboard_summaries.sql](61_dashboard_summaries.sql) owns aggregate Performance, Pipeline, Risk, Rejection, Home, and Sourcing summaries plus bounded Home/calendar/filter-option RPCs. The private Performance helper reads the company requisition feed under a fixed search path and authenticated-profile guard; public wrappers are invoker functions with explicit `authenticated` grants. Operational Home issue feeds and Rejection/Risk detail use bounded cursor pages. Calendar dates are bounded to 62 days and returned through 200-row `(date,id)` cursor pages. Sourcing charts use compact lifecycle aggregates and an optional selected-group stage/channel summary. Rehearse against disposable PGlite using `node scripts/rehearse-dashboard-summaries.cjs`; no connected database is used.

[64_home_welcome_summaries.sql](64_home_welcome_summaries.sql) owns the complete-population Welcome Back and Home banner aggregates. The welcome DTO preserves profile responsibility, PIM eligibility and its calendar-month cutoff; the banner DTO separately preserves header scope and the Home banner's month-prefix acceptance count. Both functions are invoker RPCs with explicit `authenticated` grants. Rehearse SQL against the test-only legacy Welcome helper using `node scripts/rehearse-home-welcome-summaries.cjs`, plus the ordered profile migration replay.

### Independent Home sections

`61_dashboard_summaries.sql` adds `app_home_core_summary_v1(jsonb)` for essential counts only; the legacy combined Home response is unchanged. Work queue and quality remain separate existing invoker RPCs. `64_home_welcome_summaries.sql` reuses authorized populations and offer/close-date aggregates without changing responsibility/PIM results. Migration `20261103023353_home_loading_sections.sql` is additive and must precede the corresponding frontend release. Verify with `node scripts/rehearse-home-loading-contracts.cjs`, `node scripts/rehearse-home-welcome-summaries.cjs`, `node scripts/rehearse-dashboard-summaries.cjs`, and `node scripts/rehearse-profile-contract.cjs`. The dashboard rehearsal accepts `--home-performance` for a synthetic PGlite comparison and saved inner query plans; this is not a production latency or RLS benchmark.

## Committed candidate actions and bounded Pipeline

[61_candidate_actions.sql](61_candidate_actions.sql) adds allowlisted invoker candidate writes with exact-ID authorized receipts and the board location RPC. The application-page query in 60 selects eligible applications before canonical stage/touch processing and materializes page keys before display enrichment. No indexes were added. Migration `20261103080120_candidate_pipeline_latency.sql` precedes the frontend and keeps existing mutation/list interfaces. Run `node scripts/rehearse-profile-contract.cjs --candidate-latency` in disposable PGlite for full-schema RLS, mutation and cursor/location parity; production performance remains a release gate.

## Bounded sourcing records

`60_recruitment_list.sql` adds invoker `app_recruitment_sourcing_records_page_v1` and the `sourcing_records` dispatcher entity. It aggregates authorized requisition/group data without nested group-list or candidate-stage queries. Legacy sourcing APIs remain compatible. Migration `20261103154920_sourcing_records_loading.sql` must precede the frontend. Verify with `node scripts/rehearse-profile-contract.cjs --sourcing-records`; its disposable full-schema RLS fixture also saves an analyzed execution plan under `outputs/sourcing-records/`. No indexes are added; fixture plans do not establish production latency.

## Reconcile deployed recruiter read authorization

Migration `20261104015609_reconcile_recruiter_read_authorization.sql` reconciles the final private read helpers from canonical 30/32 without changing policies or broadening grants, and bounds `app_pipeline_summary_v1` history/offers to its authorized application population. It is a new forward migration; historical migrations are not edited. The deployed November 4 inventory is captured as metadata in `tests/db/fixtures/deployed-authorization-20261104.json`. Rehearse with `node scripts/rehearse-profile-contract.cjs --recruiter-read-upgrade`; it restores the actual live helper and policy definitions inside disposable PGlite before comparing the upgrade. This includes the deployed position-group policy difference from fresh-schema replay. Outputs under `outputs/recruiter-read-upgrade/` are fixture evidence, not production performance. No indexes were added.
