# Proposal: Public Booking — Calendar Overlay and In-Page Payment Checkout

## Intent

Phase 3 of the deferred `patient-self-scheduling` scope. Two production gaps:

1. **Schedule drift** — `computeSlots()` ignores the therapist's Google Calendar, so slots already committed outside Umbral are offered publicly and get double-booked.
2. **Payment friction** — the Flow checkout link only reaches the patient by email. Patients who finish a public booking have no way to pay in the session they are already in.

## Scope

### In Scope

- Background job (~30 min) reading Google free-busy per connected therapist into a persisted overlay cache.
- `computeSlots()` consumes that cache with zero added per-request network latency; missing or stale cache degrades to today's behavior.
- Backend `POST` return endpoint that receives Flow's browser POST and 302-redirects to `/book/:therapistId?flow_return=1`.
- Public booking confirmation page renders the Flow checkout link when a charge was created.
- Two independent feature flags: `CALENDAR_AVAILABILITY_OVERLAY_ENABLED`, `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED`.

### Out of Scope

- Real-time free-busy queries per availability request.
- Blocking payment (pay before the slot is confirmed).
- Embedded/iframe checkout — Flow is full-page redirect only.
- Mandatory payment for all therapists; `PaymentAccount.status != CONNECTED` still books without a charge.
- A second payment gateway.
- Multi-calendar selection (primary calendar only).

## Capabilities

### New Capabilities

- `calendar-availability-overlay`: read-only, cached Google free-busy ingestion and its contribution to slot computation.

### Modified Capabilities

- `calendar-sync`: push-only invariant broadens to include a read scope; OAuth scope set and re-consent lifecycle change.
- `therapist-availability`: slot computation gains the overlay as an exclusion source, with graceful degradation.
- `payments`: charge creation must expose the checkout URL to the booking response; new Flow return endpoint.
- `public-scheduling`: booking confirmation surfaces checkout state without changing booking success semantics.

## Approach

Async everywhere. The overlay is a write-behind cache filled by a scheduled job, never read from Google inside a request. The charge stays fire-and-forget; the booking response carries the checkout URL only when `ensureCharge()` already produced one, so booking success never depends on Flow. Payment truth stays with `urlConfirmation` + `payment/getStatus`; arrival at `urlReturn` is presentation only.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `calendar-integration` | Modified | OAuth scopes, new free-busy read client + job |
| `availability` | Modified | `computeSlots()` overlay exclusion |
| `payments` | Modified | Checkout URL exposure, Flow return endpoint |
| `public-scheduling` | Modified | Booking response + confirmation UI |
| `prisma/schema.prisma` | New | Overlay cache table |
| `/book/:therapistId` | Modified | Checkout CTA, `flow_return` handling |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| OAuth scope upgrade forces re-consent for already-connected therapists | High | Resolve migration path in design; do not invent it here |
| Stale overlay offers a busy slot | Med | Booking-time recheck, short refresh interval, UI disclosure |
| Google free-busy rate limits | Med | Batch/stagger job, back off per connection |
| Flow POST return mishandled as GET | Med | Dedicated backend POST endpoint, confirmed by research |

## Rollback Plan

Disable either flag independently: overlay off restores today's `computeSlots()`; checkout flag off restores email-only payment links. The overlay cache table is additive and can remain. Flow return endpoint is inert when unused.

## Dependencies

- Google Calendar read scope approval and a re-consent path for existing `GoogleCalendarConnection` rows.
- Flow `urlReturn` / `urlConfirmation` configuration per environment.

## Success Criteria

- [ ] Slots overlapping cached Google busy blocks are not offered publicly.
- [ ] Availability request latency unchanged versus baseline.
- [ ] Public booking confirmation shows a working checkout link when the therapist is `CONNECTED`.
- [ ] Booking still succeeds when Flow or Google is unavailable.
- [ ] Each flag toggles its feature without affecting the other.
