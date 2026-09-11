# Delta for calendar-sync

## MODIFIED Requirements

### Requirement: OAuth Connection Lifecycle

The system MUST let a therapist connect their Google account via OAuth 2.0 authorization-code flow with `access_type=offline`, and MUST let them disconnect anytime. Connection is account-level, never per session. The requested scope set MUST include `calendar.events` (write) and, when the `calendar-availability-overlay` capability is enabled, the free-busy read scope as well. An existing connection created before the read scope was introduced MUST keep working for push sync unchanged, and MUST be treated by the overlay job as not-yet-consented until the therapist explicitly re-authorizes to grant the added scope. Re-consent MUST NOT require disconnecting the existing connection.
(Previously: requested only `calendar.events` and did not define a scope-broadening or re-consent path.)

#### Scenario: Therapist connects Google account with only the write scope

- GIVEN no active Google connection and the overlay capability disabled
- WHEN OAuth consent completes for `calendar.events` offline access
- THEN Umbral stores the connection as active with only the write scope

#### Scenario: Therapist connects Google account with both scopes

- GIVEN no active Google connection and the overlay capability enabled
- WHEN OAuth consent completes for both the write and read scopes
- THEN Umbral stores the connection as active with both scopes granted

#### Scenario: Therapist disconnects Google account

- GIVEN an active Google connection
- WHEN the therapist disconnects
- THEN Umbral revokes the token, deletes it, and marks the connection inactive

#### Scenario: Pre-existing connection keeps push sync without re-consent

- GIVEN a connection created before the read scope existed
- WHEN the therapist takes no re-consent action
- THEN Umbral continues pushing consultation events to Google exactly as before

#### Scenario: Pre-existing connection is excluded from the overlay until re-consent

- GIVEN a connection created before the read scope existed and the therapist has not re-authorized
- WHEN the availability overlay job runs
- THEN that therapist's connection is skipped, consistent with the overlay capability's stale/missing-cache degradation

#### Scenario: Re-consent grants the read scope without disconnecting

- GIVEN an active connection with only the write scope
- WHEN the therapist completes the re-consent flow
- THEN the same connection now also holds the read scope and push sync remains uninterrupted throughout
