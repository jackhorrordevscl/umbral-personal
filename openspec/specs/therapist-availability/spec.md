# therapist-availability Specification

## Purpose

Per-therapist recurring weekly schedule, session duration, blockout exceptions, and Chile public holidays, used to compute genuinely free slots at query time in the Chile time zone.

## Requirements

### Requirement: Weekly Recurring Schedule

The system MUST let a therapist define a recurring weekly schedule as a set of `(dayOfWeek, startMinute, endMinute)` entries (ISO weekday 1-7, minutes from midnight), editable from Profile and saved atomically as a whole. It MUST NOT allow an entry with `endMinute <= startMinute`, and MUST reject a schedule with overlapping entries on the same day.

#### Scenario: Therapist saves a weekly schedule

- GIVEN a therapist editing their Profile schedule
- WHEN they save entries for Monday 09:00-13:00 and Wednesday 14:00-18:00
- THEN both entries persist as the therapist's recurring weekly schedule, replacing the previous one

#### Scenario: Invalid time range is rejected

- GIVEN a therapist submitting a schedule entry
- WHEN the start is not before the end
- THEN the system rejects the entry and no schedule change is persisted

#### Scenario: Overlapping entries are rejected

- GIVEN a therapist submitting two Monday entries 09:00-12:00 and 11:00-13:00
- WHEN they save
- THEN the system rejects the schedule with an error naming the day and the overlapping ranges, and nothing is persisted

### Requirement: Per-Therapist Session Duration

The system MUST store one `sessionDurationMinutes` value per therapist (between 5 and 240 minutes), saved together with the weekly schedule, and MUST use it to segment every weekly window into fixed-length slots. It MUST NOT support a per-session-type override. Each consultation MUST store the duration in force when it was created (or booked) and keep it when later corrected, so changing the configured duration never alters existing sessions.

#### Scenario: Slots are segmented by the configured duration

- GIVEN a therapist with `sessionDurationMinutes = 50` and a Monday window 09:00-13:00
- WHEN slots are computed for that window
- THEN slots start every 50 minutes within the window and no slot extends past 13:00

#### Scenario: Changing the duration does not alter booked sessions

- GIVEN a booked consultation created with a 50-minute duration
- WHEN the therapist later changes the configured duration to 60 minutes
- THEN that consultation keeps occupying 50 minutes when availability is computed

### Requirement: Availability Blockouts

The system MUST let a therapist declare a full-day, partial-day time-range, or date-range blockout (`startsAt` before `endsAt`) that removes matching time from computed availability, and delete their own blockouts (a blockout of another therapist MUST be reported as not found). A blockout MUST take precedence over the recurring weekly schedule.

#### Scenario: Full-day blockout removes the whole day

- GIVEN a therapist with a Monday weekly window
- WHEN they add a full-day blockout for that Monday
- THEN no slots are returned for that Monday

#### Scenario: Partial-day blockout removes only its range

- GIVEN a therapist with a Monday 09:00-13:00 window
- WHEN they add a blockout for Monday 10:00-11:00
- THEN slots overlapping 10:00-11:00 are excluded and the rest of the window remains available

#### Scenario: Another therapist's blockout cannot be deleted

- GIVEN a blockout owned by therapist A
- WHEN therapist B tries to delete it
- THEN the response is `404` and the blockout remains

### Requirement: Chile Public Holidays as Implicit Blockouts

The system MUST support seeding Chile's official public holiday calendar as system defaults (through the seed script, when `SEED_HOLIDAYS=true`) and MUST apply each holiday date as an implicit full-day blockout for every therapist, without requiring per-therapist configuration.

#### Scenario: Holiday removes availability without therapist action

- GIVEN a therapist has a recurring weekly window on a date matching a seeded Chile public holiday
- WHEN slots are computed for that date
- THEN no slots are returned for that date

### Requirement: Query-Time Slot Computation with Bounded Cache

The system MUST compute available slots at query time by expanding the weekly schedule over the requested range in the Chile time zone, then subtracting existing consultations (current versions of non-deleted consultations of non-deleted patients, each with its own duration, so consultations cancelled by a treatment discharge free their slots), blockouts, public holidays, and, when the `calendar-availability-overlay` capability is enabled, cached Google busy blocks. It MUST cache the result for approximately 5 minutes per therapist and range, with a bounded number of entries, and MUST invalidate that therapist's cache whenever the schedule, a blockout, or the occupancy of the agenda changes (consultation created, corrected, or cancelled by a discharge, public booking, overlay refresh). Consulting the overlay MUST add no synchronous network call and MUST degrade gracefully to the pre-overlay exclusion set when the overlay's own cache is missing or stale.

#### Scenario: Existing consultation removes its slot

- GIVEN a therapist has a booked consultation inside an otherwise open window
- WHEN slots are computed for that window
- THEN the slot occupied by that consultation is not returned

#### Scenario: Cancelled consultation frees its slot

- GIVEN a consultation was cancelled because the patient's treatment was closed
- WHEN slots are computed for that window after the cache is invalidated
- THEN the slot it occupied is offered again

#### Scenario: Repeated query within cache window reuses computed result

- GIVEN a slot query was computed less than 5 minutes ago for the same therapist and range
- WHEN the same range is queried again within that window
- THEN the system MAY serve the cached result instead of recomputing

#### Scenario: Schedule change invalidates the cache

- GIVEN cached slots exist for a therapist
- WHEN the therapist saves a new weekly schedule or creates a blockout
- THEN the next query recomputes the slots instead of serving the cached result

#### Scenario: Overlay-covered busy time is excluded when the capability is enabled

- GIVEN the overlay capability is enabled and the therapist has a fresh overlay cache entry marking a time range busy
- WHEN slots are computed for a window covering that range
- THEN the slots overlapping that range are excluded, in addition to consultations, blockouts, and holidays

#### Scenario: Slot computation is unaffected when the overlay capability is disabled

- GIVEN the overlay capability is disabled
- WHEN slots are computed for a therapist
- THEN the result matches computation using only consultations, blockouts, and holidays, exactly as before this capability existed

### Requirement: Booking Window Bounds

The system MUST NOT offer, and MUST NOT accept a booking for, any slot earlier than a minimum lead time of 24 hours from now or later than a maximum horizon of 60 days from now. A public availability request spanning more than 60 days, or whose `to` is not after `from`, MUST be rejected with `400`.

#### Scenario: Slot inside the minimum lead time is unavailable

- GIVEN the current time is 10:00 on a given day
- WHEN slots are requested for a date within the next 24 hours
- THEN slots inside that 24-hour window are not returned

#### Scenario: Slot beyond the maximum horizon is unavailable

- GIVEN today's date
- WHEN slots are requested for a date more than 60 days ahead
- THEN no slots are returned for that date

#### Scenario: Booking a slot outside the window is rejected

- GIVEN a patient tries to book a slot inside the minimum lead time
- WHEN the booking is submitted
- THEN it is rejected with `409` because the slot is not currently available
