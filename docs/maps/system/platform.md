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

- Owner/search: [src/components/layout/AppShell.tsx](../../../src/components/layout/AppShell.tsx).
- Related symbols: `ViewId`, contextual navigation helper.
- Entry: Existing `/requisitions`, `/sourcing`, `/candidates`, `/pipeline`, `/offers` routes.
- Existing check/search: [tests/e2e/wave-4.spec.ts](../../../tests/e2e/wave-4.spec.ts).

### F06: Phone-first recruiter operations

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

- Owner/search: [src/components/ui/CommandSelector.tsx](../../../src/components/ui/CommandSelector.tsx), [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [src/components/dashboard/VacancyWaterfallView.tsx](../../../src/components/dashboard/VacancyWaterfallView.tsx).
- Related symbols: Shared `site`/`pic` state and selector shell; canonical interaction rules: [docs/WEBSITE_STRUCTURE.md](../../WEBSITE_STRUCTURE.md).
- Entry: Authenticated routes, Dashboard, create forms.
- Verification: [exact scenarios and coverage boundaries](../../workflows/TEST_ENVIRONMENTS.md#exact-source-leads). Existing sourcing tests cover selected flows; dedicated date/dropdown keyboard coverage is not established and must be added when those behaviors change.

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
