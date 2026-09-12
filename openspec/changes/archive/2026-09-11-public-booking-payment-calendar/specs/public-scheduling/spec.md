# Delta for public-scheduling

## MODIFIED Requirements

### Requirement: Public Booking Write Endpoint

The system MUST expose an unauthenticated `POST /api/v1/public/therapists/:therapistId/availability/book` endpoint that creates a consultation for a chosen slot after validating it against current availability. It MUST reuse the existing `ConsultationsService` creation path and its fire-and-forget calendar sync. When `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED` is on and a checkout URL is already available at response time per the `payments` capability, the response MUST include it; booking success MUST NOT depend on charge or checkout URL creation succeeding.
(Previously: did not define any payment or checkout URL relationship to the booking response.)

#### Scenario: Booking a currently free slot succeeds

- GIVEN a slot returned by the availability endpoint
- WHEN the client submits a booking for that exact slot
- THEN a consultation is created for the requesting therapist and patient

#### Scenario: Booking a slot outside the booking window fails

- GIVEN a slot within the 24-hour minimum lead time
- WHEN the client submits a booking for that slot
- THEN the booking is rejected and no consultation is created

#### Scenario: Booking succeeds and carries a checkout URL when available

- GIVEN `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED=true`, a `CONNECTED` therapist, and a checkout URL already produced synchronously
- WHEN the booking request completes
- THEN the consultation is created and the response includes the checkout URL

#### Scenario: Booking succeeds without a checkout URL when payment is unavailable

- GIVEN a therapist whose `PaymentAccount.status` is not `CONNECTED`, or Flow/Google is unavailable
- WHEN the booking request completes
- THEN the consultation is created and the response contains no checkout URL, with no error surfaced to the patient for the missing charge

## ADDED Requirements

### Requirement: Booking Confirmation Surfaces the Checkout Link In-Page

When `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED` is on and the booking response includes a checkout URL, the public booking confirmation page MUST render that checkout link so the patient can pay without leaving the page, in addition to the existing payment-link email. When no checkout URL is present, the confirmation page MUST render only the booking success state, with no payment call to action.

#### Scenario: Confirmation page shows the in-page checkout link

- GIVEN a booking response that includes a checkout URL
- WHEN the confirmation page renders
- THEN it displays a working checkout link alongside the booking success message

#### Scenario: Confirmation page shows no checkout link when unavailable

- GIVEN a booking response with no checkout URL
- WHEN the confirmation page renders
- THEN it shows only the booking success state

#### Scenario: Flow return arrival displays confirmation state, not payment status

- GIVEN a patient is redirected back from Flow to `/book/:therapistId?flow_return=1`
- WHEN the confirmation page loads with that query parameter
- THEN it renders the booking confirmation state without asserting the charge is paid, since payment truth comes only from `urlConfirmation`/`payment/getStatus`
