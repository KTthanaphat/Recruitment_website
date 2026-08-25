# Candidate Pipeline Paired-Status Implementation

Last updated: 2026-08-15

Status: implemented; production migration execution remains an operational deployment step.

This is the focused implementation record. Current user-facing rules belong in `docs/WEBSITE_STRUCTURE.md`; file ownership belongs in `docs/FEATURE_FILE_MAP.md`.

## Implemented contract

### Candidate References and Reference Check gate

- `candidate_references` is an optional, separately audited contact-reference list. It does not replace sourcing `candidates.ref_name`.
- Each Available reference requires one final `candidate_reference_checks` row with Bangkok date, positive conversation duration in minutes, and summary. Unavailable and archived references need a reason.
- Reference Check Pass is rejected until every Available reference is checked; Fail remains available, zero references pass, and forward jumps cannot bypass the same guard.
- Reference changes remain audited after a Pipeline outcome and never reopen that immutable stage result.

The active stored stages are:

```text
Phone Screen -> HR Interview -> Line Interview -> Test -> Reference Check -> Offer
```

`Resume Screening` remains journey/report display only. `First Contact`, `Rejected`, and `Withdrawn` are legacy/non-board history.

Each canonical `recruitment_logs` row represents one:

```text
candidate_id + recruitment_process + round
```

It contains:

- Pending: `log_date` (opened date), optional `estimated_action_date`, `interviewer`, `remark`, plus edit timestamp/actor.
- Outcome: immutable `result`, `outcome_date`, `outcome_interviewer`, `outcome_remark`, and recorded timestamp.
- Identity/audit: `stage_instance_id`, `record_origin`, migration note, update timestamp, and supersession metadata.

`result IS NULL` is `Awaiting outcome`; `1` is Passed; `0` is Failed. Superseded rows remain queryable through Audit Log but are excluded from operational state and reporting.

## Invariants

- One canonical row per candidate/stage/round.
- At most one unresolved canonical Pending row per candidate.
- Canonical rows use only the six active stages and positive rounds.
- Pending rows have no Outcome fields; completed rows require result, Outcome date, and recorded timestamp.
- Outcome cannot precede Pending.
- An estimate is null or on/after its Pending opened date; it may be overdue or later than the eventual Outcome and remains historical metadata after completion.
- Supersession timestamp, replacement ID, and reason are consistent; the replacement is a valid distinct stage instance.
- Generic deletion cannot remove a canonical Pipeline row.
- All transition indexes and terminal checks ignore superseded rows.

Authoritative chronology:

```text
previous Outcome
<= current Pending opened date
<= current Outcome date
<= next Pending opened date
<= Asia/Bangkok business date
```

Same-day transitions are valid.

Estimated action dates use a separate invariant and do not alter the authoritative Outcome chronology:

```text
Pending opened date <= estimated action date (when present)
```

## Migration and reconciliation

Migration: `supabase/migrations/202608010001_candidate_pipeline_paired_status.sql`

The migration:

1. Adds the paired-status and supersession columns as nullable where required for reconciliation.
2. Groups active history by candidate/stage/round and chooses the newest Outcome, otherwise newest Pending, as canonical.
3. Copies the newest matching Pending detail to the canonical row and moves the selected old Outcome into Outcome fields.
4. Supersedes duplicate rows and links them to the canonical stage instance.
5. Generates missing Pending dates deterministically from the previous canonical Outcome, First Contact, old Outcome, or original creation time; chronology clamps and inferences receive migration notes.
6. Infers Pass for a Pending-only historical stage followed by a later stage.
7. Keeps the latest unresolved stage Pending and creates only an immediate missing next Pending after a latest non-Offer Pass.
8. Supersedes active records after a canonical Fail and marks legacy/non-board rows as migration history.
9. Adds unique/check/FK constraints and superseded-aware indexes after reconciliation.

Absent historical stages are not invented. A legacy-only candidate keeps no active stage; those legacy audit rows use the narrowly constrained null-replacement supersession exception. Before deployment, back up production and review the migration preflight/reconciliation output in a disposable Supabase environment.

## Public model and RPCs

### 2026-08-15 estimated action date and Home calendar

- Migration `supabase/migrations/202608150002_pipeline_estimated_action_calendar.sql` adds nullable `recruitment_logs.estimated_action_date` with no backfill and updates the existing Pipeline RPCs without adding a new write surface.
- Start, Edit Pending, completion-generated next Pending, next Test round, jump target, and admin correction accept `pending.estimated_action_date`; clearing submits null. Completion and jump preserve the current stage estimate as audit/history data.
- Home derives read-only stage events from unresolved, canonical, estimated rows and start-working events from `offers.first_working_date`, each intersected with the authorized Site/PIC-filtered candidate set. Desktop uses a browsable month grid; phone uses the same grid plus a selected-day agenda.
- Fail Stage hides Current Pending controls while submitting the saved Pending values unchanged. Detail, Table, correction, and Audit continue to show those values.

### 2026-08-15 derived Pending dates and Candidate Offer editing

