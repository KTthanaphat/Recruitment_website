# Rejection Letter Delivery Contract

This integration sends the approved rejection letter from the configured shared HR mailbox. The flow must use an Outlook send-email action and must not leave the message as a draft.

## App to Power Automate

The server-only route `POST /api/rejection-letters/draft` calls the HTTP-trigger flow with `x-rejection-letter-secret` and `{ draft_id, shared_mailbox, recipient_email, subject, html_body, language, candidate_id, failed_stage }`. The flow must return `{ ok: true, outlook_message_id, flow_run_id? }` after Outlook accepts the message for delivery, or `{ ok: false, error }`.

Required server-only variables: `POWER_AUTOMATE_REJECTION_LETTER_WEBHOOK_URL`, `POWER_AUTOMATE_REJECTION_LETTER_WEBHOOK_SECRET`, and `POWER_AUTOMATE_REJECTION_LETTER_SHARED_MAILBOX`.

## Template variables

Current variables use braces: `{candidate_name}`, `{candidate_email}`, `{failed_stage}`, `{failed_outcome_date}`, `{position_group}`, `{site}`, `{recruiter_name}`, `{current_date}`. Legacy `$variable` syntax is normalized for saved-template compatibility. [rejection-letter.ts](../src/lib/rejection-letter.ts) owns normalization, validation and HTML escaping; do not infer a `$$` escape convention. Templates and rendered content are plain text; the server escapes text before sending `html_body`.

The route and database retain historical `draft` names, but current delivery states include `sending` and `sent`. The outgoing `failed_stage` field currently contains the failed stage-instance ID. [The server route](../src/app/api/rejection-letters/draft/route.ts) owns duplicate-send rejection and payload construction.

## Operational checks

1. Send a test candidate letter and confirm that it arrives from the shared HR mailbox.
2. Confirm that the recipient, subject, and HTML body match the approved content.
3. Confirm the flow rejects invalid secret values and returns a stable failure response.
