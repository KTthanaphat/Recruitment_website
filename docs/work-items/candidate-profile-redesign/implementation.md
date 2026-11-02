# Candidate profile privacy, single note, and application tabs

Date: 2026-10-15. Direct implementation; no subagents, push, or deployment. Existing unrelated checkout changes were preserved; task-start copies of overlapping files are local-only.

## Decisions and canonical owners

- [Behavior](../../WEBSITE_STRUCTURE.md#independent-candidate-profiles) owns creator/unmatched privacy, matching, PIC management, counting, and single-note permissions.
- [Candidate Detail](../../design/candidate-detail.md#shared-profile-and-application-tabs) owns hidden form controls, duplicate review, profile-first composition, and accessible application tabs.
- [Schema workflow](../../../supabase/schemas/README.md#creator-privacy-and-single-profile-note) owns source order and compatibility; [task map](../../FEATURE_FILE_MAP.md) routes future work.
- Creator identity survives matching/transfers/edits. Creator/admin starts first matching across sites; creator/application PIC/admin can add further applications. All linked requisition PICs manage their group’s journey. Creator status alone grants no foreign journey access. Former PICs receive no special retention.
- Shared profile editing: creator/PIC/admin. Single profile-note reading: creator/PIC/admin. Note editing: creator/admin only. Site membership alone is read-only for journeys. Administrators retain unmatched oversight; viewers receive only masked unmatched summaries.
- One optional current note replaces the earlier timeline assumption. Revision history stays in protected audit records. No existing note rows needed consolidation.

## Migration and preservation

Rechecked the actual target immediately before migration: 17 candidates, **18 applications**, 84 logs, 6 offers, and zero notes. The application/log counts had changed since planning; no older baseline was assumed. All 17 creators resolved unambiguously from creation audit actors.

Applied only to `mppnlkldlctvketcsald` after declarative edits and disposable PostgreSQL rehearsal:

1. `20261015074832_candidate_profile_privacy_tabs.sql` — creator backfill, nullable administrator site, immutable creator guard, single-note uniqueness/version, split permissions/RLS, redacted discovery, duplicate preflight/recheck, minimal destinations, and versioned writes.
2. `20261015080617_profile_registry_context.sql` — safe unmatched-state metadata and permitted note-editor label. This prevents a creator’s inaccessible applications from being misclassified as unmatched.
3. `20261015083414_group_pic_offer_context.sql` — all linked group PICs can read linked requisition/offer context and manage application offers/start confirmation across sites, without gaining requisition write privileges. Administrators retain audit oversight of deleted profiles.

The first migration request expired at the connector without applying; absence was checked before retry. The retry succeeded. Rollback-only remote assertions subsequently passed. No test identities or business fixtures from those assertions persist.

After migration: 17 candidates, 18 applications, 84 logs, 6 offers, no missing creators, zero notes. Original log fingerprint `0898a56d15f1bba3cc2754976d016d99` and offer fingerprint `f55e5b2c826f2bb81aa7eb769b0ee704` remained unchanged. No original stage/offer ID, date, result, or timestamp changed.

## Verification

- [Disposable harness](../../../scripts/rehearse-profile-contract.cjs) and [SQL assertions](../../../tests/db/candidate-profile-contract.sql): creation defaults, unmatched same-site/viewer denial, safe discovery, duplicate privacy, cross-site creator matching, PIC-only mutations, multiple linked PICs, transfer permission changes, closed-history discovery, note read/write separation, injection denial, revision audit, stale versions, clearing, administrator creation without site, and site-recruiter account validation.
- [Browser checks](../../../tests/e2e/candidate-profile-redesign.spec.ts): ownership fields absent, name/nickname adjacent, duplicate review and preserved draft, one note, PIC read-only note, shared-profile edit, masked summary, explicit tabs, keyboard/deep links, and English/Thai phone/tablet/desktop layout.
- Existing [application/Workspace view checks](../../../tests/e2e/candidate-applications.spec.ts) were updated only for changed form/tab contracts. Email and Teams remain mocked during browser verification.

Final production build, typecheck, documentation validator, and diff whitespace checks passed. The focused combined browser run passed 32 checks; the additional viewer-creator regression passed in a four-check follow-up (33 distinct scenarios overall). English/Thai profiles and application sections were inspected at desktop and narrow phone widths. Existing nonblocking image/accessibility/hook lint warnings remain.

The live verifier (`scripts/verify-profile-contract-live.cjs`) used three explicitly synthetic test accounts with separate sites. Real requests verified masked discovery without private contacts, creator cross-site matching, PIC-only stage updates and transfer, destination access to preserved history, independent parallel-journey access, and note read/write separation. Two simultaneous note edits with the same version produced exactly one success and one stale-write rejection. Authenticated browser checks saved the creator note, verified a PIC’s isolated tab and note-free Edit profile form, and exercised Workspace views.

All temporary identities, auth sessions/refresh tokens, candidate/journeys/stages/note, and linked group/requisition fixtures were removed. Credentials were deleted locally; synthetic audit traces remain. Counts and original stage/offer fingerprints returned to the preserved baseline. No email or Teams delivery was invoked.

Security advisors were reviewed: authenticated definer-RPC notices are expected for explicitly guarded entry points; the existing RPC-only ID counter has no public row policy. The preexisting [password-protection advisory](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) was not changed. Anonymous execution of new pool/profile/note RPCs is revoked and verified.

## Local review

- [Candidates](http://localhost:3000/candidates)
- [Workspace](http://localhost:3000/workspace)

Detailed browser workflows use deterministic mocked sessions; database authorization assertions exercise real authenticated-role policies. This focused work does not certify the full historical browser suite or deliver external messages.
