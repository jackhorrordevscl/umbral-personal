# Design: Session Reminders (therapist in-app + email)

## Technical Approach

A `@nestjs/schedule` cron in a new `RemindersModule` ticks every 5 minutes, queries the *current* version of every non-deleted `Consultation` whose `sessionDate` falls in `(now, now + 24h]`, and for each (offset, channel) still due, claims a `ReminderDispatch` row and dispatches. Idempotency is a DB unique constraint, not application logic. `NotificationsModule` owns a generic `Notification` model plus therapist-scoped REST endpoints; `MailService` gains one method per its existing one-method-per-email-type convention.

## Architecture Decisions

### Decision: Dispatch-log table keyed on `(groupId, sessionDate, offsetKind, channel)`

| Option | Tradeoff |
|---|---|
| Per-channel/per-offset booleans on `Consultation` | 4 columns now, 6+ for slices 2–3; can't record `sentAt`/failure; can't re-arm on reschedule without clearing flags |
| Dispatch log keyed on `consultationId` | Re-arms on *any* `correct()` (new row id), including a typo fix that never moved the date → duplicate email |
| **Dispatch log keyed on `(groupId, sessionDate, offsetKind, channel)`** ✅ | Re-arm semantics fall out of the key |

**Rationale**: `correct()` (consultations.service.ts:214) never mutates the original row — it creates a new row sharing `groupId`. Keying on `groupId + sessionDate` means moving `sessionDate` produces a *new* key, so all offsets re-arm automatically (Business Rule 2) with zero hook code; a correction that leaves `sessionDate` untouched reuses the existing key and stays silent. `Consultation.reminderSent` is **dropped**: dead since the original schema, always `false`, superseded by this table. Removal touches the column, `correct()`'s copy-forward at line 230, and one spec fixture assertion.

### Decision: Unique constraint as the race-safe at-most-once guarantee

**Choice**: Claim-then-send. Insert the `ReminderDispatch` row with `status: PENDING` *before* sending; a `P2002` unique violation means another tick or another instance already owns it → skip silently. Update to `SENT`/`FAILED` after.
**Alternatives considered**: Postgres advisory lock (needs a session-pinned connection — incompatible with Supavisor transaction-mode pooling, see schema.prisma:11–17); "single instance today, defer" (unverifiable and silently breaks on scale-out).
**Rationale**: The constraint holds across instances, overlapping ticks, and process restarts without new infrastructure. It buys *at-most-once*, which is exactly the stated rule; a send that fails after the claim is recorded `FAILED` and logged, never retried — consistent with `MailService`'s existing fire-and-forget posture.

### Decision: Due-ness as an instant predicate, not a time band

**Choice**: An offset is due when `sessionDate.getTime() - offsetMs <= now.getTime() < sessionDate.getTime()`. The 24h query bound only *bounds the scan*; it is not the correctness mechanism.
**Alternatives considered**: Firing only inside a ±5min band around each threshold (a missed tick loses the reminder permanently).
**Rationale**: One predicate satisfies three rules at once — a delayed tick still fires (Risk: process down), a session created 3h out fires its 24h offset on the next tick (Business Rule 1), and the dispatch log prevents the re-fire that an open-ended predicate would otherwise cause every tick.

### Decision: When multiple offsets are simultaneously due, only the nearest fires

**Choice**: For a given (consultation, channel), if more than one offset is due on the same tick (e.g. a session created 10 minutes out — both H24 and H2 have already elapsed), only the offset with the smallest `offsetMs` (closest to `sessionDate` — H2 over H24) is actually claimed and dispatched. Every other simultaneously-due offset for that (consultation, channel) is written to `ReminderDispatch` with `status: SKIPPED` in the same pass — not left pending, not fired later. `SKIPPED` still occupies the unique key, so a later tick can never dispatch it either.
**Alternatives considered**: Fire all simultaneously-due offsets (original Business Rule 1 reading — rejected: a 10-minutes-out booking would otherwise produce 2 emails + 2 notifications almost back-to-back, which reads as a bug to the therapist, not a feature); silently drop the farther offset with no record (rejected: indistinguishable from a delivery failure during troubleshooting).
**Rationale**: "Fire immediately instead of skipping" (Business Rule 1) was decided for the ordinary one-offset-elapsed case (booked with 3h notice, misses only the 24h mark). It was never meant to stack multiple simultaneous sends for the same session — the nearest offset is always a superset-in-spirit of the farther one at that point (there is no useful "24h notice" left to give 10 minutes before a session). `SKIPPED` (not silently omitted) keeps the dispatch log a complete audit trail.

### Decision: UTC instant arithmetic; explicit render zone

