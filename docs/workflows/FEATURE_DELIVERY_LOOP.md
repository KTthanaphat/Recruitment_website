# Feature delivery process

Workflow ID: SETUP-FEATURE-LOOP. Updated: 2026-10-02.

## Ask before each new feature

Before implementing a new application feature, ask the user: **“Use agents for this feature?”** Offer direct implementation and agent-assisted implementation as clear choices. Wait for an explicit answer; silence is not a selection. Ask once for that feature, including when a feature request already contains implementation instructions. The choice applies through its routine repair iterations. Documentation-only maintenance, bug fixes and an assigned worker order do not start a new feature decision.

## Deliver in the chosen mode

- **Direct:** The active agent defines observable acceptance criteria, implements code and relevant tests, runs focused checks, reviews its own diff, and reports evidence and limits. Do not delegate.
- **With agents:** The coordinator selects suitable agents, roles and models for the feature and gives bounded orders with non-overlapping write ownership. The coordinator reviews each handoff, independently verifies decision-critical behavior, and sends defects back for repair. There is no mandatory model pairing. Use the [coordinator contract](feature-loop/astra.md) and [worker contract](feature-loop/luna.md) for their respective roles.

For either mode, identify the checkout, relevant contracts, outcome, scope, observable acceptance criteria, checks and authorization boundary. A small feature needs only a compact handoff; multi-step, cross-domain or externally integrated work may use versioned records under `docs/work-items/<feature-slug>/`. Keep maps as links to owners and contracts rather than copies of this process.

## Completion

Verify the final source state and report which criteria passed, failed or remain unverified. Later edits invalidate affected results. Continue routine repairs without asking for the same agent choice again. After repeated unsuccessful repairs, revise the approach instead of weakening acceptance. A local feature request does not authorize a push, deployment, database mutation or external delivery. Use [test boundaries](TEST_ENVIRONMENTS.md) and the task-specific [setup route](../maps/SETUP_MAP.md) when applicable.
