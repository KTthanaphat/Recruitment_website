# Production-only candidate migration adapters

These SQL files were created with the Supabase CLI and moved here deliberately. They are **not** in `supabase/migrations/` and will not run as part of an automatic migration push. Keep the historical migration files byte-for-byte unchanged.

## Applicability and order

Use these adapters only for a legacy target whose migration history confirms that neither `20261011153944_independent_candidate_applications.sql` nor `20261015074832_candidate_profile_privacy_tabs.sql` has run. Confirm the target project and its migration history independently for KT1 and KT2 before applying anything. Do not replay either adapter on a target that has already run its corresponding historical migration.

1. Apply [20261102001220_production_application_site_backfill.sql](20261102001220_production_application_site_backfill.sql) **in place of** `20261011153944_independent_candidate_applications.sql`. It is the original migration body with only the home-site reconciliation block replaced. Preserve existing `home_site`; fill a null value from a valid exact document-group anchor, or from the only known site for the group. Leave unanchored multi-site records null. Stop on invalid anchors or groups with no known site. It keeps the original single application and assignment per candidate and does not remove candidate-to-requisition links.
2. Apply `20261011160759_application_context_hardening.sql`, `20261011162307_application_no_show_reapplication.sql`, `20261011163003_application_correction_attribution.sql`, and `20261011165617_application_stage_chronology.sql` in that order.
3. Immediately before the unchanged `20261015074832_candidate_profile_privacy_tabs.sql`, apply [20261102001228_production_creator_provenance_prep.sql](20261102001228_production_creator_provenance_prep.sql). It fills only null creators with exactly one matching, profile-backed `migration:%` INSERT snapshot for the same raw candidate ID and original `created_at`. Regular candidate creation audit rows remain for the unchanged privacy migration to resolve. Ambiguous or unverified migration snapshots stop the upgrade; no actor is inferred.
4. Continue with the unchanged `20261015074832_candidate_profile_privacy_tabs.sql`, then apply these remaining migrations in lexical order:

   - `20261015080617_profile_registry_context.sql`
   - `20261015083414_group_pic_offer_context.sql`
   - `20261015091726_candidate_group_journey_claims.sql`
   - `20261026040217_fix_line_interview_round_date_derivation.sql`
   - `20261101124015_five_digit_app_ids.sql`
   - `20261101125118_candidate_registry_list.sql`
   - `20261101130623_dashboard_summaries.sql`
   - `20261101130720_operational_pipeline_lists.sql`
   - `20261101133343_pipeline_history_list.sql`
   - `20261101134435_pipeline_history_sort_filter_contract.sql`
   - `20261101134656_requisition_list_endpoint.sql`
   - `20261101140739_recruitment_list_optimization.sql`
   - `20261101152821_stage_bottleneck_summaries.sql`
   - `20261101170913_async_application_destinations_lookup.sql`
   - `20261101174258_offer_candidates_lookup.sql`
   - `20261101183700_dashboard_owner_filter_options.sql`
   - `20261101184800_rejection_id_alias_search.sql`
   - `20261102101500_home_recruitment_list_filters.sql`
   - `20261102113000_home_quality_detail_scope.sql`
   - `20261102114500_home_quality_exact_group_scope.sql`
   - `20261102120000_pipeline_stage_board_membership.sql`
   - `20261102121000_requisition_link_option_filters.sql`
   - `20261102122000_home_welcome_summaries.sql`
   - `20261102123000_home_quality_duplicate_key_precompute.sql`
   - `20261102123100_requisition_page_enrichment_after_limit.sql`
   - `20261102123200_bottleneck_authorization_key_memoization.sql`
   - `20261102123300_rejection_distinct_authorization_precompute.sql`
   - `20261102123400_candidate_assignment_application_history_index.sql`

   The two auth-fastpath migrations `20261101180543_scoped_application_read_fastpath.sql` and `20261101183410_candidate_home_site_auth_fastpath.sql` are intentionally deferred and are not part of this rollout sequence. Apply declarative schema/index/grant changes only through the separately approved schema workflow.

## Migration ledger reconciliation

The production rollout is in progress: 10 prerequisite migrations and the first 12 November application migrations have been applied, with seven migrations still in progress. Do not mark this rollout complete until the remaining application steps and final read-only verification pass.

The adapter SQL is executed only through the approved guarded Supabase `execute_sql` path. After each adapter succeeds, use guarded `execute_sql` DML against `supabase_migrations.schema_migrations` to map that exact successful receipt to its required ledger identity. Preserve the receipt's executed SQL byte-for-byte in the ledger `statements` value; do not substitute the unmodified historical migration body's SQL. Make the insert idempotent by checking the `version` first, then read back and verify the exact version, name, and statement text before continuing.

| Successful receipt | Ledger version | Ledger name |
| --- | --- | --- |
| `20261102001220_production_application_site_backfill.sql` | `20261011153944` | `production_application_site_backfill` |
| `20261102001228_production_creator_provenance_prep.sql` | `20261102001228` | `production_creator_provenance_prep` |

The creator-prep row does not satisfy the subsequent `20261015074832_candidate_profile_privacy_tabs.sql` migration; record that migration with its own successful receipt after it runs. Do not edit historical migration files. Do not use an unrestricted `supabase db push` while the two authorization fastpaths remain excluded; the two fastpath files stay intentionally deferred at the user's direction.

## Verification

Run the disposable rehearsal from the application directory with `TEMP` pointing to the writable temporary directory containing the bundled `recruitment-db-tools` dependencies:

```powershell
node scripts/rehearse-profile-contract.cjs --production-upgrades
```

The opt-in path replays the production adapters with the original Oct/Nov migration chain, excluding only the two deferred auth-fastpath migrations `20261101180543_scoped_application_read_fastpath.sql` and `20261101183410_candidate_home_site_auth_fastpath.sql`. It seeds 1,132 synthetic identities, including 94 dual-site groups (41 exact anchors and 53 unanchored), 704 validated import snapshots with the three observed batch labels, and 428 ordinary creator snapshots. It checks rejection cases, source-field/timestamp/link/audit preservation, journey counts, nullability, and authenticated admin/site-reader/viewer plus anonymous-role RLS. This is a disposable PGlite rehearsal; it does not connect to or modify either KT database.

The harness also asserts the reviewed hashes of the original historical migrations and verifies the application adapter's prefix and suffix are byte-identical around the replaced site block.
