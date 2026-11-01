# Independent candidate profiles and Workspace views

Implemented locally on 2026-10-11. Delivery mode: direct; no agents, push, or production deployment.

## Ownership and decisions

- [Canonical behavior](../../WEBSITE_STRUCTURE.md#independent-candidate-profiles) owns profile/application separation, access, counts, and transitions.
- [Candidate detail](../../design/candidate-detail.md) owns identity, explicit journey selection, and transfer interaction.
- [Workspace](../../design/workspace.md) owns the Groups picker Table/Cards preference and responsive renderers.
- [Declarative schema workflow](../../../supabase/schemas/README.md) owns database changes. Application sources are `12_candidate_applications.sql`, `32_application_context.sql`, and `56_candidate_application_rpc.sql`.
- Profiles require a home site; pool saves create no stage. Applications own stage instances and offers. Parallel journeys are independent. Transfer keeps the application ID and completed/pending work; no copied passes or 90-day reuse rule.
- Stage entry and outcome have separate assignment references. Migrated attribution is marked inferred. Accepted offers are serialized on the person; offers retain their actual requisition. Scheduled meeting workflows block transfer.
- Table is the initial picker view; preference is keyed by signed-in user. Both renderers use the same uncapped filtered/sorted model.

## Migration checklist and evidence

- Preserved the existing dirty checkout and unrelated edits; additive compatibility columns remain.
- Rechecked the specified test project before migration: 17 candidates; no ambiguous multisite legacy context, out-of-group offers, or duplicate current accepted offers.
- Rehearsed representative legacy data using [the disposable PostgreSQL harness](../../../scripts/rehearse-applications.cjs).
- Applied only to `mppnlkldlctvketcsald`, in order:
  1. `20261011153944_independent_candidate_applications.sql`
  2. `20261011160759_application_context_hardening.sql`
  3. `20261011162307_application_no_show_reapplication.sql`
  4. `20261011163003_application_correction_attribution.sql`
  5. `20261011165617_application_stage_chronology.sql`
- After migration: 17 applications and 17 initial assignments; 83 logs, 6 offers, 6 requisition associations, and 3 reference assessments preserved. No missing home sites, orphan log/offer application context, duplicate active journeys, or duplicate accepted offers.
- Legacy log fingerprint remained `47eaefe35991dd4b0d6ff132bb19e3d8`; offer fingerprint remained `f55e5b2c826f2bb81aa7eb769b0ee704`. These compare original IDs, outcomes, dates, and timestamps while excluding newly added context fields.
- New tables have explicit grants/RLS. Legacy anonymous write entry points were revoked. Application authorization follows current assignment; transferred history remains in the journey.

## Verification and acceptance

[Database assertions](../../../tests/db/candidate-applications.sql) passed in the disposable rehearsal and in a rollback-only transaction on the requested project. They cover pool creation without logs, separate parallel stages, duplicate active journeys, ambiguous legacy rejection, same-ID/repeated transfers after completed HR Interview, entry/outcome attribution, corrections, stale versions, meeting blocks, accepted-offer uniqueness, reapplication/no-show reopening, per-application references, duplicate-contact privacy, home-site/cross-site RLS, administrator-only cross-site writes, and viewer denial. Test fixtures leave no persistent candidates, users, or messages.

[Focused browser coverage](../../../tests/e2e/candidate-applications.spec.ts) uses mocked Supabase, email, and Teams. Fourteen feature checks cover profile creation and duplicate warning, explicit application selection, Workspace add-existing flow, required transfer reason, shared picker order/search, user preference isolation/default fallback, and English/Thai overflow at 360, 390, 768, 1024, and 1440px. Login/CSS checks and seven affected Workspace regressions also passed (23 focused checks in total). Desktop cards and Thai phone rows were visually inspected.

Typecheck and production build pass. [Local preview verification](../../../scripts/verify-application-preview.cjs) checks Candidates, Workspace, login, the configured project ID, real Supabase Auth reachability, and anonymous application-table denial. The dev server runs on port 3000.

The opt-in live verifier (`scripts/verify-applications-live.cjs`) signed in a temporary synthetic QA administrator against the real test backend. It verified the local Candidates registry, explicit parallel journey list, and Workspace Table/Cards renderers. Two simultaneous application-creation requests produced exactly one success; two simultaneous offer acceptances also produced exactly one success. Fixture ownership was checked by name, home site, creator UUID, and synthetic email before any offer write. The temporary account, candidate, applications, stages, offer, groups, and requisitions were removed afterward; original business counts remain 17/17/83/6. Audit traces are retained. No email or Teams operation was called.

The final correction regression verifies that replacement log IDs cannot change logical stage/round ordering or block later stage completion. This fix was rehearsed and applied to the specified test project before the final local checks.

Verification boundaries: most detailed browser workflows use deterministic mocked sessions. The live run uses a synthetic administrator; every role is not represented in live browser coverage. Database authorization assertions cover site recruiters and viewers. The entire historical browser suite is not certified by this focused run. Broader role/browser regression remains necessary before production release.

## Local review

- [Candidates](http://localhost:3000/candidates)
- [Workspace](http://localhost:3000/workspace)

Sign in using the existing test-project account. The server remains running. No Git push or deployment is included.
