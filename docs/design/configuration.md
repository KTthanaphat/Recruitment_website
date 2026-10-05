# Configuration folder browser

Behavior: [Configuration](../WEBSITE_STRUCTURE.md#configuration-page). Owners: [Pipeline reasons](../maps/system/pipeline.md#f22-candidate-pipeline-boardrecord-register) and [template integrations](../maps/system/integrations.md). Shared interactions: [controls](controls.md).

## Navigation and hierarchy

`ConfigurationView` uses a 260px desktop folder navigator and flexible contents pane. The root contains Candidate failure reasons, Rejection letter formats and Teams invitation formats. Reasons nest Actor → Main reason → Detailed reasons. Template folders nest Thai/English → Formats. Folders derive from existing classifications; they are not stored separately.

Use familiar folder/file icons, localized names, immediate-child counts and Active/Archived status. Main reasons are folders with their own Edit/Active/Add detail controls. Detailed reasons/templates are contents items. Breadcrumbs expose the parent path; search finds bilingual labels/template names in the current subtree and displays each result's parent path. All/Active/Archived defaults to All; contents count matches displayed rows.

The tree supports arrows, Home/End and Enter; expansion and selection are distinct. Selected folders have a pale blue surface and system-blue text/focus. A phone Browse folders control opens the existing bottom sheet. Selection closes it and focuses the contents heading without changing page scroll. Unknown paths resolve to the closest existing parent.

## Compact contents layout

Use 12px layout gaps, 16px contents-panel padding and 8px between header sections. Keep the 260px navigator with 36px desktop rows and 44px phone/coarse-pointer targets. Folder title and count share a wrapping line. Search/status/action controls are 32px on desktop and 44px on phones; center the search icon against its input.

The contents pane is an inline-size container. At 600px or wider, align each row as 20px icon → flexible name → count/status or language/version → actions. Use 44px minimum rows, 4px vertical padding and 12px column gaps; all blocks share a vertical center. Long names and search breadcrumbs may increase row height. Below 600px, put metadata beneath the full name and wrap actions onto their own row. Center the icon against the complete name/metadata block. Scope control sizing to tree, breadcrumb, contents and action owners; avoid blanket descendant button sizing.

## Editors and feedback

`ConfigurationItemEditor` owns a drawer with a parent breadcrumb, existing validated fields and contextual defaults. Actor folders prefill main classification; main folders prefill detail parent/actor; language folders prefill template language. Existing reason classification is fixed. Archived parents remain named and cannot receive new details until active.

Use localized labels, inline errors, saving feedback and disabled controls during writes. Keep drafts on failure. A successful write followed by failed refresh exposes Retry refresh, which performs only the read. Catalog refresh preserves the selected folder, expansion and scroll. Dirty drawer exit offers Save, Discard and Continue editing; browser unload uses the native draft protection.

All Active controls use the [shared ON/OFF primitive](controls.md#shared-onoff-switch): reason/template editor drafts, reason list rows and selected-main-folder headers. Editors update the draft until Save; list/header controls write immediately. Disable during saving or refresh-only retry, preserving the last confirmed state on failed writes/reads.

System Admin/Admin Recruiter retain access. Reuse existing reason writes/template endpoints and template variable validation; this redesign does not send invitations or rejection letters.

## Verification

[Configuration checks](../../tests/e2e/rejection-reason-admin.spec.ts) cover hierarchy, search, creation/editing, archived parents, errors, read-only retry, drafts, templates, permissions and Thai phone keyboard navigation. See the [work-item review](../work-items/dashboard-configuration-redesign/review.md) for observed results.
