# Design: Patient Self-Scheduling Portal

## Technical Approach

Two new backend modules. `AvailabilityModule` owns the rules (weekly grid, blockouts, holidays) and the pure `computeSlots()`; `PublicSchedulingModule` owns the unauthenticated surface and imports `AvailabilityModule`, `PatientsModule`, `ConsultationsModule` — no cycle, since none of the three imports it (same criterion documented in `consultations.module.ts`). Slots are computed at query time behind a 5-minute in-process cache — no materialized slot rows, no backfill job. Occupancy is read from `Consultation`; concurrency is guarded by a separate `BookedSlot` table. Phase 3's Google overlay stays open: it becomes one more subtraction step inside `computeSlots`, touching nothing else.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|---|---|---|---|
| 1 | Double-booking guard | New `BookedSlot` table, `@@unique([therapistId, slotStart])`, keyed on `groupId` | `@@unique` on `Consultation(therapistId, sessionDate)` | `correct()` inserts a **new row with the same `therapistId`/`sessionDate`**, so that constraint rejects every correction. A partial index can't help: "current version" is `correctedBy: null`, a back-relation, not a column. `groupId` keying matches `Payment`/`ReminderDispatch`. |
| 2 | Occupancy read | Query `Consultation` where `{ correctedBy: null, deletedAt: null }` | Read `BookedSlot` | Predicate already proven in `findOne`/`syncGroup`; zero backfill, no drift. `BookedSlot` is only a race guard. |
| 3 | Write path | New `ConsultationsService.createFromPublicBooking()` | Availability checks inside `create()` | Leaves therapist-side scheduling untouched (rollback plan) and never imposes 409s on retroactive logging. Reuses `emitCalendarSync`/`emitPaymentCharge`. |
| 4 | Blockout shape | One half-open `[startsAt, endsAt)` + presentational `kind` | Three tables / three code paths | All three types are intervals: one subtraction path, editor keeps round-trip fidelity. |
| 5 | Wall-clock storage | `dayOfWeek` + `startMinute`/`endMinute` as `Int` | `DateTime` for times | A weekly rule is wall-clock, not an instant; `DateTime` silently binds a date and breaks across DST. |
| 6 | Cache | In-process `Map` + per-therapist version bumped on every rule/booking write | `@nestjs/cache-manager`, Redis | Not installed; single instance; no new dependency. |
| 7 | Rate limiting | Extend the **existing** `buildAuthThrottlerOptions` with two named throttlers + `PublicScheduleThrottlerGuard extends ThrottlerGuard` | New `ThrottlerModule` registration | `ThrottlerModule` is `@Global()` in v6 (verified in `node_modules`), so AuthModule's registration already reaches every module. Module-level `getTracker` is global, so per-therapist/per-email tracking needs a guard subclass. |
| 8 | Duration ownership | `User.sessionDurationMinutes`, saved atomically with the grid via `PUT /availability/schedule` | Field on `UpdateProfileDto` | Duration is both slot length and grid step; a grid saved against a stale duration is incoherent. |

## Data Flow

    GET /public/therapists/:id/availability
      → ThrottlerGuard(public-availability, tracker = ip:therapistId)
      → AvailabilityService.computeSlots(id, from, to)   [cache hit → return]
           expand weekly rules over Chile calendar days
             − PublicHoliday days   − Blockout intervals
             − Consultation[correctedBy:null, deletedAt:null]
             − slots < now+24h   − slots > now+60d
      → free slots

    POST /public/therapists/:id/availability/book
      → ThrottlerGuard(public-booking, tracker = ip:therapistId:sha256(email))
      → PatientsService.resolveForPublicBooking()  → existing | created
      → prisma.$transaction: recheck slot → INSERT BookedSlot → INSERT Consultation
           unique violation ⇒ 409 (client refetches)
      → emitCalendarSync + emitPaymentCharge (fire-and-forget, unchanged)

