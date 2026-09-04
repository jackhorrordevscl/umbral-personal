# payment-gateway-connection Specification

## Purpose

Let a therapist self-service connect their own Flow merchant account: paste credentials, validate them live against Flow before anything is persisted, store them encrypted, disconnect on demand, and reconnect an account invalidated by the split-payment-to-own-account migration.

## Requirements

### Requirement: Guided Connection Wizard With Pre-Persistence Validation

The system MUST present a 5-step connection flow (welcome/checklist, go to Flow, locate credentials, paste and validate, confirmation) and MUST validate pasted credentials against Flow before persisting anything. The system MUST reject an obviously malformed credential (e.g. empty or not matching Flow's documented key format) at the paste step, without calling Flow. Only a credential pair that both passes field-level format validation and receives a successful live validation from Flow MUST be persisted.

#### Scenario: Successful connection persists validated credentials

- GIVEN a therapist pastes a well-formed `apiKey`/`secretKey` pair
- WHEN the system validates them live against Flow and Flow confirms them
- THEN the credentials are encrypted and persisted, the account status becomes `CONNECTED`, and the confirmation step shows the commerce name Flow returned

#### Scenario: Malformed credentials are rejected before calling Flow

- GIVEN a therapist pastes a value that does not match Flow's documented credential format
- WHEN the therapist attempts to validate
- THEN the system shows a field-level error, makes no call to Flow, and persists nothing

#### Scenario: Flow rejects well-formed but invalid credentials

- GIVEN a well-formed `apiKey`/`secretKey` pair that Flow does not recognize
- WHEN the system calls Flow's live validation
- THEN the system shows Flow's actionable rejection reason, persists nothing, and the therapist remains on the paste step

### Requirement: Encrypted Credential Storage With Non-Secret Display Metadata

The system MUST store `{apiKey, secretKey}` encrypted (AES-GCM) and MUST NOT store or display the plaintext `merchantId`. The system MUST expose only non-secret metadata for display: provider, the commerce name Flow returned, the connection date, and a fingerprint of the key. The system MUST NOT return or log a decrypted secret in any API response, error message, or log line.

#### Scenario: Post-connection view exposes no secret

- GIVEN a connected account
- WHEN the therapist views their connection status
- THEN they see provider, commerce name, connection date, and key fingerprint, and never the raw `apiKey`/`secretKey`

### Requirement: Self-Service Disconnection

The system MUST let a therapist disconnect a `CONNECTED` account on demand. Disconnection MUST stop automatic charge creation for consultations created afterward, and MUST NOT alter charges already created before disconnection.

#### Scenario: Disconnecting stops future automatic charges only

- GIVEN a therapist with a `CONNECTED` account and an existing pending charge
- WHEN the therapist disconnects
- THEN the account status becomes `DISCONNECTED`, the existing pending charge is untouched, and no new consultation for that therapist gets an automatic charge until they reconnect

### Requirement: Reconnection of Legacy-Invalidated Accounts

The system MUST flag every account that was `CONNECTED` under the retired split-payment model as requiring reconnection (status `RECONNECT_REQUIRED`), MUST surface an in-app notice explaining why, and MUST let the therapist re-run the connection wizard to restore charge creation. Reconnection follows the same validate-then-persist rule as first-time connection.

#### Scenario: Legacy account is flagged and blocked from silent charge creation

- GIVEN an account that was `CONNECTED` under the retired split-payment model
- WHEN the migration runs
- THEN its status becomes `RECONNECT_REQUIRED`, the therapist sees an in-app notice, and no automatic charge is created for their consultations

#### Scenario: Reconnecting restores automatic charge creation

- GIVEN an account in `RECONNECT_REQUIRED`
- WHEN the therapist completes the wizard with credentials Flow validates
- THEN the account status becomes `CONNECTED` and subsequent consultations get automatic charges again

### Requirement: Abandoning the Wizard Persists Nothing

Because validation is separate from persistence, the system MUST NOT persist any credential, partial or complete, unless the therapist reaches and confirms the final step with Flow-validated credentials. Abandoning the wizard before that point MUST leave the account's persisted status unchanged.

#### Scenario: Leaving mid-wizard changes nothing persisted

- GIVEN a therapist who pasted and validated credentials but closes the wizard before confirming
- WHEN they return later
- THEN the account's persisted status is unchanged from before they started, and no partial credential was stored

## Open Questions

- Whether the wizard preserves client-side (not persisted server-side) progress — e.g. the pasted-but-unconfirmed keys or which step the therapist was on — across a page reload or session end is not defined by the proposal. Left as a UX decision for design; this spec only guarantees no server-side persistence occurs before final confirmation.
- The exact field-level format check for "malformed" credentials (length, prefix, character set) is not specified by the proposal or Flow's docs reviewed so far; left to design/implementation against Flow's documented format.
