# Tasks: Patient Self-Scheduling Portal

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1600-1900 (5 slices, 150-450 each) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (schema) → PR 2 (availability core) → PR 3 (public scheduling) → PR 4 (Profile editor) → PR 5 (booking page) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main — each slice is independently revertible per the proposal's rollback order, so fast sequential merges fit better than a tracker branch |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Schema, migration, RLS, holiday seed | PR 1 | `npx prisma validate` | `npx prisma migrate dev` on local DB | Drop 4 new tables via down migration; no FK from existing tables |
| 2 | AvailabilityModule + computeSlots + cache | PR 2 | `jest availability.service.spec.ts` | N/A — pure functions, no server needed | Remove `src/modules/availability/*`, unregister from `app.module.ts` |
| 3 | PublicSchedulingModule + booking write + throttling + calendar-sync accommodation | PR 3 | `jest public-scheduling.service.spec.ts consultations.service.spec.ts` | `npm run start:dev` + `curl POST /api/v1/public/therapists/:id/availability/book` | Remove `src/modules/public-scheduling/*`, revert `ConsultationsService`/`PatientsService`/`auth.module.ts` diffs, unregister from `app.module.ts` |
| 4 | Profile working-hours/blockout editor (frontend) | PR 4 | `vitest run ProfileSchedule` | Manual: open Profile, save a weekly window | Remove new Profile components; ProfilePage falls back to prior state |
| 5 | Public booking page (frontend) | PR 5 | `vitest run PublicBooking` | Manual: load `/book/:therapistId`, complete a booking | Remove new booking route/page; no other route depends on it |

## Phase 1: Schema & Data Foundation (PR 1)

- [x] 1.1 Add `TherapistAvailability`, `AvailabilityBlockout`, `BlockoutKind`, `PublicHoliday`, `BookedSlot`, `User.sessionDurationMinutes` to `backend/prisma/schema.prisma` per design's Interfaces/Contracts.
- [x] 1.2 Create `backend/prisma/migrations/<ts>_patient_self_scheduling/migration.sql` with the four tables, unique/index constraints, and `ENABLE ROW LEVEL SECURITY` on each.
- [x] 1.3 Add `PUBLIC_SCHEDULING_ENABLED` env flag to config/env schema (single flag gating both endpoints).
- [x] 1.4 Create `backend/scripts/seed-holidays.ts` fetching Boostr.cl `/holidays.json` and upserting `PublicHoliday` keyed on `(date, countryCode)`; document manual yearly run in a code comment.
- [x] 1.5 Modify `backend/prisma/seed.ts` to invoke the holiday seed for local/dev bootstrap.

## Phase 2: Availability Core (PR 2)

- [x] 2.1 Create `backend/src/common/utils/chile-time.util.ts` mirroring frontend Chile wall-clock helpers (`Intl.DateTimeFormat('America/Santiago')`).
- [x] 2.2 Create `backend/src/modules/availability/availability.service.ts` with `computeSlots(therapistId, from, to)`: expand weekly rules, subtract blockouts/holidays/consultations, apply 24h/60d bounds.
- [x] 2.3 Add in-process `Map` cache to `availability.service.ts` keyed per therapist+range, ~5 min TTL, version bumped on rule/booking writes.
- [x] 2.4 Create `backend/src/modules/availability/availability.controller.ts` (authenticated) with CRUD for weekly schedule, blockouts, and `PUT /availability/schedule` saving grid + `sessionDurationMinutes` atomically.
- [x] 2.5 Create `backend/src/modules/availability/dto/*.dto.ts` (schedule entry, blockout, schedule-update) with `startTime < endTime` validation.
- [x] 2.6 Create `backend/src/modules/availability/availability.module.ts`; register in `backend/src/app.module.ts`.
- [x] 2.7 Write `availability.service.spec.ts`: slot expansion, blockout/holiday/consultation subtraction, 24h/60d bounds, DST gap/repeat days, cache invalidation on write (fixed clock, per Testing Strategy).

## Phase 3: Public Scheduling & Booking (PR 3)

- [x] 3.1 Modify `backend/src/modules/auth/auth.module.ts`: extend `buildAuthThrottlerOptions` with `public-availability` and `public-booking` named throttlers.
- [x] 3.2 Create `backend/src/modules/public-scheduling/public-schedule-throttler.guard.ts` extending `ThrottlerGuard`, tracker `ip:therapistId` (availability) / `ip:therapistId:sha256(email)` (booking); never log plaintext email.
- [x] 3.3 Modify `backend/src/modules/auth/auth.controller.ts`: add both new throttler names to every existing `@SkipThrottle` map.
- [x] 3.4 Modify `backend/src/modules/patients/patients.service.ts`: add `resolveForPublicBooking()` — case-insensitive email match scoped to `therapistId`; ambiguous match or cross-therapist RUT collision returns uniform 409.
- [x] 3.5 Modify `backend/src/modules/consultations/consultations.service.ts` (and `.module.ts` to export it): add `createFromPublicBooking()` using `prisma.$transaction` (recheck slot → insert `BookedSlot` → insert `Consultation`), unique violation → 409.
- [x] 3.6 Create `backend/src/modules/public-scheduling/public-scheduling.controller.ts`: `GET .../availability` and `POST .../availability/book`, gated by `PUBLIC_SCHEDULING_ENABLED`.
- [x] 3.7 Create `backend/src/modules/public-scheduling/dto/*.dto.ts` (query range, booking patient form).
- [x] 3.8 Create `backend/src/modules/public-scheduling/public-scheduling.module.ts` importing `AvailabilityModule`, `PatientsModule`, `ConsultationsModule`; register in `app.module.ts`.
- [x] 3.9 Verify calendar-sync push path already treats `createFromPublicBooking()` output identically (same `emitCalendarSync` call, non-blocking failure) — no calendar-sync module change expected; add a regression assertion if the emit call is not already shared.
- [x] 3.10 Write `patients.service.spec.ts` additions: existing match, new create, cross-therapist RUT collision, ambiguous email (mocked Prisma).
- [x] 3.11 Write `consultations.service.integration.spec.ts` additions: concurrent `Promise.all` inserts on the same slot yield exactly one consultation and one 409 (real Postgres).
- [x] 3.12 Write e2e spec: public routes reachable without JWT, 429 after configured throttle budget, span > 60 days rejected, existing auth throttlers unaffected (Supertest + DI override of throttler options token).

## Phase 4: Profile Working-Hours Editor (PR 4)

- [ ] 4.1 Create frontend components for weekly schedule grid + `sessionDurationMinutes` input, wired to `PUT /availability/schedule`.
- [ ] 4.2 Create blockout editor (full-day / partial-day / date-range) wired to availability blockout CRUD endpoints.
- [ ] 4.3 Wire both into the existing ProfilePage.
- [ ] 4.4 Write component tests: save valid schedule, reject `startTime >= endTime`, add/remove blockout.

## Phase 5: Public Booking Page (PR 5)

- [ ] 5.1 Modify `frontend/src/utils/datetime.ts`: add slot-grid display helpers (reuse existing Chile-time utilities).
- [ ] 5.2 Create public booking page (unauthenticated route) fetching `GET .../availability` and rendering a slot picker.
- [ ] 5.3 Create reduced public patient form (email + minimal fields) submitting `POST .../availability/book`; handle 409 by refetching slots.
- [ ] 5.4 Write component tests: slot render, 409-triggers-refetch, submission with existing vs. new email.
