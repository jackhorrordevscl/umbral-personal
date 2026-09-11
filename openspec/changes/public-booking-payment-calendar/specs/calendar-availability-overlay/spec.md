# calendar-availability-overlay Specification

## Purpose

Read-only, periodically cached ingestion of each connected therapist's Google Calendar free-busy data, consumed by slot computation to prevent offering publicly booked slots that are already committed outside Umbral.

## Requirements

### Requirement: Periodic Free-Busy Cache Ingestion

The system MUST run a scheduled background job approximately every 30 minutes that queries Google's free-busy API for each therapist with an active, re-consented Google connection, and MUST persist the result as a per-therapist overlay cache. The job MUST NOT be triggered synchronously by an availability or booking request.

#### Scenario: Job refreshes the overlay for connected therapists

- GIVEN a therapist with an active Google connection holding the read scope
- WHEN the scheduled job runs
- THEN the therapist's free-busy blocks are fetched from Google and persisted to the overlay cache

#### Scenario: Job skips therapists without the read scope

- GIVEN a therapist whose connection predates the read scope and has not re-consented
- WHEN the scheduled job runs
- THEN that therapist is skipped and no overlay entry is written or refreshed for them

### Requirement: Overlay Consumption in Slot Computation

`computeSlots()` MUST treat the persisted overlay cache as an additional exclusion source, subtracted alongside blockouts, existing consultations, and holidays, and MUST read only the persisted cache — never calling Google synchronously during a slot computation or availability request.

#### Scenario: Cached busy block excludes an otherwise free slot

- GIVEN an overlay cache entry marking 10:00-11:00 as busy on Google
- WHEN slots are computed for a window covering that range
- THEN the slot overlapping 10:00-11:00 is not returned

#### Scenario: Slot computation latency is unaffected

- GIVEN the overlay cache already exists for a therapist
- WHEN slots are computed for that therapist
- THEN no network call to Google occurs during that computation

### Requirement: Stale Cache Degrades to No Overlay Exclusion

When the overlay cache for a therapist is missing or older than the refresh interval by a defined staleness threshold, the system MUST compute slots exactly as it did before this capability existed, applying no overlay exclusion, and MUST NOT block or delay the availability response.

#### Scenario: Stale cache falls back to pre-overlay behavior

- GIVEN a therapist's overlay cache has not refreshed within the staleness threshold
- WHEN slots are computed for that therapist
- THEN the overlay contributes no exclusions and availability is computed from existing consultations, blockouts, and holidays only

#### Scenario: Missing cache does not error

- GIVEN a therapist has no overlay cache entry yet
- WHEN slots are computed for that therapist
- THEN the request succeeds using only non-overlay exclusion sources

### Requirement: Independent Feature Flag

The system MUST expose `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` following the existing `X_ENABLED !== 'false'` convention, independent of any other payment or booking flag. When disabled, the scheduled job MUST NOT run and `computeSlots()` MUST NOT consult the overlay cache.

#### Scenario: Flag off disables ingestion and consumption

- GIVEN `CALENDAR_AVAILABILITY_OVERLAY_ENABLED=false`
- WHEN the scheduled job's trigger time arrives and slots are later computed
- THEN no free-busy fetch occurs and slot computation ignores the overlay entirely

### Requirement: Booking-Time Recheck Independent of Overlay Freshness

The system MUST continue to enforce the existing double-booking protection at write time regardless of overlay cache state, so a stale or absent overlay never weakens the guarantee that a concurrently committed slot is rejected.

#### Scenario: Overlay staleness does not weaken write-time protection

- GIVEN a stale overlay cache showed a slot as free
- WHEN a booking attempt for that slot is submitted after it was already taken
- THEN the existing double-booking protection still rejects the write
