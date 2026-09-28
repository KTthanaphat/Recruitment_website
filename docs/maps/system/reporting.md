# Dashboard reporting owners

Behavior: [Dashboard page](../../WEBSITE_STRUCTURE.md#dashboard-page). Presentation: [Recruitment Performance](../../design/recruitment-performance.md).

- [RecruitmentPerformanceOverview.tsx](../../../src/components/dashboard/RecruitmentPerformanceOverview.tsx): filters, URL state, global scope and complete PNG capture.
- [PerformanceReport.tsx](../../../src/components/dashboard/PerformanceReport.tsx) and [styles](../../../src/components/dashboard/performance.module.css): KPI cards and reference-style charts.
- [recruitment-performance.ts](../../../src/lib/recruitment-performance.ts): ranges, prior ranges, eligible headcount, accepted fills and SLA calculations.
- [CommandMultiSelector.tsx](../../../src/components/ui/CommandMultiSelector.tsx): Site/Department selections and keyboard interaction.
- [ReportHelp.tsx](../../../src/components/dashboard/ReportHelp.tsx): localized chart tooltips; KPI definitions use accessible descriptions without corner help controls.
- [VacancyWaterfallView.tsx](../../../src/components/dashboard/VacancyWaterfallView.tsx): existing Waterfall, active requisitions and independent exports; collapsible sections retain state.
- [recruitment-performance.spec.ts](../../../tests/e2e/recruitment-performance.spec.ts) and [fixture](../../../tests/e2e/support/performance-fixture.ts): calculation, filter, responsive layout and PNG coverage.
