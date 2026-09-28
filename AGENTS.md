# Recruitment application

For creating/adding features, use the [Astra–Luna delivery loop](docs/workflows/FEATURE_DELIVERY_LOOP.md): Astra issues orders and independently verifies; `gpt-6-luna` at `medium` writes application code and tests, runs them, and repairs failures. Internal subagent delegation is authorized for this bounded workflow. Documentation-only work does not require launching the loop.

Worker exemption: when executing an assigned Luna work order, implement that order directly. Do not launch another delivery loop, spawn a coordinator, or require your worker model to be Astra. The model requirement applies to the coordinating role only.

Use [docs/FEATURE_FILE_MAP.md](docs/FEATURE_FILE_MAP.md) to select a task-specific path when the owner is unclear. Product/UI work routes through the system map; environment, schema and release work through the setup map. Do not read every linked document before a small edit.

For recruitment UI design use the workspace `internal-ops-ui` skill and the matching contract under [docs/design.md](docs/design.md). Home banner, calendar, summaries and Candidate Detail are the reference patterns. Preserve existing primitives and prioritize size/weight hierarchy before decorative color.

Product behavior is owned by the relevant section of `docs/WEBSITE_STRUCTURE.md`; schema workflow by `supabase/schemas/README.md`; integration effects by their named contracts. Archived documents are historical. Maps index ownership rather than duplicating those rules.

Use current checkout/status and inspect the relevant source. Preserve unrelated changes. Keep maps and canonical contracts aligned when ownership or behavior changes. Verification depends on the change; see `docs/maps/SETUP_MAP.md#setup-verify` when needed.
