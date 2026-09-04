# Tasks: Payments Multi-Gateway Redesign — Therapist-Owned Accounts

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900-1300 (schema+migrations, port rewrite, adapter, service, controller, DTOs, wizard UI, tests) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Stateless port + registry + Flow adapter (validate/sign per-call) | PR 1 | `npm run test -- flow-gateway payment-gateway.registry` (backend) | N/A — pure unit tests, no live Flow call | Revert 3 new/modified files; port unused until Unit 2 wires it |
| 2 | Schema (M1) + `PaymentAccountService` validate/connect/resolveGatewayContext | PR 2 | `npm run test -- payment-account.service` (backend) | Nest test module + test DB (integration suite) | Revert service + migration M1; enum addition alone is backward-safe |
| 3 | Controller/DTOs wiring + `PaymentsService` context-based charge/webhook + M2 data migration | PR 3 | `npm run test:e2e -- payments` (backend) | Test DB with seeded legacy `CONNECTED` row | Revert controller/DTO/service; M2 must ship only after PR2 backend is live |
| 4 | Frontend 5-step wizard + reconnect banner | PR 4 | `npm run test -- usePaymentAccount PaymentsPage` (frontend) | Existing frontend e2e harness (wizard happy-path + invalid-key path) | Revert wizard components/hook; disabled-notice fallback stays until merge |

## Phase 1: Port & Adapter Foundation (Unit 1)

- [x] 1.1 Rewrite `backend/src/modules/payments/payment-gateway.client.ts`: stateless `PaymentGatewayClient` per design Port contract; delete `createMerchant`, `MerchantInput`, `UnconfiguredPaymentGatewayClient`
- [x] 1.2 Add `GatewayCredentials`/`GatewayContext`/`CredentialValidation` types with `toJSON()`/inspect redaction
- [x] 1.3 Create `backend/src/modules/payments/payment-gateway.registry.ts`: provider → adapter singleton, unknown provider throws `PaymentGatewayError('credentials')`
- [x] 1.4 Rewrite `backend/src/modules/payments/flow-gateway.client.ts`: sign every call with passed keys, implement `validateCredentials` via sentinel-token `getStatus` probe (401/403 invalid, 400/404 valid, 5xx transient), drop `createMerchant`/`assertConfigured`/env key reads
- [x] 1.5 Test: probe taxonomy (401/403 vs 400/404 vs 5xx) per Requirement "Guided Connection Wizard" — spec `payment-gateway-connection`
- [x] 1.6 Test: `JSON.stringify(credentials)` and log interpolation both redact secrets — spec "Encrypted Credential Storage"

## Phase 2: Persistence & Account Service (Unit 2)

- [x] 2.1 Migration M1: add `RECONNECT_REQUIRED` enum value, nullable `displayName`/`keyFingerprint`, `credentialVersion Int @default(1)` to `backend/prisma/schema.prisma`
- [x] 2.2 Rewrite `payment-account.service.ts`: `validate()` (no write), `connect()` (re-validate then encrypt+persist v2), `resolveGatewayContext()` returns `null` for non-`CONNECTED`, `disconnect()`
- [x] 2.3 Test: malformed credentials rejected without calling Flow — spec scenario "Malformed credentials are rejected before calling Flow"
- [x] 2.4 Test: `resolveGatewayContext` returns `null` for `PENDING`/`DISCONNECTED`/`RECONNECT_REQUIRED`
- [x] 2.5 Test: validate writes nothing on failure; connect persists v2 blob only after live validation — spec "Abandoning the Wizard Persists Nothing"

## Phase 3: Charge Flow, API & Legacy Migration (Unit 3)

- [x] 3.1 Create `dto/validate-credentials.dto.ts` and `dto/connect-account.dto.ts`; delete `onboard-payment-account.dto.ts`
- [x] 3.2 Update `payments.controller.ts`: `POST /account/validate`, updated `POST /account`, webhook resolves context before verifying signature (read-only lookup precedes decryption)
- [x] 3.3 Update `payments.service.ts`: `issueOrder(ctx)`, context-based `getOrderStatus`, sweep memoization in a run-scoped `Map`
- [x] 3.4 Update `payments.module.ts` to register registry + Flow adapter
- [x] 3.5 Migration M2 (separate deploy step, after new backend is live): flip legacy `CONNECTED` rows to `RECONNECT_REQUIRED`, null `credentialEncrypted`, set `lastError`
- [x] 3.6 Remove `FLOW_API_KEY`/`FLOW_SECRET_KEY` from `backend/src/config/env.validation.ts`
- [x] 3.7 Test: webhook returns 400 on unknown token with no mutation before signature check — spec "Checkout is unavailable if the owning account is no longer connected"
- [x] 3.8 Test: `ensureCharge` on `RECONNECT_REQUIRED`/`DISCONNECTED` creates consultation, no `Payment` row — spec "Automatic Charge Creation Gated by Gateway Connection"
- [x] 3.9 Test: disconnect stops future charges, leaves existing pending charge untouched — spec "Self-Service Disconnection"

## Phase 4: Frontend Wizard (Unit 4)

- [x] 4.1 Update `frontend/src/hooks/usePaymentAccount.ts`: new status union incl. `RECONNECT_REQUIRED`, `useValidateCredentials`, `useConnectPaymentAccount`
- [x] 4.2 Update `frontend/src/pages/PaymentsPage.tsx`: 5-step wizard (welcome → go to Flow → locate credentials → paste+validate → confirmation) replacing disabled notice; reconnect banner for `RECONNECT_REQUIRED`
- [x] 4.3 Test: paste step blocks obviously malformed input client-side without a network call
- [x] 4.4 Test: confirmation step renders returned commerce name or therapist-typed label per Decision 1 fallback
- [x] 4.5 E2E: wizard happy path and invalid-key path — spec "Flow rejects well-formed but invalid credentials"

## Phase 5: Cleanup

- [x] 5.1 Mark `merchantId`/`credentialVersion` deprecated in `schema.prisma` comments (follow-up migration drops them once no v1/`RECONNECT_REQUIRED` row remains)
- [x] 5.2 Update payments module docs/README references from "Comercio Integrador" to therapist-owned accounts
