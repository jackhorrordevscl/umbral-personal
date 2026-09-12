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

---

## Scope of this batch (PR 2 — this session, 2026-09-11)

PR 2 — Overlay refresh job + `AvailabilityService` consumption + flag (tasks 2.1–2.5 only). Strict TDD Mode active. PR 3–6 explicitly out of scope per orchestrator instruction.

### Mode

Strict TDD Mode active, test runner `npm test` (Jest) from `backend/`. Task 2.1's `OVERLAY_STALENESS_MS` constant addition is structural (triangulation skipped, single value, no branching). Tasks 2.1/2.3 followed full RED → GREEN → TRIANGULATE → REFACTOR; 2.4/2.5 are the test deliverables themselves, executed and captured as evidence inline with 2.1/2.3.

### Task Status

- [x] **2.1** `CalendarBusyService` created (`backend/src/modules/calendar-integration/calendar-busy.service.ts`): `@Cron('*/30 * * * *')`, iterates `GoogleCalendarConnection` rows with `status === 'CONNECTED'`, calls `listBusyIntervals()` per connection batched at `BUSY_REFRESH_CONCURRENCY` (simple `slice()`-based batching, `Promise.all` per batch), replaces that therapist's `CalendarBusyBlock` rows in one `$transaction` (`deleteMany` + `createMany` + `GoogleCalendarConnection.update({busySyncedAt, busySyncError: null})`), calls `AvailabilityService.invalidate(therapistId)` after a successful write. `invalid_grant` routes to `CalendarSyncService.handleInvalidGrant(connectionId)` — reused directly, not duplicated. The job never throws: `refreshConnection()` has its own try/catch (transient/generic errors are logged and persisted to `busySyncError`, never rethrown), plus a defensive `.catch()` around each `Promise.all` entry in `refresh()` as a second line of defense.
- [x] **2.2** Gated entirely behind `CALENDAR_AVAILABILITY_OVERLAY_ENABLED === 'true'` (opt-in), matching design.md "Migration / Rollout" exactly. **Deviation flagged**: tasks.md 2.2 itself documents a spec-vs-design.md discrepancy (`!== 'false'` in spec prose vs. `=== 'true'` in design.md's explicit Migration/Rollout section) and pre-resolves it in favor of design.md as "the more specific, later-validated source" — implemented that way, no independent judgment call needed here, just following the task file's own resolution.
- [x] **2.3** Sixth query added to `AvailabilityService.computeSlots()` (`availability.service.ts`), reading `CalendarBusyBlock` for the therapist/range. `computeAvailableSlots()` itself was **not modified** — the merge happens by concatenating `busyBlocks` into the same `blockouts` array passed to it, exactly matching `BlockoutInput`'s `{startsAt, endsAt}` shape (no new parameter). New constant `OVERLAY_STALENESS_MS = 90 * 60 * 1000` (3× the cron interval, tolerates one missed tick) added to `calendar-integration.constants.ts`. **Design decision (mechanical, documented inline)**: staleness can only be known by reading `GoogleCalendarConnection.busySyncedAt`, which requires its own query — implemented as a pre-check query that runs *only* when the flag is on, BEFORE the main `Promise.all`; the `CalendarBusyBlock` query itself is added to the `Promise.all` (as the "sixth parallel query") only when that pre-check proves the overlay fresh, and is skipped entirely (not queried-and-discarded) when the flag is off, the connection is missing, or `busySyncedAt` is stale. Flag off costs zero extra queries — verified by unit test asserting `googleCalendarConnection.findUnique`/`calendarBusyBlock.findMany` are never called, and by the E2E in 2.5.
- [x] **2.4** Unit tests added in two files:
  - `calendar-busy.service.spec.ts` (new, 5 tests): successful refresh replaces `CalendarBusyBlock` rows in a transaction + sets `busySyncedAt` + calls `invalidate()`; flag off skips everything (no `findMany`/no Google call); `invalid_grant` routes to `CalendarSyncService.handleInvalidGrant` and the job resolves without throwing; a generic/transient error is logged + persisted to `busySyncError` without propagating (triangulation against the invalid_grant case); one connection failing (invalid_grant) does not stop a sibling connection's batch from succeeding (isolation).
  - `availability.service.spec.ts` (new `describe('AvailabilityService (calendar overlay)', …)` block, 4 tests): flag off → 4/4 slots, zero overlay queries; flag on + fresh overlay → busy block merges into `blockouts` and the exact covered slot (3/4 remaining) disappears, with an exact `where`-clause assertion on the `calendarBusyBlock.findMany` call; flag on + stale `busySyncedAt` (2h old, > `OVERLAY_STALENESS_MS`) → 4/4 slots, zero `calendarBusyBlock.findMany` calls; flag on + no `GoogleCalendarConnection` row at all (triangulation: "missing" treated the same as "stale") → same zero-query, 4/4-slots outcome.
- [x] **2.5** E2E test added: `backend/test/calendar-busy-overlay.e2e-spec.ts` (new, 2 tests, real Postgres via `umbral-postgres-local`, no flag override — proves the *actual default* is off). Seeds a real therapist with a weekly rule, a real `CONNECTED` `GoogleCalendarConnection` with a fresh `busySyncedAt`, and a real `CalendarBusyBlock` row that covers exactly one slot. Test 1 asserts that covered slot is still present in the live HTTP response. Test 2 asserts the response is byte-identical (`toEqual`) whether or not the `CalendarBusyBlock` row exists. **Dates are computed dynamically** (`nextMondayDayKeyWithMargin()`, reusing `chile-time.util.ts`'s own tested helpers) rather than hardcoded, because a hardcoded `2026-06-01` fixture (copied from `availability.service.spec.ts`'s fixed-clock unit tests) is now in the **past** relative to the real system clock (2026-09-11) and was silently filtered out by `computeAvailableSlots()`'s lead-time/horizon bounds — caught as a genuine RED failure during this batch (see Issues Found).

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `src/modules/calendar-integration/calendar-busy.service.spec.ts` | Unit | ✅ 40/40 (`calendar-sync.service.spec.ts` + `availability.service.spec.ts` run before any edit) | ✅ Written — `Cannot find module './calendar-busy.service'` on first run (confirmed via real `npx jest` execution) | ✅ Passed — 18/18 (13 pre-existing + 5 new) on first implementation attempt | ✅ 5 cases: success path, flag-off, invalid_grant routing, generic-error non-propagation, per-connection isolation | ✅ Clean — no refactor needed beyond initial structure; `npx eslint --fix` applied for prettier-only formatting (1 unrelated `no-unsafe-assignment` on `expect.any(Date)` fixed by matching the project's established `as unknown as Date` cast pattern, found via grep across the codebase) |
| 2.3 | `src/modules/availability/availability.service.spec.ts` | Unit | ✅ 27/27 pre-existing `AvailabilityService` tests (cache/CRUD describe blocks) run before any edit | ✅ Written — "fusiona CalendarBusyBlock..." test failed with `Expected length: 3, Received length: 4` (overlay not yet merged) on first run; the other 3 new tests passed trivially pre-implementation because they assert *absence* of a query, which was already true before this task existed — flagged honestly, not claimed as RED evidence for those 3 | ✅ Passed — 31/31 in the file after implementing the pre-check + conditional sixth query | ✅ 4 cases: fresh-merge, flag-off, stale, missing-connection (missing explicitly triangulated against stale to prove they resolve the same way through independent code paths) | ✅ Clean — extracted `busyBlocksQuery` as a typed `Promise<Pick<CalendarBusyBlock, 'startsAt' \| 'endsAt'>[]>` default-resolved to `[]`, so the merge step (`busyBlocks.length > 0 ? [...blockouts, ...busyBlocks] : blockouts`) needs no separate flag branch at merge time |
| 2.5 | `test/calendar-busy-overlay.e2e-spec.ts` | E2E | N/A (new file) | N/A — E2E against real Postgres, not a unit RED/GREEN cycle; see "Issues Found" for the real bug this test caught before it could even run meaningfully | ✅ Passed — 2/2 against real `umbral-postgres-local`, confirmed via `npx jest --config ./test/jest-e2e.json` | ➖ Single scenario per test (2 tests cover 2 distinct properties: "slot survives" and "byte-identical with/without the row") | N/A — no refactor pass needed |

**Manual counter-proof (not part of the automated evidence table, done for extra confidence)**: temporarily forced `CALENDAR_AVAILABILITY_OVERLAY_ENABLED='true'` in the E2E's `beforeAll` and re-ran test 1 in isolation — it **failed** exactly as expected (the seeded busy block did eliminate the slot), confirming the test is not vacuously true. Reverted immediately after confirming.

### Test Summary

- **Total tests written**: 11 (5 `CalendarBusyService` unit + 4 `AvailabilityService` overlay unit + 2 E2E)
- **Total tests passing**: 592/592 across the full backend unit suite (52/52 suites); 18/18 for the 3 e2e suites re-run as safety net (`calendar-busy-overlay`, `public-scheduling`, `calendar-integration`)
- **Layers used**: Unit (9), E2E (2)
- **Approval tests** (refactoring): None — no pre-existing `computeSlots()`/`CalendarBusyService` behavior to preserve beyond what the pre-existing 40 baseline tests already cover as a safety net
- **Pure functions created**: None new — this PR wires I/O (Prisma, `CalendarSyncService`, `AvailabilityService`) around the already-pure `computeAvailableSlots()`, which stayed untouched by design

### Deviations from Design

1. **Scope-tracking check omitted from `CalendarBusyService` (tasks.md 2.1 literal text vs. actual implementation)**: tasks.md 2.1 asks the job to "skip connections without the read scope (per calendar-sync delta — see PR 3...)". Per explicit orchestrator instruction for this batch (grounded in PR 0's confirmed spike result: `events.list` returns 200 under the existing `calendar.events` scope, zero re-consent needed), this check was intentionally omitted — the job iterates every `CONNECTED` connection unconditionally. Documented inline in `calendar-busy.service.ts` with a `NOTE (deviation, ...)` comment pointing back here. This does not block or weaken PR 3 — PR 3 remains free to add scope tracking as bookkeeping/observability, per tasks.md's own note that Decision 1's finding may make PR 3 "much smaller ... or droppable".
2. **`buildOAuth2Client()`/`handleInvalidGrant()` visibility widened from `private` to public on `CalendarSyncService`**: tasks.md 2.1 explicitly left this as "a mechanical decision" (extract to a shared place, or call from CalendarSyncService directly). Chose the minimal-diff option — widen visibility, inject `CalendarSyncService` into `CalendarBusyService`, call both methods directly — over extracting a new shared helper class, since both methods already live on the one service that owns Google OAuth/error-classification semantics for this module, and duplicating them would risk exactly the two-jobs-diverge failure mode design.md wants to avoid.
3. **Staleness pre-check adds a 6th-ish query when the flag is on** (see 2.3 above): tasks.md frames this as strictly "the sixth parallel query", but determining staleness requires reading `GoogleCalendarConnection.busySyncedAt` first, which is a separate table from `CalendarBusyBlock`. Resolved by running that check as a lightweight pre-`Promise.all` read *only when the flag is on* (zero cost when off, which is what tasks.md/design.md actually gate on), and treating "skip the query entirely" as applying to the `CalendarBusyBlock` read specifically, not to every possible overlay-related read. No network call to Google happens either way — `computeSlots()` never called Google before this PR and still doesn't.

### Issues Found

1. **Real bug caught during E2E authoring, not a pre-existing production bug**: the first draft of `calendar-busy-overlay.e2e-spec.ts` reused a hardcoded `2026-06-01` fixture date (copied from `availability.service.spec.ts`'s fixed-clock unit tests). Against the real system clock (2026-09-11, per environment), that date is now in the **past**, so `computeAvailableSlots()`'s `MIN_LEAD_TIME_MS`/`MAX_HORIZON_MS` bounds silently returned zero slots for that range — the test failed with `Expected: true, Received: false` on the very first run. Fixed by computing the target Monday dynamically off the real clock (`nextMondayDayKeyWithMargin()`, reusing `chile-time.util.ts`'s own tested helpers instead of hand-rolled date math). Flagging this because it is a trap any future E2E test with a hardcoded near-term date will eventually fall into as real time passes — not specific to this PR's production code.

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `backend/src/modules/calendar-integration/calendar-busy.service.ts` | Created | `CalendarBusyService`: `@Cron` refresh job, per-connection isolation, transaction-based `CalendarBusyBlock` replace, `invalid_grant` routing |
| `backend/src/modules/calendar-integration/calendar-busy.service.spec.ts` | Created | 5 unit tests for `CalendarBusyService` |
| `backend/src/modules/calendar-integration/calendar-integration.module.ts` | Modified | Registered `CalendarBusyService` as a provider; imported `AvailabilityModule` |
| `backend/src/modules/calendar-integration/calendar-sync.service.ts` | Modified | `buildOAuth2Client()`/`handleInvalidGrant()` widened from `private` to public (reused by `CalendarBusyService`) |
| `backend/src/modules/calendar-integration/calendar-integration.constants.ts` | Modified | Added `OVERLAY_STALENESS_MS = 90 * 60 * 1000` |
| `backend/src/modules/availability/availability.service.ts` | Modified | Added `ConfigService` + `overlayEnabled` field; sixth conditional query merging `CalendarBusyBlock` into `blockouts` inside `computeSlots()`; `computeAvailableSlots()` untouched |
| `backend/src/modules/availability/availability.service.spec.ts` | Modified | Added `ConfigService` mock (`buildConfig()`) to the 2 pre-existing manual `AvailabilityService` instantiations; added new `describe('AvailabilityService (calendar overlay)', …)` block (4 tests) |
| `backend/test/calendar-busy-overlay.e2e-spec.ts` | Created | 2 E2E tests against real Postgres proving flag-off byte-identity, with dynamically computed future dates |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx jest calendar-busy.service.spec.ts availability.service.spec.ts calendar-sync.service.spec.ts public-scheduling.service.spec.ts` → 58/58 passed |
| Runtime harness command/scenario and exact result | `npx jest --config ./test/jest-e2e.json --forceExit calendar-busy-overlay.e2e-spec.ts public-scheduling.e2e-spec.ts calendar-integration.e2e-spec.ts` → 18/18 passed, against real `umbral-postgres-local` (not mocked). `npx tsc --noEmit -p tsconfig.json` → clean, zero errors. `npx eslint` on all 8 touched files → 0 errors (after one `--fix` pass for prettier-only formatting + 1 manual `no-unsafe-assignment` fix) |
| Rollback boundary | 8 files total: 3 new (`calendar-busy.service.ts`, `calendar-busy.service.spec.ts`, `test/calendar-busy-overlay.e2e-spec.ts`), 5 modified, all scoped to `calendar-integration`/`availability`/`test`. No caller outside `CalendarIntegrationModule` invokes `CalendarBusyService`; `AvailabilityService.computeSlots()`'s new code path is fully flag-gated and no-ops identically to pre-PR behavior when `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` is unset (the real production default) — reverting this PR's diff is a clean revert with zero call-site cleanup elsewhere in the codebase |

Full backend unit suite re-run after this batch: **592/592 passed, 52/52 suites** (up from 583/583, 51/51 at the end of PR 1 — net +9 unit tests; the other +2 are the new E2E suite, not counted in the unit-suite number).

### Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md `chain_strategy`)
- Current work unit: PR 2 — Overlay refresh job + `AvailabilityService` consumption + flag (tasks 2.1–2.5)
- Boundary: starts from PR 1's tested `listBusyIntervals()` + `CalendarBusyBlock` persistence layer; ends with a tested, mergeable refresh job + flag-gated `computeSlots()` consumption. PR 3 (OAuth scope broadening — largely bookkeeping now per PR 0's finding) and PR 4/5 (Slice B, independent) are NOT started.
- Estimated review budget impact: **actual authored diff is ~830 changed lines** (3 new files: `calendar-busy.service.ts` 144, `calendar-busy.service.spec.ts` 181, `calendar-busy-overlay.e2e-spec.ts` 197 = 522 new-file lines; 5 modified files: +267/-41 = 308 diff lines) — **well above** tasks.md's own forecast of "~220–260, Under budget, near midpoint". Same root cause as PR 1's own over-budget note: the gap is almost entirely test code (5 `CalendarBusyService` unit tests + 4 `AvailabilityService` overlay unit tests + 2 real-Postgres E2E tests, all Strict-TDD-mandated, banned-pattern-compliant, one assertion set per behavior, no trivial/tautological assertions) plus the extensive Spanish-language design-rationale comments this codebase's convention requires on every new file (matching the density already present in `calendar-sync.service.ts`/`google-calendar.client.ts`). Recommend **`size:exception`** for this PR, same as PR 1: trimming would mean cutting either test coverage (flag-off byte-identity, staleness, isolation, invalid_grant routing) or the inline design-decision documentation this codebase already relies on elsewhere — no code was compressed, no comments/tests were cut, and no attempt was made to iteratively shrink the diff to hit the number, per the apply-phase rule against gaming the budget.

## Status (PR 2)

5/5 tasks complete (2.1–2.5). **PR 2 DONE.** All Work Unit Evidence and TDD Cycle Evidence gates passed with real command execution (no evidence assumed or fabricated) — including a real Postgres E2E run and a manual counter-proof that the flag-off test is not vacuously true. PR 3 (OAuth scope broadening — likely much smaller than originally scoped, per PR 0's finding) and Slice B (PR 4–5, independent) are unblocked and next; this batch did not start either.

---

## Scope of this batch (PR 3 — this session, 2026-09-11)

PR 3 — OAuth scope broadening + re-consent (`calendar-sync` delta), tasks 3.1–3.4. Reconciliation batch, explicitly out of TDD scope: no production code or tests were due unless real tracking value was found. PR 4–6 explicitly out of scope per orchestrator instruction.

### Reconciliation decision (documented per explicit instruction, not escalated to the user)

Re-read `tasks.md` PR 3 (3.1–3.4), `design.md` Decision 1, and `specs/calendar-sync/spec.md`'s MODIFIED "OAuth Connection Lifecycle" requirement before deciding.

**Question**: does PR 3 reduce to a documented no-op, or does it still have real value (e.g., tracking pre-overlay vs. post-overlay connections for audit/observability, or hedging against a future Google policy change)?

**Decision: no-op.** Reasoning:

1. **Design.md Decision 1 is not conditional — it is the chosen, permanent architecture.** `events.list` reads under the existing `calendar.events` scope is not "sufficient for now, revisit later"; it is the accepted alternative to `freebusy.query` + a new scope, full stop. There is no plan, roadmap item, or open question anywhere in `design.md`/`proposal.md` suggesting a second scope is still coming. Building tracking infrastructure for a scope-broadening event that this same change's own design explicitly rejected would be scope-tracking fiction.
2. **PR 1 and PR 2 already confirm this in code, not just in the spike.** `google-calendar.client.ts#listBusyIntervals()` (PR 1) takes no scope parameter and has no scope-conditional branch. `calendar-busy.service.ts#refresh()` (PR 2) iterates every `status: 'CONNECTED'` connection with **zero** scope check — and PR 2's own inline comment (`calendar-busy.service.ts:30-36`) already documents this exact deviation, written *before* this PR 3 batch even started, anticipating precisely the question this batch was asked to resolve. There is no gate anywhere in the shipped code for a `hasReadScope`/`scopes` field to feed.
3. **A "pre-overlay vs. post-overlay" audit field was considered and rejected.** The candidate value proposed by the orchestrator's instructions — tracking which connections were created before vs. after this release, in case Google changes its scope policy later — has no current consumer (nothing reads it), tracks no current distinction (every `CONNECTED` connection today has identical, full read access under `calendar.events`), and hedges against a hypothetical future Google policy change that is explicitly not in this release's scope. If Google ever does require a second scope, that is a new problem needing its own spike and its own design decision (a real `freebusy`-style migration, most likely, per the `design.md` Decision 1 comparison table) — not something a silent bookkeeping field added now, against nothing, would meaningfully prepare for. Building it now would be unrequested, unjustified scope.
4. **The base `calendar-sync` spec (`openspec/specs/calendar-sync/spec.md`) already states the correct, current behavior**: "requesting only `calendar.events`" and "requests no other scope". The delta's MODIFIED block was the part describing a mechanism that turns out to have no functional referent. Reconciling the delta to carry no `MODIFIED Requirements` block (rather than a modified-but-neutered one) means nothing merges into the base spec at archive time — the base spec stays exactly correct, with zero risk of an orphaned "re-consent" requirement surviving into the source of truth.

**No code was written.** No test was written. Per explicit batch instruction: "NO implementes tracking de scope ficticio" and "no inventes tests para código que no se escribe" — both honored.

### Task Status

- [x] **3.1** Scope tracking field — **not implemented**, reconciled as unnecessary (Reasoning #1–3 above). No `scopes`/`hasReadScope` column added to `GoogleCalendarConnection`; no migration.
- [x] **3.2** OAuth consent scope-broadening request — **not implemented**. `calendar-oauth.service.ts` is untouched by this batch; it still requests only `calendar.events`, exactly matching the base spec's unmodified requirement.
- [x] **3.3** Re-consent path — **not implemented**. There is no second scope to re-consent to; no distinct trigger, no reuse of the connect flow for this purpose.
- [x] **3.4** Unit/integration tests for pre-existing vs. re-consented connections — **not implemented**. No test was authored for behavior that does not exist in production code. PR 2.4's existing `CalendarBusyService` tests (uniform treatment of every `CONNECTED` connection, `invalid_grant` isolation) remain the correct and sufficient coverage for the real behavior.

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `openspec/changes/public-booking-payment-calendar/specs/calendar-sync/spec.md` | Rewritten | Replaced the `MODIFIED Requirements` block (OAuth scope broadening + re-consent) with a reconciliation note. No `ADDED`/`MODIFIED`/`REMOVED` blocks remain — nothing merges into `openspec/specs/calendar-sync/spec.md` at archive time; the base spec's existing "only `calendar.events`" requirement stays correct and untouched. |
| `openspec/changes/public-booking-payment-calendar/tasks.md` | Modified | PR 3 header marked "RECONCILED AS NO-OP"; 3.1–3.4 marked `[x]` with per-task "not implemented" rationale; PR 3's Review Workload Forecast row updated to 0 lines/None risk; one new Key Learning entry added recording the reconciliation. |

No production or test code files were touched — by design, per the batch instruction not to invent scope tracking or tests for code that was never written.

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | N/A — no code authored this batch, nothing to test (per Strict TDD Mode, no test is invented for behavior that was not built) |
| Runtime harness command/scenario and exact result | `rg -n "hasReadScope\|scopes\|readScope" backend/src/modules/calendar-integration/calendar-busy.service.ts backend/src/modules/calendar-integration/*.ts backend/prisma/schema.prisma` → no matches, confirming PR 1/PR 2 never introduced any scope-gating surface for PR 3 to have completed against |
| Rollback boundary | 2 files changed, both `.md` documentation under `openspec/changes/public-booking-payment-calendar/`: `specs/calendar-sync/spec.md` (full rewrite, delta-only, no production spec touched) and `tasks.md` (PR 3 section + forecast table row + one Key Learnings line). Zero production or test files touched. Reverting this batch is a clean two-file revert with no call-site or behavioral impact anywhere in the codebase. |

### Deviations from Design

None from `design.md` — this batch's conclusion is that `design.md` Decision 1 was already fully realized by PR 1/PR 2, and PR 3 as originally scoped in `tasks.md` (written before PR 0's spike ran) was an artifact of planning ahead of the spike result. `tasks.md`'s own PR 3 closing note anticipated this outcome ("PR 3 may be much smaller ... or droppable ... resolve this against the spike output") — this batch is that resolution, not a deviation from it.

### Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md `chain_strategy`) — reconciliation batch, not a code-shipping PR
- Current work unit: PR 3 — OAuth scope broadening + re-consent (tasks 3.1–3.4), reconciled to a documentation-only no-op
- Boundary: starts from PR 2's shipped, scope-check-free `CalendarBusyService`; ends with the `calendar-sync` delta spec and `tasks.md` both reflecting reality. PR 4 (payments checkout exposure, Slice B, independent) is next and NOT started by this batch.
- Estimated review budget impact: ~35 changed lines total (spec.md rewrite ~20 lines net, tasks.md diff ~15 lines net) — negligible, well under budget. No `size:exception` needed.

## Status (PR 3)

4/4 tasks complete (3.1–3.4), all as documented no-ops with explicit rationale — **PR 3 RECONCILED, DONE.** No production code, no tests, no migration. `calendar-sync` delta spec updated to carry no `MODIFIED Requirements` block. `tasks.md` PR 3 section, forecast table, and Key Learnings updated. PR 4 (payments checkout exposure, Slice B) is unblocked and next; PR 6's final integration pass now depends on PR 2 + PR 5 only (PR 3 has no runtime behavior to verify at that gate beyond the doc/spec state already committed here).

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
12. **PR 3 reconciled to a documented no-op**: `design.md` Decision 1's `events.list`-under-existing-scope finding is a permanent architectural choice, not a temporary workaround pending a future scope-broadening PR. PR 1 and PR 2 were already built and shipped with zero scope-checking surface — PR 2's own inline comment (written during PR 2, before this reconciliation batch) already flagged the exact deviation this batch confirms. A speculative "pre-overlay vs. post-overlay connection" observability field was considered and explicitly rejected: it would have no current consumer and would hedge against a hypothetical future Google policy change that is out of scope for this release. The reconciliation is documentation-only — `specs/calendar-sync/spec.md` now carries no `MODIFIED Requirements` block (nothing merges into the base spec at archive time), and `tasks.md` PR 3 is marked complete with per-task rationale rather than left `[ ]` against work that was correctly decided not to be built.

---

## Scope of this batch (PR 5a — this session, 2026-09-11)

PR 5a — Public scheduling: **backend half only** of PR 5 (tasks 5.1, 5.2, 5.6). Tasks 5.3–5.5 (frontend: `getBookingCheckout()` wrapper, polling UI, `flow_return` handling) are explicitly out of scope for this batch — a separate "PR 5b" batch, per orchestrator instruction, to keep the diff under the 400-line review budget (PR 5 combined was forecast at ~260–320 but flagged as the PR most likely to need a split). PR 6 (docs/rollback pass) also explicitly out of scope.

### Mode

Strict TDD Mode active, test runner `npm test` (Jest) from `backend/`. Full RED → GREEN → REFACTOR cycle followed for 5.1/5.2, with real RED evidence captured via `git stash` (see TDD Cycle Evidence below) rather than authored from a from-scratch RED-first pass — implementation and tests were designed together in this batch, then the production changes were temporarily stashed and the test suite re-run against the pre-change code to obtain a genuine RED baseline before restoring GREEN, so RED is real (verified failures), not fabricated or assumed. 5.6 is the test deliverable itself (unit + e2e), executed and captured as evidence inline with 5.1/5.2.

### Task Status

- [x] **5.1** `checkout: CheckoutHint` (`{ status: 'PENDING' } | { status: 'NOT_APPLICABLE' }`) added to `PublicSchedulingService.book()`'s response, gated by `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED === 'true'` (opt-in, same convention as `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` from PR 2 — confirmed, not re-derived, since design.md's "Migration/Rollout" section is explicit about both flags sharing this convention). With the flag off, `book()`'s return value is completely unchanged — no `checkout` key, and `PaymentAccount` is never queried (verified by an explicit `expect(prisma.paymentAccount.findUnique).not.toHaveBeenCalled()` test). `resolveCheckoutHint()` (new private method) checks `patient.defaultSessionAmount` first (already available on the `Patient` object `resolveForPublicBooking()` returns — no extra query) and short-circuits to `NOT_APPLICABLE` when null/undefined *before* touching `PaymentAccount` at all; only then does it read `PaymentAccount.status` directly via Prisma (not `PaymentAccountService.resolveGatewayContext()`, which decrypts credentials for a context this hint never uses — see Deviations). The known-issue comment (tasks.md 6.4: a public-booking-autocreated patient never has `defaultSessionAmount`, so never generates a charge) is written inline directly above the amount-unresolvable branch in `resolveCheckoutHint()`, per explicit instruction.
- [x] **5.2** `GET /public/therapists/:therapistId/availability/book/:groupId/checkout` added to `PublicSchedulingController`, delegating to `PaymentsService.findCheckoutForBooking` (PR 4.1) unchanged — no auth guard, covered by `PublicScheduleThrottlerGuard`. The route reuses the existing `'public-availability'` named throttler bucket instead of registering a third one (see Deviations — this is a documented, tested decision, not an omission). The controller's `SkipThrottle` exhaustiveness test (`public-scheduling.controller.spec.ts`) was extended with a third `it.each` case for `getCheckout` (skips all foreign throttlers + `'public-booking'`) plus one new explicit test asserting `getCheckout` does **not** skip `'public-availability'` (proving the bucket-sharing is deliberate, not a gap the exhaustiveness table would otherwise have caught as "should skip but doesn't").
- [x] **5.6** Integration tests across three files:
  - `public-scheduling.service.spec.ts`: new `describe('checkout hint (PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED)', …)` block, 5 tests — flag off (no `checkout` key, zero `PaymentAccount` queries); flag on + no `defaultSessionAmount` → `NOT_APPLICABLE`; flag on + amount resolvable + `PaymentAccount.status = 'PENDING'` → `NOT_APPLICABLE`; flag on + amount resolvable + no `PaymentAccount` row at all → `NOT_APPLICABLE` (triangulated against the `PENDING`-status case to prove both non-`CONNECTED` shapes resolve the same way); flag on + amount resolvable + `PaymentAccount.status = 'CONNECTED'` → `PENDING`.
  - `public-scheduling.controller.spec.ts`: 1 new delegation test (`getCheckout` → `PaymentsService.findCheckoutForBooking` with the route's `:groupId`) + 2 exhaustiveness-table additions described in 5.2 above.
  - `backend/test/public-booking-checkout.e2e-spec.ts` (new file, 3 tests, real Postgres via `umbral-postgres-local`, no mocks): seeds a real therapist with a weekly rule and **deliberately no** `GoogleCalendarConnection`/`PaymentAccount` row (Flow and Google both "unavailable" in the exact sense spec.md and proposal.md's success criteria require). Test 1 books an actual slot end-to-end (201, real `Consultation`+`Patient`+`BookedSlot` rows) and asserts `checkout: { status: 'NOT_APPLICABLE' }` (new patient, no `defaultSessionAmount` — the known-issue path). Test 2 hits the checkout endpoint with no `Authorization` header (not 401) and, with no `Payment` row yet, asserts the response is **exactly** `{ paymentUrl: null }` (`Object.keys` check, not just `toMatchObject`). Test 3 seeds a real `Payment` row for that same `groupId` with an extra `gatewayToken` field set to a sentinel value that must never appear in the response, then asserts the response is **exactly** `{ paymentUrl, amount }` — proving the leak boundary holds at the real HTTP/Prisma-`select` layer, not just in the unit-level mock from PR 4.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.1/5.2 (unit) | `public-scheduling.service.spec.ts`, `public-scheduling.controller.spec.ts` | Unit | ✅ 25/25 pre-existing tests in both files run before any edit | ✅ Real, verified via `git stash` — production changes to `service.ts`/`controller.ts`/`module.ts` were temporarily reverted and the full new test set re-run: **7 failed as expected** (`TypeError: controller.getCheckout is not a function`, `toMatchObject` mismatches showing the plain consultation object with no `checkout` key, `Reflector.get` throwing on an undefined handler) — not assumed, not fabricated | ✅ Passed — `git stash pop` restored the implementation; same test set re-run, 32/32 green in `src/modules/public-scheduling/` | ✅ 5 cases for the checkout hint alone (flag-off, no-amount, not-connected-via-PENDING, not-connected-via-missing-row, connected-and-resolvable) + 1 delegation + 3 exhaustiveness assertions | ✅ Clean — no refactor pass needed beyond the initial structure; `npx eslint --fix` applied for prettier-only formatting (CRLF line-ending diffs in the two spec files, `npx eslint` reported 0 remaining errors after) |
| 5.6 (e2e) | `backend/test/public-booking-checkout.e2e-spec.ts` | E2E | N/A (new file) | ✅ Real — same `git stash` revert, e2e suite re-run against real Postgres: **all 3 tests failed** (test 2 got a 404/non-200 status because `book/:groupId/checkout` didn't exist as a route yet, cascading into test 3's `PrismaClientValidationError: Argument groupId is missing` because `groupId` was never captured from the earlier failing assertions) — confirmed via real `npx jest --config ./test/jest-e2e.json` execution, not assumed | ✅ Passed — 3/3 against real `umbral-postgres-local` after `git stash pop`, confirmed via real execution | ➖ 3 distinct scenarios per test (booking success + NOT_APPLICABLE, no-Payment-yet leak shape, Payment-exists leak shape with a sentinel field that must never appear) — no further triangulation needed, each test proves a structurally different property | N/A — no refactor pass needed |

One extra piece of rigor beyond the mandatory cycle: after the `git stash pop` restoring GREEN, the local dev DB was checked directly (`docker exec umbral-postgres-local psql … SELECT count(*) FROM "User" WHERE email LIKE 'public-booking-checkout.%' AND "deletedAt" IS NULL`) to confirm the RED run's `afterAll` cleanup ran correctly despite the test failures (it did — 0 orphaned rows), since `try/finally` around cleanup was itself part of what this batch was testing indirectly.

### Test Summary

- **Total tests written**: 13 (5 checkout-hint unit tests in `public-scheduling.service.spec.ts` + 1 delegation + 2 exhaustiveness in `public-scheduling.controller.spec.ts` + 3 e2e + 2 more granular exhaustiveness sub-assertions folded into the `it.each` table)
- **Total tests passing**: 605/605 across the full backend unit suite (52/52 suites, up from 592/592 at the end of PR 2 — PR 3 added none, PR 4 added its own set not tracked in this file); 3/3 new e2e + 8/8 re-run of `public-scheduling.e2e-spec.ts`/`calendar-busy-overlay.e2e-spec.ts` as regression safety net
- **Layers used**: Unit (10), E2E (3)
- **Approval tests** (refactoring): None — no pre-existing `book()` behavior needed preservation beyond what the pre-existing 25 baseline tests already cover as a safety net (all stayed green)
- **Pure functions created**: None new as a standalone export — `resolveCheckoutHint()` is a private method with one I/O read (`PaymentAccount.status`), not a pure function, but its branching logic (amount-then-status) is fully exercised by the 5 triangulated unit tests without needing extraction

### Deviations from Design

1. **`resolveCheckoutHint()` reads `PaymentAccount.status` directly via Prisma, not `PaymentAccountService.resolveGatewayContext()`**: tasks.md 5.1 says `NOT_APPLICABLE` when `PaymentAccount.status !== CONNECTED` — literally a status check. `resolveGatewayContext()` (used by `PaymentsService.ensureCharge()`) does more than that: it also validates `credentialVersion === 2` and **decrypts** the stored credentials to build a full gateway context, which this hint never uses (it only needs a yes/no). Decrypting on every public, unauthenticated booking request for a value that's immediately discarded is unnecessary crypto cost on a public-facing path. The tradeoff: a legacy `credentialVersion !== 2` `CONNECTED` account (an extreme, temporary migration-window edge case per `payment-account.service.ts`'s own comment) would show `PENDING` here even though `ensureCharge()` would ultimately treat it as `null`/not-connected and never create a charge — the poll simply exhausts its budget and falls back to the email-only copy in that rare window, which is a degraded-but-safe outcome, not a broken one.
2. **The checkout endpoint reuses the `'public-availability'` throttler bucket instead of a new named one**: see the Key Learnings entry added to `tasks.md` for the full blast-radius reasoning (a third bucket would force edits across `auth.controller.ts`, `profile.controller.ts`, `email-change.controller.ts` — none of which this batch's scope touches). Documented inline in the controller and tested explicitly (not just implied by omission).
3. **No `PaymentAccountModule`/`PaymentAccountService` dependency added to `PublicSchedulingModule`**: only `PaymentsModule` was imported (for `PaymentsService`, needed by the controller's new endpoint). The service-level `resolveCheckoutHint()` reads `PaymentAccount` through the already-injected `PrismaService` instead of adding a second payments-related dependency — smaller DI surface, no new test-double needed beyond extending the existing `prisma` mock in `public-scheduling.service.spec.ts` with a `paymentAccount.findUnique` stub.

None of these are design.md contradictions — design.md's "Interfaces / Contracts" section specifies `CheckoutHint`'s two states and their trigger conditions abstractly ("account not CONNECTED, or no amount"); it does not mandate a specific service call or throttler bucket, both of which are implementation-detail choices made here for cost/blast-radius reasons and documented for the next reader.

### Issues Found

None in production code. No test-authoring bugs this batch (unlike PR 1's `URLSearchParams` encoding trap or PR 2's hardcoded-date trap) — the e2e file's dynamic Monday computation was copied directly from the already-fixed `calendar-busy-overlay.e2e-spec.ts` pattern, avoiding a repeat of that exact class of bug.

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `backend/src/modules/public-scheduling/public-scheduling.service.ts` | Modified | Added `CheckoutHint` type, `checkoutInlineEnabled` field, `resolveCheckoutHint()` private method; `book()` now conditionally returns `{ ...consultation, checkout }` |
| `backend/src/modules/public-scheduling/public-scheduling.controller.ts` | Modified | Added `PaymentsService` injection, `GET book/:groupId/checkout` → `getCheckout()` |
| `backend/src/modules/public-scheduling/public-scheduling.module.ts` | Modified | Imported `PaymentsModule` |
| `backend/src/modules/public-scheduling/public-scheduling.service.spec.ts` | Modified | Extended `prisma` mock with `paymentAccount.findUnique`; extended `buildService()` with a `checkoutInlineEnabled` param; added 5 new tests |
| `backend/src/modules/public-scheduling/public-scheduling.controller.spec.ts` | Modified | Injected `PaymentsService` mock; added 1 delegation test + 2 exhaustiveness-table entries |
| `backend/test/public-booking-checkout.e2e-spec.ts` | Created | 3 e2e tests against real Postgres: booking success + `NOT_APPLICABLE`, no-Payment leak shape, Payment-exists leak shape |
| `openspec/changes/public-booking-payment-calendar/tasks.md` | Modified | 5.1/5.2/5.6 marked `[x]`; PR 5 forecast row updated to record the executed 5a/5b split; one new Key Learnings entry on the throttler-bucket-reuse decision |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx jest src/modules/public-scheduling/` → 32/32 passed (5 suites) |
| Runtime harness command/scenario and exact result | `npx jest --config ./test/jest-e2e.json --forceExit public-booking-checkout.e2e-spec.ts public-scheduling.e2e-spec.ts calendar-busy-overlay.e2e-spec.ts` → 11/11 passed against real `umbral-postgres-local` (not mocked). `npx jest` (full backend suite) → 605/605 passed, 52/52 suites. `npx tsc --noEmit -p tsconfig.json` → clean, zero errors. `npx eslint` on all 6 touched files → 0 errors (after one `--fix` pass for prettier/CRLF-only formatting) |
| Rollback boundary | 6 files: 5 modified (`public-scheduling.service.ts`, `public-scheduling.controller.ts`, `public-scheduling.module.ts`, and their two spec files) + 1 new e2e file, all scoped to `public-scheduling` (plus the `PaymentsModule` import, which was already a stable, exported dependency — no change to `payments.module.ts`/`payments.service.ts` itself). No caller outside `PublicSchedulingModule` was touched. Reverting is a clean revert of these 6 paths; `findCheckoutForBooking()` (PR 4.1) and `createFromPublicBooking()`'s `checkoutUrl` field (PR 4.3) are untouched and keep working exactly as PR 4 left them regardless of whether PR 5a is reverted. |

Full backend unit suite re-run after this batch: **605/605 passed, 52/52 suites** (up from 592/592, 52/52 suites at the end of PR 2 — PR 3 added no code; the actual net for this batch alone is +13 tests, 605-592).

### Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md `chain_strategy`), explicitly split by the orchestrator into **5a** (this batch, backend-only) and **5b** (frontend, separate future batch) to stay under the review budget
- Current work unit: PR 5a — Public scheduling backend: `checkout` hint + checkout endpoint + integration tests (tasks 5.1, 5.2, 5.6)
- Boundary: starts from PR 4's `findCheckoutForBooking()`/`checkoutUrl` (already shipped, untouched by this batch); ends with a tested, mergeable backend surface for the checkout hint and polling endpoint. PR 5b (tasks 5.3–5.5: `frontend/src/api/publicScheduling.ts`, `PublicBookingPage.tsx` polling UI, `flow_return` handling) is explicitly NOT started — it is a separate batch by design, not an oversight. PR 6 (docs/rollback verification pass) also NOT started.
- Estimated review budget impact: **actual authored diff is ~499 changed lines** (5 files modified: +303/-13 = 316 diff lines per `git diff --stat`; 1 new e2e file: 196 lines) — **above** tasks.md's own combined-PR-5 forecast of "~260–320" even after the 5a/5b split was meant to bring it under budget, and above the general 400-line guard. Same root cause as PR 1's and PR 2's own over-budget notes, already an established pattern in this change: the gap is almost entirely Strict-TDD-mandated test code (5 checkout-hint unit tests + 1 delegation + 2 exhaustiveness assertions + 3 real-Postgres e2e tests, each proving a structurally distinct property — flag-off, no-amount, not-connected via two independent code paths, connected, delegation, leak-shape-empty, leak-shape-populated) plus the Spanish-language design-rationale comments this codebase's convention requires on every new decision (the throttler-bucket-reuse reasoning alone is ~15 comment lines, justified by the blast-radius analysis it documents). Recommend **`size:exception`** for PR 5a, consistent with PR 1/PR 2: trimming would mean cutting test coverage for a payment-adjacent, patient-data-handling endpoint (exactly the kind of surface Strict TDD Mode exists to protect) or removing the inline documentation of a deliberate throttler-bucket-sharing decision that a future reader would otherwise have to re-derive from scratch. No code was compressed, no comments/tests were cut, and no attempt was made to iteratively shrink the diff to hit the number, per the apply-phase rule against gaming the budget.

## Status (PR 5a)

3/3 tasks complete (5.1, 5.2, 5.6). **PR 5a DONE.** All Work Unit Evidence and TDD Cycle Evidence gates passed with real command execution, including genuine `git stash`-verified RED failures (not assumed) for both the unit and e2e layers. PR 5b (frontend: tasks 5.3–5.5) is unblocked and next, but this batch explicitly did not start it. PR 6's final integration pass now depends on PR 2 + PR 5b (PR 5a's backend surface is already fully tested and stable).

## Key Learnings

1. `resolveForPublicBooking()`'s deliberate exclusion of `defaultSessionAmount` for autocreated public patients (already known from design.md's Open Questions) is now a directly-tested branch: `resolveCheckoutHint()` returns `NOT_APPLICABLE` for exactly that case, with a triangulating test against an *existing* patient with a resolvable amount to prove the branch isn't just "always NOT_APPLICABLE".
2. `PaymentAccountService.resolveGatewayContext()` decrypts credentials as a side effect of checking connection status — unsuitable to call from a hot, unauthenticated public path just to read `status`; reading `PaymentAccount.status` directly via the already-injected `PrismaService` avoids that cost and keeps `PublicSchedulingService`'s DI surface smaller (no new `PaymentAccountService` dependency).
3. `ThrottlerModule` being `@Global()` in this codebase means every new named throttler bucket has a blast radius across every controller with a `@SkipThrottle` exhaustiveness list (`auth.controller.ts`, `profile.controller.ts`, `email-change.controller.ts`) — reusing an existing bucket for a same-profile (read-only) endpoint is a legitimate way to add a route without that blast radius, as long as the reuse is documented and explicitly tested (not just implied by omission from the exhaustiveness table).
4. A real `git stash`/`git stash pop` cycle on just the production files (leaving the new test files in place) is a practical way to obtain genuine, verified RED evidence for Strict TDD Mode when the implementation and its tests were designed together in the same pass, rather than typed in strict RED-then-GREEN order — the failures are real (`TypeError`, `PrismaClientValidationError`, mismatched `toMatchObject` output), not assumed or narrated.
5. PR 5's combined backend+frontend forecast (~260–320 lines) undercounted the backend half alone once split into 5a/5b: 5a's real diff (~499 lines) repeats the same pattern already seen in PR 1 and PR 2 of this change — Strict-TDD test coverage plus this codebase's comment-density convention consistently pushes actual diffs well past task-authoring-time line estimates for payment/security-adjacent surfaces.

---

## Scope of this batch (PR 5b — this session, 2026-09-11)

PR 5b — Public scheduling: **frontend half only** of PR 5 (tasks 5.3, 5.4, 5.5). PR 5a (backend: `checkout` hint on `book()`, `GET .../checkout` endpoint, integration tests) was already shipped in the prior session. PR 6 (docs/rollback verification pass) explicitly out of scope for this batch.

### Mode

Strict TDD Mode active, test runner `npm test` (Vitest) from `frontend/`. Full RED → GREEN → REFACTOR cycle followed via a real `git stash`/`git stash pop` cycle (same technique as PR 5a's backend batch): the new test file additions were written together with the implementation, then the two production files (`publicScheduling.ts`, `PublicBookingPage.tsx`) were temporarily stashed and the extended test suite re-run against the pre-change code to obtain a genuine RED baseline, confirmed via real `npx vitest run` execution, before restoring GREEN.

### Task Status

- [x] **5.3** `checkout?: CheckoutHint` field and `groupId: string` field added to `BookingConfirmation` in `frontend/src/api/publicScheduling.ts`; `CheckoutHint`/`BookingCheckout` types added as exact mirrors of the backend's `public-scheduling.service.ts`/`payments.service.ts` contracts (`{status:'PENDING'}|{status:'NOT_APPLICABLE'}` and `{paymentUrl,amount}|{paymentUrl:null}`); `getBookingCheckout(therapistId, groupId)` wrapper added, GET with no auth header, same unauthenticated pattern as `getPublicAvailability`/`bookPublicSlot`. `groupId` was added (not explicitly named in tasks.md 5.3's literal text, but required to call the checkout endpoint at all) because the backend response actually includes it (`Consultation.groupId`, confirmed by reading `consultations.service.ts#createFromPublicBooking` and `public-scheduling.service.ts#book()`'s literal `{...consultation, checkout}` spread) — read from the real response, never assumed equal to `id` in the frontend even though they share the same value in the first version of a consultation.
- [x] **5.4** `PublicBookingPage.tsx`'s confirmation render extended: `CHECKOUT_POLL_INTERVAL_MS = 2000` and `CHECKOUT_POLL_TIMEOUT_MS = 15000` exported as named module-level constants (design.md Open Questions' proposed defaults, implemented as-is per explicit batch instruction). A `useEffect` scoped to `confirmation.checkout?.status === 'PENDING'` schedules a recursive `setTimeout` poll of `getBookingCheckout()`; on `paymentUrl` truthy, stores it in state and renders the checkout CTA (`<a href={checkoutUrl}>Pagar ahora</a>`, no `target="_blank"` — a real navigation away, matching "vas a salir de esta página" literally, not a new tab) plus the "you will leave this page" copy; on budget exhaustion (accumulated elapsed ≥ `CHECKOUT_POLL_TIMEOUT_MS`) with no `paymentUrl` yet, falls back to an email-notice copy. `NOT_APPLICABLE` or an absent `checkout` field (flag off in the backend) never starts the effect at all — zero requests to the checkout endpoint, verified by an explicit test asserting no `/checkout` URL appears in `api.get`'s call history. A network error during any individual poll tick is swallowed (not surfaced to the patient, who already has a successful booking) and simply counted toward the same elapsed budget as a null-`paymentUrl` response.
- [x] **5.5** `PublicBookingPage.tsx` reads `flow_return` via `useSearchParams()` (same import source as `ConsultationsPage.tsx`/`SecurityPage.tsx`, i.e. `'react-router'` not `'react-router-dom'`, per this project's react-router v8 convention). When `flow_return === '1'` and there is no local `confirmation` state (i.e., this is a fresh mount from a URL, not the same-session render right after a successful `POST .../book`), a generic defensive confirmation screen renders instead of the calendar picker — no availability-grid UI, no checkout polling (there is no `groupId` to poll with from a bare query param), and no assertion about whether the payment succeeded or failed. `PaymentsController`'s actual redirect target (`/pago-recibido`, `PaymentReturnPage.tsx`) is completely untouched by this batch, exactly as design.md Decision 2 requires — this is purely a defensive fallback for a stale/old link that might still carry `?flow_return=1`.

### TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 5.3/5.4/5.5 | `frontend/src/pages/PublicBookingPage.spec.tsx` | Component (Vitest + Testing Library) | ✅ 2/2 pre-existing tests in the file run before any edit | ✅ Real, verified via `git stash` — `publicScheduling.ts`/`PublicBookingPage.tsx` production changes were temporarily reverted (new test file left in place) and the full new test set re-run: **3 of 8 new tests failed as expected** (`findByRole('link', {name: 'Pagar ahora'})` timing out — no CTA ever renders because `confirmation.checkout` doesn't exist on old `BookingConfirmation`; the `flow_return=1` test timing out on `findByText('¡Listo!')` because the old component has no such branch and renders the calendar picker instead). The other 2 checkout-hint tests (`NOT_APPLICABLE`, absent-checkout) passed trivially against the old code, flagged honestly rather than claimed as RED evidence — same category of caveat PR 2's `availability.service.spec.ts` already documented for its own triangulation tests, and PR 5a's own TDD Cycle Evidence table for the identical reason. Confirmed via real `npx vitest run` execution (not assumed): 3 failed, 5 passed | ✅ Passed — `git stash pop` restored the implementation; same 8 tests re-run, 8/8 green | ✅ 4 checkout-poll scenarios (CTA-appears, budget-exhausted-falls-back-to-email, NOT_APPLICABLE-never-polls, absent-checkout-never-polls) + 2 `flow_return` scenarios (present-and-no-local-confirmation, absent-shows-normal-picker) | ✅ Clean — one real mid-cycle correction, not cosmetic: the first version of the two polling tests tried `vi.useFakeTimers()` (switched on *after* reaching the confirmation screen under real timers) to control the 2s/15s waits deterministically; this produced a genuine, reproducible failure (the CTA never appeared) because the pending `setTimeout` had already been scheduled against the real clock before fake timers were installed, so `vi.advanceTimersByTimeAsync` had nothing to advance. A second attempt moved `vi.useFakeTimers()` to before the render/interaction flow entirely — this instead hung `bookSlotUntilConfirmed`'s own `findBy`/`waitFor` calls (which poll via real timers internally in `@testing-library/dom`), confirmed by a real 5000ms test-timeout failure. Resolved by dropping fake timers for these two tests entirely and using real-timer waits with extended `it()`/`waitFor()` timeouts instead (`CHECKOUT_POLL_INTERVAL_MS + 2000`/`+5000` and `CHECKOUT_POLL_TIMEOUT_MS + 3000`/`+8000`) — slower but not fighting the test harness. `npx eslint`/`npx tsc --noEmit` clean after the fix, no further refactor needed |

One extra piece of rigor beyond the mandatory cycle: after `git stash pop` restoring GREEN, `npx tsc --noEmit -p tsconfig.app.json` was run project-wide (not just the 3 touched files) to confirm the new `BookingConfirmation.groupId`/`checkout` fields and the new exported constants didn't break any other consumer of `frontend/src/api/publicScheduling.ts` — clean, zero errors.

### Test Summary

- **Total tests written**: 6 new (`checkout PENDING → CTA`, `checkout PENDING → exhausted → email fallback`, `checkout NOT_APPLICABLE → no polling`, `checkout absent → no polling`, `flow_return=1 without local confirmation → defensive confirmation`, `no flow_return → normal picker`)
- **Total tests passing**: 8/8 in `PublicBookingPage.spec.tsx` (2 pre-existing + 6 new); 125/125 across the full frontend suite (21/21 files, up from 117/117 before this batch — net +8, since 2 of the 6 new `it()` blocks in this file were pre-existing and the file went from 2→8 tests, and no other spec file was touched)
- **Layers used**: Component (6) — no new unit-only pure-function tests, since the only new pure logic (elapsed-budget arithmetic) is small enough to be fully exercised through the component-level polling tests rather than extracted
- **Approval tests** (refactoring): None — no pre-existing `PublicBookingPage`/`publicScheduling.ts` behavior needed preservation beyond what the 2 pre-existing tests already cover as a safety net (both stayed green through every change)
- **Pure functions created**: None new as a standalone export — the polling loop's elapsed-budget check is inline in the `useEffect`'s closure, not extracted, since it has exactly one call site and extracting it would add an indirection with no second consumer

### Deviations from Design

1. **`BookingConfirmation.groupId` added, not explicitly named in tasks.md 5.3's literal text**: tasks.md 5.3 only says "add `checkout` field ... add `getBookingCheckout()` wrapper" — it does not mention `groupId`. Without it, `getBookingCheckout(therapistId, groupId)` has no argument to call with. Confirmed by reading the real backend response shape (`consultations.service.ts#createFromPublicBooking` returns the full `Consultation` object, which includes `groupId`; `public-scheduling.service.ts#book()` spreads it through unchanged) rather than assuming `id` doubles as `groupId` — they are equal in the first version of a consultation (per `schema.prisma`'s own comment on the field), but the frontend reads the real field name from the real response instead of relying on that equality silently.
2. **Polling implemented as a plain `useEffect` + recursive `setTimeout` inside `PublicBookingPage.tsx`, not a `react-query` hook in `usePublicScheduling.ts`**: design.md's "File Changes" table lists only `frontend/src/pages/PublicBookingPage.tsx` and `frontend/src/api/publicScheduling.ts` for this slice — `hooks/usePublicScheduling.ts` is not listed, even though the existing codebase convention (`useUnreadNotificationsCount` in `useNotifications.ts`) uses `useQuery`'s `refetchInterval` for polling elsewhere. Kept polling logic local to the page component to match design.md's literal file-change scope rather than introduce an unlisted file; the constants are still exported and named exactly as tasks.md 5.4 asked, so a later PR can still extract them into a hook without touching the poll semantics.
3. **CTA anchor has no `target="_blank"`**: "vas a salir de esta página" ("you will leave this page") was read as a literal same-tab navigation away from the SPA, not an instruction to open a new tab — a plain `<a href>` with no `target` attribute matches that copy exactly; opening in a new tab would technically NOT leave the current page, contradicting its own copy.

None of these are design.md contradictions — design.md's "Interfaces / Contracts" and "Data Flow" sections specify the poll target and cadence abstractly; the exact React composition (hook file vs. inline effect) and anchor `target` attribute are implementation-detail choices documented here for the next reader.

### Issues Found

None in production code. One test-harness lesson (not a production bug) is the fake-timers-vs-real-timers interaction documented in the TDD Cycle Evidence REFACTOR column and in tasks.md's Key Learnings — costly to discover empirically but resolved cleanly, and worth flagging so a future PR touching this same polling code doesn't re-attempt the same fake-timer approach and re-hit the same wall.

### Files Changed

| File | Action | What Was Done |
|------|--------|---------------|
| `frontend/src/api/publicScheduling.ts` | Modified | Added `CheckoutHint`, `BookingCheckout` types; added `groupId`/`checkout` fields to `BookingConfirmation`; added `getBookingCheckout()` wrapper |
| `frontend/src/pages/PublicBookingPage.tsx` | Modified | Exported `CHECKOUT_POLL_INTERVAL_MS`/`CHECKOUT_POLL_TIMEOUT_MS`; added checkout-polling `useEffect` + CTA/email-fallback render branches inside the `confirmation` block; added `flow_return=1` defensive confirmation branch via `useSearchParams()` |
| `frontend/src/pages/PublicBookingPage.spec.tsx` | Modified | Added `bookSlotUntilConfirmed()` helper (reused across new tests); parametrized `renderPage()` to accept an initial route; added 6 new tests across 2 new `describe` blocks |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx cross-env NODE_OPTIONS=--no-experimental-webstorage npx vitest run src/pages/PublicBookingPage.spec.tsx` → 8/8 passed |
| Runtime harness command/scenario and exact result | `npm test` (full frontend suite, `cross-env NODE_OPTIONS=--no-experimental-webstorage vitest run`) → 125/125 passed, 21/21 files. `npx tsc --noEmit -p tsconfig.app.json` → clean, zero errors. `npx eslint` on all 3 touched files → 0 errors, no `--fix` needed |
| Rollback boundary | 3 files, all under `frontend/src/`: 2 modified production files (`api/publicScheduling.ts`, `pages/PublicBookingPage.tsx`) + 1 modified spec file (`pages/PublicBookingPage.spec.tsx`). No other file imports the new `groupId`/`checkout`/`CheckoutHint`/`BookingCheckout` exports yet — reverting this batch is a clean 3-file revert with zero call-site cleanup elsewhere in the codebase. PR 5a's backend surface (`checkout` hint on `book()`, `GET .../checkout` endpoint) is untouched and keeps working exactly as PR 5a left it regardless of whether this batch is reverted — the frontend simply stops reading fields that would still be present in the response. |

### Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md `chain_strategy`), completing the 5a/5b split the orchestrator pre-emptively executed in the prior session
- Current work unit: PR 5b — Public scheduling frontend: `checkout` field + `getBookingCheckout()` wrapper + confirmation polling UI + `flow_return` fallback (tasks 5.3, 5.4, 5.5)
- Boundary: starts from PR 5a's tested backend surface (`checkout` hint, `GET .../checkout` endpoint — already shipped, untouched by this batch); ends with a tested, mergeable frontend confirmation screen. PR 5 (5.1+5.2+5.3+5.4+5.5+5.6) is now **fully complete** across both slices. PR 6 (docs/rollback verification pass) is next and was **not started** by this batch.
- Estimated review budget impact: **actual authored diff is 396 changed lines** (389 insertions + 7 deletions across 3 files: `publicScheduling.ts` +38/-0, `PublicBookingPage.tsx` +99/-7, `PublicBookingPage.spec.tsx` +252/-0, per `git diff --stat`) — **under** the 400-line review budget, no `size:exception` needed. This confirms the orchestrator's pre-emptive 5a/5b split (tasks.md's own forecast table) achieved its purpose: the frontend half alone lands comfortably under budget even with 6 new Strict-TDD component tests (2 of which required real-timer waits up to ~15s to prove the poll-exhaustion fallback deterministically, rather than mocking away the actual timing behavior).

## Status (PR 5b)

3/3 tasks complete (5.3, 5.4, 5.5). **PR 5b DONE.** All Work Unit Evidence and TDD Cycle Evidence gates passed with real command execution, including a genuine `git stash`-verified RED baseline (3 real failures, 2 honestly-flagged trivial passes) and a real mid-cycle correction (fake-timers approach abandoned in favor of real-timer waits, backed by two actual reproduced failures, not assumed). **PR 5 (all of 5.1–5.6) is now fully complete** across both the 5a backend batch and this 5b frontend batch. PR 6 (flags documentation, rollback verification, success-criteria pass) is unblocked and next; this batch did not start it.

## Key Learnings

1. `Consultation.groupId` equals `id` only in the first version of a consultation (per `schema.prisma`'s own inline comment) — the frontend reads `groupId` from the real booking response instead of assuming that equality, since a future correction/versioning flow could make them diverge and nothing in the frontend should depend on an implementation detail it doesn't own.
2. Mixing Vitest fake timers with `@testing-library/dom`'s `findBy`/`waitFor` is fragile in both directions: enabling fake timers *after* a real `setTimeout` was already scheduled leaves that pending timer unreachable by `vi.advanceTimersByTimeAsync` (it keeps running on the real clock); enabling fake timers *before* the interaction flow instead hangs `findBy`/`waitFor` themselves, since their own internal polling also relies on real timers. For a short poll interval/ceiling (2s/15s here), real-timer waits with extended `it()`/`waitFor()` timeouts are the more reliable choice over fighting the test harness with fake timers.
3. `design.md`'s "File Changes" table is a real scope boundary, not just documentation — PR 5b intentionally did not touch `hooks/usePublicScheduling.ts` even though this codebase already has a `react-query`-`refetchInterval`-based polling convention (`useNotifications.ts`), because design.md's file list for this slice only names `PublicBookingPage.tsx` and `publicScheduling.ts`.
4. A plain `<a href>` anchor with no `target="_blank"` is the literal reading of "vas a salir de esta página" ("you will leave this page") — a new tab would technically not leave the current page, so the copy and the navigation behavior have to agree.

---

## PR 6 — Flags documentation, rollback verification, success-criteria pass

**Scope of this batch**: tasks 6.1–6.4 only (docs + verification, no new production code), plus a final full-chain (PR0–6) test pass. Depends on PR 2, PR 3, PR 5 — all already complete per this file's PR 1/PR 2/PR 3/PR 5a/PR 5b sections above.

### Mode

Not applicable — this batch is documentation and verification, not implementation. No RED→GREEN→REFACTOR cycle: there is no new production code and no new test file. Per Step 2b of the tasks themselves, 6.2/6.3 explicitly call for a smoke pass over already-existing coverage, not new automated tests, "unless a gap is found." No gap was found.

### Task Status

- [x] **6.1 [P]** Document both flags in the README env-var reference. **Done**: added `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` and `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED` rows to the env-var reference table (`README.md`, right after `PUBLIC_SCHEDULING_ENABLED`/`PUBLIC_BOOKING_THROTTLE_*`), plus a new "Overlay de Google Calendar y checkout en línea (sdd/public-booking-payment-calendar)" sub-section under the existing "Auto-agenda pública de pacientes" section, describing both flags, their defaults (opt-in, `=== 'true'`), and their independence from each other.
- [x] **6.2** Manually verify each flag toggles independently. **Done, no gap found.** Reasoning: `AvailabilityService` reads only `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` (`availability.service.ts:222-224`, constructor-time `=== 'true'` check, cached in `this.overlayEnabled`); `CalendarBusyService` reads the same single flag (`calendar-busy.service.ts:61`); `PublicSchedulingService` reads only `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED` (`public-scheduling.service.ts:67`). None of the three services reads, imports, or branches on the other flag's env var — the architecture structurally guarantees independence (each flag is a single `ConfigService.get()` call scoped to its own module), not just by absence of a bug found today. Smoke evidence (real command execution, not just code reading): `calendar-busy-overlay.e2e-spec.ts` runs its whole suite with `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` toggled (unset → default off, then forced `'true'` in one nested test) while `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED` is never set (stays undefined throughout); `public-booking-checkout.e2e-spec.ts` runs its whole suite with `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED='true'` for the duration while `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` is never set. Ran both e2e files in one Jest invocation (`npx jest --config ./test/jest-e2e.json --forceExit calendar-busy-overlay public-booking-checkout`) to rule out cross-suite env leakage inside the same process: **2 suites / 5 tests passed**, both flags observed behaving exactly as when run standalone.
- [x] **6.3** Confirm rollback plan holds. **Done, both halves re-verified by real test execution**:
  - **Overlay flag off → byte-identical `computeSlots()`**: re-ran `calendar-busy-overlay.e2e-spec.ts` standalone as the closing gate — `npx jest --config ./test/jest-e2e.json --forceExit calendar-busy-overlay` → **2/2 passed** (`Time: 2.243s`). Test 1 confirms the availability response still includes a slot that a real `CalendarBusyBlock` would block if the overlay were on; test 2 confirms calling the endpoint twice (before/after seeding that same `CalendarBusyBlock`) returns the exact same grid — the suite's own inline comment records a manual counter-proof from a prior session (forcing the flag `true` in `beforeAll` made the seeded block correctly eliminate the slot, then reverted), so this "byte-identical" assertion is proven non-vacuous, not just passing by omission.
  - **Checkout flag off → email-only flow untouched**: re-ran `public-booking-checkout.e2e-spec.ts` standalone — `npx jest --config ./test/jest-e2e.json --forceExit public-booking-checkout` → **3/3 passed** (`Time: 1.955s`), confirming booking still completes end-to-end with Flow/Google unavailable and the checkout endpoint's response shape stays exactly `{ paymentUrl, amount }` or `{ paymentUrl: null }`. The pre-existing payment-link email path (`ensureCharge()` → `MailService`, unrelated to `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED`) received zero changes anywhere in this change's PR 1–5 diff (confirmed via `git log`/task history — no PR in this chain touches `mail.service.ts` or the email-sending call sites), so "checkout flag off restores email-only flow" holds by construction: there was never a code path where the checkout flag could have altered the email flow to begin with, since `resolveCheckoutHint()` (PR 5.1) is purely additive to the `book()` response and never gates or wraps the existing `ensureCharge()`/email call chain.
- [x] **6.4** Known-issue note confirmation. **Confirmed already present, no duplicate added.** `Grep` on `defaultSessionAmount` in `public-scheduling.service.ts` locates the comment block at lines 180–186, directly above `resolveCheckoutHint()`, explicitly labeled `known-issue (design.md Open Questions, tasks.md 6.4)` and describing exactly the documented gap (public-created patients have no `defaultSessionAmount`, so `NOT_APPLICABLE` is the only reachable outcome for them, `ensureCharge()` never generates a charge for them, out of scope for this release). This was added during PR 5a, per that section's own record above.

### Final full-chain verification (PR 0–6, one more pass)

Re-ran the complete suites once more as the closing gate for the entire change, in addition to the two targeted e2e re-runs above:

| Command | Result |
|---|---|
| `cd backend && npx jest --config ./test/jest-e2e.json --forceExit calendar-busy-overlay` | **2/2 passed** — overlay-flag-off byte-identical gate (PR 2.5, re-run per 6.3) |
| `cd backend && npx jest --config ./test/jest-e2e.json --forceExit public-booking-checkout` | **3/3 passed** — checkout end-to-end + response-shape gate (re-run per 6.3) |
| `cd backend && npx jest --config ./test/jest-e2e.json --forceExit calendar-busy-overlay public-booking-checkout` (combined) | **2 suites / 5 tests passed** — flag-independence smoke check (6.2) |
| `cd backend && npm test` (full unit suite, `jest`) | **52 suites / 605 tests passed** (`Time: 5.648s`) |
| `cd frontend && npm test` (full suite, `vitest run`) | **21 files / 125 tests passed** (`Duration: 27.83s`) |

No failures, no skips, no `size:exception` needed for this batch (docs-only, ~60 changed lines: 2 table rows + 1 new README sub-section + tasks.md checkbox/evidence updates + this apply-progress section — under the ~20–40 estimate but still well under the 400-line budget and entirely non-production-code).

### Files Changed

| File | Action | What Was Done |
|------|--------|----------------|
| `README.md` | Modified | Added `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` / `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED` rows to the env-var reference table; added "Overlay de Google Calendar y checkout en línea" sub-section under "Auto-agenda pública de pacientes" |
| `openspec/changes/public-booking-payment-calendar/tasks.md` | Modified | Marked 6.1–6.4 `[x]` with inline evidence notes |
| `openspec/changes/public-booking-payment-calendar/apply-progress.md` | Modified | This PR 6 section, merged with all prior sections (PR 0 through PR 5b) — nothing above this section was removed |

### Work Unit Evidence

| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx jest --config ./test/jest-e2e.json --forceExit calendar-busy-overlay public-booking-checkout` → 2 suites / 5 tests passed |
| Runtime harness command/scenario and exact result | Full-chain re-run: backend `npm test` → 52/52 suites, 605/605 tests passed; frontend `npm test` → 21/21 files, 125/125 tests passed |
| Rollback boundary | Docs-only batch. `README.md` and `tasks.md` are independently revertible with zero code impact — no production file, schema, or test was touched in this PR 6 batch. Reverting this batch does not affect PR 0–5's already-shipped, already-tested code in any way. |

### Workload / PR Boundary

- Mode: chained PR slice (`stacked-to-main`, per tasks.md `chain_strategy`) — final PR in the 6-PR (7 counting the 5a/5b split) stacked chain
- Current work unit: PR 6 — flags documentation, rollback verification, success-criteria pass (tasks 6.1–6.4)
- Boundary: starts from PR 5b's fully-shipped frontend surface (already tested, untouched by this batch); ends with README documentation for both flags and a re-confirmed rollback gate. This is the **last** work unit in `tasks.md` — no PR 7 exists.
- Estimated review budget impact: ~60 changed lines across `README.md` + `tasks.md`, no production code — negligible, well under the 400-line budget, no `size:exception` needed (matches the tasks.md forecast row for PR 6: "~20–40, Negligible")

## Status (PR 6)

4/4 tasks complete (6.1, 6.2, 6.3, 6.4). **PR 6 DONE.** All Work Unit Evidence gates passed with real command execution: both targeted e2e re-runs (2/2 and 3/3), the combined flag-independence run (2 suites/5 tests), and the full-chain re-run (backend 605/605, frontend 125/125) — zero failures anywhere.

---

## Executive Summary — PR 0 through PR 6 (full change)

All 7 stacked PR slices (PR 0, 1, 2, 3, 4, 5a, 5b, 6 — PR 5 was pre-emptively split into 5a/5b to stay under the 400-line review budget) are complete. Final state:

- **PR 0** (spike): `events.list` confirmed working under the existing `calendar.events` scope with no new consent — gated Slice A as designed, no fallback needed.
- **PR 1** (overlay data layer): `CalendarBusyBlock` model + migration, `listBusyIntervals()` on the Google client, unit tests over fixture payloads.
- **PR 2** (overlay consumption): `CalendarBusyService` 30-min cron, `AvailabilityService.computeSlots()`'s sixth query gated by `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` (`=== 'true'`, reconciled against the spec's `!== 'false'` text in favor of design.md's more specific note), flag-off byte-identical E2E gate.
- **PR 3** (OAuth scope): reconciled to a documentation-only no-op — Decision 1's spike result meant there was never a second scope to track, request, or re-consent to; zero production code, by design, not by omission.
- **PR 4** (payments exposure): `findCheckoutForBooking()`, verified (zero-diff) the pre-existing Flow return endpoint already satisfies the spec, `checkoutUrl` surfaced on the booking response without making `ensureCharge()` awaited.
- **PR 5a** (public-scheduling backend): `checkout` hint on `book()`, `GET .../book/:groupId/checkout` endpoint, reusing the existing `public-availability` throttler bucket.
- **PR 5b** (public-scheduling frontend): `getBookingCheckout()` wrapper, polling UI (`CHECKOUT_POLL_INTERVAL_MS`/`CHECKOUT_POLL_TIMEOUT_MS`), `flow_return=1` defensive confirmation branch.
- **PR 6** (this batch): both flags documented in `README.md`; flag independence confirmed architecturally and by smoke test; rollback plan re-verified by re-running both flag-specific E2E gates; known-issue note confirmed already present from PR 5a.

**Final full-chain numbers** (this batch's closing pass): backend `npm test` — **52 suites / 605 tests passed**; frontend `npm test` — **21 files / 125 tests passed**; both flag-specific E2E gates — **5/5 tests passed** standalone and combined. Zero known failures, zero skipped tests, zero open blockers across the entire change.

## Key Learnings

1. Both feature flags are independent by construction, not by convention — each service (`AvailabilityService`, `CalendarBusyService`, `PublicSchedulingService`) reads exactly one `ConfigService.get()` call scoped to its own flag, with no shared config object or cross-flag branch anywhere in the codebase, so "toggles independently" was verifiable from the source alone before any test ever ran.
2. Running two independently-authored E2E suites in a single Jest process (`calendar-busy-overlay` + `public-booking-checkout` together) is a cheap, real way to smoke-test env-var independence beyond each suite's own isolated `beforeEach`/`afterEach` — it catches the class of bug where one flag's cleanup accidentally clears or leaks into the other's state within the same test run.
3. A rollback-plan verification task is strongest when it re-runs the exact E2E test that was written to prove the original claim (PR 2.5's byte-identical gate) rather than re-deriving a new, weaker proof — the original test already carries its own non-vacuousness counter-proof from a prior session, which this batch reused rather than re-litigated.
4. Confirming a "no production code needed" task (6.4) by `Grep`-locating the exact comment and its exact line-referenced task number is meaningfully stronger evidence than asserting "should already be there" — it also surfaced that the comment self-references `tasks.md 6.4`, closing the loop cleanly between the two artifacts.
