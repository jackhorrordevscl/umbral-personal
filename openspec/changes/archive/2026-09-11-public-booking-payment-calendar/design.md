# Design: Public Booking — Calendar Overlay and In-Page Payment Checkout

## Technical Approach

Two independent, flag-gated slices over existing machinery. The overlay is a write-behind Postgres cache filled by a cron job and consumed by `computeSlots()` through its **existing** `blockouts` parameter, so the pure function `computeAvailableSlots()` is not touched. The checkout slice adds no new gateway plumbing: the Flow return endpoint the proposal asked for **already exists and is production-proven**, so only a read-side poll endpoint is new.

## Architecture Decisions

### Decision 1: Read busy intervals via `events.list`, not `freebusy.query` — no OAuth migration

| Option | Tradeoff |
|---|---|
| `freebusy.query` + new read scope | Needs `calendar.readonly`/`calendar.freebusy`; **every connected therapist must re-consent**; cannot distinguish Umbral's own pushed events |
| **`events.list` under the current `calendar.events` scope (chosen)** | Zero re-consent, zero migration, overlay live for all connected therapists on day one; requires manual recurrence/transparency handling |

**Rationale**: `calendar.events` ("view and edit events on all your calendars") already authorizes reading events — `GoogleCalendarClient` only ever exercised its write half. The entire High risk in the proposal was an artifact of assuming `freebusy` was the only read path. Privacy parity is preserved by sending `fields=items(start,end,status,transparency,extendedProperties),nextPageToken`: Google never returns `summary`, `description`, `attendees`, or `location`, so no clinical or personal content enters the process. `events.list` is also strictly *more* precise — events carrying `extendedProperties.private.umbralGroupId` are Umbral's own pushed sessions and are excluded, which `freebusy` cannot do.

**Guard**: this decision rests on `calendar.events` permitting `events.list`. Tasks MUST open with a spike that calls `events.list` with an existing connection's refresh token. If it 403s, fall back to a forced-reconnect banner (rejected alternative above) — the rest of the design is unchanged.

Query per connection: `GET /calendars/{calendarId}/events?timeMin=now&timeMax=now+60d&singleEvents=true&orderBy=startTime&showDeleted=false`. Discard `status=cancelled`, `transparency=transparent`, and all-day entries (`start.date`, no `dateTime`) — all-day events do not block, matching how a therapist actually uses a day marker.

### Decision 2: Reuse the existing Flow return endpoint unchanged

`POST|GET /api/v1/payments/return` → `PaymentsService.resolveReturnRedirectUrl(token)` → 302 to `{FRONTEND_URL}/pago-recibido?token=…` already exists (`payments.constants.ts`, fixed against a real sandbox run). `PaymentReturnPage` already refuses to treat arrival as confirmation. **No backend or frontend change is required for the return path.**

**Rejected**: redirecting to `/book/:therapistId?flow_return=1`. A full-page return re-mounts the SPA with no booking state, dropping the patient back on an empty slot picker — it reads as "the booking failed, try again". Routing by origin would also force the deliberately state-free, guard-free return handler to read `Payment` by token, breaking its "reads and mutates nothing" property. Payment truth stays exclusively with `urlConfirmation` + `payment/getStatus`.

### Decision 3: Postgres table, not in-memory and not Redis

| Option | Tradeoff |
|---|---|
| In-process `Map` (like the 5-min slot cache) | Free, but every Render deploy/spin-down empties it — the overlay would silently go dark for 30 min after each release, exactly when drift is offered publicly |
| Redis | Not in the stack; new infra and a new failure mode for one cache |
| **Prisma `CalendarBusyBlock` (chosen)** | Survives restarts, operator-inspectable, reuses the `startsAt/endsAt` overlap predicate and index shape `AvailabilityBlockout` already has |

The existing in-memory slot cache stays and stays in front. The refresh job calls the existing `AvailabilityService.invalidate(therapistId)` after writing, so a refreshed overlay takes effect immediately instead of waiting out the 5-minute TTL.

### Decision 4: Booking recheck consults the overlay cache, never Google live

Because the overlay is merged into `blockouts` *inside* `computeSlots()`, the existing recheck in `PublicSchedulingService.book()` picks it up with **no call-site change**. A live Google call at write time is rejected: it would put a Google outage on the booking path, contradicting the success criterion "booking still succeeds when Flow or Google is unavailable", and the overlay is a courtesy layer — the integrity constraint remains the `BookedSlot` unique index.

### Decision 5: Checkout is polled, not awaited

