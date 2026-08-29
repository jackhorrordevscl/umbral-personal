# Tasks: Online Payment Integration (charge-on-scheduling, split per therapist)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | PR1 ~380 · PR2 ~390 · PR3 ~390 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main (each PR merges to `main` before the next starts, per `session-calendar-view` precedent) |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Schema + `PaymentsService` charge lifecycle (gated, inert behind flag), gateway port stubbed | PR1 | `cd backend && npx jest src/modules/payments src/modules/consultations` | `PAYMENTS_ENABLED=false` — scheduling behaves exactly as without payments | Revert additive migration + `payments/` module + `emitPaymentCharge` call sites; consultations flow unaffected |
| 2 | `FlowPaymentGatewayClient`, onboarding endpoints, public `/payments/confirm` + signature verification, `@Cron sweep` (transition + reconcile only) | PR2 | `cd backend && npx jest src/modules/payments` | `npx jest --config test/jest-e2e.json payments.e2e-spec.ts` | Revert `flow-gateway.client.ts`, `payment-account.service.ts`, controller routes, and the cron; PR1 charge lifecycle untouched |
| 3 | Mail templates, `PAYMENT_LATE` notify wiring, `PaymentsPage`, badge, amount surfaces, RAT row | PR3 | `cd frontend && npm test -- --run` && `cd backend && npx jest src/modules/mail src/modules/payments` | Manual: onboard merchant, schedule session, verify link email + badge; force a `LATE` tick | Revert frontend files + mail methods + notify call sites; PR1/PR2 charge/checkout flow unaffected |

## Phase 1: Foundation — Schema, Config, Gateway Port (PR1)

- [x] 1.1 `backend/prisma/schema.prisma`: `Payment` model — `@@unique([groupId])`, `amount Int` snapshot, `dueDate`, `gatewayToken`/`gatewayPaymentId`/`paymentUrl`, `linkDelivery`, `lateNotifiedAt`, `paidAt`/`cancelledAt`, indexes `[status, dueDate]`/`[therapistId]`.
- [x] 1.2 `schema.prisma`: `PaymentAccount` model — `therapistId @unique`, `provider`, `status`, `merchantId`, `credentialEncrypted Bytes?`, `connectedAt`.
- [x] 1.3 `schema.prisma`: enums `PaymentStatus`, `PaymentLinkDelivery`, `PaymentProvider`, `PaymentAccountStatus`; add `NotificationType.PAYMENT_LATE`; `Patient.defaultSessionAmount Int?`.
- [x] 1.4 Migration `backend/prisma/migrations/*_payments/`: additive only, run against `DIRECT_URL`.
- [x] 1.5 Create `payments/payments.constants.ts`: `SWEEP_BATCH_LIMIT = 200`, `RECONCILE_MIN_AGE_MS`, `PAYMENT_RETURN_PATH = '/payments'`.
- [x] 1.6 `backend/src/config/env.validation.ts`: `PAYMENTS_ENABLED` exactly `"true"`/`"false"`; 32-byte `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` required in production.
- [x] 1.7 `.env.example`, `README.md`: add Flow credential vars, `PAYMENTS_ENABLED=false` default. **PARTIAL**: `README.md` done; `.env.example` blocked — the sandbox's file-permission policy denies Read/Bash/Write access to any `backend/.env*` path (glob-level deny, unrelated to secrets actually present). Orchestrator/user must add `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`/`PAYMENTS_ENABLED` to `.env.example` manually (values mirror the README block added by this PR).
- [x] 1.8 Create `payments/payment-gateway.client.ts`: abstract `PaymentGatewayClient` port (`createMerchant`/`createOrder`/`getOrderStatus`/`verifyCallbackSignature`) + `PaymentGatewayError` kinds (`transient`/`rejected`/`credentials`). Also adds `UnconfiguredPaymentGatewayClient`, the PR1 default DI binding (rejects every call with kind `credentials`) — see Deviations in apply-progress.

## Phase 2: Charge Lifecycle Core (PR1)

- [x] 2.1 Create `payments/payments.module.ts`: imports `ConfigModule`, `MailModule`, `NotificationsModule`; exports `PaymentsService`; no `consultations`/`patients` import.
- [x] 2.2 Create `payments/payments.service.ts`: `ensureCharge(groupId)` — gated by `PAYMENTS_ENABLED`, connected account, resolvable amount; upsert `{PENDING, amount snapshot, dueDate=sessionDate}`.
- [x] 2.3 `payments.service.ts`: `updateAmount(groupId, amount)` for the future per-session override endpoint (PR2) — updates the same row, never creates a second charge; due-date movement on `correct()`/reschedule is handled inside `ensureCharge` itself (see Deviations).
- [x] 2.4 `payments.service.ts`: `cancelUnpaid(groupId)` — cancels a pending/late charge on soft-delete, preserves a `PAID` charge untouched.
- [x] 2.5 `backend/src/modules/consultations/consultations.service.ts`: `emitPaymentCharge(groupId)` fire-and-forget after `create()`/`correct()` tx commit, same shape as `emitCalendarSync` (consultations.service.ts:62), `.catch(log)`.
- [x] 2.6 `consultations/consultations.module.ts`: import `PaymentsModule`.
- [x] 2.7 `patients/dto/{create,update}-patient.dto.ts`: `defaultSessionAmount?: number` (`@IsInt`, `@Min(0)`).
- [x] 2.8 `backend/src/app.module.ts`: register `PaymentsModule`.

