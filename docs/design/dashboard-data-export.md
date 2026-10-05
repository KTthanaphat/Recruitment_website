# Dashboard data export contract

Behavior: [Dashboard](../WEBSITE_STRUCTURE.md#dashboard-page). Navigation/header: [portal](dashboard-portal.md). Chart presentation: [Performance](recruitment-performance.md). Owners/checks: [Reporting](../maps/system/reporting.md#dashboard-data-exports).

## Risk and bottleneck workbooks

Owner: [risk-bottleneck-export.ts](../../src/lib/risk-bottleneck-export.ts), `buildRiskExport` / `buildBottleneckExport`; visual contracts and calculation rules are linked from [Risk/Bottlenecks](dashboard-risk-bottlenecks.md). Both retain exactly two localized sheets and the shared compact formatting/guide/jump links below.

| Workbook | Summary Data section IDs | Source Data section IDs |
| --- | --- | --- |
| `vacancy-risk-{asOf}.xlsx` | `metrics`, `groups`, `trends`, `readme` | `requisitions`, `coverage` |
| `stage-bottlenecks-{start}-to-{asOf}.xlsx` | `metrics`, `stats`, `primary`, `trends`, `readme` | `instances`, `waiting` |

Risk source grain is requisition/period: readable scope, approved/open/covered HC, risk category, SLA start/restart/deadline, age/remaining, Priority and visible-action flag. Coverage source grain is offer/period: accepted/reopened dates, capped covered contribution and exclusion reason. Summary metrics retain Current/Prior/change; grouped category counts and exposure reconcile with current requisitions; trends retain dated snapshots.

Bottleneck source grain is normalized attempt: authorized candidate ID/name, stage/round, entry/outcome/result/duration, current/prior contribution flags, exclusion reason and all scoped requisition IDs. Waiting grain is candidate/period: wait, reliable due date or blank, status, full scoped position/site/department/PIC context, visible-action flag and conflict flag. Current/Prior queues reconcile independently. Stage summary retains six rows, N, median/P90, waiting/oldest; primary and trend sections use the same calculation model as the screen.

Scope includes common/header selections, snapshot/activity/comparison dates, Channel and local detail filters. Local inclusion flags retain all records needed for headline reconciliation. Migration exclusions localize in Thai/English. All IDs are text, dates typed, missing values blank and percentages exact with display formatting; the guide explains grain, calendar days, interpolation, access and historical limitations.

## Export chooser

Recruitment Performance and Pipeline & Sources each expose one compact Export action with the shared download icon. Its shared Modal shows effective scope, a short workbook description, PNG image and Excel workbook actions. The description identifies the two sheets: Summary Data and Source Data. Pipeline scope includes Channel and legend state. Actions retain 44px minimum targets; the header keeps existing desktop sizing and wraps on phones. The chooser is in the static, always-open report header, traps keyboard focus and returns focus to its trigger.

Generation captures the selected report and keeps the chooser open/locked: repeated actions, Close and Escape cannot interrupt preparation. Localized PNG/Excel progress uses a live status. Success closes the chooser after initiating download; failure retains it with an inline alert and retry. Invalid ranges suppress report export; valid empty datasets export headers and zero-valued summary frames.

## Workbook schema

The same chooser also serves independent Vacancy Risk and Stage Bottleneck exports. See [new report layout](dashboard-risk-bottlenecks.md) and [new workbook sections](#risk-and-bottleneck-workbooks). PNG uses a frozen export-only render with all matching action rows, including rows beyond the screen's page.

Each workbook has exactly two sheets, in order: **Summary Data** and **Source Data** (Thai: **ข้อมูลสรุป**, **ข้อมูลต้นทาง**). Tables are stacked vertically within their owning sheet; section titles and row-4 internal jump links provide navigation. Summary Data contains the summary tables and an initially collapsed Read Me guide at the end. Source Data contains all contribution/detail tables. No data or access rules change during consolidation.

Titles/headers localize in Thai/English. Internal table IDs remain ASCII and stable. Every section starts in column B with a labeled title followed by an Excel table using TableStyleMedium2, filters and stripes. Five frozen top rows retain the sheet title, effective scope and navigation. Columns use compact 18–26 character widths, cells use Sarabun 10, wrapped text and vertical centering, and row heights expand for long values. Per-cell formats prevent one stacked table from changing another table's numeric/date display. The guide's rows can be expanded with Excel outline controls. Counts are numeric integers; rates preserve exact fractions with percent display formats; average days display one decimal. KPI rate changes are numeric percentage points. Dates are Excel dates displayed DD/MM/YYYY; confirmation timestamps display Bangkok local time. IDs and formula-like names remain literal strings. Unavailable values are blank. No formulas, macros, embedded PNGs or external workbook links are added.

### Recruitment Performance

Filename: `recruitment-performance-{start}-to-{end}.xlsx`.

| Section | Sheet | Grain / columns |
| --- | --- | --- |
| Read Me | Summary Data | Field/value guide: effective scope, generation time, mode/dates, header Site/PIC/Priority, common selections, comparison dates, identity availability, metric definitions and section directory |
| KPI Summary | Summary Data | Metric, current/prior values, absolute change, unit, current/prior start/end; four visible KPIs plus retained AVG Time-to-Fill, Open, on-time, late and unknown SLA |
| Site & Level | Summary Data | Period, Row Type, Site, band, vacancies, filled, open, filled percentage |
| Vacancy Mix | Summary Data | Period, Row Type, band, New, Replacement, vacancies, cumulative share |
| SLA | Summary Data | Period, Row Type, Site, band, on-time, late, unknown SLA, assessed fills, SLA percentage |
| Requisitions | Source Data | Period, requisition context, band/type/status, vacancy/fill/open and SLA contributions, time-to-fill day total and contributing offer count |
| Acceptances | Source Data | Period, offer ID, requisition context, candidate ID/name/identity-available flag, acceptance/working/confirmation dates, within-range/effective/count flags, SLA, days, time contribution and counting explanation |

Requisition context means ID, Site, Department, Section, Position, Level, PIC, Priority, PR approval date and approved headcount. Summary chart tables contain Current and Comparison populations; standard bands and scoped site axes remain visible with zero counts. Unknown follows standard bands. Marked Total rows prevent accidental double summation. Filter Row Type to Detail before summing.

Acceptances retain related valid accepted offers for eligible requisitions, including historical/outside-range context. Contribution flags distinguish counted, outside range, no-show and headcount cap. Sum contribution columns, not record count. Authorized candidate identity is joined by requisition/offer ID against operational offers and candidate records; unavailable identity stays blank without removing aggregate contribution. Read Me explains effective fills and comparison ranges.

### Pipeline & Sources

Filename: `pipeline-sources-{start}-to-{end}.xlsx`.

| Section | Sheet | Grain / columns |
| --- | --- | --- |
| Read Me | Summary Data | Field/value guide, effective scope/dates, Channel, legend state, identity limits, counting definitions and section directory |
| Pipeline Summary | Summary Data | Every stage, count, conversion against preceding stage, yield against Applicants |
| Pipeline Channels | Summary Data | Every stage/channel count and share; independent of legend visibility |
| Source Summary | Summary Data | Visible channel, Applicants, Phone, Hired, each measure's composition share, Phone/Applicants, Hired/Phone and Hired/Applicants |
| Requisitions | Source Data | Requisition context, request type and scoped sourcing-group IDs |
| Stage Records | Source Data | Activity ID, candidate ID/name, raw/display channel, group/eligible requisition IDs, stage/round, entry/outcome/effective dates, result, Resume/passed-stage/Source Phone contributions |
| Hire Records | Source Data | Offer/candidate identity, requisition/group context, raw/display channel, acceptance/working/start-confirmation state, distinct-hire contribution |
| Sourcing Rows | Source Data | Group ID/name, related eligible requisition IDs, scoped sites/departments, stored week date, displayed reporting start/end, channel, recorded Applicants and Applicants contribution |

Canonical in-range activity excludes superseded rows. Earliest effective activity date then activity ID determines a distinct stage contribution; Resume means entering Phone Screen regardless of result. Earliest acceptance then offer ID determines one historical Hired contribution per candidate, including no-shows. A shared sourcing group appears once per saved week/channel; null recorded counts stay blank and contribute zero. Filtering uses the stored week date, matching the screen; displayed sourcing weeks use the preceding seven-day range.

Independent weekly sourcing and dated candidate activity can produce ratios above 100%; numeric values are never capped. Channel filters apply to all Pipeline/Source summary and source sheets; the requisition table records the same eligible population used by that calculation.

## Ownership and verification

[dashboard-workbook.ts](../../src/lib/dashboard-workbook.ts) owns snapshot/sheet/table contracts, localization, typed cells and lazy ExcelJS download. [pipeline-report.ts](../../src/lib/pipeline-report.ts) and [recruitment-performance.ts](../../src/lib/recruitment-performance.ts) produce summary and contribution records. [DashboardExportChooser.tsx](../../src/components/dashboard/DashboardExportChooser.tsx) owns format selection/locking/errors. [dashboard-report-eligibility.ts](../../src/lib/dashboard-report-eligibility.ts) shares existing Vacancy/Pipeline eligibility and historical state.

[Workbook checks](../../tests/e2e/dashboard-data-export.spec.ts) reopen actual downloads and reconcile records, types, identity limits, localization, empty periods, failure/retry and preparation locking. Existing report suites retain PNG/metric regressions. [Work-item review](../work-items/dashboard-data-export/review.md) records actual verification and live boundaries.

New-report PNG surfaces use the compact system presentation in [Risk/Bottlenecks](dashboard-risk-bottlenecks.md), including all matching action rows. This visual refinement does not change workbook sheets, values or counting flags.

### Risk summary denominators

Risk metrics retain Current/Prior/Change and add numeric Current denominator/share and Prior denominator/share for Overdue, Approaching and Priority at risk. Open priority headcount is an additional metric. Source requisition Open headcount/ Priority flags reproduce its denominator; shares remain numeric with `0.0%` format, unavailable denominators produce blank shares. Distribution uses Approaching as its short column label. Exactly two worksheets and existing source-date/remaining-day cell types remain unchanged. The new screen/PNG SLA star has no effect on numeric XLSX cells. AVG Time-to-Fill stays in Performance Excel despite its card removal.

### Stage screen and export distinction

Stage Bottlenecks omits the four summary cards from the page; PNG retains counts/durations, trends/comparisons. Both use the white amber-bordered primary banner. Excel keeps all summary/source tables and exactly two sheets. [Visual contract](dashboard-risk-bottlenecks.md#stage-layout); [checks](../../tests/e2e/stage-mobile-refinement.spec.ts).
