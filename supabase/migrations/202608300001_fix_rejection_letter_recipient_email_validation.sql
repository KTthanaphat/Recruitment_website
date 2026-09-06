-- The original expression used a double-escaped dot and rejected valid addresses.
alter table public.rejection_letter_drafts
  drop constraint if exists rejection_letter_drafts_recipient_email_check;
alter table public.rejection_letter_drafts
  add constraint rejection_letter_drafts_recipient_email_check
  check (recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
