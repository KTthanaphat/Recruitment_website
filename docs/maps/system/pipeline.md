# SYS-PIPELINE: Candidates, Pipeline and detail drawers

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Pipeline implementation record](../../CANDIDATE_PIPELINE_ADJUSTMENT_PLAN.md). Visual work uses [Candidate Detail design](../../design/candidate-detail.md).

## Owners and search keys

### F19: Record detail drawers and candidate journey/profile

- Owner/search: [RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), `ui/Drawer.tsx`, `ui/Operations.tsx`, `ui/StageRail.tsx`.
- Related symbols: URL detail state; action popup, profile copy, disclosure/timeline surfaces.
- Entry: `/requisitions`, `/candidates`, `/offers`.
- Existing check/search: [wave-4.spec.ts](../../../tests/e2e/wave-4.spec.ts), [pipeline-actions.spec.ts](../../../tests/e2e/pipeline-actions.spec.ts).

### F22: Candidate Pipeline board/record register

- Owner/search: [src/components/pipeline/PipelineBoardView.tsx](../../../src/components/pipeline/PipelineBoardView.tsx), [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [supabase/schemas/50_rpc_functions.sql](../../../supabase/schemas/50_rpc_functions.sql).
- Related symbols: derived `log_date`, optional estimate, audit history, correction.
- Entry: `/pipeline`.
- Existing check/search: [tests/e2e/pipeline-actions.spec.ts](../../../tests/e2e/pipeline-actions.spec.ts), [tests/e2e/pipeline-board.spec.ts](../../../tests/e2e/pipeline-board.spec.ts), [tests/db/candidate-pipeline-paired-status.sql](../../../tests/db/candidate-pipeline-paired-status.sql).

### F23: Repeatable interview rounds and dashboard stage metrics

- Owner/search: [StageRail.tsx](../../../src/components/ui/StageRail.tsx), [HomeView.tsx](../../../src/components/dashboard/HomeView.tsx), [PipelineBoardView.tsx](../../../src/components/pipeline/PipelineBoardView.tsx), [RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [VacancyWaterfallView.tsx](../../../src/components/dashboard/VacancyWaterfallView.tsx), `202609050001_line_interview_repeat_rounds.sql`.
- Related symbols: Line Interview/Test consecutive canonical rounds; Activity/Status/Accum membership; grouped Waterfall site braces.
- Entry: `/home`, `/pipeline`, `/dashboard`.
- Existing check/search: pipeline, dashboard, bilingual, and DB pipeline coverage.

## Dependency edges

| Edge | Target | Follow when |
| --- | --- | --- |
| `uses` | [SYS-PLATFORM](platform.md) | Drawer, actions, dates and language |
| `reads` | [SYS-RECORDS](records.md) | Group and Offer context |
| `invokes` | [SYS-INTEGRATIONS](integrations.md) | Interview and rejection actions |

## Impact back-links

[SYS-HOME](home.md) (`opens`), [SYS-WORKSPACE](workspace.md) (`embeds`), [SYS-RECORDS](records.md) (`feeds`), [SYS-REPORTING](reporting.md) (`reads`), [SYS-INTEGRATIONS](integrations.md) (`updates`).

If the task changes schema, environment or release state, cross to [Setup](../SETUP_MAP.md). For visual-only work remain in this system node and its design contract. Coverage names are search leads inherited from the feature index, not evidence that checks passed or that every named scenario has a dedicated file.