## Phase 3: PR1 Testing

- [x] 3.1 RED unit `payments.service.spec.ts`: no `PaymentAccount` / `PAYMENTS_ENABLED=false` / `defaultSessionAmount=null` → no charge, no email, table-driven.
- [x] 3.2 GREEN: implement the gating checks in `ensureCharge`.
- [x] 3.3 RED unit: session override precedence over `Patient.defaultSessionAmount`; a later default-amount edit does not affect an existing charge.
- [x] 3.4 GREEN: implement amount resolution + snapshot.
- [x] 3.5 RED integration: `correct()` updates the **same** `Payment` row and moves `dueDate`; never creates a second charge (real Prisma, mocked gateway).
- [x] 3.6 GREEN: implement upsert-by-`groupId`.
- [x] 3.7 RED integration: gateway stub throwing on every call → `POST /consultations` still returns 201 with the clinical row intact (mirrors `consultations.service.integration.spec.ts` calendar case).
- [x] 3.8 GREEN: confirm `emitPaymentCharge` is never `await`ed inside the write's critical path.
- [x] 3.9 RED integration: amount snapshot survives a later `defaultSessionAmount` change (real Prisma).
- [x] 3.10 Test: no Flow credentials + `PAYMENTS_ENABLED=false` → module registers, `logger.warn`, no-op boot (mirrors `MailService` without `RESEND_API_KEY`).

## Phase 4: Flow Gateway Client (PR2)

- [x] 4.1 Create `payments/flow-gateway.client.ts`: HMAC-SHA256 request signing, native `fetch`, `createMerchant` → `/merchant/create`.
- [x] 4.2 `flow-gateway.client.ts`: `createOrder` → `payment/create`; resolve the merchant-attribution parameter against the Flow sandbox.
- [x] 4.3 `flow-gateway.client.ts`: `getOrderStatus` → `payment/getStatus`, maps to `GatewayOrderStatus`.
- [x] 4.4 `flow-gateway.client.ts`: `verifyCallbackSignature` — HMAC-SHA256 over received params via `crypto.timingSafeEqual`.
- [x] 4.5 `payments.module.ts`: provide `FlowPaymentGatewayClient` as the `PaymentGatewayClient` implementation.

## Phase 5: Onboarding + Confirmation Controller (PR2)

- [x] 5.1 Create `payments/payment-account.service.ts`: `onboard(therapistId, input)` — `gateway.createMerchant`, encrypts credential via `common/crypto/aes-gcm.ts` under `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`.
- [x] 5.2 `payment-account.service.ts`: `status(therapistId)` — never returns the credential.
- [x] 5.3 `payment-account.service.ts`: `disconnect(therapistId)` — existing charges untouched.
- [x] 5.4 Create `payments/payments.controller.ts`: `GET/POST/DELETE /payments/account` (`JwtAuthGuard`).
- [x] 5.5 `payments.controller.ts`: `PATCH /payments/:groupId` (`JwtAuthGuard`) — per-session amount override while `PENDING`, re-issues order + link; never wired into the clinical "Corregir sesión" modal.
- [x] 5.6 `payments.controller.ts`: `POST /payments/confirm` (no guard) — verify signature via `timingSafeEqual`, reject before any DB read with 400.
- [x] 5.7 `payments.service.ts`: `confirm(token)` — re-fetch authoritative status via `getOrderStatus`, idempotent `updateMany({status in [PENDING,LATE]} → PAID)`, keyed by the stored token.

## Phase 6: Cron Sweep — Transition + Reconcile (PR2)

- [x] 6.1 `payments.service.ts`: `@Cron(EVERY_30_MINUTES) sweep()` pass 1 — count-gated `updateMany({status:PENDING, dueDate:{lte:now}} → LATE)`.
- [x] 6.2 `payments.service.ts`: `sweep()` pass 2 — `PENDING|LATE` with token issued `> RECONCILE_MIN_AGE_MS` ago → `getOrderStatus` reconcile, batched at `SWEEP_BATCH_LIMIT`.
- [x] 6.3 `payments.service.ts`: reschedule-to-future re-arm — inverse gated update `LATE → PENDING`, clears `lateNotifiedAt` when `dueDate` moves forward.

## Phase 7: PR2 Testing

