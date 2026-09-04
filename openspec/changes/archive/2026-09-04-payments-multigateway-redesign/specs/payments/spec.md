# Delta for payments

## MODIFIED Requirements

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

## Open Questions

- Charges created while an account was still `CONNECTED` but left pending when the account later flips to `RECONNECT_REQUIRED` or `DISCONNECTED` (mid-flight charges): the proposal does not state whether these are cancelled, left pending indefinitely, or block reconnection. This spec only guarantees checkout does not silently proceed with stale credentials (see "Checkout is unavailable" scenario above); the disposition of those pre-existing pending charges is left as an open question for design.
