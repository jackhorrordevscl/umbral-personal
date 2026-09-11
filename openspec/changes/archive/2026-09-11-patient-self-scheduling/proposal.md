# Proposal: Patient Self-Scheduling Portal

## Intent

Today every session is scheduled manually by the therapist. Patients have no way to see free time or book it, so scheduling runs through out-of-band messaging. This change exposes a public, unauthenticated availability and booking surface driven by a therapist-owned schedule, removing manual back-and-forth without weakening ownership-based access control.

## Scope

### In Scope

- `TherapistAvailability`: per-therapist recurring weekly schedule (day of week, start/end time), edited in Profile.
- `sessionDurationMinutes`: per-therapist session length, configured alongside the weekly schedule in Profile (not per session type).
- `AvailabilityBlockout`: full-day, partial-day time-range, and date-range exceptions.
- `PublicHoliday`: Chile's official calendar, seeded as system defaults, applied as an implicit full-day blockout.
- Phase 1 — read-only `GET /api/v1/public/therapists/:therapistId/availability`.
- Phase 2 — `POST .../availability/book`; patient lookup by email + `therapistId`; existing patients link to their record, new patients use a reduced public form; no OTP.
- Query-time slot computation with a ~5 minute cache; minimum booking lead time of 24 hours; maximum booking horizon of 60 days; rate limiting on public endpoints.
- `UNIQUE (therapistId, sessionDate, slotStart)` for double-booking protection (409 on conflict).

### Out of Scope

- **Phase 3 (Google Calendar availability overlay, payment collection at booking) is delivered as a separate follow-up change**, opened only after this change (Phases 1-2) ships and is archived. Keeps this change's PR surface bounded and lets the auto-scheduling core ship independently of Google/payments readiness.
- OTP / patient authentication, rescheduling and cancellation by patients, waitlists.
- Billing defaults and legal documents in the public patient form (stay therapist-managed).
- Per-session-type duration overrides (a single per-therapist duration covers the MVP).
- Any non-Chile regional logic.

## Capabilities

### New Capabilities
- `therapist-availability`: weekly schedule, blockouts, public holidays, and slot computation rules.
- `public-scheduling`: unauthenticated availability read, booking write, patient identity resolution, rate limiting.

### Modified Capabilities
- `calendar-sync`: push-only propagation must accommodate consultations originating from the public flow (Phase 3 adds read overlay).

## Approach

Hybrid model: expand the weekly rule over the requested range, then subtract existing consultations, blockouts, and public holidays. Computation happens at query time behind a short cache rather than pre-materialized slots, keeping the schedule editable without backfill jobs. The public write path reuses existing `ConsultationsService` and fire-and-forget calendar sync; correctness under concurrency is enforced by the database, not by read-time checks.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | New | Three tables + unique constraint |
| `ConsultationsService` | Modified | Availability check before create |
| `PatientsService` | Modified | Public existing-or-create resolution |
| Public API module | New | Availability + booking routes, throttling |
| Profile page | New | Working-hours and blockouts editor |
| Public booking page | New | Unauthenticated slot picker + form |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Recurrence expansion cost (~240 candidates/query) | Med | 60-day cap + 5-minute cache |
| Stale cache shows a taken slot | Med | DB unique constraint → 409 → client refresh |
| Patient email shared across therapists | Med | Uniqueness scoped per therapist |
| Public endpoint abuse / PII scraping | Med | Per-therapist and per-email rate limits, no email logging |
| Chile holiday calendar goes stale | Low | Seeded data with a documented yearly update task |
| Therapist schedule drift vs. Google | Med | Accept eventual consistency until Phase 3 |

## Rollback Plan

Phases ship independently. Revert order: disable the public routes (feature flag or route removal) → revert the frontend booking page → revert `ConsultationsService`/`PatientsService` changes → drop the new tables via a down migration. Therapist-side scheduling is untouched by every step, so rollback never affects existing consultations.

## Dependencies

- Chile public-holiday source data for the seed.
- Existing rate-limiting infrastructure (currently auth-only) extended to public routes.

## Open Product Decisions — Resolved

- ~~Slot granularity and session duration~~ → **Per therapist**, configured alongside the weekly schedule (`sessionDurationMinutes`). No per-session-type overrides in the MVP.
- ~~Minimum booking lead time and maximum booking horizon~~ → **24 hours minimum lead time, 60 days maximum horizon.**
- ~~Whether Phase 3 is delivered inside this change or as a follow-up change~~ → **Follow-up change**, opened after this one archives.

## Success Criteria

- [ ] A therapist configures a weekly schedule and blockouts from Profile.
- [ ] The public availability endpoint returns only genuinely free slots, excluding holidays and blockouts.
- [ ] An existing patient books into their own record; a new patient is created and linked to the link's therapist.
- [ ] Concurrent bookings for one slot produce exactly one consultation and one 409.
- [ ] Public endpoints are rate limited and capped at a 60-day span.
