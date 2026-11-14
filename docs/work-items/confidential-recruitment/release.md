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
