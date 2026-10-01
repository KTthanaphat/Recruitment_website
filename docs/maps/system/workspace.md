# SYS-WORKSPACE: Hiring workspace and contextual navigation

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Navigation](../../WEBSITE_STRUCTURE.md#routes-and-navigation). Visual work uses the [Workspace design contract](../../design/workspace.md).

## Owners and search keys

### F00: Groups picker, selected-group header, journey, and tabs

- Owner/search: [HiringWorkspaceView.tsx](../../../src/components/workspace/HiringWorkspaceView.tsx), [WorkspaceBreadcrumbs.tsx](../../../src/components/workspace/WorkspaceBreadcrumbs.tsx), [linked-group derivation](../../../src/lib/data.ts), picker overlay [LinkedRequisitionPreview.tsx](../../../src/components/workspace/LinkedRequisitionPreview.tsx).
- Related/search: `WorkspacePicker`, `WorkspaceCreateMenu`, `terminalGroupStatus`; URL state: [workspace-url-state.ts](../../../src/lib/workspace-url-state.ts).
- Entry: `/workspace?type=group&id=<group_id>`; legacy requisition URLs are resolved by [RecruitmentWorkspace](../../../src/components/RecruitmentWorkspace.tsx).
- Contract/check: [Picker design](../../design/workspace.md#picker-at-workspace), [selected header design](../../design/workspace.md#selected-case-header-and-section-navigation), focused [Workspace E2E](../../../tests/e2e/workspace.spec.ts).

### F00 section presentation search keys

- Sourcing summary/trend/donut/square stage bars: [SourcingSummaryCharts.tsx](../../../src/components/sourcing/SourcingSummaryCharts.tsx), [stage derivation](../../../src/lib/sourcing-stage-channels.ts), [channel palette](../../../src/lib/sourcing-colors.ts); week list/editor: [EmbeddedSourcingPanel.tsx](../../../src/components/sourcing/EmbeddedSourcingPanel.tsx), [SourcingView.tsx](../../../src/components/sourcing/SourcingView.tsx); [design](../../design/workspace.md#sourcing-pipeline-offer-activity); [focused E2E](../../../tests/e2e/workspace.spec.ts).
- Pipeline: [src/components/pipeline/PipelineBoardView.tsx](../../../src/components/pipeline/PipelineBoardView.tsx), `embedded`.
- Offer: [src/components/workspace/WorkspaceOfferSection.tsx](../../../src/components/workspace/WorkspaceOfferSection.tsx).
- Overview journey/quality and Activity: [HiringWorkspaceView.tsx](../../../src/components/workspace/HiringWorkspaceView.tsx), `OverviewSection`, `JourneyGuide`, `ActivitySection`; [Overview design](../../design/workspace.md#overview).

### F02: Group workspace scope and legacy URL resolution

- Owner/search: [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [src/components/workspace/HiringWorkspaceView.tsx](../../../src/components/workspace/HiringWorkspaceView.tsx).
- Related symbols: `workspaceScope`, `historicalWorkspace`, `groupChoices`.
- Entry: `/workspace?type=group&id=<group_id>&section=<section>`.
- Contract/check: [Workspace design](../../design/workspace.md#selected-case-header-and-section-navigation), [Workspace E2E](../../../tests/e2e/workspace.spec.ts); related [lifecycle](../../../tests/e2e/workspace-lifecycle.spec.ts).

### F08: Canonical Offer section with legacy Outcome compatibility

- Owner/search: [src/components/workspace/HiringWorkspaceView.tsx](../../../src/components/workspace/HiringWorkspaceView.tsx), [src/components/workspace/WorkspaceOfferSection.tsx](../../../src/components/workspace/WorkspaceOfferSection.tsx).
- Related symbols: [src/lib/workspace-url-state.ts](../../../src/lib/workspace-url-state.ts), `WorkspaceSection`, `WorkspaceActionRequest`.
- Entry: `/workspace?...&section=offer`; legacy `section=outcome` is replaced.
- Existing check/search: [tests/e2e/workspace.spec.ts](../../../tests/e2e/workspace.spec.ts), [tests/e2e/pipeline-actions.spec.ts](../../../tests/e2e/pipeline-actions.spec.ts).

### F09: Confirmed Offer-pass handoff

- Owner/search: [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx).
- Related symbols: `OfferPassHandoff`, typed `RpcResult.offer_handoff`.
- Entry: `/pipeline`, `/workspace?...&section=offer`, `/offers`.
- Existing check/search: [tests/e2e/pipeline-actions.spec.ts](../../../tests/e2e/pipeline-actions.spec.ts), [tests/e2e/workspace-lifecycle.spec.ts](../../../tests/e2e/workspace-lifecycle.spec.ts).

## Dependency edges

| Edge | Target | Follow when |
| --- | --- | --- |
| `uses` | [SYS-PLATFORM](platform.md) | Shell, URL state and shared primitives |
| `embeds` | [SYS-RECORDS](records.md) | Sourcing and Offer surfaces |
| `embeds` | [SYS-PIPELINE](pipeline.md) | Candidate journey and stage actions |

## Impact back-links

[SYS-RECORDS](records.md) (`opens`).

If the task changes schema, environment or release state, cross to [Setup](../SETUP_MAP.md). For visual-only work remain in this system node and its design contract. Coverage names are search leads inherited from the feature index, not evidence that checks passed or that every named scenario has a dedicated file.