- Migration `20260815090000_derived_pipeline_pending_dates.sql` makes `log_date` server-derived: First Contact Date for initial Phone Screen, then the preceding passed Outcome. Pending dates are read-only in the UI and client values are not authoritative.
- Admin Outcome correction updates only an immediate unresolved next Pending; downstream completed history and estimate conflicts reject atomically. Candidate Detail Offer cards edit accepted date, first working date, and remark through existing `app_upsert_offer` change mode.

### 2026-08-11 completion-date and Offer-handoff adjustment

- On a non-Offer Pass, `app_complete_pipeline_stage_v2` derives the immediate next Pending `log_date` from `outcome.date`; legacy `next_pending.opened_date` input is ignored.
- The completion form shows that derived same-day date but does not submit an editable next-date field.
- The client opens the Offer handoff prompt only from the RPC's `offer_handoff` response, which is returned only by a successful Offer-stage Pass.

### 2026-08-11 Workspace candidate creation

- Embedded Workspace Pipeline renders a visible New Candidate command only with eligible active document-group links. The modal uses the shared CommandSelector: it locks one contextual Group ID or scopes its list to multiple contextual links.
- New candidate creation accepts only ongoing requisition links with remaining headcount; Site Recruiters must also own the linked Site/PIC. `app_upsert_candidate` is the authoritative check; migration `202608110002_candidate_creation_group_eligibility.sql` applies it.
- Coverage: `tests/e2e/workspace-lifecycle.spec.ts` and targeted candidate-RPC SQL checks.

Shared model: `ActiveProcessStage`, `PendingStatusDetail`, `OutcomeStatusDetail`, and `PipelineStageRecord` in `src/types/recruitment.ts`.

| RPC | Purpose | Key guarantees |
| --- | --- | --- |
| `app_update_pipeline_pending_v2` | Edit current Pending date/estimate/interviewer/remark | Candidate lock, PIC/role authorization, current-instance check, `expected_updated_at`, chronology, audited update |
| `app_complete_pipeline_stage_v2` | Save final Pending detail and Pass/Fail Outcome | Preserves current estimate; optional next estimate; atomic required next Pending for non-Offer Pass; none for Fail/Offer |
| `app_pass_pipeline_jump_v2` | Forward jump across consecutive stages | Preserves current estimate; optional target estimate; Pass-only crossed records, server-derived order, all-or-nothing transaction |
| `app_correct_pipeline_outcome_v2` | System Admin correction of completed Outcome details | Result cannot change; old canonical row is superseded; corrected replacement preserves Pending/result and downstream state |

Stable error prefixes cover authorization, invalid payload, stale write, non-current stage, terminal state, invalid transition, date order, missing next Pending, and duplicate stage/round.

Pipeline writes are v2-only. `app_start_pipeline_stage_v2` starts a no-activity candidate at Phone Screen Pending; edit, completion, jump, and correction use their existing v2 RPCs. The previous generic/process-jump/Test wrapper RPCs are removed by `202608010002_pipeline_v2_only_cleanup.sql`.

## Recruiter interaction

### Pipeline Table view

- `/pipeline` keeps Board as its default view and offers a complete Table register for active, no-activity, failed, and Offer-complete candidates.
- The Table is a record register: every canonical stage/round is a row. Admin roles may open an audited correction modal for pending/outcome detail and dates; stage/round remain fixed and superseded rows are audit-filter only.
- Table search, sortable columns, per-column advanced filters, Pipeline state, and Last-touch date range are URL-shareable. Desktop uses the shared scrollable table; mobile uses compact record cards.
- System Admin and Admin Recruiter can open the existing stage actions from eligible rows. Site Recruiters retain Site/PIC-only write scope; Viewers and terminal rows are read-only. Table controls never write inline or bypass the existing v2 RPC/audit flow.

Current Pending card menu order:

1. `Pass stage`
2. `Fail stage`
3. `Add another Test round` when current stage is Test
4. Forward targets beyond the immediate next stage
5. `Edit pending details`

The board card remains compact. Full Pending/Outcome fields live in modals and Candidate Detail.

- Edit Pending loads exact saved values and locks candidate/stage/round/status.
- Pass displays locked stage/round context, editable Pass Outcome, and the required next Pending unless current stage is Offer; stored Current Pending values are submitted unchanged.
- Fail hides Current Pending controls, carries the saved values invisibly, and shows only locked stage context plus the Fail Outcome section.
- Outcome date defaults to Bangkok today; Outcome interviewer copies Pending; new remarks and new next-stage interviewer/remark start blank.
- Drag/drop and the equivalent keyboard menu command open the same jump confirmation and never write on drop.
- Jump shows a Pending/Passed pair for every crossed stage plus the target Pending.
- Test `Pass stage` opens Reference Check. `Add another Test round` opens Test round N+1.
- Offer Pass returns an eligible candidate/group/requisition handoff and no next Pipeline stage.

