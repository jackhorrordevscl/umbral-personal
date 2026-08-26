# Design: Google Calendar Sync (push-only, therapist account)

## Technical Approach

A new `CalendarIntegrationModule` owns four concerns behind one service boundary: the OAuth handshake (`CalendarOauthService`), token custody (`GoogleTokenCryptoService`, AES-256-GCM), a thin Google Calendar REST client (`GoogleCalendarClient`), and propagation (`CalendarSyncService`). `ConsultationsService` calls `CalendarSyncService` fire-and-forget on write; a `@nestjs/schedule` reconciler is the safety net that repairs whatever a lost intent left divergent. Backfill is not a separate feature — it is one reconciler pass scoped to a single connection.

## Architecture Decisions

### Decision: Event link keyed on `(connectionId, groupId)`, not `consultationId`

| Option | Tradeoff |
|---|---|
| Key on `consultationId` | `correct()` creates a **new row** (consultations.service.ts:214) → every correction orphans the old event and inserts a duplicate |
| Key on `groupId` alone | Survives corrections, but a disconnect/reconnect against a *different* Google account reuses dead `googleEventId`s |
| **Key on `(connectionId, groupId)`** ✅ | Correction-stable, and the connection scope makes account switches recoverable |

**Rationale**: `groupId` is invariant across the version chain (schema.prisma:158), exactly the identity the archived `session-reminders` design already relied on. On reconnect, if the resolved `googleAccountEmail` differs from the stored one, all links for that connection are purged — the events belong to a calendar we no longer address.

### Decision: Fire-and-forget intents **plus** a bounded reconciler

**Choice**: `create`/`correct` call `void this.calendarSync.syncGroup(groupId).catch(log)` after their transaction commits. A `@Cron(EVERY_15_MINUTES)` `reconcile()` pass then repairs drift for every `CONNECTED` connection.
**Alternatives considered**: pure fire-and-forget, matching `MailService` (rejected — a lost email is a missed reminder, but a lost calendar write leaves Google *permanently asserting the wrong session time*, which is worse than no event at all); a transactional outbox table drained by cron (rejected — the reconciler recovers the same states from data that already exists, with no extra table); polling only, per the `session-reminders` precedent (rejected — that design could poll because due-ness is a *time* predicate; here propagation is an *event* consequence and 15-minute latency on a new booking is user-visible).
**Rationale**: the intent gives immediacy, the reconciler gives eventual correctness, and neither can fail a clinical write. The reconciler skips non-`CONNECTED` connections entirely, so it never violates the no-retry rule for a broken grant.

### Decision: Patient code = truncated domain-separated SHA-256 of `patient.id`, keyless

```typescript
// calendar-integration/patient-code.util.ts
const INITIALS_SEP = '-';
// Chilean convention: "Nombre [Nombre2] Apellido1 [Apellido2]".
// 4+ tokens => first surname is token[2]; otherwise token[1]. Diacritics are
// NFD-folded, non-letters dropped. A wrong guess is harmless: the code, not
// the initials, is what disambiguates two patients.
function initials(fullName: string): string;           // "Juan Pablo Martínez Contreras" -> "JM"
function shortCode(patientId: string): string;         // sha256("umbral/patient-code/v1|" + id), Crockford base32, 6 chars
export function patientLabel(p): string;               // "JM-4K7QX2"
```

| Option | Tradeoff |
|---|---|
| Derive the code from `rut` | Forbidden by business rule; `rut` is low-entropy and trivially brute-forced from a hash |
| Derive from `fullName` | `PatientsService.update` can change `fullName` → the code silently mutates under already-published events |
| HMAC keyed by an env secret | Non-reversible, but any key rotation invalidates every code already written into Google |
| **Truncated SHA-256 over `patient.id`** ✅ | The preimage is a uniformly random uuid v4 (122 bits), so inversion is infeasible **without** a key — and the code is stable forever |

**Rationale**: keylessness is the point. `patient.id` carries no PII, has no dictionary to brute-force, and never rotates. 6 Crockford base32 chars ≈ 1.07 × 10⁹ values (no `I/L/O/U`, so codes stay readable aloud). `rut` is excluded both by rule and because a 8-digit-plus-DV space is enumerable in seconds against any digest.

### Decision: Dedicated `GOOGLE_TOKEN_ENCRYPTION_KEY`, not `DOCUMENT_ENCRYPTION_KEY`

