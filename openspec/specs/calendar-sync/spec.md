# calendar-sync Specification

## Purpose

Google Calendar integration for therapists: OAuth lifecycle, encrypted token custody, push-only propagation keyed by `Consultation.groupId`, minimized content, periodic reconciliation with bounded backfill, and degraded-connection handling.

## Requirements

### Requirement: OAuth Connection Lifecycle

The system MUST let a therapist connect their Google account via OAuth 2.0 authorization-code flow requesting only `calendar.events` with `access_type=offline`, and MUST let them disconnect anytime. Connection is account-level, never per session. The authorization `state` MUST be a signed, single-use token valid for 10 minutes and bound to the therapist; a callback with a missing, tampered, expired or already used `state`, or without a refresh token from Google, MUST NOT create or change a connection. Connecting and disconnecting MUST be audited (`CALENDAR_CONNECTED`, `CALENDAR_DISCONNECTED`). When `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` is not configured, starting the authorization MUST fail with `503`.

#### Scenario: Therapist connects Google account

- GIVEN no active Google connection
- WHEN OAuth consent completes for `calendar.events` offline access
- THEN Umbral stores the connection as active and requests no other scope

#### Scenario: Reused or forged state is rejected

- GIVEN a callback whose `state` was already consumed or whose signature is invalid
- WHEN the callback is processed
- THEN no connection is created or modified and the browser is redirected with an error indicator

#### Scenario: Therapist disconnects Google account

- GIVEN an active Google connection
- WHEN the therapist disconnects
- THEN Umbral revokes the token in Google on a best-effort basis, deletes the stored token, marks the connection inactive, and removes the therapist's cached busy blocks

#### Scenario: Disconnect without an active connection

- GIVEN a therapist whose connection is not active
- WHEN they request to disconnect
- THEN the response is `404`

### Requirement: Calendar Integration Endpoints

The backend MUST expose, under `/calendar-integration`: `GET /status` and `POST /authorize` and `POST /disconnect`, all requiring an authenticated session (JWT), and `GET /callback`, which is unauthenticated because Google redirects the browser there without an `Authorization` header (identity travels only in the signed `state`). `GET /status` MUST return `status`, `googleAccountEmail`, `connectedAt`, `lastSyncAt`, `lastError`, `failedEvents` (links in `FAILED` state of an active connection) and `busySyncFailed` (whether the last busy refresh failed, without its error text); for a therapist with no connection it MUST return `status: 'PENDING'`, `failedEvents: 0`, `busySyncFailed: false` and the remaining fields as `null`. `POST /authorize` MUST return `{ url }` with the Google consent URL (`access_type=offline`, `prompt=consent`, only the `calendar.events` scope), and MUST answer `409` with the message "Desconecta Google Calendar antes de volver a conectarlo" when the connection is already active, without issuing a `state` or touching the stored token: reconnecting over an active connection would overwrite the refresh token without revoking the previous one, and disconnecting is what revokes it. Links between consultations and events MUST record a sync state of `SYNCED` or `FAILED`.

#### Scenario: Status without a connection

- GIVEN a therapist who never started the connection
- WHEN `GET /calendar-integration/status` is called
- THEN the response has `status: 'PENDING'`, `failedEvents: 0`, `busySyncFailed: false` and `googleAccountEmail`, `connectedAt`, `lastSyncAt` and `lastError` as `null`

#### Scenario: Authorize returns the consent URL

- GIVEN the Google client credentials are configured
- WHEN an authenticated therapist calls `POST /calendar-integration/authorize`
- THEN the response is `{ url }` pointing to Google's consent screen with offline access and forced consent

#### Scenario: Authorize with an active connection

- GIVEN a therapist whose connection is active
- WHEN they call `POST /calendar-integration/authorize`
- THEN the response is `409`, no `state` or cookie is issued, and the stored token and connection are unchanged

### Requirement: Encrypted Token Custody

