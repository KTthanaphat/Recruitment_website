-- Canonical declarative schema source. Edit this file set, not historical migrations.

create index if not exists idx_profiles_role_site on public.profiles(role, site);
create index if not exists idx_requisitions_status_site_owner on public.requisitions(status, site, person_in_charge);
create index if not exists idx_requisitions_request_type_date on public.requisitions(request_type, pr_approved_date);
create index if not exists idx_requisition_logs_doc_date on public.requisition_logs(doc_id, log_date desc);
create index if not exists idx_position_groups_position on public.position_groups(group_position);
create index if not exists idx_document_groups_doc_id on public.document_groups(doc_id);
create index if not exists idx_document_groups_group_id on public.document_groups(group_id);
create index if not exists idx_candidates_doc_group_id on public.candidates(doc_group_id);
create index if not exists idx_recruitment_logs_candidate_latest on public.recruitment_logs(candidate_id, log_id desc);
create index if not exists idx_recruitment_logs_stage_result_date on public.recruitment_logs(recruitment_process, result, log_date desc);
create index if not exists idx_offers_candidate_id on public.offers(candidate_id);
create index if not exists idx_offers_doc_accepted on public.offers(doc_id, accepted_date) where accepted_date is not null;
create index if not exists idx_sourcing_weekly_updates_week on public.sourcing_weekly_updates(week_start);
create index if not exists idx_vacancy_weekly_snapshots_week_site on public.vacancy_weekly_snapshots(week_start, site);
create index if not exists idx_change_logs_entity on public.change_logs(entity, entity_id);
create index if not exists idx_change_logs_changed_at on public.change_logs(changed_at desc);
create index if not exists idx_sourcing_weekly_updates_updated_by on public.sourcing_weekly_updates(updated_by) where updated_by is not null;
create index if not exists idx_vacancy_weekly_snapshots_updated_by on public.vacancy_weekly_snapshots(updated_by) where updated_by is not null;
create index if not exists idx_change_logs_changed_by on public.change_logs(changed_by) where changed_by is not null;
