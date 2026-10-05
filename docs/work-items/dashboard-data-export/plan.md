# Dashboard data export — accepted implementation order

User approved direct delivery on 2026-10-04: Excel XLSX plus the existing PNG, one Export chooser per report, all summary/readable-detail tables in two sheets per workbook, authorized candidate name and ID, local unpushed delivery. No SQL change is expected; any necessary feature-specific SQL goes to `mppnlkldlctvketcsald` first. Preserve prior dashboard/Configuration and unrelated SQL/migration edits.

Follow-up: the user requested a more compact workbook with one summary sheet and one source sheet. Consolidate the existing tables without dropping fields or changing calculations.

## Acceptance

- Recruitment Performance: **Summary Data** and **Source Data**, including current/comparison KPIs and chart datasets, eligible requisition contributions and accepted-offer contributions.
- Pipeline & Sources: **Summary Data** and **Source Data**, including every stage, channel breakdown, Source summary, eligible requisitions, canonical activity contributions, distinct historical hires and saved group/week/channel sourcing rows.
- One compact PNG/Excel chooser, usable when collapsed; locked while preparing, visible failure and retry, keyboard/focus restoration, bilingual phone layout.
- Screen, PNG and Excel share calculations. Source contributions reconcile; authorized identity only, no contact fields or free-text notes. Excel values remain typed/literal and exports use a captured snapshot.
- Focused workbook/browser regression checks, typecheck, production build, documentation checker and read-only authenticated live downloads. Leave localhost running; no push.

Exact workbook schema: [export contract](../../design/dashboard-data-export.md). Canonical rules: [Dashboard behavior](../../WEBSITE_STRUCTURE.md#dashboard-page). Owner routing: [Reporting](../../maps/system/reporting.md). Results: [review](review.md).
