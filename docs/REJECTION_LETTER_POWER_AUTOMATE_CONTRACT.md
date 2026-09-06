# Rejection Letter Outlook-Draft Contract

This integration sends the approved rejection letter from the configured shared HR mailbox. The flow must use an Outlook send-email action and must not leave the message as a draft.

## App to Power Automate

The server-only route `POST /api/rejection-letters/draft` calls the HTTP-trigger flow with `x-rejection-letter-secret` and `{ draft_id, shared_mailbox, recipient_email, subject, html_body, language, candidate_id, failed_stage }`. The flow must return `{ ok: true, outlook_message_id, flow_run_id? }` after Outlook accepts the message for delivery, or `{ ok: false, error }`.

Required server-only variables: `POWER_AUTOMATE_REJECTION_LETTER_WEBHOOK_URL`, `POWER_AUTOMATE_REJECTION_LETTER_WEBHOOK_SECRET`, and `POWER_AUTOMATE_REJECTION_LETTER_SHARED_MAILBOX`.

## Template variables

`$candidate_name`, `$candidate_email`, `$failed_stage`, `$failed_outcome_date`, `$position_group`, `$site`, `$recruiter_name`, `$current_date`; use `$$` for a literal dollar sign. Templates and rendered drafts are plain text; the server escapes text before sending `html_body`.

## Operational checks

1. Send a test candidate letter and confirm that it arrives from the shared HR mailbox.
2. Confirm that the recipient, subject, and HTML body match the approved content.
3. Confirm the flow rejects invalid secret values and returns a stable failure response.
