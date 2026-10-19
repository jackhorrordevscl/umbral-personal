# payment-gateway-connection Specification

## Purpose

Let a therapist self-service connect their own Flow merchant account: paste credentials, validate them live against Flow before anything is persisted, store them encrypted, disconnect on demand, and reconnect an account invalidated by the split-payment-to-own-account migration.

## Requirements

### Requirement: Guided Connection Wizard With Pre-Persistence Validation

The system MUST present a 5-step connection flow (welcome/checklist, go to Flow, locate credentials, paste and validate, confirmation) and MUST validate pasted credentials against Flow before persisting anything. The system MUST reject a malformed credential at the paste step without calling Flow: both `apiKey` and `secretKey` MUST be 16 to 128 characters long and contain only letters, digits, `_` or `-` (the same rule is enforced by the API with `400`). Only a credential pair that both passes this format validation and receives a successful live validation from Flow MUST be persisted. The paste step MUST use a validation call that never writes, and the confirmation step MUST persist by connecting again (validating once more before saving).

#### Scenario: Successful connection persists validated credentials

- GIVEN a therapist pastes a well-formed `apiKey`/`secretKey` pair
- WHEN the system validates them live against Flow and Flow confirms them
- THEN the credentials are encrypted and persisted, the account status becomes `CONNECTED`, a `PAYMENT_ACCOUNT_CONNECTED` audit entry is recorded, and the confirmation step shows the provider, the masked API key and the key fingerprint, plus the commerce name only when the gateway returns one (the Flow client currently does not, so the step offers an optional field, up to 200 characters, for the therapist to name the account)

#### Scenario: Malformed credentials are rejected before calling Flow

- GIVEN a therapist pastes a value that does not match the credential format
- WHEN the therapist attempts to validate
- THEN the system shows a field-level error, makes no call to Flow, and persists nothing

#### Scenario: Flow rejects well-formed but invalid credentials

- GIVEN a well-formed `apiKey`/`secretKey` pair that Flow does not recognize
- WHEN the system calls Flow's live validation
- THEN the system persists no credential and does not change the account status, and the therapist remains on the paste step. The paste-step validation (`POST /payments/account/validate`) writes nothing. Flow signals valid credentials by answering `400`/`404` with the "token not found" code `1700` to a probe with a non-existent token (the signature authenticates before the token is resolved) and invalid ones with `401`/`403`. A `400`/`404` that does not carry code `1700` (another code, an empty body, or a body that is not JSON, such as a proxy page from a wrong base URL) does not confirm the credentials: it is treated as invalid and nothing is persisted. When Flow rejects the paste step (`401`/`403`) or fails transiently, the API responds `400` with Flow's message and the wizard shows it, falling back to "Flow no reconoció estas credenciales." only when the response carries no message. When Flow rejects the confirmation step's connect call (`POST /payments/account`), the API responds `400` with Flow's message and records it as the account's last error (creating the account row with status `PENDING` when none exists)

### Requirement: Encrypted Credential Storage With Non-Secret Display Metadata

The system MUST store `{apiKey, secretKey}` encrypted with AES-256-GCM, using a dedicated key (`PAYMENT_CREDENTIALS_ENCRYPTION_KEY`) managed through the versioned keyring (`..._KEYRING`, `..._ACTIVE_KEY_ID`), and MUST NOT write or display the legacy plaintext `merchantId` (the deprecated column remains in the schema only for rows of the retired model). The system MUST expose only non-secret metadata for display through `GET /payments/account`: `status`, `provider`, `displayName` (the commerce name returned by the gateway when it provides one, otherwise the optional name typed by the therapist), `connectedAt`, `keyFingerprint` and `lastError`; a therapist with no account row gets `status: 'PENDING'` and the remaining fields as `null`. Credentials are persisted with `credentialVersion` 2. The system MUST NOT return or log a decrypted secret in any API response, error message, or log line. Credentials of a legacy storage version MUST NOT be used to create charges.

#### Scenario: Post-connection view exposes no secret

- GIVEN a connected account
- WHEN the therapist views their connection status
- THEN they see provider, commerce name, connection date, and key fingerprint, and never the raw `apiKey`/`secretKey`

### Requirement: Self-Service Disconnection

The system MUST let a therapist disconnect a `CONNECTED` account on demand (responding `404` when none is connected). Disconnection MUST delete the stored encrypted credentials, record a `PAYMENT_ACCOUNT_DISCONNECTED` audit entry, stop automatic charge creation for consultations created afterward, and MUST NOT alter charges already created before disconnection.

#### Scenario: Disconnecting stops future automatic charges only

- GIVEN a therapist with a `CONNECTED` account and an existing pending charge
- WHEN the therapist disconnects
- THEN the account status becomes `DISCONNECTED`, the stored credentials are deleted, the existing pending charge is untouched, and no new consultation for that therapist gets an automatic charge until they reconnect

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

- Whether the wizard preserves client-side (not persisted server-side) progress, such as the pasted-but-unconfirmed keys or which step the therapist was on, across a page reload or session end is not defined. This spec only guarantees no server-side persistence occurs before final confirmation.
