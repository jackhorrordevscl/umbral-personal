# Proposal: Online Payment Integration (charge-on-scheduling, split per therapist)

## Intent

Therapists collect session fees outside Umbral (transfer, cash, WhatsApp reminders), so Umbral knows when a session happened but never whether it was paid. Therapists reconcile manually and chase late payers by hand. This change makes the charge a first-class, automatic consequence of scheduling a session, delivers the payment link to the patient without therapist effort, and surfaces payment status where the therapist already reads the session.

## Scope

### In Scope

- `Payment` model keyed by `Consultation.groupId` (survives `correct()` versioning, same pattern as `ReminderDispatch`), with status, amount, currency, due date, and gateway references.
- Per-patient default amount (`Patient.defaultSessionAmount`), overridable per individual session (sliding scale); each charge snapshots its own amount.
- Automatic pending charge created when a consultation is created.
- Gateway: **Flow** hosted checkout (redirect), "Comercios Asociados" split mode — each therapist connects their own Flow account; Umbral never holds patient funds.
- Automatic payment-link email to `Patient.email` at charge creation, via `MailService`. No manual therapist step.
- Webhook confirmation endpoint with HMAC-SHA256 signature verification (greenfield — no signature-verification precedent in the repo) plus idempotent claim-then-process, and a reconciliation fallback.
- Transition pending → late at session time; one late-payment email via `MailService` and one in-app notification via a new `NotificationType` member.
- `PAYMENTS_ENABLED` flag following the `X_ENABLED !== 'false'` convention.
- Payment-status badge on the session card in `ConsultationsPage`, separate from the clinical "Corregir sesión" modal.

### Out of Scope

- **Payment-reminder dispatch/cadence** (cron, "how many days late", repeat sends) — a later change reusing `RemindersService`. This change only exposes a queryable pending/late status with a due date.
- **Boleta/factura electrónica (SII)** — separate future change pending legal/accounting review. Not designed around here.
- **Refunds** — a session cancelled after payment keeps its payment record as-is. Reversing money is a future refund flow, not this change.
- **Offline/manual payment records** for therapists with no Flow account — see Approach; deliberately deferred.
- Therapist onboarding UX beyond "the therapist connects an account" — `sdd-design` deep-dives it.
- Partial payments, payouts/settlement reporting, patient-facing payment history, MercadoPago as a second gateway.

## Capabilities

### New Capabilities

- `payments`: charge lifecycle keyed by consultation group, amount rules, therapist gateway-account linkage, hosted-checkout + link delivery + webhook confirmation, and late-status transition.

### Modified Capabilities

- None. Late-payment alerts emit into the existing generic `notifications` capability; no requirement there changes (same precedent as `calendar-sync`).

## Business Rules

| Rule | Value |
|---|---|
| Merchant of record | The therapist, via their own connected Flow account (Comercios Asociados). Umbral never custodies patient money. |
| Amount | Per-patient default, therapist-editable per session. No platform flat rate. Each charge snapshots its amount at creation. |
| Charge trigger | Automatic on consultation creation. No manual "send link" step. |
| Link delivery | Automatic email to `Patient.email` at charge creation. |
| Patient without email | Charge is still created and visible to the therapist; no link email is sent, and the therapist sees that delivery was not possible. `Patient.email` is optional today and scheduling must not start requiring it. |
| Due date | The session's own date/time. Unpaid at that moment → `LATE`. |
| Charge identity | Keyed by `groupId` — a `correct()` version updates the same charge, never duplicates it. A rescheduled session moves the due date with it. |
| Correction vs payment | Payment status is mutable operational state, never part of the versioned clinical snapshot. |
| Cancellation | `deletedAt` set → an unpaid charge is cancelled; a paid charge is preserved untouched, with no automatic refund. |
| Late notification | Notify once on the pending → late transition, not on every check. |
| Unconnected therapist | No Flow account → no charge created; scheduling works exactly as today. Online payment is incremental, never a prerequisite for using Umbral. |
| Flag off | `PAYMENTS_ENABLED=false` → no charges, no link emails, no webhooks, no late emails. |

## Approach

New `backend/src/modules/payments/` module owning the Flow client, charge lifecycle, and a public webhook controller. `ConsultationsService` write paths emit charge intents; a gateway or mail failure logs and never blocks the clinical write (same non-blocking contract as `MailService` and calendar sync).

**Why Flow over MercadoPago**: both offer split payouts, but Flow is Chilean-domiciled. MercadoPago is Argentina-headquartered and would extend the already-open, legally-unresolved international-transfer section of the RAT — in a health-data context where patient identity attaches to the charge, that is a cost with no offsetting product benefit. Webpay Plus is excluded outright: no native split, incompatible with the merchant-of-record decision. Flow's split model is documented (`/merchant/create`, HMAC-SHA256 signing, per-associated-merchant apiKey), so the capability is confirmed to exist; only the exact payment-to-merchant attribution mechanism remains a design detail.

Hosted checkout over API tokenization: keeps card data entirely off Umbral's frontend and backend, minimizing PCI surface for a two-person product.

**Amount lives on `Patient`, not a separate pricing table.** `Patient` is therapist-scoped with exactly one owning therapist, so a per-patient price has no ambiguity a join table would resolve, and price history is already captured immutably by each `Payment`'s amount snapshot. A pricing table would only pay off with shared price lists or scheduled price changes, neither of which exists. One nullable `defaultSessionAmount` column, no new table.

