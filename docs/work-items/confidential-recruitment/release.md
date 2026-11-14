# Develop release — 2026-11-14

User explicitly authorized push and deployment using plain Git, without GH CLI. Target: `develop` in `KTthanaphat/Recruitment_website`, Render service `Recruitment_website` (`srv-d8vv1dpo3t8c73boi000`) in the confirmed workspace. Automatic deployment is enabled. The main/production service is a separate target.

Scope: shared 28rem Save review, automatic prefix/email lookup with active-only filtering, confidential requisitions/groups and report exclusions, Home banner/sticker artwork, exact metric popups, and calendar New Hire Confirmation. Relevant canonical behavior/design/maps accompany these changes. Unrelated measurement/diagnostic changes remain unstaged.

## Release checks

- Integrated synthetic browser suite: 40/40 passed, Chromium, local KT server port 3100. Files: `calendar-start-confirmation`, `candidate-lookup`, `confidential-requisitions`, `home-aggregate-summaries`, `home-work-metrics`, `save-review` under `tests/e2e`.
- `node scripts/rehearse-profile-contract.cjs --contact-lookup --confidentiality`: passed, disposable PostgreSQL upgrade, role/RLS and ordinary-report parity.
- `node scripts/rehearse-confidentiality-fresh.cjs`: passed, canonical schema install; extension/cron installation stubbed in WASM.
- `node scripts/rehearse-home-metrics.cjs`: passed, fresh/upgrade paths, four roles, exact counts, privacy and cursor paging.
- First `next build`: compiled/generated all 22 routes; transient OneDrive ESLint dependency lock. Separate `next lint` retry passed with warnings. An isolated export of staged app inputs is used for the final release build.
- Final isolated staged-app `next build`: exit 0; compilation, lint/type validation and all 22 routes passed. Existing lint warnings remain; optional sharp is not installed.
- Documentation link/graph validation passed. Staged whitespace findings corrected before commit.
- Connected `mppnlkldlctvketcsald` migration history verified through `20261114081339_home_metric_drilldowns`; all eight new migration versions are present. Lookup and metric RPCs are invoker and deny anonymous execution. Reveal RPCs retain tested explicit admin checks and deny anonymous execution. No new schema changes or real record writes were needed during release.

## Limits

Lookup real authenticated end-to-end p95 remains unverified without representative benchmark accounts/contact samples. Mock browser timing and disposable SQL checks do not establish that target. Independent live concurrent-write stress was not performed. See [implementation evidence](implementation.md) for original verification boundaries. Current deployment target and process are owned by [Deployment](../../DEPLOYMENT.md).

## Hosted delivery

- Application commit: `85e1756ee0a56daf950faca8afbe975e822ef826`, pushed to `origin/develop` using plain Git.
- Render deploy: `dep-dbs8vclckfvc73dbsmcg`, automatic `new_commit`, **live** at 2026-11-14 16:47:37 UTC.
- Verified URL: https://recruitment-website-1heg.onrender.com/home. Clean Chromium returned HTTP 200, displayed the unauthenticated login form, and reported no page runtime errors.
- Public compiled JavaScript identifies only `mppnlkldlctvketcsald`. All four active lookup/banner/floral PNGs returned 200 and SHA-256 matched the local release files. Desktop/390px login screenshots and sanitized asset verification are kept under ignored `outputs/release-20261114/`.
- Five additional synthetic smoke flows passed against the staged optimized build on local port 3102 (45 browser checks total across the two runs). Hosted authenticated record mutations were not performed; authorization evidence remains the disposable SQL role checks plus deployed metadata.
- Main/production was not promoted. Unrelated performance/measurement edits remain local and uncommitted. This documentation-only follow-up uses `[skip render]` so the tested application deployment remains unchanged.

## Production promotion — 2026-11-15 (Bangkok)

User explicitly approved the remaining production database migrations and main deployment after automatic approval review required that scope to be confirmed. The initial contact lookup had already applied; the remaining seven migrations then succeeded on Recruitment_ATS (`sawiklexaafczfmzqhnr`). Develop was verified first.

| Production version | Reviewed migration |
| --- | --- |
| 20261114165714 | candidate_contact_lookup |
| 20261114172453 | confidential_requisitions |
| 20261114172512 | confidential_report_summaries |
| 20261114172516 | admin_unlinked_groups |
| 20261114172519 | candidate_lookup_application_groups |
| 20261114172524 | contact_lookup_index_branches |
| 20261114172528 | candidate_lookup_prefix_active |
| 20261114172532 | home_metric_drilldowns |

Production migration timestamps differ from develop; compare the named reviewed SQL rather than blindly replaying local timestamps. The eight local migration files retain their already-published develop versions.

Post-apply evidence: all 68 affected SQL function definitions match develop after newline normalization; all three classification columns are non-null with ordinary defaults; 12 report views are invoker; all seven guards are installed; lookup/metric/reveal endpoints deny anonymous execution. Thai phone and prefix normalization probes passed. Existing requisition/group/candidate/application/offer counts were preserved; no existing requisitions or groups were classified as secret.

Security advisor delta is limited to the two intentional authenticated SECURITY DEFINER reveal RPCs, whose admin checks and confirmation/concurrency guards passed the role fixtures. Existing ledger/counter and Auth notices are unchanged. [Advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

The production-adapter disposable rehearsal passed, including preservation of imported links/timestamps/audit rows and KT1/KT2/viewer/anonymous RLS. Application source/build inputs in the prepared main commit exactly match the tested develop tree (40 integrated browser checks, five optimized-build smoke checks, build/type/lint and documentation validation). Only this release evidence is added for main. Target: Render Recruitment_website-Production, automatically tracking main, https://recruitment-website-1.onrender.com/home. Hosted authenticated mutations and real lookup p95 remain unverified.
