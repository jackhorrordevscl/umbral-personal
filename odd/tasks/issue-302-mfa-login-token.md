# Issue #302 — Harden MFA, recovery and one-time token consumption (part 1 of 3)

## Objective
MFA verification must depend on the password step and must not be replayable. Part 1 covers the first evidence item of #302 plus the TOTP replay item.

## Scope
Backend (NestJS + Prisma) and the login page in the frontend. Parts 2 (encrypt `mfaSecret`, harden `recoverMfa`) and 3 (atomic one-time tokens, `jwt.strategy` allowlist, webhook secret length) ship as separate PRs. Delivery strategy: `stacked-to-main` (one PR per part, each merged to main).

## Config
- Branch: `fix/302-mfa-login-token`
- TDD: not configured; ordinary checks. Runners: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run test:e2e` in `backend/`; `npm test` in `frontend/`
- Route: delegated direct (one writer; 4+ files across backend and frontend)
- Commits: Conventional Commits in Spanish, no AI attribution; `Closes` is NOT used here because #302 stays open until part 3 (use `Refs #302`)

## Tasks
- [x] T1 — (c7b6d40) Prisma: add `lastUsedStep Int?` to `User` plus migration (`20260930...`, after `20260925120000_add_document_void`)
- [x] T2 — (c7b6d40) `completeLogin` returns a signed short-lived `mfaToken` (new purpose `mfa-verify`, ~5m) instead of a bare `userId`; `verifyMfa` takes `mfaToken`, validates purpose, and requires `mfaEnabled`; DTO `VerifyMfaDto` swaps `userId` for `mfaToken`; `jwt.strategy` rejects the new purpose as a session token
- [x] T3 — (c7b6d40) Shared private TOTP helper with replay protection (`verifyDelta` + atomic `updateMany` on `lastUsedStep`) used by verify, enable and disable; reset `lastUsedStep` when the secret is regenerated, on disable and on recover
- [x] T4 — (4e71b6e) Frontend `LoginPage`: store the server `mfaToken` (rename the state clash with the TOTP input), send `{ mfaToken, token }`
- [x] T5 — (f8f7fcc e2e, c7b6d40 unit, 4e71b6e frontend) Update unit specs, e2e specs (`critical-flows`, `rate-limit-login`, and any spec reusing a TOTP step for the same user) and `LoginPage.spec.tsx`

## Acceptance criteria
- `POST /auth/mfa/verify` without a valid, unexpired `mfa-verify` token returns 401; a bare `userId` is no longer accepted.
- A user with `mfaSecret` but `mfaEnabled=false` cannot obtain a session through verify.
- The same TOTP step cannot be used twice for the same user (verify, enable, disable).
- The `mfa-verify` token cannot be used as a Bearer session token.
- `npm test`, lint and `tsc` pass in backend and frontend; e2e results reported honestly.

## Progress
- Commits: c7b6d40 (schema, migration, backend, unit specs), f8f7fcc (e2e specs), 4e71b6e (frontend).
- Observed: backend tsc, lint, npm test (986 passed); e2e 180/181 (only calendar-busy-overlay, known baseline failure; with default 5s hook timeouts several suites time out under parallel load, all pass with --testTimeout=60000); frontend 210 tests passed, lint clean. frontend PatientsPage.spec and tsc -b fail on missing module react-window (unrelated, environmental).
- Note: enable followed by disable within the same 30s TOTP step is rejected by design (needs the next step).

## Next step
Open PR for part 1 (stacked-to-main); then parts 2 and 3.
