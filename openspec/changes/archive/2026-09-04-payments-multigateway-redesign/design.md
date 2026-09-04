# Design: Payments Multi-Gateway Redesign — Therapist-Owned Accounts

## Technical Approach

Credentials become **per-therapist data**, not process env. The `PaymentGatewayClient` port turns stateless: every method takes a resolved `GatewayCredentials` argument, so NestJS singletons survive untouched and a second provider is a new adapter plus one registry entry. `PaymentAccountService` stays the only owner of `PaymentAccount` and the only decryption point; `PaymentsService` asks it for a *gateway context* instead of reading `merchantId` from Prisma.

## Component Responsibilities

| Component | Responsibility after the change |
|---|---|
| `PaymentAccountService` | Sole owner of `PaymentAccount` R/W. Validates, encrypts, persists, disconnects. **Only** caller of `credentialCrypto.decrypt`. Exposes `resolveGatewayContext(therapistId)`. |
| `PaymentGatewayRegistry` (new) | Maps `PaymentProvider` → adapter singleton. Unknown provider → `PaymentGatewayError('credentials')`. |
| `PaymentGatewayClient` (port) | Stateless. Credentials in, no ambient config. |
| `FlowPaymentGatewayClient` | Signs each call with the passed keys. No `createMerchant`. No `FLOW_API_KEY`/`FLOW_SECRET_KEY` env reads. |
| `PaymentsService` | Charge lifecycle. Never touches `paymentAccount` rows or ciphertext; consumes a context or `null`. |
| `PaymentsController` | Wizard endpoints + webhook. Never returns secrets or ciphertext. |

## Decision 1 — Credential validation probe

**Choice**: `GET /payment/getStatus` signed with the pasted keys, using a deliberately non-existent sentinel token. Flow authenticates the signature *before* resolving the token, so the error taxonomy the adapter already implements separates the cases: `401/403` → invalid credentials; `400/404` (token not found) → **credentials valid**; `5xx`/network → transient, persist nothing.

| Option | Cost | Latency | Trace in therapist's Flow dashboard | Verdict |
|---|---|---|---|---|
| Sentinel-token `getStatus` | 0 | 1 round trip | none | **Chosen** |
| Minimum-amount order + cancel | non-zero, real order row | 2+ round trips | permanent order in dashboard | Rejected |
| `/customer/list` read | 0 | 1 round trip | none | Rejected |

**Rationale**: it exercises the exact `/payment/*` endpoint family and signing path production charging uses, so a pass predicts `createOrder` will authenticate. `/customer/list` probes an API we never call and can false-negative on accounts without that module — a false negative blocks a legitimate therapist, the worst outcome for a wizard. Order-and-cancel leaves a permanent artifact in someone else's commercial dashboard; Flow has no void for unpaid orders (they expire), so it is not reversible.

**Consequence**: the probe returns no commerce name. `validateCredentials` returns `accountLabel?` — populated when a Flow response exposes it, otherwise the confirmation step shows provider + masked apiKey + `keyFingerprint` + a therapist-typed label. Validation never blocks on the label.

## Decision 2 — Where decryption happens

**Choice**: `PaymentAccountService.resolveGatewayContext(therapistId): Promise<GatewayContext | null>`. Returns `null` for any status other than `CONNECTED` (missing / `PENDING` / `DISCONNECTED` / `RECONNECT_REQUIRED`), which reuses the existing "no order, charge stays PENDING" degradation path unchanged. `GatewayCredentials` overrides `toJSON()` and `util.inspect.custom` to `'[redacted]'` so it cannot leak through log interpolation or serialized error context.

**Alternatives rejected**: adapter fetches credentials itself (spreads decryption into the gateway layer, couples adapters to Prisma); per-therapist client instances (breaks the singleton DI pattern, unbounded instance churn).

**Dependency direction**: `PaymentsService → PaymentAccountService` (read-only). No cycle — `PaymentAccountService` never imports `PaymentsService`. The reconciliation sweep resolves per payment, memoized in a `Map` local to one run and discarded at the end; no long-lived plaintext cache.

## Sequences — before vs after

**Connect account — before**
```
POST /payments/account {name,email,rut} → onboard()
  → gateway.createMerchant(env keys) → Flow /merchant/create
  → encrypt({merchantId}) → upsert CONNECTED + plaintext merchantId
```