**Choice**: a second 32-byte base64 key. The AES-256-GCM body is extracted to `common/crypto/aes-gcm.ts` (`encryptAesGcm`/`decryptAesGcm`/`loadBase64Key`); `DocumentEncryptionService` is refactored to delegate — behavior identical, its existing spec is the regression net.
**Rationale**: rotating `DOCUMENT_ENCRYPTION_KEY` means re-encrypting every patient file on disk; rotating the OAuth key means "therapists reconnect". Sharing one key drags the cheap rotation up to the cost of the expensive one, and a leaked calendar key would then also decrypt clinical documents. Ciphertext is stored as Prisma `Bytes` (Postgres `bytea`) — `encrypt()` already returns a `Buffer`, so no base64 round-trip.

### Decision: The OAuth callback is unauthenticated; identity travels in a signed, single-use `state`

**Choice**: `POST /calendar-integration/authorize` (guarded) mints `state` = a 10-minute JWT signed with `JWT_SECRET`, payload `{ sub: therapistId, purpose: 'google-calendar-oauth', nonce }`, and stores `sha256(nonce)` on the connection row. `GET /calendar-integration/callback` carries **no** `JwtAuthGuard` (Google redirects the browser; the axios bearer interceptor cannot participate), verifies signature + `exp` + `purpose`, matches the stored nonce hash, then **clears it** — replay of a consumed `state` is rejected.
**Alternatives considered**: a separate `PendingOAuthState` table (rejected — a whole table for one nullable column pair on a row we already upsert); an unbound random `state` (rejected — it authenticates nothing, leaving login-CSRF: an attacker could graft *their* Google account onto a therapist's connection).
**Rationale**: single-use + subject-bound is the minimum that makes the public callback safe, and it reuses the signing secret the app already validates at boot.

### Decision: The access token is never persisted

Only the refresh token is stored. Each sync run exchanges it in memory via `google-auth-library`'s `OAuth2Client`. **Alternatives**: caching `accessToken`/`expiresAt` columns (rejected — a second credential at rest to save one HTTPS round-trip per batch). Dependency is `google-auth-library` + native `fetch` for the three Calendar endpoints, **not** `googleapis` (which pulls the entire Google API surface for `events.insert/patch/delete`).

### Decision: Minimized event body, fixed 50-minute duration

`summary: "Sesión — JM-4K7QX2"`; `description`: the deep link `${FRONTEND_URL}/consultations/{id}` plus "Gestionado por Umbral — los cambios hechos aquí no vuelven a Umbral."; `extendedProperties.private.umbralGroupId`; **no attendees** (an attendee would email the patient — out of scope and a disclosure). `Consultation` has no duration column, so `DEFAULT_SESSION_MINUTES = 50`. `sessionType` is omitted by rule. Inherited quirk, unchanged: `parseDate` (consultations.service.ts:15) lands date-only input at **server-local 12:00**, so such sessions publish a 12:00 event.

## Data Flow

    create()/correct()  ──tx commit──→ void CalendarSyncService.syncGroup(groupId) ──catch──→ logger.error
                                              │
    @Cron(15m) reconcile() ───────────────────┤   connection.status === CONNECTED ?
      links where syncStatus=FAILED           │
      | lastSessionDate ≠ current sessionDate ▼
      | consultation.deletedAt ≠ null    GoogleTokenCryptoService.decrypt(refreshTokenEncrypted)
      | patient.deletedAt ≠ null              │
      + unlinked sessions in (now, now+90d]   ▼
                                        OAuth2Client.getAccessToken() ──invalid_grant──┐
                                              │                                        │
                                              ▼                                        ▼
                                   events.insert / patch / delete        status=DISCONNECTED, token wiped,
                                              │                          NotificationsService.create(...)
                                              ▼                          (only if CONNECTED→DISCONNECTED won)
                                   CalendarEventLink upsert

    Browser ──/settings──→ POST /authorize ──{url}──→ Google consent ──→ GET /callback ──302──→ /settings?calendar=connected

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/prisma/schema.prisma` | Modify | `GoogleCalendarConnection`, `CalendarEventLink`, 3 enums, `NotificationType.GOOGLE_CALENDAR_DISCONNECTED`, back-relation on `User` |
| `backend/prisma/migrations/*_google_calendar/` | Create | Purely additive |
| `backend/src/common/crypto/aes-gcm.ts` | Create | Extracted AES-256-GCM primitives + base64 key loader |
| `backend/src/modules/documents/document-encryption.service.ts` | Modify | Delegate to the util; no behavior change |
| `backend/src/modules/calendar-integration/calendar-integration.module.ts` | Create | Imports `ConfigModule`, `NotificationsModule`; exports `CalendarSyncService` |
| `.../google-token-crypto.service.ts` | Create | `GOOGLE_TOKEN_ENCRYPTION_KEY`, `onModuleInit` validation (mirrors `DocumentEncryptionService`) |
| `.../calendar-oauth.service.ts` | Create | Auth URL, `state` mint/verify, code exchange, revoke |
| `.../google-calendar.client.ts` | Create | `insertEvent`/`patchEvent`/`deleteEvent`, typed error classification |
| `.../calendar-sync.service.ts` | Create | `syncGroup`, `reconcile` (`@Cron`), event-body builder |
| `.../patient-code.util.ts` | Create | `initials`, `shortCode`, `patientLabel` |
| `.../calendar-integration.constants.ts` | Create | `BACKFILL_WINDOW_DAYS = 90`, `RECONCILE_BATCH_LIMIT = 200`, `DEFAULT_SESSION_MINUTES = 50`, `STATE_TTL_MS`, `CALENDAR_TIME_ZONE = 'America/Santiago'` |
| `.../calendar-integration.controller.ts` | Create | 4 routes (below) |
| `backend/src/modules/consultations/consultations.service.ts` | Modify | Inject `CalendarSyncService`; emit after `create` and `correct` |
| `backend/src/modules/consultations/consultations.module.ts` | Modify | Import `CalendarIntegrationModule` (no cycle: it imports neither consultations nor patients) |
| `backend/src/app.module.ts` | Modify | Register `CalendarIntegrationModule` (`ScheduleModule.forRoot()` already present, line 31) |
| `backend/src/config/env.validation.ts` | Modify | 32-byte check on `GOOGLE_TOKEN_ENCRYPTION_KEY` in production; `GOOGLE_CALENDAR_SYNC_ENABLED` must be exactly `"true"`/`"false"` (mirrors `REMINDERS_ENABLED`, line 83) |
| `frontend/src/pages/SettingsPage.tsx` | Modify | "Google Calendar" card: status, connect, disconnect, `?calendar=` return banner |
| `docs/registro-actividades-tratamiento.md` | Modify | Google as processor |
| `backend/package.json` | Modify | `google-auth-library` |

## Interfaces / Contracts

```prisma
model GoogleCalendarConnection {
  id                    String    @id @default(uuid())
  therapistId           String    @unique
  therapist             User      @relation(fields: [therapistId], references: [id])
  status                GoogleConnectionStatus @default(PENDING)
  disconnectReason      GoogleDisconnectReason?
  googleAccountEmail    String?
  calendarId            String    @default("primary")
  refreshTokenEncrypted Bytes?    // [IV(12)][authTag(16)][ciphertext] — nunca en claro
  scope                 String?
  stateNonceHash        String?   // sha256; se limpia al consumirse (single-use)
  stateExpiresAt        DateTime?
  connectedAt           DateTime?
  disconnectedAt        DateTime?
  lastSyncAt            DateTime?
  lastError             String?
  links                 CalendarEventLink[]
}

// Clave (connectionId, groupId): groupId sobrevive a correct(); connectionId
// permite purgar los links si al reconectar la cuenta de Google es otra.
model CalendarEventLink {
  id              String   @id @default(uuid())
  connectionId    String
  connection      GoogleCalendarConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)
  groupId         String
  googleEventId   String
  lastSessionDate DateTime
  syncStatus      CalendarSyncStatus @default(SYNCED)
  lastError       String?
  lastSyncedAt    DateTime @updatedAt

  @@unique([connectionId, groupId])
  @@index([syncStatus])
}

enum GoogleConnectionStatus { PENDING CONNECTED DISCONNECTED }
enum GoogleDisconnectReason { USER_REQUEST INVALID_GRANT }
enum CalendarSyncStatus     { SYNCED FAILED }
```

REST — all under `@Controller('calendar-integration')`:

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/status` | `JwtAuthGuard` | `{ status, googleAccountEmail, connectedAt, lastSyncAt, lastError }` — never the token |
| POST | `/authorize` | `JwtAuthGuard` | Returns `{ url }` as **JSON, not a 302** — the axios bearer client cannot follow a cross-origin redirect |
| GET | `/callback` | **none** | `?code&state`; verifies + consumes `state`; always 302s to `${FRONTEND_URL}/settings?calendar=connected\|error` |
| POST | `/disconnect` | `JwtAuthGuard` | Revokes at Google, wipes `refreshTokenEncrypted`, `USER_REQUEST`; existing Google events are left in place (they are the therapist's own data) |

Failure classification (`GoogleCalendarClient` → `CalendarSyncService`):

| Google response | Action |
|---|---|
| `invalid_grant` / 401 on refresh | `updateMany({ where: { id, status: CONNECTED }, ... })` → **only a winning transition** notifies, so the therapist is alerted exactly once; token wiped; sync stops. No retry. |
| 404 / 410 on patch or delete | The event is gone (deleted in Google, or a stale link): drop the link; on patch, recreate |
| 403 rate-limit / 5xx / network | Log, `syncStatus = FAILED`, the next reconcile tick retries |
| Any of the above | Never propagates to the clinical write |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `patientLabel` determinism, 2/3/4-token names, diacritics, code stability across a `fullName` change | Table-driven, no I/O |
| Unit | `state` verify: bad signature, expired, wrong `purpose`, replayed nonce → all rejected | Fake clock, mocked Prisma |
| Unit | Event body contains initials+code+deep link and **no** `rut`, `fullName`, `consultReason`, `intervention`, `agreements`, `sessionType` | Assert on the serialized payload — RED first |
| Unit | `invalid_grant` → DISCONNECTED + exactly one notification; a second failure emits none | Assert `updateMany` count gating |
| Unit | Reconciler never deletes an event merely for leaving the 90-day window | Move `sessionDate` to +200d, assert `patch`, not `delete` |
| Integration | `correct()` on `sessionDate` patches the **same** `googleEventId`; a text-only `correct()` still patches once, never inserts | Real Prisma, mocked client |
| Integration | Google client throwing on every call → `create`/`correct` still return 201/200 | Force rejection, assert the clinical row |
| Integration | Backfill = one scoped reconcile: N future sessions in-window, 0 out-of-window | Real Prisma against the test DB |
| E2E | **Tenancy**: therapist B cannot read or disconnect therapist A's connection | RED first; uniform 404, never 403-with-leak |
| E2E | `GET /callback` with a forged `state` never mutates a connection | Public route, so this is the primary attack surface |

## Threat Matrix

N/A — no routing-classification, shell, subprocess, VCS/PR automation, or executable-file-classification boundary; `@nestjs/schedule` uses in-process timers and spawns nothing, and the Google integration is outbound HTTPS, not process integration. The two security-critical invariants (single-use subject-bound `state` on the public callback, and per-therapist tenancy) are carried as mandatory RED E2E tests above instead of as matrix rows — the same posture the archived `session-reminders` design took.

## Migration / Rollout

One additive Prisma migration (two tables, three enums, one enum member), run against `DIRECT_URL` per the schema's Supavisor note. With `GOOGLE_CLIENT_ID` unset the module registers but no-ops with a `logger.warn`, exactly as `MailService` does without `RESEND_API_KEY` — local dev, CI, and e2e boot untouched. `GOOGLE_CALENDAR_SYNC_ENABLED=false` kills the cron and the write-path intents without a deploy revert (and must be set in the e2e env). Delivery follows the proposal's chain: **PR 1** schema + crypto extraction + OAuth/token custody; **PR 2** sync propagation + reconciler; **PR 3** frontend + RAT. Google OAuth app verification for the sensitive `calendar.events` scope is a launch dependency, not a code dependency — test-user mode covers PRs 1–3.

## Confirmed Decisions

- **Deletion trigger**: `DELETE /patients/:id` (soft-delete of the patient) is the real, reachable trigger — confirmed that deleting a patient removes their future Google events. The reconciler also deletes on `consultation.deletedAt` for free once/if consultation soft-delete ever ships, but that path is currently unreachable through any API and is not a blocker.
- **Event duration**: fixed 50 minutes, confirmed. Therapists may resize the event in Google; that resize does not flow back and a later `patch` overwrites it — accepted tradeoff.
