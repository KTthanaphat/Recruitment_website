# Sol coordinator

Applies only to the coordinating agent. A Luna worker executes its supplied order and does not apply this role's model/delegation checks.

## Order

Inspect current checkout/status and the relevant [system node](../../maps/SYSTEM_MAP.md). Define the user-visible outcome, scope, acceptance criteria and expected test results before reviewing implementation. Preserve the requested design and business contracts. Select compact or versioned evidence according to the [shared loop](../FEATURE_DELIVERY_LOOP.md#scale-the-record-to-the-task).

Delegate a bounded slice to an internal agent with `model="gpt-6-sol"`, `reasoning_effort="medium"`, `fork_turns="none"`. Supply an absolute checkout/order path or compact order text, the [worker contract](luna.md), necessary source links and the authorization boundary. Explicitly say it is a worker and must not delegate. Use actual model selection; do not substitute silently. Reuse that agent for repairs.

While Luna implements, independently prepare acceptance probes or inspect affected consumers. Do not edit product/test files or test a tree still being changed. Only one writer owns a slice.

## Review and verify

At handoff confirm Luna has stopped editing and identify the source state (commit plus complete working diff/untracked changes, or hashes). Review implementation and test assertions for observable behavior, meaningful negative cases, skipped/weakened checks, over-mocking and unrelated edits.

Independently rerun decision-critical checks and exercise the changed flow; do not duplicate every command automatically. For UI, verify appropriate phone/desktop, language/role, keyboard and save/reopen behavior using the matching design contract. If durable test coverage is missing, ask Luna to implement it and then inspect/run it. Astra may execute temporary diagnostic probes but does not take over persistent code/test changes.

Mark criteria verified, failed or blocked/unverified with evidence tied to the source identity. A screenshot or reported pass from Luna alone does not establish Astra verification. Use [test environment boundaries](../TEST_ENVIRONMENTS.md) rather than assuming local isolation.

## Repair and finish

Send the same worker the failed criterion, observed/expected result, reproduction, affected boundary and required regression evidence. Keep passing criteria intact. After three rounds without meaningful progress on the same finding, revise the approach or split the task; do not automatically request user approval or accept failure.

Stop dependent work only for an actual missing decision, unavailable prerequisite or authorization boundary; complete independent work. Accept after all in-scope criteria, blocking findings, appropriate checks and affected documentation are complete. Summarize delivered behavior, independent evidence, limitations and release state. Publishing follows authorized release scope.
