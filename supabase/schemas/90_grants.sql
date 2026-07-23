-- Canonical declarative schema source. Edit this file set, not historical migrations.

grant usage on schema public to authenticated;
grant usage on schema app_private to authenticated;

grant select on public.profiles to authenticated;
grant select on public.requisitions to authenticated;
grant select on public.requisition_logs to authenticated;
grant select on public.position_groups to authenticated;
grant select on public.document_groups to authenticated;
grant select on public.candidates to authenticated;
grant select on public.recruitment_logs to authenticated;
grant select on public.offers to authenticated;
grant select on public.sourcing_weekly_updates to authenticated;
grant select on public.vacancy_weekly_snapshots to authenticated;
grant select on public.change_logs to authenticated;

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
revoke all on function public.app_unmatch_group_requisition(jsonb) from public, anon, authenticated;
grant execute on function public.app_unmatch_group_requisition(jsonb) to authenticated;
revoke all on function public.app_delete_recruitment_record(jsonb) from public, anon, authenticated;
grant execute on function public.app_delete_recruitment_record(jsonb) to authenticated;
revoke all on function public.app_upsert_sourcing_weekly_update(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_sourcing_weekly_update(jsonb) to authenticated;
revoke all on function public.app_upsert_candidate(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_candidate(jsonb) to authenticated;
revoke all on function public.app_insert_recruitment_log(jsonb) from public, anon, authenticated;
grant execute on function public.app_insert_recruitment_log(jsonb) to authenticated;
revoke all on function public.app_insert_pipeline_passes(jsonb) from public, anon, authenticated;
grant execute on function public.app_insert_pipeline_passes(jsonb) to authenticated;
revoke all on function public.app_insert_test_maintenance(jsonb) from public, anon, authenticated;
grant execute on function public.app_insert_test_maintenance(jsonb) to authenticated;
revoke all on function public.app_insert_pipeline_test_exit(jsonb) from public, anon, authenticated;
grant execute on function public.app_insert_pipeline_test_exit(jsonb) to authenticated;
revoke all on function public.app_upsert_offer(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_offer(jsonb) to authenticated;
revoke all on function public.app_upsert_vacancy_weekly_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.app_upsert_vacancy_weekly_snapshot(jsonb) to authenticated;
