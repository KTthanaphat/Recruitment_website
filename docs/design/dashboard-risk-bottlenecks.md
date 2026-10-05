# Vacancy Risk and Stage Bottlenecks

Behavior: [Dashboard](../WEBSITE_STRUCTURE.md#risk-and-bottleneck-subviews). Owners: [Reporting](../maps/system/reporting.md#risk-and-bottleneck-subviews). Shared [portal](dashboard-portal.md), [controls](controls.md) and [exports](dashboard-data-export.md). Accepted work: [work item](../work-items/dashboard-risk-bottlenecks/plan.md).

## References and hierarchy

The supplied [Risk reference](../work-items/dashboard-risk-bottlenecks/references/vacancy-risk.png) and [Bottleneck reference](../work-items/dashboard-risk-bottlenecks/references/stage-bottlenecks.png) guide composition; sample numbers and sparklines are calculated. Dashboard uses the system off-white canvas/dark blue sidebar, white panels, navy typography and assigned-profile accent, with restrained semantic status treatments. Shared fixed-color control exceptions remain. Header Site/PIC/Priority controls are visible inline with an always-visible scope summary. Keep compact common filters and accessible subview tabs above the report header.

`RiskReportFrame` provides static semantic heading, applied scope and Export; report content is always open. Reuse Prompt and system surface/border/small-shadow tokens: 12px panel corners/padding, 8px panel gaps, normal-weight filter values, aligned numbers and vertically centered controls. Status text accompanies color. Report heading 18px/600; section 16px/600; KPI 20px/600, open headcount 32px/600; body 12–13px; metadata 11px. Header padding is 8px vertical/12px horizontal. Remove circular heading/KPI surfaces; use 16–18px icons and 20px-high trends. All comparisons, dates and context stay visible and can wrap. [Controls](controls.md#fields-buttons-and-overlays) owns 32px desktop and 44px phone/coarse-pointer sizing.

## Vacancy layout

Desktop: one white summary surface with health and three drill-down metric blocks separated by quiet dividers, then distribution/attention columns, then full-width requisition list. Metric blocks retain hover/focus and pressed filter feedback; values are navy and semantic colors remain in indicators. Needs attention uses divided rows rather than individual cards. Action rows have a 40px desktop minimum, 4px vertical padding and natural growth for context. Health leads with open headcount, proportional known/unknown distribution, category counts and exposure denominator. KPI cards show real mini charts and explicit comparison dates. Distribution has grouping selector and keyboard-operable row drill-down; local filter chips stay beside the action list. Attention shows three priority risks; View all filters/focuses the list. An asterisk on SLA remaining links to one table remark for no-show restarts; the exact restart date remains available in a keyboard-accessible description. Tables scroll inside their surface rather than widening the page. Long names remain wrapped/accessible.

Container `risk-report` determines composition: at least 960px permits full summary and two analysis columns; 640–959px places health above three metric columns and stacks analysis; below 640px uses compact stacked risk rows. Values remain at 20/32px; chart/legend and action targets retain room. Header metadata wraps. Group/site and risk controls wrap with their labels.

## Stage layout

Screen Channel/snapshot and notices precede the primary banner; four KPI summary cards are omitted. PNG retains their values/context/trends/comparisons in a compact white strip. A white (#FFFFFF) primary-bottleneck banner with a 1px semantic amber/orange (#FF8A00) border shows calculated stage, waiting/share, median/P90/oldest and View candidates. Empty completed populations show explanatory text with the queue intact. Analysis panels show a shared duration axis (filled median / outlined P90) with N and small-sample tooltip, and queue bars/counts/oldest. The selected stage is highlighted in both panels.

Action status controls use pressed buttons with counts from the same dataset; search and Stage/PIC sit alongside on desktop and wrap on phones. Rows show every scoped position/PIC context, localized stage/status and Follow up. Twenty-row pages preserve readable density; exports render all filtered rows. Clear and removable chips expose local drill-down state. Historical limitations and unavailable-deadline notice stay visible. Dates/counts describe actual history; no sample insight text is hard-coded.

Analysis stacks below 960px report-container width; PNG-only Stage KPIs use four columns in the complete export surface. Below 1024px Dashboard shows the [desktop-required notice](mobile-navigation.md), without report content. Banner statistics wrap naturally. Duration/action tables have contained scrolling. Selector popovers and export modal stay inside 360/390px viewports. Subview tabs support arrows/Home/End; drill-down focuses the action heading; drawers/modal retain focus trapping and return.

## Ownership and verification

UI: `VacancyRiskView`, `StageBottleneckView`, `RiskReportFrame`, `risk-copy`, `risk-reports.module.css`. Calculations, loader and export symbols are linked once in [Reporting](../maps/system/reporting.md#risk-and-bottleneck-subviews). [Calculation/interaction checks](../../tests/e2e/dashboard-risk-bottlenecks.spec.ts), [compact presentation checks](../../tests/e2e/dashboard-compact.spec.ts) and [review](../work-items/dashboard-risk-bottlenecks/review.md) record evidence and limitations.

## Summary refinement

Vacancy Health places localized Open/headcount on two 12px/500 lines (16px line height), the 32px/600 total immediately beside them, and the SLA bar above its wrapping legend in the adjacent area. Exposure remains below. Risk cards order icon/title → 20px/600 fraction → 11px percentage/context → 20px trend → comparison. Overdue/Approaching use all open HC; Priority uses all open priority HC (including On track/Unknown). `0/0` has an unavailable percentage. Behavior owns the denominator definitions.

PNG-only Stage cards use the same title/value/context/trend/comparison hierarchy, retaining counts or days rather than inventing fractions. Both reports display Gregorian comparison ranges as `27/09 – 30/09/2026`, full years at both ends across years, or one complete date for a single day. Distribution alone shortens Approaching SLA to Approaching. Square-ended bars apply to distribution, queue and sparks; circles remain in legend and duration markers. Screen/PNG share banner/chart rules; Stage summary cards are PNG-only. The conditional SLA restart remark appears after all matching action rows in PNG; Excel numeric SLA/date fields remain typed.

Verification: [refinement suite](../../tests/e2e/dashboard-refinement.spec.ts). Delivery evidence: [review](../work-items/dashboard-risk-bottlenecks/review.md).

Screen/export and border checks: [Stage/mobile refinement](../../tests/e2e/stage-mobile-refinement.spec.ts). Mobile shell rules: [Mobile navigation](mobile-navigation.md).
