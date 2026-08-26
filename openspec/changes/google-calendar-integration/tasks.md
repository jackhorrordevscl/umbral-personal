# Tasks: Google Calendar Sync (push-only, therapist account)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1300-1600 (schema/migration ~130, crypto extraction ~90, OAuth/token custody ~280, sync/reconciler ~320, patient-code util ~60, tests ~450, frontend ~180, RAT ~30) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 Schema + crypto extraction + OAuth/token custody → PR 2 Sync propagation + reconciler → PR 3 Frontend + RAT |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main — confirmed by user, same pattern as `session-reminders` and `harden-profile-endpoint` |

Decision needed before apply: No — resolved
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Schema + shared AES-GCM crypto + OAuth connect/disconnect/callback with signed single-use `state` | PR 1 | `cd backend && npx jest src/modules/calendar-integration src/common/crypto src/modules/documents` | `npx jest --config test/jest-e2e.json calendar-integration.e2e-spec.ts` | Revert migration (additive) + `calendar-integration/` module + `aes-gcm.ts` extraction; `DocumentEncryptionService` reverts to inline impl |
| 2 | Push-only sync (`create`/`correct`/soft-delete), reconciler cron, patient-code util | PR 2 | `cd backend && npx jest src/modules/calendar-integration/calendar-sync src/modules/calendar-integration/patient-code` | `GOOGLE_CALENDAR_SYNC_ENABLED=false` disables cron + intents, zero data loss | Revert `calendar-sync.service.ts`, reconciler `@Cron`, and the two `consultations.service.ts` emission points; PR 1 surface untouched |
| 3 | `SettingsPage.tsx` connection card + RAT update | PR 3 | `cd frontend && npm test -- --run` | Manual: connect/disconnect from Settings, verify `?calendar=` banner | Revert frontend files + RAT paragraph only; backend unaffected |

## Phase 1: Foundation — Schema, Shared Crypto, Config (PR 1)

- [x] 1.1 `backend/src/common/crypto/aes-gcm.ts`: extract `encryptAesGcm`/`decryptAesGcm`/`loadBase64Key` from `DocumentEncryptionService`, identical behavior.
- [x] 1.2 `backend/src/modules/documents/document-encryption.service.ts`: delegate to `aes-gcm.ts`; existing spec is the regression net.
- [x] 1.3 `backend/prisma/schema.prisma`: add `GoogleCalendarConnection`, `CalendarEventLink`, `GoogleConnectionStatus`, `GoogleDisconnectReason`, `CalendarSyncStatus` enums, `NotificationType.GOOGLE_CALENDAR_DISCONNECTED`, `User.calendarConnection` back-relation.
- [x] 1.4 Migration `backend/prisma/migrations/*_google_calendar/`: additive only, run against `DIRECT_URL`.
- [x] 1.5 `backend/src/config/env.validation.ts`: 32-byte check on `GOOGLE_TOKEN_ENCRYPTION_KEY` in production; `GOOGLE_CALENDAR_SYNC_ENABLED` must be exactly `"true"`/`"false"`.
- [x] 1.6 `.env.example` / CI env: add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `GOOGLE_CALENDAR_SYNC_ENABLED=false`.
- [x] 1.7 `backend/package.json`: add `google-auth-library` (not `googleapis`).
- [x] 1.8 Create `calendar-integration/calendar-integration.constants.ts`: `BACKFILL_WINDOW_DAYS = 90`, `RECONCILE_BATCH_LIMIT = 200`, `DEFAULT_SESSION_MINUTES = 50`, `STATE_TTL_MS`, `CALENDAR_TIME_ZONE`.

## Phase 2: OAuth + Token Custody — Core (PR 1)

