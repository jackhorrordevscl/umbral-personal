# payments Specification

## Purpose

Automatic per-session charges keyed to a consultation's group, collected through each therapist's own Flow account (Comercios Asociados split mode), with hosted checkout, signature-verified webhook confirmation, and a one-shot late-payment alert. Umbral never custodies patient funds.

## Requirements

### Requirement: Payment Identity Keyed by Consultation Group

The system MUST key each `Payment` by `Consultation.groupId`, MUST update the same record on `correct()` instead of creating a second one, and MUST move the due date when a reschedule changes `sessionDate`. Payment status MUST remain mutable operational state, never part of the versioned clinical snapshot.

#### Scenario: Correction updates the same charge and moves its due date

- GIVEN a consultation with a pending charge
- WHEN `correct()` changes `sessionDate`
- THEN the same `Payment` is updated with the new due date, and no second charge exists

### Requirement: Automatic Charge Creation Gated by Gateway Connection

The system MUST create a pending charge automatically on consultation creation, with no manual step, only when the owning therapist's `PaymentAccount.status` is `CONNECTED`. For any other status (`PENDING`, `DISCONNECTED`, or `RECONNECT_REQUIRED`), no charge MUST be created and scheduling MUST succeed exactly as without payments.
(Previously: gating was a binary "connected Flow account" check against the old single-status model; it now must explicitly cover the added `RECONNECT_REQUIRED` status introduced by the credential-ownership migration, treating it identically to "not connected".)

#### Scenario: Connected therapist gets an automatic charge

- GIVEN a therapist with a `CONNECTED` Flow account
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

### Requirement: Charge Amount Resolution and Snapshot

The system MUST source a charge's amount from a session-level override when provided, otherwise from `Patient.defaultSessionAmount`, and MUST snapshot that amount at creation, independent of later edits to `Patient.defaultSessionAmount`.

#### Scenario: Override takes precedence over the patient default

- GIVEN a patient with `defaultSessionAmount` set
- WHEN a session is scheduled with an explicit amount override
- THEN the charge amount equals the override, and later edits to `defaultSessionAmount` do not affect it

### Requirement: Due Date and Late Transition

The system MUST set a charge's due date to the session's own `sessionDate`. A charge still pending at or past its due date MUST transition to `LATE`; a charge already `PAID` MUST NOT transition.

#### Scenario: Unpaid charge becomes late at session time

- GIVEN a pending charge due at `sessionDate`
- WHEN the current time reaches `sessionDate` and it is still unpaid
- THEN the charge transitions to `LATE`

### Requirement: Automatic Payment-Link Email Delivery

The system MUST email the payment link to `Patient.email` at charge creation, with no therapist action, when that address is present. When `Patient.email` is absent, the system MUST still create the charge, MUST NOT send a link email, and MUST expose a therapist-visible "link not delivered" state. Missing email MUST NOT block charge creation or scheduling.

#### Scenario: Patient with an email receives the link automatically

- GIVEN a patient with `email` set
- WHEN a charge is created for them
- THEN a payment-link email is sent at creation

#### Scenario: Patient without an email still gets a charge

- GIVEN a patient with no `email`
- WHEN a charge is created for them
- THEN the charge exists, no email is sent, and the therapist sees "link not delivered"

### Requirement: Hosted Checkout via Therapist-Owned Flow Account

The system MUST use Flow's hosted checkout with the credentials of the therapist's own connected Flow account, so each therapist is the sole merchant of record for their own charges and Umbral custodies no funds. The system MUST NOT use split-payment or sub-merchant (Comercios Asociados) semantics.
(Previously: "Hosted Checkout via Flow Split Payments" — checkout used Comercios Asociados split mode so funds routed to the therapist under Umbral's merchant relationship. Flow confirmed this model does not split funds as required, so checkout now runs entirely under the therapist's own credentials instead.)

#### Scenario: Checkout settles to the owning therapist's account

- GIVEN a pending charge owned by therapist A, whose account is `CONNECTED`
- WHEN the patient completes hosted checkout
- THEN the payment settles 100% to therapist A's own Flow account, with no funds passing through an Umbral-controlled account

#### Scenario: Checkout is unavailable if the owning account is no longer connected

- GIVEN a pending charge whose owning account has moved to `RECONNECT_REQUIRED` or `DISCONNECTED` after the charge was created
- WHEN the patient attempts to complete hosted checkout
- THEN the system MUST NOT complete the checkout using stale credentials, and MUST surface an error rather than silently failing

### Requirement: Signature-Verified Webhook Confirmation

The system MUST verify every payment-confirmation webhook with HMAC-SHA256 before processing it and MUST reject any webhook that fails verification. Confirmed payments MUST process idempotently, so a replayed webhook for an already-confirmed charge causes no further change.

#### Scenario: Valid signature confirms payment

- GIVEN a pending charge and a webhook with a valid signature reporting payment
- WHEN the webhook is received
- THEN the charge transitions to `PAID`

#### Scenario: Invalid signature is rejected

- GIVEN a webhook whose signature does not verify
- WHEN it is received
- THEN it is rejected and no charge state changes

#### Scenario: Replayed webhook is a no-op

- GIVEN a charge already `PAID` from a prior webhook
- WHEN the same webhook is delivered again
- THEN the charge remains `PAID` with no duplicate processing

### Requirement: Cancellation Preserves Paid Charges and Voids Pending Ones

When a consultation is soft-deleted, the system MUST cancel a still-pending or late charge for it, and MUST preserve a paid charge untouched, with no automatic refund.

#### Scenario: Cancelling a session with a pending charge voids it

- GIVEN a consultation with a pending or late charge
- WHEN the consultation is soft-deleted
- THEN the charge is cancelled

#### Scenario: Cancelling a session with a paid charge preserves it

- GIVEN a consultation with a paid charge
- WHEN the consultation is soft-deleted
- THEN the payment remains `PAID` and unchanged, with no refund issued

### Requirement: One-Shot Late-Payment Notification

On the pending-to-late transition, the system MUST send exactly one late-payment email and create exactly one in-app notification of a `PAYMENT_LATE` type, and MUST NOT repeat either on later checks. This is a single alert, not a recurring reminder cadence.

#### Scenario: Late transition fires exactly one alert of each kind, once

- GIVEN a charge that just transitioned to `LATE`
- WHEN the transition is processed, and a later scan re-evaluates the same charge
- THEN exactly one email and one `PAYMENT_LATE` notification exist, with no duplicate

### Requirement: Feature Flag Gating

The system MUST expose `PAYMENTS_ENABLED` following the existing `X_ENABLED !== 'false'` convention. When disabled, the system MUST NOT create charges, send link or late-payment emails, or process webhooks, and scheduling MUST behave exactly as without payments.

#### Scenario: Flag off disables the entire capability

- GIVEN `PAYMENTS_ENABLED=false`
- WHEN a consultation is created
- THEN no charge, link email, or notification is generated, and scheduling succeeds

## Open Questions

- Charges created while an account was still `CONNECTED` but left pending when the account later flips to `RECONNECT_REQUIRED` or `DISCONNECTED` (mid-flight charges): the proposal does not state whether these are cancelled, left pending indefinitely, or block reconnection. This spec only guarantees checkout does not silently proceed with stale credentials (see "Checkout is unavailable" scenario above); the disposition of those pre-existing pending charges is left as an open question for design.
