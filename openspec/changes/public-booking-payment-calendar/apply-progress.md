# Apply Progress: Public Booking — Calendar Overlay and In-Page Payment Checkout

## Scope of this batch (PR 0 — earlier session)

PR 0 — Spike: confirm `events.list` works under the existing `calendar.events` scope (tasks 0.1–0.3 only). PR 1–6 were out of scope for that batch per orchestrator instruction.

## Retry attempt (2026-09-11, ordinal 2)

Orchestrator reported Causa 1 (no real Google connection) resolved: a real `GoogleCalendarConnection` row now exists in the dev DB (`id 5ce2f9a3-e456-4c11-81a0-d267c0fba8ce`, `therapistId 3f768fb7-b005-45ea-95f7-77573b712efe`, `status CONNECTED`, `scope https://www.googleapis.com/auth/calendar.events`, `connectedAt 2026-09-11 20:34:06`).

Causa 2 was re-tested this session and **remains blocked**:
- `Read` on `backend/.env` → `"File is in a directory that is denied by your permission settings."`
- `Grep` on `backend/.env` → `"Permission to read ... has been denied."`
- `Bash` command referencing `backend/.env` (even a plain `test -f`) → `"Permission to use Bash with command ... has been denied."`

This is a **permission-settings-level deny rule** scoped to `backend/.env`, not a transient sandbox glitch — it blocks Read, Grep, and even a Bash command whose text merely names that path, regardless of whether the command would display file contents. Per explicit instruction, no code was written and no call was attempted that depends on the unreadable `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_TOKEN_ENCRYPTION_KEY` values, since doing so without being able to read them would mean guessing or fabricating credential handling.

Tasks 0.1–0.3 remain **NOT DONE**. Zero files changed; only this progress file was updated.

### Remaining single blocker

Grant this session (or a future retry session) read access to `backend/.env`, specifically by adjusting the permission settings that currently deny Read/Grep/Bash access to that path — the DB/connection blocker (Causa 1) is resolved and does not need to be revisited. Once `backend/.env` is readable, tasks 0.1–0.3 can execute against the existing real connection before it may need renewal.

## Mode

Strict TDD Mode is active for this change, but PR 0 is a non-shipped, throwaway diagnostic spike (design.md Decision 1 guard; tasks.md PR 0 header: "not shipped as code"). No production code or tests were due in this batch — the deliverable is a real API call and its recorded result, not a RED→GREEN→REFACTOR cycle. No TDD Cycle Evidence table applies here because no test-bearing code was authored.

## Task Status

- [ ] **0.1** Write a throwaway script that loads a real `GoogleCalendarConnection` refresh token and calls `events.list` through the existing OAuth plumbing — **NOT DONE**. Not written, because there is no real connection to run it against (see Blocker below) and writing unexecuted/unverifiable code against this task would misrepresent the spike as attempted.
- [ ] **0.2** Record the result (200 vs 403) — **NOT DONE**. No call was made. No result is recorded, invented, or assumed, per explicit instruction not to guess 200 or 403 without executing the real call.
- [ ] **0.3** Document the spike result inline — **NOT DONE**. Depends on 0.1/0.2.

**Exit condition (tasks.md)**: "0.2 returns 200. If 403, STOP." — neither outcome was reached. This batch STOPS for a third reason not covered by the task file's binary exit condition: **the spike could not be executed at all** in this environment.

## Blocker (STOP — reported per explicit instruction)

Two independent blockers, either one sufficient to prevent running the real `events.list` call:

