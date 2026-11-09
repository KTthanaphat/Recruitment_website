# UI component contracts

Reuse the named primitive and read only its section. Source establishes the visual baseline. Interaction acceptance below is the desired completion standard, not a claim that existing controls already pass every edge case.

## Date selector

Owner: `DayDateSelector` in [Field.tsx](../../src/components/ui/Field.tsx); `TextInput type="date"` delegates to it. Use the explicit component API for localized navigation/Clear labels or options not forwarded by the wrapper.

Anatomy: 16px calendar icon → date/placeholder → month popover. White trigger, neutral border, `rounded-md`, 40px minimum height, 14px normal tabular text, hover feedback and accent focus. Field label stays outside the value; placeholder is not the only accessible name.

Display Gregorian `DD/MM/YYYY` in both languages; retain `YYYY-MM-DD` in state/FormData. Bangkok determines today. Month heading is 14px semibold with flanking arrows above a Sunday-first grid. Selected uses fill, today outline/tint, focus a visible indicator. Optional filled dates expose localized Clear; required dates do not.

Desktop popover is approximately 19rem; phone panel sits near the bottom with safe-area spacing. Fit within viewport and above parent overlay. Preserve `name`, controlled/uncontrolled behavior and change event. Hidden input `required` alone is not browser constraint validation: validate required/valid dates at the form boundary.

When editing: focus an appropriate popup target on open; support calendar keyboard navigation and Escape from inside the popup; restore trigger focus on close; handle month transitions and blank/invalid/required dates. Do not invent unsupported `min`/`max` props—inspect caller validation and extend the shared API only when needed. Test these behaviors instead of assuming they already exist.

## Dropdown box

The [Dashboard portal](dashboard-portal.md) opts into a compact toolbar: 32px desktop value triggers and 44px phone/coarse-pointer targets, scoped by `.dashboard-filter-toolbar`. Other callers retain the default geometry below.

