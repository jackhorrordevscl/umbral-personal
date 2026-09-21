# Issue #137: extraer PaymentReconciliationService de PaymentsService

## Objetivo
`payments.service.ts` (867 líneas) mezcla la orquestación transaccional de
cobro con el cron de reconciliación (`sweep()` cada 30 min). Separar un
`PaymentReconciliationService` para el cron + su lógica de sweep, dejando
`PaymentsService` solo con el lifecycle transaccional de un cobro puntual.

## Por qué
Mismo criterio que la extracción de `MfaService` (issue #136): dos
responsabilidades distintas viviendo en la misma clase (lifecycle de un
cobro puntual vs. barrido periódico de todos los pagos pendientes).

## Alcance
- Nuevo archivo `backend/src/modules/payments/payment-reconciliation.service.ts`.
- Mover de `PaymentsService` a `PaymentReconciliationService`: `sweep()`
  (con su `@Cron`), `transitionLatePayments()`, `transitionOneToLate()`,
  `reconcilePendingPayments()`, `reconcileOne()`, `runInBatches()`.
- `resolveContextMemoized()` se duplica (helper chico, ambos servicios lo
  necesitan con cache propio) — no se comparte para no acoplar los dos
  servicios.
- `markPaid()` se queda en `PaymentsService` (lo usa también `confirm()`),
  pasa a público; `PaymentReconciliationService` inyecta `PaymentsService`
  y lo llama.
- Actualizar `payments.module.ts`: registrar el nuevo provider.
- Dividir el describe `sweep` (líneas ~1256-1528 de
  `payments.service.spec.ts`) en un nuevo
  `payment-reconciliation.service.spec.ts`.

## Constraints
- No tocar el comportamiento observable (mismos logs, mismo batching,
  misma concurrencia).
- Mantener los comentarios técnicos existentes que documentan decisiones
  no obvias (issue #113, #114, #115, design.md refs) — moverlos junto con
  el código al que pertenecen.

## Tareas
- [x] T1: Crear `PaymentReconciliationService`, mover métodos, hacer
      `markPaid` público en `PaymentsService`, actualizar `payments.module.ts`.
- [x] T2: Dividir los tests de `sweep` a
      `payment-reconciliation.service.spec.ts`.
- [x] T3: Correr `npm test` en `backend/` y confirmar verde.

## TDD
Modo: proyecto ya tiene tests existentes para el código movido — no es
TDD puro (no hay RED nuevo), es refactor con cobertura preexistente que
debe seguir en verde.

## Evidencia

**T1** — Nuevo `backend/src/modules/payments/payment-reconciliation.service.ts`
con `sweep()` (+ `@Cron`), `transitionLatePayments`, `transitionOneToLate`,
`reconcilePendingPayments`, `reconcileOne`, `runInBatches` y una copia propia
de `resolveContextMemoized`. `PaymentsService.markPaid` pasó de `private` a
público (lo sigue usando `confirm()`, y ahora también
`PaymentReconciliationService.reconcileOne` vía inyección de
`PaymentsService`). `CANCELLABLE_STATUSES` se movió de un `const` privado en
`payments.service.ts` a `payments.constants.ts`, exportada y usada por ambos
servicios. `payments.module.ts` registra `PaymentReconciliationService` como
provider (sin export, solo lo usa su propio `@Cron`).

Como consecuencia natural de mover `transitionOneToLate` (única consumidora
de `NotificationsService` dentro de `PaymentsService`), `NotificationsService`
salió del constructor de `PaymentsService` — ya no lo necesita. Se actualizó
`backend/src/modules/consultations/consultations.service.integration.spec.ts`
(dos instanciaciones directas de `PaymentsService` que pasaban
`NotificationsService` de más).

**T2** — El `describe('sweep', ...)` (líneas 1255-1527 de
`payments.service.spec.ts`, confirmado con
`grep -n "describe('sweep'" payments.service.spec.ts`) se extrajo a
`backend/src/modules/payments/payment-reconciliation.service.spec.ts` con su
propio `Test`/mocks: `PaymentsService.markPaid` se mockea como dependencia
inyectada (`paymentsService = { markPaid: jest.fn()... }`) en vez de espiarse
como método privado. Dos asserts que antes verificaban directamente
`prisma.payment.updateMany` con el shape de `markPaid` se adaptaron a
verificar `paymentsService.markPaid` (mismo comportamiento observable, ahora
a través del límite de servicio).

**T3** — Comandos corridos y resultado real:
- `cd backend && npm test -- payments` → `Test Suites: 7 passed, 7 total,
  Tests: 134 passed, 134 total` (incluye `payments.service.spec.ts` y el
  nuevo `payment-reconciliation.service.spec.ts`).
- `cd backend && npm test -- payments consultations` → `Test Suites: 10
  passed, 10 total, Tests: 181 passed, 181 total` (confirma que
  `consultations.service.integration.spec.ts`, que instancia `PaymentsService`
  directamente, sigue verde tras sacarle `NotificationsService`).
- `cd backend && npx tsc --noEmit` → sin salida, sin errores.
- `cd backend && npm run build` → `nest build` completó sin errores.

**Commit**: `48cdac7` — `refactor(payments): extraer
PaymentReconciliationService de PaymentsService` (rama
`refactor/137-extract-payment-reconciliation-service`).
