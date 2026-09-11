# public-scheduling Specification

## Purpose

Unauthenticated public availability read and booking write for a given therapist, patient identity resolution by email, double-booking protection, and rate limiting.

## Requirements

### Requirement: Public Availability Read Endpoint

The system MUST expose an unauthenticated `GET /api/v1/public/therapists/:therapistId/availability` endpoint returning computed free slots for a requested date range, bounded by the 24-hour minimum lead time and 60-day maximum horizon. It MUST NOT expose any other therapist's data through this endpoint.

#### Scenario: Public request returns only free slots

- GIVEN a therapist with a configured schedule, a blockout, and a booked consultation
- WHEN an unauthenticated client requests availability for a range covering all three
- THEN the response excludes the blockout time, the booked slot, and any holiday date

#### Scenario: Request outside the allowed range is rejected

- GIVEN the booking window is 24 hours minimum and 60 days maximum
- WHEN a client requests a range starting in the past or extending beyond 60 days
- THEN the system rejects the out-of-bounds portion of the request

### Requirement: Public Booking Write Endpoint

The system MUST expose an unauthenticated `POST /api/v1/public/therapists/:therapistId/availability/book` endpoint that creates a consultation for a chosen slot after validating it against current availability. It MUST reuse the existing `ConsultationsService` creation path and its fire-and-forget calendar sync.

#### Scenario: Booking a currently free slot succeeds

- GIVEN a slot returned by the availability endpoint
- WHEN the client submits a booking for that exact slot
- THEN a consultation is created for the requesting therapist and patient

#### Scenario: Booking a slot outside the booking window fails

- GIVEN a slot within the 24-hour minimum lead time
- WHEN the client submits a booking for that slot
- THEN the booking is rejected and no consultation is created

### Requirement: Patient Identity Resolution by Email

On a booking request, the system MUST resolve the patient by `(email, therapistId)`. If a matching patient exists for that therapist, the booking MUST link to that existing record. If none exists, the system MUST create a new patient from the reduced public form and link the booking to it. The system MUST NOT require OTP or any authentication step.

#### Scenario: Existing patient books into their own record

- GIVEN a patient with a stored email already registered under a therapist
- WHEN they book using that same email and therapist
- THEN the new consultation links to their existing patient record and no duplicate patient is created

#### Scenario: New patient is created and linked

- GIVEN no patient exists with the submitted email under the requested therapist
- WHEN a booking is submitted with the reduced public form
- THEN a new patient is created, linked to that therapist, and linked to the new consultation

#### Scenario: Same email across different therapists does not collide

- GIVEN a patient email already exists under therapist A
- WHEN a booking is submitted for the same email under therapist B
- THEN a separate patient record is created for therapist B, since identity is scoped per therapist

### Requirement: Double-Booking Protection

The system MUST enforce a `UNIQUE (therapistId, sessionDate, slotStart)` database constraint and MUST respond `409` when a booking attempt violates it, without creating a duplicate consultation.

#### Scenario: Concurrent bookings for the same slot yield one winner

- GIVEN two clients submit a booking for the same therapist, date, and slot start at nearly the same time
- WHEN both requests are processed
- THEN exactly one consultation is created and the other request receives `409`

#### Scenario: Stale cached slot is rejected at write time

- GIVEN a client holds a cached availability response showing a slot as free
- WHEN that slot was booked by someone else after the cache was computed and the client attempts to book it
- THEN the write is rejected with `409` regardless of what the stale read showed

### Requirement: Public Endpoint Rate Limiting

The system MUST apply rate limiting to both public endpoints, scoped per therapist and per submitted email, and MUST respond `429` once a limit is exceeded. The system MUST NOT log the submitted email in plaintext for rate-limiting purposes.

#### Scenario: Excessive requests from one source are throttled

- GIVEN a client exceeds the configured request window for a given therapist
- WHEN they issue another request against that therapist's public endpoints
- THEN the response is `429`

#### Scenario: Throttling does not leak email in logs

- GIVEN rate limiting is applied per submitted email
- WHEN a request is throttled or logged
- THEN the log does not contain the plaintext email
