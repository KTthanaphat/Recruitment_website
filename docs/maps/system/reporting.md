# SYS-REPORTING: Dashboard reports and exports

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Dashboard behavior](../../WEBSITE_STRUCTURE.md#dashboard-page). Visual work uses [Recruitment Performance](../../design/recruitment-performance.md) and [Controls](../../design/controls.md).

## Owners and search keys

Recruitment Performance overview: [RecruitmentPerformanceOverview.tsx](../../../src/components/dashboard/RecruitmentPerformanceOverview.tsx) owns filters and PNG capture; [PerformanceReport.tsx](../../../src/components/dashboard/PerformanceReport.tsx) and [scoped styles](../../../src/components/dashboard/performance.module.css) own the reference presentation; [recruitment-performance.ts](../../../src/lib/recruitment-performance.ts) owns calculations. It uses the dashboard company report feed; its controls, KPI cohort and three charts are specified by [Dashboard behavior](../../WEBSITE_STRUCTURE.md#dashboard-page). Focused coverage: [recruitment-performance.spec.ts](../../../tests/e2e/recruitment-performance.spec.ts) with the [reference fixture](../../../tests/e2e/support/performance-fixture.ts).

### F04: Dashboard report views, exports, and XLSX

- Overview Site/Department controls: [CommandMultiSelector.tsx](../../../src/components/ui/CommandMultiSelector.tsx) owns multiple selections and keyboard interaction; overview controller owns URL serialization and global scope.
- The shared priority scope uses [requisition-priority.ts](../../../src/lib/requisition-priority.ts); the [company report schema](../../../supabase/schemas/55_dashboard_report.sql) supplies `is_priority` in the authenticated report feed. The overview export metadata identifies an active priority scope.
- Chart help: [ReportHelp.tsx](../../../src/components/dashboard/ReportHelp.tsx) supplies viewport-contained hover/focus/tap tooltips for overview charts, Waterfall and [PipelineFunnel.tsx](../../../src/components/ui/PipelineFunnel.tsx). KPI definitions use accessible descriptions without a help control. Overview and Waterfall own independent expanded state; export surfaces remain complete when collapsed.

- Owner/search: [src/components/dashboard/VacancyWaterfallView.tsx](../../../src/components/dashboard/VacancyWaterfallView.tsx), [src/components/ui/Field.tsx](../../../src/components/ui/Field.tsx).
- Related symbols: shared DD/MM/YYYY picker; shared in-viewport 2× non-blank PNG capture; ExcelJS `TableStyleMedium2` workbook with hidden gridlines/wrapped body cells; canonical rules: [docs/WEBSITE_STRUCTURE.md](../../WEBSITE_STRUCTURE.md).
- Combined Waterfall/requisition panel and channel-stacked Pipeline Health: `VacancyWaterfallView.tsx`, `ui/PipelineFunnel.tsx`, and `lib/sourcing-colors.ts`; see [Dashboard behavior](../../WEBSITE_STRUCTURE.md#dashboard-page) and [dashboard checks](../../../tests/e2e/dashboard-reports.spec.ts).
- Entry: Calendar: `reportView` + `reportMonth`; Custom: `reportView=custom&start=<date>&end=<date>`.
- Custom defaults: [dates.ts](../../../src/lib/dates.ts) `previousSourcingReportingRange` uses the Bangkok sourcing-cycle Saturday; saved or edited custom dates take precedence. `buildWaterfall` filters empty columns for both screen and PNG.
- Verification: [dashboard-reports.spec.ts](../../../tests/e2e/dashboard-reports.spec.ts) includes report views, stage metrics and PNG downloads. A dedicated XLSX workbook-format test is not established by this index; inspect/add focused export assertions when that format changes.

## Dependency edges

| Edge | Target | Follow when |
| --- | --- | --- |
| `uses` | [SYS-PLATFORM](platform.md) | Date/month controls and language |
| `reads` | [SYS-RECORDS](records.md) | Requisition and Offer data |
| `reads` | [SYS-PIPELINE](pipeline.md) | Stage counts and rounds |

## Impact back-links

Use caller search for additional runtime dependencies.

If the task changes schema, environment or release state, cross to [Setup](../SETUP_MAP.md). For visual-only work remain in this system node and its design contract. Coverage names are search leads inherited from the feature index, not evidence that checks passed or that every named scenario has a dedicated file.