- [x] 7.1 RED unit: signature verification — valid, tampered param, missing `s`, wrong key, extra param — all rejected before any DB call; assert Prisma mock untouched.
- [x] 7.2 GREEN: implement `verifyCallbackSignature`.
- [x] 7.3 RED unit: replayed `confirm` affects 0 rows; `PAID → PAID` no-op; `CANCELLED` never becomes `PAID`.
- [x] 7.4 GREEN: implement `confirm()` idempotent `updateMany`.
- [x] 7.5 RED unit: `sweep()` pass-1 transition is count-gated — a second tick on an already-`LATE` row affects 0 rows.
- [x] 7.6 GREEN: confirm the `updateMany` where-clause excludes non-`PENDING` rows.
- [x] 7.7 RED E2E `payments.e2e-spec.ts`: **tenancy** — therapist B cannot read, patch, or disconnect therapist A's payment account or charge; uniform 404, never 403-with-leak.
- [x] 7.8 GREEN: scope every guarded route by `therapistId` from `@CurrentUser()`.
- [x] 7.9 RED E2E: forged/unsigned `POST /payments/confirm` never mutates a `Payment` (public route = primary attack surface).
- [x] 7.10 GREEN: reject unsigned/invalid/oversized bodies with 400 before any DB read.

## Phase 8: Mail + Late-Payment Notify Wiring (PR3)

- [x] 8.1 `backend/src/modules/mail/mail.service.ts`: `sendPaymentLinkEmail(patient, paymentUrl, amount)` — never-throws contract (mail.service.ts:166).
- [x] 8.2 `mail.service.ts`: `sendLatePaymentEmail(patient, payment)` — never-throws contract.
- [x] 8.3 `payments.service.ts`: `ensureCharge` — after order + link creation, call `sendPaymentLinkEmail`, set `linkDelivery = SENT|SKIPPED_NO_EMAIL|FAILED`.
- [x] 8.4 `payments.service.ts`: `sweep()` pass 1 — on the winning `PENDING → LATE` transition, call `sendLatePaymentEmail` + `NotificationsService.create(PAYMENT_LATE)`, gated by the same `updateMany` count.

## Phase 9: Frontend Surfaces (PR3)

- [x] 9.1 Create `frontend/src/hooks/usePaymentAccount.ts`: `queryKey: ['payment-account']`, wraps `GET/POST/DELETE /payments/account` (matches `useProfile` pattern).
- [x] 9.2 Create `frontend/src/pages/PaymentsPage.tsx`: merchant onboarding form + account status.
- [x] 9.3 `frontend/src/App.tsx`: `/payments` route.
- [x] 9.4 `frontend/src/components/Layout.tsx`: navLinks 7 → 8, `Pagos` (`CreditCard`), order Dashboard/Pacientes/Consultas/Calendario/Repositorio/Pagos/Perfil/Seguridad.
- [x] 9.5 Create `frontend/src/components/payments/PaymentStatusBadge.tsx`: inserted into the chip row after `sessionType` (ConsultationsPage.tsx:318).
- [x] 9.6 `frontend/src/pages/ConsultationsPage.tsx`: resolve payment by `groupId` from the range/patient response; render badge + copy-link control; amount control kept out of the "Corregir sesión" modal.
- [x] 9.7 `frontend/src/pages/PatientsPage.tsx` + `types/*.ts`: `defaultSessionAmount` field on the patient form.
- [x] 9.8 `docs/registro-actividades-tratamiento.md`: add Flow as a processor row.

## Phase 10: PR3 Testing

- [x] 10.1 RED unit `mail.service.spec.ts`: patient without email → `SKIPPED_NO_EMAIL`, charge stays `PENDING`, no throw.
- [x] 10.2 GREEN: implement the never-throws `SKIPPED_NO_EMAIL` path.
- [x] 10.3 RED unit: `sweep()` notifies exactly once on `PENDING → LATE`; a second tick emits none; reschedule-to-future re-arms (fake clock, mocked Prisma).
- [x] 10.4 GREEN: gate notify on the winning transition; clear `lateNotifiedAt` on re-arm.
- [x] 10.5 Unit (FE) `PaymentStatusBadge.spec.tsx`: renders each status + `SKIPPED_NO_EMAIL`; absent when there is no charge.
- [x] 10.6 Unit (FE) `ConsultationsPage.spec.tsx`: amount control is not present in the "Corregir sesión" modal.
- [x] 10.7 Full backend suite green (`cd backend && npx jest`); full e2e suite green (`npx jest --config test/jest-e2e.json`).

## Out of Scope (do not create tasks)

- Payment-reminder cron/dispatch cadence beyond the one-shot late alert (future change).
- Boleta/factura electrónica SII integration (future change).
- Refund flow.
- `ConsentPurpose` schema change for Ley 21.719 (open question, not a task — see design.md Open Questions).
