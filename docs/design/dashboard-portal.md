# Dashboard portal

Behavior: [Dashboard](../WEBSITE_STRUCTURE.md#dashboard-page). Owners: [Reporting](../maps/system/reporting.md). Controls: [shared controls](controls.md). Chart presentation: [Recruitment Performance](recruitment-performance.md).

## Navigation and common filters

`DashboardPortal` owns one common filter panel above a report tab strip. Its typed registry contains Recruitment Performance and Pipeline & Sources. Performance contains Performance / Vacancy & Requisitions / Risk & Aging; Pipeline contains Overview / Stage Bottlenecks. Fresh visits open Performance. Secondary tabs support arrows/Home/End for any number of children. All consume Period, Site, Department and Job Level. Keep future capability declarations explicit; unsupported filters are named beside the selected report. More than five report groups use a report selector.

Use normal 14px/400 selected values and choices, matching the original Performance Site multi-selector. Labels use 12px/500; report headings retain 18px/600. Shared selectors opt into `typography="normal"`; other callers keep their existing defaults. Preserve Prompt/Thai fallbacks, dropdown selection marks, blue edges and keyboard focus.

Calendar modes use one month/year picker; Custom uses two shared day selectors. Values remain ISO, dates display DD/MM/YYYY, and Bangkok determines today. Invalid Custom dates show an inline alert and a correction message in place of reports that support Period. Their export controls become unavailable until corrected; reports without Period support continue rendering.

The applied scope summary names dates, mode, Site, Department, Job Level, PIC and active Priority. An accessible scope-info button reveals it on hover, focus or tap; report headers retain the visible full context. Reset is a labeled icon beside scope info. Dashboard Reset affects dashboard filters within header scope. Changing a scope-dependent selection shows a short notice when unavailable selections are removed.

## Reports and responsiveness

Tabs support arrows, Home/End, selected state and visible focus. The filter panel remains in normal page flow when the active tab/subview changes. Reports have static semantic headers and remain open; the internal Waterfall breakdown retains its optional disclosure. Report groups retain their local state while hidden. Each visible report header repeats the effective scope.

Use a compact toolbar with 8px panel padding, closely stacked labels, 8px column gaps and 32px desktop controls/actions. Calendar modes form one row from laptop widths; Custom uses one row on wider desktops. Tablets use three columns; phones use two columns and full-width Custom dates. Phone/coarse-pointer controls and actions retain 44px targets. Month popovers align to the right edge on phones, and multi-select menus fit their field width. Keep internal tab-strip scrolling and no page overflow. Values truncate only where the complete value remains available; options wrap Thai/long labels.

Pipeline/Sources alone owns Channel and Channel legend. Their local toolbar uses a wrapping compact row, 12px/500 labels and aligned 32px desktop controls with 44px phone targets. Channel legend uses the [shared ON/OFF primitive](controls.md#shared-onoff-switch) and fixed system-blue tokens; toggling remains immediate and retains URL/session preferences and export metadata. Vacancy/Requisitions owns breakdown expansion, stage mode, table controls and export columns. Preserve the existing 3:2 Pipeline/Source composition, complete report PNG surfaces and selected-column XLSX/PNG behavior. Export metadata includes common scope and relevant local options.

## Verification

Dashboard uses the dark system sidebar and assigned-profile accent. Global Site/PIC/Priority are visible inline beside Language/Refresh/account controls, with visible scope text. Performance and Pipeline have accessible secondary tabs; controlled preferences own local drill-down state. [Risk/Bottlenecks](dashboard-risk-bottlenecks.md) owns the new layouts and empty/history states; canonical calculation rules remain in [Dashboard behavior](../WEBSITE_STRUCTURE.md#risk-and-bottleneck-subviews).

[Portal checks](../../tests/e2e/dashboard-portal.spec.ts) cover scope, date boundaries, legacy/canonical URLs, session navigation, reset, tab history and responsive language states. Existing [Performance](../../tests/e2e/recruitment-performance.spec.ts) and [report/export](../../tests/e2e/dashboard-reports.spec.ts) checks retain calculation and export coverage. Evidence is recorded in the [work-item review](../work-items/dashboard-configuration-redesign/review.md).

## Future report registration

Add a stable kebab-case ID, nonempty Thai/English labels and explicit capabilities to `BUILTIN_DASHBOARD_REPORTS`, then supply its renderer in `DashboardPortal`. Runtime validation rejects empty registries, duplicate/invalid IDs and duplicate/unknown capabilities. URL/session restoration reads the same catalog, including future IDs. Custom registries can be passed through the portal's `reports` prop for focused verification.

`DashboardReportNavigation` renders up to five tabs and a localized shared selector above five. Each panel has a persistent accessible label independent of navigation mode. Context scope, summary and dates follow the report capabilities; renderers must consume the controlled context instead of introducing duplicate filter state. Unsupported filters are visibly named without clearing their saved values. Header authorization always applies.

Checks: [registry and navigation](../../tests/e2e/dashboard-registry.spec.ts). Live verification: [reconciliation](../work-items/dashboard-configuration-redesign/reconciliation.md).


## Data export action

Performance and Pipeline & Sources use one shared compact Export chooser for PNG and Excel. Header/navigation behavior and common scope remain owned here; chooser geometry, workbook structure and source records are specified once in the [data-export contract](dashboard-data-export.md). Excel is organized into Summary Data and Source Data; section tables and the compact guide belong to the linked export contract.

## Compact system presentation

Dashboard uses the system dark blue sidebar in expanded/collapsed modes, the normal off-white canvas and assigned-profile accent. Inline outer-scope filters retain the Dashboard compact sizing and visible scope summary. The shell marker supplies placement, not a separate light theme; Sidebar collapse persistence/navigation are unchanged. Fixed dropdown, priority and switch tokens retain their exceptions. Compact buttons/triggers/tabs and touch sizing are owned once in [Controls](controls.md#fields-buttons-and-overlays). Existing report charts retain series colors and sizing; their actions opt into compact controls. New subviews follow [Risk/Bottlenecks](dashboard-risk-bottlenecks.md). Verification: [compact checks](../../tests/e2e/dashboard-compact.spec.ts).

## Navigation compatibility and data bars

Canonical Performance children use `performanceSubview=overview|vacancy|risk`; Pipeline retains `pipelineSubview=overview|bottlenecks`. Explicit groups without children open their default; explicit canonical children win. Old `dashboardTab=vacancy`/`vacancySubview` links and saved v1 selections migrate to Performance Vacancy/Risk while retaining their report period and local filters. Invalid children fall back. Canonical serialization removes legacy navigation/collapse flags; Back/Forward restores views and filters. Future registry IDs remain supported.

Dashboard data bars/tracks/segments/sparklines have square ends in screen and PNG. Preserve panel/control/badge/switch radii, legend dots and Median/P90 markers; shared non-Dashboard callers retain defaults. Verification: [navigation/summary refinement](../../tests/e2e/dashboard-refinement.spec.ts).
