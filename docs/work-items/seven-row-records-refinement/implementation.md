# Seven-row Records and compact contact review — local delivery

Historical: spacing, filters, priority and loading are superseded by [Records priority/history](../records-priority-history-refinement/implementation.md). Original evidence remains below.

Implemented 2026-11-08 in the primary KT `recruitment_website` checkout on `develop`, base `0cc46ba7b0e4e141b4f542cc41492aaff43fc141`, preserving the prior local work. No commit, push or deployment. [Preview](http://localhost:3000/requisitions).

## Owners and contracts

- [Candidate Detail](../../design/candidate-detail.md#flat-sections-and-contact-review-warning): compact warning, one red Create Separate Cand. action, accessible subtitle, Close/Escape draft return and restored profile card; ordinary confirmation and flat application/timeline retained.
- [Shared Records](../../design/controls.md#records-tables-and-fixed-pagination): seven-row pager and responsive below-search filters; [Audit](../../design/audit.md) remains desktop-only below 1024px, explicitly confirmed by the user.
- [Records owners](../../maps/system/records.md#records-density-and-fixed-size-pages), [Pipeline/detail owners](../../maps/system/pipeline.md#flat-detail-and-records-table-refinement), [behavior](../../WEBSITE_STRUCTURE.md#records-fixed-size-pages).

## Develop database

Only develop `mppnlkldlctvketcsald` was changed. Declarative schemas were edited first and local migration filenames match recorded versions. Main was not changed.

- [20261108053028](../../../supabase/migrations/20261108053028_support_seven_row_record_pages.sql): accept 7, retain 10/25/50/100 and count-only 0. Before/after fingerprints excluding limit guards matched, including function bodies, ACLs and security settings. Verified before the UI requested seven rows.
- [20261108055925](../../../supabase/migrations/20261108055925_fix_record_category_filter_compatibility.sql): additionally approved after a live check found 8 Ongoing requisitions for a scalar filter but 0 for the existing checkbox JSON. The private invoker decoder expands choices as OR within fields; fields remain ANDed. It supports bilingual aliases, Sourcing categories, displayed Offer status/date labels and impact ratios. Existing scalar handling, authorization, table policies, ordering and bounds remain compatible. The first attempt rolled back on a missing statement terminator; this corrected version applied successfully.

[Page-size checks](../../../tests/db/record-page-size-compatibility.sql) and [category checks](../../../tests/db/record-category-filter-compatibility.sql) are rollback-only with no business-row writes. Category checks run under the actual authenticated role with admin claims: bilingual selections, unions, counts/page consistency, impact values and malformed input. Category choices reuse authorized bootstrap/page rows and retain seen values within access/header/language scope; no full-list lookup.

## Verification

Focused suites: [Records/panels](../../../tests/e2e/records-refinement.spec.ts), [bilingual warning](../../../tests/e2e/seven-row-warning.spec.ts), [profile/privacy/deletion](../../../tests/e2e/candidate-profile-redesign.spec.ts), [applications](../../../tests/e2e/candidate-applications.spec.ts), [URL state](../../../tests/e2e/tables-url-state.spec.ts), [loading](../../../tests/e2e/loading-feedback.spec.ts), plus selected five-card board and large-history/correction cases.

76 focused UI checks pass across the listed suites and selected compatibility cases. Type checking passes. Focused ESLint has no errors; existing exhaustive-dependency warnings remain in established hooks. List/complete-traversal unit checks: 21 passed.

At 1366×768 and 100% zoom, closed filters/disclosures, every surface has seven 40px rows and document height 768px. Pager bottoms:

| Surface | Bottom |
| --- | ---: |
| Requisitions | 524px |
| Candidates | 532.5px |
| Offers | 516px |
| Pipeline table | 532px |
| Audit | 514px |
| Sourcing weekly/history | 546.5px |

Filter panels use four/two/one columns; 360/390px Records have no page-level horizontal overflow. Audit retains its desktop-required notice. Menus fit near the viewport bottom. Warning checks cover one/31 matches, both languages and 1366/390/360px: bounded size, phone margins, reachable footer, list scrolling, subtitle, draft return and no premature write.

All six local routes and 32 linked CSS/JavaScript assets return HTTP 200. The implementation-checkout server remains running. Changed documentation links/anchors and owner symbols were validated; git diff --check passes.

Ignored evidence: `outputs/seven-records-refinement-metrics.json`, `outputs/seven-records-*.png`, `outputs/seven-filter-*.png`, `outputs/seven-warning-*.png`. The ten-row delivery remains historical and links here.

## Limits

The full repository suite was not run. Two previously documented broader legacy search/outcome cases remain outside this revision; focused large-history/correction cases are checked separately. UI scenarios use isolated mocks; database checks are authenticated rollback-only reads. No live candidate was deleted for visual testing. Expanded filters/details may increase height; wide tables scroll horizontally.
