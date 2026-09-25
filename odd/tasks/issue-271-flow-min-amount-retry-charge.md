# Issue #271: Monto mínimo de Flow, cobro fallido visible y reintento

## Objetivo
Que un cobro rechazado por Flow (ej. monto < mínimo, código 1901) no quede invisible: validar el mínimo antes de llamar a la pasarela, mostrar el motivo del fallo al terapeuta y permitir reintentar la creación de la orden. Además, dejar de loguear como ERROR el rechazo esperado de la sonda de credenciales.

## Por qué
Prueba de cobros en producción con Flow prod (2026-09-25): un cargo con monto bajo devolvió `1901 The minimum amount is 350 CLP`, quedó con `paymentUrl` nulo y `lastError` seteado (verificado en la BD), y la UI no mostraba ningún botón (copiar/reenviar solo se renderizan con `paymentUrl`) ni el motivo. La sonda de credenciales (`code 1700`) deja un ERROR por cada verificación exitosa.

## Alcance (del issue)
1. Validar el monto mínimo antes de llamar a Flow y devolver un mensaje claro al terapeuta.
2. Bajar el nivel de log del rechazo 400/404 esperado de la sonda.
3. Exponer `Payment.lastError` en la respuesta de consultas y mostrar "Cobro no generado: <motivo>".
4. Endpoint de reintento (ownership gate como `resend-link`) + botón "Reintentar cobro".

## Restricciones / decisiones de diseño
- El mínimo es propiedad de la pasarela: se declara en el port `PaymentGatewayClient` (`minimumAmount`), Flow = 350 CLP (fuente: mensaje de error real de Flow prod; falta confirmar en su documentación si depende de la cuenta).
- `issueOrder` no llama a la pasarela si `amount < minimumAmount`: persiste `lastError` con el mensaje claro y devuelve `null` (mismo contrato de "no bloquea el cargo").
- `updateAmount` con contexto de pasarela y monto bajo el mínimo responde 400 (no persiste el monto), para que el terapeuta vea el error de inmediato.
- Reintento: solo cargos `PENDING`/`LATE` sin `paymentUrl`; reusa `issueOrder` + `deliverPaymentLink`. Endpoint `POST /payments/:groupId/retry-charge`.
- Log: `request()` loguea `warn` en 400/404 (rechazos esperados) y `error` en 401/403/5xx. `PaymentsService.issueOrder` ya loguea `error` el fallo real.
- Sin cambios de schema (`lastError` ya existe).
- TDD: sin modo estricto configurado; tests junto a cada unidad de trabajo. Runner: Jest (backend), Vitest (frontend).
- Planning heuristic ~400 líneas por tarea; no es tope.

## Tareas

- [x] T1 — Backend: `minimumAmount` en el port + Flow (350), validación en `issueOrder`/`updateAmount`, log `warn` en 400/404 de `request()`. Tests. Ruta: delegada (writer backend).
- [x] T2 — Backend: exponer `lastError` en `getPaymentMap` y `retryCharge` + `POST /payments/:groupId/retry-charge`. Tests. Ruta: delegada (writer backend).
- [x] T3 — Frontend: `PaymentSummary.lastError`, estado "Cobro no generado: <motivo>" y botón "Reintentar cobro" en `ConsultationsPage.tsx`. Tests. Ruta: delegada (writer frontend).

## Evidencia / commits
- T1+T2 backend: commit 0d3e9a1 (fix(payments): validar monto mínimo de Flow y permitir reintentar el cobro), 11 archivos, +383/-6. Ruta: delegada (writer backend).
  - `npx tsc --noEmit -p tsconfig.json`: exit 0.
  - `npx jest` (suite completa): 797 pasan, 14 fallan; los 3 suites que fallan son integration specs (consultations, calendar-sync, reminders) por DATABASE_URL ausente en este worktree (entorno, no el cambio). Los suites de payments y consultations unitarios pasan.
  - `npx eslint` en payments/consultations: sin salida (limpio). `npx prettier --check`: limpio.
- T3 frontend: commit c189a2d (feat(consultations): mostrar cobro fallido y permitir reintentar el cobro), 5 archivos. Ruta: delegada (writer frontend). Hook `useRetryCharge` invalida `['consultations']` en `onSettled`.
  - `npm run test`: 39 archivos, 211 tests pasan.
  - `npm run lint`: sin salida (limpio).
  - `npm run build` (tsc -b && vite build): OK.
  - No verificado: recorrido manual en la UI real.

## Checks aplicables
- Backend: `npm run test` (Jest) y `npm run lint` en `backend/`.
- Frontend: `npm run test` (Vitest), `npm run lint` y `npm run build` en `frontend/`.
- `node_modules` no está instalado en este worktree: `npm ci` (y `npx prisma generate` en backend) antes de testear.

## Próximo paso
Revisión final y decisión de push/PR (del usuario).
