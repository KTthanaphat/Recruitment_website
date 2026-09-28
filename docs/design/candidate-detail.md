# Candidate Detail design

Reference symbols: `CandidateDetailHeader`, `buildRecordDetail`, `DetailGrid`, `SectionHeading`, `DetailDisclosure` in [RecruitmentWorkspace](../../src/components/RecruitmentWorkspace.tsx), plus [StageRail](../../src/components/ui/StageRail.tsx), [Drawer](../../src/components/ui/Drawer.tsx), [Operations](../../src/components/ui/Operations.tsx). Search symbols instead of reading the entire workspace file.

## Information order

Identity leads with candidate name / ID at 20px semibold navy, quiet circular person icon and smaller stage/result soft tags. Utility links and secondary actions use More/flat controls. Do not give every utility the same strength as Update.

Body prioritizes actionable issues and Candidate Pipeline Journey, applicable Teams interview context, profile, conditional disclosures and Activity. Preserve conditional rendering rather than creating empty panels. Journey owns eligible Update and a clear blocked reason.

Use 18px semibold section headings with small accent icons, white lightly bordered rounded sections and 16–20px padding. Separate sections with whitespace; do not nest a card around each field.

## Profile grid

Reuse workspace `DetailGrid`: icon tile → label above value → optional copy. Labels 11px medium slate, values 14px semibold navy, row separators. Collapse two columns to one on phones. Wrap contact/group/Doc IDs; missing values are neutral dashes without copy actions.

Preserve copy feedback/live announcement and localized names for icon controls. Value emphasis exceeds label emphasis. A copy row must not appear to be an edit control.

## Journey and activity

`StageRail` owns journey presentation, rounds and derived Resume Screening. Do not collapse stages, invent progress or flatten Pending/Outcome records through styling.

Activity prioritizes current Pending: compact amber-accented row, stage/round title, dates/interviewer below, meaningful estimate emphasis, capability-gated edit. Recent completions follow; older history is disclosed. Keep Outcome-detail correction distinct from advancing a candidate.

Soft tags use pale backgrounds with dark text: green success, amber pending, red failure. Preserve this local treatment instead of indiscriminately applying bright generic tags.

## Offers, interviews and disclosures

Keep Offer record above Come to work; Come to work owns start confirmation/correction. Distinguish acceptance from actual start. Reference checks and rejection records retain conditional disclosures. Interview status, time and Join action take priority over transport metadata.

Design does not authorize messages, meetings or database writes. External behavior is owned by [integration contracts](../maps/system/integrations.md).

## Overlay and responsive behavior

Reuse focus-managed Drawer. Stage-update modal appears above it and returns focus appropriately. Preserve record URL/group context. On phones wrap header actions, keep primary action reachable, and constrain only genuinely wide journey content to internal scrolling.

Inspect long bilingual names, absent contacts, Pending/failed/completed cases, viewer/writer roles, long history and nested controls. [Candidate/pipeline node](../maps/system/pipeline.md) identifies owners and focused checks; profile spacing does not require setup/deployment reading.
