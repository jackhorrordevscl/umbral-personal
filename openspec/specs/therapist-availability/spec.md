# therapist-availability Specification

## Purpose

Per-therapist recurring weekly schedule, session duration, blockout exceptions, and Chile public holidays, used to compute genuinely free slots at query time.

## Requirements

### Requirement: Weekly Recurring Schedule

The system MUST let a therapist define a recurring weekly schedule as a set of `(dayOfWeek, startTime, endTime)` entries, editable from Profile. It MUST NOT allow an entry with `startTime >= endTime`.

#### Scenario: Therapist saves a weekly schedule

- GIVEN a therapist editing their Profile schedule
- WHEN they save entries for Monday 09:00-13:00 and Wednesday 14:00-18:00
- THEN both entries persist as the therapist's recurring weekly schedule

#### Scenario: Invalid time range is rejected

- GIVEN a therapist submitting a schedule entry
- WHEN `startTime` is not before `endTime`
- THEN the system rejects the entry and no schedule change is persisted

### Requirement: Per-Therapist Session Duration

The system MUST store one `sessionDurationMinutes` value per therapist, configured alongside the weekly schedule, and MUST use it to segment every weekly window into fixed-length slots. It MUST NOT support a per-session-type override.

#### Scenario: Slots are segmented by the configured duration

- GIVEN a therapist with `sessionDurationMinutes = 50` and a Monday window 09:00-13:00
- WHEN slots are computed for that window
- THEN slots start every 50 minutes within the window and no slot extends past 13:00

### Requirement: Availability Blockouts

The system MUST let a therapist declare a full-day, partial-day time-range, or date-range blockout that removes matching time from computed availability. A blockout MUST take precedence over the recurring weekly schedule.

#### Scenario: Full-day blockout removes the whole day

- GIVEN a therapist with a Monday weekly window
- WHEN they add a full-day blockout for that Monday
- THEN no slots are returned for that Monday

#### Scenario: Partial-day blockout removes only its range

- GIVEN a therapist with a Monday 09:00-13:00 window
- WHEN they add a blockout for Monday 10:00-11:00
- THEN slots overlapping 10:00-11:00 are excluded and the rest of the window remains available

### Requirement: Chile Public Holidays as Implicit Blockouts

The system MUST seed Chile's official public holiday calendar as system defaults and MUST apply each holiday date as an implicit full-day blockout for every therapist, without requiring per-therapist configuration.

#### Scenario: Holiday removes availability without therapist action

- GIVEN a therapist has a recurring weekly window on a date matching a seeded Chile public holiday
- WHEN slots are computed for that date
- THEN no slots are returned for that date

### Requirement: Query-Time Slot Computation with Bounded Cache

The system MUST compute available slots at query time by expanding the weekly schedule over the requested range, then subtracting existing consultations, blockouts, public holidays, and, when the `calendar-availability-overlay` capability is enabled, cached Google free-busy overlay entries, and MUST cache the result for approximately 5 minutes per therapist and range. Consulting the overlay MUST add no synchronous network call and MUST degrade gracefully to the pre-overlay exclusion set when the overlay's own cache is missing or stale.
(Previously: subtracted only existing consultations, blockouts, and public holidays, with no calendar overlay exclusion source.)

#### Scenario: Existing consultation removes its slot

- GIVEN a therapist has a booked consultation inside an otherwise open window
- WHEN slots are computed for that window
- THEN the slot occupied by that consultation is not returned

#### Scenario: Repeated query within cache window reuses computed result

- GIVEN a slot query was computed less than 5 minutes ago for the same therapist and range
- WHEN the same range is queried again within that window
- THEN the system MAY serve the cached result instead of recomputing

#### Scenario: Overlay-covered busy time is excluded when the capability is enabled

- GIVEN the overlay capability is enabled and the therapist has a fresh overlay cache entry marking a time range busy
- WHEN slots are computed for a window covering that range
- THEN the slots overlapping that range are excluded, in addition to consultations, blockouts, and holidays

#### Scenario: Slot computation is unaffected when the overlay capability is disabled

- GIVEN the overlay capability is disabled
- WHEN slots are computed for a therapist
- THEN the result matches computation using only consultations, blockouts, and holidays, exactly as before this capability existed
### Requirement: Booking Window Bounds

The system MUST reject any slot request or booking outside a minimum lead time of 24 hours from now and a maximum horizon of 60 days from now.

#### Scenario: Slot inside the minimum lead time is unavailable

- GIVEN the current time is 10:00 on a given day
- WHEN slots are requested for a date within the next 24 hours
- THEN slots inside that 24-hour window are not returned

#### Scenario: Slot beyond the maximum horizon is unavailable

- GIVEN today's date
- WHEN slots are requested for a date more than 60 days ahead
- THEN no slots are returned for that date
