# Session Invalidation Specification

**Domain**: session-invalidation  
**Introduced by**: harden-profile-endpoint (issue #76)  
**Merged**: 2026-08-26

## Purpose

Session tokens are revocable and die on security-relevant account changes. Any password change invalidates every access token issued before that change, by comparing token issuance time against the account's last password-change timestamp, applied uniformly across `PATCH /profile`, `AuthService.resetPassword`, and the forced `mustChangePassword` flow. Every session token is also backed by a revocable `Session` row (logout, logout-all, MFA recovery), expired rows are purged periodically, and the frontend closes the local session on idle or on password change.

## Requirements

### Requirement: passwordChangedAt Tracking

The `User` model MUST have a nullable `passwordChangedAt` timestamp. The system MUST set it to the current time whenever the account password changes through `PATCH /profile`, `AuthService.resetPassword`, or the forced `mustChangePassword` completion. Each of these three operations MUST also clear any pending email change (`pendingEmail` and `pendingEmailTokenIssuedAt`). None of these operations MUST return a session token: the user obtains a new session only by authenticating again (login and MFA).

#### Scenario: Password change via PATCH /profile sets the timestamp

- GIVEN an authenticated user changes their password via `PATCH /profile`
- WHEN the update commits
- THEN `passwordChangedAt` is set to the time of the change and no new session token is returned

#### Scenario: resetPassword sets the timestamp

- GIVEN a user completes the self-service reset-password flow
- WHEN the new password is saved
- THEN `passwordChangedAt` is set to the time of the change

#### Scenario: Forced mustChangePassword completion sets the timestamp

- GIVEN a user with `mustChangePassword: true` completes the forced change
- WHEN the new password is saved
- THEN `passwordChangedAt` is set to the time of the change and the flow continues with the MFA step instead of issuing a session token

#### Scenario: A password change clears a pending email change

- GIVEN a user has a pending email change requested from a possibly stolen session
- WHEN the password is changed through any of the three flows
- THEN the pending email change is discarded

### Requirement: No Forced Logout on Deploy

The migration adding `passwordChangedAt` MUST leave it `NULL` for all existing users and MUST NOT backfill a value. `JwtStrategy.validate()` MUST treat a `NULL` `passwordChangedAt` as "no invalidation check applies" and MUST NOT reject a token on that basis alone.

#### Scenario: Pre-deploy token stays valid until the user's first change

- GIVEN an existing user whose `passwordChangedAt` is `NULL`
- WHEN they present a token issued before deploy
- THEN the token is accepted (subject to normal expiration and to the `Session` checks) because the invalidation check is skipped while `passwordChangedAt` is `NULL`

### Requirement: Token Rejection After a Password Change

Once `passwordChangedAt` is non-null, `JwtStrategy.validate()` MUST reject (`401`) any bearer token whose `iat` is less than or equal to `passwordChangedAt` truncated to whole seconds. The comparison is inclusive because `iat` has second precision and no flow issues a new token in the same instant as the password change.

#### Scenario: Token issued before a PATCH /profile password change is rejected

- GIVEN a user holds a token issued before a password change made via `PATCH /profile`
- WHEN they use that token on any subsequent authenticated request
- THEN the response is `401`

#### Scenario: Token issued after the change is accepted

- GIVEN a user changed their password and later logged in again, receiving a fresh token
- WHEN they use that fresh token
- THEN the request is accepted

#### Scenario: resetPassword invalidates tokens from every device

- GIVEN a user has active tokens on two devices and completes a self-service password reset
- WHEN either device presents its previously issued token
- THEN both are rejected `401` and each device must log in again

#### Scenario: mustChangePassword tokens are never accepted as session tokens

- GIVEN a user has not yet completed a forced `mustChangePassword` flow
- WHEN they present the special-purpose `password-change` token to a route protected by `JwtAuthGuard`
- THEN it is rejected, independent of the `passwordChangedAt` check, because any token carrying a `purpose` claim (such as `password-change`, `password-reset`, `mfa-setup` or the Google Calendar OAuth `state`) is never a valid session token

### Requirement: Revocable Sessions

Every session token MUST carry a `jti` claim backed by a `Session` row (`jti` unique, `userId`, `expiresAt`, nullable `revokedAt`, optional `ipAddress`/`userAgent`) created when the token is issued. Session tokens MUST be issued only after the MFA step completes (MFA verification, forced MFA enrollment confirmation), never directly by the password step. `JwtStrategy.validate()` MUST reject with `401` a session token that has no `jti`, whose `Session` does not exist or belongs to another user, is revoked, or is past `expiresAt`, and a token whose user does not exist or is soft-deleted. Tokens issued before this requirement shipped carry no `jti` and are rejected once (users log in again). The backend MUST deliver the session token in an `HttpOnly` cookie named `umbral_session` (`SameSite=Strict`, `Secure` in production, `path=/`, lifetime equal to the token's, 8 hours by default through `JWT_EXPIRES_IN`) set by the response that issues the token, and `JwtStrategy` MUST read the token from that cookie first and from the `Authorization: Bearer` header otherwise. The frontend MUST NOT keep the token in `localStorage` or any script-readable storage; it only keeps a non-secret `user` marker and sends requests with credentials.

#### Scenario: Session token travels in an HttpOnly cookie

- GIVEN a user completes the MFA step successfully
- WHEN the response is sent
- THEN it sets the `umbral_session` cookie as `HttpOnly` and `SameSite=Strict`, and the frontend stores no token in `localStorage`

#### Scenario: Token without jti is rejected

- GIVEN a session token signed without a `jti`
- WHEN it is presented to a route protected by `JwtAuthGuard`
- THEN it is rejected `401`

#### Scenario: Revoked or expired session is rejected

- GIVEN a valid token whose `Session` has `revokedAt` set or `expiresAt` in the past
- WHEN it is presented
- THEN it is rejected `401`

#### Scenario: Soft-deleted user is rejected

- GIVEN a valid session token of a user whose account is soft-deleted
- WHEN it is presented
- THEN it is rejected `401`

### Requirement: Logout and Logout-All

`POST /auth/logout` MUST revoke the `Session` of the token presented; `POST /auth/logout` MUST revoke the `Session` of the token presented and answer `{ message: 'Sesión cerrada' }`; `POST /auth/logout-all` MUST revoke every still-active `Session` of the authenticated user and answer `{ message: 'Sesiones cerradas', revoked: <count> }`. Both MUST require `JwtAuthGuard`, write an audit entry (`LOGOUT` and `LOGOUT_ALL` respectively) and clear the `umbral_session` cookie in the response. The frontend `logout()` MUST remain synchronous: it fires the API call best-effort and clears local state (user marker, activity mark, query cache) regardless of the outcome.

#### Scenario: Logout revokes only the current session

- GIVEN a user with two active sessions
- WHEN they call `POST /auth/logout` with the first token
- THEN the first token is rejected `401` afterwards and the second remains valid

#### Scenario: Logout-all revokes every session

- GIVEN a user with two active sessions
- WHEN they call `POST /auth/logout-all`
- THEN both tokens are rejected `401` afterwards

### Requirement: MFA Recovery Revokes Every Session

When a user disables MFA through the recovery-code flow, the system MUST revoke every still-active `Session` of that user in the same transaction that disables MFA and consumes the recovery code, so MFA is never off while earlier sessions remain valid.

#### Scenario: Recovery kills sessions opened before it

- GIVEN a user with an active session who later completes MFA recovery with a valid password and recovery code
- WHEN the old session token is presented afterwards
- THEN it is rejected `401`

### Requirement: Expired Session Purge

The system MUST run a daily scheduled job (04:00) that deletes `Session` rows whose `expiresAt` or `revokedAt` is older than a 7-day grace period, in bounded batches, skipping a run if the previous one is still in progress. The job MUST be disabled only when `SESSION_PURGE_ENABLED` is exactly `'false'`.

#### Scenario: Old rows are removed, recent ones kept

- GIVEN one `Session` expired 8 days ago and another revoked 1 day ago
- WHEN the purge job runs
- THEN the first row is deleted and the second is kept

### Requirement: Frontend Session Closure

On a successful password change from `Perfil`, the frontend MUST close the local session and redirect to the login page with an explanatory message, because the current token is invalid from the next request. After 8 minutes without activity the frontend MUST show a warning and, after a further 120 seconds without a response, MUST log the user out; activity in another tab MUST dismiss the warning. A login or logout performed in one tab MUST be reflected in the other tabs sharing the same browser storage.

#### Scenario: Password change closes the session

- GIVEN a therapist updates their password from `Perfil`
- WHEN the request succeeds
- THEN the frontend logs out and navigates to the login page with a message asking them to sign in again

#### Scenario: Idle timeout closes the session

- GIVEN an authenticated therapist with no activity in any tab
- WHEN the idle time and the warning countdown elapse without a response
- THEN the frontend logs out and navigates to the login page
