# SYS-PIPELINE: Candidates, Pipeline and detail drawers

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Pipeline implementation record](../../CANDIDATE_PIPELINE_ADJUSTMENT_PLAN.md). Visual work uses [Candidate Detail design](../../design/candidate-detail.md).

## Owners and search keys

### F19: Record detail drawers and candidate journey/profile

Dashboard Stage Bottleneck detail entry: [report loader](../../../src/lib/dashboard-report-loader.ts) `hydrateReportCandidate` → [RecruitmentWorkspace](../../../src/components/RecruitmentWorkspace.tsx) existing current-record drawer; report owners/tests are indexed under [Reporting subviews](reporting.md#risk-and-bottleneck-subviews). History normalization and unavailable-deadline contract are owned by [Dashboard behavior](../../WEBSITE_STRUCTURE.md#risk-and-bottleneck-subviews).

- Owner/search: [RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), `ui/Drawer.tsx`, `ui/Operations.tsx`, `ui/StageRail.tsx`.
- Related symbols: URL detail state; action popup, profile copy, disclosure/timeline surfaces.
- Entry: `/requisitions`, `/candidates`, `/offers`.
- Existing check/search: [wave-4.spec.ts](../../../tests/e2e/wave-4.spec.ts), [pipeline-actions.spec.ts](../../../tests/e2e/pipeline-actions.spec.ts).

### F22: Candidate Pipeline board/record register

- Card hierarchy: [contract](../../design/pipeline.md#candidate-card-hierarchy) → [PipelineBoardView](../../../src/components/pipeline/PipelineBoardView.tsx), shared card and phone workspace list; [focused checks](../../../tests/e2e/pipeline-card-layout.spec.ts).

- Complete stage-history reads: [history loader](../../../src/lib/recruitment-history-loader.ts) pages by unique log_id with exact counts, so imported records cannot hide older candidates. No candidate re-upload is involved. Regression: [loader checks](../../../tests/unit/recruitment-history.test.cjs) and [candidate drawer](../../../tests/e2e/recruitment-history-loading.spec.ts).

- Owner/search: [src/components/pipeline/PipelineBoardView.tsx](../../../src/components/pipeline/PipelineBoardView.tsx), [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [supabase/schemas/50_rpc_functions.sql](../../../supabase/schemas/50_rpc_functions.sql).
- Related symbols: derived `log_date`, optional estimate, audit history, correction.
- Rejection reasons and targeted Configuration catalog refresh: [FailureReasonFields.tsx](../../../src/components/rejection-reasons/FailureReasonFields.tsx), [ConfigurationItemEditor.tsx](../../../src/components/configuration/ConfigurationItemEditor.tsx), [ConfigurationView.tsx](../../../src/components/configuration/ConfigurationView.tsx), [reason helpers](../../../src/lib/rejection-reasons.ts), and [seed](../../../supabase/schemas/15_rejection_reason_seed.sql); contract: [Candidate Pipeline](../../WEBSITE_STRUCTURE.md#recruitment-workflows); checks: [pipeline actions](../../../tests/e2e/pipeline-actions.spec.ts) and [catalog controls](../../../tests/e2e/rejection-reason-admin.spec.ts).
- Entry: `/pipeline`.
- Existing check/search: [tests/e2e/pipeline-actions.spec.ts](../../../tests/e2e/pipeline-actions.spec.ts), [tests/e2e/pipeline-board.spec.ts](../../../tests/e2e/pipeline-board.spec.ts), [tests/db/candidate-pipeline-paired-status.sql](../../../tests/db/candidate-pipeline-paired-status.sql).

- Stage pagination: compact `< current/total >` controls are independent for each active and failed stage; terminal failure queries carry both `boardFilter=failed` and `stage`. See [Pipeline contract](../../design/pipeline.md#compact-stage-pagination-and-failed-columns) and [release evidence](../../work-items/pipeline-pagination-recruiter-loading/implementation.md).

### F23: Repeatable interview rounds and dashboard stage metrics

- Owner/search: [StageRail.tsx](../../../src/components/ui/StageRail.tsx), [HomeView.tsx](../../../src/components/dashboard/HomeView.tsx), [PipelineBoardView.tsx](../../../src/components/pipeline/PipelineBoardView.tsx), [RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [VacancyWaterfallView.tsx](../../../src/components/dashboard/VacancyWaterfallView.tsx), `202609050001_line_interview_repeat_rounds.sql`.
- Related symbols: Line Interview/Test consecutive canonical rounds; Activity/Status/Accum membership; grouped Waterfall site braces.
- Entry: `/home`, `/pipeline`, `/dashboard`.
- Existing check/search: pipeline, dashboard, bilingual, and DB pipeline coverage.

### Configuration browser

[ConfigurationView.tsx](../../../src/components/configuration/ConfigurationView.tsx) owns tree, contents, breadcrumbs, catalog refresh and navigation. [configuration-folders.ts](../../../src/lib/configuration-folders.ts) derives folders, search and paths; [ConfigurationItemEditor.tsx](../../../src/components/configuration/ConfigurationItemEditor.tsx) owns drafts/writes/refresh-only retries. Contract: [Configuration behavior](../../WEBSITE_STRUCTURE.md#configuration-page), [folder design](../../design/configuration.md). Checks: [catalog/browser](../../../tests/e2e/rejection-reason-admin.spec.ts). Template consumers: [Integrations](integrations.md). Shared draft/list/header Active presentation: [OnOffSwitch.tsx](../../../src/components/ui/OnOffSwitch.tsx), [switch contract](../../design/controls.md#shared-onoff-switch).

## Dependency edges

| Edge | Target | Follow when |
| --- | --- | --- |
| `uses` | [SYS-PLATFORM](platform.md) | Drawer, actions, dates and language |
| `reads` | [SYS-RECORDS](records.md) | Group and Offer context |
| `invokes` | [SYS-INTEGRATIONS](integrations.md) | Interview and rejection actions |

## Impact back-links

[SYS-HOME](home.md) (`opens`), [SYS-WORKSPACE](workspace.md) (`embeds`), [SYS-RECORDS](records.md) (`feeds`), [SYS-REPORTING](reporting.md) (`reads`), [SYS-INTEGRATIONS](integrations.md) (`updates`).

If the task changes schema, environment or release state, cross to [Setup](../SETUP_MAP.md). For visual-only work remain in this system node and its design contract. Coverage names are search leads inherited from the feature index, not evidence that checks passed or that every named scenario has a dedicated file.

## Independent profile and application ownership

- Profile/registry: [CandidateRegistry](../../../src/components/candidates/CandidateRegistry.tsx), [CandidateProfilePanel](../../../src/components/candidates/CandidateProfilePanel.tsx); contract: [person/journey behavior](../../WEBSITE_STRUCTURE.md#independent-candidate-profiles), [drawer selection](../../design/candidate-detail.md#profile-and-application-selection).
- Journey projections/context: [applications.ts](../../../src/lib/applications.ts); SQL: [12](../../../supabase/schemas/12_candidate_applications.sql), [32](../../../supabase/schemas/32_application_context.sql), [56](../../../supabase/schemas/56_candidate_application_rpc.sql).
- Search: `CandidateProfile`, `candidate_applications`, `application_id`, `APPLICATION_SELECTION_REQUIRED`, `app_transfer_candidate_application_v1`, `entry_assignment_id`, `outcome_assignment_id`.
- Checks: [SQL](../../../tests/db/candidate-applications.sql), [browser](../../../tests/e2e/candidate-applications.spec.ts). Impacts: [Reporting](reporting.md), [Integrations](integrations.md), [Workspace](workspace.md).

## Creator privacy and profile/application layout

Owners: [profile panel](../../../src/components/candidates/CandidateProfilePanel.tsx), [registry](../../../src/components/candidates/CandidateRegistry.tsx), [capabilities](../../../src/lib/applications.ts), [profile SQL](../../../supabase/schemas/58_candidate_profile_contract.sql). Contract: [behavior](../../WEBSITE_STRUCTURE.md#independent-candidate-profiles), [tabs/forms](../../design/candidate-detail.md#shared-profile-and-application-tabs). Search: `created_by`, `can_edit_note`, `app_masked_candidate_pool_v1`, `duplicate_review`, `app_upsert_candidate_note_v2`. Checks: [browser](../../../tests/e2e/candidate-profile-redesign.spec.ts), [SQL](../../../tests/db/candidate-profile-contract.sql), [evidence](../../work-items/candidate-profile-redesign/implementation.md).

## Connected profile and group uniqueness

Owners: [drawer](../../../src/components/candidates/CandidateProfilePanel.tsx), [shared fields](../../../src/components/ui/RecordDetailFields.tsx), [group claims](../../../supabase/schemas/59_candidate_group_claims.sql). Contract: [layout](../../design/candidate-detail.md#connected-drawer-refinement), [behavior](../../WEBSITE_STRUCTURE.md#independent-candidate-profiles). Search: `CandidateApplicationDetailsExtras`, `candidateCanUseGroup`, `APPLICATION_GROUP_ALREADY_USED`. [Checks/evidence](../../work-items/candidate-detail-refinement/implementation.md).

Board preload/five-card pages: [contract](../../design/pipeline.md); search useBoardList, BoardPagination, fetchCompleteRecruitmentList; [checks](../../../tests/e2e/design-adjustments.spec.ts).

Candidate offer attendance icons: [shared controls](../../../src/components/ui/AttendanceDecisionActions.tsx) and confirmPendingAction/pendingSaveLock in RecruitmentWorkspace; [contract](../../design/candidate-detail.md#compact-offers-and-working-confirm); [checks](../../../tests/e2e/design-refinement.spec.ts).

- Bounded stage loading and committed candidate saves: [board hook](../../../src/lib/pipeline-board-list.ts), [receipts](../../../src/lib/candidate-action-receipt.ts), [invoker RPCs](../../../supabase/schemas/61_candidate_actions.sql), [contract](../../design/pipeline.md).

Candidate/requisition form refinement: `src/components/RecruitmentWorkspace.tsx`, `src/components/requisitions/AuthorizedRequisitionLookup.tsx`; layout contracts: [candidate detail](../../design/candidate-detail.md), [requisition detail](../../design/requisition-detail.md), [selector controls](../../design/controls.md). Focused checks: candidate-search-outcomes and requisition-identity browser specs.
