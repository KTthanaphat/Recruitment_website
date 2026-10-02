# Review: Requisition candidate associations

## Verdict

Accepted for local implementation. Shared sourcing groups still drive weekly Applicants totals. Pipeline stage counts and Source Effectiveness Phone Screening/Hired counts now use candidate-to-requisition associations. Candidate creation keeps its selected document-group requisition; new offer writes record their requisition as direct evidence. Recruiters can add/remove links from Candidate Detail, with the RPC checking both candidate and requisition management scope and the junction changes entering the existing audit log.

The migration backfill uses only the candidate's current `doc_group_id` and existing offer Doc IDs. It does not join candidate associations through a shared `group_id`.

## Independent verification

- `pnpm typecheck` — passed.
- `git diff --check` — passed; Git reports only expected LF/CRLF working-copy notices.
- Focused Playwright checks using synthetic mock data — passed (3 tests):
  - shared-group requisition scope keeps Applicants while excluding an unassociated candidate's Offer pass;
  - Candidate Detail add/remove association flow;
  - Thai Candidate Detail association rendering.
- `tests/db/candidate-requisition-associations.sql` — added, not run. The checkout has no `psql`, Supabase CLI, or local database. No remote database was accessed.
- Migration generation/diff against a local Supabase database — unverified because the CLI and local database are unavailable.

## Authorization boundary

All changes remain local. No remote migration, record edit, branch push, or deployment was performed.
