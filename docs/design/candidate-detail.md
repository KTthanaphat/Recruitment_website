# Candidate Detail design

Reference symbols: `CandidateDetailHeader`, `buildRecordDetail`, `DetailGrid`, `SectionHeading`, `DetailDisclosure` in [RecruitmentWorkspace](../../src/components/RecruitmentWorkspace.tsx), plus [StageRail](../../src/components/ui/StageRail.tsx), [Drawer](../../src/components/ui/Drawer.tsx), [Operations](../../src/components/ui/Operations.tsx). Search symbols instead of reading the entire workspace file.

## Information order

Identity leads with candidate name / ID at 20px semibold navy, quiet circular person icon and smaller stage/result soft tags. Utility links and secondary actions use More/flat controls. Do not give every utility the same strength as Update.

Body begins with candidate-level warnings, then the expanded shared Candidate profile containing Position interests and the saved Profile note, followed by browser-style application tabs. Each selected tab contains Journey, Application details, Contact references, and Activity. Application/offer issues and Teams context stay inside the selected journey; profile warnings appear once above the shared profile, even before tab selection. Preserve conditional rendering rather than creating empty panels. Journey owns eligible Update and a clear blocked reason.

Use 18px semibold section headings with small accent icons, white lightly bordered rounded sections and 16–20px padding. Separate sections with whitespace; do not nest a card around each field.

## Profile grid

Reuse workspace `DetailGrid`: icon tile → label above value → optional copy. Labels 11px medium slate, values 14px semibold navy, row separators. Collapse two columns to one on phones. Wrap contact/group/Doc IDs; missing values are neutral dashes without copy actions.

Preserve copy feedback/live announcement and localized names for icon controls. Value emphasis exceeds label emphasis. A copy row must not appear to be an edit control.

## Journey and activity

`StageRail` owns journey presentation, rounds and derived Resume Screening. Do not collapse stages, invent progress or flatten Pending/Outcome records through styling.

Activity prioritizes current Pending: compact amber-accented row, stage/round title, dates/interviewer below, meaningful estimate emphasis, capability-gated edit. Recent completions follow; older history is disclosed. Keep Outcome-detail correction distinct from advancing a candidate.
Failed completions show the saved actor, main reason, detailed reason, and optional remark below the Outcome date/interviewer. Older unclassified failures show a quiet unclassified label. The Fail modal uses the same hierarchy and preserves the stage/date/interviewer context; its three selectors are required and reset dependent selections on parent changes.

Soft tags use pale backgrounds with dark text: green success, amber pending, red failure. Preserve this local treatment instead of indiscriminately applying bright generic tags.

## Offers, interviews and disclosures

Keep compact offer details above Working Confirm, which owns attendance confirmation/correction. Distinguish acceptance from actual start. Reference checks and rejection records retain conditional disclosures. Interview status, time and Join action take priority over transport metadata.

Design does not authorize messages, meetings or database writes. External behavior is owned by [integration contracts](../maps/system/integrations.md).

## Overlay and responsive behavior

Reuse focus-managed Drawer. Stage-update modal appears above it and returns focus appropriately. Preserve record URL/group context. On phones wrap header actions, keep primary action reachable, and constrain only genuinely wide journey content to internal scrolling.

Inspect long bilingual names, absent contacts, Pending/failed/completed cases, viewer/writer roles, long history and nested controls. [Candidate/pipeline node](../maps/system/pipeline.md) identifies owners and focused checks; profile spacing does not require setup/deployment reading.

## Profile and application selection

[CandidateProfilePanel](../../src/components/candidates/CandidateProfilePanel.tsx) owns shared identity/notes, applications, addition and reassignment. [CandidateRegistry](../../src/components/candidates/CandidateRegistry.tsx) owns distinct-person filters/search. Registry opening begins at profile/application list; a single unambiguous journey may be selected. Pipeline/calendar/report links pass `applicationId` to select their exact journey. Several applications require explicit selection before stage actions.

Selected application content keeps the existing drawer hierarchy and stage controls. Summaries show current group, stage, lifecycle and transfer history. Earlier entry/outcome assignments remain labeled; a carried Pending states that it began before reassignment. Transfer review includes source, destination, stage, pending work, required reason and version. Use existing CV folder links; no upload redesign. The single profile note shows its saved text, last editor and edit time directly under Position interests, without an inline editor. Creator/admin edit through the existing profile form; application PICs read only; other readers see a locked placeholder. Phone registry rows use labeled fields and wrap long contacts/interests.