**No offline charge record for unconnected therapists.** A manually-set "paid" flag with no gateway behind it is a second, unverified source of payment truth — bookkeeping, not payment integration. Deferred as its own change. The `Payment` model keeps gateway reference fields nullable so that future change is additive rather than a migration of existing rows.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `backend/prisma/schema.prisma` | Modified | `Payment` + therapist gateway-account model; `NotificationType` member; `Patient.defaultSessionAmount` |
| `backend/src/modules/payments/` | New | Flow client, charge service, webhook controller + HMAC-SHA256 verification |
| `backend/src/modules/consultations/` | Modified | Emit charge on create; move due date on reschedule; cancel unpaid charge on soft-delete |
| `backend/src/modules/patients/` | Modified | `defaultSessionAmount` on create/update DTOs |
| `backend/src/modules/mail/mail.service.ts` | Modified | Payment-link email + late-payment email (both new tone precedents) |
| `backend/src/app.module.ts`, `.env` | Modified | Wire module; `PAYMENTS_ENABLED`, Flow credentials |
| `frontend/src/types/patient.ts`, `pages/ConsultationsPage.tsx`, `pages/PatientsPage.tsx` | Modified | `payment` field on `Consultation`; status badge; per-session and per-patient amount surfaces |
| `docs/registro-actividades-tratamiento.md` | Modified | New processor row for Flow (task-level follow-up) |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Flow split mode exists (`/merchant/create`, documented) but the exact payment-to-associated-merchant attribution parameter is not covered by public docs | Med | Resolve in `sdd-design` against Flow's API; hosted-checkout shape keeps the gateway swappable behind one client interface |
| Webhook signature verification is greenfield — a weak implementation forges paid status | Med | Security-sensitive design surface; explicit HMAC-SHA256 verification requirement in the spec |
| Duplicate/replayed webhooks double-process a charge | Med | Idempotent claim-then-process on a unique constraint, `ReminderDispatch` template |
| Missed webhook leaves a paid charge stuck pending | Med | Scheduled reconciliation query against the gateway |
| Emailing a patient a payment link may be a new *finalidad* under the granular `PatientConsent` model (Ley 21.719) | Med | Legal check before release; may need a `ConsentPurpose` member rather than riding an existing one |
| Money-related emails to a therapy patient in an untested tone cause harm or alarm | Med | Both templates reviewed with the product owner before release |
| Patients without `Patient.email` silently never receive a link | Med | Explicit therapist-visible "link not delivered" state; never block scheduling on it |
| New processor undocumented under Ley 21.719 / 19.628 | Med | RAT row added in the same change, before release |
| Therapists are not modeled as billing entities (no RUT/legal-entity fields on `User`) | Med | Gateway account linkage carries the identity; SII/boleta deliberately deferred |
| PR exceeds the review budget | High | Chain: schema + charge lifecycle → Flow client + webhook → emails, notifications, frontend |

## Rollback Plan

Additive and isolated. (1) Set `PAYMENTS_ENABLED=false` — charge creation, link emails, webhooks, and late emails stop immediately; scheduling and all clinical writes behave exactly as before. (2) Revert the frontend badge/amount surfaces. (3) Revert the `ConsultationsService` emission points. (4) Reverse the Prisma migration — new tables and the nullable `Patient` column are additive and drop without touching clinical data. Stopping at step 1 is safe on its own. Charges already settled at Flow are unaffected; money moves between patient and therapist, so Umbral has nothing to unwind.

## Dependencies

- Flow merchant account, API credentials, and access to the Comercios Asociados flow under the intended commercial terms.
- A publicly reachable HTTPS webhook endpoint in every deployed environment.
- Existing `MailService` (Resend) and `NotificationType` extension point.
- Legal confirmation on whether payment-link email needs its own `ConsentPurpose`.
- No dependency on the deferred reminder-cadence, refund, or SII changes.

## Success Criteria

- [ ] A therapist connects a Flow account; scheduling a session with a connected account creates a pending charge automatically.
- [ ] The patient receives the payment link by email at charge creation, with no therapist action.
- [ ] A patient without an email still gets a charge, and the therapist can see the link was not delivered.
- [ ] The amount defaults per patient and can be overridden for a single session without touching the clinical record.
- [ ] Paying through hosted checkout flips the charge to paid via a signature-verified webhook, and a replayed webhook changes nothing.
- [ ] `correct()` on a consultation updates the same charge instead of creating a second one, and a reschedule moves the due date.
- [ ] A charge still unpaid at session time becomes late and triggers exactly one email and one in-app notification.
- [ ] Cancelling a session voids an unpaid charge and leaves a paid one intact.
- [ ] The session card shows payment status next to the session-type badge.
- [ ] Scheduling still succeeds when Flow is unavailable, the therapist has no account, or `PAYMENTS_ENABLED=false`.
- [ ] The RAT documents Flow as a processor before release.

## Confirmed Decisions

Set by the user across two proposal preflight rounds; not re-opened in later phases.

1. Merchant of record is the therapist, split/marketplace per therapist. Umbral never holds patient money.
2. Amount is per-patient or per-session, therapist-editable — not a flat rate.
3. Charge is generated automatically on scheduling, with no manual send step.
4. Boleta/factura electrónica (SII) is out of scope, pending legal review.
5. A charge is due at session time; unpaid at that moment means late.
6. A therapist without a Flow account schedules normally and generates no charge. Online payment is optional and incremental.
7. The payment link reaches the patient by automatic email to the address on their record.
8. A session cancelled after payment keeps the payment recorded; no automatic refund. An unpaid charge cancels with the session.

## Open Questions

Non-blocking for `sdd-spec`; resolve in `sdd-design`.

1. Exact Flow parameter that attributes a payment to an associated merchant, and the resulting fund-distribution shape.
2. Reconciliation cadence for missed webhooks.
3. Whether the payment-link email requires its own `ConsentPurpose` member (legal input, not engineering).
