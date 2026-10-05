# Dashboard and Configuration redesign

Agreed 2026-10-03: direct implementation, local preview, no push. Header scope remains the outer scope. No schema change is expected; any necessary migration targets develop project `mppnlkldlctvketcsald` first and excludes unrelated pending migrations.

Canonical behavior: [Dashboard](../../WEBSITE_STRUCTURE.md#dashboard-page), [Configuration](../../WEBSITE_STRUCTURE.md#configuration-page). Visual contracts: [portal](../../design/dashboard-portal.md), [folders](../../design/configuration.md). Owners: [Reporting](../../maps/system/reporting.md), [Pipeline](../../maps/system/pipeline.md), [Integrations](../../maps/system/integrations.md).

## Delivery sequence

1. Centralize Period/month/Custom dates, Site, Department and Level; normalize legacy links; retain session preferences per user/environment.
2. Add report registry/tabs; adapt report controllers and exports to common context; preserve local Channel/legend/table options.
3. Derive Configuration folders, contents, search, status and contextual drawers from existing settings; retain refresh-only retry and draft protection.
4. Update canonical contracts/maps without duplicating rules; run typecheck, affected synthetic browser suites, documentation validation and production build.
5. Inspect the authenticated local preview and phone layouts, record exact evidence, and leave a verified server running.

## Filter ownership matrix

| Report | Common filters | Local controls |
| --- | --- | --- |
| Performance KPIs/matrix/composition/SLA | Period/date, Site, Department, Level; header Site/PIC/Priority | Expansion |
| Waterfall | Same | Expansion, executive breakdown |
| Requisitions | Same | Status/Activity/Accum, column search/filter/sort, export columns |
| Pipeline Health | Same | Channel, legend, expansion |
| Source effectiveness | Same | Pipeline's Channel |

## Acceptance

Common scope reaches every report, current MTD/YTD ends today in Bangkok, Custom comparison is prior equal-length, invalid ranges block reports/exports, and old links restore deterministically. Session navigation, URL precedence, reset, tab history and phone keyboard states are covered. Folder hierarchy, bilingual search, permissions, contextual creation, archive/draft/write/refresh failures and template validation are covered. Export shapes/calculations remain intact. Existing SQL edits are preserved.


## Shared switch and compact contents refinement

Direct delivery follows the approved follow-up: one controlled ON/OFF primitive for Pipeline legend and Configuration editor/list/header Active controls, fixed system colors, and compact responsive contents rows. Visual details live in [Controls](../../design/controls.md#shared-onoff-switch), [Configuration](../../design/configuration.md#compact-contents-layout) and [Dashboard portal](../../design/dashboard-portal.md#reports-and-responsiveness). Results and evidence remain in [review](review.md).


## Follow-up scope: live reconciliation and future reports

Reconcile the existing visualization measures against read-only development aggregates, repair mismatches, and validate registration/restoration/capability behavior for additional reports. User approved retaining both no-show acceptance and reopening movements on 2026-10-04. Evidence and boundaries: [reconciliation](reconciliation.md).
