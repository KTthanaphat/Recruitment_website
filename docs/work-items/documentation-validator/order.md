# Documentation validator work order

Order revision: 1. Feature: documentation-validator. Mode: Luna worker; do not delegate.

## Outcome and scope

Add a dependency-free Python checker for the maintained agent documentation graph and meaningful automated tests. This is the bounded tooling trial of the Astra–Luna workflow, not an application feature or live-service test.

Checkout: `C:/Users/thanaphat-krea/OneDrive - GFPT Public Company Limited/HR_database/recruitment_website`.

Luna owns only `scripts/check_agent_docs.py`, `tests/tooling/test_agent_docs.py`, and this folder's `implementation.md`. Astra edits the Markdown/skill contracts concurrently; do not modify them. Use Python standard library; no external service, npm install, credentials or app server. Record actual branch/base revision without committing.

## Acceptance

- AC-01: a command run from any working directory checks the maintained routing/design/workflow Markdown and active workspace skills, excluding archived snapshots, vendor skills and historical work-item reports. Default paths derive from script location. Check explicit local Markdown links and heading anchors; skip external URLs. Ignore fenced examples. Report source and target on failures; exit nonzero.
- AC-02: validate the small plain-scalar skill frontmatter used by active custom skills (name matching folder, nonempty concise description). Clearly scope supported syntax instead of pretending to parse all YAML.
- AC-03: graph checks ensure feature IDs F00–F27 appear exactly once in the seven system-node files, and every typed dependency-table edge has a matching impact back-link. Validate missing targets. Include role contracts in link checking.
- AC-04: standard-library tests use temporary fixtures, test valid input, missing link/anchor, ignored fenced examples, duplicate/missing feature ID and missing reverse edge. Do not alter real docs to exercise failures.
- AC-05: run the tests and checker, provide exact commands/exit codes, changed paths, source hashes and limitations; stop editing at handoff. Current docs may change while you work: report transient failures and let Astra rerun after final docs stabilize.

## Evidence

Keep evidence compact. The checker supports future maintenance; it is not proof of behavior in the recruitment app. Astra will inspect code/test assertions, independently rerun tests/checker, and issue repair orders for failures. No deployment, Git commit or remote mutation is authorized by this work order.
