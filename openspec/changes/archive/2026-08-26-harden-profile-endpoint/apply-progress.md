# Apply Progress: harden-profile-endpoint

## Batch 1 — PR A: post-verify deferred-item cleanup

**What**: Post-verify deferred-item cleanup batch for `harden-profile-endpoint` PR A (Engram verify-report id 1178, PASS WITH WARNINGS). Fixed 2 of 5 deferred items per explicit user decision; the other 3 (email-change.controller.ts/profile.module.ts coverage gaps, unexecuted e2e suite, pre-existing profile.e2e-spec.ts:92 TS2769) remained explicitly out of scope for that batch. No commit was made (branch `harden-profile-endpoint-pr-a` stayed uncommitted, per instruction; it has since merged to `main` as commit `c3a83b8`).

**Why**: WARNING #1 and WARNING #3 from the verify report were judged worth closing before archive; the remaining items were already justified as low-risk or infra-blocked in that same report.

**Where / changes**:

1. WARNING #1 (audit-action naming divergence) — `sdd/harden-profile-endpoint/spec` (Engram topic, id 1174, new revision). Documentation-only: the "Audit Logging for Credential Changes" requirement's literal `AuditAction` enum-name references were `PROFILE_PASSWORD_CHANGED` / `PROFILE_EMAIL_CHANGE_REQUESTED` / `PROFILE_EMAIL_CHANGED`. Reconciled to match the implemented/tested/schema reality: `PASSWORD_CHANGED` / `EMAIL_CHANGE_REQUESTED` / `EMAIL_CHANGE_CONFIRMED` (cross-checked against `backend/prisma/schema.prisma`'s `AuditAction` enum, lines 217-219). Updated in both the requirement prose and both of its scenario blocks ("Password change is audited", "Email change lifecycle is audited at both steps"). Added a reconciliation note near the top of the spec doc explaining the change. No code or schema touched — implementation was already correct, spec text was stale.

2. WARNING #3 (missing frontend test coverage) — new file `frontend/src/pages/ConfirmEmailChangePage.spec.tsx` (5 tests). `ConfirmEmailChangePage.tsx` mirrors `VerifyEmailPage.tsx` structurally (no `VerifyEmailPage.spec.tsx` sibling existed to copy — none of this project's pages have one). Followed `LoginPage.spec.tsx`'s established pattern instead: `vi.mock('../api/client', ...)`, `MemoryRouter`, `vi.mocked(api)`. Deliberately did NOT wrap in `QueryClientProvider` (the `PatientsPage.spec.tsx` pattern) because `ConfirmEmailChangePage` uses a plain `useEffect` + `api.post` call, not `useQuery`/react-query — matching the actual component shape over a generic template. Test names:
   - "muestra el estado de confirmación mientras la solicitud está en curso" — asserts the `confirming` loading text renders and `api.post` was called with `{ token }` from the URL query param (uses a never-resolving promise to freeze the loading state).
   - "confirmación exitosa muestra el mensaje de éxito" — asserts success heading + copy render after `api.post` resolves.
   - "token faltante muestra error sin llamar al backend" — asserts the `error` state renders with the exact missing-token copy and `api.post` is never called (mirrors the component's `token ? 'confirming' : 'error'` initial-state branch).
   - "token expirado o inválido muestra el mensaje de error del backend" — asserts `getApiErrorMessage`'s backend-supplied message renders via a rejected `api.post` shaped like `{ isAxiosError: true, response: { data: { message } } }` (same rejection shape as `LoginPage.spec.tsx`'s existing convention).
   - "incluye un enlace para volver a iniciar sesión" — asserts the `/login` link is always present regardless of state.

**Frontend test run result**: `cd frontend && npm test -- --run` → 7 test files passed, 40/40 tests passed (35 pre-existing + 5 new), 0 failed. No regressions.

**Tasks artifact**: `sdd/harden-profile-endpoint/tasks` (Engram id 1176) updated — added a "Phase 5: Post-verify deferred-item cleanup batch" section under PR A with A5.1 (spec fix, done) and A5.2 (frontend test, done) marked `[x]`, and A5.3-A5.5 listed `[ ]` as explicitly deferred/out of scope with reasons.