**Connect account — after** (two endpoints, nothing persisted until step 2)
```
1. POST /payments/account/validate {apiKey,secretKey}
     → PaymentAccountService.validate()
     → registry.get(FLOW).validateCredentials(creds)  → Flow sentinel probe
     → { accountLabel?, keyFingerprint }               [NO write]
2. POST /payments/account {apiKey,secretKey,displayName?}
     → re-validate (same probe)  → on failure: write lastError only
     → credentialCrypto.encrypt({apiKey,secretKey}), credentialVersion=2
     → upsert CONNECTED + displayName + keyFingerprint + connectedAt
```

**Charge a session — before**
```
ensureCharge → prisma.paymentAccount (status===CONNECTED)
  → issueOrder(account.merchantId) → gateway.createOrder({merchantId,...}) [env keys]
```

**Charge a session — after**
```
ensureCharge → accountService.resolveGatewayContext(therapistId)
  → null? create charge, skip order (unchanged degradation)
  → decrypt v2 blob → GatewayContext{provider, credentials}
  → issueOrder(ctx) → registry.get(ctx.provider).createOrder(ctx.credentials, input)
```

**Webhook — after** (invariant relaxed, deliberately)
```
POST /payments/confirm {token,s}
  → payment.findUnique({gatewayToken:token})   [read-only, no mutation]
  → unknown token → 400, no decryption
  → resolveGatewayContext(payment.therapistId)
  → verifyCallbackSignature(creds, {token,s}) → 400 on mismatch (same uniform message)
  → paymentsService.confirm(token)
```
Flow signs callbacks with the *merchant's* secret, so a global secret is impossible and one indexed read must precede verification. The preserved property becomes: **no state is mutated and no mail is sent before the signature verifies**. Rejected alternative: embedding `therapistId` in `confirmUrl` — it publishes therapist ids and lets an attacker choose which credential gets decrypted.

## Port contract

```ts
export interface GatewayCredentials {           // built ONLY by PaymentAccountService
  readonly apiKey: string;
  readonly secretKey: string;
  toJSON(): '[redacted]';
}
export interface GatewayContext { provider: PaymentProvider; credentials: GatewayCredentials }
export interface CredentialValidation { accountLabel?: string; keyFingerprint: string }
export interface OrderInput {                    // merchantId REMOVED
  amount: number; currency: string; subject: string;
  externalId: string; returnUrl: string; confirmUrl: string;
}

export abstract class PaymentGatewayClient {
  abstract readonly provider: PaymentProvider;
  abstract validateCredentials(c: GatewayCredentials): Promise<CredentialValidation>;
  abstract createOrder(c: GatewayCredentials, i: OrderInput): Promise<{ token: string; paymentUrl: string }>;
  abstract getOrderStatus(c: GatewayCredentials, token: string): Promise<{ status: GatewayOrderStatus; gatewayPaymentId?: string }>;
  abstract verifyCallbackSignature(c: GatewayCredentials, params: Record<string, string>): boolean;
}
```
Deleted: `createMerchant`, `MerchantInput`, `UnconfiguredPaymentGatewayClient` (obsolete — there is no ambient credential left to be missing).

## Decision 3 — Prisma migration

Two migration files, because Postgres forbids *using* an enum value in the transaction that added it.

| Step | Operation | Notes |
|---|---|---|
| M1 | `ALTER TYPE "PaymentAccountStatus" ADD VALUE 'RECONNECT_REQUIRED'` | Old code neither writes nor reads it — safe to deploy alone. |
| M1 | Add nullable `displayName`, `keyFingerprint`; add `credentialVersion Int @default(1)` | `1` = legacy `{merchantId}`, `2` = `{apiKey,secretKey}`. Explicit shape discriminator, never guessing the blob. |
| — | **Deploy new backend + frontend** | Must precede M2: an old Prisma client throws when reading an unknown enum value. |
| M2 | `UPDATE "PaymentAccount" SET status='RECONNECT_REQUIRED', "credentialEncrypted"=NULL, "lastError"='<reconnect notice>' WHERE status='CONNECTED'` | Rows are marked, never deleted. |

