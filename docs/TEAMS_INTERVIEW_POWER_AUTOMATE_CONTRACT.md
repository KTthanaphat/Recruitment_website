# Teams interview Power Automate contract

The website calls one HTTP-triggered flow. Configure its trigger authentication to validate the `x-teams-meeting-secret` header against the same secret stored in Render. Do not expose this value to the browser.

## Request

Every request is JSON and includes `operation`: `create`, `reschedule`, or `cancel`.

```json
{
  "operation": "create",
  "meeting_id": "website-meeting-uuid",
  "teams_event_id": null,
  "shared_mailbox": "hr@example.com",
  "candidate_id": "C-001",
  "stage_instance_id": "pipeline-stage-uuid",
  "candidate_email": "candidate@example.com",
  "interviewer_emails": ["interviewer@example.com"],
  "starts_at": "2026-09-15T03:00:00.000Z",
  "ends_at": "2026-09-15T04:00:00.000Z",
  "stage": "HR Interview",
  "subject": "HR Interview: Candidate name",
  "note": "Optional recruiter note"
}
```

`starts_at` and `ends_at` are UTC instants chosen in `Asia/Bangkok`; use the time-zone conversion action or set the Outlook action timezone to Bangkok before creating the event.

## Flow actions

1. Validate `x-teams-meeting-secret`; return HTTP 401 or 403 with `{ "ok": false, "error": "…" }` when it does not match.
2. For **create**, use **Create event (V4)** with the shared HR mailbox/calendar. Set *Is online meeting* to Yes, provider to Teams, required attendees to the candidate plus all interviewer emails, and use `subject`, time range, and `note` from the request.
3. For **reschedule**, use **Update event (V4)** with `teams_event_id`, keeping the event online and replacing its attendees, time range, subject, and note. Outlook sends the meeting update.
4. For **cancel**, use **Delete event (V2)** or the shared-mailbox cancellation action with `teams_event_id`, so Outlook sends cancellation notices.
5. End with an HTTP Response action. The success response needs the stable Outlook event ID, Teams join URL, and the Power Automate run ID when it is available.

Create and reschedule response:

```json
{ "ok": true, "teams_event_id": "outlook-event-id", "join_url": "https://teams.microsoft.com/l/meetup-join/...", "flow_run_id": "run-id" }
```

Cancel response:

```json
{ "ok": true, "flow_run_id": "run-id" }
```

Failure response:

```json
{ "ok": false, "error": "A safe explanation for the recruiter" }
```

## Render variables

Set these server-only variables in the production service:

- `POWER_AUTOMATE_TEAMS_MEETING_WEBHOOK_URL`
- `POWER_AUTOMATE_TEAMS_MEETING_WEBHOOK_SECRET`
- `POWER_AUTOMATE_TEAMS_MEETING_SHARED_MAILBOX`
