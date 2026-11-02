# Candidate Detail refinement and lifetime group protection

Date: 2026-10-15. Direct implementation; no agents, push, or deployment. Preserved preexisting dirty changes; task-start source copies are local-only.

## Contract and owners

[Drawer contract](../../design/candidate-detail.md#connected-drawer-refinement) owns profile fields, saved note, warning placement, icon controls, and connected tabs. [Behavior](../../WEBSITE_STRUCTURE.md#independent-candidate-profiles) owns lifetime group uniqueness. [Pipeline map](../../maps/system/pipeline.md#connected-profile-and-group-uniqueness) routes sources and search keys.

- Profile and application details share field/heading primitives. Saved note follows Position interests; creator/admin edits via the profile pencil. Existing PIC/read-only note permissions remain.
- Profile warnings precede the profile once; journey/offer warnings stay selected. Tabs omit creation date and journey ID. Blue selected tab joins the panel containing all journey content; operational/closure dates remain in Application details.
- Unique internal candidate/group claims prohibit another journey after closure or transfer. The original journey may revisit the group. Existing eligibility, authorization, meeting/offer blockers and version checks remain.

## Migration evidence

Updated declarative sources first and generated/reviewed the additive migration from the ledger schema plus the two changed RPC definitions. Rehearsed using disposable PGlite/PostgreSQL; the Docker-dependent CLI diff workflow was not used. Applied `20261015091726_candidate_group_journey_claims.sql` only to `mppnlkldlctvketcsald`, before enabling UI changes.

Immediately before migration: 17 profiles, 18 applications, 84 recruitment logs, 6 offers, zero conflicting historical candidate/group pairs. Backfill produced 19 claims. After migration and rollback tests, all counts remained unchanged. Full-row fingerprints before/after: logs `b9f84659078f81b503099c11ee2b6ad4`, offers `1949db89e812a33e7dd7b4d2cc8a36dc`. No original application, stage, offer or assignment outcomes were rewritten.

The ledger resides in `app_private`, has RLS enabled and no API grants. Claim maintenance is trigger-only. A unique candidate/group key serializes competing claims; direct insert/assignment writes and legacy RPCs cannot bypass it. Claims cascade only with deletion of their owning journey/profile. Migration stops on conflicts rather than merging histories.

## Acceptance and verification

[Rollback-only SQL tests](../../../tests/db/candidate-group-claims.sql) passed on disposable PostgreSQL and the requested target: active/closed duplicate creation, historical transfer conflict, repeated return of the same journey, direct application/assignment bypass attempts, and internal privilege isolation. The disposable run also passed the existing profile permission suite before applying the new constraint.

All 31 focused browser cases passed together (`candidate-profile-redesign.spec.ts` and `candidate-applications.spec.ts`): note editing through the profile form, PIC read-only note, duplicate review, warning order/deduplication, icon labels/targets, metadata removal, connected border/content, keyboard/deep links/history, historical destination exclusion, server rejection with preserved draft, Workspace views and English/Thai phone/tablet/desktop bounds. Rendered desktop and narrow-phone screenshots were inspected; the candidate journey now stays within its container instead of inheriting a wide minimum width on phones.

Production build, typecheck, documentation validation and whitespace checks passed. Existing nonblocking image/accessibility/hook warnings remain. The complete historical browser suite was not run. External email/Teams delivery remained mocked; no delivery endpoint was invoked.

[Live verifier](../../../scripts/verify-group-claims-live.cjs) used a separately provisioned synthetic QA administrator/profile/groups on the requested project. Two actual concurrent application RPCs produced one success and one `APPLICATION_GROUP_ALREADY_USED`; a fresh journey to the historical group was rejected, while the original journey returned successfully. A real authenticated browser saved the note through the profile pencil, verified connected tabs/CSS, and exercised Workspace Table/Cards. The temporary account needed Auth timestamp fields populated before sign-in; this was a fixture repair, not an application/schema change.

All QA business fixtures, auth sessions, refresh tokens and account were deleted using the existing candidate-delete workflow context; synthetic audit traces remain. Local credentials and provisioning SQL were removed. Counts and original full-row fingerprints returned to the preserved baseline (19 claims, 17 profiles, 18 applications, 84 logs, 6 offers; zero QA accounts). An existing shared note outside the QA fixture was preserved.

Standalone current declarative-source probing also exposed a preexisting gap: the configured source set omits earlier application sources and final legacy stage wrapper definitions are not all represented there. This task rehearses the reviewed migration chain, not a full fresh declarative rebuild; no unrelated source-order repair is included.

## Local review

- [Candidates](http://localhost:3000/candidates)
- [Workspace](http://localhost:3000/workspace)
