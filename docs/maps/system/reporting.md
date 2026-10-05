# SYS-REPORTING: Dashboard reports and exports

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Dashboard behavior](../../WEBSITE_STRUCTURE.md#dashboard-page). Visual work uses [Recruitment Performance](../../design/recruitment-performance.md) and [Controls](../../design/controls.md).

## Owners and search keys

### Common dashboard portal

Compact toolbar sizing: `.dashboard-filter-toolbar` / `.dashboard-filter-actions` in [globals.css](../../../src/app/globals.css). Scope-info presentation reuses [ReportHelp.tsx](../../../src/components/dashboard/ReportHelp.tsx); geometry belongs to the [portal contract](../../design/dashboard-portal.md).

[DashboardPortal.tsx](../../../src/components/dashboard/DashboardPortal.tsx) owns report renderers, common controls, scope and session/URL coordination. [dashboard-filters.ts](../../../src/lib/dashboard-filters.ts) owns types, dates, legacy restoration and canonical serialization. [RecruitmentPerformanceOverview.tsx](../../../src/components/dashboard/RecruitmentPerformanceOverview.tsx) consumes context and owns PNG capture; [PerformanceReport.tsx](../../../src/components/dashboard/PerformanceReport.tsx) and [scoped styles](../../../src/components/dashboard/performance.module.css) own chart presentation; [recruitment-performance.ts](../../../src/lib/recruitment-performance.ts) owns calculations. Canonical behavior: [Dashboard](../../WEBSITE_STRUCTURE.md#dashboard-page). Design: [Portal](../../design/dashboard-portal.md), [Performance](../../design/recruitment-performance.md). Checks: [portal](../../../tests/e2e/dashboard-portal.spec.ts), [Performance](../../../tests/e2e/recruitment-performance.spec.ts) and [reference fixture](../../../tests/e2e/support/performance-fixture.ts).

### F04: Dashboard report views, exports, and XLSX

- Channel legend presentation: [OnOffSwitch.tsx](../../../src/components/ui/OnOffSwitch.tsx); shared states and tokens: [Platform controls](platform.md#owners-and-search-keys).
- Common Site/Department/Level controls: [CommandMultiSelector.tsx](../../../src/components/ui/CommandMultiSelector.tsx) owns multiple selections and keyboard interaction; [shared dropdown tokens](../../design/controls.md#dropdown-box) own presentation; DashboardPortal owns URL serialization and common/header scope.
- The shared priority scope uses [requisition-priority.ts](../../../src/lib/requisition-priority.ts); the [company report schema](../../../supabase/schemas/55_dashboard_report.sql) supplies `is_priority` in the authenticated report feed. The overview export metadata identifies an active priority scope.
- Chart help: [ReportHelp.tsx](../../../src/components/dashboard/ReportHelp.tsx) supplies viewport-contained hover/focus/tap tooltips for overview charts, Waterfall and [PipelineFunnel.tsx](../../../src/components/ui/PipelineFunnel.tsx). KPI definitions use accessible descriptions without a help control. Report headers are static; Waterfall retains its internal breakdown disclosure and complete export surfaces.

- Owner/search: [src/components/dashboard/VacancyWaterfallView.tsx](../../../src/components/dashboard/VacancyWaterfallView.tsx), [src/components/ui/Field.tsx](../../../src/components/ui/Field.tsx).
- Related symbols: shared DD/MM/YYYY picker; shared in-viewport 2× non-blank PNG capture; ExcelJS `TableStyleMedium2` workbook with hidden gridlines/wrapped body cells; canonical rules: [docs/WEBSITE_STRUCTURE.md](../../WEBSITE_STRUCTURE.md).
- Combined Waterfall/requisition panel, selectable channel export columns, 3:2 Pipeline/Source layout, responsive Source details, and 16:9 PNG: [VacancyWaterfallView.tsx](../../../src/components/dashboard/VacancyWaterfallView.tsx), [SourceEffectiveness.tsx](../../../src/components/dashboard/SourceEffectiveness.tsx), [PipelineFunnel.tsx](../../../src/components/ui/PipelineFunnel.tsx), and [channel colors](../../../src/lib/sourcing-colors.ts); contract: [Dashboard behavior](../../WEBSITE_STRUCTURE.md#dashboard-page); checks: [dashboard reports](../../../tests/e2e/dashboard-reports.spec.ts).
- Entry: common `dashboardPeriod`/`dashboardMonth` or `dashboardStart`/`dashboardEnd`; legacy report/overview/funnel links restore through dashboard-filters.
- Custom defaults: [dates.ts](../../../src/lib/dates.ts) `previousSourcingReportingRange` uses the Bangkok sourcing-cycle Saturday; saved or edited custom dates take precedence. `buildWaterfall` filters empty columns for both screen and PNG.
- Verification: [dashboard-reports.spec.ts](../../../tests/e2e/dashboard-reports.spec.ts) includes report views, stage metrics and PNG downloads. Requisition XLSX column tests remain in that suite; new Performance/Pipeline workbook checks are indexed under Dashboard data exports.

## Dependency edges

### Risk and bottleneck subviews

- UI/render: [VacancyRiskView](../../../src/components/dashboard/VacancyRiskView.tsx), [StageBottleneckView](../../../src/components/dashboard/StageBottleneckView.tsx), [RiskReportFrame](../../../src/components/dashboard/RiskReportFrame.tsx), [localized copy](../../../src/components/dashboard/risk-copy.ts), [scoped styles](../../../src/components/dashboard/risk-reports.module.css).
- Models: [vacancy-risk-report](../../../src/lib/vacancy-risk-report.ts) `buildVacancyRiskReport`, `vacancyRiskAt`, `riskTotals`, `riskGroups`, `riskRowMatches`; [stage-bottleneck-report](../../../src/lib/stage-bottleneck-report.ts) `buildStageBottleneckReport`, `normalizeStageInstances`, `stageSnapshot`, `percentile`; [calendar/history](../../../src/lib/dashboard-history.ts) `bangkokDay`, `historicalVacancy`, `observationDates`.
- Reads/hydration: [dashboard-report-loader](../../../src/lib/dashboard-report-loader.ts) `readReportPages`, `loadExtendedDashboardReport`, `hydrateReportCandidate`, `clearDashboardReportCache`; [RecruitmentWorkspace](../../../src/components/RecruitmentWorkspace.tsx) detail callbacks; [DashboardPortal](../../../src/components/dashboard/DashboardPortal.tsx) atomic publication, retry and limited drawer.
- Export: [risk-bottleneck-export](../../../src/lib/risk-bottleneck-export.ts) `buildRiskExport`, `buildBottleneckExport`; [shared workbook](../../../src/lib/dashboard-workbook.ts) `ReportExportSnapshot`, `createDashboardWorkbook`.
- State: [dashboard-filters](../../../src/lib/dashboard-filters.ts) `DashboardPreferences`, `restoreDashboardPreferences`, `dashboardUrlValues`; entry `performanceSubview=risk` / `pipelineSubview=bottlenecks` (legacy Vacancy migration in dashboard-filters).
- Contracts: [canonical behavior](../../WEBSITE_STRUCTURE.md#risk-and-bottleneck-subviews), [design](../../design/dashboard-risk-bottlenecks.md), [workbooks](../../design/dashboard-data-export.md#risk-and-bottleneck-workbooks). Verification: [focused suite](../../../tests/e2e/dashboard-risk-bottlenecks.spec.ts), [review](../../work-items/dashboard-risk-bottlenecks/review.md). Extends F04; no new inventory ID.

| Edge | Target | Follow when |
| --- | --- | --- |
| `uses` | [SYS-PLATFORM](platform.md) | Date/month controls and language |
| `reads` | [SYS-RECORDS](records.md) | Requisition and Offer data |
| `reads` | [SYS-PIPELINE](pipeline.md) | Stage counts and rounds |

## Impact back-links

Use caller search for additional runtime dependencies.

If the task changes schema, environment or release state, cross to [Setup](../SETUP_MAP.md). For visual-only work remain in this system node and its design contract. Coverage names are search leads inherited from the feature index, not evidence that checks passed or that every named scenario has a dedicated file.

## Future reports and live reconciliation

- [dashboard-report-registry.ts](../../../src/lib/dashboard-report-registry.ts): `BUILTIN_DASHBOARD_REPORTS`, `validateDashboardReports`, `dashboardNavigationKind`; stable identities/capabilities shared with URL restoration.
- [DashboardReportNavigation.tsx](../../../src/components/dashboard/DashboardReportNavigation.tsx): `DashboardReportNavigation`; five-tab/six-selector navigation and keyboard focus.
- [dashboard-filters.ts](../../../src/lib/dashboard-filters.ts): `dashboardEffectivePreferences`, `scopeDashboardRequisitions`, `dashboardReportRange`; per-report effective scope within header authorization.
- [RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx): authorized `priorityData.offers` supplies candidate-linked Source input; company report offers remain anonymized.
- [registry checks](../../../tests/e2e/dashboard-registry.spec.ts), [report checks](../../../tests/e2e/dashboard-reports.spec.ts), [live reconciliation and SQL](../../work-items/dashboard-configuration-redesign/reconciliation.md). Canonical movement rules remain in [Dashboard behavior](../../WEBSITE_STRUCTURE.md#dashboard-page).

## Dashboard data exports

- Contract/schema: [data export](../../design/dashboard-data-export.md); canonical behavior: [Dashboard](../../WEBSITE_STRUCTURE.md#dashboard-page).
- [DashboardExportChooser.tsx](../../../src/components/dashboard/DashboardExportChooser.tsx): `DashboardExportChooser`, single PNG/Excel action, preparation lock/error/focus.
- [dashboard-workbook.ts](../../../src/lib/dashboard-workbook.ts): `ReportExportSnapshot`, `DashboardSheetSpec`, `DashboardTableSpec`, `compactSheets`, `buildPerformanceExportSnapshot`, `buildPipelineExportSnapshot`, `createDashboardWorkbook`, `downloadDashboardWorkbook`.
- [pipeline-report.ts](../../../src/lib/pipeline-report.ts): `buildPipelineReport`, funnel/source rows and canonical stage/hire/sourcing contributions. [dashboard-report-eligibility.ts](../../../src/lib/dashboard-report-eligibility.ts): `isReportEligible`, `requisitionSnapshotAt`; shared Vacancy/Pipeline historical population.
- [recruitment-performance.ts](../../../src/lib/recruitment-performance.ts): `buildPerformanceReport`, `PerformanceRequisitionContribution`, `PerformanceAcceptanceContribution`; KPI/chart and workbook reconciliation.
- [workbook checks](../../../tests/e2e/dashboard-data-export.spec.ts), existing [report/PNG checks](../../../tests/e2e/dashboard-reports.spec.ts), [Performance checks](../../../tests/e2e/recruitment-performance.spec.ts), [acceptance review](../../work-items/dashboard-data-export/review.md).

## Compact Dashboard presentation

- Report owners: DashboardPortal, DashboardReportNavigation, report action callers, Risk/Bottlenecks scoped styles and RiskReportFrame. Shared geometry/theme owners: [Platform compact presentation](platform.md#compact-dashboard-presentation).
- Contracts: [Controls](../../design/controls.md#fields-buttons-and-overlays), [portal](../../design/dashboard-portal.md#compact-system-presentation), [new reports](../../design/dashboard-risk-bottlenecks.md). Checks: [compact geometry/theme/layout](../../../tests/e2e/dashboard-compact.spec.ts); [review](../../work-items/dashboard-risk-bottlenecks/review.md).

## Dashboard navigation and summary refinement

- Navigation/state: DashboardPortal / dashboard-filters / dashboard-report-registry; header: AppShell; cards: PerformanceReport / VacancyRiskView / StageBottleneckView / RiskReportFrame.
- Model/export: vacancy-risk-report `RiskTotals.priorityOpen`, `riskTotals`; risk-bottleneck-export `buildRiskExport`; dates: [format.ts](../../../src/lib/format.ts) `formatCompactDateRange`.
- Contracts: [portal](../../design/dashboard-portal.md#navigation-compatibility-and-data-bars), [Risk summaries](../../design/dashboard-risk-bottlenecks.md#summary-refinement), [export denominators](../../design/dashboard-data-export.md#risk-summary-denominators).
- Checks: [refinement](../../../tests/e2e/dashboard-refinement.spec.ts), [portal](../../../tests/e2e/dashboard-portal.spec.ts), [registry](../../../tests/e2e/dashboard-registry.spec.ts); evidence: [review](../../work-items/dashboard-risk-bottlenecks/review.md).

## Stage screen and PNG refinement

- Owners: [StageBottleneckView](../../../src/components/dashboard/StageBottleneckView.tsx) `render(exportMode)`; [risk styles](../../../src/components/dashboard/risk-reports.module.css) `bottleneckBanner`; [export chooser](../../../src/components/dashboard/DashboardExportChooser.tsx) interaction lock.
- Contracts/checks: [Stage layout](../../design/dashboard-risk-bottlenecks.md#stage-layout), [export distinction](../../design/dashboard-data-export.md#stage-screen-and-export-distinction), [Stage/mobile checks](../../../tests/e2e/stage-mobile-refinement.spec.ts).
