# UI component contracts

Reuse the named primitive and read only its section. Source establishes the visual baseline. Interaction acceptance below is the desired completion standard, not a claim that existing controls already pass every edge case.

## Date selector

Owner: `DayDateSelector` in [Field.tsx](../../src/components/ui/Field.tsx); `TextInput type="date"` delegates to it. Use the explicit component API for localized navigation/Clear labels or options not forwarded by the wrapper.

Anatomy: 16px calendar icon → date/placeholder → month popover. White trigger, neutral border, `rounded-md`, 40px minimum height, 14px normal tabular text, hover feedback and accent focus. Field label stays outside the value; placeholder is not the only accessible name.

Display Gregorian `DD/MM/YYYY` in both languages; retain `YYYY-MM-DD` in state/FormData. Bangkok determines today. Month heading is 14px semibold with flanking arrows above a Sunday-first grid. Selected uses fill, today outline/tint, focus a visible indicator. Optional filled dates expose localized Clear; required dates do not.

Desktop popover is approximately 19rem; phone panel sits near the bottom with safe-area spacing. Fit within viewport and above parent overlay. Preserve `name`, controlled/uncontrolled behavior and change event. Hidden input `required` alone is not browser constraint validation: validate required/valid dates at the form boundary.

When editing: focus an appropriate popup target on open; support calendar keyboard navigation and Escape from inside the popup; restore trigger focus on close; handle month transitions and blank/invalid/required dates. Do not invent unsupported `min`/`max` props—inspect caller validation and extend the shared API only when needed. Test these behaviors instead of assuming they already exist.

## Dropdown box

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

Options: `ats-dropdown-menu` is a white panel with a thin shadow, shared 12px corner radius, a maximum height of `min(70dvh, 18rem)`, and internal scrolling. All menu rows use shared 8px corners, 6px panel padding, 4px row gaps, 36px minimum desktop choice height and 44px at phone widths. Action menus use the same surface and row geometry while retaining menu semantics and action-specific text colors. The Pipeline filter popover uses `ats-dropdown-surface` for the same border, radius and shadow without compressing its form layout. Keep readable wrapping for Thai and long values. Every choice uses one shared state treatment: transparent by default, pale blue (`#E9F2FF`) for hover and keyboard-active states, and the same pale blue selected row with a fixed `#0A3CDC` checkbox and white mark. Render that selected indicator for single-choice options and month choices too, while preserving their single-select accessibility semantics and close-after-selection behavior. Multi-selects keep their existing checkbox and stay-open behavior. Disabled choices stay muted and do not respond to hover. Recruitment Performance Site and Department are the visual reference, while its five-filter layout and selection logic remain unchanged.

Acceptance: Enter/Space opens/selects, arrows move between enabled options, Home/End reach valid extremes, Escape closes, focus returns, active option scrolls into view, and assistive technology identifies focus/selection. Handle empty arrays safely. Constrain popup width/position on phones and inside drawers; absolute positioning alone does not prove collision handling.

Add search only when list size warrants it; current `CommandSelector` has no search API. Department waits for Site, Section for Department; retain allowed legacy values. Header commands keep accessible names without stacked visible labels; forms keep visible labels. Preserve the header's exclusion of a global Clear-filter button.

## Fields, buttons and overlays

The Dashboard Channel legend uses `.ats-square-switch` with shared track width/height, corner radius, thumb size, border and state tokens in `globals.css`. Match the supplied reference: blue ON track and right white rounded-square thumb, neutral OFF track and left thumb, with the state text inside the track. The visual track is 64×32px; on phones/coarse pointers its button has a 44px-high touch target around that track. Keep `role="switch"`, `aria-checked`, and a focus indicator. The legacy generic switch styling must not override this tokenized control; Configuration Active switches retain their existing presentation.

The Configuration reason catalog uses labeled icon-only Add and Edit controls. Each main/detail reason has an Active switch whose checked state matches its saved active flag. Show saving feedback within the open section and disable its controls while saving; refresh only the reason catalog so the page and scroll position stay in place. Close the editor after success. Failed writes or refreshes keep its input and the previous confirmed switch state visible with an error. An archived main remains named in its detail's editor. Keep these controls usable by keyboard and at phone widths.

The Fail Candidate form uses visible labels and required shared selectors for actor, main, and detailed reasons. The shared selector retains native form values and required validation. Disable a dependent selector until its parent is chosen, clear stale selections when the parent changes, and present the optional remark after the hierarchy. Its confirmation uses readable field/value pairs rather than raw payload JSON. On phones, keep fields and footer controls within the modal viewport.

Reuse `Field`, `TextInput`, `TextArea`, [Button](../../src/components/ui/Button.tsx) and existing validation/disabled helpers. Values outweigh optional hints. Associate inline errors with fields, preserve inputs on failure and distinguish loading from disabled. Placeholder/color alone cannot identify required fields or errors.

Main task uses the primary action; secondary commands remain quiet; icon utilities have accessible names. Value-selection dropdowns and command menus have different semantics. Use [Operations](../../src/components/ui/Operations.tsx) for record actions, [Modal](../../src/components/ui/Modal.tsx), [Drawer](../../src/components/ui/Drawer.tsx), and [MobileBottomSheet](../../src/components/ui/MobileBottomSheet.tsx) for overlays. Preserve destructive confirmations in product flows without adding permission interruptions to routine design work.

Follow [platform dependency edges](../maps/system/platform.md) for shared-control changes: affected callers, Thai/English labels, nested overlay stacking and phone/desktop states. Prefer 44px primary phone targets; preserve density-specific desktop controls. The requisition drawer opts into shared `detailUtilityClassName` for workspace, bookmark, More and Close: 18px icons, 36px desktop / 44px phone boxes, neutral default, system blue hover/focus, and pale blue selected state. `RecordActionGroup uniformUtilities` and `Drawer uniformHeaderActions` preserve other callers while keeping the requisition controls centered within one row anchored to the header top, matching Candidate Detail on desktop and phones. Styling-only work does not require database/deployment workflows.
