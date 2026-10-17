# public-scheduling Specification

## Purpose

Unauthenticated public availability read and booking write for a given therapist, patient identity resolution (adults by email and RUT, minors by RUT and guardian RUT), double-booking protection, rate limiting, and the public booking page.

## Requirements

### Requirement: Public Availability Read Endpoint

The system MUST expose an unauthenticated `GET /api/v1/public/therapists/:therapistId/availability` endpoint returning computed free slots for a requested date range (`from`, `to` as ISO instants with explicit offset), bounded by the 24-hour minimum lead time and 60-day maximum horizon. It MUST reject with `400` a range where `to` is not after `from` or that spans more than 60 days. It MUST NOT expose any other therapist's data through this endpoint. Public scheduling MUST be available only when `PUBLIC_SCHEDULING_ENABLED` is exactly `'true'`; otherwise the availability and booking endpoints MUST answer `503`. In this endpoint and in every other `/public/therapists/:therapistId/...` route, `:therapistId` MUST accept either the therapist's public slug (derived from their name, e.g. `juan-jose-martinez`) or their UUID, and an unknown value MUST behave exactly like an unknown id (`404`, or an empty list for availability).

#### Scenario: Public request returns only free slots

- GIVEN a therapist with a configured schedule, a blockout, and a booked consultation
- WHEN an unauthenticated client requests availability for a range covering all three
- THEN the response excludes the blockout time, the booked slot, and any holiday date

#### Scenario: Request outside the allowed range is rejected

- GIVEN the booking window is 24 hours minimum and 60 days maximum
- WHEN a client requests a range extending beyond 60 days, or with `to` not after `from`
- THEN the system answers `400`, and slots inside the 24-hour lead time or beyond the horizon are never returned

#### Scenario: Feature flag off

- GIVEN `PUBLIC_SCHEDULING_ENABLED` is not `'true'`
- WHEN a client calls the public availability or booking endpoint
- THEN the response is `503`

### Requirement: Public Booking Write Endpoint

