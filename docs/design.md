# GFPT recruitment design system

Updated: 2026-09-14. Baseline: implemented Home banner, calendar, operational summaries, and Candidate Detail.

Use the matching contract and its linked component; do not read the entire library for a small edit.

| Need | Canonical visual contract |
| --- | --- |
| Font hierarchy, color, surfaces, responsive composition | [Foundations](design/foundations.md) |
| Home banner, work queue, calendar, summary cards | [Home](design/home.md) |
| Workspace picker, selected case, tabs, and sections | [Workspace](design/workspace.md) |
| Audit filters, event table and field changes | [Audit Log](design/audit.md) |
| Dashboard Recruitment Performance layout, charts and PNG | [Recruitment Performance](design/recruitment-performance.md) |
| Candidate identity, journey, profile, activity and offers | [Candidate detail](design/candidate-detail.md) |
| Date selector, dropdown, fields, buttons and overlays | [Controls](design/controls.md) |
| Locate implementation/dependencies | [System map](maps/SYSTEM_MAP.md) |
| Run, configure, verify or deploy | [Setup map](maps/SETUP_MAP.md) |

Product behavior remains in [Website Structure](WEBSITE_STRUCTURE.md). Visual guidance does not redefine routes, stages, permissions, reporting formulas or external-service actions. Component-specific exceptions override generic visual defaults. Report source/doc drift explicitly; do not silently redesign a reference while documenting it.

The previous generic ATS concept is retained in `archive/design-concept-2026-09-14.md` for history only, not current implementation guidance.
