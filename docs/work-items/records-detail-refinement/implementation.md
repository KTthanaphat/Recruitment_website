# Records and detail refinement — historical ten-row delivery

Superseded by the [seven-row refinement](../seven-row-records-refinement/implementation.md). Keep the measurements below as historical evidence.

Implemented on 2026-11-07 in the primary KT `recruitment_website` checkout, branch `develop`, base `0cc46ba7b0e4e141b4f542cc41492aaff43fc141`. Changes remain local and unpushed. Preview: [localhost Records](http://localhost:3000/requisitions).

## Contracts and owners

- [Shared Records toolbar, density and pager](../../design/controls.md#records-tables-and-fixed-pagination): `RecordPagination`, `RecordCreateButton`, `RecordCell`, `TableToolbar records`; opt-in CSS keeps unrelated layouts unchanged.
- [Flat Candidate Detail and contact warning](../../design/candidate-detail.md#flat-sections-and-contact-review-warning): `CandidateProfilePanel`, `buildDetailBodyV2`, `duplicateReview`. Nested Modal Escape now dismisses only the top review and keeps the underlying draft.
- [Requisition overview](../../design/requisition-detail.md#flat-overview-strip), [Audit](../../design/audit.md), [behavior](../../WEBSITE_STRUCTURE.md#records-fixed-size-pages).
- [Owner route](../../maps/system/records.md#records-density-and-fixed-size-pages), [Pipeline/detail route](../../maps/system/pipeline.md#flat-detail-and-records-table-refinement).

## Develop database

Updated declarative list/router/adapter limit gates first, then applied [migration 20261107093211](../../../supabase/migrations/20261107093211_support_ten_row_record_pages.sql) to develop `mppnlkldlctvketcsald` before ten-row UI requests. The local filename matches the recorded migration version.

Only the supported-limit validation changes. Existing signatures, ACLs, authorization, filters, ordering and query bodies remain intact; 0 remains count-only and 25/50/100 remain valid. Main was not changed for this feature. The [rollback-only regression](../../../tests/db/ten-row-record-pages.sql) passed against develop for Requisitions, Candidates, Sourcing records, Pipeline history, Offers and Audit, including rejecting limit 11. No business rows were written.

## Verification

- TypeScript: `pnpm typecheck` passes.
- Focused browser suites: [Records refinement](../../../tests/e2e/records-refinement.spec.ts), [candidate profile](../../../tests/e2e/candidate-profile-redesign.spec.ts), [applications](../../../tests/e2e/candidate-applications.spec.ts), [URL state](../../../tests/e2e/tables-url-state.spec.ts), [loading](../../../tests/e2e/loading-feedback.spec.ts); selected large-history/correction cases in [search/outcomes](../../../tests/e2e/candidate-search-outcomes.spec.ts).
- Focused UI coverage: 69 distinct passing checks across the listed suites, including two preserved five-card board cases (23/1,005 candidates and 25-row network blocks).
- List and complete-traversal unit checks: 21 passed.
- Changed Markdown links/anchors were checked with a Node equivalent of the repository checker because Python is unavailable. Owner symbols were inspected directly. `git diff --check` passes.
- ESLint reports no errors; existing exhaustive-dependency warnings remain in the established list, sourcing and board hooks.
- Preview HTML for all six Records/Audit routes and 32 linked CSS/JavaScript assets returns HTTP 200. The server remains running from the implementation checkout.

Measured at 1366×768, 100% zoom, filters/disclosures closed, long Thai/English values, >20 filtered items. All ten rows measure **40px**, document height is **768px**, and pager bottoms are:

| Surface | Pager bottom |
| --- | ---: |
| Requisitions | 645px |
| Candidates | 653.5px |
| Offers | 637px |
| Pipeline table | 653px |
| Audit | 635px |
| Sourcing weekly work | 667.5px |
| Sourcing lifecycle history | 667.5px |

360/390px phone checks show no page-level horizontal overflow. Natural vertical scrolling remains. Expanded filters/diffs/history can increase height; wide desktop tables scroll horizontally.

Local evidence (ignored): `outputs/records-refinement-metrics.json`, `outputs/records-preview-health.json`, `outputs/records-*.png`. The warning regression exercises over 30 matches, Phone/Email categories, footer reachability, Escape, Back, Continue, preserved draft, separate profile links and no premature save.

## Verification limits

The full repository suite was not run. An exploratory broader search/outcomes run still exposes two unresolved legacy cases outside these presentation changes: normalized telephone-search expectations in the mock and terminal offer-card visibility. The affected large-history and correction cases pass after tightening their selectors/async assertion. UI acceptance uses isolated mocked data; database compatibility uses authenticated admin claims in a rolled-back SQL transaction. No live candidate was deleted for visual testing.
