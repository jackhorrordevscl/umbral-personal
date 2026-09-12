# Delta for payments

## ADDED Requirements

### Requirement: Checkout URL Exposure to the Booking Response

When `ensureCharge()` has already produced a checkout URL at the time a public booking request completes, the system MUST include that checkout URL in the booking response. The system MUST NOT delay or block the booking response waiting for a charge or checkout URL to be created, and a booking response without a checkout URL MUST still represent a successful booking.

#### Scenario: Booking response carries the checkout URL when already available

- GIVEN a therapist with a `CONNECTED` Flow account and a public booking request that triggers automatic charge creation completed synchronously before the response is built
- WHEN the booking response is constructed
- THEN it includes the Flow checkout URL for the newly created charge

#### Scenario: Booking response omits the checkout URL without failing

- GIVEN a therapist whose `PaymentAccount.status` is not `CONNECTED`, or a charge/checkout URL not yet available at response time
- WHEN the booking response is constructed
- THEN the booking succeeds and the response contains no checkout URL

### Requirement: Flow Return Endpoint

The system MUST expose a dedicated backend endpoint that accepts Flow's browser `POST` to `urlReturn` and responds with a redirect to the public booking confirmation page, without performing any endpoint-local action beyond that redirect. This endpoint MUST NOT be treated as a source of payment status; a request reaching it MUST NOT by itself mark any charge as paid, pending, or failed.

#### Scenario: Flow POST return redirects to the confirmation page

- GIVEN a patient completes or abandons hosted checkout
- WHEN Flow issues its browser `POST` to the configured `urlReturn`
- THEN the endpoint responds with a redirect to the public booking confirmation page for that therapist

#### Scenario: Arrival at the return endpoint does not change payment state

- GIVEN a charge in `PENDING` state
- WHEN a request reaches the Flow return endpoint for that charge
- THEN the charge's status is unchanged by that request alone; only `urlConfirmation` or `payment/getStatus` may transition it
