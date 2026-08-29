# Design: Online Payment Integration (charge-on-scheduling, split per therapist)

## Technical Approach

A new `PaymentsModule` owns four concerns behind one service boundary: therapist merchant onboarding (`PaymentAccountService`), charge lifecycle (`PaymentsService`), a thin gateway client behind an abstract port (`PaymentGatewayClient` ← `FlowPaymentGatewayClient`), and a public confirmation controller. `ConsultationsService` emits charge intents fire-and-forget, byte-for-byte the same shape as `emitCalendarSync` (consultations.service.ts:62). A single `@Cron` sweep — same shape as `RemindersService.scan()` — owns both the `PENDING → LATE` transition and webhook reconciliation. Nothing in this module can fail a clinical write.

## Architecture Decisions

### Decision: `Payment` keyed on `groupId`, amount snapshotted at creation

| Option | Tradeoff | Decision |
|---|---|---|
| Key on `consultationId` | `correct()` creates a **new row** (consultations.service.ts:251) → every correction orphans the charge and a reschedule would create a second one | Rejected |
| Read amount live from `Patient.defaultSessionAmount` | A later price change retroactively rewrites an already-issued charge and an already-sent payment link | Rejected |
| **`@@unique([groupId])` + `amount` snapshot** ✅ | Correction-stable (`groupId` is invariant, schema.prisma:159), price history is immutable per charge with no pricing table | **Chosen** |

`amount` is `Int`, not `Decimal`: CLP is a zero-decimal currency and Flow expects an integer amount. `currency` stays a column (default `"CLP"`) so a decimal currency later migrates to minor units rather than changing type semantics.

### Decision: `PENDING → LATE` is a stored transition, not a computed status

| Option | Tradeoff | Decision |
|---|---|---|
| Derived at read time (`dueDate < now && PENDING`) | Zero write cost — but there is **no transition event**. The business rule is "notify once on the transition, not per check", and a read cannot send email. A charge nobody reads never notifies at all | Rejected |
| **`@Cron` sweep + count-gated `updateMany`** ✅ | The transition is an observable event exactly once; the row is queryable by `status`/`dueDate` | **Chosen** |

The one-shot guarantee is the affected-row count, not application logic — the precedent already in this repo is the `invalid_grant` disconnect (`updateMany({ where: { id, status: CONNECTED } })`, calendar-sync). Here: `updateMany({ where: { id, status: PENDING, dueDate: { lte: now } }, data: { status: LATE } })`; `count === 1` wins and notifies, `count === 0` is a no-op. No `ReminderDispatch`-style claim table is needed — the `Payment` row **is** the claim.

**Assumption this makes for the deferred reminder change**: it will query `Payment where status = LATE` and drive cadence off `dueDate`, and it will need its own claim rows (a `ReminderDispatch`-shaped table) because *this* design consumes the single transition for the single late notice. A reschedule back into the future runs the inverse gated update (`LATE → PENDING`, clearing `lateNotifiedAt`), so re-arming is legal and a genuinely new late event notifies again.

### Decision: The confirmation callback is a signal, never a source of truth