## Shared profile and application tabs

The complete person profile appears once above all applications. Use label/value hierarchy, copy feedback, wrapping, and optional CV link. Person-level responsibility is labeled Created by; application details show all linked requisition PICs. Hide site/recruiter inputs in New and Edit; place Name/Nickname next to each other on desktop. Site-recruiter creation derives its site; administrator creation permits no home site.

One current note, not a note timeline. Creator/admin edit the note through the profile form opened by the pencil icon; there is no always-visible note textarea or separate Review note button. Reads and audit responses enforce note permission; blur is a neutral placeholder, never actual private text. Draft changes survive a failed/stale save. Note edits use expected ID/version.

When the Edit form retargets another candidate, refresh every persisted profile field (name, nickname, interests, note and its expected ID/version, phone, email, channel, first-contact date and candidate-folder link) from that candidate. Clear fields and note metadata when the new candidate has no saved value; never retain the previous candidate's draft. Keep the optional Application group search inside the opened picker list in Edit and New Candidate, including when adding an application from an existing profile. Preserve talent-pool, workspace-locked groups, keyboard selection, loading/error/retry and pagination states.

Tabs use tablist/tab/tabpanel semantics, roving focus, arrows/Home/End, selected state, and a phone-local scroll strip. Include every authorized active and closed journey, active first then newest first, with group label/ID and lifecycle only. Omit creation dates and journey IDs from tabs and the summary below them; operational dates/closure context remain in Application details. The selected blue tab connects to one blue-bordered panel containing all selected content, controls, and assignment history. No tab delete/close action. Multiple registry journeys require selection; exact contextual links, refresh, back/forward, and access-loss handling preserve the correct application. Switching tabs never changes profile-note permission or mixes stage/reference/offer records.

Duplicate popup appears on Review changes, before ordinary save confirmation. It lists permitted matching IDs and contact categories, opens existing profiles separately to preserve the draft, and supports Back/Continue as separate person. Recheck on server writes; edited contacts or changed matches require a new review. No checkbox or inline duplicate banner.

Masked unmatched summaries show only ID/interests/creator/saved date and a clear private-profile state. No profile-edit, CV, note, reference, or first-application action is exposed to noncreators. Server capability and RLS contracts are owned by [candidate behavior](../WEBSITE_STRUCTURE.md#independent-candidate-profiles); checks and evidence: [implementation](../work-items/candidate-profile-redesign/implementation.md).

## Connected drawer refinement

Candidate profile reuses the same `DetailGrid` and `SectionHeading` primitives as Application details, including field icons, copy feedback, and responsive rows. Its pencil and the application plus are icon-only controls with localized accessible names/tooltips and 44px targets. Keep tabs horizontally scrollable within the drawer and all panels within its bounds.

A candidate may have only one journey per group across current and historical assignments; the original journey may return through reassignment. Never offer a new journey for a previously visited group. Server validation covers inaccessible history and concurrent changes without revealing other journeys. [Implementation and verification](../work-items/candidate-detail-refinement/implementation.md).

## Compact offers and Working Confirm

Remove the redundant Offer record title. Keep requisition ID and a labeled pencil utility. Accepted and Start dates share a compact wrapping line; remarks remain below. Working Confirm has shared icon-only attendance actions at the right of the heading row: green #167A3D Check on pale green #E8F5EC for Accept, red #C52B40 X on pale red #FCECEF for Reject, with 8px spacing and localized accessible names/tooltips. Preselect Started work / Did not start in the existing review flow. Keep the heading/actions on one row on phones, allowing the heading to wrap. Preserve attendance status below and share these controls with Home's Confirmation action. Escape dismisses an open tooltip before the drawer; a second Escape retains normal drawer behavior. Retain reason validation, date eligibility, administrator corrections, optimistic concurrency and audit history. Attendance does not change offer acceptance. Provide Thai/English labels and 44px phone/coarse-pointer targets. [Checks](../../tests/e2e/design-refinement.spec.ts).
