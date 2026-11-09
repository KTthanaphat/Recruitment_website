# Records dividers, candidate filters and compact Stage history — local delivery

Historical presentation: 48px rows, expanded history, Requisition identity and all-matching capture supersede parts of this delivery. See [current delivery](../records-capture-history-refinement/implementation.md). Original evidence remains below.

Implemented 2026-11-08 in the primary KT recruitment_website checkout on develop, base 0cc46ba7b0e4e141b4f542cc41492aaff43fc141, preserving all prior local work. No commit, push, deployment or main-database changes. Preview remains running: [Requisitions](http://localhost:3000/requisitions), [Candidates](http://localhost:3000/candidates).

## Contracts and owners

- [Shared controls](../../design/controls.md#records-tables-and-fixed-pagination) and [selection/Linked](../../design/controls.md#records-selection-and-linked-indicators): continuous divider rows, checkbox alignment/fade, adjacent sort icons, neutral Export/Clear controls and linkage dots.
- [Candidate filters/export](../../WEBSITE_STRUCTURE.md#candidate-registry-column-filters-and-selection): visible scope selector, expanded fields, masked semantics, fresh selected-ID export. Owners CandidateRegistry, candidate-registry-records and shared download-csv.
- [Candidate Detail](../../design/candidate-detail.md#flat-sections-and-contact-review-warning): state removed from the standalone history line, accessible marker descriptions and measured 2px title/detail proximity.
- [Records routing](../../maps/system/records.md#records-density-and-fixed-size-pages), [Pipeline routing](../../maps/system/pipeline.md#flat-detail-and-records-table-refinement). [Previous delivery](../records-priority-history-refinement/implementation.md) is historical.

## Develop migration

Updated declarative schema first, reviewed the live invoker router and applied [20261108082731_candidate_registry_column_filters.sql](../../../supabase/migrations/20261108082731_candidate_registry_column_filters.sql) only to mppnlkldlctvketcsald. Local filename matches recorded version. Public signatures, ACL/security-invoker configuration, read helpers, priority projection, cursor ordering and limits remain intact. Filtering uses the authorized redacted projection before counts/paging. Existing callers omit the new keys without behavior changes.

[Rollback-only SQL checks](../../../tests/db/candidate-registry-column-filters.sql) passed 234 cases across all nine profiles: system_admin 26, admin_recruiter 78, site_recruiter 104 and viewer 26. Cases cover field/count parity, literal wildcard text, combined bounds, masked projection, cursor traversal, selected-ID scopes and malformed/oversized requests. [Legacy page-size checks](../../../tests/db/record-page-size-compatibility.sql) also pass for all six scoped entities with 7/10/25/50/100 and count-only 0, rejecting unsupported 8. No persistent fixture data was changed.

## Verification

- 88 distinct focused browser checks passed across Records, candidate applications, priority/loading, new divider/filter acceptance, profile/privacy/deletion, loading feedback, URL state, bilingual warnings, board preservation and full-history/pending-edit checks. The initial collapsed-border half-pixel geometry issue was fixed before the final viewport pass; strict selector issues in new checks were corrected without weakening expected behavior.
- 46 unit checks passed, including range validation, 100-ID export batching, fresh reads after masking, cancellation, list traversal and receipt/cache behavior.
- Documentation validation passed: 15 changed/new Markdown files and 560 links/anchors, with no issues; mapped owner symbols and whitespace were checked.
- TypeScript passed; lint passed without errors, retaining existing repository warnings. No full-suite run is claimed.
- All six local routes and 32 unique JavaScript/CSS assets returned HTTP 200. Screenshots and JSON measurements remain in ignored outputs/.

### Viewport evidence

1366×768 at 100% zoom, filters/disclosures closed: seven complete rows plus pager fit; document height is 768. Candidate scope stays visible; selection controls also fit in the dedicated selection check. Checkbox insets measure 12px, sort-icon gap 6px, Linked circle 10px and Stage history title/detail gap 2px. Phone checks cover 360/390px, Thai/English and reduced motion.

| Surface | Row height px | Inter-row gap px | Pager bottom px |
| --- | --- | --- | --- |
| /requisitions?reqSize=100&reqPage=4 | 40 | 0 | 520 |
| /candidates | 40 | 0 | 570 |
| /offers | 40 | 0 | 516 |
| /pipeline?pipelineView=table | 40 | 0 | 532 |
| /audit | 40 | 0 | 514 |
| /sourcing | 40 | 0 | 546 |
| /sourcing?qaHistory=1 | 40 | 0 | 546 |

## Limits

UI flows use controlled Supabase fixtures; separate live develop role checks verify database filtering/privacy. The full repository suite and production latency were not evaluated. Wide tables preserve horizontal scrolling. Phones and expanded filters/details scroll naturally; Audit remains desktop-only below 1024px.
