# Audit Log visual contract

Owner: [AuditView](../../src/components/audit/AuditView.tsx). Use [Foundations](foundations.md) for Prompt type, slate/navy hierarchy, focus and responsive spacing. Audit event creation and access rules remain in [Website Structure](../WEBSITE_STRUCTURE.md).

Keep Entity, Action, Actor, Record ID, and date-range filters above the log on desktop and in the existing mobile filter sheet. Show a filtered-event count. Lead an event-first table with localized entity and a soft action tag, followed by Date/time, Record, Actor, and Changes. Sort newest first. Use compact links under the record ID. The desktop/tablet header and rows share one bounded horizontal and vertical viewport; its header remains visible. Phones use labeled rows and natural page scrolling.

Use the existing action tone and source actor, with System only for records without an actor. Changes shows the count of changed fields and opens an accessible disclosure with the existing field-by-field old/new diff beneath the row. Preserve empty and filtered-empty states, keyboard focus and full values on long identifiers. Verify English and Thai at phone and desktop widths with filters, disclosures and record destinations.
