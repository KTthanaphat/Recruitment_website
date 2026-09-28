# SYS-INTEGRATIONS: Interviews and rejection letters

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Rejection contract](../../REJECTION_LETTER_POWER_AUTOMATE_CONTRACT.md) and [Teams contract](../../TEAMS_INTERVIEW_POWER_AUTOMATE_CONTRACT.md). Visual work uses [Candidate Detail design](../../design/candidate-detail.md).

## Owners and search keys

### F24: Reviewed rejection letters

- Owner/search: [PipelineBoardView.tsx](../../../src/components/pipeline/PipelineBoardView.tsx), [RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), `rejection-letters/*`, `api/rejection-letters/*`.
- Related symbols: `rejection-letters`, `/api/rejection-letters/draft`; the endpoint name is historical. Current contract sends approved content; consult it before reasoning about side effects.
- Entry: Pipeline failed cards; Candidate Detail; Admin.
- Verification: [rejection-letter-ui.spec.ts](../../../tests/e2e/rejection-letter-ui.spec.ts) for composer state and [rejection-letter-format.spec.ts](../../../tests/e2e/rejection-letter-format.spec.ts) for formatting. See [environment boundaries](../../workflows/TEST_ENVIRONMENTS.md#unmocked-database-and-external-checks) before delivery tests.

### Teams meeting lifecycle

- Owner/search: `CurrentStageEditModal` in [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx); search `src/app/api` for `interview-meetings` and `src/lib` for `teams` / `interview` helpers.
- Contract owns create/reschedule/cancel payloads and external effects.
- Configuration path: [SETUP-INTEGRATIONS](../SETUP_MAP.md#setup-integrations).

## Dependency edges

| Edge | Target | Follow when |
| --- | --- | --- |
| `uses` | [SYS-PLATFORM](platform.md) | Role scope, UI controls and language |
| `updates` | [SYS-PIPELINE](pipeline.md) | Candidate meeting/rejection state |

## Impact back-links

[SYS-PIPELINE](pipeline.md) (`invokes`).

If the task changes schema, environment or release state, cross to [Setup](../SETUP_MAP.md). For visual-only work remain in this system node and its design contract. Coverage names are search leads inherited from the feature index, not evidence that checks passed or that every named scenario has a dedicated file.
