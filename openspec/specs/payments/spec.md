# payments Specification

## Purpose

Automatic per-session charges keyed to a consultation's group, collected through each therapist's own Flow account (each therapist is the sole merchant of record), with hosted checkout, gateway-verified webhook confirmation, periodic reconciliation, and a one-shot late-payment alert. Umbral never custodies patient funds.

## Requirements

### Requirement: Payment Identity Keyed by Consultation Group

The system MUST key each `Payment` by `Consultation.groupId`, MUST update the same record on `correct()` instead of creating a second one, and MUST move the due date when a reschedule changes `sessionDate`. A `LATE` charge whose session is rescheduled into the future MUST return to `PENDING` and become eligible for a new late alert. Payment status MUST remain mutable operational state, never part of the versioned clinical snapshot.

#### Scenario: Correction updates the same charge and moves its due date

- GIVEN a consultation with a pending charge
- WHEN `correct()` changes `sessionDate`
- THEN the same `Payment` is updated with the new due date, and no second charge exists

#### Scenario: Late charge returns to pending when rescheduled forward

- GIVEN a consultation whose charge is `LATE`
- WHEN `correct()` moves `sessionDate` into the future
- THEN the charge becomes `PENDING` again with the new due date

### Requirement: Automatic Charge Creation Gated by Gateway Connection

The system MUST create a pending charge automatically after a consultation is created (by the therapist or through a public booking), with no manual step, as a non-blocking side effect, only when the owning therapist's `PaymentAccount.status` is `CONNECTED` and the patient has a `defaultSessionAmount`. For any other account status (`PENDING`, `DISCONNECTED`, or `RECONNECT_REQUIRED`), for a patient without a default amount, or for a soft-deleted patient, no charge MUST be created and scheduling MUST succeed exactly as without payments. A failure while creating the charge or its gateway order MUST NOT fail or delay the consultation write.

#### Scenario: Connected therapist gets an automatic charge

- GIVEN a therapist with a `CONNECTED` Flow account and a patient with a default session amount
- WHEN a consultation is created
- THEN a pending `Payment` is created automatically

#### Scenario: Unconnected therapist schedules normally

- GIVEN a therapist whose account status is `PENDING` or `DISCONNECTED`
- WHEN a consultation is created
- THEN the consultation succeeds and no `Payment` record exists for it

#### Scenario: Therapist requiring reconnection schedules without a charge

- GIVEN a therapist whose account status is `RECONNECT_REQUIRED`
- WHEN a consultation is created
- THEN the consultation succeeds, no `Payment` record exists for it, and the therapist sees the reconnect-required notice

#### Scenario: Patient without a default amount gets no charge

- GIVEN a connected therapist and a patient whose `defaultSessionAmount` is not set
- WHEN a consultation is created
- THEN the consultation succeeds and no `Payment` record exists for it

### Requirement: Charge Amount Resolution and Snapshot

The system MUST source a charge's amount from `Patient.defaultSessionAmount` and MUST snapshot that amount at creation, independent of later edits to `Patient.defaultSessionAmount`. The therapist MUST be able to change the amount of a `PENDING` or `LATE` charge afterwards (integer CLP between 0 and 100,000,000); doing so MUST void the previous gateway order, issue a new order and resend the link, and MUST be rejected for a paid or cancelled charge. A `defaultSessionAmount` of `0` means "no charge" and MUST be treated like an unset amount: no `Payment` record is created. An amount below the gateway minimum (350 CLP for Flow) MUST NOT produce a gateway order: at creation the charge is kept with an explanatory error, and an amount update below the minimum MUST be rejected with `400`, provided the therapist has a `CONNECTED` Flow account with v2 credentials (without one there is no gateway context and the amount is saved without that check).

#### Scenario: Snapshot is independent of later edits to the default amount

- GIVEN a charge created from a patient's `defaultSessionAmount`
- WHEN the patient's default amount is edited afterwards
- THEN the existing charge keeps its original amount

#### Scenario: Therapist changes the amount of a pending charge

- GIVEN a pending charge with an issued gateway order
- WHEN the therapist updates its amount
- THEN the previous order is voided, a new order and payment link are issued for the new amount, and the link is sent again

#### Scenario: Amount below the gateway minimum

