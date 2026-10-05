# SYS-PLATFORM: Shared components, theme, language and permissions

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Security](../../WEBSITE_STRUCTURE.md#security) and [language](../../WEBSITE_STRUCTURE.md#language-system). Visual work uses [Visual foundations](../../design/foundations.md) and [controls](../../design/controls.md).

## Owners and search keys

### F01: Workspace picker actions, localized form guidance, and day-date selector

- Owner/search: [src/components/workspace/HiringWorkspaceView.tsx](../../../src/components/workspace/HiringWorkspaceView.tsx), [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [src/components/ui/Field.tsx](../../../src/components/ui/Field.tsx).
- Related symbols: [src/lib/i18n/dictionary.ts](../../../src/lib/i18n/dictionary.ts); canonical behavior: [docs/WEBSITE_STRUCTURE.md](../../WEBSITE_STRUCTURE.md); visual contract: [docs/design.md](../../design.md).
- Entry: `/workspace`, requisition/candidate/Pipeline modals.
- Existing check/search: [tests/e2e/workspace.spec.ts](../../../tests/e2e/workspace.spec.ts), [tests/e2e/forms-validation.spec.ts](../../../tests/e2e/forms-validation.spec.ts), [tests/e2e/pipeline-actions.spec.ts](../../../tests/e2e/pipeline-actions.spec.ts).

### F05: Records sidebar dropdown

Dashboard-only inline header filters placement variant (shared dark sidebar and profile theme): [AppShell](../../../src/components/layout/AppShell.tsx) `variant="dashboard"`, `headerScopeSummary`; [globals.css](../../../src/app/globals.css) scoped `[data-shell-variant]`; visual owner [Dashboard portal](../../design/dashboard-portal.md), report callers [Reporting subviews](reporting.md#risk-and-bottleneck-subviews). Default shell callers retain their styling.

- Owner/search: [src/components/layout/AppShell.tsx](../../../src/components/layout/AppShell.tsx).
- Related symbols: `ViewId`, contextual navigation helper.
- Entry: Existing `/requisitions`, `/sourcing`, `/candidates`, `/pipeline`, `/offers` routes.
- Existing check/search: [tests/e2e/wave-4.spec.ts](../../../tests/e2e/wave-4.spec.ts).

### F06: Phone-first recruiter operations

- Layout/loading: [responsive-layout.ts](../../../src/lib/responsive-layout.ts) `LayoutMode`, `useLayoutMode`, `isViewAvailable`; [RecruitmentWorkspace](../../../src/components/RecruitmentWorkspace.tsx) `loadScope`, `loadGeneration`; [notice](../../../src/components/layout/DesktopRequiredNotice.tsx); [interaction locks](../../../src/components/layout/DesktopInteractionContext.tsx).
- Contract/checks: [Mobile navigation](../../design/mobile-navigation.md), [Stage/mobile checks](../../../tests/e2e/stage-mobile-refinement.spec.ts), [review](../../work-items/mobile-shell/review.md).

- Owner/search: [src/components/layout/AppShell.tsx](../../../src/components/layout/AppShell.tsx), [src/components/ui/MobileBottomSheet.tsx](../../../src/components/ui/MobileBottomSheet.tsx), [src/components/ui/Modal.tsx](../../../src/components/ui/Modal.tsx), [src/components/sourcing/SourcingView.tsx](../../../src/components/sourcing/SourcingView.tsx), [src/components/pipeline/PipelineBoardView.tsx](../../../src/components/pipeline/PipelineBoardView.tsx).
- Related symbols: shared bottom-sheet focus/scroll lock; canonical behavior: [docs/WEBSITE_STRUCTURE.md](../../WEBSITE_STRUCTURE.md); interaction rules: [docs/design.md](../../design.md).
- Entry: All recruiter routes; contextual URLs are preserved.
- Existing check/search: [tests/e2e/mobile-operations.spec.ts](../../../tests/e2e/mobile-operations.spec.ts), [tests/e2e/wave-4.spec.ts](../../../tests/e2e/wave-4.spec.ts), mobile visual smoke.

### F07: Login fallback theme boundary

- Owner/search: [src/app/login/page.tsx](../../../src/app/login/page.tsx), [src/lib/site-theme.ts](../../../src/lib/site-theme.ts), [src/app/globals.css](../../../src/app/globals.css).
- Related symbols: Fallback assigned-site accent variables; no profile dependency before sign-in.
- Entry: `/login`.
- Existing check/search: Login visual smoke; missing CSS/process recovery belongs to [SETUP-LOCAL](../SETUP_MAP.md#setup-local), not an automatic restart for every style edit.

### F12: Header command filters and selectors

- Owner/search: [src/components/ui/OnOffSwitch.tsx](../../../src/components/ui/OnOffSwitch.tsx), [src/components/ui/CommandSelector.tsx](../../../src/components/ui/CommandSelector.tsx), [src/components/ui/CommandMultiSelector.tsx](../../../src/components/ui/CommandMultiSelector.tsx), [src/components/ui/Field.tsx](../../../src/components/ui/Field.tsx), [src/components/ui/TableControls.tsx](../../../src/components/ui/TableControls.tsx), [src/components/dashboard/VacancyWaterfallView.tsx](../../../src/components/dashboard/VacancyWaterfallView.tsx), [src/app/globals.css](../../../src/app/globals.css).
- Related symbols: Controlled `OnOffSwitch` and `--ats-square-switch-*` tokens (Dashboard legend, Configuration drafts and saved Active controls); shared `site`/`pic` state and selector shell, opt-in `typography` for normal dashboard filter values; canonical interaction rules: [docs/WEBSITE_STRUCTURE.md](../../WEBSITE_STRUCTURE.md).
- Entry: Authenticated routes, Dashboard, create forms. Dashboard-specific coordination belongs to [Reporting](reporting.md#common-dashboard-portal).
- Verification: [exact scenarios and coverage boundaries](../../workflows/TEST_ENVIRONMENTS.md#exact-source-leads) and [Recruitment Performance browser tests](../../../tests/e2e/recruitment-performance.spec.ts). Inspect shared-control callers after token changes.

### F15: Frozen desktop record headers

- Owner/search: [src/app/globals.css](../../../src/app/globals.css), Requisitions/Candidates/Offers views.
- Related symbols: shared `.table-scroll` viewport.
- Entry: `/requisitions`, `/candidates`, `/offers`.
- Existing check/search: [tests/e2e/tables-url-state.spec.ts](../../../tests/e2e/tables-url-state.spec.ts).

### F25: ATS design-system alignment

- Owner/search: [docs/design.md](../../design.md), [src/app/globals.css](../../../src/app/globals.css), [src/lib/site-theme.ts](../../../src/lib/site-theme.ts), [src/components/layout/AppShell.tsx](../../../src/components/layout/AppShell.tsx), shared `ui` primitives, Home/Workspace/Dashboard/Pipeline/record card surfaces.
- Related symbols: Assigned-site accent from `profile.site`; `ats-card`, `ats-card-subtle`, `ats-input`; Waterfall `snapshotColor` preserved; no data model or URL-state changes.
- Entry: All active Next.js routes; Dashboard Waterfall and Pipeline Funnel reporting.
- Existing check/search: Relevant site-theme visual checks for HQ/KT1/KT2/no-site profiles; choose code/release checks through [SETUP-VERIFY](../SETUP_MAP.md#setup-verify).

### F26: Thai/English UI text and dates

- Owner/search: [src/lib/i18n/dictionary.ts](../../../src/lib/i18n/dictionary.ts), [src/components/ui/Field.tsx](../../../src/components/ui/Field.tsx), active route/component surfaces.
- Related symbols: `Language`, `translate`, dictionary parity; ISO value/DD/MM/YYYY display.
- Entry: `/login` and authenticated routes, mobile controls, modals.
- Existing check/search: [tests/e2e/i18n.spec.ts](../../../tests/e2e/i18n.spec.ts), bilingual date-control smoke.

### F27: Workspace icon and record utility actions

- Owner/search: [src/components/ui/Operations.tsx](../../../src/components/ui/Operations.tsx), [src/components/layout/AppShell.tsx](../../../src/components/layout/AppShell.tsx), [src/components/ui/StageRail.tsx](../../../src/components/ui/StageRail.tsx), shared status components, record detail builders.
- Related symbols: `RecordAction.iconOnly`, `LampDesk`, accessible names; status colors follow component-specific design contracts.
- Entry: Sidebar `/workspace`; record detail workspace actions; Dashboard SLA; Pipeline journey.
- Existing check/search: Record detail utility actions, accessible names and status appearance; choose code/release checks through [SETUP-VERIFY](../SETUP_MAP.md#setup-verify).

## Dependency edges

This is a shared dependency. A local primitive repair does not require reading all consumers. Search callers, then inspect only affected features.

## Impact back-links

[SYS-HOME](home.md) (`uses`), [SYS-WORKSPACE](workspace.md) (`uses`), [SYS-RECORDS](records.md) (`uses`), [SYS-PIPELINE](pipeline.md) (`uses`), [SYS-REPORTING](reporting.md) (`uses`), [SYS-INTEGRATIONS](integrations.md) (`uses`).

High-degree owners: [Field.tsx](../../../src/components/ui/Field.tsx) (date/field) → forms and reporting; [CommandSelector.tsx](../../../src/components/ui/CommandSelector.tsx) → header/form/month controls; [Operations.tsx](../../../src/components/ui/Operations.tsx) → Home summaries and record actions; [site-theme.ts](../../../src/lib/site-theme.ts) / [globals.css](../../../src/app/globals.css) → all routes, including Login fallback. Read the relevant symbol, then search its import/callers with `rg`; verify affected states without automatically scanning every page.

If the task changes schema, environment or release state, cross to [Setup](../SETUP_MAP.md). For visual-only work remain in this system node and its design contract. Coverage names are search leads inherited from the feature index, not evidence that checks passed or that every named scenario has a dedicated file.

## Compact Dashboard presentation

- Shared owners: [Button](../../../src/components/ui/Button.tsx) toolbar/icon-toolbar sizes; [AppShell](../../../src/components/layout/AppShell.tsx) header/site theme; [globals.css](../../../src/app/globals.css) `.dashboard-compact-controls`; [Modal](../../../src/components/ui/Modal.tsx) `compactControls`. Report callers: [Reporting](reporting.md#compact-dashboard-presentation).
- Contracts: [Controls](../../design/controls.md#fields-buttons-and-overlays), [portal](../../design/dashboard-portal.md#compact-system-presentation), [new reports](../../design/dashboard-risk-bottlenecks.md). Checks: [compact geometry/theme/layout](../../../tests/e2e/dashboard-compact.spec.ts); [review](../../work-items/dashboard-risk-bottlenecks/review.md).

Dashboard inline header filters and comparison-date owner: AppShell / [format.ts](../../../src/lib/format.ts) `formatCompactDateRange`; consumers/checks: [Reporting refinement](reporting.md#dashboard-navigation-and-summary-refinement).
