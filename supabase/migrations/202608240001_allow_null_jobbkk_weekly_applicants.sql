-- Keep JobBKK consistent with the other optional weekly applicant counts.
-- The weekly update RPC persists a blank count as NULL (unrecorded), rather
-- than inventing a zero. JobBKK was added after that convention was adopted.
alter table public.sourcing_weekly_updates
  alter column applicants_jobbkk drop not null,
  alter column applicants_jobbkk drop default;