- GIVEN a connected Flow account
- WHEN the therapist sets a charge amount below 350 CLP
- THEN the response is `400` and the charge is unchanged

### Requirement: Due Date and Late Transition

The system MUST set a charge's due date to 24 hours after the later of the session's `sessionDate` and the time of creation (or of a reschedule). A scheduled sweep running every 30 minutes MUST transition a `PENDING` charge whose due date has passed to `LATE`; a charge already `PAID` or `CANCELLED` MUST NOT transition.

#### Scenario: Unpaid charge becomes late after the due date

- GIVEN a pending charge whose due date has passed
- WHEN the sweep runs and it is still unpaid
- THEN the charge transitions to `LATE`

### Requirement: Therapist Charge Management Endpoints

The backend MUST expose, behind an authenticated session, `PATCH /payments/:groupId` (body `amount`), `POST /payments/:groupId/resend-link` and `POST /payments/:groupId/retry-charge`. Each MUST first verify that the charge belongs to the requesting therapist and answer a uniform `404` otherwise, indistinguishable from a nonexistent group. `PATCH` on a charge that is not `PENDING` or `LATE` MUST answer `404`. `resend-link` MUST answer `400` when the charge is paid or cancelled, when it has no payment link, or when no recipient email exists (the message distinguishes a minor without a guardian email from a patient without an email). `retry-charge` MUST answer `400` when the charge is not `PENDING` or `LATE`, when it already has a payment link, or when the therapist has no connected payment account.

#### Scenario: Another therapist's charge is not reachable

- GIVEN a charge owned by therapist A
- WHEN therapist B calls any of the three endpoints with its `groupId`
- THEN the response is `404`

#### Scenario: Resending the link of a paid charge

- GIVEN a charge in `PAID` status
- WHEN its owner requests `resend-link`
- THEN the response is `400` and no email is sent

### Requirement: Automatic Payment-Link Email Delivery

The system MUST email the payment link at charge creation, with no therapist action, to the patient's email, or, for a minor, to the legal guardian who receives communications and has an email (preferring the one who pays), addressing the guardian by name and mentioning the patient. The delivery state (`PENDING`, `SENT`, `FAILED`, `SKIPPED_NO_EMAIL`) MUST be recorded and visible to the therapist. When no recipient email exists, the system MUST still create the charge, MUST NOT send a link email, and MUST expose the "link not delivered" state. For a minor without a guardian email, the gateway order MUST NOT be issued and the reason MUST be recorded on the charge. The therapist MUST be able to resend the link of a pending or late charge that has one, and to retry the issuing of an order for a charge that has none. Missing email MUST NOT block charge creation or scheduling.

#### Scenario: Patient with an email receives the link automatically

- GIVEN a patient with `email` set
- WHEN a charge is created for them
- THEN a payment-link email is sent at creation

#### Scenario: Minor's link goes to the guardian

- GIVEN a minor patient with a registered guardian who has an email
- WHEN a charge is created for them
- THEN the payment-link email is addressed to the guardian

#### Scenario: Patient without an email still gets a charge

- GIVEN a patient with no `email` and no guardian email
- WHEN a charge is created for them
- THEN the charge exists, no email is sent, and the therapist sees "link not delivered"

#### Scenario: Therapist resends the link

- GIVEN a pending charge with a payment link and a recipient email
- WHEN the therapist requests a resend
- THEN the email is sent again and the delivery state is updated

### Requirement: Hosted Checkout via Therapist-Owned Flow Account

The system MUST use Flow's hosted checkout with the credentials of the therapist's own connected Flow account, so each therapist is the sole merchant of record for their own charges and Umbral custodies no funds. The system MUST NOT use split-payment or sub-merchant (Comercios Asociados) semantics.

#### Scenario: Checkout settles to the owning therapist's account

- GIVEN a pending charge owned by therapist A, whose account is `CONNECTED`
- WHEN the patient completes hosted checkout
- THEN the payment settles 100% to therapist A's own Flow account, with no funds passing through an Umbral-controlled account

#### Scenario: Confirmation is unavailable if the owning account is no longer connected

- GIVEN a pending charge whose owning account has moved to `RECONNECT_REQUIRED` or `DISCONNECTED` after the charge was created
- WHEN a confirmation or reconciliation for that charge is attempted
- THEN the system MUST NOT use stale credentials, the confirmation is rejected, and the charge is not marked as paid