The global header places an icon-only priority bookmark immediately after PIC and before Language. An outlined bookmark shows all requisitions; a filled system blue (#0A3CDC) bookmark limits requisition-related pages to priority requisitions. Use a localized title/accessible name, `aria-pressed`, visible keyboard focus and a 44px phone target. Site/PIC still narrow the selected priority scope. Persist `priority=only|all` in shared links and navigation; default is all. The flag is shared record data, while the filter is each user's view preference.

Owners: [CommandSelector.tsx](../../src/components/ui/CommandSelector.tsx), [CommandMultiSelector.tsx](../../src/components/ui/CommandMultiSelector.tsx), `CreateSelectInput` / `SelectInput` in [Field.tsx](../../src/components/ui/Field.tsx), the table category filter in [TableControls.tsx](../../src/components/ui/TableControls.tsx), Dashboard Level/Channel pickers in [VacancyWaterfallView.tsx](../../src/components/dashboard/VacancyWaterfallView.tsx), and action/account menu surfaces in [Operations.tsx](../../src/components/ui/Operations.tsx), [PipelineBoardView.tsx](../../src/components/pipeline/PipelineBoardView.tsx), [HiringWorkspaceView.tsx](../../src/components/workspace/HiringWorkspaceView.tsx), and [AppShell.tsx](../../src/components/layout/AppShell.tsx). Shared dropdown tokens and classes live in [globals.css](../../src/app/globals.css).

| Need | Primitive |
| --- | --- |
| Header Site/PIC | `CommandSelector`, shared 44px minimum trigger |
| Form/dashboard value | `SelectInput` or `CreateSelectInput`, backed by `CommandSelector` |
| Select options and FormData adapter | `CreateSelectInput`, preserve name/value and required validation |
| Existing native select markup | Replace with `SelectInput` so its popup and keyboard behavior use the shared selector |
| Month, not a day | `CommandMonthSelector`: year navigation, 3-column months |

Trigger: white surface, fixed `#93B9FF` border, shared 12px corner radius, restrained accent icon → selected value → trailing chevron. All value selectors, including `SelectInput`, use `CommandSelector`; visible dropdowns share the 44px minimum trigger, and option values remain available to FormData and required validation. The thin blue shadows are `0 2px 6px rgba(20,110,250,.10)` for triggers and `0 3px 10px rgba(20,110,250,.10)` for menus. Fixed `#0A3CDC` marks focus regardless of assigned-site accent. Long values truncate within `min-w-0` but remain discoverable; the chevron does not shrink. `<datalist>` suggestion popups retain browser-controlled rendering.

Options: `ats-dropdown-menu` is a white panel with a thin shadow, shared 12px corner radius, a maximum height of `min(70dvh, 18rem)`, and internal scrolling. All menu rows use shared 8px corners, 6px panel padding, 4px row gaps, 36px minimum desktop choice height and 44px at phone widths. Action menus use the same surface and row geometry while retaining menu semantics and action-specific text colors. The Pipeline filter popover uses `ats-dropdown-surface` for the same border, radius and shadow without compressing its form layout. Keep readable wrapping for Thai and long values. Every choice uses one shared state treatment: transparent by default, pale blue (`#E9F2FF`) for hover and keyboard-active states, and the same pale blue selected row with a fixed `#0A3CDC` checkbox and white mark. Render that selected indicator for single-choice options and month choices too, while preserving their single-select accessibility semantics and close-after-selection behavior. Multi-selects keep their existing checkbox and stay-open behavior. Disabled choices stay muted and do not respond to hover. Recruitment Performance Site and Department are the visual reference, and the [Dashboard portal](dashboard-portal.md) owns the current common-filter layout. Dashboard selectors opt into normal 14px/400 values/choices; their labels use 12px/500. Other selector callers retain their defaults.

Acceptance: Enter/Space opens/selects, arrows move between enabled options, Home/End reach valid extremes, Escape closes, focus returns, active option scrolls into view, and assistive technology identifies focus/selection. Handle empty arrays safely. Constrain popup width/position on phones and inside drawers; absolute positioning alone does not prove collision handling.

`CommandSelector` supports controlled search at the top of its open scrolling menu; the closed trigger shows the selected value. Candidate ID/name search stays server-side. `AuthorizedRequisitionLookup` gathers all accessible filtered pages for requisition edit selection without page controls. Department waits for Site, Section for Department; retain allowed legacy values. Header commands keep accessible names without stacked visible labels; forms keep visible labels. Preserve the header's exclusion of a global Clear-filter button.

## Fields, buttons and overlays

Dashboard opts into `Button` sizes `toolbar` (32px minimum height, 8px horizontal padding, 12px semibold text, 6px icon gap) and `icon-toolbar` (32×32px). Both retain shared variants, 8px corners and feedback; below 640px or with a coarse pointer they provide at least 44px targets. Labels may wrap and increase height. Existing sizes keep their geometry. `.dashboard-compact-controls` opts selector/date triggers into 32px desktop / 44px phone/coarse-pointer height with 14px normal values. Tabs, local search/status/chip controls and table toolbar actions use the same geometry; options keep shared 36/44px rows. Chart links, whole-panel KPI targets and static report headings keep their content geometry. The ON/OFF visual track stays 64×32px.

Dashboard-owned export dialogs opt into `Modal compactControls`, including compact Close and format actions; defaults and operational detail drawers remain shared. Geometry/appearance checks: [compact Dashboard](../../tests/e2e/dashboard-compact.spec.ts).

Dashboard outer Site/PIC/Priority controls remain visible inline with the scope summary. Secondary tabs support arrows/Home/End with selected state and roving focus; [portal](dashboard-portal.md) owns placement and [Risk/Bottlenecks](dashboard-risk-bottlenecks.md) owns drill-down focus.

### Shared ON/OFF switch

Owner: [OnOffSwitch.tsx](../../src/components/ui/OnOffSwitch.tsx), with `--ats-square-switch-*` tokens and `.ats-square-switch` hooks in [globals.css](../../src/app/globals.css). Controlled props are `checked`, `onCheckedChange`, `label`, `language`, optional `disabled` and `title`. Dashboard Channel legend and all Configuration Active controls use this primitive. Caller ownership determines draft updates versus immediate writes.

The rounded-square track is 64×32px with a white 24px thumb and localized ON/OFF text inside. OFF places the thumb left; ON places it right. Phone/coarse-pointer buttons provide a 44px target around the unchanged visual track. Fixed system tokens are independent of Site accent:

| Token | Value |
| --- | --- |
| `--ats-square-switch-off` / `--ats-square-switch-border` | `#E8F0FF` / `#C4D8FF` |
| `--ats-square-switch-on` (track and border) | `#0A3CDC` |
| `--ats-square-switch-off-text` / `--ats-square-switch-on-text` | `#0A3CDC` / white |
| `--ats-square-switch-off-hover` / `--ats-square-switch-on-hover` | `#DDEAFF` / `#082A9E` |
| `--ats-square-switch-focus` / `--ats-square-switch-thumb` | `#0A3CDC` / white |
| `--ats-square-switch-disabled-opacity` | `0.5` |

Native button activation supports Enter/Space. Keep `role="switch"`, `aria-checked`, accessible names and a visible external field label in editors/filter fields. Disabled controls preserve state/thumb position, ignore interaction and suppress hover styling. Focus is a system-blue outline; reduced motion suppresses visible transitions. Generic legacy checkbox styling excludes this primitive.

The Configuration reason catalog uses labeled icon-only Add and Edit controls. Each main/detail reason has an Active switch whose checked state matches its saved active flag. Show saving feedback within the open section and disable its controls while saving; refresh only the reason catalog so the page and scroll position stay in place. Close the editor after success. Failed writes or refreshes keep its input and the previous confirmed switch state visible with an error. An archived main remains named in its detail's editor. Keep these controls usable by keyboard and at phone widths.

The Fail Candidate form uses visible labels and required shared selectors for actor, main, and detailed reasons. The shared selector retains native form values and required validation. Disable a dependent selector until its parent is chosen, clear stale selections when the parent changes, and present the optional remark after the hierarchy. Its confirmation uses readable field/value pairs rather than raw payload JSON. On phones, keep fields and footer controls within the modal viewport.

Reuse `Field`, `TextInput`, `TextArea`, [Button](../../src/components/ui/Button.tsx) and existing validation/disabled helpers. Values outweigh optional hints. Associate inline errors with fields, preserve inputs on failure and distinguish loading from disabled. Placeholder/color alone cannot identify required fields or errors.

Main task uses the primary action; secondary commands remain quiet; icon utilities have accessible names. Value-selection dropdowns and command menus have different semantics. Use [Operations](../../src/components/ui/Operations.tsx) for record actions, [Modal](../../src/components/ui/Modal.tsx), [Drawer](../../src/components/ui/Drawer.tsx), and [MobileBottomSheet](../../src/components/ui/MobileBottomSheet.tsx) for overlays. Drawer layer 55 sits above mobile navigation (50) and below confirmation modals (60) and mobile sheets (70), keeping editor actions reachable. Preserve destructive confirmations in product flows without adding permission interruptions to routine design work.

Follow [platform dependency edges](../maps/system/platform.md) for shared-control changes: affected callers, Thai/English labels, nested overlay stacking and phone/desktop states. Prefer 44px primary phone targets; preserve density-specific desktop controls. The requisition drawer opts into shared `detailUtilityClassName` for workspace, bookmark, More and Close: 18px icons, 36px desktop / 44px phone boxes, neutral default, system blue hover/focus, and pale blue selected state. `RecordActionGroup uniformUtilities` and `Drawer uniformHeaderActions` preserve other callers while keeping the requisition controls centered within one row anchored to the header top, matching Candidate Detail on desktop and phones. Styling-only work does not require database/deployment workflows.

Dashboard outer Site/PIC/Priority filters use visible inline header placement; retain compact 32px desktop/44px phone/coarse targets and natural wrapping. Dashboard chart bars alone use square ends; control and ON/OFF tokens retain their existing corners. [Portal](dashboard-portal.md) owns navigation/placement.

### Mobile navigation sheet

`MobileBottomSheet.breakpoint` defaults to `md` (below 768px); Records navigation opts into `lg` (below 1024px). Rendering, CSS visibility, scroll lock and focus use the same boundary. Tab/Shift+Tab stay inside, Escape closes, focus returns to the connected trigger; desktop transition closes it. Other callers retain geometry/defaults. [Shell contract](mobile-navigation.md), [checks](../../tests/e2e/mobile-operations.spec.ts).


## Data loading and retry controls

Use `LoadingSkeleton` for initial or changed-query reads: three column-aligned table rows, five pipeline cards, four lookup rows, and metric/chart/detail variants. Preserve headings, filters and headers; skeleton shapes are decorative, with one localized status announcement and `aria-busy` per loading region. Neutral pulse animation stops under reduced motion. Do not display empty-state messages or zero totals before a successful response.

The shared list hook exposes `initialLoading` and `refreshing`. Keep populated or empty snapshots during same-query refreshes, with `RefreshIndicator`; scope, user/role/site, selected entity, filters, period, sort, cursor and page size are semantic boundaries. Retry/revision tokens trigger fetching without becoming data identity. Existing cancellation guards and read scheduling remain active.

`RetryIconButton` wraps the shared Button with RotateCw, a localized accessible name, hover/focus tooltip, busy state and duplicate-click guard. Desktop target is 36px; phones/coarse pointers use at least 44px. Read errors remain visible. Count retries refresh only counts. Save/send/export and other write retries stay labeled, and manual Refresh remains labeled. Checks: [loading feedback](../../tests/e2e/loading-feedback.spec.ts).

Layout ownership: native tables insert TableSkeletonRows directly in tbody, including selection/data/action columns. Grid tables pass their real responsive column template. NumberSkeleton replaces unknown numbers and ratios without invented digits or premature zeros. OperationalSummaryStrip loading retains the actual card count, geometry and known labels while replacing fetched values/helpers. Metric variants accept known labels. Lookups remain four; tables remain three regardless of page size. Phone placeholders follow phone record layouts. Shared pulse stops with reduced motion. Compact utilities are 36px desktop and 44px phone/coarse-pointer. [Design checks](../../tests/e2e/design-adjustments.spec.ts).

### Attendance decisions and structural loading refinements

[AttendanceDecisionActions](../../src/components/ui/AttendanceDecisionActions.tsx) owns only presentation and opening the existing review flow. Props are language, eligible, pending and onDecision with AttendanceOutcome started/did_not_start. It never writes data. Each instance locks duplicate opening, uses the shared Button, renders localized body-portal hover/focus tooltips, and consumes Escape while its tooltip is open. Styles fix green #167A3D on pale green #E8F5EC / red #C52B40 on pale red #FCECEF independently of site accent, with 36px desktop and 44px phone/coarse targets. Final review writes also have a synchronous pendingSaveLock; close/cancel are disabled during that write.

SkeletonColumn.actionCount accepts one or two controls, defaulting to one. TableSkeletonRows inserts three real rows; TableLoadingPlaceholder supplies native headers when the loaded table is conditional. Do not use an unconfigured generic three-column placeholder for a wider table. NumberSkeleton and SkeletonBlock are decorative primitives. LoadingSkeleton.metricRatios marks ratio values. PerformanceReportSkeleton reuses the report's exact four-card/three-chart grid and known headings; chart placeholders must stay inside their plot frames. Workspace GroupCardSkeleton mirrors the identity/tag-only card and its responsive grid. [Refinement checks](../../tests/e2e/design-refinement.spec.ts).

Unknown report counts also use NumberSkeleton, including risk requisition totals, bottleneck page counts and active-requisition/funnel headings. Active requisition data identity excludes retry tokens: the loaded identity controls visible rows and totals, preserving a confirmed same-query snapshot during refresh while replacing values immediately on filter/scope changes. Confirmed empty results show zero only after a successful matching response.

## Records tables and fixed pagination

Owners: [RecordsControls.tsx](../../src/components/ui/RecordsControls.tsx) (`RECORD_PAGE_SIZE`, `RecordPagination`, `RecordCreateButton`, `RecordCell`, `RecordFilterPanel`, `useRecordCategoryOptions`), [TableControls.tsx](../../src/components/ui/TableControls.tsx) (`TableToolbar records`, `TableFilterField`), [list hook](../../src/lib/recruitment-list.ts), scoped `.records-surface` styles in [globals.css](../../src/app/globals.css).

Requisitions, Candidates, Sourcing history, Pipeline **table** and Offers plus Audit calculate a 1–100 row desktop/tablet page size from available height, without a size selector; phone cards use seven. Keep 48px desktop rows. Preserve existing columns, server search/privacy scopes, sorting, permissions and row/bulk actions. The shared toolbar has compact search, filtered result count, page-specific slots, an icon-only SlidersHorizontal filter action and a page-specific Plus creation action. Requisitions has no toolbar Status action. Sourcing weekly work has no unused filter button.

Records advanced filters open in a left sidebar beside the table on desktop/tablet and in a left slide-over on phones. The sidebar stages edits until Apply, discards unapplied edits on close, and keeps Apply/Clear in a persistent bottom footer. Clear immediately removes applied advanced filters without changing search, scope or sorting. Sidebar category lists use the same 44px trigger, typography, chevron, dropdown surface, and selection states as the shared multi-select filters; they retain scoped options and an accessible close button. The phone overlay supports Escape, focus containment and return. Keep aria-controls/expanded, bounded category menus, existing fields, search, sorting and scope. Audit remains desktop-only. [Behavior](../WEBSITE_STRUCTURE.md#recruitment-design-adjustments).

The pager is `< 1/4 >`, from exact filtered `ceil(count/pageSize)`. Empty results show `0/0`; unresolved totals `…`; failed totals `—` with localized count retry. Disable arrows during row requests and at boundaries. Preserve cursor reads and separate counts. Search/filter/sort changes reset paging; legacy URL sizes normalize to the measured size/page one while retaining other criteria; resize resets the cursor to page one. Empty continuation pages recover through a bounded first-page read. SQL accepts page sizes 1–100 and count-only 0; Home, Workspace, Dashboard and five-card Pipeline boards keep their defaults.

At 1366×768 and 100% zoom, the application header, closed toolbar, table header, seven 48px content rows and pager, including the candidate scope strip and selection controls fit without vertical page scrolling. Use continuous white desktop rows separated by 1px #E4E9F2 strokes, without row boxes, gaps or rounded edges. Divider strokes must not increase the 48px content-row geometry. Preserve neutral headers, hover/focus feedback, aligned actions and at most two visible lines per cell, with full authorized values through titles/details. No vertical clipping to imitate fit; wide tables may scroll horizontally. Expanded filters/diffs/history may increase height. Phones retain cards with 16px gaps, natural scrolling and 44px targets. [Acceptance checks](../../tests/e2e/records-refinement.spec.ts).


Priority columns use RecordPriorityIndicator before identity (after selection): centered read-only 18px bookmark, outlined #7C94AD or filled #0A3CDC. Localized state/tooltips. Cards show one indicator beside identity; no duplicate desktop requisition bookmark. [Semantics](../WEBSITE_STRUCTURE.md#candidate-registry-priority-and-visible-date).


### Records selection and Linked indicators

Records-specific sort icons follow the title by 6px. Show both up and down triangles and highlight the active direction. Requisitions/Candidates use 48px selection columns with 16px native checkboxes inset 16px from top and left, indeterminate captured selection and 44px phone targets. useRecordSelection retains IDs across pages; search/filter/sort/scope/access changes clear them. Checking flashes #EDF4FF for 1000ms, fading to normal; reduced motion holds the color then removes it. Unchecking/refresh/paging must not replay feedback. Selection bars show count, Export selected and Clear with neutral helper text; no Requisitions Review action. Bulk controls keep defaults for unaffected callers.

Requisitions Linked uses a soft Status-style text tag: pale blue with fixed #0A3CDC text for Linked, pale red with #C52B40 text for Not linked. Localized state and linkage explanation stay in accessible text/tooltip. Phone cards reuse the indicator. Existing filter/sort meanings stay unchanged. [Checks](../../tests/e2e/records-divider-filters.spec.ts).


### Records headings and captured selection

All scoped desktop Records headings use Prompt/Thai fallback, 12px semibold slate, 18px line height and vertical centering in a 48px label row. Static and sortable headings share this typography; sort icons remain 6px after titles. Advanced fields sit in the shared sidebar; headings retain their alignment and category menus remain viewport bounded.

useRecordSelection exposes capture/progress/error/cancel and commits IDs atomically. RecordSelectionProgress announces progress and offers Cancel. Preserve prior selection on cancel/error, disable checkboxes/paging/export while capturing, and prevent capture for unsettled search, row loading, unknown/failed counts or empty results. Only newly checked visible rows flash; off-screen rows do not replay feedback. [Behavior](../WEBSITE_STRUCTURE.md#records-captured-selection), [checks](../../tests/e2e/records-capture-history.spec.ts).
