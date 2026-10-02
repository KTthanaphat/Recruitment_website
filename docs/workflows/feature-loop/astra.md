# Agent coordinator

Applies only when the user chose agents for this feature. An assigned worker executes its order directly.

## Order

Inspect current checkout/status and the relevant [system node](../../maps/SYSTEM_MAP.md). Define the user-visible outcome, scope, acceptance criteria and expected test results before reviewing implementation. Preserve the requested design and business contracts. Select compact or versioned evidence according to the [feature process](../FEATURE_DELIVERY_LOOP.md#deliver-in-the-chosen-mode).

Select agents, roles and models that fit the task. Delegate bounded slices with an absolute checkout/order path or compact order text, the [worker contract](luna.md), necessary source links and the authorization boundary. State each worker's write ownership and whether further delegation is allowed. Use actual model selection; do not simulate model identities. Reuse the owning worker for repairs when practical.

While a worker implements, independently prepare acceptance probes or inspect affected consumers. Do not edit product/test files or test a tree still being changed. Only one writer owns a slice.

## Review and verify

At handoff confirm the worker has stopped editing and identify the source state (commit plus complete working diff/untracked changes, or hashes). Review implementation and test assertions for observable behavior, meaningful negative cases, skipped/weakened checks, over-mocking and unrelated edits.

Independently rerun decision-critical checks and exercise the changed flow; do not duplicate every command automatically. For UI, verify appropriate phone/desktop, language/role, keyboard and save/reopen behavior using the matching design contract. If durable test coverage is missing, ask the owning worker to implement it and then inspect/run it. The coordinator may execute temporary diagnostic probes but does not take over persistent code/test changes in that slice.

Mark criteria verified, failed or blocked/unverified with evidence tied to the source identity. A screenshot or reported pass from a worker alone does not establish independent verification. Use [test environment boundaries](../TEST_ENVIRONMENTS.md) rather than assuming local isolation.

## Repair and finish

Send the same worker the failed criterion, observed/expected result, reproduction, affected boundary and required regression evidence. Keep passing criteria intact. After three rounds without meaningful progress on the same finding, revise the approach or split the task; do not automatically request user approval or accept failure.

Stop dependent work only for an actual missing decision, unavailable prerequisite or authorization boundary; complete independent work. Accept after all in-scope criteria, blocking findings, appropriate checks and affected documentation are complete. Summarize delivered behavior, independent evidence, limitations and release state. Publishing follows authorized release scope.