### Requirement: Gateway-Verified Webhook Confirmation

The system MUST NOT trust the content of a payment-confirmation webhook (`POST /payments/confirm`): Flow does not sign this callback and sends only a token. Before processing it, the system MUST re-query the order status at the gateway using the owning therapist's own credentials, and MUST reject the webhook with a uniform `400` (one that does not reveal which check failed) when the token matches no charge, when the owning payment account is unavailable, when the status lookup fails, or when the gateway does not report the order as paid. The confirmation endpoint MUST have its own rate limiter. Confirmed payments MUST process idempotently, so a replayed webhook for an already-confirmed charge causes no further change. When the gateway reports a paid amount different from the charge amount, the charge MUST NOT be marked paid and the therapist MUST receive a `PAYMENT_ANOMALY` notification; the same notification MUST be raised when the gateway reports a payment for a charge cancelled in Umbral.

#### Scenario: Gateway confirms payment

- GIVEN a pending charge and a webhook carrying its token
- AND the gateway reports the order as paid
- WHEN the webhook is received
- THEN the charge transitions to `PAID`

#### Scenario: Order not reported as paid is rejected

- GIVEN a webhook whose token matches a charge
- AND the gateway does not report the order as paid, or the status lookup fails
- WHEN the webhook is received
- THEN it is rejected, no charge state changes and no email is sent

#### Scenario: Unknown token is rejected without calling the gateway

- GIVEN a webhook whose token matches no charge
- WHEN it is received
- THEN it is rejected and no gateway call is made

#### Scenario: Replayed webhook is a no-op

- GIVEN a charge already `PAID` from a prior webhook
- WHEN the same webhook is delivered again
- THEN the charge remains `PAID` with no duplicate processing

#### Scenario: Amount mismatch raises an anomaly

- GIVEN a pending charge and a gateway order reported as paid with a different amount
- WHEN the confirmation is processed
- THEN the charge is not marked paid and a `PAYMENT_ANOMALY` notification is created for the therapist

#### Scenario: Payment on a cancelled charge raises an anomaly

- GIVEN a charge cancelled in Umbral and a gateway order later reported as paid
- WHEN the confirmation is processed
- THEN the charge stays cancelled and a `PAYMENT_ANOMALY` notification is created

### Requirement: Periodic Reconciliation With the Gateway

A scheduled sweep running every 30 minutes MUST re-query the gateway for `PENDING` and `LATE` charges whose order was issued more than 15 minutes earlier, in bounded batches with limited concurrency, and MUST mark as paid those the gateway reports as paid (applying the same amount check as the webhook), so a lost webhook does not leave a paid charge open. A charge whose owning account is not `CONNECTED` MUST be skipped. A sweep triggered while the previous one is still running MUST be skipped instead of overlapping it, and a failed sweep MUST NOT leave later sweeps blocked.

#### Scenario: Lost webhook is recovered by the sweep

- GIVEN a pending charge whose webhook never arrived and which the gateway reports as paid
- WHEN the sweep runs
- THEN the charge becomes `PAID`

#### Scenario: A sweep does not overlap the previous one

- GIVEN a sweep that is still waiting on the gateway
- WHEN the schedule triggers another sweep
- THEN the new sweep is skipped without querying charges or calling the gateway
- AND the next sweep after the running one finishes (or fails) runs normally

### Requirement: Cancellation Preserves Paid Charges and Voids Pending Ones

When a patient is soft-deleted, or a treatment closure (discharge) cancels the patient's future consultations, the system MUST cancel the still-pending or late charges concerned and void their gateway orders (a gateway failure MUST NOT undo the local cancellation), and MUST preserve a paid charge untouched, with no automatic refund. A closure MUST resolve the cancellations before answering, with each charge isolated so one failure does not stop the others.

#### Scenario: Cancelling a session with a pending charge voids it

- GIVEN a consultation with a pending or late charge
- WHEN the patient is soft-deleted or the consultation is cancelled by a treatment closure
- THEN the charge is cancelled and its gateway order is voided

#### Scenario: Cancelling a session with a paid charge preserves it

