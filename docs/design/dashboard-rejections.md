# Rejection analytics

Canonical calculations/access: [Rejection analytics behavior](../WEBSITE_STRUCTURE.md#rejection-analytics). Owners/checks: [Reporting](../maps/system/reporting.md#rejection-analytics). Shared navigation: [Portal](dashboard-portal.md). Workbooks: [Export contract](dashboard-data-export.md#rejection-analytics).

## Compact composition

Dashboard → Pipeline & Sources → Rejections retains common/header scope, desktop access from 1024px and the existing desktop-required notice below it. Reading order: summary → filters → reasons → stages/trend → records. Preserve Prompt typography, current text sizes, site accent and shared focus/surface patterns.

Use 8px section/column gaps, 12px panel/metric padding, 4px metric gaps and 8px heading spacing. Bars use 4px gaps/padding. Records retain explicit readable column widths and internal horizontal scrolling, with 6px vertical cell padding and 1.5 line height; allow full values to wrap naturally. Keep 25 rows per page. Report controls opt into the existing 32px desktop / 44px coarse-pointer compact pattern; shared controls elsewhere are unchanged.

## Reason explorer

A labeled Treemap / Bars switch persists via rejectionReasonView in URL/session, defaulting to Treemap for missing/invalid values. Treemap is one full-width panel. Bars restores the compact 3:2 main/detail composition, stacking below 950px report width. Its first ten main reasons retain shares of the complete selected population.

Treemap starts at All main reasons; selecting a rectangle sets Main, clears Detail, resets pagination and drills into the details. Selecting a detail toggles that filter while retaining sibling rectangles. The breadcrumb clears Main/Detail to return. View changes preserve filters; Clear report filters preserves the view. Actor changes clear Main/Detail as before.

The chart names its comparison total and percentage denominator explicitly. The selected report total may be smaller after selecting a detail. Exact population rules are owned by the canonical behavior section, not this visual contract.

Rectangles use deterministic squarified layout, descending count then stable reason key, without a new chart framework. Area remains exactly proportional, including tiny categories. Colors are stable actor-related shades; labels/count/share appear when space permits. Full label, actor, count and comparison share appear on hover/focus. Native buttons support Enter/Space, selected state and visible focus. An accessible expandable reason directory exposes every value and selection; tiny targets never inflate chart geometry. Chart height is 280px wide / 320px in narrower desktop report containers.

Preserve saved bilingual labels and Unclassified. Handle no comparison events with an explanatory state and existing clear/breadcrumb controls; one reason fills the chart. Long Thai labels wrap/clip inside rectangles but remain complete in the tooltip and directory.

## Stage, trend, records and feedback

Stage distribution and trend retain actor colors/labels. Weekly trends name Saturday–Friday and show complete dates in tooltips; canonical behavior owns bucket rules. Stage order, sorting, pagination, application-aware read-only Candidate Detail, loading/retry and historical diagnostics retain their existing contracts. No edit, reason-administration or letter-delivery actions are added.

## Export presentation

PNG freezes the active view, scope, breadcrumb, comparison total and selected detail, expands all reason-directory values and all selected records across pagination, and waits for measured treemap geometry before capture. Excel keeps selected-report tables and adds a separately labeled comparison summary and supporting event ledger on the existing two worksheets. Both populations reconcile independently; see the export contract.

Verification evidence: [implementation record](../work-items/rejection-dashboard/implementation.md).
