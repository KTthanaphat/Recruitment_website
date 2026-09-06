# Rejection Letter Outlook-Draft Contract

This integration creates Outlook drafts only. It must contain **no Send Email action**. A human reviews and sends the message from the configured shared HR mailbox.

## App to Power Automate

The server-only route `POST /api/rejection-letters/draft` calls the HTTP-trigger flow with `x-rejection-letter-secret` and `{ draft_id, shared_mailbox, recipient_email, subject, html_body, language, candidate_id, failed_stage }`. The flow must return `{ ok: true, outlook_draft_id, flow_run_id? }` after creating the draft, or `{ ok: false, error }`.

Required server-only variables: `POWER_AUTOMATE_REJECTION_LETTER_WEBHOOK_URL`, `POWER_AUTOMATE_REJECTION_LETTER_WEBHOOK_SECRET`, and `POWER_AUTOMATE_REJECTION_LETTER_SHARED_MAILBOX`.

## Template variables

`$candidate_name`, `$candidate_email`, `$failed_stage`, `$failed_outcome_date`, `$position_group`, `$site`, `$recruiter_name`, `$current_date`; use `$$` for a literal dollar sign. Templates and rendered drafts are plain text; the server escapes text before sending `html_body`.

## Operational checks

1. Create a test candidate draft and confirm it appears in shared Outlook Drafts.
2. Confirm no recipient receives mail until a human sends the draft in Outlook.
3. Confirm the flow rejects invalid secret values and returns a stable failure response.
