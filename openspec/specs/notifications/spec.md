# Spec: in-app-notifications (New Capability)

## Purpose

Therapist-scoped notification records with a read/unread lifecycle, an authenticated owner-only retrieval API, and retention-based purge of read notifications, emitted into by reminder-producing and alerting capabilities.

## Requirements

### Requirement: Therapist-Scoped Persistence

Every notification MUST be persisted with an owning therapist (`userId`), a `type`, a title, a body, and an optional in-app `linkPath`, and MUST be visible or mutable only by that therapist. The emitted types are `SESSION_REMINDER` (session reminders), `GOOGLE_CALENDAR_DISCONNECTED` (Google grant revoked or expired), `PAYMENT_LATE` (a charge became overdue), `PAYMENT_ANOMALY` (the gateway reported a payment the local charge cannot represent) and `PATIENT_MISSING_SESSION_AMOUNT` (a patient auto-created by a public booking has no session amount). The enum also defines `PATIENT_DOCUMENT_REUPLOAD_REQUIRED`, which no application flow emits: it was sent once by an operations script (`backend/scripts/notify-document-reupload.ts`) as a broadcast asking therapists to re-upload lost legal documents.

#### Scenario: Notification created for the owning therapist

- GIVEN a session reminder fires for therapist A
- WHEN the notification is persisted
- THEN it is associated only with therapist A

### Requirement: Authorized, Owner-Scoped Retrieval

The retrieval API MUST require authentication (same guard convention as `patients`/`consultations` modules) and MUST return only notifications owned by the requesting therapist, newest first. The list MUST support optional pagination (`page`, `pageSize`, returning the total) and, without pagination parameters, MUST return at most a fixed safety limit. A separate endpoint MUST return the owner's unread count. The endpoints are `GET /notifications` (list), `GET /notifications/unread-count` (response `{ count }`), `PATCH /notifications/read-all` (response `{ count }` with the number of notifications updated) and `PATCH /notifications/:id/read`.

#### Scenario: Therapist B cannot see therapist A's notifications

- GIVEN therapist A has notifications and therapist B is authenticated
- WHEN therapist B calls the list endpoint
- THEN the response contains none of therapist A's notifications

#### Scenario: Unauthenticated request is rejected

- GIVEN no valid JWT is present
- WHEN the list endpoint is called
- THEN the request is rejected with 401

#### Scenario: Unread count is owner-scoped

- GIVEN therapist A has 2 unread notifications and therapist B has 5
- WHEN therapist A requests the unread count
- THEN the response is 2

### Requirement: Read/Unread Lifecycle Scoped to Owner

Notifications MUST start unread. Only the owning therapist MUST be able to mark a notification read, individually or all at once.

#### Scenario: Owner marks a notification read

- GIVEN an unread notification owned by therapist A
- WHEN therapist A marks it read
- THEN its state becomes read and persists across subsequent fetches

#### Scenario: Non-owner cannot mark it read

- GIVEN a notification owned by therapist A
- WHEN therapist B attempts to mark it read
- THEN the request is rejected with 404 and the notification remains unchanged

#### Scenario: Mark all read affects only the owner

- GIVEN therapists A and B each have unread notifications
- WHEN therapist A marks all notifications read
- THEN only A's notifications become read

### Requirement: Notification Bell in the Authenticated Layout

The authenticated layout MUST show a notification bell that polls the unread count every 30 seconds and displays a badge with the count (capped at `99+`) when it is greater than zero. Opening a notification from the list MUST mark it read when it is unread and show a detail view; when the notification has a `linkPath`, the detail view MUST offer navigation to it.

#### Scenario: Opening an unread notification marks it read

- GIVEN the bell shows unread notifications
- WHEN the therapist opens one from the list
- THEN it is marked read, its detail is shown, and the unread count is refreshed

#### Scenario: Detail with a link navigates in-app

- GIVEN an opened notification that carries a `linkPath`
- WHEN the therapist follows the link in the detail view
- THEN the detail closes and the app navigates to that path

### Requirement: Read Notification Retention

The system MUST run a daily scheduled job (04:30) that deletes notifications read more than 30 days ago (configurable through `NOTIFICATIONS_PURGE_RETENTION_DAYS`), in bounded batches (1000 rows per batch, at most 100 batches per run by default, configurable through `NOTIFICATIONS_PURGE_MAX_BATCHES`; an invalid retention value falls back to 30 days), skipping a run if the previous one is still in progress. Unread notifications MUST also be purged once more than 90 days have passed since their creation (configurable through `NOTIFICATIONS_PURGE_UNREAD_RETENTION_DAYS`; an invalid value falls back to 90 days). The job MUST be disabled only when `NOTIFICATIONS_PURGE_ENABLED` is exactly `'false'`.

#### Scenario: Old read notifications are purged, unread are kept

- GIVEN a notification read 31 days ago, a notification read yesterday, and an unread notification created 60 days ago
- WHEN the purge job runs
- THEN only the first one is deleted
