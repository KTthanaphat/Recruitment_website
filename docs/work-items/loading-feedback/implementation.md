# Data loading skeletons and read retry icons

Delivery mode: direct, no agents, explicitly selected by the user. KT main/develop release checkouts are used; unrelated local documentation and tsconfig changes are preserved.

## Behavior

Shared `LoadingSkeleton` covers startup, table/list reads, pipeline cards and metrics, Home summaries/calendar/quality, Workspace/detail drawers, dashboard report summaries/drill-downs, admin reads, and asynchronous lookups. Tables keep headers/filters, with five placeholder rows; pipeline stages have three cards; lookups have four rows. Shapes are inert, use neutral opacity motion, and stop animating for reduced motion. Loading status is localized and marked busy.

`RetryIconButton` reuses Button and RotateCw with accessible labels, hover/focus tooltip, busy/disabled states, and a synchronous duplicate-activation guard. It has a 36px desktop target and at least 44px on phones/coarse pointers. Error text stays visible. Data/count retries become icons; save/send/export/rejection-letter write retries and manual Refresh remain labeled.

Shared list `initialLoading` and `refreshing` distinguish missing matching snapshots from same-query refreshes, including empty results. Request revision/retry tokens trigger fetching without changing semantic identity. User/access scope, filters, sort, cursor/page size and selected record remain identity boundaries. Custom Home/calendar/report/Workspace/sourcing loaders use equivalent semantic guards and existing cancellation checks. Background manual refresh rechecks the session and reloads bootstrap without unmounting a valid same-user view. Profile/access changes invalidate matching state. No SQL changes are required.

## Verification

- Shared cache/scheduling/history/ID unit suite: 27/27 passed.
- Integrated Home/loading/scheduling/table run: 15/15 passed before the final custom-loader refinements.
- Loading plus candidate-reference/Workspace data regression run: 12/12 passed.
- Final Home summary and quality-row run: 5/5 passed, including actual quality rows after initial load.
- Risk, bottleneck export/layout, and Thai report navigation regressions: 3/3 passed.
- Phone Thai reduced-motion screenshot inspected: stable neutral placeholders, no horizontal overflow, visible filters and navigation. Final desktop/phone artifacts are retained outside Playwright's disposable test-results directory.
- Production build passed 22/22 static pages at approximately 378 kB first-load application JS; the final dependency-only source checkpoint is rebuilt before release. Existing unrelated lint/accessibility/image/optional-sharp warnings remain.

## Existing sourcing failures

Three selected sourcing tests fail identically against this feature and the unchanged, previously built `e8fd37f` production artifact: incomplete-week comparison text renders zero instead of unavailable; the selected-week editor has no group rows; and the all-zero trend includes ticks 5/10. Assertions were not weakened. These are pre-existing sourcing/model/editor issues, outside this loading-state change; they prevent claiming an all-green application regression suite.

## Rollout

Both Render services were inspected before push and have automatic deploy enabled: production follows main, development follows develop. Push the verified commits using plain Git; monitor those automatic deploys without triggering duplicates. Verify public HTML/CSS/JavaScript serves the shared skeleton and retry primitives. No database migration or permission change is part of this feature.

Final loading-feedback suite: 9/9 passed, including actual Home quality rows, selected-candidate isolation, report chart skeletons, empty-result refresh, count retry, keyboard tooltip, stage-card bounds, and reduced-motion/44px phone checks. Desktop English and phone Thai skeleton/retry artifacts were inspected.

The exact frozen source passed its final production build (exit 0; 22/22 static pages, about 378 kB first-load application JS). Hook-dependency, accessibility/image and optional-sharp warnings remain; this is not a lint-clean result.

Final refresh follow-up: Admin now renders its retained directory while loading rather than projecting an empty array; Sourcing board receives initial/refresh flags explicitly, mobile pipeline uses the first-paint flag, and manual Refresh invalidates scoped detail/directory caches before reloading. The final loading suite passed 10/10, including Admin directory retention. Exact follow-up production build passed exit 0, 22 static pages, approximately 379 kB first-load JS; warnings remain. Both initial releases were confirmed live and serving skeleton/retry code before the follow-up.
