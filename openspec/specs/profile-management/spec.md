# Profile Management Specification

**Domain**: profile-management  
**Introduced by**: harden-profile-endpoint (issue #76)  
**Merged**: 2026-08-26

## Purpose

Authenticated self-service profile read/update (PATCH /profile) with step-up confirmation for credential changes, deferred email verification with old-address notification, per-user rate limiting, and an audit trail.

## Requirements

### Requirement: Step-Up Authentication for Credential Changes

The system MUST require a valid `currentPassword` in the `PATCH /profile` body whenever the request includes `email` and/or `password`. It MUST verify `currentPassword` with `argon2.verify` against the stored hash and MUST respond `401` when it is missing or does not match, without applying any field change. Name-only updates MUST succeed without `currentPassword`.

#### Scenario: Password change with correct currentPassword

- GIVEN an authenticated user with a known current password
- WHEN they `PATCH /profile` with a new `password` and correct `currentPassword`
- THEN the request succeeds (`200`) and the password is updated

#### Scenario: Email change missing currentPassword

- GIVEN an authenticated user
- WHEN they `PATCH /profile` with a new `email` and no `currentPassword`
- THEN the response is `401` and no field is changed

#### Scenario: Name-only update requires no currentPassword

- GIVEN an authenticated user
- WHEN they `PATCH /profile` with only `name`
- THEN the update succeeds without `currentPassword`

#### Scenario: Wrong currentPassword rejects the whole request

- GIVEN an authenticated user
- WHEN they `PATCH /profile` with `email` or `password` and an incorrect `currentPassword`
- THEN the response is `401` and no field, including `name`, is changed

### Requirement: Deferred Email Change via pendingEmail

The system MUST NOT replace the active `email` immediately. On a valid email-change request it MUST store the requested address in `User.pendingEmail`, leave `email` and `emailVerified` unchanged, and send a verification link to the pending address (reusing the resend-verification signed-token mechanism, 24h expiry). Only when the user opens that link with a valid, unexpired token MUST the system set `email = pendingEmail`, `pendingEmail = null`, and `emailVerified = true`.

#### Scenario: Email change request does not swap the login email

- GIVEN a user with a verified email
- WHEN they `PATCH /profile` with a new `email` and correct `currentPassword`
- THEN `pendingEmail` stores the new address, `email` is unchanged, and a verification link is sent to the pending address

#### Scenario: Confirming the pending email activates it

- GIVEN a user with a pending email change and a valid verification token
- WHEN they open the verification link
- THEN `email` becomes the previously pending address, `pendingEmail` is cleared, and `emailVerified` is `true`

#### Scenario: Expired or invalid token does not activate the pending email

- GIVEN a pending email change
- WHEN the confirmation token is invalid or expired
- THEN `pendingEmail` and `email` remain unchanged and the user MAY request a new email change

### Requirement: Old-Email Notification

The system MUST send an informational notification to the CURRENT active email address whenever a new email-change request is accepted, independent of and not blocking the verification flow on the new address.

#### Scenario: Old address is notified of a pending change

- GIVEN a user requests an email change
- WHEN the request is accepted and `pendingEmail` is set
- THEN a notification is sent to the current active email stating the account requested a change to a new address

### Requirement: Superseding a Pending Email Change

WHEN a new email-change request arrives while one is already pending, the system MUST discard the previous pending token and `pendingEmail` value, store the newest requested address, send a fresh verification link to the newest address, and send a fresh old-email notification to the current active email (not to the previously pending address).

#### Scenario: Second request supersedes the first

- GIVEN a user with a pending email change to address A
- WHEN they submit a second valid request for address B
- THEN `pendingEmail` becomes B, the token for A is no longer valid, and a new notification goes to the current active email

### Requirement: Rate Limiting Keyed by User ID

The system MUST apply a dedicated named throttler on `PATCH /profile` keyed by the authenticated user's ID, not by IP address, and MUST respond `429` once the limit is exceeded regardless of `currentPassword` correctness.

#### Scenario: Repeated attempts from one user are throttled

- GIVEN an authenticated user exceeds the configured attempt window
- WHEN they issue another `PATCH /profile` request
- THEN the response is `429`

#### Scenario: Throttling is per user, not shared across users

- GIVEN user A has exhausted their throttle window
- WHEN user B issues a `PATCH /profile` request
- THEN user B's request is evaluated independently and is not throttled

### Requirement: Audit Logging for Credential Changes

The system MUST record a distinguishable `AuditLog` row per credential change, with `resourceId = user.id` and field names only, never secret values: `PASSWORD_CHANGED` on a successful password update, `EMAIL_CHANGE_REQUESTED` when `pendingEmail` is set, and `EMAIL_CHANGE_CONFIRMED` when the pending email is confirmed and activated.

#### Scenario: Password change is audited

- GIVEN a successful password update via `PATCH /profile`
- WHEN the update commits
- THEN an audit row with `action: PASSWORD_CHANGED` and `resourceId: user.id` exists, containing no plaintext password

#### Scenario: Email change lifecycle is audited at both steps

- GIVEN a user requests then confirms an email change
- WHEN each step completes
- THEN one `EMAIL_CHANGE_REQUESTED` row and, on confirmation, one `EMAIL_CHANGE_CONFIRMED` row exist, both scoped to `resourceId: user.id`
