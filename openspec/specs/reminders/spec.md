# Spec: session-reminders (New Capability)

## Purpose

Detects consultations approaching `sessionDate` and dispatches therapist-facing reminders on two independent offsets and two channels, with exactly-once delivery guarantees.

## Requirements

### Requirement: Two-Offset Detection Window

The system MUST detect non-deleted consultations whose `sessionDate` is 24 hours or 2 hours in the future. Each offset MUST be evaluated and tracked as an independent due event.

#### Scenario: 24h offset becomes due

- GIVEN a consultation with `sessionDate` 24h from now
- WHEN the scheduled scan runs
- THEN the system dispatches the 24h-offset reminder on both channels

#### Scenario: 2h offset becomes due independently

- GIVEN the same consultation later reaches `sessionDate` - 2h
- WHEN the scan runs
- THEN the system dispatches the 2h-offset reminder as a separate delivery from the 24h one

### Requirement: Exactly-Once Delivery Per (Consultation, Offset, Channel)

The system MUST persist a dispatch record per (consultation, offset, channel) triple and MUST NOT dispatch the same triple more than once.

#### Scenario: Re-running the scan does not duplicate

- GIVEN the 24h/email reminder was already dispatched
- WHEN the scan runs again before the 2h offset is due
- THEN no second 24h/email send occurs, and the 2h offset is unaffected

### Requirement: Late-Created Session Fires Immediately

If a consultation is created (or first scanned) after an offset's due time has already elapsed, the system MUST fire that offset on the next scan tick instead of skipping it. If more than one offset is simultaneously due for the same (consultation, channel) at that tick, the system MUST dispatch only the nearest offset (the smallest offset-to-session-time) and MUST record every other simultaneously-due offset as skipped (not pending, never dispatched later).

#### Scenario: Session created inside only the 24h window

- GIVEN a consultation created with `sessionDate` 12h from now
- WHEN the next scan tick runs
- THEN the 24h offset dispatches immediately on both channels, exactly once

#### Scenario: Session created inside both windows

- GIVEN a consultation created with `sessionDate` 1h from now
- WHEN the next scan tick runs
- THEN only the 2h offset dispatches on both channels, exactly once, and the 24h offset is recorded as skipped and never dispatched

### Requirement: Reschedule Re-Arms All Offsets

When `correct()` changes `sessionDate`, the system MUST treat both offsets as newly due relative to the new date, including offsets already dispatched for the prior date.

#### Scenario: Rescheduled session resends both offsets

- GIVEN a consultation whose 24h and 2h reminders were already dispatched for the original date
- WHEN `correct()` moves `sessionDate` forward
- THEN the system re-dispatches the 24h and 2h reminders relative to the new date, each exactly once

### Requirement: Soft-Deleted Consultations Are Excluded

The scan query MUST filter `deletedAt: null`, matching the existing filter pattern in `consultations.service.ts`.

#### Scenario: Deleted session is never reminded

- GIVEN a consultation soft-deleted (`deletedAt` set) with `sessionDate` 24h out
- WHEN the scan runs
- THEN no email or in-app notification is dispatched for it

### Requirement: Email Channel Degrades Gracefully

Email dispatch MUST use a dedicated `MailService` method including the patient's full name. If `RESEND_API_KEY` is absent, the send MUST be skipped and logged, MUST NOT throw, and MUST NOT block the in-app dispatch for the same (consultation, offset).

#### Scenario: Missing API key still yields an in-app notification

- GIVEN `RESEND_API_KEY` is not configured
- WHEN a 24h reminder becomes due
- THEN the in-app notification is created and marked dispatched, and the email attempt is logged as skipped

### Requirement: Channels Dispatch Independently

The email and in-app channels MUST be dispatched and tracked independently; a failure on one MUST NOT prevent or duplicate the other.

#### Scenario: Email send throws

- GIVEN the email provider errors during send
- WHEN dispatch runs
- THEN the in-app notification for the same (consultation, offset) is still created exactly once

---