Candidate Detail renders the derived journey, expanded Current Stage, then Completed Stage History. Cards show Pending, Outcome or Awaiting outcome, Edited/Migrated text indicators, migration note, and an exact Audit Log link. Test rounds sort numerically. Superseded duplicates never appear in the primary history.

## Authorization and integrity

- System Admin and Admin Recruiter may manage all candidates. System Admin can open and save `Edit pending details` regardless of Site or PIC ownership.
- Site Recruiter requires both assigned Site and nickname/PIC ownership.
- Viewer is read-only.
- Candidate and stage rows are locked before validation.
- Optimistic timestamps reject concurrent/stale writes without partial changes.
- Transition/date rules live in SQL as well as client validation.
- Offer handoff requires eligible group/requisition context.
- Audit actions distinguish Pending edit, Pass, Fail, jump stages/target, migration, supersession, correction, and automatic next Pending.

Unrelated findings were deliberately excluded: signup role bootstrap, candidate-mode takeover, offer-deletion requisition refresh, aging/recent-window terminology, and candidate group-transfer policy.

## Compact implementation map

| Layer | Files |
| --- | --- |
| Canonical schema/RPCs | `supabase/schemas/10_tables.sql`, `20_indexes.sql`, `30_triggers_audit.sql`, `50_rpc_functions.sql` |
| Migration/fresh install | `supabase/migrations/202608010001_candidate_pipeline_paired_status.sql`, `supabase/restructured/00_fresh_schema.sql` |
| Types/current-state/reporting | `src/types/recruitment.ts`, `src/lib/data.ts`, `src/lib/operations.ts`, `src/components/dashboard/VacancyWaterfallView.tsx` |
| Board/modals/detail/audit | `src/components/pipeline/PipelineBoardView.tsx`, `src/components/RecruitmentWorkspace.tsx`, `src/components/audit/AuditView.tsx`, `src/lib/i18n/dictionary.ts` |
| Database tests | `tests/db/candidate-pipeline-paired-status.sql`, `tests/db/workspace-group-authorization.sql` |
| Browser fixtures/tests | `tests/e2e/support/mock-supabase.ts`, `tests/e2e/pipeline-actions.spec.ts` |

Candidate identity contract: `app_upsert_candidate` accepts nullable trimmed `nickname`, `phone_no`, and `email` for New writes. Supplied email is format-validated but non-unique; Change writes require a valid phone number. Current presentation rules are canonical in `docs/WEBSITE_STRUCTURE.md`; ownership and focused coverage are in `docs/FEATURE_FILE_MAP.md`.

## Verification record

- v2-only cleanup: added `app_start_pipeline_stage_v2`; migration `202608010002_pipeline_v2_only_cleanup.sql` removes the four legacy Pipeline write RPCs.
- Menu/scroll reliability: card menus render in a viewport overlay above board cards; the shared overlay lock now restores both document and body scrolling by owner token.
- Pass/Fail simplification: both outcome forms keep Current Pending values immutable in hidden inputs; Fail renders only the outcome fields and submits `next_pending: null`. System Admin's explicit client capability and database authorization regression cover Pending edits outside Site/PIC ownership.
- `pnpm typecheck`: passed using the bundled workspace Node runtime.
- `pnpm build`: passed; all 17 routes compiled and generated. One pre-existing non-blocking `react-hooks/exhaustive-deps` warning remains at `RecruitmentWorkspace.tsx:289`.
- Focused `tests/e2e/pipeline-actions.spec.ts`: eight scenarios passed, including Pass payload preservation and System Admin Pending edit scope.
- Candidate-reference focused browser coverage verifies the disabled Reference Check Pass action, check save, and re-enabled Pass path. Disposable Supabase execution remains required before deployment.
- Full E2E regression: 59/62 passed on the first full run; its three failures were stale Current Stage expectations and a fixed-clock welcome expectation. All three corrected cases passed in the immediate targeted rerun, covering all 62 cases.
- `git diff --check`: passed.
- Canonical schema fragments and `supabase/restructured/00_fresh_schema.sql`: generated-equivalence check passed.
- Fresh schema integrity: 2,966 lines, closing `commit;`, no truncation/placeholder markers.
- Disposable Supabase migration/authorization execution: not run locally because Supabase CLI, Docker, and PostgreSQL tools are unavailable; required before production deployment.
- Estimated-action/calendar implementation (2026-08-15): migration `202608150002_pipeline_estimated_action_calendar.sql`, canonical/declarative/fresh-install schema, five existing Pipeline RPC contracts, UI types/forms/history/table/cards, localized Home calendar, mock persistence, and focused database/browser assertions were updated together.
- Estimated-action focused browser checks: 6/6 passed for Edit/Clear, Pass preservation and next Pending scheduling, Fail immutability/no next Pending, Site/PIC filtering, month navigation, Candidate Detail opening, and mobile calendar behavior. The active Pipeline card estimate/Overdue display check also passed independently.
- Current validation: bundled-runtime TypeScript check, production build (17 routes), and `git diff --check` passed. The build retains one unrelated `react-hooks/exhaustive-deps` warning in `RecruitmentWorkspace.tsx`.