**Choice**: `POST /payments/confirm` (public, no `JwtAuthGuard` — Flow's server posts here) verifies the HMAC-SHA256 signature over the received parameters with `crypto.timingSafeEqual`, rejects unsigned/invalid/oversized bodies with 400 **before any DB read**, and then discards the body's status entirely: it re-fetches authoritative status from the gateway with our own signed request, keyed by the token we stored at charge creation.
**Alternatives considered**: trusting the posted status after signature verification (rejected — this is 100% greenfield crypto in this codebase; a single subtle signing-string mistake becomes forged `PAID`. Re-fetching means a forged callback's worst case is a wasted outbound request); no signature check, relying only on re-fetch (rejected — an unauthenticated endpoint that triggers outbound calls per request is a free amplification surface).
**Rationale**: two independent gates, and the security of the money-moving state change rests on the *outbound* signed request, which is the same code path onboarding already exercises — not on freshly written inbound verification.

Idempotency is the same count gate: `updateMany({ where: { id, status: { in: [PENDING, LATE] } }, data: { status: PAID, paidAt, gatewayPaymentId } })`. A replayed callback affects 0 rows and changes nothing.

### Decision: One `PaymentGatewayClient` port; the merchant-attribution parameter is an implementation detail

Public Flow docs confirm `/merchant/create` and HMAC-SHA256 request signing, but not the exact parameter that attributes a `payment/create` call to an associated merchant. The port confines that unknown to one file:

```ts
export abstract class PaymentGatewayClient {
  abstract createMerchant(i: MerchantInput): Promise<{ merchantId: string }>;
  abstract createOrder(i: OrderInput): Promise<{ token: string; paymentUrl: string }>;
  abstract getOrderStatus(token: string): Promise<{ status: GatewayOrderStatus; gatewayPaymentId?: string }>;
  abstract verifyCallbackSignature(params: Record<string, string>): boolean;
}
// OrderInput carries merchantId; how it is serialized onto the wire is the adapter's problem.
```

`PaymentsService` never sees a Flow field name. Resolving the attribution parameter against Flow's sandbox is a task-level implementation detail, not a redesign. Same rationale rejects the alternative of inlining Flow calls into the service (proposal already names MercadoPago as a plausible second gateway).

### Decision: Therapist payment account is its own page, not a SecurityPage panel

| Option | Tradeoff | Decision |
|---|---|---|
| Panel in `SecurityPage.tsx` next to Google Calendar | Zero new nav surface — but onboarding collects billing identity (RUT, payout data), which is not account security, and `SecurityPage` is already the heaviest page after the `SettingsPage` split | Rejected |
| **New `PaymentsPage.tsx` at `/payments`** ✅ | Gives the deferred settlement/history changes a home; keeps the split's own principle (one page, one concern) | **Chosen** |

nav becomes 8 links: **Dashboard, Pacientes, Consultas, Calendario, Repositorio, Pagos, Perfil, Seguridad**. State comes from `hooks/usePaymentAccount.ts` (`queryKey: ['payment-account']`), matching the `useProfile` react-query pattern established by session-calendar-view — not a raw `api.get` in `useEffect`.

Onboarding is a **form, not an OAuth redirect**: `POST /payments/account` submits the therapist's merchant data, the adapter calls `/merchant/create`, and the returned per-merchant credential is stored as `Bytes` encrypted with the existing `common/crypto/aes-gcm.ts` primitives under a dedicated `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` (same rotation-cost argument as `GOOGLE_TOKEN_ENCRYPTION_KEY`).

### Decision: Link delivery has an explicit persisted state, and never blocks the charge

`linkDelivery` is an enum column, not a boolean: `SENT | SKIPPED_NO_EMAIL | FAILED`. `MailService.sendPaymentLinkEmail(...)` follows the file's one-method-per-type, never-throws contract (mail.service.ts:166). A patient with no `email` produces `SKIPPED_NO_EMAIL` and a therapist-visible badge state — the charge is still created and still payable via the link the therapist can copy from the card. Rejected: blocking charge creation on a missing email (`Patient.email` is optional and scheduling must not start requiring it).

## Data Flow

    create()/correct() ──tx commit──→ void PaymentsService.ensureCharge(groupId) ──catch──→ logger.error
                                              │  PAYMENTS_ENABLED? account CONNECTED? amount resolvable?
                                              ▼
                                      Payment upsert(groupId) {PENDING, amount snapshot, dueDate=sessionDate}
                                              │
                                    PaymentGatewayClient.createOrder ──→ {token, paymentUrl}
                                              │
                                    MailService.sendPaymentLinkEmail ──→ linkDelivery = SENT|SKIPPED_NO_EMAIL|FAILED

    Patient ──paymentUrl──→ hosted checkout ──→ POST /payments/confirm (public)
                                                  verify HMAC (timingSafeEqual) ──invalid──→ 400, no DB read
                                                  getOrderStatus(token)  ← authoritative
                                                  updateMany(status in [PENDING,LATE] → PAID)  ← idempotent

    @Cron(EVERY_30_MINUTES) sweep()
      pass 1  PENDING && dueDate <= now  ──updateMany count-gated──→ LATE + 1 email + 1 notification
      pass 2  PENDING|LATE && token issued > 15 min ago ──getOrderStatus──→ reconcile missed callbacks

    ConsultationsPage card  ← GET /consultations/patient/:id  (payment resolved by groupId map)

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/prisma/schema.prisma` | Modify | `Payment`, `PaymentAccount`, 4 enums, `NotificationType.PAYMENT_LATE`, `Patient.defaultSessionAmount` |
| `backend/prisma/migrations/*_payments/` | Create | Purely additive |
| `backend/src/modules/payments/payments.module.ts` | Create | Imports `ConfigModule`, `MailModule`, `NotificationsModule`; exports `PaymentsService`. Imports neither consultations nor patients — no cycle |
| `.../payments/payment-gateway.client.ts` | Create | Abstract port + `PaymentGatewayError` kinds (`transient`/`rejected`/`credentials`) |
| `.../payments/flow-gateway.client.ts` | Create | HMAC-SHA256 signing, `/merchant/create`, order create/status; native `fetch` |
| `.../payments/payment-account.service.ts` | Create | Onboarding, credential encryption, status |
| `.../payments/payments.service.ts` | Create | `ensureCharge`, `updateAmount`, `cancelUnpaid`, `confirm`, `@Cron sweep` |
| `.../payments/payments.controller.ts` | Create | 5 routes (below) |
| `.../payments/payments.constants.ts` | Create | `SWEEP_BATCH_LIMIT = 200`, `RECONCILE_MIN_AGE_MS`, `PAYMENT_RETURN_PATH = '/payments'` |
| `backend/src/modules/consultations/consultations.service.ts` | Modify | `emitPaymentCharge(groupId)` after `create`/`correct`; `payment` in `findByPatient`/`findByRange` via `groupId` map |
| `backend/src/modules/consultations/consultations.module.ts` | Modify | Import `PaymentsModule` |
| `backend/src/modules/patients/dto/{create,update}-patient.dto.ts` | Modify | `defaultSessionAmount?: number` (`@IsInt`, `@Min(0)`) |
| `backend/src/modules/mail/mail.service.ts` | Modify | `sendPaymentLinkEmail`, `sendLatePaymentEmail` |
| `backend/src/config/env.validation.ts` | Modify | `PAYMENTS_ENABLED` exactly `"true"`/`"false"`; 32-byte `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` in production |
| `backend/src/app.module.ts`, `.env.example`, `README.md` | Modify | Register module; Flow credentials + flag |
| `frontend/src/components/payments/PaymentStatusBadge.tsx` | Create | Inserted into the existing `flex flex-wrap gap-2 mt-1` chip row on the session card (`ConsultationsPage.tsx:318`), immediately after the `sessionType` span |
| `frontend/src/pages/PaymentsPage.tsx` + `.spec.tsx` | Create | Merchant onboarding + account status |
| `frontend/src/hooks/usePaymentAccount.ts` | Create | `queryKey: ['payment-account']` |
| `frontend/src/pages/ConsultationsPage.tsx`, `PatientsPage.tsx`, `types/*.ts` | Modify | Badge + copy-link + per-session amount control; `defaultSessionAmount` field |
| `frontend/src/App.tsx`, `components/Layout.tsx` | Modify | `/payments` route; navLinks 7 → 8 (`CreditCard`) |
| `docs/registro-actividades-tratamiento.md` | Modify | Flow as processor |

## Interfaces / Contracts

```prisma
// Una carga por cadena clínica: groupId sobrevive a correct() (schema.prisma:159),
// así que corregir actualiza la MISMA carga y un reagendamiento mueve dueDate.
model Payment {
  id               String        @id @default(uuid())
  groupId          String        @unique
  patientId        String
  therapistId      String
  amount           Int           // CLP no tiene decimales; snapshot al crear la carga
  currency         String        @default("CLP")
  status           PaymentStatus @default(PENDING)
  dueDate          DateTime      // = Consultation.sessionDate vigente
  gatewayToken     String?       // nullable: un cargo puede existir antes/sin orden
  gatewayPaymentId String?
  paymentUrl       String?
  linkDelivery     PaymentLinkDelivery @default(PENDING)
  linkSentAt       DateTime?
  lateNotifiedAt   DateTime?     // se limpia al reagendar a futuro (re-arma LATE)
  paidAt           DateTime?
  cancelledAt      DateTime?
  lastError        String?
  orderIssuedAt    DateTime?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  @@index([status, dueDate])
  @@index([therapistId])
}

model PaymentAccount {
  id                  String               @id @default(uuid())
  therapistId         String               @unique
  therapist           User                 @relation(fields: [therapistId], references: [id])
  provider            PaymentProvider      @default(FLOW)
  status              PaymentAccountStatus @default(PENDING)
  merchantId          String?
  credentialEncrypted Bytes?               // [IV(12)][authTag(16)][ciphertext]
  connectedAt         DateTime?
  lastError           String?
}

enum PaymentStatus       { PENDING PAID LATE CANCELLED }
enum PaymentLinkDelivery { PENDING SENT SKIPPED_NO_EMAIL FAILED }
enum PaymentProvider     { FLOW }
enum PaymentAccountStatus{ PENDING CONNECTED DISCONNECTED }
```

| Method | Path | Guard | Notes |
|---|---|---|---|
| GET | `/payments/account` | `JwtAuthGuard` | Status only — never the credential |
| POST | `/payments/account` | `JwtAuthGuard` | Onboard/reconnect merchant |
| DELETE | `/payments/account` | `JwtAuthGuard` | Disconnect; existing charges untouched |
| PATCH | `/payments/:groupId` | `JwtAuthGuard` | Per-session amount override while `PENDING`; re-issues order + link. **Never** part of the clinical `correct()` modal |
| POST | `/payments/confirm` | **none** | Signature-verified, status re-fetched, idempotent |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Signature verification: valid, tampered param, missing `s`, wrong key, extra param — all rejected **before** any DB call | RED first; assert Prisma mock untouched |
| Unit | Replayed confirm affects 0 rows; `PAID → PAID` is a no-op; `CANCELLED` never becomes `PAID` | Count-gated `updateMany` assertions |
| Unit | Sweep notifies exactly once on `PENDING → LATE`; a second tick emits none; reschedule-to-future re-arms | Fake clock, mocked Prisma |
| Unit | No `PaymentAccount`, `PAYMENTS_ENABLED=false`, or `defaultSessionAmount = null` → no charge, no email | Table-driven |
| Unit | Patient without email → `SKIPPED_NO_EMAIL`, charge still `PENDING`, no throw | `mail.service.spec.ts` never-throws contract |
| Integration | `correct()` updates the **same** `Payment` row and moves `dueDate`; never creates a second charge | Real Prisma, mocked gateway |
| Integration | Gateway throwing on every call → `POST /consultations` still returns 201 with the clinical row intact | Mirrors `consultations.service.integration.spec.ts` calendar case |
| Integration | Amount snapshot survives a later `defaultSessionAmount` change | Real Prisma |
| E2E | **Tenancy**: therapist B cannot read, patch, or disconnect therapist A's payment account or charge — uniform 404, never 403-with-leak | RED first |
| E2E | Forged/unsigned `POST /payments/confirm` never mutates a `Payment` | Public route = primary attack surface |
| Unit (FE) | Badge renders each status + `SKIPPED_NO_EMAIL`; badge is absent when there is no charge; amount control is not in the "Corregir sesión" modal | `ConsultationsPage.spec.tsx` |

## Threat Matrix

N/A — no routing-classification, shell, subprocess, VCS/PR automation, or executable-file-classification boundary; `@nestjs/schedule` uses in-process timers and spawns nothing, and the Flow integration is outbound HTTPS plus one inbound JSON callback, not process integration. The three security-critical invariants (signature verification before any state read on the public callback, idempotent count-gated transitions, per-therapist tenancy) are carried as mandatory RED tests above — the same posture the archived `google-calendar-integration` and `session-reminders` designs took.

## Migration / Rollout

One additive Prisma migration (two tables, four enums, one enum member, one nullable `Patient` column), run against `DIRECT_URL` per the schema's Supavisor note. Without Flow credentials the module registers and no-ops with a `logger.warn`, exactly as `MailService` does without `RESEND_API_KEY` — local dev, CI and e2e boot untouched. `PAYMENTS_ENABLED=false` kills the cron, the write-path intents, the emails and the callback without a deploy revert. Delivery `ask-on-risk`, 400-line budget:

| PR | Scope | Est. | Depends on |
|---|---|---|---|
| 1 | Schema + migration + `PaymentsService` charge lifecycle + flag + env validation, gateway port stubbed | ~380 | — |
| 2 | `FlowPaymentGatewayClient`, onboarding endpoints, public confirm controller + signature verification, `@Cron sweep` | ~390 | 1 |
| 3 | Mail templates, `PAYMENT_LATE` notification, `PaymentsPage`, badge, amount surfaces, RAT row | ~390 | 1, 2 |

`400-line budget risk: High` — chained PRs required, PR 1 is independently revertible and inert behind the flag.

## Open Questions

- [ ] **Legal (carried from the proposal, deliberately not designed around)**: emailing a payment link may be a distinct *finalidad* under Ley 21.719, which would need a new `ConsentPurpose` member. This design does **not** gate link delivery on a consent purpose that does not exist in the schema. If legal confirms, adding the member and the gate is additive and does not alter any decision above.
- [ ] Exact Flow parameter attributing `createOrder` to an associated merchant — confined to `flow-gateway.client.ts`, resolvable against the sandbox during PR 2 with no change to calling code.
- [ ] Money-tone review of both email templates with the product owner before release.
- [ ] `Consultation.deletedAt` has no route that writes it today (same finding as the calendar design), so `cancelUnpaid` is implemented and tested but currently only reachable via patient soft-delete.
