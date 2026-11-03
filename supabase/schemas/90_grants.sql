-- Canonical declarative schema source. Edit this file set, not historical migrations.

grant usage on schema public to authenticated;
grant usage on schema app_private to authenticated;

grant select on public.profiles to authenticated;
grant select on public.requisitions to authenticated;
grant select on public.requisition_logs to authenticated;
grant select on public.position_groups to authenticated;
grant select on public.document_groups to authenticated;
grant select on public.candidates to authenticated;
grant select on public.candidate_requisitions to authenticated;
grant select on public.candidate_references to authenticated;
grant select on public.candidate_reference_checks to authenticated;
grant select on public.recruitment_logs to authenticated;
grant select, insert, update on public.rejection_reasons to authenticated;
grant select on public.offers to authenticated;
grant select on public.sourcing_weekly_updates to authenticated;
grant select on public.vacancy_weekly_snapshots to authenticated;
grant select on public.change_logs to authenticated;
grant select on public.rejection_letter_templates to authenticated;
grant select on public.rejection_letter_drafts to authenticated;
grant select on public.interview_invitation_templates to authenticated;
grant select on public.interview_meetings to authenticated;

alter table public.candidate_references enable row level security;
alter table public.candidate_reference_checks enable row level security;
drop policy if exists candidate_references_scoped_read on public.candidate_references;
create policy candidate_references_scoped_read on public.candidate_references
for select to authenticated
using ((select app_private.can_read_candidate(candidate_id)));
drop policy if exists candidate_reference_checks_scoped_read on public.candidate_reference_checks;
create policy candidate_reference_checks_scoped_read on public.candidate_reference_checks
for select to authenticated
using (
  exists (
    select 1 from public.candidate_references reference
    where reference.reference_id = candidate_reference_checks.reference_id
      and (select app_private.can_read_application(candidate_reference_checks.application_id))
  )
);

revoke all on all functions in schema app_private from public, anon;
grant execute on all functions in schema app_private to authenticated;

revoke all on function public.app_upsert_requisition(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_requisition(jsonb) to authenticated;
revoke all on function public.app_insert_requisition_log(jsonb) from public, anon, authenticated;
grant execute on function public.app_insert_requisition_log(jsonb) to authenticated;
revoke all on function public.app_upsert_position_group(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_position_group(jsonb) to authenticated;
revoke all on function public.app_create_group_match(jsonb) from public, anon, authenticated;
grant execute on function public.app_create_group_match(jsonb) to authenticated;
revoke all on function public.app_create_and_match_sourcing_group(jsonb) from public, anon, authenticated;
grant execute on function public.app_create_and_match_sourcing_group(jsonb) to authenticated;
revoke all on function public.app_unmatch_group_requisition(jsonb) from public, anon, authenticated;
grant execute on function public.app_unmatch_group_requisition(jsonb) to authenticated;
revoke all on function public.app_delete_recruitment_record(jsonb) from public, anon, authenticated;
grant execute on function public.app_delete_recruitment_record(jsonb) to authenticated;
revoke all on function public.app_upsert_sourcing_weekly_update(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_sourcing_weekly_update(jsonb) to authenticated;
revoke all on function public.app_upsert_candidate(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_candidate(jsonb) to authenticated;
revoke all on function public.app_upsert_candidate_reference_v1(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_candidate_reference_v1(jsonb) to authenticated;
revoke all on function public.app_set_candidate_reference_status_v1(jsonb) from public, anon, authenticated;
grant execute on function public.app_set_candidate_reference_status_v1(jsonb) to authenticated;
revoke all on function public.app_save_candidate_reference_check_v1(jsonb) from public, anon, authenticated;
grant execute on function public.app_save_candidate_reference_check_v1(jsonb) to authenticated;
revoke all on function public.app_start_pipeline_stage_v2(jsonb) from public, anon, authenticated;
grant execute on function public.app_start_pipeline_stage_v2(jsonb) to authenticated;
revoke all on function public.app_upsert_offer(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_offer(jsonb) to authenticated;
revoke all on function public.app_upsert_vacancy_weekly_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_vacancy_weekly_snapshot(jsonb) to authenticated;

revoke all on function public.app_set_requisition_priority_v1(jsonb) from public, anon, authenticated;
grant execute on function public.app_set_requisition_priority_v1(jsonb) to authenticated;
revoke all on function public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.app_recruitment_list_v1(text,text,jsonb,text,text,integer,jsonb,text,boolean,boolean) to authenticated;
revoke all on function public.app_recruitment_list_count_v1(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.app_recruitment_list_count_v1(text,text,jsonb) to authenticated;
revoke all on function public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_history_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_candidate_profile_detail_v1(text), public.app_pipeline_summary_v1(jsonb,text,date,integer) from public, anon, authenticated;
grant execute on function public.app_recruitment_applications_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_history_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_candidate_profile_detail_v1(text), public.app_pipeline_summary_v1(jsonb,text,date,integer) to authenticated;
revoke all on function public.app_recruitment_requisitions_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.app_recruitment_requisitions_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) to authenticated;
revoke all on function public.app_recruitment_groups_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_sourcing_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_offers_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_audit_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) from public, anon, authenticated;
grant execute on function public.app_recruitment_groups_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_sourcing_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_offers_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean), public.app_recruitment_audit_page_v1(text,jsonb,text,text,integer,jsonb,text,boolean,boolean) to authenticated;

revoke all on function public.app_dashboard_bottleneck_summary_v1(date,date,date,date,jsonb,text,date[]), public.app_dashboard_bottleneck_queue_v1(date,jsonb,text,text,text,text,text,text,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.app_dashboard_bottleneck_summary_v1(date,date,date,date,jsonb,text,date[]), public.app_dashboard_bottleneck_queue_v1(date,jsonb,text,text,text,text,text,text,text,text,text,integer) to authenticated;
-- Legacy writes remain authenticated RPCs with explicit application resolution.
revoke all on function public.app_insert_pipeline_passes(jsonb), public.app_insert_pipeline_test_exit(jsonb), public.app_insert_recruitment_log(jsonb), public.app_insert_test_maintenance(jsonb) from public, anon;
grant execute on function public.app_insert_pipeline_passes(jsonb), public.app_insert_pipeline_test_exit(jsonb), public.app_insert_recruitment_log(jsonb), public.app_insert_test_maintenance(jsonb) to authenticated;

-- Trigger-only internal ledger maintenance is never callable by API users.
revoke all on function app_private.claim_candidate_application_group() from public,anon,authenticated;
revoke all on function public.app_home_welcome_summary_v1(), public.app_home_banner_summary_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_home_welcome_summary_v1(), public.app_home_banner_summary_v1(jsonb) to authenticated;

-- Essential Home metrics are an additive authenticated invoker RPC.
revoke all on function public.app_home_core_summary_v1(jsonb) from public,anon,authenticated;
grant execute on function public.app_home_core_summary_v1(jsonb) to authenticated;
