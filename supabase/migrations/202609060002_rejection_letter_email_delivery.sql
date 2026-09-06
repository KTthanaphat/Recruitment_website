-- Rejection letters are now sent immediately from the shared HR mailbox.
-- Keep historical Outlook-draft records unchanged for an accurate audit trail.
alter table public.rejection_letter_drafts
  drop constraint if exists rejection_letter_drafts_status_check;

alter table public.rejection_letter_drafts
  add constraint rejection_letter_drafts_status_check
  check (status in ('creating', 'draft_created', 'sending', 'sent', 'failed'));
