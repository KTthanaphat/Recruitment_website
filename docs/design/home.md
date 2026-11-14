# Home reference patterns

Owners: [HomeView](../../src/components/dashboard/HomeView.tsx), [RecruitmentCalendar](../../src/components/dashboard/RecruitmentCalendar.tsx), and `OperationalSummaryStrip` in [Operations](../../src/components/ui/Operations.tsx). This contract is based on source, banner-asset and rendered-layout inspection, not a browser accessibility audit.

## Banner

Use [home recruitment artwork](../../public/images/home-recruitment-banner-v2.png): a transparent flat-2D recruiter, laptop and candidate-card scene. Constrain it to the right 50% of the shallow 6:1 banner over white-to-light-blue waves with subtle grain. Use the left 50% for the [playful floral pattern](../../public/images/home-banner-floral-stickers-v9.png) at full opacity, inset 16px on phones, 24px at sm and 28px at lg. Keep flowers around a clear central opening for the greeting; use an inverse radial mask for that opening and a separate left-to-right fade so the pattern thins toward the recruiter. [Generation and verification notes](../work-items/home-banner-artwork/implementation.md). Image is decorative (`alt=""`); greeting remains HTML.

Preserve the full-width 6:1 banner and uncropped `object-contain` artwork centered within its right-half container. Use Next Image with priority loading; the background waves remain native SVG. Greeting occupies the left 50% in the pale-blue glass panel at 80% tint with `backdrop-blur-md`, protecting text contrast over full-color flowers. The decorative floral motif follows the supplied Colorful Floral Sticker Sheet: pink hibiscus, yellow plumeria/rose, lavender bellflower and small cyan/apricot/pink blossoms, with green leaves, soft shading and fine texture. Preserve sparse placement and the central opening; this matches the Today’s Work card ornament family. These are artwork colors only, without status meaning. Do not reduce overall floral opacity. Keep the central opening and rightward fade. Layer the motif behind the greeting's glass surface so `backdrop-blur-md` softens the flowers under text while exposed flowers retain stronger color; isolate banner stacking from the rest of Home. Use navy semibold (16/24/30px responsive sizes); daily message is secondary and hidden at narrow sizes. Preserve the opacity constant and keep all greeting/message text as HTML rather than baking it into the artwork. Keep the banner shallow so operational work stays near the top. Retain access to full identity if a long greeting truncates.

## Summary cards and rows

Reuse `OperationalSummaryStrip`: label/helper left, value right in stacked modes. Home uses `density="compact"`, `layout="stacked_lines"`: separators, without separate card backgrounds. Other callers can use the existing `grid` or `stacked` variant.

Reading order: value → label → helper. Values are 18px compact / 20px regular semibold tabular digits; labels 12px medium slate; helpers 12px muted. Align value columns. Preserve semantic tone helpers and zero versus unavailable data; do not color each metric arbitrarily.

Today’s Work has four tablet/desktop summary rows and two on phones. Metric values remain navy in every semantic state. Frame only this card with small [colorful flower-sticker ornaments](../../public/images/home-work-floral-corner-stickers-v2.png) with pink hibiscus, yellow plumeria, purple bellflowers and green leaves, layered above the panel outline, offset 8px outward at top-right and bottom-left. Allow visible overflow so petals can cross the border; preserve viewport gutters and keep the content/focus area clear. Each metric is a whole-row button with a ↗ indicator, visible keyboard focus and at least a 44px target. Other summary-strip callers remain informational. The panel ends after its metrics without a divider, critical-work list, or forced calendar height. Urgent Items remains a live count of the derived work queue.

### Metric list popups

