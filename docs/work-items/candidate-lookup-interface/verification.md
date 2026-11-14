# Candidate lookup interface verification

2026-11-14. Direct adjustment of the existing feature in the KT `recruitment_website` checkout. [Design contract](../../design/candidate-lookup.md); [asset and generation prompt](illustration.md).

- `tsc --noEmit --incremental false -p tsconfig.json`: passed.
- `python scripts/check_agent_docs.py`: passed.
- Playwright Chromium, synthetic Supabase fixtures: `tests/e2e/candidate-lookup.spec.ts` **5/5 passed** after updating navigation to avoid Home's welcome modal. Covers default visibility without autofocus, Enter-only submission/retry, tooltip focus/touch/Escape, validation, normalization, duplicate paging, stale responses, clearing, memory/navigation, opening the selected application and phone focus containment.
- Adjacent regression checks: `tests/e2e/save-review.spec.ts` **5/5 passed** and `tests/e2e/confidential-requisitions.spec.ts` **8/8 passed** with the new card present.
- Inspected rendered 1280px desktop and 360px phone idle/results screenshots; checked 390px bounds. The transparent illustration loads; search stays at the bottom, phone actions fit and there is no page-width overflow.
- Verified `http://127.0.0.1:3100/candidates?lang=th`, its CSS and illustration return HTTP 200. The Next server process resolves to the KT checkout. Configured database host: `mppnlkldlctvketcsald.supabase.co`.

No SQL changes, pushes or deployments. Browser checks use synthetic responses; this UI adjustment does not establish real-project p95 latency or database authorization evidence. Existing privacy/performance evidence and limitations remain in the [original delivery record](../confidential-recruitment/implementation.md).

## Detective illustration revision

Replaced the illustration using the user's `design-system.txt`: flat 2D detective, transparent blue/purple artwork. Inspected desktop and 360px phone idle/results rendering; the responsive top frame is approximately half its previous height, illustration/title are left-aligned, and section spacing is tighter. `candidate-lookup.spec.ts`: 5/5 passed; TypeScript and documentation validation passed. Local page and new asset return HTTP 200 at the same verified preview. No database or search-behavior changes. Current asset and exact built-in tool prompt are in [illustration notes](illustration.md).
## Blue card and wide illustration revision

Applied the requested electric-blue card with white title/help/Close controls, white input/result surfaces and a transparent 3:1 detective illustration at two-thirds of the content width. The approved character is preserved and recolored for contrast; the original compact top-frame height is retained. New asset: RGBA 2172 × 724, alpha range 0–255. White title on `#146EFA` has contrast 4.53:1. Inspected rendered desktop and 360px phone idle/results states; 390px bounds remain checked by the existing suite. Lookup browser checks: 5/5 passed; TypeScript and documentation graph validation passed. Page and illustration both return HTTP 200 at `http://127.0.0.1:3100/candidates?lang=th`. No SQL changes, push or deployment. Exact built-in edit prompt and current asset: [illustration notes](illustration.md).
## Original posture and candidate papers revision

Restored the original compact bent-arm pose; extended the composition with three candidate papers on the right. Pale clothing and papers contrast with the blue card. Top padding increased from 4px to 16px. Transparent v4 asset is 2172 × 724 RGBA. Inspected desktop/360px phone idle screenshots; existing focused suite also checks results and 390px bounds. Lookup tests 5/5, TypeScript and documentation validation passed; local page and v4 image return HTTP 200. No SQL changes, push or deployment. [Current asset and exact built-in edit prompt](illustration.md).
## White panel and original palette restoration

User confirmed restoring the original white panel with navy text and richer illustration colors. V5 restores saturated blue clothing/purple accents while retaining the compact pose, three papers and 16px top padding. Added a 1px `#B7D2FF` border and soft blue shadow (`0 2px 10px rgba(20,110,250,.14)`). Inspected desktop and phone idle screenshots; focused lookup browser suite 5/5, TypeScript and documentation graph checks passed. Page and v5 asset return HTTP 200 on the same KT localhost preview. No SQL changes, push or deployment. Current asset and built-in edit prompt are maintained in illustration.md.
## Supplied reference interface

Updated the existing panel to the user's supplied interface: 480px desktop maximum, side-by-side artwork/heading/description, Search button next to the field, lower Active only row with a local rounded native-checkbox switch, pale-blue illustration backdrop and footer wave. Phone layout remains viewport-bounded. Reused v5 artwork unchanged; no new image generation or SQL changes. Enter and Search share the same guarded action; typing and toggling still do not submit. Canonical behavior/design and platform map were updated.

Inspected desktop/360px phone idle and result states, and checked 390px bounds. Focused lookup run: 7/7 passed. Consolidated lookup/Save/confidentiality run: 18/20 passed with two navigation/session-loading timeouts; those same two cases passed on isolated rerun (2/2). Busy-state repeat submission, Search click/tap, Enter, switch keyboard operation, focus containment and focus return are covered. TypeScript, documentation validation and the Impeccable mechanical detector passed (no detector findings). Verified localhost page and CSS return HTTP 200 at the same KT preview. No push or deployment.
## Compact refinement

At the user's request, compacted the interface without running Impeccable. Desktop width reduced from 480px to 360px; artwork region 64px, title 16px, shorter description, tighter section spacing and denser result cards. Desktop input/Search targets are 40px and switch 36px; phone targets remain 44px. Search, prefix matching, active filtering, focus and session behavior are unchanged. Inspected desktop and phone idle/results, with 390px bounds in the focused suite. All 7 lookup browser checks, TypeScript and documentation validation passed. Local preview responds HTTP 200. No SQL changes, push or deployment.
## White-to-blue grain shapes

Applied one shared local SVG treatment to the illustration backdrop and bottom-right wave: vertical white-to-light-blue fade with subtle static grain, clipped to each shape. Preserves compact geometry and avoids additional image/network requests. Desktop and phone idle/result interaction checks passed (2/2), with rendered desktop/phone review; TypeScript and documentation validation passed. No SQL changes, push or deployment.
## Automatic search and three-row header

Removed the Search button. Valid phone prefixes/full email now search after a 300ms pause; Enter searches immediately, and active-filter changes refresh automatically. Invalid/incomplete input and IME composition do not query. Debounce cancels on clear/close/unmount, repeat Enter does not duplicate requests, stale responses are disregarded, and errors stop automatic retries with an explicit Retry action. Header uses equal columns: artwork left; Close, localized title and details in three right-hand rows. Retained the compact panel and white-to-blue grain shapes.

All 10 focused lookup browser checks passed, covering the above behavior, paging, navigation/session memory, privacy of browser storage and phone keyboard/bounds. Desktop and 360px phone idle/results were inspected; 390px bounds checked. TypeScript, benchmark-script syntax and documentation validation passed. The benchmark now measures input-to-render including the debounce and clears input between samples; real-project p95 remains unverified without representative authenticated inputs. No SQL changes, push or deployment.
## Divider-free header

Removed the vertical divider between the detective illustration and title, preserving the existing two-column spacing. Desktop and Thai phone idle/results were inspected; the two focused layout/interaction checks passed 2/2 and documentation validation passed. Search, keyboard focus, sizing and data behavior are unchanged. No SQL changes, push or deployment.
