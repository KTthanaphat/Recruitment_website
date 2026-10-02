# Verification environments and focused checks

Updated: 2026-09-14. Classification below is based on inspected configuration/test source; it is not a claim that all application tests currently pass.

## Local documentation tooling

`python scripts/check_agent_docs.py` checks maintained links, skill metadata and graph ownership. `python -m unittest discover -s tests/tooling -p "test_agent_docs.py" -v` uses temporary fixtures and standard-library Python. These commands do not start the app or access production. Run, repair owned failures and rerun without asking for permission at each iteration. The [tooling trial order](../work-items/documentation-validator/order.md) defines scope; its [acceptance report](../work-items/documentation-validator/review.md) records independent verification and limits.

## Browser tests with mocked data

[playwright.config.ts](../../playwright.config.ts) starts `pnpm dev`, accepts `NEXT_PUBLIC_APP_URL` and reuses an existing server. Before a browser run, establish a local loopback URL and confirm the server is the intended checkout. Do not treat an environment-provided URL as local automatically.

[installMockSupabase](../../tests/e2e/support/mock-supabase.ts) seeds synthetic users/data and intercepts browser `/auth/v1/user`, `/rest/v1/rpc/**` and `/rest/v1/**` requests. This supports browser UI assertions; it does not exercise real RLS/RPC implementations or intercept every server-side/API request. A test importing this helper is not proof that every external effect is mocked.

Use the following command from the app checkout only after confirming its local environment and the selected test's intercepts. Additional `-g` filters select the named scenario. Install browsers only if absent.

```powershell
pnpm exec playwright test tests/e2e/ux-enhancements.spec.ts -g "home calendar"
```

## Exact source leads

| Task | Existing file and test selector | Boundary |
| --- | --- | --- |
| Home calendar/context and start colors | [ux-enhancements.spec.ts](../../tests/e2e/ux-enhancements.spec.ts), `-g "home calendar"` | Synthetic browser data; not real calendar delivery |
| Candidate drawer/action hierarchy | [wave-4.spec.ts](../../tests/e2e/wave-4.spec.ts), `-g "candidate drawer has one action hierarchy"` | Drawer/modal UI, not comprehensive keyboard coverage |
| Phone overflow | [wave-4.spec.ts](../../tests/e2e/wave-4.spec.ts), `-g "key views have no page-level overflow"` | 390px sampled views |
| Sourcing controls/record saves | [wave-4.spec.ts](../../tests/e2e/wave-4.spec.ts), `-g "group details|sourcing"` | Browser-side mocked RPC, not database authorization |
| Candidate input validation | [forms-validation.spec.ts](../../tests/e2e/forms-validation.spec.ts) | Selected form flows |
| Role-dependent controls | [auth-permissions.spec.ts](../../tests/e2e/auth-permissions.spec.ts) | Mock role visibility; selectors may drift with component changes |
| Translation-key parity | [i18n.spec.ts](../../tests/e2e/i18n.spec.ts) | Dictionary parity, not rendered translation quality |
| Rejection composer/state | [rejection-letter-ui.spec.ts](../../tests/e2e/rejection-letter-ui.spec.ts) | Inspect route interception before sending; does not establish mailbox delivery |

Date-selector and command-dropdown keyboard/empty-list/collision behavior is an acceptance requirement in [Controls](../design/controls.md), not a verified dedicated suite. When such a control changes, add a focused regression scenario and exercise it during verification. Do not label a broad sourcing or form test as comprehensive selector accessibility coverage.

## Unmocked, database and external checks

[login.spec.ts](../../tests/e2e/login.spec.ts) does not install the mock helper; it observes public/protected route behavior against the configured app. It does not prove authentication correctness.

SQL files under `tests/db/` require an explicitly selected disposable/test database and source inspection. Browser mock passes do not validate SQL authorization or migrations. Actual rejection delivery and Teams create/reschedule/cancel tests affect external services; follow their contract and existing authorization before execution. Mocked composer tests are not delivery verification.

## Recording results

Record the actual command, target/mode, exit code, source identity and what was verified. Keep unresolved test drift and unavailable external verification visible. For product release use [SETUP-RELEASE](../maps/SETUP_MAP.md#setup-release); do not expand every focused repair into a full build or live-service test.
