# Issue #163: Tracking de apertura/entrega de emails transaccionales (recordatorios)

## Objetivo
Saber si los recordatorios de sesión enviados por email (`ReminderDispatch`, channel EMAIL) fueron entregados/abiertos, y mostrar ese estado en el dashboard/ficha del terapeuta.

## Por qué
Segundo issue del orden de prioridad acordado con el usuario (memoria: 157 → 163 → 155, "entregas chicas"). Referencia: comparación con "Recordatorios" de Encuadrado (seguimiento de entrega/apertura).

## Alcance (del issue, acotado)
- Investigar si el plan de Resend soporta webhooks de entrega/apertura sin costo extra. **Resuelto**: confirmado, todos los planes de Resend (incluido free) incluyen webhooks + open/click tracking (resend.com/pricing).
- Backend: endpoint para recibir webhooks de Resend y persistir el estado por email enviado.
- Frontend: indicador de estado de entrega donde ya se muestran recordatorios enviados.

## Decisión de alcance (confirmada con el usuario)
Se pidió elegir entre (a) solo recordatorios de sesión o (b) recordatorios + link de pago. El usuario eligió **(a) solo recordatorios**: acotado, coincide con la referencia real del issue ("Recordatorios" de Encuadrado), no toca el módulo de pagos.

