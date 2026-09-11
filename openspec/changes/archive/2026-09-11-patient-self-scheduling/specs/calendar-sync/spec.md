# Delta for calendar-sync

## MODIFIED Requirements

### Requirement: Push-Only Event Propagation Keyed by groupId

The system MUST push consultation changes to Google Calendar one-directionally, matched by `Consultation.groupId`, and MUST NOT let a Google-side edit mutate `Consultation`. Since no endpoint writes `Consultation.deletedAt` today, the only real deletion trigger is soft-deleting the patient. This push path MUST treat a consultation created by the public booking flow identically to one created by an authenticated therapist: same event creation, same `groupId` mapping, same non-blocking behavior.
(Previously: did not account for consultations originating outside the authenticated therapist flow.)

#### Scenario: Create pushes a new event

- GIVEN a connected therapist creates a future-dated consultation
- WHEN the consultation is persisted
- THEN Umbral creates a Google event mapped by `groupId`

#### Scenario: correct() updates the same event

- GIVEN a consultation already mapped to an event
- WHEN `correct()` changes `sessionDate`
- THEN Umbral updates the same mapped event instead of duplicating it

#### Scenario: Patient soft-delete removes future events

- GIVEN a patient with future consultations mapped to Google events
- WHEN the patient is soft-deleted
- THEN Umbral deletes every mapped future event and removes the mappings

#### Scenario: Publicly booked consultation pushes a new event

- GIVEN a therapist has an active Google connection
- WHEN a patient books a slot through the public scheduling flow and a consultation is created
- THEN Umbral creates a Google event mapped by `groupId`, same as a therapist-created consultation

#### Scenario: Public booking sync failure does not block the booking

- GIVEN the Google Calendar API is unavailable
- WHEN a public booking request creates a consultation
- THEN the booking succeeds and the sync failure is only logged, consistent with non-blocking sync failures
