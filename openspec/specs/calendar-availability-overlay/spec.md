# calendar-availability-overlay Specification

## Purpose

Read-only, periodically cached ingestion of each connected therapist's Google Calendar busy time, consumed by slot computation to prevent offering publicly booked slots that are already committed outside Umbral.

## Requirements

### Requirement: Periodic Free-Busy Cache Ingestion

The system MUST run a scheduled background job every 30 minutes that queries Google's `events.list` API (under the therapist's existing `calendar.events` OAuth scope; no scope broadening or re-consent is required) for each therapist with an active (`CONNECTED`) Google connection, over a window from now to 60 days ahead, and MUST persist the result as a per-therapist overlay cache (replacing the previous blocks in one transaction) together with the time of the last successful refresh. Connections MUST be refreshed with bounded parallelism (5 at a time). The job MUST NOT be triggered synchronously by an availability or booking request. Cancelled events, events marked as free (`transparent`), all-day events and events pushed by Umbral itself (already reflected as consultations) MUST NOT become busy blocks. After each successful refresh the cached slot results of that therapist MUST be invalidated.

#### Scenario: Job refreshes the overlay for connected therapists

- GIVEN a therapist with an active (`CONNECTED`) Google connection
- WHEN the scheduled job runs
- THEN the therapist's busy blocks are fetched from Google and persisted to the overlay cache

#### Scenario: Events that do not block time are ignored

- GIVEN the therapist's Google calendar has an all-day event, a transparent event, a cancelled event and an event created by Umbral
- WHEN the scheduled job runs
- THEN none of them is stored as a busy block

#### Scenario: Refresh failure keeps the previous cache and records the error

- GIVEN a transient error occurs while refreshing a therapist's overlay
- WHEN the job handles it
- THEN the previous busy blocks and refresh time are kept, the error is recorded on the connection, and other therapists are still refreshed

### Requirement: Overlay Consumption in Slot Computation

`computeSlots()` MUST treat the persisted overlay cache as an additional exclusion source, subtracted alongside blockouts, existing consultations, and holidays, and MUST read only the persisted cache, never calling Google synchronously during a slot computation or availability request.

#### Scenario: Cached busy block excludes an otherwise free slot

- GIVEN an overlay cache entry marking 10:00-11:00 as busy on Google
- WHEN slots are computed for a window covering that range
- THEN the slot overlapping 10:00-11:00 is not returned

#### Scenario: Slot computation latency is unaffected

- GIVEN the overlay cache already exists for a therapist
- WHEN slots are computed for that therapist
- THEN no network call to Google occurs during that computation

### Requirement: Stale Cache Degrades to No Overlay Exclusion

When the therapist's connection is not `CONNECTED`, or the overlay cache is missing or was last refreshed more than 90 minutes ago (three refresh intervals), the system MUST compute slots exactly as it did before this capability existed, applying no overlay exclusion, and MUST NOT block or delay the availability response.

#### Scenario: Stale cache falls back to pre-overlay behavior

- GIVEN a therapist's overlay cache has not refreshed within the staleness threshold
- WHEN slots are computed for that therapist
- THEN the overlay contributes no exclusions and availability is computed from existing consultations, blockouts, and holidays only

#### Scenario: Missing cache does not error

- GIVEN a therapist has no overlay cache entry yet
- WHEN slots are computed for that therapist
- THEN the request succeeds using only non-overlay exclusion sources

### Requirement: Overlay Cleared When the Connection Ends

When a connection becomes inactive, whether by the therapist's disconnection or by a revoked or expired grant, the system MUST delete that therapist's cached busy blocks and clear the last refresh time, so stale external busy time never keeps excluding slots.

#### Scenario: Disconnecting removes the overlay

- GIVEN a therapist with cached busy blocks
- WHEN they disconnect Google Calendar
- THEN their busy blocks are deleted and later slot computations apply no overlay exclusion

### Requirement: Independent Feature Flag

The system MUST expose `CALENDAR_AVAILABILITY_OVERLAY_ENABLED`, opt-in (`=== 'true'`, not the `!== 'false'` convention used by other flags in this project; deliberate, since this capability introduces new background Google API calls and a new table that should not activate silently on deploy), independent of any other payment or booking flag. When disabled or absent, the scheduled job MUST NOT run and `computeSlots()` MUST NOT consult the overlay cache.

#### Scenario: Flag off or absent disables ingestion and consumption

- GIVEN `CALENDAR_AVAILABILITY_OVERLAY_ENABLED` is unset or not exactly `'true'`
- WHEN the scheduled job's trigger time arrives and slots are later computed
- THEN no free-busy fetch occurs and slot computation ignores the overlay entirely

### Requirement: Booking-Time Recheck Independent of Overlay Freshness

The system MUST continue to enforce the existing double-booking protection at write time regardless of overlay cache state: a public booking MUST recompute availability bypassing the slot cache, and the write MUST still be serialized per therapist, checked against overlapping consultations and protected by the unique booked-slot constraint. A stale or absent overlay therefore never weakens the guarantee that a concurrently committed slot is rejected.

#### Scenario: Overlay staleness does not weaken write-time protection

- GIVEN a stale overlay cache showed a slot as free
- WHEN a booking attempt for that slot is submitted after it was already taken
- THEN the existing double-booking protection still rejects the write
