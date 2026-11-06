# SYS-REPORTING: Dashboard reports and exports

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Dashboard behavior](../../WEBSITE_STRUCTURE.md#dashboard-page). Visual work uses [Recruitment Performance](../../design/recruitment-performance.md) and [Controls](../../design/controls.md).

## Owners and search keys

### Common dashboard portal

Compact toolbar sizing: `.dashboard-filter-toolbar` / `.dashboard-filter-actions` in [globals.css](../../../src/app/globals.css). Scope-info presentation reuses [ReportHelp.tsx](../../../src/components/dashboard/ReportHelp.tsx); geometry belongs to the [portal contract](../../design/dashboard-portal.md).

[DashboardPortal.tsx](../../../src/components/dashboard/DashboardPortal.tsx) owns report renderers, common controls, scope and session/URL coordination. [dashboard-filters.ts](../../../src/lib/dashboard-filters.ts) owns types, dates, legacy restoration and canonical serialization. [RecruitmentPerformanceOverview.tsx](../../../src/components/dashboard/RecruitmentPerformanceOverview.tsx) consumes context and owns PNG capture; [PerformanceReport.tsx](../../../src/components/dashboard/PerformanceReport.tsx) and [scoped styles](../../../src/components/dashboard/performance.module.css) own chart presentation; [recruitment-performance.ts](../../../src/lib/recruitment-performance.ts) owns calculations. Canonical behavior: [Dashboard](../../WEBSITE_STRUCTURE.md#dashboard-page). Design: [Portal](../../design/dashboard-portal.md), [Performance](../../design/recruitment-performance.md). Checks: [portal](../../../tests/e2e/dashboard-portal.spec.ts), [Performance](../../../tests/e2e/recruitment-performance.spec.ts) and [reference fixture](../../../tests/e2e/support/performance-fixture.ts).

Summary RPCs and typed 30-second cache: [dashboard-summary-client.ts](../../../src/lib/dashboard-summary-client.ts). [61_dashboard_summaries.sql](../../../supabase/schemas/61_dashboard_summaries.sql) owns compact versioned report/Home/Sourcing summaries, Home quality/work-queue pages, calendar event pages, and database-wide Site/Department/PIC-owner options. [64_home_welcome_summaries.sql](../../../supabase/schemas/64_home_welcome_summaries.sql) adds the separate `app_home_welcome_summary_v1()` and `app_home_banner_summary_v1(p_scope)` aggregates: the first follows the current profile's authorized responsibility/PIM population; the second follows the selected header Site/PIC/priority scope and preserves the legacy banner month-capacity/numerator rules. They do not return row ledgers. Summary DTOs contain aggregates, trends, groupings and filter options, not contribution ledgers. Cache keys include project/client and authenticated profile/access scope; refresh and mutation paths invalidate or bypass stale summaries. Export screens fetch complete, count-verified source ledgers only after an export action and fail the download when any page/read is incomplete. Home rows remain separately paged. Calendar requests are limited to 62 inclusive dates and use 200-row `(date,id)` cursor pages; the client exhausts pages and rejects repeated IDs/cursors before publishing. Sourcing charts use full lifecycle aggregates plus selected-group stage/channel data instead of the paged list. SQL rehearsals: [rehearse-dashboard-summaries.cjs](../../../scripts/rehearse-dashboard-summaries.cjs), [rehearse-home-welcome-summaries.cjs](../../../scripts/rehearse-home-welcome-summaries.cjs), with report fixture [dashboard-summaries.json](../../../tests/db/fixtures/dashboard-summaries.json).

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

- The Bottlenecks action queue loads independently of charts and resolves Auto against the full authorized waiting population before applying queue filters. The summary reuses scoped inputs for current, prior, and trend windows. The Active Requisitions page enriches only the selected keys when sort and membership can be decided from requisition fields.

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

## Application-aware reporting

[applications.ts](../../../src/lib/applications.ts) supplies journey keys and assignment attribution to [pipeline-report](../../../src/lib/pipeline-report.ts), [stage-bottleneck-report](../../../src/lib/stage-bottleneck-report.ts), [sourcing-stage-channels](../../../src/lib/sourcing-stage-channels.ts), report hydration and export callers. Counting contract: [Independent candidates](../../WEBSITE_STRUCTURE.md#independent-candidate-profiles). Drilldowns pass `applicationId`; search `assignmentGroup`, `reassignments`, `applicationKey`. Evidence: [feature record](../../work-items/independent-candidate-applications/implementation.md).

## Candidate profile privacy

Candidate hydration/exports retain RLS; masked summaries remain separate from full report profiles and never supply private contacts or notes. Creator status grants no additional journey/report scope. [Capability owner](pipeline.md#creator-privacy-and-profileapplication-layout), [SQL verification](../../../tests/db/candidate-profile-contract.sql).

## Rejection analytics

- Rejection rows and charts load and retry independently. The first page has interactive priority and uses the same debounced report scope as the charts. Returning without a known cursor opens page one. Rejection SQL restricts failure history before authorization and reuses requisition context by resolved group.

- UI/localization: [RejectionDashboardView](../../../src/components/dashboard/RejectionDashboardView.tsx), [copy](../../../src/components/dashboard/rejection-copy.ts), [styles](../../../src/components/dashboard/rejections.module.css); search RejectionDashboardView, data-rejection-metric.
- Calculation: [rejection-report](../../../src/lib/rejection-report.ts), buildRejectionReport / sortRejectionEvents; uses normalized stage attempts and outcome assignment history. Complete reads: dashboard-report-loader stageColumns. Navigation/state: DashboardPortal / dashboard-filters, pipelineSubview=rejections, rejectionActor/rejectionMain/rejectionPage.
- Exports: [rejection-export](../../../src/lib/rejection-export.ts), buildRejectionExport; uses RiskReportFrame, DashboardExportChooser and dashboard-workbook.
- Canonical rules: [behavior](../../WEBSITE_STRUCTURE.md#rejection-analytics); [design](../../design/dashboard-rejections.md); [workbooks](../../design/dashboard-data-export.md#rejection-analytics).
- Search aliases: [recruitment-id-search.ts](../../../src/lib/recruitment-id-search.ts) matches complete CAN/GRP tokens against raw and five-digit-minimum display IDs without changing stored IDs; exact identity filters and export source IDs remain raw. SQL summary/page parity lives in [61_dashboard_summaries.sql](../../../supabase/schemas/61_dashboard_summaries.sql) and [rejection ID alias migration](../../../supabase/migrations/20261101184800_rejection_id_alias_search.sql).
- Verification: [focused tests](../../../tests/e2e/rejection-dashboard.spec.ts); [implementation evidence](../../work-items/rejection-dashboard/implementation.md). Extends F04; no new inventory ID. Reads SYS-PIPELINE reasons/applications; no rejection-letter delivery dependency.

### Rejection treemap and compact refinement

- [ReasonTreemap](../../../src/components/dashboard/ReasonTreemap.tsx) owns measured geometry, reason selection, tooltip and accessible directory; [layoutReasonTreemap](../../../src/lib/rejection-treemap.ts) owns deterministic area-preserving layout.
- RejectionDashboardView owns Treemap/Bars composition and breadcrumbs; dashboard-filters owns rejectionReasonView. buildRejectionReport separates comparison/selected events and Saturday–Friday buckets; buildRejectionExport owns comparison summary/source tables.
- [Canonical populations](../../WEBSITE_STRUCTURE.md#reason-treemap-and-comparison-population) → [compact design](../../design/dashboard-rejections.md) → [focused checks](../../../tests/e2e/rejection-dashboard.spec.ts). No new inventory ID or SQL owner.
