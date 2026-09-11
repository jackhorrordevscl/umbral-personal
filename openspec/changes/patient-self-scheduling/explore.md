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
- Prisma schema: new `TherapistAvailability` + `AvailabilityBlockout` tables.
- Frontend: new public route, no authentication.
- Auth: new rate limiter on the public booking endpoint.

## Recommended Approach: Hybrid (Weekly Recurrence + Google Overlay)

**Model:**
- `TherapistAvailability`: fixed weekly schedule (day of week, start/end time, slot duration).
- `AvailabilityBlockout`: exceptions/vacations.
- Query-time: expand the weekly rule → subtract existing consultations → subtract synced Google events → subtract blockouts.

**Why:**
- Clear ownership: the therapist controls the base availability.
- Google is the source of truth for external conflicts, but optional — works without sync.
- No variable-cost dependency (no SMS/Twilio); only Postgres + existing backend.
- Extensible later (vacation calendars, shared resources).

## MVP Phases (Recommended)

**Phase 1 — Read-only availability view**
- `GET /api/v1/public/therapists/:therapistId/availability` — returns free slots.
- Data source: weekly recurrence + existing consultations (no Google overlay yet).

**Phase 2 — Booking creation + patient identity**
- `POST /api/v1/public/therapists/:therapistId/availability/book`.
- Patient lookup by email + therapistId (pre-existing); creates a `Consultation`.
- Emits calendar sync + payment charge (existing fire-and-forget patterns).

**Phase 3 — Google Calendar overlay + payment integration**
- Query-time checks availability against Google.
- Integrates with the existing payment flow.

## Patient Identity — Recommended: Pre-existing only

The patient must already exist in the DB (created by the therapist via the web app):
- Lookup by email + therapistId.
- No OTP for the MVP.
- Simpler, avoids spam, respects ownership.

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

## Open Questions for Proposal

- Is Phase 1 scope read-only, or does it include booking?
- Pre-existing patient only, or auto-creation with OTP?
- Weekly recurrence + exceptions, or a simpler fixed weekly grid for the MVP?
- Pre-computed/cached slots, or query-time expansion?

---

**Status**: done
**Executive Summary**: Explored the patient self-scheduling portal architecture. Recommends a hybrid approach (weekly recurrence + Google overlay) with a three-phase rollout (availability view → booking → full Google integration). No external paid services needed; reuses existing Postgres + backend patterns. MVP targets pre-existing-patient booking via a public endpoint with rate limiting and race-condition handling.
**Artifacts**: Engram `sdd/patient-self-scheduling/explore`; OpenSpec `openspec/changes/patient-self-scheduling/explore.md`
**Next Recommended**: sdd-propose (after the user confirms phase scope and patient identity approach)
**Risks**: Recurrence computation performance (cache mitigation); therapist schedule drift (sync discipline); patient email collision (per-therapist uniqueness); Google sync latency (eventual consistency)