**Choice**: All due-ness math is millisecond arithmetic on `Date` instants (`sessionDate` is `timestamp(3)` UTC via Prisma). Human-facing strings render through `Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago' })`.
**Rationale**: No local-calendar arithmetic anywhere, so DST transitions cannot shift an offset. Pre-existing quirk noted, not changed: `parseDate` (consultations.service.ts:15) lands date-only input at **server-local 12:00**, so a date-only session's absolute instant depends on server TZ — out of scope here, but reminder text must never imply minute-level precision for such rows.

### Decision: No `ConsultationsService` hook

**Choice**: `ConsultationsModule` is **not** modified except for the `reminderSent` removal. `create`/`correct` emit nothing; the poller discovers new and corrected sessions on its next tick.
**Alternatives considered**: Direct `RemindersService` call from `create`/`correct` (couples the clinical write path to email infrastructure and risks a circular import); a NestJS `EventEmitter` (new dependency for a problem polling already solves).
**Rationale**: The proposal listed consultations as "modified", but the `groupId + sessionDate` key makes re-arming a *query* consequence rather than an *event* consequence. Worst case latency is one tick (5 min) against a 24h horizon.

### Decision: `Notification` is channel-generic, not reminder-shaped

**Choice**: `type` enum + `title`/`body`/`linkPath`/`metadata Json?`. No `consultationId` FK column.
**Rationale**: Slice 3 emits "your Google Calendar connection was revoked" — no consultation exists. `linkPath` carries the deep link (`/consultations/{id}`) and `metadata` the structured payload, so future slices add an enum member and nothing else.

