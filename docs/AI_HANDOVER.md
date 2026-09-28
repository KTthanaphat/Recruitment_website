# Recruitment app entry point

Updated: 2026-09-14. Active application: the Next.js app in `recruitment_website`. Work in the checkout selected for the task; inspect current Git/server state rather than relying on saved branch or port claims.

| Task | Read next |
| --- | --- |
| Locate feature or solve a product/UI issue | [System map](maps/SYSTEM_MAP.md) |
| Run/configure, change schema or prepare release | [Setup map](maps/SETUP_MAP.md) |
| Design or polish a component | Matching contract in [Design](design.md) |
| Unclear owner | [Task map](FEATURE_FILE_MAP.md) |

Core context: Home starts recruiter work; Workspace is group-scoped; Dashboard owns Vacancy Waterfall. Candidates belong directly to `group_id`; optional `doc_group_id` preserves match context. Preserve role scope, Thai/English copy, Bangkok date semantics and export contracts. Detailed rules live in the relevant [Website Structure](WEBSITE_STRUCTURE.md) section.

Use the workspace `internal-ops-ui` skill for recruitment design. Its current contracts are based on Home, calendar, summaries and Candidate Detail. Do not load unrelated design skills automatically.

Read only what the task requires. Setup instructions apply when the task reaches setup, schema or deployment. Old session notes and duplicated rules are preserved in `archive/ai-handover-2026-09-14.md` for history, not current instructions.
