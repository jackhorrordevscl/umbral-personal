# calendar-sync Specification

## Purpose

Google Calendar integration for therapists: OAuth lifecycle, encrypted token custody, push-only propagation keyed by `Consultation.groupId`, minimized content, bounded backfill, and degraded-connection handling.

## Requirements

### Requirement: OAuth Connection Lifecycle

The system MUST let a therapist connect their Google account via OAuth 2.0 authorization-code flow requesting only `calendar.events` with `access_type=offline`, and MUST let them disconnect anytime. Connection is account-level, never per session.

#### Scenario: Therapist connects Google account

- GIVEN no active Google connection
- WHEN OAuth consent completes for `calendar.events` offline access
- THEN Umbral stores the connection as active and requests no other scope

#### Scenario: Therapist disconnects Google account

- GIVEN an active Google connection
- WHEN the therapist disconnects
- THEN Umbral revokes the token, deletes it, and marks the connection inactive

### Requirement: Encrypted Token Custody

The system MUST encrypt the refresh token with AES-256-GCM, using the `DocumentEncryptionService` pattern, before persisting it, and MUST NOT store or expose it as plaintext.

#### Scenario: Refresh token stored encrypted

- GIVEN OAuth connect completes
- WHEN the refresh token is persisted
- THEN it is stored as AES-256-GCM ciphertext

#### Scenario: Token decrypted only for use

- GIVEN an active connection
- WHEN Umbral calls the Google Calendar API
- THEN the token is decrypted in memory only, never logged

### Requirement: Push-Only Event Propagation Keyed by groupId

The system MUST push consultation changes to Google Calendar one-directionally, matched by `Consultation.groupId`, and MUST NOT let a Google-side edit mutate `Consultation`. Since no endpoint writes `Consultation.deletedAt` today, the only real deletion trigger is soft-deleting the patient.

#### Scenario: Create pushes a new event

- GIVEN a connected therapist creates a future-dated consultation
- WHEN the consultation is persisted
- THEN Umbral creates a Google event mapped by `groupId`

#### Scenario: correct() updates the same event

- GIVEN a consultation already mapped to an event
- WHEN `correct()` changes `sessionDate`
- THEN Umbral updates the same mapped event instead of duplicating it

#### Scenario: Patient soft-delete removes future events

- GIVEN a patient with future consultations mapped to Google events
- WHEN the patient is soft-deleted
- THEN Umbral deletes every mapped future event and removes the mappings

### Requirement: Content Minimization

Every synced event MUST contain only the patient's initials, a non-reversible short code derived from `fullName` (never `rut`), a generic title, and a deep link to Umbral. The event MUST NOT contain the full name, RUT, `sessionType`, or clinical text.

#### Scenario: Minimized event content

- GIVEN a consultation is pushed to Google Calendar
- WHEN the event is created or updated
- THEN it contains only initials, the short code, and the Umbral link

#### Scenario: sessionType excluded

- GIVEN a consultation has `sessionType` set
- WHEN the event is built
- THEN `sessionType` does not appear anywhere in it

### Requirement: Bounded Backfill at Connect Time

When a therapist connects, the system MUST backfill non-deleted future consultations inside a bounded window, and MUST NOT push consultations outside it.

#### Scenario: Sessions within the window are backfilled

- GIVEN future consultations inside the backfill window
- WHEN the connection completes
- THEN each is pushed as a Google event exactly once

#### Scenario: Sessions outside the window are skipped

- GIVEN a future consultation beyond the backfill window
- WHEN the connection completes
- THEN no event is created for it

### Requirement: Degraded Connection on Revoked or Expired Grant

When Google returns `invalid_grant` or 401, the system MUST mark the connection disconnected, MUST emit one in-app notification via the existing `notifications` capability, and MUST NOT retry or keep syncing it.

#### Scenario: Revoked token disconnects and notifies once

- GIVEN a connection whose token was revoked in Google
- WHEN a sync call returns `invalid_grant`
- THEN Umbral marks it disconnected and notifies the therapist once

#### Scenario: No retry loop after disconnection

- GIVEN a connection just marked disconnected
- WHEN subsequent consultation writes occur
- THEN Umbral does not sync them and does not notify again

### Requirement: Non-Blocking Sync Failures

The system MUST treat every Google Calendar sync operation as a non-blocking side effect of a consultation write. Sync failures MUST be logged and MUST NOT prevent, roll back, or delay the write.

#### Scenario: Clinical write succeeds despite Google outage

- GIVEN the Google Calendar API is unavailable
- WHEN a therapist creates, corrects, or soft-deletes a consultation
- THEN the write succeeds and the failure is only logged
