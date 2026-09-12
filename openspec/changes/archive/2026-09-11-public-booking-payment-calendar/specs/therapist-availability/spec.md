# Delta for therapist-availability

## MODIFIED Requirements

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
