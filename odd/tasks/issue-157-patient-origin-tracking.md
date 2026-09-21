# Issue #157: Tracking de origen de pacientes en autoagenda pública

## Objetivo
Capturar de dónde vienen los pacientes que reservan vía `/book/:therapistId` (referrer + UTM) y mostrar el desglose por canal en el dashboard del terapeuta.

## Por qué
Primero de la lista de "quick wins" priorizada junto al usuario tras comparar Umbral con Encuadrado (memoria #1457): free tier, sin decisiones de negocio pendientes, reusa infraestructura existente.

## Alcance (del issue)
- Capturar `document.referrer` y query params (`utm_source`, `utm_medium`, `utm_campaign`) al montar `PublicBookingPage.tsx`.
- Persistir el origen en `Patient` al reservar (`bookPublicSlot` → `resolveForPublicBooking`), solo cuando el paciente se autocrea (`isNew`).
- Nueva sección en el dashboard con el desglose por canal.

## Restricciones / decisiones de diseño
- Campos nuevos en `Patient`: `acquisitionSource String?` (etiqueta derivada: `utm_source` si viene, si no el hostname del referrer, si no `"directo"`) y `acquisitionReferrer String?` (URL cruda del referrer, para detalle/debug).
- Solo se setean en la creación (`isNew` en `resolveForPublicBooking`); pacientes creados por el terapeuta en la ficha completa quedan `null`.
- DTO nuevo `PublicBookingOriginDto` (opcional) en el payload de `book-public-slot.dto.ts`, validado con class-validator (`@IsOptional @IsString @MaxLength`).
- Nuevo endpoint `GET /patients/stats/acquisition` (agregación en backend, mismo criterio que `getStats` de consultas — issue #40) para no traer todas las filas al frontend.
- TDD: sin modo estricto configurado en el proyecto; se escriben tests junto con cada unidad de trabajo (mismo patrón que sesiones previas).

## Tareas

- [x] T1 — Schema: agregar `acquisitionSource`/`acquisitionReferrer` a `Patient` + migración Prisma. Ruta: delegada (writer backend).
- [x] T2 — Backend: `PublicBookingOriginDto`, extender `BookPublicSlotDto`, pasar `origin` por `PublicSchedulingService.book()` → `resolveForPublicBooking()`, persistir en creación. Tests de servicio/dto. Ruta: delegada (writer backend).
- [x] T3 — Backend: `PatientsService.getAcquisitionStats(therapistId)` + `GET /patients/stats/acquisition` en el controller. Tests. Ruta: delegada (writer backend).
- [x] T4 — Frontend: capturar referrer/UTM en `PublicBookingPage.tsx`, pasar a `PublicBookingForm`, incluir en `bookPublicSlot` payload (`api/publicScheduling.ts`). Tests de form/page. Ruta: delegada (writer frontend).
- [x] T5 — Frontend: `api/patients.ts` (`getAcquisitionStats`), nueva sección "Origen de pacientes" en `DashboardPage.tsx`. Tests. Ruta: delegada (writer frontend).

## Evidencia / commits
- T1-T3 (backend): commit `feat(patients): rastrear origen de pacientes autoagendados` en `worktree-issue-157-patient-origin-tracking`.
  - Migración `20260921140000_add_patient_acquisition_source` generada con `prisma migrate diff` (shadow DB rota por RLS en `_prisma_migrations`, mismo bug conocido documentado en memoria) y aplicada con `prisma migrate deploy` contra el Postgres local en Docker.
  - Tests: `npx jest` (suite completa, con `DATABASE_URL`/`DIRECT_URL` seteadas para las specs de integración) → 656/656 OK. Subset `public-scheduling patients` → 76/76 OK.
  - Lint: `npm run lint` (eslint --fix) → sin errores.
- T4-T5 (frontend): commit `feat(dashboard): mostrar desglose de pacientes por canal de origen` en `worktree-issue-157-patient-origin-tracking`.
  - `node_modules` no estaba instalado en este worktree; se corrió `npm install` (376 paquetes) antes de poder testear.
  - Tests: `npm run test` (Vitest, suite completa) → 134/134 OK. Subset `PublicBooking Dashboard` → 18/18 OK, incluye 3 tests nuevos en `DashboardPage.spec.tsx` (no existía antes, precedente sí existe para specs de página: `PatientsPage.spec.tsx`, `PublicBookingPage.spec.tsx`, etc.).
  - Lint: `npm run lint` (eslint) → sin errores.
  - Build: `npm run build` (`tsc -b && vite build`) → OK, sin errores de tipos.

## Checks aplicables
- Backend: `npm run test` (Jest) en `backend/`, `npx prisma validate`.
- Frontend: `npm run test` (Vitest) en `frontend/`, `npm run build` (typecheck) opcional si hay tiempo.

## Próximo paso
Delegar T1-T3 (backend) a un writer; luego T4-T5 (frontend) a otro writer, cada uno con su propio commit de work-unit.