## Restricciones / decisiones de diseño
- `ReminderDispatch` (channel EMAIL) ya trackea SENT/FAILED/SKIPPED por recordatorio — es el modelo natural a extender, en vez de crear una tabla nueva de log de emails.
- Nuevos campos en `ReminderDispatch`: `resendMessageId String?` (id devuelto por Resend al enviar, para correlacionar con el webhook), `deliveredAt DateTime?`, `openedAt DateTime?`.
- `MailService.sendSessionReminderEmail` cambia de `Promise<void>` a `Promise<string | null>` (retorna el `id` de Resend, o `null` si no se configuró `RESEND_API_KEY` o si Resend devolvió error) — mismo criterio de "nunca lanza" que ya tiene el método, solo cambia qué devuelve en éxito.
- `RemindersService.claimAndDispatch` guarda el `resendMessageId` devuelto junto con el `status: 'SENT'` en el mismo `update()`.
- Webhook: `POST /webhooks/resend`, público (sin JwtAuthGuard — Resend no manda credenciales de la app), verificado con firma Svix (`svix` npm package, mismo esquema que usa Resend) contra `RESEND_WEBHOOK_SECRET`. Si la variable no está configurada, el endpoint responde 501 (mismo criterio "no configurado => degrada, no rompe boot" que MailService sin `RESEND_API_KEY`).
- Eventos manejados: `email.delivered` → `deliveredAt`; `email.opened` → `openedAt` (solo la primera apertura, no sobrescribe si ya tiene valor); otros eventos (`email.sent`, `email.bounced`, `email.complained`, etc.) se ignoran en este alcance (out of scope, ya existe `status: FAILED` para fallos de envío inmediatos).
- Frontend: nuevo badge `ReminderEmailStatusBadge` en `ConsultationsPage`, junto a `PaymentStatusBadge`, visible solo si existe un `ReminderDispatch` EMAIL para esa sesión. Requiere que el backend incluya el estado del último `ReminderDispatch` EMAIL en el payload de `/consultations/patient/:id` y `/consultations/range`.
- TDD: sin modo estricto configurado; tests junto con cada unidad de trabajo (mismo patrón que #157).

## Tareas

- [x] T1 — Schema: agregar `resendMessageId`/`deliveredAt`/`openedAt` a `ReminderDispatch` + migración Prisma. Ruta: delegada (writer backend).
- [x] T2 — Backend: `MailService.sendSessionReminderEmail` retorna el id de Resend; `RemindersService.claimAndDispatch` lo persiste. Tests. Ruta: delegada (writer backend).
- [x] T3 — Backend: `POST /webhooks/resend` (controller + service), verificación de firma Svix/Standard Webhooks, actualiza `deliveredAt`/`openedAt` por `resendMessageId`. Tests (firma válida/inválida, evento desconocido, dispatch no encontrado, secret no configurado, no pisa timestamp existente). Ruta: delegada (writer backend).
- [x] T4 — Backend: incluir estado del último `ReminderDispatch` EMAIL en `ConsultationsService.findByPatient`/`findByRange`. Tests. Ruta: delegada (writer backend).
- [x] T5 — Frontend: `ReminderEmailStatusBadge` + integrarlo en `ConsultationsPage`. Tests. Ruta: delegada (writer frontend).

## Desviación de diseño en T3 (documentada)

El diseño original decía "verificado con firma Svix (`svix` npm package)". Se instaló `svix` y se comprobó que su build es **ESM-only** (`package.json` solo expone `"exports": {".": "./dist/index.mjs"}`, sin build CJS) — al importarlo desde `webhooks.service.ts`, Jest (vía `ts-jest` en modo CommonJS, config existente del repo) falla con `SyntaxError: Cannot use import statement outside a module` al intentar cargar `dist/index.mjs`. No hay una config de Babel en el repo para transformar ESM de `node_modules`, y agregar una solo para esto habría sido una dependencia nueva no relacionada con el alcance.

Se desinstaló `svix` (el diff neto de `package.json`/`package-lock.json` quedó en cero) y se reimplementó la verificación con el módulo `crypto` nativo de Node, replicando el algoritmo público del esquema Standard Webhooks (el mismo que usa `svix` por debajo, y que Resend firma): `HMAC-SHA256("{svix-id}.{svix-timestamp}.{rawBody}", secret)` en base64, comparado con `timingSafeEqual` contra cada firma `v1,<sig>` del header `svix-signature` (soporta múltiples firmas espacio-separadas), más tolerancia de ±5 minutos en el timestamp (mismo valor que usa la librería de referencia, protección contra replay). El contrato funcional (501 sin secret, 401 con firma inválida, verificación correcta con firma válida) es idéntico al que habría dado `svix`.

## Evidencia / commits

- Commit `f28c503` en la rama `worktree-issue-157-patient-origin-tracking`: `feat(reminders): trackear entrega y apertura de emails de recordatorio` (T1-T4, backend). 15 archivos, +806/-22.
- Migración `backend/prisma/migrations/20260921150000_add_reminder_dispatch_email_tracking/` generada con `prisma migrate diff --from-schema-datasource --to-schema-datamodel` (mismo bug conocido de shadow DB/RLS que #157) y aplicada contra Postgres local (`umbral-postgres-local`, docker-compose.yml) con `prisma migrate deploy` — aplicó limpio.
- `npx prisma validate`: **"The schema at prisma\schema.prisma is valid"**.
- `npm run test` (Jest, backend, con `DATABASE_URL`/`DIRECT_URL` apuntando al Postgres local): **59 test suites passed, 675 tests passed**, 0 failed. Incluye las suites nuevas/modificadas: `mail.service.spec.ts`, `reminders.service.spec.ts`, `reminders.service.integration.spec.ts`, `webhooks.service.spec.ts`, `webhooks.controller.spec.ts`, `consultations.service.spec.ts`, `consultations.service.integration.spec.ts`.
- `npm run lint -- --fix`: corrió limpio, reformateó 3 archivos (whitespace/estilo, sin cambios de comportamiento); una segunda corrida sin `--fix` no reportó errores ni warnings.

- Commit `e10e921` en la rama `worktree-issue-157-patient-origin-tracking`: `feat(consultations): mostrar estado de entrega de recordatorios por email` (T5, frontend). 5 archivos, +157/-1.
- Confirmado con codegraph/lectura directa el shape real que el backend devuelve (`ConsultationsService.ReminderEmailStatus`, `consultations.service.ts:52-56` y `getReminderEmailStatusMap`): `{ status: 'PENDING'|'SENT'|'FAILED'|'SKIPPED'; deliveredAt: string|null; openedAt: string|null } | null`, tanto en `findByPatient` (serializado por Nest, Date -> ISO string) como en `findByRange` (conversión explícita a ISO).
- Nuevo `frontend/src/components/reminders/ReminderEmailStatusBadge.tsx` (patrón calcado de `PaymentStatusBadge`): `null` no renderiza nada; `PENDING`/`SKIPPED` tampoco (estados transitorios/no-op sin valor informativo en esta vista); `FAILED` → "Recordatorio no enviado" (alerta, `bg-red-50`); `SENT` sin `deliveredAt` → "Recordatorio enviado" (neutro); `deliveredAt` sin `openedAt` → "Entregado" (éxito); `openedAt` → "Abierto" (éxito).
- Agregado `ReminderEmailStatus`/`reminderEmailStatus: ReminderEmailStatus | null` a `Consultation` en `frontend/src/types/patient.ts`, y `reminderEmailStatus?: ReminderEmailStatus | null` (opcional, para no romper fixtures existentes de `CalendarPage.spec.tsx`/`useCalendarSessions.spec.tsx`) a `CalendarSession` en `frontend/src/api/consultations.ts` — no se muestra en `CalendarPage` (sin lugar visual claro en la grilla), solo se agregó el tipo por consistencia con lo que `/consultations/range` ya devuelve.
- Integrado en `frontend/src/pages/ConsultationsPage.tsx`, misma fila de chips, justo después de `<PaymentStatusBadge payment={c.payment} />`.
- Tests nuevos: `frontend/src/components/reminders/ReminderEmailStatusBadge.spec.tsx` (7 casos: null, PENDING, SKIPPED, FAILED, SENT, deliveredAt, openedAt).
- `npm run test -- --run` (Vitest, frontend): **23 test files passed, 141 tests passed**, 0 failed.
- `npm run lint` (frontend): sin salida, sin errores ni warnings.
- `npm run build` (frontend, `tsc -b && vite build`): typecheck y build de producción pasaron limpio (tras marcar `CalendarSession.reminderEmailStatus` opcional).

## Checks aplicables
- Backend: `npm run test` (Jest) en `backend/`, `npx prisma validate`. **Verificados (T1-T4).**
- Frontend: `npm run test` (Vitest) en `frontend/`, `npm run lint`, `npm run build` (typecheck). **Verificados (T5), ver evidencia arriba.**

## Próximo paso
Issue #163 completo (T1-T5). PR #166 abierto (`Closes #163`) contra `main`. Rama rebasada sobre `main` antes de abrir el PR para dejar el diff limpio (solo #163) tras detectar que arrastraba los commits ya squash-mergeados de #157 (PR #165) desde un punto viejo de `main`.
