# Profile Management Specification

**Domain**: profile-management  
**Introduced by**: harden-profile-endpoint (issue #76)  
**Merged**: 2026-08-26

## Purpose

Authenticated self-service profile read/update (PATCH /profile) with step-up confirmation for credential changes, deferred email verification with old-address notification, per-user rate limiting, an audit trail, and the therapist's public and professional profile data (photo, public profile, RUT and professional registration).

## Requirements

### Requirement: Step-Up Authentication for Credential Changes

The system MUST require a valid `currentPassword` in the `PATCH /profile` body whenever the request includes `email` and/or `password`. It MUST respond `400` when `currentPassword` is missing and `403` when it does not match the stored hash (verified with `argon2.verify`), in both cases without applying any field change. Updates that change neither `email` nor `password` (name, public profile, website, RUT, professional registration) MUST succeed without `currentPassword`.

#### Scenario: Password change with correct currentPassword

- GIVEN an authenticated user with a known current password
- WHEN they `PATCH /profile` with a new `password` and correct `currentPassword`
- THEN the request succeeds (`200`) and the password is updated

#### Scenario: Email change missing currentPassword

- GIVEN an authenticated user
- WHEN they `PATCH /profile` with a new `email` and no `currentPassword`
- THEN the response is `400` and no field is changed

#### Scenario: Name-only update requires no currentPassword

- GIVEN an authenticated user
- WHEN they `PATCH /profile` with only `name`
- THEN the update succeeds without `currentPassword`

#### Scenario: Wrong currentPassword rejects the whole request

- GIVEN an authenticated user
- WHEN they `PATCH /profile` with `email` or `password` and an incorrect `currentPassword`
- THEN the response is `403` and no field, including `name`, is changed

### Requirement: Password Change Effects

A successful password change through `PATCH /profile` MUST store the new hash, set `passwordChangedAt` (invalidating every earlier session token, see `session-invalidation`), discard any pending email change, and MUST NOT return a replacement session token, so the user has to log in again. The new password MUST be between 8 and 128 characters.

#### Scenario: Old session dies after a password change

- GIVEN a user changed their password through `PATCH /profile`
- WHEN they use the token held before the change
- THEN the response is `401` and a login with the old password fails

### Requirement: Deferred Email Change via pendingEmail

The system MUST NOT replace the active `email` immediately. On a valid email-change request it MUST normalize the requested address, reject it with `409` when another account already uses it, store it in `User.pendingEmail`, leave `email` and `emailVerified` unchanged, and send a verification link to the pending address (signed single-purpose token, 24h expiry, linking to the frontend confirmation page). Only when the user opens that link, and the frontend calls the unauthenticated `POST /profile/email-change/confirm` with a valid, unexpired token that still matches the stored pending address and request timestamp, MUST the system set `email = pendingEmail`, `pendingEmail = null`, and `emailVerified = true`. A token MUST NOT be usable twice.

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
- THEN the response is `400`, `pendingEmail` and `email` remain unchanged, and the user MAY request a new email change

#### Scenario: Address taken by another account before confirmation

- GIVEN a pending email change whose address another account registered after the request
- WHEN the user confirms with a valid token
- THEN the response is `409` and `email` remains unchanged

#### Scenario: Reused token is rejected

- GIVEN a pending email change that was already confirmed
- WHEN the same token is submitted again
- THEN the response is `400` and nothing changes

#### Scenario: Address already in use

- GIVEN another account already uses the requested address
- WHEN the user requests the change
- THEN the response is `409` and no pending change is stored

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

The system MUST apply a dedicated named throttler (`profile-update`) on `PATCH /profile` and on the avatar upload and delete endpoints, keyed by the authenticated user's ID, not by IP address, and MUST respond `429` once the limit is exceeded regardless of `currentPassword` correctness. Email-change confirmation MUST use its own separate limiter.

#### Scenario: Repeated attempts from one user are throttled

- GIVEN an authenticated user exceeds the configured attempt window
- WHEN they issue another `PATCH /profile` request
- THEN the response is `429`

#### Scenario: Throttling is per user, not shared across users

- GIVEN user A has exhausted their throttle window
- WHEN user B issues a `PATCH /profile` request
- THEN user B's request is evaluated independently and is not throttled

### Requirement: Audit Logging for Credential Changes

The system MUST record a distinguishable `AuditLog` row per credential change, with `resourceId = user.id` and never secret values: `PASSWORD_CHANGED` on a successful password update, `EMAIL_CHANGE_REQUESTED` when `pendingEmail` is set, and `EMAIL_CHANGE_CONFIRMED` when the pending email is confirmed and activated.

#### Scenario: Password change is audited

- GIVEN a successful password update via `PATCH /profile`
- WHEN the update commits
- THEN an audit row with `action: PASSWORD_CHANGED` and `resourceId: user.id` exists, containing no plaintext password

#### Scenario: Email change lifecycle is audited at both steps

- GIVEN a user requests then confirms an email change
- WHEN each step completes
- THEN one `EMAIL_CHANGE_REQUESTED` row and, on confirmation, one `EMAIL_CHANGE_CONFIRMED` row exist, both scoped to `resourceId: user.id`

### Requirement: Optional Public Website on the Therapist Profile

`GET /profile` MUST include `website` (nullable). `PATCH /profile` MUST accept an optional `website` that is an `http` or `https` URL of at most 200 characters; an empty string MUST clear it (stored as null). Any other scheme or an overlong value MUST be rejected with `400` without applying any field change. Updating `website` MUST NOT require `currentPassword`. The value is public: it is exposed by the unauthenticated public therapist profile endpoint.

#### Scenario: Valid website is saved

- GIVEN an authenticated therapist
- WHEN they send `PATCH /profile` with `website: "https://example.com"` and no `currentPassword`
- THEN the request succeeds and `GET /profile` returns that `website`

#### Scenario: Non-http(s) website is rejected

- GIVEN an authenticated therapist
- WHEN they send `PATCH /profile` with `website: "javascript:alert(1)"`
- THEN the response is `400` and the stored `website` is unchanged

#### Scenario: Empty string clears the website

- GIVEN a therapist with a stored `website`
- WHEN they send `PATCH /profile` with `website: ""`
- THEN `GET /profile` returns `website: null`

### Requirement: Public Profile Fields and Slug

`PATCH /profile` MUST accept an optional `bio` (at most 500 characters) and `specialty` (at most 120 characters); an empty string MUST clear them. `GET /profile` MUST return `id`, `email`, `name`, `mfaEnabled`, `createdAt`, `pendingEmail`, `avatarUpdatedAt`, `bio`, `specialty`, `website`, `rut`, `professionalRegistration`, `slug`, and `canInvite` (true only for the account whose email equals the configured `INVITE_CREATOR_EMAIL`). When the `name` changes (or the account has no slug yet), the system MUST regenerate the public `slug` from the name, ensuring uniqueness; the previous public link MUST stop resolving.

#### Scenario: Name change regenerates the public link

- GIVEN a therapist with the slug `ana-perez`
- WHEN they change their name to `Ana Soto`
- THEN their slug becomes `ana-soto` (with a numeric suffix if already taken) and the previous slug no longer resolves

### Requirement: Professional Data for Discharge Reports

`PATCH /profile` MUST accept an optional `rut`, validated for format and check digit and stored in canonical normalized form (an empty string clears it), and an optional `professionalRegistration` of at most 50 characters without control characters (an empty string clears it). An invalid RUT or an overlong registration MUST be rejected with `400` without applying any change. Neither requires `currentPassword`. These values are private: they MUST NOT be exposed by the public therapist profile.

#### Scenario: Invalid RUT is rejected

- GIVEN an authenticated therapist
- WHEN they send `PATCH /profile` with a RUT whose check digit is wrong
- THEN the response is `400` and the stored RUT is unchanged

#### Scenario: RUT is stored normalized

- GIVEN an authenticated therapist
- WHEN they send a valid RUT with dots and a lowercase check digit
- THEN `GET /profile` returns it in the canonical normalized form

### Requirement: Profile Photo

The system MUST let the authenticated therapist upload a profile photo (`POST /profile/avatar`, field `file`), accepting only JPEG, PNG, WEBP or GIF up to 5 MB, validating the real file content against the declared type, and storing it in the dedicated object storage bucket under a fixed per-user key (a new upload replaces the previous photo). The therapist MUST be able to read their own photo (`GET /profile/avatar`, `404` when none) and delete it (`DELETE /profile/avatar`, idempotent). The photo MUST be exposed publicly only through the public therapist avatar endpoint when set.

#### Scenario: Upload with mismatched content is rejected

- GIVEN a file declared as `image/png` whose content is not a PNG
- WHEN the therapist uploads it
- THEN the request is rejected and no photo is stored

#### Scenario: Deleting twice succeeds

- GIVEN a therapist whose photo was already removed
- WHEN they delete it again
- THEN the response is successful and the profile reports no photo

### Requirement: MFA Security History

`GET /profile/mfa-history` MUST return, for the authenticated user only, the last 20 audit entries of types `MFA_ENABLED`, `MFA_DISABLED`, `MFA_DISABLED_VIA_RECOVERY` and `MFA_RECOVERY_CODES_GENERATED`, newest first, with action, time, IP address and user agent.

#### Scenario: History is limited to the owner

- GIVEN users A and B each enabled MFA
- WHEN user A requests the history
- THEN only A's entries are returned