Slot grid: `for (t = startMinute; t + duration <= endMinute; t += duration)`. Chile wall time → instant via `Intl.DateTimeFormat('America/Santiago')` (same technique as `buildLocalISO`); DST-nonexistent times are skipped, repeated times take the first occurrence.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/prisma/schema.prisma` | Modify | `TherapistAvailability`, `AvailabilityBlockout`, `PublicHoliday`, `BookedSlot`, `User.sessionDurationMinutes` |
| `backend/prisma/migrations/<ts>_patient_self_scheduling/migration.sql` | Create | Tables + `ENABLE ROW LEVEL SECURITY` on all four (Supabase `rls_disabled_in_public`) |
| `backend/prisma/seed.ts` | Modify | Chile's official holiday calendar |
| `backend/src/modules/availability/*` | Create | Rules CRUD + `computeSlots` + cache, authenticated controller, DTOs |
| `backend/src/modules/public-scheduling/*` | Create | Public controller, service, DTOs, `PublicScheduleThrottlerGuard` |
| `backend/src/common/utils/chile-time.util.ts` | Create | Backend mirror of the frontend Chile helpers |
| `backend/src/modules/auth/auth.module.ts` | Modify | Two new named throttlers |
| `backend/src/modules/auth/auth.controller.ts` | Modify | Add both names to **every** `@SkipThrottle` map |
| `backend/src/modules/consultations/consultations.{service,module}.ts` | Modify | `createFromPublicBooking()`; export `ConsultationsService` |
| `backend/src/modules/patients/patients.service.ts` | Modify | `resolveForPublicBooking()` |
| `backend/src/app.module.ts` | Modify | Register both new modules |
| `frontend/src/utils/datetime.ts` | Modify | Extend with slot-grid helpers (reuse, do not reinvent) |
| `frontend` ProfilePage + new public booking page | Create/Modify | Working-hours editor; slot picker + reduced form |

## Interfaces / Contracts

```prisma
model TherapistAvailability {
  id String @id @default(uuid())
  therapistId String
  dayOfWeek   Int   // 1=Mon .. 7=Sun (ISO)
  startMinute Int   // minutes from Chile local midnight
  endMinute   Int
  @@unique([therapistId, dayOfWeek, startMinute])
}

model AvailabilityBlockout {
  id String @id @default(uuid())
  therapistId String
  startsAt DateTime  // half-open [startsAt, endsAt)
  endsAt   DateTime
  kind     BlockoutKind
  reason   String?
  @@index([therapistId, startsAt])
}
enum BlockoutKind { FULL_DAY PARTIAL_DAY DATE_RANGE }

model PublicHoliday {
  id String @id @default(uuid())
  date DateTime @db.Date
  name String
  countryCode String @default("CL")
  @@unique([date, countryCode])
}

model BookedSlot {
  id String @id @default(uuid())
  therapistId String
  groupId     String   @unique   // invariant across correct()
  slotStart   DateTime
  @@unique([therapistId, slotStart])
}
```

```ts
computeSlots(therapistId: string, from: Date, to: Date): Promise<SlotDto[]>
resolveForPublicBooking(therapistId: string, dto: PublicBookingPatientDto): Promise<Patient>
```

**Identity resolution gotchas (load-bearing):** `Patient.rut` is **globally** unique, not per-therapist — a patient already registered with another therapist cannot self-create, so return a uniform 409 that never reveals existence. `Patient.email` is nullable and non-unique — match case-insensitively scoped to `therapistId`; more than one match is ambiguous and must fall back to the same uniform 409 rather than guessing. Creation explicitly omits `defaultSessionAmount`, documents, and consents.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Slot expansion; blockout/holiday/consultation subtraction; 24h and 60-day bounds; DST gap and repeat days; cache invalidation on write | Jest, pure `computeSlots` with fixed clock |
| Unit | `resolveForPublicBooking`: existing match, new create, cross-therapist RUT collision, ambiguous email | Mocked Prisma, as in `patients.service.spec.ts` |
| Integration | `BookedSlot` unique violation ⇒ exactly one consultation + one 409 under concurrent inserts | Real Postgres, parallel `Promise.all` (pattern of `consultations.service.integration.spec.ts`) |
| E2E | Public routes reachable without JWT; 429 after the configured budget; span > 60 days rejected; existing auth throttlers unaffected by the new names | Supertest + DI override of the throttler options token |

## Threat Matrix

N/A — all five rows of `references/threat-matrix.md` (documentation-like paths, git repository selection, commit state, push state, PR commands) target shell/VCS/executable-classification boundaries; this change adds no subprocess, no VCS invocation, and no file classification. HTTP-surface adversarial cases (unauthenticated access, throttle exhaustion, span abuse, PII non-disclosure, concurrent booking) are covered in Testing Strategy.

## Migration / Rollout

Additive migration only; no backfill (decision 2 makes historical consultations occupy slots without `BookedSlot` rows). Phase 1 ships schema + rules editor + read-only endpoint. Phase 2 adds the booking route. `PUBLIC_SCHEDULING_ENABLED` is a single flag gating both the read endpoint and the booking endpoint — no split flag for the MVP, since there is no value in leaving the read-only view public while booking is disabled. Rollback is the proposal's order; dropping the four tables never touches `Consultation` or `Patient`.

## Holiday Data Source

Source: [Boostr.cl](https://api.boostr.cl/holidays.json) (`GET /holidays.json`, no API key, `{date, title, type, inalienable, extra}` per entry). Chosen over "FeriadosApp" because `feriadosapp.com/api/` now 301-redirects to `docs.boostr.cl` — FeriadosApp runs on Boostr's infrastructure, so Boostr is the actual source, not a third-party wrapper. Chile's own government holiday API (`apis.digital.gob.cl/fl/`) is deprecated; no better official alternative exists today.

**Update strategy: yearly manual seed script, not a live call.** `backend/prisma/seed.ts` (or a dedicated `scripts/seed-holidays.ts`) fetches Boostr's endpoint once and upserts into `PublicHoliday`, keyed on `date`. Run manually once a year (Dec/Jan, when the following year's calendar is published) — never at request time, so a Boostr outage or API change never affects the public availability endpoint. No cron/scheduled job for the MVP: a once-a-year manual run doesn't justify the added operational surface.

## Open Questions

Resolved — no open questions remain for this design.
