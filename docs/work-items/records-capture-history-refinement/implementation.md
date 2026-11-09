# Complete Stage history and all-matching Records capture — local delivery

Implemented 2026-11-08 in the primary KT recruitment_website checkout on develop, base 0cc46ba7b0e4e141b4f542cc41492aaff43fc141, preserving prior local work. Changes remain uncommitted and unpushed; no deployment or main-database change. The same checkout serves [Requisitions](http://localhost:3000/requisitions) and [Candidates](http://localhost:3000/candidates) on port 3000.

## Contracts and owners

- [Candidate Detail](../../design/candidate-detail.md#flat-sections-and-contact-review-warning): every eligible selected-application history entry renders immediately; pending first and outcome-date/log-ID completion ordering are preserved. No remaining-history disclosure or nested scroll was introduced.
- [Shared geometry](../../design/controls.md#records-headings-and-captured-selection): 48px records, centered 12px semibold headings, separate filter rows and 48px checkbox columns. [Requisition identity/order](../../design/requisition-detail.md#records-identity-and-column-order) owns the Position/Doc ID hierarchy and Linked soft tags.
- [Captured-selection behavior](../../WEBSITE_STRUCTURE.md#records-captured-selection): fixed authorized ID sets, progress/cancel, count verification, retry and fresh export. Owners fetchMatchingRecordIds/fetchSelectedRequisitions, useRecordSelection/RecordSelectionProgress, criteriaPending and fresh count options.
- Navigation: [Records](../../maps/system/records.md#records-density-and-fixed-size-pages), [Pipeline](../../maps/system/pipeline.md#flat-detail-and-records-table-refinement). [Previous delivery](../records-divider-filters-refinement/implementation.md) remains historical.

## Develop database

Updated declarative Requisition SQL first and applied [20261108121827_requisition_selected_ids.sql](../../../supabase/migrations/20261108121827_requisition_selected_ids.sql) only to mppnlkldlctvketcsald. The filename matches recorded migration version. Optional docIds accepts at most 100 nonempty string IDs and applies to all existing list/count paths. Function signatures, invoker security, ACLs, authorization and existing callers remain intact.

[Rollback-only role checks](../../../tests/db/requisition-selected-ids.sql) passed 72 cases across all nine profiles: system_admin 8, admin_recruiter 24, site_recruiter 32 and viewer 8. They compare list and optimized/normal count paths against readable IDs, include inaccessible/missing IDs and empty selections, and reject malformed/oversized arrays. [Page-size compatibility](../../../tests/db/record-page-size-compatibility.sql) passed for all six scoped entities with 7/10/25/50/100 and count-only 0, rejecting unsupported 8. No persistent fixture data was changed.

## Verification

- 97 focused browser checks passed in the final source state: 93 Records/capture/profile/privacy/loading/URL/warning/application checks plus four five-card-board/full-history/pending-edit checks.
- [Capture browser checks](../../../tests/e2e/records-capture-history.spec.ts) cover 23/1005 records for both entities, fresh export after removal, count changes/retry, progress/cancel, query cancellation, preservation of earlier manual selection, failed requests, later unselected matches and disabled capture states.
- The large-history case renders all 1,001 entries with no expansion. Existing candidate deletion permission, draft warning and application-retention checks passed.
- 56 focused unit checks passed, including capture sizes 0/7/23/100/1005, changing counts, duplicate/stuck cursors, cancellation, fresh counts, batch export and prior list/receipt behavior.
- TypeScript passed. Lint passed without errors, retaining existing repository warnings. Whitespace checks passed; mapped owner references and document links are validated separately.
- Six local routes and 32 unique CSS/JavaScript assets returned HTTP 200. Only the primary preview listener remains on port 3000. Local screenshots/metrics are kept in ignored outputs/.

### Desktop measurements

1366×768, 100% zoom, filters/disclosures closed. Seven rows and pager fit without page scrolling; candidate scope and selection controls also fit in capture/selection acceptance. Checkbox top/left insets are 16px. Requisition Position/Doc ID is 13px/600 over 11px/400. The advanced filter test verifies all labels remain vertically centered at 12px/600 in a separate 48px row. Phone checks cover 360/390px, both languages and reduced motion.

| Surface | Row height px | Pager bottom px | Document height px |
| --- | --- | --- | --- |
| /requisitions?reqSize=100&reqPage=4 | 48 | 584 | 768 |
| /candidates | 48 | 626 | 768 |
| /offers | 48 | 584 | 768 |
| /pipeline?pipelineView=table | 48 | 600 | 768 |
| /audit | 48 | 582 | 768 |
| /sourcing | 48 | 614 | 768 |
| /sourcing?qaHistory=1 | 48 | 614 | 768 |

## Limits

Browser flows use controlled Supabase fixtures; separate live develop checks verify SQL/RLS. Capture freezes criteria and validates bounded traversal, not a transactional database snapshot. New records after capture remain unselected; unavailable records are omitted from fresh export with an exported-count message. The full repository suite and production latency were not evaluated. Expanded filters/history and phones scroll naturally; wide tables retain horizontal scrolling and Audit remains desktop-only below 1024px.
