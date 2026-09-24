# Issue #192: revocable sessions (logout / logout-all)

## Objective
Let a user revoke a session (or all sessions) before the 8h JWT expires, closing the gap where a leaked token could only be neutralised by changing the password.

## Design (accepted)
- New `Session` table: `id`, `jti` (unique), `userId` (FK User, index), `createdAt`, `expiresAt`, `revokedAt?`, `ipAddress?`, `userAgent?`. RLS enabled, no policies (same pattern as `notifications` migration).
- `MfaService.generateToken` creates a Session row and signs the JWT with `jti`.
- `JwtStrategy.validate`: for session tokens (no `purpose`), require `jti` and an active (not revoked, not expired) Session; otherwise 401. Tokens issued before deploy (no `jti`) are rejected: users log in again once.
- `POST /auth/logout` revokes the current session; `POST /auth/logout-all` revokes every active session of the user. Both behind `JwtAuthGuard`. Audit with existing `LOGOUT`; add `LOGOUT_ALL` audit action via migration.
- Frontend: `logout()` keeps its synchronous signature; it fires the API call best-effort, then clears local state.

## Constraints
- Neutral Spanish in user-facing/docs text where the project already uses Spanish; code/comments follow surrounding style. No AI attribution in commits.
- Conventional Commits, one work-unit commit per task with its tests/docs.
- Out of scope: `email-change` missing from the JwtStrategy purpose blocklist (note as follow-up), issue #203.

## Tasks
- [x] T1 Prisma: `Session` model + migration (RLS) + `LOGOUT_ALL` AuditAction migration
- [x] T2 Backend: create Session in `generateToken`, `jti` in payload, JwtStrategy check, tests (strategy, mfa.service)
- [x] T3 Backend: `POST /auth/logout` and `/auth/logout-all` + service + audit + tests (controller/service, e2e)
- [x] T4 Frontend: AuthContext/logout calls API, tests
- [x] T5 Docs: README, openspec session-invalidation spec, manual if applicable

## Checks
Backend: `npx prisma generate` then `npx jest` (+ lint/tsc). Frontend: vitest + lint + tsc.

## Progress / evidence
- T1: 877eb02 (prisma validate + generate OK)
- T2: 6b45d83 (auth jest passed, tsc, eslint clean)
- T3: 86254a2 (jest 748 total, 14 failing = DB integration specs, same on base; e2e written but NOT run, no test DB configured)
- T4: 3cf0e84 (vitest 186 passed, tsc, eslint clean)
- T5: docs commit (README, openspec spec, manual)

## Route declaration
Mapping delegated (4+ files); implementation delegated to one writer (2+ non-trivial files).