- [x] 2.1 Create `calendar-integration/google-token-crypto.service.ts`: `onModuleInit` key validation, `encrypt`/`decrypt` via `aes-gcm.ts` with `GOOGLE_TOKEN_ENCRYPTION_KEY`.
- [x] 2.2 Create `calendar-integration/calendar-oauth.service.ts`: build auth URL (`calendar.events`, `access_type=offline`); mint `state` JWT (`sub`, `purpose: 'google-calendar-oauth'`, `nonce`) and store `sha256(nonce)`; verify+consume `state` (signature, `exp`, `purpose`, nonce match, single-use clear); exchange code; revoke on disconnect.
- [x] 2.3 Create `calendar-integration/calendar-integration.controller.ts`: `GET /status` (guarded), `POST /authorize` (guarded, returns `{ url }` JSON), `GET /callback` (no guard, 302 to `${FRONTEND_URL}/settings?calendar=connected|error`), `POST /disconnect` (guarded).
- [x] 2.4 Create `calendar-integration/calendar-integration.module.ts`: imports `ConfigModule`, `NotificationsModule`; exports `CalendarSyncService` (stubbed in this PR, implemented in PR 2).
- [x] 2.5 `backend/src/app.module.ts`: register `CalendarIntegrationModule`.

## Phase 3: OAuth + Token Custody — Testing (PR 1)

- [x] 3.1 RED `document-encryption.service.spec.ts` (existing suite): confirm it still passes unchanged after delegation to `aes-gcm.ts`.
- [x] 3.2 RED unit `calendar-oauth.service.spec.ts`: `state` rejected on bad signature, expired `exp`, wrong `purpose`, replayed nonce.
- [x] 3.3 GREEN: implement `state` verify/consume per 3.2.
- [x] 3.4 RED unit: refresh token persisted as ciphertext, never plaintext in the row or in logs.
- [x] 3.5 GREEN: wire `GoogleTokenCryptoService.encrypt` into the OAuth callback persist path.
- [x] 3.6 RED E2E `calendar-integration.e2e-spec.ts`: unauthenticated `GET /callback` with a **forged** `state` never mutates a connection row (public-route invariant, no guard).
- [x] 3.7 GREEN: callback signature/nonce verification rejects the forged case.
- [x] 3.8 RED E2E: **tenancy** — therapist B cannot read (`GET /status`) or disconnect therapist A's connection; uniform 404, never 403-with-leak.
- [x] 3.9 GREEN: scope `status`/`disconnect` queries by `therapistId` from `@CurrentUser()`.
- [x] 3.10 Test: `POST /authorize` and `POST /disconnect` without a token → 401.

## Phase 4: Sync Propagation — Foundation (PR 2)

- [x] 4.1 Create `calendar-integration/patient-code.util.ts`: `initials(fullName)`, `shortCode(patientId)` (`sha256("umbral/patient-code/v1|" + id)`, Crockford base32, 6 chars), `patientLabel(patient)`.
- [x] 4.2 Create `calendar-integration/google-calendar.client.ts`: `insertEvent`/`patchEvent`/`deleteEvent` via `google-auth-library` `OAuth2Client` + native `fetch`; typed error classification (`invalid_grant`/401, 404/410, 403/5xx/network).

## Phase 5: Sync Propagation — Core (PR 2)

- [x] 5.1 Create `calendar-integration/calendar-sync.service.ts`: `syncGroup(groupId)` — builds minimized event body (initials+code+deep link, no `rut`/`fullName`/`sessionType`/clinical text, `DEFAULT_SESSION_MINUTES = 50`, no attendees), upserts `CalendarEventLink` keyed `(connectionId, groupId)`.
- [x] 5.2 `calendar-sync.service.ts`: `reconcile()` `@Cron(EVERY_15_MINUTES)` — repairs `FAILED` links, date drift, `consultation.deletedAt`/`patient.deletedAt` deletions, and one bounded backfill pass (`(now, now+90d]`) per `CONNECTED` connection.
- [x] 5.3 `calendar-sync.service.ts`: `invalid_grant`/401 handling — `updateMany({ where: { id, status: CONNECTED } })` so only a winning transition notifies once via `NotificationsService`; token wiped; no retry.
- [x] 5.4 On reconnect with a different `googleAccountEmail`, purge all `CalendarEventLink` rows for that connection. **(implemented and unit-tested as `CalendarSyncService.purgeLinksOnAccountChange`; not yet wired into `CalendarOauthService.exchangeCodeAndPersist` — see Deviations.)**
- [x] 5.5 `backend/src/modules/consultations/consultations.service.ts`: emit `void this.calendarSync.syncGroup(groupId).catch(log)` after `create()` transaction commits.
- [x] 5.6 `consultations.service.ts`: same emission after `correct()` transaction commits.
- [x] 5.7 Wire patient soft-delete (`DELETE /patients/:id`) to delete every mapped future event and its `CalendarEventLink` rows for that patient's consultations.
- [x] 5.8 `backend/src/modules/consultations/consultations.module.ts`: import `CalendarIntegrationModule` (no cycle).
- [x] 5.9 `calendar-integration.module.ts`: implement the `CalendarSyncService` export stubbed in PR 1.