1. **No real `GoogleCalendarConnection` row exists in the dev DB right now.**
   Queried the local dev Postgres directly (`docker exec umbral-postgres-local psql -U umbral_user -d umbral_db`):
   ```sql
   SELECT "therapistId", status, "connectedAt", "lastSyncAt", "lastError", scope,
          ("refreshTokenEncrypted" IS NOT NULL) AS has_refresh_token
   FROM "GoogleCalendarConnection";
   -- 0 rows
   ```
   `CalendarEventLink` is also empty (0 rows), consistent with no connection ever having synced in this DB instance. Prior session memory (`sdd/…` unrelated; engram obs #1240, #1316) confirms a real Google Calendar connection existed and synced successfully in this project before, and that its OAuth app is still in Google's **Testing** publishing status (issue #123, verification pending as of 2026-09-03) — refresh tokens for external testers expire ~7 days after consent regardless of use. That prior connection is gone from this DB (fresh volume, reset, or the token already expired and the connection was cleared) — there is nothing to load a refresh token from.

2. **This session cannot read `backend/.env`.**
   `Read`/`Grep` on `backend/.env` both returned "Permission to read ... has been denied" — a sandbox restriction on this session, not a missing file (its existence was confirmed via `test -f`). Even if a connection row existed, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_TOKEN_ENCRYPTION_KEY` (required to build the `OAuth2Client` and decrypt the stored refresh token, per `calendar-oauth.service.ts:buildOAuth2Client` / `google-token-crypto.service.ts`) are unreadable from this session.

Docker and the local Postgres container (`umbral-postgres-local`) are up and reachable — this is not an infra-down blocker, it is a data/credential-access blocker.

## What was verified (read-only, no blocker)

- Confirmed the exact OAuth plumbing PR 0 is meant to reuse: `CalendarSyncService.buildOAuth2Client(connection)` (`backend/src/modules/calendar-integration/calendar-sync.service.ts:527`) decrypts `refreshTokenEncrypted` via `GoogleTokenCryptoService`, constructs an `OAuth2Client` with `clientId`/`clientSecret`, and calls `setCredentials({ refresh_token })`. `GoogleCalendarClient` (`google-calendar.client.ts`) currently only exposes `insertEvent`/`patchEvent`/`deleteEvent` — there is no existing `listEvents`/`events.list` method; task 1.4 (out of scope for this batch) is where that would be added. `getAccessToken()` is private and would need to be reused or reimplemented inline for a throwaway spike script.
- Confirmed Docker Desktop and the `umbral-postgres-local` container are running and reachable (`docker ps`, `docker exec ... psql`).

## Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | N/A — no code authored this batch, nothing to test |
| Runtime harness command/scenario and exact result | Attempted: `docker exec umbral-postgres-local psql -U umbral_user -d umbral_db -c 'SELECT ... FROM "GoogleCalendarConnection"'` → 0 rows (blocker evidence, not the spike itself) |
| Rollback boundary | N/A — zero files changed; `git status --porcelain` shows no diff introduced by this batch (only the pre-existing untracked `openspec/changes/public-booking-payment-calendar/` from earlier SDD phases) |

## Remaining Tasks

- [ ] 0.1 Write the throwaway spike script (once a real connection + credential access exist)
- [ ] 0.2 Execute it and record 200/403
- [ ] 0.3 Document the result inline

PR 1–6 remain fully unstarted and gated behind PR 0 passing (Slice A) — Slice B (PR 4–5) has no such gate per tasks.md and could be sequenced first if this spike stalls further, per the orchestrator's own sequencing note.

## Two Exits (for the user/orchestrator)

1. **Provide a real connected Google account in this environment**: connect a therapist's Google Calendar via the existing `/calendar-integration/authorize` flow (requires interactive browser OAuth consent — cannot be done headlessly by this agent), then re-run this batch so 0.1–0.3 can execute against a live refresh token before the OAuth app's 7-day Testing-mode expiry.
2. **Grant this session read access to `backend/.env`** (or supply `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_TOKEN_ENCRYPTION_KEY` through another explicit channel) — necessary but not sufficient alone; still needs blocker 1 resolved too.

## Resolution (2026-09-11, same day)

Causa 2 (`backend/.env` unreadable by the agent session) was resolved by having the **user** run the spike script locally instead of granting the agent broader file permissions. The orchestrator wrote a throwaway script (`backend/scripts/pr0-spike-events-list.ts`, reusing `CalendarSyncService.buildOAuth2Client()`'s exact decrypt/OAuth2Client pattern via `decryptAesGcm`/`loadBase64Key`, never printing the refresh/access token), the user ran `npx ts-node scripts/pr0-spike-events-list.ts` from `backend/` where their local `.env` is readable, and reported the result verbatim. The script was deleted immediately after (`git status` confirms no trace, never committed).

**Real result**: `HTTP status: 200`. `events.list` works under the existing `calendar.events` scope — 0 items returned (empty calendar in the queried range), no pagination. Confirms design.md Decision 1 exactly as proposed: **no OAuth scope broadening, no re-consent needed**.

- [x] **0.1** Throwaway script written and run (by the user, outside this session's sandbox) — **DONE**.
- [x] **0.2** Result recorded: **200** — **DONE**.
- [x] **0.3** Result documented inline in this file — **DONE**.

**Exit condition met**: "0.2 returns 200 → proceed with PR 1–4 as designed." PR 1 is now unblocked.

## Status (PR 0)

3/3 tasks complete. **PR 0 DONE.** PR 1 (overlay data layer: schema + Google read client) is unblocked and next. Slice B (PR 4-5) was never blocked and can proceed in parallel if desired.

---

## Scope of this batch (PR 1 — this session, 2026-09-11)

PR 1 — Overlay data layer: schema + Google read client (tasks 1.1–1.5 only). Strict TDD Mode active. PR 2–6 are explicitly out of scope for this batch per orchestrator instruction.

### Mode

Strict TDD Mode active, test runner `npm test` (Jest) from `backend/`. Tasks 1.1–1.3 are structural (schema/migration/constants) — no branching logic, triangulation skipped per strict-tdd.md ("purely structural... literally ONE possible output"). Tasks 1.4–1.5 followed the full RED → GREEN → TRIANGULATE → REFACTOR cycle.

### Task Status

- [x] **1.1** `CalendarBusyBlock` model added to `backend/prisma/schema.prisma` (`id`, `therapistId`, `therapist` relation, `startsAt`, `endsAt`, `createdAt`, `@@index([therapistId, startsAt])` — same shape as `AvailabilityBlockout`, plus the `User.calendarBusyBlocks` back-relation for consistency with every other therapist-scoped model). `busySyncedAt DateTime?` / `busySyncError String?` added to `GoogleCalendarConnection`, kept separate from the existing push-sync `lastSyncAt`/`lastError` (two independent jobs).
- [x] **1.2** Migration generated and applied: `backend/prisma/migrations/20260911210000_calendar_busy_block/migration.sql`. **Deviation from the default flow**: `npx prisma migrate dev` fails on this repo with P3006/P1014 (shadow DB can't introspect `_prisma_migrations` because migration `20260812150000_enable_rls_prisma_migrations` enabled RLS on it — pre-existing, unrelated to this change, already documented in engram obs #1379). Followed the established workaround: hand-wrote `migration.sql` in the same style as the most recent migrations (`ALTER TABLE`/`CREATE TABLE`/`CREATE INDEX`/`AddForeignKey`, plus the mandatory `ENABLE ROW LEVEL SECURITY` for every new public-schema table, per the `rls_disabled_in_public` convention followed by every migration since `20260804170000`), then applied it with `npx prisma migrate deploy` (bypasses the shadow DB) against `umbral-postgres-local` (`umbral_user`/`umbral_local_dev`@`localhost:5432`/`umbral_db`, per the project's documented Docker-Postgres access pattern). `npx prisma validate` confirms the resulting schema is syntactically valid. Migration applied cleanly to the local dev DB (confirmed by CLI output: "All migrations have been successfully applied").
- [x] **1.3** `BUSY_WINDOW_DAYS = 60` and `BUSY_REFRESH_CONCURRENCY = 5` added to `calendar-integration.constants.ts`, same file/section style as the existing constants (`BACKFILL_WINDOW_DAYS`, `RECONCILE_BATCH_LIMIT`).
- [x] **1.4** `listBusyIntervals(oauth2Client, calendarId, timeMin, timeMax)` implemented on `GoogleCalendarClient`: paginated `events.list` (loops on `nextPageToken`), exact field mask `fields=items(start,end,status,transparency,extendedProperties),nextPageToken`, `singleEvents=true`, `orderBy=startTime`, `showDeleted=false`. Private `toBusyInterval()` mapper discards `status=cancelled`, `transparency=transparent`, all-day entries (`start.date` present without `start.dateTime`), and events with `extendedProperties.private.umbralGroupId` set. Reuses the existing `GoogleCalendarError`/`request()` classification unchanged (401→`invalid_grant`, 404/410→`gone`, 403/5xx/network→`transient`) — no new error type. `timeMin`/`timeMax` are received as explicit `Date` params (caller — PR 2's `CalendarBusyService` — computes `now`/`now + BUSY_WINDOW_DAYS`), keeping the client itself free of wall-clock side effects and directly testable.
- [x] **1.5** 9 new unit tests added to `google-calendar.client.spec.ts` (`describe('listBusyIntervals', …)`), fixture-based, zero real network calls (same `globalThis.fetch` mock pattern as the file's existing tests): happy-path mapping of two timed events, exact query-shape assertion (method GET, `timeMin`/`timeMax`/`singleEvents`/`showDeleted`/`fields`), cancelled dropped, transparent dropped, all-day dropped, `umbralGroupId`-tagged dropped, two-page pagination followed to completion and concatenated, 401→`invalid_grant`, 403→`transient`.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | N/A (schema) | N/A | N/A | N/A | N/A | ➖ Triangulation skipped: purely structural Prisma model, no branching logic | N/A |
| 1.2 | N/A (migration) | N/A | N/A | N/A | N/A | ➖ Triangulation skipped: additive DDL only, one possible output | N/A |
| 1.3 | N/A (constants) | N/A | N/A | N/A | N/A | ➖ Triangulation skipped: constant values, no branching | N/A |
| 1.4/1.5 | `src/modules/calendar-integration/google-calendar.client.spec.ts` | Unit | ✅ 11/11 (pre-existing insert/patch/delete tests, run before any edit) | ✅ Written — `client.listBusyIntervals is not a function` on first run (9 tests failed with that exact `TypeError`, confirmed via real `npx jest` execution, not assumed) | ✅ Passed — 19/20 green on first implementation attempt | ✅ 9 cases: happy-path mapping, query-shape, cancelled, transparent, all-day, `umbralGroupId`, pagination (2 pages), 401, 403 | ✅ Clean — generalized `request()` to accept `GET` (Content-Type only sent when `body !== undefined`) instead of duplicating a second HTTP-plumbing method for `listBusyIntervals`; re-ran full suite after refactor, still 20/20; `npx eslint --fix` applied for one prettier formatting violation, re-ran tests after the fix, still 20/20 |

One test bug was caught and fixed during GREEN, not a production bug: the query-shape assertion originally compared against `encodeURIComponent(...)`, but `URLSearchParams.toString()` (used in production code) percent-encodes `(`/`)` while `encodeURIComponent` does not — fixed the assertion to compare against `new URLSearchParams({...}).toString()` instead of hand-rolling the expected encoding.

### Test Summary

- **Total tests written**: 9 (all in `listBusyIntervals` describe block)
- **Total tests passing**: 20/20 in the file (11 pre-existing + 9 new); 583/583 across the full backend suite (51/51 suites) after this change
- **Layers used**: Unit (9)
- **Approval tests** (refactoring): None — no pre-existing `listBusyIntervals` behavior to preserve; the `request()` generalization was covered by the pre-existing 11 tests as its own safety net (all stayed green)
- **Pure functions created**: `toBusyInterval()` (private mapper, deterministic, no side effects) — the mapping logic itself, which is the actual business rule under test, has zero I/O

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx jest src/modules/calendar-integration/google-calendar.client.spec.ts` → 20/20 passed (11 pre-existing + 9 new) |
| Runtime harness command/scenario and exact result | `npx jest` (full backend suite) → 51/51 suites, 583/583 tests passed. `npx prisma validate` → "The schema at prisma\schema.prisma is valid". `npx prisma migrate deploy` against `umbral-postgres-local` → "All migrations have been successfully applied" (real local Postgres, not mocked). `npx eslint` on all 4 changed files → 0 errors after one `--fix` pass |
| Rollback boundary | Fully isolated to 4 modified files + 1 new migration directory, all scoped to `calendar-integration`: `backend/prisma/schema.prisma` (CalendarBusyBlock model + 2 new GoogleCalendarConnection columns), `backend/prisma/migrations/20260911210000_calendar_busy_block/migration.sql` (new, additive-only), `backend/src/modules/calendar-integration/calendar-integration.constants.ts` (+2 constants), `backend/src/modules/calendar-integration/google-calendar.client.ts` (+`listBusyIntervals`/`toBusyInterval`, `request()` generalized to accept GET), `backend/src/modules/calendar-integration/google-calendar.client.spec.ts` (+9 tests). Nothing outside `calendar-integration` touched. No caller anywhere in the codebase invokes `listBusyIntervals()` yet (PR 2 is the first consumer) — reverting this PR is a clean revert of these 5 paths with zero call-site cleanup needed. `git status --porcelain` before this batch showed clean (only the untracked `openspec/changes/...` dir from SDD phases); after this batch the only changes are the 4 modified files + 1 new untracked migration dir listed above. |

### Known environment blocker (does not block PR 1 completion)

`npx prisma generate` fails with `EPERM: operation not permitted, rename ... query_engine-windows.dll.node.tmp... -> query_engine-windows.dll.node` on this Windows machine, because a running dev server (`nest start --watch`, PID 4228 confirmed via `Get-CimInstance Win32_Process`) holds the current Prisma query engine binary loaded/locked. Retried twice, same result both times — not transient. **Does not block PR 1**: no file touched in this batch imports `@prisma/client`'s `CalendarBusyBlock` delegate (the model exists in `schema.prisma` and the DB now has the table, but the generated TS client types are stale until regenerated). PR 2's `CalendarBusyService` will be the first real consumer of `prisma.calendarBusyBlock` — **whoever starts PR 2 must first stop the locking dev server (or run from a fresh shell) and run `npx prisma generate` successfully**, or PR 2's code won't type-check against the new model.

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `backend/prisma/schema.prisma` | Modified | Added `CalendarBusyBlock` model, `User.calendarBusyBlocks` back-relation, `GoogleCalendarConnection.busySyncedAt`/`busySyncError` |
| `backend/prisma/migrations/20260911210000_calendar_busy_block/migration.sql` | Created | Hand-written additive migration (shadow-DB workaround per obs #1379); applied to local dev DB via `migrate deploy` |
| `backend/src/modules/calendar-integration/calendar-integration.constants.ts` | Modified | Added `BUSY_WINDOW_DAYS = 60`, `BUSY_REFRESH_CONCURRENCY = 5` |
| `backend/src/modules/calendar-integration/google-calendar.client.ts` | Modified | Added `BusyInterval`, `listBusyIntervals()`, `toBusyInterval()`; generalized `request()` to support `GET` |
| `backend/src/modules/calendar-integration/google-calendar.client.spec.ts` | Modified | Added 9 unit tests for `listBusyIntervals()`, plus `mockFetchListOnce()` helper |

### Deviations from Design

None functionally — implementation matches design.md Decision 1 exactly (field-mask, filter rules, reuse of `GoogleCalendarError`). One implementation-detail deviation, documented above: `prisma migrate dev` could not be used due to a pre-existing, unrelated shadow-DB break (engram obs #1379); the established hand-written-migration + `migrate deploy` workaround was used instead, per that same prior discovery. `timeMin`/`timeMax` are explicit method params rather than the client computing "now" internally — this is a design-compatible choice (design.md only specifies the query shape, not where `now` is computed) that keeps `listBusyIntervals()` a pure, directly-testable function; PR 2's `CalendarBusyService` owns wall-clock time via `BUSY_WINDOW_DAYS`.

### Issues Found

None in production code. One test-authoring bug was caught and fixed during the GREEN step itself (see TDD Cycle Evidence note above) — `URLSearchParams` vs. `encodeURIComponent` percent-encoding of `(`/`)` differ; not a production defect.

### Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md `chain_strategy`)
- Current work unit: PR 1 — Overlay data layer: schema + Google read client (tasks 1.1–1.5)
- Boundary: starts from PR 0's confirmed `events.list` spike result (200, no re-consent needed); ends with a tested, mergeable `listBusyIntervals()` plus its persistence layer — PR 2 (refresh job + `AvailabilityService` consumption) is the next unit and is NOT started
- Estimated review budget impact: **actual authored diff is ~435 changed lines** (schema.prisma +31/-0, constants.ts +13/-0, client.ts +101/-2, client.spec.ts +253/-0, migration.sql +37 new-file lines) — **above** tasks.md's own forecast of "~180–220, Under budget". The gap is almost entirely the test file (253 lines for 9 fixture-driven cases with real HTTP-shape assertions, vs. the ~90-line estimate) plus the `request()` refactor for GET support (component of the ~101-line client delta). Recommend **`size:exception`** for this PR: the extra lines are Strict-TDD-mandated test coverage (banned-pattern-compliant, no trivial assertions, one assertion set per filter rule) and a legitimate DRY refactor of the shared HTTP method — trimming either would mean shipping either untested filter branches or a duplicated GET-request method, both against this session's Strict TDD Mode and the project's own patterns. No code was compressed, no comments/tests were cut, and no attempt was made to iteratively shrink the diff to hit the number, per the apply-phase rule against gaming the budget.

## Status (PR 1)

5/5 tasks complete (1.1–1.5). **PR 1 DONE.** All Work Unit Evidence and TDD Cycle Evidence gates passed with real command execution (no evidence assumed or fabricated). PR 2 (refresh job + `AvailabilityService.computeSlots()` consumption + flag) is unblocked and next — but note the Prisma-client-regeneration blocker above must be resolved first by whoever picks up PR 2.

## Key Learnings

1. The local dev Postgres (`umbral-postgres-local`) currently has zero `GoogleCalendarConnection` rows, so no real refresh token is available to run the PR 0 spike.
2. This session's sandbox denies reading `backend/.env`, which holds `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_TOKEN_ENCRYPTION_KEY` needed to build the OAuth2Client and decrypt a stored refresh token.
3. Prior engram memory (obs #1316) records the connected OAuth app is still in Google's Testing status, so any previously connected refresh token expires roughly every 7 days until issue #123's verification completes.
4. `GoogleCalendarClient` exposes only `insertEvent`/`patchEvent`/`deleteEvent` today; there is no `events.list` method yet, and `getAccessToken()` is private, so PR 0's throwaway script would need to reuse `CalendarSyncService.buildOAuth2Client()`'s pattern directly rather than call an existing public read method.
5. Docker Desktop and the Postgres container are healthy and reachable, so the blocker is data/credential access, not infrastructure availability.
6. A real `GoogleCalendarConnection` (CONNECTED, `calendar.events` scope) now exists in the dev DB as of 2026-09-11, resolving the earlier "no connection" blocker.
7. The `backend/.env` deny rule is a permission-settings restriction, not a sandbox artifact — it blocks Read, Grep, and any Bash command whose text merely references the path, confirmed unchanged across two separate sessions/attempts.
8. `npx prisma migrate dev` is permanently broken on this repo's local Postgres (shadow-DB P3006/P1014 caused by the `20260812150000_enable_rls_prisma_migrations` migration) — always hand-write the migration SQL in the existing style and apply with `npx prisma migrate deploy` instead, per engram obs #1379.
9. `npx prisma generate` can fail with `EPERM` on Windows when a running `nest start --watch` dev server holds the query engine DLL locked — this blocks client-type regeneration (not schema/migration work) until that process is stopped or a fresh shell is used.
10. `URLSearchParams.toString()` percent-encodes `(` and `)`, while `encodeURIComponent()` does not — a test asserting on a `URLSearchParams`-built query string must build its expected value the same way, not with `encodeURIComponent`.
11. Refactoring `GoogleCalendarClient.request()` to add a `'GET'` method variant (Content-Type header only sent when a body is present) is a safe, minimal way to add a new HTTP verb without duplicating the existing error-classification logic — all 11 pre-existing insert/patch/delete tests stayed green through the change.
