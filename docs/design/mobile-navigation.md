# Mobile navigation and desktop-required pages

Behavior: [Website Structure](../WEBSITE_STRUCTURE.md#routes-and-navigation). Owners: [Platform](../maps/system/platform.md#f06-phone-first-recruiter-operations). Interiors remain in [Home](home.md), [Workspace](workspace.md), [Candidate detail](candidate-detail.md) and [Controls](controls.md).

## Composition

Below 1024px, a safe-area fixed bottom bar has three equal-width destinations: Home, Workspace and Records. Reuse icons, assigned-profile selected accent, navy/slate text, visible labels and 44px targets. Home/Workspace are links; Records is a button selected for any record category. Reserve bottom-nav space. Desktop keeps the dark sidebar, Records hierarchy and collapse memory.

Records uses `MobileBottomSheet breakpoint="lg"`: Requisitions, Sourcing, Candidates, Pipeline, Offers in order, active category and 44px rows. Keep contextual links; close on selection, Escape, outside activation or desktop transition. Contain focus, return to trigger, keep tablet/phone bounds safe. No More item or mobile management destinations.

## Desktop-required presentation

Dashboard, Configuration, Audit and Administration show a compact white notice with monitor icon, requested page name and localized 1024px instruction. Supply Home/Workspace links and bottom bar; retain Language/account/sign-out, omit filters/Refresh. Keep URL/query without redirect/bypass. Unknown initial viewport shows neutral loading, never desktop content.

Existing editors/details/saves/export choosers defer the notice until closed/completed, retaining mounted drafts. Without active interaction show the notice immediately. Returning to desktop resumes requested navigation. Initial blocked pages read only the authenticated profile; allowed mobile pages use existing authorized data/catalogs and skip company report RPC. This is presentation, not authorization.

## Verification

[Mobile operations](../../tests/e2e/mobile-operations.spec.ts): roles, blocked reads, context, languages, 360/390/768/1023/1024 boundaries, focus and drafts. [Stage refinement](../../tests/e2e/stage-mobile-refinement.spec.ts): screen/exports, deferred notice and stale loading. [Review](../work-items/mobile-shell/review.md).
