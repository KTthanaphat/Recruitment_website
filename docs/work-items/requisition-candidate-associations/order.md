# Requisition Candidate Associations — Implementation Order

## Outcome

Keep shared sourcing groups and weekly applicant counts. Make Pipeline Health candidate-stage counts and Source effectiveness candidate measures specific to requisitions a candidate is explicitly associated with. This prevents a stage pass or offer belonging to another requisition in the same group from automatically appearing in this requisition's report.

## Scope

- Add an audited, RLS-protected candidate-to-requisition junction in the declarative schema and migration workflow. A candidate may be associated with more than one requisition.
- Backfill only direct evidence: each candidate's current `doc_group_id` mapped to its requisition, plus requisition IDs from that candidate's existing offer records. Never fan out links to every requisition in the shared `group_id`.
- Load associations through the existing app data path. New candidate creation associates the requisition represented by the selected document group. Provide a recruiter-facing way to add and remove requisition associations for existing candidates, scoped to requisitions the actor can manage.
- Scope Pipeline Health's passed-stage counts and Source Effectiveness' candidate-based Phone Screening and Hired measures through explicit associations. Keep weekly Applicants, channel colors, requisition eligibility, date rules, no-show rules, and deduplication semantics unchanged.
- Update the dashboard behavior contract and add focused UI and database coverage. Do not apply migrations to the remote Supabase project, edit live records, push branches, or deploy.

## Acceptance criteria

1. A candidate linked only to Req A through `candidate.doc_group_id` or an offer does not contribute stage counts to Req B just because A and B share a position group.
2. Explicitly associating that candidate with both A and B makes the candidate's canonical passed-stage events eligible in both requisition scopes; each funnel still counts a candidate once per stage.
3. Shared group applicant totals remain unchanged when candidate requisition links change.
4. Source Phone Screening and Hired follow the same requisition associations; accepted-offer dates, offer requisition, and no-show handling retain their current rules.
5. Creation, association edits, RLS, and audit behavior follow existing authorization patterns. Unauthorized users cannot read or change links outside their permitted scope; invalid candidate/requisition links fail atomically.
6. Migration backfill is idempotent, uses only the two direct-evidence sources above, and creates no group-wide candidate fanout.
7. Focused DB, dashboard, and type checks pass; affected English/Thai dashboard states render without regressions.

## Relevant contracts and verification

- Checkout: active `recruitment_website` workspace.
- Owners: `docs/maps/system/reporting.md`, `docs/maps/system/pipeline.md`, `src/components/dashboard/VacancyWaterfallView.tsx`, `src/lib/data.ts`, `src/types/recruitment.ts`, and declarative Supabase schema/RPC/RLS files.
- Product rules: `docs/WEBSITE_STRUCTURE.md` dashboard Pipeline/Source sections; `docs/CANDIDATE_PIPELINE_ADJUSTMENT_PLAN.md` for canonical passed-stage semantics.
- Checks: focused `tests/e2e/dashboard-reports.spec.ts`; a transaction-scoped SQL regression test in `tests/db`; `pnpm typecheck`; build if feasible.
- Authorization boundary: implement and verify locally only. No remote database or release operations are authorized by this order.
