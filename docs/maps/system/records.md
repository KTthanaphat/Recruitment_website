# SYS-RECORDS: Requisitions, sourcing and offers

[System entry](../SYSTEM_MAP.md) · [Task router](../../FEATURE_FILE_MAP.md)

Read this node for this feature only. It indexes ownership; product rules remain in [Recruitment workflows](../../WEBSITE_STRUCTURE.md#recruitment-workflows). Visual work uses [Forms and selectors](../../design/controls.md).

## Owners and search keys

### F30: Audit Log presentation

- Owner/search: [AuditView.tsx](../../../src/components/audit/AuditView.tsx), `auditDiffRows`.
- Entry/check: `/audit` → [Audit design](../../design/audit.md) → [focused browser test](../../../tests/e2e/ux-enhancements.spec.ts).

### F03: Requisition display identity

- Owner/search: [src/lib/format.ts](../../../src/lib/format.ts), requisition/Home/Offer views, [src/components/workspace/HiringWorkspaceView.tsx](../../../src/components/workspace/HiringWorkspaceView.tsx), [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx).
- Related symbols: `formatRequisitionTitle`, `formatRequisitionOptionLabel`, `RequisitionDetailHeader`, `EnrichedOffer.level`; [Requisition Detail design](../../design/requisition-detail.md); canonical rules: [docs/WEBSITE_STRUCTURE.md](../../WEBSITE_STRUCTURE.md).
- Entry: `/home`, `/workspace`, `/requisitions`, `/offers`.
- Sourcing link readiness: `EnrichedRequisition.sourcing_group_ids` derives from `document_groups`; `requisitionSourcingLinkReadiness` supplies Linked/Not linked for Records, Home and requisition details. Verify with [sourcing-link-readiness.spec.ts](../../../tests/e2e/sourcing-link-readiness.spec.ts).
- Priority: [RequisitionPriorityButton.tsx](../../../src/components/requisitions/RequisitionPriorityButton.tsx) owns the bookmark/pending/error state; [detail-utility.ts](../../../src/components/ui/detail-utility.ts) supplies the shared requisition header icon treatment; [requisition-priority.ts](../../../src/lib/requisition-priority.ts) owns permission visibility and the related-record scope. `app_set_requisition_priority_v1` persists the flag with existing audit/authorization rules. [Priority tests](../../../tests/e2e/requisition-priority.spec.ts) cover save/remove, failures, global filtering, shared links, roles and Thai phones.
- Existing check/search: [tests/e2e/requisition-identity.spec.ts](../../../tests/e2e/requisition-identity.spec.ts), [tests/e2e/workspace.spec.ts](../../../tests/e2e/workspace.spec.ts), [tests/e2e/wave-4.spec.ts](../../../tests/e2e/wave-4.spec.ts).

### F11: New-hire start confirmation, offer reassignment, and status refresh

- Owner/search: [HomeView.tsx](../../../src/components/dashboard/HomeView.tsx), [RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [supabase/schemas/30_triggers_audit.sql](../../../supabase/schemas/30_triggers_audit.sql).
- Related symbols: `Offer.start_confirmation`, `refresh_requisition_status_after_offer_change`, `app_confirm_offer_start_v1`.
- Notification impact: assigned-recruiter eligibility and 45/90/119-day reminder dates are projected by the [shared notification center](platform.md#f28-shared-notification-center-and-recruiter-reminders); canonical behavior is in [Recruitment workflows](../../WEBSITE_STRUCTURE.md#recruitment-workflows).
- Entry: `/home`, `/offers`.
- Existing check/search: Home, lifecycle, permission, SLA, and offer/database trigger tests.

### F13: Admin recruiter PIC assignment

- Owner/search: [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx).
- Related symbols: `recruiterNicknameOptions`, `can_manage_requisition`, `app_upsert_requisition`.
- Entry: `/requisitions`.
- Existing check/search: [tests/e2e/auth-permissions.spec.ts](../../../tests/e2e/auth-permissions.spec.ts), [tests/db/workspace-group-authorization.sql](../../../tests/db/workspace-group-authorization.sql).

### F14: Requisition department/section and replacement vacancies

- Owner/search: [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [src/app/api/department-sections/route.ts](../../../src/app/api/department-sections/route.ts), [src/lib/department-section-data.ts](../../../src/lib/department-section-data.ts), `dep_sec_data.csv`.
- Related symbols: Site-scoped Department options; cascading Section options; Headcount-driven required replacement names with confirmed trimming.
- Entry: `/requisitions`, `/workspace` requisition create/change.
- Existing check/search: [tests/e2e/auth-permissions.spec.ts](../../../tests/e2e/auth-permissions.spec.ts), requisition form validation coverage.

### F16: Workspace/Pipeline candidate creation and sourcing summary

- Owner/search: [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx), [src/components/sourcing/SourcingView.tsx](../../../src/components/sourcing/SourcingView.tsx).
- Related symbols: direct `candidates.group_id`; optional phone/email; optional `doc_group_id` is requisition-match context.
- Entry: `/workspace?...&section=pipeline`, `/sourcing`.
- Existing check/search: candidate/form, workspace, Pipeline, Offer, and candidate SQL checks.

### F17: Sourcing group visibility, ownership, and setup actions

- Owner/search: [src/components/sourcing/SourcingView.tsx](../../../src/components/sourcing/SourcingView.tsx), [src/components/RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx).
- Related symbols: System Admin and Admin Recruiter may add cross-site Group Details matches; Site Recruiters may add only from existing group sites and retain site/PIC ownership checks. New Group remains single-site. Unmatch preserves the group candidate pool and clears/reassigns optional match context.
- Entry: `/sourcing` → `/workspace?type=group&id=<group_id>&section=sourcing`.
- Existing check/search: [tests/e2e/wave-4.spec.ts](../../../tests/e2e/wave-4.spec.ts), [tests/db/workspace-group-authorization.sql](../../../tests/db/workspace-group-authorization.sql).

### F18: Sourcing work board, inline workspace editor, and history

- Owner/search: [SourcingView.tsx](../../../src/components/sourcing/SourcingView.tsx), [RecruitmentWorkspace.tsx](../../../src/components/RecruitmentWorkspace.tsx).
- Related symbols: [dictionary.ts](../../../src/lib/i18n/dictionary.ts); Group Details has channel checkboxes, Save, and confirmed icon-only Unmatch; `NULL` means unrecorded.
- Entry: `/sourcing`, Workspace.
- Existing check/search: [tests/e2e/wave-4.spec.ts](../../../tests/e2e/wave-4.spec.ts).

- Loading ownership: `sourcing_records` uses a sourcing-only projection; the legacy `sourcing` contract remains available. Embedded selected-week loading is independent of the 25-week navigator and charts. See [Workspace loading behavior](../../design/workspace.md#independent-sourcing-loading). Checks: `sourcing-list-query.spec.ts` and `node scripts/rehearse-profile-contract.cjs --sourcing-records`.

## Dependency edges

| Edge | Target | Follow when |
| --- | --- | --- |
| `uses` | [SYS-PLATFORM](platform.md) | Fields, selectors, roles and language |
| `opens` | [SYS-WORKSPACE](workspace.md) | Group-scoped work |
| `feeds` | [SYS-PIPELINE](pipeline.md) | Candidate group context |

## Impact back-links

[SYS-HOME](home.md) (`reads`), [SYS-WORKSPACE](workspace.md) (`embeds`), [SYS-PIPELINE](pipeline.md) (`reads`), [SYS-REPORTING](reporting.md) (`reads`).

If the task changes schema, environment or release state, cross to [Setup](../SETUP_MAP.md). For visual-only work remain in this system node and its design contract. Coverage names are search leads inherited from the feature index, not evidence that checks passed or that every named scenario has a dedicated file.

Candidate/requisition form refinement: `src/components/RecruitmentWorkspace.tsx`, `src/components/requisitions/AuthorizedRequisitionLookup.tsx`; layout contracts: [candidate detail](../../design/candidate-detail.md), [requisition detail](../../design/requisition-detail.md), [selector controls](../../design/controls.md). Focused checks: candidate-search-outcomes and requisition-identity browser specs.

### Committed requisition saves

Requisition status, creation/editing and priority use the additive requisition action RPC, exact-ID receipts and scoped 100 ms refresh notifications. Owners: requisition-action-receipt, RecruitmentWorkspace and recruitment-list. [Behavior and verification](../../work-items/requisition-committed-updates/implementation.md) → [detail contract](../../design/requisition-detail.md#committed-saves-and-reconciliation).


### Records density and fixed-size pages

- Owners/search: `RecordPagination` (adaptive viewport measurement), `RecordFilterPanel`, `useRecordCategoryOptions`, `RecordCreateButton`, `RECORD_PAGE_SIZE` in [RecordsControls](../../../src/components/ui/RecordsControls.tsx), `TableToolbar records`, `TableFilterField`, `RecordSortTriangles`, `useRecruitmentList`, `SourcingWorkBoard`, `HistoryTableControls`, `AuditView`.
- Contract/checks: [Records controls](../../design/controls.md#records-tables-and-fixed-pagination), [flat overview](../../design/requisition-detail.md#flat-overview-strip), [browser acceptance](../../../tests/e2e/records-refinement.spec.ts), [adaptive resize](../../../tests/e2e/records-adaptive-pagination.spec.ts).
- SQL ownership: [list schema](../../../supabase/schemas/60_recruitment_list.sql), [candidate adapter schema](../../../supabase/schemas/61_candidate_actions.sql), [page sizes](../../../tests/db/record-page-size-compatibility.sql), [category compatibility](../../../tests/db/record-category-filter-compatibility.sql); search recruitment_category_values_v1.
- Delivery evidence: [local verification](../../work-items/records-capture-history-refinement/implementation.md).

- Priority/Updated owners: CandidateRegistry, RecordPriorityIndicator, requisitionQueryAffected, has_priority_requisition; [semantics](../../WEBSITE_STRUCTURE.md#candidate-registry-priority-and-visible-date), [SQL](../../../tests/db/candidate-registry-priority.sql), [browser](../../../tests/e2e/records-priority-history.spec.ts).

- Divider/filter/selection owners: CandidateRegistry, candidateColumnFilterError/fetchSelectedCandidateRecords in [registry helper](../../../src/lib/candidate-registry-records.ts), useRecordSelection/RecordSelectionCheckbox, RequisitionsView; [behavior](../../WEBSITE_STRUCTURE.md#candidate-registry-column-filters-and-selection) → [UI checks](../../../tests/e2e/records-divider-filters.spec.ts) / [SQL checks](../../../tests/db/candidate-registry-column-filters.sql).

- Captured selection/fresh export: fetchMatchingRecordIds and fetchSelectedRequisitions in [records-selection](../../../src/lib/records-selection.ts), useRecordSelection, criteriaPending/fresh counts; [contract](../../WEBSITE_STRUCTURE.md#records-captured-selection) → [browser](../../../tests/e2e/records-capture-history.spec.ts) / [SQL](../../../tests/db/requisition-selected-ids.sql).

- Candidate history workbook and staged Records filter sidebar: [contract](../../WEBSITE_STRUCTURE.md#candidate-registry-column-filters-and-selection) → [export](../../../src/lib/candidate-full-export.ts) / [checks](../../../tests/e2e/records-divider-filters.spec.ts).
