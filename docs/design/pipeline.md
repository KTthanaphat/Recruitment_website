# Pipeline board contract

Standalone and Workspace boards publish each visible stage independently from 25-record authorized cursor blocks, keeping current failed/passed-offer period rules. Offscreen stages start on intersection or keyboard focus; embedded phone stages start when opened. Exact totals load separately and never block cards. Show `—` before a count succeeds and `current page / …` before an exact page total exists. Retain previous same-scope records and totals while updating; reset on search/filter/user/scope changes.

Show five cards per stage or terminal section, sliced before Site/Owner subgrouping. Navigate locally inside a block, retain previous blocks, and prefetch only the following block at background priority. Next follows loaded records/server cursors; exact counts do not decide whether another block exists. Independent chevrons retain other stages' positions. No wrapping or page-size selector. Hide empty pagers; use localized names/tooltips and existing desktop/phone targets. Focusable stage sections activate lazy reads for keyboard users. Respect reduced motion when revealing saved candidates.

Candidate workflows publish only committed server receipts, then reconcile affected loaded criteria once after a 100 ms batch. Source cards leaving their filter are removed immediately; location reads fetch only the destination block and highlight its card. Excluded candidates produce a saved-result message without changing filters. Application removals never disclose restricted destination records. Existing writes, business rules and legacy RPCs remain available; exports retain verified complete traversal.

Owners: [board](../../src/components/pipeline/PipelineBoardView.tsx), [bounded hook](../../src/lib/pipeline-board-list.ts), [candidate receipts](../../src/lib/candidate-action-receipt.ts), [list/cache revisions](../../src/lib/recruitment-list.ts), [SQL](../../supabase/schemas/61_candidate_actions.sql). Verification and release gates: [implementation record](../work-items/candidate-pipeline-latency/implementation.md).

## Compact stage pagination and failed columns

Active, failed and passed-offer pagers use the order `< current/total >`: 14px chevrons, 28px desktop buttons, 2px gaps and 44px phone touch targets. Counts remain eventual (`1/…` while unknown); empty pagers are hidden. Keyboard focus and localized names remain visible. History-table pagination is separate.

Each failed stage owns a five-card page within 25-record cursor blocks, its exact count, loading/error/retry state and cached navigation. The section has no shared pager. Offscreen columns activate on intersection or focus; changing a page leaves other stages' positions unchanged. Search, header/group scope and identity reset their pages. Standalone last-seven-days and embedded all-time failure membership remain unchanged. Refresh/reconciliation recovers an emptied page without inventing counts. Committed receipts invalidate source/destination failed stages only.

## Candidate card hierarchy

Owner: [PipelineBoardView](../../src/components/pipeline/PipelineBoardView.tsx). Applies to main Pipeline cards, compact workspace cards and phone workspace stage lists. Tables retain existing columns.

Show candidate name first, the application’s group name on its own line second, then existing metadata. Use the card’s group_position; never infer a group from another application or current selection. Blank names display — without another request.

Keep the name primary. Group names use smaller medium-weight slate text, normal line height, approximately 4px spacing, and unrestricted wrapping including unbroken text. Do not truncate group names or add a label, badge or group ID. Cards grow vertically; top-right actions stay aligned with the identity block.

Shared cards retain candidate ID, site and their existing owner visibility beneath the group name, without repeating it. Phone workspace lists retain site beneath the group name. Keep name and group inside the same detail-opening button. Preserve application navigation, dates, warnings, estimates, stage actions and drag/drop.

Check desktop and 390px phone layouts; long English/Thai/mixed/unbroken names; blank groups; multiple applications; keyboard opening; actions and dragging. [Pipeline checks](../../tests/e2e/pipeline-board.spec.ts) and [workspace checks](../../tests/e2e/workspace.spec.ts) own regression coverage.

Focused card layout checks: [pipeline-card-layout.spec.ts](../../tests/e2e/pipeline-card-layout.spec.ts).

Standalone Pipeline table mode follows the [shared ten-item Records contract](controls.md#records-tables-and-fixed-pagination). Board and embedded pagination remain as defined above.