The system MUST encrypt the refresh token with AES-256-GCM before persisting it, using a dedicated key (`GOOGLE_TOKEN_ENCRYPTION_KEY`, never shared with the document encryption key) managed through the versioned keyring (`..._KEYRING`, `..._ACTIVE_KEY_ID`). New ciphertexts MUST be written with the active key in the authenticated format that binds the key id and dataset label, and decryption MUST also accept legacy payloads. The token MUST NOT be stored or exposed as plaintext.

#### Scenario: Refresh token stored encrypted

- GIVEN OAuth connect completes
- WHEN the refresh token is persisted
- THEN it is stored as AES-256-GCM ciphertext produced with the active key of the keyring

#### Scenario: Token decrypted only for use

- GIVEN an active connection
- WHEN Umbral calls the Google Calendar API
- THEN the token is decrypted in memory only, never logged

### Requirement: Push-Only Event Propagation Keyed by groupId

The system MUST push consultation changes to Google Calendar one-directionally, matched by `Consultation.groupId` through a per-connection event link, and MUST NOT let a Google-side edit mutate `Consultation`. Sync MUST be skipped for consultations of soft-deleted patients and for superseded or deleted consultation versions. The push path MUST treat a consultation created by the public booking flow identically to one created by an authenticated therapist: same event creation, same `groupId` mapping, same non-blocking behavior. The only real deletion triggers are soft-deleting the patient and closing the treatment with a discharge report, which cancels the patient's future consultations; both MUST delete the mapped future events and their mappings. The whole sync MUST be disabled only when `GOOGLE_CALENDAR_SYNC_ENABLED` is exactly `'false'`.

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

#### Scenario: Discharge closure removes the cancelled events

- GIVEN a patient with future consultations mapped to Google events
- WHEN the therapist closes the treatment and those consultations are cancelled
- THEN Umbral deletes the events of exactly the cancelled consultations and removes their mappings, without delaying or failing the closure

#### Scenario: Publicly booked consultation pushes a new event

- GIVEN a therapist has an active Google connection
- WHEN a patient books a slot through the public scheduling flow and a consultation is created
- THEN Umbral creates a Google event mapped by `groupId`, same as a therapist-created consultation

#### Scenario: Public booking sync failure does not block the booking

- GIVEN the Google Calendar API is unavailable
- WHEN a public booking request creates a consultation
- THEN the booking succeeds and the sync failure is only logged, consistent with non-blocking sync failures

#### Scenario: Event deleted manually in Google is recreated

- GIVEN a mapped event that was deleted in Google (Google answers 404 or 410 on update)
- WHEN the next sync of that consultation runs
- THEN Umbral discards the stale mapping and creates a new event

### Requirement: Content Minimization

Every synced event MUST contain only the patient's initials, a non-reversible short code derived from the patient identifier (never `rut` or the full name), a generic title, the session time, and a fixed generic description that points the therapist to Umbral. The event MUST NOT contain the full name, RUT, `sessionType`, clinical text, any patient or consultation identifier, or any link. Its duration MUST be the consultation's own `durationMinutes`.

#### Scenario: Minimized event content

- GIVEN a consultation is pushed to Google Calendar
- WHEN the event is created or updated
- THEN it contains only initials, the short code, the session time and the fixed generic description, with no identifiers and no link

#### Scenario: sessionType excluded

- GIVEN a consultation has `sessionType` set
- WHEN the event is built
- THEN `sessionType` does not appear anywhere in it

### Requirement: Periodic Reconciliation and Bounded Backfill

A scheduled reconciler MUST run every 15 minutes over every active (`CONNECTED`) connection and, in this order, MUST: (1) retry links left in `FAILED` state, (2) delete events whose consultation or patient was removed, (3) repair events whose `sessionDate` drifted from the link, and (4) backfill non-deleted future consultations without a link that fall inside a 90-day window from now. Backfill MUST NOT push consultations outside that window; the window MUST NOT govern deletion or patching of events already linked. The reconciler MUST page through all rows (pages of 200, at most 50 pages per method per connection per run) and MUST NOT overlap with a previous run still in progress. Backfill therefore happens on the first reconciler run after a connection becomes active, not synchronously at connect time.

