# Issue #302 — Harden MFA, recovery and one-time token consumption (part 2 of 3)

## Objective
Protect the MFA secret at rest and make MFA recovery observable and revocable. Part 2 covers the evidence items on `mfaSecret` storage and `recoverMfa`.

## Scope
Backend only (NestJS + Prisma). Part 1 (mfaToken, TOTP replay) is merged (d31c784). Part 3 (atomic one-time tokens, `jwt.strategy` allowlist, webhook secret length) ships separately and is the only part that uses `Closes #302`. Delivery strategy: `stacked-to-main`.

## Config
- Branch: `fix/302-mfa-secret-cifrado-recover`
- TDD: not configured; ordinary checks. Runners in `backend/`: `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run test:e2e` (use `--testTimeout=60000` locally)
- Route: delegated direct (one writer; 4+ files: crypto service, mfa service, mail, env/render config, specs)
- Commits: Conventional Commits in Spanish, no AI attribution, `Refs #302`

## Tasks
- [x] T1 — Encrypt `mfaSecret` at rest with AES-GCM reusing `common/crypto/aes-gcm` and the existing crypto-service pattern; decrypt on every read (`verifyMfa`, `consumeTotp` callers, enable, disable, recover). Existing plaintext secrets must keep working (versioned prefix, lazy re-encrypt or data migration — writer proposes, parent confirms).
- [x] T2 — Any new env var for the key is validated in `env.validation.ts` and synced in `render.yaml` (see #208), with spec coverage.
- [x] T3 — `recoverMfa`: revoke the user's sessions, send a notice email (HTML-escaped, per #300), and record IP and user-agent in the audit entry (reuse the client-IP helper from #301).
- [x] T4 — Update unit and e2e specs; add cases for encrypted round trip, legacy plaintext, and the three recover effects.

## Acceptance criteria
- `User.mfaSecret` is never stored in plaintext for new or re-saved secrets.
- Users whose secret was stored in plaintext before the deploy can still log in.
- After `recoverMfa`: MFA disabled, all sessions revoked, notice email sent, audit row carries IP and user-agent.
- `npm test`, lint and `tsc` pass; e2e results reported honestly.

## Progress
- T1-T4 done in commit 434554d (single commit: mfa.service.ts and its spec interleave all four tasks).
- T1: `MfaSecretCryptoService` (`enc:v1:` + base64 AES-256-GCM); legacy plaintext passes through and is re-encrypted conditionally on the first valid TOTP; unreadable ciphertext gives 401. No data migration or schema change.
- T2: new dedicated env var `MFA_SECRET_ENCRYPTION_KEY` (same convention as the other three keys, never shared); validated in `env.validation.ts` (+ spec), added to `render.yaml`, `ci.yml`, README, `install.sh`. Must be loaded in Render before deploy.
- T3: `recoverMfa` revokes sessions in the same transaction, sends a best-effort notice email, audits IP and user-agent.
- T4 evidence (backend/): `npx tsc --noEmit` clean; `npm run lint` clean; `npm test` 75 suites / 1021 tests pass; `npm run test:e2e -- --testTimeout=60000` (with `MFA_SECRET_ENCRYPTION_KEY` set) 20 of 21 suites pass, only `calendar-busy-overlay` fails (already failing on main).
- Route: delegated direct (one writer). Review assessment: pending, parent decides.

## Next step
Parent: add `MFA_SECRET_ENCRYPTION_KEY` to local `backend/.env` and Render, run review assessment, push and open the stacked PR.
