# UI component contracts

Reuse the named primitive and read only its section. Source establishes the visual baseline. Interaction acceptance below is the desired completion standard, not a claim that existing controls already pass every edge case.

## Date selector

Owner: `DayDateSelector` in [Field.tsx](../../src/components/ui/Field.tsx); `TextInput type="date"` delegates to it. Use the explicit component API for localized navigation/Clear labels or options not forwarded by the wrapper.

Anatomy: 16px calendar icon → date/placeholder → month popover. White trigger, neutral border, `rounded-md`, 40px minimum height, 14px normal tabular text, hover feedback and accent focus. Field label stays outside the value; placeholder is not the only accessible name.

Display Gregorian `DD/MM/YYYY` in both languages; retain `YYYY-MM-DD` in state/FormData. Bangkok determines today. Month heading is 14px semibold with flanking arrows above a Sunday-first grid. Selected uses fill, today outline/tint, focus a visible indicator. Optional filled dates expose localized Clear; required dates do not.

Desktop popover is approximately 19rem; phone panel sits near the bottom with safe-area spacing. Fit within viewport and above parent overlay. Preserve `name`, controlled/uncontrolled behavior and change event. Hidden input `required` alone is not browser constraint validation: validate required/valid dates at the form boundary.

When editing: focus an appropriate popup target on open; support calendar keyboard navigation and Escape from inside the popup; restore trigger focus on close; handle month transitions and blank/invalid/required dates. Do not invent unsupported `min`/`max` props—inspect caller validation and extend the shared API only when needed. Test these behaviors instead of assuming they already exist.

## Dropdown box

The global header places an icon-only priority star immediately after PIC and before Language. An outlined star shows all requisitions; a filled amber star limits requisition-related pages to priority requisitions. Use a localized title/accessible name, `aria-pressed`, visible keyboard focus and a 44px phone target. Site/PIC still narrow the selected priority scope. Persist `priority=only|all` in shared links and navigation; default is all. The flag is shared record data, while the filter is each user's view preference.

Owners: [CommandSelector.tsx](../../src/components/ui/CommandSelector.tsx), `CreateSelectInput` / native `SelectInput` in [Field.tsx](../../src/components/ui/Field.tsx).

| Need | Primitive |
| --- | --- |
| Header Site/PIC | `CommandSelector density="compact"`, 36px minimum |
| Form/dashboard value | Regular `CommandSelector`, 44px minimum |
| Select options and FormData adapter | `CreateSelectInput`, preserve name/value |
| Existing simple native select | Preserve `SelectInput` unless custom behavior is needed |
| Month, not a day | `CommandMonthSelector`: year navigation, 3-column months |

Trigger: restrained accent icon → selected value → trailing chevron. `rounded-xl`, neutral blue-gray border, 14px semibold; compact pale surface or regular white. Long values truncate within `min-w-0` but remain discoverable; the chevron does not shrink.

Options: white elevated panel, bounded scrolling (currently 18rem max), distinct rows, selected accent fill/checkmark and separate active/focus indicator. Selected, hover and keyboard-active are different states. Disabled options cannot be chosen.

Acceptance: Enter/Space opens/selects, arrows move between enabled options, Home/End reach valid extremes, Escape closes, focus returns, active option scrolls into view, and assistive technology identifies focus/selection. Handle empty arrays safely. Constrain popup width/position on phones and inside drawers; absolute positioning alone does not prove collision handling.

Add search only when list size warrants it; current `CommandSelector` has no search API. Department waits for Site, Section for Department; retain allowed legacy values. Header commands keep accessible names without stacked visible labels; forms keep visible labels. Preserve the header's exclusion of a global Clear-filter button.

## Fields, buttons and overlays

Reuse `Field`, `TextInput`, `TextArea`, [Button](../../src/components/ui/Button.tsx) and existing validation/disabled helpers. Values outweigh optional hints. Associate inline errors with fields, preserve inputs on failure and distinguish loading from disabled. Placeholder/color alone cannot identify required fields or errors.

Main task uses the primary action; secondary commands remain quiet; icon utilities have accessible names. Value-selection dropdowns and command menus have different semantics. Use [Operations](../../src/components/ui/Operations.tsx) for record actions, [Modal](../../src/components/ui/Modal.tsx), [Drawer](../../src/components/ui/Drawer.tsx), and [MobileBottomSheet](../../src/components/ui/MobileBottomSheet.tsx) for overlays. Preserve destructive confirmations in product flows without adding permission interruptions to routine design work.

Follow [platform dependency edges](../maps/system/platform.md) for shared-control changes: affected callers, Thai/English labels, nested overlay stacking and phone/desktop states. Prefer 44px primary phone targets; preserve density-specific desktop controls. Styling-only work does not require database/deployment workflows.
