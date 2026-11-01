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
