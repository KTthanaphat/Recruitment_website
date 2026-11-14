# Calendar start-work confirmation

User confirmed matching Records → New Hire Confirmation layout/actions and retaining review before Save. Direct implementation, no delegation. Owners: [shared row](../../../src/components/dashboard/NewHireConfirmationRow.tsx), [calendar popup](../../../src/components/dashboard/CalendarStartConfirmation.tsx), [entry points](../../../src/components/dashboard/RecruitmentCalendar.tsx), [Home coordination](../../../src/components/dashboard/HomeView.tsx). Rules remain in [behavior](../../WEBSITE_STRUCTURE.md#calendar-start-confirmation) and [design](../../design/home.md#calendar-start-confirmation).

## Changes

Extracted the existing Records row/columns into one shared component. Calendar start events use its same fields and attendance icons in a responsive modal. Month chips, phone agenda, expanded-day details and Today’s Events use this popup; stage events and candidate identity within it still open the selected Candidate Detail.

Exact-ID offer/requisition reads use existing Supabase/RLS permissions independently of bootstrap coverage. Match event/candidate/application/date and ordinary classification before actions. Stale/unreadable rows fail closed; transient errors retry. Identity/filter/refresh changes clear selection, late responses are disregarded, and development effect replay reuses one request.

Eligibility, shared Accept/Reject controls, rejection reason, review/Save gate and fresh concurrency version remain. Future/confirmed/viewer entries are read-only here. Attendance saves never change accepted/start dates; no-show and administrator correction paths remain. No SQL/schema changes or new RPC; connected project remains `mppnlkldlctvketcsald`. No push or deployment.

Calendar details also retain current RPC remarks and cached authorized stage edit context, rather than dropping them when mapping the paginated feed.

## Verification commands and coverage

- [Calendar confirmation checks](../../../tests/e2e/calendar-start-confirmation.spec.ts): both reviewed outcomes, no premature writes, unchanged accepted/start dates, future/confirmed/viewer read-only states, retry/stale dates, Today’s Events routing, selected-candidate navigation and Thai phone/focus.
- [Existing attendance checks](../../../tests/e2e/design-refinement.spec.ts): Records loading/layout/actions/retry/read-only regression.
- [Existing calendar checks](../../../tests/e2e/ux-enhancements.spec.ts): stage details/date overflow, Today’s Events/month behavior and due/confirmed/future/no-show presentation. Destination expectations and application fixture IDs now match the selected application; mock no-show exclusion follows unchanged SQL.
- TypeScript and documentation link/graph validation; inspect desktop and 360px phone captures. Final results follow below.

## Final verification and local delivery

Verified in the active KT checkout on 2026-11-14. Integrated run passed 22/22 checks: 10 new calendar confirmation cases, 7 existing Records attendance/layout cases and 5 calendar/Today’s Events regressions. Command: `playwright test tests/e2e/calendar-start-confirmation.spec.ts tests/e2e/design-refinement.spec.ts tests/e2e/ux-enhancements.spec.ts --grep 'calendar|Today.s Events|home icon reviews|Home attendance|Read-only users|New hire loading' --workers=1`. TypeScript (`tsc --noEmit --incremental false -p tsconfig.json`), documentation graph validation and `git diff --check` passed; Git emitted only existing line-ending notices for unrelated files.

Inspected final desktop and Thai 360px phone confirmation views. Existing Records row/loading columns/actions and both outcomes remain covered; new checks also reject inaccessible offers and newly secret requisition context without displaying write actions. Tests use synthetic data; no live attendance records were changed. Current RPC remarks display even without full bootstrap stage data; inline Edit still requires an authorized cached candidate/log context, otherwise View detail opens the existing hydrated candidate flow.

Evidence is saved under `outputs/calendar-start-confirmation/`. Local Home responds HTTP 200 and serves the active KT source. Preview: http://127.0.0.1:3100/home?lang=th. No new SQL changes, push or deployment.