## Phase 6: Sync Propagation — Testing (PR 2)

- [x] 6.1 RED unit `patient-code.util.spec.ts`: `patientLabel` determinism, 2/3/4-token names, diacritics, code stability across a `fullName` change.
- [x] 6.2 GREEN: implement `initials`/`shortCode` per the Chilean-name convention.
- [x] 6.3 RED unit: event body contains initials+code+deep link and **no** `rut`, `fullName`, `consultReason`, `intervention`, `agreements`, `sessionType` — assert on serialized payload.
- [x] 6.4 GREEN: implement minimized event-body builder.
- [x] 6.5 RED unit: `invalid_grant` → DISCONNECTED + exactly one notification; a second failure on an already-`DISCONNECTED` connection emits none.
- [x] 6.6 GREEN: gate notification on the winning `updateMany` transition.
- [x] 6.7 RED unit: reconciler never deletes an event merely for leaving the 90-day window (move `sessionDate` to +200d → assert `patch`, not `delete`).
- [x] 6.8 GREEN: reconciler deletion path keyed only on `deletedAt`, not window membership.
- [x] 6.9 RED integration: `correct()` on `sessionDate` patches the **same** `googleEventId`; a text-only `correct()` still patches once, never inserts.
- [x] 6.10 GREEN: `syncGroup` resolves the existing link before deciding insert vs patch.
- [x] 6.11 RED integration: Google client throwing on every call → `create()`/`correct()` still return 201/200 (real Prisma, mocked client, force rejection).
- [x] 6.12 GREEN: confirm sync call sites never `await` inside the write's critical path.
- [x] 6.13 Integration: backfill = one scoped reconcile pass — N future sessions in-window pushed, 0 out-of-window pushed (real Prisma against the test DB).
- [x] 6.14 Integration: patient soft-delete removes every mapped future event and its links; past/already-deleted links untouched.

## Phase 7: Frontend + Documentation (PR 3)

- [x] 7.1 `frontend/src/pages/SettingsPage.tsx`: "Google Calendar" card — status display, connect button (calls `POST /authorize`, redirects to returned `url`), disconnect button.
- [x] 7.2 `SettingsPage.tsx`: handle `?calendar=connected|error` return banner after the OAuth redirect.
- [x] 7.3 Frontend tests: card renders each connection status; connect/disconnect trigger the right API calls.
- [x] 7.4 `docs/registro-actividades-tratamiento.md`: add Google as a processor (new data flow, minimized content only).

## Phase 8: Cross-Cutting Verification

- [x] 8.1 Confirm `GOOGLE_CLIENT_ID` unset → module registers, no-ops with `logger.warn` (mirrors `MailService` without `RESEND_API_KEY`); local/CI/e2e boot unaffected.
- [x] 8.2 Confirm `GOOGLE_CALENDAR_SYNC_ENABLED=false` kills the cron and write-path intents without a deploy revert; set it in the e2e env.
- [x] 8.3 Full backend test suite green (`cd backend && npx jest`), full e2e suite green (`npx jest --config test/jest-e2e.json`).