#### Scenario: Sessions within the window are backfilled

- GIVEN future consultations inside the backfill window and a newly active connection
- WHEN the reconciler runs
- THEN each is pushed as a Google event exactly once

#### Scenario: Sessions outside the window are skipped

- GIVEN a future consultation beyond the backfill window
- WHEN the reconciler runs
- THEN no event is created for it

#### Scenario: Failed link is repaired

- GIVEN a link marked `FAILED` after a transient Google error
- WHEN the reconciler runs and Google is available
- THEN the event is pushed again and the link becomes `SYNCED`

#### Scenario: Overlapping run is skipped

- GIVEN a reconciler run is still in progress
- WHEN the next scheduled tick fires
- THEN the new run is skipped

### Requirement: Degraded Connection on Revoked or Expired Grant

When Google returns `invalid_grant` or 401, the system MUST mark the connection disconnected (reason `INVALID_GRANT`), discard the stored token, remove the therapist's cached busy blocks, record a `CALENDAR_DISCONNECTED` audit entry, MUST emit one in-app notification via the existing `notifications` capability, and MUST NOT retry or keep syncing it. The transition MUST be atomic so concurrent failures notify only once.

#### Scenario: Revoked token disconnects and notifies once

- GIVEN a connection whose token was revoked in Google
- WHEN a sync call returns `invalid_grant`
- THEN Umbral marks it disconnected and notifies the therapist once

#### Scenario: No retry loop after disconnection

- GIVEN a connection just marked disconnected
- WHEN subsequent consultation writes occur
- THEN Umbral does not sync them and does not notify again

### Requirement: Non-Blocking Sync Failures

The system MUST treat every Google Calendar sync operation as a non-blocking side effect of a consultation write. Sync failures MUST be logged and MUST NOT prevent, roll back, or delay the write. Transient Google errors (rate limit, server errors, network) MUST leave the link in `FAILED` state for the reconciler to repair.

#### Scenario: Clinical write succeeds despite Google outage

- GIVEN the Google Calendar API is unavailable
- WHEN a therapist creates, corrects, or soft-deletes a consultation
- THEN the write succeeds and the failure is only logged

### Requirement: Reconciler Cut-Off on Google Outage

The reconciler MUST abandon the rest of the current run after 5 consecutive transient Google failures (rate limit, server errors, network, timeout) with no successful Google response in between, so that an outage does not keep one run busy for hours and make the next runs skip every therapist. Any Google response other than a transient failure (success, 404, 410) MUST reset the count. A cut-off connection MUST NOT have `lastSyncAt` updated, and the next run MUST start from zero with no state carried over. Syncs triggered by consultation writes MUST NOT be cut off.

#### Scenario: Google is down during a reconciler run

- GIVEN the reconciler is repairing many links and Google fails transiently on every call
- WHEN 5 consecutive calls have failed
- THEN the reconciler stops calling Google for the rest of that run, logs one warning, and the next run tries again

#### Scenario: An isolated failure does not cut the run

- GIVEN Google fails transiently on some calls but answers successfully between failures
- WHEN fewer than 5 failures happen in a row
- THEN the reconciler processes every link

### Requirement: Known Limitation on Google Account Change

The system MUST NOT claim to detect which Google account is connected: only `calendar.events` is requested, so `googleAccountEmail` is never populated and no automatic purge of event links happens when a therapist reconnects a different Google account. Existing links keep pointing to the previous account's events. A link is discarded, and its event recreated in the new account, only when a later update of that consultation makes Google answer 404 or 410. Consultations that already have a link and do not change are not recreated, and events already created in the previous account remain there untouched.

#### Scenario: Reconnecting a different Google account

- GIVEN a therapist with synced events who disconnects and connects another Google account
- WHEN their consultations are updated and synced again
- THEN links are not purged in bulk, a stale link is replaced when Google reports its event missing, and previous events are not deleted from the old account
