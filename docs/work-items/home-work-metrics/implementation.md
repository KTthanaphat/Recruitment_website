# Today’s Work floral card and metric lists

Owners: [HomeView](../../../src/components/dashboard/HomeView.tsx), [HomeMetricDialog](../../../src/components/dashboard/HomeMetricDialog.tsx), optional actions in [OperationalSummaryStrip](../../../src/components/ui/Operations.tsx), [69 RPC](../../../supabase/schemas/69_home_metric_drilldowns.sql).
Canonical rules: [behavior](../../WEBSITE_STRUCTURE.md#home-metric-lists), [design](../../design/home.md#metric-list-popups). User selected exact metric records in compact popups, continuing direct implementation without delegation.

## Delivery and SQL

[20261114081339_home_metric_drilldowns.sql](../../../supabase/migrations/20261114081339_home_metric_drilldowns.sql) was generated using installed CLI 2.120.0 (`migration new`), filled from the reviewed canonical additive source, rehearsed fresh and as a forward upgrade, then applied through the migration API. Local filename matches deployed history. Confirmed target immediately before apply: `mppnlkldlctvketcsald`, KTthanaphat's Project, ap-south-1, healthy PostgreSQL 17. No real HR records modified; no push or frontend deployment.

New RPC uses invoker security, empty search path, authenticated-only execution, validated metric/scope/cursor/page size, and existing report views plus authorization helpers. Existing aggregate endpoints/definitions remain unchanged. Urgent paging removes the ten-row preview limit; application cursor IDs distinguish shared-candidate journeys. Aging’s helper now accurately explains the existing overdue-action count.

## Verification evidence

- `node scripts/rehearse-home-metrics.cjs` passed fresh schemas and forward migration: four roles, four exact metric totals, Site/PIC/priority scopes, keyset pages beyond ten rows, superseded pending exclusion, shared ordinary/secret candidate isolation, anonymous/missing-auth denial and invalid input. Disposable PGlite stubs extensions/cron; it is functional/RLS evidence, not production performance.
- Live target: all four system-admin popup totals equal existing Home aggregates. Deployed invoker/search path/grants and migration version verified. An initial combined multi-role live query exceeded the MCP timeout; live non-admin end-to-end parity is not claimed. All-role coverage is disposable fixture evidence.
- Focused browser checks cover all four arrows, Show more, selected-application navigation, retry/empty states, Thai 360px phone layout, focus containment/Escape/return and filter-scope reset. Existing banner aggregate/retry regression is included. Desktop and phone captures are reviewed.
- TypeScript and documentation checks run before handoff.
- Security-advisor findings concern existing definer APIs, closed RLS tables and Auth password protection; none names this new invoker RPC. [Existing function lint guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## Current floral artwork

[Flower-sticker corner v2](../../../public/images/home-work-floral-corner-stickers-v2.png) follows the latest supplied flower designs. [Exact built-in edit prompt and provenance](sticker-artwork.md). Ornaments remain above/outside the outline, with no pointer events or content overlap. The previous v1 asset is retained.

## Final local handoff

Verified 2026-11-14 in the active KT checkout. `tests/e2e/home-work-metrics.spec.ts` (3 checks) plus the existing `Home banner uses` regression passed 4/4. TypeScript (`tsc --noEmit --incremental false -p tsconfig.json`) and `python scripts/check_agent_docs.py` passed. Final desktop and Thai 360px phone card/popup captures are saved under ignored `outputs/home-work-metrics/`.

Live admin parity was confirmed separately for open, overdue scheduled actions, sourcing gaps and the complete urgent queue. Installed function is security invoker with empty search path, authenticated execution enabled and anonymous execution denied. Canonical SQL matches the local migration byte-for-byte. `.env.local` points to `https://mppnlkldlctvketcsald.supabase.co`. The localhost page and floral asset respond HTTP 200; UI screenshots confirm the KT source changes are being served. Preview: http://127.0.0.1:3100/home?lang=th. No push or frontend deployment.


## Floral outline overlap refinement

Moved the ornaments above the panel border and 8px outward at the top-right and bottom-left. The card and decorative layer now allow visible overflow, keeping petals outside the outline without covering metrics, focus rings or arrows. Existing artwork, data, popup behavior and SQL are unchanged.

Outline-overlap verification: focused Today’s Work browser checks passed 3/3, including measured outward geometry, unchanged popup paging/retry/keyboard behavior and scope reset. Desktop and Thai 360px phone captures were inspected and saved under `outputs/home-work-metrics/floral-outline-overlap/`. TypeScript and documentation validation passed. No new SQL changes, push or deployment.


## Flower-sticker reference refinement

Replaced only the Today’s Work ornament asset with the supplied sticker sheet's flower language: pink hibiscus, yellow plumeria, purple bellflower and green leaves. Preserved the outward overlap, sizes, metric values, arrows and popup behavior. Banner artwork and SQL are unchanged. Prompt/provenance live in [sticker artwork notes](sticker-artwork.md).

Flower-sticker verification: the three focused Today’s Work browser checks passed 3/3, including outward geometry and existing metric popup behavior. Inspected desktop and Thai 360px phone views; pink hibiscus, yellow plumeria, purple bellflower and green leaves remain clear at the card corners. TypeScript and documentation link/graph checks passed. New asset is RGBA 1254×1254 with alpha range 0–255. No SQL changes, push or deployment.
