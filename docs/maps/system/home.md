# SYS-HOME: Home, calendar and summaries

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Home behavior](../../WEBSITE_STRUCTURE.md#home-page). Visual work uses [Home visual contract](../../design/home.md).

## Owners and search keys

Banner asset: [home_banner.png](../../../home_banner.png). `HomeView` consumes essential counts from `app_home_core_summary_v1`; urgent count uses the independent `app_home_work_queue_v1` after essential requests settle. Data Quality count/rows load only when its tab opens. The compatible `app_home_summary_v1` remains for older clients and the header-scope banner aggregate from `app_home_banner_summary_v1`; their typed client/cache lives in [dashboard-summary-client.ts](../../../src/lib/dashboard-summary-client.ts). Welcome modal aggregate/loading/error state is owned by `RecruitmentWorkspace.tsx`, rendered by [WelcomeBackPrompt.tsx](../../../src/components/dashboard/WelcomeBackPrompt.tsx), and supplied by `app_home_welcome_summary_v1`. Welcome requests wait for initial Home sections, skip dismissed sessions, and do not depend on header filters. These are separate contracts: the banner ratio follows selected header Site/PIC/priority filters; Welcome modal counts use the current profile's authorized responsibility population. Summary rows are not sourced from bootstrap arrays. Summary metrics render through `OperationalSummaryStrip` in [Operations.tsx](../../../src/components/ui/Operations.tsx); urgent count: `deriveWorkQueue` in [operations.ts](../../../src/lib/operations.ts).

### F10: Home metrics, recruitment-events calendar, and tabbed records

- Owner/search: [HomeView.tsx](../../../src/components/dashboard/HomeView.tsx), [StageRail.tsx](../../../src/components/ui/StageRail.tsx), [workspace-quality-copy.ts](../../../src/lib/workspace-quality-copy.ts); calendar: [RecruitmentCalendar.tsx](../../../src/components/dashboard/RecruitmentCalendar.tsx).
- Related symbols: `HomeRecordTabs`, `CandidateActionCard`, `SourcingUpdateCard`, `StartConfirmationCard`.
- Entry: `/home`.
- Contract/check: [Recruitment Records design](../../design/home.md#recruitment-records), focused [Candidate Pipeline E2E](../../../tests/e2e/home-candidate-pipeline.spec.ts); other tab coverage in [Home E2E](../../../tests/e2e/ux-enhancements.spec.ts).

### F20: Candidate data quality and PIM Welcome messages

- Owner/search: [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [WelcomeBackPrompt.tsx](../../../src/components/dashboard/WelcomeBackPrompt.tsx), [dashboard-summary-client.ts](../../../src/lib/dashboard-summary-client.ts), [src/lib/daily-messages.ts](../../../src/lib/daily-messages.ts).
- Related symbols: Bangkok PIM accepted-offer ratio; weekday `Filled%_min` selection; canonical rules: [docs/WEBSITE_STRUCTURE.md](../../WEBSITE_STRUCTURE.md).
- Data owner: [64_home_welcome_summaries.sql](../../../supabase/schemas/64_home_welcome_summaries.sql) and local migration `20261102122000_home_welcome_summaries.sql`; test parity is in [home-aggregate-summaries.spec.ts](../../../tests/e2e/home-aggregate-summaries.spec.ts) and the Home welcome rehearsal.
- Entry: `/home`.
- Existing check/search: [tests/e2e/forms-validation.spec.ts](../../../tests/e2e/forms-validation.spec.ts), [tests/e2e/ux-enhancements.spec.ts](../../../tests/e2e/ux-enhancements.spec.ts).

### F21: Recommendation removal with explicit commands and factual risk labels

- Owner/search: [src/components/dashboard/HomeView.tsx](../../../src/components/dashboard/HomeView.tsx), [src/components/workspace/HiringWorkspaceView.tsx](../../../src/components/workspace/HiringWorkspaceView.tsx), [src/components/candidates/CandidatesView.tsx](../../../src/components/candidates/CandidatesView.tsx), [src/lib/operations.ts](../../../src/lib/operations.ts).
- Related symbols: Work queue issue types and data-quality issue contracts; failed candidates are workflow state, not data-quality issues.
- Entry: `/home`, `/workspace`, `/candidates`, `/pipeline`.
- Existing check/search: [tests/e2e/workspace-lifecycle.spec.ts](../../../tests/e2e/workspace-lifecycle.spec.ts), [tests/e2e/pipeline-board.spec.ts](../../../tests/e2e/pipeline-board.spec.ts).

## Dependency edges

| Edge | Target | Follow when |
| --- | --- | --- |
| `uses` | [SYS-PLATFORM](platform.md) | Shared controls, theme and language |
| `opens` | [SYS-PIPELINE](pipeline.md) | Calendar/work card opens Candidate Detail |
| `reads` | [SYS-RECORDS](records.md) | Requisitions, sourcing gaps and start confirmations |

## Impact back-links

Use caller search for additional runtime dependencies.

If the task changes schema, environment or release state, cross to [Setup](../SETUP_MAP.md). For visual-only work remain in this system node and its design contract. Coverage names are search leads inherited from the feature index, not evidence that checks passed or that every named scenario has a dedicated file.

Footer/loading boundaries: [contract](../../design/home.md#record-footer-placement-and-loading); search data-home-record-pagination, homeIdentity; [checks](../../../tests/e2e/design-adjustments.spec.ts).

New Hire Confirmation icon pair: StartConfirmationCard and onConfirmStart(offer, outcome) → [shared attendance](../../../src/components/ui/AttendanceDecisionActions.tsx); [contract](../../design/home.md#recruitment-records); [checks](../../../tests/e2e/design-refinement.spec.ts).
