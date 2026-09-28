# Home reference patterns

Owners: [HomeView](../../src/components/dashboard/HomeView.tsx), [RecruitmentCalendar](../../src/components/dashboard/RecruitmentCalendar.tsx), and `OperationalSummaryStrip` in [Operations](../../src/components/ui/Operations.tsx). This contract is based on source, banner-asset and rendered-layout inspection, not a browser accessibility audit.

## Banner

Reuse [home_banner.png](../../home_banner.png): a shallow 6:1 illustration with quiet left space, blue waves below, and recruiter/candidate imagery on the right. Image is decorative (`alt=""`); greeting remains HTML.

Preserve `object-contain` and the full-width composition. Greeting occupies the left 52% in a softly translucent blurred panel. Use navy semibold (16/24/30px responsive sizes); daily message is secondary and hidden at narrow sizes. Preserve the opacity constant rather than adding a new gradient or baking text into the image. Keep the banner shallow so operational work stays near the top. Retain access to full identity if a long greeting truncates.

## Summary cards and rows

Reuse `OperationalSummaryStrip`: label/helper left, value right in stacked modes. Home uses `density="compact"`, `layout="stacked_lines"`: separators, without separate card backgrounds. Other callers can use the existing `grid` or `stacked` variant.

Reading order: value → label → helper. Values are 18px compact / 20px regular semibold tabular digits; labels 12px medium slate; helpers 12px muted. Align value columns. Preserve semantic tone helpers and zero versus unavailable data; do not color each metric arbitrarily.

Today’s Work has four tablet/desktop summary rows and two on phones. Metric values remain navy in every semantic state. The panel ends after its metrics without a divider, critical-work list, or forced calendar height. Urgent Items remains a live count of the derived work queue.

## Recruitment calendar

At `lg`, a four-column grid gives work one column and calendar three. Work scrolls within calendar-aligned height. Below this arrangement, calendar precedes work. Calendar uses desktop grid at `md` and selected-day agenda below it.

- Section heading with previous/today/next controls; quiet month strip with total below.
- Sunday-first seven-column desktop grid, 96px day cells.
- Day top-left, at most two event buttons, top-right `(N)` disclosure for three or more events.
- Desktop event chips show one ellipsized candidate-name line with a semantic calendar or work icon. Preserve the full candidate, event type, date, and status in the accessible name and title. These density-specific sizes are not form/profile defaults.
- Today has outline/tint. Normal events use site-accent tint; overdue/unconfirmed due starts red; confirmed starts green. Keep accessible status wording; color alone is insufficient.

Phone calendar shows selectable dates/counts and readable selected-day cards with site/owner context and at least 44px primary targets. Do not squeeze desktop event text into phone cells. Event opens Candidate Detail; overflow drawer reveals full day and eligible actions.

Today’s Events is a separate tablet/desktop Panel directly below the Calendar Panel in the right Home column. Its bounded rows always follow Bangkok today independently of the viewed month and refresh on visibility and Bangkok midnight. Put the date beside the title and the event count at the right. Use smaller responsive text and five left-aligned columns: Candidate, Event context, Status, Site / owner, Remark. The candidate name opens Candidate Detail with hover/focus feedback; its ID sits below. Truncate long names and remarks visually while keeping full text available. The remark is the current pending event log's remark or a dash; start-work events have no remark. Pending stage status reads Awaiting here only; an unconfirmed start scheduled for today reads Due today and a confirmed start reads Started work confirmed. Keep headers above the bounded scrolling list and separate rows with hairline dividers. It derives from the same event list as the calendar. Show a quiet empty state when no events fall on today. Phones retain the selected-day agenda without a duplicate Today’s Events list.

## Recruitment Records

Recruitment Records use aligned columns with left-aligned headers from tablet width upward, hairline-divided rows, and no vertical borders or row cards. Phones use one stacked, labeled row per record and normal page scroll; desktop lists are bounded. Phone action targets are at least 44px high. Open Headcount places its live count at left and compact sorting at right, with equal text hierarchy for count, Sort by, and option; the label is grey and option black. It defaults to the established oldest-first restartable SLA age order (age descending, then open demand descending) and offers Most open demand and Position A–Z. Columns are Open Requisition, Remaining Vac., Fill Readiness, Age/SLA, and Owner. The requisition title opens detail; ID is secondary. Show age/SLA as `48d/30d` and, only when overdue, a smaller light-weight red `18d overdue` beneath. Candidate Pipeline mirrors the count/sort hierarchy with a live displayed-candidate count and Oldest touch first, Newest touch first, and Candidate A–Z sorting. Its columns are Candidate / Stage / Site / owner / Last Touch / Pending Remark / Progress. Date leads over its smaller age; a missing date or current pending remark is a dash. Keep only the compact progress rail, without its stage-summary line. Scroll this six-column table inside its own region on tablets, never the page; phones use labeled rows. The remaining three tabs use the six-column layouts below. Names open the related record or sourcing workspace; retain distinct quality and confirmation actions. Show New Hire Confirmation only for roles with start-confirmation write permission. Truncate long values without losing accessible full text. Tabs use an underline selected state, compact count pills and Arrow/Home/End keyboard navigation; switching tabs resets list scroll.

Candidate Pipeline's tablet/desktop header and rows share one bounded viewport that scrolls horizontally and vertically; its header stays visible during vertical scroll. Do not nest a second vertical list viewport inside the horizontal viewport. Switching record tabs resets that viewport's scroll position. Phones keep natural page scrolling and stacked rows.

Progress uses bare stage icons without circular fills: blue completed, yellow current pending, grey upcoming. Keep textual stage states accessible, including failure. Candidate sorting adds **Progression: furthest first** by the existing journey order, then name and ID; the oldest-touch default remains.
In the compact Home progress rail, omit connector segments. Other stage rails retain their connectors. The Sourcing Updates missing-week state reads **Update needed / ต้องอัปเดตข้อมูล**; keep Incomplete and Recorded distinct. Home Data Quality keeps its English issue copy and uses the Workspace issue-code translations for Thai titles, explanations, and actions, falling back to source text if a code is absent.
The shared Thai Recorded sourcing tag reads **บันทึกข้อมูลแล้ว**. New Hire Confirmation uses a small secondary Confirm start button with an icon and visible label; the phone target remains at least 44px. Its existing confirmation modal and role gate remain in place.

Sourcing Updates, Data Quality and New Hire Confirmation use six aligned columns in one bounded desktop/tablet viewport with a sticky header. Sourcing: Group, Linked requisitions, Open vacancies, Site / owner, Week status, Last saved. Quality: Record, Issue, Severity, Explanation, Context, Action. New hire: Candidate, Requisition, Site / owner, First working date, Confirmation state, Action. On phones, show labeled rows in normal page flow. Preserve record links, action gates, live values, and readable long explanations.

Calendar is a schedule, not a reporting chart. Eligibility and event construction belong to the [Home system node](../maps/system/home.md).

## Reference checks

Inspect empty/busy months, today/selected distinctions, three-plus events, long names, Thai labels and mobile agenda. Verify status meaning in text and color and contextual record opening. Use [Home ownership/coverage](../maps/system/home.md) for focused checks.
