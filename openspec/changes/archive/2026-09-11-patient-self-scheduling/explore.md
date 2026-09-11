# Exploration: Patient Self-Scheduling Portal

## Current State

- **Consultations** created by an authenticated therapist, with `sessionDate` and `scheduledAt`; immutable versioning via `groupId`.
- **Google Calendar Integration** syncs consultations as events, fire-and-forget (never blocks the clinical write).
- **Public routes are limited today**: only `/pago-recibido` and the payment webhooks (`/api/v1/payments/*`).
- **Patients** are created and managed by the therapist; access control is ownership-based (`assertAccess`).
- **Rate limiting** exists on auth endpoints (login, signup); no global throttle elsewhere.

## Affected Areas

- `ConsultationsService`: `create()` will need to check availability before creating.
- `CalendarSyncService`: must verify slots against synced Google events.
- `PatientsService`: the public flow must handle pre-existing patients or auto-creation.
- Prisma schema: new `TherapistAvailability`, `AvailabilityBlockout`, and `PublicHoliday` tables.
- Frontend: new "Working hours" section in the Profile page (weekly schedule + blockouts editor); new public route, no authentication; public New Patient form (reduced fields) for the booking flow.
- Auth: new rate limiter on the public booking endpoint.

## Recommended Approach: Hybrid (Weekly Recurrence + Google Overlay)

**Model:**
- `TherapistAvailability`: per-therapist recurring weekly schedule, configured in the Profile section (day of week, start/end time). Supports arbitrary per-therapist patterns (e.g. Mon–Fri 09:00–17:00, or Mon–Sat 10:00–20:00).
- `AvailabilityBlockout`: exceptions to the weekly schedule. Three types:
  1. **Full-day blockout** — therapist unavailable the entire day (vacation, leave, one-off day off).
  2. **Partial-day blockout** — a time range blocked within an otherwise working day (e.g. works 09:00–17:00 but 13:00–14:00 is blocked).
  3. **Date-range blockout** — a full range of days blocked in one entry (e.g. a week of vacation), instead of creating one row per day.
- `PublicHoliday`: Chile's official holiday calendar, seeded as system defaults and applied as an implicit full-day blockout for every therapist. Country scope: Chile only for this project.
- Query-time: expand the weekly rule → subtract existing consultations → subtract synced Google events → subtract blockouts → subtract public holidays.

**Why:**
- Clear ownership: the therapist controls the base availability.
- Google is the source of truth for external conflicts, but optional — works without sync.
- No variable-cost dependency (no SMS/Twilio); only Postgres + existing backend.
- Extensible later (vacation calendars, shared resources).

## MVP Phases (Recommended)

**Phase 1 — Read-only availability view (confirmed scope)**
- `GET /api/v1/public/therapists/:therapistId/availability` — returns free slots.
- Data source: weekly recurrence + existing consultations + blockouts + public holidays (no Google overlay yet).
- No booking capability in this phase — validates the availability calculation in isolation before any write path is exposed publicly.

**Phase 2 — Booking creation + patient identity (confirmed flow)**
- `POST /api/v1/public/therapists/:therapistId/availability/book`.
- Patient lookup by email + therapistId:
  - **Existing patient** → linked directly to their existing record (same one used in `PatientsPage` detail).
  - **New patient** → presented with the New Patient form, excluding default billing fields and legal documents (those stay therapist-managed, not filled by the public flow). The created patient is linked to the therapist who owns the booking link.
- Creates a `Consultation`; emits calendar sync + payment charge (existing fire-and-forget patterns).

**Phase 3 — Google Calendar overlay + payment integration**
- Query-time checks availability against Google.
- Integrates with the existing payment flow.

## Patient Identity — Confirmed: existing-or-create-inline, no OTP

Either path resolves through lookup by email + therapistId, no OTP:
- **Existing patient**: reuses their `PatientsPage` record as-is.
- **New patient**: public New Patient form (billing defaults and legal documents excluded), linked to the therapist who owns the link.

This replaces the earlier "pre-existing only" assumption — the public flow now supports first-time patients directly.

## Races & Concurrency

Two patients booking the same slot:
- DB-level `UNIQUE` constraint: `(therapistId, sessionDate, slotStart)`.
- First insert wins; the second gets a 409 Conflict → client refreshes availability.

## Security Surface

- **Rate limiting**: throttle the public booking endpoint per therapistId/email.
- **PII**: standard email validation, no email logging.
- **Compute DoS**: cap the query span at 60 days; cache slots for ~5 minutes.
- **Google latency**: accept eventual consistency for the MVP.

## Risks

1. Recurrence expansion: up to ~240 candidates per query over 60 days. Mitigation: 5-minute cache.
2. Therapist schedule drift: keeping Google in sync requires discipline. Mitigation: audit log + docs.
3. Patient email collision: two therapists sharing a patient email. Mitigation: enforce uniqueness per therapist in application logic.
4. Google sync latency: a slot looks free but an event created 30s ago hasn't synced yet. Mitigation: design for eventual consistency.

## Open Questions — Resolved

- ~~Is Phase 1 scope read-only, or does it include booking?~~ → **Read-only**, confirmed.
- ~~Pre-existing patient only, or auto-creation with OTP?~~ → **Both paths supported**: existing patient reuses their record; new patient fills a reduced public form (no billing defaults, no legal documents), linked to the link's owning therapist. No OTP.
- ~~Weekly recurrence + exceptions, or a simpler fixed weekly grid for the MVP?~~ → **Weekly recurrence configured per therapist in Profile** (arbitrary days/hours per therapist) **+ exceptions from day one**: full-day, partial-day, and date-range blockouts, plus Chile's official public holidays as a default full-day blockout.
- Pre-computed/cached slots, or query-time expansion? → Still open; recommendation (query-time + short cache) stands, no new input changes it.

## Regional Scope

- Product is exclusive to Chile. Public holiday defaults use Chile's official calendar; no other-country logic is in scope.

---

**Status**: done — scope confirmed by user, ready for sdd-propose
**Executive Summary**: Explored the patient self-scheduling portal architecture. Recommends a hybrid approach (per-therapist weekly recurrence configured in Profile + blockouts + Chile public holidays + optional Google overlay) with a three-phase rollout (read-only availability view → booking with existing-or-new patient → full Google integration). No external paid services needed; reuses existing Postgres + backend patterns. Phase 1 is confirmed read-only; Phase 2 booking supports both existing patients (linked to their `PatientsPage` record) and new patients (reduced public form, linked to the link's therapist), with no OTP.
**Artifacts**: Engram `sdd/patient-self-scheduling/explore`; OpenSpec `openspec/changes/patient-self-scheduling/explore.md`
**Next Recommended**: sdd-propose
**Risks**: Recurrence computation performance (cache mitigation); therapist schedule drift (sync discipline); patient email collision (per-therapist uniqueness); Google sync latency (eventual consistency); public holiday calendar maintenance (needs a yearly update source for Chile)