## Data Flow

    @Cron(5m) ──→ RemindersService.scan()
                       │  Consultation where deletedAt:null, correctedBy:null,
                       │  sessionDate in (now, now+24h]
                       ▼
                  for each × {H24,H2} × {IN_APP,EMAIL}, if due:
                       │
                       ├─→ ReminderDispatch.create(PENDING) ──P2002──→ skip
                       │            │ claimed
                       │            ├─→ NotificationsService.create(userId=therapistId)
                       │            └─→ MailService.sendSessionReminderEmail(...)
                       │
                       └─→ update status SENT | FAILED

    Frontend ──poll──→ GET /notifications/unread-count ──→ NotificationsService (scoped by CurrentUser.id)

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/prisma/schema.prisma` | Modify | Add `Notification`, `ReminderDispatch`, 4 enums; back-relations on `User`/`Consultation`; **drop** `Consultation.reminderSent` |
| `backend/prisma/migrations/*_session_reminders/` | Create | Additive tables + one `DROP COLUMN "reminderSent"` |
| `backend/src/modules/notifications/notifications.module.ts` | Create | Exports `NotificationsService` |
| `backend/src/modules/notifications/notifications.service.ts` | Create | `create`, `list`, `unreadCount`, `markRead`, `markAllRead` — every method takes `userId` |
| `backend/src/modules/notifications/notifications.controller.ts` | Create | `@UseGuards(JwtAuthGuard)` + `@CurrentUser()`, per patients/consultations convention |
| `backend/src/modules/reminders/reminders.module.ts` | Create | Imports `NotificationsModule`, `MailModule` |
| `backend/src/modules/reminders/reminders.service.ts` | Create | Scan, due-ness predicate, claim, dispatch |
| `backend/src/modules/reminders/reminders.constants.ts` | Create | Offset table, batch limit, render timezone |
| `backend/src/modules/mail/mail.service.ts` | Modify | `sendSessionReminderEmail(to, therapistName, patientFullName, when, offsetLabel)` |
| `backend/src/app.module.ts` | Modify | `ScheduleModule.forRoot()`, `NotificationsModule`, `RemindersModule` |
| `backend/src/config/env.validation.ts` | Modify | Optional `REMINDERS_ENABLED` (default `true`) |
| `backend/src/modules/consultations/consultations.service.ts` | Modify | Delete `reminderSent: original.reminderSent` (line 230) |
| `backend/src/modules/consultations/consultations.service.spec.ts` | Modify | Drop the `reminderSent` fixture assertion |
| `backend/package.json` | Modify | `@nestjs/schedule` |
| `frontend/src/**` | Create | Bell badge + notification list, polling `unread-count` |

## Interfaces / Contracts

```prisma
model Notification {
  id        String           @id @default(uuid())
  userId    String
  user      User             @relation(fields: [userId], references: [id])
  type      NotificationType
  title     String
  body      String
  linkPath  String?
  metadata  Json?
  readAt    DateTime?
  createdAt DateTime         @default(now())

  @@index([userId, readAt])
  @@index([userId, createdAt])
}

enum NotificationType {
  SESSION_REMINDER // slices 2-3 add members here, no schema reshape
}

// `offsetKind`, not `offset`: OFFSET is a reserved word in Postgres and this
// project writes plain (unmapped) column names.
model ReminderDispatch {
  id             String                 @id @default(uuid())
  groupId        String
  sessionDate    DateTime
  offsetKind     ReminderOffset
  channel        ReminderChannel
  consultationId String
  consultation   Consultation           @relation(fields: [consultationId], references: [id])
  therapistId    String
  status         ReminderDispatchStatus @default(PENDING)
  error          String?
  sentAt         DateTime?
  createdAt      DateTime               @default(now())

  // La garantía de "a lo más un envío" NO es lógica de aplicación: es esta
  // restricción. Mover sessionDate genera una clave nueva => re-arma.
  @@unique([groupId, sessionDate, offsetKind, channel])
  @@index([consultationId])
}

enum ReminderOffset         { H24 H2 }
enum ReminderChannel        { IN_APP EMAIL }
enum ReminderDispatchStatus { PENDING SENT FAILED SKIPPED }
```

```typescript
// reminders.constants.ts
export const REMINDER_OFFSETS = [
  { kind: 'H24' as const, ms: 24 * 60 * 60 * 1000, label: '24 horas' },
  { kind: 'H2'  as const, ms:  2 * 60 * 60 * 1000, label: '2 horas'  },
];
export const MAX_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
export const SCAN_BATCH_LIMIT = 500;
export const RENDER_TIME_ZONE = 'America/Santiago';

// reminders.service.ts — detection query
@Cron(CronExpression.EVERY_5_MINUTES)
async scan() {
  if (!this.enabled) return;
  const now = new Date();
  const due = await this.prisma.consultation.findMany({
    where: {
      deletedAt: null,        // regla: excluye soft-deleted
      correctedBy: null,      // solo la versión vigente de la cadena
      sessionDate: { gt: now, lte: new Date(now.getTime() + MAX_LOOKAHEAD_MS) },
    },
    orderBy: { sessionDate: 'asc' },
    take: SCAN_BATCH_LIMIT,
    include: {
      patient:   { select: { fullName: true } },
      therapist: { select: { name: true, email: true } },
    },
  });
  // due-ness: sessionDate - offset.ms <= now  (aritmética de instantes, UTC)
  // si >1 offset está vencido para el mismo (consultation, channel), solo se
  // despacha el más cercano (menor offsetMs); el resto queda SKIPPED, no PENDING.
}
```

REST contract — all under `@UseGuards(JwtAuthGuard)`, scoped by `@CurrentUser() user.id`:

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | `PaginationQueryDto` (`page`/`pageSize`), `orderBy createdAt desc` |
| GET | `/notifications/unread-count` | **Must be declared before any `:id` route** — same Express-5 wildcard trap documented at consultations.controller.ts:40 |
| PATCH | `/notifications/:id/read` | `updateMany({ where: { id, userId } })`; 0 rows → 404 |
| PATCH | `/notifications/read-all` | Sets `readAt` on all unread rows for `userId` |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Due-ness predicate at 24h/2h boundaries, past sessions, DST-crossing dates | Fake `now`, table-driven on instants |
| Unit | Re-arm matrix: date moved → 4 new dispatches; text-only `correct()` → 0 | Mock Prisma, assert claim keys |
| Unit | `P2002` on claim → skip, no email sent | Reject `create`, assert `MailService` not called |
| Unit | Session created 10min out: only H2 dispatched, H24 written `SKIPPED`, one email/notification not two | Fake `now` so both offsets are simultaneously due |
| Unit | Missing `RESEND_API_KEY` still yields the in-app notification | `MailService` with null client |
| Integration | Scan excludes `deletedAt != null` and superseded (`correctedBy != null`) rows | Real Prisma against test DB |
| Integration | Two consecutive scans produce exactly one dispatch per tuple | Run `scan()` twice, count rows |
| E2E | **Tenancy: therapist B cannot read or mark-read therapist A's notification** | RED first; 404, never 403-with-leak |
| E2E | `unread-count` resolves before `:id` (route-order regression) | Request the literal path |

## Threat Matrix

N/A — no routing-classification, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. `@nestjs/schedule` uses in-process timers, spawning nothing. The one security-relevant invariant (per-therapist tenancy isolation on the new endpoints) is carried as a mandatory RED E2E test above rather than as a matrix row.

## Migration / Rollout

One additive Prisma migration plus `DROP COLUMN "reminderSent"` — safe because the column has never been written to a non-default value (only copy-forward at consultations.service.ts:230). Run against `DIRECT_URL` per the schema's Supavisor note. `REMINDERS_ENABLED=false` disables the cron without a deploy revert and must be set in the e2e environment so `AppModule` boot never fires reminders. Retention: none in this slice; `@@index([userId, createdAt])` keeps pagination cheap, and a purge job is a follow-up.

## Open Questions

None. The only open item — a session created ~10 minutes before it starts, where both offsets are simultaneously elapsed — was resolved: only the nearest offset (H2) dispatches; the farther one (H24) is recorded `SKIPPED`, never fired. See "When multiple offsets are simultaneously due, only the nearest fires" above.
