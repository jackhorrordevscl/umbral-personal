# Spec: session-reminders (New Capability)

## Purpose

Detects consultations approaching `sessionDate` and dispatches therapist-facing reminders on two independent offsets and two channels, with exactly-once claiming, bounded retries and email delivery tracking.

## Requirements

### Requirement: Two-Offset Detection Window

The system MUST run a scheduled scan every 5 minutes that detects current-version, non-deleted consultations of non-deleted patients whose `sessionDate` is 24 hours or 2 hours in the future. Each offset (`H24`, `H2`) MUST be evaluated and tracked as an independent due event. The scan MUST be paginated (500 consultations per page, at most 20 pages per run).

#### Scenario: 24h offset becomes due

- GIVEN a consultation with `sessionDate` 24h from now
- WHEN the scheduled scan runs
- THEN the system dispatches the 24h-offset reminder on both channels

#### Scenario: 2h offset becomes due independently

- GIVEN the same consultation later reaches `sessionDate` - 2h
- WHEN the scan runs
- THEN the system dispatches the 2h-offset reminder as a separate delivery from the 24h one

### Requirement: Exactly-Once Delivery Per (Session, Offset, Channel)

The system MUST persist a dispatch record per (`groupId`, `sessionDate`, offset, channel) combination, protected by a unique constraint, and MUST claim that record before sending. It MUST NOT dispatch the same combination more than once, including when two scans run concurrently.

#### Scenario: Re-running the scan does not duplicate

- GIVEN the 24h/email reminder was already dispatched
- WHEN the scan runs again before the 2h offset is due
- THEN no second 24h/email send occurs, and the 2h offset is unaffected

#### Scenario: Concurrent claim loses silently

- GIVEN two scans try to claim the same (session, offset, channel) at once
- WHEN the second insert violates the unique constraint
- THEN the second scan skips that combination without sending and without failing

### Requirement: Late-Created Session Fires Immediately

If a consultation is created (or first scanned) after an offset's due time has already elapsed, the system MUST fire that offset on the next scan tick instead of skipping it. If more than one offset is simultaneously due for the same (consultation, channel) at that tick, the system MUST dispatch only the nearest offset (the smallest offset-to-session-time) and MUST record every other simultaneously-due offset as skipped (status `SKIPPED`, never dispatched later).

#### Scenario: Session created inside only the 24h window

- GIVEN a consultation created with `sessionDate` 12h from now
- WHEN the next scan tick runs
- THEN the 24h offset dispatches immediately on both channels, exactly once

#### Scenario: Session created inside both windows

- GIVEN a consultation created with `sessionDate` 1h from now
- WHEN the next scan tick runs
- THEN only the 2h offset dispatches on both channels, exactly once, and the 24h offset is recorded as skipped and never dispatched

### Requirement: Reschedule Re-Arms All Offsets

When `correct()` changes `sessionDate`, the system MUST treat both offsets as newly due relative to the new date, including offsets already dispatched for the prior date, because dispatch records are keyed by `sessionDate`.

#### Scenario: Rescheduled session resends both offsets

- GIVEN a consultation whose 24h and 2h reminders were already dispatched for the original date
- WHEN `correct()` moves `sessionDate` forward
- THEN the system re-dispatches the 24h and 2h reminders relative to the new date, each exactly once

### Requirement: Removed and Cancelled Consultations Are Excluded

The scan, and every retry of a failed or abandoned dispatch, MUST filter out consultations with `deletedAt` set, superseded versions (`correctedBy` set) and consultations of soft-deleted patients. A consultation cancelled by a treatment discharge is stored as soft-deleted, so it MUST NOT receive reminders.

#### Scenario: Deleted session is never reminded

- GIVEN a consultation soft-deleted (`deletedAt` set) with `sessionDate` 24h out
- WHEN the scan runs
- THEN no email or in-app notification is dispatched for it

#### Scenario: Session cancelled by a discharge is never reminded

- GIVEN a patient's future consultation was cancelled when their treatment was closed
- WHEN the scan runs
- THEN no reminder is dispatched for it, and a pending retry for it is not sent