- GIVEN a consultation with a paid charge
- WHEN the patient is soft-deleted or the consultation is cancelled by a treatment closure
- THEN the payment remains `PAID` and unchanged, with no refund issued

### Requirement: One-Shot Late-Payment Notification

On the pending-to-late transition, the system MUST send one late-payment email to the patient (or the guardian of a minor) when a recipient email exists and the charge has a payment link, and MUST create exactly one in-app notification of a `PAYMENT_LATE` type for the therapist, and MUST NOT repeat either on later checks. A charge that never had a payment link (amount below the gateway minimum, order not issued, or link discarded) still transitions to `LATE` and notifies the therapist, but MUST NOT email the patient: they were never asked to pay. This is a single alert, not a recurring reminder cadence.

#### Scenario: Late transition fires exactly one alert of each kind, once

- GIVEN a charge that just transitioned to `LATE`
- WHEN the transition is processed, and a later scan re-evaluates the same charge
- THEN exactly one email and one `PAYMENT_LATE` notification exist, with no duplicate

### Requirement: Feature Flag Gating

The system MUST expose `PAYMENTS_ENABLED` following the existing `X_ENABLED !== 'false'` convention. When disabled, the system MUST NOT create charges, send link or late-payment emails, or run the late and reconciliation sweeps, and scheduling MUST behave exactly as without payments.

#### Scenario: Flag off disables the entire capability

- GIVEN `PAYMENTS_ENABLED=false`
- WHEN a consultation is created
- THEN no charge, link email, or notification is generated, and scheduling succeeds

### Requirement: Checkout URL Exposure to the Public Booking

A public booking response MUST NOT wait for a charge or checkout URL to be created: when `PUBLIC_BOOKING_CHECKOUT_INLINE_ENABLED` is on it carries only a checkout hint (`PENDING` or `NOT_APPLICABLE`), and the checkout URL MUST be exposed through the unauthenticated `GET /public/therapists/:therapistId/availability/book/:groupId/checkout` endpoint, which returns the payment URL and amount once the charge has one and a `null` URL otherwise. A booking without a checkout URL MUST still represent a successful booking.

#### Scenario: Checkout endpoint returns the URL once available

- GIVEN a booking whose charge already has a payment URL
- WHEN the client queries the checkout endpoint for that group
- THEN it receives the payment URL and amount

#### Scenario: Checkout endpoint without a URL does not fail

- GIVEN a booking whose charge does not exist or has no payment URL yet
- WHEN the client queries the checkout endpoint
- THEN the response is successful with a `null` payment URL

### Requirement: Flow Return Endpoint

The system MUST expose a backend endpoint (`GET` and `POST /payments/return`) that accepts Flow's browser return to `urlReturn` and responds with a `302` redirect to the frontend payment-received page, carrying the token when present, without performing any other action. A separate read-only status endpoint (`GET /payments/return-status`) MAY be queried by that page: it MUST determine the status from the gateway (using the owning therapist's credentials), answer `PAID`, `REJECTED`, or `PENDING` (also when the token is unknown, the account unavailable, or the gateway lookup fails), and MUST NOT change any charge. Neither endpoint MUST by itself mark any charge as paid, pending, or failed; only the verified confirmation webhook or the reconciliation sweep may transition it.

#### Scenario: Flow return redirects to the payment-received page

- GIVEN a patient completes or abandons hosted checkout
- WHEN Flow issues its browser request to the configured `urlReturn`
- THEN the endpoint responds with a redirect to the frontend payment-received page

#### Scenario: Arrival at the return endpoint does not change payment state

- GIVEN a charge in `PENDING` state
- WHEN a request reaches the Flow return endpoint or the return-status endpoint for that charge
- THEN the charge's status is unchanged by that request alone

#### Scenario: Return status reflects the gateway

- GIVEN a charge whose gateway order is reported as rejected
- WHEN the payment-received page queries the return status
- THEN the answer is `REJECTED` and the page tells the patient to ask their therapist for a new payment link

## Open Questions

- Charges created while an account was still `CONNECTED` but left pending when the account later flips to `RECONNECT_REQUIRED` or `DISCONNECTED` (mid-flight charges): the code leaves them pending, and their confirmation and reconciliation are skipped or rejected while the account is not `CONNECTED`. Whether they should be cancelled or block reconnection is not defined.
