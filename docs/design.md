# GFPT recruitment design system

Updated: 2026-09-14. Baseline: implemented Home banner, calendar, operational summaries, and Candidate Detail.

Use the matching contract and its linked component; do not read the entire library for a small edit.

| Need | Canonical visual contract |
| --- | --- |
| Font hierarchy, color, surfaces, responsive composition | [Foundations](design/foundations.md) |
| Home banner, work queue, calendar, summary cards | [Home](design/home.md) |
| Workspace picker, selected case, tabs, and sections | [Workspace](design/workspace.md) |
| Audit filters, event table and field changes | [Audit Log](design/audit.md) |
| Dashboard common filters, report tabs, scope and responsive portal | [Dashboard portal](design/dashboard-portal.md) |
| Vacancy Risk & Aging, Stage Bottlenecks and system Dashboard shell | [Risk and bottleneck subviews](design/dashboard-risk-bottlenecks.md) |
| Configuration folder tree, contents and editors | [Configuration](design/configuration.md) |
| Dashboard Recruitment Performance layout, charts and PNG | [Recruitment Performance](design/recruitment-performance.md) |
| Candidate identity, journey, profile, activity and offers | [Candidate detail](design/candidate-detail.md) |
| Date selector, dropdown, fields, buttons and overlays | [Controls](design/controls.md) |
| Dashboard navigation, square bars and summary fractions | [Portal](design/dashboard-portal.md#navigation-compatibility-and-data-bars) / [Risk summaries](design/dashboard-risk-bottlenecks.md#summary-refinement) |
| Mobile three-item navigation, Records sheet and desktop-required pages | [Mobile navigation](design/mobile-navigation.md) |
| Locate implementation/dependencies | [System map](maps/SYSTEM_MAP.md) |
| Run, configure, verify or deploy | [Setup map](maps/SETUP_MAP.md) |

Product behavior remains in [Website Structure](WEBSITE_STRUCTURE.md). Visual guidance does not redefine routes, stages, permissions, reporting formulas or external-service actions. Component-specific exceptions override generic visual defaults. Report source/doc drift explicitly; do not silently redesign a reference while documenting it.

The previous generic ATS concept is retained in `archive/design-concept-2026-09-14.md` for history only, not current implementation guidance.

Dashboard editable data exports: [Dashboard data export](design/dashboard-data-export.md), with owner links in [Reporting](maps/system/reporting.md#dashboard-data-exports).
