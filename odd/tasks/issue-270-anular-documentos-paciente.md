# Anular documentos de paciente subidos por error (issue #270)

## Objetivo
Permitir corregir un `PatientDocument` subido por error mediante una anulación con motivo
obligatorio, sin borrado físico, y mantener coherente el ledger de consentimiento
(`PatientConsent`).

## Por qué
Hoy `documents.controller.ts` solo expone upload, listado y descarga. Subir un
`INFORMED_CONSENT` / `TELEMED_AGREEMENT` registra un `GRANT` automático en el ledger; si el archivo
era erróneo, ese `GRANT` es falso y desbloquea consultas sin consentimiento real. El borrado físico
no es viable (custodia de 15 años, Ley 20.584; ledger append-only que cita el id del documento).

## Alcance
- Schema: `PatientDocument.voidedAt/voidedById/voidReason`, `PatientConsent.documentId`,
  `AuditAction.DOCUMENT_VOID` + migración.
- `POST /documents/:id/void` con `{ reason }` (5..500 caracteres), auditado como `DOCUMENT_VOID`.
- Efecto en el ledger dentro de un `$transaction`: `REVOKE` solo si el último evento es un `GRANT`
  atado a un documento anulado y no queda otro documento vigente del mismo propósito.
- El `GRANT` automático del upload ahora guarda `documentId`.
- Frontend: acción "Anular" con motivo en "Documentos legales" de `PatientModal`, badge "Anulado".
- Docs: `docs/registro-actividades-tratamiento.md` y README.

**Fuera de alcance**: sha256 de duplicados, `GRANT` idempotente, borrado físico.

## Restricciones y decisiones
- `PatientConsent` no tiene trigger append-only (solo RLS habilitado sin policies y convención de
  ledger); `AuditLog` sí, pero no se toca su estructura, solo se agrega un valor al enum.
- La migración se genera con `prisma migrate diff` (el shadow DB está roto por RLS en
  `_prisma_migrations`) y se aplica con `migrate deploy`. Nunca `migrate reset`.
- `RecordConsentDto` no cambia: `documentId` solo lo pasan callers internos del servidor.
- Descarga de documentos anulados sigue permitida (custodia). El listado los sigue devolviendo.
- `DOCUMENT_UPLOAD` existe en el enum pero el interceptor no lo emite; la anulación se audita con
  `@AuditRead({ action: 'DOCUMENT_VOID' })`, que sobrescribe la acción por defecto.

## Ruta de implementación
Delegated direct: un writer (2+ archivos no triviales por unidad).

## TDD
No estricto (escribir tests junto a cada unidad). Runners: Jest (backend `npm run test`), Vitest
(frontend `npm run test`).

## Tareas
- [x] T1: Schema + migración + DTO + service + controller + auditoría + tests (backend), commit `7ea6929`
- [x] T2: Frontend (api, hook, tipos, modal de anulación) + tests, commit `8c388e6`
- [x] T3: Docs (registro de actividades de tratamiento + README)

## Evidencia / commits
- `7ea6929` feat(documents): anular documentos de paciente con motivo obligatorio
- `8c388e6` feat(patients): anular documentos legales desde la ficha
- T3 en el commit de docs que sigue (sin push, sin PR).

Observaciones:
- `PatientConsent` no tiene trigger append-only; ADD COLUMN, índice y FK (RESTRICT) aplicaron con
  `prisma migrate deploy` sobre la DB local (migración `20260925120000_add_document_void`).
- La FK obliga a borrar consentimientos antes que documentos en la limpieza de specs e2e; se
  ajustó el orden en `patient-consent.e2e-spec.ts` y `rbac-ownership.e2e-spec.ts`.
- `DOCUMENT_UPLOAD` no se emite hoy (el upload se audita como CREATE); la anulación usa
  `@AuditRead({ action: 'DOCUMENT_VOID' })`.
- Pendiente de criterio legal: si la anulación con motivo satisface el derecho de rectificación.

## Checks
- Backend: `tsc --noEmit` OK; `jest` 68 suites / 803 tests OK (integration specs con DB local);
  e2e de patient-consent, rbac-ownership y documents 43/43 OK (cubre 2 docs -> sin REVOKE, ambos ->
  REVOKE, GRANT manual -> sin REVOKE, 409, 400, 404, auditoría DOCUMENT_VOID); eslint y prettier OK;
  `prisma validate` OK.
- Frontend: `npm run test` 40 archivos / 208 tests OK; `npm run lint` OK; `npm run build` OK.
- No verificado: click-through real en navegador.

## Próximo paso
Revisión y PR (decisión del usuario).
