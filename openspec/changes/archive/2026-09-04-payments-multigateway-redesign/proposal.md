# Proposal: Payments Multi-Gateway Redesign — Therapist-Owned Accounts

## Intent

Flow support confirmed the Comercio Integrador model does not split payments: all funds settle into Umbral's account (obs #1317). The shipped onboarding is therefore unimplementable and is currently disabled behind an "in progress" notice (commit de510da). Pivot to: each therapist connects **their own** Flow merchant account and collects 100% directly; Umbral never custodies funds and charges no commission. Flow offers no OAuth (obs #1324), so the friction must be solved by UX, not protocol.

## Scope

### In Scope
- New credential model on `PaymentAccount`: encrypted per-therapist `apiKey`/`secretKey`, removal of sub-merchant creation.
- Guided 5-step connection wizard with **live credential validation against Flow before persisting**.
- Invalidation + forced re-onboarding path for accounts already `CONNECTED` under the old model.
- Extensible gateway selection: evolve the existing `PaymentGatewayClient` port so a second provider is a new adapter, not a rewrite.
- Replace the temporary disabled-onboarding notice with the wizard.

### Out of Scope
- **Umbral→therapist monthly billing (fixed subscription fee) — a separate, later initiative.**
- Any second gateway implementation (e.g. Mercado Pago): abstraction only.
- Charge lifecycle, webhook verification, email delivery, reconciliation sweep — unchanged.
- Automatic migration of legacy accounts (technically impossible).

## Capabilities

### New Capabilities
- `payment-gateway-connection`: therapist self-service connection, live validation, credential storage, disconnect, and re-connection of invalidated accounts.

### Modified Capabilities
- `payments`: "Hosted Checkout via Flow Split Payments" becomes checkout executed with the therapist's own account credentials; charge gating references the new connection states.

## Approach

**Credentials.** `PaymentAccount` keeps status/ownership; `credentialEncrypted` stores `{apiKey, secretKey}` via the existing AES-GCM crypto service. Plaintext `merchantId` is retired in favour of non-secret display metadata (provider, Flow-returned commerce name, connected date, key fingerprint). Add a status meaning "must reconnect".

**Wizard.** Backend: a validate-only endpoint calls Flow with the pasted keys and returns the commerce name or an actionable error; connect re-validates then encrypts and persists. Frontend: welcome/checklist → go to Flow → locate credentials → paste + live validation → confirmation showing the returned commerce name.

**Legacy accounts.** Migration flips existing `CONNECTED` rows to the reconnect-required state; charge creation stops for them and the therapist sees an in-app notice explaining why.

**Port shape.** Drop `createMerchant`; add `validateCredentials`; every call takes an explicit resolved credentials argument so clients stay stateless singletons behind a provider registry. `PaymentAccountService` remains the only decryption owner and hands credentials to the payment flow.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/prisma/schema.prisma` | Modified | PaymentAccount fields + status enum, migration |
| `backend/src/modules/payments/payment-account.service.ts` | Modified | Validation/connect replace onboard |
| `backend/src/modules/payments/payment-gateway.client.ts` | Modified | Port: credentials arg, validateCredentials |
| `backend/src/modules/payments/flow-gateway.client.ts` | Modified | Per-therapist auth; drop createMerchant |
| `backend/src/modules/payments/payments.service.ts` | Modified | Credential resolution at boundary |
| `frontend/src/pages/PaymentsPage.tsx`, `hooks/usePaymentAccount.ts` | Modified | Wizard replaces disabled form |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Secret leakage via logs/errors/API responses | Med | Never return or log secrets; redact Flow errors; fingerprint only |
| Decryption spreads outside PaymentAccountService | Med | Single resolver at the service boundary; enforced in design/spec |
| Copy-paste friction causes abandonment | High | Live validation, actionable errors, resumable wizard |
| Legacy therapists silently lose charge creation | Med | Explicit reconnect state + in-app notice before any silent gap |
| Flow lacks a cheap validation call | Med | Design phase picks a safe read-only call; fall back to a minimal probe |
| Abstraction over-fit to Flow | Low | Port reviewed against a hypothetical second adapter |

## Rollback Plan

Keep the whole flow behind the existing payments feature flag. Rollback = disable the flag (restoring the current notice), revert the frontend wizard, and revert the Prisma migration; legacy rows are marked, not deleted, so the prior status is restorable.

## Dependencies

- Therapists must hold their own Flow production merchant account.
- Optional, non-blocking: confirm with Flow Commercial whether an undocumented partner program exists.

## Success Criteria

- [ ] A non-technical therapist completes the wizard unaided and sees their Flow commerce name confirmed.
- [ ] Invalid credentials are rejected before persistence with an actionable message.
- [ ] A charge settles 100% into the therapist's own Flow account; Umbral holds no funds.
- [ ] Legacy `CONNECTED` accounts are flagged for reconnection with no silent charge failures.
- [ ] Adding a second gateway requires only a new adapter plus registry entry.

## Issue Classification Check

#109 stays obsolete (already closed). #107/#108/#110/#111/#113/#114/#115/#118 remain valid: they target the surviving charge lifecycle. Caveat: any of them asserting split-payment or sub-merchant semantics must be re-read during the spec phase.