**Learned**: This project has no `VerifyEmailPage.spec.tsx` or any spec file for the 4 simple useEffect-driven pages (VerifyEmailPage, ForgotPasswordPage, ResetPasswordPage, MfaRecoverPage) — only `LoginPage`, `PatientsPage`, `ConsultationsPage` have specs. `QueryClientProvider` in tests is only needed for pages that actually call `useQuery`/`useMutation` (PatientsPage/ConsultationsPage pattern); plain-axios pages should follow LoginPage's simpler mock-only pattern instead. Do not assume every "closest sibling" file has an existing spec to copy — verify with Glob first.

---

## Batch 2 — PR B: session invalidation

**What**: Implemented PR B of `harden-profile-endpoint` (issue #76) — the session-invalidation domain deferred from PR A. Added a nullable `User.passwordChangedAt` column, set it (plus a `PASSWORD_CHANGED` audit row) from all three password-change entry points, cleared any pending email change when the password branch of `PATCH /profile` runs, and made `JwtStrategy.validate()` reject any bearer token whose `iat` predates `passwordChangedAt` (floored to seconds, NULL skips the check). Branch `harden-profile-endpoint-pr-b`, branched fresh off up-to-date `main` (PR A already merged as commit `c3a83b8`). No commit made — changes are staged/in the working tree per instruction.

**Why**: Spec id 1174 (`session-invalidation` domain) and design id 1175 require that any password change invalidate every access token issued before it, uniformly across `PATCH /profile`, `AuthService.resetPassword`, and the forced `mustChangePassword` completion (`AuthService.changePassword`), without forcing a retroactive logout of the existing user base on deploy day.

**Where / changes** (9 files, 618 insertions / 8 deletions):

1. **`backend/prisma/schema.prisma`** — added `passwordChangedAt DateTime?` on `User`, nullable, no default, with a comment explaining the no-backfill rationale (mirrors the existing `pendingEmail`/`passwordResetTokenIssuedAt` comment style).
2. **`backend/prisma/migrations/20260825120000_password_changed_at/migration.sql`** (new) — single additive `ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);`, no backfill, inherits existing RLS policies (same reasoning as the `email_change_audit` migration from PR A).
3. **`backend/src/modules/auth/strategies/jwt.strategy.ts`** — added `passwordChangedAt: true` to the minimal `select`, added `iat: number` to the payload type, and added the invalidation check: `if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) throw new UnauthorizedException('Sesión expirada por cambio de contraseña')`. Runs after the existing purpose-blocklist and soft-delete checks, which are untouched.
4. **`backend/src/modules/auth/strategies/jwt.strategy.spec.ts`** (new, 7 tests) — first spec file for this class. Covers: purpose-blocklist regression (password-change rejected without hitting prisma), missing/soft-deleted user regression, `passwordChangedAt` NULL skips the check entirely (arbitrarily old `iat` still accepted), `iat` exactly one second before `passwordChangedAt` is rejected, `iat` in the same floored second is accepted (same-operation token doesn't self-reject), `iat` after the change is accepted.
5. **`backend/src/modules/profile/profile.service.ts`** — in the `dto.password` branch of `update()`, in addition to hashing the new password, now sets `passwordChangedAt: new Date()` and clears `pendingEmail`/`pendingEmailTokenIssuedAt` to `null` (design.md: "Any password change also clears pending" — closes the window where an attacker's pending email-change request could survive the account owner reclaiming the account via password change).
6. **`backend/src/modules/profile/profile.service.spec.ts`** — updated the existing password-change happy-path assertion to include the three new `data` fields; added a new triangulation test asserting an existing `pendingEmail`/`pendingEmailTokenIssuedAt` gets cleared; tightened the name-only test to assert the exact (unaffected) `data` shape.
7. **`backend/src/modules/auth/auth.service.ts`** — `changePassword()` (forced `mustChangePassword` completion) now sets `passwordChangedAt: new Date()` alongside the existing `passwordHash`/`mustChangePassword` update, and logs a `PASSWORD_CHANGED` audit row. `resetPassword()` now also sets `passwordChangedAt: new Date()` and logs a second `PASSWORD_CHANGED` audit row in addition to its existing `PASSWORD_RESET_COMPLETED` row (unifies the "when did this account's password last change" audit trail across all three flows, per design.md's file-changes table).
8. **`backend/src/modules/auth/auth.service.spec.ts`** — updated the `changePassword` happy-path test to assert `passwordChangedAt` in the update payload and the new `PASSWORD_CHANGED` audit call; updated the `resetPassword` happy-path test the same way, plus asserting `auditService.log` is called exactly twice (`PASSWORD_RESET_COMPLETED` + `PASSWORD_CHANGED`).
9. **`backend/test/session-invalidation.e2e-spec.ts`** (new, 5 tests) — mirrors the fixture/throttler-override pattern of `profile.e2e-spec.ts` and `forgot-reset-password.e2e-spec.ts` (own `AppModule` compile with high throttler limits, MFA-enrollment helper for a real accessToken). Covers: (a) a token valid before a `PATCH /profile` password change becomes 401 afterward; (b) a fresh login with the new password succeeds; (c) `resetPassword` invalidates tokens from two independent "devices"/tokens at once; (d) a manually-signed session token with a past `iat` (via `noTimestamp: true` + payload-supplied `iat`, since there is no genuine pre-existing session token in the forced `mustChangePassword` flow) becomes 401 after the forced change completes; (e) an account that never changed its password (`passwordChangedAt` stays NULL) keeps accepting its existing token.

**Deliberate scope decision (exact task-list adherence)**: design.md's prose says generically "Any password change also clears pending [email]," but the literal tasks.md checklist (id 1176) only assigns pending-email clearing to B3.1 (`profile.service.ts`), not B3.2 (`auth.service.ts`). Followed the literal task list: `resetPassword`/`changePassword` do **not** clear `pendingEmail` — only the `PATCH /profile` password branch does. Flagged as a note, not a silent deviation.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| B1.1/B1.2 | N/A (schema + migration, structural) | N/A | N/A (new column) | N/A | N/A | Triangulation skipped: nullable column addition only, no branching logic | N/A |
| B2.1/B2.2 | `jwt.strategy.spec.ts` | Unit | N/A (new spec file, no prior baseline for this class) | ✅ Written (1 failing case pre-implementation) | ✅ 7/7 passed | ✅ 4 iat cases (null-skip, 1s-before-reject, floor-equal-accept, after-accept) + 3 regression cases (purpose blocklist, missing user, soft-deleted user) | ➖ None needed — implementation was already minimal |
| B3.1 | `profile.service.spec.ts` | Unit | ✅ 9/9 (baseline before edit) | ✅ Written (2 failing cases pre-implementation) | ✅ 10/10 passed | ✅ 2 cases (happy path + existing-pendingEmail-gets-cleared) | ➖ None needed |
| B3.2 | `auth.service.spec.ts` | Unit | ✅ 53/53 (baseline before edit) | ✅ Written (2 failing cases pre-implementation) | ✅ 53/53 passed | ✅ 2 flows covered independently (`changePassword`, `resetPassword`), each asserting its own `data`/audit shape | ➖ None needed |
| B4.1 | `session-invalidation.e2e-spec.ts` | E2E | N/A (new file) | ✅ Written | ⚠️ Blocked (infra) — compiles and wires through Nest DI, fails at `JwtStrategy requires a secret or key` (missing `JWT_SECRET`/`.env`), same category of pre-existing infra gap as PR A, confirmed by running the identical, unmodified `forgot-reset-password.e2e-spec.ts` and observing the same failure | ✅ 5 cases (3 flows × old-token-401, + fresh-token-accepted, + NULL-skips-check) authored per spec scenarios | N/A |
| B4.2 | Regression: `profile.e2e-spec.ts` (unmodified) | E2E | N/A | N/A | ⚠️ Blocked by the same infra gap (not a regression introduced by this batch) | N/A | N/A |

### Test Summary
- **Total tests written this batch**: 7 (jwt.strategy.spec.ts, new) + 2 updated + 1 new (profile.service.spec.ts) + 2 updated (auth.service.spec.ts) + 5 (session-invalidation.e2e-spec.ts, new, infra-blocked) = 15 new/changed assertions across 4 files.
- **Total backend unit tests passing**: 155/155, 16 suites (`cd backend && npx jest`) — up from 147/147 before this batch (net +8: 7 new in `jwt.strategy.spec.ts`, +1 new in `profile.service.spec.ts`; `auth.service.spec.ts`'s 53 tests were modified in place, not net-new).
- **Layers used**: Unit (7 new + 3 modified test bodies), E2E (5, infra-blocked at DI/config level, same category as PR A's DB-connection block).
- **Approval tests** (refactoring): None — no refactoring tasks in this batch.
- **Pure functions created**: 0 (all changes are additive branches inside existing methods; the `iat`-vs-`passwordChangedAt` comparison in `jwt.strategy.ts` is a pure boolean expression but not extracted to its own function, consistent with the file's existing style of inline guard clauses).

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `cd backend && npx jest src/modules/auth/strategies/jwt.strategy.spec.ts src/modules/profile/profile.service.spec.ts src/modules/auth/auth.service.spec.ts` → 3 suites, 70/70 tests passed (7 + 10 + 53) |
| Runtime harness command/scenario and exact result | `cd backend && npx jest --config ./test/jest-e2e.json session-invalidation.e2e-spec.ts` → fails during Nest DI compilation (`TypeError: JwtStrategy requires a secret or key`, missing `JWT_SECRET`/`.env` in this sandbox) before ever reaching Postgres. Confirmed pre-existing and unrelated to this change by running the same command against the untouched `forgot-reset-password.e2e-spec.ts` — identical failure. Full backend unit regression: `cd backend && npx jest` → 155/155 passed, 16 suites, 0 failed. |
| Rollback boundary | Revert this batch's 9 files only (`backend/prisma/schema.prisma`, the new `20260825120000_password_changed_at/` migration directory, `backend/src/modules/auth/strategies/jwt.strategy.ts` + `.spec.ts`, `backend/src/modules/profile/profile.service.ts` + `.spec.ts`, `backend/src/modules/auth/auth.service.ts` + `.spec.ts`, `backend/test/session-invalidation.e2e-spec.ts`). PR A's behavior on `main` is fully unaffected: `passwordChangedAt` is additive and nullable, no PR A file is touched, and PR A's own test suites were not modified. |

### Deviations from Design
- **Pending-email clearing scope**: design.md's decision text ("Any password change also clears pending") is broader than the literal tasks.md checklist, which only assigns clearing to B3.1 (`profile.service.ts`). Followed tasks.md literally: `resetPassword`/`changePassword` in `auth.service.ts` do not clear `pendingEmail`. Not a silent deviation — documented here per the explicit "if design is wrong or incomplete, note it" rule; the orchestrator/user should confirm whether `auth.service.ts`'s flows should also clear pending email in a follow-up.
- **`PASSWORD_CHANGED` audit added to `resetPassword`/`changePassword`**: this was implied by design.md's file-changes table ("...; PASSWORD_CHANGED audit") but not explicitly present in the spec's "Audit Logging for Credential Changes" requirement (which only mentions `PATCH /profile`). Implemented as an additive second audit row (kept `PASSWORD_RESET_COMPLETED` in `resetPassword`, added `PASSWORD_CHANGED` alongside it) rather than replacing anything, to preserve existing behavior other code/tests might depend on. No existing e2e assertion checks exact audit-row counts for these two flows, so this is additive-safe.
- Everything else matches design.md's technical approach (`iat` comparison exactly as specified: floored seconds, no clock-skew tolerance, NULL skips the check).

### Issues Found
1. **Pre-existing security gap, out of scope for PR B**: `JwtStrategy.validate()`'s purpose blocklist (`mfa-setup`, `password-change`, `email-verify`, `password-reset`) does **not** include `email-change`, even though design.md's PR A decision ("Dedicated `email-change` token purpose... Added to the JwtStrategy purpose blocklist") calls for it. Verified this was never implemented in PR A (no task in Phases 1-5 touches `jwt.strategy.ts`, and the file as read at the start of this batch confirmed the gap). This means a leaked/logged `email-change` token could technically be presented as a Bearer session token on any `JwtAuthGuard`-protected route. **Not fixed in this batch** — it is PR A's domain (email-change purpose), not PR B's assigned task list (B1.1-B4.2 only concern `passwordChangedAt`/`iat`), and the instructions for this batch explicitly say not to re-touch PR A's already-merged scope. Recommend a small, separate follow-up task to add `'email-change'` to the blocklist array.
2. **Infra gap (pre-existing, confirmed, not new)**: e2e tests cannot run to completion in this sandbox — missing `JWT_SECRET`/`.env` blocks Nest DI compilation before any test body executes, for both the new `session-invalidation.e2e-spec.ts` and every pre-existing e2e spec file (confirmed by running `forgot-reset-password.e2e-spec.ts` unmodified). This is one step earlier in the pipeline than PR A's documented "e2e fails at DB connection" gap, but the same category of accepted sandbox limitation.

### Remaining Tasks
- [ ] None from PR B's assigned checklist (B1.1-B4.2 all complete). Follow-ups noted above (email-change purpose blocklist gap; PR A's A5.3-A5.5 deferred items) are explicitly out of scope for this batch.

### Workload / PR Boundary
- Mode: chained PR slice (stacked-to-main per tasks.md; in practice PR B targets `main` directly since PR A already merged before this branch was created)
- Current work unit: Unit B — passwordChangedAt session invalidation
- Boundary: starts from PR A's merged `main` (commit `c3a83b8`), ends with all of B1.1-B4.2 implemented, tested, and passing (except the infra-blocked e2e runtime execution)
- **Budget risk — ask-on-risk trigger**: actual diff is **618 insertions / 8 deletions = 626 changed lines**, against tasks.md's ~320-line forecast for this slice (≈2x). Breakdown: `session-invalidation.e2e-spec.ts` (308 lines, new file) and `jwt.strategy.spec.ts` (147 lines, new file with no prior spec to amortize against) account for the bulk of the overrun; the four modified source/spec files (`jwt.strategy.ts`, `profile.service.ts`+spec, `auth.service.ts`+spec) total well under 150 lines combined. **This needs an explicit decision before merge/verify sign-off**: accept as `size:exception` (all work is functionally complete, tested, and independently revertible), or split `session-invalidation.e2e-spec.ts` into a follow-up PR to bring the core slice back under budget. Not resolved unilaterally — flagged per the ask-on-risk delivery strategy.

### Status
6/6 PR B tasks complete (B1.1, B1.2, B2.1, B2.2, B3.1, B3.2, B4.1, B4.2 — 8 sub-items across 6 checklist lines). 155/155 backend unit tests passing, 0 regressions. E2e written but infra-blocked (pre-existing sandbox gap, not a code defect). **Budget-risk decision needed before this is merge-ready** — see "Workload / PR Boundary" above.

---

## Batch 3 — PR B follow-up: pendingEmail clearing in auth flows

**What**: Extended the pendingEmail-clearing behavior implemented in Batch 2's `profile.service.ts` password branch (B3.1) to `AuthService.resetPassword` and `AuthService.changePassword` in `backend/src/modules/auth/auth.service.ts`. Both methods now unconditionally set `pendingEmail: null, pendingEmailTokenIssuedAt: null` on their `prisma.user.update` call, alongside the existing `passwordChangedAt` write. Strict TDD followed: RED (failing assertion) → GREEN (minimal field addition) per method; no refactor needed since both changes mirror the existing `profile.service.ts` pattern exactly. Task tracked as new item **B3.3** in the tasks artifact (Engram id 1176). No commit made — changes staged/in the working tree on branch `harden-profile-endpoint-pr-b`, per instruction.

**Why**: This was an explicit product/security decision confirmed with the user before this batch started, closing the deviation flagged in Batch 2's apply-progress above ("Pending-email clearing scope"). Design id 1175's decision "Second request replaces the first" states generically: "Any password change also clears pending [email]" — Batch 2 wired this only into `profile.service.ts` (the literal tasks.md B3.1 item at the time) and explicitly deferred `auth.service.ts`. Rationale: if an attacker holding a stolen token has a pending email-change request open (`pendingEmail` set), and the victim resets their password via the "forgot password" flow or completes a forced `mustChangePassword` change (neither of which goes through `PATCH /profile`), the pending email-change request must also be cancelled — otherwise the attacker's pending request survives the very password change meant to lock them out.

**Where / changes** (2 files, ~35 lines: 1 production file, 1 test file):

1. **`backend/src/modules/auth/auth.service.ts`**:
   - `changePassword()`: `prisma.user.update`'s `data` object gains `pendingEmail: null, pendingEmailTokenIssuedAt: null` alongside the existing `passwordHash`, `mustChangePassword: false`, `passwordChangedAt`. New comment explains the attacker/passwordChangeToken scenario, cross-referencing `ProfileService.update`'s equivalent branch.
   - `resetPassword()`: same two fields added to its `prisma.user.update` call alongside `passwordHash`, `passwordResetTokenIssuedAt: null`, `passwordChangedAt`. New comment explains the self-service reset scenario.
2. **`backend/src/modules/auth/auth.service.spec.ts`**:
   - Extended both existing happy-path `toHaveBeenCalledWith` literal assertions (`changePassword` and `resetPassword`) to include `pendingEmail: null, pendingEmailTokenIssuedAt: null` in the expected `data` object — this alone was the RED step for the unconditional-clear behavior, since a literal-equality assertion fails once the implementation writes extra fields not present in the expected literal.
   - Added 2 new triangulation tests, one per method: `changePassword` — user built with `pendingEmail: 'attacker@evil.com', pendingEmailTokenIssuedAt: new Date()` before the call, asserting the update clears both to `null` (via `expect.objectContaining`); `resetPassword` — identical pattern with a user carrying a pre-existing pending email change at reset time.

**Deliberate scope decision**: No changes to `jwt.strategy.ts`, `session-invalidation.e2e-spec.ts`, or any other Batch 2 file, per explicit instruction — this batch touches exactly the two files above.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| B3.3 (`changePassword`) | `auth.service.spec.ts` | Unit | ✅ 55/55 (full file baseline, pre-batch) | ✅ Written (2 failing: extended happy-path literal + new pendingEmail-clear test) | ✅ 7/7 `changePassword` tests passed | ✅ 1 dedicated case (pre-existing `pendingEmail` → cleared) in addition to the extended happy-path assertion | ➖ None needed — matches the existing `profile.service.ts` pattern exactly |
| B3.3 (`resetPassword`) | `auth.service.spec.ts` | Unit | ✅ 57/57 (running total after the `changePassword` fix landed) | ✅ Written (2 failing: extended happy-path literal + new pendingEmail-clear test) | ✅ full file 57/57 passed | ✅ 1 dedicated case (pre-existing `pendingEmail` → cleared) in addition to the extended happy-path assertion | ➖ None needed |

### Test Summary
- **Total tests written this batch**: 2 new (`changePassword`, `resetPassword` pendingEmail-clear cases) + 2 existing happy-path assertions extended in place (not counted as new tests — same test count, wider assertion).
- **Total backend unit tests passing**: 157/157, 16 suites (`cd backend && npx jest`) — up from 155/155 before this batch (+2 net new tests, both in `auth.service.spec.ts`).
- **Layers used**: Unit only (2 new). No integration/E2E changes this batch.
- **Approval tests**: None (not a refactoring task). **Pure functions created**: 0.

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `cd backend && npx jest src/modules/auth/auth.service.spec.ts` → 57/57 passed (was 55/55 before this batch) |
| Runtime harness command/scenario and exact result | N/A — no new runtime/integration boundary; this is a pure data-field addition to an existing `prisma.user.update` call already covered by unit tests. The existing `session-invalidation.e2e-spec.ts` (Batch 2, infra-blocked) exercises the same two methods but was not modified or re-run against this change since it is infra-blocked (missing `JWT_SECRET`/`.env`), unchanged from Batch 2's finding. |
| Rollback boundary | Revert the 2 fields added to each `prisma.user.update` call in `auth.service.ts` (4 lines total) plus the corresponding test changes in `auth.service.spec.ts`; no other Batch 2 or Batch 1 file touched. |

### Deviations from Design
None — this batch closes the one deviation flagged in Batch 2 ("Pending-email clearing scope"). Pending-email clearing now applies uniformly to all three password-change entry points (`PATCH /profile`, `resetPassword`, `changePassword`), matching design.md's "Any password change also clears pending" prose exactly.

### Issues Found
None new. The two issues noted in Batch 2 (JwtStrategy `email-change` purpose blocklist gap from PR A, and the pre-existing `JWT_SECRET`/`.env` infra gap blocking e2e) remain unchanged and out of scope for this batch.

### Remaining Tasks
- [ ] None from this batch's single assigned task (B3.3, complete). Batch 2's noted follow-ups (email-change purpose blocklist gap; PR A's A5.3-A5.5 deferred items; the e2e-suite budget-risk decision) remain outstanding and out of scope here.

### Workload / PR Boundary
- Mode: stacked PR slice (PR B → main), continuing the same branch and working tree as Batch 2.
- Current work unit: PR B, Phase 3 (Integration), item B3.3.
- Boundary: starts from Batch 2's committed-in-working-tree state (9 files, 626 changed lines) and adds exactly 2 files / ~35 lines on top.
- Estimated review budget impact: negligible addition to the already-flagged budget-risk total; does not change the accept-as-exception-or-split decision still needed for the e2e file.

### Status
PR B now 7/7 checklist items complete (added B3.3). 157/157 backend unit tests passing, 0 regressions. No commit made, per instruction.
