# Requisition Detail design

Reference: [Candidate Detail](candidate-detail.md) supplies the drawer shell, identity hierarchy, soft tags, flat actions, section surfaces and workspace profile grid. Owner: `buildDetailBodyV2` and `RequisitionDetailHeader` in [RecruitmentWorkspace](../../src/components/RecruitmentWorkspace.tsx).

Lead with the formatted position and requisition ID beside a quiet circular briefcase icon. Place status and fill-readiness soft tags below the title. Keep workspace, authorized edit, and More utilities flat; preserve each existing permission and contextual link.

On phones, place requisition utility actions on a separate row below the identity, with Close beside the title. This lets long positions wrap across the available width. The shared Drawer exposes this as an opt-in mobile action row; Candidate Detail retains its existing header layout.

Keep the information order: overview metrics, actionable issues, requisition profile, collapsed funnel, collapsed related records, then collapsed status history. Use 18px icon section headings and white, lightly bordered surfaces with 16–20px padding. Reuse the two-column workspace `DetailGrid` with meaningful Lucide icon tiles, small muted labels and stronger values; collapse to one column on phones. Missing values are neutral dashes.

The compact overview shows Open HC, accepted/approved headcount, Actual Age from PR approval, and restart-aware Current SLA. A thin fill-progress strip and localized readiness explanation follow; preserve existing calculation rules. The profile includes the copyable ID, approval date, position, level, site, department, section, status, request type, replacement names, owner, line manager, approved/accepted/open headcount, and created/updated dates. HQ uses a building icon; other sites use a factory.

Related candidates link to their detail drawer; related offers link to filtered offer records. Preserve language and global scope in links. Show names/IDs, stages or acceptance dates, and no-show status where present, with localized empty states. Status history shows most recent dates first, status and remarks; it starts collapsed. The historical funnel stays collapsed with a localized explanation of unique stage touches.

Retain requisition calculations, fields, historical funnel and related-record contents. Keep the same focus-managed drawer, responsive wrapping and keyboard disclosure behavior as Candidate Detail. Verify long bilingual positions, filled/cancelled/open states, viewer/writer actions, narrow phones and empty related records.
