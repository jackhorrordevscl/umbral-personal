# Session Invalidation Specification

**Domain**: session-invalidation  
**Introduced by**: harden-profile-endpoint (issue #76)  
**Merged**: 2026-08-26

## Purpose

Any password change invalidates every access token issued before that change, by comparing token issuance time against the account's last password-change timestamp, applied uniformly across `PATCH /profile`, `AuthService.resetPassword`, and the forced `mustChangePassword` flow.

## Requirements

### Requirement: passwordChangedAt Tracking

The `User` model MUST have a nullable `passwordChangedAt` timestamp. The system MUST set it to the current time whenever the account password changes through `PATCH /profile`, `AuthService.resetPassword`, or the forced `mustChangePassword` completion, and MUST set it before minting any replacement session token in that same operation.

#### Scenario: Password change via PATCH /profile sets the timestamp

- GIVEN an authenticated user changes their password via `PATCH /profile`
- WHEN the update commits
- THEN `passwordChangedAt` is set to the time of the change

#### Scenario: resetPassword sets the timestamp

- GIVEN a user completes the self-service reset-password flow
- WHEN the new password is saved
- THEN `passwordChangedAt` is set to the time of the change

#### Scenario: Forced mustChangePassword completion sets the timestamp

- GIVEN a user with `mustChangePassword: true` completes the forced change
- WHEN the new password is saved
- THEN `passwordChangedAt` is set to the time of the change

### Requirement: No Forced Logout on Deploy

The migration adding `passwordChangedAt` MUST leave it `NULL` for all existing users and MUST NOT backfill a value. `JwtStrategy.validate()` MUST treat a `NULL` `passwordChangedAt` as "no invalidation check applies" and MUST NOT reject a token on that basis alone.

#### Scenario: Pre-deploy token stays valid until the user's first change

- GIVEN an existing user whose `passwordChangedAt` is `NULL`
- WHEN they present a token issued before deploy
- THEN the token is accepted (subject to normal expiration) because the invalidation check is skipped while `passwordChangedAt` is `NULL`

### Requirement: Token Rejection After a Password Change

Once `passwordChangedAt` is non-null, `JwtStrategy.validate()` MUST reject (`401`) any bearer token whose `iat` predates `passwordChangedAt`. The comparison MAY apply a small clock-skew allowance so the replacement token minted in the same operation that changed the password is not itself rejected.

#### Scenario: Token issued before a PATCH /profile password change is rejected

- GIVEN a user holds a token issued before a password change made via `PATCH /profile`
- WHEN they use that token on any subsequent authenticated request
- THEN the response is `401`

#### Scenario: Token issued after the change is accepted

- GIVEN a user changed their password and received a fresh token
- WHEN they use that fresh token
- THEN the request is accepted

#### Scenario: resetPassword invalidates tokens from every device

- GIVEN a user has active tokens on two devices and completes a self-service password reset
- WHEN either device presents its previously issued token
- THEN both are rejected `401` and each device must log in again

#### Scenario: mustChangePassword tokens are never accepted as session tokens

- GIVEN a user has not yet completed a forced `mustChangePassword` flow
- WHEN they present the special-purpose `password-change` token to a route protected by `JwtAuthGuard`
- THEN it is rejected, independent of the `passwordChangedAt` check, because purpose-scoped tokens are never valid session tokens

### Requirement: Revocable Sessions

Every session token MUST carry a `jti` claim backed by a `Session` row (`jti` unique, `userId`, `expiresAt`, nullable `revokedAt`, optional `ipAddress`/`userAgent`) created when the token is issued. `JwtStrategy.validate()` MUST reject with `401` a session token that has no `jti`, whose `Session` does not exist or belongs to another user, is revoked, or is past `expiresAt`. Tokens issued before this requirement shipped carry no `jti` and are rejected once (users log in again).

#### Scenario: Token without jti is rejected

- GIVEN a session token signed without a `jti`
- WHEN it is presented to a route protected by `JwtAuthGuard`
- THEN it is rejected `401`

#### Scenario: Revoked or expired session is rejected

- GIVEN a valid token whose `Session` has `revokedAt` set or `expiresAt` in the past
- WHEN it is presented
- THEN it is rejected `401`

### Requirement: Logout and Logout-All

`POST /auth/logout` MUST revoke the `Session` of the token presented; `POST /auth/logout-all` MUST revoke every still-active `Session` of the authenticated user. Both MUST require `JwtAuthGuard` and write an audit entry (`LOGOUT` and `LOGOUT_ALL` respectively). The frontend `logout()` MUST remain synchronous: it fires the API call best-effort and clears local state regardless of the outcome.

#### Scenario: Logout revokes only the current session

- GIVEN a user with two active sessions
- WHEN they call `POST /auth/logout` with the first token
- THEN the first token is rejected `401` afterwards and the second remains valid

#### Scenario: Logout-all revokes every session

- GIVEN a user with two active sessions
- WHEN they call `POST /auth/logout-all`
- THEN both tokens are rejected `401` afterwards