#### Scenario: Deleted patient is never reminded

- GIVEN a patient is soft-deleted and has a consultation 2h out
- WHEN the scan runs
- THEN no reminder is dispatched for it

### Requirement: Email Channel Degrades Gracefully

Email dispatch MUST use a dedicated `MailService` method including the patient's full name, addressed to the therapist. If `RESEND_API_KEY` is absent or the provider returns an error, the send MUST NOT throw, MUST be logged, MUST mark that email dispatch `FAILED` with an explanatory error (the provider did not confirm the send), and MUST NOT block the in-app dispatch for the same (consultation, offset).

#### Scenario: Missing API key still yields an in-app notification

- GIVEN `RESEND_API_KEY` is not configured
- WHEN a 24h reminder becomes due
- THEN the in-app notification is created and marked `SENT`, and the email dispatch is marked `FAILED` with the attempt logged

### Requirement: Channels Dispatch Independently

The email and in-app channels MUST be dispatched and tracked independently; a failure on one MUST NOT prevent or duplicate the other. The in-app channel MUST create a `SESSION_REMINDER` notification for the therapist titled with the offset label ("24 horas" or "2 horas"), naming the patient and the session date and time in the Chile time zone, with a `linkPath` to `/consultations?patientId=<patientId>&consultationId=<consultationId>`. The webhook endpoint is `POST /webhooks/resend` and reads the Svix headers `svix-id`, `svix-timestamp` and `svix-signature`.

#### Scenario: Email send throws

- GIVEN the email provider errors during send
- WHEN dispatch runs
- THEN the in-app notification for the same (consultation, offset) is still created exactly once

### Requirement: Bounded Retry of Failed or Abandoned Dispatches

On each scan the system MUST retry dispatches that are `FAILED` for more than 5 minutes, or `PENDING` (claimed but never completed) for more than 10 minutes, up to 3 attempts in total and at most 100 per run. A retry MUST re-claim the row atomically (so only one scan retries it) and MUST be skipped when the consultation is no longer current or its `sessionDate` differs from the one recorded in the dispatch.

#### Scenario: Failed email is retried once the backoff elapses

- GIVEN an email dispatch failed 6 minutes ago with fewer than 3 attempts
- WHEN the scan runs and the session is still current and in the future
- THEN the send is retried and the dispatch is marked `SENT` on success

#### Scenario: Attempts are capped

- GIVEN an email dispatch has already used 3 attempts
- WHEN the scan runs
- THEN it is not retried again

### Requirement: Email Delivery Tracking

The system MUST expose a public webhook for Resend events that verifies the Svix signature (HMAC-SHA256 over `id.timestamp.body`, with a 5-minute timestamp tolerance) against `RESEND_WEBHOOK_SECRET` before acting, MUST respond `501` when the secret is not configured and `401` when the signature is invalid. For `email.delivered` and `email.opened` it MUST record `deliveredAt` / `openedAt` on the dispatch matching the Resend message id, writing each timestamp only once, and MUST ignore other events and unknown message ids. The latest email dispatch status and these timestamps MUST be exposed to the therapist per session (`reminderEmailStatus`).

#### Scenario: Delivered event is recorded once

- GIVEN a sent email dispatch with a stored Resend message id
- WHEN a validly signed `email.delivered` event arrives, twice
- THEN `deliveredAt` is set by the first event and not overwritten by the second

#### Scenario: Invalid signature is rejected

- GIVEN a webhook request with an invalid or stale signature, or one whose raw body is unavailable for verification
- WHEN it reaches the endpoint
- THEN the response is `401` and nothing is recorded

### Requirement: Independent Feature Flag

The system MUST disable the scan and the retries only when `REMINDERS_ENABLED` is exactly `'false'`; when absent or any other value the capability MUST be enabled.

#### Scenario: Flag off disables the scan

- GIVEN `REMINDERS_ENABLED` is `'false'`
- WHEN the scheduled scan fires
- THEN no reminder is claimed or sent