Each Today’s Work metric opens the exact authorized population in a compact desktop modal, using the shared viewport-bounded phone modal. Definitions are owned by [Home metric lists](../WEBSITE_STRUCTURE.md#home-metric-lists). Show title, current-filter context, readable record identity, reason/date, current total and 25-row Show more paging. Keep loading, empty and retry states distinct; failed later pages preserve loaded rows. Close/Escape restores the initiating row’s focus. Scope/user/refresh changes close and clear the popup; late responses cannot restore it. Artwork has empty alt text and no pointer events.

Owner: [HomeMetricDialog](../../src/components/dashboard/HomeMetricDialog.tsx). [Checks and rollout](../work-items/home-work-metrics/implementation.md).

## Recruitment calendar

At `lg`, a four-column grid gives work one column and calendar three. Work scrolls within calendar-aligned height. Below this arrangement, calendar precedes work. Calendar uses desktop grid at `md` and selected-day agenda below it.

- Section heading with previous/today/next controls; quiet month strip with total below.
- Sunday-first seven-column desktop grid, 96px day cells.
- Day top-left, at most two event buttons, top-right `(N)` disclosure for three or more events.
- Desktop event chips show one ellipsized candidate-name line with a semantic calendar or work icon. Preserve the full candidate, event type, date, and status in the accessible name and title. These density-specific sizes are not form/profile defaults.
- Today has outline/tint. Normal events use site-accent tint; overdue/unconfirmed due starts red; confirmed starts green. Keep accessible status wording; color alone is insufficient.

Phone calendar shows selectable dates/counts and readable selected-day cards with site/owner context and at least 44px primary targets. Do not squeeze desktop event text into phone cells. Stage events open Candidate Detail; start-working events open New Hire Confirmation. Overflow reveals the full day and relevant event detail/actions.

Today’s Events is a separate tablet/desktop Panel directly below the Calendar Panel in the right Home column. Its bounded rows always follow Bangkok today independently of the viewed month and refresh on visibility and Bangkok midnight. Put the date beside the title and the event count at the right. Use smaller responsive text and five left-aligned columns: Candidate, Event context, Status, Site / owner, Remark. Stage candidate names open Candidate Detail; start-working names open New Hire Confirmation, with the same hover/focus feedback and IDs below. Truncate long names and remarks visually while keeping full text available. The remark is the current pending event log's remark or a dash; start-work events have no remark. Pending stage status reads Awaiting here only; an unconfirmed start scheduled for today reads Due today and a confirmed start reads Started work confirmed. Keep headers above the bounded scrolling list and separate rows with hairline dividers. It derives from the same event list as the calendar. Show a quiet empty state when no events fall on today. Phones retain the selected-day agenda without a duplicate Today’s Events list.

### Calendar start confirmation

Use [NewHireConfirmationRow](../../src/components/dashboard/NewHireConfirmationRow.tsx) for both Records and calendar details. [CalendarStartConfirmation](../../src/components/dashboard/CalendarStartConfirmation.tsx) uses the existing Modal at 42rem desktop maximum, two-column labeled fields and stacked phone layout. Wrap long names/titles, retain 44px phone controls and modal focus containment/return. Tooltip Escape precedes modal Escape. Loading/retry/stale states must not show attendance actions. Preserve compact month chips and stage-event behavior.

This interface opens the existing review/Save flow. [Canonical eligibility/data rules](../WEBSITE_STRUCTURE.md#calendar-start-confirmation), [focused checks](../work-items/calendar-start-confirmation/implementation.md).

## Recruitment Records

Recruitment Records use aligned columns with left-aligned headers from tablet width upward, hairline-divided rows, and no vertical borders or row cards. Phones use one stacked, labeled row per record and normal page scroll; desktop lists are bounded. Phone action targets are at least 44px high. Open Headcount places its live count at left and compact sorting at right, with equal text hierarchy for count, Sort by, and option; the label is grey and option black. It defaults to the established oldest-first restartable SLA age order (age descending, then open demand descending) and offers Most open demand and Position A–Z. Columns are Open Requisition, Remaining Vac., Sourcing link readiness, Age/SLA, and Owner. The requisition title opens detail; ID is secondary. Show age/SLA as `48d/30d` and, only when overdue, a smaller light-weight red `18d overdue` beneath. Candidate Pipeline mirrors the count/sort hierarchy with a live displayed-candidate count and Oldest touch first, Newest touch first, and Candidate A–Z sorting. Its columns are Candidate / Stage / Site / owner / Last Touch / Pending Remark / Progress. Date leads over its smaller age; a missing date or current pending remark is a dash. Keep only the compact progress rail, without its stage-summary line. Scroll this six-column table inside its own region on tablets, never the page; phones use labeled rows. The remaining three tabs use the six-column layouts below. Names open the related record or sourcing workspace; retain distinct quality and confirmation actions. Show New Hire Confirmation only for roles with start-confirmation write permission. Truncate long values without losing accessible full text. Tabs use an underline selected state, compact count pills and Arrow/Home/End keyboard navigation; switching tabs resets list scroll.

Candidate Pipeline's tablet/desktop header and rows share one bounded viewport that scrolls horizontally and vertically; its header stays visible during vertical scroll. Do not nest a second vertical list viewport inside the horizontal viewport. Switching record tabs resets that viewport's scroll position. Phones keep natural page scrolling and stacked rows.

Progress uses bare stage icons without circular fills: blue completed, yellow current pending, grey upcoming. Keep textual stage states accessible, including failure. Candidate sorting adds **Progression: furthest first** by the existing journey order, then name and ID; the oldest-touch default remains.
In the compact Home progress rail, omit connector segments. Other stage rails retain their connectors. The Sourcing Updates missing-week state reads **Update needed / ต้องอัปเดตข้อมูล**; keep Incomplete and Recorded distinct. Home Data Quality keeps its English issue copy and uses the Workspace issue-code translations for Thai titles, explanations, and actions, falling back to source text if a code is absent.
The shared Thai Recorded sourcing tag reads **บันทึกข้อมูลแล้ว**. New Hire Confirmation's Confirmation action field uses the shared AttendanceDecisionActions: green Check on pale green Accept, red X on pale red Reject, with localized names and hover/focus tooltips. Desktop buttons are 36px and phone/coarse targets 44px. Accept preselects started; Reject preselects did_not_start and requires a reason. Both retain review before save and the existing role/date gate. Each loading action cell contains two button-shaped placeholders.

Sourcing Updates, Data Quality and New Hire Confirmation use six aligned columns in one bounded desktop/tablet viewport with a sticky header. Sourcing: Group, Linked requisitions, Open vacancies, Site / owner, Week status, Last saved. Quality: Record, Issue, Severity, Explanation, Context, Action. New hire: Candidate, Requisition, Site / owner, First working date, Confirmation state, Action. On phones, show labeled rows in normal page flow. Preserve record links, action gates, live values, and readable long explanations.

Calendar is a schedule, not a reporting chart. Eligibility and event construction belong to the [Home system node](../maps/system/home.md).

## Reference checks

Inspect empty/busy months, today/selected distinctions, three-plus events, long names, Thai labels and mobile agenda. Verify status meaning in text and color and contextual record opening. Use [Home ownership/coverage](../maps/system/home.md) for focused checks.

## Record footer placement and loading

Sourcing Update, Data Quality and New Hire Confirm place their whole count/page/navigation footer below and outside the bounded table viewport. Headers and rows stay inside it. Preserve independent cursors and page sizes. Skeletons reuse actual responsive column templates. Home metrics retain confirmed same-query values during refresh and reset on authorization/filter changes. [Checks](../../tests/e2e/design-adjustments.spec.ts).

## Independent loading states

Keep the existing layout while core metrics, calendar, and selected records load independently. Unloaded counts show a dash. Urgent items load after essential sections settle; its failure has a local retry. Data Quality starts on tab selection and uses its returned total for the badge. Reset its cursor and badge after scope/identity/refresh changes. Core failure has a local retry and does not hide successful sections. Welcome preserves the existing popup behavior while its optional summary waits behind initial data.
