# Recruitment application

Before implementing each new feature, ask the user whether to use agents and wait for the answer. Follow the [feature delivery process](docs/workflows/FEATURE_DELIVERY_LOOP.md) for the chosen mode. Assigned workers execute their order directly; documentation-only work does not trigger the feature question.

Use [docs/FEATURE_FILE_MAP.md](docs/FEATURE_FILE_MAP.md) to select a task-specific path when the owner is unclear. Product/UI work routes through the system map; environment, schema and release work through the setup map. Do not read every linked document before a small edit.

For recruitment UI design use the workspace `internal-ops-ui` skill and the matching contract under [docs/design.md](docs/design.md). Home banner, calendar, summaries and Candidate Detail are the reference patterns. Preserve existing primitives and prioritize size/weight hierarchy before decorative color.

Product behavior is owned by the relevant section of `docs/WEBSITE_STRUCTURE.md`; schema workflow by `supabase/schemas/README.md`; integration effects by their named contracts. Archived documents are historical. Maps index ownership rather than duplicating those rules.

Use current checkout/status and inspect the relevant source. Preserve unrelated changes. Keep maps and canonical contracts aligned when ownership or behavior changes. Verification depends on the change; see `docs/maps/SETUP_MAP.md#setup-verify` when needed.
