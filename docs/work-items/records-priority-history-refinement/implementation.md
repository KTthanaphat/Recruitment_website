# Records priority, spacing and retained candidate detail — local delivery

Historical presentation: divider rows, compact history, candidate filters and selection are superseded by [Records divider/filter refinement](../records-divider-filters-refinement/implementation.md). Original results remain below.

Implemented 2026-11-08 in the primary KT recruitment_website checkout on develop, base 0cc46ba7b0e4e141b4f542cc41492aaff43fc141, preserving prior uncommitted changes. No commit, push, deploy or main-database changes. Preview: [Requisitions](http://localhost:3000/requisitions), [Candidates](http://localhost:3000/candidates).

## Contracts and owners

- [Shared controls](../../design/controls.md#records-tables-and-fixed-pagination): seven rows, 8px desktop gaps, 16px phone card separation, header/mobile-inline filters, read-only priority.
- [Priority and visible-date behavior](../../WEBSITE_STRUCTURE.md#candidate-registry-priority-and-visible-date): candidate_registry projection, masked privacy and server Updated ordering/candDir.
- [Candidate loading](../../design/candidate-detail.md#retained-profile-during-application-loading): retained shell/requested versus loaded keys, application skeleton/retry/access loss; Stage history reuses PipelineStageMarker from Journey.
- [Records routing](../../maps/system/records.md#records-density-and-fixed-size-pages), [Pipeline routing](../../maps/system/pipeline.md#flat-detail-and-records-table-refinement). Previous [seven-row delivery](../seven-row-records-refinement/implementation.md) remains historical.

## Develop SQL

Declarative schema updated before migration. Applied only to develop mppnlkldlctvketcsald as [20261108071946_project_candidate_requisition_priority.sql](../../../supabase/migrations/20261108071946_project_candidate_requisition_priority.sql), matching the recorded version. Additive boolean is computed for returned page rows using existing read helpers and RLS; counts, signatures, cursors and size compatibility remain unchanged.

[Rollback regression](../../../tests/db/candidate-registry-priority.sql) passed for all nine reader profiles across four roles: 17 system_admin rows, 51 admin_recruiter rows, 22 site_recruiter rows and 17 viewer rows, 107 total. Every flag matched authorized active relationships; masked timestamps remained absent. Rollback-only toggles verified false → true projection without retaining data changes. Six affected entities accepted 7/10/25/50/100 and count-only 0, rejecting unsupported 8. Requisition receipt invalidation now refreshes unfiltered and header-scoped registry projections rather than patching a guessed flag.

## Verification

- Documentation validation passed: 13 changed/new Markdown files, 508 links/anchors, no issues. Whitespace checks passed.
- TypeScript passed; lint passed with existing repository warnings and no errors.
- 81 distinct focused browser checks passed: existing candidate/profile/loading/URL/Records suite (68), [priority/history suite](../../../tests/e2e/records-priority-history.spec.ts) (5), compact warning (4), five-card board preservation (2), full-history and pending-edit checks (2).
- 42 focused list, complete traversal and candidate/requisition receipt unit checks passed, including authoritative priority cache refresh.
- Header filter menus tested as body portals, live selections/closing/reopening and phone viewport bounds. Candidate rapid switching, stale response cancellation, retained DOM, retry and lost-application header refresh verified. Both warning languages and 360/390px phone layouts checked.
- All six local routes and 32 unique CSS/JavaScript assets returned HTTP 200. Server remains on port 3000 from this checkout.

### Desktop measurements

1366×768, 100% zoom, filters/disclosures closed; every row is fully visible and the document height is 768. Values below are pixels. Local screenshots and JSON metrics remain in ignored outputs/.

| Surface | Seven row heights | Gaps | Pager bottom |
| --- | --- | --- | --- |
| /requisitions?reqSize=100&reqPage=4 | 40/40/40/40/40/40/40 | 8 | 596 |
| /candidates | 40/40/40/40/40/40/40 | 8 | 600 |
| /offers | 40/40/40/40/40/40/40 | 8 | 588 |
| /pipeline?pipelineView=table | 40/40/40/40/40/40/40 | 8 | 604 |
| /audit | 40/40/40/40/40/40/40 | 8 | 562 |
| /sourcing | 40/40/40/40/40/40/40 | 8 | 618 |
| /sourcing?qaHistory=1 | 40/40/40/40/40/40/40 | 8 | 618 |

## Limits

UI interaction checks use controlled Supabase fixtures; separate live develop checks cover RLS/projection and SQL compatibility. The full repository suite was not run. Existing broader search/terminal-offer mock failures recorded in the historical delivery were outside this refinement. Audit remains desktop-only below 1024px; wide tables preserve horizontal scrolling, while expanded filters/details and phones scroll naturally.
