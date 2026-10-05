# Dashboard data export acceptance

Implemented the [accepted plan](plan.md) with direct delivery. Workbook/chooser details have one owner: [export contract](../../design/dashboard-data-export.md). No new API, SQL schema/RPC, dependency, migration application or push is involved. Existing unrelated changes remain preserved.

## Implemented

- One shared Export chooser per target report with PNG/Excel choices, progress lock, visible errors/retry and keyboard focus return; available when collapsed.
- Each workbook now contains exactly two sheets, Summary Data and Source Data. Existing summary/contribution tables are stacked under labeled sections with internal jump links, compact widths, wrapped rows and a collapsed guide. All original datasets and identity rules are retained.
- Shared screen/PNG/workbook calculations, captured snapshots, typed cells, exact uncapped ratios and authorized identity enrichment. No candidate contact information or free-text notes exported.
- Canonical behavior, portal/chart contracts, task router and Reporting owner map updated; focused contract links replace copied sheet rules.

## Verification results

- Before the compact follow-up, all 56 affected browser tests passed (9 new export checks plus existing dashboard, registry, portal and Performance suites). After the final hook-dependency cleanup and preview restart, the 9 export checks passed again. Coverage includes source contribution reconciliation, actual download parsing, formula-like literal names/leading-zero IDs, unavailable identity, header/Channel scope, Thai/empty/collapsed exports, retry, preparation locking and both choosers at desktop/tablet/360/390px widths.
- Authenticated system-administrator browser downloaded both August 2026 PIM workbooks against `mppnlkldlctvketcsald`, with all common/header filters and Channel set to All. A fresh read-only SQL reconciliation supplied expected totals. [Twenty live checks](evidence/live-aug-pim.json) passed: KPI/detail totals, average time, stage counts, channel measures and sourcing/Phone/Hired contributions. Downloaded files remain in the user's Downloads folder; only aggregate evidence is stored in the repository.

Live limits: one administrator and one reporting scope; mock tests exercise restricted-role/missing-identity behavior but do not prove every real RLS role. Live checks are snapshots, not ongoing monitoring. Database expected values: [aggregate fixture](evidence/live-expected.json); SQL owner: [existing reconciliation](../dashboard-configuration-redesign/reconciliation.sql). The [read-only workbook verifier](verify-live-export.cjs) accepts explicit download paths and writes aggregate results only.

- Typecheck, production build, documentation checker and diff whitespace checks passed. Build retains six existing warnings in HomeView (image), RecruitmentWorkspace/HiringWorkspace (hook dependencies), EmbeddedSourcingPanel and Command selectors (ARIA); this feature introduces no new warning.
- The signed-in live browser downloaded both workbooks again after restart; all 20 reconciliation checks passed again. [Live chooser screenshot](evidence/live-export-chooser.png) records the inspected desktop layout.
- Local Login, both report routes and Configuration return HTTP 200; all 20 linked CSS/JavaScript assets return HTTP 200. Authenticated Dashboard and Configuration were checked in the browser.

## Compact workbook follow-up

The user requested one summary sheet and one source sheet. The focused 9-test export suite passed after consolidation, including exact English/Thai sheet names, section-table counts/non-overlap, compact widths, guide outline state, numeric/date formats, downloads and existing chooser behavior. Both authenticated administrator downloads now have two sheets; the same [20 live reconciliation checks](evidence/live-aug-pim.json) passed against the recorded August 2026 read-only database snapshot. The verifier now reads section table ranges rather than former worksheet names. Typecheck, production build, documentation and diff checks passed again; the build retains the same six existing warnings.

## Running preview

- [Recruitment Performance](http://localhost:3000/dashboard?dashboardTab=performance)
- [Pipeline & Sources](http://localhost:3000/dashboard?dashboardTab=pipeline)
- [Login](http://localhost:3000/login)

The development server remains running on port 3000. Start command: `NEXT_DIST_DIR=next-local-dashboard-export-1004-compact pnpm dev --hostname 127.0.0.1 --port 3000` (set the environment variable using the host shell). Its fresh ignored output directory avoids OneDrive cache collisions; the production build ran with the dev server stopped. No database writes, commit, push or deployment were performed.
