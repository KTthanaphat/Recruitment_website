-- Only one active or successful delivery may exist for a failed stage.
create unique index if not exists uq_rejection_letter_delivery_per_failed_stage
  on public.rejection_letter_drafts(candidate_id, failed_stage_instance_id)
  where status in ('sending', 'sent');