`ensureCharge()` stays fire-and-forget, so `paymentUrl` does not exist when `book()` returns. The booking response carries a `checkout` hint; when it is `PENDING`, the confirmation screen polls a new public endpoint until a URL appears or the attempt budget is exhausted (then it falls back to today's "you'll get an email" copy). Awaiting `ensureCharge` was rejected — it would couple booking latency and booking success to Flow.

## Data Flow

    cron 30m ─→ CalendarBusyBlockService ─→ Google events.list ─→ CalendarBusyBlock (Postgres)
                        │                                                   │
                        └── invalidate(therapistId) ─→ slot cache           │
                                                                            ↓
    GET /public/.../availability ─→ computeSlots() ─→ blockouts + busyBlocks ─→ slots
    POST /public/.../book ────────→ (same recheck) ─→ createFromPublicBooking ─→ ensureCharge (async)
                                            │                                        │
    confirmation UI ─poll─→ GET /public/bookings/:groupId/checkout ←── Payment.paymentUrl
                                            └─→ Flow hosted page ─→ POST /api/v1/payments/return ─→ 302 /pago-recibido

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/prisma/schema.prisma` | Modify | `CalendarBusyBlock` model; `GoogleCalendarConnection.busySyncedAt`, `busySyncError` |
| `backend/src/modules/calendar-integration/google-calendar.client.ts` | Modify | `listBusyIntervals()` — field-limited, paginated `events.list`, same `GoogleCalendarError` classification |
| `backend/src/modules/calendar-integration/calendar-busy.service.ts` | Create | `@Cron('*/30 * * * *')` per-connection refresh, staggered, replace-per-therapist in one transaction |
| `backend/src/modules/calendar-integration/calendar-integration.constants.ts` | Modify | `BUSY_WINDOW_DAYS = 60`, `BUSY_REFRESH_CONCURRENCY` |
| `backend/src/modules/availability/availability.service.ts` | Modify | Sixth parallel query; concat into `blockouts` when the flag is on |
| `backend/src/modules/payments/payments.service.ts` | Modify | `findCheckoutForBooking(groupId)` — returns `paymentUrl`/`amount` only |
| `backend/src/modules/public-scheduling/public-scheduling.{controller,service}.ts` | Modify | `GET :groupId/checkout`; `checkout` hint on the book response |
| `frontend/src/pages/PublicBookingPage.tsx` | Modify | Confirmation renders checkout CTA + "you will leave this page" copy |
| `frontend/src/api/publicScheduling.ts` | Modify | `BookingConfirmation.checkout`, `getBookingCheckout()` |

## Interfaces / Contracts

```ts
// Merged into computeSlots' existing blockouts[] — BlockoutInput shape, no new param.
model CalendarBusyBlock { id; therapistId; startsAt; endsAt; @@index([therapistId, startsAt]) }

// Booking response gains one field. NOT_APPLICABLE stops the client polling for
// something that will never arrive.
type CheckoutHint =
  | { status: 'PENDING' }                                  // charge may be created
  | { status: 'NOT_APPLICABLE' };                          // account not CONNECTED, or no amount

// GET /public/therapists/:therapistId/availability/book/:groupId/checkout — no guard,
// throttled with the other public routes. Exposes nothing but the URL and the amount.
type CheckoutResponse = { paymentUrl: string; amount: number } | { paymentUrl: null };
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Event→interval mapping: recurrences expanded, `cancelled`/`transparent`/all-day dropped, `umbralGroupId` excluded, pagination | Pure mapper over fixture payloads |
| Unit | Overlay merged into `blockouts`; empty/stale overlay ⇒ today's slots exactly | `AvailabilityService` with mocked Prisma |
| Unit | `invalid_grant` during refresh ⇒ existing `handleInvalidGrant` path, never a thrown job | `CalendarBusyService` spec |
| Integration | Recheck rejects a slot covered only by a busy block; `book()` still succeeds with Google down | `public-scheduling.service.spec.ts` |
| Integration | `NOT_APPLICABLE` when `PaymentAccount != CONNECTED` or amount unresolvable; checkout endpoint leaks no patient data | Payments + public-scheduling specs |
| E2E | Flag off ⇒ byte-identical availability response to baseline | `backend/test` |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The new HTTP route is an ordinary unauthenticated read in an existing public controller, covered by `PublicScheduleThrottlerGuard` and the existing `SkipThrottle` exhaustiveness test.

## Migration / Rollout

No OAuth migration and no re-consent (Decision 1). One additive Prisma migration; the table can stay if the feature is reverted. Both flags are opt-in (`=== 'true'`, matching `PUBLIC_SCHEDULING_ENABLED`, not the `!== 'false'` default-on convention of the older sync modules), independently revertible.

## Open Questions

- [ ] **Product**: `resolveForPublicBooking()` creates new patients with no `defaultSessionAmount`, so **a first-time public patient never generates a charge**. In-page checkout will only appear for returning patients matched by email. Is a therapist-level default amount for public bookings in scope, or is "returning patients only" accepted for this release?
- [ ] Should the therapist get a manual "refresh calendar now" action, or is the 30-minute cycle plus the disclosure label enough?
- [ ] Poll budget and interval for the checkout hint (proposed: 2s interval, ~15s ceiling).