The system MUST expose an unauthenticated `POST /api/v1/public/therapists/:therapistId/availability/book` endpoint that creates a consultation for a chosen slot after revalidating it against current availability without using the slot cache. The consultation MUST be created through the existing `ConsultationsService` path (public booking variant, with a placeholder clinical content that the therapist completes later), followed by the fire-and-forget calendar sync and charge creation. The request body MUST carry `slotStart` (strict ISO instant) and `patient`, and MAY carry `origin` (acquisition data) and `guardian` (required only for a minor). The response MUST contain the consultation `id`, `groupId` and `sessionDate`. When `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED` is `'true'` the response MUST also contain a `checkout` hint with status `PENDING` (the patient has a default session amount and the therapist's payment account is `CONNECTED`) or `NOT_APPLICABLE`; the checkout URL itself MUST be obtained from the unauthenticated `GET .../availability/book/:groupId/checkout` endpoint, which returns `{ paymentUrl, amount }` once the charge has a payment URL and `{ paymentUrl: null }` otherwise. Booking success MUST NOT depend on charge or checkout URL creation succeeding.

#### Scenario: Booking a currently free slot succeeds

- GIVEN a slot returned by the availability endpoint
- WHEN the client submits a booking for that exact slot
- THEN a consultation is created for the requesting therapist and patient

#### Scenario: Booking a slot outside the booking window fails

- GIVEN a slot within the 24-hour minimum lead time
- WHEN the client submits a booking for that slot
- THEN the booking is rejected with `409` and no consultation is created

#### Scenario: Booking announces a pending checkout

- GIVEN `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED=true`, a `CONNECTED` therapist payment account, and a patient with a default session amount
- WHEN the booking request completes
- THEN the consultation is created and the response carries `checkout.status = PENDING`, and the checkout endpoint later returns the payment URL when the charge has one

#### Scenario: Booking succeeds without checkout when payment is unavailable

- GIVEN a therapist whose `PaymentAccount.status` is not `CONNECTED`, or a patient without a default session amount, or Flow/Google is unavailable
- WHEN the booking request completes
- THEN the consultation is created, the checkout hint is `NOT_APPLICABLE` (or the checkout endpoint returns `paymentUrl: null`), and no error is surfaced to the patient for the missing charge

### Requirement: Patient Identity Resolution

On a booking request, the system MUST decide whether the patient is a minor from the submitted `birthDate`, never from a client flag.

For an adult, the email is required and the system MUST resolve the patient by `(email, therapistId)`, case-insensitively. A single match MUST be reused only when the submitted RUT equals the stored RUT, the stored patient is not a minor today, and the patient's treatment is `ACTIVE`. If none exists, the system MUST create a new patient from the reduced public form (which omits default session amount, documents and consents), recording the acquisition origin (`utm_source` / referrer, or "directo"), and MUST require a valid RUT check digit only at creation. Patient RUT is unique per therapist.

For a minor, the guardian data MUST be required and the patient MUST be identified by the patient RUT scoped to the therapist plus the RUT of one of their registered guardians. If none exists, the system MUST create the patient and a legal guardian record (payer, contact, consent holder and report access by default) in the same transaction; no consent is captured publicly. A guardian RUT equal to the patient RUT MUST be rejected with `400`, and guardian data submitted for an adult MUST be rejected with `400`.

Every identity failure (RUT collision, unverified identity, ambiguous email, invalid check digit, stored patient already a minor or adult in the other path, closed treatment, duplicate email on a new minor) MUST answer the same uniform `409` ("No fue posible procesar la reserva.") without revealing which check failed, and logs MUST NOT contain RUT or email. The system MUST NOT require OTP or any authentication step. When a booking auto-creates a patient, the therapist MUST receive an in-app notification (the patient has no default session amount, so no charge is generated for the first session).

#### Scenario: Existing patient books into their own record

- GIVEN a patient with a stored email and RUT already registered under a therapist, with an active treatment
- WHEN they book using that same email, RUT and therapist
- THEN the new consultation links to their existing patient record and no duplicate patient is created

#### Scenario: Email alone does not prove identity

- GIVEN a patient registered under a therapist
- WHEN someone books with that patient's email but a different RUT
- THEN the booking is rejected with the uniform `409` and nothing is created

#### Scenario: New patient is created and linked

- GIVEN no patient exists with the submitted email under the requested therapist
- WHEN a booking is submitted with the reduced public form
- THEN a new patient is created, linked to that therapist, and linked to the new consultation, and the therapist is notified

#### Scenario: Same email across different therapists does not collide

- GIVEN a patient email already exists under therapist A
- WHEN a booking is submitted for the same email under therapist B
- THEN a separate patient record is created for therapist B, since identity is scoped per therapist

#### Scenario: Minor without guardian data is rejected

- GIVEN a submitted birth date that makes the patient a minor
- WHEN the booking carries no guardian
- THEN the response is `400` and nothing is created

#### Scenario: New minor is created with a guardian

- GIVEN no patient with the submitted RUT exists under the therapist
- WHEN a booking for a minor is submitted with a valid guardian
- THEN the patient, the guardian and the consultation are created together, and no consent is recorded

#### Scenario: Closed treatment blocks public booking

- GIVEN a patient whose treatment was closed by a discharge
- WHEN they try to book publicly
- THEN the booking is rejected with the uniform `409`

### Requirement: Double-Booking Protection

The system MUST serialize public bookings per therapist and MUST enforce a `UNIQUE (therapistId, slotStart)` constraint on booked slots (and one booked slot per consultation group) in addition to checking overlap with the durations of existing consultations inside the write transaction. It MUST respond `409` when a booking attempt conflicts, without creating a duplicate consultation or patient. The booked slot MUST be released when its consultation is cancelled by a treatment discharge and MUST move with the consultation when `correct()` changes `sessionDate`.

#### Scenario: Concurrent bookings for the same slot yield one winner

- GIVEN two clients submit a booking for the same therapist and slot start at nearly the same time
- WHEN both requests are processed
- THEN exactly one consultation is created and the other request receives `409`

#### Scenario: Stale cached slot is rejected at write time

- GIVEN a client holds a cached availability response showing a slot as free
- WHEN that slot was booked by someone else after the cache was computed and the client attempts to book it
- THEN the write is rejected with `409` regardless of what the stale read showed

#### Scenario: Slot released after a discharge cancellation

- GIVEN a publicly booked future consultation cancelled by the patient's treatment closure
- WHEN another patient books the same slot
- THEN the booking succeeds

### Requirement: Public Endpoint Rate Limiting

The system MUST apply rate limiting to the public endpoints with dedicated named limiters (availability: 20 requests per minute by default; booking: 5 per minute by default; both configurable), keyed by client IP, therapist and, when the body carries one, a SHA-256 hash of the submitted email or RUT. Booking MUST additionally be limited per IP and therapist (10 per hour by default) and by a per-therapist daily cap on new bookings (100 per 24 hours by default). It MUST respond `429` once a limit is exceeded. The system MUST NOT log or store the submitted email or RUT in plaintext for rate-limiting purposes.

#### Scenario: Excessive requests from one source are throttled

- GIVEN a client exceeds the configured request window for a given therapist
- WHEN they issue another request against that therapist's public endpoints
- THEN the response is `429`

#### Scenario: Daily booking cap

- GIVEN a therapist already reached the daily cap of new public bookings
- WHEN another booking is submitted for that therapist
- THEN the response is `429` and nothing is created

#### Scenario: Throttling does not leak email in logs

- GIVEN rate limiting is applied per submitted email
- WHEN a request is throttled or logged
- THEN the log does not contain the plaintext email

### Requirement: Booking Confirmation Surfaces the Checkout Link In-Page

When the booking response carries `checkout.status = PENDING`, the public booking page MUST poll the checkout endpoint (every 2 seconds, for at most 15 seconds) and, once a URL is available, render the checkout link so the patient can pay without leaving the page, in addition to the existing payment-link email. If the polling is exhausted, the page MUST tell the patient the payment link will be sent by email. When there is no pending checkout, the confirmation page MUST render only the booking success state, with no payment call to action.

#### Scenario: Confirmation page shows the in-page checkout link

- GIVEN a booking response with a pending checkout and a payment URL that becomes available
- WHEN the confirmation page renders
- THEN it displays a working checkout link alongside the booking success message

#### Scenario: Confirmation page shows no checkout link when unavailable

- GIVEN a booking response with no pending checkout
- WHEN the confirmation page renders
- THEN it shows only the booking success state

#### Scenario: Flow return arrival displays confirmation state, not payment status

- GIVEN a patient is redirected back from Flow to `/book/:therapistId?flow_return=1`
- WHEN the confirmation page loads with that query parameter
- THEN it renders the booking confirmation state without asserting the charge is paid, since payment truth comes only from the gateway's server-side confirmation

### Requirement: Public Booking Form for Minors

The public booking form MUST offer the option to book for a minor. When it is selected, the patient's email MUST become optional, the legal guardian block (name, RUT, relationship, email, optional phone) MUST be required, and the guardian RUT MUST differ from the patient's. When it is not selected and the birth date corresponds to a minor, the form MUST ask the user to select that option. The form MUST link to the privacy policy.

#### Scenario: Minor booking requires the guardian block

- GIVEN the "booking for a minor" option is selected
- WHEN the guardian name, RUT, relationship or email is missing or invalid
- THEN the form shows the validation errors and does not submit

#### Scenario: Minor birth date without the option

- GIVEN the option is not selected
- WHEN the entered birth date corresponds to a patient under 18
- THEN the form asks the user to mark the option for a minor

### Requirement: Public Therapist Profile Exposes an Optional Website

`GET /public/therapists/:therapistId/profile` MUST return exactly `{ name, bio, specialty, website, hasAvatar }`, where `bio`, `specialty` and `website` are nullable. It MUST NOT return any other therapist field (no email, phone or identifiers). The public booking page MUST render `website` as a link in the profile header only when the value is an `http` or `https` URL, and MUST render no link otherwise.

#### Scenario: Therapist with a website shows a link

- GIVEN a therapist whose profile has `website` set to an `https` URL
- WHEN the public profile endpoint is called and the booking page renders
- THEN the response includes `website` with that URL and the page header shows it as a link

#### Scenario: Public avatar of the therapist

- GIVEN a therapist with a profile photo (`hasAvatar: true`)
- WHEN a client requests `GET /public/therapists/:therapistId/avatar`
- THEN the image is returned with its stored MIME type and `Cross-Origin-Resource-Policy: cross-origin`; for a therapist without a photo the response is `404`

#### Scenario: Therapist without a website shows no link

- GIVEN a therapist whose profile has no `website`
- WHEN the public profile endpoint is called and the booking page renders
- THEN the response includes `website: null` and the page header renders no website link

#### Scenario: Non-http(s) value is never rendered as a link

- GIVEN a `website` value whose scheme is not `http` or `https`
- WHEN the booking page renders the profile header
- THEN no link is rendered for it
