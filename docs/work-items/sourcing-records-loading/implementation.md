# Record Sourcing loading

The sourcing board and embedded editor use an additive sourcing-only projection. Legacy sourcing/list interfaces are retained for rollback. The new SQL builds authorized requisition/group populations once, aggregates accepted offers and terminal dates once, intersects lifecycle bounds before week expansion, and never invokes the group-list/Pipeline readiness query. No indexes or RLS policies changed.

The embedded selected week and previous-week comparison are one interactive request without counts. The independent navigator starts with 25 newest weeks and appends pages only through Load more. Direct older selections are pinned. Summary charts and history cannot reset the form. Standalone Board and History request only their active surface, and standalone charts are not fetched. Summary reads have scoped leases and cancel when their last consumer disappears.

## Verification

- Typecheck and production build passed; existing lint/optional sharp warnings remain.
- 24 list/scheduler/summary-cache unit tests passed.
- 14 focused sourcing/date browser tests passed, including delayed history/charts, draft retention, Load more, independent history retry, older direct dates, Thai/English phones, timing privacy, and superseded selected-week responses.
- Disposable full-schema RLS rehearsal compares 120 sort/direction/surface cases plus filter and cursor/count checks across system administrator, admin recruiter, allowed/restricted site recruiters and viewer. The same rehearsal saves a query plan and 30 SQL samples per measured role/view under `outputs/sourcing-records/`. These fixture measurements do not establish production performance.
- Five broader linked-requisition drawer checks failed at the missing Linked label. Both distinct failing test cases reproduced against an untouched HEAD source export, confirming this existing issue is separate from the sourcing list/editor change. Baseline browser evidence is under `outputs/sourcing-records/baseline-test-results/`.

## Release measurement

`node scripts/measure-sourcing-display.cjs --base-url=APPLICATION_ORIGIN --storage-state=LOCAL_AUTH_STATE_FILE --group-id=AUTHORIZED_GROUP --role=ROLE_LABEL --samples=30`

Run separately for administrator and site recruiter after an authorized release. The tool makes no writes and does not save authentication state, URLs, record IDs, RPC payloads or rows. It captures cold/warm application-cache observations for Board, History and the selected-week editor, including numeric queue, request and response-to-display phases. Display uses two animation frames after commit as a paint approximation. Browser RPC duration is not SQL execution time; measure SQL separately with identical scopes/data. Require SQL p95 below 1.5 seconds and display p95 below 3 seconds before promotion. Cold application cache is not cold database cache.

Migration `20261103154920_sourcing_records_loading.sql` is prepared locally. Deploy it before the frontend when release is authorized; verify develop before promoting the same change to main. No connected database was changed during implementation.