`connectedAt` and plaintext `merchantId` are preserved for audit and rollback (the legacy blob is `{merchantId}`, reconstructible from the surviving column). `merchantId` and `credentialVersion` are marked deprecated in schema comments and dropped in a follow-up migration once no `RECONNECT_REQUIRED` / v1 row remains. `FLOW_API_KEY` and `FLOW_SECRET_KEY` leave `env.validation.ts`; `FLOW_API_BASE_URL`, `FRONTEND_URL`, `BACKEND_PUBLIC_URL`, `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` stay. Rollback = disable the payments flag, revert code, revert M2/M1.

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/prisma/schema.prisma` | Modify | New status, `displayName`, `keyFingerprint`, `credentialVersion`; deprecate `merchantId` |
| `backend/prisma/migrations/*` | Create | M1 (schema) and M2 (data), separate |
| `backend/src/modules/payments/payment-gateway.client.ts` | Modify | Port above; delete merchant types + unconfigured client |
| `backend/src/modules/payments/payment-gateway.registry.ts` | Create | Provider → adapter singleton lookup |
| `backend/src/modules/payments/flow-gateway.client.ts` | Modify | Per-call signing, `validateCredentials`, drop `createMerchant`/`assertConfigured` |
| `backend/src/modules/payments/payment-account.service.ts` | Modify | `validate`/`connect`/`resolveGatewayContext` replace `onboard` |
| `backend/src/modules/payments/payments.service.ts` | Modify | `issueOrder(ctx)`, context-based `getOrderStatus`, sweep memoization |
| `backend/src/modules/payments/payments.controller.ts` | Modify | `POST /account/validate`; webhook resolves context before verifying |
| `backend/src/modules/payments/dto/*.dto.ts` | Create/Delete | `ValidateCredentialsDto`, `ConnectAccountDto` replace `OnboardPaymentAccountDto` |
| `backend/src/modules/payments/payments.module.ts` | Modify | Register registry + adapters |
| `backend/src/config/env.validation.ts` | Modify | Drop `FLOW_API_KEY`/`FLOW_SECRET_KEY` |
| `frontend/src/hooks/usePaymentAccount.ts` | Modify | New status union, `useValidateCredentials`, `useConnectPaymentAccount` |
| `frontend/src/pages/PaymentsPage.tsx` | Modify | 5-step wizard replaces the disabled notice; reconnect banner |

## Secret-Handling Invariants

| Invariant | Enforcement |
|---|---|
| Only `PaymentAccountService` decrypts | Single call site; `credentialCrypto` injected nowhere else |
| Secrets never serialized | `GatewayCredentials.toJSON()` / inspect → `'[redacted]'` |
| Secrets never returned by HTTP | Status view exposes only status, provider, `displayName`, `keyFingerprint`, `connectedAt`, `lastError` |
| Flow error bodies never echoed raw to the therapist | Adapter logs the body; controller maps to an actionable message |
| Invalid credentials never persisted | Validation precedes every write of `credentialEncrypted` |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Probe taxonomy (401/403 vs 400/404 vs 5xx); signing with passed keys; credential redaction on `JSON.stringify` | Jest + mocked `fetch` |
| Unit | `resolveGatewayContext` returns `null` for each non-`CONNECTED` status | Prisma mock |
| Integration | Validate rejects without writing; connect persists v2 blob; webhook 400 on unknown token *before* any mutation | Nest testing module + test DB |
| Integration | `ensureCharge` on a `RECONNECT_REQUIRED` account creates the charge and no order | Test DB |
| E2E | Wizard happy path and invalid-key path | Existing frontend e2e harness |

## Threat Matrix

N/A — no routing-of-commands, shell, subprocess, VCS/PR automation, or executable-file classification boundary. The change adds HTTP endpoints only; its real adversarial surface is credential handling, covered by the Secret-Handling Invariants table, which carries into `tasks.md` unchanged.

## Open Questions

- [ ] Confirm against a real Flow sandbox that `/payment/getStatus` with an unknown token returns `400/404` (not `401`) for **valid** credentials. If the taxonomy is ambiguous, fall back to `/customer/list` as the probe.
- [ ] Confirm whether any Flow response exposes the commerce name; if not, `accountLabel` stays therapist-typed and the success criterion reads "connection confirmed" instead of "commerce name confirmed".
